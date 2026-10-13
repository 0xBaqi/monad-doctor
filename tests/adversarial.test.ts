import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../lib/engine.ts';
import { exportReport } from '../lib/export.ts';
import { fixtures, mockRpc, NOW, SENTINEL, TRANSACTION } from './fixtures/adversarial.ts';

for (const fixture of fixtures) test(`adversarial: ${fixture.id}`, async () => {
 assert.ok(fixture.uncertainty && fixture.mustNotClaim && fixture.provenance);
 const reports = [];
 for (const sample of fixture.samples) {
  const input = { ...fixture.input, provider: sample.provider };
  const rpc = mockRpc(sample);
  const report = await diagnose(input, { rpc, now: () => NOW });
  for (const expected of sample.expected) {
   const finding = report.findings.find(f => f.id === expected.id);
   assert.ok(finding, `${fixture.id}/${sample.provider}: missing ${expected.id}`);
   if (expected.basis) assert.equal(finding.basis, expected.basis);
   if (expected.severity) assert.equal(finding.severity, expected.severity);
   if (expected.detail) assert.match(finding.detail, expected.detail);
  }
  for (const id of sample.forbidden) assert.ok(!report.findings.some(f => f.id === id), `${fixture.id}: unsupported ${id}`);
  assert.ok(!report.findings.some(f => /^(Transaction reverted|Confirmed revert|Out.of.gas confirmed|Independently verified finality|Consensus verified|Guaranteed)/i.test(f.title)));
  assert.ok(!JSON.stringify(report).includes(SENTINEL));
  assert.equal(report.provider, sample.provider);
  assert.deepEqual(report.input, input);
  assert.ok(report.evidence.length <= 5);
  assert.deepEqual(report.evidence.map(e => e.id), report.evidence.map((_e, i) => i + 1));
  for (const finding of report.findings) {
   for (const id of finding.evidence) assert.ok(report.evidence.some(e => e.id === id));
   if (!finding.id.startsWith('gas.protocol-cap')) assert.ok(finding.evidence.length > 0);
  }
  if (report.findings.some(f => f.id === 'network.wrong-chain')) assert.equal(report.evidence.length, 1);
  for (const finding of report.findings.filter(f => f.id === 'tx.finalized')) assert.match(finding.detail, /selected RPC.*not an independently verified consensus proof/);
  const shared = exportReport(report);
  assert.equal(shared.provider, sample.provider);
  assert.equal(shared.ruleVersion, report.ruleVersion);
  assert.deepEqual(shared.findings.map(({ id, severity, basis, title, detail, nextStep, evidence, sources }) => ({ id, severity, basis, title, detail, nextStep, evidence, sources })), report.findings);
  assert.deepEqual(shared.evidence.map(e => [e.id, e.method, e.observedAt, e.durationMs, 'result' in e ? e.result : e.error.code]), report.evidence.map(e => [e.id, e.method, e.observedAt, e.durationMs, e.error ? e.error.code : e.result]));
  for (const entry of shared.evidence) {
   const original = report.evidence.find(e => e.id === entry.id)!;
   const params = original.method === 'eth_estimateGas'
    ? [{ ...(original.params[0] as object), data: '[redacted]' }, original.params[1]] : original.params;
   assert.deepEqual(entry.params, params);
   if ('error' in entry && entry.error) {
    assert.equal(entry.error.rpcCode, original.error?.rpcCode);
    assert.equal(entry.error.httpStatus, original.error?.httpStatus);
   }
  }
  assert.ok(!JSON.stringify(shared).includes('deadbeef'));
  const repeated = exportReport(report);
  assert.deepEqual(repeated, shared); // exporting never mutates provenance/results
  reports.push(report);
 }
 if (fixture.id === 'provider-recovery') {
  assert.ok(reports[0].evidence.some(e => e.error));
  assert.ok(reports[1].evidence.every(e => !e.error));
  assert.ok(reports[0].findings.some(f => f.id === 'tx.outcome-unknown'));
 }
 if (fixture.id === 'conflicting-provider-block-hashes') assert.notEqual(reports[0].evidence[2].result && (reports[0].evidence[2].result as { blockHash: string }).blockHash, (reports[1].evidence[2].result as { blockHash: string }).blockHash);
});

test('adversarial: mismatched collector identity cannot misattribute evidence', async () => {
 const rpc = mockRpc({ provider: 'secondary', expected: [], forbidden: [] });
 await assert.rejects(diagnose(TRANSACTION, { rpc, now: () => NOW }), /provider/i);
 assert.equal(rpc.evidence.length, 0);
});
