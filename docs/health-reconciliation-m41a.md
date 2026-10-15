# M4.1A: pure health reconciliation

This isolated module consumes supplied observations. It collects nothing and has no networking, scheduling, API, UI, export or CLI integration. Existing diagnostic rule version `m3.1`, report schema 1 and export version 1 are unchanged. Its separate reconciliation rule version is `m4.1a`.

## Interfaces

`validateHealthSnapshot(unknown)` validates, normalizes, copies and deeply freezes a `HealthSnapshot`. `reconcileHealthSnapshots(left, right)` validates both snapshots, checks their shared context, and returns a deeply frozen `HealthReconciliation` containing copied snapshots, integrity issues and field-level rows.

Snapshots declare the same opaque run ID, health input, distinct approved provider pair, and optional explicit historical height. Pair order is normalized; left/right result attribution follows argument order. Each snapshot owns collections and slot references for chain identity, latest, finalized and optional historical block observations.

References are `{ runId, provider, collectionId, evidenceId }`. Collection/run/provider ownership, unique collection IDs, unique IDs within each collection, exact resolution and slot request context are mandatory. IDs can repeat across providers or collections. Unreferenced evidence is rejected rather than silently omitted. At most four collections and ten evidence entries per snapshot are accepted.

Observations distinguish `value`, `null`, sanitized `error` and local `skipped`. An absent slot is `missing`, without an invented reference. Errors accept known codes only; arbitrary upstream messages/data are rejected. Skipped operations have a reason and no observation timestamp.

This is a narrow health projection: block number, hash, parent hash and timestamp. A future adapter must explicitly project a validated RPC block into this contract; full RPC bodies are not accepted. No calldata field or free-form diagnostic prose is accepted.

## Relations and eligibility

| Subject | Decision once eligible |
| --- | --- |
| Network identity | Equal IDs: `match`; unequal IDs: `contradiction` between network claims. The expected identity remains `0x8f`. |
| Latest/finalized position | Equal numbers: `match`; unequal numbers: `difference`. |
| Finalized identity | Different heights: `not_comparable`; same height and hash: `match`; same height and different hashes: `contradiction` between finalized RPC claims. |
| Historical identity | Exact requested height and equal hashes: `match`; different hashes: `difference`. No ancestry or finality inference is added. |

Unknown chain identity yields `incomplete`. A known wrong chain makes dependent block rows `not_comparable`, even if both providers return the same wrong chain ID. A network field match is not a network-validity verdict.

**Conservative block-bundle policy:** every block row requires both providers' complete, consistent requested block bundles: latest and finalized, plus historical when requested. Known integrity issues take precedence and produce `not_comparable`; missing/null/error/skipped bundle members produce `incomplete`. Original observations remain visible in copied snapshots and row views.

This intentionally sacrifices some possible partial field comparisons. It prevents replacing an observation with an error from erasing a local contradiction and upgrading another block row to a usable match. Network comparison remains independent. There is no overall success verdict, confidence score or relation-to-severity mapping.

Missing, null and unavailable blocks never become height zero. Both nulls do not establish a matching block identity. Differences in finalized positions do not become identity contradictions. Matching unrelated rows cannot suppress explicit contradictory rows or integrity issues.

## Intra-provider integrity

The module checks:

- Historical result number versus the exact requested height.
- A later latest block behind an already observed finalized block.
- Conflicting hashes at the same finalized/latest height, when finalized was observed first.
- Direct parent mismatch for an adjacent later latest block.
- Later historical observations contradicting same-height finalized identity or the immediately preceding finalized parent.
- Different retained number/parent/timestamp fields for the same reported block hash, regardless of ordering.

Ordering uses supplied `startedOffsetMs` and `durationMs` intervals relative to the run's monotonic origin. `observedAt` must be a valid canonical UTC timestamp, but wall-clock skew cannot change order. Only strictly separated intervals establish order: touching, overlapping, equal zero-duration or reversed intervals do not establish “sampled later” contradictions. The function does not read the current clock.

An integrity issue quarantines the requested block bundle; it does not delete evidence or change original observations into errors. Input/reference/context violations reject the invocation with `ValidationError`; structurally valid but contradictory provider claims produce a result with explicit issues.

## Guarantees and limitations

- Deterministic for the same supplied inputs, without mutable shared state.
- Input objects are neither modified nor frozen; output is detached and deeply frozen.
- Swapping providers preserves relations and reasons while swapping ownership and attribution.
- Returned references resolve within the same snapshot/run, not another report with the same numeric IDs.
- No comparison certifies current freshness. Even an old historical match remains only sampled historical identity agreement. No freshness threshold or protocol timeout is invented.
- No ancestry traversal, consensus certificate validation, execution-root verification or provider ranking.
- Declared ownership and monotonic offsets are validated for consistency, not authenticated. A caller can fabricate an internally consistent snapshot. Two providers may share infrastructure or agree on false data.
- Selected-field identity agreement does not mean every RPC field matches. Cross-provider metadata beyond the compared fields is not reconciled.
- There is no exported report format in this phase. The returned object is an internal typed result, not a replacement for the existing report serializer.

## Deterministic verification

Fixtures are manually constructed and never instantiate collectors or call RPC endpoints. The tests cover relations, bad ownership/context, numeric-ID namespaces, missing/null/error/skipped states, temporal and parent contradictions, wall-clock skew, immutable results, serialization and provider symmetry. A value-to-error property sweep checks both providers and every slot across consistent and contradictory examples.

Focused command:

```sh
node --experimental-strip-types --test tests/health-reconciliation.test.ts
```

If the environment's child-test reporter aggregates only file outcomes, direct execution exposes the individual assertion count:

```sh
node --experimental-strip-types tests/health-reconciliation.test.ts
```

Required regression checks are the existing full test script, TypeScript, ESLint, CLI build, production build and `git diff --check`. No live RPC or browser acceptance is needed for this unintegrated pure module.

### Local verification results

- New reconciler suite: **55 tests passed**, including a 24-replacement value-to-error property sweep.
- `npm test`: passed all **13 test files**. Because this environment's child-test reporter aggregates file outcomes, each suite was also executed directly in its own process: **224 tests passed, 0 failed** (169 existing, 55 new).
- `npm run typecheck`: passed. An initial test-fixture union annotation was narrowed to the actual value-observation return type before the successful check.
- `npm run lint`: passed, **0 errors / 5 existing warnings** in `.qa/` and `demo/`. Focused lint of the new TypeScript files: no warnings or errors.
- `npm run cli:build`: passed.
- `npm run build`: passed compilation, TypeScript, static page generation and route output. The first sandboxed attempt failed parsing the TypeScript subprocess's `--showConfig` output; standalone `--showConfig` returned valid JSON. An outside-sandbox retry passed compilation and TypeScript but reached its 600-second limit during page collection. The final outside-sandbox attempt completed within its 900-second bound, without source or configuration changes. These earlier failures are recorded as environment-related execution limitations; the precise subprocess parsing cause was not established.
- `git diff --check`: passed.
- Existing source/configuration files are unchanged. All **74 files** in `demo/` matched their initial SHA-256 manifest.

No live RPC requests, browser tests, deployment commands or production changes were performed.
