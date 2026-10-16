import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonFixture } from './fixtures/health-comparison.ts';
import { decodeHealthComparison, readHealthComparisonResponse } from '../lib/health-comparison-response.ts';
import { comparisonSummary, evidenceAnchor, reasonText, observationText } from '../lib/health-comparison-presentation.ts';
import { routeDiagnostic } from '../lib/diagnostic-route.ts';
import { COMPARISON_HEADER, COMPARISON_OPERATION } from '../lib/health-comparison-request.ts';
import { createProcessCapacity } from '../lib/http-capacity.ts';
import { startHealthComparisonHttp } from '../lib/health-comparison-http.ts';
import { FakeClock, ControlledTransport, automaticTransport, comparisonRequest, deferred, wallNow } from './fixtures/health-coordinator.ts';

const originalFetch = globalThis.fetch;
globalThis.fetch = async()=>{assert.fail('No external network permitted');};
test.after(()=>{globalThis.fetch=originalFetch;});
const env={UPSTASH_REDIS_REST_URL:'https://synthetic-test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'SYNTHETIC'};
const request=(body:unknown=comparisonRequest(true),operation:string|null=COMPARISON_OPERATION,extra:Record<string,string>={})=>new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'application/json',...(operation===null?{}:{[COMPARISON_HEADER]:operation}),...extra},body:JSON.stringify(body)});
function context(){const clock=new FakeClock(),capacity=createProcessCapacity(clock.now),rpc=new ControlledTransport();let redis=0,registered=0;const deps={clock,capacity,env,rpcFetch:rpc.fetcher,redisFetch:async()=>{redis++;assert.ok(registered);return Response.json({result:[1,0]});},registerLifecycle(){registered++;},runId:'experience',wallNow};return {clock,capacity,rpc,deps,redis:()=>redis};}
async function pending(p:Promise<unknown>,clock:FakeClock){let done=false;void p.then(()=>{done=true;},()=>{done=true;});await clock.flush();assert.equal(done,false);}
function held(s:ReturnType<typeof context>){const three=Array.from({length:3},()=>s.capacity.tryAcquire());assert.ok(three.every(Boolean));assert.equal(s.capacity.tryAcquire(),undefined);three.forEach(l=>l!.release());}

for(const variant of ['healthy','wrong-network','contradiction','difference','alignment','inconsistent','null','incomplete','cancelled'])test('decoder and presentation: '+variant,async()=>{
 const {result,text}=await comparisonFixture(variant);const decoded=decodeHealthComparison(text);assert.equal(decoded.text,text);assert.deepEqual(decoded.result,result);assert.ok(Object.isFrozen(decoded.result));assert.ok(!text.includes('UNSAFE_UPSTREAM_MARKER'));
 const summary=comparisonSummary(result.report);assert.equal(summary.ordered.length,result.report.reconciliation.rows.length);
 if(variant==='wrong-network'){assert.match(summary.title,/do not establish/);assert.ok(result.report.reconciliation.rows.some(r=>r.relation==='match'));}
 if(variant==='contradiction'){assert.equal(summary.primary?.relation,'contradiction');assert.match(reasonText(summary.primary!),/does not prove a consensus violation/);assert.equal(result.report.status,'completed');}
 if(variant==='difference')assert.match(reasonText(summary.primary!),/sampling time|sampling|Heights/);
 if(variant==='incomplete'||variant==='null')assert.equal(result.report.status,'partial');
 if(variant==='alignment')assert.ok(result.report.reconciliation.rows.some(r=>r.relation==='not_comparable'));
 if(variant==='cancelled')assert.equal(result.report.status,'cancelled');
});
for(const variant of ['version','extra','missing','result','cross-run','cross-provider','missing-reference','sparse','secret','ordinal','counter','complete','cleanup','oversized'])test('strict response rejects '+variant,async()=>{
 const {text}=await comparisonFixture('incomplete');const raw=JSON.parse(text);
 if(variant==='version')raw.comparisonResponseVersion=2;
 if(variant==='extra')raw.extra='secret';
 if(variant==='missing')delete raw.comparisonResponseVersion;
 if(variant==='result')raw.result=null;
 if(variant==='cross-run')raw.result.report.ledger[0].evidence.runId='other';
 if(variant==='cross-provider')raw.result.report.ledger[0].evidence.provider='secondary';
 if(variant==='missing-reference')delete raw.result.report.ledger[0].evidence;
 if(variant==='sparse')delete raw.result.report.ledger[1];
 if(variant==='secret')raw.result.report.ledger[0].upstream='SECRET';
 if(variant==='ordinal')raw.result.report.ledger[1].dispatchOrdinal=1;
 if(variant==='counter')raw.result.report.counters.dispatched=0;
 if(variant==='complete')raw.result.report.status='completed';
 if(variant==='cleanup')raw.result.report.cleanupPending=true;
 assert.throws(()=>decodeHealthComparison(variant==='oversized'?' '.repeat(65537):JSON.stringify(raw)));
});

