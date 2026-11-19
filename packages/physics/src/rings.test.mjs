// packages/physics/src/rings.test.mjs
//
// The rings of Jupiter, Uranus and Neptune (rings.js) against the tables
// they come from and independent ones: French et al. (2024) for Uranus's
// orbits, the NASA PDS Ring-Moon Systems Node's and NSSDC's ring tables,
// the Voyager 2 PPS occultations' equivalent depths
// (public/textures/uranus/rings_pps.json), and the Adams arcs' measured
// longitudes (Porco et al. 1995, Renner et al. 2014, Souami et al. 2022).
//
//   node packages/physics/src/rings.test.mjs

import { readFileSync } from 'node:fs';
import {
  URANUS_NARROW, URANUS_BROAD, NEPTUNE_NARROW, NEPTUNE_BROAD, ADAMS_ARCS, FRATERNITE_FIXES, JUPITER,
  URANUS_EPOCH_JD, edgeAt, edgeRadius, ringWidth, ringPlaneAt, ringAxes, equatorNode,
  fraterniteLongitude, fraterniteRates, dustPhase, dustNormalIF, PARTICLE_ALBEDO,
  modeOffset, arcsAt, galateaLongitude, ADAMS_WIGGLE, ringReflectivity, NEPTUNE_ARC_REFLECTIVITY, URANUS_LAMBERT_ALBEDO, lambertPhase,
} from './rings.js';
import { moonPositionEqj } from './moons.js';
import { bodyAxesEqj } from './orientation.js';
import { MOON_DATA } from './moons.data.js';
import { dot } from './vec.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const D = Math.PI / 180;
const ring = (n) => URANUS_NARROW.find((r) => r.name === n);
const angle = (a, b) => Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / D;

console.log('Uranus: radii, eccentricities and inclinations against the PDS Ring-Moon Systems Node table');
// [name, middle radius km, e, i deg] (Vital Statistics for Uranus's Rings).
// Gamma's e there (and in NSSDC's sheet) is 1.092e-3, ten times French et
// al.'s a e = 5.3 km at 47,626 km (1.11e-4): a slipped decimal, so 1.092e-4.
const RMS = [['6', 41838, 0.00102, 0.0607], ['5', 42234, 0.0019, 0.0559], ['4', 42571, 0.00106, 0.032],
  ['alpha', 44718, 0.00076, 0.015], ['beta', 45661, 0.000442, 0.005], ['eta', 47176, 0, 0],
  ['gamma', 47627, 0.0001092, 0], ['delta', 48300, 0, 0.001], ['lambda', 50024, 0, 0], ['epsilon', 51149, 0.00794, 0]];
for (const [n, a, e, i] of RMS) {
  const r = ring(n), c = edgeAt(r.cor, URANUS_EPOCH_JD), p = ringPlaneAt(r, URANUS_EPOCH_JD);
  check(Math.abs(c.a - a) < 3 && Math.abs(c.e - e) < 0.03e-3 + 0.03 * e && Math.abs(p.i - i) < 0.0015,
    `${n.padEnd(7)} a ${c.a.toFixed(1)} km (table ${a}), e ${(c.e * 1e3).toFixed(3)}e-3 (${(e * 1e3).toFixed(3)}), i ${p.i.toFixed(4)} deg (${i})`);
}

console.log('Uranus: widths at periapse and apoapse against NSSDC (the edges are French et al. 2024)');
for (const [n, lo, hi, tol] of [['alpha', 4, 10, 0.6], ['beta', 5, 11, 0.7], ['epsilon', 20, 96, 1.5]]) {
  const r = ring(n), w = edgeAt(r.cor, URANUS_EPOCH_JD).varpi;
  const wp = ringWidth(r, w, URANUS_EPOCH_JD), wa = ringWidth(r, w + 180, URANUS_EPOCH_JD);
  check(Math.abs(wp - lo) < tol && Math.abs(wa - hi) < tol, `${n.padEnd(7)} ${wp.toFixed(1)} to ${wa.toFixed(1)} km (table ${lo} to ${hi}, within ${tol})`);
}
for (const [n, w] of [['6', 1.5], ['eta', 1.6], ['lambda', 2.3]]) {
  const r = ring(n), W = r.oer[0] - r.ier[0];
  check(Math.abs(W - w) < 0.9, `${n.padEnd(7)} mean width ${W.toFixed(2)} km (table ${w})`);
}

