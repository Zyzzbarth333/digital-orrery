// src/physics/rocket.test.mjs
//
// Launch vehicles (rocket.js) against Curtis, Orbital Mechanics for
// Engineering Students (4th ed.), chapter 13: the gravity-turn ascent of
// Example 13.3 and the optimal three-stage vehicle of Example 13.7. Then
// the app's own additions: a rotating atmosphere, and the ascent's end
// state in three dimensions.

import { stackPerformance, optimalStaging, ascent, ascentToState, ascentTrack, launchAzimuth, rotationBonus, circularSpeed, deltaVToOrbit, deltaVDeparture, deltaVToApoapsis, levelAscent, EARTH, G0 } from './rocket.js';
import { rvToElements } from './orbital.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const rel = (a, b) => Math.abs(a / b - 1);

header('CASE 1: the rocket equation and a stack');
{
  // Curtis Example 13.2's rocket: 68,000 kg, mass ratio 7, Isp 390 s,
  // thrust 933.91 kN (g0 = 9.81 m/s^2 in the book).
  const prop = 68000 * (1 - 1 / 7);
  const p = stackPerformance([{ name: 'S1', dry: 68000 / 7, prop, isp: 390, thrust: 933910 }], 0, { g0: 9.81 });
  console.log(`  single stage: burn ${p.stages[0].burn.toFixed(1)} s (book 238.8 s), delta-v ${(p.dv / 1000).toFixed(3)} km/s (ln 7 x 3.826 km/s = ${(390 * 9.81 * Math.log(7) / 1000).toFixed(3)})`);
  check('burn time 238.8 s and delta-v c ln n, as Example 13.2', Math.abs(p.stages[0].burn - 238.8) < 0.05 && rel(p.dv, 390 * 9.81 * Math.log(7)) < 1e-12);
  const two = stackPerformance([{ name: 'A', dry: 10000, prop: 90000, isp: 300, thrust: 2e6 }, { name: 'B', dry: 1000, prop: 9000, isp: 450, thrust: 1e5 }], 1000);
  const m0 = 111000, dvA = 300 * G0 * Math.log(m0 / (m0 - 90000)), dvB = 450 * G0 * Math.log(11000 / 2000);
  check('two stages: each stage carries the ones above it, and the spent stage drops', rel(two.dv, dvA + dvB) < 1e-12 && two.liftoff === m0);
}

header("CASE 2: optimal staging, Curtis Example 13.7");
{
  const o = optimalStaging({ dv: 10000, payload: 5000, g0: 9.81, stages: [{ isp: 400, eps: 0.10 }, { isp: 350, eps: 0.15 }, { isp: 300, eps: 0.20 }] });
  console.log(`  eta ${(o.eta * 1000).toFixed(4)} s/km (book 0.4668), mass ratios ${o.n.map((x) => x.toFixed(3)).join(', ')} (book 4.541, 2.507, 1.361)`);
  console.log(`  step masses ${o.step.map((x) => x.toFixed(0)).join(', ')} kg (book 165,700, 18,070, 2,477); total ${o.m0.toFixed(0)} kg (book 191,200); payload fraction ${o.payloadFraction.toFixed(4)} (book 0.0262)`);
  check('eta and the mass ratios to the book\'s four figures', Math.abs(o.eta * 1000 - 0.4668) < 1e-4 && [4.541, 2.507, 1.361].every((x, i) => Math.abs(o.n[i] - x) < 1e-3));
  check('stage masses and total within 0.1 % of the book (which rounds to four figures)', [165700, 18070, 2477].every((x, i) => rel(o.step[i], x) < 1e-3) && rel(o.m0, 191200) < 1e-3);
  check('a minimum, not a maximum (the book\'s second-order test)', o.minimum);
  // The optimum is lighter than any nearby split of the same delta-v.
  const total = (n) => { let above = 5000; const c = [400, 350, 300].map((x) => x * 9.81), e = [0.1, 0.15, 0.2]; for (let i = 2; i >= 0; i--) above += (n[i] - 1) / (1 - n[i] * e[i]) * above; return above; };
  let lighter = 0;
  for (const d of [-0.05, 0.05]) {
    // Move delta-v from stage 1 to stage 2, keeping the total 10 km/s.
    const n1 = o.n[0] * Math.exp(d), n2 = o.n[1] * Math.exp(-d * 400 / 350);
    if (total([n1, n2, o.n[2]]) < o.m0) lighter++;
  }
  check('shifting delta-v between stages only makes the stack heavier', lighter === 0);
  check('beyond what the stages can give, no stack', optimalStaging({ dv: 30000, payload: 5000, stages: [{ isp: 300, eps: 0.1 }] }) === null);
}

