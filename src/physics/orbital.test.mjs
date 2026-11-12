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

// Independent two-body reference for Lambert checks: RK4 with step-doubling
// error control. Deliberately shares no code with orbital.js.
function propagateRK(r0, v0, T, mu, tol = 1e-12) {
  const f = (s) => {
    const rr = Math.hypot(s[0], s[1], s[2]);
    const k = -mu / (rr * rr * rr);
    return [s[3], s[4], s[5], k * s[0], k * s[1], k * s[2]];
  };
  const rk4 = (s, h) => {
    const k1 = f(s);
    const k2 = f(s.map((x, j) => x + 0.5 * h * k1[j]));
    const k3 = f(s.map((x, j) => x + 0.5 * h * k2[j]));
    const k4 = f(s.map((x, j) => x + h * k3[j]));
    return s.map((x, j) => x + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
  };
  let s = [...r0, ...v0];
  let t = 0.0;
  let h = T / 200;
  while (t < T) {
    if (t + h > T) h = T - t;
    const big = rk4(s, h);
    const fine = rk4(rk4(s, 0.5 * h), 0.5 * h);
    const err = vecErr(big.slice(0, 3), fine.slice(0, 3)) / Math.hypot(fine[0], fine[1], fine[2]);
    if (err < tol) {
      s = fine; t += h;
      if (err < tol / 32) h *= 2;
    } else {
      h *= 0.5;
    }
  }
  return s.slice(0, 3);
}

console.log('='.repeat(60));
console.log('CASE 5: Lambert sweep, Earth->Mars-like porkchop grid');
console.log('='.repeat(60));
{
  // Circular Earth (1 AU, ecliptic) and circular Mars (1.5237 AU, 1.85 deg
  // inclined). Departures 0-780 d, TOF 60-500 d covers both Type I and
  // Type II (transfer angle > 180 deg), which the old solver got wrong.
  const mu = 1.32712440018e11, AU = 149597870.7, DAY = 86400.0;
  const rE = AU, rM = 1.5237 * AU, incM = 1.85 / DEG;
  const nE = Math.sqrt(mu / rE ** 3), nM = Math.sqrt(mu / rM ** 3);
  const posE = (t) => [rE * Math.cos(nE * t), rE * Math.sin(nE * t), 0.0];
  const posM = (t) => {
    const th = nM * t + 0.7;
    return [rM * Math.cos(th), rM * Math.sin(th) * Math.cos(incM), rM * Math.sin(th) * Math.sin(incM)];
  };
  let cells = 0, nulls = 0, typeII = 0, worst = 0, worstAt = '';
  for (let dep = 0; dep < 800; dep += 20) {
    for (let tofD = 60; tofD <= 500; tofD += 20) {
      cells++;
      const r1 = posE(dep * DAY), r2 = posM((dep + tofD) * DAY);
      const sol = lambert(r1, r2, tofD * DAY, mu, true);
      if (!sol || !sol.v1.every(Number.isFinite)) { nulls++; continue; }
      if ((r1[0] * r2[1] - r1[1] * r2[0]) < 0) typeII++;
      const err = vecErr(propagateRK(r1, sol.v1, tofD * DAY, mu), r2) / norm(r2);
      if (err > worst) { worst = err; worstAt = `dep ${dep} d, tof ${tofD} d`; }
    }
  }
  console.log(`  cells=${cells}  type II=${typeII}  null=${nulls}`);
  console.log(`  worst endpoint rel err = ${worst.toExponential(3)} (${worstAt})`);
  check('every grid cell solved (no null/NaN)', nulls === 0);
  check('grid includes Type II transfers', typeII > 100);
  check('every solution reaches r2 (<1e-8 relative, independent RK4)', worst < 1e-8);
}

console.log('='.repeat(60));
console.log('CASE 6: Lambert edge cases');
console.log('='.repeat(60));
{
  const mu = 398600.0;
  const r1 = [5000.0, 10000.0, 2100.0];
  const r2 = [-14600.0, 2500.0, 7000.0];
  // Same geometry the long way round (retrograde flag), checked independently.
  const ret = lambert(r1, r2, 3600.0, mu, false);
  const hz = ret ? (r1[0] * ret.v1[1] - r1[1] * ret.v1[0]) : NaN;
  const retErr = ret ? vecErr(propagateRK(r1, ret.v1, 3600.0, mu), r2) / norm(r2) : Infinity;
  console.log(`  retrograde: h_z=${hz.toExponential(3)}  endpoint rel err=${retErr.toExponential(3)}`);
  check('retrograde solution has h_z < 0', hz < 0);
  check('retrograde solution reaches r2 (<1e-8)', retErr < 1e-8);
  // Exactly 180 deg: transfer plane undefined.
  check('180 deg transfer returns null', lambert([7000, 0, 0], [-9000, 0, 0], 5000.0, mu) === null);
  check('zero tof returns null', lambert(r1, r2, 0.0, mu) === null);
  check('negative tof returns null', lambert(r1, r2, -10.0, mu) === null);
  // Very short long-way transfer: must be null or a verified answer, never NaN.
  const fast = lambert(r1, r2, 60.0, mu, false);
  const fastOk = fast === null ||
    vecErr(propagateRK(r1, fast.v1, 60.0, mu), r2) / norm(r2) < 1e-8;
  console.log(`  60 s long-way transfer: ${fast === null ? 'null' : 'solved'}`);
  check('infeasible-looking case is null or verified', fastOk);
}

console.log('='.repeat(60));
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('RESULT: all checks PASSED');
}