// src/physics/craft.test.mjs
//
// The craft model (craft.js) with the kernel: the Worker client against
// direct stepping, the drawn state carried forward, stale results, finite
// burns and nodes, clock jumps, impacts and errors, launches, and a Lambert
// plan flown to Mars. Ported from the old BaseSpacecraft tests.

import './deNode.js';                 // DE442's Earth and Moon, as in the app
import { Craft } from './craft.js';
import { KernelClient } from './kernelClient.js';
import { createKernelHost, KERNEL_EPOCH_MS, kernelSeconds } from './kernelHost.js';
import { solarSystemBodies } from './bodies.js';
import { helioStateEqj, helioStateEcl, eclToEqj } from './ephemeris.js';
import { escapeStart, departureHyperbola } from './launch.js';
import { propagate, rvToElements, hohmann } from './orbital.js';
import { transferBetween } from './porkchop.js';
import { GRAVITATIONAL_PARAMETERS as GM, PLANETS } from '../utils/constants.js';

let failures = 0;
function check(name, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; }
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const diff = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => { const n = norm(a); return a.map((x) => x / n); };
const AU = 149597870.7, DAY = 86400, MU_E = 398600.4355;

const START = new Date('2026-11-04T00:00:00Z');
const T0 = kernelSeconds(START);
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const E0 = helioStateEqj('earth', START);
const host = createKernelHost();

// A craft in a circular orbit of radius rk km about Earth (inclined 0.4 rad
// out of the equator plane), or heliocentric near Earth.
function makeCraft(name, { rk = null, ...o } = {}) {
  let r = E0.r.map((x) => x * 1.01), v = [...E0.v];
  if (rk) { const vc = Math.sqrt(MU_E / rk); r = [E0.r[0] + rk, E0.r[1], E0.r[2]]; v = [E0.v[0], E0.v[1] + vc * Math.cos(0.4), E0.v[2] + vc * Math.sin(0.4)]; }
  return new Craft({ name, r, v, t: T0, sys, ...o });
}
// One frame to time t: the clock, then the kernel (directly, or through a
// client). jumped: the clock was set, not run.
function frame(c, t, client = null, jumped = false) {
  c.advanceClock(t, jumped);
  if (client) client.tick([c]);
  else { const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); }
}
const fly = (c, frameS, until, client = null) => { for (let t = c.clockT + frameS; t <= until + 1e-6; t += frameS) frame(c, t, client); };

header('CASE 1: through the client (Worker fallback in Node) vs stepped directly');
{
  const a = makeCraft('a', { rk: 7000 }), b = makeCraft('b', { rk: 7000 });
  const client = new KernelClient();
  fly(a, 600, T0 + DAY, client);
  fly(b, 600, T0 + DAY);
  const d = norm(diff(a.kState.r, b.kState.r));
  console.log(`  after a day of 10-minute frames: ${d.toExponential(2)} km apart (client mode ${client.mode})`);
  check('the client gives the same state as direct stepping (<1e-9 km)', d < 1e-9);
}

header('CASE 2: drawn state carried forward along the primary\'s two-body orbit');
{
  // Two copies: one stepped to T, one stepped to T - lag and carried
  // forward. Bounds as in the old suite: in orbit 0.5 km; in cruise 5 km.
  // Just outside Earth's sphere of influence, carried days at a time while
  // the Moon swings round, a second-order term cannot follow (the old bound
  // was 15,000 km); the exact state is unaffected.
  const at = (scale) => (o) => new Craft({ name: 'h', r: E0.r.map((x) => x * scale), v: [...E0.v], t: T0, sys, ...o });
  for (const [label, mk, lag, tol] of [
    ['low orbit 7,000 km, 10 min late', () => makeCraft('x', { rk: 7000 }), 600, 0.01],
    ['low orbit 7,000 km, 1 h late', () => makeCraft('x', { rk: 7000 }), 3600, 0.5],
    ['GEO, 6 h late', () => makeCraft('x', { rk: 42164 }), 6 * 3600, 2],
    ['cruise at 1.2 AU, 1.7 d late', at(1.2), 144000, 5],
    ['near Earth at 1.01 AU, 5 d late', at(1.01), 5 * DAY, 15000],
  ]) {
    const exact = mk(), late = mk();
    fly(exact, 600, T0 + 10 * DAY);
    fly(late, 600, T0 + 10 * DAY - lag);
    late.clockT = T0 + 10 * DAY;
    const d = norm(diff(late.displayState().r, exact.kState.r));
    console.log(`  ${label.padEnd(34)} drawn ${d.toExponential(2)} km from the kernel`);
    check(`${label}: within ${tol} km`, d < tol);
  }
}