test('HTTP decoder binds status, input, media type and streaming size',async()=>{
 const {text}=await comparisonFixture();const signal=new AbortController().signal;
 assert.equal((await readHealthComparisonResponse(new Response(text,{headers:{'content-type':'application/json'}}),signal,comparisonRequest(true))).text,text);
 for(const [status,type,body] of [[500,'application/json',text],[200,'text/html',text],[200,'application/json','{}'],[200,'application/json','x'.repeat(65537)],[200,'application/json',new Uint8Array([255])]] as const)await assert.rejects(()=>readHealthComparisonResponse(new Response(body,{status,headers:{'content-type':type}}),signal,comparisonRequest(true)));
 await assert.rejects(()=>readHealthComparisonResponse(new Response(text,{headers:{'content-type':'application/json'}}),signal,comparisonRequest(false)));
 const controller=new AbortController();controller.abort();await assert.rejects(()=>readHealthComparisonResponse(new Response(text,{headers:{'content-type':'application/json'}}),controller.signal,comparisonRequest(true)));
});

test('qualified evidence anchors distinguish every identity component',()=>{
 const ref={runId:'a',provider:'primary' as const,collectionId:'b',evidenceId:1};
 assert.equal(new Set([ref,{...ref,runId:'b'},{...ref,provider:'secondary' as const},{...ref,collectionId:'c'},{...ref,evidenceId:2}].map(evidenceAnchor)).size,5);
 assert.equal(evidenceAnchor(ref),evidenceAnchor({...ref}));assert.equal(observationText({kind:'missing'}),'Missing observation');
});
for(const operation of [null,'','unknown','health-comparison-v2',COMPARISON_OPERATION])for(const body of [comparisonRequest(true),{mode:'health',provider:'primary'},{mode:'gas',provider:'primary'},{mode:'transaction',provider:'primary'},{...comparisonRequest(true),call:{data:'0x1234'}}])test('route discrimination '+JSON.stringify([operation,body.mode,Object.hasOwn(body,'call')]),async()=>{
 const s=context();let factories=0;
 if(operation===null&&body.mode==='health')globalThis.fetch=automaticTransport();
 const promise=routeDiagnostic(request(body,operation),()=>{factories++;return {...s.deps,rpcFetch:automaticTransport()};});
 // A valid legacy health request deliberately uses the legacy collector, which is
 // network-forbidden here. Its compatibility is covered by protected legacy suites.
 const response=await promise;globalThis.fetch=async()=>{assert.fail('No external network permitted');};
 if(operation===COMPARISON_OPERATION&&body.mode==='health_comparison'&&!Object.hasOwn(body,'call')){assert.equal(response.status,200);assert.equal(s.redis(),1);}
 else if(operation===null&&body.mode==='health'){assert.equal(response.status,200);}
 else {assert.equal(response.status,400);assert.equal(s.redis(),0);}
 assert.equal(factories,operation===COMPARISON_OPERATION?1:0);
});

test('supported and unknown operations retain origin, JSON and size guards',async()=>{
 for(const operation of [COMPARISON_OPERATION,'unknown'])for(const [headers,status] of [[{origin:'https://evil.invalid'},403],[{'content-type':'text/plain'},415],[{'content-length':'16385'},413]] as const){let constructed=0;const s=context();assert.equal((await routeDiagnostic(request({},operation,headers),()=>{constructed++;return s.deps;})).status,status);assert.equal(constructed,0);}
});

test('route compares once, reads original body once and registers lifecycle before dispatch',async()=>{
 const s=context();const r=request();let readers=0;const original=r.body!.getReader.bind(r.body);Object.defineProperty(r.body,'getReader',{value:()=>{readers++;return original();}});
 const response=await routeDiagnostic(r,()=>({...s.deps,rpcFetch:automaticTransport()}));assert.equal(response.status,200);assert.equal(readers,1);assert.equal(s.redis(),1);
});

for(const stage of ['body','redis','rpc'])test('publication deadline bounds '+stage+' cleanup without refunding capacity',async()=>{
 const s=context(),cleanup=deferred<void>();let r=request();let deps=s.deps;
 if(stage==='body'){
  r=new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'application/json'},duplex:'half',body:new ReadableStream({cancel(){return cleanup.promise;}})} as RequestInit);
 }else if(stage==='redis'){
  // Affirmative decision followed by failed local releaseLock: only publication
  // times out; no unreserved Monad collection can start.
  deps={...deps,redisFetch:async()=>{const response=Response.json({result:[1,0]});const reader=response.body!.getReader();Object.defineProperty(response.body,'getReader',{value:()=>new Proxy(reader,{get(t,k){if(k==='releaseLock')return()=>{throw Error('cleanup');};const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}})});return response;}};
 }
 const h=startHealthComparisonHttp(r,deps);await s.clock.flush();await s.clock.advance(25000);const response=await h.response;
 assert.equal(response.status,stage==='redis'?504:stage==='body'?408:200);await pending(h.drained,s.clock);held(s);
 const before=await response.clone().text();h.cancel();h.cancel();
 if(stage==='rpc'){s.rpc.reply(0,'0x8f');await h.drained;assert.equal(await response.text(),before);}
 else if(stage==='body'){cleanup.resolve();await h.drained;}
 assert.equal(s.rpc.calls.length,stage==='rpc'?1:0);
});

