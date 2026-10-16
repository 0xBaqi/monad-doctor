import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessCapacity, claimProcessCapacity, type ProcessCapacity } from '../lib/http-capacity.ts';
import { startHealthComparisonHttp, type ComparisonHttpDependencies } from '../lib/health-comparison-http.ts';
import { startHealthComparison } from '../lib/health-coordinator.ts';
import { serializeHealthComparison } from '../lib/health-comparison-response.ts';
import type { HealthResult } from '../lib/health-coordinator-model.ts';
import { FakeClock, ControlledTransport, automaticTransport, comparisonRequest, wallNow } from './fixtures/health-coordinator.ts';

type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
type Comparison = Extract<HealthResult,{kind:'comparison'}>;
const originalFetch = globalThis.fetch;
globalThis.fetch = async()=>{assert.fail('No ambient networking in hardening tests.');};
test.after(()=>{globalThis.fetch=originalFetch;});
const env={UPSTASH_REDIS_REST_URL:'https://synthetic-test.upstash.io',UPSTASH_REDIS_REST_TOKEN:'SYNTHETIC'};
const request=()=>new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(comparisonRequest())});
function context(extra:Partial<ComparisonHttpDependencies>={}) {
 const clock=new FakeClock(),pool=createProcessCapacity(clock.now),rpc=new ControlledTransport();let redis=0;
 const deps:ComparisonHttpDependencies={clock,capacity:pool,env,rpcFetch:rpc.fetcher,redisFetch:async()=>{redis++;return Response.json({result:[1,0]});},registerLifecycle(){},runId:'hardening',wallNow,...extra};
 return {clock,pool,rpc,deps,redis:()=>redis};
}
function available(pool:ProcessCapacity,n:number) {
 const tokens=Array.from({length:n},()=>pool.tryAcquire());assert.ok(tokens.every(Boolean));assert.equal(pool.tryAcquire(),undefined);tokens.forEach(t=>t!.release());
}
async function pending(p:Promise<unknown>,clock:FakeClock) {let done=false;void p.then(()=>{done=true;},()=>{done=true;});await clock.flush();assert.equal(done,false);}
function clone(r:HealthResult):Mutable<Comparison> {assert.equal(r.kind,'comparison');return structuredClone(r) as Mutable<Comparison>;}
async function collected(variant='healthy',align=false):Promise<Comparison> {
 const clock=new FakeClock(),normal=automaticTransport();let calls=0;
 const h=startHealthComparison(comparisonRequest(align),{clock,wallNow,runId:'response',admission:{release(){}},fetcher:async(url,init)=>{
  const req=JSON.parse(String(init?.body));calls++;
  if(variant==='error'&&calls===3)throw new Error('synthetic');
  const response=await normal(url,init),data=await response.json(),secondary=String(url).includes('rpc1.');
  if(variant==='null'&&req.params[0]==='finalized'&&!secondary)data.result=null;
  if(variant==='wrong_network'&&req.method==='eth_chainId')data.result='0x1';
  if(variant==='contradiction'&&req.params[0]==='finalized'&&secondary)data.result.hash='0x'+'f'.repeat(64);
  if(variant==='alignment'&&req.params[0]==='finalized'&&secondary)data.result.number='0x9';
  if(variant==='alignment'&&req.params[0]==='0x9')data.result.number='0x9';
  if(variant==='inconsistent'&&req.params[0]==='latest')data.result.number='0x1';
  return Response.json(data);
 }});
 const r=await h.result;await h.drained;assert.equal(r.kind,'comparison');return r as Comparison;
}
async function quarantined() {
 const clock=new FakeClock(),rpc=new ControlledTransport();
 const h=startHealthComparison(comparisonRequest(),{clock,wallNow,runId:'quarantine',fetcher:rpc.fetcher,admission:{release(){}}});
 await clock.flush();await clock.advance(2250);const result=await h.result;
 return {result,finish:async()=>{rpc.reply(0,'0x8f');await h.drained;}};
}

