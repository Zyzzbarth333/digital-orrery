// src/physics/nbody.test.mjs
//
// Tests for the spacecraft kernel (nbody.js). Cases 1-6 use synthetic bodies
// and need no install; cases 7-9 use the real ephemeris (bodies.js, needs
// `npm install` for astronomy-engine). Run with:
//     node src/physics/nbody.test.mjs

import { advance, createState, accelHeliocentric, heliocentricEnergy } from './nbody.js';
import { propagate, rvToElements } from './orbital.js';

const MU_SUN = 1.32712440041279e11;
const AU = 149597870.7;
const DAY = 86400.0;
let failures = 0;
function check(name, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const noBodies = () => [];
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };

header('CASE 1: Sun only, kernel vs universal-variable propagate');
{
  const cases = [
    { name: 'circular 1 AU, 1 yr', r: [AU, 0, 0], v: [0, Math.sqrt(MU_SUN / AU), 0], T: 365.25 * DAY },
    { name: 'e = 0.6 inclined, 2 orbits', r: [0.6 * AU, 0, 0], v: [0, 0.9 * Math.sqrt(2 * MU_SUN / (0.6 * AU)), 3.0],
      T: null },
    { name: 'hyperbola past 0.5 AU, 200 d', r: [0.5 * AU, 0, 0], v: [0, Math.sqrt(2 * MU_SUN / (0.5 * AU) + 100), 0], T: 200 * DAY, start: -100 * DAY },
  ];
  for (const c of cases) {
    let r0 = c.r, v0 = c.v;
    if (c.start) { const s = propagate(c.r, c.v, c.start, MU_SUN); r0 = s.r; v0 = s.v; }
    const T = c.T ?? 2 * rvToElements(r0, v0, MU_SUN).period;
    const ref = propagate(r0, v0, T, MU_SUN);
    const errFor = (eta) => {
      const st = createState(r0, v0, 0);
      const res = advance(st, T, { bodiesAt: noBodies, muSun: MU_SUN, eta });
      return { err: norm(sub(st.r, ref.r)) / norm(ref.r), steps: res.steps };
    };
    const d = errFor(0.01), f = errFor(0.0025);
    console.log(`  ${c.name.padEnd(30)} default: ${String(d.steps).padStart(5)} steps, rel err ${d.err.toExponential(2)};` +
      `  eta/4: ${String(f.steps).padStart(5)} steps, ${f.err.toExponential(2)}`);
    check(`${c.name}: default step matches propagate (<1e-5)`, d.err < 1e-5);
    // 4th order: a 4x finer step should cut the error about 4^4 = 256x.
    check(`${c.name}: a 4x finer eta cuts the error >100x (got ${(d.err / f.err).toFixed(0)}x)`, d.err / f.err > 100);
  }
}

header('CASE 2: order of accuracy (fixed steps, quarter orbit)');
{
  const r0 = [AU, 0, 0], v0 = [0, 0.9 * Math.sqrt(MU_SUN / AU), 0];
  const T = 0.25 * rvToElements(r0, v0, MU_SUN).period;
  const ref = propagate(r0, v0, T, MU_SUN);
  const errAt = (method, n) => {
    const st = createState(r0, v0, 0);
    advance(st, T, { bodiesAt: noBodies, muSun: MU_SUN, method, fixedStep: T / n });
    return norm(sub(st.r, ref.r));
  };
  for (const [method, order, n] of [['leapfrog', 2, 200], ['yoshida4', 4, 50]]) {
    const ratio = errAt(method, n) / errAt(method, 2 * n);
    const observed = Math.log2(ratio);
    console.log(`  ${method.padEnd(9)} error ratio on halving h = ${ratio.toFixed(2)}  (order ${observed.toFixed(2)})`);
    check(`${method} converges at order ${order} (within 0.15)`, Math.abs(observed - order) < 0.15);
  }
}

