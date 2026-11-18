// src/physics/journey.js
//
// A journey of any number of legs, by patched conics (docs/physics/journey.md).
// Pure ES module: no three.js, React or DOM. km, km/s, s; dates in Unix ms;
// vectors heliocentric (or about a leg's central body) in ecliptic J2000.
//
// A journey is a start and a list of waypoints, in order:
//   start:     { body, kind: 'pad' | 'orbit' | 'craft', altKm, dateMs,
//                state?: { r, v } (a craft: heliocentric ecliptic, at dateMs) }
//   waypoint:  { id, body, kind: 'flyby' | 'orbit' | 'land', altKm,
//                stayDays, dateMs (arrival), via?, revs?, branch?, leadDeg?, incDeg? }
// Bodies are planets ('mars'), the Moon ('moon') and small bodies ('sb:433',
// registered from public/data/smallbodies.json). Each leg runs between two
// stops about the body they share: the Sun for planets and small bodies,
// a planet for its moons; a moon's leg to another planet is solved about
// the Sun from the moon's planet, with the moon's own escape or capture
// patched on (three-level patched conics).
//
//   solveJourney(journey)        every leg at the waypoints' dates, the flybys
//                                that join them, the burns, totals and a path
//   legOptions(journey, k)       the transfers that apply to leg k, compared
//   phaseOption(journey, k)      leaving a moon: the best day in the stay
//   planeOption(journey, k)      leaving a planet's orbit after a long stay:
//                                the day near the planned one its turned
//                                plane holds the way out, and the day the
//                                flight would wait for
//   applyOption(journey, k, o)   the journey re-timed to option o
//   defaultArrival(...)          a first guess at a new waypoint's date
//   journeyPath(solution)        points along every arc, for drawing

/** @typedef {{ id: number, ms: number, pro: number, nor: number, rad: number }} BurnNode */
/** @typedef {{ resonance?: [number, number], resonantPhi?: number, id: number, body: string, kind: 'flyby' | 'orbit' | 'land', altKm: number, stayDays?: number, dateMs: number, via?: string, chosen?: string, revs?: number, branch?: string, leadDeg?: number, incDeg?: number, nodes?: BurnNode[], aim?: { bT: number, bR: number } }} Waypoint */
/** @typedef {{ body: string, kind: 'pad' | 'orbit' | 'craft', altKm: number, dateMs: number, latDeg?: number, incDeg?: number, state?: { r: number[], v: number[] }, craftId?: number }} JourneyStart */
/** @typedef {{ start: JourneyStart, waypoints: Waypoint[] }} Journey */

import { lambert, lambertRevs, propagate } from './orbital.js';
import { helioStateEcl, ttSeconds, eqjToEcl } from './ephemeris.js';
import { MOON_KEYS, moonStateEqj } from './moons.js';
import { MOON_DATA } from './moons.data.js';
import { bodyConstants, MU_SUN, ZONAL } from './bodies.js';
import { bodyAxesEqj } from './orientation.js';
import { nodeRate, flownNodeRate, turnPlane, leaveCircularDv, planeAngle } from './parkingPlane.js';
import { PLANETS } from '../utils/constants.js';
import { nelderMead } from './trajsearch.js';
import * as X from './transfers.js';

