// src/physics/ephemeris.js
//
// Heliocentric states of the planets, Pluto and the Moon, in the units the
// physics core uses (km, km/s): from DE442 (deTable.js) once its table is
// installed, within 2000-2050, and from astronomy-engine outside it (or
// without the table). Mars to Pluto are their systems' barycentres, in both.
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
import { deHelioState, deSunFromSsb, DE_KEYS } from './deTable.js';

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

// A body from DE442 (deTable.js) when its table is installed and covers the
// date; null otherwise.
function deState(key, date) {
  if (!IN_DE.has(key)) return null;
  const ms = date.getTime();
  return ms >= LEAP_TABLE_START_MS ? deHelioState(key, tdbSeconds(ms)) : null;
}

/** Whether a body's state at this date comes from DE442's table (else
 *  astronomy-engine): what the data plate's tags name. 'sun' and 'ssb' ask
 *  about the solar system barycentre (DE442's own, else a sum of GMs). */
export function fromDe442(key, date) {
  if (key === 'sun' || key === 'ssb') return deSsbEqj(date) !== null;
  return deState(key, date) !== null;
}

/** The solar system barycentre relative to the Sun, EQJ km and km/s, from
 *  DE442 (the Sun's own series, which counts every body JPL integrates), or
 *  null outside the table. */
export function deSsbEqj(date) {
  const ms = date.getTime();
  const s = ms >= LEAP_TABLE_START_MS ? deSunFromSsb(tdbSeconds(ms)) : null;
  return s && { r: [-s.r[0], -s.r[1], -s.r[2]], v: [-s.v[0], -s.v[1], -s.v[2]] };
}

export function helioStateEqj(key, date) {
  return deState(key, date) ?? toKm(Astronomy.HelioState(bodyOf(key), date));
}

// The same at TT seconds past J2000 (the kernel's bodies, bodies.js): no
// UTC in the way, so nothing stands still through a leap second.
export function helioStateEqjAtTt(key, tt) {
  const de = IN_DE.has(key) && tt >= LEAP_TABLE_START_TT ? deHelioState(key, tdbFromTt(tt)) : null;
  return de ?? toKm(Astronomy.HelioState(bodyOf(key), Astronomy.AstroTime.FromTerrestrialTime(tt / 86400)));
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