test('recursive release getter from review is rejected without invoking foreign acquisition or getters',async()=>{
 const s=context();let reads=0,acquires=0,nested=0;
 const lease={get release(){reads++;nested++;startHealthComparisonHttp(request(),deps);return()=>{};}};
 const deps={...s.deps,capacity:{tryAcquire(){acquires++;return lease;}}};
 const h=startHealthComparisonHttp(request(),deps);assert.equal((await h.response).status,503);await h.drained;
 assert.equal(reads,0);assert.equal(acquires,0);assert.equal(nested,0);assert.equal(s.redis(),0);assert.equal(s.rpc.calls.length,0);available(s.pool,4);
});

test('throwing release getter from review cannot allocate or strand any of four slots',async()=>{
 const s=context();let reads=0,acquires=0;
 const capacity={tryAcquire(){acquires++;const token=s.pool.tryAcquire();return token&&{get release():()=>void{reads++;throw new Error('untrusted');}};}};
 for(let i=0;i<4;i++){const h=startHealthComparisonHttp(request(),{...s.deps,capacity});assert.equal((await h.response).status,503);await h.drained;}
 assert.equal(acquires,0);assert.equal(reads,0);available(s.pool,4);
});

for(const variant of ['getter','throwing_getter','prototype','proxy'] as const)test('unsupported supplied lease '+variant+' is rejected before property inspection',async()=>{
 const s=context(),real=s.pool.tryAcquire()!;let reads=0;
 const fake=variant==='proxy'?new Proxy(real,{get(){reads++;throw new Error();}}):variant==='prototype'?Object.create(real):{get release(){reads++;if(variant==='throwing_getter')throw new Error();return real.release;}};
 const h=startHealthComparisonHttp(request(),{...s.deps,lease:fake});assert.equal((await h.response).status,503);await h.drained;
 assert.equal(reads,0);available(s.pool,3);real.release();available(s.pool,4);
});

test('opaque claim is single-use and public release loses authority after transfer',()=>{
 const pool=createProcessCapacity(),token=pool.tryAcquire()!,release=claimProcessCapacity(pool,token)!;
 assert.throws(()=>claimProcessCapacity(pool,token));token.release();available(pool,3);
 release.call({});available(pool,4);const held=pool.tryAcquire()!;release();available(pool,3);held.release();
 assert.throws(()=>claimProcessCapacity(pool,token));
});

test('wrong-owner and released tokens are rejected without consuming another slot',()=>{
 const a=createProcessCapacity(),b=createProcessCapacity(),token=a.tryAcquire()!;
 assert.throws(()=>claimProcessCapacity(b,token));available(a,3);available(b,4);token.release();assert.throws(()=>claimProcessCapacity(a,token));available(a,4);
});

test('trusted token is rolled back after a monotonic-origin construction failure',async()=>{
 const s=context(),token=s.pool.tryAcquire()!;
 const h=startHealthComparisonHttp(request(),{...s.deps,lease:token,clock:{now(){throw new Error('origin');},at:s.clock.at}});
 assert.equal((await h.response).status,503);await h.drained;available(s.pool,4);assert.equal(s.redis(),0);assert.equal(s.rpc.calls.length,0);
});

test('trusted token is rolled back after lifecycle registration and timer setup failures',async()=>{
 for(const stage of ['registration','timer']){
  const s=context(),token=s.pool.tryAcquire()!;
  const h=startHealthComparisonHttp(request(),{...s.deps,lease:token,...(stage==='registration'?{registerLifecycle(){throw new Error();}}:{clock:{now:s.clock.now,at(){throw new Error();}}})});
  assert.equal((await h.response).status,503);await h.drained;available(s.pool,4);assert.equal(s.redis(),0);
 }
});

test('invalid input releases a trusted claimed slot once without releasing newer jobs',async()=>{
 const s=context(),token=s.pool.tryAcquire()!;
 const r=new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
 const h=startHealthComparisonHttp(r,{...s.deps,lease:token});assert.equal((await h.response).status,400);await h.drained;
 const four=Array.from({length:4},()=>s.pool.tryAcquire());assert.ok(four.every(Boolean));h.cancel();token.release();assert.equal(s.pool.tryAcquire(),undefined);four.forEach(t=>t!.release());
});

