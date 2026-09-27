# Capability replacement without gaps

Notation Systems' development is defined by implemented visual inspection,
explicit data contracts and instrument-supplied scientific methods, not by
upstream dashboard branding. Historical lineage and retained license notices
are documented separately in [ORIGIN.md](ORIGIN.md).

This is an engineering inventory, not a percentage-of-originality score.
A rewrite, new name, test count or larger README does not establish scientific
validity or eliminate inherited-code obligations.

| Existing responsibility | Alternative or extension | Current state | Gate before retiring the old path |
| --- | --- | --- | --- |
| General dashboard entry | `/notation` and `/explore`, organized around visualization, selection and evidence | Added; `/` retained | Route migration, browser regression and explicit deployment cutover |
| Geography as a collection of feeds | Exact ESM projection with pinned source/release/time and GSV point inspection | Bounded consumer implemented; configured service not assumed | Real ESM contract test, publication review, browser and failure-path checks |
| Ad hoc value comparison | Same-subject, predicate, unit and basis comparison with explicit refusals | Implemented with numerical edge-case tests | Domain-specific estimators remain instrument-owned |
| Assumed or hidden data completeness | Descriptive missingness and geometry diagnostics | Implemented; no quality score | Do not interpret counts as source reliability |
| Global viewer lifetime | Container-sized engine, removable callbacks, stop/dispose | Implemented for the embed; standalone path retained | Chromium lifecycle regression and resource review |
| Freight authorization and operating records | Existing guarded freight operations | Retained, not replaced | Equivalent authorization, persistence, replay and outcome tests |
| Scientific inference, uncertainty propagation, conservation | Existing specialist instruments through workbench/result adapters | Further integration required | Units/frame checks, solver and calibration evidence, covariance coverage, recorded run and verification bindings |
| Polygon/extent display and geodetic measurements | Dedicated representation-aware rendering and geometry instrument outputs | Shapes retained and checked; point embed does not draw them | Explicit edge semantics, frame transforms, error bounds and regression cases |

The machine-readable [replacement-ledger.json](replacement-ledger.json) protects
named existing files and records each additive implementation. CI checks that
these paths and their declared tests still exist, checks the retained upstream
notice, and rejects an unreviewed `RETIRED` status. It is a structural guard, not
proof of scientific equivalence. Existing domain tests must continue to run.

The development sequence is: implement alongside the existing path, test the
contract and numerical edge cases, compare outputs on declared inputs, inspect
failures and performance, then decide whether retirement is justified. No
legacy capability is declared retired in this increment.
