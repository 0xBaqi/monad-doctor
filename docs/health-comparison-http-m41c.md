# M4.1C: offline HTTP/Redis integration foundation

This foundation is not exposed by an API route, UI or CLI. The production route still accepts only legacy health, gas and transaction inputs through `parseInput`. No Vercel, firewall, credential, quota or deployment configuration changes are required or made by this milestone.

## Interfaces and ownership

- `http-capacity.ts`: `ProcessCapacity.tryAcquire()` synchronously returns a distinct, idempotent factory-issued `CapacityLease`, or denies admission. `claimProcessCapacity(owner, token?)` atomically transfers it to a private release capability. The exported singleton is shared with the legacy HTTP handler. Limits remain four active admissions and thirty admissions per process per 60-second window. The legacy handler releases in its existing finally boundary. Header/origin/body-size checks and legacy input parsing remain unchanged.
- `tracked-budget.ts`: `startTrackedReservation({env, fetcher, clock})` returns `decision`, `drained` and `cancel`. This strict comparison reservation requires the existing Upstash configuration even locally. It deliberately has no local bypass. The legacy `reserveBudget` wrapper and its Lua script, keys and quota values are unchanged.
- `health-comparison-http.ts`: `startHealthComparisonHttp(Request, dependencies)` returns `response`, `drained` and `cancel`. Dependencies inject the monotonic clock, Redis and Monad fetch adapters, lifecycle registration, optional factory-issued capacity owner/preacquired lease token, and response construction. Production use must use the shared singleton, not construct a second pool. Injection is an internal testing seam, never request-controlled.
- `parseHealthComparisonRequest` is the coordinator's existing pure parser, now exported for validation before reservation. No reconciliation or scheduling rules changed.
- `health-comparison-response.ts`: `serializeHealthComparison` produces `{comparisonResponseVersion:1,result:HealthResult}`. This internal serializer is separate from legacy Report schema 1/export version 1. It does not implement importing arbitrary external reports.

The adapter claims the factory-issued capacity token and obtains its private receiver-bound release capability before asynchronous work. A private identity registry rejects token reuse without reading ownership-object properties or invoking injected release getters. Registration of the lifecycle promise occurs before any owned body or outbound transport. A throwing or asynchronous registration callback fails closed before Redis or Monad dispatch. Registration is synchronous; it must arrange observation of the supplied drain promise through a future platform adapter.

Stages: request guards → synchronous process lease → lifecycle registration → bounded/validated body → one Redis reservation → affirmative decision and reservation drain → coordinator → immutable HTTP publication → all owned cleanup acknowledged → process release exactly once.

Coordinator admission uses a captured component lease. Its acknowledgment and `coordinator.drained` join the earlier body and Redis obligations before the outer process lease can release. Neither an HTTP response, cancellation timer nor quota denial releases an unresolved transport. A failed release or unknown cleanup is retained rather than treated as success.

## Reservation uncertainty

The request is the same fixed EVAL command against the same two keys: ten units, 200 per 60-second TTL window and 10,000 per 24-hour TTL window. There are no refunds or retries, including ambiguous execution. These are fixed reservation windows, not a sliding-window bound on completion times.

The reservation requests abort after 2,000 monotonic milliseconds and limits the response to 1 KiB. Its unavailable decision can publish HTTP 503 while fetch or body cancellation is still pending. That process slot remains occupied. Late allowed replies cannot reopen a sealed denial. Rejected cancellation and inaccessible locked bodies cannot acknowledge drain. No Monad request starts without an affirmative reservation and acknowledged admission cleanup.

Exhaustion returns HTTP 429 with rounded-up Retry-After. Missing/unsafe configuration, HTTP errors, malformed UTF-8/JSON, invalid results and transport errors fail closed without exposing upstream text, URLs, headers or credentials. No configured production keys are modified by tests.

## Cancellation and response semantics

Delivered Request aborts and explicit cancel calls stop future work and request current-stage cleanup. A pre-aborted request performs no reservation. Disconnect observability is not assumed. After report publication, cancellation cannot modify the frozen coordinator evidence; existing cleanup obligations continue.

The adapter has a 25-second monotonic cancellation watchdog, a three-second input-body allowance and the coordinator's unchanged 18-second collection budget. These leave nominal headroom below the existing future 30-second route ceiling; they are not hard real-time guarantees under event-loop suspension, broken callbacks or uncooperative transports. There is no time-based capacity refund.

A valid partial/cancelled comparison may return HTTP 200. `completed` means the collection plan completed, not that providers are healthy or their claims are correct. `cleanupPending`, ledger transport states and in-flight counts describe publication time; they are not updated by late cleanup. No polling/status endpoint or durable background job exists.

