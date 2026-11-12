// src/physics/ephemeris.js
//
// Heliocentric planet states from astronomy-engine, in the units the physics
// core uses (km, km/s). astronomy-engine works in AU and AU/day in its EQJ
// frame (J2000 mean equator, the same axes as SPICE "J2000").
//
//   helioStateEqj(key, date) -> { r, v }  equatorial J2000
//   helioStateEcl(key, date) -> { r, v }  ecliptic J2000 (rotated by the J2000
//                                         obliquity via astronomy-engine), the
//                                         frame Lambert's prograde test expects
//
// Keys are the lower-case names the simulation uses ('earth', 'mars', ...).
// Velocities come from HelioState directly, not from finite differences.

import * as Astronomy from 'astronomy-engine';

// Time scales. The app's clock is UTC; astronomy-engine takes UT and adds
// its ΔT = TT - UT, which past the end of its tables is an extrapolation:
// 75.2 s for 2026 against the true 69.2 s, so every body was computed 6 s
// late (180 km along Earth's orbit, 6 km along the Moon's; found by the
// Artemis II validation, docs/validation/artemis2.md). From 1972 ΔT is set
// from the leap-second table instead: TT - UTC = 32.184 s + (TAI - UTC),
// treating UTC as UT1 (they differ by under 0.9 s). Before 1972 the
// library's Espenak-Meeus model stands. Table: NAIF naif0012.tls.
const LEAP_SECONDS = [
  ['1972-01-01', 10], ['1972-07-01', 11], ['1973-01-01', 12], ['1974-01-01', 13], ['1975-01-01', 14],
  ['1976-01-01', 15], ['1977-01-01', 16], ['1978-01-01', 17], ['1979-01-01', 18], ['1980-01-01', 19],
  ['1981-07-01', 20], ['1982-07-01', 21], ['1983-07-01', 22], ['1985-07-01', 23], ['1988-01-01', 24],
  ['1990-01-01', 25], ['1991-01-01', 26], ['1992-07-01', 27], ['1993-07-01', 28], ['1994-07-01', 29],
  ['1996-01-01', 30], ['1997-07-01', 31], ['1999-01-01', 32], ['2006-01-01', 33], ['2009-01-01', 34],
  ['2012-07-01', 35], ['2015-07-01', 36], ['2017-01-01', 37],
].map(([d, s]) => [(Date.parse(`${d}T00:00:00Z`) - Date.UTC(2000, 0, 1, 12)) / 86400e3, s]);

// ΔT in seconds for ut in days from J2000 (astronomy-engine's convention).
export function deltaT(ut) {
  if (ut < LEAP_SECONDS[0][0]) return Astronomy.DeltaT_EspenakMeeus(ut);
  let tai = LEAP_SECONDS[0][1];
  for (const [d, s] of LEAP_SECONDS) if (ut >= d) tai = s;
  return 32.184 + tai;
}
Astronomy.SetDeltaTFunction(deltaT);

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

export function helioStateEqj(key, date) {
  return toKm(Astronomy.HelioState(bodyOf(key), date));
}

export function helioStateEcl(key, date) {
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
