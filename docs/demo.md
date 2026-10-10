# Monad Doctor: repeatable three-minute demo

Message: Find and fix Monad integration problems before they reach production.
Journey: Problem -> Diagnosis -> Evidence -> Fix -> Verify.

| Time | Screen | Narration and action |
| --- | --- | --- |
| 0:00 | Dashboard | Developers need to distinguish network problems, gas assumptions and transaction outcomes. This tool reads and simulates; it never signs or broadcasts. |
| 0:20 | RPC health | Choose an approved provider and run. Show actual chain ID 143, head timestamps and any unknown findings. Expand evidence and official references. |
| 0:45 | Gas analysis | Load padding example: proposed 1,000,000, zero value, empty calldata. Run live. The historical estimate was 21,000; show today's actual estimate, even if different or unavailable. |
| 1:15 | Gas evidence | Monad charges submitted gas limit. Show the pinned block and estimate response. For this unchanged simple example, enter the returned estimate and rerun; inspect the fresh estimate and warnings. Never claim guaranteed success or actual fee savings. |
| 1:45 | Synthetic network example | Label screen SYNTHETIC FIXTURE. Show docs/before-after.md and the deterministic test returning chain 1 rather than 143. Explain the correction and rerun real health separately. Never inject this into a live report. |
| 2:00 | Lifecycle | Inspect the actual successful and failed execution hashes below. Show inclusion, execution and finality separately. Failure status alone does not identify the root cause. If lookup is unavailable, show the timestamped historical report explicitly as historical. |
| 2:40 | Export and verify | Expand a finding's verification instructions, inspect evidence IDs and documentation, export sanitized JSON. Calldata must be re-entered locally to reproduce. |

## Actual historical transaction samples

Captured in evidence/live/2026-10-10T11-56-38-010Z/; these are live observations from that time, not fixtures:

- Successful execution: 0x06577e0c5b2c8f879c340d71875704d8393ccf4b4b9ea63d1a3c1c02b75976eb
- Failed execution: 0x1a88505563e1ef771885a44548e7047b943a61fe4282d816823370feb7ac5051

Requery each using Transaction lifecycle. Do not promise providers retain historical data. Show missing evidence honestly. The historical failed receipt does not prove a specific revert opcode or out-of-gas cause.

## Rehearsal

Start the production build locally, or use the verified deployment URL when available. Run npm run live:smoke once, then the demo. Avoid repeated rapid runs that exceed quotas. Keep docs/before-after.md available for the recorded gas case and synthetic explanation. A timeout is an unknown result, not a reason to replace evidence. Video recording is deferred to M5.
