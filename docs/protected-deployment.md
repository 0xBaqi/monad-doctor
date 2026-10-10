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
