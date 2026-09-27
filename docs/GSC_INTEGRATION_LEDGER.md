# Geospatial Systems Compiler — integration ledger

## Source pins and scope

- Destination: `giasonpooni/Geospatial-Systems-Compiler`, formerly Payload-Terminal-V0.
- Payload baseline: `9e9e2927d34252f0850f85af4a22d08b97423b5a` on `claude/osiris-physical-economy-7o9g2w`.
- GSV baseline: `giasonpooni/Geospatial-State-Visualization@58713d02d4e79c52290ee9d0da51ea6b4d0677ed`.
- Integration branch: `gsc/compiler-ir-foundation`.

This is an incremental consolidation, not a claim that the two applications are already one. This ledger is committed before implementation. No existing renderer, freight route, source record, license notice or test is to be removed by the first slice.

## Audit ledger

| Existing subsystem | Decision | Destination / invariant | First-slice scope |
| --- | --- | --- | --- |
| GSV `src/data/contracts.ts` | ADAPT | Provider compatibility types; preserve source IDs, WGS84 longitude/latitude, assertions versus observations | Import the required contracts without making them the general IR |
| GSV `src/data/validation.ts` | KEEP | Bounded plain-data validation, strict UTC calendar checks, detached frozen snapshot, reference integrity | Bring the existing validator into the compatibility boundary; retain its checks |
| GSV `src/data/store.ts` | KEEP | Atomic replacement, stale-load protection, comparison eligibility | Leave existing application intact; do not claim its store has migrated |
| GSV `src/data/synthetic/*` | KEEP | Deterministic synthetic provider; source-labelled records | Full dataset/provider migration remains pending; compiler fixtures are explicitly synthetic |
| GSV `src/geo`, `src/earth`, `src/layers` | ADAPT | Three.js globe, geometry basis, layers, GPU flows, LOD | Renderer migration remains pending; output contracts must not import Three.js |
| GSV `src/app/api.ts`, commands, view tools | MERGE | View operations only; no execution/admission authority | Shared investigation selection model first; browser facade migration later |
| Payload `src/lib/economy/types.ts` | DOMAIN-SPECIFIC | Preserve reported/estimated/derived/representative, geographic precision, quantity basis, inclusive date periods, knowledge-time fallback basis | Read-only entity/observation projection adapter; do not cast the entire domain corpus into a different schema |
| Payload map, panels, search, temporal UI | MERGE | MapLibre investigation shell; exact source and time context | Consume compiler outputs after contract tests; existing UI remains unchanged initially |
| Payload freight journal and write APIs | DOMAIN-SPECIFIC | Existing authorization, persistence, evidence and operation identities | Untouched; not promoted into public read-only compiler capabilities |
| Payload source/route/description gates | KEEP | Existing collection and public-description policy | No new acquisition or write API; preserve existing checks |
| ESM / CIW / scientific runtime | KEEP | External evidence/state governance, sessions, computation and verification | Reference bindings only; no fabricated integration or authorization |

The source audit is bounded to the documented responsibilities, provider implementation and contracts inspected for this slice. It is not a completed file-by-file renderer, performance or browser-lifecycle audit.

## First executable target

```
GSV snapshot ── existing eligibility validator ─┐
                                             ├─ typed, renderer-blind IR
Payload entity/observation projection ────────┘        │
                                      identity/time/provenance/frame checks
                                                    │
                             table + geographic + temporal + relational outputs
                                                    │
                                   source trace + shared investigation selection
```

## Invariants

Representation IR is a transient inspection format, not a canonical evidence/state store. Compilation IDs, source-record IDs, upstream run IDs, evidence references and verification identities are separate. Validation is not authentication or scientific verification. Rendering is not admission. Missing provenance, units, geometry and uncertainty remain explicit; they never become invented evidence, unitless values, coordinates or zero variance.

Epistemic classification and availability are separate axes. A synthetic observation remains an observation record with synthetic origin. A reported value is not automatically a direct observation; representative magnitudes are not relabelled synthetic or fresh reported evidence. A calendar date remains a date, not an invented midnight instant. Coordinate axis order and geometry basis must survive projection.

## Completion gates

- Compiler passes, adapters and projections run against bounded fixtures and malformed inputs.
- Source inputs are not mutated; emitted IR is detached and deeply frozen.
- Invalid identities, unresolved internal references, malformed calendar times, nonfinite values and unsupported frames receive explicit diagnostics.
- Selection and view changes preserve dataset/snapshot/release/run/model bindings.
- Tests, commands and actual execution limits are reported separately from architectural targets.
- Full application consolidation additionally requires a shared running browser surface, globe lifecycle migration, existing-suite parity, real published dataset integration and tested CIW/ESM handoffs. Those are not satisfied by merely adding compiler code.

## Attribution

Imported/adapted GSV source remains attributable to the pinned repository above under its existing GPL-3.0 license. Payload's existing GPL license and inherited third-party notices remain unchanged. Repository naming does not remove copyright or license obligations.
