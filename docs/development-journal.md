# Development journal

## 2026-10-10 — Workspace, research, foundation
- User approved architecture and path. Exact PowerShell probes confirmed Projects and monad-doctor absent; ancestor AGENTS.md absent. Node 24.18.0, npm 11.16.0, Git 2.53.0 available.
- Normal directory creation failed with UnauthorizedAccessException. Escalated creation succeeded. Normal apply_patch stalled; subsequent directory inspection showed no files. Switched to scoped PowerShell writes with sandbox escalation. All writes are confined to this project.
- Official sources: https://docs.monad.xyz/reference/json-rpc/overview ; https://docs.monad.xyz/developer-essentials/gas-pricing ; https://docs.monad.xyz/monad-arch/consensus/block-states .
- Mainnet chain ID 143. RPC overview: latest=Proposed, safe=Voted, finalized=Finalized. Receipt presence is not finality; null is not proof of dropped/pending. Gas limit is charged; documented per-transaction cap 30M.
- Official pages have conflicting version/block-gas figures. Read block gas limit from evidence; avoid hardcoded throughput/finality timing assumptions.
- Implementation order: deterministic engine and synthetic tests, separately recorded live observations, dashboard, all required checks.


## Engine and live milestone
- 22 initial synthetic tests passed, expanded to 25 after adding stalled body cancellation, exact Content-Type validation and call-count checks.
- All three engine workflows and responsive dashboard implemented. JSON export includes projected, validated fields; arbitrary upstream error messages/data excluded.
- Initial actual RPC run failed TLS on both endpoints. A diagnostic probe identified UNABLE_TO_VERIFY_LEAF_SIGNATURE for RPC and npm. NODE_USE_SYSTEM_CA=1 fixed HTTPS using Windows trusted certificates; TLS verification stayed enabled. Stalled initial npm install was interrupted and retried.
- Successful live collection: evidence/live/2026-10-10T06-34-48-846Z/. Both providers passed chain/head checks and returned finalized transaction evidence. Live unsigned padding example changed from 1,000,000 to measured 21,000 gas. Primary sampled price 102 gwei: conditional fees 0.102 vs 0.002142 MON; no funds moved.
- Repeated lifecycle samples were already finalized. Do not claim an observed provisional transition or independently verified consensus proof.

## Verification fixes
- TypeScript provider narrowing widened through an object literal; fixed with an explicit Pick<Input, mode | provider> annotation. All 25 tests and typecheck pass.
- Upgraded ESLint 9 to compatible ESLint 10; lint identified the brand home link and it was changed to Next Link.
- Turbopack rejected the UTF-8 BOM written by Windows PowerShell in tsconfig.json. Normalized project text to UTF-8 without BOM. Subsequent source writes use Node.
- Browser-control session timed out. Installed browsers are available; using a small development-only Playwright Core dependency with existing Chrome for reproducible desktop/mobile and form QA.

- All required checks passed after BOM and Link fixes. Split the alert and severity-badge CSS classes to keep validation errors readable.
- ESLint 10 itself ran, but three Next lint plugins declare peer support only through ESLint 9. Pinning 9.39.5 for a compatible reproducible toolchain rather than keeping peer overrides. It is a development-only dependency.

## Browser-discovered origin issue
- Production UI rendered without overflow, but the first real form request returned HTTP 403. The same-origin guard compared against the normalized internal Next URL.
- Changed the guard to compare the serialized browser Origin with the request Host authority (falling back to URL only when Host is absent), rejecting malformed/foreign origins and ignoring X-Forwarded-Host. Added a regression test that reaches input validation for a legitimate externally visible host and rejects spoofed forwarded hosts.

## M1 complete
- Final npm run verify: 26 unit tests passed; TypeScript, lint and production build all passed. Logs under evidence/verification/.
- Corrected production app passed all eight browser checks: actual health, gas before/after, transaction finality, JSON export, meaningful validation error, desktop/mobile overflow checks and no JavaScript errors. New actual UI evidence under evidence/live/ui-2026-10-10T11-34-19-374Z/.
- Visually inspected desktop and 390px mobile screenshots. No clipping or horizontal overflow. No fabricated results, wallet connections, signing or transaction submission.
- Git initialized on main only within the approved new project. No unrelated repositories changed.
- Limits remain explicit: finality is provider-attested; live samples did not capture a provisional transition; fees in the example are conditional calculations. Runtime deployment and distributed rate limiting remain outside M1.

