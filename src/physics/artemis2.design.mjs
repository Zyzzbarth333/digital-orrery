// src/physics/artemis2.design.mjs
//
// Our own Artemis II, independent of the flown trajectory: from the orbit
// Orion was in before translunar injection (the launch's result, the one
// input taken from the BET), the kernel designs the injection burn that
// meets NASA's published mission targets, then compares the result with the
// trajectory Orion actually flew. See docs/validation/artemis2.md#our-own-plan.
//
// Published inputs (sources in the docs):
//   flyby: 4,067 mi (6,545.2 km) above the Moon at 23:00:46 UTC, 6 April 2026
//   entry interface: 400,000 ft (121.92 km, WGS84) at 23:53 UTC, 10 April
//   injection burn: 1,274 ft/s planned over 5 min 49 s, about 23:49 UTC
//   engine: OMS-E, 26.7 kN at Isp 315.1 s (NASA's Artemis I engine paper);
//           with the planned burn this fixes Orion's mass at ignition
//
// Method:
//   1. B-plane targeting. The injection burn (three delta-v components in
//      the orbital frame, a finite burn held in that frame, as the real one
//      was) is solved by Newton so the approach to the Moon, 18 h out, has
//      a chosen B-plane aim point and periselene time.
//   2. The free returns that meet the flyby altitude and time form a
//      one-parameter family, the aim point's angle theta. Marching theta,
//      only a narrow band (184 to 186 deg) brings Orion home; within it the
//      member that reaches entry interface at NASA's time is found by
//      bisection. The B-plane distance and time are corrected until the
//      true flyby (not its osculating estimate) meets NASA's.
//   3. Ignition time: NASA gives it to the minute. The design takes the time
//      that needs the least delta-v (a parabola through three designs,
//      refined once), as mission design does.
//
//   node src/physics/artemis2.design.mjs     (about 20 s)
// writes src/physics/fixtures/artemis2_design.json and
// public/missions/artemis2-plan.json (the plan, for the app).
//
//   node src/physics/artemis2.design.mjs --flown-entry-angle
// designs instead with the one figure NASA did not publish, the entry
// flight-path angle, taken from the flown trajectory (-5.919 deg at 121.92
// km), and writes nothing: the test of whether that figure explains the
// remaining differences (it does not; see the docs).

import fs from 'node:fs';
import { createState, advance } from './nbody.js';
import { vnbDirection } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';
import { ORION_ENGINE } from './orion.js';
import { bodyAxesEqj } from './orientation.js';
import { lambert, propagate } from './orbital.js';
import {
  rows, fineRows, nearRows, sys, kt, sub, add, norm, dot, cross, unit, helioOf, geocentric, closest, vnb,
} from './artemis2.lib.mjs';

const FT = 0.3048, MI = 1.609344, G0 = 9.80665;
export const TARGETS = {
  flybyAltKm: 4067 * MI, flybyMs: Date.parse('2026-04-06T23:00:46Z'),
  eiAltKm: 121.92, eiMs: Date.parse('2026-04-10T23:53:00Z'),
  planDvKms: 1274 * FT / 1000, planSeconds: 349, planIgnitionMs: Date.parse('2026-04-02T23:49:00Z'),
};
export const ENGINE = ORION_ENGINE;
const VE = ENGINE.isp * G0 / 1000, MDOT = ENGINE.thrustN / (ENGINE.isp * G0);
export const MASS0 = MDOT * TARGETS.planSeconds / (1 - Math.exp(-TARGETS.planDvKms / VE));
const R_MOON = 1737.4, MU_M = 4902.80, MU_E = 398600.4355, END = Date.parse('2026-04-11T03:00:00Z');
const T_B = TARGETS.flybyMs - 18 * 3600e3;
export const START = rows.find((p) => p.ms >= Date.parse('2026-04-02T23:39:00Z'));

