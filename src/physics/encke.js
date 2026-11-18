// src/physics/encke.js
//
// Encke's method inside a body's sphere of influence (docs/physics/nbody-kernel.md#enckes-method).
//
// Relative to the primary P, the craft's position is a two-body conic plus a
// small deviation:  rho(t) = rho_ref(t) + delta(t). Only delta is integrated:
//
//   delta'' = (mu / |rho_ref|^3) [ (1 - g) rho - delta ] + a_pert,
//   g = |rho_ref|^3 / |rho|^3 = (1 + q)^(-3/2),
//   q = delta . (delta + 2 rho_ref) / |rho_ref|^2,
//   1 - g = q (3 + 3q + q^2) / ( ((1+q)^(3/2) + 1) (1+q)^(3/2) )
//
// (Battin's form, which never subtracts two nearly equal accelerations), and
//
//   a_pert = muSun (rP/|rP|^3 - r/|r|^3)
//            + sum_{j != P} mu_j [ (r_j - r)/|r_j - r|^3 - (r_j - rP)/|r_j - rP|^3 ]
//            + sum_j a_J2,j  (the primary's J2 too: zonal.js)
//            + thrust,
//
// the craft's acceleration less the primary's, both from the force model:
// each body acts only by its tide across rho (perturbationTidal). The
// ephemeris places the primary and the other bodies, but its acceleration
// never enters the motion about the primary. That matters: a Chebyshev
// ephemeris holds position far better than acceleration (DE442's Earth
// scatters by 3e-9 m/s^2 about the forces on it), and a craft in orbit about
// the Earth would otherwise follow that scatter. On NASA's Sun-and-Moon
// check case (nesc.test.mjs) this takes the kernel from 0.12 m to 5 mm
// after 8 hours. The older form, { tidal: false }, subtracts instead the
// primary's acceleration from the ephemeris (the second derivative of its
// Hermite cubic), so r = rP + rho obeys exactly the Cowell kernel's
// heliocentric equation; the two differ by the ephemeris's own fitting
// noise. (With astronomy-engine's Earth, before the DE442 table, the
// difference was ~1e-10 km/s^2: 23 km after 10 days at GEO.)
//
// The conic is carried from step to step with keplerStep (universal
// variables, warm-started Newton), and re-anchored on the current state
// (rectified) when |delta| exceeds RECTIFY |rho|. Each step is a
// Dormand-Prince 5(4) step with error control on delta, ending on the
// primary's ephemeris nodes (where rP'' jumps). Steps are also capped by 1 %
// of every other body's dynamical time, and on a conic whose periapsis lies
// inside the primary by 1 % of the primary's, so the end-of-step impact check
// is as tight as in the Cowell kernel.
//
// Encke pays only while the motion is nearly Keplerian. The kernel judges
// that by the size of the tides, not their momentary value (which passes
// through zero twice an orbit as the geometry turns): the ratio
//   ( sum_j 2 mu_j rho / (d_j - rho)^3 + |thrust| ) / (mu / rho^2)
// over the Sun and every other body, d_j its distance from the primary.
// Encke below ENCKE_IN, Cowell above ENCKE_OUT (hysteresis): low Earth orbit
// ~2e-7 is Encke; GEO ~5e-5 and beyond, and thrusting craft, are Cowell.

import { keplerStep, propagate } from './orbital.js';
import { addJ2, below } from './zonal.js';
import { locateImpact, dp45Dense } from './impact.js';

// Dormand-Prince 5(4) (Dormand & Prince 1980): nodes, stage weights, the
// 5th-order solution b (= the last stage row, FSAL) and the error weights
// e = b - b*, where b* is the embedded 4th-order solution.
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const E = [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40];
// The tableau, for the error-controlled Cowell integrator (nbody.js).
export const DP45 = { C, A, E };

export const ENCKE_IN = 1e-5;
export const ENCKE_OUT = 3e-5;
const RECTIFY = 1e-4;
// Math.hypot is several times slower than this in V8, and runs per stage.
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const ZERO = [0, 0, 0];
const SAFETY = 0.9;

