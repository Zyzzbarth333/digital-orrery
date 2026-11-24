// @ts-check
// packages/physics/src/journeyFlight.js
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
//     capture   from periapsis, a burn steered in two halves into a circular
//               orbit (landing.js planCapture), then a Hohmann transfer on
//               its mean radius to the planned one (a rendezvous, for a
//               small body: the kernel has no gravity of its own for it)
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
import { turnAngle, rotate, moonExcess, asymptoteVelocities, hohmannCircular } from './transfers.js';
import { propagate, lambert } from './orbital.js';
import { solarSystemBodies, KERNEL_BODIES } from './bodies.js';
import { MAJOR_MOONS_OF } from './moons.js';
import { accelHeliocentric } from './nbody.js';
import { makeEnvironment } from './environment.js';
import { parkedAt } from './parkingPlane.js';
import { aimingRadius } from './transfers.js';
import { bodyAxesEqj } from './orientation.js';
import { deorbitDv, designBraking, designTerminal, designAscent, planCapture, DESCENT_PERIAPSIS_KM, TOUCHDOWN_SPEED } from './landing.js';
import { dot, cross, norm, unit } from './vec.js';

/** @import { V3, Vec } from './vec.js' */
/** @import { Burn, CraftEnv, BodySet } from './kernelHost.js' */
/** @typedef {ReturnType<typeof import('./journey.js').solveJourney>} Solution */
/** @typedef {{ r: number[], v: number[], t: number }} FlightState  the craft's state at kernel time t (s) */
/** @typedef {{ mass: number, area: number, cr: number, cd: number, earth?: { degree?: number }, moon?: { degree?: number } }} Env */
/** @typedef {{ body: string, offsetEqj: number[], arrive: number, without: string | null, central?: string }} AimTarget */
/** @typedef {{ central: string, from: string, to?: string, toEqj?: number[], arrMs: number }} Reaim */
/** @typedef {{ n0: number[], pole: number[], f1: number[], f2: number[], rate: number, stayS: number }} PlaneTurn */
/** @typedef {{ wayOut?: number[], untilMs?: number, planeHold?: number[], planeTurn?: PlaneTurn }} OffsetInfo */
/** @typedef {{ kind: 'depart', ms: number, body: string, vinfEqj: number[], rp: number, via: string | null, waitDays?: number, reaim: Reaim | null, aimPlanet?: number, aimAt?: AimTarget }} DepartEvent */
/** @typedef {{ kind: 'depart-ring', ms: number, body: string, dv: number, dirEqj: number[], to?: string, arrMs?: number }} DepartRingEvent */
/** @typedef {{ body: string, offsetEqj: number[], vinEqj: number[], rp: number, mu: number, periMs: number }} PlanetB  a planet's B-plane point for a moon's way in (planetBPlane) */
/** @typedef {{ kind: 'aim', ms: number, body: string, offsetEqj: number[], arrive: number, without: string | null, central: string, farTo?: { ms: number, offsetEqj: number[] }, planetB?: PlanetB, last?: boolean, replane?: { rp: number, wayOutEqj: number[], untilMs?: number } }} AimEvent */
/** @typedef {{ kind: 'arrive', ms: number, body: string, waypoint: number, plannedRp: number, central: boolean, windowMs: number, onToMs?: number }} ArriveEvent */
/**
 * The kernel's schedule, one kind of event each (the flight reads its kind).
 * @typedef {{ kind: 'impulse', ms: number, dvEqj: number[], node?: boolean, body?: undefined }
 *   | { kind: 'liftoff', ms: number, body: string, rOrbit: number, waypoint: number }
 *   | { kind: 'tangent', ms: number, body: string, dv: number, waypoint?: number }
 *   | { kind: 'land', ms: number, body: string, waypoint: number, mode: string }
 *   | DepartEvent
 *   | DepartRingEvent
 *   | { kind: 'impulse-rel', ms: number, body: string, vinfEqj: number[] }
 *   | { kind: 'phase', ms: number, body: string, parked: { t0: number, rc: number, orbit: any }, untilMs: number }
 *   | AimEvent
 *   | { kind: 'approach', ms: number, body: string, rp: number, wayOutEqj?: number[], untilMs?: number, planeTurn?: PlaneTurn, planeHold?: number[] }
 *   | ArriveEvent
 *   | { kind: 'point', ms: number, waypoint: number, offsetEqj: number[], body: string }
 *   | { kind: 'capture' | 'rendezvous', ms: number, body: string, rp: number }} PlanEvent
 */
/** @typedef {{ start: { r: number[], v: number[], ms: number } | null, events: PlanEvent[], unsupported: string[] }} Plan */
/** @typedef {{ dt: number, d: number[], m: number, T: number, rb: number, vb: number, aimedKm?: number, offMs?: number }} DepartBurn */
/** @typedef {{ body: string, t: number, speed?: number }} Impact */
/** @typedef {{ type: string, body: string, t: number }} KernelEvent  (an event the kernel stops a step on) */
/** @typedef {{ r: number[], v: number[] }} State */
/** @typedef {{ key: string, local: number[] }} Site */
/** @typedef {{ body: string, waypoint: number, t: number, local: number[], how: string, speed: number, lat: number, lon: number, until: number | null, entryKm?: number, dv?: number, ascentDv?: number }} Landing */
/** @typedef {{ body: string, dv: number, impulsive: number, steered: boolean, pitchDeg: number[] | null, hohmann: { from: number, dv: number } | null, rc: number, a?: number, e?: number }} Capture */
/** @typedef {{ waypoint: number, body: string, closest: number, plannedRp: number, missKm: number, at: number, central: boolean, landed: boolean }} Arrival */
/** @typedef {ArriveEvent & { t0: number, t1: number, step: number, best: number, at: number, pointMiss?: number }} Watch */
/** @typedef {{ burns: Burn[], path: { t: number, r: number[] }[], arrivals: Arrival[], log: string[], impact: Impact | null, correctionsDv: number, landings: Landing[], captures: Capture[], model: 'full' | 'bare', trouble: string[], gaveUp?: boolean }} Flight */

const DAY = 86400;
/** @param {Vec} a @param {Vec} b */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {Vec} a @param {Vec} b */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @param {Vec} a @param {number} k */
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const Z = [0, 0, 1];
// The bodies the kernel pulls with: the planets, the Moon and the planets'
// major moons (bodies.js splits a planet's system near it), so each of
// these is reached by aims without its pull, approach trims and a capture,
// and left by a burn onto its own excess velocity.
const PLANET_MOONS = ['mars', 'jupiter', 'saturn', 'uranus', 'neptune'].flatMap((p) => /** @type {Record<string, string[]>} */ (MAJOR_MOONS_OF)[p] ?? []);
// A craft the air brings down before its entry perigee, falling slower
// than this (km/s), came down by entry, not by a crash: its speed was the
// drag's doing, and the plan's parachutes take it from there.
const ENTRY_FALL_MAX = 0.3;
const KERNEL = new Set(['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', ...PLANET_MOONS]);
const MOON_IN_KERNEL = new Set(PLANET_MOONS);
// The thrust of a planned burn (m/s^2): short enough to be near impulsive
// (3 km/s in 2.5 minutes), long enough for the kernel to step through.
export const PLAN_ACCEL = 20;
// The craft a journey is flown as, in the full model: the app's Craft
// defaults (craft.js), which mission.ts gives a journey's craft, so the
// environment sees the same craft headless and live. Its scripted burns
// draw nothing from its tank, so its mass stays dryMass + fuel.
export const JOURNEY_CRAFT = { dryMass: 1000, fuel: 500, area: 5, cr: 1.3, cd: 2.2 };
const TRIAL_MOON_DEGREE = 10;
// The most of its orbit a capture or departure burn sweeps (rad): 10
// degrees, so it is near impulsive, as the plan prices it.
const BURN_ARC = 10 * Math.PI / 180;
// The aims on the way down a planet's well to its moon, at these multiples
// of the planet's sphere-crossing time before the arrival.
const VIA_PLANET_AIMS = [3, 0.5, 0.1, 0.02];
/** @type {Env} */
export const JOURNEY_ENV = { mass: JOURNEY_CRAFT.dryMass + JOURNEY_CRAFT.fuel, area: JOURNEY_CRAFT.area, cr: JOURNEY_CRAFT.cr, cd: JOURNEY_CRAFT.cd };

/** @param {Vec} v */
const ecl = (v) => eclToEqj(v);
// A body's position at kernel time t: the kernel's own (a planet's moon
// wherever its system is split or folded), or for a body the kernel lacks
// (a small body) from its elements.
/** @param {BodySet} sys @param {string} key @param {number} t */
const posAt = (sys, key, t) => (sys.bodiesAt(t).find((/** @type {{ key: string }} */ b) => b.key === key) ?? (MOON_IN_KERNEL.has(key) ? sys.bodyAt?.(key, t) : null))?.r.slice() ?? eclToEqj(stateOf(key, kernelMs(t)).r);
/** @param {string} key @param {number} ms */
const state = (key, ms) => helioStateEqj(key, new Date(ms));
/** @param {Vec} u @returns {V3} */
const perpEcliptic = (u) => { const n = sub(Z, scale(u, dot(Z, u))); return norm(n) > 1e-9 ? unit(n) : [1, 0, 0]; };

// The planned periapsis at a waypoint, relative to its body (ecliptic km):
// for a flyby, along u_in - u_out (the hyperbola from the inbound to the
// outbound excess velocity); for a capture, the hyperbola whose plane holds
// the next departure's excess velocity too, so the parking orbit it leaves
// from already contains it.
/** @param {Solution} sol @param {number} k @param {OffsetInfo} [info] @returns {number[]} */
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
  // A stay the plan prices the plane over (journey.js planeAt: more than
  // 30 days at a planet): the plane it prices from, the pole and the node's
  // rate, for which the trims aim the node on the planned day.
  const pl = outLeg?.plane;
  // At the Moon the plan flies the plane through the stay (lunarPlane.js)
  // from its capture's plane, so the trims put the capture in that plane.
  if (info.wayOut && pl?.priced && !pl.aimed && pl.normal && pl.model === 'moon') info.planeHold = unit(ecl(pl.normal));
  else if (info.wayOut && pl?.priced && !pl.aimed && pl.normal && Math.abs(dot(unit(pl.normal), unit(pl.pole))) < 0.98) {
    const pole = unit(ecl(pl.pole)), f1 = unit(cross(pole, Math.abs(pole[2]) < 0.9 ? Z : [1, 0, 0]));
    info.planeTurn = { n0: unit(ecl(pl.normal)), pole, f1, f2: cross(pole, f1), rate: pl.rate, stayS: (outLeg.depMs - pl.arrMs) / 1000 };
  }
  if (fb && wayOut) uout = unit(wayOut);
  else {
    let n = wayOut ? cross(vin, wayOut) : null;
    n = n && norm(n) > 1e-9 * norm(vin) * norm(wayOut) ? unit(n) : perpEcliptic(uin);
    uout = rotate(uin, n, turnAngle(rp, norm(vin), B.mu));
  }
  const d = sub(uin, uout);
  return scale(norm(d) > 1e-9 ? unit(d) : unit(cross(uin, Z)), rp);
}

