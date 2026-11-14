// src/physics/trajsearch.js
//
// A trajectory search in the manner of NASA Ames's Trajectory Browser
// (https://trajbrowser.arc.nasa.gov): the lowest-delta-v one-way transfers
// from Earth to a destination, one optimum per launch window, so its
// results can be set beside the browser's (docs/physics/lambert.md#a-trajectory-search).
//
// Pure ES module: no three.js, React or DOM. The ephemeris is passed in, so
// it runs the same in Node, a Worker or a page:
//
//   searchTransfers({ stateOf, to, launchStartMs, launchEndMs, ... })
//     stateOf(key, date) -> { r, v }   heliocentric ecliptic J2000, km, km/s
//   -> { optima: [...], evaluated }     plain objects, times in Unix ms
//   transfer(opts, depMs, tofDays) -> one transfer between two dates:
//     { depMs, arrMs, tofDays, revs, branch, c3, vinfDep, vinfDepVec
//       (ecliptic km/s), vinfArr, injectionDv, arrivalDv, totalDv } or null
//
// Method (as the browser's user guide describes its own):
//   1. A grid of launch date x time of flight. For each cell, Lambert's
//      problem (orbital.js, prograde) gives the heliocentric transfers
//      between the planets' centres: the direct one, and up to maxRevs
//      (default 2) full revolutions round the Sun, two branches each. The
//      lowest delta-v of them is the cell's.
//   2. Patched conics turn that into delta-v. Injection from a circular
//      parking orbit:
//        dv_inj = sqrt(vinf_dep^2 + 2 mu_E / r_park) - sqrt(mu_E / r_park);
//      rendezvous, as the browser defines it, slows the arrival hyperbola at
//      periapsis r_p to escape speed there (capture into a just-bound orbit):
//        dv_arr = sqrt(vinf_arr^2 + 2 mu / r_p) - sqrt(2 mu / r_p);
//      a flyby needs no arrival burn.
//   3. For each launch date the best flight time gives a profile of delta-v
//      against launch date. Its local minima (not the ends of the span: a
//      minimum at an edge is the edge, not an opportunity) are refined by
//      Nelder-Mead over the continuous (launch, flight time), so optima are
//      not limited to the grid's step. Of optima closer than windowDays
//      (365 by default), only the lowest is kept: one per launch
//      opportunity, like the browser's "1-yr local optima".
//
// Limits: one heliocentric leg (no gravity assists yet), patched conics from
// the planets' centres (NASA's start at their spheres of influence, which
// matters for fast transfers to the giants), two-body everywhere.

import { lambertRevs } from './orbital.js';

const DAY_MS = 86400e3;
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const injectionDv = (vinf, mu, rPark) => Math.sqrt(vinf * vinf + 2 * mu / rPark) - Math.sqrt(mu / rPark);
export const captureToEscapeDv = (vinf, mu, rPeri) => Math.sqrt(vinf * vinf + 2 * mu / rPeri) - Math.sqrt(2 * mu / rPeri);

// One transfer: launch at depMs, arrive tofDays later. null if Lambert has
// no solution.
export function transfer(o, depMs, tofDays) {
  const arrMs = depMs + tofDays * DAY_MS;
  const E = o.stateOf(o.from ?? 'earth', new Date(depMs)), P = o.stateOf(o.to, new Date(arrMs));
  let best = null;
  for (let revs = 0; revs <= (o.maxRevs ?? 2); revs++) {
    for (const sol of lambertRevs(E.r, P.r, tofDays * 86400, o.muSun, revs, true)) {
      const vinfDepVec = sub(sol.v1, E.v), vinfDep = norm(vinfDepVec), vinfArr = norm(sub(sol.v2, P.v));
      const inj = injectionDv(vinfDep, o.departure.mu, o.departure.rPark);
      const arr = o.kind === 'flyby' ? 0 : captureToEscapeDv(vinfArr, o.arrival.mu, o.arrival.rPeri);
      if (![inj, arr].every(Number.isFinite) || (best && inj + arr >= best.totalDv)) continue;
      best = { depMs, arrMs, tofDays, revs, branch: sol.branch, c3: vinfDep * vinfDep, vinfDep, vinfDepVec, vinfArr, injectionDv: inj, arrivalDv: arr, totalDv: inj + arr };
    }
  }
  return best;
}

