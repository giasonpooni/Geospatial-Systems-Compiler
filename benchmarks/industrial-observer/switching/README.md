# Switching loss and sensor-bias observer — two retained, unpromoted candidates

Additive to PR #19, commit `d7cb35762568d1766d29989cfd3f15c90db09b80`.
No existing two-state observer, three-state loss observer, compiler, regression
suite, route, evidence source, GSV component or homepage is replaced. Numerical
execution stays in this bounded synthetic reference; the GSC inspector imports
only types. No neural training, live data, provider registration or deployment.

## Run

From a complete GSC checkout containing this extension:

```sh
npm ci
npm test -- tests/state_space.test.ts tests/industrial_observer.test.ts tests/loss_observer.test.ts tests/switching_observer.test.ts
npx tsc --noEmit
npx tsx benchmarks/industrial-observer/switching/cli.ts select v2
npx tsx benchmarks/industrial-observer/switching/cli.ts evaluate v2
npx tsx benchmarks/industrial-observer/switching/cli.ts report v2
python benchmarks/industrial-observer/switching/validate_numpy.py runtime-data/synthetic-switching-v2
```

NumPy and SciPy are required only for the independent Python oracle. Outputs
are under the existing ignored runtime-data directory. An optional final CLI
argument selects another directory. Files are written exclusively; existing
selection, evaluation and report files are not overwritten. Each phase checks
its input bindings, which establish content integrity, NOT authenticity.

Use `v1` in the three CLI commands to reproduce the first diagnostic candidate.
Its selection and evaluation are retained separately from v2. V1 and v2 have
DIFFERENT held-out scenarios, so their summary errors are not a head-to-head
comparison. The original two- and three-state filters run on identical evidence
within each new experiment and remain the actual comparators.

## Four-state model

`z = [V_A, V_B, loss, sensor_B_offset]`, with units `[L, L, L/s, L]`.
Volumes are signed deviations around a nominal operating point. Fixed dt=1 s:

```text
F4 = [[F00, F01,  0, 0],
      [F10, F11, -1, 0],
      [  0,   0,  1, 0],
      [  0,   0,  0, 1]]
H_A = [1, 0, 0, 0]
H_B = [0, 1, 0, 1]
```

Process loss acts on inventory, while sensor bias acts on the observation. The
full covariance retains their correlations with volume and each other. Measurement
R includes the existing independent per-reading reference uncertainty; a separate
persistent sensor offset is represented in the state, not added repeatedly to R.
There is no nonnegative clipping or claim that a net disturbance proves a leak.

The four modes are quiet, loss-change, bias-change and combined-change. This is
an interacting multiple-model (IMM) reference, not a trained classifier. Every
mode has the same state dimension. Interaction and final aggregation both use
`sum_i w_i [P_i + (mu_i - mu)(mu_i - mu)^T]`, retaining between-mode uncertainty.
Within each mode, scalar sensor updates use Joseph covariance and accumulate the
joint log likelihood. Posterior mode mass is normalized with log-sum-exp.

Mode transition semantics are explicit: row i to column j. With stationary
weights pi and persistence rho, `M_ij = rho*I_ij + (1-rho)*pi_j`, where pi factors
independent loss/bias indicators using h. At rho>0, h is NOT the probability of
entering a new jump mode in every timestep; the transition matrix defines that.

V1 uses rho=0 and end-of-interval loss innovations. V2 uses persistent modes and
within-interval jumps: `G = [0,-1,1,0]^T` for a unit loss increment, so loss process
variance adds `q_loss*G*G^T`, including negative volume-loss cross-covariance.
This is an explicit timing/discretization assumption, not a cosmetic retuning.
The optional parameters leave the v1 numerical path available.

## Mixture intervals, not invented probabilities