console.log('Uranus: the PPS equivalent depths against the tables\' optical depths');
const pps = JSON.parse(readFileSync(new URL('../../../public/textures/uranus/rings_pps.json', import.meta.url))).rings;
const eps = ring('epsilon'), wE = edgeAt(eps.cor, URANUS_EPOCH_JD).varpi, E = pps.epsilon.equivalentDepthKm;
const tP = E / ringWidth(eps, wE, URANUS_EPOCH_JD), tA = E / ringWidth(eps, wE + 180, URANUS_EPOCH_JD);
check(Math.abs(tP - 2.3) < 0.25 && Math.abs(tA - 0.5) < 0.06, `epsilon tau ${tA.toFixed(2)} at apoapse to ${tP.toFixed(2)} at periapse (table 0.5 to 2.3)`);
for (const [n, tau] of [['6', 0.3], ['5', 0.5], ['4', 0.3], ['alpha', 0.4], ['beta', 0.3], ['eta', 0.4], ['gamma', 0.3], ['delta', 0.5], ['lambda', 0.1]]) {
  const r = ring(n), t = pps[n].equivalentDepthKm / (r.oer[0] - r.ier[0]);
  check(t / tau > 0.45 && t / tau < 2.2, `${n.padEnd(7)} mean tau ${t.toFixed(2)} (table ~${tau}, within a factor 2.2)`);
}
check(URANUS_BROAD.find((b) => b[0] === 'nu')[3] === 5.6e-6 && URANUS_BROAD.find((b) => b[0] === 'mu')[3] === 8.5e-6,
  'nu and mu rings at the Ring-Moon Systems Node\'s 5.6e-6 and 8.5e-6');

console.log('Uranus: the rings\' frame');
// French et al. 2024: pole (positive angular momentum) RA 77.311327, Dec 15.172795 (J2000).
const fp = [Math.cos(15.172795 * D) * Math.cos(77.311327 * D), Math.cos(15.172795 * D) * Math.sin(77.311327 * D), Math.sin(15.172795 * D)];
const iau = bodyAxesEqj('uranus', new Date(Date.UTC(1986, 0, 19, 12)))[2];
check(angle(fp, iau) < 0.01, `the IAU pole the scene uses is French et al.'s within ${angle(fp, iau).toFixed(4)} deg (opposite sense: Uranus spins retrograde)`);
const pole = iau.map((x) => -x);
const { N } = equatorNode(pole);
const ax = ringAxes(pole, 0.06, 90);
check(Math.abs(N[2]) < 1e-12 && Math.abs(angle(ax.n, pole) - 0.06) < 1e-9 && Math.abs(dot(ax.X, ax.Y)) < 1e-12,
  'longitudes start at the equator\'s node on the Earth equator; a ring at i = 0.06 deg tilts 0.06 deg about its node');
// Periapse precession over a year: 2.7619579 deg/day takes it 288.8 deg on
// (mod 360), so at the 1986 periapse longitude ring 6 is a e (1 - cos 288.8)
// further out.
const r6 = ring('6'), yr = 365.25, c6 = edgeAt(r6.cor, URANUS_EPOCH_JD);
const dr = edgeRadius(r6, 'cor', c6.varpi, URANUS_EPOCH_JD + yr) - edgeRadius(r6, 'cor', c6.varpi, URANUS_EPOCH_JD);
const want = c6.a * c6.e * (1 - Math.cos(((2.7619579 * yr) % 360) * D));
check(Math.abs(dr - want) < 0.05, `ring 6 at its 1986 periapse longitude is ${dr.toFixed(2)} km further out a year on (${want.toFixed(2)} from the table's rate)`);

