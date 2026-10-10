# Monad Doctor

Find and fix Monad integration problems before they reach production.

M4 preparation is in progress. See [demo storyboard](docs/demo.md) and [Vercel deployment requirements](docs/deployment.md). No public URL is claimed.

M3 release candidate: **51 unit tests, 10 browser checks, TypeScript, lint and production build passed locally**. CI is configured; public deployment is not performed.

Read-only Monad Mainnet diagnostics for the Monad Metropolis Hackathon. Target chain ID **143**. Deadline: October 14, 2026, 04:59 Africa/Lagos.

## Run

Requires Node.js 24+.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. No wallet, private keys, API credentials, database, or environment file required.

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm start
npm run live
```

The lockfile pins the tested dependencies. Tests use Node's built-in runner and synthetic responses, never the network. The live command performs actual read-only RPC calls and writes timestamped observations under `evidence/live/`. Connection failures are evidence of this environment's failed request, not a diagnosed outage of the Monad network.

## M1 workflows

- **RPC health:** chain identity, latest/finalized block views, observed block gas limit, request latency, clock/staleness risk.
- **Gas-limit analysis:** unsigned sender/recipient/calldata/value plus proposed limit; pinned-block estimate, the documented 30M transaction cap, conditional MON cost comparison. No fabricated fallback after estimation failure.
- **Transaction lifecycle:** transaction and receipt lookups, execution status, finalized height, matching block hash and transaction membership. Null lookup is unknown. Execution failure can be finalized. Receipt success alone is not finality.

Each finding includes observed/inferred/unknown classification, rule ID, evidence references, official documentation links, and a next step. Request times are observations, not deterministic inputs to unit assertions.

## Architecture

`app/` contains the dashboard and one POST route. `lib/` contains validation, an allowlisted RPC client, pure rules, and orchestration. No blockchain SDK, state management library, chart dependency, ORM, or wallet package.

RPC URLs exist only in the server RPC module. The HTTP boundary accepts provider IDs, never URLs, headers or arbitrary methods. All write/financial methods are excluded. Public providers: rpc.monad.xyz and rpc1.monad.xyz.

Bounds: 16 KiB input / 3-second body read; 4 KiB calldata; 1 MiB RPC response; 5 seconds per RPC; 18-second collection budget; 10 calls per collector; 4 concurrent API runs and 30 runs/minute per process. Redirects are rejected. Limits are local process guards, not a distributed deployment quota.

Exports include only normalized inputs, projected/validated RPC fields, local error descriptions and numeric upstream error codes. Upstream arbitrary error strings, data, headers and URLs are excluded to prevent credential echoes. Public addresses are included: review them before sharing. Sharing exports redact calldata in both input and RPC parameters; re-enter calldata locally to reproduce gas simulation. The on-screen report retains it. Exports reproduce observations; rerunning against a changing chain may yield different evidence.

## Technical authority

- [Network identity](https://docs.monad.xyz/ai/current-facts)
- [Gas pricing and transaction cap](https://docs.monad.xyz/developer-essentials/gas-pricing)
- [RPC behavior, limitations and block tags](https://docs.monad.xyz/reference/json-rpc/overview)
- [Block states](https://docs.monad.xyz/monad-arch/consensus/block-states)
- [Transaction lifecycle](https://docs.monad.xyz/monad-arch/transaction-lifecycle)

Reviewed October 10, 2026. Official pages contain conflicting version/block-gas figures. The app reads block gas limits from the provider and keeps the documented transaction cap separate. No inference is based on advertised TPS or hardcoded millisecond finality.

## Finality contract

`latest` is Proposed; `safe` is Voted; `finalized` is Finalized in the current RPC overview. A receipt is an execution observation. The tool calls a transaction finalized only when its receipt block matches a height lookup with transaction membership and is covered by the provider's sampled finalized head. At equal height the finalized hash must match too. This is provider-attested evidence, not independent consensus verification. The separate Verified execution-root state is not claimed. Sequential samples are not atomic, and unfinalized results can change.

## Reproduction and verification

See [before/after example](docs/before-after.md), [development journal](docs/development-journal.md), and [verification record](docs/verification.md). A live transition is reported only if captured; all-finalized samples do not establish that a provisional transition was observed.


### Browser verification

After npm run build, run npm start -- --port 3143 in one terminal and npm run qa:browser in another. Uses existing Google Chrome in headless mode via a development-only Playwright Core package; no browser download. Exercises all live forms, exports, validation, and desktop/mobile layout. Actual UI RPC evidence is stored separately under evidence/live/ui-<timestamp>/.

On Windows with enterprise certificate trust, if npm ci reports UNABLE_TO_VERIFY_LEAF_SIGNATURE, set $env:NODE_USE_SYSTEM_CA = "1" in PowerShell first. App commands already use Node system trust. Never disable TLS verification.

Run npm run verify for the four required checks and persisted logs.

## Verification status

M1 passes 26 unit tests, TypeScript, lint, production build, and eight production-browser checks. Both approved RPC providers were exercised live. See [verification evidence](docs/verification.md), [desktop preview](evidence/verification/desktop.png), and [mobile report](evidence/verification/mobile-gas-report.png).

## M2 reliability and security

M2 verification: **42 unit tests and 9 browser checks passed**, plus TypeScript, lint and production build. Both providers validated live. Rule version m2.0 adds explicit inclusion evidence, finalized-state freshness warnings, contradictory receipt gas checks, and an explicit stop when simulation exceeds the transaction cap. Sharing exports redact calldata. HTTP and RPC resource guards have regression coverage. See docs/verification.md for M2 outcomes and the unresolved development-tool advisory. No deployment or transaction submission is included.

## M3 developer and release foundation

Each finding now includes expandable verification guidance. Sharing exports use validated field allowlists, retain rule IDs/timestamps/documentation, and remove calldata and unsupported metadata. See [report guide](docs/reports.md), [guided demonstration](docs/before-after.md), and [deployment assessment](docs/deployment.md).

GitHub Actions runs a lockfile install (lifecycle scripts disabled), TypeScript, ESLint, synthetic unit tests and the production build on Node 24.18.0. No live RPC or user secrets are needed. Run npm ci --ignore-scripts then npm run verify to reproduce locally. npm run live:smoke separately performs only three health RPC requests per approved provider. Hosted CI cannot be claimed passed until the repository is pushed and Actions runs. No remote is created automatically.

Public deployment still needs edge quotas and origin protection; process-local limits do not aggregate across serverless instances. No deployment is included in M3.