header('CASE 3: time reversal and energy');
{
  const r0 = [0.6 * AU, 0, 0], v0 = [0, 1.2 * Math.sqrt(MU_SUN / (0.6 * AU)), 0];
  const P = rvToElements(r0, v0, MU_SUN).period;
  // Forward one orbit and back with the same fixed step: a symmetric method
  // returns to the start up to round-off.
  const st = createState(r0, v0, 0);
  advance(st, P, { bodiesAt: noBodies, muSun: MU_SUN, method: 'yoshida4', fixedStep: P / 2000 });
  advance(st, 0, { bodiesAt: noBodies, muSun: MU_SUN, method: 'yoshida4', fixedStep: P / 2000 });
  const back = norm(sub(st.r, r0));
  console.log(`  yoshida4 one orbit out and back: ${back.toExponential(2)} km (${(back / norm(r0)).toExponential(2)} of |r|)`);
  // 12,000 kicks and drifts each way: round-off alone is about 1e-16 per
  // operation, so the bound is relative, not absolute.
  check('time-reversed run returns to the start (<1e-9 of |r|)', back / norm(r0) < 1e-9);
  // Leapfrog with a fixed step: the energy error oscillates within each orbit
  // but does not grow. Its maximum has to be taken over every step: sampled
  // once per orbit it lands on a drifting phase and looks like growth.
  const lf = createState(r0, v0, 0);
  const E0 = heliocentricEnergy(lf, MU_SUN);
  const h = P / 500;
  const worstOverSteps = (n) => {
    let w = 0;
    for (let k = 0; k < n; k++) {
      advance(lf, lf.t + h, { bodiesAt: noBodies, muSun: MU_SUN, method: 'leapfrog', fixedStep: h });
      w = Math.max(w, Math.abs((heliocentricEnergy(lf, MU_SUN) - E0) / E0));
    }
    return w;
  };
  const early = worstOverSteps(2 * 500);
  advance(lf, lf.t + 96 * P, { bodiesAt: noBodies, muSun: MU_SUN, method: 'leapfrog', fixedStep: h });
  const late = worstOverSteps(2 * 500);
  console.log(`  leapfrog max |dE/E|: orbits 1-2 ${early.toExponential(2)}, orbits 99-100 ${late.toExponential(2)}`);
  check('leapfrog energy error stays bounded (late within 10% of early)', late < 1.1 * early);
}

header('CASE 4: indirect term (heliocentric frame)');
{
  // A planet at 5 AU and a particle 1e5 km from it. The particle's motion
  // relative to the planet is its heliocentric acceleration minus the
  // planet's, -(muSun + muP) rP/|rP|^3. That difference must be the planet's
  // pull plus a small solar tide.
  const muP = 1.26686e8, rP = [5 * AU, 0, 0];
  const d = [0, 1e5, 0];
  const r = [rP[0] + d[0], rP[1] + d[1], rP[2] + d[2]];
  const a = accelHeliocentric(r, [{ mu: muP, r: rP }], MU_SUN);
  const k = -(MU_SUN + muP) / Math.pow(norm(rP), 3);
  const rel = [a[0] - k * rP[0], a[1] - k * rP[1], a[2] - k * rP[2]];
  const twoBody = d.map((x) => -muP * x / Math.pow(norm(d), 3));
  const resid = norm(sub(rel, twoBody)) / norm(twoBody);
  const tideBound = 3 * MU_SUN * norm(d) / Math.pow(norm(rP), 3) / norm(twoBody);
  console.log(`  relative accel vs planet's pull: residual ${resid.toExponential(2)} (solar tide bound ${tideBound.toExponential(2)})`);
  check('relative acceleration = planet pull + tide', resid <= tideBound * 1.01);
}