header('CASE 3: results computed from an old state are dropped');
{
  const c = makeCraft('stale', { rk: 7000 });
  frame(c, T0 + 600);
  c.advanceClock(T0 + 1200);
  const req = c.buildRequest();
  c.advanceClock(T0 + 5 * DAY, true);             // the clock set: version bumped
  const before = [...c.kState.r];
  c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]);
  check('a result for the old version leaves the state alone', norm(diff(c.kState.r, before)) === 0 && c.clockJumped);
}

header('CASE 4: finite burns are independent of the frame rate');
{
  // Manual engine on until dry: 5 kN, 1000 + 200 kg, Isp 305.9 s (ve 3000 m/s): 120 s.
  const manual = (o = {}) => { const c = makeCraft('m', { dryMass: 1000, fuel: 200, isp: 3000 / 9.80665, ...o }); c.setEngine([0, 0, -1]); return c; };
  const h = manual(), d = manual();
  fly(h, 3600, T0 + 4 * DAY); fly(d, DAY, T0 + 4 * DAY);
  const dm = norm(diff(h.kState.r, d.kState.r)), dv = norm(diff(h.kState.v, d.kState.v)) * 1000;
  console.log(`  manual burn to empty, hour vs day frames: |dr| ${dm.toExponential(2)} km, |dv| ${dv.toExponential(2)} m/s`);
  check('the engine is off once dry, and all the fuel is drawn', !h.engineOn && h.fuel === 0 && d.fuel === 0);
  check('a manual burn ends in the same state with hour or day frames (<0.1 km, <1e-4 m/s)', dm < 0.1 && dv < 1e-4);

  // A node 5000 s in: 0.8 km/s prograde.
  const nodeRun = (frameS) => { const c = makeCraft('n'); c.addNode(T0 + 5000, [0, 0.8, 0]); fly(c, frameS, T0 + 4 * DAY); return c; };
  const h2 = nodeRun(3600), d2 = nodeRun(DAY), m2 = nodeRun(600);
  const used = 500 - h2.fuel, want = 1500 * (1 - Math.exp(-800 / (320 * 9.80665)));
  console.log(`  node: fuel used ${used.toFixed(4)} kg, rocket equation ${want.toFixed(4)} kg; hour vs day |dr| ${norm(diff(h2.kState.r, d2.kState.r)).toExponential(2)} km`);
  check('the node draws the rocket-equation propellant for its delta-v (<1e-6 kg)', Math.abs(used - want) < 1e-6);
  check('the node ends in the same state with 10 min, hour or day frames (<0.1 km)',
    norm(diff(h2.kState.r, d2.kState.r)) < 0.1 && norm(diff(m2.kState.r, d2.kState.r)) < 0.1);
  check('the node is done and none are left', h2.executing === null && h2.nodes.length === 0);

  // A request lost mid-burn loses nothing.
  const c = manual(), ref = manual();
  for (let f = 1; f <= 48; f++) {
    c.advanceClock(T0 + f * 3600);
    const req = c.buildRequest();
    if (f === 1) { c.dropped(); continue; }
    if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]);
  }
  fly(ref, 3600, T0 + 2 * DAY);
  check('a request lost mid-burn changes nothing (<1e-3 km)', norm(diff(c.kState.r, ref.kState.r)) < 1e-3);
}

