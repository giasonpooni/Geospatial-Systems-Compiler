# Calibration-aware bounded uncertainty guard

An additive companion to PR #22 at `4bbf5ef846e34a9d9e7e5e189f8ed44fac527d49`.
The existing probabilistic observers, process parameters, covariance checks and
result meanings remain unchanged. This is not another neural model or a claim
that the previous undercovered 95% intervals have become calibrated.

## Reproduce

```sh
npm ci
npm test -- tests/bounded_observer.test.ts
npx tsc --noEmit
npx tsx benchmarks/industrial-observer/bounded/cli.ts
python benchmarks/industrial-observer/bounded/validate_scipy.py runtime-data/synthetic-bounded-uncertainty
```

The CLI accepts a fresh output-directory argument and refuses to overwrite an
existing directory. Outputs are a self-contained HTML report, JSON evidence,
arithmetic checks and a protocol/execution record. The Python oracle requires
NumPy and SciPy; the TypeScript reference adds no dependency. Generated outputs
belong in the existing ignored runtime-data directory, not the application.

## Two different uncertainty statements

A probabilistic posterior interval describes probability under a stochastic
model. This guard instead encloses states consistent with explicitly bounded
initial conditions, disturbances, noise and calibration errors. Its output has
`boundBasis: conditional_bounded_error_enclosure_not_probability` and
`probability: null`. Do not relabel these sets as 95% intervals, a covariance,
or a physical certificate. Gaussian errors have no finite hard support; the
old Gaussian workload is not silently relabelled or clipped into this one.

The guard retains the four physical/nuisance coordinates [A volume deviation,
B volume deviation, net-outflow equivalent, primary-B sensor bias]. It also
carries one bounded **shared calibration parameter**, not an iid random error
or an additional learned state. It does not modify the existing IMM.

## Model and support assumptions

For the fixed one-second step:

    A[t] = F00 A[t-1] + F01 B[t-1] + uA[t] + wA[t]
    B[t] = F10 A[t-1] + F11 B[t-1] + uB[t] - loss[t] + wB[t]
    |loss[t]-loss[t-1]| <= 0.2 L/s
    |bias[t]-bias[t-1]| <= 0.3 L
    loss[t] in [-1,1] L/s; bias[t] in [-3,3] L
    |wA[t]|, |wB[t]| <= 0.35 L

The within-interval loss timing matches the V2 formulation. F is the declared
fixed matrix, not an estimated interval-valued matrix. Control inputs are known
exactly in the synthetic experiment. Initial support and all budgets are fixed
in protocol.json. Unknown dynamics, control errors or effects outside these
supports invalidate the conditional argument and require a different contract.

Primary measurements have rows [1,0,0,0] and [0,1,0,1], with absolute errors
bounded by 0.5 L and 0.7 L. The reference has:

    yR[t] = B[t] + c0 + drift[t] + eR[t]
    c0 in [-0.4,0.4] L (ONE constant, shared across all observations)
    |drift[t]| <= 0.003 * (t-calibratedAt) L
    |eR[t]| <= 0.35 L

No independence assumption is needed for these bounds. The drift formula is an
absolute departure envelope; it conservatively permits arbitrary paths inside
that envelope, not only paths with a bounded adjacent-time derivative. Repeated
readings cannot average c0 away. In a decoupled noiseless test the null direction
[A,B,loss,bias,c0] = [0,delta,-.03 delta,-delta,-delta] retains a 0.8 L volume
uncertainty floor after 96 repeated observations. An exact known-zero c0 does
not have that floor. This is a bounded residual ambiguity, not an assertion
that imperfect calibration leaves every state precisely identifiable.

## Inclusion mechanism and limits

At each step a joint box contains previous/current physical states and c0.
Prediction uses outward-rounded binary64 interval operations. Linear strips
encode dynamics, increment budgets and measurements. For a nonzero coefficient
aj in the strip l <= sum(ai xi) <= u, contraction intersects coordinate j with:

    ([l,u] - sum(i != j, ai Xi)) / aj.

Every feasible coordinate remains inside this interval. Intersections and any
finite number of contraction passes retain that inclusion. Projecting the
result to the current state and c0 drops correlations conservatively. Induction
from the valid initial support therefore gives a conditional outer enclosure.
The arithmetic implementation surrounds each basic rounded operation with the
adjacent binary64 values and refuses overflow. No tuned epsilon, jitter,
negative-variance clipping, probabilistic inflation, or outlier deletion is used.

This is not a smallest feasible set. Finite box contraction does not prove joint
feasibility. A nonempty box is labelled `feasibility: not_disproved`, and
`physicalAssumptionsVerified` is always false. An empty constraint intersection
returns a null enclosure and `inconsistent_assumptions`; it never resets to an
old prior or silently removes the contradictory measurement.

The Python oracle solves whole-prefix linear programs with one common c0 to
check that all coordinate extrema lie inside the guard's looser boxes. Its LP
checks have an explicit 5e-8 absolute numerical tolerance and are not a formal
exact-arithmetic LP proof. Basic binary64 enclosure checks additionally use
exact Python Fractions and NumPy nextafter.

## Chronology and decisions

