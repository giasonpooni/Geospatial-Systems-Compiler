import type { Interval } from '../../../src/types/bounded_observer';

// Binary64 neighbor operations: enclose each basic rounded arithmetic result.
// No probability, epsilon tuning, covariance clipping, or inference is involved.
const view = new DataView(new ArrayBuffer(8));
export function nextUp(x: number): number {
  if (Number.isNaN(x) || x === Infinity) return x;
  if (x === 0) return Number.MIN_VALUE;
  view.setFloat64(0, x, false);
  let bits = view.getBigUint64(0, false);
  bits = x > 0 ? bits + BigInt(1) : bits - BigInt(1);
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}
export const nextDown = (x: number): number => -nextUp(-x);
export function interval(x: unknown): asserts x is Interval {
  if (!Array.isArray(x) || x.length !== 2 || !x.every(Number.isFinite) || x[0] > x[1]) throw new TypeError('Expected a finite closed interval.');
}
function finite(lo: number, hi: number): Interval {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new RangeError('Interval arithmetic overflow.');
  return [lo, hi];
}
export const plus = (a: Interval, b: Interval): Interval => finite(nextDown(a[0]+b[0]), nextUp(a[1]+b[1]));
export const minus = (a: Interval, b: Interval): Interval => finite(nextDown(a[0]-b[1]), nextUp(a[1]-b[0]));
export function scale(a: Interval, c: number): Interval {
  if (!Number.isFinite(c)) throw new TypeError('Nonfinite coefficient.');
  if (c === 0) return [0, 0];
  return c > 0 ? finite(nextDown(a[0]*c), nextUp(a[1]*c)) : finite(nextDown(a[1]*c), nextUp(a[0]*c));
}
export function divide(a: Interval, c: number): Interval {
  if (!Number.isFinite(c) || c === 0) throw new TypeError('Nonzero finite divisor required.');
  return c > 0 ? finite(nextDown(a[0]/c), nextUp(a[1]/c)) : finite(nextDown(a[1]/c), nextUp(a[0]/c));
}
export function intersect(a: Interval, b: Interval): Interval | null {
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
  return lo > hi ? null : [lo, hi];
}
export interface Strip { coefficients: number[]; range: Interval }
/** Necessary interval projections of a linear strip. Every feasible point is
 * retained, but finite passes do not prove joint feasibility or minimal width.
 */
export function contractBox(input: readonly Interval[], strips: readonly Strip[], passes: number): Interval[] | null {
  if (!Number.isInteger(passes) || passes < 1 || passes > 64) throw new TypeError('Invalid contraction budget.');
  input.forEach(interval);
  const box = input.map(v => [...v] as Interval);
  for (const s of strips) {
    interval(s.range);
    if (s.coefficients.length !== box.length || !s.coefficients.every(Number.isFinite)) throw new TypeError('Invalid strip.');
  }
  for (let pass = 0; pass < passes; ++pass) {
    let changed = false;
    for (const s of strips) {
      let total: Interval = [0, 0];
      for (let j = 0; j < box.length; ++j) if (s.coefficients[j]) total = plus(total, scale(box[j], s.coefficients[j]));
      if (!intersect(total, s.range)) return null;
      for (let j = 0; j < box.length; ++j) {
        const coefficient = s.coefficients[j];
        if (coefficient === 0) continue;
        let other: Interval = [0, 0];
        for (let k = 0; k < box.length; ++k) if (k !== j && s.coefficients[k]) other = plus(other, scale(box[k], s.coefficients[k]));
        const candidate = intersect(box[j], divide(minus(s.range, other), coefficient));
        if (!candidate) return null;
        changed ||= candidate[0] !== box[j][0] || candidate[1] !== box[j][1];
        box[j] = candidate;
      }
    }
    if (!changed) break;
  }
  return box;
}
