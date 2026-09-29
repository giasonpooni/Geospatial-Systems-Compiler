"""Independent LP outer-enclosure checks and exact rational arithmetic audit.

SciPy/HiGHS solves the full prefix constraint system, unlike the TypeScript
one-step box contractor. This is a numerical oracle, not a formal proof of
floating-point LP feasibility or a physical calibration certificate.
"""
from __future__ import annotations
import argparse
import json
from fractions import Fraction
from pathlib import Path
import numpy as np
import scipy
from scipy.optimize import linprog
from scipy.sparse import coo_matrix


def step(timestamp: str) -> int:
    from datetime import datetime
    return int((datetime.fromisoformat(timestamp.replace('Z', '+00:00')) -
                datetime.fromisoformat('2026-01-01T00:00:00+00:00')).total_seconds())


def constraints(fixture: dict, cutoff: int):
    inp = fixture['input']
    c, calibration = inp['contract'], inp['calibration']
    n = 4*(cutoff+1)+1
    rows, cols, values, rhs = [], [], [], []

    def strip(coeff: dict[int, float], lo: float, hi: float):
        for sign, limit in [(1, hi), (-1, -lo)]:
            index = len(rhs)
            for col, value in coeff.items():
                rows.append(index); cols.append(col); values.append(sign*value)
            rhs.append(limit)

    bounds = [tuple(x) for x in c['initial']]
    for _ in range(cutoff):
        bounds.extend([(None, None), (None, None), tuple(c['nuisanceDomain'][0]), tuple(c['nuisanceDomain'][1])])
    bounds.append(tuple(calibration['offsetLitres']))
    f = c['transition']
    for t in range(1, cutoff+1):
        old, cur = 4*(t-1), 4*t
        u = inp['controls'][t-1]
        strip({cur:1, old:-f[0][0], old+1:-f[0][1]},
              u[0]-c['processAbsLitres'][0], u[0]+c['processAbsLitres'][0])
        strip({cur+1:1, old:-f[1][0], old+1:-f[1][1], cur+2:1},
              u[1]-c['processAbsLitres'][1], u[1]+c['processAbsLitres'][1])
        strip({cur+2:1, old+2:-1}, -c['lossIncrementAbs'], c['lossIncrementAbs'])
        strip({cur+3:1, old+3:-1}, -c['biasIncrementAbs'], c['biasIncrementAbs'])
    for r in inp['readings']:
        t = step(r['observedAt'])
        if step(r['knownAt']) > cutoff:
            continue
        ch, y = r['channel'], r['valueLitres']
        if ch == 'a':
            strip({4*t:1}, y-c['measurementAbsLitres'][0], y+c['measurementAbsLitres'][0])
        elif ch == 'b':
            strip({4*t+1:1,4*t+3:1}, y-c['measurementAbsLitres'][1], y+c['measurementAbsLitres'][1])
        else:
            if step(calibration['knownAt']) > cutoff or r['calibrationId'] != calibration['calibrationId'] or not step(calibration['calibratedAt']) <= t <= step(calibration['validThrough']):
                continue
            error = c['measurementAbsLitres'][2] + calibration['driftAbsLitresPerSecond']*(t-step(calibration['calibratedAt']))
            strip({4*t+1:1,n-1:1}, y-error, y+error)
    matrix = coo_matrix((values,(rows,cols)),shape=(len(rhs),n)).tocsr()
    return matrix, np.asarray(rhs), bounds


def exact_arithmetic(data: dict) -> int:
    count = 0
    for r in data['neighbors']:
        assert r['up'] == float(np.nextafter(r['x'], np.inf))
        assert r['down'] == float(np.nextafter(r['x'], -np.inf))
        count += 2
    for group in ['arithmetic', 'multiply', 'divide']:
        for r in data[group]:
            a, b = Fraction(r['a']), Fraction(r['b'])
            tests = [('sum', a+b), ('difference', a-b)] if group == 'arithmetic' else [('bound', a*b if group == 'multiply' else a/b)]
            for key, exact in tests:
                lo, hi = r[key]
                assert Fraction(lo) <= exact <= Fraction(hi), (group,r)
                count += 1
    return count


