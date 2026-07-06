// src/physics/orbital.test.mjs
//
// Node test harness for the orbital-mechanics core. Run with:
//     node src/physics/orbital.test.mjs
// Prints PASS/FAIL with numeric errors for each of the four reference cases
// and exits with code 1 if any case fails.

import { rvToElements, elementsToRv, propagate, lambert, hohmann } from './orbital.js';

const DEG = 180.0 / Math.PI;
let failures = 0;

function vecErr(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}
function norm(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function fmt(v) { return `[${v.map((x) => x.toFixed(5)).join(', ')}]`; }
function check(name, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}

console.log('='.repeat(60));
console.log('CASE 1: Circular LEO propagation');
console.log('='.repeat(60));
{
  const mu = 398600.4418;
  const r0 = [6778.0, 0.0, 0.0];
  const v0 = [0.0, 7.6686, 0.0];
  const el = rvToElements(r0, v0, mu);
  console.log(`  a=${el.a.toFixed(4)} km  e=${el.e.toExponential(4)}  period=${el.period.toFixed(4)} s`);

  const full = propagate(r0, v0, el.period, mu);
  const perr = vecErr(full.r, r0);
  const verr = vecErr(full.v, v0);
  console.log(`  full-period pos err = ${perr.toExponential(4)} km   vel err = ${verr.toExponential(4)} km/s`);

  const q = propagate(r0, v0, el.period / 4.0, mu);
  const ang = Math.atan2(q.r[1], q.r[0]) * DEG;
  console.log(`  quarter-period angle = ${ang.toFixed(4)} deg`);
  check('full-period returns to start (<1 km)', perr < 1.0);
  check('quarter-period ~90 deg', Math.abs(ang - 90.0) < 1.0);
}

console.log('='.repeat(60));
console.log('CASE 2: rv<->elements round trip');
console.log('='.repeat(60));
{
  const mu = 398600.0;
  const r0 = [7000.0, -12124.0, 0.0];
  const v0 = [2.6679, 4.6210, 0.0];
  const el = rvToElements(r0, v0, mu);
  console.log(`  a=${el.a.toFixed(4)} e=${el.e.toFixed(6)} i=${(el.i * DEG).toFixed(4)} ` +
    `raan=${(el.raan * DEG).toFixed(4)} argp=${(el.argp * DEG).toFixed(4)} nu=${(el.nu * DEG).toFixed(4)}`);
  const back = elementsToRv(el, mu);
  const rrel = vecErr(back.r, r0) / norm(r0);
  const vrel = vecErr(back.v, v0) / norm(v0);
  console.log(`  r back = ${fmt(back.r)}`);
  console.log(`  v back = ${fmt(back.v)}`);
  console.log(`  rel pos err = ${rrel.toExponential(3)}   rel vel err = ${vrel.toExponential(3)}`);
  check('round-trip r < 1e-6 relative', rrel < 1e-6);
  check('round-trip v < 1e-6 relative', vrel < 1e-6);
}

console.log('='.repeat(60));
console.log('CASE 3: Lambert (Curtis Example 5.2)');
console.log('='.repeat(60));
{
  const mu = 398600.0;
  const r1 = [5000.0, 10000.0, 2100.0];
  const r2 = [-14600.0, 2500.0, 7000.0];
  const tof = 3600.0;
  const sol = lambert(r1, r2, tof, mu, true);
  const expV1 = [-5.9925, 1.9254, 3.2456];
  const expV2 = [-3.3125, -4.1966, -0.38529];
  console.log(`  v1 = ${fmt(sol.v1)}  expected ${fmt(expV1)}`);
  console.log(`  v2 = ${fmt(sol.v2)}  expected ${fmt(expV2)}`);
  const e1 = vecErr(sol.v1, expV1);
  const e2 = vecErr(sol.v2, expV2);
  console.log(`  v1 err = ${e1.toExponential(4)}   v2 err = ${e2.toExponential(4)}`);
  check('Lambert v1 within 1e-2 km/s', e1 < 1e-2);
  check('Lambert v2 within 1e-2 km/s', e2 < 1e-2);
}

console.log('='.repeat(60));
console.log('CASE 4: Hohmann Earth->Mars (heliocentric)');
console.log('='.repeat(60));
{
  const muSun = 1.32712440018e11;
  const r1 = 1.496e8;
  const r2 = 2.279e8;
  const h = hohmann(r1, r2, muSun);
  const tofDays = h.tof / 86400.0;
  console.log(`  dv1 = ${h.dv1.toFixed(5)} km/s  dv2 = ${h.dv2.toFixed(5)} km/s`);
  console.log(`  total dv = ${h.total.toFixed(5)} km/s   tof = ${tofDays.toFixed(2)} days`);
  check('total dv ~ 5.6 km/s', Math.abs(h.total - 5.6) < 0.2);
  check('tof ~ 259 days', Math.abs(tofDays - 259) < 5);
}

console.log('='.repeat(60));
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('RESULT: all checks PASSED');
}