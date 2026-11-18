// src/physics/aurora.test.mjs
//
// The auroral ovals (aurora.js):
//   - Starkov's oval against Sigernes et al. 2011 (eqs. 1-3 and Table 1, as
//     their PDF's text gives them) and the behaviour the paper states;
//   - Kp from CelesTrak's file against the CSV's own rows;
//   - corrected geomagnetic coordinates against their definition (a pure
//     centred dipole maps to itself) and a published station;
//   - Saturn's oval and its northern conjugate (Badman et al. 2006);
//   - Jupiter's main emission poleward of Io's footprint.
//
//   node src/physics/aurora.test.mjs

import fs from 'node:fs';
import {
  STARKOV, alFromKp, starkovCoefficients, ovalLatitude, installKp, kpAt, kpLabel, cgmFrame, cgmToGeo, cgmGrid,
  centredDipolePoint, dipoleLongitude, mlt, magneticEquatorFrame, equatorFootprints, ioFootprint, saturnOval, JUPITER_MAIN, ICE_GIANT_AURORA,
} from './aurora.js';
import { magneticModel, offsetDipole } from './magnetic.js';
import { parseOvation, ovationAt, ovationCovers } from './ovation.js';
import { bodyAxesEqj } from './orientation.js';
import * as Astronomy from 'astronomy-engine';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const DEG = Math.PI / 180;

console.log("Earth's oval (Starkov 1994, as Sigernes et al. 2011 give it)");
// Table 1 of Sigernes et al. 2011, in the order its text layer lists it
// (b0..b3 rows under each boundary; the PDF writes -4.44 as "-4-44").
const TABLE1 = `
-0.07 -10.06 -4.44 -3.77 -6.61 6.37 -4.48 24.54 19.83 7.47 7.90 10.17 -1.10 10.16 -12.53 -9.33 -3.01 -4.73 -5.80 0.34 -5.87 2.15 1.24 0.25 0.91 1.19 -0.38 0.98
1.61 -9.59 -12.07 -6.56 -2.22 -23.98 -20.07 23.21 17.78 17.49 11.44 1.50 42.79 36.67 -10.97 -7.20 -7.96 -6.73 -0.58 -26.96 -24.20 2.03 0.96 1.15 1.31 0.08 5.56 5.11
3.44 -2.41 -0.74 -2.12 -1.68 8.69 8.61 29.77 7.89 3.94 3.24 -2.48 -20.73 -5.34 -16.38 -4.32 -3.09 -1.67 1.58 13.03 -1.36 3.35 0.87 0.72 0.31 -0.28 -2.14 0.76`.trim().split('\n');
['poleward', 'equatorward', 'diffuse'].forEach((k, i) => {
  const want = TABLE1[i].split(' ').map(Number), got = STARKOV[k].flat();
  check(want.length === 28 && want.every((v, j) => v === got[j]), `Table 1, ${k} boundary: 28 coefficients as published`);
});
// Eq. 1, AL from Kp.
check(Math.abs(alFromKp(3) - 171.9) < 1e-9 && Math.abs(alFromKp(0) - 18) < 1e-12, `AL(Kp 3) = ${alFromKp(3).toFixed(1)} nT, AL(0) = ${alFromKp(0)} nT (eq. 1)`);
// Eq. 3 at AL = 100 nT (x = 2) is b0 + 2 b1 + 4 b2 + 8 b3 down each column.
{
  let lo = 0, hi = 9;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (alFromKp(mid) < 100) lo = mid; else hi = mid; }
  const b = STARKOV.equatorward, want = b[0].map((_, j) => b[0][j] + 2 * b[1][j] + 4 * b[2][j] + 8 * b[3][j]);
  const got = starkovCoefficients('equatorward', lo);
  check(got.every((v, j) => Math.abs(v - want[j]) < 1e-9), `eq. 3 at AL = 100 nT (Kp ${lo.toFixed(3)}): A0 = ${got[0].toFixed(2)} deg colatitude`);
}
// What the paper says of the ovals: broader on the night side than the
// day side, expanding smoothly with Kp, the diffuse boundary equatorward.
{
  const width = (kp, t) => ovalLatitude('poleward', kp, t) - ovalLatitude('equatorward', kp, t);
  check(width(3, 0) > width(3, 12), `Kp 3 oval ${width(3, 0).toFixed(1)} deg wide at midnight, ${width(3, 12).toFixed(1)} at noon (broader on the night side)`);
  let expands = true;
  // Eq. 1's cubic AL dips from 18 to 16.6 nT between Kp 0 and 0.23 and
  // peaks at 655 nT near Kp 8.8, so between those (to 0.01 deg).
  for (let kp = 0.25; kp < 8.75; kp += 0.05) for (let t = 0; t < 24; t += 1) expands &&= ovalLatitude('equatorward', kp + 0.05, t) <= ovalLatitude('equatorward', kp, t) + 0.01;
  check(expands, 'the equatorward boundary moves steadily equatorward from Kp 0.25 to 8.8 at every hour of MLT');
  let below = true;
  for (let kp = 0; kp <= 9; kp += 0.5) for (let t = 0; t < 24; t += 1) below &&= ovalLatitude('diffuse', kp, t) < ovalLatitude('equatorward', kp, t);
  check(below, "the diffuse aurora's edge lies equatorward of the oval at every Kp and hour");
  // The familiar numbers of Feldstein's oval for moderate activity: the
  // equatorward edge near 64 deg at midnight and the oval near 73-76 deg at noon.
  const m = ovalLatitude('equatorward', 3, 0), n0 = ovalLatitude('equatorward', 3, 12), n1 = ovalLatitude('poleward', 3, 12);
  console.log(`        Kp 3: equatorward ${m.toFixed(1)} deg at 00 MLT, oval ${n0.toFixed(1)}-${n1.toFixed(1)} deg at 12 MLT`);
  check(m > 62 && m < 66 && n0 > 72 && n1 < 78, 'Kp 3 boundaries in the auroral zone (no published table found to hold them to; see docs)');
}

