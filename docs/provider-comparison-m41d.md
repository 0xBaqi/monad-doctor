# M4.1D: opt-in provider comparison

This local implementation connects the reviewed health-only coordinator to POST `/api/diagnose`. It does not deploy the change or alter production settings. Legacy health, gas, transaction, CLI and export contracts remain separate.

## Public request selection

Without `X-Monad-Doctor-Operation`, the unchanged legacy HTTP handler processes the request. The exact value `health-comparison-v1` selects the comparison adapter. Unknown values pass the existing origin, JSON and length guards before a sanitized rejection. The selector is not authorization and cannot bypass admission.

The public comparison body is exactly `{ "mode": "health_comparison", "providers": ["primary", "secondary"], "alignSharedHeight": true }`. The shared pure parser retains the offline coordinator's boolean alignment contract; the public adapter additionally requires the shared-height plan. No calldata, arbitrary destination, method or user-selected height is accepted. Each branch reads the original request body once; no cloning or teeing is used.

A comparison consumes the same process-capacity singleton as legacy diagnostics: four active slots and thirty admissions per process window. It makes one ten-unit Redis reservation using unchanged keys, quotas and Lua accounting. There are no retries or refunds. The fixed sequential plan dispatches at most eight approved health calls, including alignment only when eligible. All existing allowlists remain in force.

The route supplies Next `after()` registration before Redis or Monad collection. It observes the adapter's existing drain promise, rather than starting collection after publication. Node runtime and `maxDuration = 30` are unchanged. No cancellation, WAF, secret or Vercel configuration is changed.

## Publication versus cleanup

The adapter captures one monotonic admission origin and a 25-second publication deadline. At the deadline it seals HTTP 504 with fixed, sanitized timeout text, requests cancellation and prevents new collection. Late publication cannot replace the sealed response, including when the timer callback was delayed. The three-second body, two-second reservation decision and eighteen-second coordinator budgets remain bounded by the lifecycle.

Publication never acknowledges cleanup. Request readers, Redis requests and RPC transports may remain unresolved after any response. Capacity releases exactly once only after every owned obligation drains. Rejected or unknown cleanup stays pending. A completed collection can have pending cleanup; a contradiction can exist in a completed collection. No response or abort request proves remote termination.

The browser uses a 28-second comparison timeout. Cancel stops waiting, invalidates the job identity, requests browser-fetch abort and returns keyboard focus to submission. A late response cannot replace a newer report or its status. There is no cancellation API, polling, automatic provider switching or retry. Retry-After disables explicit submission until its indicated window expires.

## Response and export contract

`comparisonResponseVersion: 1` wraps the original `HealthResult`. The public decoder accepts only bounded UTF-8, compact serializer output. It rejects unsupported versions, duplicate/ambiguous keys, unknown fields, invalid result types, forged ledger/counters/status, wrong provenance and missing evidence. HTTP status, media type and captured input are checked independently. A valid coordinator-error wrapper requires HTTP 500 and never becomes a diagnostic report. Upstream error strings are never displayed.

Downloads contain the validated captured compact serialization, capped at 64 KiB for the complete wrapper. No evidence is trimmed to fit. Legacy JSON downloads still use `exportReport` and its existing calldata redaction, without modification. Comparison accepts no calldata at all.

## Presentation

RPC health defaults to one provider. A native radio group opts into both approved public providers and preserves the prior single-provider selection. Selecting a scope, reading evidence or exporting makes no request.

The dedicated view distinguishes collection status, typed reconciliation relations and publication-time cleanup. Contradictions, wrong-network context and integrity warnings precede ordinary field matches. Matching chain IDs on the wrong network cannot produce a positive Monad summary. Height differences do not establish lag or its cause. Historical agreement does not certify freshness. No provider scores, consensus claims or universal health verdict are generated.

Each row labels both provider observations. Evidence navigation includes run, provider, collection and numeric ID in a collision-free DOM key. Recorded wall timestamps and monotonic offsets are shown separately from client receipt time. Changing mode/scope marks the retained report as a previous snapshot. Mobile uses stacked observations; desktop aligns the provider columns. Native disclosures, focus indicators, 44px controls and status/error announcements support keyboard and screen-reader use.

## Offline verification

