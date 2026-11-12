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

// Kernel: a craft in a 400 km Earth orbit for one hour, and in cruise for 30 days.
import { createKernelHost, KERNEL_EPOCH_MS } from './kernelHost.js';
const host = createKernelHost();
const t = (Date.UTC(2026, 10, 12) - KERNEL_EPOCH_MS) / 1000;
const { helioStateEqj } = await import('./ephemeris.js');
const e = helioStateEqj('earth', new Date(Date.UTC(2026, 10, 12)));
const R = 6778, V = Math.sqrt(398600.4418 / R);
const leo = { id: 1, version: 0, r: [e.r[0] + R, e.r[1], e.r[2]], v: [e.v[0], e.v[1] + V, e.v[2]], t, tEnd: t + 3600 };
const cruise = { id: 2, version: 0, r: [e.r[0] + 3e6, e.r[1], e.r[2]], v: [e.v[0], e.v[1] + 3, e.v[2]], t, tEnd: t + 30 * 86400 };
host.handle({ type: 'step', crafts: [leo] });
for (const [name, req] of [['LEO, 1 h of sim time', leo], ['cruise, 30 d of sim time', cruise]]) {
  const s = performance.now(); const out = host.handle({ type: 'step', crafts: [req] }).crafts[0]; const ms = performance.now() - s;
  console.log(`kernel ${name.padEnd(26)} ${out.steps} steps in ${ms.toFixed(1)} ms = ${(out.steps / ms * 1000 / 1e3).toFixed(0)}k steps/s`);
}
