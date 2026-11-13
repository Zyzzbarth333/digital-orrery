// src/physics/sixdof.js
//
// A 6-DOF rigid vehicle about the Earth: position and velocity in J2000
// with the Earth at the origin, and attitude and body rates, integrated
// together. It is the propagator NASA's 6-DOF check cases exercise
// (docs/validation.md#nesc-6-dof-check-cases). Pure ES module, SI units
// (m, m/s, kg, N, N m, rad).
//
// Force and torque models (each optional):
//   gravity      point mass mu, or a spherical-harmonic field (geopotential.js)
//                evaluated in the Earth-fixed frame and rotated back
//   third bodies point masses, with the indirect term (the Earth's own
//                acceleration toward each, which a geocentric frame subtracts)
//   drag         a ballistic coefficient: a = -rho |v_rel| v_rel Cd A / (2 m),
//                v_rel relative to an atmosphere turning with the Earth
//   force        thrust fixed in body axes, through the centre of mass
//   torque       fixed in body axes
//   gravity gradient  the point-mass torque 3 mu / r^3 (r_b x I r_b), r_b the
//                unit vector to the vehicle in body axes
//
// Integration: classical 4th-order Runge-Kutta at a fixed step, with steps
// cut to end exactly on output times and breakpoints (the edges of a burn or
// a torque), so a pulse switches on and off at its stated time.

import { geopotential } from './geopotential.js';
import { quatMul, quatNormalize, quatToMatrix, matVec, matTVec, invert3 } from './rigidbody.js';

export { geopotential };

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// model:
//   mu                    m^3/s^2
//   field                 a geopotential({...}) in metres, or null (point mass)
//   earthFixed(t)         J2000 -> Earth-fixed matrix at t (s from the epoch);
//                         needed for a field, drag, or Earth-fixed output
//   thirdBodies           [{ mu, at(t) -> geocentric J2000 position, m }]
//   drag                  { cdAOverM (m^2/kg), density(t, rEci, rEcef), omegaEarth }
//   force(t)              body-axis force, N (or null)
//   torque(t)             body-axis torque, N m (or null)
//   gravityGradient       true for the point-mass gravity-gradient torque
//   mass, inertia         kg; 3x3 kg m^2 about the centre of mass, body axes
//   breakpoints           times (s) a step must end on
export function makeModel(m) {
  const inertiaInv = invert3(m.inertia);
  const fixedCache = new Map();
  const earthFixed = (t) => {
    let M = fixedCache.get(t);
    if (!M) { M = m.earthFixed(t); if (fixedCache.size > 64) fixedCache.clear(); fixedCache.set(t, M); }
    return M;
  };
  // Gravitational acceleration (J2000) at r, time t.
  function gravitation(t, r) {
    let a;
    if (m.field) {
      const M = earthFixed(t);
      a = matTVec(M, m.field.accel(matVec(M, r)));
    } else {
      const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], k = -m.mu / (r2 * Math.sqrt(r2));
      a = [k * r[0], k * r[1], k * r[2]];
    }
    for (const b of m.thirdBodies ?? []) {
      const s = b.at(t), d = [s[0] - r[0], s[1] - r[1], s[2] - r[2]];
      const dn = Math.hypot(...d), sn = Math.hypot(...s);
      for (let i = 0; i < 3; i++) a[i] += b.mu * (d[i] / dn ** 3 - s[i] / sn ** 3);
    }
    return a;
  }
  // The non-gravitational acceleration (drag and thrust), J2000.
  function other(t, r, v, q, tPulse) {
    const a = [0, 0, 0];
    if (m.drag) {
      const M = earthFixed(t), pole = M[2];
      const w = [pole[0] * m.drag.omegaEarth, pole[1] * m.drag.omegaEarth, pole[2] * m.drag.omegaEarth];
      const wr = cross(w, r), vr = [v[0] - wr[0], v[1] - wr[1], v[2] - wr[2]], vn = Math.hypot(...vr);
      const k = -0.5 * m.drag.density(t, r, matVec(M, r)) * vn * m.drag.cdAOverM;
      for (let i = 0; i < 3; i++) a[i] += k * vr[i];
    }
    const F = m.force?.(tPulse);
    if (F) { const f = matVec(quatToMatrix(q), F); for (let i = 0; i < 3; i++) a[i] += f[i] / m.mass; }
    return a;
  }
  function torque(t, r, q, tPulse) {
    const tau = [0, 0, 0];
    const T = m.torque?.(tPulse);
    if (T) for (let i = 0; i < 3; i++) tau[i] += T[i];
    if (m.gravityGradient) {
      const rn = Math.hypot(...r), rb = matTVec(quatToMatrix(q), r).map((x) => x / rn);
      const g = cross(rb, matVec(m.inertia, rb)), k = 3 * m.mu / rn ** 3;
      for (let i = 0; i < 3; i++) tau[i] += k * g[i];
    }
    return tau;
  }
  // y = [r(3), v(3), q(4), omega(3)]. tPulse: the time at which a force or
  // torque pulse is judged on or off, the middle of the current step, so
  // every stage of a step sees the same switch state and a pulse starts and
  // stops on the step edges (which propagate6dof puts on its times).
  function deriv(t, y, tPulse = t) {
    const r = y.slice(0, 3), v = y.slice(3, 6), q = y.slice(6, 10), w = y.slice(10, 13);
    const g = gravitation(t, r), o = other(t, r, v, q, tPulse);
    const tau = torque(t, r, q, tPulse);
    const Iw = matVec(m.inertia, w), gyro = cross(w, Iw);
    const wDot = matVec(inertiaInv, [tau[0] - gyro[0], tau[1] - gyro[1], tau[2] - gyro[2]]);
    const qDot = quatMul(q, [0, w[0], w[1], w[2]]);
    return [v[0], v[1], v[2], g[0] + o[0], g[1] + o[1], g[2] + o[2], qDot[0] / 2, qDot[1] / 2, qDot[2] / 2, qDot[3] / 2, wDot[0], wDot[1], wDot[2]];
  }
  return { ...m, deriv, gravitation, other, torque, earthFixed };
}

