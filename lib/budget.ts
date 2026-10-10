import { readBounded } from './rpc.ts';
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
export async function reserveBudget(env: Environment = process.env, fetcher: typeof fetch = fetch): Promise<Admission> {
 const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
 const required = env.NODE_ENV === 'production' || env.VERCEL === '1';
 if (!required && !url && !token) return { status: 'allowed' };
 if (!url || !token || token.length > 4096 || /[\r\n]/.test(token)) return { status: 'unavailable' };
 // Configuration is server-controlled. Refuse private hosts, redirects and credential URLs.
 try {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'https:' || !/^[a-z0-9-]+\.upstash\.io$/.test(endpoint.hostname) || endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') return { status: 'unavailable' };
 } catch { return { status: 'unavailable' }; }
 const controller = new AbortController();
 const began = Date.now(), timer = setTimeout(() => controller.abort(), 2000);
 try {
  const response = await fetcher(url, {method:'POST',redirect:'error',cache:'no-store',signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(['EVAL',BUDGET_SCRIPT,2,'monad-doctor:rpc:v1:minute','monad-doctor:rpc:v1:day'])});
  if (!response.ok) {void response.body?.cancel().catch(()=>{});return {status:'unavailable'};}
  const remaining = 2000 - (Date.now() - began);
  if (remaining <= 0) {void response.body?.cancel().catch(()=>{});return {status:'unavailable'};}
  const value: unknown = JSON.parse(await readBounded(response.body, 1024, remaining));
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('result' in value)) return {status:'unavailable'};
  const result = value.result;
  if (!Array.isArray(result) || result.length !== 2 || !Number.isSafeInteger(result[0]) || !Number.isSafeInteger(result[1])) return {status:'unavailable'};
  if (result[0] === 1 && result[1] === 0) return {status:'allowed'};
  if (result[0] === 0 && result[1] > 0 && result[1] <= 86400000) return {status:'exhausted',retryAfter:Math.ceil(result[1]/1000)};
  return {status:'unavailable'};
 } catch {return {status:'unavailable'};} finally {clearTimeout(timer);}
}
