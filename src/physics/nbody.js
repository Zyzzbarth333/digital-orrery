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
// Events: an impact (closer to the Sun or a body than its radius) stops the
// advance; a change of primary (the body whose sphere of influence holds the
// craft) is reported and the advance continues.
//
// Each call has a step budget. Steps are never stretched to meet it: when it
// runs out the advance stops short of tEnd and says so (complete: false), and
// the caller continues from state.t next time. A stretched step near a planet
// can pass straight through it.

const W_CBRT2 = Math.cbrt(2.0);
const YOSHIDA_W1 = 1.0 / (2.0 - W_CBRT2);
const YOSHIDA_W0 = -W_CBRT2 / (2.0 - W_CBRT2);

// ---------------- force model ----------------

// Heliocentric acceleration of a test particle at r (km) given the bodies'
// positions. bodies: [{ mu, r }]. Writes into and returns `out`.
export function accelHeliocentric(r, bodies, muSun, out = [0, 0, 0]) {
  const r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2];
  const rn = Math.sqrt(r2);
  const k = -muSun / (r2 * rn);
  let ax = k * r[0], ay = k * r[1], az = k * r[2];
  for (let j = 0; j < bodies.length; j++) {
    const b = bodies[j], p = b.r;
    const dx = p[0] - r[0], dy = p[1] - r[1], dz = p[2] - r[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    const kd = b.mu / (d2 * Math.sqrt(d2));
    const p2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2];
    const kp = b.mu / (p2 * Math.sqrt(p2));
    ax += kd * dx - kp * p[0];
    ay += kd * dy - kp * p[1];
    az += kd * dz - kp * p[2];
  }
  out[0] = ax; out[1] = ay; out[2] = az;
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
  acc(t1, r, a);
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
  let best = 'sun', bestSoi = Infinity;
  for (const b of bodies) {
    const dx = r[0] - b.r[0], dy = r[1] - b.r[1], dz = r[2] - b.r[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let soi;
    const P = b.parent ? bodies.find((x) => x.key === b.parent) : null;
    if (P) {
      const px = b.r[0] - P.r[0], py = b.r[1] - P.r[1], pz = b.r[2] - P.r[2];
      soi = soiRadius(Math.sqrt(px * px + py * py + pz * pz), b.mu, P.mu);
    } else {
      soi = soiRadius(Math.hypot(b.r[0], b.r[1], b.r[2]), b.mu, muSun);
    }
    if (d < soi && soi < bestSoi) { best = b.key; bestSoi = soi; }
  }
  return best;
}

// Advance `state` in place to time tEnd (which may be earlier than state.t).
//
// opts:
//   bodiesAt(t) -> [{ key, mu, r, radius, parent? }]   body positions at t
//   muSun                                                km^3/s^2
//   method      'yoshida4' (default) or 'leapfrog'
//   eta         step as a fraction of the local dynamical time (default 0.01;
//               4th order: halving it cuts the error about 16x)
//   hMax        largest step in s (default 1 day)
//   fixedStep   use this |h| for every step instead of the eta rule
//   maxSteps    step budget for this call (default 200,000). When it runs out
//               the advance stops early with complete: false.
//   sunRadius   km (default 695,700); closer than this is an impact on 'sun'
//   extraAccel(t, r, out)   optional non-gravitational acceleration (thrust)
//
// Returns { steps, events, complete }. complete is false when the budget ran
// out (state.t is then short of tEnd) or an impact stopped the advance.
// events holds { type: 'impact', body, t } and { type: 'primary', from, to, t }.
export function advance(state, tEnd, opts) {
  const {
    bodiesAt, muSun, method = 'yoshida4', eta = 0.01, hMax = 86400.0,
    fixedStep = null, maxSteps = 200000, extraAccel = null, sunRadius = 695700.0,
  } = opts;
  const integrate = METHODS[method];
  if (!integrate) throw new Error(`nbody: unknown method '${method}'`);

  const extra = [0, 0, 0];
  const acc = (t, r, out) => {
    accelHeliocentric(r, bodiesAt(t), muSun, out);
    if (extraAccel) {
      extraAccel(t, r, extra);
      out[0] += extra[0]; out[1] += extra[1]; out[2] += extra[2];
    }
    return out;
  };

  const events = [];
  const dir = tEnd >= state.t ? 1 : -1;
  const r = state.r, v = state.v;
  const a = acc(state.t, r, [0, 0, 0]);
  if (state.primary === null) state.primary = primaryOf(r, bodiesAt(state.t), muSun);
  let steps = 0;

  while (dir * (tEnd - state.t) > 0) {
    const bodies = bodiesAt(state.t);
    let h;
    if (fixedStep) {
      h = fixedStep;
    } else {
      // Shortest local dynamical time over the Sun and every body.
      let tau = Math.sqrt(Math.pow(r[0] * r[0] + r[1] * r[1] + r[2] * r[2], 1.5) / muSun);
      for (const b of bodies) {
        const dx = r[0] - b.r[0], dy = r[1] - b.r[1], dz = r[2] - b.r[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        tau = Math.min(tau, Math.sqrt(d2 * Math.sqrt(d2) / b.mu));
      }
      h = Math.min(eta * tau, hMax);
    }
    const remaining = dir * (tEnd - state.t);
    if (steps >= maxSteps) return { steps, events, complete: false };
    // The last step lands exactly on tEnd. Comparing against a fixed epsilon
    // instead fails once t is large: at t ~ 1e8 s a leftover of 1e-8 s is
    // below one ulp, t stops advancing and the loop drifts r without time.
    const last = h >= remaining;
    if (last) h = remaining;

    state.t = integrate(state.t, r, v, a, dir * h, acc);
    if (last) state.t = tEnd;
    steps++;

    // Events, checked at the end of each step.
    if (r[0] * r[0] + r[1] * r[1] + r[2] * r[2] < sunRadius * sunRadius) {
      events.push({ type: 'impact', body: 'sun', t: state.t });
      return { steps, events, complete: false };
    }
    const now = bodiesAt(state.t);
    for (const b of now) {
      if (!(b.radius > 0)) continue;
      const dx = r[0] - b.r[0], dy = r[1] - b.r[1], dz = r[2] - b.r[2];
      if (dx * dx + dy * dy + dz * dz < b.radius * b.radius) {
        events.push({ type: 'impact', body: b.key, t: state.t });
        return { steps, events, complete: false };
      }
    }
    const p = primaryOf(r, now, muSun);
    if (p !== state.primary) {
      events.push({ type: 'primary', from: state.primary, to: p, t: state.t });
      state.primary = p;
    }
  }
  return { steps, events, complete: true };
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
    const n0 = this.node(k), n1 = this.node(k + 1);
    const s2 = s * s, s3 = s2 * s;
    const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s;
    const h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
    for (let i = 0; i < 3; i++) {
      out[i] = h00 * n0.r[i] + h10 * D * n0.v[i] + h01 * n1.r[i] + h11 * D * n1.v[i];
    }
    return out;
  }
}
