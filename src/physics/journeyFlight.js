// src/physics/journeyFlight.js
//
// A journey (journey.js, patched conics) flown by the n-body kernel
// (docs/physics/journey.md#flying-it). Pure ES module: heliocentric J2000
// equatorial (EQJ) km, km/s, kernel seconds; the craft's burns as
// kernelHost.stepCraft takes them, so the app's Craft flies the same list.
//
//   planFlight(sol)              the start state and the schedule:
//     depart    from a circular orbit: a prograde burn centred where the
//               departure hyperbola's periapsis is (waiting for the craft to
//               come round to it), its size from the patched conics
//     aim       a correction worked out from the craft's own state by
//               kernelHost.aimTo, to the planned periapsis point at the next
//               waypoint (twice a leg: soon after leaving and near the end)
//     capture   a retrograde burn at periapsis into a circular orbit (a
//               rendezvous, for a small body: the kernel has no gravity of
//               its own for it)
//     tangent   an orbit change's prograde or retrograde burn
//     land      down to the surface: on an airless body a descent orbit, a
//               braking burn and a last fall and stop (landing.js), flown;
//               through an atmosphere the drag-free path to its perigee,
//               then set down beneath it (the entry itself is not flown)
//     liftoff   from the surface after the stay: a tilted rise, a gravity
//               turn and a circularising burn into the low orbit the next
//               departure leaves from
//   flyJourney(sys, plan, opts)  flies it: the burns it made, the path, and
//                                the closest approach to each waypoint; in
//                                the full model (environment.js) or bare
//   flyPlanned(sys, plan)        the full model, bare only as a fallback
//                                where its aims can't converge

import { stepCraft, aimTo, kernelSeconds, kernelMs } from './kernelHost.js';
import { eclToEqj, eqjToEcl, helioStateEqj } from './ephemeris.js';
import { departureHyperbola } from './launch.js';
import { bodyInfo, sphereOfInfluence, stateOf } from './journey.js';
import { turnAngle, rotate, moonExcess, asymptoteVelocities } from './transfers.js';
import { propagate, lambert } from './orbital.js';
import { solarSystemBodies, KERNEL_BODIES } from './bodies.js';
import { accelHeliocentric } from './nbody.js';
import { makeEnvironment } from './environment.js';
import { aimingRadius } from './transfers.js';
import { bodyAxesEqj } from './orientation.js';
import { deorbitDv, designBraking, designTerminal, designAscent, DESCENT_PERIAPSIS_KM, TOUCHDOWN_SPEED } from './landing.js';

