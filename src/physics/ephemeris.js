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
// the frame the scene is drawn in.
export function eclToEqj(v) {
  const r = Astronomy.RotateVector(ECL_TO_EQJ, new Astronomy.Vector(v[0], v[1], v[2], new Astronomy.AstroTime(0)));
  return [r.x, r.y, r.z];
}
