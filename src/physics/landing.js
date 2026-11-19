// src/physics/landing.js
//
// Down to a surface and back up, as the journey's kernel flight burns them
// (docs/physics/journey.md#landings). Pure ES module: km, km/s, s, about the
// body's centre in a frame that does not turn with it; thrust as an
// acceleration (km/s^2), steady through each burn.
//
//   deorbitDv(mu, r0, rp)            the burn from a circular orbit r0 onto
//                                    the ellipse down to periapsis rp
//   designBraking({ r, v, mu, R })   the braking burn from periapsis:
//                                    retrograde, its thrust chosen so the
//                                    speed is gone a little above the ground
//   designTerminal({ r, v, mu, R })  the last of the descent: a fall, then
//                                    retrograde to a stop a metre or two up
//   designAscent({ r, v, mu, R, rOrbit, normal })
//                                    from the ground into orbit: a tilted
//                                    rise, then prograde (a gravity turn),
//                                    up to an apoapsis at rOrbit
//   entryPeriapsis({ mu, R, vinf, gammaDeg })
//                                    the periapsis a drag-free hyperbola
//                                    needs to meet the ground at gammaDeg
//   designCapture({ r, v, mu, R, rc, accel })
//                                    the capture before them: from the
//                                    arrival hyperbola's periapsis into the
//                                    circular orbit of radius rc, a finite
//                                    burn in two halves, each at its own
//                                    pitch from retrograde
//   planCapture({ r, v, mu, R, rc, accel })
//                                    the cheapest way into the circular
//                                    orbit rc: that burn into a circular
//                                    orbit near the periapsis, then a
//                                    Hohmann transfer to rc
//
// The model is the one the patched conics price (an ideal descent costs the
// circular speed of the low orbit) made flyable: a descent orbit, a braking
// burn and a short last fall and stop, paying the losses a real descent
// pays for slowing in a gravity field.

import { hohmannCircular } from './transfers.js';
import { dot, cross, norm, unit } from './vec.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// The fastest a landing may meet the ground (km/s), over the turning
// surface: 10 m/s. Faster is a crash, in the kernel's flight and in the
// app's Craft alike. The flown descents touch down under 3.
export const TOUCHDOWN_SPEED = 0.01;

// The descent orbit's periapsis height (km): a choice, low enough that the
// braking burn starts near the ground (little height left to lose under
// gravity), high enough to clear the terrain.
export const DESCENT_PERIAPSIS_KM = 15;

// From a circular orbit of radius r0, the retrograde burn onto the ellipse
// whose periapsis is rp: the circular speed less the ellipse's apoapsis
// speed (Curtis 4th ed. Eq. 2.71, vis-viva).
export function deorbitDv(mu, r0, rp) {
  const a = (r0 + rp) / 2;
  return Math.sqrt(mu / r0) - Math.sqrt(mu * (2 / r0 - 1 / a));
}

// The osculating semi-major axis and eccentricity vector of (r, v) about mu
// (Curtis 4th ed. Eqs. 2.71 and 4.10).
function elements(r, v, mu) {
  const rn = norm(r), v2 = dot(v, v);
  return { a: 1 / (2 / rn - v2 / mu), ev: scale(sub(scale(r, v2 - mu / rn), scale(v, dot(r, v))), 1 / mu) };
}

