import test from 'node:test';
import assert from 'node:assert/strict';
import { HEALTH_RECONCILIATION_VERSION, reconcileHealthSnapshots, validateHealthSnapshot, type HealthSnapshot, type HealthSubject } from '../lib/health-reconciliation.ts';
import { AT, FINALIZED, LATEST, HISTORICAL, hash, mutable, observed, replaceObservation, snapshot } from './fixtures/health-reconciliation.ts';

const row = (a: HealthSnapshot, b: HealthSnapshot, kind: HealthSubject['kind']) => reconcileHealthSnapshots(a, b).rows.find(r => r.subject.kind === kind)!;
const error = { kind: 'error', code: 'TIMEOUT', observedAt: AT, startedOffsetMs: 0, durationMs: 5 } as const;
const absent = { kind: 'null', observedAt: AT, startedOffsetMs: 0, durationMs: 1 } as const;
const skipped = { kind: 'skipped', reason: 'deadline' } as const;

test('health reconciliation: identical network and finalized identities match only declared fields', () => {
 const result = reconcileHealthSnapshots(snapshot('primary'), snapshot('secondary'));
 assert.equal(result.reconciliationRuleVersion, HEALTH_RECONCILIATION_VERSION);
 assert.equal(result.rows.length, 4); assert.ok(result.rows.every(r => r.relation === 'match'));
 assert.deepEqual(result.rows[3].comparedFields, ['number', 'hash']);
 assert.deepEqual(result.guarantees, { consensusVerified: false, operationalIndependence: 'unverified', currentFreshnessCertified: false });
});
test('health reconciliation: differing finalized heights are positions, not contradictory identities', () => {
 const b = replaceObservation(snapshot('secondary'), 'finalized', observed({ ...FINALIZED, number: '0x63', hash: hash('e') }, 10));
 assert.equal(row(snapshot('primary'), b, 'finalized_head_position').relation, 'difference');
 assert.equal(row(snapshot('primary'), b, 'finalized_head_identity').relation, 'not_comparable');
});
test('health reconciliation: finalized hash disagreement stays prominent beside matching chain IDs', () => {
 const b = replaceObservation(snapshot('secondary'), 'finalized', observed({ ...FINALIZED, hash: hash('e') }, 10));
 const result = reconcileHealthSnapshots(snapshot('primary'), b);
 assert.equal(result.rows[0].relation, 'match'); assert.equal(result.rows[3].relation, 'contradiction');
 assert.equal(result.rows[3].reason, 'incompatible_finalized_claims'); assert.equal(result.guarantees.consensusVerified, false);
});
test('health reconciliation: differing latest heights are a difference', () => {
 const b = replaceObservation(snapshot('secondary'), 'latest', observed({ ...LATEST, number: '0x67', hash: hash('f') }, 20));
 assert.equal(row(snapshot('primary'), b, 'latest_head_position').relation, 'difference');
});
test('health reconciliation: old shared-height agreement certifies neither freshness nor ancestry', () => {
 const r = row(snapshot('primary', true), snapshot('secondary', true), 'historical_block_identity');
 assert.equal(r.relation, 'match'); assert.equal(r.scope, 'sampled_historical_identity');
 assert.equal((r.left.observation.kind === 'value' && typeof r.left.observation.value === 'object') && r.left.observation.value.timestamp, '0x1');
 assert.equal(reconcileHealthSnapshots(snapshot('primary', true), snapshot('secondary', true)).guarantees.currentFreshnessCertified, false);
});
test('health reconciliation: distinct historical hashes are sampled differences', () => {
 const b = replaceObservation(snapshot('secondary', true), 'historical', observed({ ...HISTORICAL, hash: hash('e') }, 30));
 assert.equal(row(snapshot('primary', true), b, 'historical_block_identity').relation, 'difference');
});
test('health reconciliation: wrong network cannot validate downstream fields', () => {
 const b = replaceObservation(snapshot('secondary'), 'chain', observed('0x1'));
 const r = reconcileHealthSnapshots(snapshot('primary'), b);
 assert.equal(r.rows[0].relation, 'contradiction'); assert.equal(r.rows[0].reason, 'incompatible_network_claims');
 assert.ok(r.rows.slice(1).every(r => r.relation === 'not_comparable' && r.reason === 'wrong_network'));
});
test('health reconciliation: matching wrong chain IDs are a field match only', () => {
 const r = reconcileHealthSnapshots(replaceObservation(snapshot('primary'), 'chain', observed('0x1')), replaceObservation(snapshot('secondary'), 'chain', observed('0x1')));
 assert.equal(r.rows[0].relation, 'match'); assert.ok(r.rows.slice(1).every(r => r.relation === 'not_comparable'));
});
test('health reconciliation: missing identity is preserved without a fake reference', () => {
 const b = mutable(snapshot('secondary')); delete b.observations.chain; b.collections[0].evidence.shift();
 const r = reconcileHealthSnapshots(snapshot('primary'), b);
 assert.equal(r.rows[0].right.observation.kind, 'missing'); assert.equal(r.rows[0].right.ref, undefined);
 assert.ok(r.rows.every(r => r.relation === 'incomplete'));
});
for (const [name, a, b] of [
 ['null versus timeout', absent, error], ['both errors', error, error], ['both skipped', skipped, skipped], ['both null', absent, absent],
] as const) test('health reconciliation: ' + name + ' never creates comparable blocks', () => {
 const r = row(replaceObservation(snapshot('primary'), 'finalized', a), replaceObservation(snapshot('secondary'), 'finalized', b), 'finalized_head_identity');
 assert.equal(r.relation, 'incomplete'); assert.equal(r.left.observation.kind, a.kind); assert.equal(r.right.observation.kind, b.kind);
});
test('health reconciliation: a wrong returned historical height invalidates the block bundle', () => {
 const b = replaceObservation(snapshot('secondary', true), 'historical', observed({ ...HISTORICAL, number: '0x11' }, 30));
 const r = reconcileHealthSnapshots(snapshot('primary', true), b);
 assert.ok(r.integrityIssues.some(i => i.code === 'requested_height_mismatch'));
 assert.equal(r.rows[4].relation, 'not_comparable'); assert.deepEqual(r.rows[4].right.observation, observed({ ...HISTORICAL, number: '0x11' }, 30));
});
test('health reconciliation: IDs may repeat across providers and collections with distinct ownership', () => {
 const r = reconcileHealthSnapshots(snapshot('primary', true), snapshot('secondary', true));
 assert.equal(r.rows[0].left.ref!.evidenceId, r.rows[0].right.ref!.evidenceId);
 assert.notEqual(r.rows[0].left.ref!.provider, r.rows[0].right.ref!.provider);
 assert.equal(r.rows[4].left.ref!.evidenceId, r.rows[0].left.ref!.evidenceId);
 assert.notEqual(r.rows[4].left.ref!.collectionId, r.rows[0].left.ref!.collectionId);
});
test('health reconciliation: missing requested history stays distinct from null, skipped and error', () => {
 const b = mutable(snapshot('secondary', true)); b.collections.pop(); delete b.observations.historical;
 const r = row(snapshot('primary', true), b, 'historical_block_identity');
 assert.equal(r.right.observation.kind, 'missing'); assert.equal(r.right.ref, undefined); assert.equal(r.relation, 'incomplete');
});
for (const fault of ['reference-provider', 'reference-run', 'collection-provider', 'collection-run', 'unknown-collection', 'unknown-id', 'duplicate-id', 'duplicate-collection', 'unused-entry', 'wrong-method', 'wrong-request-height', 'unrequested-history'] as const) test('health reconciliation: rejects ' + fault, () => {
 const b = mutable(snapshot('secondary', true));
 if (fault === 'reference-provider') b.observations.chain!.provider = 'primary';
 if (fault === 'reference-run') b.observations.chain!.runId = 'other';
 if (fault === 'collection-provider') b.collections[0].provider = 'primary';
 if (fault === 'collection-run') b.collections[0].runId = 'other';
 if (fault === 'unknown-collection') b.observations.chain!.collectionId = 'other';
 if (fault === 'unknown-id') b.observations.chain!.evidenceId = 99;
 if (fault === 'duplicate-id') b.collections[0].evidence[1].evidenceId = 1;
 if (fault === 'duplicate-collection') b.collections.push(structuredClone(b.collections[0]));
 if (fault === 'unused-entry') { const e = structuredClone(b.collections[0].evidence[0]); e.evidenceId = 99; b.collections[0].evidence.push(e); }
 if (fault === 'wrong-method') b.observations.chain = b.observations.latest;
 if (fault === 'wrong-request-height') { const e = b.collections[1].evidence[0]; if (e.request.method === 'eth_getBlockByNumber') e.request.params[0] = '0x11'; }
 if (fault === 'unrequested-history') delete b.input.historicalHeight;
 assert.throws(() => reconcileHealthSnapshots(snapshot('primary', true), b));
});
test('health reconciliation: rejects different run and input contexts or duplicate providers', () => {
 const other = mutable(snapshot('secondary')); other.runId = 'other'; other.collections[0].runId = 'other';
 for (const r of Object.values(other.observations)) r.runId = 'other';
 assert.throws(() => reconcileHealthSnapshots(snapshot('primary'), other), /context mismatch/);
 assert.throws(() => reconcileHealthSnapshots(snapshot('primary'), snapshot('secondary', true)), /context mismatch/);
 assert.throws(() => reconcileHealthSnapshots(snapshot('primary'), snapshot('primary')), /context mismatch/);
});
test('health reconciliation: normalizes hex case without altering inputs', () => {
 const b = mutable(snapshot('secondary'));
 if (b.collections[0].evidence[0].observation.kind === 'value') b.collections[0].evidence[0].observation.value = '0x8F';
 const f = b.collections[0].evidence[1].observation; if (f.kind === 'value' && typeof f.value === 'object') f.value.hash = f.value.hash.toUpperCase().replace('0X', '0x');
 assert.ok(reconcileHealthSnapshots(snapshot('primary'), b).rows.every(r => r.relation === 'match'));
});