Marginal 95% intervals invert the approximate IMM mixture CDF at .025 and .975;
they are not simply mean +/-1.96 times the mixture standard deviation. The normal
CDF approximation is checked against SciPy; observed endpoint differences were
below 1e-5 in the delivered example set. IMM interaction is still a Gaussian
moment-matching approximation to a switching process; these intervals are not
claimed to be exact Bayesian posteriors or calibrated against a real plant.
Mode weights are model-conditional, NOT calibrated fault/incident probabilities.

Cholesky checks use dimensionless correlation scaling for mixed units. There is
no covariance jitter or clipping. The helper API is an internal synthetic
reference, not a hardened hostile-object, private-file or network input boundary.
State and covariance shapes, finite numbers, mode probabilities, derived model
consistency, duplicate measurements and the inherited row-hash checks are tested.

## Chronology and observability

observedAt and knownAt remain separate. A bounded replay uses only eligible rows
at a knowledge cutoff and assimilates them at measurement time. Future-known
values and future controls cannot alter an earlier content result. Inputs are
not mutated. The workload is capped by the inherited 256-step replay contract;
this is not a scalable stream processor or fixed-lag production smoother.

No measurements means only prior/model propagation. Uncertainty evolves, but no
observed evidence is fabricated. A zero-mean loss/bias prior preserves the old
model-only volume means without preserving its narrower covariance.

Rank refers to INITIAL-state observation rows, not current-state precision.
With full coupled sensing the structural rank is four. With decoupled tanks,
even both sensors do not separately identify process loss and sensor-B offset;
the test returns rank three and marks both not identifiable. Sensor A alone
without coupling provides rank one. The inspector separately labels the current
cutoff as prediction-only during a blackout, even when historical structural
rank is full. Causal attribution remains `not_established`.

## Development and genuinely fresh held-out stages

V1 (`protocol.json`): development seeds 3000..3007, four development regimes,
hazard candidates [.002,.01,.03]. It selected h=.002. Held-out seeds 4000..4015
use separately defined timing, controls, loss profiles and sensor faults. V1
failed four of five gates. Its data are retained, not relabelled as fresh later.

V2 (`protocol_v2.json`): development seeds 6000..6007 may use previously inspected
v1 scenario TYPES as development cases. Four candidate combinations use h in
[.02,.08], rho in [.8,.95], and within-interval jump coupling. Development-only
selection chose h=.02 and rho=.95. Held-out seeds 7000..7015 use new profiles,
onsets, amplitudes, controls, masks and delays. The selected configuration was
frozen before this held-out run; no post-holdout retuning was performed.

Both variants fix quiet variances at 1e-5, jump variances .25 (loss) and 2.25
(bias), and initial nuisance variances .001. Development selection minimizes
non-nominal volume MSE subject to a provisional nominal-error ratio <=1.15; if
no candidate qualifies, the best is retained as ineligible. That selection
constraint is NOT the final acceptance gate. Final nominal acceptance is literal
no-degradation: ratio <=1.0. Every changed regime must separately cover >=90%;
an average cannot hide an undercovered regime. Mean interval width is bounded
to <=2x the three-state baseline, preventing success through unlimited inflation.
Bias-only accuracy must beat the two-state baseline; pooled changed-case accuracy
must beat the three-state baseline. There is never automatic promotion.

## Executed V2 held-out results: not promoted

16 seeds per regime, 96 one-second steps. Volume RMSE in L. Coverage and widths
are descriptive over correlated time samples. Paired-error standard errors use
seed blocks across regimes, not falsely independent timesteps or reused seeds.

| Regime | Two-state | Three-state | Switching | 95% coverage |
| --- | ---: | ---: | ---: | ---: |
| Nominal | .329 | .364 | .338 | 96.6% |
| Flow flip | 1.619 | .697 | .809 | 95.4% |
| Sawtooth flow | 1.474 | .587 | .652 | 93.8% |
| Short offset pulses | .511 | .646 | .598 | 92.6% |
| Offset ramp/reset | .537 | .675 | .583 | 85.8% |
| Overlapping changes | 2.116 | 1.147 | 1.156 | 80.2% |
| Delayed offset/flow | 3.218 | 1.444 | 1.503 | 89.6% |
| Change during blackout | 2.767 | 2.643 | 2.596 | 85.3% |