console.log('Uranus: normal modes (French et al. 2024, Table 6)');
const nModes = URANUS_NARROW.reduce((n, r) => n + (r.modes?.length ?? 0), 0);
check(nModes === 10 && ring('gamma').modes.length === 5, `all ${nModes} modes fitted at the rings' centres are drawn (gamma 5, delta 2, epsilon 2, eta 1)`);
const dm = ring('delta').modes[0];
check(Math.abs(modeOffset(dm, dm[2], URANUS_EPOCH_JD) - dm[1]) < 1e-12,
  `delta's m = 2 mode pulls the ring in by its ${dm[1]} km at delta_m, a radial minimum, as Eqs. (5)-(6) define it`);
const gW = [0, 90, 180, 270].map((l) => ringWidth(ring('gamma'), l, URANUS_EPOCH_JD));
check(gW.every((w) => w > 2 && w < 5), `gamma's width round the ring ${gW.map((w) => w.toFixed(2)).join(', ')} km (table 1-4 km)`);

console.log('Uranus: particle albedo and depth against Voyager photometry (Svitek and Danielson 1987)');
check(Math.abs(PARTICLE_ALBEDO.uranus - (2 / 3) * URANUS_LAMBERT_ALBEDO) < 1e-12 && Math.abs(URANUS_LAMBERT_ALBEDO - 0.039) < 1e-12,
  `geometric albedo ${PARTICLE_ALBEDO.uranus.toFixed(3)}: 2/3 of the epsilon ring's Lambert albedo, 3.9 +/- 0.6 %`);
check(Math.abs(tA - 0.40) < 0.08, `epsilon's depth at apoapse from the PPS, ${tA.toFixed(2)}, against their 0.40 +/- 0.05 (within 0.08)`);

console.log('Neptune: radii and depths against NSSDC and the PPS occultation');
const nep = { 'Le Verrier': 53200, Adams: 62933 };
for (const r of NEPTUNE_NARROW) check(Math.abs(r.a - nep[r.name]) < 1, `${r.name} at ${r.a} km (NSSDC ${nep[r.name]})`);
check(Math.abs(NEPTUNE_BROAD[0][1] - 41900) < 200, `Galle at ${NEPTUNE_BROAD[0][1]} km (NSSDC ~41,900)`);
const lv = NEPTUNE_NARROW[0];
// Voyager PPS sigma Sgr (VG_2801 PN1P0105, 1 km): 0.25 km equivalent depth at Le Verrier.
check(Math.abs(lv.tau * lv.width - 0.25) < 0.1, `Le Verrier tau x width ${(lv.tau * lv.width).toFixed(2)} km (PPS 0.25 km)`);

console.log('Neptune: the Adams ring\'s shape (Porco 1991, via de Pater et al. 2018)');
const adams = NEPTUNE_NARROW.find((r) => r.name === 'Adams');
check(Math.abs(adams.a - 62932.37) < 0.02, `semimajor axis ${adams.a} km (62,932.37 +/- 0.02)`);
check(ADAMS_WIGGLE.m === 42 && Math.abs(ADAMS_WIGGLE.amplitudeKm - adams.a * 4.7e-4) < 1.5,
  `42 lobes of ${ADAMS_WIGGLE.amplitudeKm} km: a times the forced eccentricity 4.7e-4 is ${(adams.a * 4.7e-4).toFixed(1)} km`);
