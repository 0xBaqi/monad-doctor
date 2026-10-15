import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHealthDispatcher } from '../lib/health-dispatcher.ts';
import { HEALTH_LIMITS } from '../lib/health-coordinator-model.ts';
import { RPC_ENDPOINTS } from '../lib/rpc-providers.ts';
import { createRpc } from '../lib/rpc.ts';
import { quantity } from '../lib/validation.ts';
import { ControlledTransport, FakeClock, automaticTransport, deferred, wallNow } from './fixtures/health-coordinator.ts';

const nativeFetch = globalThis.fetch; let unexpectedNetwork = 0;
before(() => { globalThis.fetch = async () => { unexpectedNetwork++; throw new Error('Live transport forbidden in offline tests.'); }; });
after(() => { globalThis.fetch = nativeFetch; assert.equal(unexpectedNetwork, 0); });

for (const provider of ['primary', 'secondary'] as const) test('coordinator allowlist matches unchanged legacy destination: ' + provider, async () => {
 let calls = 0;
 const rpc = createRpc(provider, { fetcher: async (url, init) => {
  calls++; assert.equal(String(url), RPC_ENDPOINTS[provider]); assert.equal(init!.redirect, 'error');
  const request = JSON.parse(String(init!.body)); return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x8f' });
 } });
 assert.equal((await rpc.call('eth_chainId', [], quantity)).ok, true); assert.equal(calls, 1);
});

