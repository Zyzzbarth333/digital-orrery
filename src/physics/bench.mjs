// src/physics/bench.mjs
//
// Timing for the parts that run every frame or every kernel request, so
// efficiency work is measured, not guessed. Run: npm run bench
// (Node; a browser on the same machine is usually within a factor of 2.)

import { helioStateEcl } from './ephemeris.js';
import { bodyAxesEqj } from './orientation.js';
const keys = ['mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune','pluto'];
const t0 = Date.UTC(2026, 10, 12);
const time = (label, n, f) => { for (let i = 0; i < 200; i++) f(i); const s = performance.now(); for (let i = 0; i < n; i++) f(i); const us = (performance.now() - s) * 1000 / n; console.log(`${label.padEnd(44)} ${us.toFixed(1)} us`); return us; };
const a = time('10 body states (one frame)', 2000, (i) => { const d = new Date(t0 + i * 16); for (const k of keys) helioStateEcl(k, d); });
const b = time('10 body orientations (one frame)', 2000, (i) => { const d = new Date(t0 + i * 16); for (const k of keys) bodyAxesEqj(k, d); });
const c = time('one orbit line (361 samples x 2 states)', 50, (i) => { for (let j = 0; j <= 360; j++) { const d = new Date(t0 + i * 1e6 + j * 1e7); helioStateEcl('mars', d); helioStateEcl('earth', d); } });
console.log(`per-frame ephemeris + orientation: ${((a + b) / 1000).toFixed(2)} ms of a 16.7 ms frame`);

// Kernel: how much sim time one second of real time buys (warmed up), for
// the Cowell kernel alone and with Encke's method near a primary.
import { advance, createState } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
const sys = solarSystemBodies({ epochMs: Date.UTC(2026, 10, 12) });
const E = sys.bodiesAt(0).find((b) => b.key === 'earth');
const rE = E.eph.position(0), vE = E.eph.velocity(0), MU = E.mu, DAY = 86400;
const orbit = (R, inc) => [[rE[0] + R, rE[1], rE[2]], [vE[0], vE[1] + Math.sqrt(MU / R) * Math.cos(inc), vE[2] + Math.sqrt(MU / R) * Math.sin(inc)]];
const scenarios = [
  ['low Earth orbit (400 km)', ...orbit(6778, 0.4), DAY],
  ['GEO', ...orbit(42164, 0), 10 * DAY],
  ['heliocentric cruise', [rE[0] + 3e6, rE[1], rE[2]], [vE[0], vE[1] + 3, vE[2]], 30 * DAY],
];
for (const [name, r, v, T] of scenarios) {
  const rate = (o) => {
    let best = Infinity, steps = 0;
    for (let k = 0; k < 4; k++) {
      const st = createState(r, v, 0);
      // CPU time of this process, so other load on the machine skews it less.
      const c0 = process.cpuUsage();
      steps = advance(st, T, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e8, ...o }).steps;
      const c1 = process.cpuUsage(c0);
      best = Math.min(best, (c1.user + c1.system) / 1000);
    }
    return { days: (T / DAY) / (best / 1000), steps: steps / (T / DAY) };
  };
  const c = rate({ encke: false }), e = rate({});
  console.log(`kernel ${name.padEnd(26)} Cowell ${c.days.toFixed(0).padStart(6)} sim days/s (${c.steps.toFixed(0)} steps/day)` +
    ` | hybrid ${e.days.toFixed(0).padStart(6)} sim days/s (${e.steps.toFixed(0)} steps/day)`);
}
