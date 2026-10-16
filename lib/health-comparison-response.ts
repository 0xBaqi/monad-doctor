import { HEALTH_LIMITS, immutable, makeHealthPlan, type HealthResult } from './health-coordinator-model.ts';
import { parseHealthComparisonRequest } from './health-coordinator.ts';
import { reconcileHealthSnapshots, validateHealthSnapshot } from './health-reconciliation.ts';
import { ValidationError } from './validation.ts';

export const COMPARISON_RESPONSE_VERSION = 1 as const;
function fail(): never { throw new ValidationError('Invalid health comparison response.'); }
// This is a serializer for internal coordinator results, not a general report importer.
// Capture data without invoking getters; bound work before serializing anything.
function plain(raw: unknown, depth = 0, ancestors = new Set<object>(), budget = { nodes: 0 }): unknown {
 if (++budget.nodes > 12000 || depth > 24) return fail();
 if (raw === null || typeof raw === 'boolean') return raw;
 if (typeof raw === 'number') { if (!Number.isFinite(raw) || raw < 0) return fail(); return raw; }
 if (typeof raw === 'string') { if (raw.length > 65536) return fail(); return raw; }
 if (typeof raw !== 'object' || ancestors.has(raw)) return fail();
 const array = Array.isArray(raw);
 if (Object.getPrototypeOf(raw) !== (array ? Array.prototype : Object.prototype) && !(Object.getPrototypeOf(raw) === null && !array)) return fail();
 ancestors.add(raw);
 const descriptors = Object.getOwnPropertyDescriptors(raw), keys = Reflect.ownKeys(descriptors);
 const out: Record<string, unknown> = Object.create(null);
 if (array && (raw.length > 64 || keys.length !== raw.length + 1)) return fail();
 for (const key of keys) {
  if (array && key === 'length') continue;
  const d = descriptors[key as string];
  if (typeof key !== 'string' || !d.enumerable || !('value' in d) || (array && !/^(0|[1-9][0-9]*)$/.test(key))) return fail();
  out[key] = plain(d.value, depth + 1, ancestors, budget);
 }
 ancestors.delete(raw);
 return array ? Array.from({ length: raw.length }, (_, i) => { if (!Object.hasOwn(out, i)) return fail(); return out[i]; }) : out;
}
function obj(raw: unknown, allowed: string[]): Record<string, unknown> {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !allowed.includes(k))) return fail();
 return raw as Record<string, unknown>;
}
function one(raw: unknown, values: readonly unknown[]) { if (!values.includes(raw)) fail(); }
function count(raw: unknown, max: number) { if (!Number.isSafeInteger(raw) || Number(raw) < 0 || Number(raw) > max) fail(); }
function same(a: unknown, b: unknown): boolean {
 const canonical = (x: unknown): unknown => Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => [k, canonical(v)])) : x;
 return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function counters(raw: unknown) {
 const c = obj(raw, ['planned', 'dispatched', 'completed', 'skipped', 'inFlight']);
 for (const [k, v] of Object.entries(c)) count(v, k === 'inFlight' ? 1 : 8);
 if (Object.keys(c).length !== 5 || Number(c.completed) > Number(c.dispatched) || Number(c.dispatched) + Number(c.skipped) > Number(c.planned)) fail();
}
export function serializeHealthComparison(raw: HealthResult): string {
 const result = obj(plain(raw), ['kind', 'report', 'code', 'runId', 'counters', 'cleanupPending']);
 if (result.kind === 'coordinator_error') {
  if (!same(Object.keys(result).sort(), ['kind','code','runId','counters','cleanupPending'].sort())) fail();
  one(result.code, ['OUTPUT_LIMIT', 'INTERNAL']);
  if (typeof result.runId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(result.runId) || typeof result.cleanupPending !== 'boolean') fail();
  counters(result.counters);
 } else {
  if (result.kind !== 'comparison' || Object.keys(result).length !== 2) fail();
  const r = obj(result.report, ['coordinatorVersion','runId','request','status','termination','counters','ledger','alignment','cleanupPending','reconciliation']);
  if (Object.keys(r).length !== 10 || r.coordinatorVersion !== 'm4.1b' || typeof r.runId !== 'string' || typeof r.cleanupPending !== 'boolean') fail();
  const request = parseHealthComparisonRequest(r.request, r.runId), plan = makeHealthPlan(r.runId, request.alignSharedHeight);
  one(r.status, ['completed','partial','cancelled']); one(r.termination, ['plan_complete','deadline','cancelled','transport_quarantined']); counters(r.counters);
  const rec = obj(r.reconciliation, ['reconciliationRuleVersion','runId','input','providers','snapshots','integrityIssues','rows','guarantees']);
  if (!Array.isArray(rec.snapshots) || rec.snapshots.length !== 2) fail();
  const snapshots = rec.snapshots.map(validateHealthSnapshot);
  if (snapshots[0].provider !== 'primary' || snapshots[1].provider !== 'secondary' || snapshots.some(s => s.runId !== r.runId)) fail();
  // Reuse the real reconciler: reject forged rows, references or guarantees.
  if (!same(rec, reconcileHealthSnapshots(snapshots[0], snapshots[1]))) fail();
  const alignment = obj(r.alignment, ['status','height','sources']);
  one(alignment.status, ['disabled','unavailable','redundant','inconsistent','selected']);
  if ((alignment.status === 'disabled') !== !request.alignSharedHeight) fail();
  if (alignment.status === 'selected') {
   if (!same(alignment.height, snapshots[0].input.historicalHeight) || !same(alignment.sources, snapshots.map(s => s.observations.finalized))) fail();
  } else if (Object.keys(alignment).length !== 1 || snapshots.some(s => s.input.historicalHeight !== undefined)) fail();
  if (!Array.isArray(r.ledger) || r.ledger.length !== plan.length) fail();
  let dispatched = 0, completed = 0, skipped = 0, inFlight = 0;
  const seenRefs = new Set<string>();
  r.ledger.forEach((rawEntry, i) => {
   const e = obj(rawEntry, ['id','provider','phase','slot','state','request','evidence','observation','skipReason','dispatchOrdinal','startedOffsetMs','deadlineOffsetMs','decisionOffsetMs','quiescedOffsetMs','decisionCause','cleanupExceeded','transport','acceptedBytes']);
   const op = plan[i];
   for (const key of ['id','provider','phase','slot'] as const) if (e[key] !== op[key]) fail();
   one(e.state, ['completed','skipped']); one(e.transport, ['none','active','cancelling','quarantined','quiescent']);
   if (e.transport === 'active' || e.transport === 'cancelling' || e.transport === 'quarantined') inFlight++;
   count(e.acceptedBytes, HEALTH_LIMITS.responseBytes);
   for (const k of ['startedOffsetMs','deadlineOffsetMs','decisionOffsetMs','quiescedOffsetMs']) if (e[k] !== undefined && (typeof e[k] !== 'number' || !Number.isFinite(e[k]) || Number(e[k]) > Number.MAX_SAFE_INTEGER)) fail();
   if (e.cleanupExceeded !== undefined && typeof e.cleanupExceeded !== 'boolean') fail();
   if (e.decisionCause !== undefined) one(e.decisionCause, ['response','work_deadline','cancelled','transport_error']);
   if (e.skipReason !== undefined) one(e.skipReason, ['dependency','preparation_error','wrong_network','rate_limited','deadline','phase_capacity','budget','cancelled','transport_quarantined','anchor_unavailable','anchor_redundant','anchor_inconsistent']);
   if (e.state === 'skipped') { skipped++; if (e.skipReason === undefined || e.dispatchOrdinal !== undefined) fail(); }
   else { completed++; dispatched++; if (e.dispatchOrdinal !== dispatched || e.skipReason !== undefined) fail(); }
   if (e.evidence !== undefined) {
    if (!same(e.evidence, op.ref)) fail();
    const s = snapshots[i % 2], evidence = s.collections.flatMap(c => c.evidence.map(v => ({ ref: { runId: s.runId, provider: s.provider, collectionId: c.collectionId, evidenceId: v.evidenceId }, v }))).find(v => same(v.ref, e.evidence));
    if (!evidence || !same(evidence.v.request, e.request) || !same(evidence.v.observation, e.observation) || !same(s.observations[op.slot], e.evidence)) fail();
    if (op.request && !same(op.request, e.request)) fail();
    seenRefs.add(JSON.stringify([op.ref.provider,op.ref.collectionId,op.ref.evidenceId]));
   } else if (e.request !== undefined || e.observation !== undefined || e.state !== 'skipped' || op.phase !== 'H') fail();
  });
  if (seenRefs.size !== snapshots.reduce((n,s) => n + s.collections.reduce((n,c) => n + c.evidence.length, 0), 0)) fail();
  if (!same(r.counters, { planned: plan.length, dispatched, completed, skipped, inFlight }) || r.cleanupPending !== (inFlight > 0)) fail();
  const partial = r.ledger.some(rawEntry => { const e = rawEntry as Record<string, unknown>; return e.state === 'skipped' ? e.skipReason !== 'anchor_redundant' : (e.observation as Record<string,unknown>)?.kind !== 'value'; });
  if (r.status !== 'cancelled' && r.status !== (partial ? 'partial' : 'completed')) fail();
 }
 const wrapper = immutable({ comparisonResponseVersion: COMPARISON_RESPONSE_VERSION, result });
 const text = JSON.stringify(wrapper);
 if (new TextEncoder().encode(text).byteLength > HEALTH_LIMITS.envelopeBytes) throw new ValidationError('Health comparison response exceeds 64 KiB.');
 return text;
}
