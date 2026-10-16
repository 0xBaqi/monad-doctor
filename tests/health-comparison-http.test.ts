import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessCapacity, processCapacity } from '../lib/http-capacity.ts';
import { handleDiagnostic } from '../lib/http.ts';
import { startHealthComparisonHttp, type ComparisonHttpDependencies } from '../lib/health-comparison-http.ts';
import { serializeHealthComparison } from '../lib/health-comparison-response.ts';
import { startHealthComparison } from '../lib/health-coordinator.ts';
import { startTrackedReservation } from '../lib/tracked-budget.ts';
import { BUDGET_SCRIPT } from '../lib/budget.ts';
import { parseInput } from '../lib/validation.ts';
import { exportReport } from '../lib/export.ts';
import { FakeClock, ControlledTransport, automaticTransport, comparisonRequest, deferred, wallNow } from './fixtures/health-coordinator.ts';
import { readFileSync } from 'node:fs';

// A test accidentally falling through to ambient networking must fail immediately.
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Network forbidden in offline integration tests.'); };
test.after(() => { globalThis.fetch = originalFetch; });
const env = { UPSTASH_REDIS_REST_URL: 'https://synthetic-test.upstash.io', UPSTASH_REDIS_REST_TOKEN: 'PRIVATE_MARKER' };
const headers = { 'content-type': 'application/json' };
function request(raw: unknown = comparisonRequest(), signal?: AbortSignal) { return new Request('http://localhost/api/diagnose', { method: 'POST', headers, body: JSON.stringify(raw), signal }); }
function setup(extra: Partial<ComparisonHttpDependencies> = {}) {
 const clock = new FakeClock(), lifecycle: Promise<void>[] = [], rpc = new ControlledTransport();
 let reservations = 0;
 const deps: ComparisonHttpDependencies = { clock, env, rpcFetch: rpc.fetcher, redisFetch: async (_url, init) => {
  reservations++;
  assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
  assert.deepEqual(JSON.parse(String(init?.body)), ['EVAL', BUDGET_SCRIPT, 2, 'monad-doctor:rpc:v1:minute', 'monad-doctor:rpc:v1:day']);
  return Response.json({ result: [1, 0] });
 }, registerLifecycle(p) { lifecycle.push(p); }, capacity: createProcessCapacity(clock.now), runId: 'http-test', wallNow, ...extra };
 return { clock, rpc, deps, lifecycle, reservations: () => reservations };
}
async function pending(p: Promise<unknown>, clock: FakeClock) { let settled = false; void p.then(() => { settled = true; }, () => { settled = true; }); await clock.flush(); assert.equal(settled, false); }
function assertHeld(capacity = processCapacity) {
 const leases = Array.from({ length: 3 }, () => capacity.tryAcquire());
 assert.ok(leases.every(Boolean)); assert.equal(capacity.tryAcquire(), undefined);
 leases.forEach(l => l!.release());
}

test('capacity leases release idempotently and retain the 30-admission fixed window', () => {
 let now = 1000; const pool = createProcessCapacity(() => now);
 const leases = Array.from({ length: 4 }, () => pool.tryAcquire()); assert.ok(leases.every(Boolean)); assert.equal(pool.tryAcquire(), undefined);
 leases.forEach(l => { l!.release(); l!.release(); });
 for (let i = 0; i < 26; i++) { const l = pool.tryAcquire(); assert.ok(l); l.release(); }
 assert.equal(pool.tryAcquire(), undefined); now = 61000; assert.ok(pool.tryAcquire());
});

