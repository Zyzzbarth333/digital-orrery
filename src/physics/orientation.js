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
// The planets' moons turn synchronously, 0 deg longitude toward the planet
// (moons.js, moonAxesEqj).
//
// Checked against CSPICE pxform (ITRF93, MOON_ME, IAU_*) in
// orientation.test.mjs.

import * as Astronomy from 'astronomy-engine';
import './ephemeris.js';               // sets astronomy-engine's ΔT from the leap seconds
import { isMoonKey, moonAxesEqj } from './moons.js';

const AE_BODY = {
  sun: Astronomy.Body.Sun, mercury: Astronomy.Body.Mercury, venus: Astronomy.Body.Venus,
  moon: Astronomy.Body.Moon, mars: Astronomy.Body.Mars, jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn, uranus: Astronomy.Body.Uranus, neptune: Astronomy.Body.Neptune,
  pluto: Astronomy.Body.Pluto,
};

const DEG = Math.PI / 180;
const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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
  if (isMoonKey(key)) return moonAxesEqj(key, date);     // the planets' moons: synchronous (moons.js)
  const body = AE_BODY[key];
  if (body === undefined) throw new Error(`no rotation model for ${key}`);
  const ax = Astronomy.RotationAxis(body, date);
  const a0 = ax.ra * 15 * DEG;           // RotationAxis gives RA in hours
  const d0 = ax.dec * DEG;
  const W = ax.spin * DEG;
  const N = [-Math.sin(a0), Math.cos(a0), 0];
  const Z = [Math.cos(d0) * Math.cos(a0), Math.cos(d0) * Math.sin(a0), Math.sin(d0)];
  const ZxN = cross(Z, N);
  const X = [0, 1, 2].map((i) => Math.cos(W) * N[i] + Math.sin(W) * ZxN[i]);
  return [X, cross(Z, X), Z];
}
