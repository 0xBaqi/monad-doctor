# CLI M2 adversarial diagnostics

## Audit before implementation — 2026-10-13

Baseline: `d583bd9`. This milestone follows CLI M1; the earlier web milestone called M2 is historical and separate.

The shared engine establishes what one allowlisted provider returned: chain ID, normalized transaction/receipt fields, matching block membership, sampled heads and state-specific gas estimates. Receipt status establishes a provider-reported execution outcome, not a failure cause. Finality requires matching block evidence and coverage by the provider's finalized head; it is explicitly provider-attested, never an independent consensus proof. Null and failed requests remain unknown. An estimate is neither a universal minimum nor a future execution guarantee.

Audit risks to test, in impact order:

1. Adjacent block ancestry contradictions are ignored: a finalized head one height above the receipt block can have a different parent hash while the engine still reports finality.
2. RPC health checks freshness of latest, but not finalized. A stale finalized head can be hidden by a fresh latest observation.
3. Receipt gas is checked against transaction allowance, but not a matching block's gas limit. Impossible evidence may support execution/finality findings.
4. Injected RPC collectors have no provider identity check. An integration can accidentally label a secondary-provider observation as primary.

Already handled: mismatched transaction/receipt identities and block fields, receipt/block membership conflicts, same-height finalized hash conflicts, receipt gas above transaction allowance, wrong network, request deadlines/body bounds, malformed envelopes/results, missing receipts, missing block evidence, failed estimates and calldata/error redaction. Fixtures should verify these protections rather than present them as new weaknesses.

Web POST and CLI both call `diagnose`; the web boundary adds admission controls, while CLI JSON uses `exportReport`. Exports preserve one report's provider, rule IDs, evidence references, method/parameters, timestamps, normalized results and numeric error codes. There is no automatic cross-provider comparison: separate reports must retain their identities and cannot establish consensus. Contradictions will reuse error severity plus unknown basis and explicit conflict rules; observed/inferred/unknown remain compatible with both interfaces.

## Demonstrated changes

The first run on the unmodified engine passed **22/26** tests and failed exactly the four audit hypotheses. An isolated snapshot of `d583bd9` was replayed against the same fixtures to record before/after findings. No production incident or external exploit is claimed.

| Evidence | Before | After (`m3.1`) |
| --- | --- | --- |
| Finalized head immediately follows the receipt block but has the wrong parent hash | `tx.finalized` pass | `tx.finality-unknown`, error/unknown; receipt status remains attributed, finality is suppressed |
| Finalized head stale while latest is fresh | No freshness warning | `rpc.finalized.clock-risk`, warning/inferred; age does not reverse historical finality |
| Receipt gas exceeds a matched block's gas limit | Execution, inclusion and finality passes | `tx.inconsistent`, error/unknown; outcome conclusions suppressed |
| Secondary collector injected with primary input | Five secondary RPC calls labeled primary | Validation rejection before any RPC call; an integration attribution guard |

The provider allowlist, six read-only methods, ten-call/18-second collector budget, per-request deadlines/body bounds, HTTP admission controls and calldata/error redaction are unchanged. New cases use at most five calls per report. Compiled CLI artifacts were regenerated from the same shared engine. Report schemaVersion/exportVersion remain 1; `m3.0` exports stay compatible. No new diagnostic command, provider aggregator or dependency was added.

## Cases and unsupported conclusions

[Fixture definitions](../tests/fixtures/adversarial.ts) specify inputs, simulated RPC replies, expected findings/uncertainty, forbidden claims and provenance expectations. [Engine tests](../tests/adversarial.test.ts) exercise production collectors, validation, rules and exports; [boundary tests](../tests/adversarial-boundaries.test.ts) exercise the actual HTTP handler and CLI. Existing direct rule/transport fixtures remain regression coverage; new end-to-end cases complement them.