// Galatea, which the lobes turn with: Souami et al.'s longitude and mean
// motion against JPL's ephemeris (the app's fitted elements, 0.14 deg rms),
// in the ring frame (from the ascending node of Neptune's equator on J2000).
for (const iso of ['2016-08-23T00:25:00Z', '2026-11-10T15:00:00Z']) {
  const date = new Date(iso);
  const jd = date.getTime() / 86400000 + 2440587.5 + 69.184 / 86400;
  const npole = bodyAxesEqj('neptune', date)[2];
  const { N: nN, Q: nQ } = equatorNode(npole);
  const g = moonPositionEqj('galatea', date);
  const lonJpl = (Math.atan2(dot(g, nQ), dot(g, nN)) / D + 360) % 360;
  const dG = ((galateaLongitude(jd) - lonJpl + 540) % 360) - 180;
  // Souami et al.'s +/- 0.30 deg and the elements' up to 0.26 deg from Horizons: within 0.7.
  check(Math.abs(dG) < 0.7, `Galatea on ${iso.slice(0, 10)}: ${galateaLongitude(jd).toFixed(2)} deg from Souami et al., ${lonJpl.toFixed(2)} from JPL's ephemeris (within 0.7)`);
}

console.log('Neptune: the arcs over time');
const at = (y, m, d) => Date.UTC(y, m - 1, d, 12) / 86400000 + 2440587.5;
const arcs = (jd) => Object.fromEntries(arcsAt(jd).map((a) => [a.name, a]));
const a02 = arcs(at(2002, 7, 25)), a03 = arcs(at(2003, 10, 3)), a07 = arcs(at(2007, 8, 31)), a09 = arcs(at(2009, 7, 15)), a16 = arcs(at(2016, 8, 23));
const ratio = (x) => x['Egalite 1'].tau / x.Fraternite.tau;
check(Math.abs(ratio(a02) - 1.17) < 1e-9 && Math.abs(ratio(a03) - 0.93) < 1e-9 && Math.abs(ratio(a07) - 0.8) < 1e-9 && Math.abs(ratio(a16) - 76 / 84) < 1e-9,
  'Egalite against Fraternite: 1.17 (2002), 0.93 (2003), 0.80 (2007), 76/84 (2016)');
check(Math.abs(a03.Fraternite.tau / 0.1 - 0.75) < 1e-9 && Math.abs(a03.Liberte.tau / 0.1 - 0.3) < 1e-9 && Math.abs(a03.Courage.offset - 32.5 - 8) < 1e-9,
  'Oct 2003: Fraternite 25 % below Voyager, Liberte at 30 %, Courage 8 deg ahead');
check(a09.Liberte.tau === 0 && a09.Courage.tau === 0 && a16.Liberte.tau === 0, 'Liberte and Courage gone by July 2009, and since');
// Voyager's PPS crossed the Adams ring on 1989 Aug 24 at 23:24:30.6 UTC
// (84,270.6 s), at ring longitude 191.569 deg (VG_2801 GEOMETRY/PN1G01.TAB),
// and measured arc material there (equivalent depth 0.85 km).
const jdPps = 2447762.5 + 84270.6 / 86400 + 56.184 / 86400;
const ahead = ((191.569 - fraterniteLongitude(jdPps)) % 360 + 360) % 360;
const lib = arcsAt(jdPps).find((a) => a.name === 'Liberte');
const edge = lib.offset + lib.length / 2;
check(ahead - edge < 1.5, `PPS crossing ${ahead.toFixed(2)} deg ahead of Fraternite, ${(ahead - edge).toFixed(2)} deg past Liberte's leading edge (the published layouts differ by about a degree)`);

console.log('Neptune: brightness against Voyager (de Pater et al. 2018, Table 5.3)');
const refl = ringReflectivity(PARTICLE_ALBEDO.neptune, 0.5, NEPTUNE_ARC_REFLECTIVITY.phaseDeg);
check(Math.abs(refl - 0.055) <= NEPTUNE_ARC_REFLECTIVITY.sigma, `the arcs' reflectivity at 8 deg phase ${refl.toFixed(4)} (Voyager 0.055 +/- 0.004); particle albedo ${PARTICLE_ALBEDO.neptune.toFixed(3)}`);