const DAY = 86400;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / norm(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const Z = [0, 0, 1];
const KERNEL = new Set(['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
// The thrust of a planned burn (m/s^2): short enough to be near impulsive
// (3 km/s in 2.5 minutes), long enough for the kernel to step through.
export const PLAN_ACCEL = 20;
// The craft a journey is flown as, in the full model: the app's Craft
// defaults (craft.js), which mission.ts gives a journey's craft, so the
// environment sees the same craft headless and live. Its scripted burns
// draw nothing from its tank, so its mass stays dryMass + fuel.
export const JOURNEY_CRAFT = { dryMass: 1000, fuel: 500, area: 5, cr: 1.3, cd: 2.2 };
const TRIAL_MOON_DEGREE = 10;
export const JOURNEY_ENV = { mass: JOURNEY_CRAFT.dryMass + JOURNEY_CRAFT.fuel, area: JOURNEY_CRAFT.area, cr: JOURNEY_CRAFT.cr, cd: JOURNEY_CRAFT.cd };

const ecl = (v) => eclToEqj(v);
// A body's position at kernel time t: the kernel's own, or for a body the
// kernel lacks (a small body) from its elements.
const posAt = (sys, key, t) => sys.bodiesAt(t).find((b) => b.key === key)?.r.slice() ?? eclToEqj(stateOf(key, kernelMs(t)).r);
const state = (key, ms) => helioStateEqj(key, new Date(ms));
const perpEcliptic = (u) => { const n = sub(Z, scale(u, dot(Z, u))); return norm(n) > 1e-9 ? unit(n) : [1, 0, 0]; };

// The planned periapsis at a waypoint, relative to its body (ecliptic km):
// for a flyby, along u_in - u_out (the hyperbola from the inbound to the
// outbound excess velocity); for a capture, the hyperbola whose plane holds
// the next departure's excess velocity too, so the parking orbit it leaves
// from already contains it.
function periapsisOffset(sol, k, info = {}) {
  const Q = sol.stops[k + 1], inLeg = sol.legs[k], outLeg = sol.legs[k + 1];
  if (inLeg.ringArr) return inLeg.ringArr;
  // (Reaching a moon via its planet, the excess velocity about the moon,
  // journey.js moonArr, not the planet's.)
  const B = bodyInfo(Q.body), vin = inLeg.moonArr?.vinf ?? inLeg.vinfArr;
  if (!vin) return [0, 0, 0];
  const uin = unit(vin), fb = sol.flybys[k];
  const rp = fb ? fb.rp : B.radius + (Q.altKm ?? 300);
  if (B.mu < 1) return scale(unit(cross(uin, Z)), rp);           // a small body: no turn to speak of
  let uout;
  // The way out about this body: leaving a moon via its planet, the excess
  // velocity about the moon (journey.js moonDep), not the planet's. (The
  // stay turns the plane: the trims at the approach allow for it.)
  const wayOut = outLeg?.ok ? (outLeg.moonDep?.vinf ?? outLeg.vinfDep) : null;
  if (wayOut && !fb && Q.kind === 'orbit') { info.wayOut = wayOut; info.untilMs = outLeg.depMs; }
  if (fb && wayOut) uout = unit(wayOut);
  else {
    let n = wayOut ? cross(vin, wayOut) : null;
    n = n && norm(n) > 1e-9 * norm(vin) * norm(wayOut) ? unit(n) : perpEcliptic(uin);
    uout = rotate(uin, n, turnAngle(rp, norm(vin), B.mu));
  }
  const d = sub(uin, uout);
  return scale(norm(d) > 1e-9 ? unit(d) : unit(cross(uin, Z)), rp);
}

// The kernel's schedule for a solved journey. Returns { start: { r, v, ms },
// events: [...] sorted by time, unsupported: [reasons] }.
export function planFlight(sol) {
  const events = [], unsupported = [];
  const S = sol.stops, L0 = sol.legs[0];
  if (!sol.ok) return { start: null, events, unsupported: ['the journey has a leg with no solution'] };
  // Where the craft starts.
  let start;
  const s0 = S[0];
  if (s0.kind === 'craft') {
    // A craft's state is heliocentric ecliptic already.
    start = { r: ecl(s0.state.r), v: ecl(s0.state.v), ms: s0.depMs };
    // Its first burn: onto the leg's arc.
    events.push({ kind: 'impulse', ms: s0.depMs, dvEqj: ecl(sub(L0.arcs[0].v1, sub(s0.state.v, L0.central === 'sun' ? [0, 0, 0] : stateOf(L0.central, s0.depMs).v))) });
  } else if (L0.geometry === 'between') {
    const B = bodyInfo(s0.body), E = state(L0.endA ?? s0.body, s0.depMs);
    const h = departureHyperbola({ planetR: E.r, planetV: E.v, vInf: ecl(L0.vinfDep), mu: B.mu, rp: B.radius + s0.altKm });
    start = { r: h.r, v: h.v, ms: s0.depMs };
  } else if (L0.geometry === 'fromCentral') {
    const C = state(L0.central, s0.depMs);
    start = { r: add(C.r, ecl(L0.arcs[0].r1)), v: add(C.v, ecl(L0.arcs[0].v1)), ms: s0.depMs };
  } else {
    // An orbit change first: a circular orbit, prograde in the ecliptic.
    const B = bodyInfo(s0.body), C = state(s0.body, s0.depMs), r = B.radius + s0.altKm;
    start = { r: add(C.r, ecl([r, 0, 0])), v: add(C.v, ecl([0, Math.sqrt(B.mu / r), 0])), ms: s0.depMs };
  }
  for (const leg of sol.legs) {
    const k = leg.index, P = S[k], Q = S[k + 1];
    if (leg.geometry === 'local') {
      const B = bodyInfo(P.body), r1 = B.radius + P.altKm, r2 = B.radius + Q.altKm, up = r2 >= r1 ? 1 : -1;
      events.push({ kind: 'tangent', ms: leg.depMs, body: P.body, dv: up * leg.depDv });
      if (leg.midDv) events.push({ kind: 'tangent', ms: leg.arcs[1]?.t1 ?? leg.depMs, body: P.body, dv: up * leg.midDv });
      events.push({ kind: 'tangent', ms: leg.arrMs, body: P.body, dv: up * leg.arrDv, waypoint: k });
      continue;
    }
    // Leaving a stop where the craft was in orbit.
    if (k > 0 && P.kind !== 'flyby') {
      // Off the ground first, into the low orbit, three hours before the
      // departure (an ascent and its coast take about one).
      if (P.kind === 'land') events.push({ kind: 'liftoff', ms: Math.max(P.arrMs, leg.depMs - 3 * 3600e3), body: P.body, rOrbit: bodyInfo(P.body).radius + P.altKm, waypoint: k - 1 });
      // The way out is re-solved if the departure waits: Lambert about the
      // leg's central body to where the target is at the arrival. Leaving
      // a moon for another planet (via its planet), the excess velocity is
      // the planet's, and the moon's own is worked out from it.
      const via = leg.geometry === 'between' && leg.endA && leg.endA !== P.body ? leg.endA : null;
      // (Leaving a moon via its planet, the departure does not wait for the
      // plane: the moon's phase prices every day differently, and the plan
      // has chosen the day.)
      if (leg.vinfDep && KERNEL.has(P.body)) events.push({ kind: 'depart', ms: leg.depMs, body: P.body, vinfEqj: ecl(leg.vinfDep), rp: bodyInfo(P.body).radius + P.altKm, via, ...(via ? { waitDays: 0 } : {}),
        reaim: leg.geometry === 'between' && !leg.resonance ? (leg.brokenPlane || leg.deepSpace ? { central: leg.central, from: leg.endA ?? P.body, toEqj: ecl(leg.mid.r), arrMs: leg.mid.ms } : { central: leg.central, from: leg.endA ?? P.body, to: leg.endB ?? Q.body, arrMs: leg.arrMs }) : null });
      else if (leg.ringDep) events.push({ kind: 'depart-ring', ms: leg.depMs, body: P.body, dv: leg.depDv, dirEqj: ecl(unit(leg.ringDep)) });
      else if (leg.vinfDep) events.push({ kind: 'impulse-rel', ms: leg.depMs, body: P.body, vinfEqj: ecl(leg.vinfDep) });
    }
    // Aimed corrections to the planned periapsis (the bi-elliptic leg's
    // apoapsis burn is the first, aimed from the craft there).
    // Far out, the aim is at the B-plane: where the incoming asymptote
    // should pass the target at the arrival time, flown without the
    // target's own gravity (its pull is the hyperbola's, not an error to
    // cancel). At a central body (the Moon home to Earth) it is the planned
    // point itself, with everything.
    const offInfo = {}, off = periapsisOffset(sol, k, offInfo);
    // The excess velocity about the waypoint's body: reaching a moon via its
    // planet (Mars to the Moon), the one about the moon where it is on the
    // day (journey.js moonArr), and the aim is at the moon itself, not at its
    // planet: the planet's own pull on the way in is in every trial run.
    const vinQ = leg.moonArr?.vinf ?? leg.vinfArr, viaMoon = !!leg.moonArr;
    let aimOff = off, without = null;
    if (!leg.ringArr && vinQ && KERNEL.has(Q.body)) {
      const u = unit(vinQ), B = bodyInfo(Q.body), perp = sub(off, scale(u, dot(off, u)));
      aimOff = norm(perp) > 0 ? scale(unit(perp), aimingRadius(norm(off), norm(vinQ), B.mu)) : off;
      without = Q.body;
    }
    // Home to the central body: the point on the planned arc half an hour
    // short of the end, so no trial run meets the ground first.
    let arriveMs = leg.arrMs;
    if (leg.ringArr) {
      const arc = leg.arcs[leg.arcs.length - 1];
      arriveMs = leg.arrMs - Math.min(1800e3, 0.05 * (arc.t2 - arc.t1));
      aimOff = propagate(arc.r1, arc.v1, (arriveMs - arc.t1) / 1000, arc.mu).r;
    }
    const target = { body: leg.ringArr ? leg.central : viaMoon ? Q.body : (leg.endB ?? Q.body), offsetEqj: ecl(aimOff), arrive: arriveMs, without, central: leg.central };
    const dur = leg.arrMs - leg.depMs;
    // When: the first once the craft is clear of the body it left (half
    // again its sphere of influence at the leg's excess speed; a flyby's
    // powered burn is flown here, outside, so without its Oberth gain), the
    // second a few sphere-crossing times out from the target. (Not inside
    // it: there the craft reaches periapsis early, pulled in, and a point
    // aimed for at the planned time is the wrong hyperbola.)
    const crossing = (key, vinf) => (KERNEL.has(key) && vinf ? sphereOfInfluence(key) / norm(vinf) : 0) * 1000;
    // (Leaving a moon for another planet: clear of the planet.)
    const clearP = leg.central === P.body ? Math.min(0.1 * dur, 2 * 3600e3) : Math.max(Math.min(0.1 * dur, 2 * 3600e3), 1.5 * crossing(leg.endA ?? P.body, leg.vinfDep));
    const tIn = without ? crossing(Q.body, vinQ) : 0;
    // Burn nodes dragged onto the leg are flown as planned (their burns as
    // planned vectors); the aims come after the last of them, so the flight
    // keeps the shape given and corrects only what is left.
    const nodes = (leg.nodes ?? []).filter((n) => n.dv > 0);
    for (const n of nodes) events.push({ kind: 'impulse', ms: n.ms, dvEqj: ecl(n.dvVec), node: true });
    const afterNodes = nodes.length ? nodes[nodes.length - 1].ms + 0.02 * dur : -Infinity;
    // A return to the body just left (a resonant orbit): the aims fly
    // without the target's gravity, which is also the body the craft is
    // still climbing away from, so the first waits until it is well clear,
    // a quarter of the way round.
    const back = (leg.endB ?? Q.body) === (leg.endA ?? P.body);
    const first = Math.max(afterNodes, leg.mid ? leg.mid.ms : leg.depMs + (back ? 0.25 * dur : Math.min(clearP, 0.3 * dur)));
    // A broken plane or a deep-space burn: aimed at its point B first,
    // while the craft is near the departure (from there the target is near
    // 180 degrees away).
    if (leg.brokenPlane || leg.deepSpace) events.push({ kind: 'aim', ms: leg.depMs + Math.min(clearP, 0.3 * (leg.mid.ms - leg.depMs)), body: leg.central, offsetEqj: ecl(leg.mid.r), arrive: leg.mid.ms, without: null, central: leg.central });
    events.push({ kind: 'aim', ms: first, ...target });
    const second = Math.max(first + 0.25 * (leg.arrMs - first), leg.arrMs - 3 * tIn);
    if (second < leg.arrMs - 0.6 * tIn && leg.arrMs - first > 2 * DAY * 1000) events.push({ kind: 'aim', ms: second, ...target });
    // Inside the target's sphere: trim the periapsis radius alone (two-body
    // about the target, where its pull is most of the force).
    if (without) events.push({ kind: 'approach', ms: leg.arrMs - 0.6 * tIn, body: Q.body, rp: norm(off), ...(offInfo.wayOut ? { wayOutEqj: ecl(offInfo.wayOut), untilMs: offInfo.untilMs } : {}) });
    const wMs = leg.ringArr ? 0.25 * DAY * 1000 : Math.min(3 * DAY * 1000, Math.max(2 * 3600e3, 0.5 * (crossing(Q.body, vinQ) || DAY * 1000)));
    events.push({ kind: 'arrive', ms: leg.arrMs, body: Q.body, waypoint: k, plannedRp: norm(off), central: !!leg.ringArr, windowMs: wMs });
    // Home to the central body: how far the craft is from the aimed point.
    if (leg.ringArr) events.push({ kind: 'point', ms: arriveMs, waypoint: k, offsetEqj: ecl(aimOff), body: leg.central });
    const QB = bodyInfo(Q.body);
    if (Q.kind === 'orbit' || (Q.kind === 'land' && (!QB.atmosphere || !KERNEL.has(Q.body)))) events.push({ kind: KERNEL.has(Q.body) ? 'capture' : 'rendezvous', ms: leg.arrMs, body: Q.body });
    // Landing: flown down from the low orbit on an airless body; through
    // an atmosphere, from the perigee pass (in the window, before it; home
    // to a central body, its arc ends there); on a body without the
    // kernel's gravity, set down from the rendezvous.
    if (Q.kind === 'land') {
      const mode = !KERNEL.has(Q.body) ? 'setdown' : QB.atmosphere ? 'entry' : 'descent';
      events.push({ kind: 'land', ms: mode === 'entry' && !leg.ringArr ? leg.arrMs - wMs : leg.arrMs, body: Q.body, waypoint: k, mode });
      // Home through the air from a moon: the aimed point on the arc is
      // reached, but the perigee after it is the kernel's (the Moon's and
      // Sun's pulls over days move it by a hundred kilometres), so it is
      // trimmed to the planned entry height after the point.
      if (mode === 'entry' && leg.ringArr) events.push({ kind: 'approach', ms: arriveMs + 5 * 60e3, body: Q.body, rp: norm(off) });
    }
  }
  events.sort((a, b) => a.ms - b.ms || (a.kind === 'arrive' ? -1 : b.kind === 'arrive' ? 1 : 0));
  return { start, events, unsupported };
}

// Fly the plan through the kernel (sys: bodies.solarSystemBodies at the
// kernel's epoch). Returns { burns (the craft's scripted burns), path
// ([{ ms, r }] EQJ heliocentric), arrivals ([{ waypoint, body, closest (km
// from its centre), plannedRp, missKm, at (ms) }]), log, impact }.
// Seconds to the periapsis of the two-body orbit through r, v (negative if
// past it): the hyperbolic or elliptic anomaly from the state.
function timeToPeriapsis(r, v, mu) {
  // e cos E = 1 - r/a, e sin E = r v_r / sqrt(mu a) on an ellipse;
  // e cosh F = 1 - r/a, e sinh F = r v_r / sqrt(-mu a) on a hyperbola.
  const rn = norm(r), vr = dot(r, v) / rn, a = 1 / (2 / rn - dot(v, v) / mu);
  const A = 1 - rn / a, Bs = rn * vr / Math.sqrt(mu * Math.abs(a));
  if (a < 0) {
    const e = Math.sqrt(Math.max(0, A * A - Bs * Bs)), F = Math.atanh(Bs / A);
    return -(e * Math.sinh(F) - F) * Math.sqrt((-a) ** 3 / mu);
  }
  const e = Math.hypot(A, Bs), E = Math.atan2(Bs, A);
  return -(E - e * Math.sin(E)) * Math.sqrt(a ** 3 / mu);
}

// Seconds to the apoapsis of the ellipse through r, v (half a period from
// the periapsis).
function timeToApoapsis(r, v, mu) {
  const a = 1 / (2 / norm(r) - dot(v, v) / mu);
  if (!(a > 0)) return NaN;
  const T = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  let dt = timeToPeriapsis(r, v, mu) - T / 2;
  while (dt < 0) dt += T;
  return dt % T;
}

const WITHOUT = new Map();
function withoutBody(sys, key) {
  if (!WITHOUT.has(key)) WITHOUT.set(key, solarSystemBodies({ epochMs: sys.epochMs, keys: KERNEL_BODIES.filter((b) => b !== key) }));
  return WITHOUT.get(key);
}

// An aim that ends further than this from its point has not converged.
const AIM_CONVERGED_KM = 50;

// What went wrong in a flight, as reasons for the craft's Model row: the
// troubles it logged (an aim, a departure, a descent or an ascent it could
// not work out), a crash, a landing it planned and did not make, or a
// waypoint missed by more than 50 km or 2 % of the planned periapsis.
export function flightTrouble(plan, f) {
  const out = [...(f.trouble ?? [])];
  if (f.impact) out.push(`it hits ${bodyInfo(f.impact.body).name}`);
  const lands = plan.events.filter((e) => e.kind === 'land');
  for (const e of lands) if (!f.landings.some((l) => l.waypoint === e.waypoint)) out.push(`the landing on ${bodyInfo(e.body).name} is not made`);
  for (const a of f.arrivals) if (!a.landed && Number.isFinite(a.missKm) && a.missKm > Math.max(50, 0.02 * a.plannedRp)) out.push(`${bodyInfo(a.body).name} is missed by ${a.missKm.toFixed(0)} km`);
  return [...new Set(out)];
}

// The journey flown as the app will fly its craft: in the full model, and
// in the planner's bare model only as a fallback, when the full model's
// flight has trouble (flightTrouble) and the bare one has none. Returns the
// flight with model ('full' | 'bare') and, for a fallback, bareWhy (the
// full model's trouble, for the craft's Model row).
// deadlineMs: the full model's flight is given up past this much wall time
// (a long stay in a low lunar orbit, at degree 50, can take minutes), and
// that is its trouble.
export function flyPlanned(sys, plan, { deadlineMs = 60e3, ...opts } = {}) {
  const full = flyJourney(sys, plan, { ...opts, model: 'full', deadlineMs }), why = flightTrouble(plan, full);
  if (!why.length) return { ...full, bareWhy: null };
  const bare = flyJourney(sys, plan, { ...opts, model: 'bare' });
  if (flightTrouble(plan, bare).length) return { ...full, bareWhy: null, fullTrouble: why };
  return { ...bare, bareWhy: why.join('; ') };
}

export function flyJourney(sys, plan, { samples = 400, model = 'full', env: envIn = null, deadlineMs = Infinity } = {}) {
  const wallEnd = Date.now() + deadlineMs;
  const without = (key) => withoutBody(sys, key);
  // The model it is flown in: 'full', the environment (environment.js: the
  // Earth's and the Moon's gravity fields, the tides, drag, sunlight and
  // relativity) on the kernel's point masses and zonal terms, as the app's
  // Craft flies; 'bare', those alone (the planner's own model).
  const env = model === 'bare' ? null : (envIn ?? JOURNEY_ENV);
  // The same craft with the fields to degree 10, for looking ahead (a
  // departure's wait for its plane, a stay's turn of the plane).
  const searchEnv = env && { ...env, earth: { ...(env.earth ?? {}), degree: Math.min(env.earth?.degree ?? 20, 10) }, moon: { ...(env.moon ?? {}), degree: Math.min(env.moon?.degree ?? 50, TRIAL_MOON_DEGREE) } };
  // The same craft with the fields to degree 4, for an aim's sensitivities.
  const cheapEnv = env && { ...env, earth: { ...(env.earth ?? {}), degree: Math.min(env.earth?.degree ?? 20, 4) }, moon: { ...(env.moon ?? {}), degree: Math.min(env.moon?.degree ?? 50, 4) } };
  const out = { burns: [], path: [], arrivals: [], log: [], impact: null, correctionsDv: 0, landings: [], model: env ? 'full' : 'bare', trouble: [] };
  if (!plan.start) return out;
  const body = (key, t) => sys.bodiesAt(t).find((b) => b.key === key);
  let s = { r: [...plan.start.r], v: [...plan.start.v], t: kernelSeconds(new Date(plan.start.ms)) };
  const t0 = s.t, tEnd = kernelSeconds(new Date(plan.events.length ? plan.events[plan.events.length - 1].ms : plan.start.ms)) + DAY;
  const every = (tEnd - t0) / samples;
  out.path.push({ t: s.t, r: [...s.r] });
  // Closest approaches: each waypoint watched over a window about its
  // planned time, in fine steps, while the craft flies through it.
  const watches = plan.events.filter((e) => e.kind === 'arrive').map((e) => {
    const T = kernelSeconds(new Date(e.ms)), w = e.windowMs / 1000;
    return { ...e, t0: T - w, t1: T + w, step: (2 * w) / 240, best: Infinity, at: NaN };
  });
  // Between samples, the osculating conic about the body gives the
  // periapsis itself when it falls before the watch ends.
  const look = () => {
    for (const w of watches) {
      if (s.t < w.t0 - 1e-6 || s.t > w.t1 + 1e-6) continue;
      const d = norm(sub(s.r, posAt(sys, w.body, s.t)));
      if (d < w.best) { w.best = d; w.at = s.t; }
      const B = body(w.body, s.t);
      if (!B || w.central) continue;
      const x = rel(w.body, s.t), tp = timeToPeriapsis(x.r, x.v, B.mu);
      if (tp > 0 && tp <= w.step && s.t + tp <= w.t1 + 1) {
        const p = propagate(x.r, x.v, tp, B.mu);
        if (p && norm(p.r) < w.best) { w.best = norm(p.r); w.at = s.t + tp; }
      }
    }
  };
  // On the ground (held: { key, local }), the craft turns with the body:
  // its path follows the site. landingOn: the body a descent is coming down
  // to, where an impact is the touchdown (touch: the state there).
  let held = null, landingOn = null, touch = null;
  // Fly to time t, recording the path; stops at an impact. chunk: the
  // longest stretch handed to the kernel at once.
  const flyTo = (t, chunk = every) => {
    while (held && s.t < t - 1e-6) {
      const tn = Math.min(t, s.t + every), x = siteAt(held, tn);
      s = { r: x.r, v: x.v, t: tn };
      out.path.push({ t: s.t, r: [...s.r] });
    }
    while (s.t < t - 1e-6 && !out.impact && !touch && !out.gaveUp) {
      if (Date.now() > wallEnd) { out.gaveUp = true; out.trouble.push(`the flight took longer than ${Math.round(deadlineMs / 1000)} s to work out`); out.log.push('given up: past the time allowed'); break; }
      let tn = Math.min(t, s.t + chunk);
      for (const w of watches) if (tn > w.t0 && s.t < w.t1) tn = Math.min(tn, Math.max(s.t + w.step, Math.min(w.t0, tn)), s.t + w.step);
      const res = stepCraft(sys, { id: 0, version: 0, r: s.r, v: s.v, t: s.t, tEnd: tn, primary: null, burns: out.burns, maxSteps: 2e6, ...(env ? { env } : {}) });
      const hit = res.events.find((e) => e.type === 'impact');
      s = { r: res.r, v: res.v, t: res.t };
      if (chunk >= every || s.t - out.path[out.path.length - 1].t >= every || s.t >= t - 1e-6) out.path.push({ t: s.t, r: [...s.r] });
      look();
      // The kernel's impact is where its step crossed the surface (impact.js).
      if (hit && hit.body === landingOn) { touch = s; if (out.path[out.path.length - 1].t !== s.t) out.path.push({ t: s.t, r: [...s.r] }); break; }
      if (hit) { out.impact = { body: hit.body, t: hit.t }; break; }
      if (!res.complete) { out.log.push(`kernel stopped short at ${s.t}`); out.trouble.push('the kernel stopped short'); break; }
    }
  };
  const burn = (t, dir, dvKmS, frame = null, about = null) => {
    const dur = (dvKmS * 1000) / PLAN_ACCEL;
    if (!(dur > 0)) return;
    // Centred on t: a finite burn loses least about its aim point.
    const b = { t0: t - dur / 2, t1: t + dur / 2, dir: frame ? dir : unit(dir), F: PLAN_ACCEL, m0: 1, mdot: 0, scripted: true, ...(frame ? { frame, about } : {}) };
    out.burns.push(b);
    return b;
  };
  const bodyState = (key, t) => {
    const B = body(key, t);
    if (B) { const v = [0, 0, 0]; B.eph.velocity(t, v); return { r: B.r.slice(), v, mu: B.mu }; }
    const x = stateOf(key, kernelMs(t));
    return { r: eclToEqj(x.r), v: eclToEqj(x.v), mu: 0 };
  };
  const rel = (key, t) => { const B = bodyState(key, t); return { r: sub(s.r, B.r), v: sub(s.v, B.v), B }; };
  const durOf = (dv) => (dv * 1000) / PLAN_ACCEL;
  const peri = new Map();
  // A body's axes at kernel time t (orientation.js); fixed axes for a body
  // with no rotation model (a small body).
  const axesOf = (key, t) => { try { return bodyAxesEqj(key, new Date(kernelMs(t))); } catch { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; } };
  // A site's state at t: its body's, plus the body-fixed point turned
  // into space (and its velocity from the turn over a second).
  function siteAt(S, t) {
    const at = (tt) => { const [X, Y, W] = axesOf(S.key, tt); return [0, 1, 2].map((i) => X[i] * S.local[0] + Y[i] * S.local[1] + W[i] * S.local[2]); };
    const B = bodyState(S.key, t), d0 = at(t), d1 = at(t + 1);
    return { r: add(B.r, d0), v: add(B.v, sub(d1, d0)) };
  }
  // The surface beneath relative position d (km): the mean sphere, or the
  // Earth's ellipsoid about its pole, as the kernel's impacts take them.
  const surfaceUnder = (key, d, t) => {
    const b = body(key, t), u = unit(d);
    if (b?.surface && b.pole) { const z = dot(u, b.pole); return scale(u, 1 / Math.sqrt((1 - z * z) / b.surface.a ** 2 + z * z / b.surface.c ** 2)); }
    return scale(u, b?.radius ?? bodyInfo(key).radius);
  };
  // Down: the craft held at the point beneath it, the watch on the body
  // ended (it measured the way in), the landing recorded.
  const setDown = (key, waypoint, how, extra = {}) => {
    const B = bodyState(key, s.t), [X, Y, W] = axesOf(key, s.t), d = surfaceUnder(key, sub(s.r, B.r), s.t);
    const ground = siteAt({ key, local: [dot(X, d), dot(Y, d), dot(W, d)] }, s.t), speed = norm(sub(s.v, ground.v));
    held = { key, local: [dot(X, d), dot(Y, d), dot(W, d)] };
    for (const w of watches) if (w.body === key && w.t0 <= s.t && w.t1 >= s.t) w.t1 = s.t;
    const x = siteAt(held, s.t);
    s = { r: x.r, v: x.v, t: s.t };
    out.path.push({ t: s.t, r: [...s.r] });
    const lat = Math.asin(held.local[2] / norm(held.local)) * 180 / Math.PI, lon = Math.atan2(held.local[1], held.local[0]) * 180 / Math.PI;
    out.landings.push({ body: key, waypoint, t: s.t, local: [...held.local], how, speed, lat, lon, until: null, ...extra });
    return speed;
  };
  // The excess velocity a departure leaves on at time tt, about the body
  // left: as planned, or re-solved to the leg's arrival when it has waited
  // (Lambert about the leg's central body from where the leg's end body is
  // then); leaving a moon via its planet, the planet's excess turned into
  // the moon's: the speed about the planet at the moon whose asymptote is
  // the planned one, less the moon's own.
  const departWant = (e, tt) => {
    let want = e.vinfEqj;
    if (e.reaim && Math.abs(tt - kernelSeconds(new Date(e.ms))) >= 3600) {
      const T = kernelSeconds(new Date(e.reaim.arrMs));
      const C = e.reaim.central === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : bodyState(e.reaim.central, tt), CT = e.reaim.central === 'sun' ? [0, 0, 0] : posAt(sys, e.reaim.central, T);
      const P0 = bodyState(e.reaim.from ?? e.body, tt), to = e.reaim.toEqj ?? sub(posAt(sys, e.reaim.to, T), CT);
      const muC = e.reaim.central === 'sun' ? sys.muSun : bodyInfo(e.reaim.central).mu;
      const arc = lambert(sub(P0.r, C.r), to, T - tt, muC, true);
      if (arc) want = sub(arc.v1, sub(P0.v, C.v));
    }
    if (!e.via) return want;
    // Of the two hyperbolas through the moon's place that leave on that
    // asymptote (transfers.js moonExcess, as the plan prices it), the one
    // nearer the moon's own velocity.
    const M = bodyState(e.body, tt), Pp = bodyState(e.via, tt);
    const rm = sub(M.r, Pp.r), x = moonExcess({ rm, vm: sub(M.v, Pp.v), vinf: want, mu: Pp.mu, rMin: 0.5 * norm(rm) });
    return x ? x.vinf : want;
  };

  // The pull towards a body's centre on the craft now (km/s^2), in the
  // flight's model: the kernel's point masses and zonal terms and the
  // environment, less the body's own acceleration (its ephemeris velocity
  // differenced over a second).
  const envFn = env ? makeEnvironment(sys, env) : null;
  function localGravity(key) {
    const a = accelHeliocentric(s.r, sys.bodiesAt(s.t), sys.muSun);
    if (envFn) envFn(s.t, s.r, s.v, a, s.t);
    const B = body(key, s.t), v0 = [0, 0, 0], v1 = [0, 0, 0];
    B.eph.velocity(s.t - 0.5, v0); B.eph.velocity(s.t + 0.5, v1);
    return -dot(sub(a, sub(v1, v0)), unit(sub(s.r, B.r)));
  }

  // The way out as it must be at the capture for the parking orbit's plane
  // to hold it when the stay ends: a long stay turns the plane (the body's
  // J2 regresses the node, and the planet's pull and, in the full model,
  // the field's mascons move it too), so a trial circular orbit at the
  // planned periapsis is flown through the stay in the kernel, and the way
  // out turned back by the rotation that took its plane from the one to the
  // other. Twice, as that rotation depends a little on the plane.
  function stayTurned(key, r, v, rp, w, tUntil) {
    const mu = bodyState(key, s.t).mu, hN = unit(cross(r, v));
    const tp = Math.max(0, timeToPeriapsis(r, v, mu)), x = propagate(r, v, tp, mu), t0 = s.t + tp;
    // (Over a stay of more than a month the plane goes round many times,
    // and the departure's wait for it does better.)
    if (!x || !(tUntil > t0 + 3600) || tUntil - t0 > 30 * DAY) return w;
    let ww = w, best = null;
    // (In the full model, the trials take the Moon's field to degree 10:
    // its low harmonics move the plane, and a week at degree 50 is seconds.)
    const trialEnv = searchEnv;
    for (let it = 0; it < 3; it++) {
      // The plane holding the way in and ww, turned the way the craft goes
      // round; the circular orbit at rp beneath the periapsis.
      const nn = unit(cross(v, ww)), N = dot(nn, hN) >= 0 ? nn : scale(nn, -1);
      const p = scale(unit(sub(x.r, scale(N, dot(x.r, N)))), rp), vc = scale(unit(cross(N, p)), Math.sqrt(mu / rp));
      const B0 = bodyState(key, t0);
      const res = stepCraft(sys, { id: 0, version: 0, r: add(B0.r, p), v: add(B0.v, vc), t: t0, tEnd: tUntil, primary: null, burns: [], maxSteps: 2e6, ...(trialEnv ? { env: trialEnv } : {}) });
      if (!res.complete || res.events.some((q) => q.type === 'impact')) break;
      const B1 = bodyState(key, res.t), n1 = unit(cross(sub(res.r, B1.r), sub(res.v, B1.v)));
      // How far off the way out its plane ends, and the next try.
      const off = Math.abs(dot(n1, unit(w)));
      if (!best || off < best.off) best = { off, ww };
      if (off < 1e-4) break;
      const k = cross(N, n1), ang = Math.asin(Math.min(1, norm(k)));
      ww = ang > 1e-9 ? rotate(w, unit(k), -ang) : w;
    }
    return best ? best.ww : w;
  }

  for (const e of plan.events) {
    let t = kernelSeconds(new Date(e.ms));
    if (out.impact || out.gaveUp) break;
    if (e.kind === 'arrive') continue;
    if (e.kind === 'point') {
      // Home to the central body: how far from the aimed point on the arc.
      flyTo(t);
      const w = watches.find((x) => x.waypoint === e.waypoint);
      if (w && Math.abs(s.t - t) < 1) w.pointMiss = norm(sub(s.r, add(posAt(sys, e.body, s.t), e.offsetEqj)));
      continue;
    }
    if (e.kind === 'depart') {
      // From whatever orbit the craft is in now, the burn onto the outgoing
      // asymptote: at each of 72 points round the orbit, the two-body arc
      // (Lambert about the body) to a point out along the excess velocity a
      // sphere-crossing later; the cheapest is burned, as its full vector.
      // A long stay turns the orbit's plane (a planet's J2 precesses its
      // node, about 10 degrees a day at 400 km over Mars), so the plane may
      // no longer hold the way out: as a mission would, the departure waits
      // (up to `waitDays`, in half-day steps) for the plane to come round,
      // when that saves more than 2 %. The aims that follow tidy the rest.
      flyTo(t);
      // At each point round the orbit, the two hyperbolas through it that
      // leave on the way out (transfers.js asymptoteVelocities, exact); the
      // cheaper burn, at 72 points and then by golden section about the best.
      const cheapest = (st = s) => {
        const want = departWant(e, st.t), Bs = bodyState(e.body, st.t), B = Bs;
        const r = sub(st.r, Bs.r), v = sub(st.v, Bs.v);
        const a = 1 / (2 / norm(r) - dot(v, v) / B.mu), T = 2 * Math.PI * Math.sqrt(Math.abs(a) ** 3 / B.mu);
        const at = (dt) => {
          const x = dt ? propagate(r, v, dt, B.mu) : { r, v };
          let best = null;
          if (x) for (const v1 of asymptoteVelocities(x.r, want, B.mu)) {
            const d = sub(v1, x.v), m = norm(d);
            if (Number.isFinite(m) && (!best || m < best.m)) best = { dt, d, m, T };
          }
          return best;
        };
        let best = null, bi = 0;
        for (let i = 0; i < 72; i++) { const c = at((T * i) / 72); if (c && (!best || c.m < best.m)) { best = c; bi = i; } }
        if (!best) return null;
        let lo = (T * (bi - 1)) / 72, hi = (T * (bi + 1)) / 72;
        const gr = (Math.sqrt(5) - 1) / 2, m = (dt) => at(((dt % T) + T) % T)?.m ?? Infinity;
        for (let k = 0; k < 30; k++) { const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo); if (m(c) < m(d)) hi = d; else lo = c; }
        const g = at((((lo + hi) / 2) % T + T) % T);
        return g && g.m < best.m ? g : best;
      };
      // The days ahead are looked at on a side run (in the full model with
      // the fields to degree 10: weeks at degree 50 are a minute), and only
      // the wait chosen is flown.
      const t0 = s.t;
      let best = cheapest(), bestAt = s.t, st = { ...s };
      const onDay = best?.m;
      for (let h = 0.5; h <= (e.waitDays ?? 30) && best; h += 0.5) {
        const res = stepCraft(sys, { id: 0, version: 0, r: st.r, v: st.v, t: st.t, tEnd: t0 + h * DAY, primary: null, burns: out.burns, maxSteps: 2e6, ...(env ? { env: searchEnv } : {}) });
        if (!res.complete || res.events.some((q) => q.type === 'impact')) break;
        st = { r: res.r, v: res.v, t: res.t };
        const b = cheapest(st);
        if (b && b.m < best.m * 0.98) { best = b; bestAt = st.t; }
      }
      if (bestAt !== t0) { flyTo(bestAt); best = cheapest() ?? best; }
      if (!best) { out.log.push(`depart ${e.body}: no burn found`); out.trouble.push(`no burn leaves ${bodyInfo(e.body).name} on the way out`); continue; }
      let tb = s.t + best.dt;
      if (tb - durOf(best.m) / 2 < s.t) tb += best.T;
      burn(tb, best.d, best.m);
      out.log.push(`depart ${e.body}: ${(best.m * 1000).toFixed(0)} m/s, ${((tb - kernelSeconds(new Date(e.ms))) / 3600).toFixed(1)} h after the planned time${bestAt !== t0 && onDay ? ` (${(onDay * 1000).toFixed(0)} m/s on the planned day)` : ''}`);
      continue;
    }
    if (e.kind === 'depart-ring') {
      // Leaving a planet for its moon: prograde where the planned arc starts.
      flyTo(t);
      const { r, v, B } = rel(e.body, s.t);
      const n = unit(cross(r, v)), w = Math.sqrt(B.mu / norm(r) ** 3);
      const target = unit(sub(e.dirEqj, scale(n, dot(e.dirEqj, n))));
      const ang = Math.atan2(dot(cross(unit(r), target), n), dot(unit(r), target));
      t = s.t + (((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / w;
      if (t - durOf(e.dv) / 2 < s.t) t += 2 * Math.PI / w;
      burn(t, [1, 0, 0], e.dv, 'vnb', e.body);
      out.log.push(`depart ${e.body}: ${(e.dv * 1000).toFixed(0)} m/s prograde, ${((t - kernelSeconds(new Date(e.ms))) / 60).toFixed(0)} min after the planned time`);
      continue;
    }
    if (e.kind === 'land') {
      if (e.mode === 'setdown') { flyTo(t); setDown(e.body, e.waypoint, 'setdown'); out.log.push(`set down on ${e.body}`); continue; }
      landingOn = e.body; touch = null;
      if (e.mode === 'entry') {
        // Through the air: the drag-free path flown to its perigee, set down
        // beneath it. A path that meets the ground first is a crash: the
        // perigee was meant to be the entry height, well up.
        flyTo(t);
        for (let i = 0; i < 4 && !touch && !out.impact; i++) {
          const { r, v, B } = rel(e.body, s.t), tp = timeToPeriapsis(r, v, B.mu);
          if (!(tp > 1)) break;
          flyTo(s.t + tp);
        }
        if (out.impact) break;
        if (touch) {
          const B = bodyState(e.body, s.t), [X, Y, W] = axesOf(e.body, s.t), d = sub(s.r, B.r);
          const speed = norm(sub(s.v, siteAt({ key: e.body, local: [dot(X, d), dot(Y, d), dot(W, d)] }, s.t).v));
          out.impact = { body: e.body, t: s.t, speed };
          out.log.push(`entry at ${e.body}: the drag-free path met the ground at ${(speed * 1000).toFixed(0)} m/s before its perigee`);
          landingOn = null; touch = null;
          break;
        }
        const hp = norm(rel(e.body, s.t).r) - bodyInfo(e.body).radius;
        setDown(e.body, e.waypoint, 'entry', { entryKm: hp });
        landingOn = null; touch = null;
        out.log.push(`entry at ${e.body}: perigee ${hp.toFixed(0)} km up, set down beneath it`);
        continue;
      }
      // An airless body, from the low orbit the capture left it in: the
      // descent orbit to 15 km, then from its periapsis the braking burn
      // and the last fall and stop, each worked out from the craft's own
      // state when it comes to it.
      flyTo(Math.max(t, ...out.burns.map((b) => b.t1)) + 60);
      if (out.impact) break;
      const Bk = body(e.body, s.t), R = Bk.radius, g = Bk.mu / (R * R);
      let { r, v } = rel(e.body, s.t);
      // The descent orbit from the orbit the craft is really in: a long
      // capture (2 km/s from Mars, against 0.8 from the Earth) leaves it
      // eccentric, so the burn along the velocity that puts the two-body
      // periapsis 15 km up (bisection), not the circular orbit's.
      const rpAfter = (dv) => {
        const vv = sub(v, scale(unit(v), dv)), h = norm(cross(r, vv)), en = dot(vv, vv) / 2 - Bk.mu / norm(r);
        return (h * h / Bk.mu) / (1 + Math.sqrt(Math.max(0, 1 + 2 * en * h * h / (Bk.mu * Bk.mu))));
      };
      const rpWant = R + DESCENT_PERIAPSIS_KM;
      let d1 = deorbitDv(Bk.mu, norm(r), rpWant);
      if (Math.abs(rpAfter(d1) - rpWant) > 0.1) {
        let lo = -0.3, hi = 0.9 * norm(v);
        if (rpAfter(lo) > rpWant && rpAfter(hi) < rpWant) {
          for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (rpAfter(m) > rpWant) lo = m; else hi = m; }
          d1 = (lo + hi) / 2;
        }
      }
      const b1 = burn(s.t + durOf(Math.abs(d1)) / 2 + 1, [-Math.sign(d1) || -1, 0, 0], Math.abs(d1), 'vnb', e.body);
      flyTo(b1.t1 + 10);
      // Half an orbit down to the periapsis, the braking burn worked out two
      // minutes short of it (the Earth's pull and the Moon's J2 move a
      // periapsis by kilometres over the half orbit).
      ({ r, v } = rel(e.body, s.t));
      const toPeri = (rr, vv) => { const tp = timeToPeriapsis(rr, vv, Bk.mu); return tp > 0 ? tp : tp + 2 * Math.PI * Math.sqrt((1 / (2 / norm(rr) - dot(vv, vv) / Bk.mu)) ** 3 / Bk.mu); };
      flyTo(s.t + toPeri(r, v) - 120);
      if (out.impact) break;
      ({ r, v } = rel(e.body, s.t));
      const dtp = toPeri(r, v), x = propagate(r, v, dtp, Bk.mu) ?? { r, v };
      const br = designBraking({ r: x.r, v: x.v, mu: Bk.mu, R, hEnd: 1.5 });
      if (!br) { out.log.push(`descent to ${e.body}: no braking burn stops it above the ground`); out.trouble.push(`no braking burn sets it down on ${bodyInfo(e.body).name}`); landingOn = null; continue; }
      const tB = s.t + dtp, scripted = (t0, t1, a, dir, frame) => { const b = { t0, t1, dir, F: a * 1000, m0: 1, mdot: 0, scripted: true, ...(frame ? { frame: 'vnb', about: e.body } : {}) }; out.burns.push(b); return b; };
      scripted(tB, tB + br.dur, br.accel, [-1, 0, 0], true);
      flyTo(tB + br.dur + 0.5, 30);
      let term = null, match = 0;
      if (!touch && !out.impact) {
        // Across the ground: the braking stopped the craft in space, where
        // the ground beneath moves with the body's spin (4.6 m/s on the
        // Moon's equator), so a sideways burn matches it.
        ({ r, v } = rel(e.body, s.t));
        const Bs = bodyState(e.body, s.t), [X, Y, W] = axesOf(e.body, s.t), dd = sub(s.r, Bs.r);
        const gv = sub(siteAt({ key: e.body, local: [dot(X, dd), dot(Y, dd), dot(W, dd)] }, s.t).v, Bs.v), up = unit(r);
        let dh = sub(gv, v);
        dh = sub(dh, scale(up, dot(dh, up)));
        match = norm(dh);
        if (match > 1e-5) { burn(s.t + durOf(match) / 2 + 0.5, dh, match); flyTo(s.t + durOf(match) + 1, 1); ({ r, v } = rel(e.body, s.t)); }
        // The fall is designed on the gravity the flight's model has here,
        // radially (the body's J2 and, in the full model, its field's
        // mascons change it by tenths of a percent: metres over the fall).
        term = designTerminal({ r, v, mu: localGravity(e.body) * dot(r, r), R, accel: 2.5 * g });
        if (term) scripted(s.t + term.delay, s.t + term.delay + term.dur, term.accel, term.dir, false);
        flyTo(s.t + (term ? term.delay + term.dur : 0) + 600, 1);
      }
      if (out.impact) break;
      if (touch) s = touch;
      const dv = Math.abs(d1) + br.dv + match + (term?.dv ?? 0);
      const up = norm(rel(e.body, s.t).r) - R;
      if (!touch && up > 0.1) { out.log.push(`descent to ${e.body}: still ${(up * 1000).toFixed(0)} m up`); out.trouble.push(`the descent to ${bodyInfo(e.body).name} stopped ${(up * 1000).toFixed(0)} m up`); landingOn = null; continue; }
      const speed = setDown(e.body, e.waypoint, 'descent', { dv });
      landingOn = null; touch = null;
      if (speed > TOUCHDOWN_SPEED) { out.impact = { body: e.body, t: s.t, speed }; held = null; out.log.push(`descent to ${e.body}: hit the ground at ${(speed * 1000).toFixed(1)} m/s`); break; }
      out.log.push(`landed on ${e.body}: ${(speed * 1000).toFixed(1)} m/s at touchdown, ${(dv * 1000).toFixed(0)} m/s for the descent (descent orbit ${(Math.abs(d1) * 1000).toFixed(0)}, braking ${(br.dv * 1000).toFixed(0)} at ${(br.accel * 1000).toFixed(2)} m/s^2, across ${(match * 1000).toFixed(1)}, last ${((term?.dv ?? 0) * 1000).toFixed(0)})`);
      continue;
    }
    if (e.kind === 'liftoff') {
      if (!held) { out.log.push(`liftoff from ${e.body}: not on the ground`); continue; }
      flyTo(t);
      const L = out.landings[out.landings.length - 1];
      L.until = s.t;
      const here = siteAt(held, s.t);
      held = null;
      if (!KERNEL.has(e.body)) { s = { r: here.r, v: here.v, t: s.t }; out.log.push(`liftoff from ${e.body}`); continue; }
      // Into the plane of the way out: the next departure's excess
      // velocity (or eastward, failing one), turned the way the body spins.
      const Bk = body(e.body, s.t), R = Bk.radius, g = Bk.mu / (R * R), B = bodyState(e.body, s.t);
      const r = sub(here.r, B.r), v = sub(here.v, B.v), up = unit(r), pole = axesOf(e.body, s.t)[2];
      const next = plan.events.find((x) => x.ms > e.ms && x.body === e.body && (x.kind === 'depart' || x.kind === 'depart-ring'));
      const u = next ? (next.kind === 'depart' ? departWant(next, kernelSeconds(new Date(next.ms))) : next.dirEqj) : null;
      let along = u ? sub(u, scale(up, dot(u, up))) : null;
      if (!along || norm(along) < 1e-6 * norm(u)) along = cross(pole, up);
      along = unit(along);
      if (dot(cross(up, along), pole) < 0) along = scale(along, -1);
      const accel = 5 * g;
      const a = designAscent({ r, v, mu: Bk.mu, R, rOrbit: e.rOrbit, normal: unit(cross(up, along)), accel });
      s = { r: add(here.r, scale(up, 1e-3)), v: here.v, t: s.t };
      if (!a) { out.log.push(`liftoff from ${e.body}: no ascent found`); out.trouble.push(`no ascent from ${bodyInfo(e.body).name}`); continue; }
      const t0 = s.t;
      out.burns.push({ t0, t1: t0 + a.rise, dir: a.dirRise, F: accel * 1000, m0: 1, mdot: 0, scripted: true });
      out.burns.push({ t0: t0 + a.rise, t1: t0 + a.rise + a.dur, dir: [1, 0, 0], F: accel * 1000, m0: 1, mdot: 0, scripted: true, frame: 'vnb', about: e.body });
      // The circularising burn at the apoapsis, from the craft's own
      // state when the climb is done.
      flyTo(t0 + a.rise + a.dur + 1);
      if (out.impact) break;
      const c = rel(e.body, s.t), tA = s.t + Math.max(0, timeToApoapsis(c.r, c.v, Bk.mu)), xa = propagate(c.r, c.v, tA - s.t, Bk.mu);
      const circ = xa ? Math.sqrt(Bk.mu / norm(xa.r)) - norm(xa.v) : a.circ;
      burn(tA, [Math.sign(circ), 0, 0], Math.abs(circ), 'vnb', e.body);
      L.ascentDv = accel * (a.rise + a.dur) + Math.abs(circ);
      out.log.push(`liftoff from ${e.body}: ${(L.ascentDv * 1000).toFixed(0)} m/s into orbit (tilt ${(a.kick * 180 / Math.PI).toFixed(1)} deg, climb ${(a.rise + a.dur).toFixed(0)} s, circularise ${(circ * 1000).toFixed(0)} m/s at ${(norm(xa?.r ?? [R, 0, 0]) - R).toFixed(0)} km)`);
      continue;
    }
    if (e.kind === 'tangent') {
      flyTo(t - durOf(Math.abs(e.dv)) / 2 - 1);
      burn(t, [Math.sign(e.dv), 0, 0], Math.abs(e.dv), 'vnb', e.body);
      continue;
    }
    if (e.kind === 'capture') {
      // Near the planned periapsis: its time and speed on the two-body
      // hyperbola about the body from a little before, and a retrograde
      // burn from there down to the circular speed.
      const lead = 6 * 3600 + durOf(5);
      flyTo(Math.min(t, peri.get(e.body) ?? t) - lead);
      if (out.impact) break;
      const { r, v, B } = rel(e.body, s.t);
      const dtp = Math.max(0, timeToPeriapsis(r, v, B.mu)), x = propagate(r, v, dtp, B.mu) ?? { r, v };
      const tp = s.t + dtp, rp = norm(x.r), vp = norm(x.v);
      const dv = vp - Math.sqrt(B.mu / rp);
      // From periapsis on, not centred on it: braking before periapsis
      // would drop the path into the body (a 6 km/s capture takes minutes).
      const tb = Math.max(tp, s.t);
      for (const w of watches) if (w.body === e.body && w.t0 <= tb && w.t1 >= tb) w.t1 = tb;
      if (dv > 0) burn(tb + durOf(dv) / 2, [-1, 0, 0], dv, 'vnb', e.body);
      out.log.push(`capture at ${e.body}: ${(dv * 1000).toFixed(0)} m/s retrograde at ${rp.toFixed(0)} km`);
      continue;
    }
    flyTo(t);
    if (out.impact) break;
    if (e.kind === 'impulse') { const d = norm(e.dvEqj); burn(s.t + durOf(d) / 2, e.dvEqj, d); continue; }
    if (e.kind === 'impulse-rel') {
      // Leaving a small body (no gravity in the kernel): straight onto the
      // excess velocity.
      const { v } = rel(e.body, s.t), d = sub(e.vinfEqj, v);
      burn(s.t + (norm(d) * 1000) / PLAN_ACCEL / 2, d, norm(d));
      continue;
    }
    if (e.kind === 'aim') {
      if (kernelSeconds(new Date(e.arrive)) - s.t < 3600) continue;      // too late to aim: nodes ran into it
      const Tk = kernelSeconds(new Date(e.arrive));
      const target = add(posAt(sys, e.body, Tk), e.offsetEqj);
      const future = out.burns.filter((b) => b.t1 > s.t);
      // A first guess: the two-body arc about the leg's central body.
      const C0 = e.central === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : bodyState(e.central, s.t), CT = e.central === 'sun' ? [0, 0, 0] : posAt(sys, e.central, Tk);
      const muC = e.central === 'sun' ? sys.muSun : bodyInfo(e.central).mu;
      const arc = lambert(sub(s.r, C0.r), sub(target, CT), Tk - s.t, muC, true);
      const dv0 = arc ? sub(arc.v1, sub(s.v, C0.v)) : null;
      const k = aimTo(e.without ? without(e.without) : sys, { r: s.r, v: s.v, t0: s.t, T: Tk, target, burns: future, dv0, rounds: 8, damped: true, env, envJ: env && cheapEnv });
      if (!k) { out.log.push(`aim at ${e.body} failed`); out.trouble.push(`the aim at ${bodyInfo(e.body).name} found no burn`); continue; }
      if (k.after > AIM_CONVERGED_KM) out.trouble.push(`the aim at ${bodyInfo(e.body).name} came no nearer than ${k.after.toFixed(0)} km`);
      const dv = norm(k.dv);
      if (dv > 1e-7) burn(s.t + durOf(dv) / 2, k.dv, dv);
      out.correctionsDv = (out.correctionsDv ?? 0) + dv;
      out.log.push(`aim at ${e.body}: ${(dv * 1000).toFixed(2)} m/s (miss ${k.miss.toFixed(0)} km, aimed ${k.after.toFixed(2)} km)`);
      continue;
    }
    if (e.kind === 'approach') {
      // Twice: trim the periapsis radius, by a burn b along the aim (the
      // part of r across v), secant on b, two-body about the body; the
      // second halfway on to the periapsis, whose time is kept for the
      // capture (the body's pull brings it early, hours early at the Moon).
      // Into an orbit the craft will leave again, the burn also turns the
      // hyperbola's plane to hold the way out (wayOutEqj), so the parking
      // orbit does: Newton on the two components across v, for the
      // periapsis and the plane together.
      for (let pass = 0; pass < 2 && !out.impact; pass++) {
        const { r, v, B } = rel(e.body, s.t);
        if (dot(r, v) > 0) break;                                   // past periapsis already
        const across = sub(r, scale(unit(v), dot(r, unit(v)))), bh = norm(across) > 0 ? unit(across) : unit(cross(v, Z));
        const rpOf = (dv) => {
          const vv = add(v, dv), h = norm(cross(r, vv)), en = dot(vv, vv) / 2 - B.mu / norm(r);
          return (h * h / B.mu) / (1 + Math.sqrt(Math.max(0, 1 + 2 * en * h * h / (B.mu * B.mu))));
        };
        let b0 = 0, b1 = 1e-4, f0 = rpOf([0, 0, 0]) - e.rp, f1 = rpOf(scale(bh, b1)) - e.rp;
        for (let i = 0; i < 30 && Math.abs(f1) > 0.1 && f1 !== f0; i++) { const b2 = b1 - f1 * (b1 - b0) / (f1 - f0); b0 = b1; f0 = f1; b1 = b2; f1 = rpOf(scale(bh, b1)) - e.rp; }
        let dv = Number.isFinite(b1) && Math.abs(b1) < 0.5 ? scale(bh, b1) : [0, 0, 0];
        let w = e.wayOutEqj ? unit(e.wayOutEqj) : null;
        if (w && pass === 0 && e.untilMs) w = stayTurned(e.body, r, v, e.rp, w, kernelSeconds(new Date(e.untilMs)));
        if (w) e.wayOutEqj = w;
        if (w && norm(cross(w, unit(v))) > 0.02) {
          const e2 = unit(cross(v, bh));
          const F = (x) => { const d = add(scale(bh, x[0]), scale(e2, x[1])), h = cross(r, add(v, d)); return [(rpOf(d) - e.rp) / e.rp, dot(unit(h), w)]; };
          let x = [dot(dv, bh), 0];
          for (let it = 0; it < 12; it++) {
            const f = F(x);
            if (Math.abs(f[0]) < 1e-6 && Math.abs(f[1]) < 1e-7) break;
            const hs = 1e-6, a = F([x[0] + hs, x[1]]), c = F([x[0], x[1] + hs]);
            const J = [[(a[0] - f[0]) / hs, (c[0] - f[0]) / hs], [(a[1] - f[1]) / hs, (c[1] - f[1]) / hs]], D = J[0][0] * J[1][1] - J[0][1] * J[1][0];
            if (!(Math.abs(D) > 0)) break;
            x = [x[0] - (J[1][1] * f[0] - J[0][1] * f[1]) / D, x[1] - (-J[1][0] * f[0] + J[0][0] * f[1]) / D];
          }
          // Taken only if it costs less extra than the plane it fixes would
          // cost at the departure (about the circular speed times the angle
          // off): Newton can land on a far root, the plane the other way up.
          const f = F(x), d = add(scale(bh, x[0]), scale(e2, x[1]));
          const off = Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(unit(cross(r, add(v, dv))), w)))));
          if (Math.abs(f[0]) < 1e-4 && Math.abs(f[1]) < 1e-5 && norm(d) - norm(dv) < Math.sqrt(B.mu / e.rp) * off) dv = d;
        }
        const m = norm(dv);
        if (m > 1e-7) {
          burn(s.t + durOf(m) / 2, dv, m);
          out.log.push(`trim at ${e.body}: ${(m * 1000).toFixed(2)} m/s, periapsis ${rpOf([0, 0, 0]).toFixed(0)} to ${rpOf(dv).toFixed(0)} km${w ? `, the plane ${(Math.asin(Math.max(-1, Math.min(1, dot(unit(cross(r, v)), w)))) * 180 / Math.PI).toFixed(2)} to ${(Math.asin(Math.max(-1, Math.min(1, dot(unit(cross(r, add(v, dv))), w)))) * 180 / Math.PI).toFixed(2)} deg off the way out` : ''}`);
        }
        const tp = s.t + timeToPeriapsis(r, add(v, dv), B.mu);
        peri.set(e.body, tp);
        if (pass === 0) flyTo(s.t + 0.5 * (tp - s.t));
      }
      continue;
    }
    if (e.kind === 'rendezvous') {
      const { v } = rel(e.body, s.t);
      burn(s.t + durOf(norm(v)) / 2, scale(v, -1), norm(v));
      out.log.push(`rendezvous with ${e.body}: ${(norm(v) * 1000).toFixed(0)} m/s`);
    }
  }
  if (!out.impact && !out.gaveUp) flyTo(Math.max(s.t, tEnd - DAY + 3600, ...watches.map((w) => w.t1)));
  // missKm: for a flyby or capture, the closest approach less the planned
  // periapsis; home to a central body, the distance from the aimed point.
  out.arrivals = watches.map((w) => ({ waypoint: w.waypoint, body: w.body, closest: w.best, plannedRp: w.plannedRp, missKm: w.pointMiss ?? Math.abs(w.best - w.plannedRp), at: w.at, central: w.central, landed: out.landings.some((l) => l.waypoint === w.waypoint) }));
  return out;
}