test('deadline cannot be bypassed by delayed watchdog delivery',async()=>{
 const s=context();let first=true;
 const clock={now:s.clock.now,at(deadline:number,callback:()=>void){if(first){first=false;return()=>{};}return s.clock.at(deadline,callback);}};
 const h=startHealthComparisonHttp(request(),{...s.deps,clock,registerLifecycle(){s.clock.time+=25000;}});
 assert.equal((await h.response).status,504);await h.drained;assert.equal(s.redis(),0);
});

test('compact response contract rejects duplicate keys and ambiguous wrappers',async()=>{
 const {text}=await comparisonFixture();
 assert.throws(()=>decodeHealthComparison(text.replace('"comparisonResponseVersion":1','"comparisonResponseVersion":2,"comparisonResponseVersion":1')));
 assert.throws(()=>decodeHealthComparison(JSON.stringify(JSON.parse(text),null,2)));
 for(const property of ['report','ledger','reconciliation']){
  const {serializeHealthComparison}=await import('../lib/health-comparison-response.ts');
  const raw=JSON.parse(text);let reads=0;
  const parent=property==='report'?raw.result:raw.result.report;
  Object.defineProperty(parent,property,{enumerable:true,get(){reads++;throw Error('getter');}});
  assert.throws(()=>serializeHealthComparison(raw.result));assert.equal(reads,0);
 }
});

test('public comparison requires the explicit shared-height plan',async()=>{
 const s=context();assert.equal((await routeDiagnostic(request(comparisonRequest(false)),()=>s.deps)).status,400);assert.equal(s.redis(),0);assert.equal(s.rpc.calls.length,0);
});

test('valid coordinator-error response is decoded only with HTTP 500',async()=>{
 const {serializeHealthComparison}=await import('../lib/health-comparison-response.ts');
 const text=serializeHealthComparison({kind:'coordinator_error',code:'INTERNAL',runId:'error',counters:{planned:8,dispatched:1,completed:1,skipped:7,inFlight:1},cleanupPending:true});
 assert.equal(decodeHealthComparison(text).result.kind,'coordinator_error');
 assert.equal((await readHealthComparisonResponse(new Response(text,{status:500,headers:{'content-type':'application/json'}}),new AbortController().signal,comparisonRequest(true))).result.kind,'coordinator_error');
 await assert.rejects(()=>readHealthComparisonResponse(new Response(text,{headers:{'content-type':'application/json'}}),new AbortController().signal,comparisonRequest(true)));
});

test('parsed request with unacknowledged reader cleanup times out without releasing its slot',async()=>{
 const s=context(),r=request(),reader=r.body!.getReader();
 Object.defineProperty(r.body,'getReader',{value:()=>new Proxy(reader,{get(t,k){if(k==='releaseLock')return()=>{throw Error('cleanup');};const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}})});
 const h=startHealthComparisonHttp(r,s.deps);await s.clock.flush();await pending(h.response,s.clock);await s.clock.advance(25000);
 assert.equal((await h.response).status,504);await pending(h.drained,s.clock);held(s);assert.equal(s.redis(),0);assert.equal(s.rpc.calls.length,0);
});

test('publication deadline seals at its exact boundary and later admission cleanup cannot replace it',async()=>{
 const s=context();let fire!:()=>void,first=true;
 const clock={now:s.clock.now,at(deadline:number,callback:()=>void){if(first){first=false;fire=callback;}return s.clock.at(deadline,callback);}};
 const deps={...s.deps,clock,redisFetch:async()=>{const response=Response.json({result:[1,0]});const reader=response.body!.getReader();Object.defineProperty(response.body,'getReader',{value:()=>new Proxy(reader,{get(t,k){if(k==='releaseLock')return()=>{s.clock.time=26000;fire();return t.releaseLock();};const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}})});return response;}};
 const h=startHealthComparisonHttp(request(),deps);const response=await h.response;assert.equal(response.status,504);const text=await response.clone().text();await h.drained;assert.equal(await response.text(),text);assert.equal(s.rpc.calls.length,0);
 const four=Array.from({length:4},()=>s.capacity.tryAcquire());assert.ok(four.every(Boolean));assert.equal(s.capacity.tryAcquire(),undefined);four.forEach(l=>l!.release());
});