// Altitude above the WGS84 ellipsoid (radius at the geocentric latitude,
// about Earth's pole of date).
const WGS_A = 6378.137, WGS_F = 1 / 298.257223563, WGS_E2 = 2 * WGS_F - WGS_F * WGS_F;
const POLE = sys.bodiesAt(kt(TARGETS.eiMs)).find((b) => b.key === 'earth').pole;
export const altitude = (r) => { const s = dot(r, POLE) / norm(r); return norm(r) - WGS_A * Math.sqrt((1 - WGS_E2) / (1 - WGS_E2 * (1 - s * s))); };
const moonGeo = (ms) => { const m = helioStateEqj('moon', new Date(ms)), e = helioStateEqj('earth', new Date(ms)); return { r: sub(m.r, e.r), v: sub(m.v, e.v) }; };

// The injection burn as the kernel flies it: dv [prograde, in-plane,
// normal] km/s, held in the orbital frame about Earth, at full thrust on the
// rocket equation from ignition until it is delivered.
export function burnOptions(dv, ignitionMs) {
  const mag = norm(dv), dir = dv.map((x) => x / mag), seconds = (MASS0 / MDOT) * (1 - Math.exp(-mag / VE));
  const t0 = kt(ignitionMs), t1 = t0 + seconds, vb = [0, 0, 0];
  const E = sys.bodiesAt(t0).find((b) => b.key === 'earth');
  const thrust = (t, r, out, mid, v) => {
    out[0] = out[1] = out[2] = 0;
    if (mid < t0 || mid >= t1 || !v) return out;
    const e = sys.bodiesAt(t).find((b) => b.key === 'earth'); E.eph.velocity(t, vb);
    const d = vnbDirection(dir, sub(r, e.r), sub(v, vb)), a = ENGINE.thrustN / (MASS0 - MDOT * (t - t0)) / 1000;
    out[0] = a * d[0]; out[1] = a * d[1]; out[2] = a * d[2];
    return out;
  };
  const breakpoints = [];
  for (let t = t0; t < t1; t += 0.25) breakpoints.push(t);
  breakpoints.push(t1);
  return { opts: { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7, extraAccel: thrust, breakpoints }, seconds, mag };
}

// Flown to T_B: the Moon-centred B-plane of the approach (T axis from the
// Moon's orbit normal), and the osculating periselene time.
function bplane(dv, ignitionMs) {
  const { opts } = burnOptions(dv, ignitionMs), st = helioOf(START);
  advance(st, kt(T_B), opts);
  const g = geocentric(st, T_B), m = moonGeo(T_B);
  const r = sub(g.r, m.r), v = sub(g.v, m.v), rn = norm(r), v2 = dot(v, v), vinf2 = v2 - 2 * MU_M / rn;
  if (!(vinf2 > 0)) throw new Error('design: bound to the Moon at the B-plane epoch');
  const h = cross(r, v), eVec = r.map((x, k) => ((v2 - MU_M / rn) * x - dot(r, v) * v[k]) / MU_M), e = norm(eVec);
  const eh = unit(eVec), hh = unit(h), q = cross(hh, eh);
  const S = eh.map((x, k) => x / e + Math.sqrt(e * e - 1) / e * q[k]);
  const K = unit(cross(m.r, m.v)), Tt = unit(cross(S, K)), R = cross(S, Tt);
  const b = norm(h) / Math.sqrt(vinf2), B = cross(S, hh).map((x) => x * b);
  const a = -MU_M / vinf2, F = -Math.acosh(Math.max(1, (1 + rn / Math.abs(a)) / e)) * (dot(r, v) < 0 ? 1 : -1);
  const tPeri = T_B - ((e * Math.sinh(F) - F) / Math.sqrt(MU_M / Math.abs(a) ** 3)) * 1000;
  return { BT: dot(B, Tt), BR: dot(B, R), tPeri, vinf: Math.sqrt(vinf2) };
}