const DAY = 86400, DAY_MS = 86400e3, AU = 149597870.7, TWO_PI = 2 * Math.PI;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / norm(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const Z = [0, 0, 1];

// ---------------- bodies ----------------

export const PLANET_KEYS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
// An atmosphere deep enough to land through (entry, then parachutes or
// aerobraking, at no propulsive cost here) or to stop a landing on a giant.
const ATMOSPHERE = new Set(['venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'titan']);
const MOON_A = 384400;                   // km, the Moon's mean distance (Curtis Table A.1)
const G_KM = 6.6743e-20;                 // km^3 / (kg s^2)
const SMALL = new Map();

// Small bodies from smallbodies.json's `named` list: { pdes, name, kind,
// a (au), e, i, node, peri, M (rad, ecliptic J2000, at epochJd), diameter
// (km) }. Their gravity is a guess: a sphere of the diameter (1 km if none)
// at 2,000 kg/m^3, tiny either way, so a capture is a rendezvous.
export function registerSmallBodies(named) {
  for (const b of named) if (b.e < 1 && b.a > 0) SMALL.set(`sb:${b.pdes}`, b);
}

export function bodyInfo(key) {
  if (key === 'sun') return { key, name: 'Sun', mu: MU_SUN, radius: PLANETS.sun.radius, parent: null };
  if (key === 'moon') {
    const c = bodyConstants('moon');
    return { key, name: 'Moon', mu: c.mu, radius: c.radius, parent: 'earth', a: MOON_A, atmosphere: false, kind: 'moon' };
  }
  // The planets' other major moons (moons.js, JPL's mean elements and
  // Horizons' GM and radius).
  const md = MOON_DATA[key];
  if (md) return { key, name: md.name, mu: md.gm, radius: md.radiusKm, parent: md.planet, a: md.a, atmosphere: ATMOSPHERE.has(key), kind: 'moon' };
  if (PLANET_KEYS.includes(key)) {
    const c = bodyConstants(key), p = PLANETS[key];
    return { key, name: p.name, mu: c.mu, radius: p.radius, parent: 'sun', a: p.semiMajorAxis * AU, atmosphere: ATMOSPHERE.has(key), kind: 'planet' };
  }
  const s = SMALL.get(key);
  if (!s) throw new Error(`journey: unknown body '${key}'`);
  const R = (s.diameter || 2) / 2;
  return { key, name: s.name, mu: G_KM * 2e12 * (4 / 3) * Math.PI * R ** 3, radius: R, parent: 'sun', a: s.a * AU, atmosphere: false, kind: 'small', elements: s };
}

// Every body a journey can visit.
export function journeyBodies() {
  return [
    ...PLANET_KEYS.map((key) => ({ key, name: PLANETS[key].name, group: 'Planets' })),
    { key: 'moon', name: 'Moon', group: 'Moons' },
    ...MOON_KEYS.filter((k) => PLANET_KEYS.includes(MOON_DATA[k].planet)).map((key) => ({ key, name: MOON_DATA[key].name, group: 'Moons' })),
    ...[...SMALL.entries()].map(([key, s]) => ({ key, name: s.name, group: 'Small bodies' })),
  ];
}

// The sphere of influence (Laplace), a (m / M)^(2/5) (Curtis 8.24, Example 8.3).
export function sphereOfInfluence(key) {
  const b = bodyInfo(key);
  if (!b.parent) return Infinity;
  return b.a * (b.mu / bodyInfo(b.parent).mu) ** 0.4;
}

// Heliocentric ecliptic state at a date. Small bodies by Kepler's equation
// from their SBDB elements (two-body about the Sun).
const K_GAUSS = 0.01720209895;          // rad/day, sqrt(GM_sun) in au^1.5/day
export function stateOf(key, ms) {
  if (key === 'sun') return { r: [0, 0, 0], v: [0, 0, 0] };
  if (key === 'moon' || PLANET_KEYS.includes(key)) return helioStateEcl(key, new Date(ms));
  if (MOON_DATA[key]) {
    // About its planet (the planet as the ephemeris gives it).
    const P = helioStateEcl(MOON_DATA[key].planet, new Date(ms)), m = moonStateEqj(key, new Date(ms));
    const r = eqjToEcl(m.r), v = eqjToEcl(m.v);
    return { r: [P.r[0] + r[0], P.r[1] + r[1], P.r[2] + r[2]], v: [P.v[0] + v[0], P.v[1] + v[1], P.v[2] + v[2]] };
  }
  const el = bodyInfo(key).elements, jd = 2451545.0 + ttSeconds(ms) / DAY;
  const n = K_GAUSS / el.a ** 1.5, M = el.M + n * (jd - el.epochJd), e = el.e;
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 50; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-13) break; }
  const s1 = Math.sqrt(1 - e * e), cE = Math.cos(E), sE = Math.sin(E), f = el.a * n / (1 - e * cE);
  const p = [el.a * (cE - e), el.a * s1 * sE], q = [-f * sE, f * s1 * cE];
  const cw = Math.cos(el.peri), sw = Math.sin(el.peri), cn = Math.cos(el.node), sn = Math.sin(el.node), ci = Math.cos(el.i), si = Math.sin(el.i);
  const rot = ([x, y]) => { const xp = cw * x - sw * y, yp = sw * x + cw * y; return [cn * xp - sn * ci * yp, sn * xp + cn * ci * yp, si * yp]; };
  return { r: scale(rot(p), AU), v: scale(rot(q), AU / DAY) };
}
// About a central body.
export function relState(key, central, ms) {
  const s = stateOf(key, ms);
  if (central === 'sun') return s;
  const c = stateOf(central, ms);
  return { r: sub(s.r, c.r), v: sub(s.v, c.v) };
}

// How a leg's two bodies relate: 'local' (the same body: an orbit change),
// 'fromCentral' (a planet to its own moon), 'toCentral', or 'between' (two
// bodies orbiting one central body; viaA / viaB: a moon whose planet stands
// in for it about the Sun). resonant: the same body at both ends with a
// flyby at either, so a return to it round the central body (Galileo's two
// years from Earth back to Earth), not an orbit change.
export function legGeometry(aKey, bKey, resonant = false) {
  const A = bodyInfo(aKey), B = bodyInfo(bKey);
  if (aKey === bKey && resonant) return { kind: 'between', central: A.parent, A, B, endA: aKey, endB: bKey, resonant: true };
  if (aKey === bKey) return { kind: 'local', central: aKey, A, B };
  if (A.parent === bKey) return { kind: 'toCentral', central: bKey, A, B };
  if (B.parent === aKey) return { kind: 'fromCentral', central: aKey, A, B };
  if (A.parent === B.parent) return { kind: 'between', central: A.parent, A, B, endA: aKey, endB: bKey };
  const top = (b) => (b.parent === 'sun' ? b.key : b.parent);
  return { kind: 'between', central: 'sun', A, B, endA: top(A), endB: top(B), viaA: A.parent !== 'sun', viaB: B.parent !== 'sun' };
}

// ---------------- the burns at each end ----------------

// From a stop onto an excess velocity vinf (km/s: a vector, or a speed)
// about its body.
//   orbit (and the start's parking orbit): from a circular orbit at altKm;
//   land: an ideal ascent to that orbit (its circular speed: no gravity or
//   drag losses), then the departure;
//   flyby: nothing here (the flyby joins the legs).
// via: the body is a moon and vinf is about its planet. With the moon's
// state about its planet on the day (via = { r, v }) and vinf a vector, the
// excess about the moon is three-level patched conics at the moon's real
// place (transfers.js moonExcess); with via = true (the ideal options, on
// mean circular orbits), its best phase: the speed needed at the moon's
// distance less the moon's own, as if the moon moved the way out.
function moonSpeed(vinf, B, via, arrive) {
  const P = bodyInfo(B.parent);
  if (via && typeof via === 'object' && Array.isArray(vinf)) return X.moonExcess({ rm: via.r, vm: via.v, vinf, mu: P.mu, arrive, rMin: 0.5 * norm(via.r) }).speed;
  const w = Array.isArray(vinf) ? norm(vinf) : vinf, vm = Math.sqrt(P.mu / B.a);
  return Math.abs(Math.sqrt(w * w + 2 * P.mu / B.a) - vm);
}
const speedOf = (vinf) => (Array.isArray(vinf) ? norm(vinf) : vinf);
function departCost(stop, vinf, B, via = null) {
  if (stop.kind === 'flyby') return 0;
  const v = via ? moonSpeed(vinf, B, via, false) : speedOf(vinf);
  const rp = B.radius + stop.altKm;
  return X.departureDv(v, B.mu, rp) + (stop.kind === 'land' ? X.circularSpeed(B.mu, rp) : 0);
}
// Arriving with excess velocity vinf: orbit, a circular capture at altKm;
// land, through the atmosphere if it has one (no burn), else captured into
// that orbit and down from it (its circular speed); flyby: nothing here.
// via: as departCost, the hyperbola about the planet coming in to the moon.
function arriveCost(stop, vinf, B, via = null) {
  if (stop.kind === 'flyby') return 0;
  if (stop.kind === 'land' && B.atmosphere) return 0;
  const v = via ? moonSpeed(vinf, B, via, true) : speedOf(vinf);
  const rp = B.radius + stop.altKm;
  return X.captureDv(v, B.mu, rp, 0) + (stop.kind === 'land' ? X.circularSpeed(B.mu, rp) : 0);
}
// A moon's state about its planet on the day, for a leg that leaves it or
// reaches it via the planet (null otherwise).
const moonAt = (isVia, key, ms) => (isVia ? relState(key, bodyInfo(key).parent, ms) : null);
// The excess velocity about the moon for the planet's vinf (vector), and the
// angle between the moon's velocity and the craft's about the planet there.
function moonEnd(m, vinf, key, arrive) {
  if (!m || !vinf) return null;
  const x = X.moonExcess({ rm: m.r, vm: m.v, vinf, mu: bodyInfo(bodyInfo(key).parent).mu, arrive, rMin: 0.5 * norm(m.r) });
  return { vinf: x.vinf, speed: x.speed, rp: x.rp, swingby: x.swingby, angleDeg: Math.acos(Math.max(-1, Math.min(1, dot(unit(x.vAbout), unit(m.v))))) * 180 / Math.PI, bestSpeed: moonSpeed(norm(vinf), bodyInfo(key), true, arrive) };
}

// ---------------- the parking orbit's plane over a stay ----------------

// A stay in a planet's orbit turns the orbit's plane: the planet's J2
// regresses its node (parkingPlane.js), so on the day the next leg leaves,
// the plane may no longer hold the way out, and the burn leaves out of it.
// The flight (journeyFlight.js) captures into the plane that holds the way
// in and the planned way out; for a stay of up to 30 days it aims the
// capture so that the turned plane holds the way out on the day (no extra
// here), and beyond that, where the plane goes round many times, the
// departure waits for the plane (up to 30 days) or burns out of it.
export const PLANE_AIMED_DAYS = 30;
const PLANE_WAIT_DAYS = 30;
// J2 is taken to rule where every other body's tide on the orbit is under
// 5 % of J2's pull.
const PLANE_TIDE_MAX = 0.05;
const clamp1 = (x) => Math.max(-1, Math.min(1, x));

// What the plane at stop k (the stop leg k leaves) is priced from: the
// capture's way in and plane, the planet's pole, the orbit, and the rate's
// correction (flownNodeRate over eq. (4.52)); { why } where it is not priced,
// null where there is nothing to price (no capture before the stay, or a
// leg that does not leave the planet itself for another body about the Sun).
function planeContext(S, legs, k) {
  const P = S[k], L = legs[k], inLeg = legs[k - 1];
  if (k === 0 || P.kind !== 'orbit' || !L?.ok || !inLeg?.ok || L.resonance || !(L.vinfDep || L.moonDep)) return null;
  if (!inLeg.vinfArr || inLeg.ringArr || inLeg.geometry === 'local' || inLeg.geometry === 'craft') return null;
  // The Moon: the flight aims the capture for a stay of up to 30 days by
  // flying the stay (journeyFlight.js stayTurned); beyond, J2 alone is not
  // the plane's motion there (PR #81: a week in a low lunar orbit turned it
  // 4 degrees the other way), so it is not priced.
  if (P.body === 'moon') return { why: 'about the Moon, the Earth\'s pull and the Moon\'s own field turn the plane, not J2 alone', moon: true };
  if (L.geometry !== 'between' || (L.endA && L.endA !== P.body) || !L.vinfDep) return null;
  const B = bodyInfo(P.body);
  const z = ZONAL[P.body];
  if (B.kind !== 'planet' || !z) return null;
  const rp = B.radius + P.altKm;
  // Where J2 rules: the tide of the Sun, of the Earth's Moon and of each
  // of the planet's moons beyond the orbit, mu_3 r / d^3, against J2's
  // pull, 3/2 mu J2 R^2 / r^4; a moon within the orbit by the J2 it adds,
  // (1/2)(mu_3/mu)(d/R)^2, against the planet's own.
  const j2Acc = 1.5 * B.mu * z.j2 * z.rJ2 ** 2 / rp ** 4;
  const others = [{ name: 'the Sun', mu: MU_SUN, d: norm(stateOf(P.body, P.arrMs).r) }];
  if (P.body === 'earth') others.push({ name: 'the Moon', mu: bodyConstants('moon').mu, d: MOON_A });
  for (const m of MOON_KEYS) if (MOON_DATA[m]?.planet === P.body) others.push({ name: MOON_DATA[m].name, mu: MOON_DATA[m].gm, d: MOON_DATA[m].a });
  for (const q of others) {
    const share = rp < q.d ? (q.mu * rp) / q.d ** 3 / j2Acc : (0.5 * (q.mu / B.mu) * (q.d / z.rJ2) ** 2) / z.j2;
    if (share > PLANE_TIDE_MAX) return { why: `${Math.round(P.altKm).toLocaleString('en-AU')} km over ${B.name}, ${q.name}'s pull turns the plane as well as J2` };
  }
  const vin = inLeg.vinfArr, w = L.vinfDep, h = cross(vin, w);
  if (norm(h) < 1e-9 * norm(vin) * norm(w)) return null;
  // The capture as the flight flies it: the hyperbola from the way in, in
  // the plane holding the way out, into the circular orbit at its periapsis.
  const n0 = unit(h), uin = unit(vin), uout = X.rotate(uin, n0, X.turnAngle(rp, norm(vin), B.mu));
  const d = unit(sub(uin, uout));
  const pole = unit(eqjToEcl(bodyAxesEqj(P.body, new Date(P.arrMs))[2]));
  const flown = flownNodeRate({ mu: B.mu, j2: z.j2, j4: z.j4 ?? 0, R: z.rJ2, pole, r: scale(d, rp), v: scale(unit(cross(n0, d)), Math.sqrt(B.mu / rp)) });
  return { body: P.body, B, z, rp, vin, pole, arrMs: P.arrMs, n0, factor: flown ? flown.ratio : 1 };
}

// The plane on the day ms for a departure along w (about the planet): for a
// stay of up to 30 days, aimed (the capture is aimed for it); beyond, the
// capture's plane (n0, or the one holding the way in and w) turned by its
// node's rate over the stay, and the cheapest burn from it onto w
// (parkingPlane.js leaveCircularDv). Returns { aimed, stayDays, i, rate,
// angle, dv, extra } (rad, rad/s, km/s), extra over the burn in the plane.
function planeAt(ctx, ms, w, n0 = null) {
  const stayDays = (ms - ctx.arrMs) / DAY_MS, inPlane = X.departureDv(norm(w), ctx.B.mu, ctx.rp);
  const h = n0 ?? cross(ctx.vin, w);
  if (!(norm(h) > 0)) return null;
  const n = unit(h), i = Math.acos(clamp1(dot(n, ctx.pole)));
  const rate = ctx.factor * nodeRate(ctx.B.mu, ctx.z.j2, ctx.z.rJ2, ctx.rp, 0, i);
  if (stayDays <= PLANE_AIMED_DAYS) return { aimed: true, stayDays, i, rate, angle: 0, dv: inPlane, extra: 0 };
  const n1 = turnPlane(n, ctx.pole, (rate * (ms - ctx.arrMs)) / 1000);
  const extra = Math.max(0, leaveCircularDv(n1, ctx.rp, ctx.B.mu, w).dv - inPlane);
  return { aimed: false, stayDays, i, rate, angle: planeAngle(n1, w), dv: inPlane + extra, extra };
}

const RAD = 180 / Math.PI;
const planeSummary = (ctx, p) => ({
  priced: true, body: ctx.body, aimed: p.aimed, stayDays: p.stayDays, iDeg: p.i * RAD, rateDegDay: p.rate * DAY * RAD,
  firstOrderDegDay: nodeRate(ctx.B.mu, ctx.z.j2, ctx.z.rJ2, ctx.rp, 0, p.i) * DAY * RAD,
  angleDeg: p.angle * RAD, inPlaneDv: p.dv - p.extra, dv: p.dv, extraDv: p.extra,
});

// For leg k of a solved journey, the extra its departure pays for the
// parking orbit's plane, as a function of a solved leg (another date or
// flight time for it, its arrival kept), or null where the plane is not
// priced. Used by the window strip and the porkchop search.
export function planePricer(sol, k) {
  const ctx = planeContext(sol.stops, sol.legs, k);
  if (!ctx || ctx.why) return null;
  return (L) => (L?.ok && L.vinfDep ? planeAt(ctx, L.depMs, L.vinfDep)?.extra ?? 0 : 0);
}

// Leaving a planet's orbit after a stay of more than 30 days, the day near
// the planned one (up to 30 days either side, in half days, the arrival
// kept) when the leg costs least with the plane as the stay would turn it
// (a later departure is a longer stay, and the capture holds that day's way
// out); and what the flight does as planned: from the capture's plane,
// waiting (in half days, up to 30) while a day costs 2 % less than the best
// before it, as journeyFlight.js does. Returns the option (type 'plane'),
// or null where the plane is not priced or the capture is aimed for it.
export function planeOption(journey, k, { sol = null } = {}) {
  sol ??= solveJourney(journey);
  const S = sol.stops, L = sol.legs[k], P = S[k], Q = S[k + 1];
  if (!L?.plane?.priced || L.plane.aimed) return null;
  const ctx = planeContext(S, sol.legs, k);
  if (!ctx || ctx.why) return null;
  const legAt = (ms) => solveLeg(P, Q, ms, Q.arrMs);
  // As planned: the flight's wait.
  let flight = { ms: L.depMs, waitDays: 0, dv: L.plane.dv, angleDeg: L.plane.angleDeg };
  for (let h = 0.5; h <= PLANE_WAIT_DAYS; h += 0.5) {
    const ms = L.depMs + h * DAY_MS, Lh = legAt(ms);
    if (!Lh.ok) continue;
    const p = planeAt(ctx, ms, Lh.vinfDep, ctx.n0);
    if (p && p.dv < flight.dv * 0.98) flight = { ms, waitDays: h, dv: p.dv, angleDeg: p.angle * RAD };
  }
  // Re-timed: the best day either side.
  let best = null;
  const lo = Math.max(-PLANE_WAIT_DAYS, -Math.floor(((L.depMs - P.arrMs) / DAY_MS) * 2) / 2);
  for (let d = lo; d <= PLANE_WAIT_DAYS; d += 0.5) {
    const ms = L.depMs + d * DAY_MS, Ld = d === 0 ? null : legAt(ms);
    if (Ld && !Ld.ok) continue;
    const p = d === 0 ? { dv: L.plane.dv, angle: L.plane.angleDeg / RAD, aimed: false } : planeAt(ctx, ms, Ld.vinfDep);
    if (!p) continue;
    const dv = d === 0 ? L.depDv + L.arrDv + L.midDv : Ld.depDv + p.extra + Ld.arrDv + Ld.midDv;
    if (!best || dv < best.dv - 1e-9) best = { d, ms, dv, depDv: d === 0 ? L.depDv : Ld.depDv + p.extra, angleDeg: p.angle * RAD, aimed: p.aimed };
  }
  if (!best) return null;
  const name = bodyInfo(P.body).name;
  return {
    type: 'plane', name: `The orbit's plane at ${name}`, dv: best.dv, depDv: best.depDv, tofDays: (Q.arrMs - best.ms) / DAY_MS, depMs: best.ms, arrMs: Q.arrMs,
    waitDays: best.d, angleDeg: best.angleDeg, aimed: best.aimed, flight,
    note: `leave ${best.d === 0 ? 'as planned' : best.d > 0 ? `${best.d} d later` : `${-best.d} d earlier`}: the plane ${best.aimed ? 'aimed for it at the capture' : `${best.angleDeg.toFixed(1)}° off the way out`} (on the planned day ${L.plane.angleDeg.toFixed(1)}°)`,
  };
}

// ---------------- one leg ----------------

// The cheapest Lambert arc between two states (ecliptic, about mu) over
// tof seconds, from 0 to maxRevs revolutions, by cost(v1, v2).
function bestArc(r1, r2, tof, mu, cost, maxRevs = 0, pick = null) {
  let best = null;
  for (let revs = 0; revs <= maxRevs; revs++) {
    for (const s of lambertRevs(r1, r2, tof, mu, revs, true)) {
      if (pick && (pick.revs !== revs || (pick.branch && s.branch !== pick.branch))) continue;
      const c = cost(s.v1, s.v2);
      if (Number.isFinite(c) && (!best || c < best.cost)) best = { v1: s.v1, v2: s.v2, revs, branch: s.branch, cost: c };
    }
  }
  return best;
}

// A point on a circular orbit of radius rc about the central body, in the
// plane of the moon's orbit (normal n), at angle phi from direction u1.
const ringPoint = (rc, u1, u2, phi) => add(scale(u1, rc * Math.cos(phi)), scale(u2, rc * Math.sin(phi)));
// The angle of that point that costs least (36 trial angles, then golden
// section about the best).
function bestRing(f) {
  let bi = 0, bv = Infinity;
  for (let k = 0; k < 36; k++) { const v = f(k * TWO_PI / 36).cost; if (v < bv) { bv = v; bi = k; } }
  let a = (bi - 1) * TWO_PI / 36, b = (bi + 1) * TWO_PI / 36;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 40; k++) { const c = b - g * (b - a), d = a + g * (b - a); if (f(c).cost < f(d).cost) b = d; else a = c; }
  return f((a + b) / 2);
}