test('four published quarantined comparisons reject a fifth before Redis and keep capacity until cleanup', async () => {
 const s = setup(); const handles = Array.from({ length: 4 }, () => startHealthComparisonHttp(request(), s.deps));
 await s.clock.flush(); assert.equal(s.rpc.calls.length, 4); assert.equal(s.reservations(), 4);
 await s.clock.advance(2250);
 for (const h of handles) {
  const r = await h.response; assert.equal(r.status, 200); const json = await r.json();
  assert.equal(json.result.report.cleanupPending, true); assert.equal(json.result.report.status, 'partial'); await pending(h.drained, s.clock);
 }
 const fifth = startHealthComparisonHttp(request(), s.deps); assert.equal((await fifth.response).status, 429); assert.equal(s.reservations(), 4);
 for (let i = 0; i < 4; i++) s.rpc.reply(i, '0x8f');
 await Promise.all(handles.map(h => h.drained));
 assert.equal(s.rpc.calls.length, 4); assert.ok(s.deps.capacity!.tryAcquire());
});

test('legacy body readers and comparisons share the production singleton capacity owner', async () => {
 const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
 const legacy = Array.from({ length: 3 }, () => handleDiagnostic(new Request('http://localhost/api/diagnose', { method: 'POST', headers, body: new ReadableStream<Uint8Array>({ start(c) { streams.push(c); } }), duplex: 'half' } as RequestInit)));
 const s = setup({ capacity: processCapacity }); const h = startHealthComparisonHttp(request(), s.deps);
 await s.clock.flush(); assert.equal((await handleDiagnostic(request({}))).status, 429);
 await s.clock.advance(2250); assert.equal((await h.response).status, 200);
 assert.equal((await handleDiagnostic(request({}))).status, 429);
 streams.forEach(c => { c.enqueue(new TextEncoder().encode('{}')); c.close(); }); assert.deepEqual((await Promise.all(legacy)).map(r => r.status), [400,400,400]);
 s.rpc.reply(0, '0x8f'); await h.drained;
});

test('healthy completion registers lifecycle before all transports and preserves qualified evidence', async () => {
 let registered = false;
 const s = setup({ registerLifecycle() { registered = true; }, rpcFetch: async (...args) => { assert.equal(registered, true); return automaticTransport()(...args); } });
 const h = startHealthComparisonHttp(request(), s.deps); const response = await h.response; assert.equal(response.status, 200);
 const text = await response.text(), body = JSON.parse(text); assert.equal(body.comparisonResponseVersion, 1); assert.equal(body.result.report.status, 'completed');
 assert.equal(body.result.report.counters.dispatched, 6); assert.equal(body.result.report.cleanupPending, false);
 for (const row of body.result.report.reconciliation.rows) for (const ref of row.dependencies) assert.ok(['primary','secondary'].includes(ref.provider) && ref.runId === 'http-test');
 assert.ok(!text.includes('PRIVATE_MARKER')); assert.ok(!text.includes('https://'));
 assert.equal(response.headers.get('cache-control'), 'no-store'); await h.drained;
});

for (const [name, fetcher, status, retry] of [
 ['exhausted', async () => Response.json({ result: [0,1501] }), 429, '2'],
 ['malformed', async () => Response.json({ result: [1,0], secret: 'PRIVATE_MARKER' }), 503, null],
 ['network failure', async () => { throw new Error('PRIVATE_MARKER'); }, 503, null],
 ['authentication failure', async () => new Response('PRIVATE_MARKER', { status: 403 }), 503, null],
 ['oversized admission body', async () => new Response('x'.repeat(1025)), 503, null],
 ['invalid UTF-8', async () => new Response(new Uint8Array([255])), 503, null],
] as const) test(`Redis ${name} dispatches zero Monad calls`, async () => {
 let attempts = 0; const s = setup({ redisFetch: async () => { attempts++; return fetcher(); } });
 const h = startHealthComparisonHttp(request(), s.deps), response = await h.response;
 assert.equal(response.status, status); assert.equal(response.headers.get('retry-after'), retry); assert.ok(!(await response.text()).includes('PRIVATE_MARKER'));
 await h.drained; assert.equal(attempts, 1); assert.equal(s.rpc.calls.length, 0);
});

