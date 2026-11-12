// src/physics/artemis2.lib.mjs
//
// Shared pieces of the Artemis II validation (docs/validation/artemis2.md):
// the flown trajectory, Orion's burns reconstructed from it, and the whole
// mission flown by the kernel with those burns as finite, steered engine
// burns, with or without tracking fixes along the way.
//
// Fixtures (from c/artemis2_ref.c, NAIF's SPK of JSC's BET revF):
//   artemis2_bet.json     every 10 minutes, the whole flight
//   artemis2_burns.json   every 5 seconds, in a window around each burn

import './deNode.js';
import fs from 'node:fs';
import { createState, advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';

const load = (name) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const toRows = (f) => f.states.map((s) => ({
  ms: Date.parse(s[0]), seg: s[1], r: s.slice(2, 5), v: s.slice(5, 8), moonR: s.slice(8, 11), moonV: s.slice(11, 14),
}));
export const rows = toRows(load('artemis2_bet.json'));
export const fineRows = toRows(load('artemis2_burns.json'));

export const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
export const kt = (ms) => (ms - KERNEL_EPOCH_MS) / 1000;
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
export const MOON_RADIUS = 1737.4;              // km, IAU mean radius
const FT = 0.3048;

// The local orbital frame about Earth: prograde (along the velocity), the
// in-plane axis prograde x normal (pointing out from Earth near perigee), and
// the orbit normal.
export function vnb(r, v) {
  const V = unit(v), N = unit(cross(r, v));
  return [V, cross(V, N), N];
}

const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 };

// A heliocentric kernel state from a geocentric BET row, on the app's Earth.
export function helioOf(p) {
  const e = helioStateEqj('earth', new Date(p.ms));
  return createState(add(p.r, e.r), add(p.v, e.v), kt(p.ms));
}
export function geocentric(state, ms) {
  const e = helioStateEqj('earth', new Date(ms));
  return { r: sub(state.r, e.r), v: sub(state.v, e.v) };
}
// The BET state carried by the kernel's gravity alone from row a to time ms.
function coast(a, ms) {
  const s = helioOf(a);
  advance(s, kt(ms), opts);
  return geocentric(s, ms);
}

// What NASA published about each burn, for comparison. Times converted from
// EDT (UTC - 4 h). ftps: delta-v in ft/s.
export const NASA_BURNS = [
  { key: 'TLI', name: 'Translunar injection', utc: '2026-04-02T23:49Z', seconds: 350, ftps: 1274, note: 'planned 1,274 ft/s and 5 min 49 s (NASA); fired for 5 min 50 s (Space.com)',
    src: ['https://www.nasa.gov/blogs/missions/2026/04/02/artemis-ii-flight-update-perigee-raise-burn-complete/', 'https://www.space.com/space-exploration/artemis/artemis-2-astronauts-head-for-moon-translunar-injection-burn'] },
  { key: 'OTC', name: 'Outbound correction', utc: '2026-04-06T03:03Z', seconds: 17.5, ftps: null, note: '17.5 s; no delta-v published',
    src: ['https://www.nasa.gov/blogs/missions/2026/04/05/artemis-ii-flight-day-5-correction-burn-complete/'] },
  { key: 'RTC-1', name: 'Return correction 1', utc: '2026-04-08T00:03Z', seconds: 15, ftps: 1.6, note: '15 s, 1.6 ft/s',
    src: ['https://www.nasa.gov/blogs/missions/2026/04/07/artemis-ii-flight-day-7-first-return-correction-burn-complete/'] },
  { key: 'RTC-2', name: 'Return correction 2', utc: '2026-04-10T02:53Z', seconds: 9, ftps: 5.3, note: '9 s, 5.3 ft/s',
    src: ['https://www.nasa.gov/blogs/missions/2026/04/10/artemis-ii-flight-day-9-second-return-correction-burn-complete/'] },
  { key: 'RTC-3', name: 'Return correction 3', utc: null, seconds: 8, ftps: 4.2, note: '8 s, 4.2 ft/s (a secondary source only; not confirmed by NASA)',
    src: ['https://spacetechchronicles.com/artemis-ii-live-tracker/'] },
];