console.log('Kp');
{
  const json = JSON.parse(fs.readFileSync(new URL('../../public/data/kp.json', import.meta.url), 'utf8'));
  installKp(json);
  // 10-11 May 2024, the Gannon storm: CelesTrak's SW-All.csv rows read
  // KP1-8 = 27 27 23 20 37 77 87 87 and 90 83 83 90 87 83 77 77 (Kp x 10).
  const may10 = [27, 27, 23, 20, 37, 77, 87, 87], may11 = [90, 83, 83, 90, 87, 83, 77, 77];
  const got = [...may10, ...may11].map((_, i) => kpAt(Date.UTC(2024, 4, 10, 3 * i + 1)).kp);
  const want = [...may10, ...may11].map((v) => Math.round((v * 3) / 10) / 3);
  check(got.every((v, i) => Math.abs(v - want[i]) < 1e-12), `Kp through 10-11 May 2024: ${got.slice(5, 12).map(kpLabel).join(' ')} (the storm's 9o at 00 UT on the 11th)`);
  check(kpAt(Date.UTC(2024, 4, 11, 1)).source === 'observed' && kpLabel(9) === '9o' && kpLabel(3 + 1 / 3) === '3+' && kpLabel(3 - 1 / 3) === '3−', 'labels 9o, 3+, 3−, and observed in 2024');
  check(kpAt(Date.UTC(2090, 0, 1)).source === 'assumed', 'no table: Kp 2 assumed, and said so');
}