// Solve leg from stop P (departing at depMs) to stop Q (arriving arrMs).
// Returns { geometry, central, depMs, arrMs, arcs: [{ r1, v1, t1, t2, mu }],
// vinfDep, vinfArr (vectors about the end bodies, or null at a central
// end), depDv, arrDv, midDv, ok }.
const isResonant = (P, Q) => P.body === Q.body && (P.kind === 'flyby' || Q.kind === 'flyby');
// vinfIn: the excess speed arriving at P when P is a flyby; arcs whose
// departure excess speed differs from it cost that much more (the powered
// flyby's burn, roughly), so a chain of flybys picks matching arcs.
export function solveLeg(P, Q, depMs, arrMs, { via = 'lambert', revs, branch, maxRevs = 0, vinfIn = null, resonance = null, resonantPhi = 0 } = {}) {
  const g = legGeometry(P.body, Q.body, isResonant(P, Q)), C = bodyInfo(g.central), mu = C.mu;
  const tof = (arrMs - depMs) / 1000;
  const out = { geometry: g.kind, central: g.central, from: P.body, to: Q.body, depMs, arrMs, tofDays: tof / DAY, arcs: [], vinfDep: null, vinfArr: null, depDv: 0, arrDv: 0, midDv: 0, ok: false };
  if (g.kind === 'local') return solveLocal(P, Q, depMs, g, via, out);
  if (!(tof > 0)) return { ...out, error: 'arrives before it leaves' };
  const pick = revs !== undefined && revs !== null ? { revs, branch } : null;

  if (g.resonant) return solveResonantLeg(P, Q, depMs, arrMs, g, out, { resonance, vinf: vinfIn, phi: resonantPhi });
  if (g.kind === 'between') {
    const a = relState(g.endA, g.central, depMs), b = relState(g.endB, g.central, arrMs);
    const mA = moonAt(g.viaA, P.body, depMs), mB = moonAt(g.viaB, Q.body, arrMs);
    const cost = (v1, v2) => departCost(P, sub(v1, a.v), g.A, mA) + arriveCost(Q, sub(v2, b.v), g.B, mB) + (P.kind === 'flyby' ? (vinfIn !== null ? Math.abs(norm(sub(v1, a.v)) - vinfIn) : norm(sub(v1, a.v)) * 1e-3) : 0) + (Q.kind === 'flyby' ? norm(sub(v2, b.v)) * 1e-3 : 0);
    if (via === 'bielliptic') return solveBiEllipticLeg(P, Q, depMs, arrMs, g, a, b, out, mA, mB);
    const s = bestArc(a.r, b.r, tof, mu, cost, pick ? pick.revs : g.resonant ? Math.max(2, maxRevs) : maxRevs, pick);
    // Near 180 degrees round the central body the direct arc's plane is
    // ill-defined: a broken plane, where it costs less (or there is no
    // direct arc at all).
    const angle = transferAngle(a.r, b.r);
    out.transferDeg = angle * 180 / Math.PI;
    if (via !== 'direct' && (!pick || pick.revs === 0) && Math.abs(angle - Math.PI) < BROKEN_BAND) {
      const bp = brokenPlane(a, b, depMs, arrMs, mu, cost);
      if (bp && (!s || via === 'brokenplane' || bp.cost < s.cost || Math.abs(angle - Math.PI) < BROKEN_ALWAYS)) {
        out.arcs.push({ r1: a.r, v1: bp.v1, t1: depMs, t2: bp.ms, mu }, { r1: bp.r, v1: bp.v1b, t1: bp.ms, t2: arrMs, mu });
        out.vinfDep = sub(bp.v1, a.v); out.vinfArr = sub(bp.v2, b.v);
        out.depDv = departCost(P, out.vinfDep, g.A, mA);
        out.arrDv = arriveCost(Q, out.vinfArr, g.B, mB);
        out.midDv = bp.midDv;
        out.mid = { ms: bp.ms, r: bp.r };
        out.moonDep = P.kind === 'flyby' ? null : moonEnd(mA, out.vinfDep, P.body, false);
        out.moonArr = Q.kind === 'flyby' ? null : moonEnd(mB, out.vinfArr, Q.body, true);
        out.brokenPlane = { ms: bp.ms, r: bp.r, dv: bp.midDv, turnDeg: bp.turnDeg, angleDeg: angle * 180 / Math.PI, directDv: s ? s.cost : Infinity, directIncDeg: s ? arcTilt(a, s.v1) : null };
        return { ...out, revs: 0, branch: 'single', ok: true, endA: g.endA, endB: g.endB };
      }
    }
    if (!s) return { ...out, error: 'no Lambert arc between these dates' };
    out.arcs.push({ r1: a.r, v1: s.v1, t1: depMs, t2: arrMs, mu });
    out.vinfDep = sub(s.v1, a.v); out.vinfArr = sub(s.v2, b.v);
    out.depDv = departCost(P, out.vinfDep, g.A, mA);
    out.arrDv = arriveCost(Q, out.vinfArr, g.B, mB);
    // Leaving (or reaching) a moon via its planet: the excess velocity about
    // the moon, where the moon is on the day.
    out.moonDep = P.kind === 'flyby' ? null : moonEnd(mA, out.vinfDep, P.body, false);
    out.moonArr = Q.kind === 'flyby' ? null : moonEnd(mB, out.vinfArr, Q.body, true);
    return { ...out, revs: s.revs, branch: s.branch, ok: true, endA: g.endA, endB: g.endB };
  }

  // A planet and its own moon: the free end is a point on the parking orbit
  // at the planet, in the plane of the moon's orbit, put where it costs least.
  const moonKey = g.kind === 'fromCentral' ? Q.body : P.body, centralStop = g.kind === 'fromCentral' ? P : Q;
  const mT = relState(moonKey, g.central, g.kind === 'fromCentral' ? arrMs : depMs);
  const n = unit(cross(mT.r, mT.v)), u1 = unit(mT.r), u2 = cross(n, u1), rc = C.radius + centralStop.altKm;
  const vcirc = (r) => scale(unit(cross(n, r)), Math.sqrt(mu / norm(r)));
  const M = bodyInfo(moonKey);
  const f = (phi) => {
    const rRing = ringPoint(rc, u1, u2, phi);
    const r1 = g.kind === 'fromCentral' ? rRing : mT.r, r2 = g.kind === 'fromCentral' ? mT.r : rRing;
    const cost = (v1, v2) => (g.kind === 'fromCentral'
      ? norm(sub(v1, vcirc(r1))) + arriveCost(Q, norm(sub(v2, mT.v)), M)
      : departCost(P, norm(sub(v1, mT.v)), M) + (Q.kind === 'land' && C.atmosphere ? 0 : norm(sub(vcirc(r2), v2))));
    const s = bestArc(r1, r2, tof, mu, cost, 0);
    return s ? { ...s, r1, r2, cost: s.cost } : { cost: Infinity };
  };
  const s = bestRing(f);
  if (!Number.isFinite(s.cost)) return { ...out, error: 'no Lambert arc between these dates' };
  out.arcs.push({ r1: s.r1, v1: s.v1, t1: depMs, t2: arrMs, mu });
  if (g.kind === 'fromCentral') {
    out.depDv = norm(sub(s.v1, vcirc(s.r1)));
    out.vinfArr = sub(s.v2, mT.v); out.arrDv = arriveCost(Q, norm(out.vinfArr), M);
    out.ringDep = s.r1;
  } else {
    out.vinfDep = sub(s.v1, mT.v); out.depDv = departCost(P, norm(out.vinfDep), M);
    out.arrDv = Q.kind === 'land' && C.atmosphere ? 0 : norm(sub(vcirc(s.r2), s.v2));
    out.ringArr = s.r2;
  }
  return { ...out, ok: true, revs: 0 };
}

