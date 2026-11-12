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
//     thrust     [ax, ay, az] km/s^2, held constant from t to tEnd
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
  const state = createState(req.r, req.v, req.t);
  state.primary = req.primary ?? null;
  const th = req.thrust;
  const thrusting = th && (th[0] !== 0 || th[1] !== 0 || th[2] !== 0);
  const extraAccel = thrusting
    ? (t, r, out) => { out[0] = th[0]; out[1] = th[1]; out[2] = th[2]; return out; }
    : null;
  const res = advance(state, req.tEnd, {
    bodiesAt: sys.bodiesAt, muSun: sys.muSun, extraAccel,
    maxSteps: req.maxSteps ?? DEFAULT_MAX_STEPS,
  });
  const accel = accelHeliocentric(state.r, sys.bodiesAt(state.t), sys.muSun);
  if (thrusting) { accel[0] += th[0]; accel[1] += th[1]; accel[2] += th[2]; }
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
