import type { Block, Finding, Input, Provider, Receipt, Transaction } from '../../lib/model.ts';
import { createRpc } from '../../lib/rpc.ts';

// Every response here is SYNTHETIC. No live RPC or credentials are used.
export const NOW = 200_000;
export const HASH = '0x' + 'a'.repeat(64);
export const OTHER_HASH = '0x' + 'd'.repeat(64);
export const ADDRESS = '0x' + '1'.repeat(40);
export const BLOCK: Block = { number: '0x64', hash: '0x' + 'b'.repeat(64), parentHash: '0x' + 'c'.repeat(64), timestamp: '0xc8', gasLimit: '0x8f0d180', transactions: [HASH] };
export const TX: Transaction = { hash: HASH, blockHash: BLOCK.hash, blockNumber: BLOCK.number, gas: '0x5208', from: ADDRESS, to: ADDRESS };
export const RECEIPT: Receipt = { transactionHash: HASH, blockHash: BLOCK.hash, blockNumber: BLOCK.number, status: '0x1', gasUsed: '0x5208', effectiveGasPrice: '0x1' };
export const GAS: Input = { mode: 'gas', provider: 'primary', gasLimit: '1000000', call: { from: ADDRESS, to: ADDRESS, data: '0xdeadbeef', value: '0' } };
export const TRANSACTION: Input = { mode: 'transaction', provider: 'primary', hash: HASH };
export const HEALTH: Input = { mode: 'health', provider: 'primary' };
export const SENTINEL = 'SYNTHETIC_UPSTREAM_SECRET';

export type Fault = 'timeout' | 'truncated' | 'bad-id' | 'double-envelope' | 'rpc-error';
export type Sample = {
 provider: Provider;
 chain?: unknown;
 tx?: unknown;
 receipt?: unknown;
 finalized?: unknown;
 latest?: unknown;
 canonical?: unknown;
 estimate?: unknown;
 fault?: { method: string; kind: Fault };
 expected: { id: string; basis?: Finding['basis']; severity?: Finding['severity']; detail?: RegExp }[];
 forbidden: string[];
};
export type Fixture = {
 id: string;
 input: Input;
 samples: Sample[];
 uncertainty: string;
 mustNotClaim: string;
 provenance: string;
};
const expected = (id: string, basis: Finding['basis'], severity?: Finding['severity']) => ({ id, basis, severity });
const success = expected('tx.finalized', 'observed', 'pass');
const unknown = expected('tx.outcome-unknown', 'unknown', 'warning');
const conflict = expected('tx.inconsistent', 'unknown', 'error');
const noOutcome = ['tx.execution', 'tx.finalized', 'tx.provisional'];
const provenance = 'Keep the sample provider, requested hash/block tag, normalized results or sanitized error, timestamps and every finding evidence reference in the redacted export.';
const primary = (patch: Omit<Sample, 'provider'>): Sample => ({ provider: 'primary', ...patch });
const secondary = (patch: Omit<Sample, 'provider'>): Sample => ({ provider: 'secondary', ...patch });

