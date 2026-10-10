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
