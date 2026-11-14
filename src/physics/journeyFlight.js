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
//   flyJourney(sys, plan)        flies it: the burns it made, the path, and
//                                the closest approach to each waypoint

import { stepCraft, aimTo, kernelSeconds, kernelMs } from './kernelHost.js';
import { eclToEqj, helioStateEqj } from './ephemeris.js';
import { departureHyperbola } from './launch.js';
import { bodyInfo, sphereOfInfluence, stateOf } from './journey.js';
import { turnAngle, rotate } from './transfers.js';
import { propagate, lambert } from './orbital.js';
import { solarSystemBodies, KERNEL_BODIES } from './bodies.js';
import { aimingRadius } from './transfers.js';

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
function periapsisOffset(sol, k) {
  const Q = sol.stops[k + 1], inLeg = sol.legs[k], outLeg = sol.legs[k + 1];
  if (inLeg.ringArr) return inLeg.ringArr;
  const B = bodyInfo(Q.body), vin = inLeg.vinfArr;
  if (!vin) return [0, 0, 0];
  const uin = unit(vin), fb = sol.flybys[k];
  const rp = fb ? fb.rp : B.radius + (Q.altKm ?? 300);
  if (B.mu < 1) return scale(unit(cross(uin, Z)), rp);           // a small body: no turn to speak of
  let uout;
  if (fb && outLeg?.ok && outLeg.vinfDep) uout = unit(outLeg.vinfDep);
  else {
    let n = outLeg?.ok && outLeg.vinfDep ? cross(vin, outLeg.vinfDep) : null;
    n = n && norm(n) > 1e-9 * norm(vin) * norm(outLeg.vinfDep) ? unit(n) : perpEcliptic(uin);
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
    if (leg.geometry === 'between' && (bodyInfo(P.body).parent !== 'sun' && leg.central === 'sun')) unsupported.push(`${bodyInfo(P.body).name}: leaving a moon for another planet is planned, not flown`);
    if (leg.geometry === 'local') {
      const B = bodyInfo(P.body), r1 = B.radius + P.altKm, r2 = B.radius + Q.altKm, up = r2 >= r1 ? 1 : -1;
      events.push({ kind: 'tangent', ms: leg.depMs, body: P.body, dv: up * leg.depDv });
      if (leg.midDv) events.push({ kind: 'tangent', ms: leg.arcs[1]?.t1 ?? leg.depMs, body: P.body, dv: up * leg.midDv });
      events.push({ kind: 'tangent', ms: leg.arrMs, body: P.body, dv: up * leg.arrDv, waypoint: k });
      continue;
    }
    // Leaving a stop where the craft was in orbit.
    if (k > 0 && P.kind !== 'flyby') {
      // The way out is re-solved if the departure waits: Lambert about the
      // leg's central body to where the target is at the arrival.
      if (leg.vinfDep && KERNEL.has(P.body)) events.push({ kind: 'depart', ms: leg.depMs, body: P.body, vinfEqj: ecl(leg.vinfDep), rp: bodyInfo(P.body).radius + P.altKm,
        reaim: leg.geometry === 'between' && leg.endA === P.body ? { central: leg.central, to: leg.endB ?? Q.body, arrMs: leg.arrMs } : null });
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
    const off = periapsisOffset(sol, k);
    let aimOff = off, without = null;
    if (!leg.ringArr && leg.vinfArr && KERNEL.has(Q.body)) {
      const u = unit(leg.vinfArr), B = bodyInfo(Q.body), perp = sub(off, scale(u, dot(off, u)));
      aimOff = norm(perp) > 0 ? scale(unit(perp), aimingRadius(norm(off), norm(leg.vinfArr), B.mu)) : off;
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
    const target = { body: leg.ringArr ? leg.central : (leg.endB ?? Q.body), offsetEqj: ecl(aimOff), arrive: arriveMs, without, central: leg.central };
    const dur = leg.arrMs - leg.depMs;
    // When: the first once the craft is clear of the body it left (half
    // again its sphere of influence at the leg's excess speed; a flyby's
    // powered burn is flown here, outside, so without its Oberth gain), the
    // second a few sphere-crossing times out from the target. (Not inside
    // it: there the craft reaches periapsis early, pulled in, and a point
    // aimed for at the planned time is the wrong hyperbola.)
    const crossing = (key, vinf) => (KERNEL.has(key) && vinf ? sphereOfInfluence(key) / norm(vinf) : 0) * 1000;
    const clearP = leg.central === P.body ? Math.min(0.1 * dur, 2 * 3600e3) : Math.max(Math.min(0.1 * dur, 2 * 3600e3), 1.5 * crossing(P.body, leg.vinfDep));
    const tIn = without ? crossing(Q.body, leg.vinfArr) : 0;
    // Burn nodes dragged onto the leg are flown as planned (their burns as
    // planned vectors); the aims come after the last of them, so the flight
    // keeps the shape given and corrects only what is left.
    const nodes = (leg.nodes ?? []).filter((n) => n.dv > 0);
    for (const n of nodes) events.push({ kind: 'impulse', ms: n.ms, dvEqj: ecl(n.dvVec), node: true });
    const afterNodes = nodes.length ? nodes[nodes.length - 1].ms + 0.02 * dur : -Infinity;
    const first = Math.max(afterNodes, leg.mid ? leg.mid.ms : leg.depMs + Math.min(clearP, 0.3 * dur));
    events.push({ kind: 'aim', ms: first, ...target });
    const second = Math.max(first + 0.25 * (leg.arrMs - first), leg.arrMs - 3 * tIn);
    if (second < leg.arrMs - 0.6 * tIn && leg.arrMs - first > 2 * DAY * 1000) events.push({ kind: 'aim', ms: second, ...target });
    // Inside the target's sphere: trim the periapsis radius alone (two-body
    // about the target, where its pull is most of the force).
    if (without) events.push({ kind: 'approach', ms: leg.arrMs - 0.6 * tIn, body: Q.body, rp: norm(off) });
    const wMs = leg.ringArr ? 0.25 * DAY * 1000 : Math.min(3 * DAY * 1000, Math.max(2 * 3600e3, 0.5 * (crossing(Q.body, leg.vinfArr) || DAY * 1000)));
    events.push({ kind: 'arrive', ms: leg.arrMs, body: Q.body, waypoint: k, plannedRp: norm(off), central: !!leg.ringArr, windowMs: wMs, ...(leg.ringArr ? { point: { ms: arriveMs, offsetEqj: ecl(aimOff), body: leg.central } } : {}) });
    if (Q.kind === 'orbit' || (Q.kind === 'land' && !bodyInfo(Q.body).atmosphere)) {
      events.push({ kind: KERNEL.has(Q.body) ? 'capture' : 'rendezvous', ms: leg.arrMs, body: Q.body });
      if (Q.kind === 'land') unsupported.push(`${bodyInfo(Q.body).name}: the landing is planned; the flight waits in the low orbit`);
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

// The outgoing excess velocity (vector) of the two-body orbit through r, v
// about mu, or null for an ellipse: v_inf along the asymptote at true anomaly
// acos(-1/e), in the plane of r x v.
function asymptote(r, v, mu) {
  const rn = norm(r), v2 = dot(v, v), en = v2 / 2 - mu / rn;
  if (!(en > 0)) return null;
  const h = cross(r, v), ev = scale(sub(scale(r, v2 - mu / rn), scale(v, dot(r, v))), 1 / mu), e = norm(ev);
  const P = scale(ev, 1 / e), Q = unit(cross(h, P)), th = Math.acos(-1 / e);
  return scale(add(scale(P, Math.cos(th)), scale(Q, Math.sin(th))), Math.sqrt(2 * en));
}
// The velocity at r whose orbit leaves along the excess velocity `want`:
// Newton from v0 on the three components, sensitivities by differences.
function toAsymptote(r, v0, want, mu) {
  let v = [...v0];
  const f = (vv) => { const u = asymptote(r, vv, mu); return u ? sub(u, want) : null; };
  for (let it = 0; it < 12; it++) {
    const F = f(v);
    if (!F) return null;
    if (norm(F) < 1e-7) return v;
    const hstep = 1e-6, J = [0, 1, 2].map((k) => { const w = [...v]; w[k] += hstep; const G = f(w); return G && G.map((g, i) => (g - F[i]) / hstep); });
    if (J.some((c) => !c)) return null;
    const A = [0, 1, 2].map((i) => [J[0][i], J[1][i], J[2][i]]);
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A);
    if (!(Math.abs(D) > 0)) return null;
    const step = [0, 1, 2].map((k) => det(A.map((row, i) => row.map((val, c) => (c === k ? -F[i] : val)))) / D);
    v = add(v, step);
  }
  const F = f(v);
  return F && norm(F) < 1e-5 ? v : null;
}

const WITHOUT = new Map();
function withoutBody(sys, key) {
  if (!WITHOUT.has(key)) WITHOUT.set(key, solarSystemBodies({ epochMs: sys.epochMs, keys: KERNEL_BODIES.filter((b) => b !== key) }));
  return WITHOUT.get(key);
}

export function flyJourney(sys, plan, { samples = 400 } = {}) {
  const without = (key) => withoutBody(sys, key);
  const out = { burns: [], path: [], arrivals: [], log: [], impact: null, correctionsDv: 0 };
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
  // Fly to time t, recording the path; stops at an impact.
  const flyTo = (t) => {
    while (s.t < t - 1e-6 && !out.impact) {
      let tn = Math.min(t, s.t + every);
      for (const w of watches) if (tn > w.t0 && s.t < w.t1) tn = Math.min(tn, Math.max(s.t + w.step, Math.min(w.t0, tn)), s.t + w.step);
      const res = stepCraft(sys, { id: 0, version: 0, r: s.r, v: s.v, t: s.t, tEnd: tn, primary: null, burns: out.burns, maxSteps: 2e6 });
      const hit = res.events.find((e) => e.type === 'impact');
      s = { r: res.r, v: res.v, t: res.t };
      out.path.push({ t: s.t, r: [...s.r] });
      look();
      if (hit) { out.impact = { body: hit.body, t: hit.t }; break; }
      if (!res.complete) { out.log.push(`kernel stopped short at ${s.t}`); break; }
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

  for (const e of plan.events) {
    let t = kernelSeconds(new Date(e.ms));
    if (out.impact) break;
    if (e.kind === 'arrive') {
      // Home to the central body: how far from the aimed point on the arc.
      if (e.point) {
        const tp = kernelSeconds(new Date(e.point.ms));
        flyTo(tp);
        const w = watches.find((x) => x.waypoint === e.waypoint);
        if (w && Math.abs(s.t - tp) < 1) w.pointMiss = norm(sub(s.r, add(posAt(sys, e.point.body, s.t), e.point.offsetEqj)));
      }
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
      const tau = Math.max(3 * 3600, Math.min(5 * DAY, sphereOfInfluence(e.body) / norm(e.vinfEqj)));
      // The excess velocity for leaving at time tt: as planned, or re-solved
      // to the leg's arrival when the departure has waited.
      const vinfAt = (tt) => {
        if (!e.reaim || Math.abs(tt - t) < 3600) return e.vinfEqj;
        const T = kernelSeconds(new Date(e.reaim.arrMs));
        const C = e.reaim.central === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : bodyState(e.reaim.central, tt), CT = e.reaim.central === 'sun' ? [0, 0, 0] : posAt(sys, e.reaim.central, T);
        const P0 = bodyState(e.body, tt), to = sub(posAt(sys, e.reaim.to, T), CT);
        const muC = e.reaim.central === 'sun' ? sys.muSun : bodyInfo(e.reaim.central).mu;
        const arc = lambert(sub(P0.r, C.r), to, T - tt, muC, true);
        return arc ? sub(arc.v1, sub(P0.v, C.v)) : e.vinfEqj;
      };
      const cheapest = () => {
        const want = vinfAt(s.t), far = scale(want, tau);
        const { r, v, B } = rel(e.body, s.t);
        const a = 1 / (2 / norm(r) - dot(v, v) / B.mu), T = 2 * Math.PI * Math.sqrt(Math.abs(a) ** 3 / B.mu);
        let best = null;
        for (let i = 0; i < 72; i++) {
          const dt = (T * i) / 72, x = i ? propagate(r, v, dt, B.mu) : { r, v };
          if (!x) continue;
          for (const pro of [true, false]) {
            // A first guess from the far point, then exact on the asymptote.
            const arc = lambert(x.r, far, tau, B.mu, pro);
            if (!arc) continue;
            const v1 = toAsymptote(x.r, arc.v1, want, B.mu);
            if (!v1) continue;
            const d = sub(v1, x.v), m = norm(d);
            if (Number.isFinite(m) && (!best || m < best.m)) best = { dt, d, m, T };
          }
        }
        return best;
      };
      const t0 = s.t, saved = { ...s };
      let best = cheapest(), bestAt = s.t;
      for (let h = 0.5; h <= (e.waitDays ?? 30) && best; h += 0.5) {
        flyTo(t0 + h * DAY);
        const b = cheapest();
        if (b && b.m < best.m * 0.98) { best = b; bestAt = s.t; }
      }
      // Back to the best moment (re-flown from the departure time).
      if (s.t !== bestAt) { s = { ...saved }; flyTo(bestAt); }
      if (!best) { out.log.push(`depart ${e.body}: no burn found`); continue; }
      let tb = s.t + best.dt;
      if (tb - durOf(best.m) / 2 < s.t) tb += best.T;
      burn(tb, best.d, best.m);
      out.log.push(`depart ${e.body}: ${(best.m * 1000).toFixed(0)} m/s, ${((tb - kernelSeconds(new Date(e.ms))) / 3600).toFixed(1)} h after the planned time`);
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
      const k = aimTo(e.without ? without(e.without) : sys, { r: s.r, v: s.v, t0: s.t, T: Tk, target, burns: future, dv0, rounds: 8, damped: true });
      if (!k) { out.log.push(`aim at ${e.body} failed`); continue; }
      const dv = norm(k.dv);
      if (dv > 1e-7) burn(s.t + durOf(dv) / 2, k.dv, dv);
      out.correctionsDv = (out.correctionsDv ?? 0) + dv;
      out.log.push(`aim at ${e.body}: ${(dv * 1000).toFixed(2)} m/s (miss ${k.miss.toFixed(0)} km, aimed ${k.after.toFixed(2)} km)`);
      continue;
    }
    if (e.kind === 'approach') {
      // Twice: trim the periapsis radius alone, by a burn b along the aim
      // (the part of r across v), secant on b, two-body about the body;
      // the second halfway on to the periapsis, whose time is kept for the
      // capture (the body's pull brings it early, hours early at the Moon).
      for (let pass = 0; pass < 2 && !out.impact; pass++) {
        const { r, v, B } = rel(e.body, s.t);
        if (dot(r, v) > 0) break;                                   // past periapsis already
        const across = sub(r, scale(unit(v), dot(r, unit(v)))), bh = norm(across) > 0 ? unit(across) : unit(cross(v, Z));
        const rpOf = (b) => {
          const vv = add(v, scale(bh, b)), h = norm(cross(r, vv)), en = dot(vv, vv) / 2 - B.mu / norm(r);
          return (h * h / B.mu) / (1 + Math.sqrt(Math.max(0, 1 + 2 * en * h * h / (B.mu * B.mu))));
        };
        let b0 = 0, b1 = 1e-4, f0 = rpOf(b0) - e.rp, f1 = rpOf(b1) - e.rp;
        for (let i = 0; i < 30 && Math.abs(f1) > 0.1 && f1 !== f0; i++) { const b2 = b1 - f1 * (b1 - b0) / (f1 - f0); b0 = b1; f0 = f1; b1 = b2; f1 = rpOf(b1) - e.rp; }
        if (Number.isFinite(b1) && Math.abs(b1) < 0.5 && Math.abs(b1) > 1e-7) {
          burn(s.t + durOf(Math.abs(b1)) / 2, scale(bh, Math.sign(b1)), Math.abs(b1));
          out.log.push(`trim at ${e.body}: ${(Math.abs(b1) * 1000).toFixed(2)} m/s, periapsis ${rpOf(0).toFixed(0)} to ${(f1 + e.rp).toFixed(0)} km`);
        }
        const tp = s.t + timeToPeriapsis(r, add(v, scale(bh, Number.isFinite(b1) ? b1 : 0)), B.mu);
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
  if (!out.impact) flyTo(Math.max(s.t, tEnd - DAY + 3600, ...watches.map((w) => w.t1)));
  // missKm: for a flyby or capture, the closest approach less the planned
  // periapsis; home to a central body, the distance from the aimed point.
  out.arrivals = watches.map((w) => ({ waypoint: w.waypoint, body: w.body, closest: w.best, plannedRp: w.plannedRp, missKm: w.pointMiss ?? Math.abs(w.best - w.plannedRp), at: w.at, central: w.central }));
  return out;
}
