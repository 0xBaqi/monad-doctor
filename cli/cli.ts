import { diagnose } from '../lib/engine.ts';
import { exportReport } from '../lib/export.ts';
import { PROVIDER_LABELS, type Input, type Provider, type Report } from '../lib/model.ts';
import type { Rpc } from '../lib/rpc.ts';
import { ValidationError } from '../lib/validation.ts';

export const EXIT = { success: 0, findings: 1, usage: 2, provider: 3, internal: 4 } as const;
const VERSION = '0.1.0';
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
type IO = { out: (text: string) => void; err: (text: string) => void };
type Dependencies = { diagnose?: typeof diagnose; rpcFactory?: (provider: Provider) => Rpc; version?: string };

const GENERAL = `Monad Doctor — read-only Monad Mainnet diagnostics

Usage:
  monad-doctor <command> [options]

Commands:
  health                 Check chain identity and provider heads
  gas --limit <units>    Compare a proposed limit with an RPC estimate
  tx <transaction-hash>  Inspect transaction lifecycle evidence

Options:
  --provider <primary|secondary>  Approved provider (default: primary)
  --json                          Emit validated redacted JSON only
  --help                          Show help
  --version                       Show version

Examples:
  monad-doctor health
  monad-doctor health --json
  monad-doctor gas --limit 1000000 --from 0x… --to 0x… --data 0x
  monad-doctor tx 0x<64 hex characters>

Exit codes: 0 success, 1 diagnostic error finding, 2 invalid arguments,
3 provider/transport failure, 4 internal error. Requires Node.js 24+.`;

const COMMAND_HELP: Record<string, string> = {
 health: `Usage: monad-doctor health [--provider primary|secondary] [--json]

Checks chain ID, latest and finalized heads, provider latency, and timestamp observations.
Examples:
  monad-doctor health
  monad-doctor health --provider secondary --json`,
 gas: `Usage: monad-doctor gas --limit <units> --from <address> --to <address> [--data <hex>] [--value <wei>] [--provider primary|secondary] [--json]

Sender and recipient are required because eth_estimateGas depends on transaction context.
--data defaults to 0x and --value defaults to 0 wei. No parameters are inferred.
An estimate is a provider observation for one finalized block, not a safe-limit guarantee.
Cost is conditional on the proposed gas limit and sampled gas price under Monad's gas model.
Examples:
  monad-doctor gas --limit 1000000 --from 0x<40 hex> --to 0x<40 hex>
  monad-doctor gas --limit 100000 --from 0x<40 hex> --to 0x<40 hex> --data 0x1234 --value 10 --json`,
 tx: `Usage: monad-doctor tx <transaction-hash> [--provider primary|secondary] [--json]

Checks transaction and receipt presence, execution result, canonical block evidence, and provider-attested finality.
Finality evidence is reported as provider-attested; Monad Doctor does not independently verify consensus.
Examples:
  monad-doctor tx 0x<64 hex>
  monad-doctor tx 0x<64 hex> --provider secondary --json`,
};

