"""Batch A/B/reference NumPy oracle versus sequential TypeScript IMM updates."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import numpy as np
import scipy
from scipy.stats import chi2

# Reuse only the prior independent oracle's Gaussian-mixture algebra/CDF helpers.
_spec = importlib.util.spec_from_file_location('imm_oracle', Path(__file__).parents[1] / 'switching' / 'validate_numpy.py')
assert _spec and _spec.loader
old = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(old)


def simulate(fixture: dict, cutoff: int):
    model = fixture['model']
    f, q, transition = [np.asarray(model[k], float) for k in ['transition', 'processCovariances', 'modeTransition']]
    primary_h = np.asarray(model['measurementRows'], float)
    reference_h = np.array([0., 1., 0., 0. if fixture['spec']['loading'] == 'tank_b' else 1.])
    x = np.tile(model['initial']['mean'], (4, 1)).astype(float)
    covariances = np.tile(model['initial']['covariance'], (4, 1, 1)).astype(float)
    weights = np.asarray(model['initialModeWeights'], float)
    rows = [(r, primary_h[r['sensor']], r['noiseVarianceLitres2'] + r['referenceVarianceLitres2'])
            for r in fixture['readings'] if r['knownAt'] <= old.stamp(cutoff)]
    rows += [(r, reference_h, r['varianceLitres2']) for r in fixture['references'] if r['knownAt'] <= old.stamp(cutoff)]
    by_time: dict[str, list] = {}
    for row in rows:
        by_time.setdefault(row[0]['observedAt'], []).append(row)
    consumed = 0
    for tick in range(1, cutoff + 1):
        batch = by_time.get(old.stamp(tick), [])
        prior = weights @ transition
        next_x, next_p, log_mass = [], [], []
        for j in range(4):
            mean, p = old.mixed(x, covariances, weights * transition[:, j] / prior[j])
            mean = f @ mean + [*fixture['controls'][tick-1], 0, 0]
            p = f @ p @ f.T + q[j]
            log_likelihood = 0.
            if batch:
                h = np.array([item[1] for item in batch])
                r = np.diag([item[2] for item in batch])
                residual = np.array([item[0]['valueLitres'] for item in batch]) - h @ mean
                innovation = h @ p @ h.T + r
                cross = p @ h.T
                mean += cross @ np.linalg.solve(innovation, residual)
                p -= cross @ np.linalg.solve(innovation, cross.T)
                p = (p + p.T) / 2  # analytic symmetry, no clipping or jitter
                sign, logdet = np.linalg.slogdet(innovation)
                assert sign > 0
                log_likelihood = -.5 * (len(batch) * np.log(2*np.pi) + logdet + residual @ np.linalg.solve(innovation, residual))
            assert np.linalg.eigvalsh(p).min() > 0
            next_x.append(mean); next_p.append(p)
            log_mass.append(np.log(prior[j]) + log_likelihood)
        log_mass = np.array(log_mass)
        weights = np.exp(log_mass - log_mass.max()); weights /= weights.sum()
        x, covariances = np.array(next_x), np.array(next_p)
        consumed += len(batch)
    assert consumed == len(rows)
    mean, cov = old.mixed(x, covariances, weights)
    return mean, cov, x, covariances, weights


def validate(folder: Path) -> dict:
    report = json.loads((folder / 'report.json').read_text())
    maxima = dict(mean=0., covariance=0., component_mean=0., component_covariance=0., mode_weight=0., interval=0.)
    checks = 0
    for example in report['examples']:
        error, coverage = [], []
        for row in example['series']:
            mean, cov, x, p, w = simulate(example['fixture'], row['step'])
            result = row['result']
            targets = [result['state']['mean'], result['state']['covariance'], [c['mean'] for c in result['components']],
                       [c['covariance'] for c in result['components']], result['modeWeights']]
            for key, actual, target in zip(list(maxima)[:5], [mean, cov, x, p, w], targets, strict=True):
                np.testing.assert_allclose(actual, target, atol=3e-9, rtol=0)
                maxima[key] = max(maxima[key], float(np.max(np.abs(actual - target))))
            intervals = old.exact_intervals(x, p, w)
            np.testing.assert_allclose(intervals, result['interval95'], atol=5e-5, rtol=0)
            maxima['interval'] = max(maxima['interval'], float(np.max(np.abs(intervals-result['interval95']))))
            truth = np.asarray(row['evaluationTruth'])
            error.append((truth-mean)**2)
            coverage.append((truth >= intervals[:, 0]) & (truth <= intervals[:, 1]))
            checks += 1
        error, coverage = np.array(error), np.array(coverage)
        metrics = example['metrics']
        expected = [np.sqrt(error[:, :2].mean()), np.sqrt(error[:, 2].mean()), np.sqrt(error[:, 3].mean()),
                    coverage[:, :2].mean(), coverage[:, 2].mean(), coverage[:, 3].mean()]
        actual = [metrics[k] for k in ['volumeRmse', 'lossRmse', 'biasRmse', 'volumeCoverage', 'lossCoverage', 'biasCoverage']]
        np.testing.assert_allclose(expected, actual, atol=3e-9, rtol=0)
    matched = json.loads((folder / 'gaussian-fixtures.json').read_text())
    nees = []
    for row in matched:
        mean, cov, *_ = simulate(row['fixture'], len(row['fixture']['controls']))
        error = np.array(row['fixture']['truth'][-1])-mean
        value = float(error @ np.linalg.solve(cov, error))
        np.testing.assert_allclose(value, row['nees'], atol=3e-8, rtol=0)
        np.testing.assert_allclose(mean, row['result']['state']['mean'], atol=3e-9, rtol=0)
        nees.append(value); checks += 1
    mean_nees = float(np.mean(nees))
    np.testing.assert_allclose(mean_nees, report['gaussian']['meanNees'], atol=3e-9, rtol=0)
    band = chi2.ppf([.005, .995], 4*len(nees))/len(nees)
    structural = []
    for item in report['observability']:
        p = np.array(item['primaryRows']); independent = np.array(item['independentRows']); shared = np.array(item['sharedBiasRows'])
        ranks = {k: int(np.linalg.matrix_rank(a)) for k, a in [('primary', p), ('independent', np.vstack([p, independent])), ('sharedBias', np.vstack([p, shared]))]}
        assert ranks == item['ranks']
        # Units and row scales are fixed; these are descriptive conditioning numbers.
        structural.append({'topology': item['topology'], 'ranks': ranks,
                           'singular_values_primary': np.linalg.svd(p, compute_uv=False).tolist(),
                           'singular_values_independent': np.linalg.svd(np.vstack([p, independent]), compute_uv=False).tolist()})
    e = report['evaluation']; protocol = report['protocol']; changed = [r for r in e['regimes'] if r['regime'] != 'nominal']
    def metrics(regime, arm):
        return next(r for r in regime['arms'] if r['arm'] == arm)['metrics']
    b = [metrics(r, 'none') for r in changed]; a = [metrics(r, 'independent_4s') for r in changed]
    for axis in ['volume', 'loss', 'bias']:
        key = axis+'Rmse'
        ratio = np.sqrt(np.mean([r[key]**2 for r in a]))/np.sqrt(np.mean([r[key]**2 for r in b]))
        np.testing.assert_allclose(ratio, e['combined']['ratios'][axis], atol=1e-13, rtol=0)
    coverage_gate = all(r['volumeCoverage'] >= protocol['gates']['eachChangedCoverageMinimum'] for r in a)
    assert coverage_gate == e['gates']['everyChangedCoverage']
    return {'status': 'passed', 'posterior_or_terminal_comparisons': checks, 'heldout_example_posteriors': sum(len(e['series']) for e in report['examples']),
            'maximum_absolute_differences': maxima, 'structural_checks': structural,
            'gaussian_diagnostic': {'replications': len(nees), 'mean_nees': mean_nees, 'reference_band_99': band.tolist(),
             'decision': 'below_band' if mean_nees < band[0] else 'above_band' if mean_nees > band[1] else 'within_band',
             'role': 'secondary consistency diagnostic, not an extra held-out acceptance gate'},
            'acceptance_outcome_preserved': e['status'], 'numpy_version': np.__version__, 'scipy_version': scipy.__version__,
            'scope': 'Numerical equivalence and structural/aggregate arithmetic; not physical calibration.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    print(json.dumps(validate(parser.parse_args().folder), indent=2))
