# GSC's boundary with Julia, Python, Rust and C++

GSC remains a TypeScript representation/compiler client, not a second scientific
executor. The shared path is:

```text
CSE / Curved-Surface-Runtime: domain-owned Python model case
  -> Notations Engineering Terminal / Python: validation, normalization, retention
  -> Scientific Computation Runtime / Rust: bounded native dispatch
      -> C++ affine kernel OR Julia affine provider
  -> retained CIW result -> exact-byte numerical view -> GSC read-only inspection
```

`src/lib/notation/linear-map-view.ts` implements the read-only numerical-view
import. Its companion producer is
`Notations-Engineering-Terminal/src/ciw/polyglot_linear_map.py`. No Rust crates,
C++ sources, Julia environment, native executable, provider credentials or
private source repositories are embedded in this web application.

## Import a retained view

```typescript
import { inspectLinearMapView } from './src/lib/notation/linear-map-view';

const inspection = await inspectLinearMapView(envelope, selectedArtifact.sha256);
// inspection.view.outputs: id, unit, baseline, signed delta, value
// inspection.view: frame, model and execution/result/runtime/verification identities
// inspection.authority is always 'none'.
```

`selectedArtifact.sha256` must be selected independently from a trusted retained
artifact record. Passing `envelope.sha256` as the expected digest only checks
self-consistency and is not a trust decision. The function hashes the exact
UTF-8 payload string emitted by Python: JavaScript must not reserialize it to
verify the digest. The input string is snapshotted before asynchronous hashing
so caller mutation cannot replace the bytes that were checked.

The reader checks the envelope, schema, complete digests, exact field sets,
finite numeric quantities, explicit units/frame, supported provider/profile,
unique output identifiers and byte/output budgets. The returned model and
quantities are detached and frozen. Nonfinite/coerced values, unexpected fields,
authority/proof/admission claims and tampered bytes are refused.

This view deliberately cannot become an execution request or an ESM state
admission. A matching digest establishes byte integrity only. It does not
independently validate the retained native bundle, attest a binary, establish
calibration or authenticate a sensor. Those responsibilities do not migrate
into a renderer. Rendering a field must use text/typed values, never code or HTML
interpretation of model identifiers.

## Implemented scope

The imported data represents selected local mean responses from CSE and
heading-column displacement from the curved-surface runtime, executed through
CIW's existing `affine-binary64.v1` profile. It retains the original units and
identities but does not invent geospatial positions, transform reference frames,
reconstruct covariance, validate a physical model or authorize equipment.

This increment is an import API plus executable checks. Wiring it to a served
artifact endpoint, a selection bus or a browser panel remains a separate
application integration. Existing routes, ESM/GSV work and public/private
boundaries are unchanged; no dataset or deployment is created.

## Run checks

After installing the repository's existing TypeScript development dependencies:

```sh
node scripts/check-polyglot-view.mjs
```

The script compiles this boundary in strict mode and runs Node tests without a
Next server, network fetch or WebGL. Tests use explicitly labelled wire/parser
fixtures; fake execution IDs in those fixtures are not native qualification.
The separate CIW native gate requires real Rust-supervised C++ and Julia runs.
