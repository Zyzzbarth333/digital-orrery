// src/physics/surfaceClamp.test.mjs
//
// clampAboveSurface (surfaceClamp.js): a camera below or on a body's
// ellipsoid comes out to the margin above it, along the line from the
// centre; one already above is left alone.

import { clampAboveSurface } from './surfaceClamp.js';

let failed = 0;
const check = (ok, text) => { if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${text}`); };
console.log('Keeping the camera out of a body (WGS-84 Earth)');
const R = [6378.137, 6378.137, 6356.752], I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], C = [1e8, -2e7, 3e6];
// A tilted frame: the body's axes turned 30 deg about x.
const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6), T = [[1, 0, 0], [0, c, s], [0, -s, c]];
const at = (dir, h, axes = I) => { const p = dir.map((x) => x / Math.hypot(...dir)); const loc = p.map((x, i) => x * R[i]); const q = 1 / Math.hypot(...loc.map((x, i) => x / R[i] ** 2)); const r = 1 / Math.sqrt(p.reduce((a, x, i) => a + (x / R[i]) ** 2, 0)); const w = [0, 1, 2].map((j) => axes.reduce((a, ax, i) => a + ax[j] * p[i], 0)); return C.map((x, j) => x + w[j] * (r + h)); };
const alt = (pt, axes = I) => { const rel = pt.map((x, i) => x - C[i]), d = Math.hypot(...rel); const u = axes.map((ax) => (rel[0] * ax[0] + rel[1] * ax[1] + rel[2] * ax[2]) / d); return d - 1 / Math.sqrt(u.reduce((a, x, i) => a + (x / R[i]) ** 2, 0)); };
const m = 0.005;
check(clampAboveSurface(at([1, 0, 0], 1.6), C, I, R, m) === null, 'a camera 1.6 km above the equator is left alone');
check(clampAboveSurface(at([0, 0, 1], 0.5), C, I, R, m) === null, 'a camera 0.5 km above the pole is left alone');
const under = clampAboveSurface(at([1, 0, 0], -1.9), C, I, R, m);
check(!!under && Math.abs(alt(under) - m) < 1e-6, `1.9 km under the equator comes out to ${under ? (alt(under) * 1000).toFixed(3) : '-'} m up (the margin, 5 m)`);
const pole = clampAboveSurface(at([0, 0, 1], -10), C, I, R, m);
check(!!pole && Math.abs(alt(pole) - m) < 1e-6, 'under the pole, it comes out above the flattened pole (6356.752 km), not the equatorial radius');
const tilted = clampAboveSurface(at([0.3, 0.4, 0.86], -3, T), C, T, R, m);
check(!!tilted && Math.abs(alt(tilted, T) - m) < 1e-6, 'with the body turned, the surface is found along its own axes');
const dirIn = at([0.3, 0.4, 0.86], -3, T).map((x, i) => x - C[i]), dirOut = tilted.map((x, i) => x - C[i]);
const cosA = dirIn.reduce((a, x, i) => a + x * dirOut[i], 0) / Math.hypot(...dirIn) / Math.hypot(...dirOut);
check(cosA > 1 - 1e-15, 'the camera moves straight out from the centre');
console.log('='.repeat(60));
console.log(failed ? `RESULT: ${failed} FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failed ? 1 : 0;