header('CASE 5: clock jumps, impacts and errors');
{
  const c = makeCraft('jump');
  fly(c, DAY, T0 + 5 * DAY);
  const before = c.displayState().r;
  frame(c, T0 - 360 * DAY, null, true);
  check('a backward jump keeps the state and re-anchors it', c.clockJumped &&
    norm(diff(before, c.displayState().r)) === 0 && Math.abs(c.kState.t - c.clockT) < 1e-9);

  // Dropped toward Earth from 20,000 km at rest relative to it.
  const f = new Craft({ name: 'fall', r: [E0.r[0] + 20000, E0.r[1], E0.r[2]], v: [...E0.v], t: T0, sys });
  const client = new KernelClient();
  for (let k = 1; k <= 20 && !f.crashed; k++) frame(f, T0 + k * 1800, client);
  const drawn = norm(diff(f.onSite(f.kState.t).r, f.kState.r));
  check(`an impact is reported (${f.impactBody})`, f.crashed && f.impactBody === 'earth');
  check(`the crashed craft is drawn at the impact point (${(drawn * 1000).toFixed(1)} m)`, drawn < 1);
  // Three days on it still lies on the Earth, carried round by its spin: left
  // where it was in space, the Earth would be 7 million km away.
  const tHit = f.kState.t, hitR = norm(diff(f.kState.r, sys.bodiesAt(tHit).find((b) => b.key === 'earth').r));
  f.advanceClock(tHit + 3 * DAY);
  const later = f.displayState(), E3 = sys.bodiesAt(tHit + 3 * DAY).find((b) => b.key === 'earth');
  const d3 = diff(later.r, E3.r), v3 = norm(diff(later.v, E3.eph.velocity(tHit + 3 * DAY)));
  check(`three days on it is still on the Earth (${norm(d3).toFixed(3)} km from its centre, ${hitR.toFixed(3)} at impact)`, Math.abs(norm(d3) - hitR) < 1e-6);
  check(`and turns with it (${(v3 * 1000).toFixed(0)} m/s, the ground's speed at its latitude)`, v3 > 0.05 && v3 < 0.47);
  check('it stays down', f.crashed && f.buildRequest() === null);
  check(`it came down on the WGS-84 surface (${hitR.toFixed(1)} km, between the poles' 6,356.8 and the equator's 6,378.1)`, hitR < 6378.137 && hitR > 6356.0);

  const bad = makeCraft('bad'), good = makeCraft('good'), client2 = new KernelClient();
  bad.advanceClock(T0 + 43200); good.advanceClock(T0 + 43200);
  bad.kState.r = [NaN, NaN, NaN];
  client2.tick([bad, good]);
  check('a NaN state comes back as an error and the craft stops requesting', !!bad.error && bad.buildRequest() === null);
  check('the other craft still stepped and the client is free', good.kState.t > T0 && !client2.busy);
  const late = makeCraft('nan-time');
  late.advanceClock(T0 + 43200);
  late.kState.t = NaN;
  check('a NaN physics time is flagged, not silently frozen', late.buildRequest() === null && !!late.error);
}