The deterministic fixtures run the actual coordinator. The new presentation/HTTP suite covers strict decoding, every header selection with legacy/comparison/malformed inputs, wrong networks, contradictory finalized claims, differences, partial/cancelled evidence, reference corruption and publication/cleanup races. Existing ownership, reservation, coordinator and legacy suites remain regressions. Two native Node fetch tests use a controlled loopback HTTP server and barriers to cancel before headers and during stalled body reading; they contact no third-party endpoint.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run cli:build`, `npm run build` and `git diff --check`. The loopback tests require permission to bind 127.0.0.1.

Run browser acceptance against the optimized local server with `node --experimental-strip-types scripts/comparison-browser.mjs`; set `MONAD_DOCTOR_CHROMIUM` if needed. It refuses non-local application URLs, blocks non-local browser requests and mocks every diagnostic request. Screenshots, validated downloads and check results are saved under `evidence/verification/provider-comparison-m41d/`. The existing `scripts/guided-browser.mjs` separately checks legacy behavior with deterministic mocks. The older live `browser-check.mjs` is deliberately not used for this offline task.

## Operational limitations and release gates

No staging/platform claim follows from these tests. Verify actual Next lifecycle registration, Node fetch cleanup, delivered disconnect signals, route duration, same-process slot retention, Redis accounting and WAF path/host coverage before an authorized release. A staged hostname alone does not prove coverage on both production aliases. Keep Deployment Protection enabled and require separate approval for deployments, settings and promotion.

Capacity is process-local, not a distributed semaphore. Process termination destroys it. `after()` cannot outlive the hosting execution limit or guarantee cleanup after termination. Some disconnects may not be observable without a separately approved platform setting. Uncooperative transports can retain a surviving process slot indefinitely. Local cleanup acknowledgment is not independent consensus verification or proof that a remote server stopped executing a call.

## Final local acceptance

- Full final suite: **524 passed, 0 failed, 0 cancelled, 0 skipped**. This includes **61 new comparison experience tests** and **2 new native loopback cancellation tests**, plus all 461 existing regressions.
- Comparison browser acceptance: **33 checks passed** at **390px and 1440px**, including ten report variants per viewport, keyboard scope selection, remembered provider, evidence focus, compact downloads, stale scope, duplicate-submit blocking, Cancel focus return, late-response suppression, invalid responses, access denial and Retry-After. No browser JavaScript errors or page-wide horizontal overflow were observed.
- Existing mocked guided acceptance: **23 checks passed**, with fourteen mocked diagnostic submissions and zero live RPC calls. Legacy transaction dimensions, gas uncertainty, calldata redaction, exports, validation and mobile behavior passed.
- Typecheck, CLI build, final ESLint and production build passed. Lint reports **0 errors and 5 pre-existing warnings** in untouched `.qa/` and `demo/` scripts. The final optimized build compiled in **44 seconds**, completed TypeScript in **29.9 seconds** and generated three static pages. Routes remain `/`, `/_not-found` and `/api/diagnose`.
- A sandboxed final build compiled but failed parsing TypeScript `--showConfig` output; the completed outside-sandbox retry is the build counted above. A final sandbox lint attempt timed out at **180 seconds without diagnostics**; its bounded outside-sandbox retry passed. Initial browser launch failed because Chromium's saved shared libraries were not on its search path; using the already-present library directory resolved it without installing dependencies. An initial browser test had an ambiguous alert selector matching Next's empty route announcer; the corrected harness passed on the final optimized build.
- The independent publication deadline intentionally changes the old overall-expiration expectation from HTTP 408 to HTTP 504; the regression still proves no dispatch after expiration. Earlier body-input timeouts retain their existing status.
- Saved synthetic screenshots and downloads are under `evidence/verification/provider-comparison-m41d/`; `checks.json` records the comparison browser assertions. Desktop and mobile screenshots were visually inspected.
- Protected engine/rules, RPC collectors/allowlists, Redis script/keys/quotas, legacy HTTP handler, schema/export, CLI source/generated artifacts, dependency manifests and deployment/security configuration have no diff. All **74 demo files** match the original SHA-256 preservation manifest. No live Monad/Redis requests, push, commit, deployment, package publication or settings change occurred.
