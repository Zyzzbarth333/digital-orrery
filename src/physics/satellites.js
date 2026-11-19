// src/physics/satellites.js
//
// Earth satellites from their GP element sets (CelesTrak's OMM keywords,
// the successor to the two-line element set), moved by SGP4 and turned into
// the app's J2000 equatorial frame (docs/frontend/satellites.md).
//
//   parseGpCsv(text) -> OMM records    CelesTrak's FORMAT=csv, numbers parsed
//   satrecOf(omm)    -> satellite.js record, initialised for SGP4/SDP4
//   stateTeme(sat, utcMs) -> { r, v } | null   km, km/s, TEME of date
//   temeToEqj(utcMs) -> 3x3 matrix, rows in TEME: r_eqj = M r_teme
//   stateEqj(sat, utcMs)  -> { r, v } | null   geocentric J2000 equatorial
//
// SGP4 (Hoots and Roehrich, Spacetrack Report No. 3, 1980, with Vallado et
// al., AIAA 2006-6753's corrections) is the theory the elements are fitted
// with: use any other and the elements are wrong for it. satellite.js (MIT)
// is a port of Vallado's code; its near-Earth SGP4 and deep-space SDP4
// (periods over 225 minutes: GPS, Galileo, geostationary orbits) are
// checked against Vallado's verification vectors in satellites.test.mjs.
//
// SGP4 works in TEME, the true equator and mean equinox of date: the
// equator of date, with the x axis the equinox moved along it by the
// equation of the equinoxes. Vallado et al. 2006, Appendix C, eq. C-3,
// "of date":
//
//   r_J2000 = P^T N^T R3(-Eq_geo) r_TEME
//
// with P the IAU 1976 precession and N the IAU 1980 nutation (the 106-term
// series of earthRotation.js), and Eq_geo = dpsi cos(eps), the equation of
// the equinoxes without the kinematic terms added in 1994. The IERS
// corrections to the 1980 nutation are left out, as SGP4's frame never had
// them (0.05", 2 m at GEO). P and N want TT, from the leap-second table;
// UT1 does not enter, as TEME and the Earth-fixed frame share the pole.
//
// The time since epoch is taken from EPOCH to the microsecond it is given
// to, not through a Date's whole milliseconds (half a millisecond is 4 m of
// the ISS's track).

import { sunlight } from './discs.js';
import { json2satrec, sgp4 } from './sgp4.js';
import { precession1976, nutation1980, meanObliquity1980, R1, R3 } from './earthRotation.js';
import { ttMinusUtc, J2000_UTC_MS } from './timescale.js';