test('reentrant clock cannot acquire the same claimed token for another comparison',async()=>{
 const s=context(),token=s.pool.tryAcquire()!;let nested:ReturnType<typeof startHealthComparisonHttp>|undefined,once=false;
 const deps={...s.deps,lease:token,clock:{now(){if(!once){once=true;nested=startHealthComparisonHttp(request(),deps);}return s.clock.now();},at:s.clock.at}};
 const h=startHealthComparisonHttp(request(),deps);assert.equal((await nested!.response).status,503);await s.clock.flush();assert.equal(s.rpc.calls.length,1);
 await s.clock.advance(2250);await h.response;await pending(h.drained,s.clock);token.release();available(s.pool,3);
 s.rpc.reply(0,'0x8f');await h.drained;available(s.pool,4);
});

test('four factory-issued transfers hold capacity across partial publication; fifth dispatches nothing',async()=>{
 const s=context();const handles=Array.from({length:4},()=>startHealthComparisonHttp(request(),s.deps));await s.clock.flush();await s.clock.advance(2250);
 for(const h of handles){assert.equal((await h.response).status,200);await pending(h.drained,s.clock);}
 const fifth=startHealthComparisonHttp(request(),s.deps);assert.equal((await fifth.response).status,429);assert.equal(s.redis(),4);assert.equal(s.rpc.calls.length,4);
 for(let i=0;i<4;i++)s.rpc.reply(i,'0x8f');await Promise.all(handles.map(h=>h.drained));available(s.pool,4);
});

for(const variant of ['healthy','error','null','wrong_network','contradiction'] as const)test('real '+variant+' report retains its operation-derived status',async()=>{
 const r=await collected(variant);const body=JSON.parse(serializeHealthComparison(r));
 assert.equal(body.result.report.status,variant==='healthy'||variant==='contradiction'?'completed':'partial');
 assert.deepEqual(body.result.report.reconciliation,r.report.reconciliation);
});
for(const variant of ['healthy','alignment','inconsistent','contradiction'] as const)test('real historical plan '+variant+' remains serializable',async()=>{
 const r=await collected(variant,true);assert.equal(JSON.parse(serializeHealthComparison(r)).result.report.status,r.report.status);
 if(variant==='alignment')assert.ok(r.report.reconciliation.rows.some(row=>row.relation==='not_comparable'));
 if(variant==='contradiction'){assert.equal(r.report.status,'completed');assert.ok(r.report.reconciliation.rows.some(row=>row.relation==='contradiction'));}
});

test('real pre-dispatch cancellation and cooperative timeouts remain valid',async()=>{
 const clock=new FakeClock();const h=startHealthComparison(comparisonRequest(true),{clock,wallNow,runId:'cancel',fetcher:automaticTransport(),admission:{release(){}}});h.cancel();
 const result=await h.result;await h.drained;const body=JSON.parse(serializeHealthComparison(result));assert.equal(body.result.report.status,'cancelled');assert.equal(body.result.report.counters.dispatched,0);
 const timed=startHealthComparison(comparisonRequest(),{clock,wallNow,runId:'timeout',admission:{release(){}},fetcher:async(_url,init)=>new Promise<Response>((_yes,no)=>init!.signal!.addEventListener('abort',()=>no(new Error('abort')),{once:true}))});
 await clock.flush();await clock.advance(4000);const t=await timed.result;await timed.drained;assert.equal(JSON.parse(serializeHealthComparison(t)).result.report.status,'partial');
});

test('review forged completion and undercount retain their errors and are rejected',async()=>{
 const r=await collected('error'),v=clone(r),e=v.report.ledger.find(e=>e.observation?.kind==='error')!;
 e.state='skipped';e.skipReason='anchor_redundant';delete e.dispatchOrdinal;let ordinal=0;for(const x of v.report.ledger)if(x.state==='completed')x.dispatchOrdinal=++ordinal;
 v.report.counters={planned:6,dispatched:5,completed:5,skipped:1,inFlight:0};v.report.status='completed';
 assert.throws(()=>serializeHealthComparison(v));assert.deepEqual(v.report.reconciliation,r.report.reconciliation);assert.equal(r.report.status,'partial');
});

