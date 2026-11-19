// packages/physics/src/remedies.js
//
// What to change when the GO board reads NO GO, worked out rather than
// guessed (docs/physics/journey.md#what-to-change). For each row that can
// fail, why it fails in the plan's own terms (the body the craft hits,
// even one the user never listed, and how the planned path meets it), and
// two or three changes to the journey, each solved by patched conics
// (journey.js solveJourney) so its delta-v is the plan's own figure.
// Pure ES module.
//
//   remedies(journey, sol, opts)   { trajectory, windows, dv, shaping,
//                                  orbits, flybys, launch }: each null, or
//                                  { why, options: [Option] }
//   flightVerdict(sol, flight)     the GO board's Trajectory row: hit, miss,
//                                  corrections or go
//   impactWhy(sol, flight)         why the kernel's craft hits a body
//   withStop(journey, i, stop)     the journey with a stop inserted before
//                                  waypoint i, timed as PLOT times a new one
//
// An Option is { label, total, delta, journey } (the journey to set: one
// press applies it, as a click on a date in PLOT's timeline does) or
// { label, total, budget } (the budget to set). total: the journey's
// delta-v with it (km/s); delta: the change from now.

import { solveJourney, legOptions, applyOption, defaultArrival, bodyInfo, relState, aimNode, sphereOfInfluence } from './journey.js';
import { propagate } from './orbital.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';
import { norm } from './vec.js';

const DAY_MS = 86400e3;
const GIANTS = new Set(['jupiter', 'saturn', 'uranus', 'neptune']);
const name = (k) => bodyInfo(k).name;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const km = (x) => Math.round(x).toLocaleString('en-AU');
// Where the craft meets a body: a giant's cloud tops, anything else's ground.
const top = (k) => (GIANTS.has(k) ? 'cloud tops' : 'surface');
const copy = (j) => ({ ...j, start: { ...j.start }, waypoints: j.waypoints.map((w) => ({ ...w })) });

// The journey solved, or null where it has no solution.
function price(j) {
  try { const s = solveJourney(j); return s.ok ? s : null; } catch { return null; }
}
// An option: the journey j, solved, against the solution now.
function option(label, j, now, extra = {}) {
  const s = price(j);
  return s ? { label, total: s.totalDv, delta: s.totalDv - now.totalDv, journey: j, ...extra } : null;
}
// Leg k re-timed to leave on profile point q at its best flight time (as a
// click on that date in PLOT's timeline does).
const leaveAt = (j, k, q) => applyOption(j, k, { type: 'porkchop', depMs: q.ms, arrMs: q.ms + q.tofDays * DAY_MS, dv: q.dv });
// Leg k at its porkchop optimum near its dates, when there is one.
function porkchop(j, k) {
  try {
    const o = legOptions(j, k).options.find((x) => x.type === 'porkchop');
    return o ? applyOption(j, k, o) : j;
  } catch { return j; }
}

// The journey with stop { body, kind, altKm, stayDays } inserted before
// waypoint i, as PLOT adds one (journey.ts add): its arrival a first guess
// (journey.js defaultArrival) then the leg's porkchop optimum. The waypoint
// after it is timed again the same way from the new stop, and the ones
// after that keep their spacing.
export function withStop(journey, i, { body, kind = 'orbit', altKm = 400, stayDays = 3 }) {
  const s = price(journey);
  if (!s) return null;
  const prev = s.stops[i];
  let j = copy(journey);
  const dateMs = Math.round(defaultArrival(prev, body, altKm, kind) / DAY_MS) * DAY_MS;
  j.waypoints.splice(i, 0, { id: 1 + Math.max(0, ...j.waypoints.map((w) => w.id ?? 0)), body, kind, altKm, stayDays: kind === 'flyby' ? 0 : stayDays, dateMs });
  j = porkchop(j, i);
  const next = j.waypoints[i + 1];
  if (!next) return j;
  const s2 = price(j);
  if (!s2) return j;
  const old = next.dateMs;
  next.dateMs = Math.round(defaultArrival(s2.stops[i + 1], next.body, next.altKm, next.kind) / DAY_MS) * DAY_MS;
  j = porkchop(j, i + 1);
  const shift = j.waypoints[i + 1].dateMs - old;
  for (let k = i + 2; k < j.waypoints.length; k++) j.waypoints[k].dateMs += shift;
  return j;
}

