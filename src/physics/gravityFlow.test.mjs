// src/physics/gravityFlow.test.mjs
//
// The field of every body (gravityFlow.js) and the spin directions
// (spin.js), checked three ways:
//   1. the summed pull at test points against the kernel's own force sum
//      (nbody.js accelHeliocentric, written separately), in the inertial
//      and the falling frame, and the GPU's float32 arithmetic against it;
//   2. the rotating frame's effective potential: its stationary points,
//      found by Newton's method, are the L1-L5 that gravityGuides.js
//      solves for, L1-L3 saddles and L4, L5 peaks;
//   3. each body's turning, from the app's own orientation (orientation.js)
//      differenced in time, against the sign and size of its IAU rate,
//      with Venus, Uranus and Pluto retrograde.
// docs/physics/gravity-guides.md#the-field-of-every-body.
//
//   node src/physics/gravityFlow.test.mjs

import './moonNode.js';
import { fieldAccel, fieldPotential, fallingAccel, rotatingFrame, effectiveAccel, criticalLevels } from './gravityFlow.js';
import { accelHeliocentric } from './nbody.js';
import { bodyConstants, MU_SUN, PLANET_GM } from './bodies.js';
import { helioStateEqj } from './ephemeris.js';
import { MOON_DATA } from './moons.data.js';
import { systemEqj, MOONS_OF } from './moons.js';
import { bodyAxesEqj } from './orientation.js';
import { IAU_W1, spinRate } from './spin.js';
import { PLANETS } from '../utils/constants.js';
import { dot, cross, norm } from './vec.js';

let failed = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const header = (s) => console.log(`\n${s}`);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

// Every body the scene's field sums, heliocentric EQJ: the Sun, the
// planets at their centres with their own GMs, and each moon with a GM.
const date = new Date('2026-11-18T00:00:00Z');
const radius = (k) => PLANETS[k]?.radius ?? MOON_DATA[k]?.radiusKm ?? (k === 'moon' ? 1737.4 : 695700);
const states = { sun: { r: [0, 0, 0], v: [0, 0, 0] } };
for (const k of ['mercury', 'venus', 'earth', 'moon']) states[k] = helioStateEqj(k, date);
for (const p of Object.keys(MOONS_OF)) {
  const bary = helioStateEqj(p, date);
  const { moons, offset } = systemEqj(p, date);
  const c = { r: add(bary.r, offset.r), v: add(bary.v, offset.v) };
  states[p] = c;
  for (const [k, s] of Object.entries(moons)) states[k] = { r: add(c.r, s.r), v: add(c.v, s.v) };
}
const gmOf = (k) => (k === 'sun' ? MU_SUN : PLANET_GM[k] ?? MOON_DATA[k]?.gm ?? (['mercury', 'venus', 'earth', 'moon'].includes(k) ? bodyConstants(k).mu : null));
const bodies = Object.keys(states).filter((k) => gmOf(k)).map((k) => ({ key: k, gm: gmOf(k), r: states[k].r, v: states[k].v, radius: radius(k) }));
const at = (k) => bodies.find((b) => b.key === k);
const T0 = Date.now();
console.log(`${bodies.length} bodies with a GM, ${date.toISOString().slice(0, 10)}`);

// ---------------------------------------------------------------- 1
header('1. The summed pull against the kernel\'s force sum (nbody.js)');
// accelHeliocentric with no indirect terms is the plain sum about the Sun.
const kernelSum = (p, list) => accelHeliocentric(p, list.filter((b) => b.key !== 'sun').map((b) => ({ mu: b.gm, r: b.r })),
  list.some((b) => b.key === 'sun') ? MU_SUN : 0, [0, 0, 0], false);
