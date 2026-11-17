// src/physics/nbody.js
//
// Spacecraft propagation kernel: a test particle in the field of the Sun and
// a set of moving bodies (planets, the Moon) whose positions come from an
// ephemeris. Pure ES module: no three.js, no DOM, no astronomy-engine. The
// ephemeris is passed in as a function, so the kernel runs the same in the
// browser, in a Web Worker and under Node tests.
//
// Frame and units: heliocentric J2000 equatorial (astronomy-engine's EQJ, the
// same axes as SPICE "J2000"); km, km/s, km/s^2, s, km^3/s^2. Time t is in
// seconds from an epoch chosen by the caller.
//
// Force model (heliocentric, so the frame accelerates with the Sun):
//   a = -muSun r/|r|^3
//       + sum_j mu_j [ (r_j - r)/|r_j - r|^3  -  r_j/|r_j|^3 ]
//       + sum_j a_J2,j(r - r_j)      (bodies with a J2, zonal.js)
// The second term in the bracket is the indirect term: the Sun's own
// acceleration toward each body, which a heliocentric frame has to subtract.
// Without it a craft near a planet drifts away from it at the planet's
// heliocentric acceleration error.
//
// Integrators (fixed step h within a step, h chosen per step):
//   'leapfrog'  kick-drift-kick (velocity Verlet), 2nd order, symplectic for
//               a fixed step and a time-independent field
//   'yoshida4'  Yoshida (1990) 4th-order composition of three leapfrogs
// The step is eta times the shortest local dynamical time sqrt(d^3/mu) over
// the Sun and every body, so it shrinks near a planet and grows in cruise.
//
// Inside a body's sphere of influence, while the motion is nearly Keplerian,
// advance() hands the craft to Encke's method (encke.js): the two-body conic
// is followed exactly and only the deviation is integrated, with error
// control, in far fewer steps.
//
// Events: an impact (closer to the Sun or a body than its radius) stops the
// advance; a change of primary (the body whose sphere of influence holds the
// craft) is reported and the advance continues.
//
// Each call has a step budget. Steps are never stretched to meet it: when it
// runs out the advance stops short of tEnd and says so (complete: false), and
// the caller continues from state.t next time. A stretched step near a planet
// can pass straight through it.

import { advanceEncke, perturbationRatio, ENCKE_IN, DP45 } from './encke.js';
import { addJ2, below } from './zonal.js';

// The Cowell integrator unless asked for another: error-controlled
// Dormand-Prince 5(4) (advanceCowellRK). 'yoshida4' (and 'leapfrog') remain,
// and fixed steps always use them.
const DEFAULT_METHOD = 'dp45';
const ORIGIN = [0, 0, 0];
const H_MIN = 1e-3;     // s: dp45's smallest step (see advanceCowellRK)
const COWELL_REL_TOL = 1e-11;   // dp45's tolerance per km from the primary (see advanceCowellRK)
const W_CBRT2 = Math.cbrt(2.0);
const YOSHIDA_W1 = 1.0 / (2.0 - W_CBRT2);
const YOSHIDA_W0 = -W_CBRT2 / (2.0 - W_CBRT2);

// ---------------- force model ----------------