for (const fault of ['provider-first-hole', 'provider-second-hole', 'collection-hole', 'evidence-hole', 'selector-hole', 'flag-hole', 'null-collection', 'null-evidence', 'nested-array-collection', 'extra-array-property'] as const) test('health data boundary: rejects ' + fault, () => {
 const a = mutable(snapshot('primary'));
 if (fault === 'provider-first-hole') delete (a.input.providers as unknown[])[0];
 if (fault === 'provider-second-hole') delete (a.input.providers as unknown[])[1];
 if (fault === 'collection-hole') { a.collections = new Array(1); a.observations = {}; }
 if (fault === 'evidence-hole') delete a.collections[0].evidence[0];
 const params = a.collections[0]?.evidence[1]?.request.params as unknown[] | undefined;
 if (fault === 'selector-hole') delete params![0];
 if (fault === 'flag-hole') delete params![1];
 if (fault === 'null-collection') Object.assign(a.collections, { 0: null });
 if (fault === 'null-evidence') Object.assign(a.collections[0].evidence, { 0: null });
 if (fault === 'nested-array-collection') Object.assign(a.collections, { 0: [] });
 if (fault === 'extra-array-property') Object.assign(a.collections, { extra: 'not JSON array data' });
 assert.throws(() => validateHealthSnapshot(a));
});
test('health data boundary: requires the explicitly ordered approved provider pair', () => {
 const a = mutable(snapshot('primary')); a.input.providers.reverse();
 assert.throws(() => validateHealthSnapshot(a), /ordered approved provider pair/);
 assert.deepEqual(validateHealthSnapshot(snapshot('primary')).input.providers, ['primary', 'secondary']);
});

