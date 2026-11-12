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

header('CASE 6: launches, orbital elements and flying a Lambert plan');
{
  const { escapeStart, departureHyperbola } = await import('./launch.js');
  const { propagate, rvToElements } = await import('../../physics/orbital.js');
  // The departure hyperbola itself (two-body about Earth): periapsis on the
  // parking orbit, outgoing asymptote along v_inf, lowest-inclination plane.
  {
    const mu = 398600.4355, rp = 6578, vInf = [1.2, -2.5, 0.9];
    const h = departureHyperbola({ planetR: [0, 0, 0], planetV: [0, 0, 0], vInf, mu, rp });
    const el = rvToElements(h.r, h.v, mu);
    const far = propagate(h.r, h.v, 200 * 86400, mu);
    const vi = norm(vInf), vf = norm(far.v);
    const angDeg = Math.acos((far.v[0] * vInf[0] + far.v[1] * vInf[1] + far.v[2] * vInf[2]) / (vf * vi)) * 180 / Math.PI;
    const dlaDeg = Math.asin(vInf[2] / vi) * 180 / Math.PI;
    console.log(`  departure hyperbola: rp ${(el.a * (1 - el.e)).toFixed(6)} km, e ${el.e.toFixed(6)}, nu ${(el.nu * 180 / Math.PI).toFixed(4)} deg; ` +
      `after 200 d the velocity is ${angDeg.toExponential(2)} deg from v_inf; plane inclination ${(h.inclinationToPole * 180 / Math.PI).toFixed(4)} = |DLA| ${Math.abs(dlaDeg).toFixed(4)}`);
    check('starts at periapsis on the parking orbit (rp to 1e-6 km, true anomaly 0)', Math.abs(el.a * (1 - el.e) - rp) < 1e-6 && Math.abs(Math.sin(el.nu)) < 1e-9);
    check('the outgoing asymptote is v_inf (within 1e-3 deg after 200 days)', angDeg < 1e-3);
    check('the plane is the lowest-inclination one (inclination = |declination of v_inf|)',
      Math.abs(h.inclinationToPole * 180 / Math.PI - Math.abs(dlaDeg)) < 1e-9);
  }
  const { OrbitalMechanics } = await import('../OrbitalMechanics.js');
  const { GRAVITATIONAL_PARAMETERS: GM, PLANETS } = await import('../../utils/constants.js');
  const sceneV = (a, s = 1) => new THREE.Vector3(a[0] * s, a[2] * s, -a[1] * s);
  // Elements of Earth's own state: the old code read e ~ 1 for every orbit.
  const Ee = OrbitalMechanics.calculateOrbitalElements(sceneV(E0.r, 1 / AU_TO_KM), sceneV(E0.v), GM.sun / 1e9);
  check(`Earth's elements: a ${Ee.semiMajorAxis.toFixed(4)} AU, e ${Ee.eccentricity.toFixed(4)}, i ${Ee.inclination.toFixed(3)} deg`,
    Math.abs(Ee.semiMajorAxis - 1) < 0.002 && Math.abs(Ee.eccentricity - 0.0167) < 0.003 && Ee.inclination < 0.01);
  // The launches PhysicsTest makes in the browser, flown here headless.
  const launch = (rsw, days) => {
    const vi = OrbitalMechanics.convertDeltaV(new THREE.Vector3(...rsw), sceneV(E0.r, 1 / AU_TO_KM), sceneV(E0.v));
    const vInfEqj = [vi.x, -vi.z, vi.y];
    const st = norm(vInfEqj) > 1e-6
      ? departureHyperbola({ planetR: E0.r, planetV: E0.v, vInf: vInfEqj, mu: GM.earth / 1e9, rp: PLANETS.earth.radius + 200 })
      : escapeStart({ planetR: E0.r, planetV: E0.v, vInf: vInfEqj, mu: GM.earth / 1e9, radius: PLANETS.earth.radius, muSun: GM.sun / 1e9 });
    const c = quiet(() => new BaseSpacecraft('l', { position: sceneV(st.r, 1 / AU_TO_KM).toArray(), velocity: sceneV(st.v).toArray() }));
    quiet(() => c.update(0, NO_BODIES, START));
    for (let k = 1; k <= days; k++) quiet(() => c.update(1, NO_BODIES, at(k * 86400)));
    return c.getOrbitalElements();
  };
  const earthAU = norm(E0.r) / AU_TO_KM;
  const hoh = OrbitalMechanics.calculateHohmannTransfer(AU_TO_KM, 1.524 * AU_TO_KM).departure;
  const z = launch([0, 0, 0], 365), p = launch([0, 5, 0], 30), r = launch([0, -5, 0], 30), h = launch([0, hoh, 0], 30), e = launch([0, 12.3, 0], 30);
  console.log(`  zero: a ${z.semiMajorAxis.toFixed(3)} e ${z.eccentricity.toFixed(3)} | prograde: Ap ${p.apoapsis.toFixed(2)} Pe ${p.periapsis.toFixed(3)} | ` +
    `retrograde: Pe ${r.periapsis.toFixed(2)} Ap ${r.apoapsis.toFixed(3)} | Hohmann: Ap ${h.apoapsis.toFixed(3)} | escape: e ${e.eccentricity.toFixed(3)} (Earth at ${earthAU.toFixed(3)} AU)`);
  check('zero v_inf drifts onto an orbit near Earth\'s (|a - 1| < 0.06, e < 0.07)', Math.abs(z.semiMajorAxis - 1) < 0.06 && z.eccentricity < 0.07);
  check('prograde 5 km/s raises apoapsis, periapsis at Earth', p.apoapsis > 1.5 && Math.abs(p.periapsis - earthAU) < 0.03 && p.eccentricity > 0.2);
  check('retrograde 5 km/s lowers periapsis, apoapsis at Earth', r.periapsis < 0.8 && Math.abs(r.apoapsis - earthAU) < 0.03 && r.eccentricity > 0.2);
  check('Hohmann v_inf reaches Mars\'s distance (Ap 1.524 +/- 0.06)', Math.abs(h.apoapsis - 1.524) < 0.06 && Math.abs(h.periapsis - earthAU) < 0.03);
  check('12.3 km/s prograde escapes the Sun (e >= 1, apoapsis infinite)', e.eccentricity >= 1 && e.apoapsis === Infinity);

  // Execute Plan for the 2026 porkchop minimum: depart from a 200 km parking
  // orbit on the hyperbola whose asymptote is the Lambert arc's v_inf, and fly
  // it through the n-body kernel. With no correction burns it passes Mars at
  // ~371,000 km, ~7 days early (the radial start missed by 722,000 km, 18 days
  // early); targeting will close the rest. A wrong frame or axis for v_inf
  // would miss by tens of millions of km.
  const { transferBetween } = await import('../../physics/porkchop.js');
  const { helioStateEcl, eclToEqj } = await import('../../physics/ephemeris.js');
  const dep = new Date('2026-11-04T00:00:00Z'), tof = 308;
  const Ed = helioStateEcl('earth', dep), Ma = helioStateEcl('mars', new Date(dep.getTime() + tof * 864e5));
  const t = transferBetween(Ed, Ma, tof * 86400, GM.sun / 1e9, { mu: GM.earth / 1e9, rPark: 6571 }, { mu: GM.mars / 1e9, rPark: 3790, capture: true });
  const Eq = helioStateEqj('earth', dep);
  const st = departureHyperbola({ planetR: Eq.r, planetV: Eq.v, vInf: eclToEqj([0, 1, 2].map((i) => t.v1[i] - Ed.v[i])),
    mu: GM.earth / 1e9, rp: PLANETS.earth.radius + 200 });
  const c = quiet(() => new BaseSpacecraft('plan', { position: sceneV(st.r, 1 / AU_TO_KM).toArray(), velocity: sceneV(st.v).toArray() }));
  quiet(() => c.update(0, NO_BODIES, dep));
  let best = { d: Infinity, day: 0 };
  // 15-minute frames for the first three days (the climb out of low orbit),
  // then 6 hours.
  for (let day = 1 / 96; day <= tof + 30; day += day < 3 ? 1 / 96 : 0.25) {
    const d = new Date(dep.getTime() + day * 864e5);
    quiet(() => c.update(day < 3 ? 1 / 96 : 0.25, NO_BODIES, d));
    const M = helioStateEqj('mars', d);
    const dist = norm(diff(c.kState.r, M.r));
    if (dist < best.d) best = { d: dist, day };
  }
  console.log(`  2026 Lambert plan flown by the kernel: closest to Mars ${(best.d / 1e3).toFixed(0)}k km on day ${best.day} (planned ${tof})`);
  check('the flown Lambert plan passes Mars within 500,000 km, within 12 days of the plan', best.d < 5e5 && Math.abs(best.day - tof) < 12);
}

