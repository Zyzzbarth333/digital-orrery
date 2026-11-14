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
//   applyOption(journey, k, o)   the journey re-timed to option o
//   defaultArrival(...)          a first guess at a new waypoint's date
//   journeyPath(solution)        points along every arc, for drawing

/** @typedef {{ id: number, ms: number, pro: number, nor: number, rad: number }} BurnNode */
/** @typedef {{ id: number, body: string, kind: 'flyby' | 'orbit' | 'land', altKm: number, stayDays?: number, dateMs: number, via?: string, chosen?: string, revs?: number, branch?: string, leadDeg?: number, incDeg?: number, nodes?: BurnNode[], aim?: { bT: number, bR: number } }} Waypoint */
/** @typedef {{ body: string, kind: 'pad' | 'orbit' | 'craft', altKm: number, dateMs: number, latDeg?: number, incDeg?: number, state?: { r: number[], v: number[] }, craftId?: number }} JourneyStart */
/** @typedef {{ start: JourneyStart, waypoints: Waypoint[] }} Journey */

import { lambert, lambertRevs, propagate } from './orbital.js';
import { helioStateEcl, ttSeconds, eqjToEcl } from './ephemeris.js';
import { MOON_KEYS, moonStateEqj } from './moons.js';
import { MOON_DATA } from './moons.data.js';
import { bodyConstants, MU_SUN } from './bodies.js';
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