// Heliocentric acceleration of a test particle at r (km) given the bodies'
// positions. bodies: [{ mu, r, j2?, rJ2?, pole?, j2Cut2? }]. Writes into and
// returns `out`. indirect = false leaves out the indirect terms: the
// acceleration about the solar system barycentre (advance() then adds the
// Sun's own motion from DE442), with r and the bodies still heliocentric.
export function accelHeliocentric(r, bodies, muSun, out = [0, 0, 0], indirect = true) {
  const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  const rn = Math.sqrt(r2);
  const k = -muSun / (r2 * rn);
  out[0] = k * r[0]; out[1] = k * r[1]; out[2] = k * r[2];
  for (let j = 0; j < bodies.length; j++) {
    const b = bodies[j], p = b.r;
    const dx = p[0] - r[0], dy = p[1] - r[1], dz = p[2] - r[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const kd = b.mu / (d2 * Math.sqrt(d2));
    const p2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
    const kp = indirect ? b.mu / (p2 * Math.sqrt(p2)) : 0;
    out[0] += kd * dx - kp * p[0];
    out[1] += kd * dy - kp * p[1];
    out[2] += kd * dz - kp * p[2];
    if (b.j2 && d2 < b.j2Cut2) addJ2(-dx, -dy, -dz, d2, b, out);
  }
  return out;
}

// Laplace sphere-of-influence radius of a body of parameter mu at distance
// `dist` from a primary of parameter muPrimary.
export function soiRadius(dist, mu, muPrimary) {
  return dist * Math.pow(mu / muPrimary, 0.4);
}

// ---------------- integrators ----------------

// One kick-drift-kick leapfrog step of length h from (t, r, v) with the
// acceleration `a` already known at (t, r). Updates r, v and a in place and
// returns the new time. acc(t, r, out) writes the acceleration into out.
function leapfrogStep(t, r, v, a, h, acc) {
  const hh = 0.5 * h;
  v[0] += hh * a[0]; v[1] += hh * a[1]; v[2] += hh * a[2];
  r[0] += h * v[0]; r[1] += h * v[1]; r[2] += h * v[2];
  const t1 = t + h;
  acc(t1, r, a, hh);
  v[0] += hh * a[0]; v[1] += hh * a[1]; v[2] += hh * a[2];
  return t1;
}

const METHODS = {
  leapfrog(t, r, v, a, h, acc) {
    return leapfrogStep(t, r, v, a, h, acc);
  },
  yoshida4(t, r, v, a, h, acc) {
    t = leapfrogStep(t, r, v, a, YOSHIDA_W1 * h, acc);
    t = leapfrogStep(t, r, v, a, YOSHIDA_W0 * h, acc);
    return leapfrogStep(t, r, v, a, YOSHIDA_W1 * h, acc);
  },
};

// ---------------- state and advance ----------------

// A propagation state. t in s, r in km, v in km/s.
export function createState(r, v, t = 0) {
  return { t, r: [...r], v: [...v], primary: null };
}

// Which body's sphere of influence holds r: the innermost one, or 'sun'.
// bodies: [{ key, mu, r, parent? }]; a body with `parent` (the Moon) gets its
// SOI relative to that parent instead of the Sun.
export function primaryOf(r, bodies, muSun) {
  const info = soiInfo(bodies, muSun);
  let best = 'sun', bestSoi = Infinity;
  for (let j = 0; j < bodies.length; j++) {
    const b = bodies[j], p = b.r;
    const dx = r[0] - p[0], dy = r[1] - p[1], dz = r[2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const P = info.parent[j];
    const px = P ? p[0] - P.r[0] : p[0], py = P ? p[1] - P.r[1] : p[1], pz = P ? p[2] - P.r[2] : p[2];
    const soi = Math.sqrt(px * px + py * py + pz * pz) * info.k[j];
    if (d2 < soi * soi && soi < bestSoi) { best = b.key; bestSoi = soi; }
  }
  return best;
}

// Per body list (bodies.js keeps one array for each set of bodies), each
// body's parent in the list and its (mu / mu_primary)^0.4, computed once:
// Math.pow for every body at every step was a fifth of a Cowell step.
const SOI_INFO = new WeakMap();
function sameBodies(a, b) {
  if (a.length !== b.length) return false;
  for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) return false;
  return true;
}
// The body with this key in a list, or null (a loop: find() with a closure
// allocated at every step showed up in the garbage collector's time).
export function bodyByKey(list, key) {
  for (let j = 0; j < list.length; j++) if (list[j].key === key) return list[j];
  return null;
}
function soiInfo(bodies, muSun) {
  let info = SOI_INFO.get(bodies);
  if (!info || info.muSun !== muSun || !sameBodies(info.of, bodies)) {
    const parent = bodies.map((b) => (b.parent ? bodies.find((x) => x.key === b.parent) ?? null : null));
    info = { muSun, of: [...bodies], parent, k: bodies.map((b, j) => Math.pow(b.mu / (parent[j] ? parent[j].mu : muSun), 0.4)) };
    SOI_INFO.set(bodies, info);
  }
  return info;
}

// Advance `state` in place to time tEnd (which may be earlier than state.t).
//
// opts:
//   bodiesAt(t) -> [{ key, mu, r, radius, parent? }]   body positions at t
//   muSun                                                km^3/s^2
//   method      'dp45' (default: error-controlled Dormand-Prince 5(4)),
//               'yoshida4' or 'leapfrog' (fixed fraction of the dynamical time)
//   cowellTolKm dp45's per-step position tolerance (default 1e-6 km), plus
//   cowellRelTol of the distance from the primary (default 1e-11)
//   eta         Yoshida's and leapfrog's step as a fraction of the local
//               dynamical time (default 0.01; 4th order: halving it cuts the
//               error about 16x); dp45 starts from it
//   hMax        largest step in s (default 1 day)
//   fixedStep   use this |h| for every step instead of the eta rule
//   maxSteps    step budget for this call (default 200,000). When it runs out
//               the advance stops early with complete: false.
//   sunRadius   km (default 695,700); closer than this is an impact on 'sun'
//   breakpoints sorted times (forward advances only) that steps must end on
//               exactly, e.g. where a burn starts or stops
//   extraAccel(t, r, out, mid, v)   optional non-gravitational acceleration
//               (thrust). mid is the midpoint of the current step: with steps
//               ending on breakpoints, a burn is on for a step when mid lies
//               inside it, so it switches on and off at exact times rather
//               than at whichever stage time happens to straddle the edge.
//               v is the craft's heliocentric velocity, for burns steered
//               relative to it (Cowell's current velocity; in Encke the
//               primary's plus the reference conic's plus the deviation's).
//
//   stepCap(t, r, v)  optional: a largest step (s) for the state now, from
//               the environment (shorter near a shadow's edge, where
//               sunlight pressure switches off and on), in both integrators
//   encke       (default true) inside a body's sphere of influence, while
//               the motion is nearly Keplerian (perturbation ratio below
//               ENCKE_IN), use Encke's method with error-controlled steps
//               (encke.js). Needs bodies with a Hermite ephemeris; off for
//               fixedStep and 'leapfrog'.
//   tolKm       Encke's per-step position tolerance (default 1e-7 km)
//   focus(r, t) optional (default bodiesAt.focus): told the craft's
//               position at the start and after every step, so the bodies
//               can change with it (bodies.js splits a planet's system into
//               the planet and its moons near it). The list bodiesAt
//               returns may then change between steps, never within one.
//
// Returns { steps, floorSteps, events, complete }. floorSteps counts the
// steps dp45 took at its 1 ms floor with their error over the tolerance (a
// force that jumps with the state, or noise): 0 when nothing leaned on it.
// complete is false when the budget ran
// out (state.t is then short of tEnd) or an impact stopped the advance.
// events holds { type: 'impact', body, t } and { type: 'primary', from, to, t }.
export function advance(state, tEnd, opts) {
  if (!opts.ssb && opts.frame !== 'sun') {
    const sunEph = opts.sunEph ?? opts.bodiesAt.sunEph;
    if (sunEph) return advanceAboutSsb(state, tEnd, opts, sunEph);
  }
  const { bodiesAt, muSun, method = DEFAULT_METHOD, fixedStep = null, maxSteps = 200000 } = opts;
  const useEncke = opts.encke !== false && !fixedStep && (method === 'yoshida4' || method === 'dp45');
  const focus = opts.focus ?? bodiesAt.focus;
  const ssb = opts.ssb ?? null;
  const helio = (sign) => { if (ssb) shiftBySun(state, ssb, sign); };
  helio(-1);
  if (focus) focus(state.r, state.t);
  if (state.primary === null && useEncke) state.primary = primaryOf(state.r, bodiesAt(state.t), muSun);
  helio(1);
  if (!useEncke) return advanceCowell(state, tEnd, opts, false);
  const dir = tEnd >= state.t ? 1 : -1;
  let steps = 0, floorSteps = 0;
  const events = [];
  for (;;) {
    const sub = { ...opts, maxSteps: maxSteps - steps, primaryOf };
    // About the SSB, Encke's legs run on heliocentric coordinates (its
    // tidal form is the same in either frame), Cowell's on the SSB's.
    helio(-1);
    const encke = enckeSuits(state, opts, dir);
    let res;
    if (encke) { try { res = advanceEncke(state, tEnd, sub); } finally { helio(1); } } else {
      helio(1);
      res = advanceCowell(state, tEnd, sub, true);
    }
    steps += res.steps;
    floorSteps += res.floorSteps ?? 0;
    events.push(...res.events);
    if (!res.left) return { steps, floorSteps, events, complete: res.complete };
    if (dir * (tEnd - state.t) <= 0) return { steps, floorSteps, events, complete: true };
  }
}

// The error-controlled Cowell integrator (method 'dp45'): Dormand-Prince
// 5(4) on [r, v], each step's local error held under cowellTolKm in position and
// tolKm / tau in velocity (tau the shortest local dynamical time), steps
// ending on breakpoints as in advanceCowell. Forces, events and hooks as
// there; velocity-dependent forces see each stage's own velocity.
function advanceCowellRK(state, tEnd, opts, stopOnEntry) {
  const {
    bodiesAt, muSun, eta = 0.01, hMax = 86400.0, maxSteps = 200000, extraAccel = null, sunRadius = 695700.0,
    breakpoints = null, cowellTolKm = 1e-6, cowellRelTol = COWELL_REL_TOL,
  } = opts;
  const { C, A, E } = DP45;
  const focus = opts.focus ?? bodiesAt.focus;
  const ssb = opts.ssb ?? null, indirect = !ssb;
  const sR = [0, 0, 0], sV = [0, 0, 0], hA = [0, 0, 0], hB = [0, 0, 0], hV = [0, 0, 0];
  const helio = (t, x, out) => {
    if (!ssb) return x;
    ssb.position(t, sR);
    out[0] = x[0] - sR[0]; out[1] = x[1] - sR[1]; out[2] = x[2] - sR[2];
    return out;
  };
  const helioV = (t, x) => {
    if (!ssb) return x;
    ssb.velocity(t, sV);
    hV[0] = x[0] - sV[0]; hV[1] = x[1] - sV[1]; hV[2] = x[2] - sV[2];
    return hV;
  };
  const extra = [0, 0, 0], ra = [0, 0, 0], va = [0, 0, 0], aOut = [0, 0, 0], pV = [0, 0, 0];
  let mid = state.t;
  // d/dt [r, v] at time t.
  const f = (t, yy, out) => {
    ra[0] = yy[0]; ra[1] = yy[1]; ra[2] = yy[2];
    const x = helio(t, ra, hA);
    accelHeliocentric(x, bodiesAt(t), muSun, aOut, indirect);
    if (extraAccel) {
      va[0] = yy[3]; va[1] = yy[4]; va[2] = yy[5];
      extraAccel(t, x, extra, mid, helioV(t, va));
      aOut[0] += extra[0]; aOut[1] += extra[1]; aOut[2] += extra[2];
    }
    out[0] = yy[3]; out[1] = yy[4]; out[2] = yy[5];
    out[3] = aOut[0]; out[4] = aOut[1]; out[5] = aOut[2];
    return out;
  };
  const primaryDistance = (t, r) => {
    const x = helio(t, r, hB);
    const P = state.primary !== 'sun' ? bodyByKey(bodiesAt(t), state.primary) : null;
    const p = P ? P.r : ORIGIN;
    return Math.sqrt((x[0] - p[0]) ** 2 + (x[1] - p[1]) ** 2 + (x[2] - p[2]) ** 2);
  };
  const tauAt = (t, r) => {
    const x = helio(t, r, hB);
    let tau = Math.sqrt(Math.pow(x[0] * x[0] + x[1] * x[1] + x[2] * x[2], 1.5) / muSun);
    for (const b of bodiesAt(t)) {
      const dx = x[0] - b.r[0], dy = x[1] - b.r[1], dz = x[2] - b.r[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      tau = Math.min(tau, Math.sqrt(d2 * Math.sqrt(d2) / b.mu));
    }
    return tau;
  };

  const events = [];
  const dir = tEnd >= state.t ? 1 : -1;
  const r = state.r, v = state.v;
  const y = [r[0], r[1], r[2], v[0], v[1], v[2]];
  if (state.primary === null) state.primary = primaryOf(helio(state.t, r, hB), bodiesAt(state.t), muSun);
  const K = Array.from({ length: 7 }, () => [0, 0, 0, 0, 0, 0]), yt = [0, 0, 0, 0, 0, 0];
  let tau = tauAt(state.t, r);
  let h = Math.min(eta * tau, hMax);
  let steps = 0, bp = 0, fsal = false, floorSteps = 0;
  const bps = (breakpoints && dir > 0) ? breakpoints : null;

  while (dir * (tEnd - state.t) > 0) {
    if (steps >= maxSteps) return { steps, floorSteps, events, complete: false };
    let cap = hMax;
    if (opts.stepCap) cap = Math.min(cap, opts.stepCap(state.t, helio(state.t, r, hB), helioV(state.t, v)));
    // On a conic that dips inside the primary, keep the old fixed-fraction
    // step, so an impact is found as soon after it as before.
    const P = state.primary !== 'sun' ? bodyByKey(bodiesAt(state.t), state.primary) : null;
    if (P && P.radius > 0 && P.eph) {
      const x = helio(state.t, r, hB), vx = helioV(state.t, v);
      P.eph.velocity(state.t, pV);
      const dx = x[0] - P.r[0], dy = x[1] - P.r[1], dz = x[2] - P.r[2];
      const ux = vx[0] - pV[0], uy = vx[1] - pV[1], uz = vx[2] - pV[2];
      const hx = dy * uz - dz * uy, hy = dz * ux - dx * uz, hz = dx * uy - dy * ux;
      const h2 = hx * hx + hy * hy + hz * hz, rn = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const energy = 0.5 * (ux * ux + uy * uy + uz * uz) - P.mu / rn;
      const ecc = Math.sqrt(Math.max(0, 1 + 2 * energy * h2 / (P.mu * P.mu)));
      const inbound = dx * ux + dy * uy + dz * uz < 0;
      if ((h2 / P.mu) / (1 + ecc) < P.radius && (inbound || rn < 1.1 * P.radius)) cap = Math.min(cap, eta * tau);
    }
    let remaining = dir * (tEnd - state.t);
    if (bps) {
      while (bp < bps.length && bps[bp] <= state.t) bp++;
      if (bp < bps.length && bps[bp] < tEnd) remaining = bps[bp] - state.t;
    }
    let hs = Math.min(h, cap);
    const last = hs >= remaining;
    if (last) hs = remaining;
    const t = state.t, H = dir * hs;
    mid = t + 0.5 * H;
    if (!fsal) f(t, y, K[0]);
    for (let s = 1; s < 7; s++) {
      for (let i = 0; i < 6; i++) {
        let a = y[i];
        for (let j = 0; j < s; j++) a += H * A[s][j] * K[j][i];
        yt[i] = a;
      }
      f(t + C[s] * H, yt, K[s]);
    }
    // The position tolerance: cowellTolKm, plus cowellRelTol of the craft's
    // distance from its primary (the Sun's in cruise), so a wide orbit is
    // held to the same fraction of its size as a low one.
    const tolKm = cowellTolKm + cowellRelTol * primaryDistance(state.t, r);
    // The velocity tolerance is tolKm over a time: the local dynamical time
    // (at most hMax, so finite with no gravity at all), or the step itself
    // if that is shorter, so a velocity error is weighed by how far it moves
    // the craft. Without that floor, rounding in a force set the step: a
    // capsule's height is a difference of heliocentric places (3 cm of
    // rounding at 1 au), and under a chute that opens over 300 m of height
    // its drag carries 1e-4 of noise, which held the steps to 6 µs.
    const sT = Math.min(tau, hMax, hs);
    let err = 0;
    for (let i = 0; i < 6; i++) {
      let e = 0;
      for (let j = 0; j < 7; j++) e += E[j] * K[j][i];
      err = Math.max(err, Math.abs(e * H) / (i < 3 ? tolKm : tolKm / sT));
    }
    const grow = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -0.2)));
    // A force that jumps with the state (a parachute opening at a height)
    // has no step small enough for the error test: below H_MIN the step is
    // taken anyway, as a fixed-step method would take it.
    if (err > 1 && hs > H_MIN) { h = Math.max(hs * grow, H_MIN); fsal = true; continue; }
    if (err > 1) floorSteps++;   // taken at the floor, over the tolerance
    for (let i = 0; i < 6; i++) { y[i] = yt[i]; K[0][i] = K[6][i]; }
    fsal = true;
    state.t = last ? t + dir * remaining : t + H;
    if (!last) h = hs * grow;
    // A step ending on a breakpoint changes which burn is on: K[0] is stale.
    if (bps && last && state.t !== tEnd) fsal = false;
    r[0] = y[0]; r[1] = y[1]; r[2] = y[2]; v[0] = y[3]; v[1] = y[4]; v[2] = y[5];
    steps++;

    const x = helio(state.t, r, hB);
    if (x[0] * x[0] + x[1] * x[1] + x[2] * x[2] < sunRadius * sunRadius) {
      events.push({ type: 'impact', body: 'sun', t: state.t });
      return { steps, floorSteps, events, complete: false };
    }
    if (focus) focus(x, state.t);
    const now = bodiesAt(state.t);
    for (const b of now) {
      if (below(x, b)) {
        events.push({ type: 'impact', body: b.key, t: state.t });
        return { steps, floorSteps, events, complete: false };
      }
    }
    const prevPrimary = state.primary;
    const p = primaryOf(x, now, muSun);
    if (p !== state.primary) {
      events.push({ type: 'primary', from: state.primary, to: p, t: state.t });
      state.primary = p;
    }
    tau = tauAt(state.t, r);
    if (stopOnEntry && state.primary !== 'sun' && (p !== prevPrimary || steps % 16 === 0) && enckeSuitsAt(state, opts, dir, ssb)) {
      return { steps, floorSteps, events, complete: dir * (tEnd - state.t) <= 0, left: true };
    }
  }
  return { steps, floorSteps, events, complete: true };
}

