import { readBounded, BodyTimeoutError } from './rpc.ts';
// Server-only: imported by the HTTP boundary, never by report or client modules.
// Atomic reservations cover the collector's maximum ten RPC calls, including failures.
export const RESERVATION = 10;
export const MINUTE_BUDGET = 200;
export const DAY_BUDGET = 10000;
export const BUDGET_SCRIPT = `
local minute = tonumber(redis.call('GET', KEYS[1]) or '0')
local day = tonumber(redis.call('GET', KEYS[2]) or '0')
local mt = redis.call('PTTL', KEYS[1])
local dt = redis.call('PTTL', KEYS[2])
if (minute > 0 and mt < 0) or (day > 0 and dt < 0) then return {-1, 0} end
if minute + 10 > 200 then return {0, math.max(1, mt)} end
if day + 10 > 10000 then return {0, math.max(1, dt)} end
redis.call('INCRBY', KEYS[1], 10)
if mt < 0 then redis.call('PEXPIRE', KEYS[1], 60000) end
redis.call('INCRBY', KEYS[2], 10)
if dt < 0 then redis.call('PEXPIRE', KEYS[2], 86400000) end
return {1, 0}
`;
export type Admission = { status: 'allowed' } | { status: 'exhausted'; retryAfter: number } | { status: 'unavailable' };
type Environment = Record<string, string | undefined>;
export type BudgetCategory = 'allowed' | 'exhausted' | 'local_bypass' | 'missing_configuration' | 'invalid_configuration' | 'http_authentication' | 'http_rate_limit' | 'http_error' | 'transport_timeout' | 'tls_error' | 'transport_error' | 'malformed_response' | 'redis_command_error' | 'counter_state_error';
export type BudgetDiagnostic = { category: BudgetCategory; httpStatus?: number; durationMs: number };
// Explicit projection only: never attach exceptions, URLs, headers or upstream bodies.
export async function reserveBudget(env: Environment = process.env, fetcher: typeof fetch = fetch, observe?: (diagnostic: BudgetDiagnostic) => void): Promise<Admission> {
 const began = Date.now(); let httpStatus: number | undefined;
 const finish = (category: BudgetCategory, admission: Admission = {status:'unavailable'}): Admission => {
  try { observe?.({category, ...(httpStatus === undefined ? {} : {httpStatus}), durationMs: Math.max(0, Date.now()-began)}); } catch { /* Observation cannot change admission. */ }
  return admission;
 };
 const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
 const required = env.NODE_ENV === 'production' || env.VERCEL === '1';
 if (!required && !url && !token) return finish('local_bypass',{status:'allowed'});
 if (!url || !token) return finish('missing_configuration');
 if (token.length > 4096 || /[\r\n]/.test(token)) return finish('invalid_configuration');
 try {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.upstash\.io$/.test(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') return finish('invalid_configuration');
 } catch { return finish('invalid_configuration'); }
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), 2000);
 let reading = false;
 try {
  const response = await fetcher(url, {method:'POST',redirect:'error',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(['EVAL',BUDGET_SCRIPT,2,'monad-doctor:rpc:v1:minute','monad-doctor:rpc:v1:day'])});
  httpStatus = response.status;
  if (!response.ok) {
   void response.body?.cancel().catch(()=>{});
   return finish(response.status === 401 || response.status === 403 ? 'http_authentication' : response.status === 429 ? 'http_rate_limit' : response.status === 400 ? 'redis_command_error' : 'http_error');
  }
  const remaining = 2000 - (Date.now() - began);
  if (remaining <= 0) {void response.body?.cancel().catch(()=>{});return finish('transport_timeout');}
  reading = true;
  const value: unknown = JSON.parse(await readBounded(response.body, 1024, remaining));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return finish('malformed_response');
  if (Object.keys(value).length === 1 && 'error' in value && typeof value.error === 'string') return finish('redis_command_error');
  if (Object.keys(value).length !== 1 || !('result' in value)) return finish('malformed_response');
  const result = value.result;
  if (!Array.isArray(result) || result.length !== 2 || !Number.isSafeInteger(result[0]) || !Number.isSafeInteger(result[1])) return finish('malformed_response');
  if (result[0] === 1 && result[1] === 0) return finish('allowed',{status:'allowed'});
  if (result[0] === 0 && result[1] > 0 && result[1] <= 86400000) return finish('exhausted',{status:'exhausted',retryAfter:Math.ceil(result[1]/1000)});
  if (result[0] === -1 && result[1] === 0) return finish('counter_state_error');
  return finish('malformed_response');
 } catch (error) {
  if (controller.signal.aborted || error instanceof BodyTimeoutError) return finish('transport_timeout');
  const cause = error instanceof Error ? error.cause : undefined;
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  if (['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID'].includes(String(code))) return finish('tls_error');
  if (['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ETIMEDOUT'].includes(String(code))) return finish('transport_timeout');
  return finish(reading ? 'malformed_response' : 'transport_error');
 } finally {clearTimeout(timer);}
}
