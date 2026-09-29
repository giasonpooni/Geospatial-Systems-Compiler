# Industrial observation quality v1

**Represent what an eligible industrial source can and cannot support. Do not
fill an observation gap with an invented physical explanation.**

This is an additive, internal library slice. It adds no collection adapter,
network access, API route, UI, storage, publication or evidence-admission path.
Existing canonical `Observation`, `ValueKind`, confidence, route and source
policies are unchanged. No live AIS/SAR source is registered by this change.

## Application entrypoint

```ts
import { inspectIndustrialObservation } from '../src/lib/economy/industrialObservationQualityRegistry';

const result = inspectIndustrialObservation(
  { schemaVersion: 'industrial-observation-quality.v1', evidenceId },
  suppliedEvidenceContext,
);
```

`suppliedEvidenceContext` contains a mode and a read-only evidence metadata
snapshot supplied by the upstream evidence owner. It is NOT request JSON.
The wrapper always uses the existing `SOURCE_REGISTRY`, overriding any source
list accidentally present on the supplied object. The lower-level pure
validator takes a transient registry view for hermetic testing; that is not
another registration service.

The only request fields are `schemaVersion` and `evidenceId`. Unknown fields
fail closed. Raw posts, advertisements, names, locations, free text and caller
flags such as `occupancy_excluded` have no input slot. No rejected payload,
identifier, location or exception text is copied into a rejection result.

## Trust and eligibility boundary

Every supplied record carries an evidence ID, artifact ID, source ID and
source version, industrial-subject classification, evidence class, mode,
subject reference, time fields and dependency IDs. Every dependency is
traversed before the root payload is interpreted. Missing records, cycles,
unknown/mixed classifications and natural-person lineage refuse. Renaming a
person-derived leaf or inserting a derived industrial parent does not remove
that refusal. Traversal is bounded to 32 dependency edges in depth, 32 direct
dependencies per record and 128 distinct records per call.

Operational sources must occur exactly once in `SOURCE_REGISTRY`, have a built
adapter, an allowed access class, and only existing canonical source yields.
An open URL, a licence or a source name alone does not satisfy these checks.
A synthetic context permits `fixture:` sources without registering them;
synthetic evidence is refused in operational mode, and every output carries
its mode. Synthetic mode is selected by trusted execution context, not by the
request. It must not become a production request-controlled option.

**The validator does not discover whether an upstream classification is
truthful, prove that dependency lineage is complete, verify artifact bytes or
authenticate method/execution references.** The upstream owner must classify
sources and retain full pre-transformation lineage. A forged trusted context
or omitted ancestry is outside this boundary; declaring arbitrary records
industrial does not make their ingestion acceptable. No operational caller
should manufacture that context from unreviewed raw inputs.

Source eligibility is also not redistribution permission: existing external
release/redistribution checks remain mandatory. `REPRESENTED` is neither
ESM admission nor authorization to serve a record externally.

## Six distinct representations

| Kind | Required semantics |
| --- | --- |
| `FEED_GAP` | Zero returned records for a supplied feed/query and measurement window. Missing coverage/health state-and-evidence pairs become explicit unknowns; dangling pairs are rejected. Non-unknown assertions require dependency evidence matching subject, time window, feed and query, and agreeing with the assertion. |
| `QUALITY_ASSESSMENT` | Supplied diagnostics with a method and separate execution identity. Supported v1 metrics: packet-loss fraction, detection fraction, signal-to-noise ratio and latency, with bounded values and fixed units. A verification reference must bind an explicit supplied verification record to the artifact, method and execution; this does not execute or authenticate the verification. |
| `REPORTED_CONSTRAINT` | Organizational notice with an explicit event interval. Scheduled, reported active, cancelled and unknown remain distinct. A notice cannot be cast into a sensor diagnostic. |
| `MODEL_RESIDUAL` | Supplied observed/predicted/residual values. Checks residual arithmetic, common units, observed-value binding and the same subject/measurement window. Optional supplied standard deviation requires matching uncertainty evidence for that execution. Does not solve a model or propagate covariance. |
| `HYPOTHESIS` | Explicit hypothesis reference, predictive-association or causal-hypothesis status, matching industrial evidence, alternative references and a required-test reference. Event notices alone cannot support a sensor-quality hypothesis. |
| `INSUFFICIENT_EVIDENCE` | Fixed missing-evidence categories, not fabricated zeros or confidence. |

Every represented record retains evidence/source/version/artifact provenance,
returns `confidence: null`, `physicalCause: NOT_ESTABLISHED` and
`admission: NOT_PERFORMED`. Hypotheses never become canonical observations.
Verification pass/fail metadata is not an authorization to admit a record.

Numeric confidence and probabilities are deliberately **unsupported in v1**,
including apparently well-supported inputs: they are rejected, not silently
dropped. A future calibrated-probability adapter needs its own applicability,
calibration and validation contract before this restriction can change.
Diagnostic fractions are measured quantities, not posterior probabilities.

## Time, geometry and identity

Event and measurement intervals, publication time and retrieval time occupy
separate fields. Unknown optional times are explicitly null. V1 requires UTC
instants in `YYYY-MM-DDTHH:mm:ss[.sss]Z` form, rejects invalid calendar dates,
and requires strictly increasing interval bounds. It does not assume a date
or timezone, convert local timestamps, or synthesize an interval.

The quality representation refers to an existing industrial subject. It has
no geometry, crowd density, effect-radius or person-proximity fields. A spatial
projection must resolve eligible geometry through GSC's existing contracts;
this module does not reconstruct locations from source metadata.

Evidence and artifact references describe the supplied input; method,
execution and optional verification references are separate fields. They are
retained, not minted. Free-text reasoning is represented by upstream artifact
references rather than echoed into diagnostics.

## Architecture and integration status

GSC validates and represents this supplied record. NET may dispatch the
operation and retain a run; specialist providers retain diagnostic and model
implementations; ESM retains admission/release; GSV remains read-only.

The registry-bound library entrypoint is implemented. NET operation dispatch,
ESM transport, GSV presentation, external release and calibrated probability
support are NOT wired or implied complete. There is no new public endpoint
and no change to existing collection-policy, route-surface or description
gates, credentials, package dependencies or licensing.

## Verification

`industrialObservationQuality.cases.ts` contains shared deterministic synthetic
regressions. The adjacent Vitest suite registers all cases and adds two actual
registry-wrapper checks. Cases cover person-lineage relabelling, rejection
redaction, unknown eligibility, source registration/adapter posture, cycles,
mode isolation, dates, fabricated geometry/probability, feed/health bindings,
verification identities, residuals/uncertainty and unverified hypotheses.

With repository dependencies installed:

```sh
npx vitest run src/lib/economy/industrialObservationQuality.test.ts
npx tsc --noEmit
npm test
npm run build
```

The shared cases also run under Node's built-in test runner after TypeScript
compilation. That targeted offline run is not the full repository Vitest
suite, full-project typecheck, build or a proof of unchanged policy-gate
behavior. Release still requires the normal repository checks.
