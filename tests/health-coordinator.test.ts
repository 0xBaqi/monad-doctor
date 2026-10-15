import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boundedHealthResult, startHealthComparison } from '../lib/health-coordinator.ts';
import { HEALTH_LIMITS, type HealthEnvelope, type HealthResult } from '../lib/health-coordinator-model.ts';
import { AT, FINALIZED, LATEST, hash } from './fixtures/health-reconciliation.ts';
import { ControlledTransport, FakeClock, automaticTransport, comparisonRequest, wallNow } from './fixtures/health-coordinator.ts';

const nativeFetch = globalThis.fetch; let unexpectedNetwork = 0;
before(() => { globalThis.fetch = async () => { unexpectedNetwork++; throw new Error('Live transport forbidden in offline tests.'); }; });
after(() => { globalThis.fetch = nativeFetch; assert.equal(unexpectedNetwork, 0); });

function report(result: HealthResult): HealthEnvelope { assert.ok(result.kind === 'comparison'); return result.report; }
function setup(fetcher = automaticTransport(), align = false) {
 const clock = new FakeClock(); let releases = 0;
 const handle = startHealthComparison(comparisonRequest(align), { fetcher, clock, wallNow, runId: 'coordinator-run', admission: { release() { releases++; } } });
 return { clock, handle, releases: () => releases };
}
test('coordinator executes C/F/L fairly through one owner and releases admission once', async () => {
 const transport = new ControlledTransport(), s = setup(transport.fetcher);
 await s.clock.flush();
 for (let i = 0; i < 6; i++) {
  assert.equal(transport.calls.length, i + 1); transport.reply(i, i < 2 ? '0x8f' : i < 4 ? FINALIZED : LATEST); await s.clock.flush();
 }
 const r = report(await s.handle.result); await s.handle.drained;
 assert.deepEqual(r.ledger.map(e => e.id), ['C.primary', 'C.secondary', 'F.primary', 'F.secondary', 'L.primary', 'L.secondary']);
 assert.deepEqual(r.counters, { planned: 6, dispatched: 6, completed: 6, skipped: 0, inFlight: 0 });
 assert.equal(r.status, 'completed'); assert.equal(s.releases(), 1); s.handle.cancel(); assert.equal(s.releases(), 1);
 assert.ok(r.reconciliation.rows.every(row => row.relation === 'match')); assert.ok(Object.isFrozen(r.reconciliation.snapshots[0]));
});
test('coordinator advances immediately; wall-clock jumps cannot change scheduling', async () => {
 const clock = new FakeClock(); let wall = Date.parse(AT), calls = 0;
 const fetcher: typeof fetch = (url, init) => { calls++; wall += calls % 2 ? 86400000 : -172800000; return automaticTransport()(url, init); };
 const h = startHealthComparison(comparisonRequest(), { clock, fetcher, wallNow: () => wall, runId: 'wall-jump', admission: { release() {} } });
 const r = report(await h.result); await h.drained;
 assert.equal(clock.now(), 1000); assert.equal(clock.pending(), 0); assert.ok(r.ledger.every(e => e.startedOffsetMs === 0));
});
test('coordinator cancellation before dispatch performs zero IO', async () => {
 let calls = 0; const s = setup(async () => { calls++; throw new Error('Must not invoke'); }); s.handle.cancel();
 const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(calls, 0); assert.equal(r.status, 'cancelled'); assert.equal(r.counters.skipped, 6); assert.equal(s.releases(), 1);
});
test('coordinator ignored abort publishes immutable partial evidence but does not release admission', async () => {
 const transport = new ControlledTransport(), s = setup(transport.fetcher, true); await s.clock.flush();
 let drained = false; void s.handle.drained.then(() => { drained = true; });
 await s.clock.advance(2250); const r = report(await s.handle.result), before = JSON.stringify(r);
 assert.equal(r.termination, 'transport_quarantined'); assert.equal(r.cleanupPending, true); assert.equal(drained, false); assert.equal(s.releases(), 0);
 assert.deepEqual(r.counters, { planned: 8, dispatched: 1, completed: 1, skipped: 7, inFlight: 1 });
 transport.reply(0, '0x8f'); await s.clock.flush(); await s.handle.drained;
 assert.equal(JSON.stringify(r), before); assert.equal(s.releases(), 1); assert.equal(transport.calls.length, 1);
});
test('coordinator cancellation during fetch is explicit and retains its lease', async () => {
 const transport = new ControlledTransport(), s = setup(transport.fetcher); await s.clock.flush(); s.handle.cancel();
 await s.clock.advance(250); const r = report(await s.handle.result);
 assert.equal(r.status, 'cancelled'); assert.equal(r.ledger[0].observation?.kind === 'error' && r.ledger[0].observation.code, 'CANCELLED');
 assert.equal(s.releases(), 0); transport.reply(0, '0x8f'); await s.clock.flush(); await s.handle.drained;
});
test('coordinator wrong network never borrows the other provider identity', async () => {
 const s = setup(automaticTransport((method, params, provider) => method === 'eth_chainId' ? provider === 'primary' ? '0x1' : '0x8f' : params[0] === 'latest' ? LATEST : FINALIZED));
 const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.counters.dispatched, 4); assert.ok(r.ledger.filter(e => e.provider === 'primary' && e.phase !== 'C').every(e => e.skipReason === 'wrong_network'));
 assert.equal(r.reconciliation.rows[0].relation, 'contradiction'); assert.ok(r.reconciliation.rows.slice(1).every(row => row.reason === 'wrong_network'));
});
test('coordinator rate limit pauses that provider with no retries or switching', async () => {
 const fetcher: typeof fetch = (url, init) => String(url).includes('rpc1.') ? automaticTransport()(url, init) : Promise.resolve(new Response('SECRET', { status: 429, headers: { 'Retry-After': '60' } }));
 const s = setup(fetcher); const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.counters.dispatched, 4); assert.ok(r.ledger.filter(e => e.provider === 'primary' && e.phase !== 'C').every(e => e.skipReason === 'rate_limited'));
 assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('coordinator alignment binds one shared explicit height and separate collection ownership', async () => {
 const s = setup(automaticTransport((method, params, provider) => method === 'eth_chainId' ? '0x8f' : params[0] === 'latest' ? LATEST : params[0] === 'finalized' ? { ...FINALIZED, number: provider === 'primary' ? '0x64' : '0x63', hash: provider === 'primary' ? FINALIZED.hash : hash('e') } : { ...FINALIZED, number: '0x63', hash: hash('e') }), true);
 const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.alignment.height, '0x63'); assert.equal(r.counters.dispatched, 8);
 assert.deepEqual(r.ledger.slice(6).map(e => e.request?.params), [['0x63', false], ['0x63', false]]);
 assert.equal(r.reconciliation.rows[4].relation, 'match'); assert.equal(r.reconciliation.guarantees.currentFreshnessCertified, false);
 for (const snapshot of r.reconciliation.snapshots) {
  assert.equal(snapshot.collections.length, 2);
  assert.ok(snapshot.collections.every(c => c.provider === snapshot.provider && c.runId === r.runId));
  assert.notEqual(snapshot.observations.chain!.collectionId, snapshot.observations.historical!.collectionId);
  assert.equal(snapshot.observations.chain!.evidenceId, snapshot.observations.historical!.evidenceId);
 }
});
test('coordinator wrong returned alignment height retains evidence and marks inconsistency', async () => {
 const s = setup(automaticTransport((method, params, provider) => method === 'eth_chainId' ? '0x8f' : params[0] === 'latest' ? LATEST : params[0] === 'finalized' ? { ...FINALIZED, number: provider === 'primary' ? '0x64' : '0x62' } : { ...FINALIZED, number: '0x61', hash: hash('f') }), true);
 const r = report(await s.handle.result); await s.handle.drained;
 assert.ok(r.reconciliation.integrityIssues.some(i => i.code === 'requested_height_mismatch'));
 assert.equal(r.reconciliation.rows[4].relation, 'not_comparable');
});
test('coordinator skips redundant alignment without manufacturing historical evidence', async () => {
 const s = setup(automaticTransport(), true); const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.counters.dispatched, 6); assert.equal(r.alignment.status, 'redundant'); assert.equal(r.reconciliation.rows.length, 4);
 assert.ok(r.ledger.slice(6).every(e => e.skipReason === 'anchor_redundant' && !e.evidence));
});
test('coordinator partial null/error evidence never becomes negative chain evidence', async () => {
 const s = setup(automaticTransport((method, params) => method === 'eth_chainId' ? '0x8f' : params[0] === 'finalized' ? null : LATEST), true);
 const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.status, 'partial'); assert.equal(r.counters.dispatched, 6); assert.equal(r.reconciliation.rows[3].relation, 'incomplete');
 assert.ok(r.ledger.slice(6).every(e => e.skipReason === 'anchor_unavailable'));
});
test('coordinator reserves equal phase opportunities and refuses to catch up after scheduler suspension', async () => {
 const clock = new FakeClock(); let calls = 0;
 const fetcher: typeof fetch = (url, init) => { calls++; if (calls === 2) clock.time += 16000; return automaticTransport()(url, init); };
 const h = startHealthComparison(comparisonRequest(), { clock, fetcher, wallNow, runId: 'suspension', admission: { release() {} } });
 await clock.flush(); await clock.advance(250); const r = report(await h.result); await h.drained;
 assert.equal(calls, 2); assert.ok(r.ledger.slice(2).every(e => e.state === 'skipped')); assert.equal(r.ledger[1].observation?.kind === 'error' && r.ledger[1].observation.code, 'TIMEOUT');
});
test('coordinator output limiter rejects the whole envelope instead of truncating findings', async () => {
 const s = setup(); const r = report(await s.handle.result); await s.handle.drained;
 const large = { ...r, ledger: Array.from({ length: 2000 }, () => r.ledger[0]) };
 assert.ok(new TextEncoder().encode(JSON.stringify(large)).byteLength > HEALTH_LIMITS.envelopeBytes);
 const rejected = boundedHealthResult(large); assert.equal(rejected.kind, 'coordinator_error');
 assert.equal(rejected.kind === 'coordinator_error' && rejected.code, 'OUTPUT_LIMIT'); assert.ok(Object.isFrozen(rejected));
});
test('coordinator captures ordinary request inputs and publishes deterministic bounded data', async () => {
 const raw = { ...comparisonRequest() }, s = new FakeClock();
 const h = startHealthComparison(raw, { fetcher: automaticTransport(), clock: s, wallNow, runId: 'snapshot-input', admission: { release() {} } });
 raw.alignSharedHeight = true; const r = report(await h.result); await h.drained;
 assert.equal(r.request.alignSharedHeight, false); assert.ok(new TextEncoder().encode(JSON.stringify(r)).byteLength < HEALTH_LIMITS.envelopeBytes);
 const second = startHealthComparison(comparisonRequest(), { fetcher: automaticTransport(), clock: new FakeClock(), wallNow, runId: 'snapshot-input', admission: { release() {} } });
 assert.equal(JSON.stringify(await second.result), JSON.stringify(await h.result)); await second.drained;
});
test('coordinator rejects malformed inputs without invoking accessors or dispatching', () => {
 let reads = 0, calls = 0;
 const dependencies = { fetcher: async () => { calls++; throw new Error(); }, clock: new FakeClock(), wallNow, runId: 'bad-request', admission: { release() {} } };
 const request = { ...comparisonRequest() }; Object.defineProperty(request, 'alignSharedHeight', { enumerable: true, get() { reads++; return true; } });
 assert.throws(() => startHealthComparison(request, dependencies));
 assert.throws(() => startHealthComparison({ ...comparisonRequest(), providers: ['secondary', 'primary'] }, dependencies));
 assert.throws(() => startHealthComparison({ ...comparisonRequest(), endpoint: 'https://unapproved.invalid' }, dependencies));
 assert.equal(reads, 0); assert.equal(calls, 0);
});
test('coordinator slow eight-call trace gives each provider the same work window', async () => {
 const transport = new ControlledTransport(), s = setup(transport.fetcher, true); await s.clock.flush();
 for (let i = 0; i < 8; i++) {
  assert.equal(transport.calls.length, i + 1); await s.clock.advance(1999);
  const value = i < 2 ? '0x8f' : i < 4 ? { ...FINALIZED, number: i === 2 ? '0x64' : '0x62', hash: i === 2 ? FINALIZED.hash : hash('e') } : i < 6 ? LATEST : { ...FINALIZED, number: '0x62', hash: hash('e') };
  transport.reply(i, value); await s.clock.flush();
 }
 const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.counters.dispatched, 8); assert.equal(s.clock.now() - 1000, 15992);
 assert.ok(r.ledger.every(e => e.deadlineOffsetMs! - e.startedOffsetMs! === 2000));
 assert.ok(r.ledger.every(e => e.decisionOffsetMs! - e.startedOffsetMs! === 1999));
 assert.ok(s.clock.now() - 1000 <= HEALTH_LIMITS.collectionMs);
});
test('coordinator cooperative chain timeouts stop dependent phases after exactly two calls', async () => {
 const fetcher: typeof fetch = (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('cancel acknowledged')), { once: true }));
 const s = setup(fetcher, true); await s.clock.flush(); await s.clock.advance(4000);
 const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.counters.dispatched, 2); assert.equal(r.counters.skipped, 6); assert.equal(r.cleanupPending, false);
 assert.ok(r.reconciliation.rows.every(row => row.relation === 'incomplete'));
});
test('coordinator stops after expired cleanup even if acknowledgment precedes delayed timer delivery', async () => {
 const transport = new ControlledTransport(), s = setup(transport.fetcher); await s.clock.flush();
 transport.reply(0, '0x8f'); await s.clock.flush(); transport.reply(1, '0x8f'); await s.clock.flush();
 await s.clock.advance(2000); s.clock.time += 250; transport.reply(2, FINALIZED); await s.clock.flush();
 const r = report(await s.handle.result); await s.handle.drained;
 assert.equal(r.termination, 'transport_quarantined'); assert.equal(r.cleanupPending, false); assert.equal(r.ledger[2].cleanupExceeded, true);
 assert.equal(transport.calls.length, 3); assert.equal(s.releases(), 1);
});
test('coordinator retains direct finalized disagreement when both latest calls time out', async () => {
 const clock = new FakeClock();
 const fetcher: typeof fetch = (url, init) => {
  const rpc = JSON.parse(String(init!.body));
  if (rpc.params[0] === 'latest') return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('cancel acknowledged')), { once: true }));
  return automaticTransport((method, _params, provider) => method === 'eth_chainId' ? '0x8f' : { ...FINALIZED, hash: provider === 'primary' ? FINALIZED.hash : hash('e') })(url, init);
 };
 const h = startHealthComparison(comparisonRequest(), { clock, fetcher, wallNow, runId: 'finalized-conflict', admission: { release() {} } });
 await clock.flush(); await clock.advance(4000); const r = report(await h.result); await h.drained;
 assert.equal(r.reconciliation.rows[3].relation, 'contradiction'); assert.equal(r.reconciliation.rows[1].relation, 'incomplete');
});
test('coordinator admission remains held across four quarantined comparisons', async () => {
 let active = 0, releases = 0;
 const acquire = () => { if (active >= 4) throw new Error('capacity'); active++; return { release() { active--; releases++; } }; };
 const clock = new FakeClock(), transports = Array.from({ length: 4 }, () => new ControlledTransport());
 const handles = transports.map((t, i) => startHealthComparison(comparisonRequest(), { clock, fetcher: t.fetcher, wallNow, runId: `capacity-${i}`, admission: acquire() }));
 await clock.flush(); await clock.advance(2250); await Promise.all(handles.map(h => h.result));
 assert.equal(active, 4); assert.equal(releases, 0); assert.throws(acquire, /capacity/);
 transports.forEach(t => t.reply(0, '0x8f')); await clock.flush(); await Promise.all(handles.map(h => h.drained));
 assert.equal(active, 0); assert.equal(releases, 4);
});
test('coordinator modules have no legacy runtime integration or bypass fetch calls', async () => {
 const { readFile } = await import('node:fs/promises');
 const coordinator = await readFile(new URL('../lib/health-coordinator.ts', import.meta.url), 'utf8');
 assert.ok(!/\bfetch\s*\(|createRpc|diagnose\(/.test(coordinator));
 for (const file of ['../app/api/diagnose/route.ts', '../lib/http.ts', '../cli/index.ts']) {
  assert.ok(!/health-coordinator|health-dispatcher/.test(await readFile(new URL(file, import.meta.url), 'utf8')));
 }
});
test('coordinator cannot reuse admission credit for a second comparison', async () => {
 const admission = { release() {} }, dependencies = { fetcher: automaticTransport(), admission, clock: new FakeClock(), wallNow, runId: 'single-admission' };
 const h = startHealthComparison(comparisonRequest(), dependencies);
 assert.throws(() => startHealthComparison(comparisonRequest(), dependencies), /already consumed/);
 await h.result; await h.drained;
 assert.throws(() => startHealthComparison(comparisonRequest(), dependencies), /already consumed/);
});