// ---------------- why the kernel's craft hits a body ----------------

// The planned path's closest approach to body key on leg L, sampled along
// its arcs (about the leg's central body): { km (from its centre), ms }.
function closestOnLeg(L, key) {
  if (!L?.ok || key === L.central || !L.arcs?.length) return null;
  let best = null;
  for (const arc of L.arcs) {
    const T = (arc.t2 - arc.t1) / 1000, n = 400;
    for (let i = 0; i <= n; i++) {
      const t = (T * i) / n, ms = arc.t1 + t * 1000;
      const s = i === 0 ? { r: arc.r1 } : propagate(arc.r1, arc.v1, t, arc.mu);
      if (!s) continue;
      const b = relState(key, L.central, ms).r, d = norm([s.r[0] - b[0], s.r[1] - b[1], s.r[2] - b[2]]);
      if (!best || d < best.km) best = { km: d, ms };
    }
  }
  return best;
}

// How the planned path meets body key on leg k: through its well to its
// moon (the approach's periapsis about it), at the stop itself, or in
// passing. { relation, text, clearKm }: clearKm, how far the plan keeps
// above its surface (negative: below it).
function meeting(sol, k, key) {
  const L = sol.legs[k], Q = sol.stops[k + 1], B = bodyInfo(key), R = B.radius;
  if (!L?.ok) return null;
  const dest = name(Q.body);
  if (L.moonArr && bodyInfo(Q.body).parent === key) {
    const h = L.moonArr.rp - R;
    const lead = `${dest} is reached through ${name(key)}'s gravity: `;
    if (L.moonArr.ahead) return { relation: 'well', clearKm: h, text: lead + (h < 0 ? `the approach passes ${km(-h)} km below its ${top(key)}` : `the approach passes ${km(h)} km over its ${top(key)}`) };
    return { relation: 'well', clearKm: h, text: lead + (h < 0 ? `past ${dest}, the approach falls on to ${km(-h)} km below its ${top(key)}` : `the approach stays ${km(h)} km over its ${top(key)}`) };
  }
  if (key === Q.body) {
    const alt = Q.altKm ?? 0;
    return { relation: 'stop', clearKm: alt, text: `The ${Q.kind === 'flyby' ? 'pass' : 'orbit'} at ${dest} is planned ${km(alt)} km up` };
  }
  const c = closestOnLeg(L, key);
  if (!c) return { relation: 'central', clearKm: null, text: `On the leg to ${dest}, the craft falls into ${name(key)}` };
  const h = c.km - R;
  return { relation: 'passing', clearKm: h, ms: c.ms, text: `${name(key)} is not in the plan, but the leg to ${dest} passes it on ${iso(c.ms)}, ${km(Math.abs(h))} km ${h < 0 ? 'below' : 'over'} its ${top(key)}` };
}

// Why the kernel's craft hits a body: the leg it hits it on and how the
// planned path meets that body. flight: the kernel's reply ({ impact:
// { body, t } in kernel seconds, arrivals }). null with no impact.
export function impactWhy(sol, flight) {
  const hit = flight?.impact;
  if (!hit || !sol?.ok) return null;
  const ms = KERNEL_EPOCH_MS + hit.t * 1000;
  let k = sol.legs.findIndex((L) => L.ok && ms <= L.arrMs + DAY_MS);
  if (k < 0) k = sol.legs.length - 1;
  const m = meeting(sol, k, hit.body);
  if (!m) return null;
  const a = flight.arrivals?.find((x) => x.waypoint === k), d = a && Number.isFinite(a.closest) ? a.closest - a.plannedRp : null;
  // At the stop, how far off the kernel's flight came in; elsewhere, where
  // the plan keeps clear of it, the kernel's flight drifted in.
  const drift = m.relation === 'stop' && d !== null ? `; the kernel's flight came in ${km(Math.abs(d))} km ${d < 0 ? 'lower' : 'higher'} and hit it`
    : m.clearKm !== null && m.clearKm > 0 ? '; the kernel\'s flight drifted into it' : '';
  return { leg: k, body: hit.body, ms, ...m, text: m.text + drift };
}

