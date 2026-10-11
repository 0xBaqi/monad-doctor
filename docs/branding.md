# Branding and sharing

The existing lavender dashboard remains unchanged. A purple/black diagnostic cross with a terminal cursor identifies the app in tabs and bookmarks. public/icon.svg is the vector source; scripts/generate-branding.mjs renders the 16/32/48px ICO, 192px PNG, 180px Apple-touch icon and 1200x630 social-preview.png using the existing Playwright development dependency. No new dependencies or remote font requests.

app/layout.tsx defines the title, description, production canonical URL, Open Graph website metadata and X summary_large_image card, including descriptive image alt text. Metadata follows the [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata). No invented social account handles.

Run node scripts/branding-check.mjs against a running local production server, or set MONAD_DOCTOR_URL to the production origin. Checks validate metadata in HTML (including crawler responses), icon declarations, ICO sizes, actual browser image decoding, all three tabs and mobile overflow. Browser bookmark caches and third-party social-card caches may require refresh; these checks do not claim a platform-side scrape.

## Deferred CLI proposal

Only after the M5 video and submission materials are ready: one repository-local Node 24 command, doctor --input request.json --json. Read a bounded JSON file, call existing parseInput and diagnose, and serialize through exportReport. This reuses all three modes and their existing validation, evidence, source links, RPC allowlist and bounds. Use Node built-ins; no argument-parser dependency, npm publication, wallet support, arbitrary RPC URLs, watch mode or separate diagnostic rules. Exit 0 for a completed collection, 1 for execution/input failure; keep inferred risks and incomplete evidence explicit in JSON, rather than treating every warning as a failed transaction. A small fixture-based smoke test should prove that CLI output matches the existing export schema. This is a proposal only; no CLI implemented.
