// packages/physics/src/belts.js
//
// Radiation belts (docs/physics/magnetic-fields.md#radiation-belts): where
// each planet traps energetic particles, as bands of L-shells, the
// surfaces swept out by the field lines that cross the magnetic equator L
// planet radii from the dipole's centre. Each band is drawn as a few
// shells traced through the planet's own field (magnetic.js), so the
// belts tilt and shift with it.
//
//   Earth    inner belt L 1.2-2 ("L <~ 2"), the slot L 2-3, outer belt
//            L 3-6.6 ("L >~ 3"), its heart near L 4.6, still strong at
//            geosynchronous orbit, L 6.6 (Reeves and Daglis 2016);
//   Jupiter  stable trapping from 1.2 R_J; MeV electrons peak near L 3 and
//            fall by about ten at L 6 (Roussos and Kollmann 2020);
//   Saturn   the electron belt outside the A ring, L 2.27-7, peaking near
//            2.5; and the innermost belt between the planet and the D ring,
//            L 1.03-1.22 (the same review; Roussos et al. 2018);
//   Uranus   Voyager 2's electrons, most intense at its closest L, 4.67,
//            swept by Miranda, Ariel and Umbriel out to Umbriel's L, 10.4
//            (Cooper and Stone 1991); inside 4.67 was not sampled;
//   Neptune  energetic particles from the planet out to Triton's L-shell,
//            14.4, which bounds them (Mauk et al. 1991); where they peak
//            within is not drawn from data (the bump is centred).
// Mercury's and Ganymede's fields are too small to hold stable belts.
//
//   BELTS[key] -> [{ name, L: [inner, outer], peak }]
//   beltWeight(belt, L) -> 0..1, a smooth bump from the edges to the peak
//   traceShell(model, L, nLon, surface, opts) -> lines along one L-shell

import { traceLine, dipoleFrame } from './magnetic.js';

const DEG = Math.PI / 180;

export const BELTS = {
  earth: [
    { name: 'inner belt', L: [1.2, 2], peak: 1.5 },
    { name: 'outer belt', L: [3, 6.6], peak: 4.6 },
  ],
  jupiter: [
    { name: 'radiation belts', L: [1.2, 6], peak: 3 },
  ],
  saturn: [
    { name: 'innermost belt', L: [1.03, 1.22], peak: 1.12 },
    { name: 'electron belt', L: [2.27, 7], peak: 2.5 },
  ],
  uranus: [
    { name: 'electron belts', L: [4.5, 10.4], peak: 4.7 },
  ],
  neptune: [
    { name: 'radiation belts', L: [1.2, 14.4], peak: 7.8 },
  ],
};

// A smooth bump: 0 at the band's edges, 1 at its peak.
export function beltWeight(belt, L) {
  const [a, b] = belt.L, p = belt.peak;
  if (L <= a || L >= b) return 0;
  const u = L < p ? (L - a) / (p - a) : (b - L) / (b - p);
  return Math.sin((Math.PI / 2) * u) ** 2;
}

// The field lines of one L-shell: from points in the magnetic equator at
// L (units of a) from the dipole's centre, nLon of them around, each traced
// both ways to the surface (or to rMax). Returns
// [{ lon, points: Float64Array, strength: Float64Array }].
export function traceShell(model, L, nLon, surface, { rMax = Math.max(L * 3, model.rMax), maxSteps = 3000 } = {}) {
  const { e1, e2 } = dipoleFrame(model), c = model.dipole.centre;
  const lines = [];
  for (let j = 0; j < nLon; j++) {
    const ph = (2 * Math.PI * j) / nLon;
    const p = [0, 1, 2].map((i) => c[i] + L * (Math.cos(ph) * e1[i] + Math.sin(ph) * e2[i]));
    const t = traceLine(model, p, surface, { rMax, maxSteps });
    lines.push({ lon: ph / DEG, points: t.points, strength: t.strength });
  }
  return lines;
}

// One line resampled to n points evenly along its length, and each point's
// magnetic latitude (deg) from the dipole's centre, for drawing a shell as
// a grid.
export function resample(points, n, model) {
  const m = points.length / 3, cum = new Float64Array(m);
  for (let i = 1; i < m; i++) {
    cum[i] = cum[i - 1] + Math.hypot(points[3 * i] - points[3 * i - 3], points[3 * i + 1] - points[3 * i - 2], points[3 * i + 2] - points[3 * i - 1]);
  }
  const out = new Float64Array(3 * n), lat = new Float64Array(n);
  const { u } = dipoleFrame(model), c = model.dipole.centre;
  let k = 0;
  for (let s = 0; s < n; s++) {
    const want = (cum[m - 1] * s) / (n - 1);
    while (k < m - 2 && cum[k + 1] < want) k++;
    const f = cum[k + 1] > cum[k] ? (want - cum[k]) / (cum[k + 1] - cum[k]) : 0;
    for (let i = 0; i < 3; i++) out[3 * s + i] = points[3 * k + i] + f * (points[3 * k + 3 + i] - points[3 * k + i]);
    const d = [0, 1, 2].map((i) => out[3 * s + i] - c[i]), r = Math.hypot(...d);
    lat[s] = Math.asin((d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) / r) / DEG;
  }
  return { points: out, lat };
}