header('CASE 5: orbit around a moving planet');
{
  // Jupiter-like planet on its own Kepler orbit; a particle in a circular
  // orbit 1e6 km from it, propagated heliocentrically for 5 orbits, must stay
  // close to the planet-centred two-body orbit (they differ by the solar tide).
  const muP = 1.26686e8, aP = 5.2 * AU;
  const pr0 = [aP, 0, 0], pv0 = [0, Math.sqrt((MU_SUN + muP) / aP), 0];
  const planet = { key: 'p', mu: muP, radius: 71492, r: [...pr0] };
  const bodiesAt = (t) => { planet.r = propagate(pr0, pv0, t, MU_SUN + muP).r; return [planet]; };
  const d0 = [1e6, 0, 0], u0 = [0, Math.sqrt(muP / 1e6), 0];
  const P = 2 * Math.PI * Math.sqrt(1e18 / muP);
  const st = createState([pr0[0] + d0[0], d0[1], d0[2]], [pv0[0] + u0[0], pv0[1] + u0[1], u0[2]], 0);
  const res = advance(st, 5 * P, { bodiesAt, muSun: MU_SUN });
  const pl = propagate(pr0, pv0, 5 * P, MU_SUN + muP);
  const relNow = sub(st.r, pl.r);
  const ref = propagate(d0, u0, 5 * P, muP);
  const drift = norm(sub(relNow, ref.r)) / 1e6;
  console.log(`  5 orbits (${(5 * P / DAY).toFixed(1)} d, ${res.steps} steps): drift from two-body ${(drift * 100).toFixed(3)} % of radius`);
  check('stays on the planet-centred orbit to within 1% (solar tide)', drift < 0.01);
  check('primary is the planet', st.primary === 'p');
}

header('CASE 6: events');
{
  const muP = 3.986e5, rP = [AU, 0, 0];
  const planet = { key: 'earthlike', mu: muP, radius: 6371, r: rP };
  const bodiesAt = () => [planet];
  // Dropped toward the planet from 2e5 km: impacts.
  const st = createState([AU + 2e5, 0, 0], [-1, 0, 0], 0);
  const res = advance(st, 10 * DAY, { bodiesAt, muSun: MU_SUN });
  const hit = res.events.find((e) => e.type === 'impact');
  console.log(`  drop from 2e5 km: ${hit ? `impact on ${hit.body} after ${(hit.t / 3600).toFixed(2)} h` : 'no impact'}`);
  check('impact is reported and stops the advance', !!hit && st.t < 10 * DAY);
  // Coming in from 2e6 km: enters the SOI (about 9.2e5 km here).
  const st2 = createState([AU + 2e6, 0, 0], [-3, 0.5, 0], 0);
  const res2 = advance(st2, 5 * DAY, { bodiesAt, muSun: MU_SUN });
  const entry = res2.events.find((e) => e.type === 'primary' && e.to === 'earthlike');
  check('entering the sphere of influence is reported', !!entry);
  // Step budget: running out stops the advance short of tEnd (steps are never
  // stretched, since a stretched step near a planet can pass through it).
  const st3 = createState([AU, 0, 0], [0, 29.78, 0], 0);
  const res3 = advance(st3, 365 * DAY, { bodiesAt: noBodies, muSun: MU_SUN, maxSteps: 50 });
  check('an exhausted budget stops short (complete false, t < tEnd, 50 steps)',
    !res3.complete && st3.t < 365 * DAY && res3.steps === 50);
  // A close flyby inside one long frame (decade-a-second warp): within the
  // app's budget it must match an unlimited run. The old stretching rule
  // flagged this frame after 85 steps and left the velocity 1.4 km/s off.
  // The Sun is switched off here: this planet is held still, so the Sun's pull
  // on the craft alone would move it ~5e5 km during the 4.6-day approach.
  // Miss distance for a 7000 km periapsis at 5 km/s, allowing for gravitational
  // focusing: b = rp sqrt(1 + 2 mu / (rp v^2)).
  const bMiss = 7000 * Math.sqrt(1 + 2 * muP / (7000 * 25));
  const flyby = (maxSteps) => {
    const s = createState([AU + 2e6, bMiss, 0], [-5, 0, 0], 0);
    const r = advance(s, 60 * DAY, { bodiesAt, muSun: 0, maxSteps });
    return { s, r };
  };
  const A = flyby(20000), Bref = flyby(1e7);
  const dvFly = norm(sub(A.s.v, Bref.s.v));
  console.log(`  7000 km flyby in a 60-day frame: ${A.r.steps} steps, complete ${A.r.complete}, |dv| vs unlimited ${dvFly.toExponential(2)} km/s`);
  const minD = (() => { let m = Infinity; const s = createState([AU + 2e6, bMiss, 0], [-5, 0, 0], 0);
    for (let t = 600; t <= 8 * DAY; t += 120) { advance(s, t, { bodiesAt, muSun: 0 }); m = Math.min(m, norm(sub(s.r, rP))); } return m; })();
  console.log(`  closest approach ${minD.toFixed(0)} km (sampled every 2 min over 8 days)`);
  check('the flyby passes near 7000 km from the centre (6500-7500 km)', minD > 6500 && minD < 7500);
  check('a close flyby within budget completes and matches an unlimited run',
    A.r.complete && !A.r.events.some((e) => e.type === 'impact') && dvFly < 1e-9);
  // The Sun is an impact body too (it used to be flown through at 3,000 km/s).
  const st4 = createState([AU, 0, 0], [0, 0.5, 0], 0);
  const res4 = advance(st4, 200 * DAY, { bodiesAt: noBodies, muSun: MU_SUN });
  const sunHit = res4.events.find((e) => e.type === 'impact' && e.body === 'sun');
  check('falling into the Sun is an impact', !!sunHit && Number.isFinite(st4.r[0]));
  // Thrust through extraAccel: constant 1e-5 km/s^2 with no gravity gives
  // r = r0 + v0 t + a t^2 / 2 exactly (every stage sees the same push).
  const acc = [1e-5, 0, 0];
  const st5 = createState([AU, 0, 0], [0, 1, 0], 0);
  advance(st5, DAY, { bodiesAt: noBodies, muSun: 0, extraAccel: (t, r, out) => { out[0] = acc[0]; out[1] = 0; out[2] = 0; return out; } });
  const want = [AU + 0.5 * acc[0] * DAY * DAY, DAY, 0];
  check('constant thrust gives r0 + v0 t + a t^2/2 (<1e-6 km)', norm(sub(st5.r, want)) < 1e-6);
}

