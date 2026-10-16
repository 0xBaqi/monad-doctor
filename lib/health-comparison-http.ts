import { checkDiagnosticRequest, diagnosticJson } from './http.ts';
import { processCapacity, type ProcessCapacity } from './http-capacity.ts';
import { parseHealthComparisonRequest, startHealthComparison } from './health-coordinator.ts';
import { serializeHealthComparison } from './health-comparison-response.ts';
import { startTrackedReservation } from './tracked-budget.ts';
import { BodyLimitError, BodyTimeoutError } from './rpc.ts';
import type { HealthCoordinatorHandle, MonotonicClock } from './health-coordinator-model.ts';

export type ComparisonHttpHandle = Readonly<{ response: Promise<Response>; drained: Promise<void>; cancel(): void }>;
export type ComparisonHttpDependencies = Readonly<{
 clock: MonotonicClock;
 env: Readonly<Record<string, string | undefined>>;
 redisFetch: typeof fetch;
 rpcFetch: typeof fetch;
 registerLifecycle(drained: Promise<void>): void;
 capacity?: ProcessCapacity;
 runId?: string;
 wallNow?: () => number;
 respond?: (body: string, init: ResponseInit) => Response;
}>;
const never = () => new Promise<void>(() => {});
const consumedCapacity = new WeakSet<object>();

