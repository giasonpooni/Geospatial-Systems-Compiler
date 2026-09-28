import { describe, it, expect } from 'vitest';
import { mapDisplayGeometry, unwrapPath } from './mapGeometry';
import { GsvInvestigation } from './session';
describe('dateline display chart does not rewrite geographic evidence', () => {
  it('crosses the dateline locally in both directions without adding samples', () => {
    expect(unwrapPath([[170, 5], [-175, 8], [-160, 9]])).toEqual([[170, 5], [185, 8], [200, 9]]);
    expect(unwrapPath([[-170, 5], [175, 8]])).toEqual([[-170, 5], [-185, 8]]);
  });
  it('preserves all original ordinates modulo whole turns and leaves input detached', () => {
    const source = { type: 'LineString' as const, coordinates: [[179, 4, 7], [-179, 6, 9]] };
    const copy = structuredClone(source), display = mapDisplayGeometry(source);
    expect(source).toEqual(copy); expect(display.coordinates[1]).toEqual([181, 6, 9]);
    display.coordinates[0][1] = 99; expect(source).toEqual(copy);
  });
  it('keeps a dateline polygon and its holes in the same continuous chart', () => {
    const display = mapDisplayGeometry({ type: 'Polygon', coordinates: [
      [[170, 0], [-170, 0], [-170, 20], [170, 20], [170, 0]],
      [[-175, 5], [-175, 10], [-172, 10], [-172, 5], [-175, 5]],
    ] });
    expect(display.coordinates[0][1]).toEqual([190, 0]);
    expect(display.coordinates[1][0]).toEqual([185, 5]);
    expect(display.coordinates[0].at(-1)).toEqual(display.coordinates[0][0]);
  });
  it('does not invent a cap for an explicitly closed polar winding', () => {
    const source = { type: 'Polygon' as const, coordinates: [[[-180, -80], [-60, -80], [60, -80], [180, -80], [-180, -80]]] };
    expect(mapDisplayGeometry(source)).toEqual(source);
  });
  it('all original GSV routes render with no longitudinal edge greater than 180 degrees', async () => {
    const s = await GsvInvestigation.load(), before = JSON.stringify(s.frame().map);
    for (const f of s.frame().map.features) if (f.geometry.type === 'LineString') {
      const g = mapDisplayGeometry({ type: 'LineString', coordinates: f.geometry.coordinates.map((p) => [...p]) });
      for (let i = 1; i < g.coordinates.length; i++) expect(Math.abs(g.coordinates[i][0] - g.coordinates[i-1][0])).toBeLessThanOrEqual(180);
    }
    expect(JSON.stringify(s.frame().map)).toBe(before);
  });
});