// Reconstruct the burns from the 5-second fixture. For each 5 s interval,
// the BET's state carried across it by the kernel's gravity falls short of
// the next state by the interval's non-gravitational velocity change. An
// interval above 0.3 mm/s^2 belongs to a burn; intervals within 30 s of each
// other are one burn. For each burn:
//   dv      the thrust's total velocity change (vector, km/s): the sum of
//           the intervals' changes
//   dvImpulse, drImpulse   the same burn as one instant change of velocity
//           and position, across its window (for impulsive flight; near
//           perigee the two differ, because gravity along the burning path
//           is not gravity along the coasting one)
//   tMid    when half of it was done
//   seconds from 2 % to 98 % of it, over 0.96 (resolved for the injection
//           burn; the SPK's interpolation spreads a burn of under a minute
//           over about a minute, so shorter burns use NASA's durations)
//   dir     the direction in the local frame (prograde, in-plane, normal)
// The injection burn's acceleration is also fitted to the rocket equation,
// a(t) = a0 / (1 - t/tau): 1/a is linear in t.
export function reconstructBurns() {
  const steps = [];
  for (let i = 0; i + 1 < fineRows.length; i++) {
    const a = fineRows[i], b = fineRows[i + 1];
    if (b.ms - a.ms > 60e3) continue;
    const g = coast(a, b.ms);
    steps.push({ t0: a.ms, t1: b.ms, dv: sub(b.v, g.v), a, b });
  }
  const groups = [];
  let cur = null;
  for (const s of steps) {
    if (norm(s.dv) / ((s.t1 - s.t0) / 1000) < 3e-7) continue;
    if (!cur || s.t0 - cur.at(-1).t1 > 30e3) { cur = []; groups.push(cur); }
    cur.push(s);
  }
  return groups.map((parts) => {
    // The whole change across the burn's window, from the BET alone.
    const before = parts[0].a, after = parts.at(-1).b;
    const g = coast(before, after.ms);
    const dvImpulse = sub(after.v, g.v), drImpulse = sub(after.r, g.r);
    const dv = parts.reduce((acc, x) => add(acc, x.dv), [0, 0, 0]), mag = norm(dv), u = unit(dv);
    let c = 0;
    const cum = [[parts[0].t0, 0]];
    for (const s of parts) { c += dot(s.dv, u); cum.push([s.t1, c]); }
    const when = (f) => {
      for (let i = 1; i < cum.length; i++) {
        if (cum[i][1] >= f * c) { const [t0, c0] = cum[i - 1], [t1, c1] = cum[i]; return t0 + (t1 - t0) * (f * c - c0) / (c1 - c0); }
      }
      return cum.at(-1)[0];
    };
    const tMid = when(0.5);
    const mid = parts.reduce((best, s) => (Math.abs(s.t0 - tMid) < Math.abs(best.t0 - tMid) ? s : best), parts[0]).a;
    const F = vnb(mid.r, mid.v);
    // The burn as flown: each interval's change, as a direction in the local
    // frame at its start and a mean acceleration.
    const profile = parts.map((x) => {
      const L = vnb(x.a.r, x.a.v), m = norm(x.dv), sec = (x.t1 - x.t0) / 1000;
      return { t0: x.t0, t1: x.t1, dir: L.map((ax) => dot(x.dv, ax) / m), a: m / sec };
    });
    const burn = { tMid, profile, seconds: (when(0.98) - when(0.02)) / 1000 / 0.96, dv, dvImpulse, drImpulse, mag, dir: F.map((x) => dot(u, x)), peak: Math.max(...parts.map((s) => norm(s.dv) / ((s.t1 - s.t0) / 1000))) };
    if (mag > 0.1) {    // the injection burn: fit the rocket equation over the full intervals
      const sec = (x) => (x.t1 - x.t0) / 1000;
      const full = parts.filter((x) => norm(x.dv) / sec(x) > 0.5 * burn.peak).slice(1, -1);
      const s0 = full[0].t0, X = full.map((x) => ((x.t0 + x.t1) / 2 - s0) / 1000), Y = full.map((x) => sec(x) / norm(x.dv));
      const n = X.length, mx = X.reduce((p, q) => p + q) / n, my = Y.reduce((p, q) => p + q) / n;
      const slope = X.reduce((p, x, i) => p + (x - mx) * (Y[i] - my), 0) / X.reduce((p, x) => p + (x - mx) ** 2, 0);
      const a0 = 1 / (my - slope * mx), tau = -1 / (slope * a0);
      burn.rocket = { a0, tau, ve: a0 * tau, t0: s0 };
    }
    return burn;
  }).filter((b) => b.mag > 1e-4);    // under 0.1 m/s: attitude control, not burns
}