// Nelder-Mead minimisation of f over n parameters from p0, the first
// simplex stepped by `steps` along each axis. Stops when the simplex's
// values agree to 1e-7 and its points to 1e-4, or after 200 rounds.
// Returns the best point.
export function nelderMead(f, p0, steps, { iterations = 200 } = {}) {
  const n = p0.length, ev = (p) => ({ p, v: f(p) });
  let s = [ev([...p0]), ...steps.map((h, i) => ev(p0.map((x, j) => (j === i ? x + h : x))))];
  for (let it = 0; it < iterations; it++) {
    s.sort((a, b) => a.v - b.v);
    const spread = Math.max(...s.slice(1).map((x) => Math.hypot(...x.p.map((c, j) => c - s[0].p[j]))));
    if (Math.abs(s[n].v - s[0].v) < 1e-7 && spread < 1e-4) break;
    const c = p0.map((_, j) => s.slice(0, n).reduce((a, x) => a + x.p[j], 0) / n);
    const at = (k) => ev(c.map((cj, j) => cj + k * (s[n].p[j] - cj)));
    const r = at(-1);
    if (r.v < s[0].v) { const e = at(-2); s[n] = e.v < r.v ? e : r; } else if (r.v < s[n - 1].v) s[n] = r;
    else {
      const k = at(r.v < s[n].v ? -0.5 : 0.5);
      if (k.v < Math.min(r.v, s[n].v)) s[n] = k;
      else s = [s[0], ...s.slice(1).map((x) => ev(x.p.map((pj, j) => (pj + s[0].p[j]) / 2)))];
    }
  }
  s.sort((a, b) => a.v - b.v);
  return s[0].p;
}

// Nelder-Mead on (launch day, flight days), from a grid cell.
function refine(o, best, stepLaunch, stepTof) {
  const f = (p) => {
    const t = transfer(o, p[0] * DAY_MS, p[1]);
    return t && p[1] >= o.tofMinDays && p[1] <= o.tofMaxDays && p[0] * DAY_MS >= o.launchStartMs && p[0] * DAY_MS <= o.launchEndMs ? t.totalDv : Infinity;
  };
  const p = nelderMead(f, [best.depMs / DAY_MS, best.tofDays], [stepLaunch, stepTof]);
  return transfer(o, p[0] * DAY_MS, p[1]);
}

// opts:
//   stateOf, muSun (km^3/s^2), to (destination key), from ('earth')
//   kind            'rendezvous' (default) or 'flyby'
//   launchStartMs, launchEndMs
//   tofMinDays, tofMaxDays
//   launchStepDays, tofStepDays   grid steps (default 4 and 4)
//   departure: { mu, rPark }      Earth's GM and the parking orbit radius
//   arrival:   { mu, rPeri }      the destination's GM and capture periapsis
//   windowDays      one optimum per window (default 365)
//   maxRevs         full revolutions round the Sun to consider (default 2)
//   maxTotalDv      km/s; optima above it are dropped (default Infinity)
export function searchTransfers(opts) {
  const o = { from: 'earth', kind: 'rendezvous', launchStepDays: 4, tofStepDays: 4, windowDays: 365, maxTotalDv: Infinity, ...opts };
  let evaluated = 0;
  // The profile: the best transfer for each launch date on the grid.
  const profile = [];
  for (let dep = o.launchStartMs; dep <= o.launchEndMs; dep += o.launchStepDays * DAY_MS) {
    let best = null;
    for (let tof = o.tofMinDays; tof <= o.tofMaxDays; tof += o.tofStepDays) {
      const t = transfer(o, dep, tof);
      evaluated++;
      if (t && (!best || t.totalDv < best.totalDv)) best = t;
    }
    profile.push(best);
  }
  const dv = (k) => profile[k]?.totalDv ?? Infinity;
  const candidates = [];
  for (let k = 1; k < profile.length - 1; k++) {
    if (profile[k] && dv(k) <= dv(k - 1) && dv(k) < dv(k + 1)) {
      const r = refine(o, profile[k], o.launchStepDays, o.tofStepDays) ?? profile[k];
      if (r.totalDv <= o.maxTotalDv) candidates.push(r);
    }
  }
  // The lowest first; drop any within windowDays of one already kept.
  const optima = [];
  for (const c of candidates.sort((a, b) => a.totalDv - b.totalDv)) {
    if (optima.every((k) => Math.abs(k.depMs - c.depMs) >= o.windowDays * DAY_MS)) optima.push(c);
  }
  return { optima: optima.sort((a, b) => a.depMs - b.depMs), evaluated };
}