// The older perturbation ({ tidal: false }): the craft's heliocentric
// acceleration without P's direct pull, minus P's ephemeris acceleration aP,
//   -muSun c/|c|^3 - mu_P rP/|rP|^3
//   + sum_{j != P} mu_j [ (r_j - c)/|r_j - c|^3 - r_j/|r_j|^3 ] + J2 - aP,
// at heliocentric craft position c, primary P at rP, into out. When the
// kernel integrates about the SSB (sunAcc, the Sun's acceleration about it
// from DE442), the Sun's own acceleration is DE442's instead of the sum of
// indirect terms: those drop out and -sunAcc takes their place.
function perturbation(c, rP, aP, key, mu, bodies, muSun, out, sunAcc = null) {
  const c2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
  const p2 = rP[0] * rP[0] + rP[1] * rP[1] + rP[2] * rP[2];
  const ind = sunAcc ? 0 : 1;
  const kc = muSun / (c2 * Math.sqrt(c2)), kp = ind * mu / (p2 * Math.sqrt(p2));
  const s = sunAcc ?? ZERO;
  let ax = -kc * c[0] - kp * rP[0] - aP[0] - s[0];
  let ay = -kc * c[1] - kp * rP[1] - aP[1] - s[1];
  let az = -kc * c[2] - kp * rP[2] - aP[2] - s[2];
  out[0] = ax; out[1] = ay; out[2] = az;
  for (let j = 0; j < bodies.length; j++) {
    const b = bodies[j];
    const p = b.r;
    const ex = p[0] - c[0], ey = p[1] - c[1], ez = p[2] - c[2];
    const e2 = ex * ex + ey * ey + ez * ez;
    if (b.j2 && e2 < b.j2Cut2) addJ2(-ex, -ey, -ez, e2, b, out);
    if (b.key === key) continue;
    const q2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
    const ke = b.mu / (e2 * Math.sqrt(e2)), kj = ind * b.mu / (q2 * Math.sqrt(q2));
    out[0] += ke * ex - kj * p[0]; out[1] += ke * ey - kj * p[1]; out[2] += ke * ez - kj * p[2];
  }
  return out;
}

// The same perturbation in tidal form: the craft's acceleration less the
// primary's, both from the force model, so each body pulls only by its
// tide across rho = c - rP:
//   a_pert = muSun (rP/|rP|^3 - c/|c|^3)
//            + sum_{j != P} mu_j [ (r_j - c)/|r_j - c|^3 - (r_j - rP)/|r_j - rP|^3 ]
//            + sum_j a_J2,j(c)
// (the indirect terms r_j/|r_j|^3 cancel, so it is the same whether the
// kernel integrates about the Sun or about the SSB). The ephemeris then only places
// the primary and the other bodies; its acceleration, which carries the
// fitting noise of its Chebyshev records (3e-9 m/s^2 for DE442's Earth),
// never enters the motion about the primary.
function perturbationTidal(c, rP, key, bodies, muSun, out) {
  const c2 = c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
  const p2 = rP[0] * rP[0] + rP[1] * rP[1] + rP[2] * rP[2];
  const kc = muSun / (c2 * Math.sqrt(c2)), kp = muSun / (p2 * Math.sqrt(p2));
  out[0] = kp * rP[0] - kc * c[0]; out[1] = kp * rP[1] - kc * c[1]; out[2] = kp * rP[2] - kc * c[2];
  for (let j = 0; j < bodies.length; j++) {
    const b = bodies[j];
    const p = b.r;
    const ex = p[0] - c[0], ey = p[1] - c[1], ez = p[2] - c[2];
    const e2 = ex * ex + ey * ey + ez * ez;
    if (b.j2 && e2 < b.j2Cut2) addJ2(-ex, -ey, -ez, e2, b, out);
    if (b.key === key) continue;
    const fx = p[0] - rP[0], fy = p[1] - rP[1], fz = p[2] - rP[2];
    const f2 = fx * fx + fy * fy + fz * fz;
    const ke = b.mu / (e2 * Math.sqrt(e2)), kf = b.mu / (f2 * Math.sqrt(f2));
    out[0] += ke * ex - kf * fx; out[1] += ke * ey - kf * fy; out[2] += ke * ez - kf * fz;
  }
  return out;
}

