import { createHealthDispatcher } from './health-dispatcher.ts';
import { reconcileHealthSnapshots, validateHealthSnapshot, type HealthBlock, type HealthEvidence, type HealthSnapshot } from './health-reconciliation.ts';
import { parseHealthComparisonRequest } from './health-comparison-request.ts';
export { parseHealthComparisonRequest } from './health-comparison-request.ts';
import { ValidationError } from './validation.ts';
import { HEALTH_COORDINATOR_VERSION, HEALTH_LIMITS, immutable, type HealthAdmissionLease, type HealthAlignment, type HealthCoordinatorHandle, type HealthEnvelope, type HealthLedgerEntry, type HealthResult, type HealthSkip, type MonotonicClock } from './health-coordinator-model.ts';

type Dependencies = { fetcher: typeof fetch; admission: HealthAdmissionLease; clock?: MonotonicClock; wallNow?: () => number; runId?: string };
const realClock: MonotonicClock = { now: () => performance.now(), at: (deadline, callback) => { const timer = setTimeout(callback, Math.max(0, deadline - performance.now())); return () => clearTimeout(timer); } };
const consumedAdmissions = new WeakSet<HealthAdmissionLease>();
/** Internal publication boundary, not an importer for external report formats. */
export function boundedHealthResult(report: HealthEnvelope): HealthResult {
 const result = immutable(structuredClone({ kind: 'comparison' as const, report }));
 if (new TextEncoder().encode(JSON.stringify(result)).byteLength <= HEALTH_LIMITS.envelopeBytes) return result;
 return immutable({ kind: 'coordinator_error', code: 'OUTPUT_LIMIT', runId: report.runId, counters: structuredClone(report.counters), cleanupPending: report.cleanupPending });
}