// Two-body flight with a steady thrust accel (km/s^2) along dirOf(r, v, t)
// (a unit vector, or null for none), by fourth-order Runge-Kutta in steps of
// dt; stops when stop(r, v, t) says so or at tMax. Returns { r, v, t, ok }:
// ok false if it reached the ground (|r| < R) first.
function fly({ r, v, mu, R, accel, dirOf, stop, tMax, dt = 0.5 }) {
  let t = 0;
  const f = (rr, vv, tt) => {
    const rn = norm(rr), g = scale(rr, -mu / rn ** 3), d = accel ? dirOf(rr, vv, tt) : null;
    return [vv, d ? add(g, scale(d, accel)) : g];
  };
  while (t < tMax) {
    if (norm(r) < R) return { r, v, t, ok: false };
    if (stop(r, v, t)) return { r, v, t, ok: true };
    const h = Math.min(dt, tMax - t);
    const k1 = f(r, v, t);
    const k2 = f(add(r, scale(k1[0], h / 2)), add(v, scale(k1[1], h / 2)), t + h / 2);
    const k3 = f(add(r, scale(k2[0], h / 2)), add(v, scale(k2[1], h / 2)), t + h / 2);
    const k4 = f(add(r, scale(k3[0], h)), add(v, scale(k3[1], h)), t + h);
    r = add(r, scale(add(add(k1[0], scale(k2[0], 2)), add(scale(k3[0], 2), k4[0])), h / 6));
    v = add(v, scale(add(add(k1[1], scale(k2[1], 2)), add(scale(k3[1], 2), k4[1])), h / 6));
    t += h;
  }
  return { r, v, t, ok: norm(r) >= R };
}

const retro = (r, v) => scale(unit(v), -1);
const pro = (r, v) => unit(v);
// Retrograde until the speed is down to vStop (by default about gone: one
// step's change from zero).
function brakeToStop({ r, v, mu, R, accel, dt = 0.25, vStop = accel * dt }) {
  return fly({ r, v, mu, R, accel, dirOf: retro, stop: (rr, vv) => norm(vv) <= vStop, tMax: 3600, dt });
}

// The braking burn, from the state (r, v) at the burn's start (the descent
// orbit's periapsis): the thrust (km/s^2) at which a retrograde burn takes
// the speed to zero hEnd above the ground (bisection: more thrust stops
// sooner, higher). Returns { accel, dur, dv, end: { r, v } } or null.
export function designBraking({ r, v, mu, R, hEnd = 0.5, maxAccel = 0.05 }) {
  const hOf = (a) => { const s = brakeToStop({ r, v, mu, R, accel: a }); return s.ok ? { h: norm(s.r) - R, s } : { h: -1, s }; };
  let lo = 1e-4, hi = maxAccel;
  if (hOf(hi).h < hEnd) return null;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (hOf(m).h < hEnd) lo = m; else hi = m; }
  const { s } = hOf(hi);
  return { accel: hi, dur: s.t, dv: hi * s.t, end: { r: s.r, v: s.v } };
}

// The last of the descent, from about at rest a little up and moving with
// the ground across it: a fall of `delay` seconds, then thrust straight up
// (along r now) at `accel` until the craft is coming down at vCut (1.5 m/s)
// hEnd (1 m) above the ground (bisection on the delay: a later burn stops
// lower), the engine cut there so it settles on rather than hovering.
// Returns { delay, dur, dv, accel, dir } or null.
export function designTerminal({ r, v, mu, R, accel, hEnd = 0.001, vCut = 0.0015 }) {
  const up = unit(r), vr = (rr, vv) => dot(rr, vv) / norm(rr);
  const fall = (d) => fly({ r, v, mu, R, accel: 0, dirOf: null, stop: () => false, tMax: d, dt: 0.25 });
  const hOf = (d) => {
    const f = fall(d);
    if (!f.ok) return { h: -1 };
    if (vr(f.r, f.v) > -vCut) return { h: norm(f.r) - R + 1, dur: 0 };     // not coming down yet
    const s = fly({ r: f.r, v: f.v, mu, R, accel, dirOf: () => up, stop: (rr, vv) => vr(rr, vv) >= -vCut, tMax: 3600, dt: 0.125 });
    return s.ok ? { h: norm(s.r) - R, dur: s.t } : { h: -1 };
  };
  let lo = 0, hi = 1;
  while (hOf(hi).h > hEnd && hi < 3600) { lo = hi; hi *= 2; }
  if (hOf(lo).h < hEnd) return null;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (hOf(m).h > hEnd) lo = m; else hi = m; }
  const p = hOf(lo);
  return { delay: lo, dur: p.dur, dv: accel * p.dur, accel, dir: up };
}

