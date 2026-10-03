# Geospatial Systems Compiler in the Notation Systems stack

**Geospatial Systems Compiler (GSC)** is Notation Systems' representation
compiler and inspection client. **Notations Engineering Terminal (NET)** is the
programmable scientific controller; its existing Python session/runtime remains
`ciw`. GSC does not become a peer scientific control plane or absorb specialist
mathematics.

This document records the **target ownership and interface requirements**. It
adds no executable compiler pass, browser panel, NET endpoint or deployed
integration. The [README](../README.md) distinguishes the existing application
from integration targets. Separate implementation branches and their checks
must be assessed on their own revisions.

The [NET controller architecture decision](https://github.com/giasonpooni/Notations-Engineering-Terminal/blob/1f5d2e6a1e58ca40074598f889b53e149e03d83e/docs/NET_CONTROLLER_BOUNDARY.md)
is pinned to its review revision, not presented as a merged runtime contract.

## Ownership

| Component | Responsibility |
| --- | --- |
| [NET / `ciw`](https://github.com/giasonpooni/Notations-Engineering-Terminal) | Investigation/session state, typed composition, operation dispatch, retained execution/result history, comparison, inspection and explicit replay. |
| GSC | Representation compilation, view configuration, local interaction, inspection of permitted supplied records/results and requests to NET. |
| [State Estimator for BIM](https://github.com/giasonpooni/State-Estimator-for-BIM) | Supported IFC interpretation, evidence conditioning, posterior belief, geometry authority and scoped BIM disposition. |
| [Curved Surface Runtime](https://github.com/giasonpooni/Curved-Surface-Runtime) | Supported geometry/path, sensitivity, tolerance, covariance and validity computations. |
| [ESM](https://github.com/giasonpooni/Evidence-and-State-Management) | Separately supported evidence/state retention, review, admission and release. |

**NET controls; specialist repositories compute; GSC represents; ESM governs evidence.**
GSC can inspect retained material without a live NET session. Standalone
viewing does not create execution or evidence authority. A common homepage and
UX do not require merging repositories, runtimes or private access boundaries.

## Bidirectional intent boundary

```text
NET -> GSC: permitted retained state, results, diagnostics and view material
GSC -> NET: selection, proposed variation or explicit operation/replay request
NET -> GSC: request outcome and permitted retained results
```

The browser presents investigation context. It does not recreate the existing
workbench's experiment engine, execution ledger or instrument implementations.
It never calls BIM, CSR or native scientific providers directly.

| Interaction | Treatment |
| --- | --- |
| Camera, layer styling, layout | Local view state; no NET or ESM round trip required. |
| Representation projection/rendering | GSC work on supplied material; not scientific state estimation or evidence admission. |
| Shared record/time selection | A typed NET intent where shared session state is involved; otherwise explicitly local inspection state. |
| Parameter variation | A proposal bound to an exact retained state, target, value and unit; NET validates before planning. |
| Execute or replay | An explicit request handled by NET's existing registered-operation boundary; not a side effect of a drag or selection. |
| Evidence admission/release | A separately authorized ESM workflow, never inferred from display or execution. |

A time cursor must specify its time basis and units/epoch where applicable,
and distinguish event time from knowledge time. Moving a cursor or carrying
its metadata does not itself reconstruct a historical state.

## Proposed intent requirements

A future NET adapter must use an explicitly versioned contract carrying a
request identity, investigation/session identity, expected revision, exact
source/result bindings and a typed target/value. NET must validate permissions,
stale state, quantity compatibility and provider availability. GSC may not
choose executable paths, install providers, modify source pins or register
operations through an intent.

Selection and preview cause no scientific execution. Accepted requests need
defined idempotency and duplicate/interruption behavior. A refused or failed
computation must not be rendered as a successful new result. Changing a view
must not mutate the original retained state/result graph.

These are requirements, not an existing wire API. The illustrative
`ciw.control-intent.v1` shape in the NET architecture document is a proposal;
this documentation does not register it, add a route or claim conformance.

## Representation is not scientific input authority

Preserve exact source/release/snapshot/run/model/result references, units,
coordinate frames, temporal meaning, missingness and diagnostic status.
Maintain separate identities for source state and compiled representation.
Unsupported views stay unsupported; missing geometry is not invented.

Covariance, sensitivity, residuals and validity limits come from the owning
instrument. GSC does not infer independence, reconstruct missing uncertainty,
repair a refused covariance or promote a mean-only response into a posterior.
Display geometry is not fed back into CSE/CSR as an authoritative surface. A
scientific geometry export needs a separately declared and qualified contract.

A BIM -> supported surface/path -> CSR -> GSC investigation needs an explicit
geometry/registration handoff upstream. A BIM entity ID, mapping digest or
entity-linked fixture is not proof of a registered scan or IFC-derived
parametric surface. GSC presents these limitations rather than supplying the
missing scientific conversion.

## Existing application and public presentation

The existing repository includes write-capable freight routes. This target
NET/GSC boundary does **not** reclassify every existing route as read-only,
remove freight functionality or migrate its operational records into ESM.
Keep legacy operations separate from the public scientific explorer.

Public examples use deliberately published artifacts, not arbitrary retained
private results. Contextual links or intents carry necessary identifiers and
view context, not private credentials or embedded private records. The
destination must authorize access; a link is not permission.

The browser remains TypeScript. Selected native workflows may use NET/Python
and existing SCR/Rust supervision with explicitly bound Julia or C++ providers
in their owners. This is not a four-language rewrite of GSC, CSE or CSR.

## Acceptance before claiming an integrated control surface

| Gate | Required demonstration |
| --- | --- |
| Read path | Exact result/source bindings retained through supported views, with detached representation state. |
| Selection/preview | No scientific provider launch; shared selection rejects stale revisions. |
| Execution request | NET alone validates and dispatches; repeated or altered requests have tested outcomes. |
| Temporal inspection | Explicit event/knowledge semantics and actual eligibility behavior, not cursor metadata alone. |
| Scientific handoff | Real supported upstream adapters and providers; unavailable geometry/uncertainty remains visible. |
| Lifecycle | Mount, resize, selection synchronization, disposal and provider-free reopening tested in the browser. |

Complete assigned implementation work before adding competing controller
machinery. This document does not merge active branches, change licences or
source attribution, alter repository visibility, publish private data or claim
numerical/physical qualification.
