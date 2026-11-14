// src/physics/bench.mjs
//
// Timing for the parts that run every frame or every kernel request, so
// efficiency work is measured, not guessed. Run: npm run bench
// (Node; a browser on the same machine is usually within a factor of 2.)

import './deNode.js';                 // DE442's Earth and Moon, as in the app
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
  ["low Earth orbit (400 km)", ...orbit(6778, 0.4)],
  ["GEO", ...orbit(42164, 0)],
  ["heliocentric cruise", [rE[0] + 3e6, rE[1], rE[2]], [vE[0], vE[1] + 3, vE[2]]],
];
// Steady forward running, as in the app: the clock always moves into new
// days, so ephemeris nodes are fetched as it goes. Advance 90 days in 10-day
// chunks and report the median of the last five (after V8 has compiled the
// hot code), as CPU time of this process (other load skews it less).
const steady = (r, v, o, s = sys) => {
  const st = createState(r, v, 0);
  const perDay = [];
  for (let c = 0; c < 9; c++) {
    const c0 = process.cpuUsage();
    advance(st, st.t + 10 * DAY, { bodiesAt: s.bodiesAt, muSun: s.muSun, maxSteps: 1e8, ...o });
    const u = process.cpuUsage(c0);
    perDay.push((u.user + u.system) / 1000 / 10);
  }
  const tail = perDay.slice(4).sort((a, b) => a - b);
  return 1000 / tail[2];                       // sim days per CPU second
};
for (const [name, r, v] of scenarios) {
  const c = steady(r, v, { encke: false }), e = steady(r, v, {});
  console.log(`kernel ${name.padEnd(26)} Cowell ${c.toFixed(0).padStart(7)} sim days/s | hybrid ${e.toFixed(0).padStart(7)} sim days/s`);
}
// The same without the sixteen asteroids (asteroids: false): what their
// place in every force sum costs.
{
  const bare = solarSystemBodies({ epochMs: Date.UTC(2026, 10, 12), asteroids: false });
  for (const [name, r, v] of [scenarios[0], scenarios[2]]) {
    const c = steady(r, v, { encke: false }, bare), e = steady(r, v, {}, bare);
    console.log(`kernel ${(name + ', no asteroids').padEnd(26)} Cowell ${c.toFixed(0).padStart(7)} sim days/s | hybrid ${e.toFixed(0).padStart(7)} sim days/s`);
  }
}

// Among Jupiter's moons: a craft on a 1.5 million km orbit about Jupiter
// (between Ganymede and Callisto), with the system split into Jupiter and
// its four large moons (the default), and folded up at its barycentre
// (moons: false, as before the moons had gravity). The split costs the
// moons' ephemeris nodes and four more bodies a step.
{
  const epochMs = Date.UTC(2026, 10, 12);
  const jov = (o) => {
    const s = solarSystemBodies({ epochMs, ...o });
    const J = s.bodyAt('jupiter', 0), vJ = J.eph.velocity(0), R = 1.5e6, vc = Math.sqrt(J.mu / R);
    return [s, [J.r[0] + R, J.r[1], J.r[2]], [vJ[0], vJ[1] + vc * 0.9, vJ[2] + vc * 0.3]];
  };
  const run = ([s, r, v], o) => {
    const st = createState(r, v, 0);
    const perDay = [];
    for (let c = 0; c < 9; c++) {
      const c0 = process.cpuUsage();
      advance(st, st.t + 10 * DAY, { bodiesAt: s.bodiesAt, muSun: s.muSun, maxSteps: 1e8, ...o });
      const u = process.cpuUsage(c0);
      perDay.push((u.user + u.system) / 1000 / 10);
    }
    return 1000 / perDay.slice(4).sort((a, b) => a - b)[2];
  };
  for (const [name, o] of [['among Jupiter\'s moons', {}], ['Jupiter, moons folded up', { moons: false }]]) {
    const c = run(jov(o), { encke: false }), e = run(jov(o), {});
    console.log(`kernel ${name.padEnd(26)} Cowell ${c.toFixed(0).padStart(7)} sim days/s | hybrid ${e.toFixed(0).padStart(7)} sim days/s`);
  }
}