function setup(fetcher?: typeof fetch, alignment = false) {
 const clock = new FakeClock(), transport = new ControlledTransport(), controller = new AbortController();
 const dispatcher = createHealthDispatcher({ runId: 'dispatch-run', alignment, origin: clock.now(), clock, wallNow, fetcher: fetcher ?? transport.fetcher });
 return { clock, transport, controller, dispatcher, call: (id = 'C.primary') => dispatcher.dispatch(id, clock.now() + 2000, controller.signal) };
}
test('dispatcher owns the fixed eight-operation plan and never refunds attempts', async () => {
 const { dispatcher, call } = setup(automaticTransport(), true);
 assert.equal(dispatcher.plan.length, 8); assert.ok(Object.isFrozen(dispatcher.plan));
 dispatcher.bindHistorical('0x63');
 for (const op of dispatcher.plan) await call(op.id);
 assert.deepEqual(dispatcher.counters(), { planned: 8, dispatched: 8, completed: 8, skipped: 0, inFlight: 0 });
 await assert.rejects(call('C.primary')); await assert.rejects(call('extra.primary'));
 assert.equal(dispatcher.counters().dispatched, 8); assert.ok(dispatcher.counters().dispatched <= HEALTH_LIMITS.dispatched);
});
test('dispatcher cannot send an unbound or rebound alignment operation', async () => {
 const { dispatcher, call } = setup(automaticTransport(), true);
 await assert.rejects(call('H.primary'), /Unbound/); assert.equal(dispatcher.counters().dispatched, 0);
 dispatcher.bindHistorical('0x63'); assert.throws(() => dispatcher.bindHistorical('0x64'));
});
test('dispatcher pre-dispatch cancellation invokes no transport', async () => {
 const s = setup(); s.controller.abort(); const entry = await s.call();
 assert.equal(entry.state, 'skipped'); assert.equal(entry.skipReason, 'cancelled'); assert.equal(s.transport.calls.length, 0);
});
test('dispatcher counts before a synchronous throw and sanitizes the exception', async () => {
 let countAtInvocation = 0;
 const s = setup(() => { countAtInvocation = s.dispatcher.counters().dispatched; throw new Error('SECRET_TRANSPORT_TEXT'); });
 const entry = await s.call(); assert.equal(countAtInvocation, 1); assert.equal(entry.observation?.kind, 'error');
 assert.ok(!JSON.stringify(entry).includes('SECRET')); assert.equal(s.dispatcher.counters().inFlight, 0);
});
test('dispatcher ignored abort quarantines the lease and blocks all subsequent transport', async () => {
 const s = setup(), pending = s.call(); await s.clock.flush();
 const drained = s.dispatcher.drained(); let settled = false; void drained.then(() => { settled = true; });
 await s.clock.advance(2000); assert.equal(s.transport.calls[0].signal.aborted, true); assert.equal(settled, false);
 await s.clock.advance(250); const published = await pending, before = JSON.stringify(published);
 assert.equal(published.transport, 'quarantined'); assert.equal(s.dispatcher.counters().inFlight, 1);
 const other = await s.call('C.secondary'); assert.equal(other.skipReason, 'transport_quarantined'); assert.equal(s.transport.calls.length, 1);
 s.transport.reply(0, '0x8f'); await s.clock.flush(); await drained;
 assert.equal(JSON.stringify(published), before); assert.equal(s.dispatcher.counters().inFlight, 0);
});
test('dispatcher late settlement within cleanup grace permits safe continuation without accepting late evidence', async () => {
 const s = setup(), pending = s.call(); await s.clock.advance(2000); s.transport.reply(0, '0x8f'); await s.clock.flush();
 const entry = await pending; assert.equal(entry.transport, 'quiescent'); assert.deepEqual(entry.observation && 'code' in entry.observation && entry.observation.code, 'TIMEOUT');
 const other = s.call('C.secondary'); await s.clock.flush(); assert.equal(s.transport.calls.length, 2);
 s.transport.reply(1, '0x8f'); await other;
});
test('dispatcher response processed exactly at deadline is unavailable', async () => {
 const s = setup(), pending = s.call(); s.clock.time += 2000; s.transport.reply(0, '0x8f'); await s.clock.flush();
 const entry = await pending; assert.equal(entry.observation?.kind === 'error' && entry.observation.code, 'TIMEOUT');
});
test('dispatcher exact-grace cleanup cannot win a delayed timer race', async () => {
 const s = setup(), pending = s.call(); await s.clock.advance(2000);
 s.clock.time += 250; s.transport.reply(0, '0x8f'); await s.clock.flush();
 const entry = await pending; assert.equal(entry.cleanupExceeded, true); assert.equal(entry.transport, 'quarantined');
 await s.dispatcher.drained(); assert.equal(s.dispatcher.counters().inFlight, 0);
});
test('dispatcher delayed observation timer cannot grant a fresh cleanup allowance', async () => {
 const s = setup(), pending = s.call(); s.clock.time += 2251;
 s.transport.reply(0, '0x8f'); await s.clock.flush(); const entry = await pending;
 assert.equal(entry.observation?.kind === 'error' && entry.observation.code, 'TIMEOUT');
 assert.equal(entry.cleanupExceeded, true); await s.dispatcher.drained();
});
test('dispatcher stalled body keeps ownership until cancellation acknowledgment', async () => {
 const cleanup = deferred<void>(); let cancelled = 0;
 const body = new ReadableStream<Uint8Array>({ cancel() { cancelled++; return cleanup.promise; } });
 const s = setup(async () => new Response(body)), pending = s.call(); await s.clock.flush();
 const drained = s.dispatcher.drained(); let settled = false; void drained.then(() => { settled = true; });
 await s.clock.advance(2250); const entry = await pending;
 assert.equal(cancelled, 1); assert.equal(entry.transport, 'quarantined'); assert.equal(settled, false);
 cleanup.resolve(); await s.clock.flush(); await drained; assert.equal(settled, true);
});
test('dispatcher cannot declare a locked response body drained', async () => {
 const response = new Response(new ReadableStream<Uint8Array>()), lock = response.body!.getReader();
 const s = setup(async () => response), pending = s.call(); await s.clock.flush(); await s.clock.advance(250);
 assert.equal((await pending).transport, 'quarantined'); assert.equal(s.dispatcher.counters().inFlight, 1); lock.releaseLock();
});
test('dispatcher rejected body cancellation never claims successful cleanup', async () => {
 const s = setup(async () => new Response(new ReadableStream({ cancel() { return Promise.reject(new Error('SECRET')); } })));
 const pending = s.call(); await s.clock.flush(); await s.clock.advance(2250); const entry = await pending;
 assert.equal(entry.transport, 'quarantined'); assert.equal(s.dispatcher.counters().inFlight, 1); assert.ok(!JSON.stringify(entry).includes('SECRET'));
});
test('dispatcher in-flight user cancellation differs from timeout', async () => {
 const s = setup(), pending = s.call(); s.controller.abort(); await s.clock.advance(250); const entry = await pending;
 assert.equal(entry.observation?.kind === 'error' && entry.observation.code, 'CANCELLED');
 assert.equal(entry.decisionCause, 'cancelled'); assert.equal(s.dispatcher.counters().dispatched, 1);
});
for (const fault of ['rpc-error', 'wrong-id', 'both-result-error', 'truncated', 'invalid-utf8', 'oversized', 'null-body', 'http429', 'redirect', 'bad-block'] as const) test('dispatcher bounds and sanitizes ' + fault, async () => {
 const s = setup(async (_url, init) => {
  const id = JSON.parse(String(init!.body)).id;
  if (fault === 'truncated') return new Response('{"secret":"SECRET"');
  if (fault === 'invalid-utf8') return new Response(new Uint8Array([255]));
  if (fault === 'oversized') return new Response(new Uint8Array(HEALTH_LIMITS.responseBytes + 1));
  if (fault === 'null-body') return new Response(null);
  if (fault === 'http429') return new Response('SECRET', { status: 429 });
  if (fault === 'redirect') return new Response('SECRET', { status: 302, headers: { Location: 'https://unapproved.invalid' } });
  if (fault === 'rpc-error') return Response.json({ jsonrpc: '2.0', id, error: { code: -32603, message: 'SECRET', data: 'SECRET' } });
  if (fault === 'both-result-error') return Response.json({ jsonrpc: '2.0', id, result: '0x8f', error: { code: -1, message: 'SECRET' } });
  if (fault === 'bad-block') return Response.json({ jsonrpc: '2.0', id, result: { number: '0x1', hash: 'SECRET' } });
  return Response.json({ jsonrpc: '2.0', id: id + 1, result: '0x8f' });
 });
 const entry = await s.call(fault === 'bad-block' ? 'F.primary' : 'C.primary');
 assert.equal(entry.observation?.kind, 'error'); assert.ok(!JSON.stringify(entry).includes('SECRET'));
 assert.equal(s.dispatcher.counters().dispatched, 1); assert.equal(s.dispatcher.counters().inFlight, 0);
 assert.ok(entry.acceptedBytes <= HEALTH_LIMITS.responseBytes);
});
test('dispatcher destination, methods and wire options are server controlled', async () => {
 const s = setup(), pending = s.call(); const call = s.transport.calls[0];
 assert.equal(call.url, RPC_ENDPOINTS.primary); assert.equal(call.method, 'eth_chainId'); assert.deepEqual(call.params, []);
 assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store'); assert.equal(call.init.method, 'POST');
 assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json' });
 s.transport.reply(0, '0x8f'); await pending; s.dispatcher.close(); await assert.rejects(s.call('C.secondary'));
});

