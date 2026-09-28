/** Longitude unwrapping for a continuous MapLibre display chart, not a CRS conversion. */
import type { Geometry, Position } from 'geojson';

/** Preserve every latitude/extra ordinate; change longitude only by full turns. */
export function unwrapPath(path: readonly (readonly number[])[]): Position[] {
  let previous: number | undefined;
  return path.map((position) => {
    if (position.length < 2 || !position.every(Number.isFinite) || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) throw new Error('Invalid display position');
    const copy = [...position];
    if (previous !== undefined) {
      // Exactly antipodal longitudes retain the source direction, rather than selecting a new one.
      const delta = copy[0] - previous;
      if (delta > 180) copy[0] -= Math.ceil((delta - 180) / 360) * 360;
      else if (delta < -180) copy[0] += Math.ceil((-delta - 180) / 360) * 360;
    }
    previous = copy[0];
    return copy;
  });
}
function polygon(rings: Position[][]): Position[][] {
  const exterior = unwrapPath(rings[0] ?? []);
  // Polar rings wind through a full turn; retain the source's explicitly closed polar chart.
  // Local unwrapping cannot choose a new cap boundary on the caller's behalf.
  if (exterior.length && exterior[0][0] !== exterior[exterior.length - 1][0])
    return rings.map((r) => r.map((p) => [...p]));
  const anchor = exterior.length ? exterior.reduce((sum, p) => sum + p[0], 0) / exterior.length : 0;
  return [exterior, ...rings.slice(1).map((ring) => {
    const out = unwrapPath(ring);
    const center = out.length ? out.reduce((sum, p) => sum + p[0], 0) / out.length : anchor;
    const shift = Math.round((anchor - center) / 360) * 360;
    return out.map((p) => [p[0] + shift, ...p.slice(1)]);
  })];
}
/** Renderer-only chart: longitudes can exceed +/-180; source IR remains untouched. */
export function mapDisplayGeometry<G extends Geometry>(geometry: G): G {
  switch (geometry.type) {
    case 'Point': return { ...geometry, coordinates: [...geometry.coordinates] };
    case 'MultiPoint': return { ...geometry, coordinates: geometry.coordinates.map((p) => [...p]) };
    case 'LineString': return { ...geometry, coordinates: unwrapPath(geometry.coordinates) };
    case 'MultiLineString': return { ...geometry, coordinates: geometry.coordinates.map(unwrapPath) };
    case 'Polygon': return { ...geometry, coordinates: polygon(geometry.coordinates) };
    case 'MultiPolygon': return { ...geometry, coordinates: geometry.coordinates.map(polygon) };
    case 'GeometryCollection': return { ...geometry, geometries: geometry.geometries.map(mapDisplayGeometry) };
  }
}
