// src/physics/feasibility.js
//
// Can this journey be flown, and if not, when? (docs/physics/journey.md#the-flags)
// Pure ES module, on journey.js's patched conics.
//
//   legProfile(journey, k, opts)   the cheapest delta-v of leg k for each
//                                  departure date from when it can first
//                                  leave, each date's best flight time
//   assess(journey, sol, opts)     the plotting table's lamps: window, phase,
//                                  parking, wait, delta-v, no window, plane,
//                                  miss, flyby

import { solveJourney, solveLeg, legGeometry, bodyInfo, phaseOption, planeOption, planePricer, BROKEN_ALWAYS } from './journey.js';
import { hohmannCircular } from './transfers.js';

const DAY_MS = 86400e3;

// The departure-date profile of leg k: for each date from the earliest it
// can leave (its stop's arrival, or the start date) across spanDays, the
// lowest delta-v over flight times tofMin..tofMax (a fraction of the
// Hohmann time between the two orbits by default). null for a leg whose
// departure is fixed (after a flyby), an orbit change, or a return to the
// same body. A leg that leaves or reaches a moon via its planet is profiled
// every day, not every 8: the moon's phase ripples its price over a month
// (journey.js moonExcess); leaving one, the profile also carries the best day
// in the stay (journey.js phaseOption). Leaving a planet's orbit after a
// capture, each date is priced with the parking orbit's plane as a stay to
// that date would turn it (journey.js planePricer), every 2 days where the
// plane comes round in under two months, and the profile carries the day
// near the planned one its plane holds the way out (journey.js
// planeOption). Returns { k, fromMs, points: [{ ms, dv, tofDays }], best,
// stepDays, phase, plane }.
export function legProfile(journey, k, { spanDays = null, stepDays = null, tofSteps = 24, sol = null } = {}) {
  const s = sol ?? solveJourney(journey);
  const P = s.stops[k], Q = s.stops[k + 1];
  if (!P || !Q || P.kind === 'flyby' || P.kind === 'craft') return null;
  const g = legGeometry(P.body, Q.body, P.body === Q.body && (P.kind === 'flyby' || Q.kind === 'flyby'));
  if (g.kind === 'local' || g.resonant) return null;
  const plane = planePricer(s, k), planned = plane && s.legs[k]?.plane;
  stepDays ??= g.viaA || g.viaB ? 1 : planned?.rateDegDay && 360 / Math.abs(planned.rateDegDay) < 60 ? 2 : 8;
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
    const tried = [];
    for (let i = 0; i < tofSteps; i++) {
      const tof = tH * (0.5 + (1.1 * i) / (tofSteps - 1));
      const L = solveLeg(P, Q, dep, dep + tof * DAY_MS, { maxRevs: 0 });
      if (!L.ok) continue;
      const dv = L.depDv + L.arrDv + L.midDv;
      if (plane) tried.push({ L, dv, tof });
      else if (!p || dv < p.dv) p = { ms: dep, dv, tofDays: tof };
    }
    // With the plane: the flight times in order of their price in the
    // plane, each with its plane's extra, until the next costs more in the
    // plane alone than the best so far.
    if (plane) {
      tried.sort((a, b) => a.dv - b.dv);
      for (const c of tried) {
        if (p && c.dv >= p.dv) break;
        const dv = c.dv + plane(c.L);
        if (!p || dv < p.dv) p = { ms: dep, dv, tofDays: c.tof };
      }
    }
    if (p) { points.push(p); if (!best || p.dv < best.dv) best = p; }
  }
  const phase = g.viaA ? phaseOption(journey, k, { sol: s }) : null;
  const po = plane ? planeOption(journey, k, { sol: s }) : null;
  return { k, fromMs, points, best, stepDays, phase: phase && { ms: phase.depMs, dv: phase.dv, tofDays: phase.tofDays, arrMs: phase.arrMs, angleDeg: phase.moonAngleDeg },
    plane: po && { ms: po.depMs, dv: po.dv, tofDays: po.tofDays, arrMs: po.arrMs, angleDeg: po.angleDeg, aimed: po.aimed, waitDays: po.waitDays, flight: po.flight } };
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

  // Window: a leg leaving well off its cheapest date (unless that date is
  // within the parking orbit lamp's reach: it says why).
  let worst = null;
  const dearPlane = (L) => L?.ok && L.plane?.priced && !L.plane.aimed && L.plane.extraDv > Math.max(0.05, 0.03 * dvOf(L));
  for (const p of profiles) {
    if (!p?.best) continue;
    const L = sol.legs[p.k], now = dvOf(L);
    if (dearPlane(L) && Math.abs(p.best.ms - L.depMs) <= 30 * DAY_MS) continue;
    const extra = now - p.best.dv;
    if (extra > Math.max(0.2, 0.1 * p.best.dv) && Math.abs(p.best.ms - L.depMs) > 3 * DAY_MS && (!worst || extra > worst.extra)) {
      worst = { extra, p, L };
    }
  }
  if (worst) {
    const wait = Math.round((worst.p.best.ms - worst.L.depMs) / DAY_MS);
    lamps.push({ key: 'window', level: 'caution', leg: worst.p.k, text: `Leave ${name(worst.L.from)} ${iso(worst.p.best.ms)}: ${worst.p.best.dv.toFixed(2)} km/s, not ${dvOf(worst.L).toFixed(2)} (${wait > 0 ? `${wait} d later` : `${-wait} d earlier`})`, waitDays: wait, bestMs: worst.p.best.ms });
  } else if (profiles.some((p) => p?.best)) lamps.push({ key: 'window', level: 'go', text: 'Every leg leaves in its window' });

  // Phase: leaving a moon for another planet on a day its phase makes
  // dear, when a day in the stay (or within a turn of the moon) saves more
  // than 50 m/s and 3 %.
  for (const p of profiles) {
    if (!p?.phase) continue;
    const L = sol.legs[p.k], now = dvOf(L), save = now - p.phase.dv;
    if (save > Math.max(0.05, 0.03 * now)) {
      const d = Math.round((p.phase.ms - L.depMs) / DAY_MS);
      lamps.push({ key: 'phase', level: 'caution', leg: p.k, text: `Leave ${name(L.from)} ${iso(p.phase.ms)} for its phase: ${p.phase.dv.toFixed(2)} km/s, not ${now.toFixed(2)} (${d === 0 ? 'the same day' : d > 0 ? `${d} d later` : `${-d} d earlier`})`, bestMs: p.phase.ms, waitDays: d });
      break;
    }
  }

  // Parking orbit: a leg leaving a planet's orbit whose turned plane makes the
  // planned day dear (more than 50 m/s and 3 % of the leg): the day near it
  // the plane holds the way out, once the profile has it.
  for (const L of sol.legs) {
    if (!dearPlane(L)) continue;
    const pl = L.plane, now = dvOf(L);
    const o = profiles.find((p) => p?.k === L.index)?.plane;
    const off = `the parking orbit's plane ${pl.angleDeg.toFixed(0)}° off the way out`;
    if (o && now - o.dv > Math.max(0.05, 0.03 * now)) {
      const d = o.waitDays;
      lamps.push({ key: 'parking', level: 'caution', leg: L.index, text: `Leave ${name(L.from)} ${iso(o.ms)} for its orbit's plane: ${o.dv.toFixed(2)} km/s, not ${now.toFixed(2)} (${d === 0 ? 'the same day' : d > 0 ? `${d} d later` : `${-d} d earlier`}; ${off} as planned)`, bestMs: o.ms, waitDays: d });
    } else lamps.push({ key: 'parking', level: 'caution', leg: L.index, text: `Leaving ${name(L.from)}: ${off}, ${(pl.extraDv * 1000).toFixed(0)} m/s extra` });
    break;
  }

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

  // Plane: a leg near 180 degrees round its central body, where Lambert's
  // plane is ill-defined, flown on a broken plane (journey.js brokenPlane),
  // or, where none could be found, direct on a plane that will not hold.
  for (const L of sol.legs) {
    if (!L?.ok || L.geometry !== 'between' || L.resonance) continue;
    const bp = L.brokenPlane;
    if (bp) {
      lamps.push({ key: 'plane', level: 'caution', leg: L.index, text: `To ${name(L.to)}: ${bp.angleDeg.toFixed(1)}° round the ${name(L.central)}, so the plane breaks on ${iso(bp.ms)}, ${(bp.dv * 1000).toFixed(0)} m/s (${bp.turnDeg.toFixed(2)}°)${Number.isFinite(bp.directDv) ? `; direct ${bp.directDv.toFixed(2)} km/s, tilted ${bp.directIncDeg.toFixed(1)}°` : ''}`, bestMs: bp.ms });
      break;
    }
    const off = Math.abs((L.transferDeg ?? 0) - 180) * Math.PI / 180;
    if (L.transferDeg !== undefined && off < BROKEN_ALWAYS && !L.nodes?.length) {
      lamps.push({ key: 'plane', level: 'warn', leg: L.index, text: `To ${name(L.to)}: ${L.transferDeg.toFixed(1)}° round the ${name(L.central)}, its plane ill-defined, flown direct; move the arrival a few days` });
      break;
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