The serializer copies plain data without invoking accessors, rejects sparse/exotic/cyclic shapes, validates snapshots and qualified ledger bindings, and reuses the actual pure reconciler to validate retained relations, integrity issues and guarantees. It rejects unexpected fields rather than projecting away potentially consequential evidence. The final UTF-8 wrapper is limited to 64 KiB; oversize or invalid envelopes produce a sanitized error rather than trimmed evidence. No calldata is accepted. Legacy gas report exports still redact calldata independently.

## Offline verification and future gates

Integration tests use fake monotonic clocks and controlled transports; ambient fetch is forbidden. Cases cover shared capacity, admission bursts, thirty-request windows, exactly-once ownership, reentrant preparation, denial/uncertainty, blocked cleanup, cancellation at each stage, lifecycle failure, platform-deadline simulation, strict request protection, malformed responses, real reconciliation outcomes and legacy exports. Existing coordinator/dispatcher/reconciler and legacy HTTP tests remain required regressions.

Tests of request guards and the unchanged route do not prove live WAF coverage. This milestone does not register Next `after`, enable `supportsCancellation`, expose a comparison branch or validate real Vercel disconnect behavior. A future route composition must register the lifecycle obligation before any dispatch and verify its actual hosting behavior. Existing build-time Redis gates remain intact.

Process capacity is local and disappears on termination; it is not a distributed semaphore. Four quarantined jobs can exhaust a surviving process intentionally. A new instance has a new capacity owner. Redis spend reservations persist independently but cannot prove how many remote calls are still executing. A simulated platform deadline proves local non-release only, not survival after actual process destruction.

Node fetch/body cleanup acknowledgment is local resource bookkeeping, not proof of remote RPC termination. An abort-ignoring fetch or rejected/stalled cancellation can keep drain pending forever. Next after/waitUntil cannot extend execution beyond the platform limit or guarantee cleanup on abrupt termination. Do not claim durable background work, globally four active transports, guaranteed remote cancellation, consensus verification, provider independence or certified freshness.

## Initial local verification (9349950)

- Full deterministic suite: **402 passed, 0 failed, 0 cancelled, 0 skipped**, across 16 files. `npm test` reports 16 file wrappers; isolated direct execution supplied the 402 assertion count. The new integration suite contributes **52** tests. Protected legacy web/CLI boundary regressions contribute **25** of the existing tests.
- Typecheck and CLI build passed on the final source tree. Legacy CLI source and generated artifacts remain unchanged.
- Full ESLint passed with **0 errors and 5 existing warnings** in untouched `.qa/` and `demo/` scripts. Two initial test-only prefer-const errors were corrected.
- Final production build passed: compilation 41 seconds, TypeScript 52 seconds, all three static pages generated. Routes remain `/`, `/_not-found` and `/api/diagnose`; no comparison route/branch was exposed.
- An earlier sandboxed build compiled successfully but failed with `Could not parse output from TypeScript's --showConfig.` Outside-sandbox retries completed, including the final-source build. The exact cause of the subprocess-output failure was not established; it is not presented as a passed build.
- Verification caught a compatibility regression in the initial capacity extraction: capturing `Date.now` at module load prevented the legacy tests' clock replacement from advancing quota windows. The default now calls `Date.now()` dynamically as before, with an explicit regression. Deferred HTTP startup also cannot restart its admission-time allowance; a late-start test dispatches no Redis or Monad request.
- Existing engine/rules, collectors, provider endpoints, legacy schemas/exports, API route, UI, CLI, Redis script/keys/limits, package dependencies and Vercel configuration are unchanged. The only legacy runtime refactor is equivalent shared request checks and process-capacity ownership.
- Git diff checks passed. SHA-256 comparison confirms all **74 demo files unchanged**. No live Redis/Monad calls, production actions, pushes or package publication occurred.


## Ownership and response-integrity follow-up

The adversarial review reproduced three defects in the initial foundation: a release getter could reenter before lease consumption was recorded; a throwing getter could strand a custom allocator's slot; and contradictory ledger/status/counter metadata could pass serialization. These were defects of the unexposed integration boundary, not findings about currently exposed legacy diagnostics.

### Trusted ownership contract

Comparison owners and tokens must be exact identities issued by `createProcessCapacity`. The private registry supplies the original acquisition and receiver-bound release capabilities. Foreign owners, wrappers, proxies, cloned tokens and accessor-backed tokens are unsupported and are rejected without invoking their acquisition/release properties. An invalid owner is rejected before allocation. There is no promise to recover resources an arbitrary foreign allocator acquired independently; the adapter never calls that allocator in the first place.

A token is marked claimed synchronously before any subsequent dependency callback. A second comparison cannot consume it. The token's public legacy release method loses authority after transfer; only the captured private capability can release the comparison slot. A late old-holder release therefore cannot free a quarantined comparison or a later job. Release remains idempotent, and the thirty-admission window is never refunded.

