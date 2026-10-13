import type { Finding, Input, Mode, Report } from './model.ts';
import { decimal, hex, parseInput } from './validation.ts';
import { guidance } from './guidance.ts';

// Presentation only: selections do not collect evidence or change diagnostic rules.
export const symptoms: { mode: Mode; label: string }[] = [
 { mode: 'transaction', label: "My transaction isn't showing up." },
 { mode: 'gas', label: 'My gas limit or fee looks wrong.' },
 { mode: 'health', label: 'My RPC results look unexpected.' },
];
export function orderedFindings(findings: Finding[]): Finding[] {
 const priority = { error: 0, warning: 1, info: 2, pass: 3 };
 return [...findings].sort((a, b) => priority[a.severity] - priority[b.severity] || Number(a.id === 'network.mainnet') - Number(b.id === 'network.mainnet'));
}
export function isContradiction(f: Finding): boolean {
 return f.basis === 'unknown' && f.severity === 'error' &&
  ['tx.inconsistent', 'tx.finality-unknown', 'rpc.heads'].includes(f.id);
}
export function guidedSummary(report: Report) {
 const ordered = orderedFindings(report.findings);
 const primary = ordered[0];
 const unknown = ordered.filter(f => f.basis === 'unknown');
 // No inferred certainty for unknown IDs: preserve their original text and basis.
 const outcome = (label: string, ids: string[]) => ({ label, finding: ordered.find(f => ids.includes(f.id)) });
 const outcomes = report.mode === 'transaction' ? [
  outcome('Inclusion', ['tx.inclusion', 'tx.inconsistent', 'tx.outcome-unknown']),
  outcome('Execution', ['tx.execution', 'tx.inconsistent', 'tx.outcome-unknown']),
  outcome('Provider-attested finality', ['tx.finalized', 'tx.provisional', 'tx.finality-unknown', 'tx.inconsistent', 'tx.outcome-unknown']),
 ] : report.mode === 'gas' ? [
  outcome('Proposed limit (gas units)', ['gas.protocol-cap']),
  outcome('RPC estimate at sampled state', ['gas.estimate-comparison', 'gas.estimate-over-cap', 'gas.estimate-unknown']),
  outcome('Conditional cost, not an actual fee', ['gas.cost-comparison']),
 ] : [];
 return { ordered, primary, unknown, outcomes, limitations: guidance(report.mode === 'transaction' ? 'tx.' : report.mode === 'gas' ? 'gas.' : 'rpc.').unknown };
}
export function evidenceReferences(report: Report, finding: Finding): number[] {
 const ids = new Set(report.evidence.map(e => e.id));
 return finding.evidence.filter(id => ids.has(id));
}
export function snapshotIsStale(current: unknown, report: Report): boolean {
 try { return JSON.stringify(parseInput(current)) !== JSON.stringify(parseInput(report.input)); }
 catch { return true; }
}
export function inputErrors(input: Input): Record<string, string> {
 const errors: Record<string, string> = {};
 const check = (name: string, fn: () => unknown) => { try { fn(); } catch(e) { errors[name] = e instanceof Error ? e.message : 'Invalid input.'; } };
 if (input.mode === 'transaction') check('hash', () => hex(input.hash, 32, 'Transaction hash'));
 if (input.mode === 'gas') {
  check('from', () => hex(input.call?.from, 20, 'Sender'));
  check('to', () => hex(input.call?.to, 20, 'Recipient'));
  check('gasLimit', () => decimal(input.gasLimit, 'Gas limit', true));
  check('value', () => decimal(input.call?.value, 'Value in wei'));
  check('data', () => parseInput({ ...input, gasLimit: '1', call: { from: '0x' + '0'.repeat(40), to: '0x' + '0'.repeat(40), value: '0', data: input.call?.data } }));
 }
 return errors;
}
export function retryAfterMs(value: string | null, now: number): number {
 if (!value) return 0;
 if (!/^\d+$/.test(value) && !/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return 0;
 const seconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
 return Number.isFinite(seconds) ? Math.max(0, Math.min(seconds, 2147483647)) : 0;
}
export function responseError(status: number): string {
 if (status === 401 || status === 403) return 'Access denied. Open the application with your authorized access; no diagnostic report was received.';
 if (status === 429) return 'Request limit reached. Wait before running another check; no automatic retry will occur.';
 if (status === 503) return 'Diagnostic admission is unavailable. No usable report was received. Try again later.';
 return 'The diagnostic server did not return a usable report. Check connectivity and try again explicitly.';
}
