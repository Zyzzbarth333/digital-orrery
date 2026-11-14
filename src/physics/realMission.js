// src/physics/realMission.js
//
// A real mission the app can fly (public/missions/*.json, written by
// artemis1.export.mjs and artemis2.export.mjs): the craft's flown state at the start, its burns as
// flown, and the flown trajectory, to compare against and to take tracking
// fixes from. Pure: no DOM; the app's Mission (src/app/mission.ts) wraps it.
//
// Times are Unix milliseconds (UTC); states are geocentric J2000 equatorial
// km, km/s, converted to the kernel's heliocentric frame with the app's
// Earth.

import { helioStateEqj } from './ephemeris.js';
import { kernelSeconds, stepCraft } from './kernelHost.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
// A correction aims at the start of the next burn at least this far on (or
// the end of the data): one followed sooner by another (the first of the two
// outbound trims) is flown as it was, and the later one aims for both.
const AIM_MIN_MS = 12 * 3600e3;

export class RealMission {
  // data: the parsed mission file.
  constructor(data) {
    this.data = data;
    this.name = data.name;
    this.startMs = data.start.ms;
    this.endMs = data.endMs;
    this.flown = data.flown;                 // [ms, x, y, z, vx, vy, vz]
    this.burns = data.burns;
  }

  // The craft's heliocentric state at the start, for new Craft().
  startState() {
    const E = helioStateEqj('earth', new Date(this.startMs));
    return { r: add(this.data.start.r, E.r), v: add(this.data.start.v, E.v), t: kernelSeconds(new Date(this.startMs)) };
  }

  // The scripted burns for Craft.setScript: kernel seconds, m/s^2, steered
  // in the orbital frame about the burn's body (b.about, default the Earth).
  script() {
    return this.burns.flatMap((b) => b.intervals.map(([t0, t1, p, i, n, a]) => ({
      t0: kernelSeconds(new Date(t0)), t1: kernelSeconds(new Date(t1)), dir: [p, i, n], accel: a, about: b.about ?? 'earth',
    })));
  }

  // The burn on at ms, or the next one after it. A burn's span is where its
  // thrust is at least half its peak: the injection burn's data starts with
  // ten minutes of smaller thrust (settling pulses of up to a seventh of the
  // main engine's) before the engine lights.
  burnAt(ms) {
    const span = (b) => {
      const peak = Math.max(...b.intervals.map((x) => x[5]));
      const main = b.intervals.filter((x) => x[5] >= 0.5 * peak);
      return [main[0][0], main.at(-1)[1]];
    };
    const on = this.burns.find((b) => { const [a, z] = span(b); return ms >= a && ms < z; });
    if (on) return { burn: on, on: true };
    const next = this.burns.find((b) => span(b)[0] > ms);
    return next ? { burn: next, on: false, inMs: span(next)[0] - ms } : null;
  }