// The whole flight: samples, the closest approach to the Moon, and entry
// interface (bisected to the millisecond).
export function flyDesign(dv, ignitionMs) {
  const { opts, seconds, mag } = burnOptions(dv, ignitionMs), st = helioOf(START);
  const samples = [];
  let ms = START.ms, ei = null;
  while (ms < END) {
    const last = samples.at(-1), r = last ? norm(last.r) : 1e9;
    const step = ms < ignitionMs + 3600e3 ? 60e3 : (ms > TARGETS.flybyMs && r < 70000) ? 20e3 : 600e3;
    const prev = { t: st.t, r: [...st.r], v: [...st.v], primary: st.primary, ms };
    ms += step;
    advance(st, kt(ms), opts);
    const g = geocentric(st, ms), m = moonGeo(ms);
    samples.push({ ms, r: g.r, v: g.v, moonR: m.r, moonV: m.v });
    if (ms > TARGETS.flybyMs && altitude(g.r) < TARGETS.eiAltKm) {
      let lo = prev.ms, hi = ms, gg = g;
      for (let k = 0; k < 24; k++) {
        const mid = (lo + hi) / 2, s = createState(prev.r, prev.v, prev.t);
        s.primary = prev.primary;
        advance(s, kt(mid), opts);
        const gm = geocentric(s, mid);
        if (altitude(gm.r) < TARGETS.eiAltKm) { hi = mid; gg = gm; } else lo = mid;
      }
      ei = { ms: hi, r: gg.r, v: gg.v, speed: norm(gg.v), fpa: Math.asin(dot(gg.r, gg.v) / norm(gg.r) / norm(gg.v)) * 180 / Math.PI };
      break;
    }
  }
  const near = samples.filter((s) => Math.abs(s.ms - TARGETS.flybyMs) < 1.5 * 86400e3);
  const flyby = closest(near, (s) => ({ r: sub(s.r, s.moonR), v: sub(s.v, s.moonV) }));
  return { samples, flyby, ei, seconds, mag };
}

// Newton in three unknowns with a finite-difference Jacobian, steps capped
// at 10 m/s.
function newton3(x, f, tol, maxIt = 40) {
  for (let it = 0; it < maxIt; it++) {
    const y = f(x);
    if (y.every((v, i) => Math.abs(v) < tol[i])) return x;
    const h = 1e-6;
    const J = [0, 1, 2].map((k) => { const xp = [...x]; xp[k] += h; return f(xp).map((v, i) => (v - y[i]) / h); });
    const A = [0, 1, 2].map((i) => [0, 1, 2].map((k) => J[k][i]));
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const D = det(A), dx = [0, 1, 2].map((k) => det(A.map((row, r) => row.map((v, c) => (c === k ? -y[r] : v)))) / D);
    const s = Math.min(1, 0.01 / Math.max(...dx.map(Math.abs)));
    x = x.map((v, i) => v + s * dx[i]);
  }
  return x;
}