A supplied preacquired trusted token must belong to the selected factory owner. Request-guard rejection rolls back a valid unclaimed supplied token; it cannot roll back one already claimed by another job. Invalid input, failed lifecycle registration, timer setup or monotonic-origin failures after claim release trusted capacity through the normal cleanup boundary. Replacing dependency fields after construction cannot substitute another token or owner. Unsupported caller-created wrappers remain caller-owned; their getters are never used as cleanup capabilities.

The shared singleton remains the production default. There is no second comparison pool and no public branch accepting capacity dependencies or tokens.

### Publication and serialization invariants

At publication, the fixed plan contains six or eight operations. Every operation has a sealed completed decision or an explicit skip, so `completed === dispatched` and `completed + skipped === planned`. An in-flight cleanup lease can overlap a completed decision; its count is zero or one, cannot exceed dispatched calls, and must agree with `cleanupPending` in both comparison and coordinator-error responses. The compact error variant has no ledger and validates these aggregate relationships without claiming a diagnostic result.

Ledger validation checks fixed operation identity/order, unique contiguous dispatch ordinals, normalized observation ownership, timing consistency, transport state and serial cleanup ordering. Dispatched operations require value/null/error outcomes and their dispatch/decision metadata. Skipped operations have zero accepted bytes, no dispatch metadata or transport lease, and only phase-valid reasons; bound skip observations must agree with their normalized reason. `anchor_redundant` is reserved for the two unbound historical operations of a redundant alignment, never a failed core call. Alignment status, supplied height and retained observations remain cross-checked. Quarantine termination and cleanup flags are preserved even when cleanup acknowledgment happens exactly at the grace boundary.

Collection completion is derived from actual operation outcomes: all required operations produced values, with only legitimate redundant historical skips excepted. It is not derived from reconciliation row relations. Fully collected contradictory or not-comparable claims may still have completed collection; that proves neither health nor consensus. A fully collected report can retain pending cleanup. Missing/null/error required outcomes remain partial, and cancellation remains a separate outcome. Validation never deletes contradictory or incomplete rows to make a report fit or appear valid. The final wrapper limit remains 64 KiB, and legacy report/export versions and reconciliation rules are unchanged.

Timing checks validate internal offset/observation consistency with floating-point subtraction tolerance, not a confidence score or an independent timing/finality claim. The coordinator remains the authority for dispatch deadlines; the serializer does not reconstruct elapsed wall time from relative offsets.

Permanent regressions reuse the review counterexamples and the real coordinator with controlled clocks/transports. They include rejected getter reentry/throws, shared-token reuse, trusted setup rollback, token substitution, retained quarantine, forged completeness/accounting, ordinal and skip-state corruption, inconsistent error envelopes, real complete/partial/cancelled/error outputs, collection-complete/cleanup-pending output, and exact-grace acknowledgment. No live Redis/RPC requests are used.

### Follow-up verification

- **461 tests passed**, zero failed/cancelled/skipped across **17 files**. `npm test` passed all file wrappers; direct isolated suite execution supplied individual counts. The new hardening file adds **59 regressions**. The adapted existing HTTP suite remains **52 passing tests**; dispatcher **44**, coordinator **28**, reconciler **109**, and protected legacy web/CLI boundary **25** tests also passed. These subset counts are included in the 461 total.
- The saved reentrant/throwing getter patterns now return controlled admission failure without invoking the foreign allocator or getter and without allocating any process slot. Reusing a genuine factory token rejects the second comparison while the first retains its slot. Trusted-origin/lifecycle/timer/input failures roll back once. The original forged completion/undercount and false-cleanup envelopes are rejected without modifying retained evidence or reconciliation rows.
- Final-source typecheck, CLI build, full ESLint and Git diff checks passed. Full lint has **0 errors and 5 pre-existing warnings**, all in untouched `.qa/` and `demo/` files. A temporary unused type import was removed from the new test file before final checks.
- The initial sandboxed production build compiled in 63 seconds but failed parsing TypeScript `--showConfig` subprocess output. It is recorded as a failure. A bounded outside-sandbox retry completed successfully: compilation **27.7 seconds**, TypeScript **85 seconds**, all **three static pages** generated. The route list remains `/`, `/_not-found`, `/api/diagnose`.
- An additional focused sandbox lint attempt reached its **300-second limit without diagnostics**; this is recorded as a timeout, not a pass. The completed full final lint validates the final source tree independently.
- SHA-256 checks confirm **all 74 demo files unchanged**. Engine, collectors, reconciliation/coordinator semantics, legacy HTTP handler/route, Redis reservation script/keys/quotas, UI, CLI source/generated files, legacy report/export schemas, dependencies and Vercel configuration remain unchanged from 9349950. No public comparison branch, live RPC/Redis request, push, deployment or global Git configuration change is part of this follow-up.
- The bounded focused lint retry outside the sandbox also completed with **0 errors and 0 warnings** on all five changed source/test files. The earlier sandbox timeout remains recorded separately.