console.log('Neptune: the Adams arcs');
for (const f of FRATERNITE_FIXES) {
  const L = fraterniteLongitude(f.jd), d = ((L - f.lon + 540) % 360) - 180;
  check(Math.abs(d) <= f.sigma, `Fraternite ${L.toFixed(2)} deg at JD ${f.jd.toFixed(3)} (${f.source}: ${f.lon} +/- ${f.sigma})`);
}
const [n1, n2] = fraterniteRates();
check(Math.abs(n1 - 820.11213) < 0.0002, `1989-2007 rate ${n1.toFixed(5)} deg/day (Renner et al. 2014: 820.11213 +/- 0.00008)`);
const nAll = (FRATERNITE_FIXES[2].lon - FRATERNITE_FIXES[0].lon + 360 * Math.round((820.1118 * (FRATERNITE_FIXES[2].jd - FRATERNITE_FIXES[0].jd) - (FRATERNITE_FIXES[2].lon - FRATERNITE_FIXES[0].lon)) / 360)) / (FRATERNITE_FIXES[2].jd - FRATERNITE_FIXES[0].jd);
check(Math.abs(nAll - 820.11178) < 0.0002, `1989-2016 mean ${nAll.toFixed(5)} deg/day (Souami et al. 2022: 820.11178 +/- 0.00003; 2007-16 alone ${n2.toFixed(5)})`);
const arc = (n) => ADAMS_ARCS.find((a) => a.name === n);
check(arc('Egalite 1').offset === 10.7 && Math.abs(arc('Liberte').offset - arc('Egalite 2').offset - 12) < 0.01
  && Math.abs(arc('Courage').offset - arc('Liberte').offset - 7.3) < 0.01, 'separations as the Ring-Moon Systems Node gives them: 10.7, 12 and 7.3 deg');
const span = arc('Courage').offset + arc('Courage').length / 2 + arc('Fraternite').length / 2;
check(Math.abs(span - 40) < 2.5, `the arcs span ${span.toFixed(1)} deg (de Pater et al. 2018: within about 40)`);
// Voyager-era extents (Porco 1991): Fraternite 247-257, Courage 284.5-285.5.
const f0 = FRATERNITE_FIXES[0].lon;
check(Math.abs(f0 - arc('Fraternite').length / 2 - 247) < 0.5 && Math.abs(f0 + arc('Courage').offset - 285) < 1.2,
  `Fraternite from ${(f0 - 4.8).toFixed(1)} deg, Courage at ${(f0 + arc('Courage').offset).toFixed(1)} deg in 1989 (Porco 1991: 247 and 285)`);

console.log('Jupiter: extents and thicknesses against NSSDC and de Pater et al. 2018');
const thick = (k) => 2 * JUPITER[k].outer * Math.sin(MOON_DATA[k === 'amalthea' ? 'amalthea' : 'thebe'].i * D);
check(Math.abs(JUPITER.main.outer - 128940) < 200 && Math.abs(JUPITER.amalthea.outer - MOON_DATA.amalthea.a) < 100
  && Math.abs(JUPITER.thebe.outer - MOON_DATA.thebe.a) < 100, `main ring to ${JUPITER.main.outer} km (NSSDC 128,940); gossamer rings end at Amalthea's and Thebe's orbits`);
check(Math.abs(thick('amalthea') / 2300 - 1) < 0.15 && Math.abs(thick('thebe') / 8500 - 1) < 0.05,
  `gossamer rings ${thick('amalthea').toFixed(0)} and ${thick('thebe').toFixed(0)} km thick from the moons' inclinations (table ~2300 and ~8500)`);
const tauMain = JUPITER.main.tauDust + JUPITER.main.tauBodies;
check(tauMain < 8e-6 && tauMain > 3e-6, `main ring tau ${tauMain.toExponential(1)} (Ring-Moon Systems Node < 8e-6, NSSDC 5e-6)`);

console.log('Jupiter: the main ring measured by New Horizons LORRI (public/textures/jupiter/rings_lorri.json)');
const lorri = JSON.parse(readFileSync(new URL('../../../public/textures/jupiter/rings_lorri.json', import.meta.url)));
const depth = lorri.shells.depth;
const meanDepth = depth.reduce((a, b) => a + b, 0) / depth.length;
check(depth.length === 14 && Math.abs(meanDepth - 1) < 2e-3 && lorri.shells.innerKm === JUPITER.main.inner && lorri.shells.outerKm === JUPITER.main.outer,
  `14 shells from ${lorri.shells.innerKm} to ${lorri.shells.outerKm} km, mean depth ${meanDepth.toFixed(4)}`);
