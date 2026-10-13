export const SOURCES = {
 network: 'https://docs.monad.xyz/ai/current-facts',
 gas: 'https://docs.monad.xyz/developer-essentials/gas-pricing',
 rpc: 'https://docs.monad.xyz/reference/json-rpc/overview',
 states: 'https://docs.monad.xyz/monad-arch/consensus/block-states',
 lifecycle: 'https://docs.monad.xyz/monad-arch/transaction-lifecycle',
} as const;
export type Mode = 'health' | 'gas' | 'transaction';
export type Provider = 'primary' | 'secondary';
export type Input = { mode: Mode; provider: Provider; hash?: string; call?: { from: string; to: string; data: string; value: string }; gasLimit?: string };
export type Finding = { id: string; severity: 'pass' | 'info' | 'warning' | 'error'; basis: 'observed' | 'inferred' | 'unknown'; title: string; detail: string; nextStep: string; evidence: number[]; sources: string[] };
export type RpcError = { code: string; message: string; rpcCode?: number; httpStatus?: number };
export type Evidence = { id: number; method: string; params: unknown[]; observedAt: string; durationMs: number; result?: unknown; error?: RpcError };
export type Report = { schemaVersion: 1; ruleVersion: 'm3.0' | 'm3.1'; provider: Provider; mode: Mode; startedAt: string; completedAt: string; input: Input; findings: Finding[]; evidence: Evidence[] };
export type Block = { number: string; hash: string; parentHash: string; timestamp: string; gasLimit: string; baseFeePerGas?: string; transactions: string[] };
export type Transaction = { hash: string; blockHash: string | null; blockNumber: string | null; gas: string; from: string; to: string | null };
export type Receipt = { transactionHash: string; blockHash: string; blockNumber: string; status: '0x0' | '0x1'; gasUsed: string; effectiveGasPrice: string };
export const PROVIDER_LABELS: Record<Provider, string> = { primary: 'QuickNode · Monad public RPC', secondary: 'Alchemy · Monad public RPC' };