test('ambiguous Redis timeout publishes denial but holds capacity until late cleanup, without retry', async () => {
 const reply = deferred<Response>(); let attempts = 0; const s = setup({ redisFetch: () => { attempts++; return reply.promise; } });
 const h = startHealthComparisonHttp(request(), s.deps); await s.clock.flush(); await s.clock.advance(2000);
 assert.equal((await h.response).status, 503); await pending(h.drained, s.clock); assertHeld(s.deps.capacity);
 await s.clock.advance(30000); assert.equal(attempts, 1); assert.equal(s.rpc.calls.length, 0);
 reply.resolve(Response.json({ result: [1,0] })); await h.drained; assert.equal(s.rpc.calls.length, 0);
});

test('stalled Redis body cancellation acknowledgment gates drain', async () => {
 const cleanup = deferred<void>(); let cancelled = 0;
 const s = setup({ redisFetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled++; return cleanup.promise; } })) });
 const h = startHealthComparisonHttp(request(), s.deps); await s.clock.flush(); await s.clock.advance(2000);
 assert.equal((await h.response).status, 503); assert.equal(cancelled, 1); await pending(h.drained, s.clock); assertHeld(s.deps.capacity);
 cleanup.resolve(); await h.drained; assert.equal(s.rpc.calls.length, 0);
});

test('rejected Redis body cancellation retains ownership instead of acknowledging cleanup', async () => {
 const s = setup({ redisFetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel() { return Promise.reject(new Error('PRIVATE_MARKER')); } })) });
 const h = startHealthComparisonHttp(request(), s.deps); await s.clock.flush(); await s.clock.advance(2000);
 assert.equal((await h.response).status, 503); await pending(h.drained, s.clock); assertHeld(s.deps.capacity); assert.equal(s.rpc.calls.length, 0);
});

for (const stage of ['before', 'reservation', 'collection', 'published'] as const) test(`delivered cancellation ${stage} respects ownership and sealed evidence`, async () => {
 const controller = new AbortController(), redisReply = deferred<Response>();
 const s = setup(stage === 'reservation' ? { redisFetch: () => redisReply.promise } : {});
 if (stage === 'before') controller.abort();
 const h = startHealthComparisonHttp(request(comparisonRequest(), controller.signal), s.deps); await s.clock.flush();
 if (stage === 'published') await s.clock.advance(2250);
 let serialized = '';
 if (stage === 'published') serialized = await (await h.response).text();
 controller.abort(); h.cancel(); h.cancel();
 if (stage === 'reservation') { assert.equal((await h.response).status, 503); await pending(h.drained, s.clock); redisReply.resolve(Response.json({ result: [1,0] })); }
 if (stage === 'collection') { await s.clock.advance(250); const json = await (await h.response).json(); assert.equal(json.result.report.status, 'cancelled'); }
 if (stage === 'collection' || stage === 'published') { await pending(h.drained, s.clock); s.rpc.reply(0, '0x8f'); }
 await h.drained;
 assert.equal(s.rpc.calls.length, stage === 'before' || stage === 'reservation' ? 0 : 1);
 if (stage === 'before') assert.equal(s.reservations(), 0);
 if (stage === 'published') assert.equal(JSON.parse(serialized).result.report.cleanupPending, true);
});

test('lifecycle registration failure prevents even Redis dispatch and releases its slot exactly once', async () => {
 const s = setup({ registerLifecycle() { throw new Error('PRIVATE_MARKER'); } });
 const lease = s.deps.capacity!.tryAcquire()!;
 const h = startHealthComparisonHttp(request(), { ...s.deps, lease }); assert.equal((await h.response).status, 503); await h.drained;
 const four = Array.from({length:4}, () => s.deps.capacity!.tryAcquire()); assert.ok(four.every(Boolean));
 h.cancel(); lease.release(); assert.equal(s.deps.capacity!.tryAcquire(),undefined);
 four.forEach(l => l!.release()); assert.equal(s.reservations(), 0); assert.equal(s.rpc.calls.length, 0);
});

