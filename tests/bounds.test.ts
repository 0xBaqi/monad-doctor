import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpc, readBounded } from '../lib/rpc.ts';
import { quantity } from '../lib/validation.ts';
import { handleDiagnostic } from '../lib/http.ts';
test('a stalled body is cancelled within its deadline',async()=>{
 let cancelled=false;
 const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
 await assert.rejects(readBounded(body,100,10),/timed out/);
 assert.equal(cancelled,true);
});
test('collector stops after ten calls',async()=>{
 let calls=0;
 const rpc=createRpc('primary',{fetcher:async(_u,init)=>{calls++; const req=JSON.parse(String(init?.body));return Response.json({jsonrpc:'2.0',id:req.id,result:'0x8f'});}});
 for(let i=0;i<10;i++) await rpc.call('eth_chainId',[],quantity);
 const r=await rpc.call('eth_chainId',[],quantity);
 assert.equal(calls,10); assert.equal(r.ok,false);if(!r.ok)assert.equal(r.error.code,'BUDGET');
});
test('HTTP content type is an exact media type',async()=>{
 const r=await handleDiagnostic(new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'evilapplication/json'},body:'{}'}));
 assert.equal(r.status,415);
});


test('same-origin guard uses the browser-facing Host when Next normalizes the URL',async()=>{
 const request=(origin:string, extra:Record<string,string>={})=>new Request('http://localhost:3143/api/diagnose',{method:'POST',headers:{'content-type':'application/json',host:'127.0.0.1:3143',origin,...extra},body:'{}'});
 assert.equal((await handleDiagnostic(request('http://127.0.0.1:3143'))).status,400); // input validation reached, no RPC
 assert.equal((await handleDiagnostic(request('https://evil.example',{'x-forwarded-host':'evil.example'}))).status,403);
 assert.equal((await handleDiagnostic(request('null'))).status,403);
});
