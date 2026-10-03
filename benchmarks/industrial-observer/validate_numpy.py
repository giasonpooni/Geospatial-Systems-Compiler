"""Independent numerical check of generated TypeScript results (NumPy + SciPy)."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import numpy as np
import scipy
from scipy.stats import chi2


def validate(folder: Path) -> dict:
    report = json.loads((folder / 'report.json').read_text())
    fixtures = json.loads((folder / 'synthetic-fixtures.json').read_text())
    maximum_mean_error = maximum_covariance_error = maximum_metric_error = 0.0
    comparisons = 0
    for fixture, scenario in zip(fixtures, report['scenarios'], strict=True):
        assert fixture['scenario'] == scenario['scenario']
        model = fixture['model']
        f = np.asarray(model['transition'], dtype=float)
        q = np.asarray(model['processCovariance'], dtype=float)
        controls = np.asarray(fixture['controls'], dtype=float)
        truth = np.asarray(fixture['truth'], dtype=float)
        errors, coverages, all_nees = [], [], []
        for row in scenario['series']:
            cutoff = row['step']
            cutoff_iso = f'2026-01-01T00:{cutoff//60:02d}:{cutoff%60:02d}.000Z'
            selected = sorted((r for r in fixture['readings'] if r['knownAt'] <= cutoff_iso), key=lambda r: (r['observedAt'], r['sensor']))
            mean = np.asarray(model['initial']['mean'], dtype=float).copy()
            covariance = np.asarray(model['initial']['covariance'], dtype=float).copy()
            index = 0
            for tick in range(1, cutoff + 1):
                mean = f @ mean + controls[tick-1]
                covariance = f @ covariance @ f.T + q
                iso = f'2026-01-01T00:{tick//60:02d}:{tick%60:02d}.000Z'
                while index < len(selected) and selected[index]['observedAt'] == iso:
                    reading = selected[index]
                    sensor = reading['sensor']
                    r = reading['noiseVarianceLitres2'] + reading['referenceVarianceLitres2']
                    residual = reading['valueLitres'] - mean[sensor]
                    s = covariance[sensor, sensor] + r
                    cross = covariance[:, sensor].copy()
                    mean += cross * (residual / s)
                    # Subtractive covariance update is independent of the TS Joseph implementation.
                    covariance -= np.outer(cross, cross) / s
                    index += 1
            assert index == len(selected)
            np.testing.assert_allclose(mean, row['mean'], rtol=0, atol=2e-11)
            np.testing.assert_allclose(covariance, row['covariance'], rtol=0, atol=2e-11)
            maximum_mean_error = max(maximum_mean_error, float(np.max(np.abs(mean - row['mean']))))
            maximum_covariance_error = max(maximum_covariance_error, float(np.max(np.abs(covariance - row['covariance']))))
            assert np.min(np.linalg.eigvalsh(covariance)) > 0
            error = truth[cutoff] - mean
            all_nees.append(float(error @ np.linalg.solve(covariance, error)))
            errors.extend(error**2)
            coverages.extend(np.abs(error) <= 1.959963984540054 * np.sqrt(np.diag(covariance)))
            comparisons += 1
        expected = [np.sqrt(np.mean(errors)), np.mean(coverages), np.mean(all_nees)]
        actual = [scenario['metrics']['rmseLitres']['kalman'], scenario['metrics']['marginalCoverage95'], scenario['metrics']['meanNees']]
        np.testing.assert_allclose(expected, actual, rtol=0, atol=2e-11)
        maximum_metric_error = max(maximum_metric_error, float(np.max(np.abs(np.asarray(expected)-actual))))
    for metric, degrees in [('nees', 512), ('nis', 256)]:
        expected_band = chi2.ppf([0.005, 0.995], degrees) / 256
        np.testing.assert_allclose(expected_band, report['consistency']['bands'][metric], rtol=0, atol=1e-13)
    return {
        'status': 'passed', 'scenarios': len(fixtures), 'posterior_comparisons': comparisons,
        'maximum_mean_absolute_difference_litres': maximum_mean_error,
        'maximum_covariance_absolute_difference_litres_squared': maximum_covariance_error,
        'maximum_metric_absolute_difference': maximum_metric_error,
        'bands_verified_against_scipy': True,
        'numpy_version': np.__version__, 'scipy_version': scipy.__version__,
        'scope': 'Independent numerical equivalence; not validation against physical measurements.'
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output_folder', type=Path)
    args = parser.parse_args()
    print(json.dumps(validate(args.output_folder), indent=2))