console.log('Corrected geomagnetic coordinates');
{
  // On a pure centred dipole, CGM is the dipole's own coordinates.
  const m = [-1500, 4500, -29000];
  const dip = { field: offsetDipole(m, [0, 0, 0]), dipole: { m, centre: [0, 0, 0] }, rMax: 80 };
  const frame = cgmFrame(dip);
  let worst = 0;
  for (const lat of [55, 65, 75, -65]) for (const lon of [0, 120, 250]) {
    const p = cgmToGeo(dip, frame, lat, lon), q = centredDipolePoint(frame, lat, lon);
    worst = Math.max(worst, Math.acos(Math.min(1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])) / DEG);
  }
  check(worst < 0.01, `on a centred dipole CGM maps to itself: within ${worst.toFixed(4)} deg`);
  // Longitude 0 runs through the geographic south pole.
  const sp = dipoleLongitude(frame, [0, 0, -1]);
  check(Math.abs(sp) < 1e-9, `CGM longitude of the geographic south pole ${sp.toFixed(6)} deg`);
  // Magnetic local time: noon under the Sun, midnight opposite.
  check(mlt(40, 40) === 12 && mlt(220, 40) === 0 && Math.abs(mlt(130, 40) - 18) < 1e-12, 'MLT 12 under the Sun, 0 opposite, 18 a quarter turn east');
}
{
  // Tromso (69.66 N, 18.94 E): CGM latitude about 66.7 deg in the 2000s
  // (the station lists of IMAGE give 66.6-66.7), growing slowly.
  const E = magneticModel('earth', new Date('2025-06-01T00:00:00Z')), g = cgmGrid(E);
  g.step();
  let best = [Infinity];
  for (let la = 62; la < 72; la += 0.05) for (let lo = 90; lo < 115; lo += 0.1) {
    const p = g.at(1, la, lo), d = Math.hypot(Math.asin(p[2]) / DEG - 69.66, ((Math.atan2(p[1], p[0]) / DEG) - 18.94) * Math.cos(69.66 * DEG));
    if (d < best[0]) best = [d, la, lo];
  }
  check(Math.abs(best[1] - 67) < 0.8, `Tromso at CGM ${best[1].toFixed(1)} N, ${best[2].toFixed(1)} E in 2025 (IGRF-14 traced, 2 x 10 deg grid)`);
}

console.log('Saturn and Jupiter');
{
  const S = magneticModel('saturn'), surf = { eq: 1, pol: 54364 / 60268 };
  const o = saturnOval(S, 15, 30, surf);
  const north = o.north.map((q) => 90 - Math.asin(q[2] / Math.hypot(...q)) / DEG);
  // Cassini 11's northward offset makes the northern oval the smaller one.
  check(north.every((c) => c > 12.5 && c < 14.5), `Saturn's oval at 15 deg from the south pole maps to ${north[0].toFixed(2)} deg from the north pole`);
}
{
  const J = magneticModel('jupiter'), surf = { eq: 1, pol: 1 - 1 / 15.4 }, fr = magneticEquatorFrame(J);
  const main = equatorFootprints(J, JUPITER_MAIN.r[0], 30, surf, fr);
  // The main emission lies poleward of Io's footprint (the Io spot is
  // equatorward of the main oval): their mean magnetic latitudes.
  const ang = (q) => 90 - Math.acos(Math.abs(q[0] * fr.u[0] + q[1] * fr.u[1] + q[2] * fr.u[2]) / Math.hypot(...q)) / DEG;
  const io = [];
  for (let l = 0; l < 360; l += 30) { const f = ioFootprint(J, l, surf); io.push(ang(f.north), ang(f.south)); }
  const mainLat = [...main.north, ...main.south].filter(Boolean).map(ang);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  check(mainLat.length === 24 && mean(mainLat) > mean(io) + 3, `main oval (20 R_J) at a mean ${mean(mainLat).toFixed(1)} deg magnetic latitude, all 24 footprints found; Io's footprints at ${mean(io).toFixed(1)}`);
}

