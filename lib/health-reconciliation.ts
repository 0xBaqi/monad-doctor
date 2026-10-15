import type { Provider } from './model.ts';
import { hex, object, quantity, ValidationError } from './validation.ts';

export const HEALTH_RECONCILIATION_VERSION = 'm4.1a' as const;
type Pair = readonly [Provider, Provider];
type Slot = 'chain' | 'latest' | 'finalized' | 'historical';
type BlockSlot = Exclude<Slot, 'chain'>;
export type HealthBlock = Readonly<{ number: string; hash: string; parentHash: string; timestamp: string }>;
export type HealthEvidenceRef = Readonly<{ runId: string; provider: Provider; collectionId: string; evidenceId: number }>;
export type HealthComparisonInput = Readonly<{ mode: 'health'; providers: Pair; historicalHeight?: string }>;
export type HealthRpcError = 'TIMEOUT' | 'RATE_LIMIT' | 'HTTP' | 'RPC' | 'MALFORMED' | 'NETWORK' | 'TOO_LARGE' | 'BUDGET';
export type SkipReason = 'deadline' | 'budget' | 'cancelled' | 'dependency' | 'not_requested';
// Relative offsets share the declared run's monotonic origin. Wall timestamps
// are provenance only; clock adjustments must not invent sampling order.
type Timing = Readonly<{ observedAt: string; startedOffsetMs: number; durationMs: number }>;
export type HealthObservation<T> =
 | (Timing & Readonly<{ kind: 'value'; value: T }>)
 | (Timing & Readonly<{ kind: 'null' }>)
 | (Timing & Readonly<{ kind: 'error'; code: HealthRpcError }>)
 | Readonly<{ kind: 'skipped'; reason: SkipReason }>;
export type HealthEvidence =
 | Readonly<{ evidenceId: number; request: { method: 'eth_chainId'; params: readonly [] }; observation: HealthObservation<string> }>
 | Readonly<{ evidenceId: number; request: { method: 'eth_getBlockByNumber'; params: readonly [string, false] }; observation: HealthObservation<HealthBlock> }>;
export type HealthCollection = Readonly<{ runId: string; provider: Provider; collectionId: string; evidence: readonly HealthEvidence[] }>;
export type HealthSnapshot = Readonly<{
 runId: string; provider: Provider; input: HealthComparisonInput;
 collections: readonly HealthCollection[];
 observations: Readonly<Partial<Record<Slot, HealthEvidenceRef>>>;
}>;
export type HealthSubject =
 | Readonly<{ kind: 'network_identity'; expectedChainId: '0x8f' }>
 | Readonly<{ kind: 'latest_head_position' }>
 | Readonly<{ kind: 'finalized_head_position' }>
 | Readonly<{ kind: 'finalized_head_identity' }>
 | Readonly<{ kind: 'historical_block_identity'; height: string }>;
export type HealthRelation = 'match' | 'difference' | 'contradiction' | 'incomplete' | 'not_comparable';
type View = Readonly<{ provider: Provider; ref?: HealthEvidenceRef; observation: HealthObservation<string | HealthBlock> | { kind: 'missing' } }>;
export type HealthIntegrityIssue = Readonly<{
 provider: Provider; code: 'requested_height_mismatch' | 'finalized_ahead_of_latest' | 'finalized_hash_conflict' | 'finalized_parent_conflict' | 'same_hash_payload_conflict';
 evidence: readonly HealthEvidenceRef[];
}>;
export type HealthComparisonRow = Readonly<{
 subject: HealthSubject; relation: HealthRelation;
 reason: 'equal_fields' | 'different_positions' | 'different_finalized_heights' | 'different_historical_hashes' | 'incompatible_finalized_claims'
  | 'incompatible_network_claims' | 'missing_network_identity' | 'wrong_network' | 'incomplete_block_bundle' | 'provider_evidence_inconsistent';
 comparedFields: readonly string[]; left: View; right: View;
 dependencies: readonly HealthEvidenceRef[];
 scope: 'network_field' | 'sampled_head_positions' | 'reported_finalized_identity' | 'sampled_historical_identity';
}>;
export type HealthReconciliation = Readonly<{
 reconciliationRuleVersion: typeof HEALTH_RECONCILIATION_VERSION;
 runId: string; input: HealthComparisonInput; providers: Pair;
 snapshots: readonly [HealthSnapshot, HealthSnapshot];
 integrityIssues: readonly HealthIntegrityIssue[]; rows: readonly HealthComparisonRow[];
 guarantees: { consensusVerified: false; operationalIndependence: 'unverified'; currentFreshnessCertified: false };
}>;

