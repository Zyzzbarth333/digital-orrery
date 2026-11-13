// src/physics/vent.js
//
// The small unmodelled pushes a real spacecraft feels: venting, uneven
// thermal radiation, and attitude-thruster puffs (docs/physics/environment.md#venting-and-thruster-puffs).
// A simulator cannot predict them (JSC's fit of Artemis II takes them from
// Orion's logs), so this is a random model with the right size and memory,
// calibrated on what Artemis II's flown trajectory showed: a push of 1.3 to
// 3.4 um/s^2, steady over each coast arc of a day or two, its direction
// changing between arcs, and always leaning toward the Sun.
//
// Every value is a fixed function of time and a seed, so the same instant
// always gives the same push, whatever order the integrator asks in or
// however the clock's frames split the flight.
//
//   makeVent({ sigma, tau, sunward, seed, puffs }) -> (t, sunDir, out, mid)
//     t kernel seconds; sunDir unit vector from the craft to the Sun;
//     adds the push (m/s^2) into out. mid: the middle of the integrator's
//     step, at which a puff is judged on or off (as burns are), since a
//     fourth-order step's stages reach beyond the step itself.
//   - sunward (m/s^2): a steady push toward the Sun (default 1.4e-6);
//   - sigma (m/s^2), tau (s): each inertial axis wanders as a first-order
//     Gauss-Markov process of standard deviation sigma and correlation time
//     tau (defaults 1.3e-6 and 1.5 days);
//   - puffs: { rate (per hour), dv (m/s) }: attitude-thruster puffs, each a
//     2 s push of about dv in a random direction (default none).

// A 32-bit hash of integers (splitmix-style), and uniform and normal
// deviates from it.
function hash(a, b, c) {
  let h = (a * 0x9e3779b1 ^ b * 0x85ebca6b ^ c * 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const uniform = (a, b, c) => (hash(a, b, c) + 0.5) / 4294967296;
const normal = (a, b, c) => Math.sqrt(-2 * Math.log(uniform(a, b, c * 2))) * Math.cos(2 * Math.PI * uniform(a, b, c * 2 + 1));

export const VENT_DEFAULTS = { sigma: 1.3e-6, tau: 1.5 * 86400, sunward: 1.4e-6, seed: 1 };

export function makeVent(opts = {}) {
  const { sigma, tau, sunward, seed } = { ...VENT_DEFAULTS, ...opts };
  // Knots every tau/8. A knot's value is the exponentially weighted sum of
  // the white noise before it, x_k = sqrt(1 - phi^2) sigma sum_j phi^j w_(k-j),
  // which is the stationary AR(1) process, but computed from the knot's own
  // index (truncated at phi^j < 1e-4) rather than by stepping from the start.
  const dk = tau / 8, phi = Math.exp(-dk / tau), J = Math.ceil(Math.log(1e-4) / Math.log(phi));
  const scale = Math.sqrt(1 - phi * phi) * sigma;
  const cache = new Map();
  const knot = (k, axis) => {
    const key = k * 3 + axis;
    let v = cache.get(key);
    if (v === undefined) {
      v = 0;
      for (let j = 0, p = 1; j <= J; j++, p *= phi) v += p * normal(seed, axis + 7, k - j + 0x40000000);
      v *= scale;
      if (cache.size > 4096) cache.clear();
      cache.set(key, v);
    }
    return v;
  };
  // Catmull-Rom between knots: continuous, with a continuous rate.
  const axisAt = (t, axis) => {
    const u = t / dk, k = Math.floor(u), f = u - k;
    const p0 = knot(k - 1, axis), p1 = knot(k, axis), p2 = knot(k + 1, axis), p3 = knot(k + 2, axis);
    return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
  };
  const puffs = opts.puffs && opts.puffs.rate > 0 ? opts.puffs : null;
  const SLOT = 3600, PUFF_S = 2;
  // The puffs in an hour's slot: how many (Poisson), when, which way.
  const slotPuffs = (s) => {
    const out = [];
    let p = Math.exp(-puffs.rate), u = uniform(seed, 101, s), n = 0, c = p;
    while (u > c && n < 50) { n++; p *= puffs.rate / n; c += p; }
    for (let i = 0; i < n; i++) {
      const t0 = s * SLOT + uniform(seed, 102 + i, s) * (SLOT - PUFF_S);
      const z = 2 * uniform(seed, 103 + i, s) - 1, a = 2 * Math.PI * uniform(seed, 104 + i, s), q = Math.sqrt(1 - z * z);
      const dv = puffs.dv * (0.5 + uniform(seed, 105 + i, s));
      out.push({ t0, t1: t0 + PUFF_S, a: [q * Math.cos(a) * dv / PUFF_S, q * Math.sin(a) * dv / PUFF_S, z * dv / PUFF_S] });
    }
    return out;
  };
  const slots = new Map();
  const puffsNear = (t) => {
    const s = Math.floor(t / SLOT), list = [];
    for (const k of [s - 1, s, s + 1]) {
      if (!slots.has(k)) { if (slots.size > 64) slots.clear(); slots.set(k, slotPuffs(k)); }
      list.push(...slots.get(k));
    }
    return list;
  };
  const vent = (t, sunDir, out, mid = t) => {
    out[0] += sunward * sunDir[0] + axisAt(t, 0);
    out[1] += sunward * sunDir[1] + axisAt(t, 1);
    out[2] += sunward * sunDir[2] + axisAt(t, 2);
    if (puffs) for (const p of puffsNear(mid)) if (mid >= p.t0 && mid < p.t1) { out[0] += p.a[0]; out[1] += p.a[1]; out[2] += p.a[2]; }
    return out;
  };
  // Steps end close to a puff's edges, so each is felt in full: the time to
  // the next edge within ten minutes (never below 0.05 s).
  vent.stepCap = puffs ? (t) => {
    let cap = Infinity;
    for (const p of puffsNear(t)) for (const e of [p.t0, p.t1]) if (e > t + 1e-6 && e - t < 600) cap = Math.min(cap, e - t);
    return Math.max(0.05, cap);
  } : null;
  vent.puffsIn = puffs ? (a, b) => { const out = []; for (let s = Math.floor(a / SLOT); s <= Math.floor(b / SLOT); s++) out.push(...slotPuffs(s).filter((p) => p.t0 >= a && p.t1 <= b)); return out; } : () => [];
  return vent;
}
