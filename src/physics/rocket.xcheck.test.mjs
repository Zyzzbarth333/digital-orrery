// src/physics/rocket.xcheck.test.mjs
//
// The ROCKET tab's ascent (rocket.js) against two other simulators flying
// the same vehicles: OpenRocket 24.12 (GPL-3.0, run as an outside oracle)
// and RocketPy 1.13 (MIT, in its point-mass "3 DOF" mode). The vehicles are
// two of OpenRocket's bundled examples, a one-stage model rocket and a
// two-stage high-power rocket, flown calm and straight up from sea level on
// the equator in the ISA atmosphere. fixtures/rocket_xcheck.json holds what
// OpenRocket flew and what it got (written by rocket.openrocket.mjs);
// fixtures/rocketpy_xcheck.json holds RocketPy's results (tools/rocketpy/fly.py).
//
// Ours flies the same thrust curves, masses, reference area and gravity,
// with the drag coefficient taken two ways:
// - replayed: OpenRocket's own against time, so only the integration and
//   the mass model differ from OpenRocket's flight;
// - from tables against Mach, burning and coasting, as RocketPy is given it.

import fs from 'node:fs';
import { ascent, EARTH } from './rocket.js';
import { standardAtmosphere } from './atmosphere.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const rel = (a, b) => Math.abs(a / b - 1);
const pct = (a, b) => `${((a / b - 1) * 100).toFixed(2)} %`;

const read = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const OR = read('rocket_xcheck.json').vehicles, RP = read('rocketpy_xcheck.json').vehicles;

// Piecewise linear through [x, y] points, held beyond the ends.
const lerp = (pts) => (x) => {
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts.at(-1)[0]) return pts.at(-1)[1];
  let i = 1;
  while (pts[i][0] < x) i++;
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
};
// The ISA (the 1976 standard's troposphere): density and pressure ratio.
const isa = (h) => { const s = standardAtmosphere(Math.max(0, h) / 1000); return { rho: s.rho, p: s.p / 101325 }; };

function fly(v, drag) {
  const on = lerp(v.drag.powerOn.length ? v.drag.powerOn : v.drag.powerOff), off = lerp(v.drag.powerOff.length ? v.drag.powerOff : v.drag.powerOn);
  const replay = lerp(v.drag.replay);
  const cdAt = drag === 'replay' ? (M, t) => replay(t) : (M, t, burning) => (burning ? on : off)(M);
  const res = ascent({
    stages: v.stages.map(({ name, dry, prop, thrustCurve }) => ({ name, dry, prop, thrustCurve })), payload: v.payload,
    vertical: true, stopAtApogee: true, coast: 1e6, cdAt, area: v.refArea, atmosphere: isa,
    g0: v.gravity, R: EARTH.R, rotation: 0, dt: 0.001, sample: 0.001,
  });
  const top = res.events.find((e) => e.type === 'apogee');
  const at = lerp(res.history.map((p) => [p.t, p.h]));
  return { apogee: top.h, timeToApogee: top.t, maxSpeed: Math.max(...res.history.map((p) => p.v)), heightAt: at, res };
}

const line = (who, r, ref) => console.log(`  ${who.padEnd(26)} apogee ${r.apogee.toFixed(2).padStart(7)} m${ref ? ` (${pct(r.apogee, ref.apogee)})` : '          '}   at ${r.timeToApogee.toFixed(3)} s${ref ? ` (${pct(r.timeToApogee, ref.timeToApogee)})` : '          '}   top speed ${r.maxSpeed.toFixed(2)} m/s${ref ? ` (${pct(r.maxSpeed, ref.maxSpeed)})` : ''}`);

for (const [key, v] of Object.entries(OR)) {
  header(`${v.name}: ${v.stages.length} stage(s), ${(v.liftoffMass * 1000).toFixed(1)} g at liftoff`);
  const or = { apogee: v.openrocket.maxAltitude, timeToApogee: v.openrocket.apogeeTime, maxSpeed: v.openrocket.maxVelocity };
  const rp = RP[key];
  const replay = fly(v, 'replay'), table = fly(v, 'table');
  line('OpenRocket 24.12', or);
  line('ours, its drag replayed', replay, or);
  line('RocketPy 1.13 (3-DOF)', rp, or);
  line('ours, drag against Mach', table, or);
  // The height every half second, against OpenRocket's.
  const dev = v.openrocket.history.filter(([t]) => t <= or.timeToApogee).map(([t, h]) => Math.abs(replay.heightAt(t) - h));
  const worst = Math.max(...dev);
  console.log(`  ours (replayed) against OpenRocket's height every half second: within ${worst.toFixed(2)} m`);
  // OpenRocket's own mass history is flown (rocket.openrocket.mjs); where it
  // burns more than the motors hold, say so.
  for (const st of v.stages) if (rel(st.prop, st.ratedProp) > 1e-3) console.log(`  note: OpenRocket's flight loses ${(st.prop * 1000).toFixed(1)} g while ${st.name} burns, though its motors hold ${(st.ratedProp * 1000).toFixed(1)} g of propellant; flown as OpenRocket flew it`);
  check('the stages and payload add up to the liftoff mass', rel(v.stages.reduce((s, st) => s + st.prop + st.dry, v.payload), v.liftoffMass) < 1e-4);
  check('given OpenRocket\'s drag, apogee, the time to it and the top speed within 0.1 % of OpenRocket\'s', rel(replay.apogee, or.apogee) < 1e-3 && rel(replay.timeToApogee, or.timeToApogee) < 1e-3 && rel(replay.maxSpeed, or.maxSpeed) < 1e-3);
  check('given OpenRocket\'s drag, its height every half second within 0.1 % of the apogee', worst < 1e-3 * or.apogee);
  check('given the same drag tables, apogee, the time to it and the top speed within 0.1 % of RocketPy\'s', rel(table.apogee, rp.apogee) < 1e-3 && rel(table.timeToApogee, rp.timeToApogee) < 1e-3 && rel(table.maxSpeed, rp.maxSpeed) < 1e-3);
  check('all three simulators\' apogees within 0.1 % of each other', Math.max(rel(table.apogee, or.apogee), rel(rp.apogee, or.apogee), rel(replay.apogee, rp.apogee)) < 1e-3);
}

console.log('='.repeat(72));
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
