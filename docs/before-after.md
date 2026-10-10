# Before / after: Ethereum-style gas padding on Monad

## The real integration problem

A developer carries over a generous Ethereum-style gas limit, assuming unused allowance is not charged. Monad charges the submitted gas limit. The official gas guide also describes wallets assigning very high limits after estimation reverts.

Authority: https://docs.monad.xyz/developer-essentials/gas-pricing#gas-limit-not-gas-used

## Reproduce without spending funds

1. Start the app, choose **Gas-limit analysis**, then **Load padding example**.
2. This loads an unsigned zero-value, empty-calldata call from address 0x0000000000000000000000000000000000000001 to 0x000000000000000000000000000000000000dead with proposed gas 1,000,000.
3. Run the diagnostic. Inspect the actual estimate and its pinned block number. If estimation fails, no replacement gas limit is produced.
4. For this simple example, replace the proposed limit with the returned estimate and rerun. Inspect the new estimate too: state can change between runs.
5. Export both reports. Nothing is signed, broadcast, or charged.

The correction is to measure the operation and choose an appropriate limit, rather than assuming all unused allowance is free. Matching a sampled estimate does not guarantee future execution and is not a universal recommendation to remove all safety margin from state-dependent calls.

## Deterministic regression

`npm test` includes a clearly synthetic before/after fixture: estimate 21,000, price 100,000,000,000 wei per gas, before limit 1,000,000, after limit 21,000. Conditional fee comparison: 0.1 MON versus 0.0021 MON. These numbers are test inputs, **not actual payments or live findings**. The rule changes from a padding warning to a match.

## Actual evidence

`npm run live` runs the same unsigned example on both approved endpoints. Actual responses and errors are stored under timestamped `evidence/live/` directories, separate from synthetic tests. It writes an after report only when a valid estimate was returned. See the verification record for the actual run outcome; a connection error is not a successful reproduction.

## Related lifecycle correction

Incorrect: “receipt.status == 1 means the transaction is final.”

Correct: validate execution status independently, then compare the receipt block with finalized-head and matching block-hash/membership evidence. Missing receipt means unknown, not failed.

Authority: https://docs.monad.xyz/reference/json-rpc/overview#unfinalized-data


### Captured successful live run

[Before report](../evidence/live/2026-10-10T06-34-48-846Z/primary-gas-before.json) and [after report](../evidence/live/2026-10-10T06-34-48-846Z/primary-gas-after.json): actual estimate 21,000 gas, sampled price 102 gwei. Proposed limit 1,000,000 to 21,000; conditional cost 0.102 to 0.002142 MON. These are read-only observations and calculations, not payments. The same correction also passed through the production dashboard during browser QA.

## M3 guided demonstration and verification

The recorded 1,000,000 gas limit is a deliberately oversized **input**. The 21,000 estimate is an **actual RPC response for this unsigned call and sampled state**, not a universal verified minimum. The engine first checks chain ID 143, reads a finalized block, then calls eth_estimateGas with the same sender/recipient/value/calldata at that recorded block number. eth_gasPrice is a separate latest-state sample. Consult each report's request timestamps and evidence IDs.

Why this matters: Monad charges the submitted gas limit; the arithmetic compares conditional costs. No transaction was sent, and no actual transaction-fee saving occurred. See the existing official gas-pricing link above. The estimate is not a guarantee for changed inputs or future state.

To verify the correction, load the padding example, run once at 1,000,000, then use the newly returned estimate only for this unchanged simple example and run again. Confirm a usable fresh estimate and gas.estimate-comparison, inspect any warnings, and keep the two exported reports. A timeout remains unknown; do not manufacture an after result. Sharing exports redact calldata, so re-enter 0x locally for this demonstration. Never lower gas below a known execution requirement or clamp an estimate above the transaction cap.

## Deliberately incorrect network configuration (synthetic)

A configured endpoint is expected to return 0x8f (143), but the fixture returns 0x1 (1). The engine reports network.wrong-chain and makes no dependent calls. This is a deterministic illustration, not a claim that either live allowlisted provider returned Ethereum data. Run npm test and locate the synthetic wrong-network example. Correct configuration means selecting a Monad Mainnet endpoint; rerun health and require network.mainnet plus usable head evidence. The app intentionally does not expose custom RPC URLs for trying arbitrary endpoints.

Authority: https://docs.monad.xyz/ai/current-facts .