// ---------------- the broken plane ----------------

// The prograde angle from r1 to r2 about +z (0 to 2 pi), as Lambert's
// solver takes it (Curtis Algorithm 5.2, step 2).
function transferAngle(r1, r2) {
  const t = Math.acos(Math.max(-1, Math.min(1, dot(r1, r2) / (norm(r1) * norm(r2)))));
  return cross(r1, r2)[2] >= 0 ? t : TWO_PI - t;
}
// The angle between an arc's plane and the departure body's orbit plane.
const arcTilt = (a, v1) => Math.acos(Math.max(-1, Math.min(1, dot(unit(cross(a.r, a.v)), unit(cross(a.r, v1)))))) * 180 / Math.PI;

// Within 15 degrees of 180 a leg also tries the broken plane, and takes it
// where it costs less. Within 6 it takes it even where the direct arc is a
// little cheaper on paper: there the direct arc's plane turns with every
// kilometre the craft is off it, and the flight's aims, re-solved from where
// the craft is, pay hundreds of metres a second to follow it (a 2.3 degree
// tilt at 183.4 degrees flies with 679 m/s of corrections, the broken plane
// with 61 m/s of them planned; journey.test.mjs).
export const BROKEN_BAND = 15 * Math.PI / 180, BROKEN_ALWAYS = 6 * Math.PI / 180;

// A broken-plane transfer: the transfer the leg would be if the target
// lay in the departure body's orbit plane (Lambert's arc there to the
// target's place turned into that plane, at its own distance: in a plane
// fixed beforehand, 180 degrees is no trouble), flown to a point B, where
// a burn turns the craft onto Lambert's arc from B to the real target.
// Where B is (when it is reached along the first arc) is chosen where the
// whole leg costs least: a fraction of the flight time from 0.1 to 0.9,
// in steps of 0.1, then golden section about the best. The burn at B is
// mostly the plane's turn, about the line to B; 90 degrees short of the
// target it is the target's height above the plane. cost(v1, v2): the end
// burns, as for the direct arc. Returns { v1, v2, v1b (leaving B), r, ms,
// midDv, turnDeg (the plane's turn at B), cost } or null.
function brokenPlane(a, b, depMs, arrMs, mu, cost) {
  const tof = (arrMs - depMs) / 1000;
  const n = unit(cross(a.r, a.v));
  if (n[2] <= 0) return null;                   // (Lambert's arcs are prograde about +z)
  const inPlane = scale(unit(sub(b.r, scale(n, dot(b.r, n)))), norm(b.r));
  const s0 = lambert(a.r, inPlane, tof, mu, true);
  if (!s0) return null;
  const at = (tau) => {
    const tB = tau * tof, B = propagate(a.r, s0.v1, tB, mu), s2 = B && lambert(B.r, b.r, tof - tB, mu, true);
    if (!s2) return null;
    const midDv = norm(sub(s2.v1, B.v)), c = cost(s0.v1, s2.v2) + midDv;
    return Number.isFinite(c) ? { v1: s0.v1, v2: s2.v2, v1b: s2.v1, v2a: B.v, r: B.r, ms: depMs + tB * 1000, midDv, cost: c } : null;
  };
  const f = (tau) => at(tau)?.cost ?? Infinity;
  let bi = -1, bv = Infinity;
  for (let i = 1; i <= 9; i++) { const v = f(i * 0.1); if (v < bv) { bv = v; bi = i; } }
  if (bi < 0) return null;
  let lo = Math.max(0.02, (bi - 1) * 0.1), hi = Math.min(0.98, (bi + 1) * 0.1);
  const g = (Math.sqrt(5) - 1) / 2;
  let c = hi - g * (hi - lo), d = lo + g * (hi - lo), fc = f(c), fd = f(d);
  for (let k = 0; k < 24; k++) {
    if (fc < fd) { hi = d; d = c; fd = fc; c = hi - g * (hi - lo); fc = f(c); } else { lo = c; c = d; fc = fd; d = lo + g * (hi - lo); fd = f(d); }
  }
  const s = at((lo + hi) / 2);
  if (!s) return null;
  const turn = Math.acos(Math.max(-1, Math.min(1, dot(unit(cross(s.r, s.v2a)), unit(cross(s.r, s.v1b))))));
  return { ...s, tau: (lo + hi) / 2, turnDeg: turn * 180 / Math.PI };
}

// The ratios a resonant return can take: N of the body's periods for M of
// the craft's, N and M up to 6, the craft's period from a third to six
// times the body's.
const RESONANCES = [];
for (let N = 1; N <= 6; N++) for (let M = 1; M <= 6; M++) if (N / M >= 1 / 3 && N / M <= 6 && gcd(N, M) === 1) RESONANCES.push([N, M]);
function gcd(a, b) { return b ? gcd(b, a % b) : a; }

// The body's own period about the central body, from its osculating orbit
// at the date (so the craft and the body both come round in it).
function bodyPeriod(key, central, ms) {
  const s = relState(key, central, ms), mu = bodyInfo(central).mu;
  const a = 1 / (2 / norm(s.r) - dot(s.v, s.v) / mu);
  return 2 * Math.PI * Math.sqrt(a ** 3 / mu);
}

// When a body comes back nearest where it was at depMs, within 20 days of
// days later (golden section on the distance).
function bodyReturn(key, central, depMs, days) {
  const r0 = relState(key, central, depMs).r, d = (t) => norm(sub(relState(key, central, t).r, r0));
  let lo = depMs + (days - 20) * DAY_MS, hi = depMs + (days + 20) * DAY_MS;
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60; i++) { const c = hi - g * (hi - lo), e = lo + g * (hi - lo); if (d(c) < d(e)) hi = e; else lo = c; }
  return Math.round((lo + hi) / 2);
}

// The resonant returns open to an excess speed vinf (null: any) at a body,
// with their flight times: [{ N, M, tofDays, theta }].
export function resonances(key, depMs, vinf = null) {
  const B = bodyInfo(key), central = B.parent, s = relState(key, central, depMs), TB = bodyPeriod(key, central, depMs), mu = bodyInfo(central).mu;
  return RESONANCES.map(([N, M]) => {
    const c = X.resonantCone({ r: norm(s.r), vB: s.v, mu, vinf: vinf ?? 1, N, M, TB });
    return { N, M, tofDays: c.tof / DAY, theta: c.theta, feasible: vinf === null || c.feasible };
  }).filter((x) => x.feasible).sort((a, b) => a.tofDays - b.tofDays);
}

// A return to the same body on a resonant orbit (the leg's two ends the
// same body, with a flyby at either). Its excess velocity lies on the
// cone for the ratio N:M (transfers.js resonantCone) at clock angle phi,
// chosen when the journey is solved so the flybys either side cost least;
// the arrival is the body's N periods later, and later waypoints keep
// their spacing. The ratio is the waypoint's `resonance` [N, M], or the
// one whose flight time is nearest the waypoint's date. vinf: the excess
// speed it leaves with (the flyby's; without one, a guess for now).
function solveResonantLeg(P, Q, depMs, arrMs, g, out, { resonance = null, vinf = null, phi = 0 }) {
  const C = bodyInfo(g.central), mu = C.mu, a = relState(P.body, g.central, depMs);
  const v = vinf ?? 5;
  const open = resonances(P.body, depMs, v);
  const pick0 = resonance ? open.find((x) => x.N === resonance[0] && x.M === resonance[1]) : open.reduce((best, x) => (!best || Math.abs(x.tofDays * DAY_MS - (arrMs - depMs)) < Math.abs(best.tofDays * DAY_MS - (arrMs - depMs)) ? x : best), null);
  if (!pick0) return { ...out, error: resonance ? `no ${resonance[0]}:${resonance[1]} resonant orbit at ${v.toFixed(2)} km/s` : `no resonant return at ${v.toFixed(2)} km/s` };
  // The body's real return: its osculating period on the day is off by up
  // to a day in two years (the Moon swings the Earth), so the leg ends when
  // the body comes back nearest where it was, within 20 days of N periods,
  // and the craft's period is set from that (N T / M).
  const ret = bodyReturn(P.body, g.central, depMs, pick0.tofDays);
  const TB = (ret - depMs) / 1000 / pick0.N;
  const cone = X.resonantCone({ r: norm(a.r), vB: a.v, mu, vinf: v, N: pick0.N, M: pick0.M, TB });
  if (!cone.feasible) return { ...out, error: `no ${pick0.N}:${pick0.M} resonant orbit at ${v.toFixed(2)} km/s` };
  const pick = { ...pick0, theta: cone.theta, tofDays: (ret - depMs) / DAY_MS };
  const vinfDep = X.resonantVinf({ rB: a.r, vB: a.v, vinf: v, theta: pick.theta, phi });
  const t2 = ret, v1 = add(a.v, vinfDep);
  const end = propagate(a.r, v1, pick.tofDays * DAY, mu), b = relState(Q.body, g.central, t2);
  if (!end) return { ...out, error: 'the resonant orbit could not be flown' };
  out.arcs.push({ r1: a.r, v1, t1: depMs, t2, mu });
  out.vinfDep = vinfDep; out.vinfArr = sub(end.v, b.v);
  out.depDv = departCost(P, v, g.A); out.arrDv = arriveCost(Q, norm(out.vinfArr), g.B);
  return { ...out, arrMs: t2, tofDays: pick.tofDays, ok: true, revs: pick.M - 1, endA: P.body, endB: Q.body, resonance: { N: pick.N, M: pick.M, theta: pick.theta, phi, vinf: v, missKm: norm(sub(end.r, b.r)) } };
}

