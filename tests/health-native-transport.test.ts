import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { startHealthComparison } from '../lib/health-coordinator.ts';
import { serializeHealthComparison } from '../lib/health-comparison-response.ts';
import { FakeClock, comparisonRequest, deferred, wallNow } from './fixtures/health-coordinator.ts';

// Real Node fetch, but exclusively loopback. Barriers drive cancellation; no sleeps.
for (const stage of ['headers','body'] as const) test('native loopback fetch acknowledges local cancellation during '+stage,{timeout:15000},async()=>{
 const arrived=deferred<void>(),reading=deferred<void>();
 const server=createServer((_request,response)=>{
  if(stage==='body'){response.writeHead(200,{'Content-Type':'application/json'});response.write('{"jsonrpc":');}
  arrived.resolve();
 });
 const sockets=new Set<import('node:net').Socket>();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert.ok(address&&typeof address==='object');const url='http://127.0.0.1:'+address.port;
 let calls=0,released=0;
 try {
  const clock=new FakeClock();
  const h=startHealthComparison(comparisonRequest(),{clock,wallNow,runId:'native-'+stage,admission:{release(){released++;}},fetcher:async(destination,init)=>{
   assert.ok(['https://rpc.monad.xyz','https://rpc1.monad.xyz'].includes(String(destination)));assert.equal(init?.redirect,'error');calls++;
   const response=await fetch(url,init);
   if(stage==='body'){
    const original=response.body!.getReader.bind(response.body);Object.defineProperty(response.body,'getReader',{value:()=>{
     const reader=original();let reads=0;
     return new Proxy(reader,{get(t,key){if(key==='read')return()=>{if(++reads===2)reading.resolve();return t.read();};const v=Reflect.get(t,key,t);return typeof v==='function'?v.bind(t):v;}});
    }});
   }
   return response;
  }});
  await arrived.promise;if(stage==='body')await reading.promise;
  h.cancel();h.cancel();const result=await h.result;await h.drained;
  assert.equal(calls,1);assert.equal(released,1);assert.equal(result.kind,'comparison');
  if(result.kind==='comparison'){assert.equal(result.report.status,'cancelled');assert.equal(result.report.cleanupPending,false);assert.equal(result.report.counters.inFlight,0);serializeHealthComparison(result);}
 }finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