function fail(message: string): never { throw new ValidationError('Health reconciliation: ' + message); }
function fields(raw: unknown, allowed: string[]) {
 const x = object(raw);
 if (Object.keys(x).some(k => !allowed.includes(k))) fail('Unexpected field.');
 return x;
}
function identifier(v: unknown): string {
 if (typeof v !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(v)) fail('Invalid identifier.');
 return v;
}
function provider(v: unknown): Provider { if (v !== 'primary' && v !== 'secondary') fail('Invalid provider.'); return v; }
function id(v: unknown): number { if (!Number.isSafeInteger(v) || Number(v) < 1) fail('Invalid evidence ID.'); return v as number; }
function ref(raw: unknown): HealthEvidenceRef {
 const x = fields(raw, ['runId', 'provider', 'collectionId', 'evidenceId']);
 return { runId: identifier(x.runId), provider: provider(x.provider), collectionId: identifier(x.collectionId), evidenceId: id(x.evidenceId) };
}
function input(raw: unknown): HealthComparisonInput {
 const x = fields(raw, ['mode', 'providers', 'historicalHeight']);
 if (x.mode !== 'health' || !Array.isArray(x.providers) || x.providers.length !== 2) fail('Invalid health input.');
 const pair = x.providers.map(provider);
 if (pair[0] === pair[1]) fail('Provider pair must be distinct.');
 // Pair order is not a subject difference; result attribution follows argument order.
 return { mode: 'health', providers: ['primary', 'secondary'], ...(x.historicalHeight === undefined ? {} : { historicalHeight: quantity(x.historicalHeight) }) };
}
function block(raw: unknown): HealthBlock {
 const x = fields(raw, ['number', 'hash', 'parentHash', 'timestamp']);
 return { number: quantity(x.number), hash: hex(x.hash, 32, 'Block hash'), parentHash: hex(x.parentHash, 32, 'Parent hash'), timestamp: quantity(x.timestamp) };
}
function timing(x: Record<string, unknown>): Timing {
 if (typeof x.observedAt !== 'string' || !Number.isFinite(Date.parse(x.observedAt)) || new Date(x.observedAt).toISOString() !== x.observedAt) fail('Invalid observation timestamp.');
 if (typeof x.durationMs !== 'number' || !Number.isFinite(x.durationMs) || x.durationMs < 0) fail('Invalid observation duration.');
 if (typeof x.startedOffsetMs !== 'number' || !Number.isFinite(x.startedOffsetMs) || x.startedOffsetMs < 0 || x.startedOffsetMs + x.durationMs > Number.MAX_SAFE_INTEGER) fail('Invalid monotonic observation interval.');
 return { observedAt: x.observedAt, startedOffsetMs: x.startedOffsetMs, durationMs: x.durationMs };
}
function observation(raw: unknown, chain: boolean): HealthObservation<string | HealthBlock> {
 const x = object(raw);
 switch (x.kind) {
  case 'value': fields(x, ['kind', 'value', 'observedAt', 'startedOffsetMs', 'durationMs']); return { kind: 'value', value: chain ? quantity(x.value) : block(x.value), ...timing(x) };
  case 'null': fields(x, ['kind', 'observedAt', 'startedOffsetMs', 'durationMs']); return { kind: 'null', ...timing(x) };
  case 'error': {
   fields(x, ['kind', 'code', 'observedAt', 'startedOffsetMs', 'durationMs']);
   if (typeof x.code !== 'string' || !['TIMEOUT', 'RATE_LIMIT', 'HTTP', 'RPC', 'MALFORMED', 'NETWORK', 'TOO_LARGE', 'BUDGET'].includes(x.code)) fail('Invalid error code.');
   return { kind: 'error', code: x.code as HealthRpcError, ...timing(x) };
  }
  case 'skipped':
   fields(x, ['kind', 'reason']);
   if (typeof x.reason !== 'string' || !['deadline', 'budget', 'cancelled', 'dependency', 'not_requested'].includes(x.reason)) fail('Invalid skip reason.');
   return { kind: 'skipped', reason: x.reason as SkipReason };
  default: return fail('Invalid observation kind.');
 }
}
function evidence(raw: unknown): HealthEvidence {
 const x = fields(raw, ['evidenceId', 'request', 'observation']), req = fields(x.request, ['method', 'params']);
 if (!Array.isArray(req.params)) fail('Invalid request parameters.');
 if (req.method === 'eth_chainId' && req.params.length === 0) {
  return { evidenceId: id(x.evidenceId), request: { method: 'eth_chainId', params: [] }, observation: observation(x.observation, true) as HealthObservation<string> };
 }
 if (req.method !== 'eth_getBlockByNumber' || req.params.length !== 2 || req.params[1] !== false) fail('Invalid health method or parameters.');
 const selector = req.params[0] === 'latest' || req.params[0] === 'finalized' ? req.params[0] : quantity(req.params[0]);
 return { evidenceId: id(x.evidenceId), request: { method: 'eth_getBlockByNumber', params: [selector, false] }, observation: observation(x.observation, false) as HealthObservation<HealthBlock> };
}
function freeze<T>(value: T): T {
 if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
 return value;
}
function key(r: HealthEvidenceRef): string { return JSON.stringify([r.runId, r.provider, r.collectionId, r.evidenceId]); }

