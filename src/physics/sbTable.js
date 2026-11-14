// src/physics/sbTable.js
//
// The largest asteroids' exact positions: Chebyshev series fitted to JPL's
// SB441 asteroid ephemerides by c/sb_cheb.c (public/ephemeris/
// sb441-asteroids-2000-2050.bin, 0.35 MB): the sixteen most massive
// asteroids (asteroids.js), the perturbers JPL's small-body integrations use
// with DE441, and the other bodies the app names
// that sb441-n373s.bsp covers (Lutetia, Eros, and Eris, Haumea, Makemake and
// four more trans-Neptunian objects). J2000 equatorial km against TDB
// seconds past J2000. Each asteroid is stored relative to the solar-system
// barycentre, with one series of the Sun relative to it: heliocentric, every
// series would have to follow the Sun's own wobble (hundreds of km over
// months) and be twice as long. Each series interpolates the SPK at the
// Chebyshev-Lobatto points of its intervals (so neighbouring intervals meet
// in position); the difference, asteroid less Sun, is within 0.94 km of
// SB441's heliocentric position from 2000 to 2050. SB441 is the asteroids'
// own integration with DE441's planets and the largest asteroids' pull
// (Farnocchia 2021, JPL IOM 392R-21-005), so these positions carry
// everything the two-body ellipses in smallBodies.js leave out.
//
// Outside the table's span (2000 to 2050) a body moves on the two-body
// orbit through its state at the nearer end, so the kernel and the labels
// still have it, drifting as the ellipses do.
//
// Installed with the DE442 table (deLoad.js in the browser, deNode.js under
// Node); until then sbHelioState returns null.

import { MU_SUN_KM } from './asteroids.js';

let table = null;

// The file (c/sb_cheb.c): Float64, [0] format (1), [1] number of series,
// then per series its NAIF id (10 the Sun, 2000000 + number an asteroid),
// t0, interval length (s), intervals and coefficients, then the
// coefficients (per series, per interval: x, y, z). The Sun's comes first;
// all are relative to the barycentre.
export function parseSbTable(buffer) {
  const f = new Float64Array(buffer);
  if (f[0] !== 1) throw new Error(`sbTable: unknown format ${f[0]}`);
  const nb = f[1];
  const bodies = new Map();
  let sun = null, off = 2 + 5 * nb;
  for (let k = 0; k < nb; k++) {
    const [id, t0, len, n, nc] = f.subarray(2 + 5 * k, 7 + 5 * k);
    const s = { id, t0, len, n, nc, c: f.subarray(off, off + n * 3 * nc), ends: null };
    if (id === 10) sun = s; else bodies.set(id, s);
    off += n * 3 * nc;
  }
  if (off !== f.length) throw new Error('sbTable: size does not match its header');
  if (!sun) throw new Error('sbTable: no series for the Sun');
  return { sun, bodies };
}

export function installSbTable(parsed) { table = parsed; }
export function sbTableInstalled() { return table !== null; }
// The NAIF ids of the asteroids the table holds (2000000 + the number).
export function sbIds() { return table ? [...table.bodies.keys()] : []; }
export function sbCovers(id) { return table !== null && table.bodies.has(id); }
// The span covered, TDB seconds past J2000, for asteroid id.
export function sbSpan(id) {
  const s = table?.bodies.get(id);
  if (!s) return null;
  const S = table.sun;
  return [Math.max(s.t0, S.t0), Math.min(s.t0 + s.n * s.len, S.t0 + S.n * S.len)];
}

const T = new Float64Array(32), U = new Float64Array(32);
const rS = [0, 0, 0], vS = [0, 0, 0];

// Position (km) and velocity (km/s) of series s at TDB et inside its span.
function evaluate(s, et, r, v) {
  let i = Math.floor((et - s.t0) / s.len);
  if (i >= s.n) i = s.n - 1;
  if (i < 0) i = 0;
  const x = 2 * (et - (s.t0 + i * s.len)) / s.len - 1, nc = s.nc;
  T[0] = 1; T[1] = x; U[0] = 1; U[1] = 2 * x;
  for (let j = 2; j < nc; j++) { T[j] = 2 * x * T[j - 1] - T[j - 2]; U[j] = 2 * x * U[j - 1] - U[j - 2]; }
  const base = i * 3 * nc, dxdt = 2 / s.len;
  for (let d = 0; d < 3; d++) {
    const o = base + d * nc;
    let p = 0, q = 0;
    for (let j = 0; j < nc; j++) p += s.c[o + j] * T[j];
    for (let j = 1; j < nc; j++) q += s.c[o + j] * j * U[j - 1];
    r[d] = p; v[d] = q * dxdt;
  }
}

// Two-body motion about the Sun from (r0, v0) over dt seconds (universal
// variables; the asteroids' orbits are all ellipses).
export function kepler(r0, v0, dt, mu = MU_SUN_KM) {
  const r0n = Math.hypot(...r0), v2 = v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2;
  const a = 1 / (2 / r0n - v2 / mu), n = Math.sqrt(mu / a ** 3);
  const sig = (r0[0] * v0[0] + r0[1] * v0[1] + r0[2] * v0[2]) / Math.sqrt(mu * a), ecosE = 1 - r0n / a;
  // Kepler's equation for the change in eccentric anomaly, dE.
  const M = n * dt;
  let dE = M;
  for (let k = 0; k < 50; k++) {
    const f = dE - ecosE * Math.sin(dE) + sig * (1 - Math.cos(dE)) - M;
    const fp = 1 - ecosE * Math.cos(dE) + sig * Math.sin(dE);
    const step = f / fp;
    dE -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  const rn = a * (1 - ecosE * Math.cos(dE) + sig * Math.sin(dE));
  const F = 1 - a / r0n * (1 - Math.cos(dE)), G = dt - (dE - Math.sin(dE)) / n;
  const Fd = -Math.sqrt(mu * a) / (rn * r0n) * Math.sin(dE), Gd = 1 - a / rn * (1 - Math.cos(dE));
  return {
    r: [F * r0[0] + G * v0[0], F * r0[1] + G * v0[1], F * r0[2] + G * v0[2]],
    v: [Fd * r0[0] + Gd * v0[0], Fd * r0[1] + Gd * v0[1], Fd * r0[2] + Gd * v0[2]],
  };
}

// Heliocentric J2000 equatorial state { r (km), v (km/s), exact } of
// asteroid id (NAIF, 2000000 + its number) at TDB et (s past J2000): from
// the table inside its span (exact: true), two-body from the nearer end
// outside it, or null when the table is not installed or lacks the body.
function helio(s, et) {
  const r = [0, 0, 0], v = [0, 0, 0];
  evaluate(s, et, r, v);
  evaluate(table.sun, et, rS, vS);
  for (let d = 0; d < 3; d++) { r[d] -= rS[d]; v[d] -= vS[d]; }
  return { r, v };
}

export function sbHelioState(id, et) {
  const s = table?.bodies.get(id);
  if (!s) return null;
  const [t0, t1] = sbSpan(id);
  if (et >= t0 && et <= t1) return { ...helio(s, et), exact: true };
  if (!s.ends) s.ends = [helio(s, t0), helio(s, t1)];
  const [end, te] = et < t0 ? [s.ends[0], t0] : [s.ends[1], t1];
  return { ...kepler(end.r, end.v, et - te), exact: false };
}
