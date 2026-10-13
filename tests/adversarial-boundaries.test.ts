import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli, EXIT } from '../cli/cli.ts';
import { diagnose } from '../lib/engine.ts';
import { exportReport } from '../lib/export.ts';
import { handleDiagnostic } from '../lib/http.ts';
import { BodyTimeoutError } from '../lib/rpc.ts';
import type { Input, Report } from '../lib/model.ts';
import { fixtures, mockFetch, mockRpc, NOW } from './fixtures/adversarial.ts';

function argumentsFor(input: Input) {
 const args = input.mode === 'transaction' ? ['tx', input.hash!] : input.mode === 'gas'
  ? ['gas', '--limit', input.gasLimit!, '--from', input.call!.from, '--to', input.call!.to, '--data', input.call!.data, '--value', input.call!.value]
  : ['health'];
 return [...args, '--provider', input.provider];
}

let sequence = 0;
for (const fixture of fixtures) test(`web/CLI production boundaries: ${fixture.id}`, async () => {
 const originalFetch = globalThis.fetch, originalNow = Date.now;
 const env: Record<string, string | undefined> = process.env;
 const envKeys = ['NODE_ENV', 'VERCEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
 const saved = envKeys.map(key => [key, env[key]] as const);
 try {
  // Use the existing local admission path. No Redis or Monad network is contacted.
  for (const key of envKeys) delete env[key];
  env.NODE_ENV = 'test';
  for (const sample of fixture.samples) {
   // Advance a minute for each independent report to preserve the real HTTP quota.
   const observedAt = NOW + ++sequence * 60_001;
   Date.now = () => observedAt;
   const input = { ...fixture.input, provider: sample.provider };
   const fetcher = mockFetch(sample);
   globalThis.fetch = sample.fault?.kind === 'timeout'
    // Abort deterministically without waiting for the production five-second timeout.
    ? async () => { throw new BodyTimeoutError('synthetic response deadline'); }
    : fetcher;
   // Timeout only at the specified method; earlier/later evidence still completes.
   const webFetch = globalThis.fetch;
   if (sample.fault?.kind === 'timeout') globalThis.fetch = async (url, init) => {
    const method = JSON.parse(String(init?.body)).method;
    return method === sample.fault!.method ? webFetch(url, init) : fetcher(url, init);
   };
   const response = await handleDiagnostic(new Request('http://localhost/api/diagnose', {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(input),
   }));
   assert.equal(response.status, 200);
   assert.equal(response.headers.get('cache-control'), 'no-store');
   const web: Report = await response.json();
   const engine = await diagnose(input, { rpc: mockRpc(sample, Date.now), now: Date.now });
   assert.deepEqual(web, engine);
   const stdout: string[] = [], stderr: string[] = [];
   const code = await runCli([...argumentsFor(input), '--json'], { out: text => stdout.push(text), err: text => stderr.push(text) }, { rpcFactory: provider => {
    assert.equal(provider, sample.provider);
    return mockRpc(sample, Date.now);
   } });
   assert.deepEqual(stderr, []);
   assert.equal(stdout.length, 1);
   assert.deepEqual(JSON.parse(stdout[0]), exportReport(web));
   const expected = engine.evidence.some(e => e.error) ? EXIT.provider : engine.findings.some(f => f.severity === 'error') ? EXIT.findings : EXIT.success;
   assert.equal(code, expected);
   assert.ok(web.evidence.length <= 5);
  }
 } finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  for (const [key, value] of saved) { if (value === undefined) delete env[key]; else env[key] = value; }
 }
});
