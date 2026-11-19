// packages/physics/src/warp.test.mjs
//
// The drawn craft at high warp, when the kernel answers late (craft.js
// displayState): Artemis II, set up as the app's Mission.flyReal sets it up,
// carried across a day a second's jump before the kernel has answered.
// Two cases the app showed:
// 1. Switched from real time to a day a second ten minutes before the
//    translunar injection, the kernel's first answer took most of a second
//    of wall time, and the drawn craft, carried from before the burn, was up
//    to 78,000 km off the flown path.
// 2. Carried a day on from the crew module's separation while the kernel
//    flew the entry, the drawn capsule was 99 million km out at 1,100 km/s.

import './deNode.js';                 // DE442's Earth and Moon, as in the app
import { readFileSync } from 'node:fs';
import { Craft } from './craft.js';
import { RealMission } from './realMission.js';
import { ORION_CRAFT, ORION_ENTRIES, orionFor } from './orion.js';
import { createKernelHost, KERNEL_EPOCH_MS, kernelSeconds } from './kernelHost.js';
import { solarSystemBodies } from './bodies.js';
import { propagate } from './orbital.js';
import { norm } from './vec.js';

let failures = 0;
function check(name, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; }
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const H = 3600, DAY = 86400, R_EI = 6378.137 + 121.92;

const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const host = createKernelHost();
const m = new RealMission({ ...JSON.parse(readFileSync(new URL('../../../public/missions/artemis2.json', import.meta.url), 'utf8')), id: 'artemis2' });
const earth = (t) => sys.bodyAt('earth', t);
// The craft as Mission.flyReal builds it, from state s.
const orion = (s) => { const c = new Craft({ name: m.name, r: s.r, v: s.v, t: s.t, sys, ...ORION_CRAFT }); c.setScript(m.script()); return c; };
const step = (c) => { const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); };

header('CASE 1: a day a second from ten minutes before the injection');
{
  // The kernel still at the start, the clock hours on (the app showed the
  // worst near 15 h): the drawn craft against the flown path, and against
  // the kernel once it answers.
  console.log('  clock on  drawn from flown   kernel from flown   drawn from kernel');
  let worst = 0, worstKernel = 0;
  for (const h of [3, 6, 10, 15]) {
    const c = orion(m.startState()), k = orion(m.startState());
    c.advanceClock(c.kState.t + h * H);
    k.advanceClock(k.kState.t + h * H); step(k);
    const ms = m.startMs + h * H * 1000, s = c.displayState();
    const drawn = m.distanceFromFlown(s.r, ms), flown = m.distanceFromFlown(k.kState.r, ms), apart = norm(sub(s.r, k.kState.r));
    console.log(`  ${String(h).padStart(5)} h ${drawn.toFixed(1).padStart(14)} km ${flown.toFixed(1).padStart(14)} km ${apart.toFixed(1).padStart(15)} km`);
    worst = Math.max(worst, drawn); worstKernel = Math.max(worstKernel, apart);
  }
  check('the drawn craft stays within 100 km of the flown path (was 17,052 km at 15 h)', worst < 100);
  check('and within 100 km of the kernel\'s own state', worstKernel < 100);
}

header('CASE 2: a day a second past separation: the entry');
{
  // The crew module at separation (orion.js), as Mission.entry makes it.
  const EN = ORION_ENTRIES.artemis2, C = orionFor('artemis2');
  // The data end before it: flown there by the kernel from their last state.
  const c = orion(m.fixAt(m.endMs));
  c.advanceClock(kernelSeconds(new Date(EN.separationMs))); step(c);
  c.configure({ dryMass: C.mass, fuel: 0, area: C.area, cd: C.cd, cr: 1.3, vent: null, scriptIsp: null, entry: { aero: C.aero, chutes: C.chutes, target: EN.target } });
  const t0 = c.kState.t, E0 = earth(t0);
  // Where its conic first meets the entry interface.
  const d0 = sub(c.kState.r, E0.eph.position(t0)), w0 = sub(c.kState.v, E0.eph.velocity(t0));
  let lo = 0;
  while (lo < 3 * H && norm(propagate(d0, w0, lo + 1, E0.mu).r) > R_EI) lo++;
  console.log(`  separation ${norm(d0).toFixed(0)} km from the Earth's centre; its conic reaches the entry interface ${(lo / 60).toFixed(1)} min on`);
  for (const lag of [10 * 60, H, DAY]) {
    c.advanceClock(t0 + lag);
    const s = c.displayState(), E = earth(t0 + lag);
    const r = norm(sub(s.r, E.eph.position(t0 + lag))), v = norm(sub(s.v, E.eph.velocity(t0 + lag)));
    console.log(`  ${(lag / 60).toFixed(0).padStart(5)} min on, the kernel not yet answered: drawn ${(r - 6378.137).toFixed(1)} km up at ${v.toFixed(3)} km/s`);
    if (lag < lo) check(`${lag / 60} min on, still above the air: carried as before (above the entry interface)`, r > R_EI);
    // The carry (J2, the Moon) is not quite the conic: within a few km.
    else check(`${lag / 60} min on: held at the entry interface (${(r - R_EI).toFixed(1)} km), under 12 km/s`, Math.abs(r - R_EI) < 5 && v < 12);
  }
  // The kernel then flies the entry (the step that took seconds in the
  // app), and the capsule lies at its splashdown site.
  const wall = performance.now();
  for (let i = 0; i < 20 && !c.crashed; i++) step(c);
  console.log(`  the kernel's entry: ${((performance.now() - wall) / 1000).toFixed(1)} s; ${c.log.filter((x) => /splashdown|impact/.test(x.text)).map((x) => x.text).join('; ')}`);
  check('the kernel brings it down: a splashdown', c.crashed && c.splashed);
  c.advanceClock(t0 + 2 * DAY);
  const s = c.displayState(), E = earth(t0 + 2 * DAY), r = norm(sub(s.r, E.eph.position(t0 + 2 * DAY)));
  check(`two days on it lies on the sea (${(r - 6371).toFixed(1)} km from the mean radius)`, Math.abs(r - 6371) < 25);
}

console.log('='.repeat(60));
if (failures > 0) { console.log(`RESULT: ${failures} check(s) FAILED`); process.exit(1); }
console.log('RESULT: all checks PASSED');
