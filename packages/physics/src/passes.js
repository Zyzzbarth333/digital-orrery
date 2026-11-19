// packages/physics/src/passes.js
//
// A satellite's passes over a place on the Earth: when it rises, culminates
// and sets, where it is in the sky then, and whether it can be seen, from
// its GP element set by SGP4 (satellites.js; docs/frontend/satellites.md,
// "Passes over a place").
//
//   siteOf(latDeg, lonDeg, heightKm)   -> site: ITRF position and local axes
//   temeToItrf(utcMs)                  -> 3x3, r_ITRF = M r_TEME
//   lookAngles(site, rItrf)            -> { azDeg, elDeg, rangeKm }
//   findPasses(sat, site, fromMs, opt) -> passes, in time order
//   subPoint(rItrf)                    -> { latDeg, lonDeg, heightKm } geodetic
//
// The frames. SGP4 works in TEME, whose equator is the true equator of
// date and whose x axis is the mean equinox (satellites.js). The Earth's
// own frame of the true pole (PEF) is TEME turned about that pole by the
// Greenwich mean sidereal time (Vallado et al., AIAA 2006-6753, eq. (1));
// polar motion then turns it to the crust (ITRF):
//
//   r_ITRF = W R3(GMST(UT1)) r_TEME,     W = R1(-yp) R2(-xp)
//
// with GMST the IAU 1982 expression and UT1 - UTC, xp and yp the day's
// Earth orientation parameters (eop.js), as the Earth's own orientation
// uses (orientation.js earthFixedAxes, which this matches to the IERS
// nutation corrections SGP4's frame leaves out: a metre or two).
//
// The observer is a point on the WGS-84 ellipsoid (geodetic latitude,
// longitude east, height above the ellipsoid). Elevation is the angle
// above the plane normal to the ellipsoid there, azimuth clockwise from
// north: the geometric direction, without refraction (it lifts a satellite
// on the horizon by 0.6 deg, which brings its rise a few seconds early).
//
// Visible: the satellite in sunlight (satellites.js inShadow, the Earth's
// shadow as a cylinder) while the Sun is more than 6 deg below the
// observer's horizon (civil twilight's end: the sky dark enough for a
// sunlit satellite to show), both at once while it is above the horizon
// (minVisibleDeg, 0 by default, as Heavens-Above judges it).

import { stateTeme, temeToEqj, apply, inShadow } from './satellites.js';
import { gmst1982, R1, R2, R3 } from './earthRotation.js';
import { eopAt } from './eop.js';
import { helioStateEqj } from './ephemeris.js';
import { J2000_UTC_MS } from './timescale.js';
import { dot } from './vec.js';

const DEG = Math.PI / 180;
const AS2R = DEG / 3600;
export const WGS84_A = 6378.137, WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);

const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const transpose = (a) => [0, 1, 2].map((i) => [a[0][i], a[1][i], a[2][i]]);

/**
 * A place on the Earth: its ITRF position (km) and the local east, north
 * and up axes, the up axis normal to the WGS-84 ellipsoid.
 * @typedef {{ latDeg: number, lonDeg: number, heightKm: number, r: number[], E: number[], N: number[], U: number[] }} Site
 */
/** @returns {Site} */
export function siteOf(latDeg, lonDeg, heightKm = 0) {
  const p = latDeg * DEG, l = lonDeg * DEG;
  const sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
  const Nr = WGS84_A / Math.sqrt(1 - E2 * sp * sp);      // prime vertical radius of curvature
  const r = [(Nr + heightKm) * cp * cl, (Nr + heightKm) * cp * sl, (Nr * (1 - E2) + heightKm) * sp];
  return { latDeg, lonDeg, heightKm, r, E: [-sl, cl, 0], N: [-sp * cl, -sp * sl, cp], U: [cp * cl, cp * sl, sp] };
}

// Geodetic latitude, longitude and height of an ITRF point (Bowring's
// iteration, to 1e-12 rad in three steps for any height a satellite has).
export function subPoint(r) {
  const p = Math.hypot(r[0], r[1]), lonDeg = Math.atan2(r[1], r[0]) / DEG;
  let lat = Math.atan2(r[2], p * (1 - E2)), Nr = WGS84_A;
  for (let k = 0; k < 4; k++) {
    const s = Math.sin(lat);
    Nr = WGS84_A / Math.sqrt(1 - E2 * s * s);
    lat = Math.atan2(r[2] + E2 * Nr * s, p);
  }
  const s = Math.sin(lat), c = Math.cos(lat);
  const heightKm = Math.abs(c) > 1e-9 ? p / c - Nr : Math.abs(r[2]) / Math.abs(s) - Nr * (1 - E2);
  return { latDeg: lat / DEG, lonDeg, heightKm };
}

