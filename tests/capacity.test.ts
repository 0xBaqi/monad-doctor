import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiagnostic } from '../lib/http.ts';
// Synthetic requests with invalid inputs; never reach a network RPC.
const headers={'content-type':'application/json'};
test('four active body readers bound concurrency and release capacity',async()=>{
 const streams:ReadableStreamDefaultController<Uint8Array>[]=[];
 const pending=Array.from({length:4},()=>handleDiagnostic(new Request('http://localhost/api/diagnose',{method:'POST',headers,body:new ReadableStream<Uint8Array>({start(c){streams.push(c);}}),duplex:'half'} as RequestInit)));
 const rejected=await handleDiagnostic(new Request('http://localhost/api/diagnose',{method:'POST',headers,body:'{}'}));
 assert.equal(rejected.status,429);
 for(const c of streams){c.enqueue(new TextEncoder().encode('{}'));c.close();}
 assert.deepEqual((await Promise.all(pending)).map(r=>r.status),[400,400,400,400]);
});
test('per-process minute budget stops request thirty-one without RPC work',async()=>{
 // Four requests were consumed by the preceding test in this isolated test file.
 for(let i=0;i<26;i++) assert.equal((await handleDiagnostic(new Request('http://localhost/api/diagnose',{method:'POST',headers,body:'{}'}))).status,400);
 assert.equal((await handleDiagnostic(new Request('http://localhost/api/diagnose',{method:'POST',headers,body:'{}'}))).status,429);
});
