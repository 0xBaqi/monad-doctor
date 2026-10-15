# M4.1B: offline bounded health coordinator

This is an unexposed internal module. No API route, UI, CLI command, export importer or default network transport is installed. `startHealthComparison(request, dependencies)` requires an explicit fetch adapter and an admission lease. Tests use synthetic transports only. Importing the module performs no IO. The caller must obtain real admission before any future production use; the offline lease interface does not itself perform Redis admission or enforce the HTTP four-job limit.

## Contracts and isolation

`HealthComparisonRequest` accepts only `mode: 'health_comparison'`, the explicit canonical pair `['primary', 'secondary']`, and `alignSharedHeight`. Unknown fields, accessors and malformed pairs are rejected. Each invocation captures the request and creates or accepts a run ID before any dispatch. Test dependencies supply fixed run IDs, a fake monotonic clock and fixed wall time. Run IDs supplied by future trusted callers must be unique; the pure module cannot authenticate an asserted provider identity or prevent reuse of an arbitrary caller-chosen ID.

The handle exposes `result`, `drained` and idempotent `cancel()`. A lease object is single-use, even after draining. A valid comparison releases that lease exactly once, after publication and transport quiescence. Invalid construction does not consume it. Existing HTTP/Redis/WAF admission ownership remains unchanged and disconnected; sharing its capacity safely is a separate integration requirement.

Admission ownership is captured at construction, including the original release method bound to its original receiver. Replacing the dependencies' admission property or changing that method later cannot substitute the released lease. A release failure rejects `drained` without retrying release or making the lease reusable.

The fixed plan contains C (chain), F (finalized), L (latest), and optionally H (shared explicit height), each primary then secondary. Every transport invocation is owned by one dispatcher. Its private plan binds provider, destination, method, parameters, run, collection and evidence ID. No public operation takes an endpoint or arbitrary RPC method. `rpc-providers.ts` is a coordinator-only immutable map mirroring the legacy collector's two destinations. Mocked parity tests verify both providers against the unchanged legacy collector. The proposed shared-map extraction was avoided because it would also change tracked compiled CLI files. Existing collector source, request behavior, budgets, parsing, cancellation and CLI artifacts remain intact; a future shared-map refactor would need to include its generated-artifact implications explicitly.

The coordinator never calls `diagnose`, `createRpc`, or `fetch` directly. It reuses the pure reconciler rather than creating a second diagnostic engine. No wallet, transaction, gas, signing or submission operation is supported.

## Scheduling and accounting

- A run has at most eight planned operations; a plan ID may dispatch at most once.
- A private counter charges before invoking the fetch adapter, including synchronous throws. Its absolute guard is ten. With a fixed eight-entry plan and one invocation per entry, dispatched calls are at most eight, below the reserved ten-call allowance. Failures and cancellation do not refund credit; unused credit cannot fund supplemental calls or retries.
- There is one active transport lease per comparison, including body cleanup. Redirects are disabled. There are no retries or provider switches.
- Scheduling uses one monotonic origin, a shared 18,000 ms deadline, 2,000 ms work allowance per operation, and at most 250 ms cleanup allowance. Wall time supplies observation provenance only.
- Each phase reserves 2,250 ms per eligible provider. If the remaining collection time cannot fund its eligible operations, they are skipped with `phase_capacity`. An operation cannot borrow the next provider's work allowance. Phases advance immediately after safe completion; they do not idle until the reservation expires.
- A provider's block operations require its own successful expected chain identity. Wrong/unknown network, rate limiting, missing anchors, deadline exhaustion, cancellation and quarantined capacity have distinct ledger skip causes. A provider rate limit stops its remaining operations for the run; the other provider remains a preplanned participant.

The ledger distinguishes planned, dispatched, completed decisions, skipped operations, and still-in-flight transport. Completed and in-flight counts can overlap: a timeout decision may be complete while its cleanup is not. Skipped operations have no dispatch ordinal. Bound skipped snapshot entries have no fabricated observation timestamp; unbound historical operations have no dangling evidence reference.

