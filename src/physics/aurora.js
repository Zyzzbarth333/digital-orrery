// src/physics/aurora.js
//
// Where the auroras are (docs/physics/magnetic-fields.md#auroras):
//
//   Earth     the Feldstein-Starkov oval: Starkov 1994's boundaries of the
//             auroral oval and of the diffuse aurora, in corrected
//             geomagnetic (CGM) latitude against magnetic local time, driven
//             by the planetary Kp index (CelesTrak, public/data/kp.json)
//             through Starkov's AL(Kp), as Sigernes et al. 2011 give them;
//             carried to geographic positions through IGRF-14 by the CGM
//             definition.
//   Jupiter   the main emission, at the footprints of field lines from 20 to
//             30 R_J in the magnetic equator (Clarke et al. 2004), and Io's
//             footprint, both through JRM33 + con2020.
//   Saturn    the main oval at 14 to 16 deg colatitude from the southern pole
//             (Badman et al. 2006's medians), and its conjugate in the north
//             along Cassini 11's field lines.
//   Uranus,   the auroral zones at the footprints of field lines from 3 to 20
//   Neptune   planet radii in the magnetic equator, where JWST found
//             Neptune's (Melin et al. 2025); Uranus's drawn the same way.
//
// Starkov's model (Sigernes et al. 2011, eqs. 1-3, Table 1):
//
//   AL = 18 - 12.3 Kp + 27.2 Kp^2 - 2 Kp^3                     nT
//   A_i, alpha_i = b0 + b1 x + b2 x^2 + b3 x^3,   x = log10 |AL|
//   theta(t) = A0 + A1 cos[15(t + a1)] + A2 cos[15(2t + a2)] + A3 cos[15(3t + a3)]
//
// with theta the CGM colatitude (deg), t the magnetic local time (h) and
// the cosines' arguments in degrees.

import { footprint, traceLine } from './magnetic.js';

const DEG = Math.PI / 180;

// Table 1 of Sigernes et al. 2011 (from Starkov 1994): rows b0..b3, columns
// A0 A1 A2 A3 alpha1 alpha2 alpha3.
export const STARKOV = {
  poleward: [
    [-0.07, -10.06, -4.44, -3.77, -6.61, 6.37, -4.48],
    [24.54, 19.83, 7.47, 7.90, 10.17, -1.10, 10.16],
    [-12.53, -9.33, -3.01, -4.73, -5.80, 0.34, -5.87],
    [2.15, 1.24, 0.25, 0.91, 1.19, -0.38, 0.98],
  ],
  equatorward: [
    [1.61, -9.59, -12.07, -6.56, -2.22, -23.98, -20.07],
    [23.21, 17.78, 17.49, 11.44, 1.50, 42.79, 36.67],
    [-10.97, -7.20, -7.96, -6.73, -0.58, -26.96, -24.20],
    [2.03, 0.96, 1.15, 1.31, 0.08, 5.56, 5.11],
  ],
  diffuse: [
    [3.44, -2.41, -0.74, -2.12, -1.68, 8.69, 8.61],
    [29.77, 7.89, 3.94, 3.24, -2.48, -20.73, -5.34],
    [-16.38, -4.32, -3.09, -1.67, 1.58, 13.03, -1.36],
    [3.35, 0.87, 0.72, 0.31, -0.28, -2.14, 0.76],
  ],
};

export const alFromKp = (kp) => 18 - 12.3 * kp + 27.2 * kp * kp - 2 * kp ** 3;

// The coefficients A0..A3, alpha1..alpha3 of one boundary at a Kp.
export function starkovCoefficients(which, kp) {
  const x = Math.log10(Math.abs(alFromKp(kp))), b = STARKOV[which];
  return b[0].map((_, j) => b[0][j] + b[1][j] * x + b[2][j] * x * x + b[3][j] * x ** 3);
}

// A boundary's CGM latitude (deg) at magnetic local time mlt (h).
export function ovalLatitude(which, kp, mlt, coeffs = starkovCoefficients(which, kp)) {
  const [A0, A1, A2, A3, a1, a2, a3] = coeffs;
  const theta = A0 + A1 * Math.cos(15 * (mlt + a1) * DEG) + A2 * Math.cos(15 * (2 * mlt + a2) * DEG) + A3 * Math.cos(15 * (3 * mlt + a3) * DEG);
  return 90 - theta;
}

// ---- Kp by date ----

