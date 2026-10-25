// Local acceptance only. Engine reports use deterministic RPC mocks; no live RPC.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { diagnose } from '../lib/engine.ts';
import { exportReport } from '../lib/export.ts';
import { comparisonFixture } from '../tests/fixtures/health-comparison.ts';
import { fixtures, mockRpc, NOW } from '../tests/fixtures/adversarial.ts';

const base = process.env.MONAD_DOCTOR_URL ?? 'http://127.0.0.1:3143';
if (new URL(base).hostname !== '127.0.0.1') throw new Error('Acceptance must run against a local server.');
const output = process.env.MONAD_DOCTOR_QA_DIR ?? '.qa/guided';
const mobileWidth = Number(process.env.MONAD_DOCTOR_MOBILE_WIDTH ?? 390);
if (!Number.isInteger(mobileWidth) || mobileWidth < 320 || mobileWidth > 600) throw new Error('Mobile viewport must be an integer from 320 to 600 pixels.');
await mkdir(output, { recursive: true });
const reports = {};
for (const fixture of fixtures) {
 const sample = fixture.samples[0];
 reports[fixture.id] = await diagnose({ ...fixture.input, provider: sample.provider }, { rpc: mockRpc(sample), now: () => NOW });
}
const comparison = await comparisonFixture();
const browser = await chromium.launch({ executablePath: process.env.MONAD_DOCTOR_CHROMIUM, headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [], checks = [], requests = [];
page.on('pageerror', e => errors.push(e.message));
let scenario = 'unknown-on-all-providers', status = 200, headers = {}, body = null, delayed = false, networkFailure = false;
await page.route('**/api/diagnose', async route => {
 const request = route.request(); requests.push(request.postDataJSON());
 if (networkFailure) { await route.abort('failed'); return; }
 if (delayed) await new Promise(resolve => setTimeout(resolve, 300));
 const isComparison = request.headers()['x-monad-doctor-operation'] === 'health-comparison-v1';
 await route.fulfill({ status, headers, contentType: body === '<html>Access denied</html>' ? 'text/html' : 'application/json', body: body ?? (isComparison ? comparison.text : JSON.stringify(reports[scenario])) });
});
const record = name => { checks.push({ name, passed: true }); console.log('PASS: ' + name); };
const result = page.getByRole('region', { name: 'Diagnostic results' });
async function select(mode) {
 const count = requests.length;
 const label = { transaction: "My transaction isn't showing up.", gas: 'My gas limit or fee looks wrong.', health: 'My RPC results look unexpected.' }[mode];
 await page.getByRole('button', { name: label, exact: true }).click();
 const input = reports[scenario].input;
 await page.getByLabel('RPC provider').selectOption(input.provider);
 if (mode === 'transaction') await page.locator('#hash').fill(input.hash);
 if (mode === 'gas') for (const field of ['from', 'to', 'value', 'data', 'gasLimit']) await page.locator('#' + field).fill(field === 'gasLimit' ? input.gasLimit : input.call[field]);
 assert.equal(requests.length, count);
}
async function run() {
 const count = requests.length;
 const diagnostic = request => request.url() === base + '/api/diagnose' && request.method() === 'POST';
 // Register before the click: an idle old report is not evidence of completion.
 const requested = page.waitForRequest(diagnostic);
 const completed = networkFailure
  ? page.waitForEvent('requestfailed', { predicate: diagnostic })
  : page.waitForResponse(response => diagnostic(response.request()));
 await page.getByRole('button', { name: 'Run diagnostic' }).click();
 const request = await requested;
 const responseOrFailure = await completed;
 if (networkFailure) assert.equal(responseOrFailure, request);
 else {
  assert.equal(responseOrFailure.request(), request);
  await responseOrFailure.finished();
 }
 const expectedError = networkFailure ? 'Unable to reach the diagnostic server' :
  status === 429 ? 'Request limit reached' : status === 401 ? 'Access denied' :
  status === 503 ? 'admission is unavailable' : body === '{}' ? 'invalid or incompatible report' : null;
 if (expectedError) await page.getByRole('alert').filter({ hasText: expectedError }).waitFor();
 else await result.getByRole('heading', { name: reports[scenario].findings[0].title, exact: true }).waitFor();
 await page.waitForFunction(() => document.querySelector('[aria-label="Diagnostic results"]').getAttribute('aria-busy') === 'false');
 assert.equal(requests.length, count + 1);
 assert.equal(request.postDataJSON().provider, reports[scenario].input.provider);
}
try {
 await page.goto(base, { waitUntil: 'networkidle', timeout: 90000 });
 assert.equal(requests.length, 0);
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
 record('Desktop initial render, zero diagnostics and no horizontal overflow');
 for (const mode of ['transaction', 'gas', 'health']) {
  await page.getByRole('button', { name: { transaction: "My transaction isn't showing up.", gas: 'My gas limit or fee looks wrong.', health: 'My RPC results look unexpected.' }[mode], exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'diagnostic-title');
  assert.equal(await page.locator('#diagnostic-title').evaluate(el => el === document.activeElement), true);
 }
 await page.getByText('Technical modes', { exact: true }).click();
 await page.getByRole('button', { name: /Transaction lifecycle/ }).click();
 assert.equal(requests.length, 0); record('All symptoms and technical modes navigate without requests and focus the form');
 await page.locator('#hash').fill('0x1');
 await page.getByRole('button', { name: 'Run diagnostic' }).click();
 assert.equal(requests.length, 0);
 assert.equal(await page.locator('#hash').getAttribute('aria-invalid'), 'true');
 await page.waitForFunction(() => document.activeElement?.id === 'hash');
 assert.equal(await page.locator('#hash').evaluate(el => el === document.activeElement), true);
 assert.ok(await page.locator('#hash-error').textContent()); record('Invalid input has associated inline error and keyboard focus, no request');
 await select('transaction'); await run();
 await result.getByText('Transaction outcome is unknown', { exact: true }).first().waitFor();
 assert.equal(await result.getByRole('heading', { name: 'Receipt reports successful execution' }).count(), 0);
 for (const name of ['Inclusion', 'Execution', 'Provider-attested finality']) await result.getByRole('heading', { name, exact: true }).waitFor();
 record('Unknown transaction preserves unknown outcome and three separate lifecycle questions');
 await page.waitForFunction(() => document.activeElement?.textContent === 'Your diagnostic report');
 assert.equal(await result.getByRole('heading', { name: 'Your diagnostic report' }).evaluate(el => el === document.activeElement), true);
 assert.ok(await page.getByRole('status').filter({ hasText: 'Report received' }).count()); record('Completion focuses report and announces a concise status');
 await page.getByRole('button', { name: 'My gas limit or fee looks wrong.', exact: true }).click();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await result.getByRole('button', { name: 'Export JSON' }).count(), 0);
 assert.equal(await page.getByLabel('Proposed gas limit').isVisible(), true);
 await page.getByRole('button', { name: "My transaction isn't showing up.", exact: true }).click();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await result.getByRole('button', { name: 'Export JSON' }).count(), 0);
 assert.equal(await page.getByLabel(/^Transaction hash/).isVisible(), true);
 await select('transaction'); await run();
 record('Switching investigations clears results/export immediately; switching back does not restore them');
 const count = requests.length;
 await result.getByRole('link', { name: 'Evidence #2', exact: true }).first().click();
 assert.equal(await page.locator('#evidence-2').evaluate(el => el === document.activeElement), true);
 assert.equal(await page.locator('#evidence-2').locator('..').locator('pre').textContent(), JSON.stringify(exportReport(reports[scenario]).evidence[1], null, 2));
 assert.equal(requests.length, count); record('Evidence link opens original observation, retains provenance and focuses target without requests');
 scenario = 'receipt-timeout'; await select('transaction'); await run();
 for (const label of ['Inclusion', 'Execution', 'Provider-attested finality']) {
  const slot = result.getByRole('heading', { name: label, exact: true }).locator('..');
  assert.match(await slot.innerText(), label === 'Inclusion' ? /RPC reports block inclusion · observed/ : /Transaction found; outcome unavailable · unknown/);
 }
 record('Receipt timeout preserves observed inclusion with unknown execution and finality');
 scenario = 'transaction-receipt-block-conflict'; await select('transaction'); await run();
 assert.equal(await result.locator('article').first().locator('code').textContent(), 'tx.inconsistent');
 assert.match(await result.innerText(), /Contradictory · unknown/);
 assert.equal(await result.locator('article code').filter({ hasText: /^tx\.execution$/ }).count(), 0);
 record('Contradictory receipt takes priority and does not invent execution or finality');
 scenario = 'same-height-finalized-hash-conflict'; await select('transaction'); await run();
 assert.equal(await result.locator('article').first().locator('code').textContent(), 'tx.finality-unknown');
 await result.getByRole('heading', { name: 'Receipt reports successful execution', exact: true }).waitFor();
 record('Finality contradiction preserves the separate observed execution finding');
 scenario = 'failed-execution-no-revert-reason'; await select('transaction'); await run();
 await result.getByRole('heading', { name: 'Receipt reports failed execution', exact: true }).waitFor();
 await result.getByRole('heading', { name: 'Finalized according to this RPC', exact: true }).waitFor();
 assert.match(await result.innerText(), /Failure cause is not determined/); record('Failed execution remains distinct from finality and unknown cause');
 scenario = 'gas-padding'; await select('gas'); await run();
 for (const name of ['Proposed limit (gas units)', 'RPC estimate at sampled state', 'Conditional cost, not an actual fee']) await result.getByRole('heading', { name, exact: true }).waitFor();
 await result.locator('article').filter({ has: page.locator('code').filter({ hasText: /^gas\.cost-comparison$/ }) }).locator('summary').first().click();
 assert.match(await result.innerText(), /not an actual charge or guaranteed saving/);
 await result.getByRole('link', { name: 'Evidence #3', exact: true }).first().click();
 assert.ok(!(await result.innerText()).includes('deadbeef')); record('Gas separates limit, estimate and conditional cost; evidence hides calldata');
 const beforeExport = requests.length;
 const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON' }).click();
 const download = await downloadEvent; await download.saveAs(output + '/gas-export.json');
 const exported = JSON.parse(await readFile(output + '/gas-export.json', 'utf8'));
 assert.deepEqual(exported, exportReport(reports[scenario]));
 assert.equal(exported.input.call.data, '[redacted]');
 assert.equal(exported.evidence.find(e => e.method === 'eth_estimateGas').params[0].data, '[redacted]');
 assert.equal(requests.length, beforeExport);
 record('Downloaded JSON equals the unchanged M2 export format with both calldata fields redacted');
 const beforeEdit = requests.length;
 await page.locator('#gasLimit').fill('999999');
 await result.getByText(/Previous snapshot — inputs have changed/).waitFor();
 assert.match(await result.innerText(), /Proposed limit: 1000000 gas/);
 await page.getByLabel('RPC provider').selectOption('secondary');
 assert.equal(requests.length, beforeEdit);
 const oldExportEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export JSON' }).click();
 const oldExport = await oldExportEvent; await oldExport.saveAs(output + '/previous-export.json');
 assert.deepEqual(JSON.parse(await readFile(output + '/previous-export.json', 'utf8')), exported);
 assert.equal(requests.length, beforeEdit);
 record('Edited inputs/provider mark previous snapshot; export retains captured context with no request');
 scenario = 'gas-estimation-error'; await select('gas'); await run();
 await result.getByRole('heading', { name: 'No usable gas estimate', exact: true }).waitFor();
 assert.equal(await result.getByRole('heading', { name: 'Cost at the sampled gas price', exact: true }).count(), 0);
 record('Estimation failure retains unknown headroom and never supplies a guaranteed fee');
 scenario = 'stale-finalized-fresh-latest'; await select('health'); delayed = true;
 const lateRequest = page.waitForRequest(r => r.url() === base + '/api/diagnose' && r.method() === 'POST');
 const lateResponse = page.waitForResponse(r => r.url() === base + '/api/diagnose' && r.request().method() === 'POST');
 await page.getByRole('button', { name: 'Run diagnostic' }).click();
 await lateRequest;
 assert.equal(await page.getByRole('button', { name: 'Reading RPC' }).isDisabled(), true);
 assert.equal(await page.getByRole('button', { name: 'My RPC results look unexpected.', exact: true }).isDisabled(), false);
 await page.getByRole('button', { name: 'My gas limit or fee looks wrong.', exact: true }).click();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await page.getByLabel('Proposed gas limit').isEnabled(), true);
 assert.equal(await result.getByRole('button', { name: 'Export JSON' }).count(), 0);
 const late = await lateResponse; await late.finished(); delayed = false;
 await page.waitForFunction(() => document.querySelector('[aria-label="Diagnostic results"]').getAttribute('aria-busy') === 'false');
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await result.getByRole('heading', { name: 'RPC finalized head may be stale' }).count(), 0);
 await select('health'); await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 await run();
 assert.equal(await result.locator('article').first().locator('code').textContent(), 'rpc.finalized.clock-risk');
 record('Late response is drained but cannot restore cleared results; same investigation remains runnable');
 await page.getByLabel('Compare both approved providers').check();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await result.getByRole('button', { name: 'Export JSON' }).count(), 0);
 assert.equal(await page.getByText('Compare approved public observations.').isVisible(), true);
 const comparisonRequest = page.waitForRequest(r => r.url() === base + '/api/diagnose' && r.method() === 'POST' && r.headers()['x-monad-doctor-operation'] === 'health-comparison-v1');
 const comparisonResponse = page.waitForResponse(r => r.url() === base + '/api/diagnose' && r.request().method() === 'POST' && r.request().headers()['x-monad-doctor-operation'] === 'health-comparison-v1');
 await page.getByRole('button', { name: 'Run comparison' }).click();
 const comparisonReq = await comparisonRequest, comparisonRes = await comparisonResponse; await comparisonRes.finished();
 assert.equal(comparisonReq.postDataJSON().mode, 'health_comparison');
 await result.getByRole('heading', { name: 'What the comparison supports' }).waitFor();
 await page.getByLabel('Inspect one provider').check();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await result.getByRole('button', { name: 'Export JSON' }).count(), 0);
 assert.equal(await page.getByLabel('RPC provider').isVisible(), true);
 await page.getByLabel('Compare both approved providers').check();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await result.getByRole('heading', { name: 'What the comparison supports' }).count(), 0);
 await page.getByLabel('Inspect one provider').check();
 record('Provider comparison completes; changing health scope clears its result and switching back does not restore it');
 status = 429; headers = { 'Retry-After': '1' }; body = JSON.stringify({ error: 'synthetic quota exhaustion' }); await run();
 await page.getByRole('alert').filter({ hasText: 'Request limit reached' }).waitFor();
 assert.equal(await page.getByRole('button', { name: 'Run diagnostic' }).isDisabled(), true);
 const quotaCount = requests.length;
 await page.getByRole('button', { name: 'Run diagnostic' }).waitFor({ state: 'visible' });
 await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
 assert.equal(requests.length, quotaCount); record('429 respects Retry-After and sends no automatic retry');
 await page.getByRole('button', { name: 'My gas limit or fee looks wrong.', exact: true }).click();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 const quotaAlert = page.getByRole('alert').filter({ hasText: 'Request limit reached' });
 await quotaAlert.waitFor({ state: 'detached' });
 assert.equal(await quotaAlert.count(), 0);
 assert.equal(await page.getByLabel('Proposed gas limit').isVisible(), true);
 await page.getByRole('button', { name: 'My RPC results look unexpected.', exact: true }).click();
 await result.getByRole('heading', { name: 'Ready when you are.' }).waitFor();
 assert.equal(await quotaAlert.count(), 0);
 record('Switching investigations clears prior request errors without restoring old results');
 status = 401; headers = {}; body = '<html>Access denied</html>'; await run();
 await page.getByRole('alert').filter({ hasText: 'Access denied' }).waitFor(); record('Protected HTML response produces access-denial copy without exposing response content');
 status = 503; body = '{}'; await run();
 await page.getByRole('alert').filter({ hasText: 'admission is unavailable' }).waitFor(); record('503 admission failure preserves previous report and establishes no new outcome');
 status = 200; body = '{}'; await run();
 await page.getByRole('alert').filter({ hasText: 'invalid or incompatible report' }).waitFor(); record('HTTP 200 with malformed report is rejected rather than interpreted as success');
 networkFailure = true; await run(); networkFailure = false;
 await page.getByRole('alert').filter({ hasText: 'Unable to reach the diagnostic server' }).waitFor();
 assert.equal(await result.getByRole('heading', { name: 'Ready when you are.' }).count(), 1);
 assert.equal(await result.locator('article').count(), 0);
 record('Transport failure establishes no outcome and preserves the already-cleared result state');
 await page.setViewportSize({ width: mobileWidth, height: 844 });
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
 for (const button of await page.locator('section[aria-labelledby="symptom-title"] button').all()) assert.ok((await button.boundingBox()).height >= 44);
 for (const control of await page.locator('input,select,textarea').all()) assert.ok(await control.evaluate(el => el.labels.length > 0));
 await page.emulateMedia({ reducedMotion: 'reduce' });
 await page.getByRole('link', { name: 'Skip to diagnostic' }).focus(); await page.keyboard.press('Enter');
 assert.equal(await page.locator('#diagnostic-title').evaluate(el => el === document.activeElement), true);
 record(`Mobile ${mobileWidth}px has no overflow, labelled inputs, adequate symptom targets and keyboard skip navigation`);
 status = 200; body = null; headers = {}; scenario = 'receipt-present-versus-absent'; await select('transaction'); await run();
 await result.getByRole('heading', { name: 'Finalized according to this RPC', exact: true }).waitFor();
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
 await page.screenshot({ path: output + '/mobile.png', fullPage: true });
 await page.setViewportSize({ width: 1440, height: 1100 }); await page.screenshot({ path: output + '/desktop.png', fullPage: true });
 record('Mobile successful lifecycle remains provider-attested and renders without overflow');
 assert.equal(requests.length, 17); // Only the bounded explicit submissions above.
 assert.deepEqual(errors, []); record('No browser JavaScript errors');
 await writeFile(output + '/results.json', JSON.stringify({ target: base, evidence: 'Synthetic reports from the real M2 engine; no live RPC requests', checks, diagnosticSubmissions: requests.length, errors }, null, 2) + '\n');
 console.log(JSON.stringify({ passed: checks.length, failed: 0, diagnosticSubmissions: requests.length, liveRpcCalls: 0, output }));
} finally { await browser.close(); }