Dispatch synchronously reserves operation identity and a unique capacity lease before calling injected clocks, timestamp functions or transports. Same-operation reentry is rejected; other operations cannot overlap the reservation. Credit is charged only immediately before transport invocation, after cancellation and absolute-deadline checks following preparation callbacks. Cancellation/expiry during preparation skips without invoking transport; a thrown preparation callback skips with `preparation_error`, releases the unused reservation and rejects with a sanitized error. Cleanup releases by lease object identity, never by an operation label.

Clock failures while collecting evidence fail closed: timing-dependent evidence becomes unavailable, publication may be quarantined immediately, and acknowledged cleanup can still drain using the last valid monotonic reading for bookkeeping. No further transport is dispatched after a failed monotonic read. Timer-removal exceptions cannot reopen sealed work. This does not establish accurate elapsed time after clock failure, nor guarantee progress from an uncooperative clock, event loop or transport.

Representative deterministic traces:

| Trace | Result |
| --- | --- |
| Six immediate healthy observations | Six calls; no artificial delay. |
| Eight valid responses, each after 1,999 ms | Eight equal 2,000 ms work windows; 15,992 ms total simulated collection. |
| Two cooperative chain timeouts | Two calls; six optional/dependent plan entries skipped; no retained transport. |
| First fetch ignores abort | Timeout at 2,000 ms; quarantine and partial publication at 2,250 ms; no second dispatch. |
| Conflicting finalized hashes followed by two cooperative latest timeouts | Six calls; finalized claim contradiction remains visible. |
| Scheduler resumes after a deadline | Late evidence rejected; no catch-up burst of dependent requests. |

The eight 2,250 ms reservations fit 18 seconds. This is an application budget under a functioning event loop, not a hard real-time guarantee across process suspension or synchronous parsing. The existing five-second collector timeout is untouched; comparison observations have the intentionally shorter fair-share allowance.

## Cancellation and immutable publication

At a work deadline or user cancellation, seal an unavailable observation (`TIMEOUT` or `CANCELLED`), request abort, and stop accepting values. After 250 ms without cleanup acknowledgment, quarantine the lease and stop the plan. `result` can resolve with frozen partial/cancelled evidence; `drained` cannot resolve merely because the decision deadline passed.

Fetch settlement alone is insufficient if a response body remains. The dispatcher waits for body consumption or acknowledged cancellation and releases its reader lock. Late responses are disposed, never accepted as replacement evidence. Rejected cancellation or inaccessible/locked body cleanup is fail-closed. A transport that never settles, or cleanup that never acknowledges, can keep `drained` pending indefinitely. No guaranteed cleanup or unconditional provider fairness is claimed for such a transport.

Published envelopes and ledger entries are detached, deeply frozen copies. Later private transport-quiescence bookkeeping can resolve `drained` and release admission, but cannot mutate published evidence, counters or serialized results. At publication, `cleanupPending` and transport state accurately retain the outstanding condition; they are snapshots, not live status objects.

Grace expiry uses the monotonic clock as well as the timer callback. Cleanup acknowledged at or after that deadline cannot win a delayed-timer race and resume the plan. The ledger retains `cleanupExceeded` even if the transport has actually drained by publication; in that case termination remains `transport_quarantined` while `cleanupPending` is false.

## Provenance, alignment and reconciliation

Core collections use `{runId}.{provider}.core`; supplemental observations use `{runId}.{provider}.alignment`. References retain `{ runId, provider, collectionId, evidenceId }`. Numeric IDs may repeat in qualified namespaces. Final snapshots pass M4.1A's strict validation and preserve original reported values, including wrong returned historical heights as explicit integrity issues.

Optional alignment requires complete consistent core observations and different finalized heights. It selects the smaller reported finalized height, records both source references, and independently requests that exact height from both providers. No provider's block is substituted for the other's response. Equal finalized heights skip redundant alignment, including conflicting same-height finalized claims; no extra requests try to resolve the contradiction. Unavailable anchors produce explicit ledger skips and no invented historical subject.

