# Independent-reference measurement experiment

Additive to PR #20 (`c6b5da4c13a86bb63444d3d55ed66c02fcc367a3`).
The four-state, four-mode IMM and its selected V2 parameters are frozen. This
experiment adds a measurement channel, not model capacity or neural training.
Existing observer implementations, policies, routes and dependencies are unchanged.

## Reproduce

```sh
npm ci
npm test -- tests/state_space.test.ts tests/industrial_observer.test.ts tests/loss_observer.test.ts tests/switching_observer.test.ts tests/reference_observer.test.ts
npx tsc --noEmit
npx tsx benchmarks/industrial-observer/reference/cli.ts
python benchmarks/industrial-observer/reference/validate_numpy.py runtime-data/synthetic-independent-reference
```

The Python oracle requires NumPy and SciPy and reuses algebra/CDF helpers from
PR20's independent oracle. The CLI accepts an optional fresh output directory;
exclusive directory creation refuses to overwrite an existing experiment. It
writes a protocol record before evaluating, then JSON, synthetic audit fixtures
and self-contained HTML. This is a local pre-evaluation record, not externally
timestamped preregistration. Outputs default to the existing ignored runtime-data
folder. No application route or production provider is registered.

## Mechanism: a reference observes something different

State order remains [tank A volume, tank B volume, net outflow, sensor B bias],
with units [L, L, L/s, L] and a one-second step. The primary sensor observes:

    y_B = V_B + b_B + noise       H_B = [0,1,0,1]

The independently calibrated synthetic reference instead observes:

    y_R = V_B + noise             H_R = [0,1,0,0]

The reference has known zero offset in the synthetic generator, independent
per-reading noise of variance .25 L^2, and a separate pseudorandom noise stream.
This is a metrological assumption, not a claim that a physical sensor has been
calibrated. Persistent calibration uncertainty is NOT added repeatedly as if it
were independent measurement noise. Correlated residual errors or a shared
unknown calibration offset would require another declared likelihood/constraint.

The implementation calls the unchanged PR20 interaction/prediction/primary
update, then applies one additional scalar likelihood to every component and
renormalizes mode weights in log space. No second prediction or interaction is
performed at the same time. Full within- and between-mode covariance and the
original mixture intervals are retained. Measurement and process-model identities
are distinct; reference hashes and primary hashes never share evidence identity.

## Identifiability test

For decoupled tank dynamics with F_BB=.97, the initial-state perturbation

    v = [0, 1, -.03, -1]

satisfies Fv=v and H_A v=H_B v=0. Changing the initial state by any scalar multiple
of v preserves all noise-free primary outputs. Thus the existing data cannot
uniquely separate volume, loss and bias along that direction. A second monitor
with H=[0,1,0,1] cannot remove it, even with fresh measurement noise. H_R v=1,
so the independent reference breaks that ambiguity.

The numerical structural test stacks initial-state sensitivity rows over eight
steps. Rank is 3 with the primary sensors, stays 3 with a shared-bias monitor,
and becomes 4 with the independent reference. NumPy independently verifies this.
The coupled case already has rank 4: there the reference improves information
rather than creating structural observability. Reported singular values use
fixed state units/row scales; conditioning numbers are not unit-invariant.
Structural initial-state rank does not establish current precision, correct
mode timing, physical cause or a new observation during a blackout.

## Frozen protocol and controlled ablations

protocol.json fixes the prior parameter selection hash, all model parameters,
nine new regime profiles, held-out seeds 14000..14015, and five measurement arms:

- no reference;
- independent reference every four seconds (the primary comparison);
- second monitor every four seconds with the SAME sensor bias but independent noise;
- independent reference every second;
- one independent early reading at t=4 only.

All arms share the same synthetic truth, primary records and controls for each
seed/regime pair. No fitting or parameter selection is performed, and no setting
was changed after evaluating the split. These examined regimes are not fresh
holdout for future model/calibration selection. The nine profiles include
nominal operation, stepped loss, bias plateaus, mixed jumps, drift, delayed
primary readings, primary-only blackout, all-sensor blackout and decoupled tanks.
Exact schedules and controls are in experiment.ts. The reference remains active
during primary-only blackout, but is also removed during all-sensor blackout.

The primary comparison is the SAME frozen observer with different evidence,
not a model-superiority comparison. Earlier two- and three-state observers stay
available. Within-regime coverage uses correlated time samples and is descriptive;
paired-error uncertainty across regimes is clustered by the 16 seeds.

## Executed main comparison

Sixteen seeds/regime, 96 one-second steps. Volume RMSE in L, before and after
adding the four-second independent reference:

