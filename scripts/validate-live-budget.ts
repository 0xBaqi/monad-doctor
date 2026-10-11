import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {reserveBudget, type BudgetDiagnostic} from '../lib/budget.ts';
import {handleDiagnostic} from '../lib/http.ts';
const namespace='monad-doctor:validation:'+randomUUID();
const endpoint=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN;
const results:{name:string;passed:boolean;detail?:string}[]=[];
const nativeFetch=globalThis.fetch;
const diagnostics: BudgetDiagnostic[]=[];
const observe=(value:BudgetDiagnostic)=>{diagnostics.push(value);};
let stage='configuration';
const env={...process.env,NODE_ENV:'production'};
const isolated:typeof fetch=async(url,init)=>{
 assert.equal(url,endpoint);const command=JSON.parse(String(init?.body));assert.equal(command[0],'EVAL');assert.equal(command[3],'monad-doctor:rpc:v1:minute');assert.equal(command[4],'monad-doctor:rpc:v1:day');
 command[3]=namespace+':minute';command[4]=namespace+':day';
 return nativeFetch(url,{...init,body:JSON.stringify(command)});
};
async function inspectFiles(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+entry.name;if(entry.isDirectory())await inspectFiles(p);else {const data=await readFile(p);assert.ok(!data.includes(Buffer.from(token!)));assert.ok(!data.includes(Buffer.from(endpoint!)));}}}
try {
 if(!endpoint||!token){await reserveBudget(env,isolated,observe);results.push({name:'Required environment presence',passed:false,detail:JSON.stringify({urlPresent:Boolean(endpoint),tokenPresent:Boolean(token)})});throw new Error('Missing configuration');}stage='credential-leak-scan';
 await inspectFiles('.next/static');await inspectFiles('evidence');
 async function scanSource(dir:string){for(const entry of await readdir(dir,{withFileTypes:true})){if(['node_modules','.next','.git','.vercel','.qa'].includes(entry.name)||entry.name.startsWith('.env'))continue;const path=dir+'/'+entry.name;if(entry.isDirectory())await scanSource(path);else{const data=await readFile(path);assert.ok(!data.includes(Buffer.from(token!)));assert.ok(!data.includes(Buffer.from(endpoint!)));}}}
 await scanSource('.');
 results.push({name:'Exact Redis credentials absent from source, reports, logs and client bundles',passed:true});
 stage='authentication-and-initial-reservation';const started=Date.now();
 assert.deepEqual(await reserveBudget(env,isolated,observe),{status:'allowed'});results.push({name:'Actual Redis authenticated and accepted first isolated reservation',passed:true});
 stage='concurrent-reservations';const admissions=[];
 for(let n=0;n<23;n+=4){const batch=await Promise.all(Array.from({length:Math.min(4,23-n)},()=>reserveBudget(env,isolated,observe)));admissions.push(...batch);}
 assert.ok(Date.now()-started<55000);assert.equal(admissions.filter(a=>a.status==='allowed').length,19);assert.equal(admissions.filter(a=>a.status==='exhausted').length,4);assert.equal(admissions.filter(a=>a.status==='unavailable').length,0);
 results.push({name:'Atomic shared quota: 20 total admissions and 4 rejections, concurrency bounded at 4',passed:true});
 stage='denied-http-no-rpc';const previous={NODE_ENV:process.env.NODE_ENV};Object.assign(process.env,{NODE_ENV:'production'});let outbound=0;
 try {globalThis.fetch=async(url,init)=>{assert.equal(url,endpoint);outbound++;return isolated(url,init);};const response=await handleDiagnostic(new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'health',provider:'primary'})}));assert.equal(response.status,429);assert.equal(outbound,1);assert.ok(Number(response.headers.get('retry-after'))>0);}finally{globalThis.fetch=nativeFetch;for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
 results.push({name:'Live exhausted Redis budget returns HTTP 429 with zero Monad RPC requests',passed:true});
 stage='simulated-outage-and-malformed';
 for(const fetcher of [async()=>{throw new Error('synthetic outage');},async()=>Response.json({result:[1,'bad']}),async()=>Response.json({error:'synthetic rejection'})] as typeof fetch[])assert.deepEqual(await reserveBudget(env,fetcher),{status:'unavailable'});
 results.push({name:'Simulated outages and malformed replies fail closed using production configuration',passed:true});
 stage='complete';
}catch {results.push({name:stage,passed:false,detail:'Validation stopped at this stage; sensitive upstream values and error text withheld.'});process.exitCode=1;}
finally{globalThis.fetch=nativeFetch;const dir='evidence/verification';await mkdir(dir,{recursive:true});const report={checkedAt:new Date().toISOString(),namespace,productionCountersTouched:false,diagnostics,cleanup:'Test keys expire automatically (minute 60s, day 24h); no production keys read, modified or deleted.',results};await writeFile(dir+'/live-budget.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));}
