// src/physics/porkchop.test.mjs
//
// Tests for the porkchop grid and the astronomy-engine ephemeris adapter.
// Needs `npm install` (astronomy-engine). Run with:
//     node src/physics/porkchop.test.mjs
// Reference values come from src/physics/fixtures/spice_reference.json
// (CSPICE + DE442, see c/README.md).

import './deNode.js';                 // DE442's Earth and Moon, as in the app
import { readFileSync } from 'node:fs';
import { lambert } from './orbital.js';
import { helioStateEqj, helioStateEcl } from './ephemeris.js';
import { porkchopGrid, transferBetween, range } from './porkchop.js';
import { GRAVITATIONAL_PARAMETERS, PLANETS } from '../utils/constants.js';

const SPICE = JSON.parse(readFileSync(new URL('./fixtures/spice_reference.json', import.meta.url), 'utf8'));
const DAY = 86400.0;
let failures = 0;
function check(name, ok) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
}
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const diff = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// SPICE epoch strings in the fixture -> UTC Date. J2000 (TDB) is
// 2000-01-01 11:58:55.816 UTC.
const EPOCH_UTC = {
  '2000 JAN 01 12:00:00 TDB': new Date('2000-01-01T11:58:55.816Z'),
  '2011 NOV 26 15:02:00 UTC': new Date('2011-11-26T15:02:00Z'),
  '2026 JAN 01 00:00:00 UTC': new Date('2026-01-01T00:00:00Z'),
};
const KEY = {
  MERCURY: 'mercury', VENUS: 'venus', EARTH: 'earth', 'MARS BARYCENTER': 'mars',
  'JUPITER BARYCENTER': 'jupiter', 'SATURN BARYCENTER': 'saturn',
  'URANUS BARYCENTER': 'uranus', 'NEPTUNE BARYCENTER': 'neptune',
};
const INNER = new Set(['venus', 'earth', 'mars']);
let mslC3 = NaN;   // set by case 2 from the DE442 states, used by case 3

console.log('='.repeat(60));
console.log('CASE 1: the app ephemeris vs DE442 (heliocentric J2000; Earth is DE442 itself, case 1b)');
console.log('='.repeat(60));
{
  let worstInnerR = 0, worstInnerV = 0, worstAllR = 0, worstAllV = 0;
  for (const p of SPICE.planets) {
    const key = KEY[p.s.body];
    const s = helioStateEqj(key, EPOCH_UTC[p.epoch]);
    const r = p.s.state.slice(0, 3), v = p.s.state.slice(3);
    const relR = norm(diff(s.r, r)) / norm(r);
    const dV = norm(diff(s.v, v));
    worstAllR = Math.max(worstAllR, relR); worstAllV = Math.max(worstAllV, dV);
    if (INNER.has(key)) { worstInnerR = Math.max(worstInnerR, relR); worstInnerV = Math.max(worstInnerV, dV); }
  }
  console.log(`  Venus/Earth/Mars: worst rel pos ${worstInnerR.toExponential(2)}, worst vel ${(worstInnerV * 1e3).toFixed(2)} m/s`);
  console.log(`  all 8 bodies:     worst rel pos ${worstAllR.toExponential(2)}, worst vel ${(worstAllV * 1e3).toFixed(2)} m/s`);
  check('Venus/Earth/Mars position within 3e-5 relative', worstInnerR < 3e-5);
  check('Venus/Earth/Mars velocity within 3 m/s', worstInnerV < 3e-3);
  check('all planets position within 2e-4 relative', worstAllR < 2e-4);
  check('all planets velocity within 15 m/s', worstAllV < 15e-3);
}

console.log('='.repeat(60));
console.log("CASE 1b: the app's Earth (DE442 table) vs DE442 through SPICE");
console.log('='.repeat(60));
{
  // Earth comes from the Chebyshev table (deTable.js) between 2000 and
  // 2050, through the app's own UTC -> TDB conversion (timescale.js).
  let worstR = 0, worstV = 0;
  const cases = [...SPICE.planets.filter((p) => p.s.body === 'EARTH').map((p) => [EPOCH_UTC[p.epoch], p.s.state]),
    [new Date(`${SPICE.msl.launch_utc}Z`), SPICE.msl.earth_at_launch.state]];
  for (const [date, st] of cases) {
    const s = helioStateEqj('earth', date);
    worstR = Math.max(worstR, norm(diff(s.r, st.slice(0, 3))));
    worstV = Math.max(worstV, norm(diff(s.v, st.slice(3))));
  }
  console.log(`  ${cases.length} epochs: worst ${(worstR * 1000).toFixed(3)} m, ${(worstV * 1e6).toFixed(3)} mm/s`);
  // The other epochs are within 0.1 m; the J2000 epoch, given here as UTC
  // to the millisecond (11:58:55.816), is 0.07 ms off its exact instant,
  // which Earth covers in 2.1 m.
  check("the app's Earth within 5 m of DE442 at every epoch", worstR < 5e-3);
  check("the app's Earth velocity within 1 mm/s of DE442", worstV < 1e-6);
}