export const fixtures: Fixture[] = [
 { id: 'receipt-present-versus-absent', input: TRANSACTION,
  samples: [primary({ expected: [success], forbidden: [] }), secondary({ tx: null, receipt: null, expected: [unknown], forbidden: noOutcome })],
  uncertainty: 'Absence at B does not refute A or distinguish propagation, changing unfinalized data and missing history.', mustNotClaim: 'Provider agreement, universal finality, or failed/dropped status from B nulls.', provenance },
 { id: 'conflicting-provider-block-hashes', input: TRANSACTION,
  samples: [primary({ expected: [success], forbidden: [] }), secondary({ tx: { ...TX, blockHash: OTHER_HASH }, receipt: { ...RECEIPT, blockHash: OTHER_HASH }, canonical: { ...BLOCK, hash: OTHER_HASH }, finalized: { ...BLOCK, hash: OTHER_HASH }, expected: [success], forbidden: [] })],
  uncertainty: 'Each self-consistent report is attributable to its provider. These separately collected reports disagree; the engine does not merge them.', mustNotClaim: 'Cross-provider consensus or independently verified finality.', provenance },
 { id: 'conflicting-provider-execution-statuses', input: TRANSACTION,
  samples: [primary({ expected: [expected('tx.execution', 'observed', 'pass'), success], forbidden: [] }), secondary({ receipt: { ...RECEIPT, status: '0x0' }, expected: [expected('tx.execution', 'observed', 'error'), success], forbidden: [] })],
  uncertainty: 'Status disagreement across separate providers is unresolved. Finality coverage does not turn failed execution into success.', mustNotClaim: 'A single agreed status or a failure cause.', provenance },
 { id: 'transaction-receipt-block-conflict', input: TRANSACTION,
  samples: [primary({ receipt: { ...RECEIPT, blockHash: OTHER_HASH }, expected: [conflict], forbidden: noOutcome })],
  uncertainty: 'The receipt and transaction disagree, so execution/finality conclusions are suppressed.', mustNotClaim: 'Successful, failed or finalized transaction from contradictory evidence.', provenance },
 { id: 'receipt-block-membership-conflict', input: TRANSACTION,
  samples: [primary({ canonical: { ...BLOCK, transactions: [] }, expected: [conflict], forbidden: noOutcome })],
  uncertainty: 'A block lacking the requested transaction does not substantiate this receipt.', mustNotClaim: 'Confirmed inclusion, execution or finality.', provenance },
 { id: 'same-height-finalized-hash-conflict', input: TRANSACTION,
  samples: [primary({ finalized: { ...BLOCK, hash: OTHER_HASH }, expected: [expected('tx.finality-unknown', 'unknown', 'error')], forbidden: ['tx.finalized'] })],
  uncertainty: 'Receipt status remains an attributed observation; settlement is contradicted at the sampled height.', mustNotClaim: 'Finality from mismatched finalized/canonical hashes.', provenance },
 { id: 'adjacent-finalized-parent-conflict', input: TRANSACTION,
  samples: [primary({ finalized: { ...BLOCK, number: '0x65', hash: OTHER_HASH, parentHash: OTHER_HASH }, expected: [expected('tx.finality-unknown', 'unknown', 'error')], forbidden: ['tx.finalized'] })],
  uncertainty: 'The immediately following finalized block does not name the receipt block as its parent.', mustNotClaim: 'Provider-attested finality in the face of direct ancestry contradiction.', provenance },
 { id: 'adjacent-finalized-parent-match', input: TRANSACTION,
  samples: [primary({ finalized: { ...BLOCK, number: '0x65', hash: OTHER_HASH, parentHash: BLOCK.hash }, expected: [success], forbidden: ['tx.finality-unknown'] })],
  uncertainty: 'Even matching ancestry is provider-attested, not cryptographically verified.', mustNotClaim: 'Independent consensus verification.', provenance },
 { id: 'stale-finalized-fresh-latest', input: HEALTH,
  samples: [primary({ finalized: { ...BLOCK, timestamp: '0x1' }, expected: [expected('rpc.finalized.clock-risk', 'inferred', 'warning')], forbidden: ['rpc.clock-risk'] })],
  uncertainty: 'Local clock and provider lag are possible; age alone cannot establish network failure.', mustNotClaim: 'A fresh finalized sample merely because latest is fresh.', provenance },
 { id: 'stale-latest', input: HEALTH,
  samples: [primary({ latest: { ...BLOCK, timestamp: '0x1' }, expected: [expected('rpc.clock-risk', 'inferred', 'warning')], forbidden: [] })],
  uncertainty: 'Age is an application heuristic, not a protocol finality threshold.', mustNotClaim: 'Confirmed network outage or loss of historical finality.', provenance },
 { id: 'stale-transaction-finalized-head', input: TRANSACTION,
  samples: [primary({ finalized: { ...BLOCK, timestamp: '0x1' }, expected: [expected('tx.clock-risk', 'inferred', 'warning'), success], forbidden: [] })],
  uncertainty: 'Historical provider-attested finality is preserved while current freshness is questioned.', mustNotClaim: 'Fresh current state or reversed historical finality.', provenance },
 { id: 'unknown-on-all-providers', input: TRANSACTION,
  samples: [primary({ tx: null, receipt: null, expected: [unknown], forbidden: noOutcome }), secondary({ tx: null, receipt: null, expected: [unknown], forbidden: noOutcome })],
  uncertainty: 'Neither provider can establish execution, pending, dropped or failed status.', mustNotClaim: 'Failed/dropped transaction or universal absence.', provenance },
 { id: 'receipt-timeout', input: TRANSACTION,
  samples: [primary({ fault: { method: 'eth_getTransactionReceipt', kind: 'timeout' }, expected: [unknown, expected('rpc.3.timeout', 'unknown', 'warning')], forbidden: noOutcome })],
  uncertainty: 'Transaction inclusion may remain visible; unavailable receipt cannot establish execution.', mustNotClaim: 'Execution failure caused by an RPC timeout.', provenance },
 { id: 'truncated-receipt', input: TRANSACTION,
  samples: [primary({ fault: { method: 'eth_getTransactionReceipt', kind: 'truncated' }, expected: [unknown, expected('rpc.3.malformed', 'unknown', 'warning')], forbidden: noOutcome })],
  uncertainty: 'Truncated JSON is unusable receipt evidence.', mustNotClaim: 'Execution or finality from partial JSON.', provenance },
 { id: 'malformed-receipt-status', input: TRANSACTION,
  samples: [primary({ receipt: { ...RECEIPT, status: '0x2' }, expected: [unknown, expected('rpc.3.malformed', 'unknown', 'warning')], forbidden: noOutcome })],
  uncertainty: 'Unsupported status cannot be interpreted as successful or failed execution.', mustNotClaim: 'Truthiness-based successful receipt.', provenance },
 { id: 'mismatched-envelope-id', input: TRANSACTION,
  samples: [primary({ fault: { method: 'eth_getTransactionReceipt', kind: 'bad-id' }, expected: [unknown, expected('rpc.3.malformed', 'unknown', 'warning')], forbidden: noOutcome })],
  uncertainty: 'A reply for another request is not this request evidence.', mustNotClaim: 'Receipt execution from unrelated response.', provenance },
 { id: 'result-and-error-envelope', input: TRANSACTION,
  samples: [primary({ fault: { method: 'eth_getTransactionReceipt', kind: 'double-envelope' }, expected: [unknown, expected('rpc.3.malformed', 'unknown', 'warning')], forbidden: noOutcome })],
  uncertainty: 'A contradictory envelope is rejected instead of selecting its favorable half.', mustNotClaim: 'Execution success by ignoring an error.', provenance },
 { id: 'failed-execution-no-revert-reason', input: TRANSACTION,
  samples: [primary({ receipt: { ...RECEIPT, status: '0x0', gasUsed: '0x5000', revertReason: SENTINEL }, expected: [{ ...expected('tx.execution', 'observed', 'error'), detail: /Failure cause is not determined/ }, success], forbidden: ['tx.reverted', 'tx.out-of-gas'] })],
  uncertainty: 'Fixture scenario is a revert, but status alone cannot establish the opcode/reason.', mustNotClaim: 'Confirmed revert, revert reason, or out-of-gas.', provenance },
 { id: 'gas-exhausted-without-cause-evidence', input: TRANSACTION,
  samples: [primary({ receipt: { ...RECEIPT, status: '0x0' }, expected: [{ ...expected('tx.execution', 'observed', 'error'), detail: /Failure cause is not determined/ }, success], forbidden: ['tx.reverted', 'tx.out-of-gas'] })],
  uncertainty: 'gasUsed equals the allowance; that does not establish the failure cause.', mustNotClaim: 'Confirmed out-of-gas from gas equality or receipt status.', provenance },
 { id: 'receipt-exceeds-transaction-allowance', input: TRANSACTION,
  samples: [primary({ receipt: { ...RECEIPT, gasUsed: '0x5209' }, expected: [conflict], forbidden: noOutcome })],
  uncertainty: 'Impossible gas accounting suppresses execution and finality conclusions.', mustNotClaim: 'An executable finalized receipt despite impossible gas accounting.', provenance },
 { id: 'receipt-exceeds-block-limit', input: TRANSACTION,
  samples: [primary({ canonical: { ...BLOCK, gasLimit: '0x5207' }, finalized: { ...BLOCK, gasLimit: '0x5207' }, expected: [conflict], forbidden: noOutcome })],
  uncertainty: 'A matched block cannot support receipt gas greater than its own gas limit.', mustNotClaim: 'Execution or finality from internally impossible block/receipt evidence.', provenance },
 { id: 'gas-padding', input: GAS,
  samples: [primary({ expected: [expected('gas.estimate-comparison', 'inferred', 'warning')], forbidden: ['gas.estimate-unknown'] })],
  uncertainty: '21,000 is an estimate for the supplied call and state, not a universal safe minimum.', mustNotClaim: 'Guaranteed execution, guaranteed savings, or actual paid fees.', provenance },
 { id: 'gas-estimation-error', input: GAS,
  samples: [primary({ fault: { method: 'eth_estimateGas', kind: 'rpc-error' }, expected: [expected('gas.estimate-unknown', 'unknown', 'warning'), expected('rpc.3.rpc', 'unknown', 'warning')], forbidden: ['gas.estimate-comparison', 'gas.cost-comparison'] })],
  uncertainty: 'The simulated error text says revert but is untrusted; no on-chain execution or cause is established.', mustNotClaim: 'Fallback estimate, actual failed transaction, confirmed revert, or credential-bearing provider reason.', provenance },
 { id: 'contradictory-provider-chain-ids', input: TRANSACTION,
  samples: [primary({ expected: [success], forbidden: ['network.wrong-chain'] }), secondary({ chain: '0x1', expected: [expected('network.wrong-chain', 'observed', 'error')], forbidden: ['network.mainnet', ...noOutcome] })],
  uncertainty: 'Only the selected provider is checked. Wrong-network evidence stops all dependent RPC work.', mustNotClaim: 'Monad outcome from another chain or agreed chain identity.', provenance },
 { id: 'provider-recovery', input: TRANSACTION,
  samples: [primary({ fault: { method: 'eth_getTransactionReceipt', kind: 'rpc-error' }, expected: [unknown, expected('rpc.3.rpc', 'unknown', 'warning')], forbidden: noOutcome }), primary({ expected: [success], forbidden: ['tx.outcome-unknown'] })],
  uncertainty: 'A fresh successful observation supersedes no stored history; the failed earlier report remains separately attributable.', mustNotClaim: 'Earlier failure never happened, or success in the earlier report.', provenance },
];