// A bi-elliptic leg between two bodies about the Sun (or a planet): out to
// a far apoapsis opposite the departure, a burn there, then on to the
// target: two Lambert arcs, the second ending at the target's position.
function solveBiEllipticLeg(P, Q, depMs, arrMs, g, a, b, out, mA = null, mB = null) {
  const C = bodyInfo(g.central), mu = C.mu, rA = norm(a.r), rC = norm(b.r);
  const rB = biEllipticApoapsis(g.central, rA, rC);
  const T1 = Math.PI * Math.sqrt(((rA + rB) / 2) ** 3 / mu), tMid = depMs + T1 * 1000;
  if (!(tMid < arrMs)) return { ...out, error: 'too short for a bi-elliptic transfer' };
  const n = unit(cross(a.r, a.v)), apo = scale(unit(a.r), -rB);
  // The apoapsis point a little off opposite (an arc of exactly 180 degrees
  // has no plane), in the departure body's orbit plane.
  const apoPt = add(scale(apo, Math.cos(0.01)), scale(cross(n, unit(apo)), rB * Math.sin(0.01)));
  const s1 = bestArc(a.r, apoPt, T1, mu, (v1) => norm(sub(v1, a.v)), 0);
  const s2 = s1 && bestArc(apoPt, b.r, (arrMs - tMid) / 1000, mu, (v1, v2) => norm(sub(v1, s1.v2)) + norm(sub(v2, b.v)), 1);
  if (!s1 || !s2) return { ...out, error: 'no bi-elliptic arcs between these dates' };
  out.arcs.push({ r1: a.r, v1: s1.v1, t1: depMs, t2: tMid, mu }, { r1: apoPt, v1: s2.v1, t1: tMid, t2: arrMs, mu });
  out.vinfDep = sub(s1.v1, a.v); out.vinfArr = sub(s2.v2, b.v);
  out.depDv = departCost(P, out.vinfDep, g.A, mA);
  out.arrDv = arriveCost(Q, out.vinfArr, g.B, mB);
  out.midDv = norm(sub(s2.v1, s1.v2));
  out.mid = { ms: tMid, r: apoPt };
  return { ...out, ok: true, revs: 0, endA: g.endA, endB: g.endB };
}

// The far apoapsis a bi-elliptic transfer uses: half the central body's
// sphere of influence for orbits about a planet; about the Sun, three
// times the outer orbit.
function biEllipticApoapsis(central, r1, r2) {
  return central === 'sun' ? 3 * Math.max(r1, r2) : 0.5 * sphereOfInfluence(central);
}

// An orbit change about one body: Hohmann (or bi-elliptic, or phasing)
// between circular orbits at the two stops' altitudes; the arrival is the
// transfer's own time.
function solveLocal(P, Q, depMs, g, via, out) {
  const B = g.A, mu = B.mu, r1 = B.radius + P.altKm, r2 = B.radius + Q.altKm;
  const o = localOption(via, mu, r1, r2, Q, B);
  const u = [1, 0, 0], w = [0, 1, 0];
  const arcs = [];
  let t = depMs;
  // Draw the transfer ellipses in the body's ecliptic plane from +x.
  const halves = via === 'bielliptic' ? [[r1, o.rB], [o.rB, r2]] : via === 'phasing' ? [] : [[r1, r2]];
  let dir = 1;
  for (const [ra, rb] of halves) {
    const a = (ra + rb) / 2, v = X.visViva(mu, ra, a), T = Math.PI * Math.sqrt(a ** 3 / mu);
    arcs.push({ r1: scale(u, ra * dir), v1: scale(w, v * dir), t1: t, t2: t + T * 1000, mu });
    t += T * 1000; dir = -dir;
  }
  if (via === 'phasing') arcs.push({ r1: scale(u, r1), v1: scale(w, X.visViva(mu, r1, o.a2)), t1: t, t2: t + o.tof * 1000, mu });
  return { ...out, arcs, arrMs: depMs + o.tof * 1000, tofDays: o.tof / DAY, depDv: o.dv1, arrDv: o.dvLast, midDv: o.dvMid ?? 0, ok: o.ok, error: o.ok ? undefined : o.error, local: o };
}
function localOption(via, mu, r1, r2, Q, B) {
  if (via === 'bielliptic') {
    const rB = Math.max(biEllipticApoapsis(B.key, r1, r2), 1.01 * Math.max(r1, r2));
    const b = X.biElliptic(mu, r1, rB, r2);
    return { dv1: b.dv1, dvMid: b.dv2, dvLast: b.dv3, tof: b.tof, rB, ok: true };
  }
  if (via === 'phasing') {
    const T1 = X.orbitPeriod(mu, r1), p = X.phasing({ mu, rp: r1, ra: r1, lead: ((Q.leadDeg ?? 0) / 360) * T1, revs: Q.revs || 1, rMin: B.radius });
    if (!p) return { dv1: 0, dvLast: 0, tof: 0, ok: false, error: 'no phasing orbit' };
    return { dv1: p.dv1, dvLast: p.dv2, tof: p.tof, a2: p.a2, ok: p.feasible, error: p.feasible ? undefined : 'the phasing orbit dips into the body' };
  }
  const di = ((Q.incDeg ?? 0) - (Q.prevIncDeg ?? Q.incDeg ?? 0)) * Math.PI / 180;
  if (via === 'planechange' && di) {
    const h = X.hohmannPlaneChange(mu, r1, r2, Math.abs(di));
    return { dv1: h.dv1, dvLast: h.dv2, tof: h.tof, split: h.split, ok: true };
  }
  const h = X.hohmannCircular(mu, r1, r2);
  return { dv1: h.dv1, dvLast: h.dv2, tof: h.tof, ok: true };
}

// ---------------- the journey ----------------

const stops = (j) => {
  const s0 = { body: j.start.body, kind: j.start.kind === 'craft' ? 'craft' : 'orbit', altKm: j.start.altKm ?? 200, arrMs: j.start.dateMs, depMs: j.start.dateMs, incDeg: j.start.incDeg ?? 0, state: j.start.state };
  const out = [s0];
  for (const w of j.waypoints) {
    const prev = out[out.length - 1];
    out.push({ ...w, arrMs: w.dateMs, depMs: w.dateMs + (w.kind === 'flyby' ? 0 : (w.stayDays ?? 0) * DAY_MS), prevIncDeg: prev.incDeg ?? 0 });
  }
  return out;
};

// Solve every leg at the waypoints' dates and join them: a flyby between
// two legs is the powered flyby that turns one leg's arrival excess
// velocity into the next one's departure (unpowered if they match).
// Local legs (an orbit change) set their own arrival; later dates keep
// their spacing from it.
export function solveJourney(journey, { maxRevs = 0 } = {}) {
  const S = stops(journey);
  const legs = [], burns = [], flybys = [];
  let shift = 0;
  for (let k = 1; k < S.length; k++) {
    const P = S[k - 1], Q = S[k];
    Q.arrMs += shift; Q.depMs += shift;
    const w = journey.waypoints[k - 1];
    let leg;
    if (P.kind === 'craft' && k === 1) leg = solveCraftLeg(P, Q, P.depMs, Q.arrMs, w);
    else {
      const prev = legs[k - 2], vinfIn = P.kind === 'flyby' && prev?.ok && prev.vinfArr ? norm(prev.vinfArr) : null;
      leg = solveLeg(P, Q, P.depMs, Q.arrMs, { via: w.via ?? 'lambert', revs: w.revs, branch: w.branch, maxRevs, vinfIn, resonance: w.resonance ?? null });
    }
    if ((leg.geometry === 'local' || leg.resonance) && leg.ok) {
      const d = leg.arrMs - Q.arrMs;
      Q.arrMs += d; Q.depMs += d; shift += d;
    }
    leg.index = k - 1;
    legs.push(leg);
  }
  // Resonant returns: the clock angle that makes the flybys either side
  // cheapest, with the excess speed of the flyby it leaves (or, leaving an
  // orbit, of the flyby it returns to).
  for (let k = 1; k < S.length; k++) {
    const leg = legs[k - 1];
    if (!leg.ok || !leg.resonance) continue;
    const P = S[k - 1], Q = S[k], w = journey.waypoints[k - 1];
    const vinIn = P.kind === 'flyby' && legs[k - 2]?.ok ? legs[k - 2].vinfArr : null;
    const vOut = Q.kind === 'flyby' && legs[k]?.ok ? legs[k].vinfDep : null;
    const mag = vinIn ? norm(vinIn) : vOut ? norm(vOut) : leg.resonance.vinf;
    const B = bodyInfo(P.body), rpMin = B.radius + ((P.kind === 'flyby' ? P.altKm : Q.altKm) ?? 300);
    const at = (phi) => solveLeg(P, Q, P.depMs, Q.arrMs, { resonance: [leg.resonance.N, leg.resonance.M], vinfIn: mag, resonantPhi: phi });
    const cost = (L) => !L.ok ? Infinity
      : (vinIn ? X.poweredFlyby({ vinfIn: vinIn, vinfOut: L.vinfDep, mu: B.mu, rpMin: B.radius + (P.altKm ?? 300) }).dv : L.depDv)
        + (vOut ? X.poweredFlyby({ vinfIn: L.vinfArr, vinfOut: vOut, mu: B.mu, rpMin: B.radius + (Q.altKm ?? 300) }).dv : L.arrDv);
    let bi = 0, bv = Infinity;
    for (let i = 0; i < 72; i++) { const c = cost(at((2 * Math.PI * i) / 72)); if (c < bv) { bv = c; bi = i; } }
    let lo = (2 * Math.PI * (bi - 1)) / 72, hi = (2 * Math.PI * (bi + 1)) / 72;
    const gr = (Math.sqrt(5) - 1) / 2;
    for (let i = 0; i < 40; i++) { const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo); if (cost(at(c)) < cost(at(d))) hi = d; else lo = c; }
    const L = at(w.resonantPhi ?? (lo + hi) / 2);
    if (L.ok) legs[k - 1] = { ...L, index: k - 1 };
    void rpMin;
  }
  // Shaped legs: burn nodes along a leg, or a flyby aimed by hand before
  // it, fly it free from there (shapeLeg).
  const aimed = [];
  for (let k = 1; k < S.length; k++) {
    const leg = legs[k - 1], w = journey.waypoints[k - 1], P = S[k - 1];
    const pw = k > 1 ? journey.waypoints[k - 2] : null;
    const from = P.kind === 'flyby' && pw?.aim && legs[k - 2]?.ok && legs[k - 2].vinfArr ? { vinfIn: legs[k - 2].vinfArr, aim: pw.aim } : null;
    if (leg.ok && leg.geometry !== 'local' && leg.geometry !== 'craft' && (from || w.nodes?.length)) {
      const sh = shapeLeg(leg, S[k], w.nodes ?? [], from);
      legs[k - 1] = sh.leg;
      if (sh.flyby) aimed[k - 2] = sh.flyby;
    }
  }
  // The parking orbit's plane: a stay turns it, and the departure pays to
  // leave out of it (planeAt).
  for (let k = 1; k < legs.length; k++) {
    const ctx = planeContext(S, legs, k), L = legs[k];
    if (!ctx) continue;
    const stayDays = (L.depMs - S[k].arrMs) / DAY_MS;
    if (ctx.why) { L.plane = ctx.moon && stayDays <= PLANE_AIMED_DAYS ? { priced: true, body: S[k].body, aimed: true, stayDays, angleDeg: 0, extraDv: 0 } : { priced: false, why: ctx.why, stayDays }; continue; }
    const p = planeAt(ctx, L.depMs, L.vinfDep);
    if (!p) continue;
    L.plane = planeSummary(ctx, p);
    L.depDv += p.extra;
  }
  // Flybys: the turn between the legs either side.
  for (let k = 1; k < S.length; k++) {
    const Q = S[k];
    if (Q.kind !== 'flyby') continue;
    const inLeg = legs[k - 1], outLeg = legs[k];
    const B = bodyInfo(Q.body), rpMin = B.radius + (Q.altKm ?? 300);
    if (!inLeg.ok || !inLeg.vinfArr) continue;
    if (aimed[k - 1]) flybys[k - 1] = { ...aimed[k - 1], body: Q.body, ms: Q.arrMs, vinf: norm(inLeg.vinfArr) };
    else if (outLeg && outLeg.ok && outLeg.vinfDep) {
      const f = X.poweredFlyby({ vinfIn: inLeg.vinfArr, vinfOut: outLeg.vinfDep, mu: B.mu, rpMin });
      flybys[k - 1] = { ...f, body: Q.body, ms: Q.arrMs, vinf: norm(inLeg.vinfArr) };
    } else {
      // The last stop, or a flyby before a free leg: unpowered at the
      // given altitude, the turn about the ecliptic-most axis.
      const n = unit(sub(Z, scale(unit(inLeg.vinfArr), dot(Z, unit(inLeg.vinfArr)))));
      const f = X.flyby({ vinfIn: inLeg.vinfArr, mu: B.mu, rp: rpMin, normal: n });
      const b = X.bPlane(inLeg.vinfArr, f.vinfOut, rpMin, B.mu);
      flybys[k - 1] = { delta: f.delta, rp: rpMin, dv: 0, periapsisDv: 0, steerDv: 0, gain: f.gain, bT: b.bT, bR: b.bR, aim: f.aim, body: Q.body, ms: Q.arrMs, vinf: norm(inLeg.vinfArr), unpoweredOnly: true };
    }
  }
  // The burns, in order.
  for (const leg of legs) {
    if (!leg.ok) continue;
    const P = S[leg.index], Q = S[leg.index + 1];
    const name = (k) => bodyInfo(k).name;
    if (leg.depDv > 0) burns.push({ ms: leg.depMs, body: P.body, dv: leg.depDv, kind: P.kind === 'land' ? 'ascend' : 'depart', label: `${P.kind === 'land' ? 'Lift off from' : 'Leave'} ${name(P.body)}`, leg: leg.index });
    if (leg.midDv > 0) burns.push({ ms: leg.mid?.ms ?? (leg.arcs[1]?.t1 ?? leg.depMs), body: leg.central, dv: leg.midDv, kind: 'mid', label: leg.geometry === 'local' ? 'Transfer burn' : leg.brokenPlane ? 'Plane change' : 'Apoapsis burn', leg: leg.index });
    for (const n of leg.nodes ?? []) if (n.dv > 0) burns.push({ ms: n.ms, body: leg.central, dv: n.dv, kind: 'node', label: 'Node burn', leg: leg.index, node: n.id });
    const fb = flybys[leg.index];
    if (fb && fb.dv > 0) burns.push({ ms: fb.ms, body: Q.body, dv: fb.dv, kind: 'flyby', label: `Powered flyby of ${name(Q.body)}`, leg: leg.index });
    if (leg.arrDv > 0) burns.push({ ms: leg.arrMs, body: Q.body, dv: leg.arrDv, kind: Q.kind === 'land' ? 'land' : 'capture', label: `${Q.kind === 'land' ? 'Land on' : leg.geometry === 'local' ? 'Circularise at' : 'Capture at'} ${name(Q.body)}`, leg: leg.index });
  }
  const totalDv = burns.reduce((a, b) => a + b.dv, 0);
  const end = S[S.length - 1];
  return {
    stops: S, legs, flybys, burns, totalDv,
    startMs: S[0].depMs, endMs: end.arrMs, durationDays: (end.arrMs - S[0].depMs) / DAY_MS,
    ok: legs.every((l) => l.ok),
  };
}

