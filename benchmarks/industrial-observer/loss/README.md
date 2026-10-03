# Explicit loss-state observer: development selection and held-out evaluation

Additive experiment on PR #18 (`55dfb992a11f89fa26b5e9a825117256cd212250`).
The original two-state implementation, types, test cases and failure example
remain unchanged. This is an opt-in three-state classical Kalman reference,
not a trained neural model, live source, model promotion or production adapter.

## Run from the repository root

```sh
npm ci
npm test -- tests/state_space.test.ts tests/industrial_observer.test.ts tests/loss_observer.test.ts
npx tsc --noEmit
npx tsx benchmarks/industrial-observer/loss/cli.ts select
npx tsx benchmarks/industrial-observer/loss/cli.ts evaluate
python benchmarks/industrial-observer/loss/validate_numpy.py runtime-data/synthetic-loss-observer
```

The Python oracle requires NumPy and SciPy. Each CLI phase accepts an optional
output-directory argument. `select` refuses to overwrite an existing selection;
`evaluate` refuses to overwrite an existing report. To repeat a fixed evaluation,
copy its unchanged selection.json into a new output directory. Defaults are in
the existing ignored runtime-data directory. Open index.html for a self-contained,
network-free retained-result inspection; no application route is installed.

## Model, units and meaning

State z = [tank-A volume deviation, tank-B volume deviation, net-outflow equivalent].
The first two coordinates are L; the third is L/s. For the fixed dt=1 s model:

    F_aug = [[F00, F01,  0],
             [F10, F11, -dt],
             [  0,   0,  1]]
    Q_aug = blockdiag(Q_volume, q_loss)
    z[t] = F_aug z[t-1] + [uA[t],uB[t],0] + w[t]
    y[s,t] = z[s,t] + measurement_error + independent_reference_error

Positive loss subtracts from tank B; negative loss represents an equivalent
unmeasured inflow. Do not clip the state to zero or declare its estimated value
a demonstrated leak. Sensor bias, incorrect dynamics and other disturbances
can be mapped into this state; the sensor-bias diagnostic shows this limitation.
No sensor-bias state is included and no cause is identified by the filter.

The full 3x3 covariance includes state/loss cross-terms and their product units.
Joseph correction includes measurement AND independent reference variance.
A persistent shared reference error is not independent per reading; handling
that would require a separate bias/correlated-noise model. Cholesky validation
uses a dimensionless correlation scaling so mixed units do not create an
arbitrary positive-definiteness tolerance. No covariance clipping/jitter repair
is applied. The signed Gaussian state describes deviations around an operating
point, not a physical nonnegative tank-volume constraint.

## Preserved invariants

- Original two-state code, operation identity, test cases and numerical outputs
  are not replaced. The explicit loss candidate has a distinct operation/schema.
- observedAt and knownAt stay separate. Delayed rows replay at measurement time;
  future-known values and future controls cannot change an earlier result hash.
- Existing selectReadings enforces row hashes and duplicate event checks.
- Empty sensing produces only prior/model propagation, not fabricated evidence.
  Volume means equal the original model-only mean when the loss prior is zero;
  covariance is deliberately larger because this model has extra uncertainty.
- With uncoupled tanks and only sensor A, tank B loss stays unobserved. The rank
  diagnostic concerns initial-state sensitivity, not current precision or cause.
- Result, model, evidence and execution identities remain separate. Verification
  is not_verified with a null verification identity; hashes are not certificates.
- GSC's new inspection helper imports only types. Numerical functions live in
  this bounded benchmark, not in a browser, source collector or NET controller.

The helper API is an internal synthetic-reference interface, not a hardened
hostile-object/JSON ingestion boundary. No database/file ingestion endpoint is
exposed. The timestep stays fixed at one second; no irregular-time approximation
is silently introduced. At most 256 steps are accepted by the reused replay.

## Selection before evaluation

protocol.json fixes the development seeds 0..15, candidate q_loss values
[0.0001, 0.001, 0.01, 0.04], initial loss variance .04, split and acceptance rules.
Candidate parameters are selected using only nominal operation and the known
.65 L/s development step. Selection minimizes development-step volume RMSE
subject to nominal pooled RMSE ratio <=1.15; ties use the smaller q. This 15%
limit is an engineering tolerance, not statistical equivalence or a promise
of zero degradation. The original baseline is always retained.

The executed selection chose q_loss=.001. Nominal development RMSE ratios were
1.0473, 1.0909, 1.1988 and 1.3040 in candidate order. The faster two candidates
were rejected before held-out evaluation because they violated the nominal limit.
The selection artifact binds all development-fixture hashes and all candidate
metrics. Hashes establish content integrity, not external authentication.

