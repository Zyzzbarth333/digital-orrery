// src/physics/launchers.test.mjs
//
// The real launchers (launchers.js): their figures add up to what their
// sources state, each reaches orbit in the ascent model with its payload,
// and each flown one is set beside the real flight
// (docs/physics/rocket.md#real-launchers).

import { LAUNCHERS, F9_ASCENT_PROP } from './launchers.js';
import { levelAscent, launchAzimuth, rotationBonus, stackPerformance, surfaceSpeed, EARTH } from './rocket.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const PADS = { ksc: 28.627, mahia: -39.262 };
const by = Object.fromEntries(LAUNCHERS.map((l) => [l.key, l]));
const si = (L) => L.stages.map((s) => ({ name: s.name, dry: s.dry * 1000, prop: s.prop * 1000, isp: s.isp, ispSl: s.ispSl, thrust: s.thrust * 1000 }));
const fly = (L) => {
  const lat = PADS[L.job.pad], az = launchAzimuth(L.job.inc, lat), rotation = rotationBonus(lat, az);
  return { rotation, res: levelAscent({ stages: si(L), payload: L.payload * 1000, pitchAlt: 500, cd: L.cd, diameter: L.diameter, rotation, mu: EARTH.mu, R: EARTH.R, dt: 0.1, sample: 1, toOrbit: true }) };
};
const at = (res, t) => res.history.find((x) => x.t >= t) ?? null;

header('What the figures add up to');
{
  const sv = by['saturn-v'], total = sv.payload + sv.stages.reduce((a, s) => a + s.dry + s.prop, 0);
  console.log(`  Saturn V (Apollo 11): ${total.toFixed(2)} t; Apollo by the Numbers: 6,477,875 lb = ${(6477875 * 0.45359237e-3).toFixed(2)} t`);
  check('Saturn V\'s stages and spacecraft sum to Apollo 11\'s weight at ignition (to 0.01 t)', Math.abs(total - 6477875 * 0.45359237e-3) < 0.01);
  const el = by.electron, m = el.payload + el.stages.reduce((a, s) => a + s.dry + s.prop, 0);
  check('Electron lifts off at its published 13,000 kg', Math.abs(m - 13) < 1e-9);
  const f9 = by['falcon-9-landing'], fx = by['falcon-9'];
  const same = (a, b) => a.stages.every((s, i) => Math.abs(s.dry + s.prop - (b.stages[i].dry + b.stages[i].prop)) < 1e-9);
  check('the landing Falcon 9 carries the same loaded mass as the expendable one, its reserve as dead weight', same(f9, fx) && f9.stages[0].prop === F9_ASCENT_PROP);
}

header('Each reaches orbit in the ascent model with its payload');
for (const L of LAUNCHERS) {
  const perf = stackPerformance(si(L), L.payload * 1000);
  const { res } = fly(L);
  const b = res?.burnout;
  console.log(`  ${L.label}: ${(perf.liftoff / 1000).toFixed(1)} t, T/W ${perf.stages[0].twr.toFixed(2)}, ideal ${(perf.dv / 1000).toFixed(2)} km/s` + (b ? `; in orbit at ${b.t.toFixed(0)} s, ${(b.h / 1000).toFixed(0)} km, ${res.remaining ? `${(res.remaining.prop / 1000).toFixed(1)} t left in ${L.stages[res.remaining.stage].name}` : 'all propellant spent'}` : '; no orbit'));
  check(`${L.label} lifts off (T/W over 1.2) and reaches orbit`, perf.stages[0].twr > 1.2 && !!res);
}

header('Beside the real flights');
{
  // Apollo 11: the S-IC burns its propellant in about the time it did,
  // and the S-IVB keeps about what it kept for the translunar burn.
  const sv = by['saturn-v'], { res } = fly(sv);
  const sic = res.history.findLast((x) => x.stage === 0);
  const real = sv.flown.events[0];
  console.log(`  S-IC: burnout at ${sic.t.toFixed(1)} s, ${(sic.h / 1000).toFixed(1)} km, ${(sic.v / 1000).toFixed(3)} km/s; Apollo 11 ${real.t} s, ${real.h.toFixed(1)} km, ${real.v.toFixed(3)} km/s`);
  check('Saturn V: the S-IC burns out within 3 s of Apollo 11\'s outboard cutoff', Math.abs(sic.t - real.t) < 3);
  check('Saturn V: its speed at S-IC burnout within 10% of Apollo 11\'s', Math.abs(sic.v / 1000 / real.v - 1) < 0.1);
  const kept = res.remaining.prop / 1000, used = sv.stages[2].prop - kept;
  // Apollo 11's S-IVB first burn: 147.13 s; at its rated flow
  // (thrust / (Isp g0)) that is the propellant burned.
  const flow = sv.stages[2].thrust * 1000 / (sv.stages[2].isp * 9.80665) / 1000;
  console.log(`  S-IVB: burns ${used.toFixed(1)} t to orbit here, keeping ${kept.toFixed(1)} t; Apollo 11's 147.13 s first burn at the rated flow is ${(147.13 * flow).toFixed(1)} t`);
  check('Saturn V: the S-IVB burns within 15% of Apollo 11\'s first-burn propellant to reach orbit', Math.abs(used / (147.13 * flow) - 1) < 0.15);
  // Known gap: the model ends level wherever the gravity turn takes it.
  console.log(`  (orbit here at ${(res.burnout.h / 1000).toFixed(0)} km; Apollo 11's guidance flew it to ${sv.flown.events[2].h.toFixed(0)} km: the model has no closed-loop guidance)`);
}
{
  // Falcon 9: the landing preset's ascent propellant is fitted to Demo-1's
  // first-stage cutoff speed; check the fit holds.
  const f9 = by['falcon-9-landing'], { res, rotation } = fly(f9);
  const meco = res.history.findLast((x) => x.stage === 0), vs = surfaceSpeed(meco, rotation) / 1000;
  const real = f9.flown.events[0];
  console.log(`  Falcon 9: first stage out at ${meco.t.toFixed(0)} s, ${(meco.h / 1000).toFixed(1)} km, ${vs.toFixed(3)} km/s over the ground; Demo-1 ${real.t} s, ${real.h} km, ${real.v} km/s`);
  check('Falcon 9 (landing): first-stage cutoff speed within 0.1 km/s of Demo-1\'s', Math.abs(vs - real.v) < 0.1);
  const seco = f9.flown.events[2], o = at(res, Math.min(seco.t, res.burnout.t));
  console.log(`  second stage: in orbit at ${res.burnout.t.toFixed(0)} s, ${(res.burnout.h / 1000).toFixed(0)} km, ${(surfaceSpeed(res.history.at(-1), rotation) / 1000).toFixed(3)} km/s over the ground; Demo-1 ${seco.t} s, ${seco.h} km, ${seco.v} km/s`);
  check('Falcon 9 (landing): reaches orbit with the second stage\'s propellant nearly spent (under 5 t left), as Demo-1\'s', !!o && (!res.remaining || res.remaining.prop < 5000));
}

console.log('='.repeat(60));
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
