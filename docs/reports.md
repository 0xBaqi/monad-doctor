# Reading and sharing diagnostic reports

Each finding keeps its rule ID, observed/inferred/unknown basis, severity, evidence references, official documentation links and next step. Expand **Understand and verify this finding** for what was checked, remaining unknowns, why it matters and a concrete recheck. A warning marked inferred is a risk, not a confirmed fault.

RPC health verifies identity and sampled heads; a connection error is not proof the Monad network is down. Gas analysis compares input with a state-specific RPC estimate and documented cap, without submitting anything. Transaction lifecycle separates block inclusion, receipt execution and provider-attested finality. A failed finalized transaction stays failed; rerunning the diagnostic only updates evidence.

Sharing JSON uses exportVersion 1 and preserves schemaVersion, ruleVersion, collection/request timestamps, sanitized input, findings, evidence and reproduction instructions. Exports are explicit allowlisted projections: unknown metadata is dropped, RPC results are revalidated, arbitrary upstream error text is replaced with a local explanation, and calldata is redacted in both input and estimate parameters. Foreign documentation URLs, dangling evidence references, unsupported methods and invalid metadata cause export to fail visibly. It does not mutate the original report.

Exports are for sharing observations, not direct replay/import. Re-enter calldata locally and never insert credentials into diagnostic inputs. Public addresses/hashes remain. Gas price and block state can change between runs, so compare rule IDs, estimates and timestamps rather than expecting byte-identical reports. A report is evidence from a provider, not a cryptographic attestation. The app has no generic imported-report execution path.

Raw local QA files under evidence/live may retain the unsigned empty-calldata demonstration input; only reviewed artifacts belong in Git. Put personal exports under exports/ (ignored), not in source directories. Never commit arbitrary user-provided exports.
