# Industrial pipe — Pipe 1 foundations

Notation Systems operates provenance-bearing computational corpora across
PAYLOAD / TRADEWIND / LANDSHARK. GSC / Frame Mapper projects supplied industrial
state; NET's `spatial.map` is an interface target, not a shipped command.

**Fence:** person-CAI is out of scope forever in this tree. No natural-person,
resident, phone, device-advertising or people-geofence yield. Existing collection,
source, route and description gates remain mandatory. Conditional infrastructure
attribution keeps its condition in the implementing source file. Sanctions stay
organisation/vessel/aircraft-only, with the person path filtered from results.

| Package | Shape, not a rate or availability claim |
| --- | --- |
| Seat | One commodity or exact registered corridor; research context and evidence counts |
| Feed | Rights-qualified industrial source vintages; official access does not grant bulk resale |
| Watch | A buyer's bounded industrial-object set; no monitoring service added here |
| Proof | [Notary verdict over committed readings](notary.program.md); not a new proof engine |

**Objects → identities:** organisation and site → `Entity`; material movement →
`Flow`; quantity → `Observation` / `Capacity`; operator versus shareholder →
`Dependency`; bounded change → `EconEvent`; disagreement → `Divergence`.
Parcel, voyage and contract integrations are not implemented by this mapping.
`UnresolvedIdentifier`, provenance, valueKind, confidence, knowledge time and row
accounting remain explicit; similar names never establish identity.

**Implemented:** source-registry sensor cards; exact acquisition rungs; completed
assembly time; `GET /api/economy/seat` projection and `?view=sensors` ledger.
`POST /api/economy/seat` records typed query/miss/refusal context. Journal reads use
`?view=artifacts&kind=miss&sessionId=<opaque-uuid>`. Both require the existing
`PAYLOAD_OPERATIONS_TOKEN` Bearer authority. No raw question text is accepted;
questions use a bounded vocabulary plus canonical entity and registered source
IDs. Refusals carry policy / resolution / basis / coverage reason codes and remedies.

Records append under `PAYLOAD_MISS_LOG_DIR` (existing archive default). Misses
share `search-misses.jsonl`; queries/refusals extend the existing session telemetry
with private journals. Old raw rows are neither rewritten nor served; readers
count every filtered/rejected row. Writes acknowledge only after sync. Journal
reads are bounded and require operator rotation beyond 16 MiB. These are operator
records, **not verified non-builder demand**; frozen S-7 counters are unchanged.
Optional authenticated `sessionId` on a projection GET records what was served;
machine-declared traffic is excluded. Historical record selection and current
assembly/sensor health are labelled separately. Cards describe posture, not rights.

**Non-goals:** billing, new intelligence branding, licensed AIS/resale, person-data
products, ESM admission, parcel ingest, a NET command, viewport compute kinds,
engine conversions or a new authentication product. Godot/Bevy remain projectors.
No live fetches in tests without `RUN_LIVE_TESTS=1`; no secrets or relicensing.