test('captured capacity lease and receiver cannot be substituted during quarantine', async () => {
 const s = setup(), pool = s.deps.capacity!;
 const a = pool.tryAcquire()!, b = pool.tryAcquire()!;
 const injected = { ...s.deps, capacity: pool, lease: a };
 const h = startHealthComparisonHttp(request(), injected);
 injected.lease = b; injected.capacity = createProcessCapacity(s.clock.now);
 assert.equal(Reflect.set(a, 'release', () => assert.fail('replacement')),false);
 await s.clock.flush(); await s.clock.advance(2250); await h.response;
 a.release(); // Ownership transferred: the old holder cannot release early.
 const two = [pool.tryAcquire(),pool.tryAcquire()]; assert.ok(two.every(Boolean)); assert.equal(pool.tryAcquire(),undefined); two.forEach(l=>l!.release());
 s.rpc.reply(0,'0x8f'); await h.drained; h.cancel();
 const three = Array.from({length:3},()=>pool.tryAcquire()); assert.ok(three.every(Boolean)); assert.equal(pool.tryAcquire(),undefined);
 three.forEach(l=>l!.release()); b.release();
});

test('quarantined RPC body retains capacity; late acknowledgment cannot alter response', async () => {
 const bodyCleanup = deferred<void>(); const s = setup({ rpcFetch: async () => new Response(new ReadableStream<Uint8Array>({ cancel() { return bodyCleanup.promise; } })) });
 const h = startHealthComparisonHttp(request(), s.deps); await s.clock.flush(); await s.clock.advance(2250);
 const text = await (await h.response).text(); assert.equal(JSON.parse(text).result.report.cleanupPending, true); await pending(h.drained, s.clock);
 bodyCleanup.resolve(); await h.drained; assert.equal(JSON.parse(text).result.report.counters.inFlight, 1);
});

test('platform-timeout simulation cannot refund an unresolved admission lease', async () => {
 const s = setup(); const h = startHealthComparisonHttp(request(), s.deps); await s.clock.flush(); await s.clock.advance(30000);
 assert.equal((await h.response).status, 200); await pending(h.drained, s.clock); assertHeld(s.deps.capacity); assert.equal(s.rpc.calls.length, 1);
 s.rpc.reply(0, '0x8f'); await h.drained;
});

for (const raw of [{ ...comparisonRequest(), call: { data: '0x1234' } }, { ...comparisonRequest(), providers: ['secondary','primary'] }, { ...comparisonRequest(), url: 'https://evil.invalid' }, { mode: 'health', provider: 'primary' }]) test('strict comparison validation precedes reservation: ' + JSON.stringify(raw), async () => {
 const s = setup(); const h = startHealthComparisonHttp(request(raw), s.deps); assert.equal((await h.response).status, 400); await h.drained; assert.equal(s.reservations(), 0); assert.equal(s.rpc.calls.length, 0);
});

for (const [extra, method, status] of [
 [{ origin: 'https://evil.invalid' }, 'POST', 403], [{ 'sec-fetch-site': 'cross-site' }, 'POST', 403],
 [{ 'content-type': 'text/plain' }, 'POST', 415], [{ 'content-length': '16385' }, 'POST', 413],
 [{ 'content-length': '-1' }, 'POST', 400], [{}, 'PUT', 405],
] as const) test('offline adapter reuses protected request boundary: ' + JSON.stringify(extra) + method, async () => {
 const s = setup(); const r = new Request('http://localhost/api/diagnose', { method, headers: { ...headers, ...extra }, body: '{}' });
 const h = startHealthComparisonHttp(r, s.deps); assert.equal((await h.response).status, status); await h.drained; assert.equal(s.reservations(), 0);
});

test('production route still rejects comparison inputs and imports no comparison adapter', async () => {
 const route = readFileSync(new URL('../app/api/diagnose/route.ts', import.meta.url), 'utf8');
 assert.match(route, /maxDuration = 30/); assert.doesNotMatch(route, /health-comparison|health-coordinator/);
 assert.throws(() => parseInput(comparisonRequest()));
 const r = await handleDiagnostic(request()); assert.equal(r.status, 400);
});