## M2 audit and focused fixes
- Inspected M1 source, docs, recorded evidence, and Git status: all project files untracked, no commits. No unrelated changes identified.
- Rechecked official gas-pricing, JSON-RPC overview, and block-states documentation. Existing tag mapping, gas-limit charging, 30M transaction cap, and null lookup semantics remain documented.
- Found mode coercion (an array could pass initial validation), missing explicit inclusion findings, missing finalized-state freshness warnings, and no explicit estimate-above-cap outcome. Fixed these without changing workflows.
- Body reads now share the remaining RPC deadline instead of starting a separate five-second allowance; cancellation rejections are consumed. Removed unused getCode allowlist entry and rejected cross-site Fetch Metadata requests.
- Sandbox again denied file writes and test child processes with EPERM. Used scoped escalated execution after the failures.

- Sharing exports now redact calldata in both normalized input and estimate parameters without changing the local report. Added 14 deterministic regressions for security, numerical, incomplete-evidence, timeout and lifecycle cases. Live validation includes at most eight receipt probes per provider within an 18-second collector budget; absent examples stay absent.

- Initial M2 verification: 40/40 synthetic tests, TypeScript, lint and production build passed. Both live providers returned successful and failed execution examples with matching finalized block evidence; all-zero hashes returned null transaction/receipt. Root causes are not inferred from failed status. Added explicit concurrency/rate-limit regressions for the existing process guards.
- npm audit found five high entries from one unpatched braces advisory in the lint dependency chain. Official advisory lists no patched version: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm . No forced Next lint-config downgrade or new dependencies; production-only audit checked separately. Run lint only on trusted repository inputs and track the upstream fix.

- First M2 browser acceptance attempt stopped on a real 5,011 ms eth_estimateGas timeout. The app correctly retained chain/block evidence, labeled the estimate unknown, and offered no fallback. Original report: evidence/live/ui-2026-10-10T11-59-16-093Z/gas-before.json; failed check record preserved in evidence/verification/m2-browser-first-attempt.json. Rerun is a separate observation, not a replacement of the failed evidence.
- Production-only npm audit completed with zero vulnerabilities. Full audit retains five high entries from the single unpatched development-tool advisory; counts and command provenance recorded in evidence/verification/m2-security-audit.json.

## M2 complete
- Final verification: 42/42 deterministic tests (16 new), TypeScript, lint and production build passed. Second production-browser attempt passed 9/9; first real estimate timeout preserved separately. Browser evidence: evidence/live/ui-2026-10-10T12-13-09-282Z/.
- Both allowlisted providers passed live chain/head/gas checks and yielded successful and failed finalized transactions. No live finality transition captured; no root failure causes invented.
- Existing before/after example and dependencies preserved. Full security audit has one unresolved development-tool advisory (five high package entries); production audit is clear. Documentation records limitations and M3 recommendation. Git remains all untracked on main with no commits. Local QA server stopped; no deployment or financial actions.

## M3 foundation - October 10, 2026
- Inspected Git, source, docs and all 95 project artifacts outside dependency/build/Git directories (about 1.3 MB). No existing commits/remotes, no secret-pattern matches or private key/environment files found. RPC hashes are public identifiers; stored demo calldata reviewed separately before staging.
- Added deterministic GitHub Actions validation (Node 24.18.0, lockfile install without lifecycle scripts, typecheck, lint, tests, build; no live RPC or secrets).
- Replaced clone-and-redact exports with explicit validated projection, nested evidence sanitization, safe errors, source/reference checks and reproduction metadata. Added expandable explanations to existing finding cards.
- Tightened Content-Length validation and UTF-8 errors; handled rejected HTTP body cancellation. Expanded ignore rules for local exports, private key files and temporary artifacts.
- Initial write script failed to parse a GitHub expression embedded in a JavaScript template literal; no files were written by that attempt. Corrected by constructing the workflow as literal lines.

- Verified official action v4 tag hashes with git ls-remote and pinned both CI actions to immutable commits. Git author identity is already configured. No remote added.
- Added nine deterministic M3 regressions and one browser guidance check. Baseline review script checks candidate files, ignore rules, JSON credential/calldata fields and built client bundles without printing secret contents.

- All 51 unit tests passed before the build checks. Six-request live smoke passed both providers: evidence/live/m3-smoke-2026-10-10T12-45-39-404Z/. Fresh production audit reports zero vulnerabilities.
- The first clean install did not finish after roughly 12 minutes; its last log entries were registry metadata revalidation. Interrupted only that task-owned install and retried cache-first with automatic audit disabled. Dependency versions and lockfile retained. CI also separates installation from advisory review.