| Requested case | Checked conclusion / uncertainty |
| --- | --- |
| A receipt, B no receipt | A retains its attributed observation; B stays unknown. Absence alone does not refute presence. |
| Conflicting receipt hashes/statuses | Separate provider reports retain both claims; no agreement is asserted. Within-report transaction, receipt, block membership and finalized hash conflicts are errors. |
| Stale finalized/latest | Separate inferred clock/freshness warnings; no diagnosed network outage or loss of historical finality. |
| Unknown on both providers | No execution/finality, pending, dropped or failed conclusion. |
| Timeout in transaction analysis | Partial inclusion evidence retained; receipt outcome unknown; CLI exit 3. |
| Malformed/truncated/inconsistent payload | Invalid status, truncated JSON, wrong response ID and result-plus-error envelopes become MALFORMED evidence. |
| Revert scenario without confirmed reason | Only failed execution is observed; no confirmed REVERT opcode or reason. |
| Gas exhaustion suspected | Status 0 and gasUsed equal to the allowance still do not establish out-of-gas. Impossible accounting is a contradiction. |
| Estimate far below proposed limit | Inferred padding/conditional cost warning; no universal minimum, guaranteed execution or actual savings. |
| Estimation RPC error | Unknown estimate; no fallback, cost comparison or confirmed on-chain failure. Arbitrary error/reason/data strings removed. |
| Contradictory chain IDs/wrong network | Wrong provider stops after chain ID; no dependent Monad outcome. |
| Recovery after failed observation | New report succeeds; earlier error and unknown report remain intact. |

Observed, inferred and unknown keep their existing meanings. Contradictory evidence is explicit through error severity, unknown basis and conflict rule IDs, rather than a numeric confidence score. A finalized-head contradiction does not erase a separately observed receipt status; a receipt/block or impossible-gas contradiction suppresses the outcome itself. [Report semantics and CLI exits](reports.md) describe the distinction.

Every fixture checks that export preserves provider, input/hash or block tag, method, request ID/time, normalized result or sanitized error code, finding references and rule version. Numeric RPC/HTTP error codes survive. Calldata is redacted in both input and estimation parameters; unexpected receipt fields and arbitrary provider error text are excluded. Export is non-mutating. Each paired web/CLI run has identical mocked inputs and evidence and yields the same findings and redacted export. CLI transport errors retain precedence over diagnostic error exits; web reports remain HTTP 200 with separately enforced input/admission errors.

## Verification — 2026-10-13

- `npm test`: **130/130 passed** (79 existing + 26 adversarial + 25 boundary tests); zero failed, skipped, cancelled or todo. The 25 fixture scenarios contain 31 provider observations; the additional adversarial test covers collector identity.
- `npm run typecheck`, `npm run cli:build`, `npm run build` and `git diff --check`: passed. Next.js 16.4.0 completed compilation, TypeScript, all three static pages and API route generation.
- `npm run lint`: passed, zero errors and three pre-existing warnings in untouched `demo/` scripts. A warning in the new test was corrected before final verification.
- Compiled CLI: **34/34** checks passed, including all 31 mocked report/exit/export comparisons plus help, version and invalid invocation. These are synthetic subprocess checks, not live Mainnet observations.
- Local production HTML: **7/7** render checks passed on a temporary localhost server. Actual HTTP-handler regressions cover all 31 simulated observations. No full interactive browser or new live RPC acceptance run is claimed for this milestone.
- `demo/`: all 80 paths/modes/sizes/symlink targets/file hashes match the initial snapshot. It is excluded from the commit.

Sandboxed Node test subprocesses reported only 11 file results; the subprocess-capable rerun reported all 130 individual tests. Sandbox runs also returned empty stdout from the compiled CLI harness and could not reach localhost; external reruns passed. A targeted sandbox lint exceeded 90 seconds after the extra provenance assertions; final full lint outside the sandbox passed with only the three existing demo warnings. These were verification-environment failures, not repaired product defects. SWC loaded and the production build succeeded with the dependency already restored during M1. No dependency or lockfile changes were needed. The temporary local server stopped after its bounded run.

Machine-readable before/after results and check summaries: [CLI M2 evidence](../evidence/verification/cli-m2-adversarial.json). Reproduce with the mandatory commands above; fixtures run without network access or credentials. Nothing was deployed, published or pushed.

## Remaining blind spots

One report trusts one provider. Cross-provider conflicts are preserved in separate reports but are not automatically detected/aggregated by the product, and even provider agreement cannot prove consensus. Header/receipt proofs and ancestry across larger height gaps are not verified; the new adjacent check rejects a directly visible contradiction only. Sequential samples can change. Freshness depends on local clock/application heuristics. Null history cannot identify pending/dropped transactions. Receipt status/gas cannot distinguish REVERT from out-of-gas; traces/revert reasons are outside the read-only method allowlist. Estimates remain state-specific and cannot guarantee future execution. Synthetic tests establish behavior under their supplied evidence, not real-provider reliability.

Official references rechecked for scope: [RPC transaction/null and unfinalized-data behavior](https://docs.monad.xyz/reference/json-rpc/overview), [Finalized versus Verified block states](https://docs.monad.xyz/monad-arch/consensus/block-states), and [gas-limit accounting](https://docs.monad.xyz/developer-essentials/gas-pricing). None supplies independent finality verification to this application.