let kpTable = null;
export function installKp(json) {
  kpTable = { start: Date.parse(`${json.start}T00:00:00Z`), kp: json.kp, lastObserved: json.lastObserved ? Date.parse(`${json.lastObserved}T00:00:00Z`) + 864e5 : -Infinity };
}
export const kpInstalled = () => kpTable !== null;
// Quiet-to-moderate activity, for dates the table does not reach.
export const KP_DEFAULT = 2;

// The Kp of the three-hour interval holding ms (UTC):
// { kp, source: 'observed' | 'predicted' | 'assumed' }.
export function kpAt(ms) {
  if (kpTable) {
    const i = Math.floor((ms - kpTable.start) / (3 * 3600e3));
    const c = i >= 0 && i < kpTable.kp.length ? kpTable.kp[i] : '~';
    if (c !== '~') return { kp: (c.charCodeAt(0) - 48) / 3, source: ms < kpTable.lastObserved ? 'observed' : 'predicted' };
  }
  return { kp: KP_DEFAULT, source: 'assumed' };
}

// Kp as written: 3-, 3o, 3+.
export function kpLabel(kp) {
  const t = Math.round(kp * 3), n = Math.round(t / 3), r = t - 3 * n;
  return `${n}${r < 0 ? '−' : r > 0 ? '+' : 'o'}`;
}

// ---- corrected geomagnetic coordinates ----
//
// CGM (Gustafsson et al. 1992): follow the IGRF field line from a point to
// the centred dipole's equator, then back down the dipole's own field line
// to the ground; the dipole latitude and longitude there are the point's
// CGM coordinates. Here the other way round, for drawing: a CGM latitude
// lambda puts the dipole line's equator crossing at r = a / cos^2 lambda,
// and the IGRF line from there reaches the ground at the geographic point.
//
// The centred dipole's frame (from IGRF's degree 1): n toward the
// geomagnetic north pole (against the moment), and e1, e2 across it with
// e1 in the meridian of the geographic pole on the far side from n, so
// longitude 0 is the CGM meridian through the geographic south pole
// (Fraser-Smith 1987's convention for geomagnetic longitude).
export function cgmFrame(model) {
  const m = model.dipole.m, M = Math.hypot(...m), n = [-m[0] / M, -m[1] / M, -m[2] / M];
  // The geographic north pole projected across the dipole axis, reversed.
  const z = [0, 0, 1], d = n[2];
  let e1 = [-(z[0] - d * n[0]), -(z[1] - d * n[1]), -(z[2] - d * n[2])];
  const l = Math.hypot(...e1); e1 = e1.map((v) => v / l);
  const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  return { n, e1, e2 };
}

// A CGM latitude (deg, signed: south negative) and longitude (deg) to an
// Earth-fixed point on the sphere of radius a (units of a), or null where
// the field line does not come down (it can't for lambda under ~15 deg).
export function cgmToGeo(model, frame, latDeg, lonDeg) {
  const rEq = 1 / Math.cos(latDeg * DEG) ** 2, ph = lonDeg * DEG;
  const p = [0, 1, 2].map((i) => rEq * (Math.cos(ph) * frame.e1[i] + Math.sin(ph) * frame.e2[i]));
  const want = Math.sign(latDeg);
  for (const sign of [1, -1]) {
    const q = footprint(model, p, sign, { eq: 1, pol: 1 }, { rMax: rEq * 2 + 5, maxSteps: 6000 });
    if (q && want * (q[0] * frame.n[0] + q[1] * frame.n[1] + q[2] * frame.n[2]) > 0) return q;
  }
  return null;
}

// The CGM longitude of a direction (Earth-fixed unit vector), as of the
// centred dipole (for the Sun's direction, which sets magnetic local time).
export function dipoleLongitude(frame, v) {
  const x = v[0] * frame.e1[0] + v[1] * frame.e1[1] + v[2] * frame.e1[2];
  const y = v[0] * frame.e2[0] + v[1] * frame.e2[1] + v[2] * frame.e2[2];
  return Math.atan2(y, x) / DEG;
}

// Magnetic local time (h) at a CGM longitude, with the Sun at sunLon.
export const mlt = (lonDeg, sunLonDeg) => ((((12 + (lonDeg - sunLonDeg) / 15) % 24) + 24) % 24);