test('comparison serialization rejects forged provenance, conclusions, secrets and malformed envelopes without getters', async () => {
 const clock = new FakeClock(); const h = startHealthComparison(comparisonRequest(), { clock, wallNow, runId: 'serialize', fetcher: automaticTransport(), admission: { release() {} } });
 const result = await h.result; await h.drained; const text = serializeHealthComparison(result); assert.equal(serializeHealthComparison(result), text);
 if (result.kind !== 'comparison') assert.fail();
 const cases: ((v: Extract<typeof result, {kind: 'comparison'}>) => void)[] = [
  v => { (v.report as unknown as Record<string,unknown>).headers = { Authorization: 'PRIVATE_MARKER' }; },
  v => { (v.report.reconciliation.rows[0] as unknown as Record<string,unknown>).relation = 'contradiction'; },
  v => { (v.report.ledger[0].evidence as unknown as Record<string,unknown>).provider = 'secondary'; },
  v => { (v.report as unknown as Record<string,unknown>).cleanupPending = true; },
  v => { (v.report as unknown as Record<string,unknown>).ledger = new Array(6); },
  v => { (v.report as unknown as Record<string,unknown>).runId = 'x'.repeat(65537); },
 ];
 for (const mutate of cases) { const v = structuredClone(result); mutate(v); assert.throws(() => serializeHealthComparison(v)); }
 let getterCalls = 0; const v = structuredClone(result); Object.defineProperty(v.report, 'runId', { enumerable: true, get() { getterCalls++; return 'PRIVATE_MARKER'; } }); assert.throws(() => serializeHealthComparison(v)); assert.equal(getterCalls, 0);
 assert.ok(new TextEncoder().encode(text).byteLength <= 65536);
});

test('tracked reservation rejects unsafe/missing configuration without transport or local bypass', async () => {
 for (const config of [{}, { ...env, UPSTASH_REDIS_REST_URL: 'https://evil.invalid' }, { ...env, UPSTASH_REDIS_REST_TOKEN: 'x\ny' }]) {
  const clock = new FakeClock(); const r = startTrackedReservation({ clock, env: config, fetcher: async () => { assert.fail('network'); } });
  assert.deepEqual(await r.decision, { status: 'unavailable' }); await r.drained;
 }
});

test('legacy export format remains version 1 and redacts calldata', () => {
 const engine = readFileSync(new URL('../lib/engine.ts', import.meta.url), 'utf8'); assert.match(engine, /m3\.1/);
 const input = parseInput({ mode: 'gas', provider: 'primary', gasLimit: '1000000', call: { from: '0x'+'1'.repeat(40), to: '0x'+'2'.repeat(40), value: '0', data: '0xabcdef' } });
 const exported = exportReport({ schemaVersion: 1, ruleVersion: 'm3.1', mode: 'gas', provider: 'primary', input, evidence: [], findings: [], startedAt: '2026-10-16T00:00:00.000Z', completedAt: '2026-10-16T00:00:00.000Z' });
 assert.equal(exported.exportVersion, 1); assert.equal(exported.input.call?.data, '[redacted]'); assert.ok(!JSON.stringify(exported).includes('0xabcdef'));
});

test('concurrent admission burst never reserves Redis for more than four jobs', async () => {
 const s = setup(); const handles = Array.from({ length: 12 }, () => startHealthComparisonHttp(request(), s.deps));
 await s.clock.flush(); assert.equal(s.reservations(), 4); assert.equal(s.rpc.calls.length, 4);
 for (const h of handles.slice(4)) assert.equal((await h.response).status, 429);
 await s.clock.advance(2250); for (let i = 0; i < 4; i++) s.rpc.reply(i, '0x8f'); await Promise.all(handles.map(h => h.drained));
});

test('capacity clock reentry cannot bypass synchronous ownership accounting', () => {
 let nested = 0;
 const pool = createProcessCapacity(() => { assert.equal(pool.tryAcquire(), undefined); nested++; return 1000; });
 const leases = Array.from({ length: 5 }, () => pool.tryAcquire()); assert.equal(leases.filter(Boolean).length, 4); assert.equal(nested, 5); leases.forEach(l => l?.release());
});

