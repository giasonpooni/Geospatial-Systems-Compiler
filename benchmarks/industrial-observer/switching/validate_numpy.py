"""Independent NumPy batch-update oracle for the TypeScript sequential IMM reference."""
from __future__ import annotations
import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import scipy
from scipy.special import ndtr
from scipy.optimize import brentq
from scipy.stats import chi2


def stamp(t: int) -> str:
    return (datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=t)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def mixed(x: np.ndarray, p: np.ndarray, weights: np.ndarray):
    mean = weights @ x
    delta = x - mean
    covariance = np.einsum('k,kij->ij', weights, p) + np.einsum('k,ki,kj->ij', weights, delta, delta)
    return mean, covariance


def simulate(fixture: dict, cutoff: int):
    m = fixture['model']
    f, h, q, transition = [np.asarray(m[k], float) for k in ['transition', 'measurementRows', 'processCovariances', 'modeTransition']]
    x = np.tile(m['initial']['mean'], (4, 1)).astype(float)
    p = np.tile(m['initial']['covariance'], (4, 1, 1)).astype(float)
    weights = np.asarray(m['initialModeWeights'], float)
    readings = sorted((r for r in fixture['readings'] if r['knownAt'] <= stamp(cutoff)), key=lambda r: (r['observedAt'], r['sensor']))
    cursor, predictive_nis = 0, None
    for tick in range(1, cutoff + 1):
        batch = []
        while cursor < len(readings) and readings[cursor]['observedAt'] == stamp(tick):
            batch.append(readings[cursor]); cursor += 1
        prior_weights = weights @ transition
        next_x, next_p, log_likelihoods = [], [], []
        priors_x, priors_p = [], []
        for j in range(4):
            omega = weights * transition[:, j] / prior_weights[j]
            mean, cov = mixed(x, p, omega)
            mean = f @ mean + [*fixture['controls'][tick-1], 0, 0]
            cov = f @ cov @ f.T + q[j]
            priors_x.append(mean.copy()); priors_p.append(cov.copy())
            likelihood = 0.0
            if batch:
                hs = h[[r['sensor'] for r in batch]]
                noise = np.diag([r['noiseVarianceLitres2'] + r['referenceVarianceLitres2'] for r in batch])
                residual = np.array([r['valueLitres'] for r in batch]) - hs @ mean
                s = hs @ cov @ hs.T + noise
                cross = cov @ hs.T
                # Joint batch update and subtractive covariance: independent of TS sequential Joseph updates.
                mean += cross @ np.linalg.solve(s, residual)
                cov -= cross @ np.linalg.solve(s, cross.T)
                # Restore analytic symmetry after subtractive roundoff; no clipping or jitter.
                cov = (cov + cov.T) / 2
                sign, logdet = np.linalg.slogdet(s)
                assert sign > 0
                likelihood = -.5 * (len(batch)*np.log(2*np.pi) + logdet + residual @ np.linalg.solve(s, residual))
            next_x.append(mean); next_p.append(cov); log_likelihoods.append(likelihood)
        if tick == cutoff and batch and batch[0]['sensor'] == 0:
            pm, pp = mixed(np.array(priors_x), np.array(priors_p), prior_weights)
            r = batch[0]
            predictive_nis = (r['valueLitres'] - pm[0])**2 / (pp[0, 0] + r['noiseVarianceLitres2'] + r['referenceVarianceLitres2'])
        lw = np.log(prior_weights) + log_likelihoods
        weights = np.exp(lw - max(lw)); weights /= weights.sum()
        x, p = np.array(next_x), np.array(next_p)
    assert cursor == len(readings)
    mean, cov = mixed(x, p, weights)
    return mean, cov, x, p, weights, predictive_nis


def exact_intervals(x, p, w):
    out = []
    for d in range(4):
        sd = np.sqrt(p[:, d, d])
        low, high = min(x[:, d] - 12*sd), max(x[:, d] + 12*sd)
        out.append([brentq(lambda v: w @ ndtr((v - x[:, d])/sd) - target, low, high, xtol=1e-12) for target in [.025, .975]])
    return np.array(out)


