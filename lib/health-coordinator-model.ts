import type { Provider } from './model.ts';
import type { HealthBlock, HealthEvidence, HealthEvidenceRef, HealthObservation, HealthReconciliation } from './health-reconciliation.ts';

export const HEALTH_COORDINATOR_VERSION = 'm4.1b' as const;
export const HEALTH_LIMITS = Object.freeze({ planned: 8, dispatched: 10, workMs: 2000, cleanupMs: 250, collectionMs: 18000, responseBytes: 1048576, envelopeBytes: 65536 });
export type HealthComparisonRequest = Readonly<{ mode: 'health_comparison'; providers: readonly ['primary', 'secondary']; alignSharedHeight: boolean }>;
export type HealthPhase = 'C' | 'F' | 'L' | 'H';
export type HealthSlot = 'chain' | 'finalized' | 'latest' | 'historical';
export type HealthOperation = Readonly<{ id: string; provider: Provider; phase: HealthPhase; slot: HealthSlot; ref: HealthEvidenceRef; request?: HealthEvidence['request'] }>;
export type HealthSkip = 'dependency' | 'preparation_error' | 'wrong_network' | 'rate_limited' | 'deadline' | 'phase_capacity' | 'budget' | 'cancelled' | 'transport_quarantined' | 'anchor_unavailable' | 'anchor_redundant' | 'anchor_inconsistent';
export type HealthDecision = HealthObservation<string | HealthBlock>;
export type HealthLedgerEntry = Readonly<{
 id: string; provider: Provider; phase: HealthPhase; slot: HealthSlot;
 state: 'planned' | 'dispatched' | 'completed' | 'skipped';
 request?: HealthEvidence['request']; evidence?: HealthEvidenceRef; observation?: HealthDecision;
 skipReason?: HealthSkip; dispatchOrdinal?: number;
 startedOffsetMs?: number; deadlineOffsetMs?: number; decisionOffsetMs?: number; quiescedOffsetMs?: number;
 decisionCause?: 'response' | 'work_deadline' | 'cancelled' | 'transport_error';
 cleanupExceeded?: boolean;
 transport: 'none' | 'active' | 'cancelling' | 'quarantined' | 'quiescent'; acceptedBytes: number;
}>;
export type HealthCounters = Readonly<{ planned: number; dispatched: number; completed: number; skipped: number; inFlight: number }>;
export type HealthAlignment = Readonly<{ status: 'disabled' | 'unavailable' | 'redundant' | 'inconsistent' | 'selected'; height?: string; sources?: readonly HealthEvidenceRef[] }>;
export type HealthEnvelope = Readonly<{
 coordinatorVersion: typeof HEALTH_COORDINATOR_VERSION; runId: string; request: HealthComparisonRequest;
 status: 'completed' | 'partial' | 'cancelled';
 termination: 'plan_complete' | 'deadline' | 'cancelled' | 'transport_quarantined';
 counters: HealthCounters; ledger: readonly HealthLedgerEntry[]; alignment: HealthAlignment;
 cleanupPending: boolean; reconciliation: HealthReconciliation;
}>;
export type HealthResult = Readonly<{ kind: 'comparison'; report: HealthEnvelope }> | Readonly<{ kind: 'coordinator_error'; code: 'OUTPUT_LIMIT' | 'INTERNAL'; runId: string; counters: HealthCounters; cleanupPending: boolean }>;
export interface MonotonicClock { now(): number; at(deadline: number, callback: () => void): () => void }
export interface HealthAdmissionLease { release(): void }
export type HealthCoordinatorHandle = Readonly<{ result: Promise<HealthResult>; drained: Promise<void>; cancel(): void }>;

// Only constructed, narrow data is frozen; never pass dependency objects here.
export function immutable<T>(value: T): T {
 if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
 return value;
}
export function makeHealthPlan(runId: string, alignment: boolean): readonly HealthOperation[] {
 if (!/^[A-Za-z0-9._-]{1,64}$/.test(runId)) throw new Error('Invalid comparison run ID.');
 const phases = alignment ? ['C', 'F', 'L', 'H'] as const : ['C', 'F', 'L'] as const;
 return immutable(phases.flatMap(phase => (['primary', 'secondary'] as const).map(provider => {
  const slot = ({ C: 'chain', F: 'finalized', L: 'latest', H: 'historical' } as const)[phase];
  const ref = { runId, provider, collectionId: `${runId}.${provider}.${phase === 'H' ? 'alignment' : 'core'}`, evidenceId: ({ C: 1, F: 2, L: 3, H: 1 })[phase] };
  const request: HealthEvidence['request'] | undefined = phase === 'C' ? { method: 'eth_chainId', params: [] } : phase === 'H' ? undefined : { method: 'eth_getBlockByNumber', params: [phase === 'F' ? 'finalized' : 'latest', false] };
  return { id: `${phase}.${provider}`, provider, phase, slot, ref, ...(request ? { request } : {}) };
 })));
}