for (const source of ['timestamp', 'clock', 'timer', 'transport'] as const) test('dispatcher reserves ownership before reentrant ' + source, async () => {
 const clock = new FakeClock(), transport = new ControlledTransport(), signal = new AbortController().signal;
 let entered = false;
 const attempts: Promise<unknown>[] = [];
 const reenter = () => {
  if (entered) return; entered = true;
  attempts.push(assert.rejects(dispatcher.dispatch('C.primary', 3000, signal), /consumed/));
  attempts.push(dispatcher.dispatch('C.secondary', 3000, signal).then(e => assert.equal(e.skipReason, 'transport_quarantined')));
 };
 const injectedClock = {
  now: () => { if (source === 'clock') reenter(); return clock.now(); },
  at: (deadline: number, callback: () => void) => { if (source === 'timer') reenter(); return clock.at(deadline, callback); },
 };
 const dispatcher: ReturnType<typeof createHealthDispatcher> = createHealthDispatcher({ runId: 'reenter-' + source, alignment: false, origin: clock.now(), clock: injectedClock,
  wallNow: () => { if (source === 'timestamp') reenter(); return wallNow(); },
  fetcher: (url, init) => { if (source === 'transport') reenter(); return transport.fetcher(url, init); },
 });
 const first = dispatcher.dispatch('C.primary', 3000, signal); await clock.flush(); await Promise.all(attempts);
 assert.equal(transport.calls.length, 1); assert.equal(dispatcher.counters().inFlight, 1);
 let drained = false; void dispatcher.drained().then(() => { drained = true; });
 await clock.flush(); assert.equal(drained, false);
 transport.reply(0, '0x8f'); await first; await clock.flush(); assert.equal(drained, true);
 assert.equal(dispatcher.counters().dispatched, 1); assert.equal(dispatcher.counters().inFlight, 0);
});

