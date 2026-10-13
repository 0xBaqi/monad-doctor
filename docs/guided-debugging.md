# M3.1 guided debugging

The three symptom choices select the existing transaction, gas and health modes.
Technical modes remain available. Selection, input editing, evidence navigation
and export do not collect RPC evidence. Only an explicit Run submits a diagnostic.

The presentation module orders existing findings by severity, keeping ordinary
network passes behind equally ranked diagnostic findings. Summary text and next
actions come directly from the original findings; no prose is parsed to infer
facts. Unknown IDs retain their original text and basis. Contradiction labels
require an existing conflict ID with error severity and unknown basis.

Transaction summaries keep inclusion, execution and provider-attested finality
separate. Gas summaries separate the captured proposed limit, sampled RPC
estimate and conditional cost. Missing findings remain unknown. No confidence,
consensus proof, guaranteed gas requirement, actual fee or failure cause is added.

The engine rule version remains `m3.1`; this product milestone does not change
diagnostic rules, schema version 1, export version 1, CLI behavior or exit codes.
The API, approved providers, read-only method allowlist and admission/security
limits are unchanged. Typical runs still collect at most three health, four gas
or five transaction observations; web admission reserves ten RPC units per run.

Captured reports remain available when inputs change and are labelled previous
snapshots. Comparisons use the existing input normalizer, including hex case.
Export always describes the captured report, never untested edited inputs.
On-screen report inputs and evidence use the existing redacted export projection.
Calldata remains in the developer's editable form and submitted POST body, but is
not repeated in report evidence or downloads. Public addresses and hashes remain.
No URLs, persistent storage, analytics, signing or automatic retries are added.

Inline validation runs on submission, associates errors with fields and focuses
the first invalid field. Editing clears previous field errors. Report completion
focuses its heading and announces status. Evidence links open and focus original
observation IDs. HTTP 401/403, 429, 503, transport failures and invalid HTTP-200
reports have distinct messages. Retry-After seconds and HTTP dates temporarily
pause Run; timer expiry never submits a request. A completed report with error or
unknown findings is retained as such, irrespective of HTTP 200.

## Local deterministic browser acceptance

Start the app locally on port 3143. The harness refuses non-loopback targets and
intercepts diagnostic requests with reports produced by the actual M2 engine
using existing adversarial RPC fixtures. It does not contact live RPC providers,
exercise production quotas or weaken production admission.

```sh
npm run dev -- --port 3143
npm run qa:guided
```

Chromium must be installed for playwright-core. Set `MONAD_DOCTOR_CHROMIUM` to an
existing Chromium executable if needed. `MONAD_DOCTOR_URL` can specify another
127.0.0.1 port. Artifacts default to ignored `.qa/guided/`; override with
`MONAD_DOCTOR_QA_DIR`. Exports and screenshots contain synthetic evidence only.

Coverage includes all symptom/technical navigation, zero-request validation,
unknown and contradictory outcomes, failed execution without a confirmed cause,
conditional gas cost, redacted downloads, previous snapshots, evidence focus,
bounded loading, Retry-After without retry, protected HTML responses, admission
failures, invalid HTTP-200 reports, desktop/mobile layout, labels, keyboard skip
navigation, announcements and JavaScript errors.

The deterministic presentation suite reuses all 25 adversarial fixtures and adds
fallback, ordering, input matching, evidence-reference and HTTP-error tests.
Browser assertions cover accessibility mechanics, not a complete WCAG audit or
human screen-reader/usability study. Live M3 production acceptance is separate.

## Verification result

164/164 deterministic tests passed: 130 existing and 34 new presentation tests.
TypeScript, full ESLint, CLI compilation, optimized production build and
`git diff --check` passed. Full lint reported zero errors and five pre-existing
warnings in local .qa/demo scripts; final harness lint reported zero warnings.

The optimized local build passed 22/22 desktop/mobile browser checks with no
JavaScript exceptions, 13 explicitly submitted mocked requests and zero live
RPC calls. All 74 preserved demo file fingerprints matched. No deployment,
push or production configuration change occurred. See
[the verification record](../evidence/verification/guided-debugging-m31.json).