// A planet's aim point for an aim flown at time ms without the planet's
// gravity (relative to the planet at the arrival, ecliptic km): where the
// planned hyperbola's state at ms would go by the arrival in a straight
// line, the planet's pull switched off. Far out it is the B-plane point
// (aimOff, across the asymptote at the aiming radius), but the craft is on
// the hyperbola long before its sphere: bent a little, and faster than the
// excess speed by about mu / (r v_inf) at r, so its straight line runs
// ahead of the asymptote's by about (mu / v_inf^2) ln(r1 / r2) between
// distances r1 and r2. Aimed at the B-plane point, an aim cancels the speed
// the planet gave the craft since the last, the next aim gives it back,
// and the craft reaches the periapsis early (an hour at Venus). The
// hyperbola is the incoming one through the B-plane point with the planned
// periapsis radius, at its periapsis at arrMs (Curtis eqs. (8.71), (8.75)).
/** @param {number[]} aimOff @param {number[]} vin @param {number} rp @param {number} mu @param {number} arrMs @returns {(ms: number) => number[]} */
function bentAim(aimOff, vin, rp, mu, arrMs) {
  const u = unit(vin), b = unit(aimOff), vinf = norm(vin);
  const half = turnAngle(rp, vinf, mu) / 2, c = Math.cos(half), s = Math.sin(half);
  const r0 = scale(add(scale(b, c), scale(u, s)), rp);
  const v0 = scale(sub(scale(u, c), scale(b, s)), Math.sqrt(vinf * vinf + 2 * mu / rp));
  return (ms) => {
    const dt = (arrMs - ms) / 1000;
    if (!(dt > 0)) return aimOff;
    const h = propagate(r0, v0, -dt, mu);
    if (!h) return aimOff;   // the solve failed: aim as for no bend
    return add(h.r, scale(h.v, dt));
  };
}

// Reaching a moon via its planet, the planet's B-plane point for the
// planned way in: the hyperbola about the planet that comes in along the
// leg's excess velocity v and passes the moon's place rm at vAbout
// (journey.js moonArr). Its angular momentum is h = rm x vAbout = B x v,
// with B perpendicular to v, so B = (v x h) / v^2. With it the hyperbola's
// periapsis rp and when the craft is there (periMs), for bentAim. EQJ.
// The fallback aim when an aim at the moon finds no burn.
/** @param {{ arrMs: number, vinfArr: number[], moonArr: { rm: number[], vAbout: number[], rp: number } }} leg @param {string} planet @returns {PlanetB} */
function planetBPlane(leg, planet) {
  const v = leg.vinfArr, M = leg.moonArr, h = cross(M.rm, M.vAbout), mu = bodyInfo(planet).mu;
  return { body: planet, offsetEqj: ecl(scale(cross(v, h), 1 / dot(v, v))), vinEqj: ecl(v), rp: M.rp, mu, periMs: leg.arrMs + 1000 * timeToPeriapsis(M.rm, M.vAbout, mu) };
}

