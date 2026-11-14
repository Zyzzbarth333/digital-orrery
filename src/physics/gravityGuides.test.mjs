// src/physics/gravityGuides.test.mjs
//
// The gravity guides (gravityGuides.js) against textbook values: spheres of
// influence as Curtis works them, Hill radii, the Earth-Moon Lagrange
// points of the circular restricted problem, and the gravity maps against
// the kernel's own spherical-harmonic acceleration (geopotential.js).
//
//   node src/physics/gravityGuides.test.mjs

import { soiRadius, hillRadius, collinearPoints, lagrangePoints, strongestPulls, fieldMap, WGS84_NORMAL_ZONALS } from './gravityGuides.js';
import { geopotential } from './geopotential.js';
import { EGM2008 } from './egm2008.js';
import { GRAIL } from './grail.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const rel = (a, b) => Math.abs(a / b - 1);

// Spheres of influence with Curtis's masses and distances (Orbital Mechanics
// for Engineering Students, table A.1 data; his table A.2 and the sphere
// of influence section give 925 x 10^3 km for Earth, 66.1 x 10^3 km for the
// Moon and 48.2 x 10^6 km for Jupiter).
const SUN = 1.989e30;
const soiCases = [
  ['Earth', 149.6e6, 5.974e24, SUN, 925e3],
  ['Moon', 384.4e3, 73.48e21, 5.974e24, 66.1e3],
  ['Jupiter', 778.6e6, 1.899e27, SUN, 48.2e6],
];
for (const [name, a, m, M, want] of soiCases) {
  const r = soiRadius(a, m, M);
  check(rel(r, want) < 0.005, `${name} SOI ${(r / 1e3).toFixed(1)} x 10^3 km (Curtis ${want / 1e3})`);
}

// Hill radius: Earth's, at pericentre, is the familiar 1.47 million km; and
// for a small mass ratio it is the first-order distance to L1 and L2.
const hE = hillRadius(149.598e6, 0.0167, 5.972e24, SUN);
check(Math.abs(hE - 1.4716e6) < 5e3, `Earth Hill radius ${(hE / 1e6).toFixed(4)} million km`);
for (const mu of [1e-7, 3.0035e-6, 9.537e-4]) {
  const c = collinearPoints(mu), h = Math.cbrt(mu / 3);
  const d1 = 1 - mu - c.L1, d2 = c.L2 - (1 - mu);
  check(rel(d1, h) < 2 * h && rel(d2, h) < 2 * h, `mu ${mu}: L1, L2 at ${(d1 / h).toFixed(4)} and ${(d2 / h).toFixed(4)} Hill radii`);
}

// The Earth-Moon collinear points for mu = 0.012150585609624 (Koon, Lo,
// Marsden and Ross, Dynamical Systems, the Three-Body Problem and Space
// Mission Design, 2011, sec. 2.5): 0.836915, 1.155682, -1.005063.
const em = collinearPoints(0.012150585609624);
check(Math.abs(em.L1 - 0.836915) < 1e-6, `Earth-Moon L1 ${em.L1.toFixed(7)}`);
check(Math.abs(em.L2 - 1.155682) < 1e-6, `Earth-Moon L2 ${em.L2.toFixed(7)}`);
check(Math.abs(em.L3 + 1.005063) < 1e-6, `Earth-Moon L3 ${em.L3.toFixed(7)}`);

// In kilometres at the mean distance: L1 about 326,400 km from Earth, L2
// about 448,900 km.
const sep = 384400;
check(Math.abs((em.L1 + 0.0121506) * sep - 326400) < 1000, `Earth-Moon L1 ${((em.L1 + 0.0121506) * sep).toFixed(0)} km from Earth`);
check(Math.abs((em.L2 + 0.0121506) * sep - 448900) < 1000, `Earth-Moon L2 ${((em.L2 + 0.0121506) * sep).toFixed(0)} km from Earth`);

// Sun-(Earth+Moon) L1 and L2 at 1 AU: about 1.5 million km sunward and
// anti-sunward (ESA's figure for L2).
const se = collinearPoints(3.0404e-6);
const AU = 149597870.7;
const dL1 = (1 - 3.0404e-6 - se.L1) * AU, dL2 = (se.L2 - 1 + 3.0404e-6) * AU;
check(Math.abs(dL1 - 1.49e6) < 0.02e6 && Math.abs(dL2 - 1.50e6) < 0.02e6, `Sun-Earth L1 ${(dL1 / 1e6).toFixed(3)}, L2 ${(dL2 / 1e6).toFixed(3)} million km`);

