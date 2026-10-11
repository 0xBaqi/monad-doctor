import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveBudget, type BudgetDiagnostic, type BudgetCategory} from '../lib/budget.ts';
import {BodyTimeoutError} from '../lib/rpc.ts';
const env={NODE_ENV:'production',UPSTASH_REDIS_REST_URL:'https://synthetic-test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'synthetic-test-token'};
const marker='DO_NOT_DISCLOSE';
async function check(category:BudgetCategory,fetcher:typeof fetch,config=env,status?:number){
 const records:BudgetDiagnostic[]=[];
 assert.deepEqual(await reserveBudget(config,fetcher,d=>records.push(d)),{status:'unavailable'});
 assert.equal(records.length,1);assert.equal(records[0].category,category);assert.equal(records[0].httpStatus,status);
 assert.ok(Number.isInteger(records[0].durationMs)&&records[0].durationMs>=0);
 assert.deepEqual(Object.keys(records[0]).sort(),(status===undefined?['category','durationMs']:['category','durationMs','httpStatus']).sort());
 const text=JSON.stringify(records);for(const secret of [marker,env.UPSTASH_REDIS_REST_URL,env.UPSTASH_REDIS_REST_TOKEN,'Authorization'])assert.ok(!text.includes(secret));
}
test('budget diagnostics distinguish missing and invalid configuration without fetching',async()=>{
 const noFetch:typeof fetch=async()=>{assert.fail('must not fetch');};
 await check('missing_configuration',noFetch,{...env,UPSTASH_REDIS_REST_TOKEN:''});
 await check('invalid_configuration',noFetch,{...env,UPSTASH_REDIS_REST_URL:'http://localhost'});
});
for(const [status,category] of [[401,'http_authentication'],[403,'http_authentication'],[429,'http_rate_limit'],[400,'redis_command_error'],[503,'http_error']] as const){
 test('budget diagnostics safely classify HTTP '+status,()=>check(category,async()=>new Response(marker,{status}),env,status));
}
test('budget diagnostics discard Redis command error text',()=>check('redis_command_error',async()=>Response.json({error:marker}),env,200));
test('budget diagnostics reject malformed and oversized bodies without disclosure',async()=>{
 for(const body of [marker,'x'.repeat(1025),JSON.stringify({result:[1,'bad']}),JSON.stringify({result:[1,0],error:marker})])await check('malformed_response',async()=>new Response(body),env,200);
});
test('budget diagnostics separate TLS, timeout and transport errors',async()=>{
 await check('tls_error',async()=>{throw new Error(marker,{cause:{code:'CERT_HAS_EXPIRED'}});});
 await check('transport_timeout',async()=>{throw new Error(marker,{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}});});
 await check('transport_timeout',async()=>{throw new BodyTimeoutError(marker);});
 await check('transport_error',async()=>{throw new Error(marker);});
});
test('budget diagnostics classify broken counter state',()=>check('counter_state_error',async()=>Response.json({result:[-1,0]}),env,200));
test('diagnostic observer cannot change allowed or denied admission',async()=>{
 const broken=()=>{throw new Error(marker);};
 assert.deepEqual(await reserveBudget(env,async()=>Response.json({result:[1,0]}),broken),{status:'allowed'});
 assert.deepEqual(await reserveBudget(env,async()=>new Response(marker,{status:401}),broken),{status:'unavailable'});
});
