import type { MonotonicClock } from '../../lib/health-coordinator-model.ts';
import { AT, FINALIZED, LATEST } from './health-reconciliation.ts';

export function deferred<T>() {
 let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
 const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}
// All delays are driven explicitly. Microtask flushing uses no wall timers.
export class FakeClock implements MonotonicClock {
 time = 1000;
 private sequence = 0;
 private tasks = new Map<number, { deadline: number; callback: () => void }>();
 now = () => this.time;
 at = (deadline: number, callback: () => void) => {
  const id = ++this.sequence; this.tasks.set(id, { deadline, callback });
  return () => { this.tasks.delete(id); };
 };
 async flush() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
 async advance(ms: number) {
  const end = this.time + ms;
  while (true) {
   const next = [...this.tasks].filter(([, t]) => t.deadline <= end).sort((a, b) => a[1].deadline - b[1].deadline || a[0] - b[0])[0];
   if (!next) break;
   this.time = Math.max(this.time, next[1].deadline); this.tasks.delete(next[0]); next[1].callback(); await this.flush();
  }
  this.time = end; await this.flush();
 }
 pending() { return this.tasks.size; }
}
export type RecordedCall = { url: string; method: string; params: unknown[]; id: number; signal: AbortSignal; init: RequestInit; response: ReturnType<typeof deferred<Response>> };
export class ControlledTransport {
 calls: RecordedCall[] = [];
 fetcher: typeof fetch = (url, init) => {
  const request = JSON.parse(String(init!.body));
  const response = deferred<Response>();
  this.calls.push({ url: String(url), ...request, signal: init!.signal as AbortSignal, init: init!, response });
  return response.promise;
 };
 reply(index: number, value: unknown) { const call = this.calls[index]; call.response.resolve(Response.json({ jsonrpc: '2.0', id: call.id, result: value })); }
}
export const wallNow = () => Date.parse(AT);
export function automaticTransport(override?: (method: string, params: unknown[], provider: string) => unknown): typeof fetch {
 return async (url, init) => {
  const request = JSON.parse(String(init!.body)), provider = String(url).includes('rpc1.') ? 'secondary' : 'primary';
  const value = override ? override(request.method, request.params, provider) : request.method === 'eth_chainId' ? '0x8f' : request.params[0] === 'latest' ? LATEST : FINALIZED;
  return Response.json({ jsonrpc: '2.0', id: request.id, result: value });
 };
}
export const comparisonRequest = (alignSharedHeight = false) => ({ mode: 'health_comparison', providers: ['primary', 'secondary'], alignSharedHeight }) as const;