// The design for one ignition time. seed: a nearby solution, or null for a
// Lambert first guess (two-body, impulsive, to the Moon's centre).
// entry: which member of the free-return family to take: { by: 'time' }
// (entry interface at NASA's time) or { by: 'fpa', deg } (at a published
// flight-path angle; the entry time is then a result to compare).
export function designFor(ignitionMs, seed = null, entry = { by: 'time' }) {
  let x = seed?.dv;
  if (!x) {
    const tMid = ignitionMs + TARGETS.planSeconds * 500;
    const c0 = propagate(START.r, START.v, (tMid - START.ms) / 1000, MU_E);
    const L = lambert(c0.r, moonGeo(TARGETS.flybyMs).r, (TARGETS.flybyMs - tMid) / 1000, MU_E, true);
    x = vnb(c0.r, c0.v).map((ax) => dot(sub(L.v1, c0.v), ax));
  }
  const p0 = bplane(x, ignitionMs), rp = R_MOON + TARGETS.flybyAltKm;
  let b = seed?.b ?? rp * Math.sqrt(1 + 2 * MU_M / (rp * p0.vinf ** 2)), tp = seed?.tp ?? TARGETS.flybyMs;
  const aim = (deg) => (dv) => { const p = bplane(dv, ignitionMs), th = deg * Math.PI / 180; return [p.BT - b * Math.cos(th), p.BR - b * Math.sin(th), (p.tPeri - tp) / 1000]; };
  // March theta into the band of free returns from outside it.
  if (!seed) for (let deg = 150; deg <= 184; deg += 2) x = newton3(x, aim(deg), [0.5, 0.5, 0.5]);
  let best = null;
  for (let pass = 0; pass < 5; pass++) {
    const memo = new Map();
    const member = (deg) => {
      if (memo.has(deg)) return memo.get(deg);
      x = newton3(x, aim(deg), [0.2, 0.2, 0.2]);
      const f = flyDesign(x, ignitionMs), out = { deg, dv: [...x], f };
      memo.set(deg, out);
      return out;
    };
    const g = (deg) => {
      const m = member(deg);
      if (!m.f.ei) return 1e9;
      return entry.by === 'fpa' ? (m.f.ei.fpa - entry.deg) * 100 : (m.f.ei.ms - TARGETS.eiMs) / 1000;
    };
    let lo = (seed?.theta ?? 184.5) - 0.5, hi = (seed?.theta ?? 184.5) + 2, glo = g(lo), ghi = g(hi);
    if (glo > 0 === ghi > 0) { lo = 184; hi = 186.5; glo = g(lo); ghi = g(hi); }
    for (let k = 0; k < 40 && hi - lo > 1e-5; k++) {
      const mid = (lo + hi) / 2, gm = g(mid);
      if (gm > 0 === glo > 0) { lo = mid; glo = gm; } else { hi = mid; ghi = gm; }
    }
    best = member(Math.abs(glo) < Math.abs(ghi) ? lo : hi);
    const dAlt = TARGETS.flybyAltKm - best.f.flyby.altitude, dT = TARGETS.flybyMs - Date.parse(best.f.flyby.utc);
    if (Math.abs(dAlt) < 0.5 && Math.abs(dT) < 1e3) break;
    b += dAlt * 1.05; tp += dT;
  }
  return { ignitionMs, theta: best.deg, dv: best.dv, b, tp, ...best.f };
}

// The ignition time that needs the least delta-v: a parabola through three
// designs, then once more about its vertex.
export function design(entry = { by: 'time' }) {
  let pts = [Date.parse('2026-04-02T23:49:30Z'), Date.parse('2026-04-02T23:50:10Z'), Date.parse('2026-04-02T23:50:50Z')];
  let seed = null;
  const tried = [];
  const run = (ms) => { const d = designFor(ms, seed, entry); seed = d; tried.push(d); return d; };
  let ds = pts.map(run);
  for (let round = 0; round < 2; round++) {
    const [a, b, c] = ds, [x0, x1, x2] = pts.map((p) => (p - pts[1]) / 1000), [y0, y1, y2] = ds.map((d) => d.mag);
    const den = (x0 - x1) * (x0 - x2) * (x1 - x2);
    const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / den, B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / den;
    const vertex = pts[1] + Math.round((-B / (2 * A)) * 1000);
    const span = (pts[2] - pts[0]) / 4;
    pts = [vertex - span, vertex, vertex + span];
    ds = pts.map(run);
    void a; void b; void c;
  }
  const best = ds.reduce((p, q) => (q.mag < p.mag ? q : p));
  return { best, tried };
}

// Where a geocentric state is over the Earth (geocentric latitude, east
// longitude, from Earth's axes of date) and its speed relative to the
// rotating Earth.
export function surface(ms, r, v) {
  const [X, Y, Z] = bodyAxesEqj('earth', new Date(ms)), w = 7.2921159e-5;
  const vrel = sub(v, cross(Z.map((c) => c * w), r));
  return { lat: Math.asin(dot(unit(r), Z)) * 180 / Math.PI, lon: Math.atan2(dot(r, Y), dot(r, X)) * 180 / Math.PI, speedEarth: norm(vrel) };
}

