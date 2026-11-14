// src/physics/moons.js
//
// The planets' moons: where each one is about its planet, for the scene
// and for the spacecraft kernel (bodies.js, which gives each of the twenty
// major moons its own pull near its planet).
//
//   moonStateEqj(key, date)      -> { r, v }  planetocentric J2000 equatorial
//                                             (EQJ = ICRF axes), km and km/s
//   planetCentreOffsetEqj(planet, date) -> [x, y, z] km: the planet's centre
//                                             minus its system barycentre
//   moonStateEqjAtTt(key, tt), systemEqjAtTt(planet, tt),
//   planetOffsetEqjAtTt(planet, tt): the same at TT seconds past J2000 (the
//                                             kernel's time; no UTC, no
//                                             millisecond rounding of a Date)
//
// From 2000 to 2049, JPL's satellite ephemerides (moonTables.js: Chebyshev
// series of mar099s, jup365, sat441, sat415, ura184, nep098 and plu060, within
// 1 km of them), wherever that system's year is installed: each moon and
// the planet's centre about the system barycentre, so the planet's offset
// is JPL's own. Elsewhere, and before a year has loaded:
//
// - Io, Europa, Ganymede and Callisto: astronomy-engine's JupiterMoons
//   (Lieske's E5 theory as truncated in L1.2), jovicentric.
// - The others: JPL's planetary satellite mean elements
//   (https://ssd.jpl.nasa.gov/sats/elem/; moons.data.js), a precessing
//   ellipse in the moon's Laplace plane (Mars, Jupiter's inner moons,
//   Saturn), its planet's equator (Uranus's regular moons, Neptune, Pluto)
//   or the J2000 ecliptic (Uranus's irregular moons):
//
//     M(t) = M0 + 360 t / P + dM + dn t     (t in days TDB from the epoch)
//     w(t) = w0 + dW + 360 t / P_apsis      (P_apsis, P_node in years)
//     node(t) = node0 + dNode -+ 360 t / P_node   (regressing; advancing
//                                            for a retrograde orbit)
//
//   The node is measured from the reference plane's ascending node on the
//   ICRF equator, at RA = pole RA + 90 deg. The table's epoch angles and
//   periods do not hold a moon's place for long (its periods are rounded:
//   Phobos's to four digits, which loses 80 deg every 5 years, and its
//   Saturn and Uranus phases are off by up to 160 deg at the epoch itself),
//   so dM, dn, dW and dNode are fitted to JPL Horizons vectors from 2000 to
//   2050 (moons.fetch.mjs). docs/frontend/moons.md has the errors.
//
//   The planet positions the scene uses for Mars to Pluto are system
//   barycentres; with the elements the planet itself is offset from that
//   by -sum(GM_i r_i) / GM_system over its moons with a measured GM, 2,100
//   km for Pluto (Charon is an eighth of the system's mass), under 300 km
//   for the others.

import * as Astronomy from 'astronomy-engine';
import { ttSeconds } from './ephemeris.js';
import { MOON_DATA } from './moons.data.js';
import { moonChunkAt, chunkState } from './moonTables.js';

const DEG = Math.PI / 180;
const AU_KM = 149597870.7;
const J2000_DAYS_TO_ASTRO = 0;          // AstroTime counts days from J2000 too

// System GMs (DE442; bodies.js has the same), for the barycentre offset.
export const SYSTEM_GM = { mars: 4.28283758157561024e4, jupiter: 1.26712764099999979e8, saturn: 3.79405848417999968e7,
  uranus: 5.79455639999999851e6, neptune: 6.83652710058039892e6, pluto: 975.5 };

const AE_PLANET = { uranus: Astronomy.Body.Uranus, neptune: Astronomy.Body.Neptune, pluto: Astronomy.Body.Pluto };
const GALILEAN = new Set(['io', 'europa', 'ganymede', 'callisto']);

export const MOON_KEYS = Object.keys(MOON_DATA);
// Every moon of each planet, out from it, and the twenty major ones, which
// the kernel gives a pull.
export const MOONS_OF = {}, MAJOR_MOONS_OF = {};
for (const k of MOON_KEYS) {
  (MOONS_OF[MOON_DATA[k].planet] ??= []).push(k);
  if (MOON_DATA[k].major) (MAJOR_MOONS_OF[MOON_DATA[k].planet] ??= []).push(k);
}
const PLANET_NAIF = { mars: 499, jupiter: 599, saturn: 699, uranus: 799, neptune: 899, pluto: 999 };
// The J2000 ecliptic's pole in the ICRF (obliquity 84381.448").
const ECLIPTIC_POLE_DEC = 90 - 84381.448 / 3600;