// The points in space: L4 and L5 make equilateral triangles with the pair,
// L4 leads; all lie in the orbital plane.
{
  const rP = [10, -20, 5], rS = [10 + 384400, -20, 5], v = [0, 1.02, 0.05];
  const L = lagrangePoints(rP, rS, v, 398600.4, 4902.8);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  for (const k of ['L4', 'L5']) {
    check(rel(dist(L[k], rP), 384400) < 1e-12 && rel(dist(L[k], rS), 384400) < 1e-12, `${k} equidistant from both`);
  }
  check(L.L4[1] > rP[1] && L.L5[1] < rP[1], 'L4 leads (along the velocity), L5 trails');
  const n = [0, -v[2] * 384400, v[1] * 384400];      // d x v
  const off = (p) => Math.abs(n[0] * (p[0] - rP[0]) + n[1] * (p[1] - rP[1]) + n[2] * (p[2] - rP[2])) / Math.hypot(...n);
  check(['L1', 'L2', 'L3', 'L4', 'L5'].every((k) => off(L[k]) < 1e-6), 'all five in the orbital plane');
}

// Strongest pulls, by GM / d^2.
{
  const p = strongestPulls({ key: 'x', r: [0, 0, 0] }, [{ key: 'a', gm: 1, r: [1, 0, 0] }, { key: 'b', gm: 9, r: [0, 2, 0] }, { key: 'x', gm: 5, r: [0, 0, 0] }]);
  check(p.length === 2 && p[0].key === 'b' && Math.abs(p[0].accel - 2.25) < 1e-12, 'pulls sorted strongest first, the target left out');
}

// The maps: the disturbance of EGM2008 to degree 30 at a few places equals
// the radial part of geopotential.js's acceleration (harmonics only) on the
// sphere at the reference radius, so the Legendre functions, the
// normalisation and the longitude sense agree with the kernel's.
{
  const N = 30, W = 72, H = 37;
  const map = fieldMap({ ...EGM2008, degree: N, kind: 'disturbance', width: W, height: H });
  const field = geopotential({ mu: EGM2008.gm, radius: EGM2008.radius, n: N, C: EGM2008.C, S: EGM2008.S, central: false });
  // Without C20 (whose 1/r^4 term dwarfs the rest), on both sides.
  const C = EGM2008.C.map((row, n) => (n === 2 ? row.map((c, m) => (m === 0 ? 0 : c)) : row));
  const map2 = fieldMap({ ...EGM2008, C, degree: N, kind: 'disturbance', width: W, height: H });
  const field2 = geopotential({ mu: EGM2008.gm, radius: EGM2008.radius, n: N, C, S: EGM2008.S, central: false });
  let worst = 0;
  for (const [i, j] of [[5, 3], [18, 0], [18, 40], [30, 61], [12, 25]]) {
    const lat = -Math.PI / 2 + (Math.PI * i) / (H - 1), lon = -Math.PI + (2 * Math.PI * j) / W;
    const u = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
    for (const [m, f] of [[map, field], [map2, field2]]) {
      const a = f.accel(u.map((c) => c * EGM2008.radius));
      const radial = -(a[0] * u[0] + a[1] * u[1] + a[2] * u[2]);  // downward pull, km/s^2
      worst = Math.max(worst, Math.abs(m[i * W + j] - radial));
    }
  }
  check(worst < 1e-12, `EGM2008 map matches geopotential.js to ${(worst * 1e8).toExponential(2)} mGal`);
}

// Earth's free-air anomalies to degree 70 against the WGS 84 ellipsoid:
// zero on average (no degree 0 or 1). The range is only reported: degree
// 70 smooths the field to about 290 km, far below the full model's peaks.
{
  const W = 360, H = 181;
  const map = fieldMap({ ...EGM2008, degree: 70, normal: WGS84_NORMAL_ZONALS, width: W, height: H });
  let sum = 0, wsum = 0, lo = Infinity, hi = -Infinity;
  for (let i = 0; i < H; i++) {
    const w = Math.cos(-Math.PI / 2 + (Math.PI * i) / (H - 1));
    for (let j = 0; j < W; j++) { const v = map[i * W + j] * 1e8; sum += w * v; wsum += w; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  }
  check(Math.abs(sum / wsum) < 1, `Earth anomaly: mean ${(sum / wsum).toFixed(2)} mGal, range ${lo.toFixed(0)} to ${hi.toFixed(0)} mGal`);
  // Tibet stands high, and Hudson Bay, still rebounding from its ice
  // sheet, is the classic low (lat, lon).
  const at = (lat, lon) => map[(lat + 90) * W + (lon + 180)] * 1e8;
  check(at(28, 87) > 20 && at(60, -85) < -20, `Himalaya ${at(28, 87).toFixed(0)} mGal, Hudson Bay ${at(60, -85).toFixed(0)} mGal`);
}

// The Moon's mascons: Mare Imbrium (33 N, 16 W) and Serenitatis (28 N, 17 E)
// are strongly positive in GRAIL's free-air map, degree 100.
{
  const W = 720, H = 361;
  const map = fieldMap({ ...GRAIL, degree: 100, width: W, height: H });
  const at = (lat, lon) => map[(lat + 90) * 2 * W + (lon + 180) * 2] * 1e8;
  check(at(33, -16) > 150 && at(28, 17) > 150, `Moon: Imbrium ${at(33, -16).toFixed(0)} mGal, Serenitatis ${at(28, 17).toFixed(0)} mGal`);
}

if (failed) { console.log(`\n${failed} gravity-guide check(s) failed`); process.exit(1); }
console.log('\ngravity guides: all checks passed');
