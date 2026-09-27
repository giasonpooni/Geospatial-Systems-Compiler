# Geospatial Systems Compiler — implemented first slice

GSC now has a renderer-independent compiler library at `src/lib/gsc/`.
It can read GSV snapshot records and a declared Payload entity/observation
projection, validate them, and emit several views of the same source-bound records.
This is working compiler code, **not yet a merged browser application**.

```
GSV WorldSnapshot ── preserved GSV validator ──────┐
                                                ├─ representation IR
Payload entity/observation projection ───────────┘       │
                          identity → time → quantity → geometry → provenance
                                                       │
                      ┌────────────┬────────────┬────────┼───────────────┐
                    table       GeoJSON     timeline  relations   unit sphere
```

## What runs

- `adapters.ts`: `compileGsv` and `compilePayload`. Both take untrusted plain
  input, a caller-assigned compilation ID and explicit upstream bindings.
- `compiler.ts`: bounded input checks and five explicit validation passes.
  Invalid input returns diagnostics without a partial successful IR.
- `ir.ts`: distinct representation/source identities, record roles, origin
  classification, geometry/frame/basis, scalar quantities, two clocks,
  validity and measurement intervals, provenance and uncertainty references.
- `projections.ts`: table rows, GeoJSON features, temporal records, relation
  edges and GSV-compatible unit-sphere vertices. Outputs retain compilation
  and upstream bindings; omitted spatial entities have explicit diagnostics.
- `investigation.ts`: strict local selection/view commands, independent event
  cursor and knowledge cutoff, and rejection of cross-compilation bindings.
- `compat/gsv/`: adapted source contracts and the existing GSV eligibility
  validator. No Three.js, MapLibre, React, DOM or service dependency enters
  the compiler library.

## Example

```ts
import { compileGsv } from '../src/lib/gsc/adapters';
import { project } from '../src/lib/gsc/projections';
import { beginInvestigation, transitionInvestigation } from '../src/lib/gsc/investigation';

const compilation = compileGsv(snapshot, 'compile:example-1', {
  datasetId: 'dataset:example',
  snapshotId: 'snapshot:producer-supplied',
  releaseId: null,
  runId: null,
  modelId: null,
});
if (!compilation.ok) throw new Error(JSON.stringify(compilation.diagnostics));

const geographic = project(compilation.value, 'geojson');
const tabular = project(compilation.value, 'table');
const investigation = beginInvestigation(compilation.value);
if (investigation.ok) {
  const next = transitionInvestigation(compilation.value, investigation.value,
    { type: 'view', value: 'unit-sphere' });
  // A view transition retains selection and upstream bindings. It executes no workload.
}
```

For Payload, pass `{ entities, observations, coordinateFrame }` to
`compilePayload`. These are projections of the existing economy contracts, not a
replacement domain model. Supply `CRS84` from `adapters.ts` only when the producer
actually declares longitude/latitude in WGS84 degrees. An absent frame keeps
coordinates in the source detail but omits spatial geometry. A supplied different
frame is refused: assigning a new CRS label is not reprojection. Extra top-level
collections such as flows are refused rather than silently discarded. Full
Payload flows, capacities, dependencies, events and analytical outputs need their
own mapped contracts in later slices.

## Meaning preserved

A synthetic observation has role `observation` and valueKind `synthetic`.
Payload `reported` is not renamed `observed`; `representative` is not renamed
`synthetic`, `computed` or fresh reported data. Missingness and unsupported
capabilities are expressed using nulls and diagnostics, not epistemic labels.

Payload inclusive calendar-date periods remain date-valued and inclusive.
GSV UTC instants and half-open validity intervals retain their conventions.
When Payload supplies no knownAt, its documented retrievedAt fallback is marked
`retrieval-upper-bound`. Entity provenance and knowledge time are not invented
from an associated observation. Mixed date/instant comparisons require an
explicit precision policy and are refused by the comparator.

No unit conversion, interpolation, smoothing, aggregation, independence inference,
covariance propagation, simulation, source authentication or scientific
verification is performed. An empty uncertainty-reference list means no references
were supplied, not zero uncertainty. The initial normalized quantity is scalar;
vector/tensor fields, timed trajectories and native instrument-result imports
remain unimplemented rather than represented by empty capability shells.

`unit-sphere` preserves GSV's display convention: longitude 0 is +X, longitude
90 east is -Z, and north is +Y. Its output frame is
`gsv.unit-sphere-display.v1`. It is not ECEF, an ellipsoidal geodetic conversion,
a metric world frame, a routed path or an uncertainty transform. GeoJSON emits
only explicitly bound CRS84 geometry and does not invent flow paths.

Source detail is preserved in a detached, frozen `sourceRecord` for compatibility
inspection. Specialized fields not yet normalized (for example GSV route-history
samples and inline constraints) remain there. This in-memory copy is not a new
canonical corpus. Consumers must not treat presence in the IR as admission,
public publication, source authenticity or authorization to execute.

## Run the actual checks

```sh
node scripts/test-gsc.mjs
npm test -- src/lib/gscContract.test.ts
```

The first command uses the repository's installed TypeScript compiler, falling
back to a global `tsc` when available. It compiles into a disposable temporary
directory, checks the static dependency boundary and executes the Node regression
tests. No new npm dependencies are required. The Vitest wrapper also puts these
checks on the existing `npm test` path without changing its argument semantics.

The local implementation run used Node 22.16.0 and TypeScript 5.8.3 and passed
59 Node tests, strict compiler-slice typechecking and the dependency-boundary
check. One test restores the adapted validator's original comments/export and
verifies its exact Git blob ID `fe6a9db4b0faa43426b84136088adae66a37f07a`.
The fixtures are bounded compiler test data, not the original complete GSV
synthetic world, a real published dataset or validated scientific experiments.

## Explicit remaining work

The existing Payload interface/freight APIs and separate GSV application remain
unchanged. No combined browser screen, Three.js mount/resize/dispose migration,
MapLibre binding, complete GSV provider import, source-time eligibility filtering,
replay, ESM adapter or CIW handoff is claimed by this slice. Investigation clocks
are carried as context only; the timeline lists source time metadata rather than
claiming to resolve state at a selected time. Consumers must not label it
as-known replay until eligibility filtering is implemented and tested.

Full application dependency installation, the inherited complete test suites,
Next.js production build and GPU/browser tests could not be run in this editing
environment because direct network/dependency access was unavailable. They remain
integration gates. The integration branch must not be described as the completed
two-application consolidation merely because the isolated compiler checks pass.

See [GSC_INTEGRATION_LEDGER.md](GSC_INTEGRATION_LEDGER.md) for source pins,
subsystem decisions and the remaining migration gates. Existing licenses and
third-party notices remain in force. GSV's validator and extracted spherical
formula are attributed to the pinned GPL-3.0 source there.
