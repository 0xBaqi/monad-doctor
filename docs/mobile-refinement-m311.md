# M3.1.1 mobile refinement verification

Baseline: `0a25be2cc59a925289ffa32fda71077830c82f75`. Diagnostic rule version remains `m3.1`.

## Layout decisions

Reused M2's brand, typography, purple accent, card borders, three-column report metrics and 760px responsive breakpoint. Symptom buttons remain at least 44px tall on mobile. Technical modes are available through a native expandable control rather than a second competing navigation row.

Reports start with RPC Requests, Needs Attention and Captured At, followed by the existing evidence-backed primary finding, limitations and next action. Provider attribution stays in the metrics; full timestamps and captured inputs remain expandable. Inclusion, Execution and provider-attested Finality remain separate, with mobile rows and desktop columns. Gas outcomes retain distinct proposed limit, RPC estimate and conditional cost.

All original findings remain in their original summary order. Closed finding headers show severity, evidentiary basis, rule ID and title, including warnings and contradictions. Expanding reveals the original detail, next step, verification guidance, documentation and evidence links. Export JSON stays beside the report heading with a 44px target. Stale snapshots, error handling, redaction and keyboard evidence navigation are preserved.

No changes to the diagnostic engine, presentation mapping, report schema, export serializer, API, CLI, providers, quotas or rule version. No added RPC calls, retries or provider switching.

## Screenshot comparison

Matching 390px viewports, aligned at the report heading, using identical deterministic reports:

| Scenario | M2 | M3.1 before | M3.1.1 after |
| --- | --- | --- | --- |
| Gas padding | [M2](../evidence/verification/mobile-refinement-m311/m2-gas-padding-390.png) | [Before](../evidence/verification/mobile-refinement-m311/before-gas-padding-390.png) | [After](../evidence/verification/mobile-refinement-m311/after-gas-padding-390.png) |
| Unknown transaction | [M2](../evidence/verification/mobile-refinement-m311/m2-unknown-on-all-providers-390.png) | [Before](../evidence/verification/mobile-refinement-m311/before-unknown-on-all-providers-390.png) | [After](../evidence/verification/mobile-refinement-m311/after-unknown-on-all-providers-390.png) |
| Contradictory transaction | [M2](../evidence/verification/mobile-refinement-m311/m2-transaction-receipt-block-conflict-390.png) | [Before](../evidence/verification/mobile-refinement-m311/before-transaction-receipt-block-conflict-390.png) | [After](../evidence/verification/mobile-refinement-m311/after-transaction-receipt-block-conflict-390.png) |

[Full mobile before](../evidence/verification/mobile-refinement-m311/before-mobile-flow.png), [full mobile after](../evidence/verification/mobile-refinement-m311/after-mobile-flow.png), [desktop after](../evidence/verification/mobile-refinement-m311/after-desktop-gas.png).

M2 comparison uses the unchanged production frontend assets, with every diagnostic POST intercepted and fulfilled with the same synthetic engine reports. The isolated M2 source build exceeded its 600-second bound. No production diagnostic or RPC requests were sent. Before and refined screenshots use local optimized builds. Screenshots were visually inspected, including all seven refined report scenarios.

Default report heights in pixels at 390px (expanded finding bodies differ intentionally between versions):

| Report | M2 | Before | After |
| --- | ---: | ---: | ---: |
| Healthy RPC | 1212 | 2353 | 1230 |
| Gas padding | 1786 | 3645 | 1740 |
| Gas estimate failure | 1683 | 3503 | 1700 |
| Known transaction | 1624 | 3733 | 1705 |
| Unknown transaction | 987 | 2584 | 1509 |
| Receipt timeout / observed inclusion | 1685 | 3679 | 1804 |
| Contradictory transaction | 925 | 2736 | 1558 |

These measurements establish reduced scrolling, not faster task completion. Unknown and contradictory reports remain taller than M2 because they preserve explicit lifecycle outcomes and uncertainty.

## Verification

- `npm test`: 169 passed, zero failed or skipped.
- Typecheck, CLI build, final clean production build and diff checks passed.
- Full ESLint: zero errors, five pre-existing warnings in `.qa` and `demo`. Focused changed-code lint: zero errors or warnings. An initial scan failed on a disappearing transient `.agents` directory; rerun passed.
- Guided browser suite: 23 passed; 14 mocked submissions.
- Responsive suite: seven real-engine fixture reports at 320px, 390px and 1440px; 21 passed, 21 mocked submissions, 21 JSON downloads equal to the unchanged redacted export serializer. No horizontal overflow or browser exceptions. Tests check metrics, original finding content and sources, visible warning headings, outcome columns, touch targets, keyboard expansion, evidence focus and absence of additional requests.
- Legacy browser harness: 10 passed; four mocked submissions. Historical test names mentioning real/live transactions describe mocked reports in this run.
- All browser acceptance used the final optimized build. Zero live RPC calls. All 74 existing `demo/` file hashes unchanged.

Run the new suite against a local optimized server with:

```sh
MONAD_DOCTOR_URL=http://127.0.0.1:3152 MONAD_DOCTOR_CHROMIUM=/path/to/chromium node --experimental-strip-types scripts/mobile-layout.mjs
```

The browser tests cover Chromium desktop/mobile viewports and keyboard interactions, not Safari, physical-device behavior or a human screen-reader audit. The longer unknown/conflict layouts are an intentional accuracy tradeoff. Full measurements and check results are in [the verification record](../evidence/verification/mobile-refinement-m311.json).

No push, deployment, promotion or production configuration changes were performed.