// The Earth orientation parameters, looked up once an hour of the clock:
// UT1 - UTC moves by 2 ms a day at most and polar motion by a few
// millimetres, so an hour's value is good to 0.1 ms and 0.1 mm.
let eopHour = NaN, eopHeld = null;
function eopNear(utcMs) {
  const h = Math.floor(utcMs / 3600e3);
  if (h !== eopHour) { eopHour = h; eopHeld = eopAt(h * 3600e3 + 1800e3); }
  return eopHeld;
}

/** TEME of date -> ITRF at a UTC instant: W R3(GMST(UT1)). */
export function temeToItrf(utcMs) {
  const eop = eopNear(utcMs);
  const du = (utcMs - J2000_UTC_MS) / 86400e3 + (eop ? eop.dut1 : 0) / 86400;
  const M = R3(gmst1982(du));
  return eop && (eop.xp || eop.yp) ? mul(mul(R1(-eop.yp * AS2R), R2(-eop.xp * AS2R)), M) : M;
}

/** Azimuth (clockwise from north) and elevation, degrees, and range (km) of an ITRF point from a site. */
export function lookAngles(site, rItrf) {
  const d = [rItrf[0] - site.r[0], rItrf[1] - site.r[1], rItrf[2] - site.r[2]];
  const rangeKm = Math.hypot(d[0], d[1], d[2]);
  const e = dot(d, site.E), n = dot(d, site.N), u = dot(d, site.U);
  let azDeg = Math.atan2(e, n) / DEG;
  if (azDeg < 0) azDeg += 360;
  return { azDeg, elDeg: Math.asin(Math.max(-1, Math.min(1, u / rangeKm))) / DEG, rangeKm };
}

// The Sun's direction from the Earth's centre, J2000 (DE442 once its table
// is in, astronomy-engine before). Its 8.8" of parallax and 20" of
// aberration are left out: under 0.01 deg of the Sun's altitude.
export function sunDirEqj(utcMs) {
  const r = helioStateEqj('earth', new Date(utcMs)).r;
  const n = Math.hypot(r[0], r[1], r[2]);
  return [-r[0] / n, -r[1] / n, -r[2] / n];
}

/** The Sun's elevation (degrees, geometric) at a site. */
export function sunElevation(site, utcMs) {
  const s = apply(temeToItrf(utcMs), apply(transpose(temeToEqj(utcMs)), sunDirEqj(utcMs)));
  return Math.asin(dot(s, site.U)) / DEG;
}

/**
 * Where a satellite is in a site's sky at an instant, and its ITRF position:
 * { t, azDeg, elDeg, rangeKm, r } | null where SGP4 stops.
 */
export function lookAt(sat, site, utcMs) {
  const s = stateTeme(sat, utcMs);
  if (!s) return null;
  const r = apply(temeToItrf(utcMs), s.r);
  return { t: utcMs, ...lookAngles(site, r), r, rTeme: s.r };
}

/**
 * A pass event: when, and where in the sky.
 * @typedef {{ t: number, azDeg: number, elDeg: number, rangeKm: number }} SkyPoint
 */
/**
 * @typedef {{ rise: SkyPoint | null, peak: SkyPoint, set: SkyPoint | null,
 *   above: { up: SkyPoint, down: SkyPoint } | null,
 *   visible: { from: SkyPoint, to: SkyPoint } | null,
 *   sunlit: boolean[], sunElDeg: number, kind: 'visible' | 'daylight' | 'unlit' }} Pass
 */

const pick = (p) => p && { t: p.t, azDeg: p.azDeg, elDeg: p.elDeg, rangeKm: p.rangeKm };

/**
 * The passes of a satellite over a site from fromMs for `days`: each whose
 * highest point is at least minPeakDeg up, with its rise and set (0 deg,
 * null where they fall outside the search), its culmination, the times it
 * crosses aboveDeg (10, where Heavens-Above's tables start and end), and
 * when between the times it crosses minVisibleDeg it can be seen.
 *
 * The search samples the elevation every period/100 (a minute for the ISS),
 * finds each local maximum, refines it by golden-section search, and finds
 * each crossing by bisection, all to 1 ms.
 * @param {ReturnType<typeof import('./satellites.js').satrecOf>} sat
 * @param {Site} site
 * @returns {Pass[]}
 */