// The kernel's schedule for a solved journey. Returns { start: { r, v, ms },
// events: [...] sorted by time, unsupported: [reasons] }.
/** @param {Solution} sol @returns {Plan} */
export function planFlight(sol) {
  const events = /** @type {PlanEvent[]} */ ([]), unsupported = /** @type {string[]} */ ([]);
  const S = sol.stops, L0 = sol.legs[0];
  if (!sol.ok) return { start: null, events, unsupported: ['the journey has a leg with no solution'] };
  // Where the craft starts.
  /** @type {{ r: number[], v: number[], ms: number }} */
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
      // Up from the ground first (journey.js solveLocal prices the ascent
      // into the leg's first burn, and the descent into its last: the
      // tangent burns are the orbit change's alone).
      if (P.kind === 'land' && k > 0) events.push({ kind: 'liftoff', ms: Math.max(P.arrMs, leg.depMs - 3 * 3600e3), body: P.body, rOrbit: r1, waypoint: k - 1 });
      const dep = leg.depDv - (leg.ascentDv ?? 0), arr = leg.arrDv - (leg.descentDv ?? 0);
      if (dep) events.push({ kind: 'tangent', ms: leg.depMs, body: P.body, dv: up * dep });
      if (leg.midDv) events.push({ kind: 'tangent', ms: leg.arcs[1]?.t1 ?? leg.depMs, body: P.body, dv: up * leg.midDv });
      if (arr || Q.kind !== 'land') events.push({ kind: 'tangent', ms: leg.arrMs, body: P.body, dv: up * arr, waypoint: k });
      // Down from the orbit before: powered on an airless body, at the end
      // of the orbit change; through the air, the first burn's path flown
      // to its periapsis.
      if (Q.kind === 'land') {
        const mode = !KERNEL.has(Q.body) ? 'setdown' : B.atmosphere ? 'entry' : 'descent';
        events.push({ kind: 'land', ms: mode === 'entry' ? (leg.depMs + leg.arrMs) / 2 : leg.arrMs + 1, body: Q.body, waypoint: k, mode });
      }
      continue;
    }
    // Leaving a stop where the craft was in orbit.
    /** @type {DepartEvent | null} */
    let departEv = null;
    if (k > 0 && P.kind !== 'flyby') {
      // Off the ground first, into the low orbit, three hours before the
      // departure (an ascent and its coast take about one).
      if (P.kind === 'land') events.push({ kind: 'liftoff', ms: Math.max(P.arrMs, leg.depMs - 3 * 3600e3), body: P.body, rOrbit: bodyInfo(P.body).radius + P.altKm, waypoint: k - 1 });
      // The way out is re-solved if the departure waits: Lambert about the
      // leg's central body to where the target is at the arrival (on a leg
      // of two arcs, to its break point when it reaches it). Leaving
      // a moon for another planet (via its planet), the excess velocity is
      // the planet's, and the moon's own is worked out from it.
      const via = leg.geometry === 'between' && leg.endA && leg.endA !== P.body ? leg.endA : null;
      // (Leaving a moon via its planet, the departure does not wait for the
      // plane: the moon's phase prices every day differently, and the plan
      // has chosen the day.)
      if (leg.vinfDep && KERNEL.has(P.body)) events.push(departEv = { kind: 'depart', ms: leg.depMs, body: P.body, vinfEqj: ecl(leg.vinfDep), rp: bodyInfo(P.body).radius + P.altKm, via, ...(via ? { waitDays: 0 } : {}),
        reaim: leg.geometry === 'between' && !leg.resonance ? (leg.mid ? { central: leg.central, from: leg.endA ?? P.body, toEqj: ecl(leg.mid.r), arrMs: leg.mid.ms } : { central: leg.central, from: leg.endA ?? P.body, to: leg.endB ?? Q.body, arrMs: leg.arrMs }) : null });
      else if (leg.ringDep) {
        events.push({ kind: 'depart-ring', ms: leg.depMs, body: P.body, dv: leg.depDv, dirEqj: ecl(unit(leg.ringDep)), ...(leg.parkedDep ? { to: Q.body, arrMs: leg.arrMs } : {}) });
        // From a parking orbit the plan captured into: the craft phased on
        // it, after the capture has settled (a turn and a half), to where
        // the plan has it at the departure (journey.js parkedAt).
        const parked = /** @type {{ t0: number, rc: number, orbit: any } | undefined} */ (/** @type {any} */ (P).parked);
        const T = 2 * Math.PI * Math.sqrt((parked?.rc ?? 0) ** 3 / bodyInfo(P.body).mu);
        // Twice: what the first leaves (the phasing orbit's own zonal
        // motion, two-body timing), the second takes out.
        if (leg.parkedDep && parked) {
          const t1 = P.arrMs + 1.5 * T * 1000, mid = (t1 + leg.depMs) / 2;
          events.push({ kind: 'phase', ms: t1, body: P.body, parked, untilMs: mid }, { kind: 'phase', ms: mid + 0.5 * T * 1000, body: P.body, parked, untilMs: leg.depMs });
        }
      }
      else if (leg.vinfDep) events.push({ kind: 'impulse-rel', ms: leg.depMs, body: P.body, vinfEqj: ecl(leg.vinfDep) });
    }
    // Aimed corrections to the planned periapsis (the bi-elliptic leg's
    // apoapsis burn is the first, aimed from the craft there).
    // Far out, the aim is at the B-plane: where the incoming asymptote
    // should pass the target at the arrival time, flown without the
    // target's own gravity (its pull is the hyperbola's, not an error to
    // cancel), less the bending the target has given the craft by then. At
    // a central body (the Moon home to Earth) it is the planned point
    // itself, with everything.
    const offInfo = /** @type {OffsetInfo} */ ({}), off = periapsisOffset(sol, k, offInfo);
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
      const short = propagate(arc.r1, arc.v1, (arriveMs - arc.t1) / 1000, arc.mu);
      if (short) aimOff = short.r;   // else (the solve failed) the arc's end as it was
    }
    /** @param {string} key @param {Vec | null | undefined} vinf */
    const crossing = (key, vinf) => (KERNEL.has(key) && vinf ? sphereOfInfluence(key) / norm(vinf) : 0) * 1000;
    const target = { body: leg.ringArr ? leg.central : viaMoon ? Q.body : (leg.endB ?? Q.body), offsetEqj: ecl(aimOff), arrive: arriveMs, without, central: leg.central, ...(viaMoon && leg.endB && KERNEL.has(leg.endB) ? { planetB: planetBPlane(leg, leg.endB) } : {}) };
    // At a planet, the B-plane point less the bending the planet has
    // already given the craft by the aim's time (bentAim). (Not about the
    // Earth, at the Moon: there the Earth's pull is most of the bending, and
    // a hyperbola about the Moon from a day out is no guide to it.)
    const bent = without && !viaMoon && target.body === Q.body && leg.central === 'sun' ? bentAim(aimOff, vinQ, norm(off), bodyInfo(Q.body).mu, arriveMs) : null;
    /** @param {number} ms */
    const targetAt = (ms) => (bent ? { ...target, offsetEqj: ecl(bent(ms)) } : target);
    // Leaving a planet's moon via the planet, the burn is set by side runs
    // to the excess about the planet: three-level patched conics are rough
    // at a moon so deep in its planet's well (Europa's sphere is 1.4 % of
    // its distance from Jupiter, and Europa's velocity turns 1.6 degrees
    // while the craft crosses it), 0.8 km/s off in the excess about Jupiter.
    // (On a leg of two arcs, a broken plane or a bi-elliptic leg, aimed at
    // its break point, as the way out is re-solved.)
    if (departEv?.via && MOON_IN_KERNEL.has(P.body)) Object.assign(departEv, { aimPlanet: 3 * DAY, aimAt: leg.mid ? { body: leg.central, offsetEqj: ecl(leg.mid.r), arrive: leg.mid.ms, without: null } : targetAt(leg.depMs) });
    const dur = leg.arrMs - leg.depMs;
    // When: the first once the craft is clear of the body it left (half
    // again its sphere of influence at the leg's excess speed; a flyby's
    // powered burn is flown here, outside, so without its Oberth gain), the
    // second a few sphere-crossing times out from the target. (Not inside
    // it: there the craft reaches periapsis early, pulled in, and a point
    // aimed for at the planned time is the wrong hyperbola.)
    // (Leaving a moon for another planet: clear of the planet.)
    const clearP = leg.central === P.body ? Math.min(0.1 * dur, 2 * 3600e3) : Math.max(Math.min(0.1 * dur, 2 * 3600e3), 1.5 * crossing(leg.endA ?? P.body, leg.vinfDep));
    const tIn = without ? crossing(Q.body, vinQ) : 0;
    // Burn nodes dragged onto the leg are flown as planned (their burns as
    // planned vectors); the aims come after the last of them, so the flight
    // keeps the shape given and corrects only what is left.
    const nodes = /** @type {{ ms: number, dv: number, dvVec: number[] }[]} */ ((leg.nodes ?? []).filter((/** @type {{ dv: number }} */ n) => n.dv > 0));
    for (const n of nodes) events.push({ kind: 'impulse', ms: n.ms, dvEqj: ecl(n.dvVec), node: true });
    const afterNodes = nodes.length ? nodes[nodes.length - 1].ms + 0.02 * dur : -Infinity;
    // A return to the body just left (a resonant orbit): the aims fly
    // without the target's gravity, which is also the body the craft is
    // still climbing away from, so the first waits until it is well clear,
    // a quarter of the way round.
    const back = (leg.endB ?? Q.body) === (leg.endA ?? P.body);
    const first = Math.max(afterNodes, leg.mid ? leg.mid.ms : leg.depMs + (back ? 0.25 * dur : Math.min(clearP, 0.3 * dur)));
    // A broken plane or a deep-space burn: aimed at its point B first, while the craft is
    // near the departure (from there the target is near 180 degrees away),
    // unless nodes before the break shape the way there.
    if ((leg.brokenPlane || leg.deepSpace) && !nodes.some((n) => n.ms < leg.mid.ms)) events.push({ kind: 'aim', ms: leg.depMs + Math.min(clearP, 0.3 * (leg.mid.ms - leg.depMs)), body: leg.central, offsetEqj: ecl(leg.mid.r), arrive: leg.mid.ms, without: null, central: leg.central });
    // Leaving a moon on a swing-by of its planet (journey.js moonDep: the
    // way out falls in past the planet first), a first aim once clear of
    // the moon (half again its sphere crossing at the excess speed about
    // it), and before half the fall to the periapsis: the pass turns the way
    // out, and the error the moon's pull leaves on the way out (patched
    // conics take the moon as a point) grows with it, to millions of
    // kilometres at the target. Aimed where the next aim is: the break
    // point on a broken plane. (Not when burn nodes shape the way, nor from
    // a moon in the kernel, whose departure burn is itself aimed.)
    const sw = leg.moonDep?.swingby && leg.endA && leg.endA !== P.body && !nodes.length && !MOON_IN_KERNEL.has(P.body) ? leg.moonDep : null;
    if (sw) {
      const tp = timeToPeriapsis(sw.rm, sw.vAbout, bodyInfo(leg.endA).mu) * 1000;
      const early = leg.depMs + Math.min(1.5 * crossing(P.body, sw.vinf), 0.5 * tp);
      const toBreak = leg.mid ? { body: leg.central, offsetEqj: ecl(leg.mid.r), arrive: leg.mid.ms, without: null, central: leg.central } : targetAt(early);
      if (early < first - 3600e3) events.push({ kind: 'aim', ms: early, ...toBreak });
    }
    /** @type {AimEvent[]} */
    const aims = [{ kind: 'aim', ms: first, ...targetAt(first) }];
    // Reaching a moon via its planet, the way in falls through the planet's
    // well, where a miss grows fast: more aims on the way down, at a few
    // and at fractions of the planet's sphere-crossing time out (none
    // within three of the moon's). The last, two days out at Jupiter, is at
    // the planned periapsis point itself, with the moon's pull: a small
    // moon bends the way in for days before its sphere (Europa's, 10,000
    // km, is 25 minutes out), and the planet's tide moves the periapsis an
    // aim without the moon puts there. The approach trims do the rest.
    // (Not the Moon: its sphere is a sixth of its distance from the Earth,
    // against Europa's 1.4 % of its distance from Jupiter, and a point aim
    // with its pull from a day and a half out does not converge.)
    if (viaMoon && MOON_IN_KERNEL.has(Q.body)) {
      const tP = crossing(leg.endB, leg.vinfArr);
      const at = VIA_PLANET_AIMS.map((f) => leg.arrMs - f * tP).filter((ms) => ms > first + 0.02 * dur && ms < leg.arrMs - 3 * tIn);
      at.forEach((ms, i) => aims.push({ kind: 'aim', ms, ...target, ...(i === at.length - 1 ? { offsetEqj: ecl(off), without: null, ...(offInfo.wayOut ? { replane: { rp: norm(off), wayOutEqj: ecl(offInfo.wayOut), untilMs: offInfo.untilMs } } : {}) } : {}) }));
    } else {
      const second = Math.max(first + 0.25 * (leg.arrMs - first), leg.arrMs - 3 * tIn);
      if (second < leg.arrMs - 0.6 * tIn && leg.arrMs - first > 2 * DAY * 1000) {
        // Months out, the two-body hyperbola is a rough guide to the
        // planet's pull (the craft and the planet go round the Sun on
        // different orbits): the first aim takes the pull up to the second
        // from side runs instead, and aims at the second's point from there.
        if (bent) aims[0].farTo = { ms: second, offsetEqj: ecl(bent(second)) };
        aims.push({ kind: 'aim', ms: second, ...targetAt(second) });
      }
    }
    // (An aim that does not converge is trouble only if it is the leg's
    // last: the next corrects what it leaves.)
    aims[aims.length - 1].last = true;
    events.push(...aims);
    // Inside the target's sphere: trim the periapsis radius alone (two-body
    // about the target, where its pull is most of the force).
    if (without) events.push({ kind: 'approach', ms: leg.arrMs - 0.6 * tIn, body: Q.body, rp: norm(off), ...(offInfo.wayOut ? { wayOutEqj: ecl(offInfo.wayOut), untilMs: offInfo.untilMs } : {}), ...(offInfo.planeTurn ? { planeTurn: offInfo.planeTurn } : {}), ...(offInfo.planeHold ? { planeHold: offInfo.planeHold } : {}) });
    const wMs = leg.ringArr ? 0.25 * DAY * 1000 : Math.min(3 * DAY * 1000, Math.max(2 * 3600e3, 0.5 * (crossing(Q.body, vinQ) || DAY * 1000)));
    // A last stop that is a flyby of a moon whose way on falls below its
    // planet's cloud tops (the approach's periapsis about the planet comes
    // after the moon, under its radius): flown on to that periapsis, so the
    // flight meets the planet where the plan does, not an hour past the moon.
    const pB = target.planetB, fallsOn = pB && Q.kind === 'flyby' && k === sol.legs.length - 1 && !leg.moonArr.ahead && leg.moonArr.rp < bodyInfo(pB.body).radius;
    events.push({ kind: 'arrive', ms: leg.arrMs, body: Q.body, waypoint: k, plannedRp: norm(off), central: !!leg.ringArr, windowMs: wMs, ...(pB && fallsOn ? { onToMs: pB.periMs + 3600e3 } : {}) });
    // Home to the central body: how far the craft is from the aimed point.
    if (leg.ringArr) events.push({ kind: 'point', ms: arriveMs, waypoint: k, offsetEqj: ecl(aimOff), body: leg.central });
    const QB = bodyInfo(Q.body);
    if (Q.kind === 'orbit' || (Q.kind === 'land' && (!QB.atmosphere || !KERNEL.has(Q.body)))) events.push({ kind: KERNEL.has(Q.body) ? 'capture' : 'rendezvous', ms: leg.arrMs, body: Q.body, rp: norm(off) });
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
/** @param {Vec} r @param {Vec} v @param {number} mu */
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

// The excess velocity of the two-body hyperbola through r, v about mu
// (along its outgoing asymptote), or null on an ellipse.
/** @param {Vec} r @param {Vec} v @param {number} mu */
function asymptote(r, v, mu) {
  const en = dot(v, v) / 2 - mu / norm(r);
  if (!(en > 0)) return null;
  const h = cross(r, v), ev = sub(scale(cross(v, h), 1 / mu), unit(r)), ec = norm(ev), th = Math.acos(Math.max(-1, Math.min(1, -1 / ec)));   // clamped: near a parabola, rounding puts -1/ec just past 1
  const p = unit(ev), q = unit(cross(h, p));
  return scale(add(scale(p, Math.cos(th)), scale(q, Math.sin(th))), Math.sqrt(2 * en));
}
// x with A x = b (3 by 3, Cramer), or null if A is singular.
/** @param {number[][]} A @param {number[]} b */
function solve3(A, b) {
  /** @param {number[][]} m */
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (!(Math.abs(D) > 0)) return null;
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((x, c) => (c === k ? b[i] : x)))) / D);
}

// Seconds to the apoapsis of the ellipse through r, v (half a period from
// the periapsis).
/** @param {Vec} r @param {Vec} v @param {number} mu */
function timeToApoapsis(r, v, mu) {
  const a = 1 / (2 / norm(r) - dot(v, v) / mu);
  if (!(a > 0)) return NaN;
  const T = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  let dt = timeToPeriapsis(r, v, mu) - T / 2;
  while (dt < 0) dt += T;
  return dt % T;
}

// The kernel's bodies without one: a planet or the Moon left out of the
// list, a planet's major moon left out of its split system (bodies.js omit).
/** @type {Map<string, BodySet>} */
const WITHOUT = new Map();
/** @param {BodySet} sys @param {string} key */
function withoutBody(sys, key) {
  const id = `${sys.epochMs}:${key}`;
  if (!WITHOUT.has(id)) WITHOUT.set(id, MOON_IN_KERNEL.has(key)
    ? solarSystemBodies({ epochMs: sys.epochMs, omit: /** @type {never[]} */ ([key]) })
    : solarSystemBodies({ epochMs: sys.epochMs, keys: KERNEL_BODIES.filter((b) => b !== key) }));
  return /** @type {BodySet} */ (WITHOUT.get(id));
}

// An aim that ends further than this from its point has not converged.
const AIM_CONVERGED_KM = 50;

