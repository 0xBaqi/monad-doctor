import { object, ValidationError } from "./validation.js";
// Server-controlled endpoints. No user-supplied URLs, headers, credentials or methods.
const ENDPOINTS = { primary: 'https://rpc.monad.xyz', secondary: 'https://rpc1.monad.xyz' };
const METHODS = ['eth_chainId', 'eth_getBlockByNumber', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_estimateGas', 'eth_gasPrice'];
export class BodyLimitError extends Error {
}
export class BodyTimeoutError extends Error {
}
export async function readBounded(body, limit, timeoutMs = 5000) {
    if (!body)
        throw new ValidationError('Response body is missing.');
    const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0, text = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => { }); }, timeoutMs);
    try {
        while (true) {
            const part = await reader.read();
            if (timedOut)
                throw new BodyTimeoutError('Body read timed out. Retry the request.');
            if (part.done)
                return text + decoder.decode();
            size += part.value.byteLength;
            if (size > limit) {
                void reader.cancel().catch(() => { });
                throw new BodyLimitError('Body exceeds size limit.');
            }
            text += decoder.decode(part.value, { stream: true });
        }
    }
    finally {
        clearTimeout(timer);
        reader.releaseLock();
    }
}
export function createRpc(provider, options = {}) {
    if (!Object.hasOwn(ENDPOINTS, provider))
        throw new ValidationError('RPC provider is not allowlisted.');
    const fetcher = options.fetcher ?? fetch, now = options.now ?? Date.now, started = now();
    const evidence = [];
    let sequence = 0;
    async function call(method, params, validate) {
        if (!METHODS.includes(method))
            throw new ValidationError('RPC method is not read-only allowlisted.');
        const id = ++sequence, begin = now();
        const record = { id, method, params, observedAt: new Date(begin).toISOString(), durationMs: 0 };
        evidence.push(record);
        const remaining = (options.budgetMs ?? 18000) - (begin - started);
        const fail = (error) => { record.error = error; return { id, ok: false, error }; };
        if (id > 10 || remaining <= 0)
            return fail({ code: 'BUDGET', message: 'Diagnostic request budget exhausted. Run again.' });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 5000, remaining));
        try {
            const response = await fetcher(ENDPOINTS[provider], { method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
            if (!response.ok) {
                void response.body?.cancel().catch(() => { });
                return fail({ code: response.status === 429 ? 'RATE_LIMIT' : 'HTTP', message: response.status === 429 ? 'Provider rate limit reached. Wait before retrying.' : 'Provider returned an HTTP error. Retry or switch provider.', httpStatus: response.status });
            }
            const bodyBudget = Math.min(options.timeoutMs ?? 5000, remaining) - (now() - begin);
            if (bodyBudget <= 0) {
                controller.abort();
                void response.body?.cancel().catch(() => { });
                throw new Error('deadline');
            }
            const raw = object(JSON.parse(await readBounded(response.body, options.maxBytes ?? 1048576, bodyBudget)));
            if (raw.jsonrpc !== '2.0' || raw.id !== id || Object.hasOwn(raw, 'result') === Object.hasOwn(raw, 'error'))
                throw new ValidationError('Invalid JSON-RPC envelope or response ID.');
            if (Object.hasOwn(raw, 'error')) {
                const error = object(raw.error);
                if (!Number.isSafeInteger(error.code) || typeof error.message !== 'string')
                    throw new ValidationError('Malformed RPC error.');
                // Arbitrary upstream error text/data may echo credentials. Export only code + local description.
                return fail({ code: 'RPC', rpcCode: error.code, message: error.code === -32601 ? 'Method unavailable on this provider.' : error.code === -32602 ? 'Provider rejected method parameters.' : 'Provider could not execute this request. This is not proof of an on-chain transaction failure.' });
            }
            const value = validate(raw.result);
            record.result = value;
            return { id, ok: true, value };
        }
        catch (error) {
            if (controller.signal.aborted || error instanceof BodyTimeoutError)
                return fail({ code: 'TIMEOUT', message: 'RPC timed out. Evidence is incomplete; retry or switch provider.' });
            if (error instanceof BodyLimitError)
                return fail({ code: 'TOO_LARGE', message: 'RPC response exceeded the size limit.' });
            if (error instanceof ValidationError || error instanceof SyntaxError || error instanceof TypeError && error.message.includes('encoded data'))
                return fail({ code: 'MALFORMED', message: 'Provider returned malformed or incomplete JSON-RPC data.' });
            return fail({ code: 'NETWORK', message: 'RPC connection failed. Check connectivity or choose another provider.' });
        }
        finally {
            clearTimeout(timer);
            record.durationMs = Math.max(0, now() - begin);
        }
    }
    return { call, evidence };
}
