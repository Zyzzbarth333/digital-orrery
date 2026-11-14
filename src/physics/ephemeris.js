// src/physics/ephemeris.js
//
// Heliocentric states of the planets, Pluto and the Moon, in the units the
// physics core uses (km, km/s): from DE442 (deTable.js) once its table is
// installed, within 2000-2050, and from astronomy-engine outside it (or
// without the table), the two blended over the table's margins. Mars to Pluto are their systems' barycentres, in both.
// astronomy-engine works in AU and AU/day in its EQJ frame (J2000 mean
// equator, the same axes as SPICE "J2000").
//
//   helioStateEqj(key, date) -> { r, v }  equatorial J2000
//   helioStateEcl(key, date) -> { r, v }  ecliptic J2000 (rotated by the J2000
//                                         obliquity via astronomy-engine), the
//                                         frame Lambert's prograde test expects
//
// Keys are the lower-case names the simulation uses ('earth', 'mars', ...).
// Velocities come from the series' derivative or HelioState directly, not
// from finite differences.

import * as Astronomy from 'astronomy-engine';
import { ttMinusUtc, tdbSeconds, tdbFromTt, J2000_UTC_MS, LEAP_TABLE_START_MS } from './timescale.js';
import { deHelioState, deSunFromSsb, deKeySpan, DE_KEYS } from './deTable.js';

// Time scales. The app's clock is UTC; astronomy-engine takes UT and adds
// its ΔT = TT - UT, which past the end of its tables is an extrapolation:
// 75.2 s for 2026 against the true 69.2 s, so every body was computed 6 s
// late (180 km along Earth's orbit, 6 km along the Moon's; found by the
// Artemis II validation, docs/validation/artemis2.md). From 1972 ΔT is set
// from the leap-second table instead (timescale.js), treating UTC as UT1
// (they differ by under 0.9 s). Before 1972 the library's Espenak-Meeus
// model stands.
export function deltaT(ut) {
  const tt = ttMinusUtc(J2000_UTC_MS + ut * 86400e3);
  return tt === null ? Astronomy.DeltaT_EspenakMeeus(ut) : tt;
}
Astronomy.SetDeltaTFunction(deltaT);

// TT seconds past J2000 (2000-01-01 12:00 TT) at a UTC instant, by the same
// TT - UTC the bodies are computed with. Unlike UTC it never stops for a leap
// second, so the kernel counts its time in it (kernelHost.kernelSeconds).
export function ttSeconds(ms) {
  return (ms - J2000_UTC_MS) / 1000 + deltaT((ms - J2000_UTC_MS) / 86400e3);
}

// The UTC instant (ms) of TT seconds past J2000. Inside a leap second, which
// UTC (as JavaScript counts it) has no instant for, the end of that second:
// the clock shows 00:00:00 for its whole length.
export function utcMsAtTt(tt) {
  let ms = J2000_UTC_MS + (tt - 64) * 1000, prev = NaN;
  for (let k = 0; k < 8; k++) {
    const next = J2000_UTC_MS + (tt - deltaT((ms - J2000_UTC_MS) / 86400e3)) * 1000;
    if (Math.abs(next - ms) < 1e-6) return next;
    if (Math.abs(next - prev) < 1e-6) return Math.ceil(Math.min(ms, next) / 1000) * 1000;
    prev = ms;
    ms = next;
  }
  return ms;
}

const LEAP_TABLE_START_TT = ttSeconds(LEAP_TABLE_START_MS);

const AU_KM = 149597870.7;
const AU_PER_DAY_TO_KMS = AU_KM / 86400.0;

const BODIES = {
  mercury: Astronomy.Body.Mercury,
  venus: Astronomy.Body.Venus,
  earth: Astronomy.Body.Earth,
  mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn,
  uranus: Astronomy.Body.Uranus,
  neptune: Astronomy.Body.Neptune,
  pluto: Astronomy.Body.Pluto,
  moon: Astronomy.Body.Moon,
};

const EQJ_TO_ECL = Astronomy.Rotation_EQJ_ECL();

function bodyOf(key) {
  const b = BODIES[key];
  if (!b) throw new Error(`ephemeris: unknown body '${key}'`);
  return b;
}

function toKm(s) {
  return {
    r: [s.x * AU_KM, s.y * AU_KM, s.z * AU_KM],
    v: [s.vx * AU_PER_DAY_TO_KMS, s.vy * AU_PER_DAY_TO_KMS, s.vz * AU_PER_DAY_TO_KMS],
  };
}

// The bodies DE442's table holds.
const IN_DE = new Set(['earth', 'moon', ...Object.keys(DE_KEYS)]);

// At each end of the table, DE442 is blended into astronomy-engine over
// these many days, inside the margin by which each series runs past
// 2000-2050 (c/de_cheb.c), so 2000-2050 itself is DE442 throughout. Without
// a blend the bodies would jump by astronomy-engine's error at the edge
// (335,000 km for Neptune): a kink in every orbit line that spans it, and a
// leap under a craft flying across it. The blend's own acceleration,
// 2 w' (v_DE - v_AE) + w'' (r_DE - r_AE), up to about jump x 5.77 / T^2,
// sets each length: at most 0.8 % of the Sun's pull there (Pluto, whose jump
// is 260,000 km), 0.02 % for Earth (deTable.test.mjs). Earth and the Moon share one
// length, so the Moon about the Earth blends as one too.
export const BLEND_DAYS = { mercury: 30, venus: 30, earth: 30, moon: 30, mars: 60, jupiter: 365, saturn: 365, uranus: 730, neptune: 1461, pluto: 2922, ssb: 365 };

