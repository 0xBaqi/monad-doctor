import { HEALTH_LIMITS, immutable, makeHealthPlan, type HealthResult, type HealthCounters, type HealthLedgerEntry, type HealthOperation } from './health-coordinator-model.ts';
import { parseHealthComparisonRequest } from './health-comparison-request.ts';
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
function counters(raw: unknown, cleanupPending: unknown): HealthCounters {
 const c = obj(raw, ['planned', 'dispatched', 'completed', 'skipped', 'inFlight']);
 for (const [k, v] of Object.entries(c)) count(v, k === 'inFlight' ? 1 : 8);
 // Publication seals every planned operation's decision. Completed decisions
 // can still overlap an in-flight cleanup lease; these are separate counts.
 if (Object.keys(c).length !== 5 || ![6,8].includes(Number(c.planned)) || c.completed !== c.dispatched || Number(c.dispatched) + Number(c.skipped) !== c.planned || Number(c.inFlight) > Number(c.dispatched) || typeof cleanupPending !== 'boolean' || cleanupPending !== (Number(c.inFlight) > 0)) fail();
 return c as unknown as HealthCounters;
}
function offset(raw: unknown): number {
 if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > Number.MAX_SAFE_INTEGER) fail();
 return raw;
}
function closeNumber(a: number, b: number, scale: number) {
 // Arithmetic validation only: account for floating-point offset subtraction.
 return Math.abs(a-b) <= Number.EPSILON * Math.max(1,scale) * 4;
}
const commonSkips = ['preparation_error','deadline','phase_capacity','budget','cancelled','transport_quarantined'];
const anchorStatuses: Readonly<Record<string,string>> = Object.freeze({ anchor_redundant:'redundant',anchor_inconsistent:'inconsistent',anchor_unavailable:'unavailable' });
function ledgerEntry(raw: unknown, op: HealthOperation, alignment: Record<string,unknown>): HealthLedgerEntry {
 const e = obj(raw, ['id','provider','phase','slot','state','request','evidence','observation','skipReason','dispatchOrdinal','startedOffsetMs','deadlineOffsetMs','decisionOffsetMs','quiescedOffsetMs','decisionCause','cleanupExceeded','transport','acceptedBytes']);
 for (const key of ['id','provider','phase','slot'] as const) if (e[key] !== op[key]) fail();
 one(e.state, ['completed','skipped']); count(e.acceptedBytes, HEALTH_LIMITS.responseBytes);
 const observation = e.observation === undefined ? undefined : obj(e.observation, ['kind','value','code','reason','observedAt','startedOffsetMs','durationMs']);
 if (e.state === 'skipped') {
  one(e.skipReason, [...commonSkips, ...(op.phase === 'F' || op.phase === 'L' ? ['dependency','wrong_network','rate_limited'] : []), ...(op.phase === 'H' ? ['anchor_unavailable','anchor_redundant','anchor_inconsistent'] : [])]);
  if (e.transport !== 'none' || e.acceptedBytes !== 0 || ['dispatchOrdinal','startedOffsetMs','deadlineOffsetMs','decisionOffsetMs','quiescedOffsetMs','decisionCause','cleanupExceeded'].some(k => e[k] !== undefined)) fail();
  const reason = e.skipReason === 'budget' ? 'budget' : e.skipReason === 'deadline' || e.skipReason === 'phase_capacity' ? 'deadline' : e.skipReason === 'cancelled' || e.skipReason === 'transport_quarantined' ? 'cancelled' : e.skipReason === 'anchor_redundant' ? 'not_requested' : 'dependency';
  if (e.request !== undefined) {
   if (!same(observation, { kind: 'skipped', reason })) fail();
  } else if (op.phase !== 'H' || observation !== undefined) fail();
  const expected = anchorStatuses[String(e.skipReason)];
  if (expected !== undefined) {
   if (alignment.status !== expected || e.request !== undefined) fail();
  }
 } else {
  if (e.skipReason !== undefined || !e.evidence || !e.request || !observation) fail();
  one(observation.kind, ['value','null','error']); one(e.transport, ['quiescent','quarantined']);
  count(e.dispatchOrdinal, 8); if (e.dispatchOrdinal === 0) fail();
  const start = offset(e.startedOffsetMs), deadline = offset(e.deadlineOffsetMs), decision = offset(e.decisionOffsetMs);
  const duration = offset(observation.durationMs);
  if (start >= deadline || decision < start || start !== observation.startedOffsetMs || !closeNumber(decision-start, duration, Math.max(decision,start,duration))) fail();
  one(e.decisionCause, ['response','work_deadline','cancelled','transport_error']);
  if (e.decisionCause === 'work_deadline') {
   if (observation.kind !== 'error' || observation.code !== 'TIMEOUT' || decision < deadline) fail();
  } else if (e.decisionCause === 'cancelled') {
   if (observation.kind !== 'error' || observation.code !== 'CANCELLED' || decision >= deadline) fail();
  } else if (e.decisionCause === 'transport_error') {
   if (observation.kind !== 'error' || !['NETWORK','MALFORMED'].includes(String(observation.code))) fail();
  } else {
   if (decision >= deadline || observation.kind === 'error' && !['RPC','HTTP','RATE_LIMIT','TOO_LARGE','MALFORMED'].includes(String(observation.code))) fail();
  }
  if (e.cleanupExceeded !== undefined && typeof e.cleanupExceeded !== 'boolean') fail();
  if (e.transport === 'quarantined') {
   if (e.cleanupExceeded !== true || e.quiescedOffsetMs !== undefined) fail();
  } else if (offset(e.quiescedOffsetMs) < decision) fail();
 }
 return e as unknown as HealthLedgerEntry;
}
export function serializeHealthComparison(raw: HealthResult): string {
 const result = obj(plain(raw), ['kind', 'report', 'code', 'runId', 'counters', 'cleanupPending']);
 if (result.kind === 'coordinator_error') {
  if (!same(Object.keys(result).sort(), ['kind','code','runId','counters','cleanupPending'].sort())) fail();
  one(result.code, ['OUTPUT_LIMIT', 'INTERNAL']);
  if (typeof result.runId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(result.runId) || typeof result.cleanupPending !== 'boolean') fail();
  counters(result.counters, result.cleanupPending);
 } else {
  if (result.kind !== 'comparison' || Object.keys(result).length !== 2) fail();
  const r = obj(result.report, ['coordinatorVersion','runId','request','status','termination','counters','ledger','alignment','cleanupPending','reconciliation']);
  if (Object.keys(r).length !== 10 || r.coordinatorVersion !== 'm4.1b' || typeof r.runId !== 'string' || typeof r.cleanupPending !== 'boolean') fail();
  const request = parseHealthComparisonRequest(r.request, r.runId), plan = makeHealthPlan(r.runId, request.alignSharedHeight);
  one(r.status, ['completed','partial','cancelled']); one(r.termination, ['plan_complete','deadline','cancelled','transport_quarantined']); counters(r.counters, r.cleanupPending);
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
  const validated: HealthLedgerEntry[] = [];
  const seenRefs = new Set<string>();
  r.ledger.forEach((rawEntry, i) => {
   const op = plan[i], e = ledgerEntry(rawEntry, op, alignment);
   validated.push(e);
   if (e.state === 'skipped') skipped++;
   else { completed++; dispatched++; if (e.dispatchOrdinal !== dispatched) fail(); }
   if (e.transport === 'quarantined') inFlight++;
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
  const dispatchedEntries = validated.filter(e => e.state === 'completed');
  for (let i = 0; i < dispatchedEntries.length; i++) {
   const e = dispatchedEntries[i], next = dispatchedEntries[i+1];
   if (next && (e.cleanupExceeded || e.transport !== 'quiescent' || e.quiescedOffsetMs! > next.startedOffsetMs!)) fail();
   if (e.cleanupExceeded && r.termination !== 'transport_quarantined') fail();
  }
  if ((r.termination === 'transport_quarantined') !== validated.some(e => e.cleanupExceeded === true)) fail();
  const historical = validated.filter(e => e.phase === 'H'), core = validated.filter(e => e.phase !== 'H');
  if (alignment.status === 'selected') {
   if (core.some(e => e.observation?.kind !== 'value') || historical.some(e => !e.request || e.request.params[0] !== alignment.height)) fail();
   const finals = snapshots.map(s => s.collections.flatMap(c => c.evidence).find(e => e.request.params[0] === 'finalized')!.observation);
   if (finals.some(o => o.kind !== 'value' || typeof o.value !== 'object')) fail();
   const heights = finals.map(o => (o as {value:{number:string}}).value.number);
   if (heights[0] === heights[1] || alignment.height !== (BigInt(heights[0]) < BigInt(heights[1]) ? heights[0] : heights[1])) fail();
  } else if (alignment.status === 'redundant' || alignment.status === 'inconsistent') {
   if (core.some(e => e.observation?.kind !== 'value') || historical.some(e => e.skipReason !== (alignment.status === 'redundant' ? 'anchor_redundant' : 'anchor_inconsistent'))) fail();
   if (((rec.integrityIssues as readonly unknown[]).length > 0) !== (alignment.status === 'inconsistent')) fail();
   if (alignment.status === 'redundant') {
    const finals = core.filter(e => e.phase === 'F').map(e => (e.observation as {value:{number:string}}).value.number);
    if (finals[0] !== finals[1]) fail();
   }
  } else if (alignment.status === 'unavailable' && historical.some(e => e.request !== undefined || !['anchor_unavailable','cancelled','deadline','transport_quarantined'].includes(e.skipReason!))) fail();
  // Completion comes from the fixed operation plan, never reconciliation row
  // relations. A collected contradiction/not-comparable row is not a failed call.
  const partial = validated.some(e => e.state === 'skipped' ? e.skipReason !== 'anchor_redundant' : e.observation?.kind !== 'value');
  if (r.status !== 'cancelled' && r.status !== (partial ? 'partial' : 'completed')) fail();
  if ((r.status === 'cancelled' && !['cancelled','transport_quarantined'].includes(String(r.termination))) || (r.termination === 'cancelled' && r.status !== 'cancelled')) fail();
 }
 const wrapper = immutable({ comparisonResponseVersion: COMPARISON_RESPONSE_VERSION, result });
 const text = JSON.stringify(wrapper);
 if (new TextEncoder().encode(text).byteLength > HEALTH_LIMITS.envelopeBytes) throw new ValidationError('Health comparison response exceeds 64 KiB.');
 return text;
}

export type DecodedComparison = Readonly<{ result: HealthResult; text: string }>;
/** Strict public wrapper decoder. Retains the validated compact wire snapshot. */
export function decodeHealthComparison(text: string): DecodedComparison {
 if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > HEALTH_LIMITS.envelopeBytes) fail();
 let raw: unknown;
 try { raw = JSON.parse(text); } catch { return fail(); }
 const wrapper = obj(plain(raw), ['comparisonResponseVersion', 'result']);
 if (Object.keys(wrapper).length !== 2 || wrapper.comparisonResponseVersion !== COMPARISON_RESPONSE_VERSION) fail();
 const canonical = serializeHealthComparison(wrapper.result as HealthResult);
 if (text !== canonical) fail(); // The public contract is compact serializer output; reject duplicate/ambiguous keys.
 const validated = JSON.parse(canonical) as { result: HealthResult };
 return immutable({ result: validated.result, text: canonical });
}
/** Read before parsing; even a chunked HTTP 200 must pass the wire boundary. */
export async function readHealthComparisonResponse(response: Response, signal: AbortSignal, expected: unknown): Promise<DecodedComparison> {
 if (![200,500].includes(response.status) || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) fail();
 const reader = response.body.getReader();
 let done = false, size = 0, text = '';
 const decoder = new TextDecoder('utf-8', { fatal: true });
 const cancel = () => { void reader.cancel().catch(() => {}); };
 signal.addEventListener('abort', cancel, { once: true });
 try {
  if (signal.aborted) fail();
  while (true) {
   const part = await reader.read();
   if (signal.aborted) fail();
   if (part.done) { done = true; text += decoder.decode(); break; }
   size += part.value.byteLength;
   if (size > HEALTH_LIMITS.envelopeBytes) fail();
   text += decoder.decode(part.value, { stream: true });
  }
  const value = decodeHealthComparison(text);
  if (value.result.kind === 'comparison') {
   if (response.status !== 200 || !same(parseHealthComparisonRequest(expected), value.result.report.request)) fail();
  } else if (response.status !== 500) fail();
  return value;
 } finally {
  signal.removeEventListener('abort', cancel);
  if (!done) cancel();
  // A hostile reader need not settle cancellation; the UI stops waiting.
  try { reader.releaseLock(); } catch { /* No server capacity is released here. */ }
 }
}