// The tidal ratio (above) at distance rho from the primary at rP.
function tideRatio(rho, rP, key, mu, bodies, muSun, thrustMag) {
  const dS = Math.max(len3(rP[0], rP[1], rP[2]) - rho, 1);
  let tide = 2 * muSun * rho / (dS * dS * dS);
  for (let j = 0; j < bodies.length; j++) {
    const b = bodies[j];
    if (b.key === key) continue;
    const d = Math.max(len3(b.r[0] - rP[0], b.r[1] - rP[1], b.r[2] - rP[2]) - rho, 1);
    tide += 2 * b.mu * rho / (d * d * d);
  }
  return (tide + thrustMag) * rho * rho / mu;
}

// The tidal ratio for a heliocentric state r at time t, thrust included.
// Used by advance() to choose between Encke and Cowell.
export function perturbationRatio(r, t, P, bodies, muSun, thrust = null) {
  const rP = P.eph.position(t);
  const rho = len3(r[0] - rP[0], r[1] - rP[1], r[2] - rP[2]);
  const th = thrust ? len3(thrust[0], thrust[1], thrust[2]) : 0;
  return tideRatio(rho, rP, P.key, P.mu, bodies, muSun, th);
}

function conicStep(r0, v0, dt, mu, rOut, vOut) {
  if (keplerStep(r0, v0, dt, mu, rOut, vOut)) return;
  const s = propagate(r0, v0, dt, mu);
  if (!s) throw new Error('encke: reference conic failed to propagate');
  for (let i = 0; i < 3; i++) { rOut[i] = s.r[i]; vOut[i] = s.v[i]; }
}

// A budget in wall time as well as in steps: deadline is a performance.now()
// time (ms) after which an advance stops before its next step, as it does
// when maxSteps runs out. At least one step is always taken, so a run of
// short budgets still gets on.
export function outOfTime(deadline, steps) {
  return deadline != null && steps > 0 && performance.now() >= deadline;
}