const towards = (k, from, frac) => add(at(from).r, scale(sub(at(k).r, at(from).r), frac));
const points = [
  ['Earth-Moon, 0.85 of the way', towards('moon', 'earth', 0.85)],
  ['100 km above Ganymede', add(at('ganymede').r, scale(sub(at('jupiter').r, at('ganymede').r), 2731 / norm(sub(at('jupiter').r, at('ganymede').r))))],
  ['between Io and Europa', towards('europa', 'io', 0.5)],
  ['Titan, 0.9 of the way from Saturn', towards('titan', 'saturn', 0.9)],
  ['the main belt, 2.8 au', scale(at('earth').r, 2.8 * 1.495978707e8 / norm(at('earth').r))],
  ['Charon, 0.5 of the way from Pluto', towards('charon', 'pluto', 0.5)],
];
// Float32 as the GPU does it: positions relative to the field's origin (the
// focus) and the sums in single precision.
const f = Math.fround;
function fieldAccel32(p, list, origin) {
  const q = sub(p, origin).map(f);
  let ax = 0, ay = 0, az = 0;
  for (const b of list) {
    const r = sub(b.r, origin).map(f);
    const dx = f(r[0] - q[0]), dy = f(r[1] - q[1]), dz = f(r[2] - q[2]);
    const d2 = f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz));
    const k = f(f(b.gm) / f(d2 * f(Math.sqrt(d2))));
    ax = f(ax + f(k * dx)); ay = f(ay + f(k * dy)); az = f(az + f(k * dz));
  }
  return [ax, ay, az];
}
const focusOf = { 'Earth-Moon, 0.85 of the way': 'earth', '100 km above Ganymede': 'ganymede', 'between Io and Europa': 'jupiter',
  'Titan, 0.9 of the way from Saturn': 'saturn', 'the main belt, 2.8 au': 'sun', 'Charon, 0.5 of the way from Pluto': 'pluto' };
for (const [name, p] of points) {
  const a = fieldAccel(p, bodies), ref = kernelSum(p, bodies);
  const err = norm(sub(a, ref)) / norm(ref);
  check(err < 1e-13, `${name}: |a| ${(norm(a) * 1e3).toPrecision(6)} m/s², ${err.toExponential(1)} from the kernel's sum (within 1e-13)`);
  const g = fieldAccel32(p, bodies, at(focusOf[name]).r);
  const e32 = norm(sub(g, a)) / norm(a);
  check(e32 < 1e-5, `  float32 about ${focusOf[name]}: ${e32.toExponential(1)} (within 1e-5)`);
}
// The falling frame: what remains once the focus's own acceleration is
// taken away, against the kernel's sum differenced the same way.
for (const [name, p, fk] of [['Earth-Moon, 0.85 of the way', points[0][1], 'earth'], ['between Io and Europa', points[2][1], 'jupiter']]) {
  const fi = bodies.findIndex((b) => b.key === fk);
  const a = fallingAccel(p, bodies, fi);
  const ref = sub(kernelSum(p, bodies), kernelSum(bodies[fi].r, bodies.filter((_, i) => i !== fi)));
  const err = norm(sub(a, ref)) / norm(ref);
  check(err < 1e-12, `falling with ${fk}, ${name}: |a| ${(norm(a) * 1e3).toPrecision(6)} m/s², ${err.toExponential(1)} from the kernel's (within 1e-12)`);
}
// In the inertial frame the Sun's pull at the Moon (5.9 mm/s²) is more
// than twice the Earth's (2.7 mm/s²); falling with the Earth only its tide
// is left, a few µm/s².
{
  const ei = bodies.findIndex((b) => b.key === 'earth');
  const sunAtMoon = norm(fieldAccel(at('moon').r, [at('sun')]));
  const earthAtMoon = norm(fieldAccel(at('moon').r, [at('earth')]));
  const tide = norm(sub(fallingAccel(at('moon').r, [at('sun'), at('earth')], 1), fieldAccel(at('moon').r, [at('earth')])));
  check(sunAtMoon > 2 * earthAtMoon && tide < 2 * MU_SUN * 384400 / 1.47e8 ** 3 && ei >= 0,
    `at the Moon: the Sun ${(sunAtMoon * 1e6).toFixed(2)} mm/s², the Earth ${(earthAtMoon * 1e6).toFixed(2)} mm/s²; falling with the Earth only the Sun's tide, ${(tide * 1e9).toFixed(1)} µm/s² (at most 2GM d / D³)`);
}
// Potential and field agree: -grad Phi by central differences.
{
  const p = points[1][1], h = 1;
  const g = [0, 1, 2].map((i) => {
    const e = [0, 0, 0]; e[i] = h;
    return -(fieldPotential(add(p, e), bodies) - fieldPotential(sub(p, e), bodies)) / (2 * h);
  });
  const err = norm(sub(g, fieldAccel(p, bodies))) / norm(g);
  check(err < 1e-6, `-grad Phi = a above Ganymede: ${err.toExponential(1)} (within 1e-6)`);
}
// Inside a body its pull falls linearly to zero at the centre.
{
  const j = at('jupiter');
  const a = norm(fieldAccel(add(j.r, [j.radius / 2, 0, 0]), [j])), surf = j.gm / j.radius ** 2;
  check(Math.abs(a / surf - 0.5) < 1e-12, `half way to Jupiter's centre the pull is ${(a / surf).toFixed(6)} of the surface's (a uniform sphere's 0.5)`);
}

