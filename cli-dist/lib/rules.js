import { SOURCES } from "./model.js";
export function finding(id, severity, basis, title, detail, nextStep, evidence, sources) {
    return { id, severity, basis, title, detail, nextStep, evidence, sources };
}
export function mon(value) { const whole = value / 10n ** 18n, fraction = (value % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, ''); return whole.toString() + (fraction ? '.' + fraction : '') + ' MON'; }
export function gasRules(limit, estimate, price, refs) {
    const out = [];
    out.push(finding('gas.protocol-cap', limit > 30000000n ? 'error' : 'pass', 'observed', limit > 30000000n ? 'Gas limit exceeds the documented transaction cap' : 'Within the documented transaction gas cap', 'Proposed: ' + limit + ' gas. Documented Monad per-transaction maximum: 30,000,000 gas (reviewed 2026-10-10). RPC simulation caps and block gas limits are separate limits.', 'A viable limit must cover the operation and stay within 30,000,000. Never reduce below a verified requirement; reduce or split work and re-estimate if necessary.', [], [SOURCES.gas]));
    if (estimate === undefined)
        out.push(finding('gas.estimate-unknown', 'warning', 'unknown', 'No usable gas estimate', 'Without a successful estimate, this report cannot assess execution headroom. A failed estimate does not establish an on-chain failure.', 'Inspect the call inputs and retry. Do not replace a failed estimate with a very large gas limit.', refs, [SOURCES.gas, SOURCES.rpc]));
    else if (estimate > 30000000n) {
        out.push(finding('gas.estimate-over-cap', 'error', 'observed', 'Estimate exceeds the transaction cap', 'The RPC estimated ' + estimate + ' gas, above the documented 30,000,000 transaction cap. Simulation limits are separate from transaction limits.', 'Do not clamp the estimate to 30,000,000 or submit this operation unchanged. Reduce or split the operation and re-estimate; no viable limit is established.', refs, [SOURCES.gas, SOURCES.rpc]));
    }
    else {
        const delta = limit - estimate;
        out.push(finding('gas.estimate-comparison', delta < 0n ? 'error' : delta > 0n ? 'warning' : 'pass', delta === 0n ? 'observed' : 'inferred', delta < 0n ? 'Limit is below the RPC estimate' : delta > 0n ? 'Gas padding has a cost on Monad' : 'Limit matches the RPC estimate', 'RPC estimate: ' + estimate + ' gas. Proposed: ' + limit + ' gas.' + (delta > 0n ? ' Extra allowance: ' + delta + ' gas. Monad charges the submitted limit.' : '') + ' An estimate applies to the sampled state and is not a guarantee of future execution.', delta < 0n ? 'Re-estimate with the same sender, recipient, value and calldata; use adequate gas within the transaction cap.' : 'Use a measured limit appropriate to this operation. Re-estimate when state changes; avoid blindly copying large Ethereum-style buffers.', refs, [SOURCES.gas]));
        if (price !== undefined)
            out.push(finding('gas.cost-comparison', 'info', 'inferred', 'Cost at the sampled gas price', 'At ' + price + ' wei/gas: proposed limit costs ' + mon(limit * price) + '; estimated limit costs ' + mon(estimate * price) + '. This is a conditional comparison, not an actual charge or guaranteed saving.', 'Check current fees and re-estimate before any future transaction. Monad Doctor never signs or submits.', refs, [SOURCES.gas]));
    }
    return out;
}
export function lifecycleRules(hash, tx, receipt, finalized, canonical, refs) {
    const f = (id, severity, basis, title, detail, next) => finding(id, severity, basis, title, detail, next, refs, [SOURCES.rpc, SOURCES.states]);
    if (tx && tx.hash !== hash || receipt && receipt.transactionHash !== hash || tx && receipt && (tx.blockHash !== receipt.blockHash || tx.blockNumber !== receipt.blockNumber))
        return [f('tx.inconsistent', 'error', 'unknown', 'Transaction evidence disagrees', 'Hash or block fields disagree between the requested transaction and RPC results. No execution or finality conclusion is safe.', 'Retry the full diagnostic or compare the other provider.')];
    if (!receipt)
        return [...(tx && tx.blockHash && tx.blockNumber ? [f('tx.inclusion', 'info', 'observed', 'RPC reports block inclusion', 'Transaction lookup identifies block ' + BigInt(tx.blockNumber) + '. Inclusion alone establishes neither execution success nor finality.', 'Obtain a receipt and matching block evidence before relying on the outcome.')] : []), f('tx.outcome-unknown', 'warning', 'unknown', tx ? 'Transaction found; outcome unavailable' : 'Transaction outcome is unknown', 'No usable receipt was returned. Monad does not return pending transactions through eth_getTransactionByHash. Missing data cannot distinguish pending, dropped, unknown, or unavailable history.', 'Confirm the hash and network, then retry. Do not mark this transaction failed solely because the lookup is null.')];
    if (canonical && (canonical.number !== receipt.blockNumber || canonical.hash !== receipt.blockHash || !canonical.transactions.includes(hash)))
        return [f('tx.inconsistent', 'error', 'unknown', 'Receipt does not match the block evidence', 'The block lookup does not confirm the receipt block and transaction membership. Provider inconsistency or changing unfinalized data is possible.', 'Retry all lookups together; do not treat this receipt as final.')];
    if (tx && BigInt(receipt.gasUsed) > BigInt(tx.gas))
        return [f('tx.inconsistent', 'error', 'unknown', 'Receipt gas exceeds transaction allowance', 'Receipt gasUsed exceeds the transaction gas limit. Execution and finality conclusions are suppressed.', 'Retry both lookups or compare another provider.')];
    if (canonical && BigInt(receipt.gasUsed) > BigInt(canonical.gasLimit))
        return [f('tx.inconsistent', 'error', 'unknown', 'Receipt gas exceeds block limit', 'Receipt gasUsed exceeds the matching block gas limit. The block and receipt contradict each other; execution and finality conclusions are suppressed.', 'Retry the receipt and block lookups or compare another provider.')];
    const out = [f('tx.execution', receipt.status === '0x1' ? 'pass' : 'error', 'observed', receipt.status === '0x1' ? 'Receipt reports successful execution' : 'Receipt reports failed execution', 'Receipt status is ' + receipt.status + ' at block ' + BigInt(receipt.blockNumber) + '. Execution outcome and consensus finality are separate. Failure cause is not determined from status alone.', receipt.status === '0x1' ? 'Check finality below before relying on settlement.' : 'Inspect contract inputs or a trace with a suitable provider; do not assume out-of-gas from status alone.')];
    out.push(f('tx.inclusion', canonical ? 'pass' : 'warning', canonical ? 'observed' : 'unknown', canonical ? 'Block inclusion confirmed by RPC' : 'Block inclusion not independently matched', canonical ? 'Receipt block hash and transaction membership match the block lookup. Inclusion is separate from execution and finality.' : 'A receipt was returned, but matching block membership evidence is unavailable.', 'Review execution and finality separately.'));
    if (finalized && canonical && (finalized.number === canonical.number && finalized.hash !== canonical.hash || BigInt(finalized.number) === BigInt(canonical.number) + 1n && finalized.parentHash !== canonical.hash)) {
        out.push(f('tx.finality-unknown', 'error', 'unknown', 'Finalized block evidence conflicts', finalized.number === canonical.number ? 'The finalized head and receipt block have the same height but different hashes.' : 'The finalized head is one height above the receipt block, but its parent hash does not match that block. This directly contradicts the claimed ancestry.', 'Retry or compare the other provider; do not rely on this finality sample.'));
    }
    else if (finalized && canonical && BigInt(receipt.blockNumber) <= BigInt(finalized.number) && (receipt.blockNumber !== finalized.number || receipt.blockHash === finalized.hash)) {
        out.push(f('tx.finalized', 'pass', 'observed', 'Finalized according to this RPC', 'Receipt block hash and transaction membership match the block lookup, and its height is at or below the sampled finalized head. This relies on the selected RPC; it is not an independently verified consensus proof.', 'Use finalized evidence for settlement. This check does not establish the separate Verified execution-root state.'));
    }
    else if (finalized && BigInt(receipt.blockNumber) > BigInt(finalized.number)) {
        out.push(f('tx.provisional', 'warning', 'observed', 'Execution observed; finality not yet observed', 'Receipt height ' + BigInt(receipt.blockNumber) + ' is ahead of sampled finalized height ' + BigInt(finalized.number) + '. Unfinalized results can change.', 'Retry until a matching receipt block is covered by the finalized head.'));
    }
    else {
        out.push(f('tx.finality-unknown', 'warning', 'unknown', 'Finality cannot be established', 'A consistent finalized head and matching transaction block are required. Evidence is missing or disagrees.', 'Retry or compare the other provider. Elapsed time is not proof of finality.'));
    }
    return out;
}
export function freshness(block, now, refs, context) {
    const age = BigInt(Math.floor(now / 1000)) - BigInt(block.timestamp);
    if (age <= 120n && age >= -30n)
        return [];
    return [finding(context + '.clock-risk', 'warning', 'inferred', 'Sampled finalized state may be stale', 'Block age relative to this server is ' + age + ' seconds. The 120-second age and 30-second future-clock bounds are application heuristics, not Monad protocol thresholds. Historical finality is not reversed by age.', 'Check the server clock and another provider. Do not treat this sample as current state or a guarantee of future execution.', refs, [SOURCES.rpc, SOURCES.states])];
}