{
  // Neptune: JWST found the southern H3+ aurora between 30 and 60 deg S
  // and 200 and 280 deg W (Melin et al. 2025), mapping to L 3-20. The
  // zone's footprints through Voyager's dipole fall at those latitudes;
  // their longitudes rest on the Voyager-to-IAU convention (docs).
  const N = magneticModel('neptune'), fr = magneticEquatorFrame(N), surf = { eq: 1, pol: 24341 / 24765 };
  const lats = [], lons = [];
  for (const L of ICE_GIANT_AURORA.L) for (const q of equatorFootprints(N, L, 30, surf, fr).south) {
    lats.push(Math.asin(q[2] / Math.hypot(...q)) / DEG);
    lons.push((((-Math.atan2(q[1], q[0])) / DEG) % 360 + 360) % 360);
  }
  const mean = lats.reduce((a, b) => a + b, 0) / lats.length;
  check(mean < -30 && mean > -60 && Math.min(...lats) > -60, `Neptune's southern zone (L 3-20) at ${Math.max(...lats).toFixed(0)} to ${Math.min(...lats).toFixed(0)} deg, mean ${mean.toFixed(0)} (JWST: 30-60 S); ${Math.min(...lons).toFixed(0)}-${Math.max(...lons).toFixed(0)} W (JWST: 200-280 W)`);
}

console.log("NOAA's OVATION Prime map against Starkov's oval");
{
  // A snapshot of NOAA SWPC's live map (forecast 03:09 UTC 18 Nov 2026), read
  // as the app reads the live file, against Starkov's oval for that hour's
  // Kp carried to geographic positions through IGRF-14: on the night side
  // (18 to 06 MLT) the map's aurora should lie inside the oval.
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/ovation_2026-11-18.json', import.meta.url), 'utf8'));
  const bytes = Buffer.from(fx.b64, 'base64'), coordinates = [];
  fx.latitudes.forEach((lat, i) => { for (let lon = 0; lon < 360; lon++) coordinates.push([lon, lat, bytes[i * 360 + lon]]); });
  const o = parseOvation({ 'Observation Time': fx['Observation Time'], 'Forecast Time': fx['Forecast Time'], coordinates });
  const t = new Date(fx['Forecast Time']);
  check(ovationCovers(o, t.getTime()) && !ovationCovers(o, t.getTime() + 2 * 3600e3) && Math.abs(ovationAt(o, 65.5, 10.5) - (bytes[fx.latitudes.indexOf(65) * 360 + 10] + bytes[fx.latitudes.indexOf(65) * 360 + 11] + bytes[fx.latitudes.indexOf(66) * 360 + 10] + bytes[fx.latitudes.indexOf(66) * 360 + 11]) / 4) < 1e-9,
    'the map parses, interpolates between cells, and holds only near its forecast time');
  const kp = kpAt(t.getTime()).kp;
  const E = magneticModel('earth', t), g = cgmGrid(E);
  g.step();
  const sun = Astronomy.GeoVector(Astronomy.Body.Sun, t, true), ax = bodyAxesEqj('earth', t);
  const sv = ax.map((a) => a[0] * sun.x + a[1] * sun.y + a[2] * sun.z), sn = Math.hypot(...sv);
  const sunLon = dipoleLongitude(g.frame, sv.map((v) => v / sn));
  for (const h of [1, -1]) {
    let inside = 0, eq = 0, pole = 0, n = 0;
    for (let m = 18; m < 30; m += 0.5) {
      const t2 = m % 24, lon = sunLon + (t2 - 12) * 15;
      const e = ovalLatitude('equatorward', kp, t2), p = ovalLatitude('poleward', kp, t2);
      const val = (lat) => { const q = g.at(h, lat, lon); return ovationAt(o, Math.asin(q[2]) / DEG, Math.atan2(q[1], q[0]) / DEG); };
      inside += val((e + p) / 2); eq += val(e - 6); pole += val(p + 6); n++;
    }
    check(inside > 1.5 * eq && inside > 5 * pole, `${h > 0 ? 'north' : 'south'}: OVATION's mean ${(inside / n).toFixed(1)} % mid-oval, ${(eq / n).toFixed(1)} % 6 deg equatorward, ${(pole / n).toFixed(1)} % 6 deg poleward (Kp ${kpLabel(kp)})`);
  }
}

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall aurora checks passed');