// From the ground (r, v: the site's position and its velocity with the
// body's spin) into orbit in the plane with the given normal: a rise of
// `rise` seconds (10) tilted `kick` from the vertical towards the way the orbit
// goes, then prograde (a gravity turn) until the coast's apoapsis is
// rOrbit, and a circularising burn there. The tilt is chosen (golden
// section) for the least delta-v in all. Returns { kick, rise, dirRise
// (unit vector), dur (the prograde burn's), coast (s from its end to
// apoapsis), circ (km/s), dv (the total), accel } or null.
export function designAscent({ r, v, mu, R, rOrbit, normal, accel, rise = 10 }) {
  const up = unit(r), along = unit(cross(normal, up));
  const tryKick = (kick) => {
    const dirRise = unit(add(scale(up, Math.cos(kick)), scale(along, Math.sin(kick))));
    const a = fly({ r: add(r, scale(up, 1e-3)), v, mu, R, accel, dirOf: () => dirRise, stop: () => false, tMax: rise, dt: 0.25 });
    if (!a.ok) return null;
    const apo = (rr, vv) => { const h = norm(cross(rr, vv)), en = dot(vv, vv) / 2 - mu / norm(rr); if (en >= 0) return Infinity; const sma = -mu / (2 * en), e = Math.sqrt(Math.max(0, 1 - h * h / (mu * sma))); return sma * (1 + e); };
    // The prograde burn's length: bisection for the apoapsis.
    const burnFor = (d) => fly({ r: a.r, v: a.v, mu, R, accel, dirOf: pro, stop: () => false, tMax: d, dt: 0.25 });
    let lo = 0, hi = 30;
    while (hi < 7200) { const b = burnFor(hi); if (!b.ok || apo(b.r, b.v) >= rOrbit) break; lo = hi; hi *= 2; }
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; const b = burnFor(m); if (b.ok && apo(b.r, b.v) < rOrbit) lo = m; else hi = m; }
    const b = burnFor(hi);
    if (!b.ok || dot(b.r, b.v) <= 0) return null;
    // Coast up to the apoapsis, then circularise.
    const c = fly({ r: b.r, v: b.v, mu, R, accel: 0, dirOf: null, stop: (rr, vv) => dot(rr, vv) <= 0, tMax: 4 * 3600, dt: 1 });
    if (!c.ok) return null;
    const circ = Math.sqrt(mu / norm(c.r)) - norm(c.v);
    return { kick, rise, dirRise, dur: hi, coast: c.t, circ, dv: accel * (rise + hi) + Math.abs(circ), accel, apo: norm(c.r) };
  };
  // The tilt: a scan from 2 to 86 degrees (too little and the climb falls
  // back, too much and it grazes the ground), then golden section about the
  // best.
  const cost = (k) => tryKick(k)?.dv ?? Infinity, D = Math.PI / 180;
  let k0 = null, f0 = Infinity;
  for (let k = 2; k <= 86; k += 3) { const f = cost(k * D); if (f < f0) { f0 = f; k0 = k * D; } }
  if (k0 === null) return null;
  const g = (Math.sqrt(5) - 1) / 2;
  let a = k0 - 3 * D, b = k0 + 3 * D, c1 = b - g * (b - a), c2 = a + g * (b - a), f1 = cost(c1), f2 = cost(c2);
  for (let i = 0; i < 20; i++) {
    if (f1 < f2) { b = c2; c2 = c1; f2 = f1; c1 = b - g * (b - a); f1 = cost(c1); }
    else { a = c1; c1 = c2; f1 = f2; c2 = a + g * (b - a); f2 = cost(c2); }
  }
  const best = tryKick((a + b) / 2);
  return best && best.dv <= f0 ? best : tryKick(k0);
}

