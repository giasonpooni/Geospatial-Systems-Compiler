/** Bounded three-state reference algebra. No replacement of the two-state core. */
import { requireCondition } from '../core';
import type { GaussianLossState, Matrix3, Triple } from '../../../src/types/loss_observer';

export function triple(x: unknown): asserts x is Triple {
  requireCondition(Array.isArray(x) && x.length === 3 && [0, 1, 2].every(i =>
    Object.hasOwn(x, i) && typeof x[i] === 'number' && Number.isFinite(x[i]) && Math.abs(x[i]) <= 1e12), 'Expected finite triple.');
}
export function matrix3(p: unknown): asserts p is Matrix3 {
  requireCondition(Array.isArray(p) && p.length === 3, 'Expected 3x3 matrix.');
  [0, 1, 2].forEach(i => triple(p[i]));
}
export const identity3 = (): Matrix3 => [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export const transpose3 = (a: Matrix3): Matrix3 => [0, 1, 2].map(i => a.map(row => row[i])) as Matrix3;
export const multiply3 = (a: Matrix3, b: Matrix3): Matrix3 => [0, 1, 2].map(i =>
  [0, 1, 2].map(j => a[i][0]*b[0][j] + a[i][1]*b[1][j] + a[i][2]*b[2][j])) as Matrix3;
export const add3 = (a: Matrix3, b: Matrix3): Matrix3 => a.map((r, i) => r.map((v, j) => v+b[i][j])) as Matrix3;
export const apply3 = (a: Matrix3, x: Triple): Triple => a.map(r => r[0]*x[0]+r[1]*x[1]+r[2]*x[2]) as Triple;

/** Diagonal scaling makes the PD tolerance dimensionless despite mixed units. */
export function cholesky3(p: Matrix3): Matrix3 {
  matrix3(p);
  const scales = [0, 1, 2].map(i => Math.sqrt(p[i][i]));
  requireCondition(scales.every(s => Number.isFinite(s) && s > 0), 'Nonpositive variance.');
  const c = p.map((row, i) => row.map((v, j) => v/scales[i]/scales[j])) as Matrix3;
  for (let i = 0; i < 3; ++i) for (let j = 0; j < i; ++j) {
    requireCondition(Math.abs(c[i][j]-c[j][i]) <= 1e-12, 'Asymmetric covariance.');
  }
  const l: Matrix3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; ++i) for (let j = 0; j <= i; ++j) {
    let v = c[i][j];
    for (let k = 0; k < j; ++k) v -= l[i][k]*l[j][k];
    if (i === j) { requireCondition(v > 1e-13, 'Covariance is singular or indefinite.'); l[i][j] = Math.sqrt(v); }
    else l[i][j] = v/l[j][j];
  }
  return l.map((row, i) => row.map(v => v*scales[i])) as Matrix3;
}
export function checked3(mean: Triple, covariance: Matrix3): GaussianLossState {
  triple(mean); matrix3(covariance);
  const symmetric = covariance.map((row, i) => row.map((v, j) => (v+covariance[j][i])/2)) as Matrix3;
  cholesky3(symmetric);
  return { mean: [...mean], covariance: symmetric };
}
export function nees3(state: GaussianLossState, truth: Triple): number {
  triple(truth); triple(state.mean);
  const l = cholesky3(state.covariance); const z: Triple = [0, 0, 0];
  for (let i = 0; i < 3; ++i) {
    let e = truth[i]-state.mean[i];
    for (let j = 0; j < i; ++j) e -= l[i][j]*z[j];
    z[i] = e/l[i][i];
  }
  return z.reduce((s, v) => s+v*v, 0);
}
/** Row-normalized elimination. Explicit tolerance for this small reference. */
export function rank3(rows: readonly Triple[]): 0 | 1 | 2 | 3 {
  const a = rows.filter(r => Math.hypot(...r) > 1e-12).map(r => {
    const scale = Math.hypot(...r); return r.map(v => v/scale);
  });
  let rank = 0;
  for (let col = 0; col < 3 && rank < a.length; ++col) {
    let pivot = rank;
    for (let i = rank+1; i < a.length; ++i) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    if (Math.abs(a[pivot][col]) < 1e-10) continue;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    const value = a[rank][col]; for (let j = col; j < 3; ++j) a[rank][j] /= value;
    for (let i = rank+1; i < a.length; ++i) {
      const factor = a[i][col]; for (let j = col; j < 3; ++j) a[i][j] -= factor*a[rank][j];
    }
    ++rank;
  }
  return rank as 0 | 1 | 2 | 3;
}