test('skipped state cannot carry an actual dispatched error even with an otherwise valid skip reason',async()=>{
 const v=clone(await collected('error')),e=v.report.ledger.find(e=>e.observation?.kind==='error')!;
 e.state='skipped';e.skipReason='dependency';delete e.dispatchOrdinal;let ordinal=0;for(const x of v.report.ledger)if(x.state==='completed')x.dispatchOrdinal=++ordinal;
 v.report.counters={planned:6,dispatched:5,completed:5,skipped:1,inFlight:0};assert.throws(()=>serializeHealthComparison(v));
});

const ledgerMutations:Record<string,(v:Mutable<Comparison>)=>void>={
 'falsified dispatched count':v=>{v.report.counters.dispatched--;},
 'falsified completed count':v=>{v.report.counters.completed--;},
 'falsified skipped count':v=>{v.report.counters.skipped++;},
 'invalid planned count':v=>{v.report.counters.planned=7;},
 'duplicate dispatch ordinal':v=>{v.report.ledger[1].dispatchOrdinal=1;},
 'reordered dispatch ordinals':v=>{v.report.ledger[0].dispatchOrdinal=2;v.report.ledger[1].dispatchOrdinal=1;},
 'missing dispatch ordinal':v=>{delete v.report.ledger[0].dispatchOrdinal;},
 'missing required dispatch timing':v=>{delete v.report.ledger[0].deadlineOffsetMs;},
 'inconsistent observation timing':v=>{v.report.ledger[0].decisionOffsetMs=100;},
 'completed operation with no transport':v=>{v.report.ledger[0].transport='none';},
 'completed operation with skipped observation':v=>{v.report.ledger[0].observation={kind:'skipped',reason:'dependency'};},
 'missing ledger entry':v=>{v.report.ledger.pop();},
 'reordered ledger operations':v=>{[v.report.ledger[0],v.report.ledger[1]]=[v.report.ledger[1],v.report.ledger[0]];},
 'duplicated ledger operation':v=>{v.report.ledger[1]=v.report.ledger[0];},
 'missing cleanup timestamp':v=>{delete v.report.ledger[0].quiescedOffsetMs;},
 'overlapping transport intervals':v=>{v.report.ledger[0].quiescedOffsetMs=1;},
};
for(const [name,mutate] of Object.entries(ledgerMutations))test('serializer rejects '+name,async()=>{const v=clone(await collected());mutate(v);assert.throws(()=>serializeHealthComparison(v));});

for(const variant of ['invalid_phase','dispatched_skip','bytes_on_skip'] as const)test('serializer rejects skip metadata '+variant,async()=>{
 const v=clone(await collected('wrong_network')),e=v.report.ledger.find(e=>e.state==='skipped')!;
 if(variant==='invalid_phase')e.skipReason='anchor_unavailable';
 else if(variant==='dispatched_skip')e.dispatchOrdinal=3;
 else e.acceptedBytes=1;
 assert.throws(()=>serializeHealthComparison(v));
});

test('serializer rejects false completeness and false cleanup flags without changing the report',async()=>{
 const q=await quarantined();
 try{const v=clone(q.result);v.report.status='completed';assert.throws(()=>serializeHealthComparison(v));v.report.status='partial';v.report.cleanupPending=false;assert.throws(()=>serializeHealthComparison(v));
  assert.equal(JSON.parse(serializeHealthComparison(q.result)).result.report.cleanupPending,true);
 }finally{await q.finish();}
});

const errorCounters={planned:6,dispatched:1,completed:1,skipped:5,inFlight:1};
const badErrors:Record<string,Partial<typeof errorCounters>&{cleanupPending?:boolean}>={
 'false cleanup':{cleanupPending:false},'true cleanup without flight':{inFlight:0},'unsealed dispatch':{completed:0},'unaccounted plan':{skipped:4},'unknown plan':{planned:7,skipped:6},'flight without invocation':{dispatched:0,completed:0,skipped:6},'two active transports':{inFlight:2},
};
for(const [name,change] of Object.entries(badErrors))test('coordinator-error rejects '+name,()=>{
 const {cleanupPending=true,...counts}=change;const result:HealthResult={kind:'coordinator_error',code:'INTERNAL',runId:'error',counters:{...errorCounters,...counts},cleanupPending};assert.throws(()=>serializeHealthComparison(result));
});
test('valid error envelopes preserve sealed decisions separately from pending cleanup',()=>{
 for(const inFlight of [0,1])for(const code of ['INTERNAL','OUTPUT_LIMIT'] as const){const r:HealthResult={kind:'coordinator_error',code,runId:'error',counters:{...errorCounters,inFlight},cleanupPending:inFlight===1};assert.deepEqual(JSON.parse(serializeHealthComparison(r)).result,r);}
});

