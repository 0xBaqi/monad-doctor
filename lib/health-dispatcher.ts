import { hex, object, quantity, ValidationError } from './validation.ts';
import { RPC_ENDPOINTS } from './rpc-providers.ts';
import type { HealthBlock, HealthRpcError, SkipReason } from './health-reconciliation.ts';
import { HEALTH_LIMITS, immutable, makeHealthPlan, type HealthLedgerEntry, type HealthSkip, type MonotonicClock } from './health-coordinator-model.ts';

type Entry = { -readonly [K in keyof HealthLedgerEntry]: HealthLedgerEntry[K] };
type Payload = { kind: 'value'; value: string | HealthBlock } | { kind: 'null' } | { kind: 'error'; code: HealthRpcError };
type Options = { runId: string; alignment: boolean; origin: number; clock: MonotonicClock; wallNow: () => number; fetcher: typeof fetch };
const skipKind = (reason: HealthSkip): SkipReason => reason === 'budget' ? 'budget' : reason === 'deadline' || reason === 'phase_capacity' ? 'deadline' : reason === 'cancelled' || reason === 'transport_quarantined' ? 'cancelled' : reason === 'anchor_redundant' ? 'not_requested' : 'dependency';

/** Offline-capable transport owner. There is deliberately no default fetcher. */
export function createHealthDispatcher(options: Options) {
 const { clock, origin, wallNow, fetcher } = options, runDeadline = origin + HEALTH_LIMITS.collectionMs;
 const plan = makeHealthPlan(options.runId, options.alignment);
 const entries: Entry[] = plan.map(op => ({ id: op.id, provider: op.provider, phase: op.phase, slot: op.slot, state: 'planned', ...(op.request ? { request: op.request, evidence: op.ref } : {}), transport: 'none', acceptedBytes: 0 }));
 let dispatches = 0, closed = false;
 let active: { id: string; drained: Promise<void> } | undefined;
 let lastTime = origin, clockBroken = false;
 function readClock() {
  try {
   const now = clock.now();
   if (!Number.isFinite(now) || now < lastTime || now > Number.MAX_SAFE_INTEGER) throw new Error();
   lastTime = now; return now;
  } catch { clockBroken = true; throw new ValidationError('Health scheduling clock failed.'); }
 }
 // After invocation, a broken clock must not prevent acknowledged cleanup.
 const cleanupTime = () => { try { return readClock(); } catch { return lastTime; } };
 const clearTimer = (clear: () => void) => { try { clear(); } catch { /* A sealed callback is harmless even if its timer cannot be removed. */ } };
 const copy = (entry: Entry): HealthLedgerEntry => immutable(structuredClone(entry));
 function entryFor(id: string) {
  const entry = entries.find(e => e.id === id);
  if (closed || !entry || entry.state !== 'planned' || active?.id === id) throw new ValidationError('Invalid or already consumed health operation.');
  return entry;
 }
 function skip(id: string, reason: HealthSkip) {
  const entry = entryFor(id);
  entry.state = 'skipped'; entry.skipReason = reason;
  if (entry.request) entry.observation = { kind: 'skipped', reason: skipKind(reason) };
  return copy(entry);
 }
 function bindHistorical(height: string) {
  const normalized = quantity(height);
  const targets = entries.filter(e => e.phase === 'H');
  if (closed || targets.length !== 2 || targets.some(e => e.state !== 'planned' || e.request || active?.id === e.id)) throw new ValidationError('Historical operations cannot be rebound.');
  for (const entry of targets) {
   entry.request = immutable({ method: 'eth_getBlockByNumber', params: [normalized, false] });
   entry.evidence = plan.find(op => op.id === entry.id)!.ref;
  }
 }
 async function dispatch(id: string, requestedDeadline: number, signal: AbortSignal): Promise<HealthLedgerEntry> {
  const entry = entryFor(id);
  if (active) return skip(id, 'transport_quarantined');
  if (!entry.request || !Number.isFinite(requestedDeadline)) throw new ValidationError('Unbound health operation or invalid deadline.');
  let started = origin, deadline = origin, observedAt = '', invoked = false, pendingStop: 'TIMEOUT' | 'CANCELLED' | undefined;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseBody: ReadableStream<Uint8Array> | null = null, received = false;
  let bodyDone = false, cancellation: Promise<void> | undefined, decision = false, quiescent = false, returned = false;
  let cleanupDeadline = Infinity;
  let clearWork = () => {}, clearGrace = () => {};
  let resolveResult!: (entry: HealthLedgerEntry) => void, resolveDrained!: () => void;
  const result = new Promise<HealthLedgerEntry>(resolve => { resolveResult = resolve; });
  const drained = new Promise<void>(resolve => { resolveDrained = resolve; });
  // No dependency callback runs before this synchronous reservation. A reservation
  // owns capacity but is not an invocation and consumes no dispatch credit.
  const lease = { id, drained }; active = lease;
  function releaseLease() { if (active === lease) active = undefined; resolveDrained(); }
  function skipReserved(reason: HealthSkip) {
   entry.state = 'skipped'; entry.skipReason = reason;
   entry.observation = { kind: 'skipped', reason: skipKind(reason) };
   returned = true; clearTimer(clearWork); signal.removeEventListener('abort', onAbort);
   releaseLease(); return copy(entry);
  }
  function finish() {
   if (returned) return;
   returned = true; clearTimer(clearGrace); signal.removeEventListener('abort', onAbort); resolveResult(copy(entry));
  }
  function cancelResources() {
   if (!entry.cleanupExceeded) entry.transport = 'cancelling';
   if (reader && !bodyDone && !cancellation) {
    // A rejected cancellation is not acknowledgment. Fail closed, with no
    // unhandled rejection and no claim that the resource has been drained.
    cancellation = reader.cancel().catch(() => new Promise<void>(() => {}));
   }
   controller.abort();
  }
  function decide(payload: Payload, cause: HealthLedgerEntry['decisionCause'] = 'response') {
   if (decision) return;
   const now = cleanupTime();
   if (decision) return; // Reading an injected clock may reenter cancellation.
   if (clockBroken) { payload = { kind: 'error', code: 'NETWORK' }; cause = 'transport_error'; }
   else if (now >= deadline) { payload = { kind: 'error', code: 'TIMEOUT' }; cause = 'work_deadline'; }
   decision = true; clearTimer(clearWork);
   entry.state = 'completed'; entry.decisionCause = cause; entry.decisionOffsetMs = now - origin;
   entry.observation = immutable({ ...payload, observedAt, startedOffsetMs: started - origin, durationMs: now - started });
   if (quiescent) { finish(); return; }
   cleanupDeadline = Math.min((cause === 'work_deadline' ? deadline : now) + HEALTH_LIMITS.cleanupMs, runDeadline);
   try {
    if (clockBroken) throw new Error();
    clearGrace = clock.at(cleanupDeadline, () => {
     if (!quiescent) { entry.cleanupExceeded = true; entry.transport = 'quarantined'; finish(); }
    });
   } catch {
    clockBroken = true;
    entry.observation = immutable({ kind: 'error', code: 'NETWORK', observedAt, startedOffsetMs: started - origin, durationMs: now - started });
    entry.decisionCause = 'transport_error';
    cancelResources(); entry.cleanupExceeded = true; entry.transport = 'quarantined'; finish();
   }
  }
  function stop(code: 'TIMEOUT' | 'CANCELLED') {
   if (!invoked) { pendingStop = code; return; }
   if (decision) return;
   decide({ kind: 'error', code }, code === 'CANCELLED' ? 'cancelled' : 'work_deadline');
   cancelResources();
  }
  function onAbort() { stop('CANCELLED'); }
  try {
   if (signal.aborted) return skipReserved('cancelled');
   if (clockBroken) return skipReserved('preparation_error');
   started = readClock(); deadline = Math.min(requestedDeadline, started + HEALTH_LIMITS.workMs, runDeadline);
   if (started >= deadline) return skipReserved('deadline');
   observedAt = new Date(wallNow()).toISOString();
   let now = readClock();
   if (signal.aborted || closed) return skipReserved('cancelled');
   if (now >= deadline) return skipReserved('deadline');
   clearWork = clock.at(deadline, () => stop('TIMEOUT'));
   signal.addEventListener('abort', onAbort, { once: true });
   now = readClock();
   if (signal.aborted || pendingStop === 'CANCELLED' || closed) return skipReserved('cancelled');
   if (now >= deadline || pendingStop === 'TIMEOUT') return skipReserved('deadline');
   if (dispatches >= HEALTH_LIMITS.dispatched) return skipReserved('budget');
  } catch {
   skipReserved('preparation_error');
   throw new ValidationError('Health dispatch preparation failed.');
  }
  entry.state = 'dispatched'; entry.transport = 'active'; entry.startedOffsetMs = started - origin; entry.deadlineOffsetMs = deadline - origin;
  // No dependency callback between the final checks, charge and invocation.
  entry.dispatchOrdinal = ++dispatches; invoked = true;
  async function perform() {
   try {
    const response = await fetcher(RPC_ENDPOINTS[entry.provider], {
     method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ jsonrpc: '2.0', id: entry.dispatchOrdinal, method: entry.request!.method, params: entry.request!.params }),
    });
    received = true; responseBody = response.body;
    if (responseBody) reader = responseBody.getReader(); else bodyDone = true;
    if (decision || signal.aborted || readClock() >= deadline) { if (!decision) stop(signal.aborted ? 'CANCELLED' : 'TIMEOUT'); cancelResources(); return; }
    if (!response.ok) { decide({ kind: 'error', code: response.status === 429 ? 'RATE_LIMIT' : 'HTTP' }); cancelResources(); return; }
    if (!reader) { decide({ kind: 'error', code: 'MALFORMED' }); return; }
    const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '';
    while (true) {
     const chunk = await reader.read();
     if (decision || signal.aborted || readClock() >= deadline) { if (!decision) stop(signal.aborted ? 'CANCELLED' : 'TIMEOUT'); cancelResources(); return; }
     if (chunk.done) { bodyDone = true; text += decoder.decode(); break; }
     if (entry.acceptedBytes + chunk.value.byteLength > HEALTH_LIMITS.responseBytes) { decide({ kind: 'error', code: 'TOO_LARGE' }); cancelResources(); return; }
     entry.acceptedBytes += chunk.value.byteLength; text += decoder.decode(chunk.value, { stream: true });
    }
    const raw = object(JSON.parse(text));
    if (raw.jsonrpc !== '2.0' || raw.id !== entry.dispatchOrdinal || Object.hasOwn(raw, 'result') === Object.hasOwn(raw, 'error')) throw new ValidationError('Invalid RPC envelope.');
    if (Object.hasOwn(raw, 'error')) {
     const error = object(raw.error);
     if (!Number.isSafeInteger(error.code) || typeof error.message !== 'string') throw new ValidationError('Invalid RPC error.');
     decide({ kind: 'error', code: 'RPC' }); return;
    }
    if (raw.result === null) { decide({ kind: 'null' }); return; }
    if (entry.request!.method === 'eth_chainId') { decide({ kind: 'value', value: quantity(raw.result) }); return; }
    const block = object(raw.result);
    decide({ kind: 'value', value: { number: quantity(block.number), hash: hex(block.hash, 32, 'Block hash'), parentHash: hex(block.parentHash, 32, 'Parent hash'), timestamp: quantity(block.timestamp) } });
   } catch (error) {
    if (!decision) decide({ kind: 'error', code: error instanceof ValidationError || error instanceof SyntaxError || error instanceof TypeError && received ? 'MALFORMED' : 'NETWORK' }, 'transport_error');
   } finally {
    if (reader && !bodyDone && !cancellation) cancelResources();
    if (responseBody && !reader && !bodyDone && !cancellation) cancellation = responseBody.cancel().catch(() => new Promise<void>(() => {}));
    if (cancellation) await cancellation;
    reader?.releaseLock();
   }
  }
  // Settlement alone is insufficient until perform's body-cleanup finally ends.
  void perform().then(() => {
   // Timer delivery may be delayed. A late cleanup acknowledgment cannot race
   // the grace timer and turn an expired operation back into safe continuation.
   const now = cleanupTime();
   if (clockBroken && !decision) decide({ kind: 'error', code: 'NETWORK' }, 'transport_error');
   if (decision && !returned && (clockBroken || now >= cleanupDeadline)) { entry.cleanupExceeded = true; entry.transport = 'quarantined'; finish(); }
   quiescent = true; entry.transport = 'quiescent'; entry.quiescedOffsetMs = now - origin;
   releaseLease(); if (decision) finish();
  }).catch(() => {
   // Unexpected adapter cleanup failures remain quarantined; never release on
   // an exception from cleanup or expose its text.
   if (!decision) decide({ kind: 'error', code: 'NETWORK' }, 'transport_error');
  });
  return result;
 }
 function ledger(): readonly HealthLedgerEntry[] { return immutable(entries.map(copy)); }
 function counters() { return immutable({ planned: plan.length, dispatched: dispatches, completed: entries.filter(e => e.state === 'completed').length, skipped: entries.filter(e => e.state === 'skipped').length, inFlight: active ? 1 : 0 }); }
 return { plan, dispatch, skip, bindHistorical, ledger, counters, quarantined: () => Boolean(active), close: () => { closed = true; }, drained: () => active?.drained ?? Promise.resolve() };
}