// From a stop onto an excess speed vinf (km/s) about its body.
//   orbit (and the start's parking orbit): from a circular orbit at altKm;
//   land: an ideal ascent to that orbit (its circular speed: no gravity or
//   drag losses), then the departure;
//   flyby: nothing here (the flyby joins the legs).
// via: the body is a moon and vinf is about its planet: the speed needed at
// the moon's distance, less the moon's own, is the excess about the moon.
function departCost(stop, vinf, B, via = false) {
  if (stop.kind === 'flyby') return 0;
  let v = vinf;
  if (via) {
    const P = bodyInfo(B.parent), vm = Math.sqrt(P.mu / B.a);
    v = Math.abs(Math.sqrt(vinf * vinf + 2 * P.mu / B.a) - vm);
  }
  const rp = B.radius + stop.altKm;
  return X.departureDv(v, B.mu, rp) + (stop.kind === 'land' ? X.circularSpeed(B.mu, rp) : 0);
}
// Arriving with excess speed vinf: orbit, a circular capture at altKm;
// land, through the atmosphere if it has one (no burn), else captured into
// that orbit and down from it (its circular speed); flyby: nothing here.
function arriveCost(stop, vinf, B, via = false) {
  if (stop.kind === 'flyby') return 0;
  let v = vinf;
  if (via) {
    const P = bodyInfo(B.parent), vm = Math.sqrt(P.mu / B.a);
    v = Math.abs(Math.sqrt(vinf * vinf + 2 * P.mu / B.a) - vm);
  }
  if (stop.kind === 'land' && B.atmosphere) return 0;
  const rp = B.radius + stop.altKm;
  return X.captureDv(v, B.mu, rp, 0) + (stop.kind === 'land' ? X.circularSpeed(B.mu, rp) : 0);
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
export function solveLeg(P, Q, depMs, arrMs, { via = 'lambert', revs, branch, maxRevs = 0, vinfIn = null } = {}) {
  const g = legGeometry(P.body, Q.body, isResonant(P, Q)), C = bodyInfo(g.central), mu = C.mu;
  const tof = (arrMs - depMs) / 1000;
  const out = { geometry: g.kind, central: g.central, from: P.body, to: Q.body, depMs, arrMs, tofDays: tof / DAY, arcs: [], vinfDep: null, vinfArr: null, depDv: 0, arrDv: 0, midDv: 0, ok: false };
  if (g.kind === 'local') return solveLocal(P, Q, depMs, g, via, out);
  if (!(tof > 0)) return { ...out, error: 'arrives before it leaves' };
  const pick = revs !== undefined && revs !== null ? { revs, branch } : null;

  if (g.kind === 'between') {
    const a = relState(g.endA, g.central, depMs), b = relState(g.endB, g.central, arrMs);
    const cost = (v1, v2) => departCost(P, norm(sub(v1, a.v)), g.A, g.viaA) + arriveCost(Q, norm(sub(v2, b.v)), g.B, g.viaB) + (P.kind === 'flyby' ? (vinfIn !== null ? Math.abs(norm(sub(v1, a.v)) - vinfIn) : norm(sub(v1, a.v)) * 1e-3) : 0) + (Q.kind === 'flyby' ? norm(sub(v2, b.v)) * 1e-3 : 0);
    if (via === 'bielliptic') return solveBiEllipticLeg(P, Q, depMs, arrMs, g, a, b, out);
    const s = bestArc(a.r, b.r, tof, mu, cost, pick ? pick.revs : g.resonant ? Math.max(2, maxRevs) : maxRevs, pick);
    if (!s) return { ...out, error: 'no Lambert arc between these dates' };
    out.arcs.push({ r1: a.r, v1: s.v1, t1: depMs, t2: arrMs, mu });
    out.vinfDep = sub(s.v1, a.v); out.vinfArr = sub(s.v2, b.v);
    out.depDv = departCost(P, norm(out.vinfDep), g.A, g.viaA);
    out.arrDv = arriveCost(Q, norm(out.vinfArr), g.B, g.viaB);
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

// A bi-elliptic leg between two bodies about the Sun (or a planet): out to
// a far apoapsis opposite the departure, a burn there, then on to the
// target: two Lambert arcs, the second ending at the target's position.
function solveBiEllipticLeg(P, Q, depMs, arrMs, g, a, b, out) {
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
  out.depDv = departCost(P, norm(out.vinfDep), g.A, g.viaA);
  out.arrDv = arriveCost(Q, norm(out.vinfArr), g.B, g.viaB);
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
      leg = solveLeg(P, Q, P.depMs, Q.arrMs, { via: w.via ?? 'lambert', revs: w.revs, branch: w.branch, maxRevs, vinfIn });
    }
    if (leg.geometry === 'local' && leg.ok) {
      const d = leg.arrMs - Q.arrMs;
      Q.arrMs += d; Q.depMs += d; shift += d;
    }
    leg.index = k - 1;
    legs.push(leg);
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
    if (leg.midDv > 0) burns.push({ ms: leg.mid?.ms ?? (leg.arcs[1]?.t1 ?? leg.depMs), body: leg.central, dv: leg.midDv, kind: 'mid', label: leg.geometry === 'local' ? 'Transfer burn' : 'Apoapsis burn', leg: leg.index });
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
  const sol = b && bestArc(r1, b.r, tof, mu, (v1, v2) => norm(sub(v1, v0)) + arriveCost(Q, norm(sub(v2, b.v)), B, g.viaB), w.revs ?? 0);
  const base = { geometry: 'craft', central, from: P.body, to: Q.body, depMs, arrMs, tofDays: tof / DAY, arcs: [], vinfDep: null, vinfArr: null, depDv: 0, arrDv: 0, midDv: 0 };
  if (!sol) return { ...base, ok: false, error: 'no Lambert arc from the craft between these dates' };
  return { ...base, arcs: [{ r1, v1: sol.v1, t1: depMs, t2: arrMs, mu }], vinfArr: sub(sol.v2, b.v), depDv: norm(sub(sol.v1, v0)), arrDv: arriveCost(Q, norm(sub(sol.v2, b.v)), B, g.viaB), ok: true, revs: sol.revs, branch: sol.branch, endB: g.endB ?? Q.body };
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
  out.arrDv = leg.ringArr ? leg.arrDv : arriveCost(Q, norm(out.vinfArr), B, g.viaB);
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
//   porkchop    the cheapest departure and flight time near the window
//               (a Lambert grid refined by Nelder-Mead, as trajsearch.js)
//   phasing     an orbit change in the same orbit: to a point leadDeg ahead
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
  const legDv = (L) => L.depDv + L.arrDv + L.midDv + joinIn(L);
  if (asIs.ok && g.kind !== 'local') options.push({ type: 'lambert', name: 'Lambert, as scheduled', dv: legDv(asIs), tofDays: asIs.tofDays, depMs: asIs.depMs, arrMs: asIs.arrMs, revs: asIs.revs, branch: asIs.branch });

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
    if (search) {
      const T = X.orbitPeriod(mu, g.A.a) / DAY, o = porkchopSearch(P, Q, g, earliest, true, T * 0.8, T * 2.2, legDv);
      if (o) options.push(o);
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
    const tH = h.tof / DAY, o = porkchopSearch(P, Q, g, earliest, fixed, tH * 0.5, tH * 1.6, legDv, g.kind === 'between' ? Math.min(win.synodic / DAY, 800) : 30);
    if (o) options.push(o);
  }

  // The assist at a flyby this leg ends in.
  const fb = sol.flybys[k];
  if (fb) options.push(assistOption(fb, Q));

  flagBiElliptic(options);
  return { leg: asIs, options, geometry: g.kind, central: g.central };
}
const assistOption = (fb, Q) => ({ type: 'assist', name: `Gravity assist at ${bodyInfo(Q.body).name}`, selectable: false, dv: fb.dv, gain: fb.gain, delta: fb.delta, rp: fb.rp, bT: fb.bT, bR: fb.bR, tooTight: fb.tooTight, vinf: fb.vinf });

// A grid of departure (span days from the earliest; none if fixed) by
// flight time (tMin to tMax days), then Nelder-Mead from the best cell.
function porkchopSearch(P, Q, g, earliest, fixed, tMin, tMax, legDv, span = 0) {
  const legAt = (dep, tofD) => solveLeg(P, Q, dep, dep + tofD * DAY_MS, { maxRevs: g.kind === 'between' ? 1 : 0 });
  const f = (dep, tofD) => { if (!(tofD > 0.5) || dep < earliest || dep > earliest + span * DAY_MS + 1) return Infinity; const L = legAt(dep, tofD); return L.ok ? legDv(L) : Infinity; };
  if (fixed) span = 0;
  const nD = span > 0 ? (g.kind === 'between' ? 28 : 10) : 1, nT = g.kind === 'between' ? 24 : 10;
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
  w.via = o.type === 'porkchop' || o.type === 'hohmann' || o.type === 'planechange' ? 'lambert' : o.type;
  w.chosen = o.type;
  w.revs = o.revs; w.branch = o.branch;
  if (o.type === 'lambert') return j;
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