header('CASE 6: launches and flying a Lambert plan');
{
  {
    const mu = MU_E, rp = 6578, vInf = [1.2, -2.5, 0.9];
    const h = departureHyperbola({ planetR: [0, 0, 0], planetV: [0, 0, 0], vInf, mu, rp });
    const el = rvToElements(h.r, h.v, mu);
    const far = propagate(h.r, h.v, 200 * DAY, mu);
    const ang = Math.acos((far.v[0] * vInf[0] + far.v[1] * vInf[1] + far.v[2] * vInf[2]) / (norm(far.v) * norm(vInf))) * 180 / Math.PI;
    const dla = Math.asin(vInf[2] / norm(vInf)) * 180 / Math.PI;
    check('departure hyperbola: periapsis on the parking orbit (1e-6 km, true anomaly 0)', Math.abs(el.a * (1 - el.e) - rp) < 1e-6 && Math.abs(Math.sin(el.nu)) < 1e-9);
    check('departure hyperbola: the asymptote is v_inf (within 1e-3 deg after 200 days)', ang < 1e-3);
    check('departure hyperbola: the lowest-inclination plane (= |declination of v_inf|)', Math.abs(h.inclinationToPole * 180 / Math.PI - Math.abs(dla)) < 1e-9);
  }
  // Launches from a 200 km parking orbit, v_inf along Earth's heliocentric
  // prograde / retrograde direction.
  const muE = GM.earth / 1e9, muS = GM.sun / 1e9, rp = PLANETS.earth.radius + 200;
  const pro = unit(E0.v);
  const launch = (vi, days) => {
    const vInf = pro.map((x) => x * vi);
    const st = Math.abs(vi) > 1e-6
      ? departureHyperbola({ planetR: E0.r, planetV: E0.v, vInf, mu: muE, rp })
      : escapeStart({ planetR: E0.r, planetV: E0.v, vInf, mu: muE, radius: PLANETS.earth.radius, muSun: muS });
    const c = new Craft({ name: 'l', r: st.r, v: st.v, t: T0, sys });
    fly(c, 3600, T0 + 3 * DAY); fly(c, DAY, T0 + days * DAY);
    const el = rvToElements(c.kState.r, c.kState.v, muS);
    return { a: el.a / AU, e: el.e, ap: el.e < 1 ? el.a * (1 + el.e) / AU : Infinity, pe: el.a * (1 - el.e) / AU };
  };
  const earthAU = norm(E0.r) / AU;
  const vHoh = hohmann(AU, 1.524 * AU, muS).dv1;
  const z = launch(0, 365), p = launch(5, 30), r = launch(-5, 30), h = launch(vHoh, 30), e = launch(12.3, 30);
  console.log(`  zero: a ${z.a.toFixed(3)} e ${z.e.toFixed(3)} | +5: Ap ${p.ap.toFixed(2)} | -5: Pe ${r.pe.toFixed(2)} | Hohmann ${vHoh.toFixed(3)} km/s: Ap ${h.ap.toFixed(3)} | 12.3: e ${e.e.toFixed(3)} (Earth ${earthAU.toFixed(3)} AU)`);
  check('zero v_inf stays near Earth\'s orbit (|a - 1| < 0.06, e < 0.07)', Math.abs(z.a - 1) < 0.06 && z.e < 0.07);
  check('5 km/s prograde raises apoapsis, periapsis at Earth', p.ap > 1.5 && Math.abs(p.pe - earthAU) < 0.03);
  check('5 km/s retrograde lowers periapsis, apoapsis at Earth', r.pe < 0.8 && Math.abs(r.ap - earthAU) < 0.03);
  check('the Hohmann v_inf reaches Mars\'s distance (Ap 1.524 +/- 0.06)', Math.abs(h.ap - 1.524) < 0.06);
  check('12.3 km/s prograde escapes the Sun', e.e >= 1 && e.ap === Infinity);

  // The 2026 porkchop minimum, flown through the kernel from a 200 km
  // parking orbit on the departure hyperbola (no correction burns).
  const dep = START, tof = 308;
  const Ed = helioStateEcl('earth', dep), Ma = helioStateEcl('mars', new Date(dep.getTime() + tof * 864e5));
  const t = transferBetween(Ed, Ma, tof * DAY, muS, { mu: muE, rPark: 6571 }, { mu: GM.mars / 1e9, rPark: 3790, capture: true });
  const st = departureHyperbola({ planetR: E0.r, planetV: E0.v, vInf: eclToEqj([0, 1, 2].map((i) => t.v1[i] - Ed.v[i])), mu: muE, rp });
  const c = new Craft({ name: 'plan', r: st.r, v: st.v, t: T0, sys });
  let best = { d: Infinity, day: 0 };
  for (let day = 1 / 96; day <= tof + 30; day += day < 3 ? 1 / 96 : 0.25) {
    frame(c, T0 + day * DAY);
    const dist = norm(diff(c.kState.r, helioStateEqj('mars', new Date(dep.getTime() + day * 864e5)).r));
    if (dist < best.d) best = { d: dist, day };
  }
  console.log(`  2026 Lambert plan flown by the kernel: closest to Mars ${(best.d / 1e3).toFixed(0)}k km on day ${best.day.toFixed(2)} (planned ${tof})`);
  check('the flown plan passes Mars within 500,000 km and 12 days of the plan', best.d < 5e5 && Math.abs(best.day - tof) < 12);
}

header('CASE 7: burns across clock jumps, fuel checks');
{
  const c = makeCraft('jump-burn', { dryMass: 1000, fuel: 1000, isp: 3000 / 9.80665 });
  c.setEngine([0, 0, -1]);
  frame(c, T0 + 200);
  const fuelAfter = c.fuel;
  frame(c, T0 + 200 - 3600, null, true);                   // set an hour back
  fly(c, 60, T0 + 400);
  check('after a backward jump the old burn is not flown again', c.fuel === fuelAfter && !c.engineOn && c.burns.length === 0);

  let threw = false;
  try { const f = makeCraft('fresh'); f.setEngine([1, 0, 0]); f.setEngine(null); } catch { threw = true; }
  check('switching the engine before the first frame does not throw', !threw);

  const n = makeCraft('big-node');
  n.addNode(T0 + 600, [0, 1.5, 0]);                        // 1.5 km/s: needs 568 kg, has 500
  fly(n, 300, T0 + 1800);
  check('an undeliverable node is refused before any propellant is spent',
    n.nodes.length === 0 && n.fuel === 500 && n.burns.length === 0 && n.log.some((x) => x.text.startsWith('node refused')));
}

console.log('='.repeat(60));
if (failures > 0) { console.log(`RESULT: ${failures} check(s) FAILED`); process.exit(1); }
console.log('RESULT: all checks PASSED');