Nominal error increases 2.78%: no-degradation gate FAIL. Pooled changed-regime
RMSE is 1.315408 vs three-state 1.314148, an approximately .096% increase: error
gate FAIL. It is 34.0% lower than the two-state baseline, but that does not beat
the already available three-state improvement. Bias-only RMSE is .590552 versus
two-state .524460 (+12.6%): bias gate FAIL. Several individual regimes miss 90%
coverage: coverage gate FAIL. Interval width ratio is 1.38060 <=2: width PASS.

The switching candidate improves some coverage relative to the three-state model
(pooled changed-case coverage 88.96% vs 80.28%) but still does not qualify. The
result is `benchmark_gate_failed_not_promoted`. More states and model weights
have not demonstrated a superior replacement under the current sensing setup.

## Numerical and statistical checks are separate

The independent NumPy oracle uses joint sensor updates, subtractive covariance
and SciPy CDF inversion, rather than TypeScript's sequential Joseph updates. It
recomputes 768 example posteriors and 256 terminal references. The subtractive
oracle explicitly restores analytic covariance symmetry after floating-point
roundoff; no eigenvalue clipping or jitter is used. The audit retains the initial
failed oracle runs that exposed accumulated asymmetry before this correction.

Across the checked examples, maximum posterior mean/covariance differences were
2.49e-14 and 1.35e-13; component covariance difference 5.69e-13; mode weight
error 4.67e-15; interval endpoint difference 9.53e-6. Numerical equivalence does
not establish correct physical modeling or acceptance of the prediction errors.

The separate identical-mode Gaussian-collapse reference uses 128 seeds 8000..8127
at step 48. Its NEES mean 4.98506 is ABOVE the two-sided 99% band
[3.38540393,4.67326840]; NIS 1.14851 is within [.70736821,1.35123023]. The failed
NEES reference is retained, not called a pass. A post-hoc 1024-seed sampling
diagnostic at seeds 10000..11023 gave mean NEES 3.99263 and NIS 1.04120. That
additional diagnostic is consistent with sampling variability, but is NOT a
replacement for the originally reported 128-seed failure. Reproduce it with:

```sh
npx tsx benchmarks/industrial-observer/switching/diagnose_gaussian.ts runtime-data/synthetic-switching-v2/selection.json
```

A separate switching-mixture reference uses seeds 9000..9127. Its NEES and
coverage are descriptive; a Gaussian chi-square gate is not applied to an
approximate non-Gaussian mixture. V1 report generation instead uses its declared
5000-series reference seeds, separate from the v2 report.

The old 49 state-space, 51 observer and 46 loss-state tests remain unchanged.
The new suite adds 50 tests. Actual repository Vitest/typecheck/build status is
recorded in the PR; a local native-Node registration copy is not labelled Vitest.
The existing unrelated TECHNICAL_REFERENCE.md classification gate is not edited.

## Ownership and next decision

Operation, model, evidence, result, execution and verification identities remain
separate. The schema explicitly states synthetic and unverified. GSC projects
retained results; NET remains controller and ESM retains admission/release. No
private source or application route is added, and no HTML is automatically hosted.

The evidence now favors keeping the old estimators and studying identifiability,
measurement redundancy or controlled calibration data before adding model
capacity. A new neural model or calibration channel would need a new protocol
and untouched holdout; neither is claimed delivered by this experiment.

Primary mathematical references (no third-party implementation copied):
- https://filterpy.readthedocs.io/en/latest/_modules/filterpy/kalman/IMM.html
- https://filterpy.readthedocs.io/en/latest/_modules/filterpy/kalman/kalman_filter.html
- https://www.mathworks.com/help/control/ref/statespacemodel.obsv.html

Existing repository licensing applies to this original reference code.