// The weight of DE442 at TDB et within a body's span: w = 1 inside, falling
// to 0 at the table's ends as 10s^3 - 15s^4 + 6s^5 (continuous to the
// second derivative, so positions, velocities and accelerations meet), with
// dw/dt. null outside the table.
function deWeight(key, et) {
  const span = deKeySpan(key);
  if (!span || et < span[0] || et > span[1]) return null;
  const T = BLEND_DAYS[key] * 86400, a = et - span[0], b = span[1] - et;
  const s = Math.min(a, b) / T, sign = a <= b ? 1 : -1;
  if (s >= 1) return { w: 1, dw: 0 };
  return { w: s * s * s * (10 - 15 * s + 6 * s * s), dw: (sign * 30 * s * s * (1 - s) * (1 - s)) / T };
}

// a + w (d - a), with velocity a.v + w (d.v - a.v) + dw (d.r - a.r).
function blend(d, a, { w, dw }) {
  const r = [0, 0, 0], v = [0, 0, 0];
  for (let j = 0; j < 3; j++) {
    const dr = d.r[j] - a.r[j];
    r[j] = a.r[j] + w * dr;
    v[j] = a.v[j] + w * (d.v[j] - a.v[j]) + dw * dr;
  }
  return { r, v };
}

// A body from DE442 (deTable.js) at TDB et, blended into astronomy-engine's
// state (aeState(), called only in the blend) at the table's ends; null
// outside the table or without it.
function deAt(key, et, aeState) {
  const wt = deWeight(key, et);
  const de = wt && deHelioState(key, et);
  if (!de) return null;
  return wt.w === 1 ? de : blend(de, aeState(), wt);
}

const aeEqj = (key, date) => () => toKm(Astronomy.HelioState(bodyOf(key), date));
function deState(key, date) {
  if (!IN_DE.has(key)) return null;
  const ms = date.getTime();
  return ms >= LEAP_TABLE_START_MS ? deAt(key, tdbSeconds(ms), aeEqj(key, date)) : null;
}

/** Whether a body's state at this date is DE442's alone (else
 *  astronomy-engine, or the two blended at the table's ends): what the data
 *  plate's tags name. 'sun' and 'ssb' ask about the solar system barycentre
 *  (DE442's own, else a sum of GMs). */
export function fromDe442(key, date) {
  const ms = date.getTime(), k = key === 'sun' ? 'ssb' : key;
  if (k !== 'ssb' && !IN_DE.has(k)) return false;
  return ms >= LEAP_TABLE_START_MS && deWeight(k, tdbSeconds(ms))?.w === 1;
}

/** The solar system barycentre relative to the Sun from DE442 (the Sun's
 *  own series, which counts every body JPL integrates), EQJ km and km/s,
 *  with DE442's weight there: { s, w, dw }, w < 1 in the blend at the
 *  table's ends (barycentres.js blends it into its sum of GMs); null
 *  outside the table. */
export function deSsbEqj(date) {
  const ms = date.getTime();
  if (ms < LEAP_TABLE_START_MS) return null;
  const et = tdbSeconds(ms), wt = deWeight('ssb', et), sun = wt && deSunFromSsb(et);
  return sun && { s: { r: [-sun.r[0], -sun.r[1], -sun.r[2]], v: [-sun.v[0], -sun.v[1], -sun.v[2]] }, ...wt };
}

/** DE442's SSB blended into another estimate of it, as the bodies are into
 *  astronomy-engine (for barycentres.js). */
export function blendSsb(de, other) {
  return de.w === 1 ? de.s : blend(de.s, other, de);
}

export function helioStateEqj(key, date) {
  return deState(key, date) ?? aeEqj(key, date)();
}

// The same at TT seconds past J2000 (the kernel's bodies, bodies.js): no
// UTC in the way, so nothing stands still through a leap second.
export function helioStateEqjAtTt(key, tt) {
  const ae = () => toKm(Astronomy.HelioState(bodyOf(key), Astronomy.AstroTime.FromTerrestrialTime(tt / 86400)));
  const de = IN_DE.has(key) && tt >= LEAP_TABLE_START_TT ? deAt(key, tdbFromTt(tt), ae) : null;
  return de ?? ae();
}

export function helioStateEcl(key, date) {
  const de = deState(key, date);
  if (de) return { r: eqjToEcl(de.r), v: eqjToEcl(de.v) };
  const s = Astronomy.HelioState(bodyOf(key), date);
  return toKm(Astronomy.RotateState(EQJ_TO_ECL, s));
}

const ECL_TO_EQJ = Astronomy.Rotation_ECL_EQJ();

// Rotate an ecliptic J2000 vector [x, y, z] back to equatorial J2000 (EQJ),
// the frame the n-body kernel uses.
export function eclToEqj(v) {
  const r = Astronomy.RotateVector(ECL_TO_EQJ, new Astronomy.Vector(v[0], v[1], v[2], new Astronomy.AstroTime(0)));
  return [r.x, r.y, r.z];
}

// Rotate an equatorial J2000 (EQJ) vector [x, y, z] into ecliptic J2000.
export function eqjToEcl(v) {
  const r = Astronomy.RotateVector(EQJ_TO_ECL, new Astronomy.Vector(v[0], v[1], v[2], new Astronomy.AstroTime(0)));
  return [r.x, r.y, r.z];
}
