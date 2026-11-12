// src/simulation/spacecraft/craftKernel.test.mjs
//
// Tests for how a spacecraft is driven by the physics kernel: requests,
// results, version checks, thrust bookkeeping, clock jumps, impacts, errors
// and the drawn state. Needs `npm install` (three, astronomy-engine). Node has
// no Web Worker, so KernelClient runs the kernel host on this thread; the
// asynchronous cases are reproduced by holding requests and replying later.
// Run with:
//     node src/simulation/spacecraft/craftKernel.test.mjs

import * as THREE from 'three';
import { BaseSpacecraft } from './BaseSpacecraft.js';
import { KernelClient } from './KernelClient.js';
import { createKernelHost } from '../../physics/kernelHost.js';
import { helioStateEqj } from '../../physics/ephemeris.js';
import { AU_TO_KM } from '../../utils/constants.js';

let failures = 0;
function check(name, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const diff = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const toScene = (a, s = 1) => [a[0] * s, a[2] * s, -a[1] * s];
const quiet = (fn) => { const w = console.warn, i = console.info, l = console.log; console.warn = console.info = console.log = () => {}; try { return fn(); } finally { console.warn = w; console.info = i; console.log = l; } };

const START = new Date('2026-11-04T00:00:00Z');
// Scene bodies as the app passes them; the systems model falls back to
// defaults when the Sun is not in the map.
const NO_BODIES = new Map();
const E0 = helioStateEqj('earth', START);
// A craft in a circular orbit of radius rk km about Earth, or heliocentric.
function makeCraft(name, { rk = null, managed = false, enhanced = false } = {}) {
  let r = [E0.r[0] * 1.01, E0.r[1] * 1.01, E0.r[2] * 1.01], v = [...E0.v];
  if (rk) { const vc = Math.sqrt(398600.4355 / rk); r = [E0.r[0] + rk, E0.r[1], E0.r[2]]; v = [E0.v[0], E0.v[1] + vc, E0.v[2]]; }
  const c = quiet(() => new BaseSpacecraft(name, { position: toScene(r, 1 / AU_TO_KM), velocity: toScene(v) },
    enhanced ? { type: 'enhanced' } : {}));
  c.kernelManaged = managed;
  return c;
}
const at = (s) => new Date(START.getTime() + s * 1000);

header('CASE 1: managed through the client vs stepped directly');
{
  const a = makeCraft('direct'), b = makeCraft('managed', { managed: true });
  const client = new KernelClient();
  for (let f = 1; f <= 40; f++) {
    const d = at(f * 43200);
    quiet(() => { a.update(0.5, NO_BODIES, d); b.update(0.5, NO_BODIES, d); client.tick([b]); });
  }
  check(`client runs on the main thread in Node (mode ${client.mode})`, client.mode === 'main-thread');
  check('exact states agree to the bit after 20 days', norm(diff(a.kState.r, b.kState.r)) === 0 && a.kState.t === b.kState.t);
}

header('CASE 2: drawn state carried forward along the primary\'s two-body orbit');
{
  for (const [label, rk, frameS] of [['LEO, 1 min frames', 6778, 60], ['LEO, 24 min frames', 6778, 1440], ['20,000 km, 24 min frames', 20000, 1440]]) {
    const a = makeCraft('exact', { rk }), b = makeCraft('drawn', { rk, managed: true });
    const client = new KernelClient();
    let worst = 0;
    for (let f = 1; f <= 60; f++) {
      const d = at(f * frameS);
      quiet(() => { a.update(frameS / 86400, NO_BODIES, d); b.update(frameS / 86400, NO_BODIES, d); client.tick([b]); });
      worst = Math.max(worst, a.position.distanceTo(b.position) * AU_TO_KM);
    }
    console.log(`  ${label.padEnd(26)} drawn vs exact: worst ${worst.toFixed(3)} km over 60 frames`);
    check(`${label}: drawn within 0.5 km of the exact state`, worst < 0.5);
  }
}

header('CASE 2b: drawn state with replies a frame late (as from the Worker)');
{
  // Node's client answers within the frame; the Worker answers a frame or two
  // later. Hold each reply for one frame and compare the drawn position with
  // a craft stepped directly, from the first frame on.
  const host = createKernelHost();
  for (const [label, rk, scale, frameS] of [['LEO, 24 min frames', 6778, null, 1440],
    ['near Earth at 1.01 AU, 1.7 d frames', null, 1.01, 144000], ['cruise at 1.2 AU, 1.7 d frames', null, 1.2, 144000]]) {
    let a, b;
    if (rk) { a = makeCraft('exact', { rk }); b = makeCraft('late', { rk, managed: true }); } else {
      const mkAt = (m) => { const c = quiet(() => new BaseSpacecraft('c', { position: toScene(E0.r.map((x) => x * scale), 1 / AU_TO_KM), velocity: toScene(E0.v) })); c.kernelManaged = m; return c; };
      a = mkAt(false); b = mkAt(true);
    }
    let pending = null, worst = 0;
    for (let f = 1; f <= 40; f++) {
      const d = at(f * frameS);
      quiet(() => { a.update(frameS / 86400, NO_BODIES, d); b.update(frameS / 86400, NO_BODIES, d); });
      worst = Math.max(worst, a.position.distanceTo(b.position) * AU_TO_KM);
      if (pending) quiet(() => b.applyKernelResult(host.handle({ type: 'step', crafts: [pending] }).crafts[0]));
      pending = b.buildKernelRequest();
    }
    // Two-body about the primary plus the kernel's other accelerations to
    // second order. Exact in low orbit and in cruise. The near-Earth craft
    // falls past Earth at 126,000 km, carried forward 3.3 days at a time
    // (100 days/s) while the Moon moves ~44 degrees: a second-order term
    // cannot follow that, so the drawn position there is off by up to
    // ~11,000 km until the next result (the exact state is unaffected).
    const bound = rk ? 0.5 : (scale < 1.1 ? 15000 : 5);
    console.log(`  ${label.padEnd(36)} worst ${worst.toFixed(2)} km`);
    check(`${label}: drawn within ${bound} km of the exact state`, worst < bound);
  }
}

header('CASE 3: results computed from an old state are dropped');
{
  const host = createKernelHost();
  const c = makeCraft('burn', { managed: true });
  quiet(() => c.update(0.5, NO_BODIES, at(43200)));
  const req = c.buildKernelRequest();
  const res = host.handle({ type: 'step', crafts: [req] }).crafts[0];
  const vBefore = [...c.kState.v];
  quiet(() => c.applyManeuver(0.5, new THREE.Vector3(0, 0, -1)));
  quiet(() => c.applyKernelResult(res));
  check('a burn while the request is in flight survives (0.5 km/s kept)', Math.abs(norm(diff(c.kState.v, vBefore)) - 0.5) < 1e-12);
  check('the stale result did not move the exact state', c.kState.t === req.t);
  check('the result is not applied twice', (quiet(() => c.applyKernelResult(res)), c.kState.t === req.t));
}

header('CASE 4: finite burns are independent of the frame rate');
{
  // The same burn flown with hour-long frames and with day-long frames must
  // end in the same place: burns are timed segments, not per-frame thrust.
  const run = (frameS, setup, days = 4, managedClient = null, enhanced = false) => {
    const c = makeCraft('burn', { managed: !!managedClient, enhanced });
    quiet(() => c.update(0, NO_BODIES, START));                  // anchor the clock at START
    quiet(() => setup(c));
    for (let t = frameS; t <= days * 86400 + 1e-6; t += frameS) {
      quiet(() => { c.update(frameS / 86400, NO_BODIES, at(t)); if (managedClient) managedClient.tick([c]); });
    }
    return c;
  };
  // Manual engine on until the tank runs dry (5 kN on 1000 + 200 kg, ve 3000 m/s: 120 s).
  const manual = (c) => { c.mass = 1000; c.fuelMass = 200; c.thrustPower = 5000; c.exhaustVelocity = 3000;
    if (c.systems) c.systems.propulsion.main.fuel = 0; c.setThrust(new THREE.Vector3(0, 0, -1), true); };
  const h = run(3600, manual), d = run(86400, manual);
  const burn = h.burns.length ? h.burns[0] : null;
  check('the manual engine is off once the tank is dry, and all fuel is drawn', !h.engineOn && h.fuelMass === 0 && d.fuelMass === 0);
  const dm = norm(diff(h.kState.r, d.kState.r)), dv = norm(diff(h.kState.v, d.kState.v)) * 1000;
  console.log(`  manual burn to empty, hour vs day frames: |dr| ${dm.toExponential(2)} km, |dv| ${dv.toExponential(2)} m/s`);
  // Same burn either way; what differs is the cruise step sequence over four
  // days (eta = 0.01), so the bound is the kernel's accuracy, not round-off.
  check('a manual burn ends in the same state with hour or day frames (<0.1 km, <1e-4 m/s)', dm < 0.1 && dv < 1e-4);
  // A manoeuvre node 5000 s in: 0.8 km/s prograde.
  const node = (c) => { const n = c.addManoeuvreNode(5000); n.setDeltaV(0, 0.8, 0); };
  const h2 = run(3600, node, 4, null, true), d2 = run(86400, node, 4, null, true), m2 = run(600, node, 4, null, true);
  const main0 = 500, used = main0 - h2.systems.propulsion.main.fuel;
  const ve = h2.systems.propulsion.main.specificImpulse * 9.80665;
  const mStart = h2.mass + h2.fuelMass + main0;
  const usedWant = mStart * (1 - Math.exp(-800 / ve));
  console.log(`  node burn: fuel used ${used.toFixed(3)} kg, rocket equation ${usedWant.toFixed(3)} kg; ` +
    `hour vs day |dr| ${norm(diff(h2.kState.r, d2.kState.r)).toExponential(2)} km, 10 min vs day ${norm(diff(m2.kState.r, d2.kState.r)).toExponential(2)} km`);
  check('the node burn draws the rocket-equation fuel for its delta-v (<1e-6 kg)', Math.abs(used - usedWant) < 1e-6);
  check('the node burn ends in the same state with 10 min, hour or day frames (<0.1 km)',
    norm(diff(h2.kState.r, d2.kState.r)) < 0.1 && norm(diff(m2.kState.r, d2.kState.r)) < 0.1);
  check('the manoeuvre is complete and the throttle back to zero',
    h2.executingManoeuvre === null && h2.systems.propulsion.main.throttle === 0 && h2.manoeuvreNodes.length === 0);
  // A request lost mid-burn (Worker failure) loses nothing: the next request
  // starts from the same state and sends the same burn.
  const c = makeCraft('dropped', { managed: true });
  const host = createKernelHost();
  quiet(() => { c.update(0, NO_BODIES, START); manual(c); });
  for (let f = 1; f <= 48; f++) {
    quiet(() => c.update(1 / 24, NO_BODIES, at(f * 3600)));
    const req = c.buildKernelRequest();
    if (f === 1) { c.onKernelRequestDropped(); continue; }       // lost in a fallback
    if (req) quiet(() => c.applyKernelResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]));
  }
  const ref = run(3600, manual, 2);
  check('a request lost mid-burn changes nothing (<1e-3 km)', norm(diff(c.kState.r, ref.kState.r)) < 1e-3);
}