def validate(folder: Path) -> dict:
    report = json.loads((folder/'report.json').read_text())
    arithmetic_count = exact_arithmetic(json.loads((folder/'arithmetic.json').read_text()))
    extrema, prefixes, largest_gap = 0, 0, 0.0
    for example in report['examples']:
        fixture = example['fixture']
        for cutoff in [8,32,64,96]:
            a, b, bounds = constraints(fixture,cutoff)
            asserted = example['series'][cutoff-1]['bounds']
            assert asserted is not None
            for axis in range(4):
                objective = np.zeros(a.shape[1]); objective[4*cutoff+axis] = 1
                low = linprog(objective,A_ub=a,b_ub=b,bounds=bounds,method='highs')
                high = linprog(-objective,A_ub=a,b_ub=b,bounds=bounds,method='highs')
                assert low.success and high.success, (example['regime'],cutoff,axis,low.message,high.message)
                lo, hi = low.fun, -high.fun
                # Solver tolerance is independently declared; it is not TS roundoff padding.
                assert asserted[axis][0] <= lo+5e-8
                assert asserted[axis][1] >= hi-5e-8
                truth = fixture['truth'][cutoff][axis]
                assert lo-5e-8 <= truth <= hi+5e-8
                largest_gap = max(largest_gap, float((asserted[axis][1]-asserted[axis][0])-(hi-lo)))
                extrema += 2
            prefixes += 1
        # Check ground truth obeys every declared physical support assumption.
        inp=fixture['input']; c=inp['contract']; f=np.asarray(c['transition'])
        x=np.asarray(fixture['truth'])
        assert all(lo <= value <= hi for value,(lo,hi) in zip(x[0],c['initial']))
        assert np.max(np.abs(np.diff(x[:,2]))) <= c['lossIncrementAbs']+1e-12
        assert np.max(np.abs(np.diff(x[:,3]))) <= c['biasIncrementAbs']+1e-12
        for tick in range(1,len(x)):
            w=x[tick,:2]-(f@x[tick-1,:2]+np.asarray(inp['controls'][tick-1])+np.asarray([0,-x[tick,2]]))
            assert np.all(np.abs(w) <= np.asarray(c['processAbsLitres'])+1e-12)
        for row in inp['readings']:
            t=step(row['observedAt']);ch=row['channel']
            expected=x[t,0] if ch=='a' else x[t,1]+x[t,3] if ch=='b' else x[t,1]+fixture['calibrationOffset']+fixture['calibrationDrift'][t]
            bound=c['measurementAbsLitres'][['a','b','reference'].index(ch)]
            assert abs(row['valueLitres']-expected) <= bound+1e-12
        for row in example['series']:
            box=np.asarray(row['bounds']); truth=x[row['step']]
            assert np.all(truth >= box[:,0]) and np.all(truth <= box[:,1])
    assert report['gates']['conditionalContainment'] and report['gates']['staleBlackoutAbstention']
    assert report['gates']['expiredReferencesExcluded']
    assert not report['gates']['usefulVolumeAvailability']  # Retain the frozen failed utility gate.
    return {'status':'passed','prefix_constraint_systems':prefixes,'lp_coordinate_extrema':extrema,
            'exact_rational_or_neighbor_checks':arithmetic_count,'largest_extra_box_width_vs_full_prefix_lp':largest_gap,
            'lp_absolute_comparison_tolerance':5e-8,'example_all_cutoff_containment_checks':len(report['examples'])*96*4,
            'scope':'Numerical/exact-arithmetic checks; conditional supports are synthetic assumptions, not field certificates.',
            'numpy':np.__version__,'scipy':scipy.__version__}


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output_directory',type=Path)
    print(json.dumps(validate(parser.parse_args().output_directory),indent=2))
