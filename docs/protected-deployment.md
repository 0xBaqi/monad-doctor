# Protected deployment setup (M4.5)

## Verified destinations and blockers

Vercel CLI user: adewaleagboola444-8813. Scope 0x-baqi, display name 0xBaqi, role OWNER, Hobby plan. A new monad-doctor project was created only after confirming it was absent. No unrelated project was modified and no application deployment has occurred. The CLI linked this checkout and generated ignored .vercel metadata and an ignored .env.local OIDC credential; neither belongs in Git or reports. Do not print that file.

GitHub CLI was installed from the official winget package with its installer hash verified. Authentication is absent. Complete this in PowerShell:

    & 'C:\Program Files\GitHub CLI\gh.exe' auth login --hostname github.com --git-protocol https --web

Authorize 0xBaqi through the browser. Do not paste tokens into chat. The agent must then verify the authenticated login and that 0xBaqi/monad-doctor is unused before creating the public repository or pushing. No GitHub repository or remote has yet been created.

## Required Upstash setup

1. Sign in at https://console.upstash.com and create a dedicated Redis database named monad-doctor-limits on the Free plan. Use one primary database for all app instances, regions and deployment aliases; do not use separate regional databases or the anonymous 72-hour trial.
2. Leave billing/auto-upgrade disabled. Stop if the console requires a paid plan or card. The published free allowance is 500K commands/month; denied requests also consume commands, so the free tier is not unlimited.
3. In Vercel, select the verified 0xBaqi / monad-doctor project, Settings > Environment Variables. Add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN for Production and Preview using the HTTPS REST URL and write-capable token from Upstash. Mark the token sensitive where supported. No NEXT_PUBLIC_ prefix. Do not commit a .env file or paste credentials into chat.
4. Reply that configuration is ready. Before any public deployment, verify actual atomic reservations and concurrent exhaustion in the dedicated database with separate test keys, then verify firewall publication and production failure behavior. Do not delete/reset active quota keys to make a check pass.

Authority: https://upstash.com/docs/redis/features/restapi ; https://upstash.com/pricing/redis ; https://upstash.com/blog/lua-scripting-on-upstash-redis-atomic-operations-over-http .

## Shared application protection

The API validates input, then atomically reserves ten RPC-call units (the collector's maximum) before any Monad request. A single Redis EVAL enforces 200 reserved units per 60-second window and 10,000 per 24-hour window shared across all instances. Windows begin with the first reservation and expire using Redis TTL, not client clocks. Reservations are not refunded after failures or shorter runs, so actual RPC use cannot exceed reserved capacity. These are conservative operating choices, not Monad limits. Fixed windows allow bursts across a reset boundary; in-flight calls may complete in the following window. This is not a sliding-window guarantee.

Production NODE_ENV and every Vercel deployment require the limiter. Missing configuration, malformed replies, backend errors, quota-service exhaustion and timeouts return HTTP 503 with no RPC forwarding. Exhaustion returns 429 and Retry-After. There is no production bypass flag. Local development without configuration retains the local guards; npm start is production and therefore now requires Redis configuration for successful diagnostics.

The Redis request is restricted to a server-configured HTTPS *.upstash.io endpoint, with redirects disabled, a two-second deadline and a 1 KiB response bound. Credentials only appear in the server request's authorization header. No Redis response text, token or URL is put in diagnostic reports. There are no new runtime dependencies. Existing RPC allowlists, collector deadlines, body limits and process concurrency limits remain in force. Free-tier exhaustion sacrifices availability, never protection.

## Edge protection and release gates

Use one Hobby WAF rule matching /api/diagnose, fixed-window six requests per minute per IP, enforced 429 action. Vercel counters are regional and per-IP; this complements the shared reservation budget, not replaces it. Distributed clients can still consume the limited service capacity or free Redis commands. CORS is not authentication. Confirm the rule is published (a draft is insufficient) and applies to every deployment alias. No public exposure until both layers are verified. No paid service activation is authorized.

Authority: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting .

Hosted CI, production URL, deployment QA and actual Redis atomicity remain release gates. Deterministic tests mock the REST boundary and do not claim to prove behavior of an unconfigured live database.

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