const outerTwo = (depth[12] + depth[13]) / 2, innerHalf = depth.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
check(outerTwo / innerHalf > 1.4 && outerTwo / innerHalf < 2.6,
  `brightest at the outer edge: the outer two shells ${outerTwo.toFixed(2)} against ${innerHalf.toFixed(2)} inside (the tabled annulus, twice as deep)`);
// The model's level, from Throop et al.'s depths and the photometry, against
// what LORRI measured at 11.7-15.3 deg phase (median of 16 images; the two
// ansae differ by up to two times in their backgrounds).
const lowImgs = lorri.images.filter((o) => o.phase < 20 && o.ewKm !== null);
const meanOf = (o) => o.ewKm / (131000 - 121000);
const lo12 = Math.min(...lowImgs.map(meanOf)), hi12 = Math.max(...lowImgs.map(meanOf));
const model12 = dustNormalIF(JUPITER.main.tauDust, 13.5) + PARTICLE_ALBEDO.jupiter * lambertPhase(13.5) * JUPITER.main.tauBodies;
check(Math.abs(model12 / lorri.mainRingMeanNormalIF - 1) < 0.35,
  `normal I/F at 13.5 deg phase: model ${model12.toExponential(2)}, LORRI ${lorri.mainRingMeanNormalIF.toExponential(2)} (within 35 %; images ${lo12.toExponential(1)}-${hi12.toExponential(1)} over 121,000-131,000 km)`);
// At 151 deg the two frames that hold the whole ring see it 1.6 deg from
// edge-on, in Jupiter's glare: forward scattering brightens it in both, by
// less in the frames than in the model, whose lobe is set by Galileo at 178 deg.
const hiImgs = lorri.images.filter((o) => o.phase > 150 && o.ewKm !== null && o.rMin < 121000);
const ew = (a) => a.map((o) => o.ewKm).sort((x, y) => x - y)[Math.floor(a.length / 2)];
const measuredRatio = ew(hiImgs) / ew(lowImgs);
const modelRatio = (dustNormalIF(JUPITER.main.tauDust, 151.5) + PARTICLE_ALBEDO.jupiter * lambertPhase(151.5) * JUPITER.main.tauBodies) / model12;
check(measuredRatio > 1 && modelRatio > 1, `brighter at 151.5 deg than at 13.5: LORRI ${measuredRatio.toFixed(2)} times, the model ${modelRatio.toFixed(2)} times`);

console.log('Dust photometry');
let sum = 0;
for (let k = 0; k < 18000; k++) { const t = (k + 0.5) * 0.01; sum += dustPhase(t) * Math.sin(t * D) * 0.01 * D; }
check(Math.abs(sum / 2 - 1) < 0.002, `phase function averages ${(sum / 2).toFixed(4)} over the sphere`);
const flat = dustPhase(180 - 130) / dustPhase(180 - 1);
check(flat < 2.2, `flat-ish to 130 deg phase: ${flat.toFixed(2)} times its value at 1 deg (Throop et al. 2004)`);
const hi = dustNormalIF(JUPITER.main.tauDust, 178), lo = dustNormalIF(JUPITER.main.tauDust, 5) + PARTICLE_ALBEDO.jupiter * JUPITER.main.tauBodies;
check(hi > 1e-6 && hi < 1e-5, `main ring normal I/F ${hi.toExponential(1)} at 178 deg phase (Galileo: a few 1e-6)`);
check(lo > 1e-7 && lo < 1e-6, `and ${lo.toExponential(1)} at 5 deg (Keck and Galileo: ~1e-7)`);

if (failed) { console.log(`\n${failed} ring check(s) failed`); process.exit(1); }
console.log('\nrings: all checks passed');