test('a consumed capacity object cannot start a second comparison or release the first', async () => {
 const s = setup(); const lease = s.deps.capacity!.tryAcquire()!; const injected = { ...s.deps, lease };
 const a = startHealthComparisonHttp(request(), injected), b = startHealthComparisonHttp(request(), injected);
 assert.equal((await b.response).status, 503); await s.clock.flush(); assert.equal(s.reservations(), 1);
 lease.release(); assertHeld(s.deps.capacity);
 await s.clock.advance(2250); await a.response; s.rpc.reply(0, '0x8f'); await a.drained;
 const four = Array.from({length:4},()=>s.deps.capacity!.tryAcquire()); assert.ok(four.every(Boolean)); four.forEach(l=>l!.release());
});

test('cancellation during Redis clock preparation prevents invocation', async () => {
 const clock = new FakeClock(); let reads = 0, calls = 0;
 const now = () => { reads++; if (reads === 2) reservation.cancel(); return clock.now(); };
 const reservation: ReturnType<typeof startTrackedReservation> = startTrackedReservation({ clock: { now, at: clock.at }, env, fetcher: async () => { calls++; return Response.json({ result: [1,0] }); } });
 assert.deepEqual(await reservation.decision, { status: 'unavailable' }); await reservation.drained; assert.equal(calls, 0);
});

test('locked Redis response bodies retain capacity because cleanup cannot be acknowledged', async () => {
 const body = new ReadableStream<Uint8Array>(); const response = new Response(body); const reader = body.getReader();
 const s = setup({ redisFetch: async () => response }); const h = startHealthComparisonHttp(request(), s.deps);
 assert.equal((await h.response).status, 503); await pending(h.drained, s.clock); assertHeld(s.deps.capacity); assert.equal(s.rpc.calls.length, 0);
 reader.releaseLock(); // This does not retroactively prove disposal to the owner.
});

test('request-body cancellation cleanup is retained after an early error response', async () => {
 const cleanup = deferred<void>(); const s = setup();
 const req = new Request('http://localhost/api/diagnose', { method: 'POST', headers, body: new ReadableStream<Uint8Array>({ cancel() { return cleanup.promise; } }), duplex: 'half' } as RequestInit);
 const h = startHealthComparisonHttp(req, s.deps); await s.clock.flush(); await s.clock.advance(3000);
 assert.equal((await h.response).status, 408); await pending(h.drained, s.clock); assertHeld(s.deps.capacity); assert.equal(s.reservations(), 0);
 cleanup.resolve(); await h.drained;
});

for (const variant of ['wrong_network','null','timeout','contradiction','alignment'] as const) test('response compatibility with real coordinator evidence: ' + variant, async () => {
 const s = setup();
 const normal = automaticTransport();
 let calls = 0;
 const rpcFetch: typeof fetch = async (url, init) => {
  calls++; const r = JSON.parse(String(init?.body)), secondary = String(url).includes('rpc1.');
  if (variant === 'wrong_network' && r.method === 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: r.id, result: '0x1' });
  if (variant === 'null' && r.method !== 'eth_chainId') return Response.json({ jsonrpc: '2.0', id: r.id, result: null });
  if (variant === 'timeout' && r.method === 'eth_chainId') return new Promise<Response>((_yes, no) => init!.signal!.addEventListener('abort', () => no(new Error('abort')), { once: true }));
  const reply = await normal(url,init), body = await reply.json();
  if (variant === 'contradiction' && r.params[0] === 'finalized' && secondary) body.result.hash = '0x'+'f'.repeat(64);
  if (variant === 'alignment') {
   if (r.params[0] === 'finalized' && secondary) body.result.number = '0x9';
   if (r.params[0] === '0x9') body.result.number = '0x9';
  }
  return Response.json(body);
 };
 const h = startHealthComparisonHttp(request(comparisonRequest(variant === 'alignment')), { ...s.deps, rpcFetch });
 await s.clock.flush(); if (variant === 'timeout') await s.clock.advance(4000);
 const r = await h.response; assert.equal(r.status, 200); const body = await r.json();
 if (variant === 'contradiction') assert.ok(body.result.report.reconciliation.rows.some((row: { relation: string }) => row.relation === 'contradiction'));
 assert.ok(calls <= 8); await h.drained;
});

