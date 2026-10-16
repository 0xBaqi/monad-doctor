import { after } from 'next/server';
import { routeDiagnostic } from '../../../lib/diagnostic-route.ts';
export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export function POST(request: Request): Promise<Response> {
 return routeDiagnostic(request, () => ({
  clock: { now: () => performance.now(), at: (deadline, callback) => {
   const timer = setTimeout(callback, Math.max(0, deadline - performance.now()));
   return () => clearTimeout(timer);
  } },
  env: process.env,
  redisFetch: fetch,
  rpcFetch: fetch,
  registerLifecycle(drained) { after(async () => { await drained; }); },
 }));
}