console.log('='.repeat(60));
console.log('CASE 2: MSL cell, astronomy-engine vs DE442 states');
console.log('='.repeat(60));
{
  const m = SPICE.msl;
  const muSun = SPICE.meta.gm.sun;
  const sE = m.earth_at_launch.state, sM = m.mars_at_arrival.state;
  const ref = lambert(sE.slice(0, 3), sM.slice(0, 3), m.tof_s, muSun, true);
  const c3Ref = norm(diff(ref.v1, sE.slice(3))) ** 2;
  mslC3 = c3Ref;
  const vinfArrRef = norm(diff(ref.v2, sM.slice(3)));

  const launch = new Date('2011-11-26T15:02:00Z');
  const arrive = new Date('2012-08-06T05:17:00Z');
  const tof = (arrive - launch) / 1000;
  const dep = { mu: GRAVITATIONAL_PARAMETERS.earth / 1e9, rPark: PLANETS.earth.radius + 200 };
  const arr = { mu: GRAVITATIONAL_PARAMETERS.mars / 1e9, rPark: PLANETS.mars.radius + 400, capture: true };
  const t = transferBetween(helioStateEcl('earth', launch), helioStateEcl('mars', arrive), tof, muSun, dep, arr);
  console.log(`  DE442:            C3 = ${c3Ref.toFixed(4)} km^2/s^2   arrival v_inf = ${vinfArrRef.toFixed(4)} km/s`);
  console.log(`  astronomy-engine: C3 = ${t.c3.toFixed(4)} km^2/s^2   arrival v_inf = ${t.vinfArr.toFixed(4)} km/s`);
  console.log(`  tof SPICE ${(m.tof_s / DAY).toFixed(4)} d vs UTC ${(tof / DAY).toFixed(4)} d`);
  check('C3 agrees with DE442 within 0.02 km^2/s^2', Math.abs(t.c3 - c3Ref) < 0.02);
  check('arrival v_inf agrees with DE442 within 5 m/s', Math.abs(t.vinfArr - vinfArrRef) < 5e-3);
  check('MSL arc is Type I', t.type === 1);
}

console.log('='.repeat(60));
console.log('CASE 3: Earth->Mars 2011 porkchop grid');
console.log('='.repeat(60));
{
  const depStart = new Date('2011-09-01T00:00:00Z');
  const depDays = range(0, 180, 2);
  const tofDays = range(120, 360, 2);
  const t0 = performance.now();
  const g = porkchopGrid({
    stateOf: helioStateEcl,
    departure: { key: 'earth', mu: GRAVITATIONAL_PARAMETERS.earth / 1e9, rPark: PLANETS.earth.radius + 200 },
    arrival: { key: 'mars', mu: GRAVITATIONAL_PARAMETERS.mars / 1e9, rPark: PLANETS.mars.radius + 400, capture: true },
    muSun: SPICE.meta.gm.sun,
    depStart, depDays, tofDays,
  });
  const ms = performance.now() - t0;
  let solved = 0;
  for (const x of g.c3) if (Number.isFinite(x)) solved++;
  const day = (d) => d.toISOString().slice(0, 10);
  const mc = g.minC3, mt = g.minTotal;
  console.log(`  ${g.nDep} x ${g.nTof} = ${g.nDep * g.nTof} cells in ${ms.toFixed(0)} ms, solved ${solved}`);
  console.log(`  min C3   ${mc.c3.toFixed(2)} km^2/s^2: depart ${day(mc.departure)}, ${mc.tofDays} d, type ${mc.type}`);
  console.log(`  min dV   ${mt.dvTotal.toFixed(3)} km/s (${mt.dvDep.toFixed(3)} + ${mt.dvArr.toFixed(3)}): ` +
    `depart ${day(mt.departure)}, ${mt.tofDays} d, type ${mt.type}`);
  const interior = (b) => b.iDep > 0 && b.iDep < g.nDep - 1 && b.iTof > 0 && b.iTof < g.nTof - 1;
  check('at least 99% of cells solved', solved >= 0.99 * g.nDep * g.nTof);
  check('min C3 is a basin inside the grid, not on an edge', interior(mc));
  check('min total dV is a basin inside the grid, not on an edge', interior(mt));
  check('min-C3 departure falls in Oct-Dec 2011 (the 2011 window)',
    mc.departure >= new Date('2011-10-01') && mc.departure < new Date('2012-01-01'));
  check('MSL launch C3 (case 2) is not below the grid minimum', mc.c3 <= mslC3);
  check('grid runs in under 3 s', ms < 3000);
}

console.log('='.repeat(60));
console.log('CASE 4: signed Hohmann excess speed');
console.log('='.repeat(60));
{
  const { hohmannVinf } = await import('./porkchop.js');
  const AUk = 149597870.7, muS = SPICE.meta.gm.sun;
  const toMars = hohmannVinf(AUk, 1.523679 * AUk, muS), toVenus = hohmannVinf(AUk, 0.723332 * AUk, muS);
  console.log(`  Earth to Mars ${toMars.toFixed(3)} km/s, Earth to Venus ${toVenus.toFixed(3)} km/s`);
  // Curtis Ex 8.3: Earth to Mars departure v_inf 2.943 km/s (circular, coplanar).
  check('Earth to Mars is outward, +2.94 km/s (Curtis Ex 8.3: 2.943)', Math.abs(toMars - 2.943) < 0.005);
  check('Earth to Venus is inward: negative, about -2.5 km/s', toVenus < 0 && Math.abs(toVenus + 2.495) < 0.01);
}

console.log('='.repeat(60));
if (failures > 0) {
  console.log(`RESULT: ${failures} check(s) FAILED`);
  process.exit(1);
} else {
  console.log('RESULT: all checks PASSED');
}
