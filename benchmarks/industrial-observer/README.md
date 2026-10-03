# Synthetic industrial observer benchmark

An isolated two-tank state-estimation experiment plus a read-only GSC result
projection. It extends PR #15 without changing its compiler or importing the
separate local overlay/graph extension. No trained model, source connector,
production dispatcher, app route, private store or publication behavior is added.

## Run from the repository root

```sh
npm ci
npm test -- tests/industrial_observer.test.ts
npx tsc --noEmit
npx tsx benchmarks/industrial-observer/cli.ts
# Optional independent check (requires NumPy and SciPy):
python benchmarks/industrial-observer/validate_numpy.py runtime-data/synthetic-observer
```

The CLI accepts an optional output-directory argument. Its default is the
existing ignored `runtime-data/synthetic-observer` directory. It creates a
self-contained `index.html` inspection report, `report.json`, synthetic audit
fixtures and a content manifest. No server, map service or network call is
required by the report. Output files are generated, not checked into this tree.

## State and measurement model

The state is two inventory deviations in litres around a nominal operating
point. It is a small linear-Gaussian reference, not a calibrated hydraulic plant:

    x[t] = F x[t-1] + u[t] + w[t]
    F = [[.95, .04], [.04, .95]]
    Q = [[.04, -.012], [-.012, .04]]  (litres squared per 1-second step)
    x[0] ~ Normal([0,0], diag([4,4]))
    y[s,t] = x[s,t] + measurement_error + independent_reference_error

The column sums of F equal .99: internal exchange cancels in total inventory,
while the declared drain remains. Gaussian noise is not clipped; these are
signed deviations, not nonnegative absolute tank volumes. Known controls are
shared by model-only prediction and Kalman estimation. Hold-last and neighbor
mean deliberately do not use dynamics, making those baseline assumptions clear.

The correction uses the Joseph covariance expression:

    P+ = (I-KH) P- (I-KH)^T + K R K^T

R includes both measurement noise variance and reference variance. Reference
errors are independent at each reading in the generator. A persistent shared
calibration offset would require a bias state or correlated noise treatment;
this experiment does not model that case. Q and prior P must be well-conditioned
positive definite. This reference does not handle singular/deterministic priors.

## As-known replay and evidence integrity

`observedAt` and `knownAt` are separate canonical UTC timestamps on a fixed
1-second synthetic grid. At each cutoff, only eligible observations and the
control prefix are passed into replay. Late readings are assimilated at their
measurement time by replaying from the initial prior, rather than being applied
as current measurements. Earlier results are new immutable values, not rewritten.

The experiment intentionally uses bounded full replay (12..256 steps, at most
512 readings); it is not a scalable streaming or fixed-lag smoothing service.
Archive validation rejects duplicate record IDs/sensor-time events and stale
content hashes. Supplied hashes establish integrity, not source authenticity.
Helpers are an internal synthetic-reference API, not a hardened untrusted JSON
or hostile JavaScript object ingestion boundary. No production input endpoint
is exposed. Invalid numeric state, covariance, chronology or dimensions throw.

Input/evidence, model, result and execution identities are distinct. Only the
selected evidence and control prefix contribute to evidenceHash. Execution IDs
are unique, while content results remain reproducible. Verification remains
`not_verified` with `verificationId: null`; a content digest is not a certificate.

## Experiment cases and ablations

- `full`: both sensors each second.
- `staggered`: unequal sample cadences and delayed availability.
- `blackout`: both sensors absent for the middle third.
- `no_sensors`: model-only prior propagation; no invented measurements.
- `unobserved_b`: decoupled dynamics and process noise; tank B has no observations.
- `model_mismatch`: an unmodelled outflow in tank B after the midpoint.

Each case compares hold-last, neighbor averaging, model-only prediction and
Kalman estimation. All use the same availability cutoff. The generator draws
sensor noise before masking so missingness-only counterfactuals share exactly
the same truth and noise realizations. Truth is supplied only to evaluation and
is never an estimator argument. Neither coupling nor geography is inferred.

Nominal 95% marginal intervals, RMSE, NIS and NEES are reported. Time-series
coverage and averaged NEES are descriptive because repeated-time errors are
correlated. A separate matched-model sweep uses seeds 0..255, one terminal
2-state NEES and one terminal scalar sensor-A NIS per replication at step 64.
Its fixed two-sided 99% reference bands are:

    mean NEES: [1.692701962807257, 2.3366341977202647]
    mean NIS:  [0.7870060854055189, 1.2423177882649463]

These are chi-square quantiles divided by 256, with 512 and 256 degrees of
freedom respectively. Both tails matter: excessively wide covariance can be
inconsistent too. The two tests are marginal tests, not a familywise-adjusted
joint claim. Seeds are deterministic pseudorandom replications, not field trials.

## Representation and ownership

`src/lib/observerInspection.ts` imports only types. It projects an explicitly
synthetic retained envelope into state/interval/age/support rows and never calls
a solver. Its integrity check validates format and interval consistency, not
cryptographic result integrity. No GSC application route mounts it yet.

The reported rank is the finite-horizon initial-state observation rank with an
explicit small-matrix tolerance. Rank two does not imply precise current state,
model correctness, or good conditioning. No readings gives rank zero. The
uncoupled hidden state is labelled unobserved; indirect estimates are distinct
from direct measurements. The HTML report plots an archive of as-known outputs
and separately labelled evaluation truth, not information available to an online
estimator at every displayed time.

NET remains the controller, specialist repositories retain scientific execution,
ESM retains evidence/release authority, and GSC retains representation. This
bounded benchmark is a reference experiment, not a second production runtime.
A future provider should implement the same result seam through NET's existing
operation/run contracts, not dispatch directly from the browser. The public
homepage, GSV, freight routes, source policy and PR #15 files remain unchanged.

## Primary mathematical/software references

- FilterPy linear Kalman filter and explicit Joseph-form update:
  https://filterpy.readthedocs.io/en/latest/_modules/filterpy/kalman/kalman_filter.html
- SciPy chi-square percent-point function:
  https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chi2.html
- Vitest 2 CLI file filtering:
  https://v2.vitest.dev/guide/cli

The implementation is original TypeScript reference code; no third-party
filter implementation was copied. Existing repository licensing applies.
