import type { HealthEnvelope } from './health-coordinator-model.ts';
import type { HealthComparisonRow, HealthEvidenceRef, HealthObservation, HealthBlock } from './health-reconciliation.ts';

export const relationLabels = { match: 'Fields agree', difference: 'Observed difference', contradiction: 'Incompatible RPC claims', incomplete: 'Evidence incomplete', not_comparable: 'Not comparable' } as const;
const subjects = { network_identity: 'Network identity', latest_head_position: 'Latest-head position', finalized_head_position: 'Finalized-head position', finalized_head_identity: 'Provider-attested finalized identity', historical_block_identity: 'Shared-height block identity' } as const;
const reasons = {
 equal_fields: 'Only the named fields agree in these samples.', different_positions: 'Heights differ between sequential observations; sampling time or provider lag may contribute, but neither cause is established.',
 different_finalized_heights: 'Finalized identities at different heights cannot be compared directly.', different_historical_hashes: 'The sampled historical hashes differ; this is not independent consensus verification.',
 incompatible_finalized_claims: 'The providers report different finalized hashes at the same height. This does not prove a consensus violation or identify the correct claim.',
 incompatible_network_claims: 'The providers report different chain identities.', missing_network_identity: 'Required chain identity evidence is unavailable.', wrong_network: 'At least one provider reports a chain other than Monad Mainnet (143). Matching fields cannot validate Monad comparisons.',
 incomplete_block_bundle: 'A required block observation is unavailable. Displayed values do not establish comparison eligibility.', provider_evidence_inconsistent: 'Retained observations contain an internal provider inconsistency. Dependent comparisons remain unestablished.',
} as const;
export function subjectLabel(row: HealthComparisonRow): string { return subjects[row.subject.kind] ?? 'Unsupported comparison subject'; }
export function reasonText(row: HealthComparisonRow): string { return reasons[row.reason] ?? 'No supported interpretation is available.'; }
export function evidenceAnchor(ref: HealthEvidenceRef): string {
 // One encoded tuple, including run/provider/collection, avoids numeric-ID collisions.
 return 'comparison-evidence-' + Array.from(JSON.stringify([ref.runId, ref.provider, ref.collectionId, ref.evidenceId]), char=>char.charCodeAt(0).toString(16).padStart(2,'0')).join('');
}
export function observationText(o: HealthObservation<string | HealthBlock> | { kind: 'missing' }): string {
 if (o.kind === 'missing') return 'Missing observation';
 if (o.kind === 'null') return 'Null response — no value supplied';
 if (o.kind === 'error') return 'Unavailable (' + o.code + ')';
 if (o.kind === 'skipped') return 'Skipped (' + o.reason + ')';
 if (typeof o.value === 'string') return 'Chain ID ' + BigInt(o.value).toString() + ' (' + o.value + ')';
 return 'Block ' + BigInt(o.value.number).toString() + ' · ' + o.value.hash;
}
export function comparisonSummary(report: HealthEnvelope) {
 const rows = report.reconciliation.rows;
 const contradiction = rows.find(r => r.relation === 'contradiction');
 const wrongNetwork = rows.find(r => r.reason === 'wrong_network');
 const priority = { contradiction: 0, not_comparable: 1, incomplete: 2, difference: 3, match: 4 };
 const ordered = [...rows].sort((a,b) => priority[a.relation] - priority[b.relation]);
 const primary = contradiction ?? wrongNetwork ?? ordered[0];
 const integrity = report.reconciliation.integrityIssues.length > 0;
 return {
  primary, ordered,
  title: contradiction ? 'Incompatible provider claims were observed.' : wrongNetwork ? 'The observations do not establish a Monad Mainnet comparison.' : integrity ? 'Provider observations are internally inconsistent.' : primary ? relationLabels[primary.relation] : 'No comparison outcome is established.',
  uncertainty: 'These are sequential provider observations. They do not verify consensus, provider infrastructure independence or current freshness. A shared-height match cannot certify synchronization.',
  next: contradiction || integrity ? 'Inspect the attributed conflicting evidence before relying on either claim. Recheck explicitly or consult the provider with these references.' : wrongNetwork ? 'Verify the expected network in the captured evidence; do not use these samples as Monad confirmation.' : rows.some(r=>r.relation==='incomplete') || report.status !== 'completed' ? 'Inspect unavailable and skipped observations. If needed, run another comparison explicitly after any request limit has cleared.' : 'Inspect the field-level evidence before relying on a specific provider claim. Run again explicitly if a newer sample is needed.',
 };
}
