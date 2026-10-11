# Verification record

Current public URL: https://monad-doctor.baronal.xyz . The Vercel URL https://monad-doctor.vercel.app remains a fallback. Earlier release URLs and evidence below are retained as historical observations.

## Current production release - 2026-10-11

Live application: https://monad-doctor.vercel.app . Deployed source commit: 4075ddfe666fb8d4bbd3e7d3cfc9d92debc1094f. [Hosted CI passed](https://github.com/0xBaqi/monad-doctor/actions/runs/38113612827): 70 deterministic tests, TypeScript, ESLint and production build.

After the owner corrected the matching Production REST credentials, one gated deployment attempt passed at 05:06:07 UTC. Authentication returned HTTP 200 in 101 ms. Isolated concurrency (maximum 4) admitted 20 reservations and rejected 4; the exhausted HTTP boundary returned 429 with zero Monad RPC calls. Injected outage/malformed replies failed closed. Exact credential scanning passed. Production counters were not touched by gate tests. The existing live firewall remains enabled at 6 requests/60 seconds/IP; the shared budget and all API safeguards are unchanged. No paid resources were enabled. See [gate evidence](../evidence/verification/redis-release-gate.json).

Production acceptance passed 12 checks across two runs: desktop/keyboard navigation, primary RPC health, actual JSON download, gas estimate, re-estimated correction, 390px mobile layout, successful transaction inclusion/execution/finality, unknown transaction, malformed hash HTTP 400, secondary RPC health, synthetic 429 UI handling, and no browser JavaScript errors. The initial browser script stopped after 9 passes because its exact provider-label locator included the wrong accessible name; the locator was corrected and only the remaining 3 checks ran. This was a harness failure, not an upstream timeout. [Initial acceptance](../evidence/verification/production-acceptance.json) and [remaining checks](../evidence/verification/production-remaining.json) preserve that distinction.

Actual gas calls returned 0x5208 (21,000) for this example; proposed limit 1,000,000 then 21,000. No transaction was submitted and no actual fee saving is claimed. Estimates remain state-dependent. Both live providers succeeded in this sample; this does not establish that earlier intermittent failures are resolved. Machine-validated sanitized exports for gas and transaction reports accompany the downloaded health report in evidence/live/production-2026-10-11T05-10-35-199Z/.

Limitations: production firewall quotas were not deliberately exhausted; the browser 429 is synthetic. Real Redis outage was not induced. Preview credentials remain unverified. Per-IP limits can affect shared NAT users and counters are regional; Redis enforces the aggregate budget and fails closed if unavailable. Historical blocked-attempt notes below are retained and superseded by this successful release. M5 demo recording may proceed using the reachable production application; do not claim universal gas estimates or independent consensus verification.


## Synthetic regression tests
- First engine milestone: 22/22 passing.
- Boundary refinements: 25/25 passing, including stalled streams, exact content types, and ten-call cap.
- Synthetic inputs live in tests/ and are never presented as Mainnet findings.

## Actual Mainnet RPC evidence
Successful collection: evidence/live/2026-10-10T06-34-48-846Z/ . Earlier failed TLS run retained at evidence/live/2026-10-10T06-25-38-635Z/ .

Both QuickNode and Alchemy returned chain ID 143, readable latest/finalized heads, valid finalized transaction evidence, and 21,000-gas estimates for the unsigned zero-value example.

Primary sampled latest block: **112112140**. Finalized head sampled immediately before it: **112112136**. Observed block gas limit: **150,000,000**. These are sequential observations, not an atomic four-block lag measurement.

Transaction **0x81f9e43b6ece21dcb71705d67dd9c44b74f1059597606c2c0f113b726636d4dd**: receipt status 0x1 at block **112112139**; sampled finalized head **112112143**; block hash/membership matched. The secondary endpoint independently returned a different finalized transaction sample. Full parameters, timestamps, normalized responses and outcomes are in the JSON reports.

Three follow-up samples on each provider were already finalized. We did **not** capture a live provisional-to-finalized transition. That branch is covered by deterministic tests; no millisecond finality measurement is claimed. Finality conclusions rely on the selected RPC, not independent cryptographic verification.

All-zero hash lookup returned no usable receipt and correctly remained unknown, not failed or dropped.

## Live before / after
At sampled gas price **102,000,000,000 wei/gas**, the primary endpoint estimated **21,000 gas**:
- Before: proposed 1,000,000; padding warning; conditional fee **0.102 MON**.
- After: proposed 21,000; estimate match; conditional fee **0.002142 MON**.
- Both estimates were actual read-only calls. No transaction was signed, submitted or charged. The comparison is not an observed monetary saving.