// The periapsis radius of the drag-free hyperbola (excess speed vinf) that
// crosses the surface R at flight-path angle gammaDeg below the horizontal:
// h = R v_R cos(gamma) with v_R from the energy, and r_p = (h^2 / mu) / (1 + e),
// e = sqrt(1 + vinf^2 h^2 / mu^2) (Curtis Eqs. 2.40, 2.103).
export function entryPeriapsis({ mu, R, vinf, gammaDeg = 12 }) {
  const vR = Math.sqrt(vinf * vinf + 2 * mu / R), h = R * vR * Math.cos(gammaDeg * Math.PI / 180);
  const e = Math.sqrt(1 + (vinf * h / mu) ** 2);
  return (h * h / mu) / (1 + e);
}

// The capture burn from the arrival hyperbola's periapsis (r, v there) into
// the circular orbit of radius rc, at a steady thrust accel (km/s^2).
// Impulsive, it is vp - sqrt(mu / rp) at the periapsis (Curtis 4th ed.
// Eq. 8.58). Finite, it cannot be centred on the periapsis on a fast
// capture (braking before it lowers the periapsis: a 6 km/s capture takes
// minutes), and started there and held retrograde it ends eccentric (e about
// 0.04 for 2 km/s at Mars, 100 s): the craft climbs while it is still faster
// than circular and falls after. So the burn starts at the periapsis and is
// flown in two halves, each held at its own pitch from retrograde in the
// orbit's plane (negative: down, towards the body), and Newton on the two
// pitches and the length puts the osculating orbit at its end on a = rc,
// e = 0: three conditions, three unknowns. The loss over the impulse
// (about 1 % at Mars) is paid in the burn, where it was meant to be.
// Returns { dur, pitch: [p1, p2] (rad), dv, impulsive, end: { r, v }, a, e,
// rMin, rc } or null (no such burn: too slow already, or Newton does not
// converge within a pitch of 60 degrees). guess: [p1, p2, dur] to start
// Newton from (by default retrograde, for the impulse's length).
export function designCapture({ r, v, mu, R, rc, accel, dt = 0.5, guess = null }) {
  const impulsive = norm(v) - Math.sqrt(mu / norm(r));
  if (!(norm(v) > Math.sqrt(mu / rc))) return null;
  const N = unit(cross(r, v)), P = unit(r), Q = cross(N, P);
  const dirAt = (p) => (rr, vv) => { const V = unit(vv), I = unit(cross(V, unit(cross(rr, vv)))); return add(scale(V, -Math.cos(p)), scale(I, Math.sin(p))); };
  const flown = ([p1, p2, dur]) => {
    let rMin = norm(r);
    const track = (rr) => { rMin = Math.min(rMin, norm(rr)); return false; };
    const a = fly({ r, v, mu, R, accel, dirOf: dirAt(p1), stop: track, tMax: dur / 2, dt });
    const b = a.ok ? fly({ r: a.r, v: a.v, mu, R, accel, dirOf: dirAt(p2), stop: track, tMax: dur / 2, dt }) : a;
    track(b.r);
    const el = elements(b.r, b.v, mu);
    return { f: [(el.a - rc) / rc, dot(el.ev, P), dot(el.ev, Q)], end: { r: b.r, v: b.v }, ok: b.ok, rMin, a: el.a, e: norm(el.ev) };
  };
  const size = (f) => Math.hypot(f[0], f[1], f[2]);
  let x = guess ? [...guess] : [0, 0, (norm(v) - Math.sqrt(mu / rc)) / accel], cur = flown(x);
  for (let it = 0; it < 30 && cur.ok && size(cur.f) > 1e-10; it++) {
    const hs = [1e-6, 1e-6, 1e-4 * x[2]], J = hs.map((h, j) => { const y = [...x]; y[j] += h; const g = flown(y).f; return g.map((gi, i) => (gi - cur.f[i]) / h); });
    // J[j][i] = d f_i / d x_j; solve sum_j J[j][i] s_j = -f_i (Cramer).
    const M = [0, 1, 2].map((i) => [J[0][i], J[1][i], J[2][i]]);
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(M);
    if (!(Math.abs(D) > 0)) return null;
    const step = [0, 1, 2].map((k) => det(M.map((row, i) => row.map((c, j) => (j === k ? -cur.f[i] : c)))) / D);
    // Halved while it makes things worse.
    let lam = 1, next = null;
    for (let h = 0; h < 8; h++, lam /= 2) {
      const y = x.map((xi, k) => xi + lam * step[k]);
      if (!(y[2] > 0)) continue;
      const c = flown(y);
      if (c.ok && size(c.f) < size(cur.f)) { next = { y, c }; break; }
    }
    if (!next) break;
    x = next.y; cur = next.c;
  }
  if (!cur.ok || cur.e > 1e-6 || Math.abs(cur.a - rc) > 0.01 || Math.abs(x[0]) > Math.PI / 3 || Math.abs(x[1]) > Math.PI / 3) return null;
  return { dur: x[2], pitch: [x[0], x[1]], dv: accel * x[2], impulsive, end: cur.end, a: cur.a, e: cur.e, rMin: cur.rMin, rc };
}

