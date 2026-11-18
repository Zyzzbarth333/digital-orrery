// src/physics/umbra.test.mjs
//
// The light the Earth's air bends into its shadow (umbra.js): the bend's
// limits, the grazing path's transmittance, and the eclipsed Moon's light
// against what eclipses show: red, 10^-4 to 10^-3 of sunlight in its
// reddest light at the centre, brighter toward the umbra's edge, with
// ozone's blue fringe there.
//
//   node src/physics/umbra.test.mjs

import { DEFLECTION_GROUND_RAD, grazingTransmittance, tangentHeight, umbraLight, umbraTable } from './umbra.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}

// atmosphere.ts's EARTH_ATMOSPHERE (a TypeScript module node cannot load).
const EARTH = {
  topKm: 100, rayleigh: [5.802e-3, 13.558e-3, 33.1e-3], rayleighHKm: 8, mieExtinct: [4.44e-3, 4.44e-3, 4.44e-3], mieHKm: 1.2,
  ozone: [0.650e-3, 1.881e-3, 0.085e-3], ozoneCentreKm: 25, ozoneHalfWidthKm: 15,
};
const R = 6371, L = 384400 / R;
const fmt = (v) => v.map((x) => x.toExponential(2)).join(' ');

console.log('Bend and tangent height');
check(Math.abs(DEFLECTION_GROUND_RAD * 180 / Math.PI - 1.15) < 0.01, `a ray grazing the ground is bent ${(DEFLECTION_GROUND_RAD * 180 / Math.PI).toFixed(3)} deg (twice the horizon's 34.5')`);
check(tangentHeight(DEFLECTION_GROUND_RAD) === 0 && tangentHeight(DEFLECTION_GROUND_RAD * 1.01) === null, 'no ray bends more than one grazing the ground');
check(Math.abs(tangentHeight(DEFLECTION_GROUND_RAD / Math.E) - 8) < 1e-9, 'the bend falls by e every 8 km');

console.log('Grazing transmittance');
const hs = [0, 5, 10, 20, 40, 80];
const Ts = hs.map((h) => grazingTransmittance(EARTH, h, R));
check(Ts.every((t, i) => i === 0 || t.every((x, c) => x >= Ts[i - 1][c])), `rises with height: ${Ts.map((t) => t[1].toFixed(3)).join(', ')} (green)`);
check(grazingTransmittance(EARTH, 100, R).every((x) => x === 1), 'nothing lost above the top');
// Rayleigh alone, by the Chapman grazing air mass sqrt(2 pi R / H) at the
// ground, both ways: the integral within a percent.
const rayOnly = { ...EARTH, mieExtinct: [0, 0, 0], ozone: [0, 0, 0] };
const tauR = -Math.log(grazingTransmittance(rayOnly, 0, R)[0]);
const chapman = EARTH.rayleigh[0] * 8 * Math.sqrt((2 * Math.PI * R) / 8);
check(Math.abs(tauR / chapman - 1) < 0.02, `Rayleigh optical depth on the grazing path ${tauR.toFixed(3)} against Chapman's ${chapman.toFixed(3)}`);
const tab = umbraTable(EARTH, R);
check(tab.n === 24 && tab.table.length === 72 && Math.abs(tab.table[3 * 23 + 1] - grazingTransmittance(EARTH, 60, R)[1]) < 1e-6, 'the shader table holds T at 24 heights to 60 km');

console.log('The Earth\'s shadow at the Moon');
const centre = umbraLight(EARTH, R, L, 0);
console.log(`    centre ${fmt(centre)}, 0.5 ${fmt(umbraLight(EARTH, R, L, 0.5))}, 0.7 ${fmt(umbraLight(EARTH, R, L, 0.7))}, 0.9 ${fmt(umbraLight(EARTH, R, L, 0.9))}`);
check(centre[0] > 1e-4 && centre[0] < 1e-3, 'the centre gets 10^-4 to 10^-3 of sunlight in red');
check(centre[0] > 20 * centre[1] && centre[1] > 20 * centre[2], 'and is red: green and blue are gone');
const edge = umbraLight(EARTH, R, L, 0.7);
check(edge[0] > 3 * centre[0], 'the umbra\'s edge (0.7 radii) is brighter than its centre');
const fringe = umbraLight(EARTH, R, L, 0.92);
check(fringe[2] > fringe[1], 'near the edge ozone takes more green than blue: the turquoise fringe');
const near = umbraLight(EARTH, R, 1.1, 0.3);
check(near.every((x) => x === 0), 'just behind the Earth (a low orbit) no bent light arrives');

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