// How the design compares with the flown trajectory.
export function compareWithFlown(d) {
  const merged = new Map();
  for (const p of [...rows, ...nearRows, ...fineRows]) merged.set(p.ms, p);
  const flown = [...merged.values()].sort((a, b) => a.ms - b.ms);
  const at = (ms) => {
    let i = flown.findIndex((p) => p.ms >= ms);
    if (i <= 0) i = 1;
    const a = flown[i - 1], b = flown[i], h = (b.ms - a.ms) / 1000, u = (ms - a.ms) / 1000 / h;
    const h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
    const d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
    return {
      r: [0, 1, 2].map((k) => h00 * a.r[k] + h10 * h * a.v[k] + h01 * b.r[k] + h11 * h * b.v[k]),
      v: [0, 1, 2].map((k) => d00 * a.r[k] + d10 * a.v[k] + d01 * b.r[k] + d11 * b.v[k]),
    };
  };
  const series = d.samples.filter((s) => s.ms <= flown.at(-1).ms).map((s) => [s.ms, norm(sub(s.r, at(s.ms).r))]);
  // Entry interface of the flown trajectory: its data ends at NASA's entry
  // interface (23:53:24), 129.7 km up; compared there and, for ours, at
  // 121.92 km.
  const last = flown.at(-1), flownEi = { ms: last.ms, r: last.r, v: last.v, alt: altitude(last.r) };
  const farthest = (list) => list.reduce((p, q) => (norm(q.r) > norm(p.r) ? q : p));
  const fo = farthest(d.samples), ff = farthest(rows);
  return {
    series,
    max: Math.max(...series.map((s) => s[1])),
    farthest: { ours: { km: norm(fo.r), ms: fo.ms }, flown: { km: norm(ff.r), ms: ff.ms } },
    flownEi: { ...flownEi, speed: norm(flownEi.v), fpa: Math.asin(dot(flownEi.r, flownEi.v) / norm(flownEi.r) / norm(flownEi.v)) * 180 / Math.PI, ...surface(flownEi.ms, flownEi.r, flownEi.v) },
    oursEi: surface(d.ei.ms, d.ei.r, d.ei.v),
  };
}

export const FLOWN_ENTRY_FPA = -5.919;    // deg, the BET carried down to 121.92 km