// enckeSuits for a state about the SSB when ssb is given.
function enckeSuitsAt(state, opts, dir, ssb) {
  if (!ssb) return enckeSuits(state, opts, dir);
  shiftBySun(state, ssb, -1);
  try { return enckeSuits(state, opts, dir); } finally { shiftBySun(state, ssb, 1); }
}

// Whether Encke's method suits the craft now: inside a body's sphere of
// influence, with an ephemeris that has accelerations, and nearly Keplerian
// motion (thrust counts as a perturbation, so a burning craft is Cowell).
function enckeSuits(state, opts, dir) {
  if (state.primary === 'sun' || state.primary === null) return false;
  const bodies = opts.bodiesAt(state.t);
  const P = bodyByKey(bodies, state.primary);
  if (!P || !P.eph || !P.eph.acceleration) return false;
  let thrust = null;
  if (opts.extraAccel) { thrust = [0, 0, 0]; opts.extraAccel(state.t, state.r, thrust, state.t + 1e-9 * dir, state.v); }
  return perturbationRatio(state.r, state.t, P, bodies, opts.muSun, thrust) < ENCKE_IN;
}

// The Cowell integrator. About the SSB (opts.ssb, the Sun's place there),
// r and v are about the SSB and every force, event and hook is taken at the
// heliocentric r - r_sun(t), with the Sun's pull at the origin and no
// indirect term. With stopOnEntry, it returns
// { left: true } as soon as Encke's method suits the craft (it has entered a
// body's sphere of influence on a nearly Keplerian path), so advance() can
// switch to it.
function advanceCowell(state, tEnd, opts, stopOnEntry) {
  if ((opts.method ?? DEFAULT_METHOD) === 'dp45' && !opts.fixedStep) return advanceCowellRK(state, tEnd, opts, stopOnEntry);
  const {
    bodiesAt, muSun, method = 'yoshida4', eta = 0.01, hMax = 86400.0,
    fixedStep = null, maxSteps = 200000, extraAccel = null, sunRadius = 695700.0,
    breakpoints = null,
  } = opts;
  const integrate = METHODS[method];
  if (!integrate) throw new Error(`nbody: unknown method '${method}'`);
  const focus = opts.focus ?? bodiesAt.focus;
  // Heliocentric position (and velocity) for the forces and hooks: r itself
  // about the Sun, r - r_sun(t) about the SSB.
  const ssb = opts.ssb ?? null, indirect = !ssb;
  const sR = [0, 0, 0], sV = [0, 0, 0], hA = [0, 0, 0], hB = [0, 0, 0], hV = [0, 0, 0];
  const helio = (t, x, out) => {
    if (!ssb) return x;
    ssb.position(t, sR);
    out[0] = x[0] - sR[0]; out[1] = x[1] - sR[1]; out[2] = x[2] - sR[2];
    return out;
  };
  const helioV = (t, x) => {
    if (!ssb) return x;
    ssb.velocity(t, sV);
    hV[0] = x[0] - sV[0]; hV[1] = x[1] - sV[1]; hV[2] = x[2] - sV[2];
    return hV;
  };

  const extra = [0, 0, 0], vEnd = [0, 0, 0];
  let mid = state.t;
  // hh: the leapfrog's half-step when called between its kicks, where the
  // velocity is only half-kicked. A force that depends on velocity (drag,
  // steered thrust) is then evaluated at the velocity the kick ends on,
  // predicted with the gravity just found and the last extra push; at the
  // half-kicked velocity the method drops to first order (drag on a low
  // orbit: 0.26 m after 8 hours, 0.06 m at a quarter of the step).
  const acc = (t, r, out, hh = 0) => {
    const x = helio(t, r, hA);
    accelHeliocentric(x, bodiesAt(t), muSun, out, indirect);
    if (extraAccel) {
      const sv = state.v;
      vEnd[0] = sv[0] + hh * (out[0] + extra[0]); vEnd[1] = sv[1] + hh * (out[1] + extra[1]); vEnd[2] = sv[2] + hh * (out[2] + extra[2]);
      extraAccel(t, x, extra, mid, helioV(t, vEnd));
      out[0] += extra[0]; out[1] += extra[1]; out[2] += extra[2];
    }
    return out;
  };

  const events = [];
  const dir = tEnd >= state.t ? 1 : -1;
  const r = state.r, v = state.v;
  const a = acc(state.t, r, [0, 0, 0]);
  if (state.primary === null) state.primary = primaryOf(helio(state.t, r, hB), bodiesAt(state.t), muSun);
  let steps = 0;
  const floorSteps = 0;   // fixed fractions of the dynamical time never fall to dp45's floor
  let bp = 0;   // next breakpoint index (forward only)
  const bps = (breakpoints && dir > 0) ? breakpoints : null;

  while (dir * (tEnd - state.t) > 0) {
    const bodies = bodiesAt(state.t);
    let h;
    if (fixedStep) {
      h = fixedStep;
    } else {
      // Shortest local dynamical time over the Sun and every body.
      const x = helio(state.t, r, hB);
      let tau = Math.sqrt(Math.pow(x[0] * x[0] + x[1] * x[1] + x[2] * x[2], 1.5) / muSun);
      for (const b of bodies) {
        const dx = x[0] - b.r[0], dy = x[1] - b.r[1], dz = x[2] - b.r[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        tau = Math.min(tau, Math.sqrt(d2 * Math.sqrt(d2) / b.mu));
      }
      h = Math.min(eta * tau, hMax);
      if (opts.stepCap) h = Math.min(h, opts.stepCap(state.t, x, helioV(state.t, v)));
    }
    let remaining = dir * (tEnd - state.t);
    if (bps) {
      while (bp < bps.length && bps[bp] <= state.t) bp++;
      if (bp < bps.length && bps[bp] < tEnd) remaining = bps[bp] - state.t;
    }
    if (steps >= maxSteps) return { steps, floorSteps, events, complete: false };
    // The last step lands exactly on tEnd. Comparing against a fixed epsilon
    // instead fails once t is large: at t ~ 1e8 s a leftover of 1e-8 s is
    // below one ulp, t stops advancing and the loop drifts r without time.
    const last = h >= remaining;
    if (last) h = remaining;
    const landing = last ? state.t + dir * remaining : null;
    mid = state.t + 0.5 * dir * h;
    // A step that lands on a breakpoint changes which burn is active, so the
    // acceleration carried into the next step must be the one on the far side.
    state.t = integrate(state.t, r, v, a, dir * h, acc);
    if (last) state.t = landing;
    if (bps && last && state.t !== tEnd) { mid = state.t + 1e-9; acc(state.t, r, a); }
    steps++;

    // Events, checked at the end of each step.
    const x = helio(state.t, r, hB);
    if (x[0] * x[0] + x[1] * x[1] + x[2] * x[2] < sunRadius * sunRadius) {
      events.push({ type: 'impact', body: 'sun', t: state.t });
      return { steps, floorSteps, events, complete: false };
    }
    if (focus) focus(x, state.t);
    const now = bodiesAt(state.t);
    for (const b of now) {
      if (below(x, b)) {
        events.push({ type: 'impact', body: b.key, t: state.t });
        return { steps, floorSteps, events, complete: false };
      }
    }
    const prevPrimary = state.primary;
    const p = primaryOf(x, now, muSun);
    if (p !== state.primary) {
      events.push({ type: 'primary', from: state.primary, to: p, t: state.t });
      state.primary = p;
    }
    // Whether Encke now suits: checked every 16 steps (the ratio changes
    // slowly, and the check costs about as much as a step).
    if (stopOnEntry && state.primary !== 'sun' && (p !== prevPrimary || steps % 16 === 0) && enckeSuitsAt(state, opts, dir, ssb)) {
      return { steps, floorSteps, events, complete: dir * (tEnd - state.t) <= 0, left: true };
    }
  }
  return { steps, floorSteps, events, complete: true };
}

// ---------------- about the solar system barycentre ----------------

// The Sun's place and velocity about the SSB, for the many instants a step
// asks about. Within SUN_TAYLOR seconds of the last instant evaluated the
// Sun follows its second-order Taylor series from there: its jerk is about
// 1e-17 km/s^3, so an hour out the series is 1e-7 km from the cubic, and a
// step's forces need no fresh cubic.
const SUN_TAYLOR = 3600;
class SunMemo {
  constructor(eph) { this.eph = eph; this.t0 = NaN; this.r = [0, 0, 0]; this.v = [0, 0, 0]; this.a = [0, 0, 0]; }
  at(t) {
    if (!(Math.abs(t - this.t0) <= SUN_TAYLOR)) {
      this.eph.position(t, this.r); this.eph.velocity(t, this.v); this.eph.acceleration(t, this.a); this.t0 = t;
    }
    return t - this.t0;
  }
  position(t, out = [0, 0, 0]) {
    const d = this.at(t), h = 0.5 * d * d, r = this.r, v = this.v, a = this.a;
    out[0] = r[0] + v[0] * d + a[0] * h; out[1] = r[1] + v[1] * d + a[1] * h; out[2] = r[2] + v[2] * d + a[2] * h;
    return out;
  }
  velocity(t, out = [0, 0, 0]) {
    const d = this.at(t), v = this.v, a = this.a;
    out[0] = v[0] + a[0] * d; out[1] = v[1] + a[1] * d; out[2] = v[2] + a[2] * d;
    return out;
  }
  acceleration(t, out = [0, 0, 0]) { this.at(t); out[0] = this.a[0]; out[1] = this.a[1]; out[2] = this.a[2]; return out; }
}

// Moves a state by the Sun's place and velocity about the SSB at its time:
// sign +1 from heliocentric to the SSB, -1 back.
const SHIFT_R = [0, 0, 0], SHIFT_V = [0, 0, 0];
function shiftBySun(state, ssb, sign) {
  ssb.position(state.t, SHIFT_R); ssb.velocity(state.t, SHIFT_V);
  for (let i = 0; i < 3; i++) { state.r[i] += sign * SHIFT_R[i]; state.v[i] += sign * SHIFT_V[i]; }
}

// The kernel integrates about the solar system barycentre (SSB), as the DE
// ephemerides, GMAT and Orekit do: an inertial frame, with no indirect term,
// where the Sun is a moving body placed by DE442 (bodies.js sunEph). The
// Cowell integrator carries the state about the SSB and takes every force
// at the craft's heliocentric place r - r_sun(t); Encke's legs work about
// their primary, the same in either frame. Callers stay heliocentric: the
// state is moved to the SSB here and back at the end, and the hooks
// (extraAccel, stepCap, focus) are handed heliocentric positions and
// velocities.
function advanceAboutSsb(state, tEnd, opts, sunEph) {
  const ssb = new SunMemo(sunEph);
  shiftBySun(state, ssb, 1);
  try {
    return advance(state, tEnd, { ...opts, ssb });
  } finally {
    shiftBySun(state, ssb, -1);
  }
}

// Specific orbital energy about the Sun alone (for conservation checks).
export function heliocentricEnergy(state, muSun) {
  const [x, y, z] = state.r, [vx, vy, vz] = state.v;
  return 0.5 * (vx * vx + vy * vy + vz * vz) - muSun / Math.hypot(x, y, z);
}

// ---------------- ephemeris interpolation ----------------

// Cubic Hermite interpolation of a body's state between nodes spaced `spacing`
// seconds apart. stateAt(t) -> { r, v } is the (expensive) ephemeris; nodes are
// computed on demand and cached. The interpolation itself errs by about
// (spacing * n)^4 * a / 384 for mean motion n and radius a (1e-5 km for the
// Moon at one hour); with astronomy-engine the measured error is 0.01-0.07 km,
// set by how well its velocities match its own positions.
export class HermiteEphemeris {
  constructor(stateAt, spacing, maxNodes = 8192) {
    this.stateAt = stateAt;
    this.spacing = spacing;
    this.maxNodes = maxNodes;
    this.nodes = new Map();
    // The interval used last: most calls stay in it, so they skip the map.
    this.lastK = NaN; this.lastN0 = null; this.lastN1 = null;
  }

  // Nodes k and k+1 (the interval [k, k+1] in units of spacing).
  pair(k) {
    if (k !== this.lastK) {
      this.lastN0 = this.node(k);
      this.lastN1 = this.node(k + 1);
      this.lastK = k;
    }
  }

  node(k) {
    let n = this.nodes.get(k);
    if (!n) {
      if (this.nodes.size >= this.maxNodes) this.nodes.clear();
      n = this.stateAt(k * this.spacing);
      this.nodes.set(k, n);
    }
    return n;
  }

  // Position at time t, written into out.
  position(t, out = [0, 0, 0]) {
    const D = this.spacing;
    const k = Math.floor(t / D);
    const s = t / D - k;
    this.pair(k);
    const n0 = this.lastN0, n1 = this.lastN1;
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    for (let i = 0; i < 3; i++) {
      out[i] = h00 * n0.r[i] + h10 * D * n0.v[i] + h01 * n1.r[i] + h11 * D * n1.v[i];
    }
    return out;
  }

  // Acceleration at time t: the second derivative of the same cubic
  // (linear within an interval). Encke's method subtracts this from the
  // craft's acceleration, so the craft moves relative to the primary exactly
  // as the Cowell kernel's does relative to the same ephemeris.
  acceleration(t, out = [0, 0, 0]) {
    const D = this.spacing;
    const k = Math.floor(t / D);
    const s = t / D - k;
    this.pair(k);
    const n0 = this.lastN0, n1 = this.lastN1;
    const a00 = 12 * s - 6, a10 = 6 * s - 4, a01 = -12 * s + 6, a11 = 6 * s - 2;
    for (let i = 0; i < 3; i++) {
      out[i] = (a00 * n0.r[i] + a01 * n1.r[i]) / (D * D) + (a10 * n0.v[i] + a11 * n1.v[i]) / D;
    }
    return out;
  }

  // Velocity at time t: the derivative of the same cubic, so it matches
  // position() exactly (continuous across nodes, equal to the node
  // velocities at the nodes).
  velocity(t, out = [0, 0, 0]) {
    const D = this.spacing;
    const k = Math.floor(t / D);
    const s = t / D - k;
    this.pair(k);
    const n0 = this.lastN0, n1 = this.lastN1;
    const s2 = s * s;
    const d00 = 6 * s2 - 6 * s, d10 = 3 * s2 - 4 * s + 1;
    const d01 = -6 * s2 + 6 * s, d11 = 3 * s2 - 2 * s;
    for (let i = 0; i < 3; i++) {
      out[i] = (d00 * n0.r[i] + d01 * n1.r[i]) / D + d10 * n0.v[i] + d11 * n1.v[i];
    }
    return out;
  }
}