test('dispatcher blocks twelve-attempt amplification and invokes each of eight plan entries once', async () => {
 const clock = new FakeClock(), signal = new AbortController().signal; let calls = 0;
 const rejected: Promise<unknown>[] = [];
 const dispatcher: ReturnType<typeof createHealthDispatcher> = createHealthDispatcher({ runId: 'amplification', alignment: true, origin: clock.now(), clock,
  wallNow: () => {
   // Every operation tries the reproduced recursive entry before transport.
   for (let i = 0; i < 12; i++) rejected.push(assert.rejects(dispatcher.dispatch('C.primary', clock.now() + 2000, signal)));
   return wallNow();
  }, fetcher: (url, init) => { calls++; assert.equal(dispatcher.counters().dispatched, calls); return automaticTransport()(url, init); },
 });
 dispatcher.bindHistorical('0x63');
 for (const op of dispatcher.plan) await dispatcher.dispatch(op.id, clock.now() + 2000, signal);
 await Promise.all(rejected);
 assert.equal(calls, 8); assert.equal(rejected.length, 96);
 assert.deepEqual(dispatcher.counters(), { planned: 8, dispatched: 8, completed: 8, skipped: 0, inFlight: 0 });
 assert.deepEqual(dispatcher.ledger().map(e => e.dispatchOrdinal), [1, 2, 3, 4, 5, 6, 7, 8]);
});

for (const stage of ['timestamp', 'timer', 'clock'] as const) for (const event of ['cancel', 'deadline'] as const) test(`dispatcher rechecks ${event} after ${stage} callback before invocation`, async () => {
 const clock = new FakeClock(), transport = new ControlledTransport(), abort = new AbortController(); let nowReads = 0;
 const alter = () => { if (event === 'cancel') abort.abort(); else clock.time += HEALTH_LIMITS.collectionMs; };
 const dispatcher = createHealthDispatcher({ runId: 'pre-dispatch-' + stage + '-' + event, alignment: false, origin: clock.now(),
  clock: {
   now: () => { if (stage === 'clock' && ++nowReads === 3) alter(); return clock.now(); },
   at: (deadline, callback) => { if (stage === 'timer') alter(); return clock.at(deadline, callback); },
  }, wallNow: () => { if (stage === 'timestamp') alter(); return wallNow(); }, fetcher: transport.fetcher,
 });
 const entry = await dispatcher.dispatch('C.primary', 3000, abort.signal);
 assert.equal(entry.state, 'skipped'); assert.equal(entry.skipReason, event === 'cancel' ? 'cancelled' : 'deadline');
 assert.equal(transport.calls.length, 0); assert.equal(dispatcher.counters().dispatched, 0); assert.equal(entry.dispatchOrdinal, undefined);
 await dispatcher.drained(); assert.equal(dispatcher.counters().inFlight, 0);
});

for (const source of ['timestamp', 'clock-now', 'clock-at'] as const) test('dispatcher preparation exception releases only the reservation: ' + source, async () => {
 const clock = new FakeClock(), transport = new ControlledTransport(), signal = new AbortController().signal;
 let failing = true;
 const dispatcher = createHealthDispatcher({ runId: 'throw-' + source, alignment: false, origin: clock.now(),
  clock: { now: () => { if (failing && source === 'clock-now') throw new Error('SECRET'); return clock.now(); },
   at: (deadline, callback) => { if (failing && source === 'clock-at') throw new Error('SECRET'); return clock.at(deadline, callback); } },
  wallNow: () => { if (failing && source === 'timestamp') throw new Error('SECRET'); return wallNow(); }, fetcher: transport.fetcher,
 });
 await assert.rejects(dispatcher.dispatch('C.primary', 3000, signal), /^Error: Health dispatch preparation failed\.$/);
 assert.equal(transport.calls.length, 0); assert.equal(dispatcher.counters().dispatched, 0); assert.equal(dispatcher.counters().inFlight, 0);
 assert.equal(dispatcher.ledger()[0].skipReason, 'preparation_error'); assert.ok(!JSON.stringify(dispatcher.ledger()).includes('SECRET'));
 await dispatcher.drained(); failing = false;
 // A failed clock disables further dispatch. A failed timestamp does not.
 const second = dispatcher.dispatch('C.secondary', 3000, signal);
 if (source === 'clock-now') assert.equal((await second).skipReason, 'preparation_error');
 else { transport.reply(0, '0x8f'); await second; }
});