/** Validates and copies JSON-shaped supplied observations; performs no collection. */
export function validateHealthSnapshot(raw: unknown): HealthSnapshot {
 const x = fields(raw, ['runId', 'provider', 'input', 'collections', 'observations']);
 const runId = identifier(x.runId), owner = provider(x.provider), context = input(x.input);
 if (!Array.isArray(x.collections) || x.collections.length > 4) fail('Invalid collections.');
 const collectionIds = new Set<string>(), index = new Map<string, HealthEvidence>(); let count = 0;
 const collections: HealthCollection[] = x.collections.map(rawCollection => {
  const c = fields(rawCollection, ['runId', 'provider', 'collectionId', 'evidence']);
  if (c.runId !== runId || c.provider !== owner) fail('Collection ownership mismatch.');
  const collectionId = identifier(c.collectionId);
  if (collectionIds.has(collectionId)) fail('Duplicate collection ID.'); collectionIds.add(collectionId);
  if (!Array.isArray(c.evidence) || (count += c.evidence.length) > 10) fail('Too many evidence entries.');
  const entries = c.evidence.map(evidence);
  for (const entry of entries) {
   const k = key({ runId, provider: owner, collectionId, evidenceId: entry.evidenceId });
   if (index.has(k)) fail('Duplicate qualified evidence ID.'); index.set(k, entry);
  }
  return { runId, provider: owner, collectionId, evidence: entries };
 });
 const refs = fields(x.observations, ['chain', 'latest', 'finalized', 'historical']);
 const observations: Partial<Record<Slot, HealthEvidenceRef>> = {}, used = new Set<string>();
 for (const slot of ['chain', 'latest', 'finalized', 'historical'] as const) {
  if (refs[slot] === undefined) continue;
  const r = ref(refs[slot]), k = key(r), e = index.get(k);
  if (r.runId !== runId || r.provider !== owner || !e) fail('Reference ownership or resolution mismatch.');
  if (used.has(k)) fail('Evidence reference reused for another subject.'); used.add(k);
  if (slot === 'chain') { if (e.request.method !== 'eth_chainId') fail('Chain reference context mismatch.'); }
  else {
   const target = slot === 'historical' ? context.historicalHeight : slot;
   if (target === undefined || e.request.method !== 'eth_getBlockByNumber' || e.request.params[0] !== target) fail('Block reference context mismatch.');
  }
  observations[slot] = r;
 }
 // No unassigned responses can disappear from integrity evaluation.
 if (used.size !== index.size) fail('Unreferenced evidence entry.');
 return freeze({ runId, provider: owner, input: context, collections, observations });
}
function view(s: HealthSnapshot, slot: Slot): View {
 const r = s.observations[slot];
 if (!r) return { provider: s.provider, observation: { kind: 'missing' } };
 const entry = s.collections.find(c => c.collectionId === r.collectionId)!.evidence.find(e => e.evidenceId === r.evidenceId)!;
 return { provider: s.provider, ref: r, observation: entry.observation };
}
function value(v: View): string | HealthBlock | undefined { return v.observation.kind === 'value' ? v.observation.value : undefined; }
function blockValue(v: View): HealthBlock | undefined { const b = value(v); return typeof b === 'object' ? b : undefined; }
function before(a: View, b: View): boolean {
 return 'startedOffsetMs' in a.observation && 'startedOffsetMs' in b.observation && a.observation.startedOffsetMs + a.observation.durationMs < b.observation.startedOffsetMs;
}
function integrity(s: HealthSnapshot): HealthIntegrityIssue[] {
 const issues: HealthIntegrityIssue[] = [];
 const add = (code: HealthIntegrityIssue['code'], a: View, b?: View) => issues.push({ provider: s.provider, code, evidence: [a.ref!, ...(b ? [b.ref!] : [])] });
 const f = view(s, 'finalized'), l = view(s, 'latest'), h = view(s, 'historical');
 const fv = blockValue(f), lv = blockValue(l), hv = blockValue(h);
 if (hv && hv.number !== s.input.historicalHeight) add('requested_height_mismatch', h);
 if (fv && lv && before(f, l)) {
  if (BigInt(fv.number) > BigInt(lv.number)) add('finalized_ahead_of_latest', f, l);
  else if (fv.number === lv.number && fv.hash !== lv.hash) add('finalized_hash_conflict', f, l);
  else if (BigInt(lv.number) === BigInt(fv.number) + 1n && lv.parentHash !== fv.hash) add('finalized_parent_conflict', f, l);
 }
 if (fv && hv && before(f, h) && fv.number === hv.number && fv.hash !== hv.hash) add('finalized_hash_conflict', f, h);
 if (fv && hv && before(f, h) && BigInt(fv.number) === BigInt(hv.number) + 1n && fv.parentHash !== hv.hash) add('finalized_parent_conflict', f, h);
 const blocks = [f, l, h].filter(v => blockValue(v));
 for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) {
  const av = blockValue(blocks[a])!, bv = blockValue(blocks[b])!;
  if (av.hash === bv.hash && (av.number !== bv.number || av.parentHash !== bv.parentHash || av.timestamp !== bv.timestamp)) add('same_hash_payload_conflict', blocks[a], blocks[b]);
 }
 return issues;
}