export function mockFetch(sample: Sample): typeof fetch {
 return async (url, init) => {
  if (url !== (sample.provider === 'primary' ? 'https://rpc.monad.xyz' : 'https://rpc1.monad.xyz')) throw new Error('Fixture provider mismatch');
  const request = JSON.parse(String(init?.body));
  const fault = sample.fault?.method === request.method ? sample.fault?.kind : undefined;
  if (fault === 'timeout') return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('synthetic timeout')), { once: true }));
  if (fault === 'truncated') return new Response('{"jsonrpc":"2.0","result":');
  const value = (key: keyof Sample, fallback: unknown) => Object.hasOwn(sample, key) ? sample[key] : fallback;
  const result = request.method === 'eth_chainId' ? value('chain', '0x8f')
   : request.method === 'eth_getTransactionByHash' ? value('tx', TX)
   : request.method === 'eth_getTransactionReceipt' ? value('receipt', RECEIPT)
   : request.method === 'eth_getBlockByNumber' ? request.params[0] === 'finalized' ? value('finalized', BLOCK) : request.params[0] === 'latest' ? value('latest', BLOCK) : value('canonical', BLOCK)
   : request.method === 'eth_estimateGas' ? value('estimate', '0x5208') : '0x1';
  const error = { code: -32603, message: 'execution reverted: ' + SENTINEL, data: SENTINEL };
  if (fault === 'rpc-error') return Response.json({ jsonrpc: '2.0', id: request.id, error });
  return Response.json({ jsonrpc: '2.0', id: fault === 'bad-id' ? request.id + 1 : request.id, result, ...(fault === 'double-envelope' ? { error } : {}) });
 };
}

export function mockRpc(sample: Sample, now: () => number = () => NOW) {
 return createRpc(sample.provider, { now, timeoutMs: 20, fetcher: mockFetch(sample) });
}