for (const source of ['now', 'at'] as const) test('dispatcher clock failure after invocation seals conservatively and drains acknowledged cleanup: ' + source, async () => {
 const clock = new FakeClock(), transport = new ControlledTransport(), signal = new AbortController().signal; let failing = false;
 const dispatcher = createHealthDispatcher({ runId: 'post-clock-' + source, alignment: false, origin: clock.now(),
  clock: { now: () => { if (failing && source === 'now') throw new Error('SECRET'); return clock.now(); },
   at: (deadline, callback) => { if (failing && source === 'at') throw new Error('SECRET'); return clock.at(deadline, callback); } }, wallNow, fetcher: transport.fetcher,
 });
 const pending = dispatcher.dispatch('C.primary', 3000, signal); failing = true; transport.reply(0, '0x8f'); await clock.flush();
 const entry = await pending; await dispatcher.drained();
 assert.equal(entry.observation?.kind === 'error' && entry.observation.code, 'NETWORK');
 assert.equal(entry.cleanupExceeded, true); assert.equal(dispatcher.counters().inFlight, 0); assert.equal(dispatcher.counters().dispatched, 1);
 assert.equal((await dispatcher.dispatch('C.secondary', 3000, signal)).skipReason, 'preparation_error');
 assert.ok(!JSON.stringify(entry).includes('SECRET'));
});

test('dispatcher stale callbacks cannot release the unique lease of a later operation', async () => {
 const clock = new FakeClock(), transport = new ControlledTransport(), signal = new AbortController().signal;
 const callbacks: (() => void)[] = [];
 const dispatcher = createHealthDispatcher({ runId: 'unique-lease', alignment: false, origin: clock.now(),
  clock: { now: clock.now, at: (deadline, callback) => { callbacks.push(callback); return clock.at(deadline, callback); } }, wallNow, fetcher: transport.fetcher,
 });
 const first = dispatcher.dispatch('C.primary', 3000, signal); transport.reply(0, '0x8f'); await first;
 const staleCallbacks = callbacks.slice(), second = dispatcher.dispatch('C.secondary', 3000, signal);
 let drained = false; void dispatcher.drained().then(() => { drained = true; });
 staleCallbacks.forEach(callback => callback()); await clock.flush();
 assert.equal(dispatcher.counters().inFlight, 1); assert.equal(drained, false);
 assert.equal((await dispatcher.dispatch('F.primary', 3000, signal)).skipReason, 'transport_quarantined');
 assert.equal(transport.calls.length, 2); transport.reply(1, '0x8f'); await second; await clock.flush(); assert.equal(drained, true);
});

test('dispatcher clock failure during cancellation retains quarantine until ignored abort is acknowledged', async () => {
 const clock = new FakeClock(), transport = new ControlledTransport(), abort = new AbortController(); let failing = false, drained = false;
 const dispatcher = createHealthDispatcher({ runId: 'clock-failure-quarantine', alignment: false, origin: clock.now(),
  clock: { now: () => { if (failing) throw new Error('SECRET'); return clock.now(); }, at: clock.at }, wallNow, fetcher: transport.fetcher,
 });
 const pending = dispatcher.dispatch('C.primary', 3000, abort.signal);
 void dispatcher.drained().then(() => { drained = true; });
 failing = true; abort.abort(); abort.abort(); await clock.flush();
 const entry = await pending, before = JSON.stringify(entry);
 assert.equal(entry.transport, 'quarantined'); assert.equal(dispatcher.ledger()[0].transport, 'quarantined');
 assert.equal(drained, false); assert.equal(dispatcher.counters().inFlight, 1);
 assert.equal((await dispatcher.dispatch('C.secondary', 3000, abort.signal)).skipReason, 'transport_quarantined');
 assert.equal(transport.calls.length, 1);
 transport.reply(0, '0x8f'); await clock.flush(); await dispatcher.drained();
 assert.equal(drained, true); assert.equal(dispatcher.counters().inFlight, 0); assert.equal(JSON.stringify(entry), before);
});
