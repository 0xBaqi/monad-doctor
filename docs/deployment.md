# Deployment readiness

M3 prepares a release candidate; it does not authorize or perform a public deployment.

## API boundary

The Node route accepts POST JSON only, two provider IDs and three diagnostic modes. It never accepts an endpoint URL, upstream headers, or arbitrary RPC methods. Six read-only methods are server-controlled; redirects are rejected. Hashes/addresses are exact hex widths, quantities are at most 256 bits, calldata at most 4 KiB, request bodies 16 KiB with a three-second read deadline. Each RPC has five seconds and a 1 MiB response limit; collection has 18 seconds and ten calls. Four API runs and 30 requests/minute are allowed per process. Invalid UTF-8 and malformed content lengths are client errors. No application code logs request bodies, headers or private configuration.

Cross-origin and Fetch Metadata guards reduce browser misuse; they are not authentication. Non-browser clients can supply Host/Origin. Do not use these headers to identify an authenticated user. Public addresses remain in reports, so review sharing. On-screen calldata stays local to the report; sharing exports omit its bytes and all unsupported metadata.

## Recommended first public deployment

Use one Node 24 process behind an HTTPS reverse proxy with a private or loopback-only origin. The existing start script binds 127.0.0.1; this fits a same-host reverse proxy. A managed platform requiring 0.0.0.0 needs an explicit platform launch command and restricted origin access. Configure the proxy to preserve the public Host so the same-origin check works. Do not add credentials to client environment variables.

The process quota is a backstop, not adequate public abuse protection. Put per-client and aggregate limits at the edge before invoking Next.js. A practical single-host option is NGINX shared-memory request limits: start conservatively at 6 requests/minute per client IP and 20 requests/minute for the diagnostic route overall, with small bursts and HTTP 429. These are initial operating choices, not Monad protocol limits; tune from measurements. NGINX supports concurrent per-IP/per-server limits: https://nginx.org/en/docs/http/ngx_http_limit_req_module.html . No database is needed for one ingress. Trust forwarded client IP only from a known proxy, prevent direct-origin bypass, and avoid request-body/header logging. Apply a 16 KiB edge body cap and suitable request deadlines too.

On serverless or multiple replicas, module counters reset on cold starts and multiply across instances. A per-instance quota cannot enforce an aggregate RPC budget. Use the deployment provider's edge/WAF rate limits plus a platform concurrency cap, or a shared atomic limiter if that platform has no adequate edge control. Edge limits may be approximate/distributed; per-IP rules affect shared NAT users and cannot alone stop distributed abuse. A shared limiter adds availability/fail-open decisions. Choose the host first; no untested distributed limiter is claimed here.

Before public release: configure and test ingress quotas, origin isolation, TLS, trusted Host forwarding, timeout/429 behavior, operational request counts (without bodies), and a rollback procedure. Check the production dependency audit again. No public-readiness claim substitutes for these deployment checks.

## Outstanding tool advisory

GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, high severity, affects braces <=3.0.3; the advisory lists no patched version as reviewed October 10, 2026: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm . The dependency chain is eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces. npm reports five affected package entries for this one advisory. It concerns deeply nested glob patterns exhausting the stack.

This chain is development tooling, not a runtime API dependency; M2's production-only audit had zero findings. M3 records a fresh audit separately. The safest current approach is to retain the compatible lockfile, use isolated credential-free CI runners, avoid untrusted lint patterns, and track a supported upstream fix. Do not force npm's suggested downgrade to a mismatched Next lint-config major. Update and reverify when a compatible fix exists. ESLint 9 also remains a maintenance limitation due to plugin peer compatibility. A production-only install avoids shipping lint tools but is not itself a proof of application security.

## M4 Vercel preparation

Vercel is the requested target. The Node diagnostic route declares maxDuration 30 seconds, above the 3-second input read plus 18-second collector budget. No database, application credentials or environment variables are needed for diagnostics. Vercel build uses npm run build and the lockfile; it does not run the loopback npm start server. Local .vercel state is ignored. No public deployment has been performed.

Before exposing POST /api/diagnose, configure an enforced firewall rule (not Log) and verify 429 responses on all deployment aliases. Start with six requests/minute per client IP. Vercel documents fixed-window rate limiting on all plans, one Hobby rate-limit rule, and regional counters. This is not a global aggregate quota and per-IP limits alone cannot bound distributed RPC consumption. A strict shared aggregate budget requires an additional deployment-compatible shared limiter or an ingress that enforces that budget. Do not claim the existing module counter supplies it. Account plan, quota controls and any external service/cost must be reviewed before enabling the public endpoint. Keep the project protected until then.

Official authority: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting and https://vercel.com/docs/functions/configuring-functions/duration . Pricing/account availability must be confirmed in the target account; no paid activation is authorized. CORS is not authentication or an abuse budget.

The Vercel CLI sign-in check succeeded using NODE_USE_SYSTEM_CA=1 after a certificate error; TLS verification remained enabled. GitHub destination and Vercel project/team remain pending. No tokens were read or written to project files.

## M4.5 superseding deployment configuration

See [protected deployment setup](protected-deployment.md). The API now requires shared Redis admission in production and on Vercel. The earlier no-environment-variable statement applies only to local development. The verified 0x-baqi Hobby project monad-doctor exists and its per-IP API firewall rule is published (6 requests / 60 seconds). No app deployment has occurred. Global limiter credentials, live atomicity verification, GitHub login/publication and hosted CI remain pending.