header('CASE 5: clock jumps, impacts and errors');
{
  const c = makeCraft('jump', { managed: false });
  for (let f = 1; f <= 5; f++) quiet(() => c.update(1, NO_BODIES, at(f * 86400)));
  const before = c.position.clone();
  quiet(() => c.update(1, NO_BODIES, at(-360 * 86400)));          // Reset: a year back
  check('a backward clock jump keeps the state and re-anchors it', c.clockJumped && before.distanceTo(c.position) === 0 &&
    Math.abs(c.kState.t - c.lastClockT) < 1e-9);

  // Dropped toward Earth from 20,000 km: the impact is drawn where it happened.
  const d = makeCraft('fall', { rk: 20000, managed: true });
  d.kState = null;
  d.velocity.set(...toScene([E0.v[0], E0.v[1], E0.v[2]]));
  const client = new KernelClient();
  for (let f = 1; f <= 20 && !d.crashed; f++) quiet(() => { d.update(1800 / 86400, NO_BODIES, at(f * 1800)); client.tick([d]); });
  const drawnKm = d.position.clone().multiplyScalar(AU_TO_KM).distanceTo(new THREE.Vector3(...toScene(d.kState.r)));
  check(`an impact is reported (${d.impactBody})`, d.crashed && d.impactBody === 'earth');
  check('the crashed craft is drawn at the impact point', drawnKm < 1e-6);

  // A bad state: the kernel reports an error for that craft, and the client
  // is free for the next request.
  const bad = makeCraft('bad', { managed: true }), good = makeCraft('good', { managed: true });
  const client2 = new KernelClient();
  quiet(() => { bad.update(0.5, NO_BODIES, at(43200)); good.update(0.5, NO_BODIES, at(43200)); });
  bad.kState.r = [NaN, NaN, NaN];
  quiet(() => client2.tick([bad, good]));
  check('a NaN state comes back as an error, and the craft stops requesting', !!bad.kernelError && bad.buildKernelRequest() === null);
  check('the other craft still stepped and the client is not stuck', good.kState.t > 0 && !client2.busy);
  const late = makeCraft('nan-time', { managed: true });
  quiet(() => late.update(0.5, NO_BODIES, at(43200)));
  late.kState.t = NaN;
  check('a NaN physics time is flagged instead of freezing silently', late.buildKernelRequest() === null && !!late.kernelError);
}

console.log('='.repeat(60));
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('RESULT: all checks PASSED');
}
