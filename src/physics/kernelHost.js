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
import { ttSeconds, utcMsAtTt } from './ephemeris.js';
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

// Kernel time is TT seconds from KERNEL_EPOCH_MS: uniform, so a leap second
// is a second the craft flies, as the bodies' ephemerides count it. (Counted
// in UTC seconds, a craft lost a second against the bodies at each one.)
const TT0 = ttSeconds(KERNEL_EPOCH_MS);
export function kernelSeconds(date) {
  return ttSeconds(date.getTime()) - TT0;
}
// The UTC instant (ms) of kernel time t.
export function kernelMs(t) {
  return utcMsAtTt(TT0 + t);
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
  // A body by key, a moon or planet whether or not its system is split.
  const bodyOf = (key, t) => (sys.bodyAt ? sys.bodyAt(key, t) : sys.bodiesAt(t).find((x) => x.key === key));
  const burns = (req.burns || []).filter((b) => b.t1 > req.t && b.t0 < req.tEnd);
  for (const b of burns) {
    if (![b.t0, b.t1, b.F, b.m0, b.mdot].every(Number.isFinite) || !finite(b.dir) || !(b.m0 - b.mdot * (b.t1 - b.t0) > 0)) {
      throw new Error('bad burn: needs finite times, direction, thrust and mass, and mass left at the end');
    }
    if (b.frame === 'vnb' && !bodyOf(b.about, req.t)) throw new Error(`bad burn: no body '${b.about}' to steer about`);
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
            const B = bodyOf(b.about, t);
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
  // 1 kg) count only when they carry their own mass and flow (mass0,
  // massFlow: a craft with a scriptIsp); otherwise they are skipped.
  const massAt = (t) => {
    let next = null, last = null;
    for (const b of burns) {
      const m0 = b.scripted ? b.mass0 : b.m0, md = b.scripted ? b.massFlow : b.mdot;
      if (m0 === undefined) continue;
      if (t >= b.t0 && t < b.t1) return m0 - md * (t - b.t0);
      if (b.t0 >= t && (!next || b.t0 < next.t0)) next = { t0: b.t0, m: m0 };
      if (b.t1 <= t && (!last || b.t1 > last.t1)) last = { t1: b.t1, m: m0 - md * (b.t1 - b.t0) };
    }
    if (next) return next.m;
    if (last) return last.m;
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
    envState: env?.state?.() ?? null,
  };
}

// Aim: the velocity change at heliocentric r, v and kernel time t0 that
// brings the craft to the position target (heliocentric, km) at time T,
// flying the scripted burns between (burns, as Craft builds them) through
// stepCraft under gravity alone. Newton's method, its sensitivities from
// three runs each nudged 1 cm/s; it stops within 10 m, or after four
// rounds, keeping the best. Returns { dv (EQJ km/s), miss (km, without it),
// after (km, with it) }, or null if a trial run fails or hits a body.
// RealMission.aimCorrection calls it in Node; the app sends it to the
// kernel worker ({ type: 'aim' }), off the page's thread. dv0: a first
// guess (the journey planner's two-body Lambert arc); rounds, how many
// Newton rounds at most; damped, a step that hits a body or misses by more
// is halved (up to five times) rather than ending the search.
export function aimTo(sys, { r, v, t0, T, target, burns = [], dv0 = null, rounds = 4, damped = false }) {
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const list = burns.filter((b) => !b.aimed && b.t1 > t0 && b.t0 < T);
  const fly = (vv) => {
    const res = stepCraft(sys, { id: 0, version: 0, r: [...r], v: vv, t: t0, tEnd: T, primary: null, burns: list.map((b) => ({ ...b })), maxSteps: 1e6 });
    return res.complete && !res.events.some((e) => e.type === 'impact') ? res.r : null;
  };
  const plain = fly([...v]);
  const miss0 = plain ? Math.hypot(...sub3(plain, target)) : Infinity;
  let dv = [0, 0, 0], base = plain, best = { dv, after: miss0 };
  if (dv0) {
    const guess = fly(add3(v, dv0));
    if (guess && Math.hypot(...sub3(guess, target)) < miss0) { dv = [...dv0]; base = guess; best = { dv, after: Math.hypot(...sub3(guess, target)) }; }
  }
  if (!base) return null;
  for (let round = 0; round < rounds && best.after > 0.01; round++) {
    const miss = sub3(base, target), h = 1e-5;
    const cols = [0, 1, 2].map((j) => { const vv = add3(v, dv); vv[j] += h; const q = fly(vv); return q && sub3(q, base).map((d) => d / h); });
    if (cols.some((c) => !c)) break;
    const A = [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]), D = det3(A);
    if (!(Math.abs(D) > 0)) break;
    let step = [0, 1, 2].map((k) => det3(A.map((row, i) => row.map((val, c) => (c === k ? -miss[i] : val)))) / D);
    let next = null, after = Infinity;
    for (let half = 0; half <= (damped ? 5 : 0); half++, step = step.map((x) => x / 2)) {
      next = fly(add3(v, add3(dv, step)));
      after = next ? Math.hypot(...sub3(next, target)) : Infinity;
      if (after < best.after) break;
    }
    dv = add3(dv, step);
    if (!next) break;
    base = next;
    if (after < best.after) best = { dv, after };
    else break;
  }
  return { dv: best.dv, miss: miss0, after: best.after };
}

export function createKernelHost() {
  let sys = null;
  return {
    handle(msg) {
      if (!sys) sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
      if (msg && msg.type === 'aim') {
        try {
          return { type: 'aimed', id: msg.id, result: aimTo(sys, msg) };
        } catch (err) {
          return { type: 'aimed', id: msg.id, result: null, error: String(err && err.message || err) };
        }
      }
      if (!msg || msg.type !== 'step') return { type: 'error', error: `unknown message ${msg && msg.type}` };
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
