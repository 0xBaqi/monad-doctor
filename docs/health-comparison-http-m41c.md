# M4.1C: offline HTTP/Redis integration foundation

This foundation is not exposed by an API route, UI or CLI. The production route still accepts only legacy health, gas and transaction inputs through `parseInput`. No Vercel, firewall, credential, quota or deployment configuration changes are required or made by this milestone.

## Interfaces and ownership

- `http-capacity.ts`: `ProcessCapacity.tryAcquire()` synchronously returns a distinct, idempotent `CapacityLease`, or denies admission. The exported singleton is shared with the legacy HTTP handler. Limits remain four active admissions and thirty admissions per process per 60-second window. The legacy handler releases in its existing finally boundary. Header/origin/body-size checks and legacy input parsing remain unchanged.
- `tracked-budget.ts`: `startTrackedReservation({env, fetcher, clock})` returns `decision`, `drained` and `cancel`. This strict comparison reservation requires the existing Upstash configuration even locally. It deliberately has no local bypass. The legacy `reserveBudget` wrapper and its Lua script, keys and quota values are unchanged.
- `health-comparison-http.ts`: `startHealthComparisonHttp(Request, dependencies)` returns `response`, `drained` and `cancel`. Dependencies inject the monotonic clock, Redis and Monad fetch adapters, lifecycle registration, optional capacity owner and response construction. Production use must use the shared singleton, not construct a second pool. Injection is an internal testing seam, never request-controlled.
- `parseHealthComparisonRequest` is the coordinator's existing pure parser, now exported for validation before reservation. No reconciliation or scheduling rules changed.
- `health-comparison-response.ts`: `serializeHealthComparison` produces `{comparisonResponseVersion:1,result:HealthResult}`. This internal serializer is separate from legacy Report schema 1/export version 1. It does not implement importing arbitrary external reports.

The adapter captures the capacity lease and its receiver-bound release function before asynchronous work, and rejects reuse of the same lease object. Registration of the lifecycle promise occurs before any owned body or outbound transport. A throwing or asynchronous registration callback fails closed before Redis or Monad dispatch. Registration is synchronous; it must arrange observation of the supplied drain promise through a future platform adapter.

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

## Final local verification

- Full deterministic suite: **402 passed, 0 failed, 0 cancelled, 0 skipped**, across 16 files. `npm test` reports 16 file wrappers; isolated direct execution supplied the 402 assertion count. The new integration suite contributes **52** tests. Protected legacy web/CLI boundary regressions contribute **25** of the existing tests.
- Typecheck and CLI build passed on the final source tree. Legacy CLI source and generated artifacts remain unchanged.
- Full ESLint passed with **0 errors and 5 existing warnings** in untouched `.qa/` and `demo/` scripts. Two initial test-only prefer-const errors were corrected.
- Final production build passed: compilation 41 seconds, TypeScript 52 seconds, all three static pages generated. Routes remain `/`, `/_not-found` and `/api/diagnose`; no comparison route/branch was exposed.
- An earlier sandboxed build compiled successfully but failed with `Could not parse output from TypeScript's --showConfig.` Outside-sandbox retries completed, including the final-source build. The exact cause of the subprocess-output failure was not established; it is not presented as a passed build.
- Verification caught a compatibility regression in the initial capacity extraction: capturing `Date.now` at module load prevented the legacy tests' clock replacement from advancing quota windows. The default now calls `Date.now()` dynamically as before, with an explicit regression. Deferred HTTP startup also cannot restart its admission-time allowance; a late-start test dispatches no Redis or Monad request.
- Existing engine/rules, collectors, provider endpoints, legacy schemas/exports, API route, UI, CLI, Redis script/keys/limits, package dependencies and Vercel configuration are unchanged. The only legacy runtime refactor is equivalent shared request checks and process-capacity ownership.
- Git diff checks passed. SHA-256 comparison confirms all **74 demo files unchanged**. No live Redis/Monad calls, production actions, pushes or package publication occurred.
