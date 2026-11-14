// src/physics/orientation.js
//
// Body-fixed frames: which way each body is turned at a given time, so a
// surface map lands with the right longitude under the Sun.
//
//   bodyAxesEqj(key, date) -> [X, Y, Z]   body-fixed unit axes in J2000
//                                          equatorial (EQJ) coordinates
//
// X points to 0 deg longitude on the equator, Z to the north pole, Y = Z x X
// (east longitude positive). A vector v in EQJ has body-fixed components
// (X.v, Y.v, Z.v).
//
// Earth: from astronomy-engine's ObserverVector, which includes precession,
// nutation and Greenwich apparent sidereal time (not polar motion, ~10 m).
// Everything else: the IAU rotation model, pole (alpha0, delta0) and prime
// meridian angle W (Archinal et al., IAU WG on Cartographic Coordinates and
// Rotational Elements), via astronomy-engine's RotationAxis:
//
//   N = (-sin a0, cos a0, 0)                      node of the body's equator
//   Z = (cos d0 cos a0, cos d0 sin a0, sin d0)    north pole
//   X = cos W N + sin W (Z x N),   Y = Z x X
//
// The planets' 20 major moons: the same construction from the IAU models in
// NAIF's pck00011 (pck.data.js), evaluated as SPICE does (bodeul), with
// d days and T Julian centuries TDB from J2000:
//
//   theta_j = A_j + B_j T                 the system's angles (BODYn_NUT_PREC_ANGLES)
//   a0 = ra0 + ra1 T + ra2 T^2 + sum a_j sin theta_j
//   d0 = de0 + de1 T + de2 T^2 + sum d_j cos theta_j
//   W  = W0 + W1 d + W2 d^2 + sum w_j sin theta_j
//
// The sums carry each moon's forced libration and the precession of its
// orbit's plane (Triton's pole swings 32 deg in RA over 690 years).
//
// Checked against CSPICE pxform (ITRF93, MOON_ME, IAU_*) in
// orientation.test.mjs.

import * as Astronomy from 'astronomy-engine';
import { ttSeconds } from './ephemeris.js';   // also sets astronomy-engine's ΔT from the leap seconds
import { NUT_PREC_ANGLES, ROTATION } from './pck.data.js';

const AE_BODY = {
  sun: Astronomy.Body.Sun, mercury: Astronomy.Body.Mercury, venus: Astronomy.Body.Venus,
  moon: Astronomy.Body.Moon, mars: Astronomy.Body.Mars, jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn, uranus: Astronomy.Body.Uranus, neptune: Astronomy.Body.Neptune,
  pluto: Astronomy.Body.Pluto,
};

const DEG = Math.PI / 180;
const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Axes from a pole (a0, d0) and prime meridian W, radians.
function axesFrom(a0, d0, W) {
  const N = [-Math.sin(a0), Math.cos(a0), 0];
  const Z = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const ZxN = cross(Z, N);
  const X = [0, 1, 2].map((i) => Math.cos(W) * N[i] + Math.sin(W) * ZxN[i]);
  return [X, cross(Z, X), Z];
}

// A pck00011 rotation model at d days TDB from J2000 -> [a0, d0, W] degrees.
export function iauAngles(m, d) {
  const T = d / 36525;
  let a0 = m.ra[0] + m.ra[1] * T + m.ra[2] * T * T;
  let d0 = m.dec[0] + m.dec[1] * T + m.dec[2] * T * T;
  let W = m.pm[0] + m.pm[1] * d + m.pm[2] * d * d;
  if (m.system) {
    const ang = NUT_PREC_ANGLES[m.system];
    const theta = (j) => { const c = ang[j]; let t = 0; for (let k = c.length - 1; k >= 0; k--) t = t * T + c[k]; return t * DEG; };
    for (let j = 0; j < m.nutRa.length; j++) if (m.nutRa[j]) a0 += m.nutRa[j] * Math.sin(theta(j));
    for (let j = 0; j < m.nutDec.length; j++) if (m.nutDec[j]) d0 += m.nutDec[j] * Math.cos(theta(j));
    for (let j = 0; j < m.nutPm.length; j++) if (m.nutPm[j]) W += m.nutPm[j] * Math.sin(theta(j));
  }
  return [a0, d0, W];
}

// TT stands in for TDB (under 2 ms apart: 0.0006 deg of Phobos's turn).
const tdbDays = (date) => ttSeconds(date.getTime()) / 86400;

function earthAxes(date) {
  const at = (lat, lon) => {
    const v = Astronomy.ObserverVector(date, new Astronomy.Observer(lat, lon, 0), false);
    return unit([v.x, v.y, v.z]);
  };
  const X = at(0, 0);
  const Z = at(90, 0);
  return [X, unit(cross(Z, X)), Z];
}

export function bodyAxesEqj(key, date) {
  if (key === 'earth') return earthAxes(date);
  const moon = ROTATION[key];
  if (moon) {                            // the planets' moons: IAU, from pck00011
    const [a0, d0, W] = iauAngles(moon, tdbDays(date));
    return axesFrom(a0 * DEG, d0 * DEG, W * DEG);
  }
  const body = AE_BODY[key];
  if (body === undefined) throw new Error(`no rotation model for ${key}`);
  const ax = Astronomy.RotationAxis(body, date);
  return axesFrom(ax.ra * 15 * DEG, ax.dec * DEG, ax.spin * DEG);   // RotationAxis gives RA in hours
}