def validate(folder: Path) -> dict:
    report = json.loads((folder/'report.json').read_text())
    maximum_mean = maximum_covariance = maximum_weight = maximum_interval = 0.0
    maximum_component_mean = maximum_component_covariance = 0.0
    maximum_component_condition = 0.0
    comparisons = 0
    for example in report['examples']:
        fixture = example['fixture']; squared, covered = [], []
        for row in example['series']:
            mean, cov, x, p, w, _ = simulate(fixture, row['step'])
            candidate = row['candidate']
            np.testing.assert_allclose(mean, candidate['state']['mean'], atol=3e-9, rtol=0)
            np.testing.assert_allclose(cov, candidate['state']['covariance'], atol=3e-9, rtol=0)
            np.testing.assert_allclose(x, [c['mean'] for c in candidate['components']], atol=3e-9, rtol=0)
            np.testing.assert_allclose(p, [c['covariance'] for c in candidate['components']], atol=3e-9, rtol=0)
            maximum_component_mean = max(maximum_component_mean, float(np.max(np.abs(x - [c['mean'] for c in candidate['components']]))))
            maximum_component_covariance = max(maximum_component_covariance, float(np.max(np.abs(p - [c['covariance'] for c in candidate['components']]))))
            maximum_component_condition = max(maximum_component_condition, max(float(np.linalg.cond(covariance)) for covariance in p))
            np.testing.assert_allclose(w, candidate['modeWeights'], atol=3e-10, rtol=0)
            bounds = exact_intervals(x, p, w)
            np.testing.assert_allclose(bounds, candidate['interval95'], atol=5e-5, rtol=0)
            assert np.min(np.linalg.eigvalsh(cov)) > 0
            maximum_mean = max(maximum_mean, float(np.max(np.abs(mean - candidate['state']['mean']))))
            maximum_covariance = max(maximum_covariance, float(np.max(np.abs(cov - candidate['state']['covariance']))))
            maximum_weight = max(maximum_weight, float(np.max(np.abs(w - candidate['modeWeights']))))
            maximum_interval = max(maximum_interval, float(np.max(np.abs(bounds - candidate['interval95']))))
            truth = np.array(row['evaluationTruth'])
            squared.extend((mean[:2] - truth[:2])**2)
            covered.extend((truth[:2] >= bounds[:2, 0]) & (truth[:2] <= bounds[:2, 1]))
            comparisons += 1
        np.testing.assert_allclose(np.sqrt(np.mean(squared)), example['metrics']['switchingRmse'], atol=3e-9, rtol=0)
        np.testing.assert_allclose(np.mean(covered), example['metrics']['switchingCoverage'], atol=1e-12, rtol=0)
    matched = json.loads((folder/'consistency-fixtures.json').read_text())
    for item in matched:
        fixture, expected = item['fixture'], item['expected']
        mean, cov, x, p, w, nis = simulate(fixture, len(fixture['controls']))
        error = np.array(fixture['truth'][-1]) - mean
        nees = error @ np.linalg.solve(cov, error)
        np.testing.assert_allclose([nees, nis], [expected['nees'], expected['predictiveNis']], atol=3e-8, rtol=0)
        np.testing.assert_allclose(mean, expected['state']['mean'], atol=3e-9, rtol=0)
        np.testing.assert_allclose(cov, expected['state']['covariance'], atol=3e-9, rtol=0)
        comparisons += 1
    count = report['consistency']['protocol']['replications']
    collapsed = next(g for g in report['consistency']['groups'] if g['collapsed'])
    nees_band = (chi2.ppf([.005, .995], 4*count)/count).tolist()
    nis_band = (chi2.ppf([.005, .995], count)/count).tolist()
    band_decision = lambda value, band: 'below_band' if value < band[0] else 'above_band' if value > band[1] else 'within_band'
    return {
        'status': 'passed', 'posterior_or_terminal_comparisons': comparisons,
        'maximum_mean_absolute_difference': maximum_mean,
        'maximum_component_mean_difference': maximum_component_mean,
        'maximum_component_covariance_difference': maximum_component_covariance,
        'maximum_component_condition_number': maximum_component_condition,
        'component_tolerance': {'absolute': 3e-9, 'relative': 0},
        'maximum_covariance_absolute_difference': maximum_covariance,
        'maximum_mode_weight_absolute_difference': maximum_weight,
        'maximum_interval_endpoint_difference': maximum_interval,
        'collapsed_gaussian_reference': {'mean_nees': collapsed['meanNees'], 'nees_band': nees_band, 'nees_decision': band_decision(collapsed['meanNees'], nees_band),
                                         'mean_nis': collapsed['meanNis'], 'nis_band': nis_band, 'nis_decision': band_decision(collapsed['meanNis'], nis_band)},
        'mixture_chi_square_gate': 'not_applied_to_approximate_nongaussian_mixture',
        'numpy_version': np.__version__, 'scipy_version': scipy.__version__,
        'scope': 'Numerical equivalence and Gaussian-collapse consistency, not physical validation.'
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    print(json.dumps(validate(parser.parse_args().folder), indent=2))