test('large fractional monotonic origins do not turn valid serialized offsets into failures',async()=>{
 const clock=new FakeClock();clock.time=2**40-1000.125;
 const h=startHealthComparison(comparisonRequest(),{clock,wallNow,runId:'fractional',admission:{release(){}},fetcher:automaticTransport()});
 const r=await h.result;await h.drained;assert.equal(JSON.parse(serializeHealthComparison(r)).result.report.status,'completed');
});

test('request guard rejection rolls back supplied trusted tokens without weakening guards',async()=>{
 for(const [headers,status] of [[{'content-type':'text/plain'},415],[{'content-type':'application/json',origin:'https://evil.invalid'},403],[{'content-type':'application/json','content-length':'16385'},413]] as const){
  const s=context(),token=s.pool.tryAcquire()!;
  const r=new Request('http://localhost/api/diagnose',{method:'POST',headers,body:'{}'});
  const h=startHealthComparisonHttp(r,{...s.deps,lease:token});assert.equal((await h.response).status,status);await h.drained;available(s.pool,4);assert.equal(s.redis(),0);
 }
});

test('guard rejection cannot roll back a token already claimed by a running comparison',async()=>{
 const s=context(),token=s.pool.tryAcquire()!;const deps={...s.deps,lease:token};
 const h=startHealthComparisonHttp(request(),deps);await s.clock.flush();
 const bad=new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'text/plain'},body:'{}'});
 const denied=startHealthComparisonHttp(bad,deps);assert.equal((await denied.response).status,415);await denied.drained;available(s.pool,3);
 await s.clock.advance(2250);await h.response;s.rpc.reply(0,'0x8f');await h.drained;available(s.pool,4);
});

test('fully collected claims remain completed while failed local cleanup stays pending',async()=>{
 const clock=new FakeClock(),normal=automaticTransport();let calls=0;
 const h=startHealthComparison(comparisonRequest(),{clock,wallNow,runId:'collected-pending',admission:{release(){assert.fail('undrained');}},fetcher:async(url,init)=>{
  const response=await normal(url,init);calls++;
  if(calls===6){const reader=response.body!.getReader();Object.defineProperty(response.body,'getReader',{value:()=>new Proxy(reader,{get(target,key){if(key==='releaseLock')return()=>{throw new Error('cleanup');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}})});}
  return response;
 }});
 await clock.flush();await clock.advance(250);const result=await h.result,body=JSON.parse(serializeHealthComparison(result));
 assert.equal(body.result.report.status,'completed');assert.equal(body.result.report.cleanupPending,true);assert.equal(body.result.report.counters.completed,6);await pending(h.drained,clock);
});

test('acknowledgment exactly at cleanup grace preserves quarantine termination with a drained snapshot',async()=>{
 const clock=new FakeClock();let acknowledge!:()=>void;const cleanup=new Promise<void>(resolve=>{acknowledge=resolve;});
 clock.at(clock.time+2250,acknowledge);
 const h=startHealthComparison(comparisonRequest(),{clock,wallNow,runId:'grace-edge',admission:{release(){}},fetcher:async()=>new Response(new ReadableStream({cancel(){return cleanup;}}))});
 await clock.flush();await clock.advance(2250);const result=await h.result;await h.drained;const body=JSON.parse(serializeHealthComparison(result));
 assert.equal(body.result.report.termination,'transport_quarantined');assert.equal(body.result.report.cleanupPending,false);assert.equal(body.result.report.status,'partial');
});

test('actual coordinator setup error publishes consistent sealed counters',async()=>{
 const clock=new FakeClock();const h=startHealthComparison(comparisonRequest(),{clock,wallNow(){throw new Error('timestamp');},runId:'internal',admission:{release(){}},fetcher:automaticTransport()});
 const result=await h.result;await h.drained;assert.equal(result.kind,'coordinator_error');assert.equal(JSON.parse(serializeHealthComparison(result)).result.counters.skipped,6);
});