export function findPasses(sat, site, fromMs, { days = 3, minPeakDeg = 10, aboveDeg = 10, minVisibleDeg = 0, sunDeg = -6, max = Infinity } = {}) {
  const period = 86400e3 / sat.omm.MEAN_MOTION;
  const h = Math.min(600e3, Math.max(20e3, period / 100));
  const el = (t) => { const l = lookAt(sat, site, t); return l ? l.elDeg : NaN; };
  const t0 = fromMs - period / 2, t1 = fromMs + days * 86400e3;
  const passes = [];
  let a = el(t0 - h), b = el(t0);
  for (let t = t0; t < t1 && passes.length < max; t += h) {
    const c = el(t + h);
    if (!(b >= a && b > c)) { a = b; b = c; continue; }
    a = b; b = c;
    // A maximum in [t - h, t + h]: golden-section search to 1 ms.
    let lo = t - h, hi = t + h;
    const g = (Math.sqrt(5) - 1) / 2;
    let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = el(x1), f2 = el(x2);
    while (hi - lo > 1) {
      if (f1 > f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = el(x1); }
      else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = el(x2); }
    }
    const peak = lookAt(sat, site, (lo + hi) / 2);
    if (!peak || peak.elDeg < minPeakDeg) continue;
    const cross = (level, dir) => crossing(el, peak.t, level, dir, h, period / 2);
    const tRise = cross(0, -1), tSet = cross(0, 1);
    // Up for half a period either side (geostationary, or near it): no pass.
    if (tRise === null && tSet === null) continue;
    if (tSet !== null && tSet < fromMs) continue;
    const rise = tRise === null ? null : lookAt(sat, site, tRise), set = tSet === null ? null : lookAt(sat, site, tSet);
    let above = null, visible = null;
    const sunlit = [], sunEl = sunElevation(site, peak.t);
    if (peak.elDeg >= aboveDeg) {
      const up = cross(aboveDeg, -1) ?? peak.t, down = cross(aboveDeg, 1) ?? peak.t;
      above = { up: pick(lookAt(sat, site, up)), down: pick(lookAt(sat, site, down)) };
    }
    if (peak.elDeg >= minVisibleDeg) {
      const from = (minVisibleDeg === 0 ? tRise : cross(minVisibleDeg, -1)) ?? peak.t;
      const to = (minVisibleDeg === 0 ? tSet : cross(minVisibleDeg, 1)) ?? peak.t;
      visible = visibleWindow(sat, site, from, to, sunDeg, sunlit);
    }
    passes.push({
      rise: pick(rise), peak: pick(peak), set: pick(set), above,
      visible: visible && { from: pick(lookAt(sat, site, visible[0])), to: pick(lookAt(sat, site, visible[1])) },
      sunlit, sunElDeg: sunEl,
      kind: visible ? 'visible' : sunEl > sunDeg ? 'daylight' : 'unlit',
    });
  }
  return passes;
}

// Where el(t) crosses `level` going away from tPeak (dir -1 back, +1 on):
// step out by h to bracket it, then bisect to 1 ms. null if not within span.
function crossing(el, tPeak, level, dir, h, span) {
  let inT = tPeak, outT = tPeak;
  for (let s = h; s <= span + h; s += h) {
    const t = tPeak + dir * s;
    if (el(t) < level) { outT = t; break; }
    inT = t;
  }
  if (outT === tPeak) return null;
  while (Math.abs(outT - inT) > 1) {
    const m = (inT + outT) / 2;
    if (el(m) < level) outT = m; else inT = m;
  }
  return (inT + outT) / 2;
}

// Whether a sunlit satellite can be seen at t: it is out of the Earth's
// shadow and the Sun is below sunDeg at the site. The Sun's direction is
// taken in TEME, the satellite's own frame.
function seenState(sat, site, t, sunDeg) {
  const s = stateTeme(sat, t);
  if (!s) return { lit: false, dark: false };
  const toTeme = transpose(temeToEqj(t)), sun = apply(toTeme, sunDirEqj(t));
  const sunUp = dot(apply(temeToItrf(t), sun), site.U);
  return { lit: !inShadow(s.r, sun), dark: Math.asin(sunUp) / DEG < sunDeg };
}

// The span within [ta, tb] when the satellite can be seen, or null. Within
// a pass's few minutes the satellite enters or leaves the shadow at most
// once and the Sun crosses sunDeg at most once, so each state is found at
// the ends and its one change, if any, by bisection. sunlit gets the
// satellite's state at the two ends.
function visibleWindow(sat, site, ta, tb, sunDeg, sunlit) {
  const A = seenState(sat, site, ta, sunDeg), B = seenState(sat, site, tb, sunDeg);
  sunlit.push(A.lit, B.lit);
  const edge = (key) => {
    let lo = ta, hi = tb;
    while (hi - lo > 1) {
      const m = (lo + hi) / 2;
      if (seenState(sat, site, m, sunDeg)[key] === A[key]) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  };
  // Each state as the interval it holds over [ta, tb].
  const span = (key) => {
    if (A[key] && B[key]) return [ta, tb];
    if (!A[key] && !B[key]) return null;
    const e = edge(key);
    return A[key] ? [ta, e] : [e, tb];
  };
  const lit = span('lit'), dark = span('dark');
  if (!lit || !dark) return null;
  const from = Math.max(lit[0], dark[0]), to = Math.min(lit[1], dark[1]);
  return to > from ? [from, to] : null;
}