/** Pure, conservative field reconciliation. Matching observations are not truth proofs. */
export function reconcileHealthSnapshots(leftInput: HealthSnapshot, rightInput: HealthSnapshot): HealthReconciliation {
 const left = validateHealthSnapshot(leftInput), right = validateHealthSnapshot(rightInput);
 if (left.runId !== right.runId || left.provider === right.provider || JSON.stringify(left.input) !== JSON.stringify(right.input)) fail('Comparison run, pair or input context mismatch.');
 const issues = [...integrity(left), ...integrity(right)];
 const slots: BlockSlot[] = ['latest', 'finalized', ...(left.input.historicalHeight === undefined ? [] : ['historical'] as const)];
 const dependencies = [left, right].flatMap(s => ['chain', ...slots].flatMap(slot => s.observations[slot as Slot] ? [s.observations[slot as Slot]!] : []));
 const chainLeft = view(left, 'chain'), chainRight = view(right, 'chain');
 const rows: HealthComparisonRow[] = [];
 function row(subject: HealthSubject, slot: Slot, scope: HealthComparisonRow['scope'], comparedFields: string[], decide: (a: string | HealthBlock, b: string | HealthBlock) => Pick<HealthComparisonRow, 'relation' | 'reason'>) {
  const a = view(left, slot), b = view(right, slot), av = value(a), bv = value(b);
  let decision: Pick<HealthComparisonRow, 'relation' | 'reason'>;
  if (slot === 'chain') decision = av === undefined || bv === undefined ? { relation: 'incomplete', reason: 'missing_network_identity' } : decide(av, bv);
  else if ([value(chainLeft), value(chainRight)].some(v => typeof v === 'string' && v !== '0x8f')) decision = { relation: 'not_comparable', reason: 'wrong_network' };
  else if (value(chainLeft) === undefined || value(chainRight) === undefined) decision = { relation: 'incomplete', reason: 'missing_network_identity' };
  else if (issues.length) decision = { relation: 'not_comparable', reason: 'provider_evidence_inconsistent' };
  // Fixed integrity dependencies prevent an error from erasing a conflicting
  // observation and thereby upgrading another block row to a match.
  else if ([left, right].some(s => slots.some(slot => blockValue(view(s, slot)) === undefined))) decision = { relation: 'incomplete', reason: 'incomplete_block_bundle' };
  else decision = decide(av!, bv!);
  rows.push({ subject, ...decision, comparedFields, left: a, right: b, dependencies: slot === 'chain' ? [chainLeft.ref, chainRight.ref].filter((r): r is HealthEvidenceRef => Boolean(r)) : dependencies, scope });
 }
 row({ kind: 'network_identity', expectedChainId: '0x8f' }, 'chain', 'network_field', ['chainId'], (a, b) => ({ relation: a === b ? 'match' : 'contradiction', reason: a === b ? 'equal_fields' : 'incompatible_network_claims' }));
 for (const slot of ['latest', 'finalized'] as const) row({ kind: slot === 'latest' ? 'latest_head_position' : 'finalized_head_position' }, slot, 'sampled_head_positions', ['number'], (a, b) => ({ relation: (a as HealthBlock).number === (b as HealthBlock).number ? 'match' : 'difference', reason: (a as HealthBlock).number === (b as HealthBlock).number ? 'equal_fields' : 'different_positions' }));
 row({ kind: 'finalized_head_identity' }, 'finalized', 'reported_finalized_identity', ['number', 'hash'], (a, b) => {
  const av = a as HealthBlock, bv = b as HealthBlock;
  return av.number !== bv.number ? { relation: 'not_comparable', reason: 'different_finalized_heights' } : { relation: av.hash === bv.hash ? 'match' : 'contradiction', reason: av.hash === bv.hash ? 'equal_fields' : 'incompatible_finalized_claims' };
 });
 if (left.input.historicalHeight !== undefined) row({ kind: 'historical_block_identity', height: left.input.historicalHeight }, 'historical', 'sampled_historical_identity', ['number', 'hash'], (a, b) => ({ relation: (a as HealthBlock).hash === (b as HealthBlock).hash ? 'match' : 'difference', reason: (a as HealthBlock).hash === (b as HealthBlock).hash ? 'equal_fields' : 'different_historical_hashes' }));
 return freeze({ reconciliationRuleVersion: HEALTH_RECONCILIATION_VERSION, runId: left.runId, input: left.input, providers: [left.provider, right.provider] as Pair, snapshots: [left, right] as const, integrityIssues: issues, rows, guarantees: { consensusVerified: false, operationalIndependence: 'unverified', currentFreshnessCertified: false } });
}