// A grid of CGM -> geographic points, lat lat0..lat1 by dLat, all longitudes
// by dLon, both hemispheres, worked out a few milliseconds at a time
// (step(ms) returns true when it is done) so the drawing never stalls on it.
export function cgmGrid(model, { lat0 = 50, lat1 = 82, dLat = 2, dLon = 10 } = {}) {
  const frame = cgmFrame(model), lats = [], lons = [];
  for (let l = lat0; l <= lat1 + 1e-9; l += dLat) lats.push(l);
  for (let l = 0; l < 360; l += dLon) lons.push(l);
  const pts = { 1: lats.map(() => new Array(lons.length)), [-1]: lats.map(() => new Array(lons.length)) };
  const jobs = [];
  for (const h of [1, -1]) lats.forEach((_, i) => lons.forEach((_, j) => jobs.push([h, i, j])));
  let next = 0;
  const grid = {
    frame, lats, lons, pts, done: false,
    step(ms = Infinity) {
      const t0 = performance.now();
      while (next < jobs.length && performance.now() - t0 < ms) {
        const [h, i, j] = jobs[next++];
        pts[h][i][j] = cgmToGeo(model, frame, h * lats[i], lons[j]) ?? centredDipolePoint(frame, h * lats[i], lons[j]);
      }
      grid.done = next >= jobs.length;
      return grid.done;
    },
    // Bilinear in latitude and longitude, renormalised to the sphere.
    at(h, latDeg, lonDeg) {
      const fi = Math.min(Math.max((latDeg - lats[0]) / dLat, 0), lats.length - 1.000001), i = Math.floor(fi), u = fi - i;
      const fl = ((((lonDeg - lons[0]) / dLon) % lons.length) + lons.length) % lons.length, j = Math.floor(fl), v = fl - j, j1 = (j + 1) % lons.length;
      const P = pts[h], o = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        o[c] = (1 - u) * ((1 - v) * P[i][j][c] + v * P[i][j1][c]) + u * ((1 - v) * P[i + 1][j][c] + v * P[i + 1][j1][c]);
      }
      const n = Math.hypot(...o);
      return [o[0] / n, o[1] / n, o[2] / n];
    },
  };
  return grid;
}

// Where the centred dipole alone would put a CGM point (its definition's
// limit far from the Earth, and the fallback where a trace fails).
export function centredDipolePoint(frame, latDeg, lonDeg) {
  const cl = Math.cos(latDeg * DEG), sl = Math.sin(latDeg * DEG), c = Math.cos(lonDeg * DEG), s = Math.sin(lonDeg * DEG);
  return [0, 1, 2].map((i) => cl * (c * frame.e1[i] + s * frame.e2[i]) + sl * frame.n[i]);
}

// ---- Jupiter and Saturn ----

// Clarke et al. 2004: the main emission maps to ~20-30 R_J in the equator.
export const JUPITER_MAIN = { r: [20, 30] };
// Badman et al. 2006: median poleward and equatorward boundaries of the
// southern oval at ~14 and ~16 deg colatitude.
export const SATURN_MAIN = { colat: [14, 16] };
export const IO_ORBIT_RJ = 5.9;
// Feldman et al. 2000 (HST/STIS): Ganymede's oxygen aurora is confined to
// latitudes above +-40 deg, along the boundary of its open field lines; the
// ovals are drawn from 40 to 48 deg in each hemisphere.
export const GANYMEDE_OVAL = { lat: [40, 48] };
// Melin et al. 2025: Neptune's southern H3+ aurora maps to L from under 3
// to 20 R_N (the northern to 3-5).
export const ICE_GIANT_AURORA = { L: [3, 20] };

// Footprints of field lines from points in the magnetic equator at radius
// r (units of a) from the dipole's centre, every dLon deg of magnetic
// longitude, in both hemispheres: { north: [[x, y, z] | null, ...], south: [...] }.
export function equatorFootprints(model, r, dLon, surface, frame) {
  const out = { north: [], south: [] }, c = model.dipole.centre ?? [0, 0, 0];
  for (let lon = 0; lon < 360; lon += dLon) {
    const ph = lon * DEG, p = [0, 1, 2].map((i) => c[i] + r * (Math.cos(ph) * frame.e1[i] + Math.sin(ph) * frame.e2[i]));
    const a = footprint(model, p, 1, surface, { rMax: r * 3 }), b = footprint(model, p, -1, surface, { rMax: r * 3 });
    // North and south of the magnetic equator, along the dipole axis.
    const up = (q) => q && (q[0] - c[0]) * frame.u[0] + (q[1] - c[1]) * frame.u[1] + (q[2] - c[2]) * frame.u[2] > 0 === frame.u[2] > 0;
    out.north.push(up(a) ? a : up(b) ? b : null);
    out.south.push(a && !up(a) ? a : b && !up(b) ? b : null);
  }
  return out;
}

