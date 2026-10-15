import type { Provider } from './model.ts';
// Coordinator-only destinations, with offline parity tests against the legacy
// collector. Keeping that collector intact also preserves tracked CLI artifacts.
// No endpoint comes from comparison input.
export const RPC_ENDPOINTS: Readonly<Record<Provider, string>> = Object.freeze({ primary: 'https://rpc.monad.xyz', secondary: 'https://rpc1.monad.xyz' });