// ---- cases that need the real ephemeris (astronomy-engine) ----
const { solarSystemBodies } = await import('./bodies.js');
const { helioStateEqj } = await import('./ephemeris.js');

header('CASE 7: ephemeris interpolation');
{
  // bodies.js serves positions by cubic Hermite interpolation between cached
  // astronomy-engine nodes. Check it against direct calls over 30 days.
  const epochMs = Date.parse('2026-01-01T00:00:00Z');
  const sys = solarSystemBodies({ epochMs });
  let worst = 0, worstKey = '';
  for (let i = 0; i < 400; i++) {
    const t = (i + 0.37) * (30 * DAY / 400);
    for (const b of sys.bodiesAt(t)) {
      const s = helioStateEqj(b.key, new Date(epochMs + t * 1000));
      const e = norm(sub(b.r, s.r));
      if (e > worst) { worst = e; worstKey = b.key; }
    }
  }
  console.log(`  worst interpolation error over 30 days: ${(worst * 1000).toFixed(1)} m (${worstKey})`);
  check('interpolated positions within 0.1 km of direct ephemeris calls', worst < 0.1);
}

header('CASE 8: low Earth orbit with the real Sun, Moon and planets');
{
  // The old integrator ignored any body closer than 0.01 AU, so Earth's own
  // gravity never acted on a craft near Earth. A 400 km circular orbit must
  // now stay close to the geocentric two-body orbit for a day.
  const epochMs = Date.parse('2026-01-01T00:00:00Z');
  const sys = solarSystemBodies({ epochMs });
  const E0 = helioStateEqj('earth', new Date(epochMs));
  const muE = sys.bodiesAt(0).find((b) => b.key === 'earth').mu;
  const rl = 6378.137 + 400, vl = Math.sqrt(muE / rl);
  const d0 = [rl, 0, 0], u0 = [0, vl * Math.cos(0.9), vl * Math.sin(0.9)];
  const st = createState([E0.r[0] + rl, E0.r[1], E0.r[2]], [E0.v[0], E0.v[1] + u0[1], E0.v[2] + u0[2]], 0);
  const t0 = performance.now();
  const res = advance(st, DAY, { bodiesAt: sys.bodiesAt, muSun: sys.muSun });
  const ms = performance.now() - t0;
  const E1 = helioStateEqj('earth', new Date(epochMs + DAY * 1000));
  const rel = sub(st.r, E1.r);
  const ref = propagate(d0, u0, DAY, muE);
  const err = norm(sub(rel, ref.r));
  console.log(`  1 day (${(DAY / (2 * Math.PI * Math.sqrt(rl ** 3 / muE))).toFixed(1)} orbits): ${res.steps} steps in ${ms.toFixed(0)} ms; ` +
    `|r| ${norm(rel).toFixed(1)} km, off two-body by ${err.toFixed(2)} km`);
  check('craft stays in LEO (|r| within 10 km of 6778 km)', Math.abs(norm(rel) - rl) < 10);
  check('within 5 km of the geocentric two-body orbit after a day', err < 5);
  check('primary is earth', st.primary === 'earth');
}

