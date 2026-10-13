import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../lib/engine.ts';
import { exportReport } from '../lib/export.ts';
import { evidenceReferences, guidedSummary, inputErrors, isContradiction, orderedFindings, responseError, retryAfterMs, snapshotIsStale, symptoms } from '../lib/presentation.ts';
import type { Finding } from '../lib/model.ts';
import { fixtures, mockRpc, NOW, GAS, HEALTH, TRANSACTION } from './fixtures/adversarial.ts';

for (const fixture of fixtures) test(`guided presentation: ${fixture.id}`, async () => {
 for (const sample of fixture.samples) {
  const report = await diagnose({ ...fixture.input, provider: sample.provider }, { rpc: mockRpc(sample), now: () => NOW });
  const before = structuredClone(report);
  const summary = guidedSummary(report);
  assert.equal(summary.ordered.length, report.findings.length);
  assert.deepEqual(new Set(summary.ordered), new Set(report.findings));
  assert.ok(summary.primary && report.findings.includes(summary.primary));
  if (report.findings.some(f => f.severity === 'error')) assert.equal(summary.primary.severity, 'error');
  for (const f of summary.unknown) assert.equal(f.basis, 'unknown');
  for (const slot of summary.outcomes) if (slot.finding) {
   assert.ok(report.findings.includes(slot.finding));
   assert.deepEqual(evidenceReferences(report, slot.finding), slot.finding.evidence);
  }
  if (report.mode === 'transaction') {
   assert.deepEqual(summary.outcomes.map(o => o.label), ['Inclusion', 'Execution', 'Provider-attested finality']);
   if (report.findings.some(f => f.id === 'tx.inconsistent')) for (const o of summary.outcomes) assert.equal(o.finding?.id, 'tx.inconsistent');
   if (report.findings.some(f => f.id === 'tx.execution')) assert.equal(summary.outcomes[1].finding?.id, 'tx.execution');
   if (report.findings.some(f => f.id === 'tx.finality-unknown')) assert.equal(summary.outcomes[2].finding?.id, 'tx.finality-unknown');
  }
  if (report.mode === 'gas') assert.match(summary.outcomes[2].label, /Conditional.*not an actual fee/);
  assert.equal(snapshotIsStale(report.input, report), false);
  assert.equal(snapshotIsStale({ ...report.input, provider: sample.provider === 'primary' ? 'secondary' : 'primary' }, report), true);
  assert.deepEqual(report, before);
  assert.equal(exportReport(report).ruleVersion, 'm3.1');
 }
});

test('guided summary: unknown rule IDs retain original findings without a manufactured outcome', async () => {
 const report = await diagnose(TRANSACTION, { rpc: mockRpc({ provider: 'primary', expected: [], forbidden: [] }), now: () => NOW });
 const future: Finding = { id: 'future.rule', severity: 'error', basis: 'unknown', title: 'Future unknown result', detail: 'Unavailable evidence.', nextStep: 'Inspect recorded evidence.', evidence: [], sources: [] };
 report.findings = [future];
 const summary = guidedSummary(report);
 assert.equal(summary.primary, future);
 assert.deepEqual(summary.unknown, [future]);
 assert.ok(summary.outcomes.every(o => !o.finding));
 assert.equal(isContradiction(future), false);
});
test('contradiction labels require an explicit conflict ID, severity and unknown basis', () => {
 const f: Finding = { id: 'tx.finality-unknown', severity: 'warning', basis: 'unknown', title: '', detail: '', nextStep: '', evidence: [], sources: [] };
 assert.equal(isContradiction(f), false);
 assert.equal(isContradiction({ ...f, severity: 'error' }), true);
 assert.equal(isContradiction({ ...f, id: 'rpc.heads', severity: 'pass', basis: 'observed' }), false);
});
test('sorting is stable and preserves every finding, with ordinary network pass last in a tie', () => {
 const f: Finding = { id: 'network.mainnet', severity: 'pass', basis: 'observed', title: '', detail: '', nextStep: '', evidence: [], sources: [] };
 const all = [f, { ...f, id: 'tx.execution' }, { ...f, id: 'tx.finalized' }, { ...f, id: 'tx.inconsistent', severity: 'error' as const }];
 assert.deepEqual(orderedFindings(all).map(x => x.id), ['tx.inconsistent', 'tx.execution', 'tx.finalized', 'network.mainnet']);
 assert.equal(all[0], f);
});
test('snapshot matching normalizes hex case but tracks all gas context and mode changes', async () => {
 const report = await diagnose(GAS, { rpc: mockRpc({ provider: 'primary', expected: [], forbidden: [] }), now: () => NOW });
 assert.equal(snapshotIsStale({ ...GAS, call: { ...GAS.call!, data: '0xDEADBEEF' } }, report), false);
 for (const field of ['from', 'to', 'data', 'value'] as const) {
  const changed = field === 'value' ? '1' : field === 'data' ? '0x' : '0x' + '2'.repeat(40);
  assert.equal(snapshotIsStale({ ...GAS, call: { ...GAS.call!, [field]: changed } }, report), true);
 }
 assert.equal(snapshotIsStale({ ...GAS, gasLimit: '999999' }, report), true);
 assert.equal(snapshotIsStale(HEALTH, report), true);
 assert.equal(snapshotIsStale({ ...GAS, gasLimit: '' }, report), true);
});
test('evidence navigation never creates a reference missing from the report', async () => {
 const report = await diagnose(HEALTH, { rpc: mockRpc({ provider: 'primary', expected: [], forbidden: [] }), now: () => NOW });
 assert.deepEqual(evidenceReferences(report, { ...report.findings[0], evidence: [1, 999] }), [1]);
});
test('inline validation uses the existing validators for every gas field and hash', () => {
 assert.deepEqual(inputErrors(GAS), {});
 assert.deepEqual(inputErrors(HEALTH), {});
 assert.ok(inputErrors({ mode: 'transaction', provider: 'primary', hash: '0x' }).hash);
 const errors = inputErrors({ ...GAS, gasLimit: '0', call: { from: '', to: '', value: '-1', data: '0x1' } });
 assert.deepEqual(Object.keys(errors), ['from', 'to', 'gasLimit', 'value', 'data']);
});
test('Retry-After respects seconds and HTTP dates without polling', () => {
 assert.equal(retryAfterMs('3', NOW), 3000);
 assert.equal(retryAfterMs(new Date(NOW + 5000).toUTCString(), NOW), 5000);
 for (const value of [null, 'garbage', '-1', '0']) assert.equal(retryAfterMs(value, NOW), 0);
 assert.equal(retryAfterMs('99999999999999', NOW), 2147483647);
});
test('HTTP error copy separates access, quotas, admission and transport failures', () => {
 assert.match(responseError(401), /Access denied/);
 assert.match(responseError(403), /Access denied/);
 assert.match(responseError(429), /no automatic retry/i);
 assert.match(responseError(503), /admission/);
 assert.match(responseError(500), /usable report/);
});
test('symptom selection is a static mapping to the three existing modes', () => {
 assert.deepEqual(symptoms.map(s => s.mode), ['transaction', 'gas', 'health']);
 assert.ok(symptoms.every(s => Object.keys(s).sort().join(',') === 'label,mode'));
});
