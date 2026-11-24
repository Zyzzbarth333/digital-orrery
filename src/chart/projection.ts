// src/chart/projection.ts
//
// The chart's two projections (docs/frontend/chart.md#projections), on the
// sphere, as the shader (chartMaterial.ts) draws them and the overlay
// (overlay.ts) marks them:
//
// - simple cylindrical (equirectangular): x = s (lon - lon0), y = s (lat - lat0),
//   the layout every map is stored in, so the chart is the map itself;
// - polar stereographic about either pole, true to scale at the pole:
//   rho = 2 tan(c / 2) for the angle c from the pole, with longitude lon0 down
//   the page from the north pole and up it from the south (as USGS's polar
//   sheets have 0 deg; east is then anticlockwise round the north pole and
//   clockwise round the south, as seen from outside).
//
// A view is a scale s (CSS px per radian on the sphere, at the reference
// latitude of equirectangular or at the pole) and the point at the
// viewport's centre: lon0, lat0 for equirectangular; for a polar view, the
// pole's offset (px) from the centre. Screen y runs down.

export type Proj = 'eq' | 'n' | 's';
export interface View { proj: Proj; lon0: number; lat0: number; px: number; py: number; scale: number; w: number; h: number }

const D = Math.PI / 180;
export const wrapPi = (x: number): number => x - 2 * Math.PI * Math.floor((x + Math.PI) / (2 * Math.PI));

// Screen position (CSS px from the viewport's top left) of lat, lon (rad).
// Equirectangular gives the copy nearest the centre, then `k` whole turns over.
export function forward(v: View, lat: number, lon: number, k = 0): [number, number] {
  if (v.proj === 'eq') {
    const dl = wrapPi(lon - v.lon0) + 2 * Math.PI * k;
    return [v.w / 2 + v.scale * dl, v.h / 2 - v.scale * (lat - v.lat0)];
  }
  const c = v.proj === 'n' ? Math.PI / 2 - lat : Math.PI / 2 + lat;
  const rho = 2 * Math.tan(c / 2) * v.scale, a = lon - v.lon0;
  const x = v.w / 2 + v.px + rho * Math.sin(a);
  // North: lon0 below the pole (screen y down); south: above it.
  return [x, v.h / 2 + v.py + (v.proj === 'n' ? rho : -rho) * Math.cos(a)];
}

// lat, lon (rad) under a screen position, or null off the sphere's chart.
export function inverse(v: View, x: number, y: number): [number, number] | null {
  if (v.proj === 'eq') {
    const lat = v.lat0 - (y - v.h / 2) / v.scale;
    if (Math.abs(lat) > Math.PI / 2) return null;
    return [lat, wrapPi(v.lon0 + (x - v.w / 2) / v.scale)];
  }
  const X = (x - v.w / 2 - v.px) / v.scale, Y = (y - v.h / 2 - v.py) / v.scale;   // Y down
  const rho = Math.hypot(X, Y), c = 2 * Math.atan(rho / 2);
  if (c > Math.PI) return null;
  if (v.proj === 'n') return [Math.PI / 2 - c, wrapPi(v.lon0 + Math.atan2(X, Y))];
  return [c - Math.PI / 2, wrapPi(v.lon0 + Math.atan2(X, -Y))];
}

// Ground distance per CSS px (km), at a latitude along a parallel for
// equirectangular, or along a meridian (stereographic is conformal) at the
// angle c from the pole for a polar view.
export function kmPerPx(v: View, radiusKm: number, lat: number): number {
  if (v.proj === 'eq') return radiusKm / v.scale;    // along a meridian; a parallel is cos(lat) of it
  const c = v.proj === 'n' ? Math.PI / 2 - lat : Math.PI / 2 + lat;
  // d(rho)/dc = sec^2(c / 2): the map scale grows away from the pole.
  return radiusKm / (v.scale / Math.cos(c / 2) ** 2);
}

export const deg = (r: number): number => r / D;
export const rad = (d: number): number => d * D;