header('CASE 9: escape from the edge of Earth\'s sphere of influence');
{
  // How launches start: on the outbound asymptote at the SOI radius with the
  // speed energy conservation gives for the requested v_inf. After 20 days the
  // speed relative to Earth must have dropped to about v_inf.
  const epochMs = Date.parse('2026-11-04T00:00:00Z');
  const sys = solarSystemBodies({ epochMs });
  const E0 = helioStateEqj('earth', new Date(epochMs));
  const muE = sys.bodiesAt(0).find((b) => b.key === 'earth').mu;
  const R = norm(E0.r) * Math.pow(muE / sys.muSun, 0.4);
  const vinf = 3.0, u = [E0.v[0], E0.v[1], E0.v[2]].map((x) => x / norm(E0.v));
  const s0 = Math.sqrt(vinf * vinf + 2 * muE / R);
  const st = createState(E0.r.map((x, i) => x + R * u[i]), E0.v.map((x, i) => x + s0 * u[i]), 0);
  const res = advance(st, 20 * DAY, { bodiesAt: sys.bodiesAt, muSun: sys.muSun });
  const E1 = helioStateEqj('earth', new Date(epochMs + 20 * DAY * 1000));
  const vrel = norm(sub(st.v, E1.v));
  const left = res.events.find((e) => e.type === 'primary' && e.from === 'earth');
  console.log(`  SOI radius ${R.toFixed(0)} km; start ${s0.toFixed(3)} km/s; after 20 d ${vrel.toFixed(3)} km/s relative to Earth`);
  check('relative speed has fallen to v_inf within 10%', Math.abs(vrel - vinf) / vinf < 0.1);
  check('leaving Earth\'s sphere of influence is reported', !!left);
}

header('CASE 10: kernel host (the Worker\'s message handling)');
{
  const { createKernelHost, KERNEL_EPOCH_MS, kernelSeconds } = await import('./kernelHost.js');
  const host = createKernelHost();
  const t0 = kernelSeconds(new Date('2026-11-04T00:00:00Z'));
  const E0 = helioStateEqj('earth', new Date('2026-11-04T00:00:00Z'));
  const r0 = [E0.r[0] + 6778, E0.r[1], E0.r[2]], v0 = [E0.v[0], E0.v[1] + 7.6686, E0.v[2]];
  const reply = host.handle({ type: 'step', crafts: [
    { id: 7, version: 3, r: r0, v: v0, t: t0, tEnd: t0 + 3600, primary: null, thrust: [0, 0, 0] },
    { id: 8, version: 1, r: r0, v: v0, t: t0, tEnd: t0 + 30 * DAY, primary: null, thrust: [0, 0, 0], maxSteps: 100 },
  ] });
  // The same advance done directly.
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const st = createState(r0, v0, t0);
  advance(st, t0 + 3600, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 20000 });
  const [a, b] = reply.crafts;
  const d = norm(sub(a.r, st.r));
  console.log(`  host vs direct advance: ${d.toExponential(2)} km; ids ${a.id},${b.id}; versions ${a.version},${b.version}`);
  check('host result equals a direct advance (same body set and steps)', d === 0);
  check('id and version pass through unchanged', a.id === 7 && a.version === 3 && b.id === 8 && b.version === 1);
  check('a budget shortfall comes back as complete: false with t < tEnd', !b.complete && b.t < b.tEnd && b.steps === 100);
  check('the result carries the acceleration at the returned state', a.accel.every(Number.isFinite) && norm(a.accel) > 0);
  check('an unknown message is answered with an error, not a throw',
    host.handle({ type: 'nope' }).type === 'error');
}

console.log('='.repeat(60));
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('RESULT: all checks PASSED');
}
