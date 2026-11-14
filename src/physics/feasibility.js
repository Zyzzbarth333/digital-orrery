// src/physics/feasibility.js
//
// Can this journey be flown, and if not, when? (docs/physics/journey.md#the-flags)
// Pure ES module, on journey.js's patched conics.
//
//   legProfile(journey, k, opts)   the cheapest delta-v of leg k for each
//                                  departure date from when it can first
//                                  leave, each date's best flight time
//   assess(journey, sol, opts)     the plotting table's lamps: window, wait,
//                                  delta-v, no window, miss, flyby

import { solveJourney, solveLeg, legGeometry, bodyInfo } from './journey.js';
import { hohmannCircular } from './transfers.js';

const DAY_MS = 86400e3;

// The departure-date profile of leg k: for each date from the earliest it
// can leave (its stop's arrival, or the start date) across spanDays, the
// lowest delta-v over flight times tofMin..tofMax (a fraction of the
// Hohmann time between the two orbits by default). null for a leg whose
// departure is fixed (after a flyby), an orbit change, or a return to the
// same body. Returns { k, fromMs, points: [{ ms, dv, tofDays }], best }.
export function legProfile(journey, k, { spanDays = null, stepDays = 8, tofSteps = 24, sol = null } = {}) {
  const s = sol ?? solveJourney(journey);
  const P = s.stops[k], Q = s.stops[k + 1];
  if (!P || !Q || P.kind === 'flyby' || P.kind === 'craft') return null;
  const g = legGeometry(P.body, Q.body, P.body === Q.body && (P.kind === 'flyby' || Q.kind === 'flyby'));
  if (g.kind === 'local' || g.resonant) return null;
  const mu = bodyInfo(g.central).mu;
  const rA = g.kind === 'fromCentral' ? g.A.radius + P.altKm : bodyInfo(g.endA ?? P.body).a;
  const rB = g.kind === 'toCentral' ? g.B.radius + Q.altKm : bodyInfo(g.endB ?? Q.body).a;
  const tH = hohmannCircular(mu, rA, rB).tof / 86400;
  const synodic = g.kind === 'between' ? 2 * Math.PI / Math.abs(Math.sqrt(mu / rA ** 3) - Math.sqrt(mu / rB ** 3)) / 86400 : 30;
  const span = spanDays ?? Math.min(1.25 * synodic, 1100);
  const fromMs = k === 0 ? P.depMs : P.arrMs;
  const points = [];
  let best = null;
  for (let d = 0; d <= span; d += stepDays) {
    const dep = fromMs + d * DAY_MS;
    let p = null;
    for (let i = 0; i < tofSteps; i++) {
      const tof = tH * (0.5 + (1.1 * i) / (tofSteps - 1));
      const L = solveLeg(P, Q, dep, dep + tof * DAY_MS, { maxRevs: 0 });
      if (!L.ok) continue;
      const dv = L.depDv + L.arrDv + L.midDv;
      if (!p || dv < p.dv) p = { ms: dep, dv, tofDays: tof };
    }
    if (p) { points.push(p); if (!best || p.dv < best.dv) best = p; }
  }
  return { k, fromMs, points, best, stepDays };
}

// The lamps. budget: the ship's delta-v from the parking orbit on (km/s).
// profiles: legProfile results by leg (missing ones are skipped). Each lamp
// is { key, level: 'off' | 'go' | 'caution' | 'warn', text, leg? }; a lamp
// is lit only when it means something.
export function assess(journey, sol, { budget = Infinity, profiles = [] } = {}) {
  const lamps = [];
  const name = (k) => bodyInfo(k).name;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const dvOf = (L) => (L?.ok ? L.depDv + L.arrDv + L.midDv : Infinity);

  // Window: a leg leaving well off its cheapest date.
  let worst = null;
  for (const p of profiles) {
    if (!p?.best) continue;
    const L = sol.legs[p.k], now = dvOf(L);
    const extra = now - p.best.dv;
    if (extra > Math.max(0.2, 0.1 * p.best.dv) && Math.abs(p.best.ms - L.depMs) > 3 * DAY_MS && (!worst || extra > worst.extra)) {
      worst = { extra, p, L };
    }
  }
  if (worst) {
    const wait = Math.round((worst.p.best.ms - worst.L.depMs) / DAY_MS);
    lamps.push({ key: 'window', level: 'caution', leg: worst.p.k, text: `Leave ${name(worst.L.from)} ${iso(worst.p.best.ms)}: ${worst.p.best.dv.toFixed(2)} km/s, not ${dvOf(worst.L).toFixed(2)} (${wait > 0 ? `${wait} d later` : `${-wait} d earlier`})`, waitDays: wait, bestMs: worst.p.best.ms });
  } else if (profiles.some((p) => p?.best)) lamps.push({ key: 'window', level: 'go', text: 'Every leg leaves in its window' });

  // Wait: the longest stay.
  let stay = null;
  sol.stops.forEach((s, i) => { if (i > 0 && s.kind !== 'flyby' && s.depMs - s.arrMs > 30 * DAY_MS && (!stay || s.depMs - s.arrMs > stay.d)) stay = { d: s.depMs - s.arrMs, s }; });
  if (stay) lamps.push({ key: 'wait', level: 'caution', text: `${Math.round(stay.d / DAY_MS)} d at ${name(stay.s.body)}` });

  // Delta-v against the budget.
  if (Number.isFinite(budget)) {
    const over = sol.totalDv - budget;
    lamps.push(over > 0 ? { key: 'dv', level: 'warn', text: `Over the budget by ${over.toFixed(2)} km/s` } : { key: 'dv', level: 'go', text: `Margin ${(-over).toFixed(2)} km/s` });
  }

  // No window: a leg with no date in its profile under what the budget
  // leaves it (the budget less every other burn).
  if (Number.isFinite(budget)) {
    for (const p of profiles) {
      if (!p?.points?.length) continue;
      const others = sol.totalDv - dvOf(sol.legs[p.k]);
      const room = budget - others;
      if (!p.points.some((q) => q.dv <= room)) {
        lamps.push({ key: 'nowindow', level: 'warn', leg: p.k, text: `No date leaving ${name(sol.legs[p.k].from)} before ${iso(p.points.at(-1).ms)} fits the budget (best ${p.best.dv.toFixed(2)} km/s, room ${Math.max(0, room).toFixed(2)})` });
        break;
      }
    }
  }

  // Miss: a shaped leg that ends outside its target's sphere.
  for (const L of sol.legs) {
    if (L.shaped && !L.reaches) { lamps.push({ key: 'miss', level: 'warn', leg: L.index, text: `Misses ${name(L.to)} by ${fmtKm(L.missKm)}` }); break; }
  }

  // Flyby: a pass below its floor, or underground.
  sol.flybys.forEach((f, k) => {
    if (!f) return;
    const R = bodyInfo(f.body).radius;
    if (f.rp < R) lamps.push({ key: 'flyby', level: 'warn', leg: k, text: `${name(f.body)}: periapsis ${Math.round(R - f.rp).toLocaleString('en-AU')} km underground` });
    else if (f.tooTight) lamps.push({ key: 'flyby', level: 'caution', leg: k, text: `${name(f.body)}: the turn needs a lower pass, or ${(f.steerDv * 1000).toFixed(0)} m/s more` });
  });

  return lamps;
}

const fmtKm = (km) => (km >= 1e6 ? `${(km / 1e6).toFixed(2)} million km` : `${Math.round(km).toLocaleString('en-AU')} km`);