// The magnetic equator's frame for a planet: across the dipole axis.
export function magneticEquatorFrame(model) {
  const m = model.dipole.m, M = Math.hypot(...m), u = [m[0] / M, m[1] / M, m[2] / M];
  const ref = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  let e1 = [ref[1] * u[2] - ref[2] * u[1], ref[2] * u[0] - ref[0] * u[2], ref[0] * u[1] - ref[1] * u[0]];
  const l = Math.hypot(...e1); e1 = e1.map((v) => v / l);
  const e2 = [u[1] * e1[2] - u[2] * e1[1], u[2] * e1[0] - u[0] * e1[2], u[0] * e1[1] - u[1] * e1[0]];
  return { u, e1, e2 };
}

// ---- moons' auroral footprints ----
//
// Io, Europa and Ganymede each leave a spot on Jupiter where their field
// lines meet it, Enceladus one on Saturn (Pryor et al. 2011). The spot sits
// downstream of the moon's instantaneous footprint by the equatorial lead
// angle delta, the travel time of the Alfven wave the moon launches: Hue et
// al. 2023 fitted it from Juno-UVS, against lambda the moon's System III
// west longitude (deg),
//   delta = a0 + a1 cos(w lambda) + b1 sin(w lambda) + a2 cos(2 w lambda) + b2 sin(2 w lambda)
// (their Table 1, [a0, a1, b1, a2, b2, w]). Downstream is toward smaller west
// longitude: the plasma corotates past the slower moon.
export const LEAD_ANGLE = {
  io: { north: [4.26, 2.64, 0.50, 0.20, 0.126, 1], south: [4.14, -1.89, -0.70, 0.22, -0.12, 1] },
  europa: { north: [5.78, 3.29, 1.41, 0, 0, 0.99], south: [7.06, -3.37, 0.15, 0, 0, 1] },
  ganymede: { north: [12.45, 6.16, 3.64, 0, 0, 0.98], south: [12.97, -5.39, -4.50, 0, 0, 0.99] },
};
export function leadAngle(moon, hemisphere, westLonDeg) {
  const c = LEAD_ANGLE[moon]?.[hemisphere];
  if (!c) return 0;
  const [a0, a1, b1, a2, b2, w] = c, x = w * westLonDeg * DEG;
  return a0 + a1 * Math.cos(x) + b1 * Math.sin(x) + a2 * Math.cos(2 * x) + b2 * Math.sin(2 * x);
}
// The moons whose footprints are drawn, and their orbits' radii (planet radii):
// Io, Europa and Ganymede as JRM33's footprint tables take them, Enceladus's
// 238,000 km over Saturn's 60,268.
export const FOOTPRINT_MOONS = {
  io: { planet: 'jupiter', r: 5.9 }, europa: { planet: 'jupiter', r: 9.4 }, ganymede: { planet: 'jupiter', r: 15.0 },
  enceladus: { planet: 'saturn', r: 3.95 },
};

// Io's footprints, north and south, for Io at System III east longitude
// lonDeg in Jupiter's equator: the field line through Io traced down.
export function ioFootprint(model, lonDeg, surface, r = IO_ORBIT_RJ) {
  const p = [r * Math.cos(lonDeg * DEG), r * Math.sin(lonDeg * DEG), 0];
  const a = footprint(model, p, 1, surface), b = footprint(model, p, -1, surface);
  const up = (q) => q && q[2] > 0;
  return { north: up(a) ? a : up(b) ? b : null, south: a && !up(a) ? a : b && !up(b) ? b : null };
}

// Saturn's oval: points at colatitude colat (deg) from the southern
// rotational pole (Cassini 11 is axisymmetric), and their conjugates in the
// north along the field.
export function saturnOval(model, colat, dLon, surface) {
  const south = [], north = [];
  for (let lon = 0; lon < 360; lon += dLon) {
    const lat = -(90 - colat) * DEG, c = Math.cos(lat), s = Math.sin(lat);
    const r = 1 / Math.sqrt(c * c / (surface.eq * surface.eq) + s * s / (surface.pol * surface.pol));
    const p = [r * c * Math.cos(lon * DEG), r * c * Math.sin(lon * DEG), r * s];
    south.push(p);
    // Lift it off the surface a little so the trace starts outside.
    const q = p.map((v) => v * 1.001);
    const t = traceLine(model, q, surface, { maxSteps: 4000 });
    const ends = [t.points.slice(0, 3), t.points.slice(-3)];
    north.push(t.closed ? ends.find((e) => e[2] > 0) ?? null : null);
  }
  return { north, south };
}

// Any moon's magnetic footprints, for the moon at east longitude lonDeg in
// its planet's equator, r planet radii out.
export const moonFootprint = (model, lonDeg, surface, r) => ioFootprint(model, lonDeg, surface, r);
