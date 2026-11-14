// src/physics/orientation.test.mjs
//
// Body-fixed axes against CSPICE pxform (J2000 -> ITRF93 / MOON_ME / IAU_*),
// from src/physics/fixtures/spice_reference.json. Errors are the angle of the
// worst axis in degrees, and the equivalent surface distance at the body's
// mean radius. The planets' 20 major moons (IAU models from pck00011,
// pck.data.js) and every body's triaxial radii (bodvrd_c RADII) as well.
// Then the Earth densely: ITRF93 at 408 instants 2000-2126 (the Earth
// orientation table, eop.js), in metres at the equator.

import './deNode.js';                 // DE442's Earth and Moon, as in the app
import fs from 'node:fs';
import { bodyAxesEqj } from './orientation.js';
import { MOON_DATA } from './moons.data.js';
import { RADII } from './pck.data.js';
import { earthFixedAt } from './environment.js';
import { utcMsAtTt, ttSeconds } from './ephemeris.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/spice_reference.json', import.meta.url)));
const RADIUS_KM = {
  sun: 695700, mercury: 2439.4, venus: 6051.8, earth: 6371.0084, moon: 1737.4, mars: 3389.5,
  jupiter: 69911, saturn: 58232, uranus: 25362, neptune: 24622, pluto: 1188.3,
};
for (const [k, m] of Object.entries(MOON_DATA)) RADIUS_KM[k] = m.radiusKm;
// Tolerances in degrees, about three times what was measured (Nov 2026).
// Earth (ITRF93, with UT1 and polar motion from eop.js; checked in metres
// below) and the Moon (MOON_ME) carry real surface maps; Mars differs by
// the Konopliv 2026 model against the IAU one; the giants by the IAU report
// astronomy-engine follows.
const TOL_DEG = {
  sun: 0.005, mercury: 0.002, venus: 0.0005, earth: 4e-7, moon: 0.012, mars: 0.08,
  jupiter: 0.2, saturn: 0.2, uranus: 0.12, neptune: 0.12, pluto: 0.015,
};
// The moons are SPICE's own model, so only TT for TDB (under 2 ms) and
// rounding remain: 1.9e-5 deg at worst (Phobos), measured Nov 2026.
for (const k of Object.keys(MOON_DATA)) TOL_DEG[k] = 1e-4;

// The angle between two unit vectors, by atan2: acos loses half the digits
// near 0 (1.5e-8 rad, 9 cm on the Earth).
const angle = (a, b) => {
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
};
// The worst of the three body axes against a row-major SPICE matrix (rad).
const worstAxis = (axes, m) => Math.max(...[0, 1, 2].map((i) => angle(axes[i], m.slice(3 * i, 3 * i + 3))));

let failed = 0;
const worst = {};
for (const row of fixture.orientation) {
  const [y, mon, d, hms] = row.utc.split(' ');      // "2026 AUG 12 17:45:47 UTC"
  const month = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'].indexOf(mon);
  const [hh, mm, ss] = hms.split(':').map(Number);
  const date = new Date(Date.UTC(Number(y), month, Number(d), hh, mm, ss));
  // Row i of the SPICE matrix is body axis i in J2000.
  const maxDeg = worstAxis(bodyAxesEqj(row.body, date), row.m) * 180 / Math.PI;
  worst[row.body] = Math.max(worst[row.body] ?? 0, maxDeg);
}