// Into the circular orbit rc from the arrival hyperbola's periapsis (r, v),
// for the least delta-v: designCapture's burn into the circular orbit of
// radius rs, then a Hohmann transfer from rs to rc (Curtis 4th ed. Sec. 6.2)
// if they differ. Holding a radius within the burn is dear: lowering the
// end by 2 km within a 40 s burn at the Moon takes 14 degrees of pitch and
// 3 % more. The Hohmann transfer is about v dr / 2r (a metre a second a
// kilometre at Mars). rs: scanned over -0.5 to 2 times the burn's own
// scale about the periapsis (accel dur^2 / 8, the height a burn that long
// moves it), then golden section about the cheapest. Returns designCapture's
// burn with rs, hohmann ({ dv1, dv2, total } or null when rs is within
// 0.1 km of rc) and total (km/s), or null. The steps: 100 to the burn, from
// 0.25 to 2 s (the orbit turns a few degrees over the burn: RK4 is good to
// millimetres there).
export function planCapture({ r, v, mu, R, rc, accel }) {
  const rp = norm(r), d0 = (norm(v) - Math.sqrt(mu / rp)) / accel, L = accel * d0 * d0 / 8;
  if (!(d0 > 0)) return null;
  const dt = Math.min(2, Math.max(0.25, d0 / 100));
  const memo = new Map();
  let warm = null;
  const at = (rs) => {
    if (memo.has(rs)) return memo.get(rs);
    const c = rs > R ? (designCapture({ r, v, mu, R, rc: rs, accel, dt, guess: warm }) ?? (warm ? designCapture({ r, v, mu, R, rc: rs, accel, dt }) : null)) : null;
    if (c) warm = [c.pitch[0], c.pitch[1], c.dur];
    const h = c && Math.abs(rs - rc) > 0.1 ? hohmannCircular(mu, rs, rc) : null;
    const res = c ? { ...c, rs, hohmann: h && { dv1: h.dv1, dv2: h.dv2, total: h.total }, total: c.dv + (h ? h.total : 0) } : null;
    memo.set(rs, res);
    return res;
  };
  const cost = (rs) => at(rs)?.total ?? Infinity;
  const xs = [];
  for (let k = 0; k <= 10; k++) xs.push(rp + L * (-0.5 + 0.25 * k));
  // (rc itself too, which a capture already near it often is best at.)
  let best = xs.concat([rc]).reduce((b, x) => (cost(x) < cost(b) ? x : b), rp);
  if (!Number.isFinite(cost(best))) return null;
  const g = (Math.sqrt(5) - 1) / 2;
  let a = best - 0.25 * L, b = best + 0.25 * L, c1 = b - g * (b - a), c2 = a + g * (b - a);
  for (let i = 0; i < 14; i++) {
    if (cost(c1) < cost(c2)) { b = c2; c2 = c1; c1 = b - g * (b - a); }
    else { a = c1; c1 = c2; c2 = a + g * (b - a); }
  }
  for (const x of [c1, c2]) if (cost(x) < cost(best)) best = x;
  return at(best);
}