// opts: bodiesAt, muSun, tolKm (default 1e-7 km per step), hMax, eta
// (other-body step fraction, default 0.01), maxSteps, deadline, breakpoints,
// extraAccel(t, r, out, mid), sunRadius, primaryOf, tidal (default true:
// the tidal perturbation above; false for the ephemeris form).
// Returns { steps, events, complete, left }: left is true when the craft
// left the primary's sphere of influence or the motion stopped being nearly
// Keplerian; advance() then continues with the right integrator.
export function advanceEncke(state, tEnd, opts) {
  const {
    bodiesAt, muSun, tolKm = 1e-7, hMax = 86400, eta = 0.01, maxSteps = 200000,
    breakpoints = null, extraAccel = null, sunRadius = 695700, primaryOf, tidal = true,
  } = opts;
  const focus = opts.focus ?? bodiesAt.focus;
  // About the SSB (advance()), Encke still works in heliocentric
  // coordinates: its tidal form is the same in either frame, and its older
  // form takes the Sun's acceleration from DE442 (opts.ssb).
  const ssb = opts.ssb ?? null, sunAcc = ssb ? [0, 0, 0] : null;
  const key = state.primary;
  const bodies0 = () => bodiesAt(state.t);
  const P = bodies0().find((b) => b.key === key);
  const mu = P.mu;
  const rP = [0, 0, 0], vP = [0, 0, 0], aP = [0, 0, 0];

  // The conic's state at the current time, and the deviation from it.
  P.eph.position(state.t, rP); P.eph.velocity(state.t, vP);
  const cR = [state.r[0] - rP[0], state.r[1] - rP[1], state.r[2] - rP[2]];
  const cV = [state.v[0] - vP[0], state.v[1] - vP[1], state.v[2] - vP[2]];
  const y = [0, 0, 0, 0, 0, 0];

  const extra = [0, 0, 0], pert = [0, 0, 0], cpos = [0, 0, 0];
  let mid = state.t, lastThrust = 0;

  // The other bodies within a step. They act on the craft only through
  // their tides across rho, so each step evaluates them once at its far end
  // (position and velocity; the near end is the last step's far end) and
  // places them at the stages by the cubic through the two ends. Against
  // their own cubics that is (h n)^4 a / 384 for a step h: 1e-12 km for the
  // Moon in low Earth orbit, 1e-4 km over a two-hour step near apogee, where
  // the tide it changes is 1e-15 km/s^2. The primary is placed exactly at
  // every stage, from its own ephemeris. Before, every stage placed every
  // body: six cubics each where now there are two.
  let sList = null, sCopies = null, sP = -1, sT0 = NaN, sH = NaN, sEnds = null;
  const stepBodies = (list, t0, H) => {
    if (list !== sList) {
      sList = list;
      sCopies = list.map((b) => ({ key: b.key, mu: b.mu, radius: b.radius, parent: b.parent, r: [0, 0, 0],
        j2: b.j2, rJ2: b.rJ2, j2Cut2: b.j2Cut2, c22: b.c22, pole: b.pole, axisX: b.axisX, axisY: b.axisY }));
      sP = list.findIndex((b) => b.key === key);
      sEnds = new Float64Array(list.length * 12);    // r0 v0 r1 v1 for each body
      sT0 = NaN;
    }
    const n = list.length;
    if (t0 !== sT0) {
      for (let j = 0; j < n; j++) {
        const b = list[j], o = 12 * j;
        sEnds[o] = b.r[0]; sEnds[o + 1] = b.r[1]; sEnds[o + 2] = b.r[2];
        if (b.eph) { b.eph.velocity(t0, vTmp); sEnds[o + 3] = vTmp[0]; sEnds[o + 4] = vTmp[1]; sEnds[o + 5] = vTmp[2]; } else { sEnds[o + 3] = sEnds[o + 4] = sEnds[o + 5] = 0; }
        const c = sCopies[j];
        c.pole = b.pole; c.axisX = b.axisX; c.axisY = b.axisY;
      }
      sT0 = t0; sH = NaN;
    }
    if (H !== sH) {
      for (let j = 0; j < n; j++) {
        const b = list[j], o = 12 * j;
        if (j === sP || !b.eph) { for (let i = 0; i < 6; i++) sEnds[o + 6 + i] = sEnds[o + i] + (i < 3 ? H * sEnds[o + 3 + i] : 0); continue; }
        b.eph.position(t0 + H, rTmp); b.eph.velocity(t0 + H, vTmp);
        sEnds[o + 6] = rTmp[0]; sEnds[o + 7] = rTmp[1]; sEnds[o + 8] = rTmp[2];
        sEnds[o + 9] = vTmp[0]; sEnds[o + 10] = vTmp[1]; sEnds[o + 11] = vTmp[2];
      }
      sH = H;
    }
  };
  const rTmp = [0, 0, 0], vTmp = [0, 0, 0];
  // The bodies at a stage time t of the step from sT0 over sH.
  const stageBodies = (t) => {
    const s1 = (t - sT0) / sH, s2 = s1 * s1, s3 = s2 * s1;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s1) * sH, h01 = -2 * s3 + 3 * s2, h11 = (s3 - s2) * sH;
    for (let j = 0; j < sCopies.length; j++) {
      const q = sCopies[j].r;
      if (j === sP) { q[0] = rP[0]; q[1] = rP[1]; q[2] = rP[2]; continue; }
      const o = 12 * j;
      q[0] = h00 * sEnds[o] + h10 * sEnds[o + 3] + h01 * sEnds[o + 6] + h11 * sEnds[o + 9];
      q[1] = h00 * sEnds[o + 1] + h10 * sEnds[o + 4] + h01 * sEnds[o + 7] + h11 * sEnds[o + 10];
      q[2] = h00 * sEnds[o + 2] + h10 * sEnds[o + 5] + h01 * sEnds[o + 8] + h11 * sEnds[o + 11];
    }
    return sCopies;
  };
  // d/dt of [delta, delta'] at time t, with the conic at rr.
  const cvel = [0, 0, 0], vPt = [0, 0, 0];
  const f = (t, yy, rr, out, rv) => {
    P.eph.position(t, rP);
    const bodies = stageBodies(t);
    if (!tidal) P.eph.acceleration(t, aP);
    const dx = yy[0], dy = yy[1], dz = yy[2];
    const rx = rr[0] + dx, ry = rr[1] + dy, rz = rr[2] + dz;
    const rr2 = rr[0] * rr[0] + rr[1] * rr[1] + rr[2] * rr[2];
    const q = (dx * (dx + 2 * rr[0]) + dy * (dy + 2 * rr[1]) + dz * (dz + 2 * rr[2])) / rr2;
    const s32 = (1 + q) * Math.sqrt(1 + q);
    const oneMinusG = q * (3 + 3 * q + q * q) / ((s32 + 1) * s32);
    const k = mu / (rr2 * Math.sqrt(rr2));
    cpos[0] = rP[0] + rx; cpos[1] = rP[1] + ry; cpos[2] = rP[2] + rz;
    if (tidal) perturbationTidal(cpos, rP, key, bodies, muSun, pert);
    else perturbation(cpos, rP, aP, key, mu, bodies, muSun, pert, sunAcc && ssb.acceleration(t, sunAcc));
    if (extraAccel) {
      // The craft's heliocentric velocity, for burns steered relative to it:
      // the primary's, the reference conic's and the deviation's.
      P.eph.velocity(t, vPt);
      cvel[0] = vPt[0] + rv[0] + yy[3]; cvel[1] = vPt[1] + rv[1] + yy[4]; cvel[2] = vPt[2] + rv[2] + yy[5];
      extraAccel(t, cpos, extra, mid, cvel);
      pert[0] += extra[0]; pert[1] += extra[1]; pert[2] += extra[2];
    }
    lastThrust = extraAccel ? len3(extra[0], extra[1], extra[2]) : 0;
    out[0] = yy[3]; out[1] = yy[4]; out[2] = yy[5];
    out[3] = k * (oneMinusG * rx - dx) + pert[0];
    out[4] = k * (oneMinusG * ry - dy) + pert[1];
    out[5] = k * (oneMinusG * rz - dz) + pert[2];
    return out;
  };

  const events = [];
  const dir = tEnd >= state.t ? 1 : -1;
  const bps = (breakpoints && dir > 0) ? breakpoints : null;
  let bp = 0, steps = 0;
  const K = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0, 0]);
  const SR = Array.from({ length: 7 }, () => [0, 0, 0]);   // conic position at each stage
  const SV = Array.from({ length: 7 }, () => [0, 0, 0]);   // and velocity
  const nR = [0, 0, 0], nV = [0, 0, 0];                     // conic at the step's end
  const yt = [0, 0, 0, 0, 0, 0];
  // The last step's start (deviation, first stage, conic), for its dense
  // output at an impact.
  const y0 = [0, 0, 0, 0, 0, 0], k1 = [0, 0, 0, 0, 0, 0], cR0 = [0, 0, 0], cV0 = [0, 0, 0];
  let rhoN = len3(cR[0], cR[1], cR[2]);
  let h = Math.min(hMax, 0.01 * Math.sqrt(rhoN ** 3 / mu));
  let fsal = false;
  const D = P.eph.spacing;
  // Sphere-of-influence radii (Laplace, dist (mu/muParent)^0.4) of the
  // primary and of the bodies orbiting it, refreshed every 256 steps: the
  // primary can only change by leaving its own or entering one of theirs, so
  // the full primaryOf() runs only near those edges.
  const kids = bodies0().filter((b) => b.parent === key);
  let soiP = 0, soiKids = [], soiAge = Infinity;
  // A moon's sphere is about its planet (as primaryOf has it), not the Sun:
  // taken about the Sun, the Moon's would be 2.5 million km instead of
  // 66,000. In practice the planet's tide ends Encke about a moon well
  // inside either (the ratio passes ENCKE_OUT about 2,000 km from the
  // Moon), so this only keeps the two checks in agreement.
  const refreshSoi = () => {
    const bs = bodiesAt(state.t);
    const p = bs.find((b) => b.key === key);
    const host = p.parent ? bs.find((b) => b.key === p.parent) : null;
    soiP = host
      ? len3(p.r[0] - host.r[0], p.r[1] - host.r[1], p.r[2] - host.r[2]) * Math.pow(mu / host.mu, 0.4)
      : len3(p.r[0], p.r[1], p.r[2]) * Math.pow(mu / muSun, 0.4);
    soiKids = kids.map((k) => {
      const b = bs.find((x) => x.key === k.key);
      return len3(b.r[0] - p.r[0], b.r[1] - p.r[1], b.r[2] - p.r[2]) * Math.pow(b.mu / mu, 0.4);
    });
    soiAge = 0;
  };

  while (dir * (tEnd - state.t) > 0) {
    if (steps >= maxSteps || outOfTime(opts.deadline, steps)) return { steps, events, complete: false, left: false };
    const bodies = bodiesAt(state.t);
    let cap = hMax;
    for (const b of bodies) {
      if (b.key === key) continue;
      const dx = state.r[0] - b.r[0], dy = state.r[1] - b.r[1], dz = state.r[2] - b.r[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      cap = Math.min(cap, eta * Math.sqrt(d2 * Math.sqrt(d2) / b.mu));
    }
    {
      // On a conic that dips inside the primary, keep the Cowell step.
      const rx = cR[0] + y[0], ry = cR[1] + y[1], rz = cR[2] + y[2];
      const vx = cV[0] + y[3], vy = cV[1] + y[4], vz = cV[2] + y[5];
      const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx;
      const h2 = hx * hx + hy * hy + hz * hz;
      const rn = len3(rx, ry, rz);
      const energy = 0.5 * (vx * vx + vy * vy + vz * vz) - mu / rn;
      const ecc = Math.sqrt(Math.max(0, 1 + 2 * energy * h2 / (mu * mu)));
      if (P.radius > 0 && (h2 / mu) / (1 + ecc) < P.radius) cap = Math.min(cap, 0.01 * Math.sqrt(rn ** 3 / mu));
    }
    if (opts.stepCap) cap = Math.min(cap, opts.stepCap(state.t, state.r, state.v));
    let remaining = dir * (tEnd - state.t);
    if (bps) {
      while (bp < bps.length && bps[bp] <= state.t) bp++;
      if (bp < bps.length && bps[bp] < tEnd) remaining = bps[bp] - state.t;
    }
    const nextNode = dir > 0 ? (Math.floor(state.t / D + 1e-12) + 1) * D : (Math.ceil(state.t / D - 1e-12) - 1) * D;
    const toNode = dir * (nextNode - state.t);
    if (toNode > 0 && toNode < remaining) remaining = toNode;
    let hs = Math.min(h, cap);
    const last = hs >= remaining;
    if (last) hs = remaining;

    const t = state.t;
    const H = dir * hs;
    mid = t + 0.5 * H;
    stepBodies(bodies, t, H);
    SR[0][0] = cR[0]; SR[0][1] = cR[1]; SR[0][2] = cR[2];
    SV[0][0] = cV[0]; SV[0][1] = cV[1]; SV[0][2] = cV[2];
    // Stage times sit a hair inside the step at both ends: on a node the
    // primary's ephemeris acceleration jumps, and each stage must use the
    // cubic of the interval the step crosses, not the one beyond it.
    const nudge = 1e-9 * H;
    if (!fsal) f(t + nudge, y, SR[0], K[0], SV[0]);
    for (let s = 1; s < 7; s++) {
      for (let i = 0; i < 6; i++) {
        let acc = y[i];
        for (let j = 0; j < s; j++) acc += H * A[s][j] * K[j][i];
        yt[i] = acc;
      }
      if (s < 5) conicStep(cR, cV, C[s] * H, mu, SR[s], SV[s]);
      else if (s === 5) { conicStep(cR, cV, H, mu, nR, nV); for (let i = 0; i < 3; i++) { SR[5][i] = nR[i]; SV[5][i] = nV[i]; } }
      else { for (let i = 0; i < 3; i++) { SR[6][i] = nR[i]; SV[6][i] = nV[i]; } }
      f(t + C[s] * H - (C[s] === 1 ? nudge : 0), yt, SR[s], K[s], SV[s]);
    }
    const sTime = Math.sqrt(rhoN ** 3 / mu);
    let err = 0;
    for (let i = 0; i < 6; i++) {
      let e = 0;
      for (let j = 0; j < 7; j++) e += E[j] * K[j][i];
      err = Math.max(err, Math.abs(e * H) / (i < 3 ? tolKm : tolKm / sTime));
    }
    const grow = err === 0 ? 5 : Math.min(5, Math.max(0.2, SAFETY * Math.pow(err, -0.2)));
    if (err > 1) { h = hs * grow; fsal = true; continue; }   // K[0] still holds f at t

    // Accept: the 5th-order solution is the last stage's argument (FSAL).
    for (let i = 0; i < 6; i++) { y0[i] = y[i]; k1[i] = K[0][i]; y[i] = yt[i]; K[0][i] = K[6][i]; }
    for (let i = 0; i < 3; i++) { cR0[i] = cR[i]; cV0[i] = cV[i]; cR[i] = nR[i]; cV[i] = nV[i]; }
    fsal = true;
    state.t = last ? t + dir * remaining : t + H;
    if (!last) h = hs * grow;
    steps++;
    P.eph.position(state.t, rP); P.eph.velocity(state.t, vP);
    for (let i = 0; i < 3; i++) {
      state.r[i] = rP[i] + cR[i] + y[i];
      state.v[i] = vP[i] + cV[i] + y[3 + i];
    }
    rhoN = len3(cR[0] + y[0], cR[1] + y[1], cR[2] + y[2]);
    const ratio = tideRatio(rhoN, rP, key, mu, bodiesAt(state.t), muSun, lastThrust);

    // On a node or a burn edge the acceleration jumps: the stored first
    // stage (taken just inside the step that ended) is stale.
    if (last && state.t !== tEnd) { mid = state.t + 1e-9 * dir; fsal = false; }

    if (len3(y[0], y[1], y[2]) > RECTIFY * rhoN) {
      for (let i = 0; i < 3; i++) { cR[i] += y[i]; cV[i] += y[3 + i]; }
      y.fill(0);
      fsal = false;
    }

    // Events, as in the Cowell kernel. An impact puts the state back to
    // where the step crossed the surface: the deviation on the step's dense
    // output, the conic carried to the same time (impact.js).
    const hit = (key) => {
      const tEndStep = state.t, yd = [0, 0, 0, 0, 0, 0], rc = [0, 0, 0], vc = [0, 0, 0];
      const at = (s, rr, vv) => {
        const ts = s === 1 ? tEndStep : t + s * H;
        dp45Dense(y0, yt, k1, K, H, s, yd);
        conicStep(cR0, cV0, s * H, mu, rc, vc);
        P.eph.position(ts, rP); P.eph.velocity(ts, vP);
        for (let i = 0; i < 3; i++) { rr[i] = rP[i] + rc[i] + yd[i]; vv[i] = vP[i] + vc[i] + yd[3 + i]; }
      };
      const I = locateImpact(key, t, H, tEndStep, at, bodiesAt, sunRadius);
      if (I.s < 1) {
        state.t = I.t;
        for (let i = 0; i < 3; i++) { state.r[i] = I.r[i]; state.v[i] = I.v[i]; }
      }
      events.push({ type: 'impact', body: key, t: state.t, speed: I.speed });
      return { steps, events, complete: false, left: false };
    };
    const r = state.r;
    if (r[0] * r[0] + r[1] * r[1] + r[2] * r[2] < sunRadius * sunRadius) return hit('sun');
    if (focus) focus(r, state.t);
    const now = bodiesAt(state.t);
    for (const b of now) if (below(r, b)) return hit(b.key);
    if (++soiAge > 256) refreshSoi();
    let near = rhoN > 0.98 * soiP;
    for (let k = 0; k < kids.length && !near; k++) {
      const b = now.indexOf(kids[k]) >= 0 ? kids[k] : null;
      if (!b) continue;
      const dx = r[0] - b.r[0], dy = r[1] - b.r[1], dz = r[2] - b.r[2];
      near = dx * dx + dy * dy + dz * dz < (1.02 * soiKids[k]) ** 2;
    }
    const p = near ? primaryOf(r, now, muSun) : state.primary;
    if (p !== state.primary) {
      events.push({ type: 'primary', from: state.primary, to: p, t: state.t });
      state.primary = p;
      return { steps, events, complete: dir * (tEnd - state.t) <= 0, left: true };
    }
    if (ratio > ENCKE_OUT) return { steps, events, complete: dir * (tEnd - state.t) <= 0, left: true };
  }
  return { steps, events, complete: true, left: false };
}
