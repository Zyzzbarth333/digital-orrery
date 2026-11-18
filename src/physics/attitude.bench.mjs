// src/physics/attitude.bench.mjs
//
// Where to carry a craft's attitude: on the main thread (craftAttitude.js,
// as the app does) or in the kernel's worker beside the translation.
// npm run bench:attitude. Prints milliseconds; the numbers in
// docs/physics/sixdof.md#where-the-attitude-is-carried came from it.
//
//   main thread   the app's craft, frame by frame: held (locked) at 1x and
//                 at a day a second; a 90 deg slew at 1x (60 fps); the same
//                 slew inside one frame at a day a second; free tumbling
//                 under the gravity gradient at a day a second
//   in the kernel the cost of integrating attitude with the translation:
//                 the kernel's steps must then end on every control sample
//                 (0.1 s) while the attitude is turning. Timed as a 60 s
//                 step in low orbit with and without 600 breakpoints (a
//                 burn of 1 micronewton cut into 0.1 s pieces)

import './deNode.js';
import { Craft } from './craft.js';
import { createKernelHost, stepCraft, KERNEL_EPOCH_MS, kernelSeconds } from './kernelHost.js';
import { solarSystemBodies } from './bodies.js';
import { helioStateEqj } from './ephemeris.js';

const START = new Date('2026-11-04T00:00:00Z'), T0 = kernelSeconds(START);
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), host = createKernelHost();
const E = helioStateEqj('earth', START), rk = 6778.137, vc = Math.sqrt(398600.4355 / rk);
const mk = (o = {}) => new Craft({ name: 'bench', r: [E.r[0] + rk, E.r[1], E.r[2]], v: [E.v[0], E.v[1] + vc, E.v[2]], t: T0, sys, ...o });
const frame = (c, t) => { c.advanceClock(t); const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); c.displayState(); };
// The attitude's own share of a frame: the craft's advanceClock less its
// point-mass twin's, the kernel and the drawn carry left out.
function attitudeMs(c, twin, t) {
  let a = performance.now(); c.advanceClock(t); const ms = performance.now() - a;
  a = performance.now(); twin.advanceClock(t); const base = performance.now() - a;
  for (const x of [c, twin]) { const req = x.buildRequest(); if (req) x.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); x.displayState(); }
  return ms - base;
}
const row = (label, ms) => console.log(`  ${label.padEnd(52)} ${ms.toFixed(3).padStart(8)} ms`);

console.log('MAIN THREAD (the attitude\'s share of a frame, median of the frames)');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
{
  const c = mk({ attitude: { mode: 'prograde' } }), tw = mk();
  for (let k = 1; k <= 30; k++) frame(c, T0 + k / 60), frame(tw, T0 + k / 60);
  const xs = []; for (let k = 31; k <= 330; k++) xs.push(attitudeMs(c, tw, T0 + k / 60));
  row('held prograde, 1x (60 fps)', median(xs));
}
{
  const c = mk({ attitude: { mode: 'prograde' } }), tw = mk();
  const xs = []; for (let k = 1; k <= 120; k++) xs.push(attitudeMs(c, tw, T0 + k * 1440));
  row('held prograde, a day a second', median(xs));
}
{
  const c = mk({ attitude: { mode: 'radial' } }), tw = mk();
  for (let k = 1; k <= 30; k++) frame(c, T0 + k / 60), frame(tw, T0 + k / 60);
  c.att.setMode('prograde');
  const xs = []; let k = 31;
  while (!c.att.locked && k < 6000) xs.push(attitudeMs(c, tw, T0 + k++ / 60));
  row(`90 deg slew to prograde, 1x (${xs.length} frames)`, median(xs));
  row('  the slowest of those frames', Math.max(...xs));
}
{
  const c = mk({ attitude: { mode: 'radial' } }), tw = mk();
  frame(c, T0 + 1 / 60); frame(tw, T0 + 1 / 60);
  c.att.setMode('prograde');
  row('the same slew inside one frame at a day a second', attitudeMs(c, tw, T0 + 1 / 60 + 1440));
}
{
  const c = mk({ attitude: { mode: 'off' } }), tw = mk();
  const xs = []; for (let k = 1; k <= 120; k++) xs.push(attitudeMs(c, tw, T0 + k * 1440));
  row(`control off, tumbling, a day a second (${c.att.A.steps} steps in 2 d)`, median(xs));
}

console.log('IN THE KERNEL (a 60 s step in low orbit, median of 50)');
{
  const base = mk(), req0 = base.buildRequest() ?? { id: 1, version: 0, r: base.kState.r, v: base.kState.v, t: T0, primary: 'earth' };
  const r = { ...req0, t: T0, tEnd: T0 + 60, burns: [], env: base.envParams(), primary: 'earth' };
  const pieces = Array.from({ length: 600 }, (_, k) => ({ t0: T0 + k * 0.1, t1: T0 + (k + 1) * 0.1, dir: [0, 1, 0], F: 1e-6, m0: 1500, mdot: 0 }));
  const time = (req) => { const xs = []; let steps = 0; for (let i = 0; i < 50; i++) { const a = performance.now(); steps = stepCraft(sys, structuredClone(req)).steps; xs.push(performance.now() - a); } return { ms: median(xs), steps }; };
  const a = time(r), b = time({ ...r, burns: pieces });
  row(`coasting: ${a.steps} steps`, a.ms);
  row(`ending on every 0.1 s sample: ${b.steps} steps`, b.ms);
}
