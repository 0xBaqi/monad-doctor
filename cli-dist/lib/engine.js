import { SOURCES } from "./model.js";
import { createRpc } from "./rpc.js";
import { parseBlock, parseInput, parseReceipt, parseTransaction, quantity, ValidationError } from "./validation.js";
import { finding, gasRules, lifecycleRules, freshness } from "./rules.js";
export async function diagnose(raw, options = {}) {
    const input = parseInput(raw), now = options.now ?? Date.now;
    const rpc = options.rpc ?? createRpc(input.provider);
    if (rpc.provider !== input.provider)
        throw new ValidationError('RPC collector provider disagrees with the input provider.');
    const report = { schemaVersion: 1, ruleVersion: 'm3.1', provider: input.provider, mode: input.mode, startedAt: new Date(now()).toISOString(), completedAt: '', input, findings: [], evidence: rpc.evidence };
    const finish = () => {
        for (const e of rpc.evidence)
            if (e.error)
                report.findings.push(finding('rpc.' + e.id + '.' + e.error.code.toLowerCase(), 'warning', 'unknown', e.method + ': evidence unavailable', e.error.message, 'Retry or choose another provider. Successful checks in this report remain visible.', [e.id], [SOURCES.rpc]));
        report.completedAt = new Date(now()).toISOString();
        return report;
    };
    const chain = await rpc.call('eth_chainId', [], quantity);
    if (!chain.ok)
        return finish();
    if (BigInt(chain.value) !== 143n) {
        report.findings.push(finding('network.wrong-chain', 'error', 'observed', 'RPC is not Monad Mainnet', 'Expected chain ID 143 (0x8f); observed ' + BigInt(chain.value) + '.', 'Choose a Monad Mainnet endpoint. Dependent diagnostics have been stopped.', [chain.id], [SOURCES.network]));
        return finish();
    }
    report.findings.push(finding('network.mainnet', 'pass', 'observed', 'Monad Mainnet confirmed', 'This provider returned chain ID 143 (0x8f).', 'Continue with the evidence below.', [chain.id], [SOURCES.network]));
    if (input.mode === 'health') {
        // Query finalized first: a later latest response should not be behind it.
        const finalized = await rpc.call('eth_getBlockByNumber', ['finalized', false], parseBlock);
        const latest = await rpc.call('eth_getBlockByNumber', ['latest', false], parseBlock);
        if (finalized.ok && finalized.value)
            report.findings.push(...freshness(finalized.value, now(), [finalized.id], 'rpc.finalized'));
        if (latest.ok && latest.value) {
            const b = latest.value;
            report.findings.push(finding('rpc.latest', 'pass', 'observed', 'Latest block is readable', 'Block ' + BigInt(b.number) + '; gas limit ' + BigInt(b.gasLimit) + '. Request latency: ' + rpc.evidence.find(e => e.id === latest.id).durationMs + ' ms. Latest is the proposed view, not proof of finality.', 'Use finalized for settlement; latency describes this request only.', [latest.id], [SOURCES.rpc]));
            const age = BigInt(Math.floor(now() / 1000)) - BigInt(b.timestamp);
            if (age > 120n || age < -30n)
                report.findings.push(finding('rpc.clock-risk', 'warning', 'inferred', 'Block timestamp needs attention', 'Block age relative to this server is ' + age.toString() + ' seconds. Application heuristic: older than 120 seconds or over 30 seconds in the future; this is not a Monad protocol threshold.', 'Check local clock and another provider before concluding the node is stale.', [latest.id], [SOURCES.rpc]));
        }
        else if (latest.ok)
            report.findings.push(finding('rpc.latest-null', 'warning', 'unknown', 'Latest block unavailable', 'Provider returned null for latest.', 'Retry or switch provider.', [latest.id], [SOURCES.rpc]));
        if (finalized.ok && finalized.value && latest.ok && latest.value) {
            const f = finalized.value, l = latest.value;
            const inconsistent = BigInt(f.number) > BigInt(l.number) || f.number === l.number && f.hash !== l.hash;
            report.findings.push(finding('rpc.heads', inconsistent ? 'error' : 'pass', inconsistent ? 'unknown' : 'observed', inconsistent ? 'Block views disagree' : 'Finalized head is readable', 'Finalized: ' + BigInt(f.number) + '. Latest sampled afterward: ' + BigInt(l.number) + '. These requests are not an atomic snapshot.', inconsistent ? 'Retry or compare the other provider.' : 'Keep finality separate from execution success.', [finalized.id, latest.id], [SOURCES.rpc, SOURCES.states]));
        }
        else if (finalized.ok && !finalized.value)
            report.findings.push(finding('rpc.finalized-null', 'warning', 'unknown', 'Finalized head unavailable', 'Provider returned null for finalized.', 'Retry; do not replace finalized with latest.', [finalized.id], [SOURCES.states]));
    }
    else if (input.mode === 'gas') {
        const block = await rpc.call('eth_getBlockByNumber', ['finalized', false], parseBlock);
        if (block.ok && block.value)
            report.findings.push(...freshness(block.value, now(), [block.id], 'gas'));
        let estimate;
        const refs = [block.id];
        if (block.ok && block.value) {
            const result = await rpc.call('eth_estimateGas', [{ ...input.call, value: '0x' + BigInt(input.call.value).toString(16) }, block.value.number], value => {
                const q = quantity(value);
                if (BigInt(q) === 0n)
                    throw new SyntaxError('Zero estimate');
                return q;
            });
            refs.push(result.id);
            if (result.ok)
                estimate = BigInt(result.value);
        }
        const price = await rpc.call('eth_gasPrice', [], quantity);
        refs.push(price.id);
        report.findings.push(...gasRules(BigInt(input.gasLimit), estimate, price.ok ? BigInt(price.value) : undefined, refs));
    }
    else {
        const tx = await rpc.call('eth_getTransactionByHash', [input.hash], parseTransaction);
        const receipt = await rpc.call('eth_getTransactionReceipt', [input.hash], parseReceipt);
        const finalized = await rpc.call('eth_getBlockByNumber', ['finalized', false], parseBlock);
        if (finalized.ok && finalized.value)
            report.findings.push(...freshness(finalized.value, now(), [finalized.id], 'tx'));
        const canonical = receipt.ok && receipt.value ? await rpc.call('eth_getBlockByNumber', [receipt.value.blockNumber, false], parseBlock) : undefined;
        report.findings.push(...lifecycleRules(input.hash, tx.ok ? tx.value : undefined, receipt.ok ? receipt.value : undefined, finalized.ok ? finalized.value : undefined, canonical?.ok ? canonical.value : undefined, [tx.id, receipt.id, finalized.id, ...(canonical ? [canonical.id] : [])]));
    }
    return finish();
}