if (import.meta.url === `file://${process.argv[1]}` && process.argv.includes('--flown-entry-angle')) {
  const { best, tried } = design({ by: 'fpa', deg: FLOWN_ENTRY_FPA });
  for (const d of tried) console.log(`  ignition ${new Date(d.ignitionMs).toISOString().slice(11, 19)}: ${(d.mag * 1000).toFixed(3)} m/s`);
  console.log(`at the flown entry angle: ignition ${new Date(best.ignitionMs).toISOString().slice(11, 19)}, ${(best.mag * 1e6 / 304.8).toFixed(1)} ft/s over ${best.seconds.toFixed(1)} s, direction ${best.dv.map((v) => (v / best.mag).toFixed(3)).join(' ')}; entry ${new Date(best.ei.ms).toISOString().slice(11, 19)} at ${best.ei.fpa.toFixed(3)} deg; flyby ${best.flyby.altitude.toFixed(2)} km at ${best.flyby.utc.slice(11, 19)}`);
} else if (import.meta.url === `file://${process.argv[1]}`) {
  const t0 = performance.now();
  const { best, tried } = design();
  const cmp = compareWithFlown(best);
  const ftps = (kms) => kms * 1e6 / 304.8;
  for (const d of tried) console.log(`  ignition ${new Date(d.ignitionMs).toISOString().slice(11, 19)}: ${(d.mag * 1000).toFixed(3)} m/s`);
  console.log(`\nour plan: ignition ${new Date(best.ignitionMs).toISOString().slice(11, 19)}, ${(best.mag * 1000).toFixed(2)} m/s (${ftps(best.mag).toFixed(1)} ft/s) over ${best.seconds.toFixed(1)} s, direction ${best.dv.map((v) => (v / best.mag).toFixed(3)).join(' ')}`);
  console.log(`  flyby ${best.flyby.altitude.toFixed(2)} km at ${best.flyby.utc.slice(11, 19)}; entry interface ${new Date(best.ei.ms).toISOString().slice(11, 19)}, ${best.ei.speed.toFixed(4)} km/s at ${best.ei.fpa.toFixed(2)} deg`);
  console.log(`  from the flown path: at most ${cmp.max.toFixed(0)} km; farthest from Earth ${cmp.farthest.ours.km.toFixed(0)} km (flown ${cmp.farthest.flown.km.toFixed(0)} km)`);
  console.log(`  flown entry interface ${new Date(cmp.flownEi.ms).toISOString().slice(11, 19)}, ${cmp.flownEi.speed.toFixed(4)} km/s at ${cmp.flownEi.fpa.toFixed(2)} deg, ${cmp.flownEi.alt.toFixed(1)} km up, ${cmp.flownEi.lat.toFixed(2)} ${cmp.flownEi.lon.toFixed(2)}, Earth-relative ${cmp.flownEi.speedEarth.toFixed(4)} km/s`);
  console.log(`  our entry interface: ${cmp.oursEi.lat.toFixed(2)} ${cmp.oursEi.lon.toFixed(2)}, Earth-relative ${cmp.oursEi.speedEarth.toFixed(4)} km/s`);
  const out = {
    note: 'Artemis II designed by artemis2.design.mjs from the pre-TLI orbit and NASA\'s published targets; no BET data after the start',
    mass0Kg: MASS0, ignitionMs: best.ignitionMs, dvKms: best.dv, theta: best.theta, seconds: best.seconds,
    flyby: best.flyby, ei: { ms: best.ei.ms, speed: best.ei.speed, fpa: best.ei.fpa, r: best.ei.r, v: best.ei.v },
    tried: tried.map((d) => ({ ignitionMs: d.ignitionMs, dvKms: d.mag })),
    comparison: { max: cmp.max, farthest: cmp.farthest, flownEi: cmp.flownEi, oursEi: cmp.oursEi, series: cmp.series },
  };
  fs.writeFileSync(new URL('./fixtures/artemis2_design.json', import.meta.url), JSON.stringify(out));
  // The plan as a mission file for the app: the same start, the flown path
  // taken from artemis2.json (flownFrom),
  // with our injection burn (5 s intervals on the rocket equation, held in
  // the orbital frame) as its only burn.
  const mission = JSON.parse(fs.readFileSync(new URL('../../public/missions/artemis2.json', import.meta.url)));
  const intervals = [];
  for (let s0 = 0; s0 < best.seconds; s0 += 5) {
    const s1 = Math.min(best.seconds, s0 + 5), mid = (s0 + s1) / 2, a = ENGINE.thrustN / (MASS0 - MDOT * mid);
    intervals.push([best.ignitionMs + s0 * 1000, best.ignitionMs + s1 * 1000, ...best.dv.map((x) => Math.round(x / best.mag * 1e6) / 1e6), Math.round(a * 1e6) / 1e6]);
  }
  const { flown, ...rest } = mission;
  void flown;
  const plan = {
    ...rest, name: 'Artemis II plan', craft: 'Orion (our plan)', flownFrom: 'artemis2',
    summary: 'Artemis II as this simulator designs it from the pre-TLI orbit and NASA\'s published targets, with no flown-trajectory data after the start; flown beside the real path.',
    source: 'designed by src/physics/artemis2.design.mjs; flown path: JSC BET revF',
    burns: [{ key: 'TLI', name: 'Translunar injection (our plan)', mps: Math.round(best.mag * 1e6) / 1e3, nasa: 'planned 1,274 ft/s and 5 min 49 s (NASA)', intervals }],
  };
  fs.writeFileSync(new URL('../../public/missions/artemis2-plan.json', import.meta.url), JSON.stringify(plan));
  console.log(`(${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}