See primary-gas-before.json and primary-gas-after.json in the successful collection directory, plus equivalent secondary reports.

## Environment issue and fix
Node initially failed RPC and npm HTTPS with UNABLE_TO_VERIFY_LEAF_SIGNATURE. Using Node 24's Windows system certificate store resolved this without disabling TLS verification. The environment variable NODE_USE_SYSTEM_CA=1 was applied to the rerun.

## Final verification ? complete
- Unit tests: **26/26 passed**, including the production-origin regression.
- TypeScript: passed. ESLint: passed. Next.js 16.4.0 production build: passed.
- Production browser checks: **8/8 passed** on installed Chrome. All three live forms, the gas correction, JSON download, malformed-hash error, desktop layout, 390px mobile layout, and absence of JavaScript errors verified.
- Desktop and mobile screenshots were visually inspected; no clipping or horizontal overflow found.
- Actual browser-run API reports: evidence/live/ui-2026-10-10T11-34-19-374Z/ . These are separate from synthetic test fixtures.
- Machine-readable logs: evidence/verification/checks.json and browser-checks.json; per-command .log files; desktop.png, desktop-gas-report.png, mobile-gas-report.png.
- Local QA server was used only for validation. Start normally with npm run dev. No public deployment was performed.

### Toolchain note
ESLint is pinned to 9.39.5 because the Next.js lint plugins currently declare peer support through ESLint 9. The attempted ESLint 10 upgrade produced peer overrides and was reverted. npm warns that ESLint 9 is deprecated; this is a development-tooling limitation, not a runtime dependency.



## M2 verification - October 10, 2026