test('delayed body deadline callback cannot admit a late request', async () => {
 let stream!: ReadableStreamDefaultController<Uint8Array>;
 const s = setup(); const r = new Request('http://localhost/api/diagnose', { method: 'POST', headers, body: new ReadableStream<Uint8Array>({ start(c) { stream = c; } }), duplex: 'half' } as RequestInit);
 const h = startHealthComparisonHttp(r, s.deps); await s.clock.flush();
 s.clock.time += 3000; // Simulate a delayed timer callback; only the body settles.
 stream.enqueue(new TextEncoder().encode(JSON.stringify(comparisonRequest()))); stream.close();
 assert.equal((await h.response).status, 408); await h.drained; assert.equal(s.reservations(), 0);
});

test('streamed oversized and invalid UTF-8 input cannot reserve quota', async () => {
 for (const bytes of [new Uint8Array(16385), new Uint8Array([255])]) {
  const s = setup(); const req = new Request('http://localhost/api/diagnose', { method: 'POST', headers, body: bytes });
  const h = startHealthComparisonHttp(req, s.deps); assert.equal((await h.response).status, bytes.length > 16384 ? 413 : 400); await h.drained; assert.equal(s.reservations(), 0);
 }
});

test('tracked reservation counts synchronous throws once and rejects exact-deadline replies', async () => {
 const clock = new FakeClock(); let attempts = 0;
 const throws = startTrackedReservation({ clock, env, fetcher: () => { attempts++; throw new Error('PRIVATE_MARKER'); } });
 assert.deepEqual(await throws.decision, { status: 'unavailable' }); await throws.drained; assert.equal(attempts, 1);
 const reply = deferred<Response>(); const late = startTrackedReservation({ clock, env, fetcher: () => { attempts++; return reply.promise; } });
 await clock.flush(); clock.time += 2000; reply.resolve(Response.json({ result: [1,0] }));
 assert.deepEqual(await late.decision, { status: 'unavailable' }); await late.drained; assert.equal(attempts, 2);
});

test('default capacity clock preserves legacy Date.now replacement behavior', () => {
 const original = Date.now; let now = 1000; const pool = createProcessCapacity();
 Date.now = () => now;
 try {
  for (let i = 0; i < 30; i++) { const lease = pool.tryAcquire(); assert.ok(lease); lease.release(); }
  assert.equal(pool.tryAcquire(), undefined); now += 60000;
  const lease = pool.tryAcquire(); assert.ok(lease); lease.release();
 } finally { Date.now = original; }
});

test('request abort inside reservation preparation prevents its deferred transport', async () => {
 const controller = new AbortController(), clock = new FakeClock(); let reads = 0, attempts = 0;
 // Trigger precisely inside reservation timer preparation, after input has drained.
 let reservationTimer = false;
 const injectedClock = { now: clock.now, at(deadline: number, callback: () => void) {
  reads++;
  if (deadline === clock.time + 2000) { reservationTimer = true; controller.abort(); }
  return clock.at(deadline,callback);
 } };
 const s = setup({ clock: injectedClock, redisFetch: async () => { attempts++; return Response.json({ result: [1,0] }); } });
 const h = startHealthComparisonHttp(request(comparisonRequest(),controller.signal),s.deps);
 assert.equal((await h.response).status,503); await h.drained;
 assert.equal(reservationTimer,true); assert.ok(reads >= 3); assert.equal(attempts,0); assert.equal(s.rpc.calls.length,0);
});

test('delayed initial scheduling cannot restart the HTTP allowance', async () => {
 const s = setup(); const h = startHealthComparisonHttp(request(), s.deps);
 s.clock.time += 25000; // The deferred runner has not executed yet.
 assert.equal((await h.response).status, 408); await h.drained;
 assert.equal(s.reservations(), 0); assert.equal(s.rpc.calls.length, 0);
});