header("CASE 3: a gravity-turn ascent, Curtis Example 13.3");
{
  // 68,000 kg, mass ratio 7, Isp 390 s, 933.913 kN; 5 m across, CD 0.5;
  // exponential atmosphere (1.225 kg/m^3, 7.5 km); g0 9.81, RE 6378 km;
  // pitchover at 130 m to 89.85 deg; non-rotating Earth.
  const res = ascent({
    stages: [{ name: 'S1', dry: 68000 / 7, prop: 68000 * (1 - 1 / 7), isp: 390, thrust: 933913 }], payload: 0,
    pitchAlt: 130, gamma0: 89.85, cd: 0.5, diameter: 5, g0: 9.81, R: 6378000, rotation: 0, dt: 0.01,
  });
  const b = res.burnout;
  console.log(`  burnout at ${b.t.toFixed(3)} s: ${(b.v / 1000).toFixed(3)} km/s, gamma ${b.gamma.toFixed(3)} deg, ${(b.h / 1000).toFixed(3)} km up, ${(b.x / 1000).toFixed(3)} km downrange`);
  console.log(`  (book: 238.776 s, 5.737 km/s, 9.154 deg, 110.324 km, 318.364 km)`);
  console.log(`  losses: drag ${(res.losses.drag / 1000).toFixed(3)} km/s, gravity ${(res.losses.gravity / 1000).toFixed(3)} km/s (book 0.298, 1.410); max q ${(res.maxQ.q / 101325).toFixed(3)} atm at ${(res.maxQ.t / 60).toFixed(3)} min, ${(res.maxQ.h / 1000).toFixed(3)} km (book 0.156 atm, 1.110 min, 9.424 km)`);
  check('burnout speed, altitude and downrange within 0.1 % of the book, flight path angle within 0.02 deg', rel(b.v, 5737) < 1e-3 && rel(b.h, 110324) < 1e-3 && rel(b.x, 318364) < 1e-3 && Math.abs(b.gamma - 9.154) < 0.02);
  check('drag and gravity losses within 5 m/s of the book', Math.abs(res.losses.drag - 298) < 5 && Math.abs(res.losses.gravity - 1410) < 5);
  // q is flat near its peak (the book reads it off its own output steps).
  check('maximum dynamic pressure 0.156 atm, within 3 s of the book\'s 1.11 min', Math.abs(res.maxQ.q / 101325 - 0.156) < 0.001 && Math.abs(res.maxQ.t - 66.6) < 3);
}