// The reference plane's axes in EQJ: N its ascending node on the ICRF
// equator, Y = P x N, P its pole.
function planeAxes(m) {
  let ra, dec;
  if (m.frame === 'Laplace') { ra = m.poleRa * DEG; dec = m.poleDec * DEG; } else if (m.frame === 'ecliptic') {
    ra = 270 * DEG; dec = ECLIPTIC_POLE_DEC * DEG;
  } else {
    const ax = Astronomy.RotationAxis(AE_PLANET[m.planet], new Astronomy.AstroTime(J2000_DAYS_TO_ASTRO));
    ra = ax.ra * 15 * DEG; dec = ax.dec * DEG;
    // The IAU's north pole of a planet is the one on the north side of the
    // invariable plane; Uranus spins the other way about it, and its moons'
    // elements are referred to the pole they orbit about.
    if (m.planet === 'uranus') { ra += Math.PI; dec = -dec; }
  }
  const N = [-Math.sin(ra), Math.cos(ra), 0];
  const P = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const Y = [P[1] * N[2] - P[2] * N[1], P[2] * N[0] - P[0] * N[2], P[0] * N[1] - P[1] * N[0]];
  return [N, Y, P];
}
const AXES = {};
for (const k of MOON_KEYS) if (!GALILEAN.has(k)) AXES[k] = planeAxes(MOON_DATA[k]);

// Days from J2000 to a row's epoch, "YYYY-MM-DD.d" TDB.
function epochDays(m) {
  const [y, mo, d] = m.epoch.split('-');
  return (Date.UTC(Number(y), Number(mo) - 1, 1) - Date.UTC(2000, 0, 1, 12)) / 864e5 + Number(d) - 1;
}

// Position from mean elements m at t days TDB from J2000, EQJ km, and the
// orbit's pole h (unit). fit = false leaves out the fitted corrections.
function elementPosition(m, tJ2000, axes, fit) {
  const t = tJ2000 - epochDays(m);
  const f = fit && m.fit ? m.fit : null;
  const yr = t / 365.25;
  const w = (m.w + (f ? f.dW : 0) + (m.Papsis ? (360 * yr) / m.Papsis : 0)) * DEG;
  const nodeRate = m.Pnode ? (360 * yr) / m.Pnode : 0;
  const node = (m.node + (f ? f.dNode : 0) - Math.sign(Math.cos(m.i * DEG)) * nodeRate) * DEG;
  const inc = m.i * DEG, e = m.e, a = m.a;
  const M = ((m.M + (f ? f.dM : 0)) + (360 / m.P + (f ? f.dn : 0)) * t) * DEG;
  let E = M;
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const xo = a * (Math.cos(E) - e), yo = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(w), sw = Math.sin(w), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(inc), si = Math.sin(inc);
  // Orbit plane -> reference plane: Rz(node) Rx(i) Rz(w), then to EQJ.
  const x1 = cw * xo - sw * yo, y1 = sw * xo + cw * yo;
  const q = [cn * x1 - sn * ci * y1, sn * x1 + cn * ci * y1, si * y1];
  const hq = [sn * si, -cn * si, ci];
  const [N, Y, P] = axes;
  const toEqj = (u) => [0, 1, 2].map((j) => u[0] * N[j] + u[1] * Y[j] + u[2] * P[j]);
  return { r: toEqj(q), h: toEqj(hq) };
}

// State from mean elements: position, orbit pole and velocity (km/s, by a
// central difference over 10 s, so it carries the precessions too; the
// difference's own error, (n dt)^2 / 6 of the speed, is 1e-7 of Phobos's).
// The kernel interpolates the moons with cubic Hermite polynomials through
// these states, which need velocities that match the positions.
export function elementState(m, t, axes = planeAxes(m), fit = true) {
  const { r, h } = elementPosition(m, t, axes, fit);
  const dt = 10 / 86400;
  const a = elementPosition(m, t - dt, axes, fit).r, b = elementPosition(m, t + dt, axes, fit).r;
  return { r, h, v: [(b[0] - a[0]) / 20, (b[1] - a[1]) / 20, (b[2] - a[2]) / 20] };
}

// Days TDB from J2000 at a UTC instant (TT; TDB differs by under 2 ms).
const tdbDays = (date) => ttSeconds(date.getTime()) / 86400;

// A moon about its planet's centre from the tables at tt, or null where
// its system's year is not installed (TDB taken as TT: they differ by
// under 2 ms, 40 m of the fastest moon's path).
const rm = [0, 0, 0], vm = [0, 0, 0], rp = [0, 0, 0], vp = [0, 0, 0];
function tableState(key, tt) {
  const m = MOON_DATA[key], chunk = moonChunkAt(m.planet, tt);
  if (!chunk || !chunkState(chunk, m.naif, tt, rm, vm) || !chunkState(chunk, PLANET_NAIF[m.planet], tt, rp, vp)) return null;
  return { r: [rm[0] - rp[0], rm[1] - rp[1], rm[2] - rp[2]], v: [vm[0] - vp[0], vm[1] - vp[1], vm[2] - vp[2]] };
}

// Position only (EQJ km), for sampling orbit lines.
export function moonPositionEqj(key, date) {
  const tt = ttSeconds(date.getTime());
  if (GALILEAN.has(key)) return moonStateEqjAtTt(key, tt).r;
  const s = tableState(key, tt);
  if (s) return s.r;
  return elementPosition(MOON_DATA[key], tt / 86400, AXES[key], true).r;
}