// ---------------------------------------------------------------- 2
console.log(`  (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
header('2. The rotating frame\'s stationary points against gravityGuides.js\'s L1-L5');
const PAIRS = [['sun', 'earth'], ['earth', 'moon'], ['sun', 'jupiter'], ['jupiter', 'ganymede'], ['saturn', 'titan']];
for (const [pk, sk] of PAIRS) {
  const F = rotatingFrame(at(pk), at(sk));
  const L = criticalLevels(F);
  // The in-plane axes of the frame.
  const ex = scale(sub(F.S.r, F.P.r), 1 / F.sep), ey = cross(F.axis, ex);
  let worst = 0;
  const kinds = [];
  for (const k of ['L1', 'L2', 'L3', 'L4', 'L5']) {
    // Newton on the effective acceleration in the plane, from 1 % of the
    // way to the nearer body off the point (or 1 % of the separation).
    const scaleK = k === 'L1' || k === 'L2' ? norm(sub(L[k].r, F.S.r)) : F.sep;
    let x = add(L[k].r, add(scale(ex, 0.01 * scaleK), scale(ey, -0.007 * scaleK)));
    let J;
    for (let it = 0; it < 60; it++) {
      const a = effectiveAccel(x, F);
      const h = 1e-5 * scaleK;
      J = [ex, ey].map((e) => { const ap = effectiveAccel(add(x, scale(e, h)), F), am = effectiveAccel(sub(x, scale(e, h)), F); return [dot(sub(ap, am), ex) / (2 * h), dot(sub(ap, am), ey) / (2 * h)]; });
      // J[j][i]: d a_i / d x_j.  Solve J^T dx = -a.
      const a0 = dot(a, ex), a1 = dot(a, ey);
      const det = J[0][0] * J[1][1] - J[1][0] * J[0][1];
      const dx0 = (-a0 * J[1][1] + a1 * J[1][0]) / det, dx1 = (-a1 * J[0][0] + a0 * J[0][1]) / det;
      x = add(x, add(scale(ex, dx0), scale(ey, dx1)));
      if (Math.hypot(dx0, dx1) < 1e-13 * F.sep) break;
    }
    const off = norm(sub(x, L[k].r)) / F.sep;
    worst = Math.max(worst, off);
    // The Hessian of Phi is -J: a saddle has one eigenvalue of each sign,
    // a peak two negative ones (J's eigenvalues both positive).
    const tr = J[0][0] + J[1][1], det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    kinds.push(det < 0 ? 'saddle' : tr > 0 ? 'peak' : 'well');
  }
  const ok = worst < 1e-9 && kinds.slice(0, 3).every((s) => s === 'saddle') && kinds.slice(3).every((s) => s === 'peak');
  const C = ['L1', 'L2', 'L3', 'L4'].map((k) => L[k].C);
  check(ok, `${pk}-${sk} (mu ${F.mu.toExponential(3)}): L1-L5 within ${worst.toExponential(1)} of the separation, ${kinds.join(', ')}`);
  check(C[0] > C[1] && C[1] > C[2] && C[2] > C[3], `  Jacobi C1 ${C[0].toFixed(6)} > C2 ${C[1].toFixed(6)} > C3 ${C[2].toFixed(6)} > C4 ${C[3].toFixed(6)}`);
}
// Koon, Lo, Marsden and Ross (2011), Earth-Moon, mu = 0.01215: C1 3.1883,
// C2 3.1722, C3 3.0121, C4 = C5 2.9880 (their Jacobi constant, like this
// one, leaves out the constant mu(1 - mu)).
{
  const mu = 0.012150585609624;
  const F = rotatingFrame({ gm: 1 - mu, r: [-mu, 0, 0], v: [0, -mu, 0] }, { gm: mu, r: [1 - mu, 0, 0], v: [0, 1 - mu, 0] });
  const L = criticalLevels(F);
  const want = [3.1883, 3.1722, 3.0121, 2.9880];
  const got = ['L1', 'L2', 'L3', 'L4'].map((k) => L[k].C);
  check(got.every((c, i) => Math.abs(c - want[i]) < 1e-4), `Earth-Moon Jacobi constants ${got.map((c) => c.toFixed(4)).join(', ')} (Koon et al. ${want.join(', ')})`);
}

// ---------------------------------------------------------------- 3
console.log(`  (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
header('3. Spin directions against the IAU rates (orientation.js differenced)');
// The angular velocity of a frame from its axes a minute either side:
// omega = 1/2 sum_i e_i x de_i/dt.
function omegaOf(key, t) {
  const h = 60e3;
  const A = bodyAxesEqj(key, new Date(t - h)), B = bodyAxesEqj(key, new Date(t + h)), C = bodyAxesEqj(key, new Date(t));
  let w = [0, 0, 0];
  for (let i = 0; i < 3; i++) w = add(w, scale(cross(C[i], scale(sub(B[i], A[i]), 1 / (2 * h / 1000))), 0.5));
  return { w, Z: C[2] };
}
const DEG_PER_DAY = (180 / Math.PI) * 86400;
const keys = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto', ...Object.keys(MOON_DATA)];
const t0 = date.getTime();
let signs = 0, sizes = 0, sync = 0, worstSize = 0, worstKey = '';
const badSign = [];
for (const k of keys) {
  const { w, Z } = omegaOf(k, t0);
  const s = spinRate(k);
  if (!s) {
    // No IAU model: turning with its orbit, about the orbit's pole.
    const st = states[k], par = states[MOON_DATA[k].planet];
    const hOrb = cross(sub(st.r, par.r), sub(st.v, par.v));
    if (dot(w, hOrb) > 0) sync++; else badSign.push(k);
    continue;
  }
  const about = dot(w, Z) * DEG_PER_DAY;
  if (Math.sign(about) === Math.sign(s.w1)) signs++; else badSign.push(k);
  const e = Math.abs(about / s.w1 - 1);
  if (e > worstSize) { worstSize = e; worstKey = k; }
  if (e < 0.02) sizes++;
}
const withRate = keys.filter((k) => spinRate(k)).length;
check(badSign.length === 0, `${signs} of ${withRate} bodies turn the way their IAU W1's sign says, ${sync} of ${keys.length - withRate} synchronous ones with their orbit${badSign.length ? `; wrong: ${badSign.join(', ')}` : ''}`);
check(sizes === withRate, `${sizes} of ${withRate} turn at their IAU rate within 2 % (worst ${worstKey}, ${(worstSize * 100).toFixed(2)} %, its forced libration)`);
// Retrograde: the spin against the body's own orbit about the Sun.
const retro = [];
for (const k of ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto']) {
  const { w } = omegaOf(k, t0);
  const st = helioStateEqj(k, date);
  const ob = (Math.acos(dot(w, cross(st.r, st.v)) / (norm(w) * norm(cross(st.r, st.v)))) * 180) / Math.PI;
  if (ob > 90) retro.push(`${k} ${ob.toFixed(1)}°`);
}
check(retro.length === 3 && ['venus', 'uranus', 'pluto'].every((k) => retro.some((r) => r.startsWith(k))),
  `retrograde, with the angle between spin and orbit: ${retro.join(', ')} (Venus 177°, Uranus 98°, Pluto 120°)`);
check(IAU_W1.venus < 0 && IAU_W1.uranus < 0 && IAU_W1.pluto > 0, "Venus's and Uranus's W1 are negative; Pluto's, about its positive pole, is positive");

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