// From a craft's own state (heliocentric, or about a planet if it is in
// orbit there: the journey's start body): the first leg is a Lambert arc
// from where it is, the burn the change of velocity.
function solveCraftLeg(P, Q, depMs, arrMs, w) {
  const s = P.state;
  if (!s) return { ok: false, error: 'no craft state', arcs: [], from: P.body, to: Q.body, depMs, arrMs };
  const g = legGeometry(P.body, Q.body), central = g.kind === 'local' ? P.body : g.central;
  const c = central === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : stateOf(central, depMs);
  const r1 = sub(s.r, c.r), v0 = sub(s.v, c.v), mu = bodyInfo(central).mu, tof = (arrMs - depMs) / 1000;
  const b = Q.body === central ? null : relState(Q.body === central ? central : (g.endB ?? Q.body), central, arrMs);
  const B = bodyInfo(Q.body);
  const mB = moonAt(g.viaB, Q.body, arrMs);
  const sol = b && bestArc(r1, b.r, tof, mu, (v1, v2) => norm(sub(v1, v0)) + arriveCost(Q, sub(v2, b.v), B, mB), w.revs ?? 0);
  const base = { geometry: 'craft', central, from: P.body, to: Q.body, depMs, arrMs, tofDays: tof / DAY, arcs: [], vinfDep: null, vinfArr: null, depDv: 0, arrDv: 0, midDv: 0 };
  if (!sol) return { ...base, ok: false, error: 'no Lambert arc from the craft between these dates' };
  return { ...base, arcs: [{ r1, v1: sol.v1, t1: depMs, t2: arrMs, mu }], vinfArr: sub(sol.v2, b.v), depDv: norm(sub(sol.v1, v0)), arrDv: arriveCost(Q, sub(sol.v2, b.v), B, mB), ok: true, revs: sol.revs, branch: sol.branch, endB: g.endB ?? Q.body };
}

// ---------------- shaping a leg: burn nodes and an aimed flyby ----------------

// The local frame of a state about a central body: prograde along v, normal
// along r x v, radial out (prograde x normal), as craft.js's manoeuvre
// nodes are.
export function nodeFrame(r, v) {
  const T = unit(v), N = unit(cross(r, v));
  return { T, N, R: cross(T, N) };
}

// A leg flown free instead of by Lambert's arc: from its departure (the
// planned arc's velocity, or, after a flyby aimed by hand, the flyby's own
// outgoing velocity), two-body about the central body, with each node's
// burn (prograde, normal, radial km/s) at its time. It arrives where it
// arrives: the miss from the target at the arrival date is kept, and the
// arrival is costed with the velocity it has. Returns the new leg, and the
// aimed flyby (its turn, periapsis and aim) when there is one.
export function shapeLeg(leg, Q, nodes, from = null) {
  const mu = bodyInfo(leg.central).mu;
  const out = { ...leg, arcs: [], nodes: [] };
  let r = leg.arcs[0].r1, v = leg.arcs[0].v1, t = leg.depMs, flyby = null;
  if (from) {
    const P = bodyInfo(leg.from), p = relState(leg.endA ?? leg.from, leg.central, leg.depMs);
    const f = X.flybyFromB({ vinfIn: from.vinfIn, mu: P.mu, bT: from.aim.bT, bR: from.aim.bR });
    v = add(p.v, f.vinfOut);
    out.vinfDep = f.vinfOut; out.depDv = 0;
    flyby = { delta: f.delta, rp: f.rp, dv: 0, periapsisDv: 0, steerDv: 0, gain: norm(sub(f.vinfOut, from.vinfIn)), bT: from.aim.bT, bR: from.aim.bR, aim: Math.hypot(from.aim.bT, from.aim.bR), byHand: true, tooTight: f.rp < P.radius };
  }
  const list = nodes.filter((n) => n.ms > leg.depMs && n.ms < leg.arrMs).sort((a, b) => a.ms - b.ms);
  for (const n of list) {
    const x = propagate(r, v, (n.ms - t) / 1000, mu);
    if (!x) return { leg: { ...leg, ok: false, error: 'a node\'s arc could not be flown' }, flyby };
    out.arcs.push({ r1: r, v1: v, t1: t, t2: n.ms, mu });
    const F = nodeFrame(x.r, x.v), dv = [0, 1, 2].map((i) => F.T[i] * n.pro + F.N[i] * n.nor + F.R[i] * n.rad);
    out.nodes.push({ id: n.id, ms: n.ms, r: x.r, v: x.v, frame: F, dv: norm(dv), dvVec: dv });
    r = x.r; v = add(x.v, dv); t = n.ms;
  }
  const end = propagate(r, v, (leg.arrMs - t) / 1000, mu);
  if (!end) return { leg: { ...leg, ok: false, error: 'the shaped arc could not be flown' }, flyby };
  out.arcs.push({ r1: r, v1: v, t1: t, t2: leg.arrMs, mu });
  const atEnd = relState(leg.endB ?? leg.to, leg.central, leg.arrMs);
  const target = leg.ringArr ?? atEnd.r;
  out.missKm = norm(sub(end.r, target));
  out.vinfArr = sub(end.v, leg.ringArr ? [0, 0, 0] : atEnd.v);
  const B = bodyInfo(leg.to), g = legGeometry(leg.from, leg.to, leg.from === leg.to);
  out.arrDv = leg.ringArr ? leg.arrDv : arriveCost(Q, out.vinfArr, B, moonAt(g.viaB, leg.to, leg.arrMs));
  out.midDv = (leg.midDv ?? 0);
  out.reaches = out.missKm < (leg.ringArr ? 0.05 * norm(target) : Math.max(sphereOfInfluence(leg.endB ?? leg.to), B.radius * 2));
  out.shaped = true;
  return { leg: out, flyby };
}

// The burn at node id that brings leg k's free arc to its target at the
// arrival date (Lambert's arc from the node's place): the journey with that
// node's prograde, normal and radial set. Later nodes on the leg are left
// as they are, so it aims the last one best.
export function aimNode(journey, k, id) {
  const sol = solveJourney(journey), leg = sol.legs[k];
  const n = leg?.nodes?.find((x) => x.id === id);
  if (!n) return journey;
  const atEnd = relState(leg.endB ?? leg.to, leg.central, leg.arrMs), target = leg.ringArr ?? atEnd.r;
  const s = lambert(n.r, target, (leg.arrMs - n.ms) / 1000, bodyInfo(leg.central).mu, true);
  if (!s) return journey;
  const d = sub(s.v1, n.v);
  const w = journey.waypoints[k];
  return { ...journey, waypoints: journey.waypoints.map((x, i) => (i === k ? { ...w, nodes: (w.nodes ?? []).map((m) => (m.id === id ? { ...m, pro: dot(d, n.frame.T), nor: dot(d, n.frame.N), rad: dot(d, n.frame.R) } : m)) } : x)) };
}

