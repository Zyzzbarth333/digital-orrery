// src/physics/nesc.lib.mjs
//
// NASA's 6-DOF orbital check cases (NESC, NASA/TM-2015-218675, 2015) set
// up for sixdof.js: constants, vehicles, initial states and each case's
// models, as the report and its data define them. Where the report's tables
// and the four NASA simulations' data disagree, the data's version is used
// and the difference noted (docs/validation.md#nesc-6-dof-check-cases).

import { makeModel, propagate6dof, lvlhMatrix, euler321, geodetic, geopotential } from './sixdof.js';
import { earthFixedMatrix, R2, R3 } from './earthRotation.js';
import { matrixToQuat, matMul, transpose, quatToMatrix, matVec } from './rigidbody.js';
import { helioStateEqj } from './ephemeris.js';

// Constants of the orbital cases (the report's Table 73; not WGS-84).
export const EPOCH_MS = Date.UTC(2007, 10, 20);       // 2007/324 00:00:00 UTC
export const MU = 3.98600436e14;
export const RE = 6378137.0;
export const FLATTENING = 1 / 298.3;
export const OMEGA_E = 7.29211514670638e-5;
export const MU_SUN = 1.3271244e20, MU_MOON = 4.90266e12;
export const TIME = { leapSeconds: 32, dut1: -0.469 };   // as the report gives them
const D2R = Math.PI / 180;

// GEM-T1, fully normalised, degree and order 2 to 8 (the report's Table 74).
const GEMT1 = [
  [2, 0, -4.8416499e-04, 0], [2, 1, 0, 0], [2, 2, 2.4389280e-06, -1.3998397e-06],
  [3, 0, 9.5723751e-07, 0], [3, 1, 2.0297737e-06, 2.4959463e-07], [3, 2, 9.0354910e-07, -6.2041982e-07], [3, 3, 7.2098662e-07, 1.4131694e-06],
  [4, 0, 5.3873219e-07, 0], [4, 1, -5.3342722e-07, -4.7511891e-07], [4, 2, 3.4700208e-07, 6.6403042e-07], [4, 3, 9.9097790e-07, -2.0062149e-07], [4, 4, -1.9003480e-07, 3.0845955e-07],
  [5, 0, 6.8780161e-08, 0], [5, 1, -5.8950310e-08, -9.5543463e-08], [5, 2, 6.5579025e-07, -3.2340559e-07], [5, 3, -4.4820358e-07, -2.1513633e-07], [5, 4, -2.9482361e-07, 5.2408737e-08], [5, 5, 1.7775628e-07, -6.6602811e-07],
  [6, 0, -1.4810038e-07, 0], [6, 1, -8.1375094e-08, 2.3890050e-08], [6, 2, 5.1609578e-08, -3.7499560e-07], [6, 3, 6.1970909e-08, 4.6429830e-09], [6, 4, -9.2797469e-08, -4.7330695e-07], [6, 5, -2.6576497e-07, -5.3774724e-07], [6, 6, 9.0593110e-09, -2.3633442e-07],
  [7, 0, 9.0533705e-08, 0], [7, 1, 2.7709714e-07, 9.7817738e-08], [7, 2, 3.1771079e-07, 9.1608267e-08], [7, 3, 2.5074289e-07, -2.0916391e-07], [7, 4, -2.7374044e-07, -1.2202073e-07], [7, 5, 3.4749784e-09, 1.9651896e-08], [7, 6, -3.5785266e-07, 1.5091751e-07], [7, 7, 1.5976040e-09, 2.2001281e-08],
  [8, 0, 4.5902321e-08, 0], [8, 1, 2.8856051e-08, 5.4722278e-08], [8, 2, 7.0380074e-08, 6.8449357e-08], [8, 3, -1.9966400e-08, -8.6936688e-08], [8, 4, -2.4606388e-07, 6.7745274e-08], [8, 5, -2.4933453e-08, 8.5300324e-08], [8, 6, -6.6417800e-08, 3.1283228e-07], [8, 7, 7.0424829e-08, 7.4862572e-08], [8, 8, -1.1888272e-07, 1.2233200e-07],
];
// The coefficients to degree n, km units (for environment.js), and the
// field in metres (for sixdof.js).
export function gemT1Coefficients(n) {
  const C = [], S = [];
  for (let i = 0; i <= n; i++) { C.push(new Array(i + 1).fill(0)); S.push(new Array(i + 1).fill(0)); }
  C[0][0] = 1;
  for (const [i, j, c, s] of GEMT1) if (i <= n) { C[i][j] = c; S[i][j] = s; }
  return { gm: MU / 1e9, radius: RE / 1000, C, S };
}
export function gemT1(n) {
  const { C, S } = gemT1Coefficients(n);
  return geopotential({ mu: MU, radius: RE, n, C, S, normalized: true });
}

