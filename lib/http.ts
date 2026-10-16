import { reserveBudget } from './budget.ts';
import { diagnose } from './engine.ts';
import { BodyLimitError, BodyTimeoutError, readBounded } from './rpc.ts';
import { parseInput, ValidationError } from './validation.ts';
import { processCapacity } from './http-capacity.ts';
export function diagnosticJson(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function checkDiagnosticRequest(request: Request): Response | undefined {
 if (request.method !== 'POST') return diagnosticJson({ error: 'Use POST for diagnostics.' }, 405);
 if (request.headers.get('sec-fetch-site') === 'cross-site') return diagnosticJson({ error: 'Cross-site requests are not accepted.' }, 403);
 const origin = request.headers.get('origin');
 if (origin) {
  try {
   const parsed = new URL(origin);
   // Next may normalize the internal request URL. Host preserves the browser-facing authority.
   // Do not trust client-controlled X-Forwarded-Host for this check.
   const host = request.headers.get('host') ?? new URL(request.url).host;
   if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin || parsed.host !== host.toLowerCase()) return diagnosticJson({ error: 'Cross-origin requests are not accepted.' }, 403);
  } catch { return diagnosticJson({ error: 'Cross-origin requests are not accepted.' }, 403); }
 }
 if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return diagnosticJson({ error: 'Send application/json.' }, 415);
 const length = request.headers.get('content-length');
 if (length !== null && !/^(0|[1-9][0-9]{0,15})$/.test(length)) return diagnosticJson({ error: 'Content-Length must be a non-negative integer.' }, 400);
 if (length !== null && BigInt(length) > 16384n) return diagnosticJson({ error: 'Request exceeds 16 KiB.' }, 413);
 return undefined;
}
export async function handleDiagnostic(request: Request): Promise<Response> {
 const denied = checkDiagnosticRequest(request);
 if (denied) return denied;
 const lease = processCapacity.tryAcquire();
 if (!lease) return diagnosticJson({ error: 'Diagnostic capacity reached. Wait a minute and retry.' }, 429);
 try {
  const body = await readBounded(request.body, 16384, 3000);
  const input = parseInput(JSON.parse(body));
  const admission = await reserveBudget();
  if (admission.status === 'unavailable') return diagnosticJson({error:'Diagnostic protection is unavailable. No RPC calls were made. Retry later.'},503);
  if (admission.status === 'exhausted') {
   const response = diagnosticJson({error:'Shared diagnostic budget reached. No RPC calls were made. Retry later.'},429);
   response.headers.set('Retry-After',String(admission.retryAfter));
   return response;
  }
  const report = await diagnose(input);
  return diagnosticJson(report);
 } catch (e) {
  if (e instanceof BodyTimeoutError) return diagnosticJson({error:'Request body timed out. Retry with a complete JSON request.'},408);
  if (e instanceof BodyLimitError) return diagnosticJson({ error: 'Request exceeds 16 KiB.' }, 413);
  if (e instanceof ValidationError) return diagnosticJson({ error: e.message }, 400);
  if (e instanceof TypeError && e.message.includes('encoded data')) return diagnosticJson({ error: 'Request body must be valid UTF-8 JSON.' }, 400);
  if (e instanceof SyntaxError) return diagnosticJson({ error: 'Request body must contain valid JSON.' }, 400);
  return diagnosticJson({ error: 'Diagnostic could not complete. Retry with a smaller request.' }, 500);
 } finally { lease.release(); }
}