// ---------------- options for one leg, compared ----------------

// The mean radius of a body's orbit about the leg's central body (or a
// stop's parking orbit when it is the central body itself).
function legRadii(g, P, Q) {
  const r = (b, stop, isEnd) => {
    if (g.kind === 'fromCentral' && !isEnd) return g.A.radius + stop.altKm;
    if (g.kind === 'toCentral' && isEnd) return g.B.radius + stop.altKm;
    const key = isEnd ? g.endB ?? b.key : g.endA ?? b.key;
    return bodyInfo(key).a;
  };
  return [r(g.A, P, false), r(g.B, Q, true)];
}
// The ecliptic longitude of an end about the central body.
const lon = (key, central, ms) => { const s = relState(key, central, ms); return Math.atan2(s.r[1], s.r[0]); };

// Each transfer that applies to leg k, with its delta-v (km/s, every burn
// of the leg; a flyby at either end is the flyby's own), time of flight,
// departure (the window) and arrival:
//   lambert     as scheduled, at the waypoints' dates
//   hohmann     two tangent burns between circular coplanar orbits, at the
//               next window (Curtis 8.13-8.16)
//   bielliptic  three burns via a far apoapsis, flagged where it beats Hohmann
//   planechange Hohmann with the planes' angle split between its burns
//   direct      near 180 degrees, where the leg is flown on a broken plane:
//               the direct arc on one plane, for comparison
//   porkchop    the cheapest departure and flight time near the window
//               (a Lambert grid refined by Nelder-Mead, as trajsearch.js)
//   phasing     an orbit change in the same orbit: to a point leadDeg ahead
//   phase       leaving a moon via its planet: the best day in the stay for
//               the moon's phase
//   assist      for a leg that ends at a flyby: the flyby, not selectable
export function legOptions(journey, k, { search = true } = {}) {
  const sol = solveJourney(journey);
  const P = sol.stops[k], Q = sol.stops[k + 1];
  const g = legGeometry(P.body, Q.body, isResonant(P, Q)), C = bodyInfo(g.central), mu = C.mu;
  const earliest = P.depMs, fixed = P.kind === 'flyby' || P.kind === 'craft';
  const options = [];
  const asIs = sol.legs[k];
  // A leg that leaves a flyby also pays for the flyby that turns the
  // inbound excess velocity onto its own (poweredFlyby), so its options
  // are compared with that included.
  const inbound = k > 0 ? sol.legs[k - 1] : null, PB = bodyInfo(P.body);
  const joinIn = (L) => (P.kind === 'flyby' && inbound?.ok && inbound.vinfArr && L.vinfDep
    ? X.poweredFlyby({ vinfIn: inbound.vinfArr, vinfOut: L.vinfDep, mu: PB.mu, rpMin: PB.radius + (P.altKm ?? 300) }).dv : 0);
  // Leaving a planet's orbit after a long stay, the parking orbit's plane
  // as that day would have it (planePricer); the leg as scheduled has it
  // already.
  const plane = planePricer(sol, k);
  const legDv = (L) => L.depDv + L.arrDv + L.midDv + joinIn(L) + (plane && L !== asIs ? plane(L) : 0);
  if (asIs.ok && g.kind !== 'local') options.push({ type: 'lambert', name: asIs.resonance ? `As scheduled (resonant ${asIs.resonance.N}:${asIs.resonance.M})` : asIs.brokenPlane ? 'Broken plane, as scheduled' : 'Lambert, as scheduled', dv: legDv(asIs), tofDays: asIs.tofDays, depMs: asIs.depMs, arrMs: asIs.arrMs, revs: asIs.revs, branch: asIs.branch, ...(asIs.brokenPlane ? { note: `${asIs.brokenPlane.angleDeg.toFixed(1)}° round the ${C.name}: the plane turned ${asIs.brokenPlane.turnDeg.toFixed(2)}° on the way, for ${(asIs.brokenPlane.dv * 1000).toFixed(0)} m/s` } : {}) });
  // Near 180 degrees, the direct arc on one plane, for comparison.
  if (asIs.ok && asIs.brokenPlane) {
    const D = solveLeg(P, Q, asIs.depMs, asIs.arrMs, { via: 'direct', vinfIn: inbound?.ok && inbound.vinfArr && P.kind === 'flyby' ? norm(inbound.vinfArr) : null });
    if (D.ok) options.push({ type: 'direct', name: 'Direct, one plane', dv: legDv(D), tofDays: D.tofDays, depMs: D.depMs, arrMs: D.arrMs, revs: D.revs, branch: D.branch, note: `its plane tilted ${asIs.brokenPlane.directIncDeg?.toFixed(1)}° to the departure's: ill-defined this near 180°, and dear to fly` });
  }

  if (g.kind === 'local') {
    for (const via of ['hohmann', 'bielliptic', ...(((Q.incDeg ?? 0) !== (P.incDeg ?? 0)) ? ['planechange'] : []), ...(Q.altKm === P.altKm && Q.leadDeg ? ['phasing'] : [])]) {
      const L = solveLeg(P, { ...Q, prevIncDeg: P.incDeg ?? 0 }, earliest, earliest, { via });
      if (!L.local) continue;
      const tilted = (Q.incDeg ?? 0) !== (P.incDeg ?? 0) && (via === 'hohmann' || via === 'bielliptic');
      options.push({ type: via, name: { hohmann: 'Hohmann', bielliptic: 'Bi-elliptic', planechange: 'Hohmann with plane change', phasing: `Phasing, ${Q.revs || 1} revolution${(Q.revs || 1) > 1 ? 's' : ''}` }[via], dv: legDv(L), tofDays: L.tofDays, depMs: earliest, arrMs: L.arrMs, ok: L.ok, note: L.error ?? (tilted ? `leaves the ${Math.abs((Q.incDeg ?? 0) - (P.incDeg ?? 0))}° plane change out` : undefined) });
    }
    flagBiElliptic(options);
    return { leg: asIs, options, geometry: g.kind, central: g.central };
  }

  if (g.resonant) {
    // Each resonant ratio open to the flyby's excess speed, costed by the
    // flybys it needs either side (the journey solved with that ratio).
    const vin = inbound?.ok && inbound.vinfArr ? norm(inbound.vinfArr) : null;
    const fbCost = (s2) => (s2.flybys[k - 1]?.dv ?? 0) + (s2.flybys[k]?.dv ?? 0);
    for (const r of resonances(P.body, P.depMs, vin).slice(0, 8)) {
      const j2 = { ...journey, waypoints: journey.waypoints.map((x, i) => (i === k ? { ...x, resonance: [r.N, r.M] } : x)) };
      const s2 = solveJourney(j2), L = s2.legs[k];
      if (!L?.ok) continue;
      options.push({ type: 'resonance', name: `Resonant ${r.N}:${r.M}`, dv: L.depDv + L.arrDv + fbCost(s2), tofDays: L.tofDays, depMs: L.depMs, arrMs: L.arrMs, resonance: [r.N, r.M], note: `${r.N} of ${bodyInfo(P.body).name}'s orbits, ${r.M} of the craft's; the flybys either side ${(fbCost(s2) * 1000).toFixed(0)} m/s` });
    }
    const fb = sol.flybys[k];
    if (fb) options.push(assistOption(fb, Q));
    return { leg: asIs, options, geometry: 'resonant', central: g.central };
  }
  const [r1, r2] = legRadii(g, P, Q);
  const vinfCosts = (v1, v2) => {
    const A = g.kind === 'fromCentral' ? null : g.A, B = g.kind === 'toCentral' ? null : g.B;
    const d = A ? departCost(P, v1, A, g.viaA) : v1;
    const a = B ? arriveCost(Q, v2, B, g.viaB) : (Q.kind === 'land' && C.atmosphere ? 0 : v2);
    return d + a;
  };
  // Hohmann, ideal: circular coplanar orbits at the mean radii.
  const h = X.hohmannCircular(mu, r1, r2), win = X.hohmannWindow(mu, r1, r2);
  let wait = 0, windowNote = 'any day: where in the parking orbit it burns sets the aim';
  if (g.kind === 'between') {
    wait = X.windowWait(lon(g.endB, g.central, earliest) - lon(g.endA, g.central, earliest), win.phase0, win.n1, win.n2);
    windowNote = null;
  }
  const hDep = earliest + wait * 1000;
  options.push({ type: 'hohmann', name: 'Hohmann', ideal: true, dv: vinfCosts(h.dv1, h.dv2), tofDays: h.tof / DAY, depMs: hDep, arrMs: hDep + h.tof * 1000, windowNote, unreachable: fixed && wait > DAY, synodicDays: g.kind === 'between' ? win.synodic / DAY : null });

  // Bi-elliptic, ideal, at its own window (the target must come round to
  // the departure's longitude: it flies a full turn).
  if (g.kind === 'between' || g.kind === 'fromCentral' || g.kind === 'toCentral') {
    const rB = biEllipticApoapsis(g.central, r1, r2);
    if (rB > Math.max(r1, r2)) {
      const b = X.biElliptic(mu, r1, rB, r2);
      let bw = 0;
      if (g.kind === 'between') bw = X.windowWait(lon(g.endB, g.central, earliest) - lon(g.endA, g.central, earliest), ((-win.n2 * b.tof) % TWO_PI + TWO_PI) % TWO_PI, win.n1, win.n2);
      const bDep = earliest + bw * 1000;
      options.push({ type: 'bielliptic', name: 'Bi-elliptic', ideal: true, dv: vinfCosts(b.dv1, b.dv3) + b.dv2, tofDays: b.tof / DAY, depMs: bDep, arrMs: bDep + b.tof * 1000, rB, unreachable: fixed && bw > DAY, flyable: g.kind === 'between' });
    }
  }

  // The planes: the angle between the two orbits (or the parking orbit and
  // the moon's), split between the Hohmann burns where it costs least.
  if (g.kind === 'between') {
    const a = relState(g.endA, g.central, earliest), b = relState(g.endB, g.central, earliest);
    const di = Math.acos(Math.min(1, Math.max(-1, dot(unit(cross(a.r, a.v)), unit(cross(b.r, b.v))))));
    if (di > 1e-4) {
      const pc = X.hohmannPlaneChange(mu, r1, r2, di);
      options.push({ type: 'planechange', name: 'Hohmann with plane change', ideal: true, dv: vinfCosts(pc.dv1, pc.dv2), tofDays: pc.tof / DAY, depMs: hDep, arrMs: hDep + pc.tof * 1000, note: `${(di * 180 / Math.PI).toFixed(2)}° between the orbits: ${(pc.split * 180 / Math.PI).toFixed(2)}° at departure, the rest on arrival`, unreachable: fixed && wait > DAY });
    }
  }

  // The porkchop optimum: a grid of departure (from the earliest, across a
  // synodic period, or fixed after a flyby) by flight time (0.5 to 1.6 of
  // Hohmann's), then Nelder-Mead from the best cell.
  if (search) {
    // (Leaving a moon via its planet, a departure every day: its phase
    // ripples the price over a month.)
    const span = g.kind === 'between' ? Math.min(win.synodic / DAY, 800) : 30;
    const tH = h.tof / DAY, o = porkchopSearch(P, Q, g, earliest, fixed, tH * 0.5, tH * 1.6, legDv, span, g.viaA || g.viaB ? Math.ceil(span) : null);
    if (o) options.push(o);
  }

  // Leaving a moon via its planet: the best day in the stay for the moon's
  // phase (phaseOption).
  if (search) { const o = phaseOption(journey, k, { sol, legDv }); if (o) options.push(o); }
  // Leaving a planet's orbit after a long stay: the day its plane holds the
  // way out (planeOption).
  if (search) { const o = planeOption(journey, k, { sol }); if (o) options.push(o); }

  // The assist at a flyby this leg ends in.
  const fb = sol.flybys[k];
  if (fb) options.push(assistOption(fb, Q));

  flagBiElliptic(options);
  return { leg: asIs, options, geometry: g.kind, central: g.central };
}