const NUMERIC = new Set(['MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY',
  'EPHEMERIS_TYPE', 'NORAD_CAT_ID', 'ELEMENT_SET_NO', 'REV_AT_EPOCH', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT']);

/**
 * An OMM record as CelesTrak gives it (its CSV's columns).
 * @typedef {{ OBJECT_NAME: string, OBJECT_ID: string, EPOCH: string, NORAD_CAT_ID: number,
 *   MEAN_MOTION: number, ECCENTRICITY: number, INCLINATION: number, RA_OF_ASC_NODE: number,
 *   ARG_OF_PERICENTER: number, MEAN_ANOMALY: number, BSTAR: number, MEAN_MOTION_DOT: number,
 *   MEAN_MOTION_DDOT: number, EPHEMERIS_TYPE?: number, CLASSIFICATION_TYPE?: string,
 *   ELEMENT_SET_NO?: number, REV_AT_EPOCH?: number }} Omm
 */

// CelesTrak's CSV: a header row of OMM keywords, then one row a satellite.
// Names hold no commas or quotes in CelesTrak's data; a quoted field is
// handled all the same.
/** @param {string} text @returns {Omm[]} */
export function parseGpCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line) => {
    const out = [];
    let cur = '', q = false;
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (q) { if (c === '"') { if (line[k + 1] === '"') { cur += '"'; k++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let k = 1; k < lines.length; k++) {
    const f = split(lines[k]);
    if (f.length < head.length) continue;
    const r = /** @type {any} */ ({});
    head.forEach((h, j) => { r[h] = NUMERIC.has(h) ? Number(f[j]) : f[j].trim(); });
    if (!Number.isFinite(r.NORAD_CAT_ID) || !(r.MEAN_MOTION > 0)) continue;
    rows.push(r);
  }
  return rows;
}

// A geostationary orbit: one turn a sidereal day, near circular and near
// equatorial (inclined geosynchronous weather satellites are left out).
export const isGeostationary = (r) => Math.abs(r.MEAN_MOTION - 1.0027) < 0.01 && r.ECCENTRICITY < 0.01 && r.INCLINATION < 5;

// EPOCH (UTC, "2026-11-17T12:34:56.123456") as Unix ms with its fraction.
export function epochMs(epoch) {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(\.\d+)?Z?$/.exec(epoch.trim());
  if (!m) return Date.parse(epoch);
  return Date.parse(`${m[1]}Z`) + (m[2] ? Number(m[2]) * 1000 : 0);
}

// A two-line element set as the OMM record CelesTrak would give for it
// (the verification set and older sources come as TLEs).
// The TLE's epoch (day of year to 1e-8, under a millisecond) is written to
// the microsecond, as CelesTrak writes EPOCH.
export function ommFromTle(l1, l2) {
  const yy = Number(l1.slice(18, 20)), year = yy < 57 ? 2000 + yy : 1900 + yy;
  const ms = Date.UTC(year, 0, 1) + (Number(l1.slice(20, 32)) - 1) * 86400e3;
  const whole = Math.floor(ms), us = Math.round((ms - whole) * 1000);
  const iso = new Date(whole).toISOString().slice(0, 23) + String(us).padStart(3, '0');
  const exp = (s) => Number(`${s[0] === '-' ? '-' : ''}0.${s.slice(1, 6).replace(/ /g, '0')}e${s.slice(6, 8)}`);
  return {
    NORAD_CAT_ID: Number(l1.slice(2, 7)), EPOCH: iso,
    MEAN_MOTION_DOT: Number(l1.slice(33, 43)), MEAN_MOTION_DDOT: exp(l1.slice(44, 52)), BSTAR: exp(l1.slice(53, 61)),
    INCLINATION: Number(l2.slice(8, 16)), RA_OF_ASC_NODE: Number(l2.slice(17, 25)), ECCENTRICITY: Number(`0.${l2.slice(26, 33).replace(/ /g, '0')}`),
    ARG_OF_PERICENTER: Number(l2.slice(34, 42)), MEAN_ANOMALY: Number(l2.slice(43, 51)), MEAN_MOTION: Number(l2.slice(52, 63)),
  };
}

// A satellite: its OMM record, its SGP4 record and its exact epoch.
/** @param {Omm} omm */
export function satrecOf(omm) {
  return { omm, rec: json2satrec(omm, 'a'), epochMs: epochMs(omm.EPOCH) };
}

// Minutes from its epoch to a UTC instant.
export const minutesSince = (sat, utcMs) => (utcMs - sat.epochMs) / 60000;

// SGP4's state in TEME, or null where it fails (decayed, or eccentricity
// out of range: satellite.js sets rec.error).
export function stateTeme(sat, utcMs) {
  const pv = sgp4(sat.rec, minutesSince(sat, utcMs));
  if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
  const p = pv.position, v = pv.velocity;
  if (!Number.isFinite(p.x)) return null;
  return { r: [p.x, p.y, p.z], v: [v.x, v.y, v.z] };
}

const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));
const transpose = (a) => [0, 1, 2].map((i) => [a[0][i], a[1][i], a[2][i]]);

// TT days from J2000 at a UTC instant (before 1972, 2017's offset: a
// second's difference turns the frame by 0.00002").
const ttDays = (utcMs) => ((utcMs - J2000_UTC_MS) / 1000 + (ttMinusUtc(utcMs) ?? 69.184)) / 86400;

// TEME of date -> J2000 equatorial (Vallado et al. 2006, eq. C-3).
// The forward chain is J2000 -> TOD: N P; TOD -> TEME: R3(Eq_geo); so
// r_J2000 = (R3(Eq_geo) N P)^T r_TEME.
export function temeToEqj(utcMs) {
  const d = ttDays(utcMs), T = d / 36525;
  const P = precession1976(T), eps = meanObliquity1980(T), { dpsi, deps } = nutation1980(d);
  const N = mul(R1(-(eps + deps)), mul(R3(-dpsi), R1(eps)));
  const eqGeo = dpsi * Math.cos(eps + deps);
  return transpose(mul(R3(eqGeo), mul(N, P)));
}

export const apply = (M, x) => [
  M[0][0] * x[0] + M[0][1] * x[1] + M[0][2] * x[2],
  M[1][0] * x[0] + M[1][1] * x[1] + M[1][2] * x[2],
  M[2][0] * x[0] + M[2][1] * x[1] + M[2][2] * x[2],
];

// Geocentric J2000 equatorial state (km, km/s). The frame's own turn (the
// precession and nutation rates, 1e-11 rad/s) is left out of v: 0.4 mm/s.
// M: temeToEqj's matrix, when the caller has it for many satellites.
export function stateEqj(sat, utcMs, M = temeToEqj(utcMs)) {
  const s = stateTeme(sat, utcMs);
  return s && { r: apply(M, s.r), v: apply(M, s.v) };
}

// Speeds against the turning Earth (the data plate's ground speed). TEME's
// z is the true pole of date, so the Earth turns about it at the WGS-84
// rate, and v - w x r is the velocity seen from the ground (polar motion,
// 0.3" of the pole, is left out: under 0.1 m/s). `relative`: that
// velocity's size, km/s, the speed through still air; `track`: the
// sub-satellite point's speed over a sphere of the Earth's mean radius,
// the horizontal part scaled down to the ground, km/s.
export const EARTH_RATE = 7.292115e-5;   // rad/s, WGS-84 (NIMA TR8350.2)
const R_MEAN_KM = 6371.0088;
export function groundSpeeds(s) {
  const [x, y, z] = s.r;
  const vr = [s.v[0] + EARTH_RATE * y, s.v[1] - EARTH_RATE * x, s.v[2]];
  const d = Math.hypot(x, y, z);
  const radial = (vr[0] * x + vr[1] * y + vr[2] * z) / d;
  const rel = Math.hypot(...vr);
  const horiz = Math.sqrt(Math.max(0, rel * rel - radial * radial));
  return { relative: rel, track: (horiz * R_MEAN_KM) / d };
}

// What the element set says of the orbit, for the data plate: SGP4's mean
// elements at epoch (Kozai mean motion turned to Brouwer's by sgp4init:
// rec.no is the un-Kozai'd mean motion in rad/min, rec.a in Earth radii).
const EARTH_RADIUS_WGS72 = 6378.135;
export function meanOrbit(sat) {
  const { rec, omm } = sat;
  const a = rec.a * EARTH_RADIUS_WGS72;
  return {
    a, e: omm.ECCENTRICITY, iDeg: omm.INCLINATION, nodeDeg: omm.RA_OF_ASC_NODE, periDeg: omm.ARG_OF_PERICENTER, MDeg: omm.MEAN_ANOMALY,
    revsPerDay: omm.MEAN_MOTION, periodMin: 1440 / omm.MEAN_MOTION,
    perigeeKm: a * (1 - omm.ECCENTRICITY) - EARTH_RADIUS_WGS72, apogeeKm: a * (1 + omm.ECCENTRICITY) - EARTH_RADIUS_WGS72,
    bstar: omm.BSTAR, deepSpace: rec.method === 'd',
  };
}

// The Sun seen from a satellite: the fraction of its disc the Earth and
// the Moon leave (discs.js sunlight: the umbra's and penumbra's true
// cones, each about 200 km off a cylinder of the Earth's radius at GEO,
// the penumbra 400 km wide there), and which casts it. r: the satellite from the
// Earth's centre (km); sunDir: unit vector to the Sun, in the same frame;
// moon: the Moon from the Earth's centre (km), or null. The Sun is taken at
// 1 AU along sunDir (its distance moves the cones by under 0.1 %).
export const R_EARTH_KM = 6378.137;
export const R_MOON_KM = 1737.4;
const AU_KM = 149597870.7;
/** @param {number[]} r @param {number[]} sunDir @param {number[] | null} [moon] */
export function sunFraction(r, sunDir, moon = null) {
  const sunRel = [sunDir[0] * AU_KM - r[0], sunDir[1] * AU_KM - r[1], sunDir[2] * AU_KM - r[2]];
  const bodies = [{ key: 'earth', rel: [-r[0], -r[1], -r[2]], radius: R_EARTH_KM }];
  if (moon) bodies.push({ key: 'moon', rel: [moon[0] - r[0], moon[1] - r[1], moon[2] - r[2]], radius: R_MOON_KM });
  return sunlight(sunRel, bodies);
}

// In shadow: under half the Sun's disc in view (the penumbra's middle).
/** @param {number[]} r @param {number[]} sunDir @param {number[] | null} [moon] */
export function inShadow(r, sunDir, moon = null) {
  return sunFraction(r, sunDir, moon).nu < 0.5;
}