// Propagate from state { t, r, v, q, omega } to tEnd, with step h (s),
// calling sample(state) at t0 and every outEvery s (and at tEnd).
// A step never crosses a breakpoint or an output time.
export function propagate6dof(model, s0, { tEnd, h = 1, outEvery = 60, sample }) {
  let t = s0.t;
  let y = [...s0.r, ...s0.v, ...s0.q, ...s0.omega];
  const stops = [...new Set([...(model.breakpoints ?? []), tEnd])].filter((b) => b > t).sort((a, b) => a - b);
  const emit = () => sample?.({ t, r: y.slice(0, 3), v: y.slice(3, 6), q: y.slice(6, 10), omega: y.slice(10, 13) });
  emit();
  let nextOut = t + outEvery, k = 0;
  const f = model.deriv;
  while (t < tEnd - 1e-9) {
    while (stops[k] <= t + 1e-9) k++;
    const limit = Math.min(stops[k] ?? tEnd, nextOut, tEnd);
    const dt = Math.min(h, limit - t);
    const mid = t + dt / 2;
    const k1 = f(t, y, mid);
    const y2 = y.map((x, i) => x + dt / 2 * k1[i]), k2 = f(mid, y2, mid);
    const y3 = y.map((x, i) => x + dt / 2 * k2[i]), k3 = f(mid, y3, mid);
    const y4 = y.map((x, i) => x + dt * k3[i]), k4 = f(t + dt, y4, mid);
    y = y.map((x, i) => x + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    const q = quatNormalize(y.slice(6, 10));
    y[6] = q[0]; y[7] = q[1]; y[8] = q[2]; y[9] = q[3];
    t = Math.abs(t + dt - limit) < 1e-9 ? limit : t + dt;
    if (t >= nextOut - 1e-9) { emit(); nextOut += outEvery; }
  }
  return { t, r: y.slice(0, 3), v: y.slice(3, 6), q: y.slice(6, 10), omega: y.slice(10, 13) };
}

// --- outputs in the check cases' conventions ---

// The local-vertical local-horizontal frame as rows (J2000 -> LVLH):
// z to the Earth's centre, y against the orbital angular momentum.
export function lvlhMatrix(r, v) {
  const rn = Math.hypot(...r), z = r.map((x) => -x / rn);
  const h = cross(r, v), hn = Math.hypot(...h), y = h.map((x) => -x / hn);
  return [cross(y, z), y, z];
}

// 3-2-1 (yaw, pitch, roll) angles of a frame-to-body matrix B (rows: body
// axes in the frame).
export function euler321(B) {
  return { roll: Math.atan2(B[1][2], B[2][2]), pitch: -Math.asin(Math.max(-1, Math.min(1, B[0][2]))), yaw: Math.atan2(B[0][1], B[0][0]) };
}

// Geodetic height (m) on an ellipsoid of equatorial radius a and
// flattening f, from an Earth-fixed position (Bowring's iteration).
export function geodetic(rEcef, a, f) {
  const [x, y, z] = rEcef, e2 = f * (2 - f), p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2)), N = a, hgt = 0;
  for (let i = 0; i < 8; i++) {
    const s = Math.sin(lat);
    N = a / Math.sqrt(1 - e2 * s * s);
    hgt = p / Math.cos(lat) - N;
    lat = Math.atan2(z, p * (1 - e2 * N / (N + hgt)));
  }
  return { lat, lon: Math.atan2(y, x), h: hgt };
}