// Vehicles: mass, inertia about the centre of mass (body axes). The ISS's
// products of inertia enter the tensor with a minus sign (the report's
// eq. 3; its data confirm it).
const diag = (a, b, c) => [[a, 0, 0], [0, b, 0], [0, 0, c]];
export const VEHICLES = {
  iss: { mass: 400000, inertia: [[1.02e8, -6.96e6, -5.48e6], [-6.96e6, 0.91e8, 5.90e5], [-5.48e6, 5.90e5, 1.64e8]], cd: 2, area: 1400 },
  sphere: { mass: 1, inertia: diag(2 / (5 * Math.PI), 2 / (5 * Math.PI), 2 / (5 * Math.PI)), cd: 0.02, area: 1 },
  cylinder: { mass: 1000, inertia: diag(500, 12250, 12250) },
};

// The two orbits (J2000, m and m/s).
export const ORBITS = {
  circular: { r: [-4292653.41, 955168.47, 5139356.57], v: [109.649663, -7527.726490, 1484.521489] },
  elliptical: { r: [-4315967.74, 960356.20, 5167269.53], v: [129.091037, -7491.513855, 1452.515654] },
};

const pulse = (t0, dur, vec) => (t) => (t >= t0 && t < t0 + dur ? vec : null);

// The cases. att: body from LVLH, as a matrix; rate: 'lvlh' (held in LVLH,
// the data's version of the tables' -0.065 deg/s), 'zero' (inertially
// still), or LVLH plus an extra body-axis rate.
const STD = { att: () => R2(-11.6 * D2R), rate: 'lvlh' };
const ISS_C = { vehicle: 'iss', orbit: 'circular', ...STD };
const ISS_E = { vehicle: 'iss', orbit: 'elliptical', ...STD };
const SPH_E = { vehicle: 'sphere', orbit: 'elliptical', ...STD };
const CYL10 = { vehicle: 'cylinder', gravityGradient: true, att: () => matMul(R3(1 * D2R), R2(85 * D2R)) };
const torque9 = pulse(1000, 1000, [10, 0, 0]), force9 = pulse(1000, 1000, [10, 0, 0]);
export const CASES = {
  '02': { ...ISS_C, title: 'ISS, point-mass Earth' },
  '03A': { ...ISS_C, harmonics: 4, title: 'ISS, 4x4 GEM-T1 gravity' },
  '03B': { ...ISS_C, harmonics: 8, title: 'ISS, 8x8 GEM-T1 gravity' },
  '04': { ...ISS_C, sunMoon: true, title: 'ISS, Sun and Moon' },
  '05A': { ...ISS_E, met: true, title: 'ISS, low solar activity (atmosphere only)' },
  '05B': { ...ISS_E, met: true, title: 'ISS, mean solar activity (atmosphere only)' },
  '05C': { ...ISS_E, met: true, title: 'ISS, high solar activity (atmosphere only)' },
  '06A': { ...SPH_E, drag: 'constant', title: 'sphere, drag at constant density' },
  '06B': { ...SPH_E, drag: 'met', title: 'sphere, drag in the MET atmosphere' },
  '06C': { vehicle: 'cylinder', orbit: 'circular', att: () => R2(0), rate: 'lvlh', force: pulse(1000, 93, [0, -29000, 0]), breakpoints: [1000, 1093], title: 'cylinder, plane-change burn' },
  '06D': { vehicle: 'cylinder', orbit: 'circular', att: () => R2(0), rate: 'lvlh', force: pulse(1000, 48, [66400, 0, 0]), breakpoints: [1000, 1048], title: 'cylinder, Earth-departure burn' },
  '07A': { ...SPH_E, harmonics: 4, sunMoon: true, title: 'sphere, 4x4, Sun and Moon' },
  '07B': { ...SPH_E, harmonics: 8, sunMoon: true, title: 'sphere, 8x8, Sun and Moon' },
  '07C': { ...SPH_E, harmonics: 4, sunMoon: true, drag: 'met', title: 'sphere, 4x4, Sun, Moon and drag' },
  '07D': { ...SPH_E, harmonics: 8, sunMoon: true, drag: 'met', title: 'sphere, 8x8, Sun, Moon and drag' },
  '08A': { ...ISS_C, rate: 'zero', title: 'ISS, torque-free, inertially still' },
  '08B': { ...ISS_C, title: 'ISS, torque-free, turning' },
  '09A': { ...ISS_C, rate: 'zero', torque: torque9, breakpoints: [1000, 2000], title: 'ISS, still, torque pulse' },
  '09B': { ...ISS_C, torque: torque9, breakpoints: [1000, 2000], title: 'ISS, turning, torque pulse' },
  '09C': { ...ISS_C, rate: 'zero', torque: torque9, force: force9, breakpoints: [1000, 2000], title: 'ISS, still, torque and force pulse' },
  '09D': { ...ISS_C, torque: torque9, force: force9, breakpoints: [1000, 2000], title: 'ISS, turning, torque and force pulse' },
  '10A': { ...CYL10, orbit: 'circular', rate: 'lvlh', title: 'cylinder, gravity gradient' },
  '10B': { ...CYL10, orbit: 'circular', rate: [0, 0.01 * D2R, 0], title: 'cylinder, gravity gradient, pitching' },
  '10C': { ...CYL10, orbit: 'elliptical', rate: 'lvlh', title: 'cylinder, gravity gradient, elliptical' },
  '10D': { ...CYL10, orbit: 'elliptical', rate: [0, 0.01 * D2R, 0], title: 'cylinder, gravity gradient, elliptical, pitching' },
  '11': { ...ISS_E, harmonics: 8, sunMoon: true, drag: 'met', gravityGradient: true, title: 'ISS, everything (8x8, Sun, Moon, drag, gravity gradient)' },
};