Reconciliation rules are versioned `m4.1b`. A narrow exception reports incompatible finalized RPC claims when both networks are expected and usable finalized observations have equal heights and different hashes. This remains observable despite unrelated latest errors or internal-integrity warnings. The contradiction row depends on the two chain and two finalized references; all integrity issues remain present. It proves neither claim correct and is not a consensus violation finding.

Positive matches and position differences retain the complete-bundle prerequisites. Removing a conflicting observation cannot turn an integrity failure into a positive match. Required chain/finalized observation loss weakens the direct contradiction. Legacy diagnostic rule version `m3.1`, report schema 1 and export version 1 are unchanged. The health-only normalized error union adds explicit `CANCELLED`, without changing legacy `RpcError` or exported reports.

## Size and security bounds

Each call accepts at most 1 MiB of body bytes; at most eight calls accept at most 8 MiB cumulatively. Only one raw body is processed at a time. These are application acceptance bounds, not bounds on packets sent by an upstream server or chunks already allocated by a transport. Fatal UTF-8 decoding, JSON-RPC version/ID checks, and method-specific narrow field validation precede acceptance. Arbitrary upstream text, error data, extra block fields and headers are not retained. There is no calldata input.

The internal publication boundary measures the UTF-8 encoded wrapper against 64 KiB. Oversize yields a small `OUTPUT_LIMIT` coordinator error rather than dropping findings or provenance to fit. `boundedHealthResult` is for internally constructed envelopes, not validation/import of arbitrary external reports.

## Future integration gates

Production transport cancellation and cleanup need separate operational validation. The real admission owner must retain a comparison's capacity until `drained`, including after early HTTP publication; the current legacy handler's unconditional `finally` release cannot simply wrap this lifecycle. No HTTP capacity refactor or Redis reservation happens here. Callers cannot treat an operational `completed` envelope as a universal passing diagnostic verdict, nor `partial` as absence of disagreement. Provider agreement still proves neither independence, current freshness nor independent consensus verification.

## Ownership regression verification

The follow-up adds 24 deterministic tests: 18 dispatcher and six coordinator cases. Dispatcher coverage includes timestamp/clock/timer/transport reentry, 96 rejected amplification attempts across an eight-invocation plan, pre-dispatch cancellation/expiry, preparation and post-invocation clock exceptions, retained quarantine during a clock failure with ignored abort, and stale callbacks during a later lease. Coordinator coverage includes captured receiver/method ownership, substitution before collection and during quarantine, multiple drain waiters, failed construction, consumed-lease reuse and release failure. No live RPC requests are used; final verification results are reported with the follow-up commit.

## Initial implementation verification

- Dispatcher suite: **26 passed**, including two mocked destination-parity tests against the unchanged legacy collector.
- Coordinator suite: **22 passed**. Coverage includes serial phase order, eight slow observations, ignored abort, cooperative cancellation, late/grace-deadline races, single-use admission, four retained offline capacity leases, partial results, explicit alignment and size rejection.
- Pure reconciliation suite: **109 passed**, including the new direct-claim exception, required-evidence loss, provider symmetry and preserved positive-result dependencies.
- Full deterministic verification: **326 passed, 0 failed** (169 other existing tests). `npm test` passed all **15 files**; direct execution of each suite in its own process supplied the individual counts because the environment's child-test reporter aggregates file outcomes.
- Standalone TypeScript, CLI build, final ESLint, production build and Git diff checks passed. ESLint reported **0 errors and 5 pre-existing warnings** in `.qa/` and `demo/`, with none in changed files.
- One initial sandboxed ESLint attempt reached its 600-second bound without a result. A bounded outside-sandbox retry passed, and the final full run after the collector-preserving adjustment also passed. The precise initial timeout cause was not established. Final production build completed within its 900-second bound, including compilation, TypeScript, all three static pages and route output.
- Legacy collector, engine/rules, HTTP/API/security, UI, CLI source and tracked CLI artifacts, package configuration and legacy exports match the baseline. The coordinator remains unimported by those paths. No live RPC/HTTP calls, push or deployment commands were performed. Tests explicitly forbid global fetch and inject controlled transports.
- SHA-256 verification confirmed all **74 `demo/` files** unchanged.