header("CASE 4: the app's launches: a rotating Earth, and the end state in 3D");
{
  // Due east from 28.5 deg N, the Earth's rotation is worth 408 m/s.
  const bonus = rotationBonus(28.5, 90);
  check('due east from 28.5 deg N, the rotation gives 408 m/s', Math.abs(bonus - 408.3) < 0.5);
  check('the azimuth for 51.6 deg from 28.5 deg N: 44.9 deg (ascending)', Math.abs(launchAzimuth(51.6, 28.5) - 44.9) < 0.1 && launchAzimuth(20, 28.5) === null);
  // A two-stage vehicle flown due east with and without the rotation.
  const stack = { stages: [{ name: '1', dry: 22000, prop: 400000, isp: 311, ispSl: 282, thrust: 7.6e6 }, { name: '2', dry: 4000, prop: 92000, isp: 348, thrust: 9.8e5 }], payload: 10000 };
  const fly = (rotation) => ascent({ ...stack, pitchAlt: 500, gamma0: 89.3, cd: 0.3, diameter: 3.7, rotation, mu: EARTH.mu, R: EARTH.R, dt: 0.05 });
  const still = fly(0), spun = fly(bonus);
  // The gain shows in orbital energy (it can go into height as well as
  // speed): as the extra speed it is worth, sqrt(v^2 + 2 dE) - v.
  const E = (b) => b.v * b.v / 2 - EARTH.mu / b.r;
  const worth = Math.sqrt(still.burnout.v ** 2 + 2 * (E(spun.burnout) - E(still.burnout))) - still.burnout.v;
  console.log(`  two stages due east: energy ${(E(still.burnout) / 1e6).toFixed(2)} MJ/kg without rotation, ${(E(spun.burnout) / 1e6).toFixed(2)} with it: worth ${worth.toFixed(0)} m/s at burnout`);
  // An unguided gravity turn with the same kick flies a different path when
  // the air turns under it, and spends part of the gain climbing, so the
  // gain is real but less than the full 408 m/s a guided launch banks.
  check('the rotating Earth adds energy, worth between 100 and 408 m/s at burnout', worth > 100 && worth < 408);
  // The end state in 3D: the orbit it describes has the plane the azimuth
  // asks for. With the Earth-fixed and J2000 axes the same (identity), a
  // launch from 0 deg longitude.
  const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const az = launchAzimuth(51.6, 28.5);
  const res = ascent({ ...stack, pitchAlt: 500, gamma0: 89.3, cd: 0.3, diameter: 3.7, rotation: rotationBonus(28.5, az), mu: EARTH.mu, R: EARTH.R });
  const s = ascentToState(res, { lat: 28.5, lon: 0, az, earthFixedAtLiftoff: I });
  const el = rvToElements(s.r, s.v, EARTH.mu / 1e9);
  const inc = el.i * 180 / Math.PI;
  console.log(`  launched at azimuth ${az.toFixed(2)} deg: orbit inclination ${inc.toFixed(3)} deg (aimed 51.6); the pad's speed across the plane, steered away: ${s.crossSpeed.toFixed(0)} m/s`);
  check('the 3D state keeps the ascent\'s radius and speed', Math.abs(Math.hypot(...s.r) * 1000 - res.burnout.r) < 1e-6 && Math.abs(Math.hypot(...s.v) * 1000 - res.burnout.v) < 1e-6);
  check('and lies in the plane aimed for: inclination within 0.01 deg of 51.6', Math.abs(inc - 51.6) < 0.01);
  check('a circular orbit at 200 km needs 7.784 km/s', Math.abs(circularSpeed(200e3) - 7784.3) < 0.5);
  // The whole ascent in 3D, for drawing: it starts on the pad, moving with
  // the Earth's surface along the plane, and ends on the burnout state.
  const track = ascentTrack(res, { lat: 28.5, lon: 0, az, earthFixedAtLiftoff: I });
  const pad = [Math.cos(28.5 * Math.PI / 180), 0, Math.sin(28.5 * Math.PI / 180)].map((x) => x * EARTH.R / 1000);
  const last = track.at(-1), d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  console.log(`  track: ${track.length} states; starts ${(d(track[0].r, pad) * 1000).toFixed(3)} m from the pad at ${(Math.hypot(...track[0].v) * 1000).toFixed(1)} m/s; ends ${(d(last.r, s.r) * 1e6).toExponential(1)} mm from the burnout state`);
  check('the track starts on the pad at the rotation\'s speed along the plane, and ends on the burnout state', d(track[0].r, pad) < 1e-6 && Math.abs(Math.hypot(...track[0].v) * 1000 - rotationBonus(28.5, az)) < 1e-6 && d(last.r, s.r) < 1e-9 && d(last.v, s.v) < 1e-12);
  check('every point of the track is at the ascent\'s height', res.history.every((p, i) => Math.abs(Math.hypot(...track[i].r) * 1000 - EARTH.R - p.h) < 1e-6));
}