/** Offline-only adapter. No production route imports or activates this module. */
export function startHealthComparisonHttp(request: Request, dependencies: ComparisonHttpDependencies): ComparisonHttpHandle {
 // Capture dependencies and ownership before asynchronous work or caller mutation.
 const { clock, redisFetch, rpcFetch, registerLifecycle, runId, wallNow } = dependencies;
 const respond = dependencies.respond ?? ((body: string, init: ResponseInit) => new Response(body, init));
 const env = { UPSTASH_REDIS_REST_URL: dependencies.env.UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN: dependencies.env.UPSTASH_REDIS_REST_TOKEN };
 const denied = checkDiagnosticRequest(request);
 if (denied) return Object.freeze({ response: Promise.resolve(denied), drained: Promise.resolve(), cancel() {} });
 const lease = (dependencies.capacity ?? processCapacity).tryAcquire();
 if (!lease) return Object.freeze({ response: Promise.resolve(diagnosticJson({ error: 'Diagnostic capacity reached. Wait a minute and retry.' }, 429)), drained: Promise.resolve(), cancel() {} });
 if (consumedCapacity.has(lease)) return Object.freeze({ response: Promise.resolve(diagnosticJson({ error: 'Comparison admission lease already consumed.' }, 503)), drained: Promise.resolve(), cancel() {} });
 const release = lease.release.bind(lease);
 consumedCapacity.add(lease);
 let resolveResponse!: (response: Response) => void, resolveDrain!: () => void;
 const response = new Promise<Response>(resolve => { resolveResponse = resolve; });
 const drained = new Promise<void>(resolve => { resolveDrain = resolve; });
 const obligations: Promise<void>[] = [];
 let stopped = false, published = false, released = false, stageCancel = () => {}, clearWatchdog = () => {};
 const safeClear = (clear: () => void) => { try { clear(); } catch { /* Late timers cannot grant admission. */ } };
 const cancel = () => { stopped = true; stageCancel(); };
 const abort = () => cancel();
 const publish = (value: Response) => { if (!published) { published = true; resolveResponse(value); } };
 const error = (status: number, code: string) => diagnosticJson({ error: code }, status);
 let deadline = 0, lastTime = 0, initialized = false;
 // Capture admission time before the deferred work: a delayed microtask must
 // not restart the HTTP allowance after the platform has already spent it.
 try {
  const origin = clock.now();
  if (!Number.isFinite(origin) || origin < 0 || origin + 25000 > Number.MAX_SAFE_INTEGER) throw new Error();
  lastTime = origin; deadline = origin + 25000; initialized = true;
 } catch { /* The async boundary publishes a sanitized failure and releases. */ }
 function expired() {
  try { const t = clock.now(); const invalid = !Number.isFinite(t) || t < lastTime; lastTime = t; return stopped || invalid || t >= deadline; } catch { return true; }
 }
 function bodyInput() {
  let resolve!: (raw: unknown) => void, reject!: (error: Error) => void, settle!: () => void;
  const value = new Promise<unknown>((yes,no) => { resolve = yes; reject = no; });
  const cleanup = new Promise<void>(yes => { settle = yes; }); obligations.push(cleanup);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, cancellation: Promise<void> | undefined, done = false, ended = false;
  const stop = () => {
   ended = true; reject(new BodyTimeoutError('Request body unavailable.'));
   if (reader && !done && !cancellation) {
    try { cancellation = reader.cancel().catch(never); } catch { cancellation = never(); }
   }
  };
  stageCancel = stop;
  let clear = () => {};
  async function read() {
   try {
    const bodyDeadline = Math.min(clock.now() + 3000, deadline);
    clear = clock.at(bodyDeadline, stop);
    if (ended || stopped || expired() || lastTime >= bodyDeadline) { stop(); return; }
    if (!request.body) throw new Error();
    try { reader = request.body.getReader(); } catch { obligations.push(never()); throw new Error(); }
    const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', size = 0;
    while (true) {
     const part = await reader.read();
     if (ended || stopped || expired() || lastTime >= bodyDeadline) { stop(); return; }
     if (part.done) { done = true; text += decoder.decode(); break; }
     size += part.value.byteLength;
     if (size > 16384) throw new BodyLimitError('Request exceeds 16 KiB.');
     text += decoder.decode(part.value, { stream: true });
    }
    resolve(parseHealthComparisonRequest(JSON.parse(text)));
   } catch (e) { reject(e instanceof BodyLimitError ? e : new Error('Invalid health comparison request.')); }
   finally {
    safeClear(clear);
    if (!done) stop();
    if (cancellation) await cancellation;
    if (reader) reader.releaseLock();
    settle();
   }
  }
  void read().catch(() => { reject(new Error('Request body unavailable.')); });
  return { value, cleanup };
 }
 async function run() {
  try {
   if (!initialized) throw new Error('Invalid HTTP monotonic origin.');
   // Register before starting any owned transport, including Redis. A broken
   // lifecycle host must never turn this into untracked fire-and-forget work.
   const registered = registerLifecycle(drained);
   if (registered !== undefined) { void Promise.resolve(registered).catch(() => {}); throw new Error('Lifecycle registration must be synchronous.'); }
   request.signal.addEventListener('abort', abort, { once: true });
   clearWatchdog = clock.at(deadline, cancel);
   if (request.signal.aborted || stopped || expired()) { cancel(); publish(error(408, 'Comparison cancelled before collection.')); return; }
   const body = bodyInput();
   let input;
   try { input = await body.value; } catch (e) { publish(error(e instanceof BodyLimitError ? 413 : stopped || e instanceof BodyTimeoutError ? 408 : 400, 'Invalid or incomplete health comparison request.')); return; }
   await body.cleanup;
   if (stopped || expired()) { publish(error(408, 'Comparison cancelled before collection.')); return; }
   const reservation = startTrackedReservation({ env, fetcher: redisFetch, clock });
   obligations.push(reservation.drained); stageCancel = reservation.cancel;
   if (stopped || request.signal.aborted || expired()) cancel();
   const admission = await reservation.decision;
   if (admission.status !== 'allowed') {
    const reply = error(admission.status === 'exhausted' ? 429 : 503, admission.status === 'exhausted' ? 'Shared diagnostic budget reached. No RPC calls were made.' : 'Diagnostic protection unavailable. No RPC calls were made.');
    if (admission.status === 'exhausted') reply.headers.set('Retry-After', String(admission.retryAfter));
    publish(reply); return;
   }
   // An affirmative decision alone does not abandon admission cleanup.
   await reservation.drained;
   if (stopped || expired()) { publish(error(408, 'Comparison cancelled before collection.')); return; }
   // The coordinator owns this component lease; the outer capacity lease waits
   // for every owned stage, including this captured component's proper drain.
   let acknowledge!: () => void;
   const admissionDrained = new Promise<void>(resolve => { acknowledge = resolve; });
   const coordinator: HealthCoordinatorHandle = startHealthComparison(input, { fetcher: rpcFetch, clock, runId, wallNow, admission: Object.freeze({ release: acknowledge }) });
   obligations.push(Promise.all([coordinator.drained, admissionDrained]).then(() => {}));
   stageCancel = coordinator.cancel;
   if (stopped || request.signal.aborted || expired()) cancel();
   const result = await coordinator.result;
   let text: string;
   try { text = serializeHealthComparison(result); }
   catch { publish(error(500, 'Comparison response could not be safely serialized.')); return; }
   publish(respond(text, { status: result.kind === 'comparison' ? 200 : 500, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }));
  } catch { cancel(); publish(error(503, 'Comparison lifecycle unavailable.')); }
  finally {
   // Returning a response never releases capacity. Rejected/unknown cleanup is
   // deliberately retained; there is no timeout-based capacity refund.
   await Promise.all(obligations).catch(never);
   safeClear(clearWatchdog); request.signal.removeEventListener('abort', abort);
   if (!released) { released = true; release(); }
   resolveDrain();
  }
 }
 void Promise.resolve().then(run).catch(() => { publish(error(503, 'Comparison cleanup unavailable.')); });
 return Object.freeze({ response, drained, cancel });
}