- Cache-first lockfile installation completed successfully: 355 packages in seven minutes, install scripts disabled and no dependency upgrades. Workflow YAML parsed successfully; both actions pinned, token permissions read-only, credentials not persisted. No app/lib environment-variable reads or console logging found.

- Post-install verification caught a TypeScript-only issue in the new error-export test: the result/error union needed an explicit discriminator. Runtime tests and lint passed. Added the narrowing assertion and reran verification.

## M3 verification complete
- Final local verify: 51 tests, TypeScript, lint and production build all passed. Earlier build attempt timed out; no successful build was claimed until the rerun completed.
- Ten production-browser checks passed, including new guidance and export metadata. Actual UI evidence: evidence/live/ui-2026-10-10T17-11-16-723Z/. Both providers also passed the limited health smoke.
- Final scan found no candidate secrets or server endpoint URLs in client bundles; ignored directories/material confirmed. Reviewed public evidence remains separate from synthetic tests. Preparing the authorized initial local baseline commit after the final staged-file check. No remote or deployment configured.

- Final staged review found only trailing blank lines and Windows line-ending warnings. Removed surplus EOF blank lines (no code or evidence values changed) and added repository-local LF attributes for cross-platform consistency. The reviewed baseline includes 111 small project/evidence files; dependency/build/private directories are excluded.

## M4 initial review ? 2026-10-10

Confirmed clean M3 baseline 7de39a7 and no remote. Captured desktop 1440px and mobile 390px screenshots under ignored .qa. Initial full-load browser navigation timed out; bounded DOM-ready retry captured both views. Preserved the lavender dashboard and three workflows. Focused changes clarify product purpose/inputs, add keyboard skip navigation, improve supporting text contrast and input/button sizing. Added a 30-second Vercel function duration and ignored local .vercel metadata. Prepared repeatable demo storyboard separating historical/live evidence from synthetic wrong-network fixtures. Vercel CLI account check required system CA trust; no TLS bypass. Publication awaits destination and deployment security decisions. Verification of changed code is pending.

M4 verification follow-up: all 51 tests, TypeScript, lint and build passed. PowerShell converted newly inserted arrow characters to question marks; replaced them with HTML entities and rebuilt successfully. Both limited smoke requests timed out. The later live browser run recovered for health and gas/export checks, but transaction chain identity timed out; retained the unknown report and failed assertion. Focused UI first attempt passed skip navigation and three widths, then timed out opening gas; added an explicit network-idle readiness wait for the bounded retry. No diagnostic findings were fabricated or weakened to pass checks.

Final focused M4 browser retry passed all seven checks, including keyboard skip link, 1440/390/320px layouts, labeled 16px mobile inputs, loading lockout and synthetic accessible 429. ESLint passed again after the new script. Screenshots: evidence/verification/m4-1440.png, m4-390.png and m4-320.png.

## M4.5 ? protected deployment foundation

Verified clean 880e038 checkout and no remote. Repeated working-file scan: no findings; all reachable history scan covered two commits and 142 blobs with no findings. Installed official GitHub CLI via winget, installer hash verified; no GitHub authentication was present, so no ownership or destination availability claim and no repository creation/push. Verified Vercel user adewaleagboola444-8813 owns 0x-baqi on Hobby. Confirmed destination absent, created and linked only monad-doctor. Link automatically wrote ignored local OIDC credentials; contents were not printed or committed. Published and verified live API-specific per-IP firewall rule, six requests per 60 seconds. No paid activation and no app deployment.

Added dependency-free Upstash REST EVAL reservations: ten RPC units/run, 200/60-second and 10,000/24-hour windows. Production and Vercel fail closed on missing configuration, outages and malformed responses; exhaustion returns 429 with Retry-After. Seven deterministic tests added, 58 tests passing; TypeScript/lint/build passed. These tests do not substitute for actual Redis atomicity/concurrency verification, still blocked by account credentials.

Investigated intermittent RPC behavior using four bounded read-only calls. Both native fetch and collector returned chain 143 on both providers. Primary timings 2029/497 ms; secondary 943/659 ms. This sequential sample did not reproduce prior failures and does not identify their root cause. Historical timeouts remain recorded. Production browser fail-closed verification is tracked separately.

## M4.5 resumed validation