// The Trajectory row's verdict on the kernel's flight (flight: its reply):
// 'hit', it hits a body that is not a landing's; 'miss', a waypoint more
// than 50 km off the plan; 'corrections', past 250 m/s or a tenth of the
// plan's delta-v, where the plan and the n-body flight disagree too much
// to trust the plan's delta-v; else 'go'. { state, body, worst, corr }.
export const MISS_KM = 50;
export function flightVerdict(sol, flight) {
  const arrivals = flight?.arrivals ?? [];
  const worst = Math.max(0, ...arrivals.map((a) => a.missKm));
  const corr = flight?.correctionsDv ?? 0;
  const hit = flight?.impact && !arrivals.some((a) => a.central && a.body === flight.impact.body);
  const state = hit ? 'hit' : worst > MISS_KM ? 'miss' : corr > Math.max(0.25, 0.1 * (sol?.totalDv ?? 0)) ? 'corrections' : 'go';
  return { state, body: hit ? flight.impact.body : null, worst, corr };
}

// ---------------- the options for each row ----------------

// The cheapest dates in leg k's profile (other than the planned one) whose
// plan passes the test ok(sol), at most n, cheapest first.
function windowDates(journey, now, profile, k, ok, n = 1) {
  if (!profile?.points?.length) return [];
  const L = now.legs[k], out = [];
  const pts = profile.points.filter((q) => Math.abs(q.ms - L.depMs) > DAY_MS).sort((a, b) => a.dv - b.dv);
  for (const q of pts.slice(0, 24)) {
    const j = leaveAt(journey, k, q), s = price(j);
    if (!s || !ok(s)) continue;
    out.push({ label: `Leave ${name(L.from)} ${iso(q.ms)} instead`, total: s.totalDv, delta: s.totalDv - now.totalDv, journey: j });
    if (out.length >= n) break;
  }
  return out;
}

// The kernel's craft hits a body.
function trajectoryHit(journey, now, why, profiles, flight) {
  const k = why.leg, Q = now.stops[k + 1], w = journey.waypoints[k], H = why.body, R = bodyInfo(H).radius;
  const options = [];
  // A capture into the planet's orbit before its moon: tried at a few
  // heights (half a radius up, a radius up, the moon's own distance), the
  // cheapest taken.
  if (why.relation === 'well') {
    const a = bodyInfo(Q.body).a, tries = [0.5 * R, R, Math.max(R, a - R - sphereOfInfluence(Q.body))].map((h) => Math.round(h / 1000) * 1000);
    let best = null;
    for (const altKm of tries) {
      const j = withStop(journey, k, { body: H, kind: 'orbit', altKm, stayDays: 3 }), o = j && option(`Stop in ${name(H)} orbit first, ${km(altKm)} km up`, j, now);
      if (o && (!best || o.total < best.total)) best = o;
    }
    if (best) options.push(best);
  }
  // Another departure date whose plan keeps clear of it (by a tenth of its
  // radius at least).
  const clear = (s) => { const m = meeting(s, k, H); return m && (m.clearKm === null || m.clearKm > 0.1 * R); };
  options.push(...windowDates(journey, now, profiles[k], k, clear));
  // A pass or an orbit at the stop itself: higher by twice what the kernel
  // missed it by (at least 200 km).
  if (why.relation === 'stop' && w && Q.kind !== 'land') {
    const a = flight.arrivals?.find((x) => x.waypoint === k), up = Math.max(200, 2 * (a?.missKm ?? 0)), altKm = Math.ceil(((w.altKm ?? 0) + up) / 100) * 100;
    const j = copy(journey); j.waypoints[k].altKm = altKm;
    const o = option(`Raise the ${Q.kind === 'flyby' ? 'pass' : 'orbit'} at ${name(Q.body)} to ${km(altKm)} km`, j, now);
    if (o) options.push(o);
  }
  // A flyby in the way, skipped.
  if (Q.kind === 'flyby' && journey.waypoints.length > 1 && k < journey.waypoints.length - 1) {
    const j = copy(journey); j.waypoints.splice(k, 1);
    const o = option(`Skip the ${name(Q.body)} flyby`, j, now);
    if (o) options.push(o);
  }
  return options.slice(0, 3);
}

