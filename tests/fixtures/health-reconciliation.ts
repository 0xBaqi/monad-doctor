import type { HealthBlock, HealthEvidence, HealthEvidenceRef, HealthObservation, HealthSnapshot } from '../../lib/health-reconciliation.ts';
import type { Provider } from '../../lib/model.ts';

// Manually constructed synthetic observations. No collector, fetch or wall clock.
export const AT = '2026-01-01T00:00:00.000Z';
export const hash = (digit: string) => '0x' + digit.repeat(64);
export const FINALIZED: HealthBlock = { number: '0x64', hash: hash('a'), parentHash: hash('b'), timestamp: '0x6955b900' };
export const LATEST: HealthBlock = { ...FINALIZED, number: '0x66', hash: hash('c') };
export const HISTORICAL: HealthBlock = { ...FINALIZED, number: '0x10', hash: hash('d'), timestamp: '0x1' };
export function observed<T>(value: T, offset = 0): Extract<HealthObservation<T>, { kind: 'value' }> {
 return { kind: 'value', value, observedAt: new Date(Date.parse(AT) + offset).toISOString(), startedOffsetMs: offset, durationMs: 1 };
}
export function snapshot(provider: Provider, historical = false): HealthSnapshot {
 const reference = (collectionId: string, evidenceId: number): HealthEvidenceRef => ({ runId: 'run-1', provider, collectionId, evidenceId });
 const evidence: HealthEvidence[] = [
  { evidenceId: 1, request: { method: 'eth_chainId', params: [] }, observation: observed('0x8f') },
  { evidenceId: 2, request: { method: 'eth_getBlockByNumber', params: ['finalized', false] }, observation: observed(FINALIZED, 10) },
  { evidenceId: 3, request: { method: 'eth_getBlockByNumber', params: ['latest', false] }, observation: observed(LATEST, 20) },
 ];
 return {
  runId: 'run-1', provider,
  input: { mode: 'health', providers: ['primary', 'secondary'], ...(historical ? { historicalHeight: '0x10' } : {}) },
  collections: [
   { runId: 'run-1', provider, collectionId: 'diagnostic', evidence },
   ...(historical ? [{ runId: 'run-1', provider, collectionId: 'alignment', evidence: [{ evidenceId: 1, request: { method: 'eth_getBlockByNumber' as const, params: ['0x10', false] as const }, observation: observed(HISTORICAL, 30) }] }] : []),
  ],
  observations: { chain: reference('diagnostic', 1), finalized: reference('diagnostic', 2), latest: reference('diagnostic', 3), ...(historical ? { historical: reference('alignment', 1) } : {}) },
 };
}
type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export function mutable(s: HealthSnapshot): Mutable<HealthSnapshot> { return structuredClone(s) as Mutable<HealthSnapshot>; }
export function replaceObservation(s: HealthSnapshot, slot: keyof HealthSnapshot['observations'], observation: HealthObservation<string | HealthBlock>): HealthSnapshot {
 const copy = mutable(s), ref = copy.observations[slot]!;
 const entry = copy.collections.find(c => c.collectionId === ref.collectionId)!.evidence.find(e => e.evidenceId === ref.evidenceId)!;
 // Test faults intentionally cross the method-specific union, then runtime
 // snapshot validation decides whether the supplied observation is acceptable.
 Object.assign(entry, { observation });
 return copy;
}