GitHub authentication now verifies 0xBaqi; the proposed repository returned authenticated 404. File and three-commit history scans passed. Production Redis variables exist as Sensitive; Preview is absent. Vercel intentionally withholds Sensitive values from local pulls, so the local validator stopped at configuration before any Redis/RPC request. No secret was exposed or downgraded. Added a Vercel server-side build gate: normal production build, then isolated live Redis validation; a failed validation exits nonzero before deployment publication. Credentials stay within the intended Vercel build environment. Test keys use a UUID namespace and expire automatically; production counters are untouched. Explicit .vercelignore excludes local environment files and QA artifacts.

Release checks exposed a real timer-ordering defect: a stalled RPC response body could throw the generic validation error before the outer abort callback fired, producing MALFORMED instead of TIMEOUT. Added BodyTimeoutError and explicit RPC classification, plus a deterministic regression. Incoming request-body timeouts now return safe HTTP 408. No timeout was extended and no failed live observation was rewritten. GitHub repository 0xBaqi/monad-doctor was created publicly after authenticated ownership, absence and secret/history checks; the first push awaits the corrected local checks.

## Release attempt ? 2026-10-11 (blocked)

Public repository: https://github.com/0xBaqi/monad-doctor . Reviewed history was pushed normally. Hosted Validate run https://github.com/0xBaqi/monad-doctor/actions/runs/38108185671 passed for e584ba8538bdda4ad0c17b6315f28446e4bd3470. Local verification: 59 tests, TypeScript, ESLint and production build passed.

Vercel project remains 0x-baqi/monad-doctor on Hobby, with the live API firewall rule at six requests per 60 seconds per IP. Production Redis URL/token are Sensitive; Preview has neither and therefore fails closed. Sensitive values cannot be pulled into the local validator. The Vercel build gate runs the isolated validation server-side before publication.

Deployment dpl_G3qFPHAtgJmsXKkMcJZUWhrNg351 failed the gate at 2026-10-11T03:25:53Z. Next.js compilation passed and exact Redis values were absent from scanned source, evidence/logs and client bundles. The first real reserveBudget call did not return allowed. The sanitized log does not identify whether configuration, authentication, network transport or Redis command execution caused it; no credential defect or provider outage is asserted. See evidence/verification/vercel-redis-gate-failure.json. No production counters were touched; only the UUID test namespace was selected. Concurrent/exhaustion checks and deployed browser acceptance did not run.

No working production URL is claimed. The generated deployment URL belongs to an ERROR deployment, not a released application. Per user instruction, no second live Redis attempt or deployment was made after this failure. No paid features, signing or transactions were used.

Next gate: diagnose the first reservation with safe metadata (configuration-validity booleans, HTTP status, timeout/error category; never raw response text or credentials), then verify isolated concurrency/exhaustion before release. Check the dedicated database uses the correct HTTPS REST endpoint and write-capable token, with no accidental whitespace; the present evidence does not prove these are wrong. Keep Vercel variables Sensitive. Preview configuration can be added separately when needed. M5 submission readiness is blocked on the shared-limiter validation and actual production acceptance.


## Redis gate recovery - 2026-10-11

One bounded Vercel Production validation attempt returned HTTP 401 in 114 ms at 03:51:30.587 UTC. The category is http_authentication; the build and TypeScript compilation succeeded, but the gate correctly blocked publication. No production counters were touched. Concurrency/exhaustion and production acceptance did not run. The earlier failure's precise cause remains unproven; the new observation establishes authentication failure for the currently configured URL/token pair, not which value is incorrect. Evidence: [sanitized recovery record](../evidence/verification/redis-recovery.json).

Added server-only diagnostic categories and 11 deterministic regression tests (70 total passing), covering missing/invalid configuration, HTTP authentication/rate limits/errors, transport/TLS/timeouts, malformed replies, Redis command errors, counter state and redaction. Only category, optional HTTP status and duration are emitted. Public API errors remain generic. Local TypeScript, ESLint and production build passed. File/client-bundle and reachable Git-history scans found no indicators; exact credential scanning also passed in the Vercel build. The existing live firewall remains enabled at 6 requests per 60 seconds per IP. No configuration, dependency, firewall or fail-closed policy was weakened.