export const earthFixedAt = (t) => earthFixedMatrix(EPOCH_MS + t * 1000, TIME).M;

// Geocentric J2000 position (m) of the Sun or the Moon, from the app's
// ephemeris (DE442; NASA's tools used DE405).
const geocentricOf = (key) => (t) => {
  const d = new Date(EPOCH_MS + t * 1000), e = helioStateEqj('earth', d).r;
  if (key === 'sun') return [-e[0] * 1e3, -e[1] * 1e3, -e[2] * 1e3];
  const b = helioStateEqj(key, d).r;
  return [(b[0] - e[0]) * 1e3, (b[1] - e[1]) * 1e3, (b[2] - e[2]) * 1e3];
};

// The initial state of a case.
export function initialState(c) {
  const { r, v } = ORBITS[c.orbit];
  const L = lvlhMatrix(r, v);
  const B = matMul(c.att(), L);                        // J2000 -> body
  const n0 = Math.hypot(...[r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]]) / (r[0] ** 2 + r[1] ** 2 + r[2] ** 2);
  const lvlhRate = matVec(c.att(), [0, -n0, 0]);       // held in LVLH, body axes
  const omega = c.rate === 'zero' ? [0, 0, 0] : c.rate === 'lvlh' ? lvlhRate : lvlhRate.map((x, i) => x + c.rate[i]);
  return { t: 0, r: [...r], v: [...v], q: matrixToQuat(transpose(B)), omega };
}

// Run a case. density(t) supplies the atmosphere for the drag cases that
// use NASA's MET model (not reproduced here: see the docs).
export function runCase(key, { h = 1, density = null, outEvery = 60, tEnd = 28800 } = {}) {
  const c = CASES[key], veh = VEHICLES[c.vehicle];
  const drag = c.drag === 'constant' ? () => 1.4e-12 : c.drag === 'met' ? density : null;
  const model = makeModel({
    mu: MU, field: c.harmonics ? gemT1(c.harmonics) : null, earthFixed: earthFixedAt,
    thirdBodies: c.sunMoon ? [{ mu: MU_SUN, at: geocentricOf('sun') }, { mu: MU_MOON, at: geocentricOf('moon') }] : [],
    drag: drag ? { cdAOverM: veh.cd * veh.area / veh.mass, density: drag, omegaEarth: OMEGA_E } : null,
    force: c.force, torque: c.torque, gravityGradient: !!c.gravityGradient,
    mass: veh.mass, inertia: veh.inertia, breakpoints: c.breakpoints,
  });
  const out = [];
  propagate6dof(model, initialState(c), {
    tEnd, h, outEvery,
    sample: (s) => {
      const M = earthFixedAt(s.t), ecef = matVec(M, s.r);
      const B = transpose(quatToMatrix(s.q));            // J2000 -> body
      out.push({
        t: s.t, r: s.r, v: s.v, q: s.q, ecef, omega: s.omega,
        eulerEci: euler321(B), eulerLvlh: euler321(matMul(B, transpose(lvlhMatrix(s.r, s.v)))),
        alt: geodetic(ecef, RE, FLATTENING).h, gravitation: model.gravitation(s.t, s.r),
      });
    },
  });
  return out;
}