// Name the reconstructed burns after NASA's, by time.
export function matchNasa(burns) {
  const byTime = [['TLI', '2026-04-02T23:53Z'], ['trim-1', '2026-04-05T01:25Z'], ['trim-2', '2026-04-05T01:40Z'],
    ['OTC', '2026-04-06T03:03Z'], ['RTC-1', '2026-04-08T00:03Z'], ['RTC-2', '2026-04-10T02:53Z'], ['RTC-3', '2026-04-10T18:53Z']];
  return burns.map((b) => {
    const [key] = byTime.reduce((best, x) => (Math.abs(Date.parse(x[1]) - b.tMid) < Math.abs(Date.parse(best[1]) - b.tMid) ? x : best));
    return { ...b, key, nasa: NASA_BURNS.find((n) => n.key === key) ?? null, ftps: b.mag * 1000 / FT };
  });
}

// Finite burns for the kernel, steered in the local frame. Two ways:
//   modelled   one direction (the measured mean) for the whole burn, over
//              NASA's duration where it gave one, at constant acceleration,
//              or for the injection burn on the fitted rocket profile; each
//              scaled to give exactly the measured delta-v.
//   replayed   the burn as flown: each 5 s interval's measured direction
//              and acceleration in turn.
export function finiteBurns(burns, { replay = false } = {}) {
  if (replay) return burns.flatMap((b) => b.profile.map((x) => ({ key: b.key, t0: x.t0, t1: x.t1, dir: x.dir, accel: () => x.a })));
  return burns.map((b) => {
    const seconds = b.rocket ? b.seconds : (b.nasa?.seconds ?? b.seconds);
    const t0 = b.tMid - seconds * 500, t1 = t0 + seconds * 1000;
    if (b.rocket) {
      const { tau } = b.rocket, a0 = b.mag / (-tau * Math.log(1 - seconds / tau));
      return { key: b.key, t0, t1, dir: b.dir, accel: (s) => a0 / (1 - s / tau) };
    }
    const a = b.mag / seconds;
    return { key: b.key, t0, t1, dir: b.dir, accel: () => a };
  });
}

// The thrust function for advance(), and step breakpoints every 5 s inside
// each burn. Earth's velocity comes from its ephemeris.
function thrustOf(finite) {
  const E = sys.bodiesAt(0).find((x) => x.key === 'earth');
  const ve = [0, 0, 0];
  let last = [0, 0, 0];
  return (t, r, out, mid, v) => {
    out[0] = out[1] = out[2] = 0;
    const ms = KERNEL_EPOCH_MS + mid * 1000;
    for (const b of finite) {
      if (ms < b.t0 || ms >= b.t1) continue;
      let d = last;
      if (v) {
        const e = sys.bodiesAt(t).find((x) => x.key === 'earth').r;
        E.eph.velocity(t, ve);
        const F = vnb(sub(r, e), sub(v, ve));
        d = unit([0, 1, 2].map((k) => b.dir[0] * F[0][k] + b.dir[1] * F[1][k] + b.dir[2] * F[2][k]));
        last = d;
      }
      const a = b.accel((ms - b.t0) / 1000);
      out[0] += a * d[0]; out[1] += a * d[1]; out[2] += a * d[2];
    }
    return out;
  };
}