console.log('Body-fixed axes vs CSPICE pxform (4 epochs, 2000 to 2026)');
for (const [body, deg] of Object.entries(worst)) {
  const km = deg * Math.PI / 180 * RADIUS_KM[body];
  const ok = deg <= TOL_DEG[body];
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${body.padEnd(8)} ${deg.toExponential(2)} deg  (${km.toFixed(km < 10 ? 3 : 1)} km at the surface; tolerance ${TOL_DEG[body]} deg)`);
}
// The ellipsoids pck.build.mjs extracted, against SPICE's own reading.
let radiiWorst = 0;
for (const [body, ref] of Object.entries(fixture.radii)) {
  const r = RADII[body];
  if (!r) { failed++; console.log(`  FAIL  no radii for ${body}`); continue; }
  for (let i = 0; i < 3; i++) radiiWorst = Math.max(radiiWorst, Math.abs(r[i] - ref[i]));
}
const radiiOk = radiiWorst < 1e-9 && Object.keys(fixture.radii).length === Object.keys(RADII).length;
if (!radiiOk) failed++;
console.log(`  ${radiiOk ? 'PASS' : 'FAIL'}  radii of ${Object.keys(fixture.radii).length} bodies vs bodvrd_c: worst ${radiiWorst.toExponential(1)} km`);

// ---- The Earth, densely ----
// Up to the end of the high-precision file (measured EOP, then JPL's
// three-month prediction), the table should be NAIF's ITRF93 to the
// centimetre: its fit is good to 4 mm, and four-point interpolation of
// daily values and Float32 storage add the rest. After it, SPICE turns to
// NAIF's long-term file, made from older data (Aug 2026), which the table
// joins onto the newer instead (eop.build.mjs): there the difference is that
// offset, 177 ms of UT1 and 0.18" of polar motion (85 m), and it should hold
// steady to within the nutation corrections' turn with the sky.
const R_EQ = 6378.137e3;                  // m
const hpEnd = Date.parse(fixture.earth.high_prec_end_utc + 'Z');
const err = { hp: [], tail: [] };
let worstAt = '';
for (const row of fixture.earth.rows) {
  const ms = Date.parse(row.utc + 'Z');
  const m = worstAxis(bodyAxesEqj('earth', new Date(ms)), row.m) * R_EQ;
  const seg = ms <= hpEnd ? 'hp' : 'tail';
  if (seg === 'hp' && m > Math.max(...err.hp, 0)) worstAt = row.utc;
  err[seg].push(m);
}
const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return { n: a.length, max: s[s.length - 1], min: s[0], rms: Math.sqrt(a.reduce((t, x) => t + x * x, 0) / a.length) };
};
const hp = stats(err.hp), tail = stats(err.tail);
const TOL_HP_M = 0.1, TAIL_M = [70, 100], TAIL_SPREAD_M = 0.1;
console.log(`Earth (ITRF93, ${fixture.earth.rows.length} instants 2000-2126), metres at the equator`);
const check = (ok, text) => { if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${text}`); };
check(hp.max <= TOL_HP_M, `to ${fixture.earth.high_prec_end_utc.slice(0, 10)} (${hp.n} instants, leap seconds among them): worst ${(hp.max * 100).toFixed(2)} cm (${worstAt}), rms ${(hp.rms * 100).toFixed(2)} cm; tolerance ${TOL_HP_M * 100} cm`);
check(tail.min >= TAIL_M[0] && tail.max <= TAIL_M[1] && tail.max - tail.min <= TAIL_SPREAD_M,
  `after it (${tail.n} instants, against NAIF's Aug 2026 long-term file): ${tail.min.toFixed(2)} to ${tail.max.toFixed(2)} m, the junction's offset; expected ${TAIL_M[0]}-${TAIL_M[1]} m, steady to ${TAIL_SPREAD_M} m`);

// The craft's gravity field, drag and entry take the Earth from
// environment.js, which computes it once an hour and spins it in between:
// the same Earth as the scene and the launch sites, but for the nutation
// within half an hour (its fortnightly term moves the pole and the equinox
// by up to 1.5e-8 rad, 9 cm).
{
  const epochMs = Date.UTC(2026, 3, 1, 22, 35, 12), fixed = earthFixedAt(epochMs), tt0 = ttSeconds(epochMs);
  let worstM = 0;
  for (let t = 0; t <= 3 * 86400; t += 997) {
    const M = fixed(t), axes = bodyAxesEqj('earth', new Date(utcMsAtTt(tt0 + t)));
    worstM = Math.max(worstM, worstAxis(axes, M.flat()) * R_EQ);
  }
  check(worstM <= 0.15, `the craft's Earth (environment.js, hourly with the spin between) against the scene's over 3 days: ${(worstM * 100).toFixed(1)} cm; tolerance 15 cm`);
}

console.log(failed ? `RESULT: ${failed} FAILED` : 'RESULT: all checks PASSED');
process.exit(failed ? 1 : 0);