The existing POST JSON command [EVAL, script, 2, minuteKey, dayKey] matches [Upstash REST command-body semantics](https://upstash.com/docs/redis/features/restapi). HTTP 401 denotes failed authentication; no evidence supports changing the command format.

Required account action: In Upstash, open monad-doctor-ratelimit and copy its HTTPS REST URL and standard read/write REST token (not the read-only token). In the existing Vercel monad-doctor project under scope 0x-baqi, replace UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for Production, keeping both Sensitive. Use the corresponding pair from the same database, with no quotes, whitespace, or Bearer prefix; the URL must be the HTTPS root endpoint, not a redis:// connection string or command path. Do not paste credentials into chat or logs. Configure Preview separately only if Preview diagnostics are intended. Save, then authorize one further gated validation attempt. No second attempt was made during this recovery.


## Current production release - 2026-10-11

Live application: https://monad-doctor.vercel.app . Deployed source commit: 4075ddfe666fb8d4bbd3e7d3cfc9d92debc1094f. [Hosted CI passed](https://github.com/0xBaqi/monad-doctor/actions/runs/38113612827): 70 deterministic tests, TypeScript, ESLint and production build.

After the owner corrected the matching Production REST credentials, one gated deployment attempt passed at 05:06:07 UTC. Authentication returned HTTP 200 in 101 ms. Isolated concurrency (maximum 4) admitted 20 reservations and rejected 4; the exhausted HTTP boundary returned 429 with zero Monad RPC calls. Injected outage/malformed replies failed closed. Exact credential scanning passed. Production counters were not touched by gate tests. The existing live firewall remains enabled at 6 requests/60 seconds/IP; the shared budget and all API safeguards are unchanged. No paid resources were enabled. See [gate evidence](../evidence/verification/redis-release-gate.json).

Production acceptance passed 12 checks across two runs: desktop/keyboard navigation, primary RPC health, actual JSON download, gas estimate, re-estimated correction, 390px mobile layout, successful transaction inclusion/execution/finality, unknown transaction, malformed hash HTTP 400, secondary RPC health, synthetic 429 UI handling, and no browser JavaScript errors. The initial browser script stopped after 9 passes because its exact provider-label locator included the wrong accessible name; the locator was corrected and only the remaining 3 checks ran. This was a harness failure, not an upstream timeout. [Initial acceptance](../evidence/verification/production-acceptance.json) and [remaining checks](../evidence/verification/production-remaining.json) preserve that distinction.

Actual gas calls returned 0x5208 (21,000) for this example; proposed limit 1,000,000 then 21,000. No transaction was submitted and no actual fee saving is claimed. Estimates remain state-dependent. Both live providers succeeded in this sample; this does not establish that earlier intermittent failures are resolved. Machine-validated sanitized exports for gas and transaction reports accompany the downloaded health report in evidence/live/production-2026-10-11T05-10-35-199Z/.

Limitations: production firewall quotas were not deliberately exhausted; the browser 429 is synthetic. Real Redis outage was not induced. Preview credentials remain unverified. Per-IP limits can affect shared NAT users and counters are regional; Redis enforces the aggregate budget and fails closed if unavailable. Historical blocked-attempt notes below are retained and superseded by this successful release. M5 demo recording may proceed using the reachable production application; do not claim universal gas estimates or independent consensus verification.



## Pre-M5 branding - 2026-10-11
Inspected metadata: basic title/description only, no favicon or social assets. Added a static purple/black diagnostic icon family and social card; configured canonical, Open Graph and X metadata. Preserved dashboard and diagnostic code. Added reproducible image generation and focused browser checks. All 70 existing unit tests, TypeScript, lint and production build passed. See docs/branding.md for details and the deferred minimal CLI proposal.


## Branding release verified - 2026-10-11
Production https://monad-doctor.vercel.app now serves branding commit 168b84304b7be3919caa035e2a2cdfba314425ff (deployment dpl_CW3hzTCAukXT6QqHEA8AkkTNLYcm). Local verification: 70 unit tests, TypeScript, ESLint and production build passed. Hosted CI passed: https://github.com/0xBaqi/monad-doctor/actions/runs/38115036541 . Ten local and ten actual-production branding browser checks passed, including favicon sizes, decoded images, crawler-visible Open Graph/X metadata and mobile tab navigation. See evidence/verification/branding-local.json and branding-production.json.

The unchanged deployment gate passed at 05:31:33 UTC: authenticated HTTP 200 (102 ms), 20 isolated admissions/4 exhaustion rejections, bounded concurrency 4, HTTP 429 with zero Monad RPC calls when exhausted, and simulated outage/malformed fail-closed checks. Production counters were untouched by the gate; exact credential scan passed. No firewall settings were changed. Social preview: https://monad-doctor.vercel.app/social-preview.png . Browser bookmark and social-platform caches may take time to refresh; no third-party scraper rendering is claimed. No CLI implementation has started; docs/branding.md contains a deferred small scope.

## 2026-10-11 - Branded domain release

Both public hostnames returned HTTP 200 and the real diagnostic UI over HTTPS. Updated metadataBase (canonical, Open Graph URL and OG/X image URLs), the social preview domain label and current documentation. The Vercel hostname remains available as a fallback; historical evidence and the completed demo are unchanged. Added demo/ to .vercelignore to keep completed media out of release uploads. No DNS, firewall, Redis, API or diagnostic changes.

Local validation: 70 tests, TypeScript and production build passed. ESLint exited successfully with three existing warnings in untouched demo scripts. Port 3000 was occupied by an unrelated app; its initial browser checks were invalid for this project. Left that process untouched and verified Monad Doctor on port 3001 instead. Secret scans found no issues across 195 files, 11 client bundles and 231 historical blobs. The existing live firewall rule remained enabled at 6 requests/60 seconds per IP. Production verification follows after the unchanged gated deployment.

## Branded-domain release - 2026-10-11

Primary: https://monad-doctor.baronal.xyz . Fallback: https://monad-doctor.vercel.app . Both are aliases of production deployment dpl_8tufk8JXvUuXC6kCWXemuGWtCPww, built from 990eac672857cb4e611e2dc43ad755a83fa448d2. [Hosted CI passed](https://github.com/0xBaqi/monad-doctor/actions/runs/38165174278).

Canonical and Open Graph URLs, X/OG image URLs and the social preview label now use the branded domain. The original favicon is preserved. Current documentation uses the primary URL; historical release evidence and completed demo media remain unchanged. No DNS, Cloudflare, firewall, Redis, API or diagnostic behavior changes were made. Completed demo artifacts are excluded from Vercel uploads.

Verification: 70 unit tests, TypeScript, ESLint (zero errors; three existing warnings in untouched demo scripts) and production build passed. Ten local and ten branded-production branding checks passed, including crawler metadata, exact served asset contents and image decoding. Twelve branded-domain acceptance checks passed: both RPC providers, gas before/after, transaction lifecycle, downloaded JSON export, unknown transaction, invalid input, mobile/desktop layout, keyboard navigation and no browser JavaScript errors. The 429 UI test was synthetic and explicitly labeled; production quotas were not intentionally exhausted.

Actual gas estimates were 0x5208 (21,000) for the documented zero-value empty-calldata call, with proposed limits of 1,000,000 and 21,000. Neither run recorded an RPC error. The previously verified transaction 0x4c282c10e069e89fb73885dbb52b3aae7e5c6cfcd8026e4fe57197e9616415db had separately observed inclusion, successful execution and finality according to the sampled RPC evidence. This is not independent consensus verification or a guarantee for future calls.

The unchanged Redis gate passed at 18:52:31 UTC: authentication HTTP 200 in 97 ms; 20 admissions and four exhaustion rejections with concurrency bounded at four; denied HTTP 429 with zero Monad RPC calls; simulated outages/malformed replies fail closed. Its namespace was isolated from production counters. Exact credential checks passed in source, reports, logs and client bundles. The live firewall remained enabled at six requests per 60 seconds per IP.

Evidence: evidence/verification/branded-deployment.json, branded-acceptance.json, branding-branded-production.json, branding-branded-local.json and evidence/live/branded-2026-10-11T18-55-23-118Z/. Reproduce branding checks using MONAD_DOCTOR_URL and node --use-system-ca scripts/branding-check.mjs.

Limitations: an initial branded page navigation timed out; initial Node-backed asset checks lacked the local system CA configuration. Both are retained as initial verification evidence; the branded checks subsequently passed with TLS validation enabled. External social-platform and bookmark caches can lag; no third-party preview scrape is claimed. Intermittent navigation timeouts are not evidence of an RPC provider failure.

Fallback verification completed: https://monad-doctor.vercel.app returned HTTP 200, passed all ten metadata/asset/browser checks, and served the same canonical branded URLs and exact asset bytes. A bounded same-origin health request returned HTTP 200 in 6,024 ms, confirmed Mainnet and block evidence, and recorded no RPC errors. An earlier UI-click attempt did not observe an API response within 35 seconds and remains inconclusive; it is not counted as a passing diagnostic. Evidence: branding-branded-fallback.json and branded-fallback-health.json. Browser checks now wait for DOMContentLoaded and specific assets instead of network idleness, and record navigation/setup failures explicitly. No additional application deployment was needed for this test-harness/documentation change.
