// src/physics/realMission.js
//
// A real mission the app can fly (public/missions/*.json, written by e.g.
// artemis2.export.mjs): the craft's flown state at the start, its burns as
// flown, and the flown trajectory, to compare against and to take tracking
// fixes from. Pure: no DOM; the app's Mission (src/app/mission.ts) wraps it.
//
// Times are Unix milliseconds (UTC); states are geocentric J2000 equatorial
// km, km/s, converted to the kernel's heliocentric frame with the app's
// Earth.

import { helioStateEqj } from './ephemeris.js';
import { kernelSeconds } from './kernelHost.js';

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

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

  // The scripted burns for Craft.setScript: kernel seconds, m/s^2.
  script() {
    return this.burns.flatMap((b) => b.intervals.map(([t0, t1, p, i, n, a]) => ({
      t0: kernelSeconds(new Date(t0)), t1: kernelSeconds(new Date(t1)), dir: [p, i, n], accel: a,
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
    const v = [0, 1, 2].map((k) => d00 * a[1 + k] + d10 * a[4 + k] + d01 * b[1 + k] + d11 * b[4 + k]);
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