// JupiterMoons gives all four at once, and the kernel asks for each at the
// same node times, so the last few answers are kept. Its velocities are
// not the derivative of its positions (Callisto's differ by up to 3 m/s,
// which bends a Hermite cubic through them by 0.4 km), so the velocity is a
// central difference of the positions over 10 s, like the elements'.
const JM_KEEP = 6, jmCache = [];
function jupiterMoonsAt(tt) {
  for (const c of jmCache) if (c.tt === tt) return c.m;
  const m = Astronomy.JupiterMoons(Astronomy.AstroTime.FromTerrestrialTime(tt / 86400));
  if (jmCache.push({ tt, m }) > JM_KEEP) jmCache.shift();
  return m;
}
const JM_DT = 10;                       // s
function galilean(key, tt) {
  const s = jupiterMoonsAt(tt)[key], a = jupiterMoonsAt(tt - JM_DT)[key], b = jupiterMoonsAt(tt + JM_DT)[key];
  const k = AU_KM / (2 * JM_DT);
  return { r: [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM], v: [(b.x - a.x) * k, (b.y - a.y) * k, (b.z - a.z) * k] };
}

export function moonStateEqjAtTt(key, tt) {
  const m = MOON_DATA[key];
  if (!m) throw new Error(`moons: unknown moon '${key}'`);
  const s = tableState(key, tt);
  if (s) return s;
  if (GALILEAN.has(key)) return galilean(key, tt);
  return elementState(m, tt / 86400, AXES[key]);
}

export const moonStateEqj = (key, date) => moonStateEqjAtTt(key, ttSeconds(date.getTime()));

// The planet's centre about its system barycentre from the elements,
// -sum(GM_i s_i) / GM_system over its moons with a measured GM.
function elementOffset(planet, states) {
  const offset = { r: [0, 0, 0], v: [0, 0, 0] };
  for (const [k, s] of Object.entries(states)) {
    const f = (MOON_DATA[k].gm ?? 0) / SYSTEM_GM[planet];
    for (let j = 0; j < 3; j++) { offset.r[j] -= f * s.r[j]; offset.v[j] -= f * s.v[j]; }
  }
  return offset;
}

// A planet's system at once: each moon's planetocentric state and the
// planet's centre about the system barycentre (EQJ km, km/s).
export function systemEqjAtTt(planet, tt) {
  const moons = {};
  const chunk = moonChunkAt(planet, tt);
  if (chunk && chunkState(chunk, PLANET_NAIF[planet], tt, rp, vp)) {
    const offset = { r: [rp[0], rp[1], rp[2]], v: [vp[0], vp[1], vp[2]] };
    for (const k of MOONS_OF[planet] ?? []) {
      moons[k] = chunkState(chunk, MOON_DATA[k].naif, tt, rm, vm)
        ? { r: [rm[0] - offset.r[0], rm[1] - offset.r[1], rm[2] - offset.r[2]], v: [vm[0] - offset.v[0], vm[1] - offset.v[1], vm[2] - offset.v[2]] }
        : moonStateEqjAtTt(k, tt);
    }
    return { moons, offset };
  }
  for (const k of MOONS_OF[planet] ?? []) moons[k] = moonStateEqjAtTt(k, tt);
  return { moons, offset: elementOffset(planet, moons) };
}

// The planet's centre about its system barycentre alone (the kernel's
// planet), without the moons' states where the tables give it.
export function planetOffsetEqjAtTt(planet, tt) {
  const chunk = moonChunkAt(planet, tt);
  if (chunk && chunkState(chunk, PLANET_NAIF[planet], tt, rp, vp)) return { r: [rp[0], rp[1], rp[2]], v: [vp[0], vp[1], vp[2]] };
  return systemEqjAtTt(planet, tt).offset;
}

export const systemEqj = (planet, date) => systemEqjAtTt(planet, ttSeconds(date.getTime()));

export const planetCentreOffsetEqj = (planet, date) => systemEqj(planet, date).offset.r;

// Each moon's body-fixed frame (its IAU rotation model) is in orientation.js.
export const isMoonKey = (key) => key in MOON_DATA;

// The satellite ephemeris each moon's table is fitted to: its system's, but
// sat415 for Saturn's ring moons.
const SYSTEM_KERNEL = { mars: 'mar099s', jupiter: 'jup365', saturn: 'sat441', uranus: 'ura184', neptune: 'nep098', pluto: 'plu060' };
const SAT415 = new Set([610, 611, 615, 616, 617, 618, 633, 649, 653]);
export const moonKernel = (key) => (SAT415.has(MOON_DATA[key].naif) ? 'sat415' : SYSTEM_KERNEL[MOON_DATA[key].planet]);

// Where a moon's place at a date comes from: 'table' (JPL's satellite
// ephemeris), 'theory' (astronomy-engine's, for the Galilean moons) or
// 'elements' (the mean elements).
export function moonSource(key, date) {
  const m = MOON_DATA[key], tt = ttSeconds(date.getTime()), chunk = moonChunkAt(m.planet, tt);
  if (chunk && chunk.has(m.naif)) return 'table';
  return GALILEAN.has(key) ? 'theory' : 'elements';
}