header('CASE 7: review regressions (burns across clock jumps, fuel checks, plan v_inf)');
{
  // A burn cut short by a backward clock jump must not be flown again when
  // the clock passes its old times (it used to burn 333 kg and ~527 m/s twice).
  const c = makeCraft('jump-burn');
  quiet(() => c.update(0, NO_BODIES, START));
  c.mass = 1000; c.fuelMass = 1000; c.thrustPower = 5000; c.exhaustVelocity = 3000;
  quiet(() => c.setThrust(new THREE.Vector3(0, 0, -1), true));
  quiet(() => c.update(200 / 86400, NO_BODIES, at(200)));
  const fuelAfterBurn = c.fuelMass;
  quiet(() => c.update(1 / 86400, NO_BODIES, at(200 - 3600)));          // Reset: an hour back
  for (let t = 200 - 3600 + 60; t <= 400; t += 60) quiet(() => c.update(60 / 86400, NO_BODIES, at(t)));
  check('after a backward jump the old burn is not flown again (no fuel drawn, engine off)',
    c.fuelMass === fuelAfterBurn && !c.engineOn && c.burns.length === 0);
  // setThrust before the first frame used to throw.
  const fresh = makeCraft('fresh');
  let threw = false;
  try { quiet(() => { fresh.setThrust(new THREE.Vector3(1, 0, 0), true); fresh.setThrust(null, false); }); } catch { threw = true; }
  check('setThrust before the first frame does not throw', !threw);
  // A node the main tank cannot deliver is refused before an ignition is
  // spent, instead of burning dry and reporting the manoeuvre complete.
  const n = makeCraft('big-node', { enhanced: true });
  quiet(() => n.update(0, NO_BODIES, START));
  const ign0 = n.systems.propulsion.main.ignitionsUsed;
  quiet(() => { const node = n.addManoeuvreNode(600); node.setDeltaV(0, 1.2, 0); });
  for (let t = 300; t <= 1800; t += 300) quiet(() => n.update(300 / 86400, NO_BODIES, at(t)));
  check('an undeliverable node is refused without spending an ignition or fuel',
    n.manoeuvreNodes.length === 0 && n.systems.propulsion.main.ignitionsUsed === ign0 &&
    n.systems.propulsion.main.fuel === 500 && n.burns.length === 0);
  // The planner's Hohmann v_inf is signed: inward transfers launch retrograde.
  const { TrajectoryPlanner } = await import('../trajectory/TrajectoryPlanner.js');
  const { PLANETS } = await import('../../utils/constants.js');
  const fakeSim = { bodies: new Map(Object.keys(PLANETS).map((k) => [k, { data: PLANETS[k] }])) };
  const hoh = (a, b) => quiet(() => TrajectoryPlanner.prototype.calculateHohmannTransfer.call({ simulation: fakeSim }, a, b, 200, 400));
  const toVenus = hoh('earth', 'venus'), toMars = hoh('earth', 'mars');
  console.log(`  planner v_inf: Earth->Venus ${toVenus.vInfDeparture.toFixed(3)} km/s, Earth->Mars ${toMars.vInfDeparture.toFixed(3)} km/s`);
  check('Earth->Venus launches retrograde (negative along-track v_inf), Earth->Mars prograde',
    toVenus.vInfDeparture < 0 && toMars.vInfDeparture > 0);
}

console.log('='.repeat(60));
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('RESULT: all checks PASSED');
}
