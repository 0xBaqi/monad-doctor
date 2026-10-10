import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../lib/engine.ts';
import { gasRules, lifecycleRules } from '../lib/rules.ts';
import { parseInput, parseBlock, quantity, parseReceipt, parseTransaction } from '../lib/validation.ts';
import { createRpc, readBounded, type Method } from '../lib/rpc.ts';
import { handleDiagnostic } from '../lib/http.ts';
import type { Block, Receipt, Transaction } from '../lib/model.ts';

// All values in this file are explicitly SYNTHETIC. No live RPC is used.
const hash = '0x' + 'a'.repeat(64), blockHash = '0x' + 'b'.repeat(64), address = '0x' + '1'.repeat(40);
const block: Block = { number: '0x64', hash: blockHash, parentHash: '0x' + 'c'.repeat(64), timestamp: '0x1', gasLimit: '0x8f0d180', transactions: [hash] };
const tx: Transaction = { hash, blockHash, blockNumber: '0x64', gas: '0x5208', from: address, to: address };
const receipt: Receipt = { transactionHash: hash, blockHash, blockNumber: '0x64', status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x174876e800' };
const gasInput = { mode: 'gas', provider: 'primary', gasLimit: '1000000', call: { from: address, to: address, data: '0x', value: '0' } };
function fake(handler: (method: string, params: unknown[]) => unknown) {
 return createRpc('primary', { now: () => 1000, fetcher: async (_url, init) => {
  const req = JSON.parse(String(init?.body));
  return Response.json({ jsonrpc: '2.0', id: req.id, result: handler(req.method, req.params) });
 } });
}
test('input validation rejects private fields, URL injection, odd calldata and numeric coercion', () => {
 for (const x of [{mode:'health',provider:'http://localhost'}, {...gasInput, privateKey: 'secret'}, {...gasInput, gasLimit: 21000}, {...gasInput, call: {...gasInput.call, data:'0x1'}}, {...gasInput, gasLimit:'-1'}, {...gasInput, gasLimit:'1e6'}, {...gasInput, gasLimit:'0'}]) assert.throws(() => parseInput(x));
 assert.equal(parseInput(gasInput).gasLimit, '1000000');
});
test('quantities reject malformed or oversized RPC data', () => {
 for (const x of ['0x', '0x00', '0x-1', '143', '0x' + 'f'.repeat(65), 143]) assert.throws(() => quantity(x));
 assert.equal(quantity('0x8F'), '0x8f');
 assert.throws(() => parseBlock({...block, transactions: [123]}));
 assert.throws(() => parseReceipt({...receipt, status: '0x2'}));
 assert.throws(() => parseTransaction({...tx, blockNumber: null}));
});
test('wrong chain stops all dependent calls', async () => {
 const rpc = fake(() => '0x1');
 const r = await diagnose({mode:'health',provider:'primary'}, {rpc});
 assert.equal(r.evidence.length, 1);
 assert.equal(r.findings[0].id, 'network.wrong-chain');
});
test('RPC health keeps partial evidence', async () => {
 const rpc = fake((method, params) => method === 'eth_chainId' ? '0x8f' : params[0] === 'finalized' ? null : block);
 const r = await diagnose({mode:'health',provider:'primary'}, {rpc, now:() => 1000});
 assert.ok(r.findings.some(f => f.id === 'rpc.latest'));
 assert.ok(r.findings.some(f => f.id === 'rpc.finalized-null'));
});
test('health detects inconsistent head views', async () => {
 const r = await diagnose({mode:'health',provider:'primary'}, {rpc:fake((m,p) => m === 'eth_chainId' ? '0x8f' : {...block, number:p[0] === 'finalized' ? '0x65' : '0x64'}), now:()=>1000});
 assert.equal(r.findings.find(f=>f.id==='rpc.heads')?.severity,'error');
});
test('gas boundary and padding math uses bigint', () => {
 assert.equal(gasRules(30000000n,21000n,1n,[])[0].severity,'pass');
 assert.equal(gasRules(30000001n,21000n,1n,[])[0].severity,'error');
 assert.equal(gasRules(20999n,21000n,undefined,[])[1].severity,'error');
 const r=gasRules(1000000n,21000n,100000000000n,[]);
 assert.match(r[2].detail,/0.1 MON/);
 assert.match(r[2].detail,/0.0021 MON/);
 assert.equal(r[1].basis,'inferred');
});
test('before/after reproduces Monad padding issue without sending a transaction', async () => {
 const handler = (m:string) => m === 'eth_chainId' ? '0x8f' : m === 'eth_getBlockByNumber' ? block : m === 'eth_gasPrice' ? '0x174876e800' : '0x5208';
 const before=await diagnose(gasInput,{rpc:fake(handler)});
 const after=await diagnose({...gasInput,gasLimit:'21000'},{rpc:fake(handler)});
 assert.equal(before.findings.find(f=>f.id==='gas.estimate-comparison')?.severity,'warning');
 assert.equal(after.findings.find(f=>f.id==='gas.estimate-comparison')?.severity,'pass');
 const estimate=before.evidence.find(e=>e.method==='eth_estimateGas')!;
 assert.equal(estimate.params[1],block.number);
 assert.equal((estimate.params[0] as Record<string,unknown>).value,'0x0');
 assert.ok(before.evidence.every(e=>!e.method.startsWith('eth_send')));
});
test('failed estimate never invents a fallback', async () => {
 const r=await diagnose(gasInput,{rpc:fake(m=>m==='eth_chainId'?'0x8f':m==='eth_getBlockByNumber'?block:m==='eth_gasPrice'?'0x1':'garbage')});
 assert.ok(r.findings.some(f=>f.id==='gas.estimate-unknown'));
 assert.ok(!r.findings.some(f=>f.id==='gas.cost-comparison'));
});
test('null lookups are unknown, never diagnosed dropped or failed', () => {
 const r=lifecycleRules(hash,null,null,block,undefined,[]);
 assert.equal(r[0].id,'tx.outcome-unknown'); assert.equal(r[0].basis,'unknown');
});
test('successful receipt above finalized height is provisional', () => {
 const r=lifecycleRules(hash,tx,receipt,{...block,number:'0x63'},block,[]);
 assert.ok(r.some(f=>f.id==='tx.provisional')); assert.ok(!r.some(f=>f.id==='tx.finalized'));
});
test('finality requires matching hash and membership', () => {
 assert.ok(lifecycleRules(hash,tx,receipt,block,block,[]).some(f=>f.id==='tx.finalized'));
 for (const canonical of [{...block,hash:'0x'+'d'.repeat(64)},{...block,transactions:[]}]) {
  const r=lifecycleRules(hash,tx,receipt,block,canonical,[]);
  assert.equal(r[0].id,'tx.inconsistent'); assert.ok(!r.some(f=>f.id==='tx.finalized'));
 }
});
test('missing finalized or canonical evidence never implies finality', () => {
 for (const [f,c] of [[undefined,block],[block,undefined]] as const) assert.ok(lifecycleRules(hash,tx,receipt,f,c,[]).some(x=>x.id==='tx.finality-unknown'));
});
test('execution failure can be finalized without inventing failure cause', () => {
 const r=lifecycleRules(hash,tx,{...receipt,status:'0x0'},block,block,[]);
 assert.equal(r[0].severity,'error'); assert.ok(r.some(f=>f.id==='tx.finalized'));
 assert.match(r[0].detail,/cause is not determined/);
});
test('transaction and receipt disagreement suppresses outcome claims', () => {
 assert.equal(lifecycleRules(hash,{...tx,blockNumber:'0x63'},receipt,block,block,[])[0].id,'tx.inconsistent');
});
test('transaction orchestration validates finality end to end', async () => {
 const r=await diagnose({mode:'transaction',provider:'primary',hash},{rpc:fake(m=>m==='eth_chainId'?'0x8f':m==='eth_getTransactionByHash'?tx:m==='eth_getTransactionReceipt'?receipt:block)});
 assert.ok(r.findings.some(f=>f.id==='tx.finalized'));
 assert.ok(r.findings.every(f=>f.sources.every(s=>s.startsWith('https://docs.monad.xyz/'))));
});
test('RPC rejects mismatched ID, invalid envelopes, invalid JSON and shapes', async () => {
 for (const body of ['{', JSON.stringify({jsonrpc:'2.0',id:99,result:'0x8f'}), JSON.stringify({jsonrpc:'2.0',id:1,result:'0x8f',error:{code:1,message:'x'}}), JSON.stringify({jsonrpc:'2.0',id:1,result:143})]) {
  const rpc=createRpc('primary',{fetcher:async()=>new Response(body)});
  const r=await rpc.call('eth_chainId',[],quantity);
  assert.equal(r.ok,false); if (!r.ok) assert.equal(r.error.code,'MALFORMED');
 }
});
test('RPC maps outages and rate limits without leaking response bodies', async () => {
 for (const status of [429,503]) {
  const rpc=createRpc('primary',{fetcher:async()=>new Response('secret-token',{status})});
  const r=await rpc.call('eth_chainId',[],quantity);
  assert.equal(r.ok,false); assert.ok(!JSON.stringify(rpc.evidence).includes('secret-token'));
 }
 const rpc=createRpc('primary',{fetcher:async()=>{throw new Error('https://secret-url');}});
 const r=await rpc.call('eth_chainId',[],quantity);
 assert.equal(r.ok,false); assert.ok(!JSON.stringify(rpc.evidence).includes('secret-url'));
});
test('provider error messages/data and extra fields cannot enter exports', async () => {
 const rpc=createRpc('primary',{fetcher:async()=>Response.json({jsonrpc:'2.0',id:1,error:{code:-32603,message:'Bearer secret',data:'secret'}})});
 await rpc.call('eth_chainId',[],quantity);
 assert.ok(!JSON.stringify(rpc.evidence).includes('secret'));
 assert.ok(!JSON.stringify(parseReceipt({...receipt,apiKey:'secret'})).includes('secret'));
});
test('request timeout aborts fetch and produces incomplete evidence', async () => {
 const rpc=createRpc('primary',{timeoutMs:10,fetcher:async(_u,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(new Error('aborted'))))});
 const r=await rpc.call('eth_chainId',[],quantity);
 assert.equal(r.ok,false); if(!r.ok) assert.equal(r.error.code,'TIMEOUT');
});
test('response size and request budgets are bounded', async () => {
 const rpc=createRpc('primary',{maxBytes:10,fetcher:async()=>new Response('x'.repeat(20))});
 const r=await rpc.call('eth_chainId',[],quantity);
 assert.equal(r.ok,false); if(!r.ok) assert.equal(r.error.code,'TOO_LARGE');
 const bounded=createRpc('primary',{budgetMs:0,fetcher:async()=>{throw new Error('must not fetch');}});
 const b=await bounded.call('eth_chainId',[],quantity); assert.equal(b.ok,false);
 await assert.rejects(readBounded(new Response('12345').body,4));
});
test('server-controlled allowlists reject arbitrary endpoint and financial methods', async () => {
 assert.throws(()=>createRpc('http://localhost' as 'primary'));
 await assert.rejects(createRpc('primary').call('eth_sendRawTransaction' as Method,[],quantity));
});
test('HTTP boundary rejects malformed requests before any RPC calls', async () => {
 const req=(body:string,headers:Record<string,string>={})=>new Request('http://localhost/api/diagnose',{method:'POST',headers:{'content-type':'application/json',...headers},body});
 assert.equal((await handleDiagnostic(req('{'))).status,400);
 assert.equal((await handleDiagnostic(req('{}',{'origin':'https://evil.example'}))).status,403);
 assert.equal((await handleDiagnostic(req('{}',{'content-type':'text/plain'}))).status,415);
 assert.equal((await handleDiagnostic(req(' '.repeat(17000)))).status,413);
 assert.equal((await handleDiagnostic(req('{"mode":"health","provider":"https://localhost"}'))).status,400);
});
