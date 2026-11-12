// src/physics/orientation.test.mjs
//
// Body-fixed axes against CSPICE pxform (J2000 -> ITRF93 / MOON_ME / IAU_*),
// from src/physics/fixtures/spice_reference.json. Errors are the angle of the
// worst axis in degrees, and the equivalent surface distance at the body's
// mean radius.

import fs from 'node:fs';
import { bodyAxesEqj } from './orientation.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/spice_reference.json', import.meta.url)));
const RADIUS_KM = {
  sun: 695700, mercury: 2439.4, venus: 6051.8, earth: 6371.0084, moon: 1737.4, mars: 3389.5,
  jupiter: 69911, saturn: 58232, uranus: 25362, neptune: 24622, pluto: 1188.3,
};
// Tolerances in degrees, about three times what was measured (Nov 2026).
// Earth (ITRF93 also has polar motion and UT1) and the Moon (MOON_ME) carry
// real surface maps; Mars differs by the Konopliv 2026 model against the
// IAU one; the giants by the IAU report astronomy-engine follows.
const TOL_DEG = {
  sun: 0.005, mercury: 0.002, venus: 0.0005, earth: 0.005, moon: 0.012, mars: 0.08,
  jupiter: 0.2, saturn: 0.2, uranus: 0.12, neptune: 0.12, pluto: 0.015,
};

let failed = 0;
const worst = {};
for (const row of fixture.orientation) {
  const [y, mon, d, hms] = row.utc.split(' ');      // "2026 AUG 12 17:45:47 UTC"
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(mon);
  const [hh, mm, ss] = hms.split(':').map(Number);
  const date = new Date(Date.UTC(Number(y), month, Number(d), hh, mm, ss));
  const axes = bodyAxesEqj(row.body, date);
  let maxDeg = 0;
  for (let i = 0; i < 3; i++) {
    const ref = row.m.slice(3 * i, 3 * i + 3);        // row i = body axis i in J2000
    const dot = axes[i][0] * ref[0] + axes[i][1] * ref[1] + axes[i][2] * ref[2];
    maxDeg = Math.max(maxDeg, Math.acos(Math.min(1, dot)) * 180 / Math.PI);
  }
  worst[row.body] = Math.max(worst[row.body] ?? 0, maxDeg);
}

console.log('Body-fixed axes vs CSPICE pxform (4 epochs, 2000 to 2026)');
for (const [body, deg] of Object.entries(worst)) {
  const km = deg * Math.PI / 180 * RADIUS_KM[body];
  const ok = deg <= TOL_DEG[body];
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${body.padEnd(8)} ${deg.toExponential(2)} deg  (${km.toFixed(km < 10 ? 3 : 1)} km at the surface; tolerance ${TOL_DEG[body]} deg)`);
}
console.log(failed ? `RESULT: ${failed} FAILED` : 'RESULT: all checks PASSED');
process.exit(failed ? 1 : 0);