header('CASE 5: working backwards, from a job to the delta-v and the rocket');
{
  // Hohmann from 200 km to geostationary height: the first burn, by
  // vis-viva at perigee of the transfer ellipse (about 2.455 km/s).
  const gto = deltaVToApoapsis({ h: 200e3, apo: 35786e3 });
  // Escape from 200 km (C3 = 0) is (sqrt(2) - 1) of circular speed.
  const esc = deltaVDeparture({ h: 200e3, c3: 0 });
  console.log(`  from a 200 km parking orbit: to geostationary height ${(gto / 1000).toFixed(3)} km/s, to escape ${(esc / 1000).toFixed(3)} km/s`);
  const r1 = EARTH.R + 200e3, r2 = EARTH.R + 35786e3, visViva = Math.sqrt(EARTH.mu * (2 / r1 - 2 / (r1 + r2))) - Math.sqrt(EARTH.mu / r1);
  check('the GTO burn is the Hohmann first burn by vis-viva (2.455 km/s)', Math.abs(gto - visViva) < 1e-6 && Math.abs(gto - 2455) < 1);
  check('escape from 200 km is (sqrt 2 - 1) times 7.784 km/s', Math.abs(esc - (Math.SQRT2 - 1) * circularSpeed(200e3)) < 1e-6);
  const toLeo = deltaVToOrbit({ h: 200e3, lat: 28.5, az: 90 });
  console.log(`  to a 200 km orbit due east from 28.5 deg N, with 1.5 km/s of losses: ${(toLeo / 1000).toFixed(3)} km/s`);
  check('a 200 km orbit from Florida with typical losses: about 8.9 km/s', Math.abs(toLeo - 8876) < 5);
  // A pitch kick that ends level: a two-stage stack, due east.
  const stack = { stages: [{ name: '1', dry: 22000, prop: 400000, isp: 311, ispSl: 282, thrust: 7.6e6 }, { name: '2', dry: 4000, prop: 92000, isp: 348, thrust: 9.8e5 }], payload: 10000 };
  const lv = levelAscent({ ...stack, pitchAlt: 500, cd: 0.3, diameter: 3.7, rotation: rotationBonus(28.5, 90), mu: EARTH.mu, R: EARTH.R });
  console.log(`  level-ending kick ${lv.gamma0.toFixed(4)} deg: burnout ${(lv.burnout.h / 1000).toFixed(1)} km, ${(lv.burnout.v / 1000).toFixed(3)} km/s, gamma ${lv.burnout.gamma.toFixed(4)} deg; losses gravity ${(lv.losses.gravity / 1000).toFixed(3)}, drag ${(lv.losses.drag / 1000).toFixed(3)} km/s`);
  check('the tuned gravity turn ends level (within 0.01 deg)', Math.abs(lv.burnout.gamma) < 0.01);
  // The same stack (too strong for low orbit) with engine cutoff at orbital
  // speed: a level, nearly circular orbit, with propellant left over.
  const lo = levelAscent({ ...stack, pitchAlt: 500, cd: 0.3, diameter: 3.7, rotation: rotationBonus(28.5, 90), mu: EARTH.mu, R: EARTH.R, toOrbit: true });
  const b = lo.burnout, a = 1 / (2 / b.r - b.v * b.v / EARTH.mu), ecc = Math.abs(1 - b.r / a);
  console.log(`  with cutoff at orbital speed: ${(b.h / 1000).toFixed(1)} km, gamma ${b.gamma.toFixed(4)} deg, eccentricity ${ecc.toExponential(1)}; stage ${lo.remaining.stage + 1} keeps ${(lo.remaining.prop / 1000).toFixed(1)} t of propellant`);
  check('engine cutoff in orbit: level, circular to 1e-3, propellant kept', Math.abs(b.gamma) < 0.01 && ecc < 1e-3 && lo.remaining.prop > 0);
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
