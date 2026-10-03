"""Independent numerical oracle. NumPy subtractive update versus TS Joseph update."""
from __future__ import annotations
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import scipy
from scipy.stats import chi2


def stamp(tick: int) -> str:
    return (datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=tick)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def posterior(fixture: dict, cutoff: int) -> tuple[np.ndarray, np.ndarray, dict]:
    model = fixture['model']
    f = np.asarray(model['transition'], dtype=float)
    q = np.asarray(model['processCovariance'], dtype=float)
    mean = np.asarray(model['initial']['mean'], dtype=float).copy()
    cov = np.asarray(model['initial']['covariance'], dtype=float).copy()
    eligible = sorted((r for r in fixture['readings'] if r['knownAt'] <= stamp(cutoff)), key=lambda r: (r['observedAt'], r['sensor']))
    cursor = 0
    innovations = {}
    for tick in range(1, cutoff + 1):
        u = np.asarray([*fixture['controls'][tick-1], 0.0])
        mean = f @ mean + u
        cov = f @ cov @ f.T + q
        while cursor < len(eligible) and eligible[cursor]['observedAt'] == stamp(tick):
            r = eligible[cursor]
            sensor = r['sensor']
            residual = r['valueLitres'] - mean[sensor]
            variance = cov[sensor, sensor] + r['noiseVarianceLitres2'] + r['referenceVarianceLitres2']
            cross = cov[:, sensor].copy()
            mean += cross * residual / variance
            cov -= np.outer(cross, cross) / variance
            innovations[r['recordId']] = float(residual**2 / variance)
            cursor += 1
    assert cursor == len(eligible)
    return mean, cov, innovations


def validate(folder: Path) -> dict:
    report = json.loads((folder / 'report.json').read_text())
    max_mean = max_cov = max_metric = 0.0
    comparisons = 0
    for example in report['examples']:
        volume_squared = []
        volume_covered = []
        loss_squared = []
        nees = []
        for row in example['series']:
            mean, cov, _ = posterior(example, row['step'])
            actual = row['augmented']['state']
            np.testing.assert_allclose(mean, actual['mean'], atol=3e-11, rtol=0)
            np.testing.assert_allclose(cov, actual['covariance'], atol=3e-11, rtol=0)
            max_mean = max(max_mean, float(np.max(np.abs(mean - actual['mean']))))
            max_cov = max(max_cov, float(np.max(np.abs(cov - actual['covariance']))))
            assert np.linalg.eigvalsh(cov).min() > 0
            truth = np.asarray(row['evaluationTruth'])
            error = truth - mean
            volume_squared.extend(error[:2]**2)
            volume_covered.extend(np.abs(error[:2]) <= 1.959963984540054*np.sqrt(np.diag(cov)[:2]))
            loss_squared.append(error[2]**2)
            nees.append(float(error[:2] @ np.linalg.solve(cov[:2, :2], error[:2])))
            comparisons += 1
        expected = np.array([np.sqrt(np.mean(volume_squared)), np.mean(volume_covered), np.sqrt(np.mean(loss_squared)), np.mean(nees)])
        actual = np.array([example['metrics'][k] for k in ['augmentedRmse', 'augmentedCoverage', 'lossRmse', 'augmentedVolumeMeanNees']])
        np.testing.assert_allclose(expected, actual, atol=3e-11, rtol=0)
        max_metric = max(max_metric, float(np.max(np.abs(expected-actual))))
    matched = json.loads((folder / 'consistency-fixtures.json').read_text())
    matched_nees, matched_nis = [], []
    for row in matched:
        fixture = row['fixture']
        mean, cov, innovations = posterior(fixture, 64)
        error = np.asarray(fixture['truth'][64]) - mean
        value = float(error @ np.linalg.solve(cov, error))
        nis = innovations['synthetic:tank:a:64']
        np.testing.assert_allclose([value, nis], [row['nees3'], row['nis']], atol=3e-10, rtol=0)
        matched_nees.append(value)
        matched_nis.append(nis)
        comparisons += 1
    np.testing.assert_allclose([np.mean(matched_nees), np.mean(matched_nis)],
                              [report['consistency']['meanNees3'], report['consistency']['meanNis']], atol=3e-11, rtol=0)
    for key, df in [('nees3', 768), ('nis', 256)]:
        np.testing.assert_allclose(chi2.ppf([.005, .995], df)/256,
                                  report['consistency']['bands'][key], atol=1e-13, rtol=0)
    # Recompute held-out summaries from independent replicate-level stored metrics.
    trials = [trial['metrics'] for case in report['evaluation']['regimes']
              if case['regime'] not in ['nominal', 'sensor_bias'] for trial in case['trials']]
    ratio = np.sqrt(np.mean([r['augmentedRmse']**2 for r in trials]))/np.sqrt(np.mean([r['baselineRmse']**2 for r in trials]))
    coverage = np.mean([r['augmentedCoverage'] for r in trials])
    np.testing.assert_allclose([ratio, coverage], [report['evaluation']['combinedLosses']['rmseRatio'], report['evaluation']['combinedLosses']['augmentedCoverage']], atol=1e-13, rtol=0)
    assert not report['evaluation']['gates']['aggregateLossCoverage']
    return {'status': 'passed', 'posterior_or_consistency_comparisons': comparisons,
            'heldout_example_posteriors': 768, 'matched_terminal_statistics': len(matched),
            'maximum_mean_difference': max_mean, 'maximum_covariance_difference': max_cov,
            'maximum_metric_difference': max_metric, 'reference_bands_verified': True,
            'heldout_gate_failure_preserved': True, 'numpy': np.__version__, 'scipy': scipy.__version__,
            'scope': 'Numerical equivalence and report arithmetic, not field validation.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output_folder', type=Path)
    print(json.dumps(validate(parser.parse_args().output_folder), indent=2))