/** No networking occurs on import. A transport and admission lease are required. */
export function startHealthComparison(raw: unknown, dependencies: Dependencies): HealthCoordinatorHandle {
 const runId = dependencies.runId ?? crypto.randomUUID();
 const request = parseHealthComparisonRequest(raw, runId), clock = dependencies.clock ?? realClock;
 const admission = dependencies.admission, release = admission?.release;
 if (typeof dependencies.fetcher !== 'function' || !admission || typeof release !== 'function') throw new ValidationError('Comparison transport and admission lease are required.');
 const releaseAdmission = release.bind(admission);
 const origin = clock.now();
 if (!Number.isFinite(origin) || origin < 0 || origin + HEALTH_LIMITS.collectionMs > Number.MAX_SAFE_INTEGER) throw new ValidationError('Invalid monotonic origin.');
 const dispatcher = createHealthDispatcher({ runId, alignment: request.alignSharedHeight, clock, origin, wallNow: dependencies.wallNow ?? Date.now, fetcher: dependencies.fetcher });
 if (consumedAdmissions.has(admission)) throw new ValidationError('Comparison admission lease was already consumed.');
 consumedAdmissions.add(admission);
 const controller = new AbortController(), deadline = origin + HEALTH_LIMITS.collectionMs;
 let published = false, released = false;
 let resolveResult!: (result: HealthResult) => void, resolveDrained!: () => void, rejectDrained!: (reason: Error) => void;
 const result = new Promise<HealthResult>(resolve => { resolveResult = resolve; });
 const drained = new Promise<void>((resolve, reject) => { resolveDrained = resolve; rejectDrained = reject; });
 let alignment: HealthAlignment = { status: request.alignSharedHeight ? 'unavailable' : 'disabled' };
 let termination: HealthEnvelope['termination'] = 'plan_complete';
 function snapshots(ledger: readonly HealthLedgerEntry[]): readonly [HealthSnapshot, HealthSnapshot] {
  return request.providers.map(provider => {
   const local = ledger.filter(e => e.provider === provider && e.request && e.evidence && e.observation);
   const collectionIds = [...new Set(local.map(e => e.evidence!.collectionId))];
   return validateHealthSnapshot({ runId, provider,
    input: { mode: 'health', providers: request.providers, ...(alignment.height ? { historicalHeight: alignment.height } : {}) },
    collections: collectionIds.map(collectionId => ({ runId, provider, collectionId, evidence: local.filter(e => e.evidence!.collectionId === collectionId).map(e => ({ evidenceId: e.evidence!.evidenceId, request: e.request, observation: e.observation }) as HealthEvidence) })),
    observations: Object.fromEntries(local.map(e => [e.slot, e.evidence])),
   });
  }) as unknown as readonly [HealthSnapshot, HealthSnapshot];
 }
 function eligibility(op: typeof dispatcher.plan[number]): HealthSkip | undefined {
  if (op.phase === 'C') return;
  const entries = dispatcher.ledger().filter(e => e.provider === op.provider);
  if (entries.some(e => e.observation?.kind === 'error' && e.observation.code === 'RATE_LIMIT')) return 'rate_limited';
  const chain = entries.find(e => e.phase === 'C')?.observation;
  if (chain?.kind !== 'value') return 'dependency';
  if (chain.value !== '0x8f') return 'wrong_network';
 }
 function skipPending(reason: HealthSkip) { for (const entry of dispatcher.ledger()) if (entry.state === 'planned') dispatcher.skip(entry.id, reason); }
 async function collect(): Promise<HealthResult> {
  for (const phase of ['C', 'F', 'L', 'H'] as const) {
   const operations = dispatcher.plan.filter(op => op.phase === phase);
   if (!operations.length) continue;
   if (controller.signal.aborted) { termination = 'cancelled'; skipPending('cancelled'); break; }
   if (phase === 'H') {
    const ledger = dispatcher.ledger(), core = ledger.filter(e => e.phase !== 'H');
    const finalized = core.filter(e => e.phase === 'F');
    let reason: HealthSkip | undefined;
    if (core.some(e => e.observation?.kind !== 'value')) reason = 'anchor_unavailable';
    else if (reconcileHealthSnapshots(...snapshots(core)).integrityIssues.length) { reason = 'anchor_inconsistent'; alignment = { status: 'inconsistent' }; }
    else {
     const a = finalized[0].observation!, b = finalized[1].observation!;
     const av = (a as { value: HealthBlock }).value, bv = (b as { value: HealthBlock }).value;
     if (av.number === bv.number) { reason = 'anchor_redundant'; alignment = { status: 'redundant' }; }
     else {
      const height = BigInt(av.number) < BigInt(bv.number) ? av.number : bv.number;
      alignment = immutable({ status: 'selected', height, sources: finalized.map(e => e.evidence!) }); dispatcher.bindHistorical(height);
     }
    }
    if (reason) { for (const op of operations) dispatcher.skip(op.id, reason); continue; }
   }
   const eligible: typeof operations[number][] = [];
   for (const op of operations) { const reason = eligibility(op); if (reason) dispatcher.skip(op.id, reason); else eligible.push(op); }
   const allowance = eligible.length * (HEALTH_LIMITS.workMs + HEALTH_LIMITS.cleanupMs);
   const phaseEnd = Math.min(deadline, clock.now() + allowance);
   if (clock.now() + allowance > deadline) { for (const op of eligible) dispatcher.skip(op.id, 'phase_capacity'); termination = 'deadline'; continue; }
   for (const op of eligible) {
    if (controller.signal.aborted) { termination = 'cancelled'; skipPending('cancelled'); break; }
    if (clock.now() + HEALTH_LIMITS.workMs + HEALTH_LIMITS.cleanupMs > phaseEnd) { dispatcher.skip(op.id, 'phase_capacity'); termination = 'deadline'; continue; }
    const completed = await dispatcher.dispatch(op.id, Math.min(clock.now() + HEALTH_LIMITS.workMs, phaseEnd - HEALTH_LIMITS.cleanupMs), controller.signal);
    if (completed.cleanupExceeded || dispatcher.quarantined()) { termination = 'transport_quarantined'; skipPending('transport_quarantined'); break; }
   }
   if (termination === 'transport_quarantined' || termination === 'cancelled') break;
  }
  if (controller.signal.aborted && termination !== 'transport_quarantined') termination = 'cancelled';
  skipPending(termination === 'cancelled' ? 'cancelled' : 'deadline');
  const ledger = dispatcher.ledger();
  const partial = ledger.some(e => e.state === 'skipped' ? e.skipReason !== 'anchor_redundant' : e.observation?.kind !== 'value');
  return boundedHealthResult({ coordinatorVersion: HEALTH_COORDINATOR_VERSION, runId, request, status: controller.signal.aborted ? 'cancelled' : partial ? 'partial' : 'completed', termination,
   counters: dispatcher.counters(), ledger, alignment, cleanupPending: dispatcher.quarantined(), reconciliation: reconcileHealthSnapshots(...snapshots(ledger)) });
 }
 async function publish() {
  let outcome: HealthResult;
  try { outcome = await collect(); }
  catch { controller.abort(); skipPending('cancelled'); outcome = immutable({ kind: 'coordinator_error', code: 'INTERNAL', runId, counters: dispatcher.counters(), cleanupPending: dispatcher.quarantined() }); }
  dispatcher.close(); published = true; resolveResult(outcome);
  await dispatcher.drained();
  if (!released) {
   released = true;
   try { releaseAdmission(); resolveDrained(); }
   catch { rejectDrained(new Error('Comparison admission release failed.')); }
  }
 }
 // Defer dispatch so cancellation immediately after construction precedes all IO.
 void Promise.resolve().then(publish);
 return Object.freeze({ result, drained, cancel: () => { if (!published) controller.abort(); } });
}