| Regime | No reference | Independent reference | Volume coverage |
| --- | ---: | ---: | ---: |
| nominal | .3373 | .3165 | 95.28% |
| loss step | .5600 | .4173 | 92.45% |
| bias plateau | .8215 | .4157 | 90.76% |
| mixed jumps | .9024 | .5134 | 90.10% |
| slow drift | .5755 | .3490 | 95.05% |
| delayed primary | 1.3387 | .6511 | 94.34% |
| primary blackout | 2.4162 | .5019 | 93.82% |
| all-sensor blackout | 2.4162 | 2.3463 | 80.92% |
| decoupled mixed | 1.1817 | .5202 | 89.88% |

Pooled changed-regime volume RMSE falls from 1.457686644 to .947617423 L (35.0%).
Bias RMSE falls 38.2% (1.021808601 to .631948264 L); loss RMSE falls 16.0%
(.244208948 to .205048305 L/s). Nominal volume RMSE falls 6.2%. Mean volume
interval width falls 37.1%, rather than buying coverage by widening everything.
Mean absolute posterior loss/bias correlation falls from .1835 to .0799; this
is a model-conditional summary, not a physical-independence certificate.

Five of six frozen engineering gates pass. The gate requiring >=90% volume
coverage in EVERY changed regime fails for all-sensor blackout and decoupled
mixed operation. Pooled volume coverage is 90.91%, which does not override those
failures. Moreover, latent bias and loss coverage are only 77.16% and 87.53%
respectively, and slow-drift bias coverage is 49.54%. The bias estimate is more
accurate but its interval is still not reliably calibrated. The retained outcome
is benchmark_gate_failed_not_promoted. No old model is replaced or qualified.

## Negative controls matter

On the bias-plateau case, volume/bias RMSEs are:

| Measurement arm | Volume RMSE (L) | Bias RMSE (L) |
| --- | ---: | ---: |
| no reference | .8215 | 1.0944 |
| independent every 4 s | .4157 | .7203 |
| shared-bias monitor every 4 s | .8086 | 1.0734 |
| independent every 1 s | .2814 | .5489 |
| one reading at t=4 | .8204 | 1.0947 |

An explicit fault-injection case feeds a common-bias measurement while declaring
it independent. Its volume RMSE worsens to .8930 L and coverage falls to 68.36%.
Labels/hashes cannot establish real calibration or independence. The ingestion
checks reject a DECLARED copied-primary noise family, stale hashes, duplicates,
wrong calibration identities and incompatible variances. Relabelling the same
numbers with false metadata is not automatically detectable; upstream source
qualification remains necessary. This benchmark has no external ingestion route.

## Verification and software scope

The 36 added test cases exercise the null direction, rank controls, unchanged
baseline/no-reference execution, delayed-reference replay, future-data isolation,
nonmutation, duplicate/hash/variance gates, missing reference freshness and
separate identities. The original 196 test cases remain unchanged. Local native
Node registration-copy tests total 232 passed. Focused strict engine/new-test
checking passes. The full native-copy typecheck has an existing Vitest-to-Node
callback-return signature mismatch in the old switching test; this does not
change published Vitest tests and is not reported as a passing full typecheck.
Actual repository Vitest/full typecheck/build status is recorded in the PR.

NumPy uses a joint A/B/reference batch likelihood and subtractive covariance
update rather than the TypeScript sequential Joseph updates. It verifies 864
example posteriors plus 256 terminal Gaussian-collapse cases (1120 comparisons),
mixture weights/components, interval endpoints, ranks and aggregate arithmetic.
Maximum mean/covariance differences are 1.78e-14 / 1.95e-14, component covariance
2.84e-13, and interval endpoint 4.24e-6 (mixed units follow the corresponding
entry). No jitter or eigenvalue clipping is used. The separate 256-seed Gaussian
diagnostic has mean NEES 4.091063486; the oracle reports its conventional two-
sided 99% reference band separately, not as an extra held-out acceptance gate.
It does not erase PR20's retained fixed-run consistency failure.

No network request is needed to inspect generated HTML. The report uses only
retained results; synthetic truth is explicitly evaluation-only. NET orchestration,
ESM admission/release, GSC's existing application and GSV remain untouched. This
is a bounded reference interface, not hardened hostile-JavaScript ingestion,
physical calibration, exact switching inference or an operational leak detector.

## Primary mathematical references

- Observability rank: https://www.mathworks.com/help/control/ref/statespacemodel.obsv.html
- IMM mixing equations: https://filterpy.readthedocs.io/en/latest/_modules/filterpy/kalman/IMM.html
- Covariance in uncertainty propagation: https://www.itl.nist.gov/div898/handbook/mpc/section5/mpc552.htm

Existing repository licensing applies. The new evidence removes a demonstrated
structural ambiguity under its assumptions; it does not guarantee well-calibrated
fault trajectories when all sensors disappear or the disturbance prior is wrong.
