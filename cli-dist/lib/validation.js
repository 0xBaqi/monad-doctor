export class ValidationError extends Error {
}
export function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new ValidationError('Expected a JSON object.');
    return value;
}
export function hex(value, bytes, name) {
    if (typeof value !== 'string' || !new RegExp('^0x[0-9a-fA-F]{' + bytes * 2 + '}$').test(value))
        throw new ValidationError(name + ' must be 0x followed by ' + bytes * 2 + ' hexadecimal characters.');
    return value.toLowerCase();
}
export function quantity(value) {
    if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value))
        throw new ValidationError('RPC quantity must be canonical unsigned hex, at most 256 bits.');
    return value.toLowerCase();
}
export function decimal(value, name, positive = false) {
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 2n ** 256n || (positive && BigInt(value) === 0n))
        throw new ValidationError(name + ' must be a ' + (positive ? 'positive' : 'non-negative') + ' decimal integer of at most 256 bits.');
    return value;
}
function keys(x, allowed) {
    if (Object.keys(x).some(k => !allowed.includes(k)))
        throw new ValidationError('Unexpected input field. Only documented diagnostic fields are accepted.');
}
export function parseInput(raw) {
    const x = object(raw);
    if (typeof x.mode !== 'string' || !['health', 'gas', 'transaction'].includes(x.mode))
        throw new ValidationError('Choose health, gas, or transaction diagnostics.');
    if (x.provider !== 'primary' && x.provider !== 'secondary')
        throw new ValidationError('Choose a server-approved RPC provider. Custom URLs are not accepted.');
    const common = { mode: x.mode, provider: x.provider };
    if (x.mode === 'health') {
        keys(x, ['mode', 'provider']);
        return common;
    }
    if (x.mode === 'transaction') {
        keys(x, ['mode', 'provider', 'hash']);
        return { ...common, hash: hex(x.hash, 32, 'Transaction hash') };
    }
    keys(x, ['mode', 'provider', 'call', 'gasLimit']);
    const call = object(x.call);
    keys(call, ['from', 'to', 'data', 'value']);
    if (typeof call.data !== 'string' || !/^0x(?:[a-fA-F0-9]{2}){0,4096}$/.test(call.data))
        throw new ValidationError('Calldata must be even-length 0x-prefixed hex, up to 4,096 bytes.');
    return { ...common, gasLimit: decimal(x.gasLimit, 'Gas limit', true), call: { from: hex(call.from, 20, 'Sender'), to: hex(call.to, 20, 'Recipient'), data: call.data.toLowerCase(), value: decimal(call.value, 'Value in wei') } };
}
export function parseBlock(raw) {
    if (raw === null)
        return null;
    const x = object(raw);
    if (!Array.isArray(x.transactions))
        throw new ValidationError('Block transactions must be an array.');
    return { number: quantity(x.number), hash: hex(x.hash, 32, 'Block hash'), parentHash: hex(x.parentHash, 32, 'Parent hash'), timestamp: quantity(x.timestamp), gasLimit: quantity(x.gasLimit),
        ...(x.baseFeePerGas === undefined ? {} : { baseFeePerGas: quantity(x.baseFeePerGas) }), transactions: x.transactions.map(h => hex(h, 32, 'Transaction hash')) };
}
export function parseTransaction(raw) {
    if (raw === null)
        return null;
    const x = object(raw);
    if ((x.blockHash === null) !== (x.blockNumber === null))
        throw new ValidationError('Transaction block fields disagree.');
    return { hash: hex(x.hash, 32, 'Transaction hash'), blockHash: x.blockHash === null ? null : hex(x.blockHash, 32, 'Block hash'), blockNumber: x.blockNumber === null ? null : quantity(x.blockNumber), gas: quantity(x.gas), from: hex(x.from, 20, 'Sender'), to: x.to === null ? null : hex(x.to, 20, 'Recipient') };
}
export function parseReceipt(raw) {
    if (raw === null)
        return null;
    const x = object(raw);
    if (x.status !== '0x0' && x.status !== '0x1')
        throw new ValidationError('Receipt status must be 0x0 or 0x1.');
    return { transactionHash: hex(x.transactionHash, 32, 'Transaction hash'), blockHash: hex(x.blockHash, 32, 'Block hash'), blockNumber: quantity(x.blockNumber), status: x.status, gasUsed: quantity(x.gasUsed), effectiveGasPrice: quantity(x.effectiveGasPrice) };
}
