import { requireCondition as check } from '../core';
import type { Gaussian4 } from '../../../src/types/switching_observer';

/** Small bounded reference algebra, not a general replacement numerical library. */
export const zero = (n = 4): number[][] => Array.from({ length: n }, () => Array(n).fill(0));
export const eye = (): number[][] => zero().map((r, i) => r.map((_, j) => Number(i === j)));
export const transpose = (a: number[][]): number[][] => a[0].map((_, i) => a.map(r => r[i]));
export const dot = (a: number[], b: number[]): number => a.reduce((s, v, i) => s + v*b[i], 0);
export const apply = (a: number[][], x: number[]): number[] => a.map(r => dot(r, x));
export const mul = (a: number[][], b: number[][]): number[][] => a.map(r => transpose(b).map(c => dot(r, c)));
export const add = (a: number[][], b: number[][]): number[][] => a.map((r, i) => r.map((v, j) => v+b[i][j]));
export function vector(x: unknown, n = 4): asserts x is number[] {
  check(Array.isArray(x) && x.length === n && Array.from({ length: n }, (_, i) => i).every(i =>
    Object.hasOwn(x, i) && typeof x[i] === 'number' && Number.isFinite(x[i]) && Math.abs(x[i]) <= 1e12), 'Invalid finite vector.');
}
export function matrix(a: unknown, n = 4): asserts a is number[][] {
  check(Array.isArray(a) && a.length === n, 'Invalid matrix shape.');
  for (let i = 0; i < n; ++i) vector(a[i], n);
}
/** Dimensionless correlation scaling; no covariance clipping or jitter. */
export function chol(p: number[][]): number[][] {
  matrix(p); const scale = p.map((r, i) => Math.sqrt(r[i]));
  check(scale.every(s => Number.isFinite(s) && s > 0), 'Nonpositive variance.');
  const c = p.map((r, i) => r.map((v, j) => v/scale[i]/scale[j])); const l = zero();
  for (let i = 0; i < 4; ++i) for (let j = 0; j <= i; ++j) {
    check(Math.abs(c[i][j]-c[j][i]) <= 1e-11, 'Asymmetric covariance.');
    let v = c[i][j]; for (let k = 0; k < j; ++k) v -= l[i][k]*l[j][k];
    if (i === j) { check(v > 1e-13, 'Singular or indefinite covariance.'); l[i][j] = Math.sqrt(v); }
    else l[i][j] = v/l[j][j];
  }
  return l.map((r, i) => r.map(v => v*scale[i]));
}
export function checked(mean: number[], p: number[][]): Gaussian4 {
  vector(mean); matrix(p); chol(p);
  return { mean: [...mean], covariance: p.map((r, i) => r.map((v, j) => (v+p[j][i])/2)) };
}
export function weights(w: number[], n: number): void {
  vector(w, n); check(w.every(v => v >= 0) && Math.abs(w.reduce((s, v) => s+v, 0)-1) < 1e-10, 'Invalid mixture weights.');
}
export function mix(states: Gaussian4[], w: number[]): Gaussian4 {
  check(states.length > 0 && states.length <= 4, 'Invalid component count.'); weights(w, states.length);
  states.forEach(s => { vector(s.mean); chol(s.covariance); });
  const mean = [0, 1, 2, 3].map(d => states.reduce((s, x, i) => s+w[i]*x.mean[d], 0));
  const p = zero();
  states.forEach((s, k) => {
    for (let i = 0; i < 4; ++i) for (let j = 0; j < 4; ++j) {
      p[i][j] += w[k]*(s.covariance[i][j]+(s.mean[i]-mean[i])*(s.mean[j]-mean[j]));
    }
  });
  return checked(mean, p);
}
/** Normal CDF approximation; absolute error about 8e-8, checked against SciPy. */
export function normalCdf(x: number): number {
  if (x === 0) return 0.5;
  const a = Math.abs(x); const t = 1/(1+0.2316419*a);
  const tail = Math.exp(-a*a/2)/Math.sqrt(2*Math.PI)*t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return x > 0 ? 1-tail : tail;
}
export function intervals(states: Gaussian4[], w: number[]): [number, number][] {
  weights(w, states.length);
  return [0, 1, 2, 3].map(d => {
    const sd = states.map(s => Math.sqrt(s.covariance[d][d]));
    const cdf = (x: number) => states.reduce((s, c, i) => s+w[i]*normalCdf((x-c.mean[d])/sd[i]), 0);
    return [0.025, 0.975].map(q => {
      let lo = Math.min(...states.map((s, i) => s.mean[d]-12*sd[i]));
      let hi = Math.max(...states.map((s, i) => s.mean[d]+12*sd[i]));
      for (let n = 0; n < 54; ++n) { const mid = (lo+hi)/2; if (cdf(mid) < q) lo = mid; else hi = mid; }
      return (lo+hi)/2;
    }) as [number, number];
  });
}
export function rank(rows: number[][]): number {
  const a = rows.filter(r => Math.hypot(...r) > 1e-12).map(r => r.map(v => v/Math.hypot(...r)));
  let rank = 0;
  for (let col = 0; col < 4 && rank < a.length; ++col) {
    let pivot = rank; for (let i = rank+1; i < a.length; ++i) if (Math.abs(a[i][col]) > Math.abs(a[pivot][col])) pivot = i;
    if (Math.abs(a[pivot][col]) < 1e-10) continue;
    [a[rank], a[pivot]] = [a[pivot], a[rank]];
    const v = a[rank][col]; for (let j = col; j < 4; ++j) a[rank][j] /= v;
    for (let i = rank+1; i < a.length; ++i) { const v = a[i][col]; for (let j = col; j < 4; ++j) a[i][j] -= v*a[rank][j]; }
    rank++;
  }
  return rank;
}