// The leg (with a profile) whose window saves most, and that saving.
function bestWindow(journey, now, profiles) {
  let best = null;
  for (const p of profiles) {
    const L = p?.best && now.legs[p.k];
    if (!L?.ok || Math.abs(p.best.ms - L.depMs) <= DAY_MS) continue;
    const j = leaveAt(journey, p.k, p.best), s = price(j);
    if (s && s.totalDv < now.totalDv - 1e-6 && (!best || s.totalDv < best.total)) best = { label: `Leave ${name(L.from)} ${iso(p.best.ms)} instead`, total: s.totalDv, delta: s.totalDv - now.totalDv, journey: j };
  }
  return best;
}
// The budget to set: the total, up a tenth of a km/s.
const budgetTo = (total, now) => ({ label: `Raise the budget to ${(Math.ceil(total * 10) / 10).toFixed(1)} km/s`, total: now.totalDv, budget: Math.ceil(total * 10) / 10 });

// opts: { budget, profiles (legProfile by leg; [] while not worked out),
// lamps (feasibility.js assess), flight (the kernel's reply, or null) }.
export function remedies(journey, sol, { budget = Infinity, profiles = [], lamps = [], flight = null } = {}) {
  const out = { trajectory: null, windows: null, dv: null, shaping: null, orbits: null, flybys: null, launch: null };
  if (!sol?.ok || !journey.waypoints.length) return out;
  const lamp = (key) => lamps.find((l) => l.key === key);

  // Trajectory: the craft hits a body; or misses a waypoint, or needs too
  // many corrections, which leaving at a window or aiming a node may cure.
  if (flight) {
    const v = flightVerdict(sol, flight);
    const why = v.state === 'hit' ? impactWhy(sol, flight) : null;
    if (why) out.trajectory = { why: why.text, options: trajectoryHit(journey, sol, why, profiles, flight) };
    else if (v.state !== 'go') {
      const options = [];
      const worst = (flight.arrivals ?? []).reduce((m, a) => (a.missKm > (m?.missKm ?? -1) ? a : m), null);
      const L = worst && sol.legs[worst.waypoint], last = L?.nodes?.at(-1);
      if (v.state === 'miss' && last) {
        const o = option(`Aim the last burn node on the leg to ${name(L.to)}`, aimNode(journey, worst.waypoint, last.id), sol);
        if (o) options.push(o);
      }
      const b = bestWindow(journey, sol, profiles);
      if (b) options.push(b);
      out.trajectory = { why: null, options };
    }
  }

  // Windows: leave at the window; with no window under the budget, the
  // leg's best date (unless it leaves then already) and the budget that
  // date needs.
  const win = lamp('window'), nowin = lamp('nowindow');
  if (nowin) {
    const p = profiles[nowin.leg], L = sol.legs[nowin.leg], options = [];
    if (p?.best) {
      const o = Math.abs(p.best.ms - L.depMs) > DAY_MS && option(`Leave ${name(L.from)} ${iso(p.best.ms)}, its best date`, leaveAt(journey, nowin.leg, p.best), sol);
      if (o) options.push(o);
      options.push(budgetTo(sol.totalDv - (L.depDv + L.arrDv + L.midDv) + p.best.dv, sol));
    }
    out.windows = { why: null, options };
  } else if (win?.level === 'caution') {
    const p = profiles[win.leg];
    const o = p?.best && option(`Leave ${name(sol.legs[win.leg].from)} ${iso(p.best.ms)} instead`, leaveAt(journey, win.leg, p.best), sol);
    out.windows = { why: null, options: o ? [o] : [] };
  }

  // Delta-v over the budget: leave at the window that saves most, skip a
  // flyby where that is cheaper, or raise the budget to the total.
  if (Number.isFinite(budget) && sol.totalDv > budget) {
    const options = [];
    const b = bestWindow(journey, sol, profiles);
    if (b) options.push(b);
    journey.waypoints.forEach((w, k) => {
      if (w.kind !== 'flyby' || k === journey.waypoints.length - 1) return;
      const j = copy(journey); j.waypoints.splice(k, 1);
      const o = option(`Skip the ${name(w.body)} flyby`, j, sol);
      if (o && o.delta < 0) options.push(o);
    });
    options.sort((x, y) => x.total - y.total);
    out.dv = { why: null, options: [...options.slice(0, 2), budgetTo(sol.totalDv, sol)] };
  }

  // Shaping: a shaped leg that misses its target: its last node aimed, or
  // the node taken out.
  const miss = lamp('miss');
  if (miss) {
    const L = sol.legs[miss.leg], last = L?.nodes?.at(-1), options = [];
    if (last) {
      const a = option('Aim its last burn node', aimNode(journey, miss.leg, last.id), sol); if (a) options.push(a);
      const j = copy(journey); j.waypoints[miss.leg].nodes = (j.waypoints[miss.leg].nodes ?? []).filter((n) => n.id !== last.id);
      const r = option('Take its last burn node out', j, sol); if (r) options.push(r);
    }
    out.shaping = { why: null, options };
  }

  // Orbits: a low lunar orbit the field brings down in the stay: a shorter
  // stay, or the orbit the lamp found safe.
  const lo = lamp('lowOrbit');
  if (lo?.level === 'warn') {
    const L = sol.legs[lo.leg], o = L?.stayOrbit, k = lo.leg - 1, options = [];
    if (o && k >= 0) {
      const d = Math.max(0, Math.floor(o.fallDays) - 1);
      const j = copy(journey); j.waypoints[k].stayDays = d;
      const a = option(`Stay ${d} d at ${name(L.from)}`, j, sol); if (a) options.push(a);
      if (o.safeAltKm) { const j2 = copy(journey); j2.waypoints[k].altKm = Math.round(o.safeAltKm); const b = option(`Orbit ${name(L.from)} ${km(o.safeAltKm)} km up`, j2, sol); if (b) options.push(b); }
    }
    out.orbits = { why: null, options };
  }

  // Flybys: a pass below the ground (an aim set by hand): the aim cleared,
  // or the flyby skipped.
  const under = lamps.find((l) => l.key === 'flyby' && l.level === 'warn');
  if (under) {
    const k = under.leg, w = journey.waypoints[k], options = [];
    if (w?.aim) { const j = copy(journey); delete j.waypoints[k].aim; const a = option(`Clear the hand aim at ${name(w.body)}`, j, sol); if (a) options.push(a); }
    if (w && k < journey.waypoints.length - 1) { const j = copy(journey); j.waypoints.splice(k, 1); const b = option(`Skip the ${name(w.body)} flyby`, j, sol); if (b) options.push(b); }
    out.flybys = { why: null, options };
  }

  // Launch: a parking orbit inside the air: 120 km.
  const s0 = journey.start;
  if (s0.kind !== 'craft' && !(s0.altKm >= 120)) {
    const j = copy(journey); j.start.altKm = 120;
    const o = option('Raise the parking orbit to 120 km', j, sol);
    out.launch = { why: null, options: o ? [o] : [] };
  }
  return out;
}