function human(report: Report): string {
 const lines = [`Monad Doctor · ${report.mode}`, `Provider: ${PROVIDER_LABELS[report.provider]}`, `Observed: ${report.startedAt} → ${report.completedAt}`, ''];
 for (const f of report.findings) {
  const icon = f.severity === 'pass' ? '✓' : f.severity === 'error' ? '✗' : f.severity === 'warning' ? '!' : '·';
  lines.push(`${icon} [${f.basis}/${f.severity}] ${f.title}`, `  ${f.detail}`, `  Next: ${f.nextStep}`, `  Evidence: ${f.evidence.length ? f.evidence.map(id => `#${id}`).join(', ') : 'none'}  Rule: ${f.id}`);
 }
 if (report.evidence.length) {
  lines.push('', 'RPC evidence:');
  for (const e of report.evidence) lines.push(`  #${e.id} ${e.method} · ${e.durationMs} ms · ${e.error ? `${e.error.code}: ${e.error.message}` : 'response validated'}`);
 }
 lines.push('', 'Provider observations can be incomplete or change. Review evidence and warnings before acting.');
 return lines.join('\n');
}

function usage(message: string, io: IO): number { io.err(`Error: ${message}\nUse --help for usage.`); return EXIT.usage; }

export async function runCli(args: string[], io: IO, deps: Dependencies = {}): Promise<number> {
 const version = deps.version ?? VERSION;
 if (args.includes('--version')) { io.out(`monad-doctor ${version}\n`); return EXIT.success; }
 if (args.length === 0 || args.includes('--help')) {
  const command = args[0]; io.out((command && COMMAND_HELP[command] ? COMMAND_HELP[command] : GENERAL) + '\n'); return EXIT.success;
 }
 const command = args[0];
 if (!['health', 'gas', 'tx'].includes(command)) return usage(`Unknown command: ${command}`, io);
 let provider: Provider = 'primary', json = false, limit: string | undefined, from: string | undefined, to: string | undefined, data = '0x', value = '0';
 let hasGasFlags = false;
 const positional: string[] = [];
 const valued = new Set(['--provider', '--limit', '--from', '--to', '--data', '--value']);
 for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--json') { json = true; continue; }
  if (valued.has(arg)) {
   const v = args[++i]; if (!v || v.startsWith('--')) return usage(`${arg} requires a value.`, io);
   if (arg === '--provider') { if (v !== 'primary' && v !== 'secondary') return usage('Provider must be primary or secondary.', io); provider = v; }
   if (arg === '--limit') { limit = v; hasGasFlags = true; }
   if (arg === '--from') { from = v; hasGasFlags = true; }
   if (arg === '--to') { to = v; hasGasFlags = true; }
   if (arg === '--data') { data = v; hasGasFlags = true; }
   if (arg === '--value') { value = v; hasGasFlags = true; }
   continue;
  }
  if (arg.startsWith('-')) return usage(`Unknown option: ${arg}`, io);
  positional.push(arg);
 }
 let input: Input;
 try {
  if (command !== 'gas' && hasGasFlags) return usage('Gas options can only be used with gas.', io);
  if (command === 'health') {
   if (positional.length) return usage('health takes no positional arguments.', io);
   input = { mode: 'health', provider };
  } else if (command === 'tx') {
   if (positional.length !== 1 || !HASH.test(positional[0])) return usage('tx requires exactly one 32-byte 0x-prefixed transaction hash.', io);
   if (hasGasFlags) return usage('Gas options cannot be used with tx.', io);
   input = { mode: 'transaction', provider, hash: positional[0] };
  } else {
   if (positional.length) return usage('gas takes no positional arguments.', io);
   if (!limit) return usage('gas requires --limit.', io);
   if (!from || !ADDRESS.test(from)) return usage('--from must be a 20-byte 0x-prefixed address.', io);
   if (!to || !ADDRESS.test(to)) return usage('--to must be a 20-byte 0x-prefixed address.', io);
   input = { mode: 'gas', provider, gasLimit: limit, call: { from, to, data, value } };
  }
  const report = await (deps.diagnose ?? diagnose)(input, deps.rpcFactory ? { rpc: deps.rpcFactory(provider) } : {});
  if (json) io.out(JSON.stringify(exportReport(report), null, 2) + '\n');
  else io.out(human(report) + '\n');
  if (report.evidence.some(e => e.error)) return EXIT.provider;
  if (report.findings.some(f => f.severity === 'error')) return EXIT.findings;
  return EXIT.success;
 } catch (error) {
  if (error instanceof ValidationError || error instanceof TypeError || error instanceof SyntaxError) return usage(error.message, io);
  io.err(`Diagnostic failed: ${error instanceof Error ? error.message : 'internal error'}\n`);
  return EXIT.internal;
 }
}
