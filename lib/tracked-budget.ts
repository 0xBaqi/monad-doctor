import { BUDGET_SCRIPT, type Admission } from './budget.ts';
import type { MonotonicClock } from './health-coordinator-model.ts';

export type TrackedReservation = Readonly<{ decision: Promise<Admission>; drained: Promise<void>; cancel(): void }>;
type Options = { env: Readonly<Record<string, string | undefined>>; fetcher: typeof fetch; clock: MonotonicClock };
const unavailable: Admission = Object.freeze({ status: 'unavailable' });
/** One attempt, no refunds/retries. Decision timeout is not transport settlement. */
export function startTrackedReservation(options: Options): TrackedReservation {
 const { clock, fetcher } = options;
 const url = options.env.UPSTASH_REDIS_REST_URL, token = options.env.UPSTASH_REDIS_REST_TOKEN;
 let decide!: (value: Admission) => void, drain!: () => void;
 const decision = new Promise<Admission>(resolve => { decide = resolve; });
 const drained = new Promise<void>(resolve => { drain = resolve; });
 const controller = new AbortController();
 let sealed = false, stopped = false, reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
 let cancellation: Promise<void> | undefined, complete = false, clear = () => {};
 const seal = (value: Admission) => { if (!sealed) { sealed = true; decide(Object.freeze(value)); } };
 function cancelBody() {
  if (reader && !complete && !cancellation) {
   // Rejected cancellation cannot acknowledge cleanup.
   try { cancellation = reader.cancel().catch(() => new Promise<void>(() => {})); }
   catch { cancellation = new Promise<void>(() => {}); }
  }
 }
 function cancel() { stopped = true; seal(unavailable); controller.abort(); cancelBody(); }
 let deadline = 0, lastTime = 0;
 try {
  const endpoint = new URL(url ?? '');
  if (typeof token !== 'string' || !token || token.length > 4096 || /[\r\n]/.test(token) || endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.upstash\.io$/.test(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw new Error();
  const origin = clock.now();
  if (!Number.isFinite(origin) || origin < 0 || origin + 2000 > Number.MAX_SAFE_INTEGER) throw new Error();
  lastTime = origin; deadline = origin + 2000;
  clear = clock.at(deadline, cancel);
 } catch { cancel(); }
 const expired = () => {
  try { const time = clock.now(); const invalid = !Number.isFinite(time) || time < lastTime; lastTime = time; return stopped || invalid || time >= deadline; }
  catch { return true; }
 };
 async function collect() {
  try {
   if (stopped || expired()) { cancel(); return; }
   const response = await fetcher(url!, { method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(['EVAL', BUDGET_SCRIPT, 2, 'monad-doctor:rpc:v1:minute', 'monad-doctor:rpc:v1:day']) });
   if (response.body) {
    try { reader = response.body.getReader(); }
    catch { seal(unavailable); await new Promise<void>(() => {}); return; }
   }
   if (stopped || expired() || !response.ok || !reader) { cancel(); return; }
   let bytes = 0, text = '';
   const decoder = new TextDecoder('utf-8', { fatal: true });
   while (true) {
    const part = await reader.read();
    if (stopped || expired()) { cancel(); return; }
    if (part.done) { complete = true; text += decoder.decode(); break; }
    bytes += part.value.byteLength;
    if (bytes > 1024) { cancel(); return; }
    text += decoder.decode(part.value, { stream: true });
   }
   const value: unknown = JSON.parse(text);
   if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('result' in value)) return;
   const result = value.result;
   if (!Array.isArray(result) || result.length !== 2 || !result.every(Number.isSafeInteger)) return;
   if (result[0] === 1 && result[1] === 0) seal({ status: 'allowed' });
   else if (result[0] === 0 && result[1] > 0 && result[1] <= 86400000) seal({ status: 'exhausted', retryAfter: Math.ceil(result[1] / 1000) });
  } catch { seal(unavailable); }
  finally {
   seal(unavailable);
   try { clear(); } catch { /* Sealed decisions cannot be reopened by a late timer. */ }
   cancelBody();
   if (cancellation) await cancellation;
   if (reader) reader.releaseLock();
   drain();
  }
 }
 // A caller can cancel synchronously before any transport invocation.
 void Promise.resolve().then(collect).catch(() => { seal(unavailable); /* Unknown cleanup: retain ownership. */ });
 return Object.freeze({ decision, drained, cancel });
}
