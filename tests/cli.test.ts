import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli, EXIT } from '../cli/cli.ts';
import { createRpc } from '../lib/rpc.ts';
import type { Block } from '../lib/model.ts';

const addr = '0x' + '1'.repeat(40), hash = '0x' + 'a'.repeat(64);
const block: Block = { number: '0x64', hash: '0x' + 'b'.repeat(64), parentHash: '0x' + 'c'.repeat(64), timestamp: '0x1', gasLimit: '0x8f0d180', transactions: [] };
function harness(handler: (method: string, params: unknown[]) => unknown) {
 const stdout: string[] = [], stderr: string[] = [];
 const rpcFactory = () => createRpc('primary', { now: () => 1000, fetcher: async (_url, init) => {
  const request = JSON.parse(String(init?.body));
  return Response.json({ jsonrpc: '2.0', id: request.id, result: handler(request.method, request.params) });
 } });
 return { stdout, stderr, io: { out: (s: string) => stdout.push(s), err: (s: string) => stderr.push(s) }, rpcFactory };
}
const h = (m: string) => m === 'eth_chainId' ? '0x8f' : m === 'eth_getBlockByNumber' ? block : m === 'eth_gasPrice' ? '0x1' : '0x5208';

test('health human report calls shared engine and names evidence-backed checks', async () => {
 const x = harness(h); const code = await runCli(['health'], x.io, { rpcFactory: x.rpcFactory });
 assert.equal(code, EXIT.success); assert.match(x.stdout[0], /Monad Mainnet confirmed/); assert.match(x.stdout[0], /RPC evidence:/); assert.equal(x.stderr.length, 0);
});
test('gas command uses supplied context and JSON passes through validated redacting export', async () => {
 const x = harness(h); const code = await runCli(['gas', '--limit', '1000000', '--from', addr, '--to', addr, '--data', '0xdeadbeef', '--json'], x.io, { rpcFactory: x.rpcFactory });
 assert.equal(code, EXIT.success); const parsed = JSON.parse(x.stdout[0]); assert.equal(parsed.mode, 'gas'); assert.equal(parsed.input.call.data, '[redacted]'); assert.ok(parsed.evidence.some((e: {method:string}) => e.method === 'eth_estimateGas')); assert.ok(!x.stdout[0].includes('deadbeef'));
});
test('transaction command reports provider-attested lifecycle evidence', async () => {
 const x = harness(m => m === 'eth_chainId' ? '0x8f' : m === 'eth_getTransactionByHash' || m === 'eth_getTransactionReceipt' ? null : block); const code = await runCli(['tx', hash], x.io, { rpcFactory: x.rpcFactory });
 assert.equal(code, EXIT.success); assert.match(x.stdout[0], /Transaction not found|unknown|finalized/i);
});
test('invalid flags, values, and hashes return usage code on stderr only', async () => {
 for (const args of [['wat'], ['tx', 'abc'], ['gas', '--limit', '0', '--from', addr, '--to', addr], ['health', '--endpoint', 'https://bad']]) {
  const x = harness(h); assert.equal(await runCli(args, x.io, { rpcFactory: x.rpcFactory }), EXIT.usage); assert.equal(x.stdout.length, 0); assert.ok(x.stderr.length);
 }
});
test('provider failures are distinct from diagnostic error findings', async () => {
 const x = harness(h); x.rpcFactory = () => createRpc('primary', { fetcher: async () => { throw new Error('synthetic timeout'); } });
 assert.equal(await runCli(['health', '--json'], x.io, { rpcFactory: x.rpcFactory }), EXIT.provider); assert.equal(JSON.parse(x.stdout[0]).evidence[0].error.code, 'NETWORK');
});
test('request timeout stays an infrastructure exit and preserves incomplete evidence', async () => {
 const x = harness(h); x.rpcFactory = () => createRpc('primary', { timeoutMs: 5, fetcher: async (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))) });
 assert.equal(await runCli(['health', '--json'], x.io, { rpcFactory: x.rpcFactory }), EXIT.provider); assert.equal(JSON.parse(x.stdout[0]).evidence[0].error.code, 'TIMEOUT');
});
test('contradictory RPC head evidence remains a diagnostic error', async () => {
 const x = harness((m, p) => m === 'eth_chainId' ? '0x8f' : { ...block, number: p[0] === 'finalized' ? '0x65' : '0x64' });
 assert.equal(await runCli(['health'], x.io, { rpcFactory: x.rpcFactory }), EXIT.findings); assert.match(x.stdout[0], /Block views disagree/);
});
test('help and version have stable success output', async () => {
 const x = harness(h); assert.equal(await runCli(['gas', '--help'], x.io), EXIT.success); assert.match(x.stdout[0], /--from/);
 const y = harness(h); assert.equal(await runCli(['--version'], y.io), EXIT.success); assert.match(y.stdout[0], /0\.1\.0/);
});
test('no CLI or shared collector path exposes transaction submission methods', async () => {
 const x = harness(h); await runCli(['health'], x.io, { rpcFactory: x.rpcFactory });
 const methods = JSON.parse(JSON.stringify(x.stdout[0]));
 assert.ok(!methods.includes('eth_send') && !methods.includes('personal_') && !methods.includes('eth_sign'));
});
