// src/physics/kernelHost.js
//
// The spacecraft side of the physics kernel, as message handling: it owns the
// body set (planets and Moon) and advances craft states on request. The Web
// Worker (kernel.worker.js) wraps it; the main thread uses it directly when a
// Worker is not available. Pure: no three.js, no DOM.
//
// Request:  { type: 'step', crafts: [CraftRequest] }
//   CraftRequest = { id, version, r, v, t, tEnd, primary, thrust, maxSteps? }
//     r, v       heliocentric J2000 equatorial km, km/s at time t
//     t, tEnd    seconds from KERNEL_EPOCH_MS
//     thrust     [ax, ay, az] km/s^2, held constant from t to tEnd (optional)
//     burns      [{ t0, t1, dir, F, m0, mdot }] (optional): finite burns. On
//                from t0 to t1 along the unit vector dir (EQJ), thrust F
//                newtons on a craft of mass m0 kg at t0 losing mdot kg/s, so
//                the acceleration grows as fuel burns. Steps end exactly at
//                each t0 and t1.
//     version    returned unchanged, so the caller can drop a result computed
//                from a state it has since changed (a burn, a clock jump)
// Reply:    { type: 'stepped', crafts: [CraftResult], ms }
//   CraftResult = { id, version, r, v, t, tEnd, primary, accel, events,
//                   complete, steps }
//     accel      km/s^2 at the returned state, gravity plus thrust
//     complete   false if the step budget ran out (t < tEnd) or an impact
//                stopped the advance
//   A craft whose step throws (a bad state, a time outside the ephemeris)
//   comes back as { id, version, error } instead, and the others still step.

import { advance, createState, accelHeliocentric } from './nbody.js';
import { solarSystemBodies } from './bodies.js';

// Kernel time zero: 2000-01-01 12:00 UTC. Only a reference; every time is a
// difference from it.
export const KERNEL_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
export const DEFAULT_MAX_STEPS = 20000;

export function kernelSeconds(date) {
  return (date.getTime() - KERNEL_EPOCH_MS) / 1000;
}

// Advance one craft. sys is a body set from solarSystemBodies().
export function stepCraft(sys, req) {
  // NaN does not throw anywhere in the kernel: it would integrate quietly and
  // come back as a 'complete' NaN state. Refuse it here instead.
  const finite = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
  if (!finite(req.r) || !finite(req.v) || !Number.isFinite(req.t) || !Number.isFinite(req.tEnd) ||
      (req.thrust && !finite(req.thrust))) {
    throw new Error('non-finite craft state, time or thrust');
  }
  const burns = (req.burns || []).filter((b) => b.t1 > req.t && b.t0 < req.tEnd);
  for (const b of burns) {
    if (![b.t0, b.t1, b.F, b.m0, b.mdot].every(Number.isFinite) || !finite(b.dir) || !(b.m0 - b.mdot * (b.t1 - b.t0) > 0)) {
      throw new Error('bad burn: needs finite times, direction, thrust and mass, and mass left at the end');
    }
  }
  const state = createState(req.r, req.v, req.t);
  state.primary = req.primary ?? null;
  const th = req.thrust;
  const constant = th && (th[0] !== 0 || th[1] !== 0 || th[2] !== 0);
  // Thrust at time t (mass from t), for the burn active at the step midpoint.
  const thrustAt = (t, mid, out) => {
    out[0] = out[1] = out[2] = 0;
    if (constant) { out[0] = th[0]; out[1] = th[1]; out[2] = th[2]; }
    for (const b of burns) {
      if (mid >= b.t0 && mid < b.t1) {
        const k = b.F / (b.m0 - b.mdot * (t - b.t0)) / 1000;   // m/s^2 -> km/s^2
        out[0] += k * b.dir[0]; out[1] += k * b.dir[1]; out[2] += k * b.dir[2];
      }
    }
    return out;
  };
  const extraAccel = (constant || burns.length) ? (t, r, out, mid) => thrustAt(t, mid, out) : null;
  // Steps end on each burn's edges, and inside a burn no step burns more than
  // 1 % of the craft's mass: in cruise the gravity rule would otherwise take a
  // whole burn in one step, and a burn that sheds a large share of the mass
  // (44 % in the tests) is too curved for that (1.5 % short of the rocket
  // equation in one step).
  const breakpoints = burns.length
    ? [...new Set(burns.flatMap((b) => {
      const m1 = b.m0 - b.mdot * (b.t1 - b.t0);
      const n = Math.min(4000, Math.max(1, Math.ceil(Math.log(b.m0 / m1) / Math.log(1.01))));
      const pts = [];
      for (let k = 0; k <= n; k++) pts.push(k === n ? b.t1 : b.t0 + (b.t1 - b.t0) * k / n);
      return pts;
    }))].sort((x, y) => x - y)
    : null;
  const res = advance(state, req.tEnd, {
    bodiesAt: sys.bodiesAt, muSun: sys.muSun, extraAccel, breakpoints,
    maxSteps: req.maxSteps ?? DEFAULT_MAX_STEPS,
  });
  const accel = accelHeliocentric(state.r, sys.bodiesAt(state.t), sys.muSun);
  const thrustNow = thrustAt(state.t, state.t, [0, 0, 0]);
  for (let i = 0; i < 3; i++) accel[i] += thrustNow[i];
  return {
    id: req.id, version: req.version,
    r: state.r, v: state.v, t: state.t, tEnd: req.tEnd, primary: state.primary,
    accel, events: res.events, complete: res.complete, steps: res.steps,
  };
}

export function createKernelHost() {
  let sys = null;
  return {
    handle(msg) {
      if (!msg || msg.type !== 'step') return { type: 'error', error: `unknown message ${msg && msg.type}` };
      if (!sys) sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
      const t0 = Date.now();
      const crafts = msg.crafts.map((req) => {
        try {
          return stepCraft(sys, req);
        } catch (err) {
          return { id: req.id, version: req.version, error: String(err && err.message || err) };
        }
      });
      return { type: 'stepped', crafts, ms: Date.now() - t0 };
    },
  };
}