### Correctness and regression coverage
- **42/42 deterministic tests passed** (16 added to M1's 26). TypeScript, ESLint and production build all exited 0; see evidence/verification/checks.json and per-command logs.
- New coverage: mode coercion, exact 256-bit boundaries, above-cap estimates, large padding arithmetic, inclusion with missing receipt, impossible receipt gas usage, finalized hash conflicts, missing block evidence, bigint freshness thresholds, stale simulation state, calldata redaction, response-body deadline, fixed transport options, HTTP method/site checks, concurrent readers and minute quota.
- Rule version m2.0. Inclusion, receipt execution and provider-attested finality are separate findings. Failed status never establishes a root cause. A simulation above the transaction cap gets no clamped recommendation. Freshness is an explicitly inferred application heuristic.
- Focused official references rechecked: [gas pricing](https://docs.monad.xyz/developer-essentials/gas-pricing), [RPC semantics](https://docs.monad.xyz/reference/json-rpc/overview), [block states](https://docs.monad.xyz/monad-arch/consensus/block-states). M1 before/after example is preserved unchanged.

### Actual live observations
Collection: [M2 live summary](../evidence/live/2026-10-10T11-56-38-010Z/summary.json). No signing, broadcasting or funding.

| Provider | Chain ID | Finalized / later latest height | Gas estimate |
| --- | --- | --- | --- |
| primary | 143 | 112176118 / 112176121 | 21000 |
| secondary | 143 | 112176205 / 112176209 | 21000 |

Sequential block samples are not an atomic lag measurement. Both providers returned successful transaction receipts, matching canonical block membership and covering finalized heads. Both returned null transaction and receipt for the all-zero hash; these remained unknown.

Trustworthy failed-execution examples found within the eight-receipt / 18-second scan bound:
- Primary: 0x1a88505563e1ef771885a44548e7047b943a61fe4282d816823370feb7ac5051.
- Secondary: 0x54a39c5bf6ecb5fff29bf176044808a826b5331c88673a683e1c1df18f1cdbfe.

See each provider's failed-transaction.json for status 0x0, block hash/membership and finality evidence. These establish failed execution, not specifically a REVERT opcode or out-of-gas cause. No trace/root-cause claim is made. All three follow-up samples per provider were already finalized; no live provisional-to-finalized transition was captured. That branch remains deterministic-fixture coverage.

### Security audit and remaining limitations
- Fixed server endpoints, six read-only methods, strict inputs, rejected redirects, no forwarded credentials/headers, bounded bodies/calls/time/concurrency and local quota. No arbitrary URL or RPC forwarding path was found in the HTTP route.
- Fixed array-mode coercion and independent response-body timeout allowance. Added Fetch Metadata rejection and POST enforcement. Exports redact calldata in both input and estimate parameters; arbitrary provider error text and extra response fields remain excluded.
- Production-only npm audit: **0 vulnerabilities**. Full audit: **5 high package entries from one unpatched development-only braces advisory**, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). No compatible patched version is listed. Do not feed untrusted patterns/repositories into lint; track upstream resolution. No forced downgrade or dependency additions were made. Audit summary: evidence/verification/m2-security-audit.json.
- ESLint 9 maintenance limitation remains. Finality trusts one provider and is not a cryptographic proof; samples are sequential. Freshness depends on the local clock. Null history cannot identify pending/dropped transactions. Estimates cannot guarantee execution at future state. Limits are per process, not a distributed public-service quota. Public addresses remain in exports; calldata must be re-entered locally for reproduction.
- Live browser attempt one recorded a real 5,011 ms estimate timeout, correctly shown as unknown with no fallback. Evidence retained at evidence/live/ui-2026-10-10T11-59-16-093Z/; check failure retained at evidence/verification/m2-browser-first-attempt.json.

### M2 file inventory and Git state
All project files remain untracked on main, with no commits, as at the initial M2 inspection. No unrelated repository was changed. No deployment was performed.

Modified: README.md; app/page.tsx; lib/model.ts, validation.ts, engine.ts, rules.ts, rpc.ts, http.ts; scripts/live-check.ts, browser-check.mjs; docs/development-journal.md, verification.md. Added: lib/export.ts; tests/m2.test.ts, capacity.test.ts; timestamped live evidence and verification artifacts. Package manifest/lockfile and original before/after example were not changed in M2.

M3 recommendation: establish a reviewed Git baseline and CI for deterministic checks; resolve/track the tooling advisory and design deployment-level quotas before any public release. Keep live acceptance observations separate from deterministic CI tests.

### Final M2 browser acceptance
Second attempt: **9/9 passed**, with no browser JavaScript errors. Covered all three workflows, actual gas before/after, normalized JSON download, calldata redaction, malformed hash errors, desktop and 390px mobile layout. Actual UI evidence: evidence/live/ui-2026-10-10T12-13-09-282Z/. Screenshots and checks: evidence/verification/. First failed attempt remains recorded separately. Local QA server stopped after checks; no deployment.

## M3 release foundation - October 10, 2026

- **51/51 unit tests passed**, including nine new M3 regressions. TypeScript, ESLint and production build all exited 0 after the clean lockfile install. Machine records: evidence/verification/checks.json and per-task logs.
- **10/10 production-browser checks passed**, with no JavaScript errors. New coverage verifies expandable unknown/verification guidance and exportVersion/ruleVersion metadata; all M2 workflows, gas correction, redaction, malformed-hash feedback and desktop/mobile bounds remain covered. Actual browser evidence: evidence/live/ui-2026-10-10T17-11-16-723Z/.
- Limited live smoke: evidence/live/m3-smoke-2026-10-10T12-45-39-404Z/ . Exactly three health RPC calls per provider, both passed chain ID 143 and latest/finalized checks. Browser acceptance made additional bounded read-only diagnostic requests. No signing, broadcasting or actual fee-savings claim.
- New deterministic cases: unknown/nested export fields, metadata preservation, invalid references/sources/timestamps, unsupported methods/results, safe error export, workflow guidance, synthetic wrong network, bad Content-Length/UTF-8 and cancellation rejection handling.
- CI: .github/workflows/validate.yml, Ubuntu + Node 24.18.0, immutable official action pins, read-only token, no persisted checkout credentials, 15-minute timeout; npm ci --ignore-scripts --no-audit then typecheck/lint/test/build. YAML parsed and equivalent commands passed locally. **Hosted GitHub Actions has not run**: no remote or push was configured. CI has no live RPC dependency or user secrets.
- Fresh production audit: zero vulnerabilities (m3-production-audit.json). Outstanding development advisory remains GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, high, braces <=3.0.3; five affected tooling package entries via the existing lint chain. Official advisory still lists no patched version. No dependency upgrades were made. See deployment.md for assessment and safest resolution.
- API limits/allowlists retained; stricter length/UTF-8 validation and safe cancellation added. Exports explicitly select and validate fields, redact calldata, drop unsupported metadata and provide reproduction instructions. See reports.md.
- Pre-staging scan reviewed all candidate artifacts, JSON credential/data fields, ignore rules and final client bundles. No detected secrets, large generated artifacts or server RPC URLs in client bundles. node_modules, .next, .env files, private key files, exports and temporary material are ignored. Pattern scanning is not a proof against arbitrary encoded secrets; reviewed evidence contains only public RPC observations and empty/redacted demo calldata.
- Initial local Git baseline includes the reviewed source, lockfile, tests, CI, documentation and small evidence artifacts. Commit hash and final status are recorded in the completion report; no remote changes, pushes or history rewriting.

### M3 limitations and M4 recommendation

Public deployment still needs ingress quotas, origin protection and host-specific verification. Process quotas multiply across serverless instances and reset on restart. Prefer edge per-client plus aggregate limits with a single protected origin initially; no rate-limit database was added. Provider-attested finality, sequential observations, mutable estimates, missing-history ambiguity and the unobserved live finality transition remain explicit. Public addresses remain in exports; calldata must be re-entered locally. ESLint maintenance and the unpatched development advisory remain open.

M4: configure the chosen host's edge limits and private origin, enable the remote/hosted CI only when authorized, run staging acceptance and rehearse the documented demo. Keep the release focused; no CLI or new diagnostic features are necessary before these operational checks.

## M4 local preparation ? 2026-10-10

- 51/51 deterministic unit tests passed; no diagnostic engine changes or new unit tests. TypeScript, ESLint and production build passed. The journey text required an encoding correction; the production build was rerun successfully afterward.
- Initial desktop/mobile screenshots were captured before edits. Focused UI changes preserve the design and diagnostic scope. New browser checks cover skip navigation, 1440/390/320px layouts, mobile input text, loading and synthetic 429 errors. See m4-ui-review.json for the actual result; intercepted responses are explicitly synthetic.
- Live browser attempt at 17:48 UTC passed seven checks: desktop layout, live health, guidance, health export, live gas before/after, gas export redaction and mobile report overflow. Transaction assertion stopped because its chain-ID call timed out; the app reported unknown, not finality. No browser JavaScript errors were recorded. The remaining checks in that run did not execute. Saved in evidence/verification/m4-browser-first-attempt.json and evidence/live/ui-2026-10-10T17-48-36-048Z/.
- Earlier limited provider smoke at 17:42 UTC timed out on both initial chain-ID calls: evidence/live/m3-smoke-2026-10-10T17-42-17-190Z/ (legacy script directory prefix). This does not prove provider-wide outages. Historical M3 passing results remain historical, not a substitute for this run.
- Secret/artifact and client-bundle scan reported no findings. Pattern scanning is not proof against arbitrary encoded secrets.
- No remote publication, hosted Actions run, deployment or production-URL verification occurred. GitHub destination, Vercel project/team and public aggregate quota controls remain unresolved. No paid services enabled.
- Accessibility checks are essentials, not a WCAG conformance audit or screen-reader certification.

Final focused M4 browser retry passed all seven checks, including keyboard skip link, 1440/390/320px layouts, labeled 16px mobile inputs, loading lockout and synthetic accessible 429. ESLint passed again after the new script. Screenshots: evidence/verification/m4-1440.png, m4-390.png and m4-320.png.

## M4.5 protected deployment preparation ? 2026-10-10

58/58 deterministic tests passed (seven new shared-limiter tests), TypeScript, ESLint and production build passed. No Redis network dependency exists in tests. Actual Redis atomicity and concurrent admission have not yet been verified and remain a deployment gate. Four checks against the actual local production build passed: safe visible 503 without credentials, no fabricated report/export, all three modes fail closed, and invalid providers/GET remain rejected. See evidence/verification/m45-production-closed.json and .png. This is local production verification, not deployed-URL QA.

Read-only network investigation: evidence/live/m45-network-2026-10-10T22-12-02-749Z/comparison.json records successful chain-143 responses through native fetch and the collector on both providers. Earlier timeouts were not reproduced. Sequential samples cannot isolate provider, network or scheduling causes; no timeout suppression or increased RPC deadline was introduced.

Security scans before publication: original tracked/candidate files clean; history scan covered two commits and 142 blobs with no findings. Local Vercel OIDC/environment files remain ignored and were not printed. Vercel verified OWNER/Hobby scope 0x-baqi; created only monad-doctor and published its live /api/diagnose WAF rule at 6 requests/60 seconds/IP. Rule ID rule_monad_doctor_diagnostic_per_ip_quota_246QC3. No app deployment or paid activation. GitHub CLI is installed but unauthenticated: no owner verification, destination availability confirmation, repository creation, push, or hosted CI result. User account actions are required as documented in docs/protected-deployment.md.

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


## Branding release verified - 2026-10-11
Production https://monad-doctor.vercel.app now serves branding commit 168b84304b7be3919caa035e2a2cdfba314425ff (deployment dpl_CW3hzTCAukXT6QqHEA8AkkTNLYcm). Local verification: 70 unit tests, TypeScript, ESLint and production build passed. Hosted CI passed: https://github.com/0xBaqi/monad-doctor/actions/runs/38115036541 . Ten local and ten actual-production branding browser checks passed, including favicon sizes, decoded images, crawler-visible Open Graph/X metadata and mobile tab navigation. See evidence/verification/branding-local.json and branding-production.json.

The unchanged deployment gate passed at 05:31:33 UTC: authenticated HTTP 200 (102 ms), 20 isolated admissions/4 exhaustion rejections, bounded concurrency 4, HTTP 429 with zero Monad RPC calls when exhausted, and simulated outage/malformed fail-closed checks. Production counters were untouched by the gate; exact credential scan passed. No firewall settings were changed. Social preview: https://monad-doctor.vercel.app/social-preview.png . Browser bookmark and social-platform caches may take time to refresh; no third-party scraper rendering is claimed. No CLI implementation has started; docs/branding.md contains a deferred small scope.

## Branded-domain release - 2026-10-11

Primary: https://monad-doctor.baronal.xyz . Fallback: https://monad-doctor.vercel.app . Both are aliases of production deployment dpl_8tufk8JXvUuXC6kCWXemuGWtCPww, built from 990eac672857cb4e611e2dc43ad755a83fa448d2. [Hosted CI passed](https://github.com/0xBaqi/monad-doctor/actions/runs/38165174278).

Canonical and Open Graph URLs, X/OG image URLs and the social preview label now use the branded domain. The original favicon is preserved. Current documentation uses the primary URL; historical release evidence and completed demo media remain unchanged. No DNS, Cloudflare, firewall, Redis, API or diagnostic behavior changes were made. Completed demo artifacts are excluded from Vercel uploads.

Verification: 70 unit tests, TypeScript, ESLint (zero errors; three existing warnings in untouched demo scripts) and production build passed. Ten local and ten branded-production branding checks passed, including crawler metadata, exact served asset contents and image decoding. Twelve branded-domain acceptance checks passed: both RPC providers, gas before/after, transaction lifecycle, downloaded JSON export, unknown transaction, invalid input, mobile/desktop layout, keyboard navigation and no browser JavaScript errors. The 429 UI test was synthetic and explicitly labeled; production quotas were not intentionally exhausted.

Actual gas estimates were 0x5208 (21,000) for the documented zero-value empty-calldata call, with proposed limits of 1,000,000 and 21,000. Neither run recorded an RPC error. The previously verified transaction 0x4c282c10e069e89fb73885dbb52b3aae7e5c6cfcd8026e4fe57197e9616415db had separately observed inclusion, successful execution and finality according to the sampled RPC evidence. This is not independent consensus verification or a guarantee for future calls.

The unchanged Redis gate passed at 18:52:31 UTC: authentication HTTP 200 in 97 ms; 20 admissions and four exhaustion rejections with concurrency bounded at four; denied HTTP 429 with zero Monad RPC calls; simulated outages/malformed replies fail closed. Its namespace was isolated from production counters. Exact credential checks passed in source, reports, logs and client bundles. The live firewall remained enabled at six requests per 60 seconds per IP.

Evidence: evidence/verification/branded-deployment.json, branded-acceptance.json, branding-branded-production.json, branding-branded-local.json and evidence/live/branded-2026-10-11T18-55-23-118Z/. Reproduce branding checks using MONAD_DOCTOR_URL and node --use-system-ca scripts/branding-check.mjs.

Limitations: an initial branded page navigation timed out; initial Node-backed asset checks lacked the local system CA configuration. Both are retained as initial verification evidence; the branded checks subsequently passed with TLS validation enabled. External social-platform and bookmark caches can lag; no third-party preview scrape is claimed. Intermittent navigation timeouts are not evidence of an RPC provider failure.

Fallback verification completed: https://monad-doctor.vercel.app returned HTTP 200, passed all ten metadata/asset/browser checks, and served the same canonical branded URLs and exact asset bytes. A bounded same-origin health request returned HTTP 200 in 6,024 ms, confirmed Mainnet and block evidence, and recorded no RPC errors. An earlier UI-click attempt did not observe an API response within 35 seconds and remains inconclusive; it is not counted as a passing diagnostic. Evidence: branding-branded-fallback.json and branded-fallback-health.json. Browser checks now wait for DOMContentLoaded and specific assets instead of network idleness, and record navigation/setup failures explicitly. No additional application deployment was needed for this test-harness/documentation change.
