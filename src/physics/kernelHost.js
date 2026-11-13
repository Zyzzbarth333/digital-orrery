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
//                each t0 and t1. With frame: 'vnb' and about: a body key,
//                dir is instead [prograde, in-plane, normal] in the craft's
//                orbital frame about that body (along its velocity relative
//                to the body, prograde x normal, and the orbit normal), so
//                the burn turns with the orbit as a guided burn does.
//     env        { mass, area, cr, cd, earth } (optional): the craft as the
//                environment model sees it (environment.js): the Earth's
//                field beyond J2, drag, and sunlight pressure with the
//                Earth's and Moon's shadows
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
import { makeEnvironment } from './environment.js';

// Kernel time zero: 2000-01-01 12:00 UTC. Only a reference; every time is a
// difference from it.
export const KERNEL_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
export const DEFAULT_MAX_STEPS = 20000;

// A direction given as [prograde, in-plane, normal] in the orbital frame of
// relative position r and velocity v, as an EQJ unit vector.
export function vnbDirection(dir, r, v) {
  const n = (a) => Math.hypot(a[0], a[1], a[2]);
  const vn = n(v), V = [v[0] / vn, v[1] / vn, v[2] / vn];
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], hn = n(h);
  const N = [h[0] / hn, h[1] / hn, h[2] / hn];
  const I = [V[1] * N[2] - V[2] * N[1], V[2] * N[0] - V[0] * N[2], V[0] * N[1] - V[1] * N[0]];
  const d = [0, 1, 2].map((k) => dir[0] * V[k] + dir[1] * I[k] + dir[2] * N[k]), dn = n(d);
  return [d[0] / dn, d[1] / dn, d[2] / dn];
}

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
    if (b.frame === 'vnb' && !sys.bodiesAt(req.t).some((x) => x.key === b.about)) throw new Error(`bad burn: no body '${b.about}' to steer about`);
  }
  const state = createState(req.r, req.v, req.t);
  state.primary = req.primary ?? null;
  const th = req.thrust;
  const constant = th && (th[0] !== 0 || th[1] !== 0 || th[2] !== 0);
  // Thrust at time t (mass from t), for the burn active at the step midpoint.
  // A burn in the orbital frame needs the craft's velocity (r, v); where the
  // integrator has none (Encke, which runs only while thrust is negligible)
  // it keeps the direction it last had.
  const vb = [0, 0, 0];
  const thrustAt = (t, mid, out, r, v) => {
    out[0] = out[1] = out[2] = 0;
    if (constant) { out[0] = th[0]; out[1] = th[1]; out[2] = th[2]; }
    for (const b of burns) {
      if (mid >= b.t0 && mid < b.t1) {
        const k = b.F / (b.m0 - b.mdot * (t - b.t0)) / 1000;   // m/s^2 -> km/s^2
        let d = b.dir;
        if (b.frame === 'vnb') {
          if (r && v) {
            const B = sys.bodiesAt(t).find((x) => x.key === b.about);
            B.eph.velocity(t, vb);
            b.last = vnbDirection(b.dir, [r[0] - B.r[0], r[1] - B.r[1], r[2] - B.r[2]], [v[0] - vb[0], v[1] - vb[1], v[2] - vb[2]]);
          }
          d = b.last ?? [0, 0, 0];
        }
        out[0] += k * d[0]; out[1] += k * d[1]; out[2] += k * d[2];
      }
    }
    return out;
  };
  // The environment (sunlight pressure and so on) adds to the thrust.
  // Its mass falls as burns draw propellant, so it is reckoned at each
  // instant from the burns themselves (each carries its starting mass and
  // flow): during a burn, m0 - mdot (t - t0); between burns, the next one's
  // starting mass, or the last one's final mass; with none, env.mass.
  // Scripted burns (a real mission's, given as acceleration on a nominal
  // 1 kg) say nothing of the mass and are skipped.
  const massAt = (t) => {
    let next = null, last = null;
    for (const b of burns) {
      if (b.scripted) continue;
      if (t >= b.t0 && t < b.t1) return b.m0 - b.mdot * (t - b.t0);
      if (b.t0 >= t && (!next || b.t0 < next.t0)) next = b;
      if (b.t1 <= t && (!last || b.t1 > last.t1)) last = b;
    }
    if (next) return next.m0;
    if (last) return last.m0 - last.mdot * (last.t1 - last.t0);
    return req.env.mass;
  };
  const env = req.env ? makeEnvironment(sys, { ...req.env, massAt }) : null;
  const thrusting = constant || burns.length;
  const extraAccel = (thrusting || env) ? (t, r, out, mid, v) => {
    if (thrusting) thrustAt(t, mid, out, r, v); else { out[0] = out[1] = out[2] = 0; }
    if (env) env(t, r, v, out, mid);
    return out;
  } : null;
  // Steps end on each burn's edges, and inside a burn no step burns more than
  // 1 % of the craft's mass: in cruise the gravity rule would otherwise take a
  // whole burn in one step, and a burn that sheds a large share of the mass
  // (44 % in the tests) is too curved for that (1.5 % short of the rocket
  // equation in one step).
  // A burn steered in the orbital frame turns with the velocity, which the
  // symplectic steps follow only to first order: its steps are also capped
  // at 0.25 s (0.0065 m/s per minute of burning near perigee, against
  // 0.13 m/s at 5 s, measured against RK4 at 0.01 s).
  const breakpoints = burns.length
    ? [...new Set(burns.flatMap((b) => {
      const m1 = b.m0 - b.mdot * (b.t1 - b.t0);
      const n = Math.min(4000, Math.max(1, Math.ceil(Math.log(b.m0 / m1) / Math.log(1.01)), b.frame === 'vnb' ? Math.ceil((b.t1 - b.t0) / 0.25) : 1));
      const pts = [];
      for (let k = 0; k <= n; k++) pts.push(k === n ? b.t1 : b.t0 + (b.t1 - b.t0) * k / n);
      return pts;
    }))].sort((x, y) => x - y)
    : null;
  // The environment's switching times (thruster puffs) join the burns'.
  const envEdges = env && req.tEnd > req.t ? env.breakpoints(req.t, req.tEnd) : [];
  const allBreaks = envEdges.length ? [...new Set([...(breakpoints ?? []), ...envEdges])].sort((x, y) => x - y) : breakpoints;
  const res = advance(state, req.tEnd, {
    bodiesAt: sys.bodiesAt, muSun: sys.muSun, extraAccel, breakpoints: allBreaks, stepCap: env?.stepCap ?? null,
    maxSteps: req.maxSteps ?? DEFAULT_MAX_STEPS,
  });
  const accel = accelHeliocentric(state.r, sys.bodiesAt(state.t), sys.muSun);
  const thrustNow = thrustAt(state.t, state.t, [0, 0, 0], state.r, state.v);
  if (env) env(state.t, state.r, state.v, thrustNow);
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