Held-out seeds are 1000..1015. Loss onsets/amplitudes/shapes, forcing controls,
missingness and delays differ from development. The repeated nominal case uses
new seeds to measure nominal degradation. There is no neural training here.
The following regime definitions are fixed in experiment.ts:

| Regime | Net outflow equivalent / measurement change |
| --- | --- |
| small_step | .3 L/s from t=20 |
| ramp | t=20 onward, .016 L/s per step capped at .8 L/s |
| reversal | .7 L/s from t=24, -.3 L/s from t=64 |
| intermittent | .6 L/s during [24,44) and [64,84) |
| delayed_step | .85 L/s from t=30, staggered sampling and 1/3-second delays |
| blackout_step | .5 L/s from t=24, both sensors absent during t=32..64 |
| sensor_bias | zero process loss, persistent +1.5 L sensor-B offset from t=48 |

The loss at time t drives the following transition. New forcing controls are
used for all held-out non-nominal cases. Noise is reconstructed from the original
generator so counterfactual regime changes keep the same noise realization.
Only model, controls and readings enter the observer. Regime, seed and truth do
not. Immediate-observation trials use an equivalent forward pass for speed;
delayed trials use chronological replay. Tests compare the fast path with replay.

## Executed held-out results — candidate NOT promoted

16 seeds per regime, 96 one-second steps. Pooled volume RMSE in L; nominal 95%
marginal volume coverage is descriptive across correlated time samples.

| Regime | Baseline RMSE | Augmented RMSE | Augmented coverage |
| --- | ---: | ---: | ---: |
| nominal | .337 | .361 | 95.7% |
| small_step | .766 | .385 | 94.3% |
| ramp | 1.395 | .393 | 94.4% |
| reversal | 1.228 | .575 | 86.2% |
| intermittent | 1.005 | .569 | 84.7% |
| delayed_step | 4.065 | 1.109 | 87.8% |
| blackout_step | 3.385 | 1.875 | 79.6% |
| sensor_bias | .674 | .810 | 74.0% |

Across the six loss regimes, pooled RMSE falls 58.4%, but coverage is 87.8255%,
below the predeclared 90% threshold. Nominal RMSE rises 7.2% (within the 15%
engineering gate, not an improvement). The sensor-bias case worsens by 20.1%.
It is diagnostic, not silently removed from the report or treated as a leak.

Gate outcome: nominal PASS; aggregate loss RMSE PASS; coverage FAIL. Parameters
were not retuned after seeing the held-out failures. The candidate remains
benchmark_gate_failed_not_promoted. Lower error alone cannot qualify uncertainty.
Neither baseline nor augmented model should be called field-calibrated.

Per-regime paired error standard errors use the 16 seed-level differences.
The combined summary clusters differences by seed because the same noise seeds
are reused across regimes; 96 regime/seed trials are not 96 independent seeds.
No p-value from correlated time samples or per-frame coverage is claimed.

## Matched-model covariance experiment and independent oracle

A separate 256-replication sweep (seeds 2000..2255) uses the model's actual random-
walk disturbance and prior distribution. One terminal NEES for three states
and one sensor-A NIS at t=64 are taken from each replication. The fixed marginal
two-sided 99% reference bands use chi-square degrees of freedom 768 and 256,
divided by 256. Mean NEES=3.264710588 and mean NIS=1.078156553 both fall within
bands. This validates consistency under the matching random-walk assumptions,
NOT interval coverage across abrupt or biased-measurement regimes.

validate_numpy.py independently rebuilds 768 held-out example posteriors and
256 matched terminal statistics with NumPy's subtractive covariance update,
checks positive eigenvalues, recomputes coverage/RMSE/NEES and checks the bands
with SciPy. Current maximum mean/covariance differences are below 4e-15. This
is numerical equivalence, not plant validation. Report arithmetic retains the
coverage failure rather than changing a threshold to make a test green.

## Architecture and next evidence required

NET remains controller, specialist repositories retain scientific authority,
ESM retains evidence/release authority, and GSC inspects retained results. No
freight route, public homepage, GSV provider or earlier local overlay is changed.

Further model selection should use a new development/held-out split: these
regimes have now been examined. Candidate extensions include a separately
identified sensor-bias state, a change-point/random-walk mixture, or a learned
residual, with explicit covariance treatment. They must improve robustness to
abrupt changes without concealing loss of observability or model mismatch.
The old operation should remain available even when a new candidate qualifies.

Primary references (formulations/software, not a claim of physical validation):
- https://filterpy.readthedocs.io/en/latest/_modules/filterpy/kalman/kalman_filter.html
- https://www.mathworks.com/help/slcontrol/ug/disturbancecompensator.html
- https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chi2.html

Original TypeScript reference implementation; no third-party filter source is
copied. Existing repository licensing applies. Repository CI status is recorded
in the PR, not inferred from a local native-Node validation run.
