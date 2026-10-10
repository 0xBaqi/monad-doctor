import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveBudget, BUDGET_SCRIPT } from '../lib/budget.ts';
import { handleDiagnostic } from '../lib/http.ts';
const env={NODE_ENV:'production',UPSTASH_REDIS_REST_URL:'https://synthetic-test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'synthetic-test-token'};
const reply=(value:unknown):typeof fetch=>async()=>Response.json(value);
test('shared admission allows valid atomic reservation and fixes server-controlled command',async()=>{
 let calls=0;
 const result=await reserveBudget(env,async(url,init)=>{calls++;assert.equal(url,env.UPSTASH_REDIS_REST_URL);assert.equal(init?.redirect,'error');assert.equal(init?.cache,'no-store');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-test-token');const command=JSON.parse(String(init?.body));assert.equal(command[0],'EVAL');assert.equal(command[1],BUDGET_SCRIPT);assert.deepEqual(command.slice(2),[2,'monad-doctor:rpc:v1:minute','monad-doctor:rpc:v1:day']);return Response.json({result:[1,0]});});
 assert.deepEqual(result,{status:'allowed'});assert.equal(calls,1);
});
test('shared admission reports exhausted quota and rounds retry upward',async()=>{
 assert.deepEqual(await reserveBudget(env,reply({result:[0,1501]})),{status:'exhausted',retryAfter:2});
 assert.deepEqual(await reserveBudget(env,reply({result:[0,86400000]})),{status:'exhausted',retryAfter:86400});
});
test('production and every Vercel environment fail closed without configuration',async()=>{
 const noFetch:typeof fetch=async()=>{assert.fail('No configured endpoint may be fetched');};
 assert.deepEqual(await reserveBudget({NODE_ENV:'production'},noFetch),{status:'unavailable'});
 assert.deepEqual(await reserveBudget({NODE_ENV:'development',VERCEL:'1'},noFetch),{status:'unavailable'});
 assert.deepEqual(await reserveBudget({NODE_ENV:'development'},noFetch),{status:'allowed'});
});
test('shared admission rejects unsafe configuration before fetching',async()=>{
 const credentialUrl=new URL(env.UPSTASH_REDIS_REST_URL);credentialUrl.username='synthetic-user';credentialUrl.password='synthetic-password';
 for(const url of ['http://localhost','https://evil.invalid','https://test.upstash.io.evil.invalid',credentialUrl.href,'https://test.upstash.io/path','https://test.upstash.io/?token=x']) assert.deepEqual(await reserveBudget({...env,UPSTASH_REDIS_REST_URL:url},async()=>{assert.fail('Unsafe URL');}),{status:'unavailable'});
 assert.deepEqual(await reserveBudget({...env,UPSTASH_REDIS_REST_TOKEN:''},reply({result:[1,0]})),{status:'unavailable'});
});
test('shared admission fails closed on outages HTTP errors and malformed evidence',async()=>{
 for(const value of [{result:[-1,0]},{result:[1,1]},{result:[0,0]},{result:[0,86400001]},{result:['1',0]},{result:[1,0],error:'synthetic-secret'},null,[]]) assert.deepEqual(await reserveBudget(env,reply(value)),{status:'unavailable'});
 assert.deepEqual(await reserveBudget(env,async()=>{throw new Error('synthetic-secret');}),{status:'unavailable'});
 assert.deepEqual(await reserveBudget(env,async()=>new Response('synthetic-secret',{status:401})),{status:'unavailable'});
 assert.deepEqual(await reserveBudget(env,async()=>new Response('x'.repeat(1025))),{status:'unavailable'});
});
test('shared admission aborts a stalled fetch within its bounded deadline',async()=>{
 let aborted=false;
 const result=await reserveBudget(env,async(_url,init)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});}));
 assert.equal(aborted,true);assert.deepEqual(result,{status:'unavailable'});
});
test('HTTP production admission never forwards RPC on outage or exhausted budget',async()=>{
 const old={NODE_ENV:process.env.NODE_ENV,UPSTASH_REDIS_REST_URL:process.env.UPSTASH_REDIS_REST_URL,UPSTASH_REDIS_REST_TOKEN:process.env.UPSTASH_REDIS_REST_TOKEN};const original=globalThis.fetch;
 Object.assign(process.env,env);
 try {
  for(const result of [[-1,0],[0,3000]]) {
   let requests=0;globalThis.fetch=async(url)=>{requests++;assert.equal(url,env.UPSTASH_REDIS_REST_URL);return Response.json({result});};
   const response=await handleDiagnostic(new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'health',provider:'primary'})}));
   assert.equal(response.status,result[0]===0?429:503);assert.equal(requests,1);assert.ok(!(await response.text()).includes('synthetic-test-token'));if(result[0]===0)assert.equal(response.headers.get('retry-after'),'3');
  }
 } finally {globalThis.fetch=original;for(const [key,value]of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
