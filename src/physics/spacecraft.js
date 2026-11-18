// src/physics/spacecraft.js
//
// Spacecraft beyond Earth orbit, on the trajectories JPL Horizons publishes
// for them: orbiters of Mercury, the Moon, Mars and Jupiter, the
// observatories about the Sun-Earth L1 and L2 points, and the probes in
// cruise (docs/frontend/spacecraft.md). The app flies none of them: it
// places each where Horizons says it is, from states packed by
// `npm run fetch:spacecraft` (spacecraft.fetch.mjs).
//
// The packing. Each craft's trajectory is cut into days (UTC). Within a
// day it is held as states (position and velocity about a centre body, in
// J2000 equatorial axes) every dt seconds, ends included, with one of two
// ways to fill in between two states (s_a at t_a, s_b at t_b):
//
//   kepler   each state carried along its own two-body orbit about the
//            centre (orbital.js propagate), and the two blended:
//              r(t) = (1 - w) K(s_a, t - t_a) + w K(s_b, t - t_b),
//              w = 3u^2 - 2u^3,  u = (t - t_a)/(t_b - t_a)
//            Both ends are exact and the error between them is what the
//            centre's oblateness and the other bodies' pull do in half an
//            interval, far less than either arc alone.
//   hermite  the cubic through both positions with both velocities: for
//            paths that bend slowly (cruise, a halo orbit seen from the
//            Earth, a craft passing far from its centre).
//
// The fetch picks, for each craft and day, the centre, the way and the
// longest dt that keeps every Horizons sample of the day (every 4 to 60
// minutes) within the tolerance, 2 km. satellites.test's sibling,
// spacecraft.test.mjs, checks held-out samples.
//
// Files (public/data/spacecraft/):
//   index.json        the craft, the centres and their GMs, the months
//   YYYY-MM.json      the month's segments: [craft, way, centre, t0 (UTC ms),
//                     dt (s), n intervals, byte offset, 1 if float64]
//   YYYY-MM.bin       their states: (n + 1) x 6 numbers each, float32 for a
//                     craft within 100,000 km of its centre (4 m), float64 beyond

import { propagate } from './orbital.js';

export const KEPLER = 0, HERMITE = 1;

// A month's segments and states, from its two files.
export function parseMonth(index, buffer) {
  const segs = index.segments.map(([craft, way, centre, t0, dt, n, offset, f64]) => {
    const count = (n + 1) * 6;
    const states = f64 ? new Float64Array(buffer, offset, count) : new Float32Array(buffer, offset, count);
    return { craft, way, centre, t0, dt, n, states, t1: t0 + n * dt * 1000 };
  });
  // Each craft's segments in time order, for the lookup.
  const byCraft = new Map();
  for (const s of segs) {
    if (!byCraft.has(s.craft)) byCraft.set(s.craft, []);
    byCraft.get(s.craft).push(s);
  }
  for (const list of byCraft.values()) list.sort((a, b) => a.t0 - b.t0);
  return { byCraft };
}

// The segment that holds time t (UTC ms), or null.
export function segmentAt(month, craft, t) {
  const list = month.byCraft.get(craft);
  if (!list) return null;
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, s = list[mid];
    if (t < s.t0) hi = mid - 1;
    else if (t > s.t1) lo = mid + 1;
    else return s;
  }
  return null;
}

const node = (s, k) => {
  const o = k * 6, a = s.states;
  return { r: [a[o], a[o + 1], a[o + 2]], v: [a[o + 3], a[o + 4], a[o + 5]] };
};

// State about the segment's centre at t (UTC ms): { r (km), v (km/s) },
// J2000 equatorial. mu: the centre's GM (km^3/s^2), for KEPLER.
export function stateIn(s, t, mu) {
  const dtMs = s.dt * 1000;
  const k = Math.min(s.n - 1, Math.max(0, Math.floor((t - s.t0) / dtMs)));
  const ta = s.t0 + k * dtMs, T = s.dt;
  const u = Math.min(1, Math.max(0, (t - ta) / dtMs));
  const a = node(s, k), b = node(s, k + 1);
  if (s.way === HERMITE) {
    // Cubic Hermite in u, its derivative / T for the velocity.
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const d00 = (6 * u2 - 6 * u) / T, d10 = (3 * u2 - 4 * u + 1), d01 = (-6 * u2 + 6 * u) / T, d11 = (3 * u2 - 2 * u);
    const r = [0, 1, 2].map((i) => h00 * a.r[i] + h10 * T * a.v[i] + h01 * b.r[i] + h11 * T * b.v[i]);
    const v = [0, 1, 2].map((i) => d00 * a.r[i] + d10 * a.v[i] + d01 * b.r[i] + d11 * b.v[i]);
    return { r, v };
  }
  const dta = u * T, dtb = (u - 1) * T;
  const pa = dta === 0 ? a : propagate(a.r, a.v, dta, mu);
  const pb = dtb === 0 ? b : propagate(b.r, b.v, dtb, mu);
  const w = u * u * (3 - 2 * u), dw = (6 * u - 6 * u * u) / T;
  const r = [0, 1, 2].map((i) => (1 - w) * pa.r[i] + w * pb.r[i]);
  const v = [0, 1, 2].map((i) => (1 - w) * pa.v[i] + w * pb.v[i] + dw * (pb.r[i] - pa.r[i]));
  return { r, v };
}