// What went wrong in a flight, as reasons for the craft's Model row: the
// troubles it logged (an aim, a departure, a descent or an ascent it could
// not work out), a crash, a landing it planned and did not make, or a
// waypoint missed by more than 50 km or 2 % of the planned periapsis.
/** @param {Plan} plan @param {Flight} f */
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
/** @param {BodySet} sys @param {Plan} plan @param {{ samples?: number, env?: Env | null, deadlineMs?: number }} [options] */
export function flyPlanned(sys, plan, { deadlineMs = 60e3, ...opts } = {}) {
  const full = flyJourney(sys, plan, { ...opts, model: 'full', deadlineMs }), why = flightTrouble(plan, full);
  if (!why.length) return { ...full, bareWhy: null };
  const bare = flyJourney(sys, plan, { ...opts, model: 'bare' });
  if (flightTrouble(plan, bare).length) return { ...full, bareWhy: null, fullTrouble: why };
  return { ...bare, bareWhy: why.join('; ') };
}

/** @param {BodySet} sys @param {Plan} plan @param {{ samples?: number, model?: 'full' | 'bare', env?: Env | null, deadlineMs?: number }} [options] @returns {Flight} */
export function flyJourney(sys, plan, { samples = 400, model = 'full', env: envIn = null, deadlineMs = Infinity } = {}) {
  const wallEnd = Date.now() + deadlineMs;
  /** @param {string} key */
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
  /** @type {Flight} */
  const out = { burns: [], path: [], arrivals: [], log: [], impact: null, correctionsDv: 0, landings: [], captures: [], model: env ? 'full' : 'bare', trouble: [] };
  if (!plan.start) return out;
  // A body in the kernel's list now, or a planet's moon while its system is
  // folded (bodies.js bodyAt: the moon at its place with its own GM).
  /** @param {string} key @param {number} t */
  const body = (key, t) => sys.bodiesAt(t).find((/** @type {{ key: string }} */ b) => b.key === key) ?? (MOON_IN_KERNEL.has(key) ? sys.bodyAt?.(key, t) : undefined);
  let s = { r: [...plan.start.r], v: [...plan.start.v], t: kernelSeconds(new Date(plan.start.ms)) };
  const t0 = s.t, tEnd = kernelSeconds(new Date(plan.events.length ? plan.events[plan.events.length - 1].ms : plan.start.ms)) + DAY;
  const every = (tEnd - t0) / samples;
  out.path.push({ t: s.t, r: [...s.r] });
  // Closest approaches: each waypoint watched over a window about its
  // planned time, in fine steps, while the craft flies through it.
  /** @type {Watch[]} */
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
  let held = /** @type {Site | null} */ (null), landingOn = /** @type {string | null} */ (null), touch = /** @type {FlightState | null} */ (null);
  // Fly to time t, recording the path; stops at an impact. chunk: the
  // longest stretch handed to the kernel at once.
  /** @param {number} t @param {number} [chunk] */
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
      const hit = res.events.find((/** @type {KernelEvent} */ e) => e.type === 'impact');
      s = { r: res.r, v: res.v, t: res.t };
      if (chunk >= every || s.t - out.path[out.path.length - 1].t >= every || s.t >= t - 1e-6) out.path.push({ t: s.t, r: [...s.r] });
      look();
      // The kernel's impact is where its step crossed the surface (impact.js).
      if (hit && hit.body === landingOn) { touch = s; if (out.path[out.path.length - 1].t !== s.t) out.path.push({ t: s.t, r: [...s.r] }); break; }
      if (hit) { out.impact = { body: hit.body, t: hit.t }; break; }
      if (!res.complete) { out.log.push(`kernel stopped short at ${s.t}`); out.trouble.push('the kernel stopped short'); break; }
    }
  };
  /** @param {number} t @param {number[]} dir @param {number} dvKmS @param {string | null} [frame] @param {string | null} [about] @param {number} [accel] @returns {Burn | undefined} */
  const burn = (t, dir, dvKmS, frame = null, about = null, accel = PLAN_ACCEL) => {
    const dur = (dvKmS * 1000) / accel;
    if (!(dur > 0)) return;
    // Centred on t: a finite burn loses least about its aim point.
    const b = { t0: t - dur / 2, t1: t + dur / 2, dir: frame ? dir : unit(dir), F: accel, m0: 1, mdot: 0, scripted: true, ...(frame ? { frame, about: /** @type {string} */ (about) } : {}) };
    out.burns.push(b);
    return b;
  };
  /** @param {string} key @param {number} t */
  const bodyState = (key, t) => {
    const B = body(key, t);
    if (B) { const v = [0, 0, 0]; B.eph.velocity(t, v); return { r: B.r.slice(), v, mu: B.mu }; }
    const x = stateOf(key, kernelMs(t));
    return { r: eclToEqj(x.r), v: eclToEqj(x.v), mu: 0 };
  };
  /** @param {string} key @param {number} t */
  const rel = (key, t) => { const B = bodyState(key, t); return { r: sub(s.r, B.r), v: sub(s.v, B.v), B }; };
  /** @param {number} dv */
  const durOf = (dv) => (dv * 1000) / PLAN_ACCEL;
  const peri = new Map();
  // A body's axes at kernel time t (orientation.js); fixed axes for a body
  // with no rotation model (a small body).
  /** @param {string} key @param {number} t */
  const axesOf = (key, t) => { try { return bodyAxesEqj(key, new Date(kernelMs(t))); } catch { return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; } };
  // A site's state at t: its body's, plus the body-fixed point turned
  // into space (and its velocity from the turn over a second).
  /** @param {Site} S @param {number} t */
  function siteAt(S, t) {
    /** @param {number} tt */
    const at = (tt) => { const [X, Y, W] = axesOf(S.key, tt); return [0, 1, 2].map((i) => X[i] * S.local[0] + Y[i] * S.local[1] + W[i] * S.local[2]); };
    const B = bodyState(S.key, t), d0 = at(t), d1 = at(t + 1);
    return { r: add(B.r, d0), v: add(B.v, sub(d1, d0)) };
  }
  // The surface beneath relative position d (km): the mean sphere, or the
  // Earth's ellipsoid about its pole, as the kernel's impacts take them.
  /** @param {string} key @param {number[]} d @param {number} t */
  const surfaceUnder = (key, d, t) => {
    const b = body(key, t), u = unit(d);
    if (b?.surface && b.pole) { const z = dot(u, b.pole); return scale(u, 1 / Math.sqrt((1 - z * z) / b.surface.a ** 2 + z * z / b.surface.c ** 2)); }
    return scale(u, b?.radius ?? bodyInfo(key).radius);
  };
  // Down: the craft held at the point beneath it, the watch on the body
  // ended (it measured the way in), the landing recorded.
  /** @param {string} key @param {number} waypoint @param {string} how @param {{ entryKm?: number, dv?: number }} [extra] */
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
  /** @param {DepartEvent} e @param {number} tt @param {boolean} [planet] */
  const departWant = (e, tt, planet = false) => {
    let want = e.vinfEqj;
    if (e.reaim && Math.abs(tt - kernelSeconds(new Date(e.ms))) >= 3600) {
      const T = kernelSeconds(new Date(e.reaim.arrMs));
      const C = e.reaim.central === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : bodyState(e.reaim.central, tt), CT = e.reaim.central === 'sun' ? [0, 0, 0] : posAt(sys, e.reaim.central, T);
      const P0 = bodyState(e.reaim.from ?? e.body, tt), to = e.reaim.toEqj ?? sub(posAt(sys, /** @type {string} */ (e.reaim.to), T), CT);
      const muC = e.reaim.central === 'sun' ? sys.muSun : bodyInfo(e.reaim.central).mu;
      const arc = lambert(sub(P0.r, C.r), to, T - tt, muC, true);
      if (arc) want = sub(arc.v1, sub(P0.v, C.v));
    }
    if (!e.via || planet) return want;
    // Of the two hyperbolas through the moon's place that leave on that
    // asymptote (transfers.js moonExcess, as the plan prices it), the
    // cheaper, a swing-by near the planet charged its margin.
    const M = bodyState(e.body, tt), Pp = bodyState(e.via, tt);
    const rm = sub(M.r, Pp.r), x = moonExcess({ rm, vm: sub(M.v, Pp.v), vinf: want, mu: Pp.mu, rPlanet: bodyInfo(e.via).radius });
    return x ? x.vinf : want;
  };

  // The pull towards a body's centre on the craft now (km/s^2), in the
  // flight's model: the kernel's point masses and zonal terms and the
  // environment, less the body's own acceleration (its ephemeris velocity
  // differenced over a second).
  const envFn = env ? makeEnvironment(sys, env) : null;
  /** @param {string} key */
  function localGravity(key) {
    const a = accelHeliocentric(s.r, sys.bodiesAt(s.t), sys.muSun);
    if (envFn) envFn(s.t, s.r, s.v, a, s.t);
    const B = body(key, s.t), v0 = [0, 0, 0], v1 = [0, 0, 0];
    B.eph.velocity(s.t - 0.5, v0); B.eph.velocity(s.t + 0.5, v1);
    return -dot(sub(a, sub(v1, v0)), unit(sub(s.r, B.r)));
  }

  // The orbit the craft is in about a body, over one revolution on a side
  // run from st (fields to degree 10): its radius, as e = (r_max - r_min) /
  // (r_max + r_min), and its mean semi-major axis, the two-body osculating
  // one averaged round the turn (aMean; a0 is the osculating one at st).
  // Not the osculating elements alone: the body's J2 swings those within
  // each turn (about 2 km in a at 400 km over Mars, as cos 2u from the node),
  // round the same orbit, and the node's rate goes with the mean (-7/2 a
  // power of it: 2 km is 0.2 %, 13 degrees over a year at Mars).
  /** @param {string} key @param {FlightState} [st] */
  function orbitShape(key, st = s) {
    const B0 = bodyState(key, st.t), r0 = sub(st.r, B0.r), v0 = sub(st.v, B0.v);
    /** @param {number[]} r @param {number[]} v @param {number} mu */
    const aOf = (r, v, mu) => 1 / (2 / norm(r) - dot(v, v) / mu);
    const a0 = aOf(r0, v0, B0.mu);
    if (!(a0 > 0)) return null;
    const T = 2 * Math.PI * Math.sqrt(a0 ** 3 / B0.mu), n = 180;
    let x = st, lo = Infinity, hi = 0, sum = 0;
    for (let i = 1; i <= n; i++) {
      const res = stepCraft(sys, { id: 0, version: 0, r: x.r, v: x.v, t: x.t, tEnd: st.t + (T * i) / n, primary: null, burns: out.burns, maxSteps: 2e5, ...(env ? { env: searchEnv } : {}) });
      if (!res.complete || res.events.some((/** @type {KernelEvent} */ q) => q.type === 'impact')) return null;
      x = { r: res.r, v: res.v, t: res.t };
      const Bx = bodyState(key, x.t), d = sub(x.r, Bx.r);
      lo = Math.min(lo, norm(d)); hi = Math.max(hi, norm(d));
      sum += aOf(d, sub(x.v, Bx.v), Bx.mu);
    }
    return { a: (hi + lo) / 2, e: (hi - lo) / (hi + lo), rMin: lo, rMax: hi, aMean: sum / n, a0 };
  }

  // The way out as it must be at the capture for the parking orbit's plane
  // to hold it when the stay ends: a long stay turns the plane (the body's
  // J2 regresses the node, and the planet's pull and, in the full model,
  // the field's mascons move it too), so a trial circular orbit at the
  // planned periapsis is flown through the stay in the kernel, and the way
  // out turned back by the rotation that took its plane from the one to the
  // other. Twice, as that rotation depends a little on the plane.
  // (tAt: r, v are the periapsis state at that time, not the craft's now.)
  /** @param {string} key @param {number[]} r @param {number[]} v @param {number} rp @param {number[]} w @param {number} tUntil @param {number | null} [tAt] */
  function stayTurned(key, r, v, rp, w, tUntil, tAt = null) {
    const mu = bodyState(key, s.t).mu, hN = unit(cross(r, v));
    const tp = tAt === null ? Math.max(0, timeToPeriapsis(r, v, mu)) : 0, x = tAt === null ? propagate(r, v, tp, mu) : { r, v }, t0 = tAt ?? s.t + tp;
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
      if (!res.complete || res.events.some((/** @type {KernelEvent} */ q) => q.type === 'impact')) break;
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
      // Leaving a moon via its planet, the price moves with the moon round
      // the planet (3 % in a turn of a low orbit at Europa): the burn point
      // is looked for from half a turn before the planned time to half
      // after, not a whole turn after it.
      // (A turn of the parking orbit: the craft may not be in it yet, its
      // capture burn still to come.)
      flyTo(e.via ? Math.max(s.t, t - Math.PI * Math.sqrt(e.rp ** 3 / bodyInfo(e.body).mu)) : t);
      // At each point round the orbit, the two hyperbolas through it that
      // leave on the way out (transfers.js asymptoteVelocities, exact); the
      // cheaper burn, at 72 points and then by golden section about the best.
      // (Leaving a moon via its planet, the way out about the moon at the
      // burn's own time: Europa goes 10 degrees round Jupiter in one turn of
      // a low orbit about it.)
      /** @param {FlightState} [st] @returns {DepartBurn | null} */
      const cheapest = (st = s) => {
        const want0 = departWant(e, st.t), Bs = bodyState(e.body, st.t), B = Bs;
        const r = sub(st.r, Bs.r), v = sub(st.v, Bs.v);
        const a = 1 / (2 / norm(r) - dot(v, v) / B.mu), T = 2 * Math.PI * Math.sqrt(Math.abs(a) ** 3 / B.mu);
        /** @param {number} dt @returns {DepartBurn | null} */
        const at = (dt) => {
          const want = e.via && dt ? departWant(e, st.t + dt) : want0;
          const x = dt ? propagate(r, v, dt, B.mu) : { r, v };
          /** @type {DepartBurn | null} */
          let best = null;
          if (x) for (const v1 of asymptoteVelocities(x.r, want, B.mu)) {
            const d = sub(v1, x.v), m = norm(d);
            if (Number.isFinite(m) && (!best || m < best.m)) best = { dt, d, m, T, rb: norm(x.r), vb: norm(v1) };
          }
          return best;
        };
        let best = /** @type {DepartBurn | null} */ (null), bi = 0;
        for (let i = 0; i < 72; i++) { const c = at((T * i) / 72); if (c && (!best || c.m < best.m)) { best = c; bi = i; } }
        if (!best) return null;
        let lo = (T * (bi - 1)) / 72, hi = (T * (bi + 1)) / 72;
        const gr = (Math.sqrt(5) - 1) / 2, m = (/** @type {number} */ dt) => at(((dt % T) + T) % T)?.m ?? Infinity;
        for (let k = 0; k < 30; k++) { const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo); if (m(c) < m(d)) hi = d; else lo = c; }
        const g = at((((lo + hi) / 2) % T + T) % T);
        return g && g.m < best.m ? g : best;
      };
      // The days ahead are looked at on a side run (in the full model with
      // the fields to degree 10: weeks at degree 50 are a minute), and only
      // the wait chosen is flown.
      // The cheapest of the half days, then golden section within half a day
      // either side of it: the plane turns about 4.5 degrees in half a day
      // at 400 km over Mars, enough to cost per cent.
      const t0 = s.t, side = (/** @type {FlightState} */ from, /** @type {number} */ tt) => {
        const res = stepCraft(sys, { id: 0, version: 0, r: from.r, v: from.v, t: from.t, tEnd: tt, primary: null, burns: out.burns, maxSteps: 2e6, ...(env ? { env: searchEnv } : {}) });
        return res.complete && !res.events.some((/** @type {KernelEvent} */ q) => q.type === 'impact') ? { r: res.r, v: res.v, t: res.t } : null;
      };
      let best = cheapest(), bestAt = s.t, st = /** @type {FlightState | null} */ ({ ...s });
      const onDay = best?.m, now0 = best, seen = [{ st: { ...s }, b: best }];
      for (let h = 0.5; h <= (e.waitDays ?? 30) && best; h += 0.5) {
        st = side(/** @type {FlightState} */ (st), t0 + h * DAY);
        if (!st) break;
        seen.push({ st, b: cheapest(st) });
      }
      const low = seen.reduce((q, x) => (x.b && (!q.b || x.b.m < q.b.m) ? x : q), seen[0]);
      if (low.b && now0 && low.b.m < now0.m * 0.98) {
        const k = seen.indexOf(low), from = seen[Math.max(0, k - 1)].st, hiT = seen[Math.min(seen.length - 1, k + 1)].st.t;
        const f = (/** @type {number} */ tt) => { const x = side(from, tt); return (x && cheapest(x)?.m) ?? Infinity; };
        const g = (Math.sqrt(5) - 1) / 2;
        let a = from.t, b = hiT, c1 = b - g * (b - a), c2 = a + g * (b - a), f1 = f(c1), f2 = f(c2);
        for (let i = 0; i < 16; i++) {
          if (f1 < f2) { b = c2; c2 = c1; f2 = f1; c1 = b - g * (b - a); f1 = f(c1); }
          else { a = c1; c1 = c2; f1 = f2; c2 = a + g * (b - a); f2 = f(c2); }
        }
        bestAt = Math.min(f1, f2) < low.b.m ? (f1 < f2 ? c1 : c2) : low.st.t;
      }
      if (bestAt !== t0) { flyTo(bestAt); best = cheapest() ?? best; }
      if (!best) { out.log.push(`depart ${e.body}: no burn found`); out.trouble.push(`no burn leaves ${bodyInfo(e.body).name} on the way out`); continue; }
      // Near impulsive, as for a capture: a harder burn where PLAN_ACCEL
      // would sweep more than BURN_ARC of the way round (5.7 km/s from a
      // low orbit about Europa would sweep 60 degrees in a fixed direction).
      /** @param {DepartBurn} b */
      const accelOf = (b) => Math.max(PLAN_ACCEL, (b.m * 1000) / (BURN_ARC * b.rb / b.vb));
      // Leaving a planet's moon via the planet, the burn is then set so the
      // excess velocity about the planet is the one planned: Newton on the
      // burn from the patched conics' one, each trial a side run in the
      // kernel to past the planet's outer major moons (three days at
      // Jupiter), its osculating asymptote about the planet there.
      if (e.aimPlanet) {
        let tb0 = s.t + best.dt;
        if (tb0 - (best.m * 1000) / accelOf(best) / 2 < s.t) tb0 += best.T;
        const st = stepCraft(sys, { id: 0, version: 0, r: s.r, v: s.v, t: s.t, tEnd: tb0, primary: null, burns: out.burns, maxSteps: 2e6, ...(env ? { env } : {}) });
        const want = departWant(e, tb0, true), muP = bodyInfo(e.via).mu, later = out.burns.filter((b) => b.t1 > tb0);
        /** @param {number[]} dv */
        const excess = (dv) => {
          const res = stepCraft(sys, { id: 0, version: 0, r: st.r, v: add(st.v, dv), t: tb0, tEnd: tb0 + /** @type {number} */ (e.aimPlanet), primary: null, burns: later, maxSteps: 2e6, ...(env ? { env: cheapEnv } : {}) });
          if (!res.complete || res.events.some((/** @type {KernelEvent} */ q) => q.type === 'impact')) return null;
          const P = bodyState(/** @type {string} */ (e.via), res.t);
          return asymptote(sub(res.r, P.r), sub(res.v, P.v), muP);
        };
        let d = best.d, f = st.complete ? excess(d) : null, off0 = f ? norm(sub(f, want)) : Infinity, off = off0;
        for (let it = 0; it < 6 && f && off > 1e-4; it++) {
          const cols = /** @type {number[][]} */ ([0, 1, 2].map((j) => { const dd = [...d]; dd[j] += 1e-4; const q = excess(dd); return q && scale(sub(q, /** @type {number[]} */ (f)), 1e4); }));   // (each is a vector: a null breaks out just below)
          if (cols.some((c) => !c)) break;
          const A = [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]), step = solve3(A, sub(want, f));
          if (!step) break;
          const dn = add(d, step), fn = excess(dn), on = fn ? norm(sub(fn, want)) : Infinity;
          if (!(on < off)) break;
          d = dn; f = fn; off = on;
        }
        if (off < off0) { best.d = d; best.m = norm(d); best.dt = tb0 - s.t; }
        // Then aimed, from there, at the leg's aim point, as the aims are
        // flown: what is left is the Sun's pull on the way out of the
        // planet's sphere, months of it, cheapest to correct in the burn
        // itself (an aim half a day on cost Europa to Earth 120 m/s; folded
        // into the burn, 5).
        const A = e.aimAt, Tk = /** @type {number} */ (A && kernelSeconds(new Date(A.arrive)));
        const k = A && st.complete ? aimTo(A.without ? without(A.without) : sys, { r: st.r, v: st.v, t0: tb0, T: Tk, target: add(posAt(sys, A.body, Tk), A.offsetEqj), burns: later, dv0: best.d, rounds: 3, damped: true, env, envJ: env && cheapEnv }) : null;
        if (k && k.after < k.miss) { best.d = k.dv; best.m = norm(k.dv); best.dt = tb0 - s.t; best.aimedKm = k.after; }
        best.offMs = off * 1000;
      }
      const accel = accelOf(best);
      let tb = s.t + best.dt;
      if (tb - (best.m * 1000) / accel / 2 < s.t) tb += best.T;
      const from = orbitShape(e.body);
      // How far the orbit's plane is off the way out as it leaves (for the
      // record: the plan prices it, journey.js planeAt).
      const { r: rNow, v: vNow } = rel(e.body, s.t), offDeg = Math.asin(Math.min(1, Math.abs(dot(unit(cross(rNow, vNow)), unit(departWant(e, s.t)))))) * 180 / Math.PI;
      burn(tb, best.d, best.m, null, null, accel);
      out.log.push(`depart ${e.body}: ${(best.m * 1000).toFixed(0)} m/s${accel > PLAN_ACCEL ? ` (at ${accel.toFixed(0)} m/s^2)` : ''}, ${((tb - kernelSeconds(new Date(e.ms))) / 3600).toFixed(1)} h after the planned time${best.offMs !== undefined ? ` (the excess about ${bodyInfo(e.via).name} first matched to ${best.offMs.toFixed(1)} m/s${best.aimedKm !== undefined ? `, then aimed to ${best.aimedKm.toFixed(0)} km` : ''})` : ''}${bestAt !== t0 && onDay ? ` (${(onDay * 1000).toFixed(0)} m/s on the planned day)` : ''}${from ? `; from an orbit of mean a ${from.aMean.toFixed(1)} km, e ${from.e.toFixed(4)}` : ''}, the plane ${offDeg.toFixed(2)} deg off the way out`);
      continue;
    }
    if (e.kind === 'phase') {
      // The craft on its parking orbit, against where the plan has it (the
      // capture comes at the flown periapsis, hours from the planned one at
      // Jupiter, so the craft can be a third of a turn off): a tangential
      // burn onto a phasing orbit, N turns on it, and the burn back, so that
      // it gains or loses that angle before the departure (two-body, the
      // most turns the stay allows: the cheapest). What is left the
      // departure's own arc takes up.
      flyTo(t);
      const { r, v, B } = rel(e.body, s.t), n = unit(cross(r, v)), mu = B.mu, rr = norm(r);
      const want = ecl(parkedAt(e.parked.orbit, (kernelMs(s.t) - e.parked.t0) / 1000, e.parked.rc, mu).r);
      const w = sub(want, scale(n, dot(want, n)));
      const off = Math.atan2(dot(cross(unit(r), unit(w)), n), dot(unit(r), unit(w)));
      // (The orbit's own semi-major axis and period, not the circle's at
      // this radius: the capture leaves it a little eccentric.)
      const a = 1 / (2 / rr - dot(v, v) / mu), T = 2 * Math.PI * Math.sqrt(a ** 3 / mu), N = Math.floor((kernelSeconds(new Date(e.untilMs)) - s.t - 0.5 * T) / T);
      if (N < 1 || Math.abs(off) < 1e-4) { out.log.push(`phase at ${e.body}: ${(off * 180 / Math.PI).toFixed(2)} deg off, left to the departure`); continue; }
      const Tp = T - off / (2 * Math.PI) * T / N, ap = a * (Tp / T) ** (2 / 3);
      const dv = Math.sqrt(mu * (2 / rr - 1 / ap)) - norm(v), sg = Math.sign(dv), t1 = s.t + durOf(Math.abs(dv)) / 2;
      if (2 * ap - rr < bodyInfo(e.body).radius + 100) { out.log.push(`phase at ${e.body}: ${(off * 180 / Math.PI).toFixed(1)} deg off, no phasing orbit clears the planet`); continue; }
      burn(t1, [sg, 0, 0], Math.abs(dv), 'vnb', e.body);
      burn(t1 + N * Tp, [-sg, 0, 0], Math.abs(dv), 'vnb', e.body);
      out.correctionsDv = (out.correctionsDv ?? 0) + 2 * Math.abs(dv);
      out.log.push(`phase at ${e.body}: ${(off * 180 / Math.PI).toFixed(1)} deg off where the plan has the craft; ${N} turns on a phasing orbit, 2 x ${(Math.abs(dv) * 1000).toFixed(1)} m/s`);
      continue;
    }
    if (e.kind === 'depart-ring' && e.to && e.arrMs) {
      // From a parking orbit the plan captured into (journey.js parkedAt):
      // at the planned time, from where the craft is, onto the arc to the
      // moon's place at the arrival (Lambert about the planet, the cheaper
      // way round), the burn centred there. (Waiting for the craft to come
      // round to a point, up to a turn, reached the moon's place late.)
      // Within half a turn of the planned time, the point on the craft's
      // own orbit that costs least (its plane and phase are the flown ones,
      // a few degrees from the plan's): 48 times, then golden section.
      const mu = bodyInfo(e.body).mu, here = rel(e.body, s.t), T = 2 * Math.PI * Math.sqrt((1 / (2 / norm(here.r) - dot(here.v, here.v) / mu)) ** 3 / mu);
      flyTo(Math.max(s.t, t - T / 2 - durOf(e.dv)));
      const { r, v } = rel(e.body, s.t), t0 = s.t;
      const Ta = kernelSeconds(new Date(e.arrMs)), M = bodyState(e.to, Ta), Pl = bodyState(e.body, Ta), r2 = sub(M.r, Pl.r);
      /** @param {number} tc */
      const leave = (tc) => {
        const c = propagate(r, v, tc - t0, mu);
        if (!c) return null;
        let best = null;
        for (const pro of [true, false]) {
          const arc = lambert(c.r, r2, Ta - tc, mu, pro), d = arc && sub(arc.v1, c.v);
          if (d && (!best || norm(d) < norm(best.dv))) best = { dv: d, c, tc };
        }
        return best;
      };
      const lo0 = Math.max(t0 + durOf(e.dv) / 2, t - T / 2), hi0 = t + T / 2;
      let bi = null;
      for (let i = 0; i <= 48; i++) { const x = leave(lo0 + ((hi0 - lo0) * i) / 48); if (x && (!bi || norm(x.dv) < norm(bi.dv))) bi = x; }
      if (!bi) { out.log.push(`depart ${e.body}: no arc to ${e.to}`); out.trouble.push(`the departure from ${bodyInfo(e.body).name} found no arc`); continue; }
      let lo = Math.max(lo0, bi.tc - (hi0 - lo0) / 48), hi = Math.min(hi0, bi.tc + (hi0 - lo0) / 48);
      const gr = (Math.sqrt(5) - 1) / 2, cost = (/** @type {number} */ x) => { const q = leave(x); return q ? norm(q.dv) : Infinity; };
      for (let i = 0; i < 30; i++) { const a = hi - gr * (hi - lo), b = lo + gr * (hi - lo); if (cost(a) < cost(b)) hi = b; else lo = a; }
      const g = leave((lo + hi) / 2);
      if (g && norm(g.dv) < norm(bi.dv)) bi = g;
      burn(bi.tc, bi.dv, norm(bi.dv));
      const off = Math.acos(Math.max(-1, Math.min(1, dot(unit(bi.c.r), unit(e.dirEqj))))) * 180 / Math.PI;
      out.log.push(`depart ${e.body}: ${(norm(bi.dv) * 1000).toFixed(0)} m/s, ${((bi.tc - t) / 60).toFixed(0)} min from the planned time, ${off.toFixed(1)} deg from the planned point (the plan's ${(e.dv * 1000).toFixed(0)})`);
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
          // The air brought it down on the way (a low perigee from orbit:
          // the full model's drag), slowed to a fall the parachutes the
          // plan assumes would take: an entry, set down there.
          if (speed < ENTRY_FALL_MAX) {
            s = touch;
            setDown(e.body, e.waypoint, 'entry', { entryKm: 0 });
            landingOn = null; touch = null;
            out.log.push(`entry at ${e.body}: down through the air before its perigee, falling at ${(speed * 1000).toFixed(0)} m/s, set down there`);
            continue;
          }
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
      // The descent orbit from the orbit the craft is really in (circular
      // to a few thousandths, and the body's J2 swings its osculating
      // radius), so the burn along the velocity that puts the two-body
      // periapsis 15 km up (bisection), not the circular orbit's.
      /** @param {number} dv */
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
      flyTo((b1 ? b1.t1 : s.t) + 10);   // no burn when d1 is 0
      // Half an orbit down to the periapsis, the braking burn worked out two
      // minutes short of it (the Earth's pull and the Moon's J2 move a
      // periapsis by kilometres over the half orbit).
      ({ r, v } = rel(e.body, s.t));
      /** @param {number[]} rr @param {number[]} vv */
      const toPeri = (rr, vv) => { const tp = timeToPeriapsis(rr, vv, Bk.mu); return tp > 0 ? tp : tp + 2 * Math.PI * Math.sqrt((1 / (2 / norm(rr) - dot(vv, vv) / Bk.mu)) ** 3 / Bk.mu); };
      flyTo(s.t + toPeri(r, v) - 120);
      if (out.impact) break;
      ({ r, v } = rel(e.body, s.t));
      const dtp = toPeri(r, v), x = propagate(r, v, dtp, Bk.mu) ?? { r, v };
      const br = designBraking({ r: x.r, v: x.v, mu: Bk.mu, R, hEnd: 1.5 });
      if (!br) { out.log.push(`descent to ${e.body}: no braking burn stops it above the ground`); out.trouble.push(`no braking burn sets it down on ${bodyInfo(e.body).name}`); landingOn = null; continue; }
      const tB = s.t + dtp, scripted = (/** @type {number} */ t0, /** @type {number} */ t1, /** @type {number} */ a, /** @type {number[]} */ dir, /** @type {boolean} */ frame) => { const b = { t0, t1, dir, F: a * 1000, m0: 1, mdot: 0, scripted: true, ...(frame ? { frame: 'vnb', about: e.body } : {}) }; out.burns.push(b); return b; };
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
        if (term) scripted(s.t + term.delay, s.t + term.delay + /** @type {number} */ (term.dur), term.accel, term.dir, false);
        flyTo(s.t + (term ? term.delay + /** @type {number} */ (term.dur) : 0) + 600, 1);
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
      const u = next ? (next.kind === 'depart' ? departWant(next, kernelSeconds(new Date(next.ms))) : /** @type {DepartRingEvent} */ (next).dirEqj) : null;
      let along = u ? sub(u, scale(up, dot(u, up))) : null;
      if (!along || norm(along) < 1e-6 * norm(/** @type {number[]} */ (u))) along = cross(pole, up);
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
      // Centred on its time, unless that would start it before the craft
      // is there (an orbit change that opens the journey): then from now,
      // or its first half is never flown.
      burn(Math.max(t, s.t + durOf(Math.abs(e.dv)) / 2), [Math.sign(e.dv), 0, 0], Math.abs(e.dv), 'vnb', e.body);
      continue;
    }
    if (e.kind === 'capture') {
      // Near the planned periapsis: its time and state on the two-body
      // hyperbola about the body, from six hours before and again from five
      // minutes before (the Sun's pull and the body's J2 move it over the
      // hours), from the craft's own state.
      const lead = 6 * 3600 + durOf(5);
      flyTo(Math.min(t, peri.get(e.body) ?? t) - lead);
      if (out.impact) break;
      let { r, v, B } = rel(e.body, s.t), dtp = Math.max(0, timeToPeriapsis(r, v, B.mu));
      if (dtp > 600) {
        flyTo(s.t + dtp - 300);
        if (out.impact) break;
        ({ r, v, B } = rel(e.body, s.t));
        dtp = Math.max(0, timeToPeriapsis(r, v, B.mu));
      }
      const x = propagate(r, v, dtp, B.mu) ?? { r, v };
      const tp = s.t + dtp, rp = norm(x.r), vp = norm(x.v);
      const dv = vp - Math.sqrt(B.mu / rp), rc = e.rp ?? rp;
      // From periapsis on, not centred on it: braking before periapsis
      // would drop the path into the body (a 6 km/s capture takes minutes).
      // Steered (landing.js planCapture), so the orbit ends circular: two
      // halves, each at its own pitch from retrograde, into a circular orbit
      // near the periapsis, then a Hohmann transfer to the planned radius.
      // Held retrograde, a 2 km/s capture at Mars left the orbit at e 0.04,
      // and every departure from it cost 2 to 5 % more than the plan's.
      // And near impulsive, as the plan prices it: no more than BURN_ARC of
      // the orbit swept in the burn, a harder one where PLAN_ACCEL would
      // sweep more (a 5.8 km/s capture 300 km over Europa sweeps 65 degrees
      // at 20 m/s^2, and held retrograde left the periapsis under the
      // ground; at the planets and the Moon, 12 degrees at most).
      const accel = Math.max(PLAN_ACCEL, (Math.max(0, dv) * 1000) / (BURN_ARC * rp / vp));
      const tb = Math.max(tp, s.t);
      for (const w of watches) if (w.body === e.body && w.t0 <= tb && w.t1 >= tb) w.t1 = tb;
      const cap = dv > 0 ? planCapture({ r: x.r, v: x.v, mu: B.mu, R: bodyInfo(e.body).radius, rc, accel: accel / 1000 }) : null;
      let tEnd = tb, flownDv = 0, moved = /** @type {{ from: number, dv: number } | null} */ (null);
      // The orbit flown so far, from time t on (a side run to t, then a turn).
      /** @param {number} t */
      const shapeAt = (t) => {
        const res = stepCraft(sys, { id: 0, version: 0, r: s.r, v: s.v, t: s.t, tEnd: t, primary: null, burns: out.burns, maxSteps: 2e6, ...(env ? { env } : {}) });
        return res.complete && !res.events.some((/** @type {KernelEvent} */ q) => q.type === 'impact') ? orbitShape(e.body, { r: res.r, v: res.v, t: res.t }) : null;
      };
      if (cap) {
        const half = cap.dur / 2;
        for (const [i, p] of cap.pitch.entries()) out.burns.push({ t0: tb + i * half, t1: tb + (i + 1) * half, dir: [-Math.cos(p), Math.sin(p), 0], F: accel, m0: 1, mdot: 0, scripted: true, frame: 'vnb', about: e.body });
        tEnd = tb + cap.dur; flownDv = cap.dv;
        // Then the Hohmann transfer to the planned radius, as the mean one:
        // in the body's J2 field the osculating radius swings by kilometres
        // round each turn, so a transfer of a few kilometres is worked out
        // on the orbit's mean semi-major axis (orbitShape), its two burns
        // along the velocity half the transfer's period apart (Curtis Sec.
        // 6.2), not at apsides from the two-body orbit. Twice, the second
        // pass tidying what J2 left. Not if the next event comes first (an
        // orbit change straight after), nor for under 100 m.
        const next = plan.events.find((q) => q.ms > e.ms && !['arrive', 'point', 'land'].includes(q.kind));
        for (let pass = 0; pass < 2; pass++) {
          const now = shapeAt(tEnd + 1);
          if (!now || Math.abs(now.aMean - rc) < 0.1) break;
          const h = hohmannCircular(B.mu, now.aMean, rc), sg = Math.sign(rc - now.aMean), gap = Math.PI * Math.sqrt(h.a ** 3 / B.mu);
          const t1 = tEnd + 5 + durOf(h.dv1) / 2;
          if (next && kernelSeconds(new Date(next.ms)) < t1 + gap + 600) break;
          burn(t1, [sg, 0, 0], h.dv1, 'vnb', e.body);
          tEnd = burn(t1 + gap, [sg, 0, 0], h.dv2, 'vnb', e.body)?.t1 ?? t1 + gap;
          flownDv += h.dv1 + h.dv2;
          moved = { from: moved?.from ?? now.aMean, dv: (moved?.dv ?? 0) + h.dv1 + h.dv2 };
        }
      } else if (dv > 0) {
        // (No steered burn found: retrograde from the periapsis, as before.)
        tEnd = /** @type {Burn} */ (burn(tb + (dv * 1000) / accel / 2, [-1, 0, 0], dv, 'vnb', e.body, accel)).t1; flownDv = dv;
      }
      // The orbit it leaves, from the last burn's end (on a side run).
      const orbit = flownDv > 0 ? shapeAt(tEnd + 1) : null;
      out.captures.push({ body: e.body, dv: flownDv, impulsive: Math.max(0, dv), steered: !!cap, pitchDeg: cap ? cap.pitch.map((/** @type {number} */ p) => p * 180 / Math.PI) : null, hohmann: moved, rc, ...(orbit ? { a: orbit.aMean, e: orbit.e } : {}) });
      out.log.push(`capture at ${e.body}: ${(flownDv * 1000).toFixed(0)} m/s (impulsive ${(Math.max(0, dv) * 1000).toFixed(0)}), ${cap ? `steered from ${rp.toFixed(0)} km${accel > PLAN_ACCEL ? ` at ${accel.toFixed(0)} m/s^2` : ''} (pitch ${cap.pitch.map((/** @type {number} */ p) => (p * 180 / Math.PI).toFixed(1)).join(' then ')} deg)${moved ? `, then Hohmann from a mean ${moved.from.toFixed(1)} km for ${(moved.dv * 1000).toFixed(1)} m/s` : ''}` : `retrograde from ${rp.toFixed(0)} km${accel > PLAN_ACCEL ? ` at ${accel.toFixed(0)} m/s^2` : ''}`}${orbit ? `; the orbit's mean a ${orbit.aMean.toFixed(1)} km (planned ${rc.toFixed(1)}), e ${orbit.e.toFixed(4)}` : ''}`);
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
      const future = out.burns.filter((b) => b.t1 > s.t);
      // The last aim down a planet's well into an orbit about its moon: the
      // periapsis point made again from the way in as the craft now has it,
      // so the hyperbola's plane holds the way out. The planned point is
      // from the patched conics' way in; the kernel's differs by degrees
      // (10 at Europa), and the trims inside the moon's sphere, minutes
      // out, cannot turn the plane for less than the departure would pay
      // for it (169 m/s for 9 degrees). Here, two days out, it is cheap.
      // The way in is the craft's velocity about the moon at the arrival on
      // a side run without the moon's pull.
      let offsetEqj = e.offsetEqj;
      if (e.replane) {
        const res = stepCraft(without(e.body), { id: 0, version: 0, r: s.r, v: s.v, t: s.t, tEnd: Tk, primary: null, burns: future.map((b) => ({ ...b })), maxSteps: 2e6, ...(env ? { env: cheapEnv } : {}) });
        const M = bodyState(e.body, Tk), vin = res.complete ? sub(res.v, M.v) : null, w = unit(e.replane.wayOutEqj);
        // The periapsis in the plane of the way in and ww; then ww turned
        // back by the stay's turn of the plane (stayTurned, flown from that
        // periapsis: ten degrees over six days at Europa, Jupiter's pull and
        // Europa's own field), and the periapsis again in its plane.
        const rp = e.replane.rp, peri = (/** @type {number[]} */ ww) => {
          const nn = vin && cross(vin, ww);
          if (!nn || !(norm(nn) > 1e-6 * norm(vin))) return null;
          const uin = unit(vin), uout = rotate(uin, unit(nn), turnAngle(rp, norm(vin), M.mu)), d = sub(uin, uout), b = add(uin, uout);
          return norm(d) > 1e-9 && norm(b) > 1e-9 ? { r: scale(unit(d), rp), v: scale(unit(b), Math.sqrt(dot(vin, vin) + 2 * M.mu / rp)) } : null;
        };
        let p = peri(w);
        if (p && e.replane.untilMs) { const w2 = stayTurned(e.body, p.r, p.v, rp, w, kernelSeconds(new Date(e.replane.untilMs)), Tk); p = peri(w2) ?? p; }
        if (p) offsetEqj = p.r;
      }
      const target = add(posAt(sys, e.body, Tk), offsetEqj);
      // A first guess: the two-body arc about the leg's central body.
      const C0 = e.central === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : bodyState(e.central, s.t), CT = e.central === 'sun' ? [0, 0, 0] : posAt(sys, e.central, Tk);
      const muC = e.central === 'sun' ? sys.muSun : bodyInfo(e.central).mu;
      const arc = lambert(sub(s.r, C0.r), sub(target, CT), Tk - s.t, muC, true);
      const dv0 = arc ? sub(arc.v1, sub(s.v, C0.v)) : null;
      let k = aimTo(e.without ? without(e.without) : sys, { r: s.r, v: s.v, t0: s.t, T: Tk, target, burns: future, dv0, rounds: 8, damped: true, env, envJ: env && cheapEnv });
      // Far out at a planet (farTo): the planet's pull up to the next aim,
      // from side runs with it and without it after this aim, carried on in
      // a straight line to the arrival; aimed again for the next aim's point
      // less that. (Its pull from there on is the next aim's.)
      if (k && e.farTo) {
        const tm = kernelSeconds(new Date(e.farTo.ms)), v1 = add(s.v, k.dv);
        /** @param {BodySet} S */
        const run = (S) => stepCraft(S, { id: 0, version: 0, r: s.r, v: v1, t: s.t, tEnd: tm, primary: null, burns: future, maxSteps: 2e6, ...(env ? { env: cheapEnv } : {}) });
        const a = run(sys), b = run(without(/** @type {string} */ (e.without)));
        if (a.complete && b.complete && ![a, b].some((x) => x.events.some((/** @type {KernelEvent} */ q) => q.type === 'impact'))) {
          const d = add(sub(a.r, b.r), scale(sub(a.v, b.v), Tk - tm));
          const k2 = aimTo(without(/** @type {string} */ (e.without)), { r: s.r, v: s.v, t0: s.t, T: Tk, target: sub(add(posAt(sys, e.body, Tk), e.farTo.offsetEqj), d), burns: future, dv0: k.dv, rounds: 8, damped: true, env, envJ: env && cheapEnv });
          if (k2) k = k2;
        }
      }
      // Down a planet's well to its moon, the trial runs of an aim at the
      // moon fly the planet's pull, and a course straight at a moon inside
      // the planet's capture radius meets the planet first: at 6 km/s about
      // 700,000 km for Jupiter (Io's and Europa's orbits lie inside it), at
      // 3 km/s 700,000 km for Saturn (Mimas to Rhea) and 180,000 km for
      // Uranus (Miranda). When every run falls in, the aim finds no burn;
      // when the run with no burn clears it and every correction falls in,
      // it keeps no burn at all and comes no nearer. Either way the aim is then at
      // the planet's B-plane point for the planned way in instead, without
      // the planet, as at a planet; the next aim at the moon starts from a
      // course that clears the planet.
      const stuck = !k || (k.after > AIM_CONVERGED_KM && norm(k.dv) === 0);
      if (stuck && e.planetB && e.central === 'sun') {
        const B = e.planetB, TB = kernelSeconds(new Date(B.periMs)), P0 = bodyState(B.body, s.t);
        /** @type {typeof k} */
        let kf = null;
        if (norm(sub(s.r, P0.r)) < sphereOfInfluence(B.body)) {
          // Inside the planet's sphere the way in is already bent, and the
          // planet's pull is the guide: a two-body arc about it to the aim
          // point at the moon, either way round, flown with it.
          const PT = posAt(sys, B.body, Tk);
          for (const pro of [true, false]) {
            const arcP = lambert(sub(s.r, P0.r), sub(target, PT), Tk - s.t, B.mu, pro);
            kf = arcP && aimTo(e.without ? without(e.without) : sys, { r: s.r, v: s.v, t0: s.t, T: Tk, target, burns: future, dv0: sub(arcP.v1, sub(s.v, P0.v)), rounds: 8, damped: true, env, envJ: env && cheapEnv });
            if (kf) break;
          }
          if (kf) { k = kf; out.log.push(`aim at ${e.body}: the trial runs fell into ${bodyInfo(B.body).name}; from an arc about it instead`); }
        } else if (TB - s.t > 3600) {
          // Further out, the planet's B-plane point for the planned way in,
          // without the planet, as at a planet (bentAim).
          const pt = add(posAt(sys, B.body, TB), bentAim(B.offsetEqj, B.vinEqj, B.rp, B.mu, B.periMs)(kernelMs(s.t)));
          const arcP = lambert(s.r, pt, TB - s.t, sys.muSun, true);
          kf = aimTo(without(B.body), { r: s.r, v: s.v, t0: s.t, T: TB, target: pt, burns: future, dv0: arcP ? sub(arcP.v1, s.v) : null, rounds: 8, damped: true, env, envJ: env && cheapEnv });
          if (kf && kf.after < AIM_CONVERGED_KM) { k = kf; out.log.push(`aim at ${e.body}: the trial runs fell into ${bodyInfo(B.body).name}; at its B-plane instead`); }
        }
      }
      if (!k) { out.log.push(`aim at ${e.body} failed`); out.trouble.push(`the aim at ${bodyInfo(e.body).name} found no burn`); continue; }
      if (k.after > AIM_CONVERGED_KM && e.last) out.trouble.push(`the aim at ${bodyInfo(e.body).name} came no nearer than ${k.after.toFixed(0)} km`);
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
        /** @param {number[]} dv */
        const rpOf = (dv) => {
          const vv = add(v, dv), h = norm(cross(r, vv)), en = dot(vv, vv) / 2 - B.mu / norm(r);
          return (h * h / B.mu) / (1 + Math.sqrt(Math.max(0, 1 + 2 * en * h * h / (B.mu * B.mu))));
        };
        let b0 = 0, b1 = 1e-4, f0 = rpOf([0, 0, 0]) - e.rp, f1 = rpOf(scale(bh, b1)) - e.rp;
        for (let i = 0; i < 30 && Math.abs(f1) > 0.1 && f1 !== f0; i++) { const b2 = b1 - f1 * (b1 - b0) / (f1 - f0); b0 = b1; f0 = f1; b1 = b2; f1 = rpOf(scale(bh, b1)) - e.rp; }
        let dv = Number.isFinite(b1) && Math.abs(b1) < 0.5 ? scale(bh, b1) : [0, 0, 0];
        let w = /** @type {number[] | null} */ (e.wayOutEqj ? unit(e.wayOutEqj) : null);
        if (w && pass === 0 && e.untilMs) w = stayTurned(e.body, r, v, e.rp, w, kernelSeconds(new Date(e.untilMs)));
        if (w) e.wayOutEqj = w;
        // Over a stay the plan prices the plane for (planeTurn: more than 30
        // days at a planet), the plane it prices: the kernel's way in is not
        // the patched conics', so the plane through it and the way out is
        // turned about the way out from the plan's (a year at Mars, 0.5
        // degrees steeper to the equator), and its node turns at another
        // rate (about 0.5 % faster, as cos i: 16 degrees over the year). The burn cannot
        // give the orbit the plan's plane itself: the plane holds the craft's
        // position, and the two planes meet only along the way out. It turns
        // the plane about the position instead (cheap far out, where the
        // velocity across it is small: about 1 m/s a degree at 340,000 km
        // over Mars), so that the node, turned at the orbit's own rate (the
        // plan's, times cos i / cos i0, eq. (4.52)) over the planned stay,
        // comes to the plan's on the planned day. Over a long stay the
        // inclination's share of the node grows (a year at Mars, 30 degrees
        // of node a degree), so an inclination within a few hundredths of a
        // degree of the plan's does it. At the Moon (planeHold), where the
        // plan flies the plane through the stay from its capture's, the plane
        // is turned about the position to the nearest to the plan's: the
        // plan's, less its part along the position. Otherwise (a short stay,
        // or a stay the plan does not price) the plane holds the way out.
        const pt = e.planeTurn, ph = e.planeHold;
        let cond = /** @type {((h: number[]) => number) | null} */ (null);
        if (ph) {
          const ru = unit(r), np = unit(sub(ph, scale(ru, dot(ph, ru)))), c = unit(cross(ru, np));
          cond = (/** @type {number[]} */ h) => dot(unit(h), c);
        } else if (pt && Math.abs(dot(unit(r), pt.pole)) < 0.98) {
          const nodeOf = (/** @type {number[]} */ n) => { const q = cross(pt.pole, n); return Math.atan2(dot(q, pt.f2), dot(q, pt.f1)); };
          const c0 = dot(pt.n0, pt.pole), node0 = nodeOf(pt.n0);
          cond = (/** @type {number[]} */ h) => {
            const n = unit(h);
            let g = nodeOf(n) - node0 + pt.rate * pt.stayS * (dot(n, pt.pole) / c0 - 1);
            g -= 2 * Math.PI * Math.round(g / (2 * Math.PI));
            return g;
          };
        } else if (w && norm(cross(w, unit(v))) > 0.02) cond = (/** @type {number[]} */ h) => dot(unit(h), w);
        if (cond) {
          const e2 = unit(cross(v, bh));
          /** @param {number[]} x */
          const F = (x) => { const d = add(scale(bh, x[0]), scale(e2, x[1])), h = cross(r, add(v, d)); return [(rpOf(d) - e.rp) / e.rp, /** @type {(h: number[]) => number} */ (cond)(h)]; };
          let x = [dot(dv, bh), 0];
          for (let it = 0; it < 12; it++) {
            const f = F(x);
            if (Math.abs(f[0]) < 1e-6 && Math.abs(f[1]) < 1e-7) break;
            const hs = 1e-6, a = F([x[0] + hs, x[1]]), c = F([x[0], x[1] + hs]);
            const J = [[(a[0] - f[0]) / hs, (c[0] - f[0]) / hs], [(a[1] - f[1]) / hs, (c[1] - f[1]) / hs]], D = J[0][0] * J[1][1] - J[0][1] * J[1][0];
            if (!(Math.abs(D) > 0)) break;
            x = [x[0] - (J[1][1] * f[0] - J[0][1] * f[1]) / D, x[1] - (-J[1][0] * f[0] + J[0][0] * f[1]) / D];
          }
          // Taken only if it costs less extra than turning the plane by as
          // much in the circular orbit would (v_c times the angle, Curtis
          // eq. (6.20) for a small turn): Newton can land on a far root, the
          // plane the other way up.
          const f = F(x), d = add(scale(bh, x[0]), scale(e2, x[1]));
          const h0 = unit(cross(r, add(v, dv))), h1 = unit(cross(r, add(v, d))), turn = Math.acos(Math.max(-1, Math.min(1, dot(h0, h1))));
          const cap = pt || ph ? Math.sqrt(B.mu / e.rp) * turn : Math.sqrt(B.mu / e.rp) * Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(h0, w ?? h0)))));
          if (Math.abs(f[0]) < 1e-4 && Math.abs(f[1]) < 1e-5 && turn < Math.PI / 2 && norm(d) - norm(dv) < cap) dv = d;
        }
        const m = norm(dv);
        if (m > 1e-7) {
          burn(s.t + durOf(m) / 2, dv, m);
          const nodeOff = (/** @type {number[]} */ q) => (cond && pt ? (cond(cross(r, q)) * 180 / Math.PI).toFixed(3) : '');
          out.log.push(`trim at ${e.body}: ${(m * 1000).toFixed(2)} m/s, periapsis ${rpOf([0, 0, 0]).toFixed(0)} to ${rpOf(dv).toFixed(0)} km${w ? `, the plane ${(Math.asin(Math.max(-1, Math.min(1, dot(unit(cross(r, v)), w)))) * 180 / Math.PI).toFixed(2)} to ${(Math.asin(Math.max(-1, Math.min(1, dot(unit(cross(r, add(v, dv))), w)))) * 180 / Math.PI).toFixed(2)} deg off the way out` : ''}${cond && pt ? `, the node on the planned day ${nodeOff(v)} to ${nodeOff(add(v, dv))} deg off the plan's` : ''}${ph ? `, the plane ${(Math.acos(Math.max(-1, Math.min(1, dot(unit(cross(r, v)), ph)))) * 180 / Math.PI).toFixed(3)} to ${(Math.acos(Math.max(-1, Math.min(1, dot(unit(cross(r, add(v, dv))), ph)))) * 180 / Math.PI).toFixed(3)} deg off the plan's` : ''}`);
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
  if (!out.impact && !out.gaveUp) flyTo(Math.max(s.t, tEnd - DAY + 3600, ...watches.map((w) => w.t1), ...watches.map((w) => (w.onToMs ? kernelSeconds(new Date(w.onToMs)) : -Infinity))));
  // missKm: for a flyby or capture, the closest approach less the planned
  // periapsis; home to a central body, the distance from the aimed point.
  out.arrivals = watches.map((w) => ({ waypoint: w.waypoint, body: w.body, closest: w.best, plannedRp: w.plannedRp, missKm: w.pointMiss ?? Math.abs(w.best - w.plannedRp), at: w.at, central: w.central, landed: out.landings.some((l) => l.waypoint === w.waypoint) }));
  return out;
}