// Leaving a moon for another planet, the price swings with the moon's phase
// over a month (where the moon is, and which way it is going, against the
// way out), so the best day to leave in the stay: from the arrival (or the
// start date) to the planned departure, or a whole turn of the moon if the
// stay is shorter, every day's best flight time (the porkchop search over
// that span). Returns the option, or null for a leg that does not leave a
// moon via its planet or whose departure is fixed.
export function phaseOption(journey, k, { sol = null, legDv = null } = {}) {
  sol ??= solveJourney(journey);
  const P = sol.stops[k], Q = sol.stops[k + 1];
  if (!P || !Q || P.kind === 'flyby' || P.kind === 'craft') return null;
  const g = legGeometry(P.body, Q.body, isResonant(P, Q));
  if (g.kind !== 'between' || !g.viaA || g.resonant) return null;
  const C = bodyInfo(g.central), [r1, r2] = legRadii(g, P, Q), tH = X.hohmannCircular(C.mu, r1, r2).tof / DAY;
  const from = k === 0 ? P.depMs : P.arrMs, month = bodyPeriod(P.body, g.A.parent, from) / DAY;
  const span = Math.max((P.depMs - from) / DAY_MS, month);
  const dvOf = legDv ?? ((L) => L.depDv + L.arrDv + L.midDv);
  const o = porkchopSearch(P, Q, g, from, false, tH * 0.5, tH * 1.6, dvOf, span, Math.ceil(span * 2));
  if (!o) return null;
  const L = solveLeg(P, Q, o.depMs, o.arrMs, { maxRevs: 1, revs: o.revs, branch: o.branch });
  const name = bodyInfo(P.body).name, d = Math.round((o.depMs - P.depMs) / DAY_MS);
  return { ...o, type: 'phase', name: `Best phase of the ${name === 'Moon' ? 'Moon' : name}`, depDv: L.ok ? L.depDv : null, moonAngleDeg: L.moonDep?.angleDeg ?? null,
    note: `leave ${d === 0 ? 'as planned' : d > 0 ? `${d} d later` : `${-d} d earlier`}: ${name}'s velocity ${L.moonDep ? L.moonDep.angleDeg.toFixed(0) : '?'}° off the way out` };
}
const assistOption = (fb, Q) => ({ type: 'assist', name: `Gravity assist at ${bodyInfo(Q.body).name}`, selectable: false, dv: fb.dv, gain: fb.gain, delta: fb.delta, rp: fb.rp, bT: fb.bT, bR: fb.bR, tooTight: fb.tooTight, vinf: fb.vinf });

// A grid of departure (span days from the earliest; none if fixed) by
// flight time (tMin to tMax days), then Nelder-Mead from the best cell.
function porkchopSearch(P, Q, g, earliest, fixed, tMin, tMax, legDv, span = 0, nDep = null) {
  const legAt = (dep, tofD) => solveLeg(P, Q, dep, dep + tofD * DAY_MS, { maxRevs: g.kind === 'between' ? 1 : 0 });
  const f = (dep, tofD) => { if (!(tofD > 0.5) || dep < earliest || dep > earliest + span * DAY_MS + 1) return Infinity; const L = legAt(dep, tofD); return L.ok ? legDv(L) : Infinity; };
  if (fixed) span = 0;
  const nD = span > 0 ? (nDep ?? (g.kind === 'between' ? 28 : 10)) : 1, nT = g.kind === 'between' ? 24 : 10;
  let best = null;
  for (let i = 0; i < nD; i++) for (let j = 0; j < nT; j++) {
    const dep = earliest + (nD > 1 ? (span * i) / (nD - 1) : 0) * DAY_MS, tofD = tMin + ((tMax - tMin) * j) / (nT - 1);
    const v = f(dep, tofD);
    if (v < (best?.v ?? Infinity)) best = { dep, tofD, v };
  }
  if (!best) return null;
  const dT = (tMax - tMin) / nT;
  const p = nD === 1 ? nelderMead(([t]) => f(earliest, t), [best.tofD], [dT]) : nelderMead(([d, t]) => f(d * DAY_MS, t), [best.dep / DAY_MS, best.tofD], [span / nD, dT]);
  const dep = nD === 1 ? earliest : p[0] * DAY_MS, tofD = nD === 1 ? p[0] : p[1];
  const L = legAt(dep, tofD);
  return L.ok ? { type: 'porkchop', name: 'Porkchop optimum', dv: legDv(L), tofDays: tofD, depMs: dep, arrMs: dep + tofD * DAY_MS, revs: L.revs, branch: L.branch } : null;
}

function flagBiElliptic(options) {
  const h = options.find((o) => o.type === 'hohmann'), b = options.find((o) => o.type === 'bielliptic');
  if (h && b) b.beatsHohmann = b.dv < h.dv;
}

// The journey re-timed to option o for leg k: the leg's departure moves to
// the option's (the previous stay, or the start, takes up the difference),
// its arrival to the option's, and every later waypoint keeps its spacing.
export function applyOption(journey, k, o) {
  const j = { start: { ...journey.start }, waypoints: journey.waypoints.map((w) => ({ ...w })) };
  const w = j.waypoints[k];
  w.via = o.type === 'porkchop' || o.type === 'phase' || o.type === 'plane' || o.type === 'hohmann' || o.type === 'planechange' || o.type === 'resonance' ? 'lambert' : o.type;
  if (o.type === 'resonance') w.resonance = o.resonance;
  w.chosen = o.type;
  w.revs = o.revs; w.branch = o.branch;
  if (o.type === 'lambert' || o.type === 'direct') return j;
  const sol = solveJourney(journey), P = sol.stops[k];
  if (k === 0) j.start.dateMs = o.depMs;
  else if (P.kind !== 'flyby') j.waypoints[k - 1].stayDays = Math.max(0, (o.depMs - P.arrMs) / DAY_MS);
  const shift = o.arrMs - sol.stops[k + 1].arrMs;
  for (let i = k; i < j.waypoints.length; i++) j.waypoints[i].dateMs = sol.stops[i + 1].arrMs + shift;
  return j;
}

// A first guess at the arrival date of a waypoint added after stop P: its
// departure plus the Hohmann time between the two orbits.
export function defaultArrival(P, body, altKm = 300, kind = 'orbit') {
  const g = legGeometry(P.body, body, P.body === body && (kind === 'flyby' || P.kind === 'flyby')), mu = bodyInfo(g.central).mu;
  if (g.resonant) return P.depMs + X.orbitPeriod(mu, g.A.a) * 1000;
  const Q = { body, altKm, kind: 'orbit' };
  const [r1, r2] = g.kind === 'local' ? [g.A.radius + P.altKm, g.A.radius + altKm] : legRadii(g, P, Q);
  return P.depMs + X.hohmannCircular(mu, r1, r2).tof * 1000;
}

// ---------------- drawing ----------------

// Points along every arc of the solution (about each arc's central body,
// ecliptic km), with the burns' places: { arcs: [{ central, leg, pts }],
// marks: [{ central, at, ms, label, dv, kind }] }.
export function journeyPath(sol, perArc = 160) {
  const arcs = [], marks = [];
  for (const leg of sol.legs) {
    if (!leg.ok) continue;
    for (const arc of leg.arcs) {
      const T = (arc.t2 - arc.t1) / 1000, pts = [arc.r1];
      for (let i = 1; i <= perArc; i++) {
        const s = propagate(arc.r1, arc.v1, (T * i) / perArc, arc.mu);
        if (s && s.r.every(Number.isFinite)) pts.push(s.r);
      }
      arcs.push({ central: leg.central, leg: leg.index, pts, t1: arc.t1, t2: arc.t2 });
    }
  }
  const at = (key, central, ms) => (key === central ? [0, 0, 0] : relState(key, central, ms).r);
  for (const b of sol.burns) {
    const leg = sol.legs[b.leg];
    const central = leg.central;
    let pos;
    if (b.kind === 'mid' && leg.mid) pos = leg.mid.r;
    else if (b.kind === 'mid') pos = leg.arcs[1]?.r1 ?? leg.arcs[0].r1;
    else if (leg.geometry === 'local') pos = b.kind === 'depart' ? leg.arcs[0].r1 : propagate(leg.arcs.at(-1).r1, leg.arcs.at(-1).v1, (leg.arcs.at(-1).t2 - leg.arcs.at(-1).t1) / 1000, leg.mu ?? bodyInfo(central).mu)?.r ?? [0, 0, 0];
    else if (b.kind === 'depart' || b.kind === 'ascend') pos = leg.ringDep ?? at(leg.endA ?? b.body, central, b.ms);
    else pos = leg.ringArr ?? at(leg.endB ?? b.body, central, b.ms);
    if (b.kind === 'node') continue;
    marks.push({ central, at: pos, ms: b.ms, label: b.label, dv: b.dv, kind: b.kind });
  }
  // Burn nodes, with their frames for the handles; and at each flyby, its
  // aim point's B-plane axes (T, R in the central body's frame).
  for (const leg of sol.legs) {
    for (const n of leg.nodes ?? []) marks.push({ central: leg.central, at: n.r, ms: n.ms, label: 'Node', dv: n.dv, kind: 'node', id: `node:${leg.index}:${n.id}`, frame: n.frame });
  }
  sol.flybys.forEach((f, k) => {
    if (!f) return;
    const leg = sol.legs[k], inV = leg?.vinfArr;
    if (!inV) return;
    const ax = X.bPlaneAxes(inV);
    marks.push({ central: leg.central, at: at(leg.endB ?? f.body, leg.central, f.ms), ms: f.ms, label: `Aim at ${bodyInfo(f.body).name}`, dv: f.dv, kind: 'aim', id: `aim:${k}`, frame: { T: ax.T, R: ax.R, N: ax.S }, b: [f.bT, f.bR] });
  });
  return { arcs, marks };
}