for (const location of ['root-provider', 'input', 'provider-array', 'provider-entry', 'collection-entry', 'collection-evidence', 'evidence-id', 'request', 'params', 'param-entry', 'observation', 'kind', 'timestamp', 'duration', 'offset', 'block-value', 'block-number', 'block-hash', 'block-parent', 'block-timestamp', 'reference-id'] as const) test('health data boundary: rejects accessor at ' + location + ' without invoking it', () => {
 const a = mutable(snapshot('primary')), collection = a.collections[0], entry = collection.evidence[1];
 const observation = entry.observation;
 assert.ok(observation.kind === 'value' && typeof observation.value === 'object');
 const targets: Record<typeof location, [object, string]> = {
  'root-provider': [a, 'provider'], input: [a, 'input'], 'provider-array': [a.input, 'providers'], 'provider-entry': [a.input.providers, '0'],
  'collection-entry': [a.collections, '0'], 'collection-evidence': [collection, 'evidence'], 'evidence-id': [entry, 'evidenceId'],
  request: [entry, 'request'], params: [entry.request, 'params'], 'param-entry': [entry.request.params, '0'],
  observation: [entry, 'observation'], kind: [observation, 'kind'], timestamp: [observation, 'observedAt'], duration: [observation, 'durationMs'], offset: [observation, 'startedOffsetMs'],
  'block-value': [observation, 'value'], 'block-number': [observation.value, 'number'], 'block-hash': [observation.value, 'hash'], 'block-parent': [observation.value, 'parentHash'], 'block-timestamp': [observation.value, 'timestamp'],
  'reference-id': [a.observations.finalized!, 'evidenceId'],
 };
 const [target, key] = targets[location], original = Object.getOwnPropertyDescriptor(target, key)!.value;
 let reads = 0;
 Object.defineProperty(target, key, { enumerable: true, configurable: true, get() { reads++; return location === 'timestamp' && reads > 4 ? 'UNVALIDATED_TIMESTAMP' : original; } });
 assert.throws(() => reconcileHealthSnapshots(a, snapshot('secondary')), /data (properties|entries)/);
 assert.equal(reads, 0);
});
for (const fault of ['custom-object-prototype', 'array-subclass-prototype', 'date', 'symbol-property', 'nonenumerable-property', 'setter-only'] as const) test('health data boundary: rejects unsupported ' + fault, () => {
 const a = mutable(snapshot('primary'));
 if (fault === 'custom-object-prototype') Object.setPrototypeOf(a.collections[0], { inherited: true });
 if (fault === 'array-subclass-prototype') Object.setPrototypeOf(a.input.providers, Object.create(Array.prototype));
 if (fault === 'date') Object.assign(a, { observations: new Date(0) });
 if (fault === 'symbol-property') Object.defineProperty(a, Symbol('extra'), { value: 1, enumerable: true });
 if (fault === 'nonenumerable-property') Object.defineProperty(a, 'extra', { value: 1 });
 let writes = 0;
 if (fault === 'setter-only') Object.defineProperty(a.input, 'mode', { enumerable: true, set() { writes++; } });
 assert.throws(() => validateHealthSnapshot(a)); assert.equal(writes, 0);
});
for (const scenario of ['ordinary', 'frozen', 'null-prototype', 'partial', 'contradictory'] as const) test('health data boundary: accepted ' + scenario + ' snapshots round-trip and serialize deterministically', () => {
 let a = mutable(snapshot('primary', true));
 if (scenario === 'partial') a = mutable(replaceObservation(a, 'finalized', error));
 if (scenario === 'contradictory') a = mutable(replaceObservation(a, 'latest', observed({ ...LATEST, number: '0x63' }, 20)));
 if (scenario === 'null-prototype') { Object.setPrototypeOf(a, null); Object.setPrototypeOf(a.collections[0].evidence[1].observation, null); }
 if (scenario === 'frozen') {
  const freeze = (x: unknown) => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } };
  freeze(a);
 }
 const before = JSON.stringify(a), validated = validateHealthSnapshot(a);
 assert.deepEqual(validateHealthSnapshot(JSON.parse(JSON.stringify(validated))), validated);
 const b = snapshot('secondary', true), result = reconcileHealthSnapshots(a, b);
 assert.equal(JSON.stringify(result), JSON.stringify(reconcileHealthSnapshots(a, b)));
 assert.equal(JSON.stringify(a), before);
});
test('health reconciliation: latest timeout cannot conceal incompatible finalized claims', () => {
 const b = replaceObservation(snapshot('secondary'), 'finalized', observed({ ...FINALIZED, hash: hash('e') }, 10));
 assert.equal(reconcileHealthSnapshots(snapshot('primary'), b).rows[3].relation, 'contradiction');
 const result = reconcileHealthSnapshots(snapshot('primary'), replaceObservation(b, 'latest', error));
 assert.equal(result.rows[3].relation, 'contradiction'); assert.equal(result.rows[3].reason, 'incompatible_finalized_claims');
 assert.equal(result.rows[3].dependencies.length, 4);
 assert.ok(result.rows[3].dependencies.every(r => [1, 2].includes(r.evidenceId)));
 assert.deepEqual(result.rows[3].right.observation, observed({ ...FINALIZED, hash: hash('e') }, 10));
});