// Fly from `from` to `to` (ISO) through the 10-minute rows, with the burns
// as finite burns (or, with impulsive, each applied at once as its measured
// velocity and position change at the next row), optionally resetting to the
// BET (a tracking fix) every fixHours. Returns per-row geocentric errors.
export function flyMission({ from, to, burns, impulsive = false, replay = false, fixHours = null }) {
  const pts = rows.filter((p) => p.ms >= Date.parse(from) && p.ms <= Date.parse(to));
  const finite = finiteBurns(burns, { replay });
  const breakpoints = impulsive ? null : finite.flatMap((b) => {
    const out = [];
    for (let ms = b.t0; ms < b.t1; ms += 5e3) out.push(kt(ms));
    out.push(kt(b.t1));
    return out;
  }).sort((p, q) => p - q);
  const o = { ...opts, extraAccel: impulsive ? null : thrustOf(finite), breakpoints };
  let st = helioOf(pts[0]);
  const fixEvery = fixHours ? fixHours * 3600e3 : Infinity;
  let nextFix = pts[0].ms + fixEvery;
  const pending = impulsive ? burns.map((b) => ({ ...b, applied: false })) : [];
  const out = [];
  for (const [i, p] of pts.entries()) {
    if (i) advance(st, kt(p.ms), o);
    for (const b of pending) {
      if (!b.applied && b.tMid <= p.ms) { for (let k = 0; k < 3; k++) { st.r[k] += b.drImpulse[k]; st.v[k] += b.dvImpulse[k]; } b.applied = true; }
    }
    const g = geocentric(st, p.ms);
    const m = sub(helioStateEqj('moon', new Date(p.ms)).r, helioStateEqj('earth', new Date(p.ms)).r);
    const mv = sub(helioStateEqj('moon', new Date(p.ms)).v, helioStateEqj('earth', new Date(p.ms)).v);
    out.push({ ms: p.ms, r: g.r, v: g.v, dr: norm(sub(g.r, p.r)), dv: norm(sub(g.v, p.v)) * 1000, moonR: m, moonV: mv, bet: p });
    if (p.ms >= nextFix) { st = helioOf(p); nextFix += fixEvery; }
  }
  return out;
}

// Closest approach to the Moon: the sample with the least distance, refined
// by cubic Hermite interpolation of the Moon-relative state over the
// neighbouring 10-minute intervals.
export function closest(samples, rel) {
  let k = 0;
  samples.forEach((s, i) => { if (norm(rel(s).r) < norm(rel(samples[k]).r)) k = i; });
  let best = { d: Infinity, ms: 0 };
  for (let i = Math.max(0, k - 1); i < Math.min(samples.length - 1, k + 1); i++) {
    const a = rel(samples[i]), b = rel(samples[i + 1]), h = (samples[i + 1].ms - samples[i].ms) / 1000;
    for (let s = 0; s <= 600; s++) {
      const u = s / 600, h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
      const p = [0, 1, 2].map((j) => h00 * a.r[j] + h10 * h * a.v[j] + h01 * b.r[j] + h11 * h * b.v[j]);
      const d = norm(p);
      if (d < best.d) best = { d, ms: samples[i].ms + u * h * 1000 };
    }
  }
  return { altitude: best.d - MOON_RADIUS, utc: new Date(Math.round(best.ms)).toISOString() };
}
export const craftMoon = (s) => ({ r: sub(s.r, s.moonR), v: sub(s.v, s.moonV) });
export const betMoon = (s) => ({ r: sub(s.bet.r, s.moonR), v: sub(s.bet.v, s.moonV) });

// The error along the path (s; positive: ahead) and across it (km).
export function splitError(x) {
  const u = x.bet.v, sp = norm(u), d = sub(x.r, x.bet.r);
  const lead = dot(d, u) / sp / sp;
  return { lead, cross: Math.sqrt(Math.max(0, dot(d, d) - (lead * sp) ** 2)) };
}