  // The flown geocentric state at ms, by cubic Hermite interpolation between
  // the 10-minute samples (positions and velocities), or null outside them.
  flownAt(ms) {
    const f = this.flown;
    if (ms < f[0][0] || ms > f.at(-1)[0]) return null;
    let lo = 0, hi = f.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (f[m][0] <= ms) lo = m; else hi = m; }
    const a = f[lo], b = f[hi], h = (b[0] - a[0]) / 1000;
    if (!(h > 0)) return { r: a.slice(1, 4), v: a.slice(4, 7) };
    const u = (ms - a[0]) / 1000 / h;
    const h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
    const d00 = (6 * u * u - 6 * u) / h, d10 = 3 * u * u - 4 * u + 1, d01 = (-6 * u * u + 6 * u) / h, d11 = 3 * u * u - 2 * u;
    const r = [0, 1, 2].map((k) => h00 * a[1 + k] + h10 * h * a[4 + k] + h01 * b[1 + k] + h11 * h * b[4 + k]);
    // The cubic's velocity divides the positions' rounding (1 mm) by the
    // interval: 6 mm/s across the 0.26 s between the first two samples, enough
    // for the injection burn to carry to 50 km by the next day. Under a second
    // the samples' own velocities, straight between them, are better (the
    // curve they miss is h^2/8 times the jerk, micrometres a second).
    const v = h < 1
      ? [0, 1, 2].map((k) => (1 - u) * a[4 + k] + u * b[4 + k])
      : [0, 1, 2].map((k) => d00 * a[1 + k] + d10 * a[4 + k] + d01 * b[1 + k] + d11 * b[4 + k]);
    return { r, v };
  }

  // The flown state at ms, heliocentric, for a tracking fix.
  fixAt(ms) {
    const g = this.flownAt(ms);
    if (!g) return null;
    const E = helioStateEqj('earth', new Date(ms));
    return { r: add(g.r, E.r), v: add(g.v, E.v), t: kernelSeconds(new Date(ms)) };
  }

  // How far a heliocentric position is from the flown one at ms (km), or
  // null outside the data.
  distanceFromFlown(rHelio, ms) {
    const g = this.flownAt(ms);
    if (!g) return null;
    const E = helioStateEqj('earth', new Date(ms));
    return Math.hypot(rHelio[0] - E.r[0] - g.r[0], rHelio[1] - E.r[1] - g.r[1], rHelio[2] - E.r[2] - g.r[2]);
  }

  // The tracking fixes due between two clock times, every fixHours from the
  // start (ms of each).
  // The corrections that are aimed from the craft rather than replayed: every
  // burn after the first (the injection burn sets the course; the rest keep
  // it), except one followed within 12 h by another. Each aims at the flown
  // position at the start of the next burn after it, or at the end.
  // { name, atMs, endMs, targetMs }: the burn's first and last instants.
  aims() {
    if (this._aims) return this._aims;
    const B = this.burns.map((b) => ({ name: b.name, atMs: b.intervals[0][0], endMs: b.intervals.at(-1)[1] }));
    this._aims = [];
    for (let k = 1; k < B.length; k++) {
      if (k + 1 < B.length && B[k + 1].atMs - B[k].endMs < AIM_MIN_MS) continue;
      this._aims.push({ ...B[k], targetMs: k + 1 < B.length ? B[k + 1].atMs : this.endMs });
    }
    return this._aims;
  }

  // The correction to add to a burn so the craft, at heliocentric r, v at
  // the burn's start, reaches the flown position at the aim's target time,
  // as a navigation team aims a correction from the tracked state rather
  // than flying the planned one blind. The craft is flown to the target by
  // the kernel (stepCraft, gravity alone) with the scripted burns between
  // (burns: the craft's script), and the velocity change that cancels the
  // miss is found by Newton's method, its sensitivities from three runs each
  // nudged 1 cm/s; it stops within 10 m, or after four rounds, keeping the
  // best. Flying the burns matters: a powered flyby aimed from a coast would
  // take the sensitivities of a path that misses the burn's 180 m/s.
  // sys: the kernel's bodies. Returns { dv (EQJ km/s), miss (km, without
  // it), after (km, with it), off (km and km/s from the flown state) }, or
  // null outside the data or if a trial run fails or hits a body.
  aimCorrection(sys, r, v, aim, burns = []) {
    const x = this.fixAt(aim.atMs), target = this.fixAt(aim.targetMs);
    if (!x || !target) return null;
    const t0 = kernelSeconds(new Date(aim.atMs)), T = target.t;
    const list = burns.filter((b) => !b.aimed && b.t1 > t0 && b.t0 < T);
    const fly = (vv) => {
      const res = stepCraft(sys, { id: 0, version: 0, r: [...r], v: vv, t: t0, tEnd: T, primary: null, burns: list.map((b) => ({ ...b })), maxSteps: 1e6 });
      return res.complete && !res.events.some((e) => e.type === 'impact') ? res.r : null;
    };
    let base = fly([...v]);
    if (!base) return null;
    const miss0 = Math.hypot(...sub(base, target.r));
    let dv = [0, 0, 0], best = { dv, after: miss0 };
    for (let round = 0; round < 4 && best.after > 0.01; round++) {
      const miss = sub(base, target.r), h = 1e-5;
      const cols = [0, 1, 2].map((j) => { const vv = add(v, dv); vv[j] += h; const p = fly(vv); return p && sub(p, base).map((d) => d / h); });
      if (cols.some((c) => !c)) break;
      const A = [0, 1, 2].map((i) => [cols[0][i], cols[1][i], cols[2][i]]), D = det3(A);
      if (!(Math.abs(D) > 0)) break;
      const step = [0, 1, 2].map((k) => det3(A.map((row, i) => row.map((val, c) => (c === k ? -miss[i] : val)))) / D);
      dv = add(dv, step);
      const next = fly(add(v, dv));
      if (!next) break;
      base = next;
      const after = Math.hypot(...sub(base, target.r));
      if (after < best.after) best = { dv, after };
      else break;
    }
    return { dv: best.dv, miss: miss0, after: best.after, off: { km: Math.hypot(...sub(r, x.r)), kms: Math.hypot(...sub(v, x.v)) } };
  }

  // One frame of aimed corrections for craft c (after its clock and any fix,
  // before the kernel is asked): the kernel holds at each correction's start
  // (c.holdAt); once the craft is there the correction is worked out from its
  // own state and added to the burn as flown, spread over the burn; then the
  // kernel runs on to the next. run: { aimNext, aimedDv } kept between frames
  // (the next aim's index; m/s added so far). jumped: the clock was set, so
  // aims after the new time are pending again.
  aimStep(c, sys, run, jumped = false) {
    const aims = this.aims(), at = (i) => kernelSeconds(new Date(aims[i].atMs));
    if (jumped) {
      c.dropAimed(c.kState.t);
      run.aimNext = aims.findIndex((a) => kernelSeconds(new Date(a.atMs)) >= c.kState.t);
      if (run.aimNext < 0) run.aimNext = aims.length;
    }
    while (run.aimNext < aims.length && at(run.aimNext) < c.kState.t - 1e-6) run.aimNext++;
    if (run.aimNext >= aims.length) { c.holdAt = null; return null; }
    const a = aims[run.aimNext];
    if (!(Math.abs(c.kState.t - at(run.aimNext)) < 1e-6)) { c.holdAt = at(run.aimNext); return null; }
    const k = this.aimCorrection(sys, c.kState.r, c.kState.v, a, c.script);
    if (k) {
      const dv = Math.hypot(k.dv[0], k.dv[1], k.dv[2]), span = (a.endMs - a.atMs) / 1000;
      if (dv > 0) c.addScripted({ t0: c.kState.t, t1: c.kState.t + span, dir: k.dv, accel: dv * 1000 / span });
      run.aimedDv += dv * 1000;
      c.note(`${a.name} aimed from the craft: ${(dv * 1000).toFixed(2)} m/s more than flown (${k.off.km.toFixed(1)} km off the flown path; it would miss by ${k.miss.toFixed(0)} km, aimed ${k.after.toFixed(2)} km)`, c.kState.t);
    }
    run.aimNext++;
    c.holdAt = run.aimNext < aims.length ? at(run.aimNext) : null;
    return k;
  }

  fixesBetween(fromMs, toMs, fixHours) {
    if (!fixHours || !(toMs > fromMs)) return [];
    const every = fixHours * 3600e3, out = [];
    for (let k = Math.floor((fromMs - this.startMs) / every) + 1; this.startMs + k * every <= toMs; k++) {
      const ms = this.startMs + k * every;
      if (ms > fromMs && ms <= this.endMs) out.push(ms);
    }
    return out;
  }
}