for (const kind of ['error', 'null', 'skipped', 'missing'] as const) test('health reconciliation: direct finalized disagreement survives unrelated latest ' + kind, () => {
 const a = snapshot('primary'), b = mutable(replaceObservation(snapshot('secondary'), 'finalized', observed({ ...FINALIZED, hash: hash('e') }, 10)));
 let changed: HealthSnapshot = b;
 if (kind === 'missing') { delete b.observations.latest; b.collections[0].evidence.pop(); }
 else changed = replaceObservation(b, 'latest', kind === 'error' ? error : kind === 'null' ? absent : skipped);
 const ab = reconcileHealthSnapshots(a, changed), ba = reconcileHealthSnapshots(changed, a);
 assert.equal(ab.rows[3].relation, 'contradiction'); assert.equal(ba.rows[3].relation, 'contradiction');
 assert.equal(ab.rows[1].relation, 'incomplete'); assert.equal(ab.guarantees.consensusVerified, false);
});
for (const side of ['primary', 'secondary'] as const) for (const slot of ['chain', 'finalized'] as const) test(`health reconciliation: removing required ${side} ${slot} weakens finalized contradiction`, () => {
 let a = snapshot('primary'), b = replaceObservation(snapshot('secondary'), 'finalized', observed({ ...FINALIZED, hash: hash('e') }, 10));
 if (side === 'primary') a = replaceObservation(a, slot, error); else b = replaceObservation(b, slot, error);
 assert.equal(reconcileHealthSnapshots(a, b).rows[3].relation, 'incomplete');
});
test('health reconciliation: direct finalized contradiction preserves internal integrity warnings', () => {
 let b = replaceObservation(snapshot('secondary'), 'finalized', observed({ ...FINALIZED, hash: hash('e') }, 10));
 b = replaceObservation(b, 'latest', observed({ ...LATEST, number: '0x63' }, 20));
 const r = reconcileHealthSnapshots(snapshot('primary'), b);
 assert.equal(r.rows[3].relation, 'contradiction'); assert.ok(r.integrityIssues.some(i => i.code === 'finalized_ahead_of_latest'));
 assert.ok(r.rows.slice(1, 3).every(r => r.relation === 'not_comparable'));
 const weakened = reconcileHealthSnapshots(snapshot('primary'), replaceObservation(b, 'latest', error));
 assert.equal(weakened.rows[3].relation, 'contradiction'); assert.ok(weakened.rows.slice(1, 3).every(r => r.relation === 'incomplete'));
});
test('health reconciliation: removing local inconsistency cannot manufacture a positive finalized match', () => {
 const a = snapshot('primary'), b = replaceObservation(snapshot('secondary'), 'latest', observed({ ...LATEST, number: '0x63' }, 20));
 assert.equal(reconcileHealthSnapshots(a, b).rows[3].relation, 'not_comparable');
 assert.equal(reconcileHealthSnapshots(a, replaceObservation(b, 'latest', error)).rows[3].relation, 'incomplete');
});
test('health reconciliation: later latest behind finalized invalidates dependent rows, retaining evidence', () => {
 const b = replaceObservation(snapshot('secondary'), 'latest', observed({ ...LATEST, number: '0x63' }, 20));
 const r = reconcileHealthSnapshots(snapshot('primary'), b);
 assert.ok(r.integrityIssues.some(i => i.code === 'finalized_ahead_of_latest'));
 assert.equal(r.rows[0].relation, 'match'); assert.ok(r.rows.slice(1).every(r => r.relation === 'not_comparable'));
 assert.deepEqual(r.snapshots[1].collections[0].evidence, b.collections[0].evidence);
});
test('health reconciliation: reversed or overlapping head samples do not invent ordering contradictions', () => {
 for (const at of [0, 10, 11]) {
  const b = replaceObservation(snapshot('secondary'), 'latest', observed({ ...LATEST, number: '0x63' }, at));
  const r = reconcileHealthSnapshots(snapshot('primary'), b);
  assert.equal(r.integrityIssues.length, 0); assert.equal(r.rows[1].relation, 'difference');
 }
});
test('health reconciliation: equal zero-duration intervals cannot establish before/after order', () => {
 const a = snapshot('primary');
 let b = replaceObservation(snapshot('secondary'), 'finalized', { ...observed(FINALIZED), durationMs: 0 });
 b = replaceObservation(b, 'latest', { ...observed({ ...LATEST, number: '0x63' }), durationMs: 0 });
 assert.equal(reconcileHealthSnapshots(a, b).integrityIssues.length, 0);
});
test('health reconciliation: same-height later latest conflicts with finalized hash', () => {
 const b = replaceObservation(snapshot('secondary'), 'latest', observed({ ...LATEST, number: FINALIZED.number }, 20));
 assert.ok(reconcileHealthSnapshots(snapshot('primary'), b).integrityIssues.some(i => i.code === 'finalized_hash_conflict'));
});
test('health reconciliation: wall clock skew cannot alter monotonic ordering or identity claims', () => {
 const skewed = { ...observed({ ...LATEST, number: '0x63' }, 20), observedAt: '2025-01-01T00:00:00.000Z' };
 const r = reconcileHealthSnapshots(snapshot('primary'), replaceObservation(snapshot('secondary'), 'latest', skewed));
 assert.ok(r.integrityIssues.some(i => i.code === 'finalized_ahead_of_latest'));
 const earlier = { ...observed({ ...LATEST, number: '0x63' }, 0), observedAt: '2027-01-01T00:00:00.000Z' };
 assert.equal(reconcileHealthSnapshots(snapshot('primary'), replaceObservation(snapshot('secondary'), 'latest', earlier)).integrityIssues.length, 0);
});
test('health reconciliation: adjacent later latest must name finalized parent', () => {
 const bad = replaceObservation(snapshot('secondary'), 'latest', observed({ ...LATEST, number: '0x65', parentHash: hash('e') }, 20));
 assert.ok(reconcileHealthSnapshots(snapshot('primary'), bad).integrityIssues.some(i => i.code === 'finalized_parent_conflict'));
 const good = replaceObservation(bad, 'latest', observed({ ...LATEST, number: '0x65', parentHash: FINALIZED.hash }, 20));
 assert.equal(reconcileHealthSnapshots(snapshot('primary'), good).integrityIssues.length, 0);
});
test('health reconciliation: same reported hash cannot have conflicting retained payloads', () => {
 const b = replaceObservation(snapshot('secondary'), 'latest', observed({ ...FINALIZED, timestamp: '0x1' }, 20));
 assert.ok(reconcileHealthSnapshots(snapshot('primary'), b).integrityIssues.some(i => i.code === 'same_hash_payload_conflict'));
});
test('health reconciliation: historical sampling cannot contradict an earlier same-height finalized claim', () => {
 function sameHeight(s: HealthSnapshot) {
  const a = mutable(s); a.input.historicalHeight = FINALIZED.number;
  const e = a.collections[1].evidence[0]; if (e.request.method === 'eth_getBlockByNumber') e.request.params[0] = FINALIZED.number;
  return replaceObservation(a, 'historical', observed(FINALIZED, 30));
 }
 const a = sameHeight(snapshot('primary', true)), b = sameHeight(snapshot('secondary', true));
 const bad = replaceObservation(b, 'historical', observed({ ...FINALIZED, hash: hash('e') }, 30));
 const r = reconcileHealthSnapshots(a, bad);
 assert.ok(r.integrityIssues.some(i => i.code === 'finalized_hash_conflict')); assert.equal(r.rows[4].relation, 'not_comparable');
 const beforeFinalization = replaceObservation(b, 'historical', observed({ ...FINALIZED, hash: hash('e') }, 0));
 assert.equal(reconcileHealthSnapshots(a, beforeFinalization).rows[4].relation, 'difference');
});
test('health reconciliation: adjacent historical identity must match the earlier finalized parent claim', () => {
 function adjacent(s: HealthSnapshot) {
  const a = mutable(s); a.input.historicalHeight = '0x63';
  const e = a.collections[1].evidence[0]; if (e.request.method === 'eth_getBlockByNumber') e.request.params[0] = '0x63';
  return replaceObservation(a, 'historical', observed({ ...HISTORICAL, number: '0x63', hash: FINALIZED.parentHash }, 30));
 }
 const a = adjacent(snapshot('primary', true)), b = adjacent(snapshot('secondary', true));
 assert.equal(reconcileHealthSnapshots(a, b).rows[4].relation, 'match');
 const bad = replaceObservation(b, 'historical', observed({ ...HISTORICAL, number: '0x63', hash: hash('e') }, 30));
 assert.ok(reconcileHealthSnapshots(a, bad).integrityIssues.some(i => i.code === 'finalized_parent_conflict'));
});
test('health reconciliation: frozen inputs remain unchanged; output is detached and deeply frozen', () => {
 const a = snapshot('primary', true), b = snapshot('secondary', true), before = JSON.stringify([a, b]);
 function freeze(x: unknown) { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } }
 freeze(a); freeze(b); const result = reconcileHealthSnapshots(a, b);
 assert.equal(JSON.stringify([a, b]), before); assert.notEqual(result.snapshots[0], a);
 assert.ok(Object.isFrozen(result.rows[0].left.observation)); assert.ok(Object.isFrozen(result.snapshots[0].collections[0].evidence));
 const mutableInput = mutable(snapshot('primary')); const detached = reconcileHealthSnapshots(mutableInput, snapshot('secondary'));
 mutableInput.collections[0].evidence.pop(); assert.equal(detached.snapshots[0].collections[0].evidence.length, 3);
});
test('health reconciliation: repeated serialization and provider-order symmetry', () => {
 const a = snapshot('primary', true), b = replaceObservation(snapshot('secondary', true), 'finalized', observed({ ...FINALIZED, hash: hash('e') }, 10));
 const ab = reconcileHealthSnapshots(a, b), ba = reconcileHealthSnapshots(b, a);
 assert.equal(JSON.stringify(ab), JSON.stringify(reconcileHealthSnapshots(a, b)));
 assert.deepEqual(ab.rows.map(({ left, right, dependencies, ...semantic }) => ({ ...semantic, left: left.provider, right: right.provider, dependencies: dependencies.length })), ba.rows.map(({ left, right, dependencies, ...semantic }) => ({ ...semantic, left: right.provider, right: left.provider, dependencies: dependencies.length })));
 assert.deepEqual(ab.providers, [...ba.providers].reverse());
 assert.deepEqual(ab.integrityIssues, ba.integrityIssues);
});
test('health reconciliation: replacing any value with an error cannot produce a new match/difference/contradiction', () => {
 const examples = [snapshot('secondary', true), replaceObservation(snapshot('secondary', true), 'latest', observed({ ...LATEST, number: '0x63' }, 20)), replaceObservation(snapshot('secondary', true), 'finalized', observed({ ...FINALIZED, hash: hash('e') }, 10))];
 for (const b of examples) for (const side of [0, 1]) for (const slot of ['chain', 'latest', 'finalized', 'historical'] as const) {
  const a = snapshot('primary', true), before = reconcileHealthSnapshots(a, b);
  const after = side === 0 ? reconcileHealthSnapshots(replaceObservation(a, slot, error), b) : reconcileHealthSnapshots(a, replaceObservation(b, slot, error));
  for (let i = 0; i < after.rows.length; i++) if (['match', 'difference', 'contradiction'].includes(after.rows[i].relation)) assert.equal(after.rows[i].relation, before.rows[i].relation);
 }
});
for (const fault of ['unknown-field', 'unknown-provider', 'duplicate-pair', 'negative-id', 'noncanonical-quantity', 'invalid-hash', 'invalid-time', 'negative-duration', 'negative-offset', 'unknown-error', 'raw-error-text', 'skipped-time', 'too-many-entries'] as const) test('health snapshot validation: rejects ' + fault, () => {
 const a = mutable(snapshot('primary'));
 if (fault === 'unknown-field') Object.assign(a, { secret: 'do not project' });
 if (fault === 'unknown-provider') Object.assign(a, { provider: 'arbitrary-endpoint' });
 if (fault === 'duplicate-pair') a.input.providers = ['primary', 'primary'];
 if (fault === 'negative-id') a.collections[0].evidence[0].evidenceId = -1;
 if (fault === 'noncanonical-quantity') Object.assign(a.collections[0].evidence[0].observation, { value: '0x08f' });
 if (fault === 'invalid-hash') Object.assign(a.collections[0].evidence[1].observation, { value: { ...FINALIZED, hash: '0x1' } });
 if (fault === 'invalid-time') Object.assign(a.collections[0].evidence[0].observation, { observedAt: 'yesterday' });
 if (fault === 'negative-duration') Object.assign(a.collections[0].evidence[0].observation, { durationMs: -1 });
 if (fault === 'negative-offset') Object.assign(a.collections[0].evidence[0].observation, { startedOffsetMs: -1 });
 if (fault === 'unknown-error') Object.assign(a.collections[0].evidence[0], { observation: { ...error, code: 'UNTRUSTED' } });
 if (fault === 'raw-error-text') Object.assign(a.collections[0].evidence[0], { observation: { ...error, message: 'SENSITIVE_UPSTREAM_TEXT' } });
 if (fault === 'skipped-time') Object.assign(a.collections[0].evidence[0], { observation: { ...skipped, observedAt: AT } });
 if (fault === 'too-many-entries') for (let i = 4; i < 12; i++) { const e = structuredClone(a.collections[0].evidence[0]); e.evidenceId = i; a.collections[0].evidence.push(e); }
 assert.throws(() => validateHealthSnapshot(a));
});