Calibration metadata separates calibratedAt, knownAt and validThrough. A future-
known calibration cannot affect an earlier result. Reference samples outside
its validity interval or with unsupported calibration IDs are counted and not
assimilated. Older valid evidence may still contribute to a forecast after the
certificate expires, but reference-dependent decisions abstain.

The simple API performs full chronological as-known replay. The batch path
rewinds only to the earliest newly known observation, reusing the unaffected
checkpoint prefix. Tests compare every delayed-evidence cutoff with full replay.
Retained earlier as-known results and input rows are never mutated.

Width limits [3 L,3 L,1 L/s,2 L] and measurement-age budgets are distinct from
mathematical containment. `within_precision_budget` is a data label, not action
authorization. Complete outages retain growing bounds but abstain. All cutoffs,
including abstentions and inconsistencies, remain in evaluation denominators.
Evidence, assumption, calibration, result, execution and verification identities
remain separate. Content hashes do not authenticate certificates or assumptions.

## Frozen experiment and observed results

No fitting or holdout tuning. Eight regimes, 24 held-out seeds 24000..24023 and
96 one-second steps. Both four-second and one-second reference arms share truth
and coincident noise draws: 384 in-scope trajectories, 36,864 cutoffs and 147,456
physical-state containment checks. A deliberate zero-calibration ablation uses
the same data with incorrect perfect-calibration assumptions. Stress seeds
25000..25015 are separate; unit/development checks use seeds 22000..22002.
The protocol was recorded locally before full evaluation, not externally
preregistered. Two time-limited interrupted executions retained only protocol
records. The final run uses a tested checkpoint optimization of the same replay;
no support or acceptance parameter was changed after held-out results.

| Regime | All-state containment | 4-s volume availability | 1-s volume availability |
| --- | ---: | ---: | ---: |
| nominal offset | 100% | 25.0% | 100% |
| primary drift | 100% | 25.1% | 100% |
| reference drift | 100% | 25.0% | 100% |
| bounded jumps | 100% | 25.0% | 100% |
| delayed reference | 100% | 0% | 0% |
| complete blackout | 100% | 15.7% | 62.5% |
| expired calibration | 100% | 12.5% | 50.0% |
| decoupled drift | 100% | 25.1% | 100% |

Observed containment is conditional on the synthetic support assumptions, not
an empirical proof that physical error bounds hold. No all-four-axis precision
availability is achieved with the four-second reference. The broad allowable
loss/bias increments intentionally expose insufficient information rather than
inventing calibrated latent precision. Mean four-second tank-B width ranges
from 4.17 L in sensed cases to 17.40 L in blackout. These bounds are often too
wide to support a useful decision; that is measured rather than hidden.

Containment, stale-outage abstention and expired-reference exclusion pass. The
fixed >=60% non-outage volume-availability gate FAILS for the four-second arm.
Status: `reference_gate_failed_not_promoted`. One-second sensing is an explicit
extra measurement budget, not evidence of a better model. Delaying those data
still prevents a sufficiently precise current estimate under the chosen bounds.

Ignoring common calibration uncertainty produces only 94.31% pooled all-state
containment on the same four-second data, yet no contradictory intersection.
The 16 plausible out-of-certificate reference offsets are likewise not detected.
Sixteen impossible measurements are detected at their first affected sample;
sixteen gross loss violations are detected with 4..8-second latency. These are
separate stress results, not proof of complete fault detection. A coherent wrong
calibration assumption can remain feasible and produce an incorrect bound.

## Validation and architecture

276 test bodies pass locally: the unchanged 232 plus 44 new cases. The local
copy changes only Vitest registration imports to node:test. Focused strict
engine/new-test checking passes; actual repository Vitest and whole-project
TypeScript/build results are reported separately in the PR.

Independent validation covers 32 prefix systems, 256 LP extrema, 268 exact-
arithmetic/neighbor checks and 3,072 example state-containment checks. The largest
extra interval width versus a full-prefix LP bound is 0.66505 in this checked
set (units follow the coordinate). Desktop1365/mobile390 Chromium checks cover
eight regimes, cutoff interactions, outage abstention and the failed utility
banner, with no page errors, network requests or document overflow. This is
retained HTML via set_content, not an application deployment test.

NET remains the controller; specialist instruments retain execution; ESM retains
admission/release. GSC remains the representation destination. This benchmark
adds no provider, private file loader, live route, public homepage/GSV change,
source admission, production action, dependency, or model promotion. Its helper
API is internal typed synthetic data, not a hardened hostile-object service.

## Primary references

Set-membership state estimation and bounded-error interval observers:
https://www.urus.upc.edu/publications/show/2140

Calibration validity, systematic error and uncertainty:
https://www.nist.gov/publications/careful-consideration-calibration-concept-0

Interval inclusion and rounding requirements:
https://www.boost.org/doc/libs/1_31_0/libs/numeric/interval/doc/interval.htm

These support the approach; they do not certify this implementation. Original
TypeScript code, no copied third-party solver implementation. Existing repository
licensing applies. The next practical improvement is tighter evidenced error
contracts or fresher reference sensing, not pretending the current envelope is
already precise enough for latent-fault decisions.
