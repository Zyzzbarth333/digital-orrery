// src/physics/nesc.test.mjs
//
// NASA's 6-DOF orbital check cases (NESC, NASA/TM-2015-218675): 25 cases
// of a rigid vehicle in Earth orbit for 8 hours, each run by four NASA
// simulations (the report masks which is which: sims A to D). sixdof.js
// runs every case (nesc.lib.mjs) and is compared with each tool:
// position, Earth-fixed position, gravitation, geodetic height, body rates
// and attitude. The app's own n-body kernel also flies the point-mass and
// the Sun-and-Moon cases.
//
// The atmosphere is the Marshall Engineering Thermosphere as NASA's sims
// B and C ran it (MET-1999, atmosphereMET.js, built from NASA's published
// listings): checked against sim B's recorded density and temperature, and
// used for the drag cases.
//
// Fixture: fixtures/nesc_orbital.json (npm run fetch:nesc).

import './deNode.js';
import fs from 'node:fs';
import { runCase, CASES, MU, initialState, ORBITS, EPOCH_MS, VEHICLES, RE, FLATTENING, gemT1Coefficients } from './nesc.lib.mjs';
import { makeEnvironment } from './environment.js';
import { geopotential, normFactor } from './geopotential.js';
import { rotationalInvariants } from './rigidbody.js';
import { createState, advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { helioStateEqj } from './ephemeris.js';
import { metAtmosphere } from './atmosphereMET.js';
import { geodetic } from './sixdof.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/nesc_orbital.json', import.meta.url)));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const R2D = 180 / Math.PI;

// Known-bad tool outputs, as NASA's report lists them: sim A's 5B is
// corrupt; sim D applied no drag in 6A; sim D's attitude in the full case
// departs after about an hour; sim D records a zero body rate at t = 0.
const BAD = { '05B': ['A'], '06A': ['D'] };
const BAD_ATTITUDE = { 11: ['D'] };

// The MET atmosphere at the vehicle: geodetic latitude, longitude and
// height on the cases' ellipsoid, the case's solar flux (one value, used as
// both the daily and the 162-day mean F10.7) and ap.
const SOLAR = { '05A': [70, 0], '05C': [250, 25] };     // every other case 128.8, 15.7
const metAt = (key, t, ecef) => {
  const [f107, ap] = SOLAR[key] ?? [128.8, 15.7], g = geodetic(ecef, RE, FLATTENING);
  return metAtmosphere({ ms: EPOCH_MS + t * 1000, lat: g.lat * R2D, lon: g.lon * R2D, alt: g.h / 1e3, f107, ap });
};
const densityOf = (key) => (t, r, ecef) => metAt(key, t, ecef).rho;

header('CASES: sixdof.js against the four NASA simulations (8 hours each)');
console.log('  case  closest tool: position, Earth-fixed (relative), rates, attitude | tools\' own spread | ours to each tool (m)');
const results = {};
for (const key of Object.keys(CASES)) {
  const c = fx.cases[key];
  const ours = runCase(key, { density: densityOf(key), outEvery: fx.every });
  const at = new Map(ours.map((s) => [Math.round(s.t), s]));
  const per = {};
  for (const [tool, rows] of Object.entries(c.tools)) {
    if (BAD[key]?.includes(tool)) continue;
    let dr = 0, de = 0, dw = 0, da = 0, dalt = 0, dg = 0;
    for (const x of rows) {
      const o = at.get(Math.round(x.t));
      if (!o || Math.abs(o.t - x.t) > 1e-3) continue;
      dr = Math.max(dr, dist(o.r, x.r)); de = Math.max(de, dist(o.ecef, x.ecef) / Math.hypot(...x.ecef));
      if (x.t > 0) dw = Math.max(dw, dist(o.omega, x.omega));
      const e = [o.eulerEci.roll, o.eulerEci.pitch, o.eulerEci.yaw];
      da = Math.max(da, ...e.map((a, i) => angDiff(a, x.euler[i])));
      dalt = Math.max(dalt, Math.abs(o.alt - x.alt)); dg = Math.max(dg, dist(o.gravitation, x.g));
    }
    per[tool] = { dr, de, dw, da, dalt, dg };
  }
  const tools = Object.keys(per);
  const best = (f, exclude = []) => Math.min(...tools.filter((t) => !exclude.includes(t)).map((t) => per[t][f]));
  const good = Object.entries(c.spread).filter(([pair]) => !(BAD[key] ?? []).some((t) => pair.includes(t))).map(([, v]) => v);
  // Gravitation and geodetic height depend on where each tool's vehicle
  // is, so they are compared with the tool closest in position (sim A
  // aside: it used WGS-84's flattening and another Earth rotation).
  const near = tools.filter((t) => t !== 'A').reduce((a, b) => (per[b].dr < per[a].dr ? b : a));
  results[key] = { per, r: best('dr'), ecef: best('de'), w: best('dw', BAD_ATTITUDE[key]), a: best('da', BAD_ATTITUDE[key]), alt: per[near].dalt, g: per[near].dg, near, spreadMin: Math.min(...good), spreadMax: Math.max(...good) };
  const R = results[key];
  console.log(`  ${key.padEnd(4)}  ${R.r.toExponential(1).padStart(7)} m ${R.ecef.toExponential(1).padStart(7)}   ${R.w.toExponential(1).padStart(7)} rad/s ${(R.a * R2D).toExponential(1).padStart(7)} deg | ${R.spreadMin.toExponential(1)} to ${R.spreadMax.toExponential(1)} m | ${tools.map((t) => `${t} ${per[t].dr.toPrecision(2)}`).join('  ')}  ${CASES[key].title}`);
}

// The cases with drag in the MET atmosphere agree with sim B, the tool
// whose MET version (1999) atmosphereMET.js reproduces, to a few mm; the
// other tools ran other MET versions and differ by metres (sim A, MET-2007:
// 24 to 77 m). Every other case is exact to within a few mm.
const drag = ['06B', '07C', '07D', '11'];
const exact = Object.keys(CASES).filter((k) => !drag.includes(k));
const worst = (keys, f) => Math.max(...keys.map((k) => results[k][f]));
console.log(`  without MET drag: worst ${(worst(exact, 'r') * 1e3).toFixed(2)} mm to the closest tool; with it: worst ${(Math.max(...drag.map((k) => results[k].per.B.dr)) * 1e3).toFixed(2)} mm to sim B`);
check('every case without MET drag within 5 mm of a NASA tool after 8 h', worst(exact, 'r') < 5e-3);
check('the MET-drag cases, in our MET-1999, within 1 cm of sim B (MET-1999) after 8 h', drag.every((k) => results[k].per.B.dr < 0.01));
console.log(`  Earth-fixed: worst ${worst(exact, 'ecef').toExponential(1)} of the distance; gravitation: worst ${worst(exact, 'g').toExponential(1)} m/s^2; geodetic height: worst ${(worst(exact, 'alt') * 1e3).toFixed(1)} mm`);
check('Earth-fixed positions within 2e-9 of the distance of a tool (1.4 cm in low orbit; IAU 1976/1980 rotation, no polar motion), drag aside', worst(exact, 'ecef') < 2e-9);
// (In the drag cases the vehicles are up to a metre apart, and gravity
// changes by 1.4e-6 m/s^2 per metre in low orbit.)
check('gravitation within 1e-8 m/s^2 of the nearest tool (8x8 GEM-T1, Sun and Moon), drag aside', worst(exact, 'g') < 1e-8);
check('geodetic height within 1 cm of the nearest tool (1/f = 298.3), drag aside', worst(exact, 'alt') < 0.01);
const rot = Object.keys(CASES).filter((k) => k !== '11');
check('body rates within 1e-10 rad/s of a tool in every case but the full one', worst(rot, 'w') < 1e-10);
check('attitude within 1e-6 deg of a tool in every case but the full one', worst(rot, 'a') * R2D < 1e-6);
check('full case: rates within 1e-7 rad/s and attitude within 0.01 deg of a tool (sim D aside)', results['11'].w < 1e-7 && results['11'].a * R2D < 0.01);

header('ATMOSPHERE: atmosphereMET.js against NASA\'s MET');
{
  // NASA's own worked examples. MET-V 2.0 (NASA/TM-2002-211786 4.3), printed
  // to 4 or 5 digits: 350 km, 45 N 120 W, 1969-01-20 19:11 UTC, F10.7 136,
  // mean 155, ap 9.
  const a = metAtmosphere({ ms: Date.UTC(1969, 0, 20, 19, 11), lat: 45, lon: -120, alt: 350, f107: 136, f107bar: 155, ap: 9 });
  const pub = [[a.Texo, 1031.207, 'exospheric T'], [a.T, 1019.849, 'T'], [a.rho, 0.9123e-11, 'density'], [a.M, 17.110, 'molecular mass'],
    [a.n.N2, 0.3289e14, 'N2'], [a.n.O2, 0.1660e13, 'O2'], [a.n.O, 0.2811e15, 'O'], [a.n.Ar, 0.5398e10, 'Ar'], [a.n.He, 0.5449e13, 'He'], [a.p, 0.4521e-5, 'pressure']];
  const wA = Math.max(...pub.map(([x, y]) => Math.abs(x / y - 1)));
  console.log(`  MET-V 2.0 sample: Texo ${a.Texo.toFixed(3)} K, T ${a.T.toFixed(3)} K, rho ${a.rho.toExponential(4)} kg/m^3; worst of 10 outputs ${wA.toExponential(1)} (NASA prints 4 to 7 digits)`);
  check('NASA\'s MET-V 2.0 sample reproduced to its printed digits (5e-4)', wA < 5e-4);
  // MET-88 (NASA CR-179359): 200 km, 0 N 0 E, 1987-10-27 14:00, F10.7 230,
  // ap 400. MET-88 had an older Sun and Simpson's rule, so 1e-4.
  const b = metAtmosphere({ ms: Date.UTC(1987, 9, 27, 14, 0), lat: 0, lon: 0, alt: 200, f107: 230, ap: 400 });
  const wB = Math.max(Math.abs(b.Texo / 2105.903 - 1), Math.abs(b.T / 1495.590 - 1), Math.abs(b.rho / 4.656589e-10 - 1), Math.abs(b.M / 23.34522 - 1));
  console.log(`  MET-88 test case: Texo ${b.Texo.toFixed(3)} K, T ${b.T.toFixed(3)} K, rho ${b.rho.toExponential(6)} kg/m^3; worst ${wB.toExponential(1)}`);
  check('NASA\'s MET-88 test case within 1e-4 (an older Sun and integrator)', wB < 1e-4);

  // Along the check cases' orbit, every 60 s for 8 hours: our MET at our
  // vehicle's position (within mm of sim B's) against sim B's recorded
  // density and temperature.
  let wr = 0, wt = 0;
  for (const key of Object.keys(fx.cases).filter((k) => fx.cases[k].metB)) {
    const { rho, T } = fx.cases[key].metB;
    const ours = runCase(key, { density: drag.includes(key) ? densityOf(key) : null, outEvery: 60 });
    let cr = 0, ct = 0;
    ours.forEach((s, i) => { const m = metAt(key, s.t, s.ecef); cr = Math.max(cr, Math.abs(m.rho / rho[i] - 1)); ct = Math.max(ct, Math.abs(m.T - T[i])); });
    console.log(`  ${key.padEnd(4)} F10.7 ${(SOLAR[key] ?? [128.8])[0].toString().padStart(5)}: density within ${cr.toExponential(1)}, temperature within ${(ct * 1e3).toFixed(2)} mK of sim B (481 samples)  ${CASES[key].title}`);
    wr = Math.max(wr, cr); wt = Math.max(wt, ct);
  }
  check('MET density within 1e-5 of sim B along cases 5A-C and the drag cases', wr < 1e-5);
  check('MET temperature within 2 mK of sim B along the same', wt < 2e-3);
}

header('MODELS: the geopotential and torque-free rotation, independently');
{
  // The geopotential's acceleration against the numerical gradient of its
  // potential summed directly (unnormalised Legendre functions by their
  // own recursion), for a random 8x8 field at random points.
  const N = 8, mu = 398600.436, R = 6378.137;
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  const C = [], S = [];
  for (let n = 0; n <= N; n++) { C.push([]); S.push([]); for (let m = 0; m <= n; m++) { C[n][m] = n < 2 ? 0 : rnd() * 2e-6; S[n][m] = m === 0 || n < 2 ? 0 : rnd() * 2e-6; } }
  C[0][0] = 1; C[2][0] = -4.84e-4;
  const f = geopotential({ mu, radius: R, n: N, C, S });
  const P = (n, m, x) => {
    let pmm = 1; const s1 = Math.sqrt(1 - x * x); for (let i = 1; i <= m; i++) pmm *= (2 * i - 1) * s1;
    if (n === m) return pmm; let p1 = x * (2 * m + 1) * pmm; if (n === m + 1) return p1;
    let p0 = pmm; for (let k = m + 2; k <= n; k++) { const p = ((2 * k - 1) * x * p1 - (k + m - 1) * p0) / (k - m); p0 = p1; p1 = p; } return p1;
  };
  const U = (r) => { const rr = Math.hypot(...r), x = r[2] / rr, lam = Math.atan2(r[1], r[0]); let u = 0;
    for (let n = 0; n <= N; n++) for (let m = 0; m <= n; m++) u += (R / rr) ** n * P(n, m, x) * normFactor(n, m) * (C[n][m] * Math.cos(m * lam) + S[n][m] * Math.sin(m * lam));
    return mu / rr * u; };
  let worstG = 0;
  for (let i = 0; i < 60; i++) {
    const r = [rnd() * 2e4, rnd() * 2e4, rnd() * 2e4]; if (Math.hypot(...r) < 6600) continue;
    const a = f.accel(r), g = [0, 1, 2].map((j) => { const p = [...r], q = [...r]; p[j] += 1e-3; q[j] -= 1e-3; return (U(p) - U(q)) / 2e-3; });
    worstG = Math.max(worstG, dist(a, g) / Math.hypot(...g));
  }
  console.log(`  8x8 field against the gradient of the Legendre sum: worst ${worstG.toExponential(1)} (finite differences)`);
  check('the geopotential is the gradient of its potential (to 1e-7)', worstG < 1e-7);

  // Torque-free tumbling of the ISS (non-principal axes) for 8 hours: the
  // rotational energy and the inertial angular momentum stay constant.
  const ours = runCase('08B', { outEvery: 3600 }), I = VEHICLES.iss.inertia;
  const inv = ours.map((s) => rotationalInvariants(s.q, s.omega, I));
  const dE = Math.max(...inv.map((x) => Math.abs(x.energy / inv[0].energy - 1)));
  const dH = Math.max(...inv.map((x) => dist(x.momentum, inv[0].momentum) / Math.hypot(...inv[0].momentum)));
  console.log(`  case 8B: energy constant to ${dE.toExponential(1)}, angular momentum to ${dH.toExponential(1)}`);
  check('torque-free rotation keeps its energy and angular momentum (to 1e-10)', dE < 1e-10 && dH < 1e-10);
}

header("THE APP'S KERNEL: cases 2 and 4 in nbody.js");
// Case 2: the kernel with the Earth as its central body. Case 4: the
// kernel as the app runs it, heliocentric, with the Earth and the Moon as
// bodies (point masses, NASA's GM for the Earth), so the Sun and the Moon
// perturb the orbit through the kernel's own direct and indirect terms.
{
  const s0 = initialState(CASES['02']), toKm = (a) => a.map((x) => x / 1e3);
  const st = createState(toKm(s0.r), toKm(s0.v), 0);
  advance(st, 28800, { bodiesAt: () => [], muSun: MU / 1e9, sunRadius: 6000, hMax: 60, eta: 0.002 });
  const B = fx.cases['02'].tools.B.at(-1);
  const d2 = dist(st.r.map((x) => x * 1e3), B.r);
  console.log(`  case 2, kernel (Cowell, Yoshida 4th order) after 8 h: ${d2.toFixed(3)} m from sim B`);
  check('case 2 by the kernel within 5 cm of sim B', d2 < 0.05);

  const sys = solarSystemBodies({ epochMs: EPOCH_MS, zonal: false });
  sys.bodiesAt(0).find((b) => b.key === 'earth').mu = MU / 1e9;
  const E0 = helioStateEqj('earth', new Date(EPOCH_MS));
  const { r, v } = ORBITS.circular;
  const s4 = createState(r.map((x, i) => x / 1e3 + E0.r[i]), v.map((x, i) => x / 1e3 + E0.v[i]), 0);
  advance(s4, 28800, { bodiesAt: sys.bodiesAt, muSun: 1.3271244e11 });
  const E8 = helioStateEqj('earth', new Date(EPOCH_MS + 28800e3));
  const B4 = fx.cases['04'].tools.B.at(-1);
  const d4 = dist(s4.r.map((x, i) => (x - E8.r[i]) * 1e3), B4.r);
  console.log(`  case 4, kernel (heliocentric, Encke near the Earth, every body, DE442 table) after 8 h: ${d4.toFixed(3)} m from sim B`);
  // History: with the primary's acceleration taken from the ephemeris, an
  // orbit about the Earth followed the table's Earth: 0.62 m here on the
  // first table (the Earth fitted directly), 0.12 m on the barycentre fit
  // (the floor of DE442's own records). Encke's tidal form (encke.js) keeps
  // the ephemeris's acceleration out of the motion about the Earth.
  check('case 4 by the kernel within 2 cm of sim B', d4 < 0.02);

  // Case 3B (8x8 GEM-T1) by the kernel: the Earth as the central body, its
  // field from the environment model (environment.js) with NASA's
  // coefficients, J2 included, and NASA's Earth-rotation offsets.
  const env = makeEnvironment({ bodiesAt: () => [] }, { epochMs: EPOCH_MS, earth: { degree: 8, field: gemT1Coefficients(8), withJ2: true, leapSeconds: 32, dut1: -0.469 } });
  const s3 = createState(toKm(s0.r), toKm(s0.v), 0);
  advance(s3, 28800, { bodiesAt: () => [], muSun: MU / 1e9, sunRadius: 6000, hMax: 60, eta: 0.002, extraAccel: (t, r, out, mid, v) => { out[0] = out[1] = out[2] = 0; return env(t, r, v, out); } });
  const d3 = dist(s3.r.map((x) => x * 1e3), fx.cases['03B'].tools.B.at(-1).r);
  console.log(`  case 3B, kernel with the environment's 8x8 field after 8 h: ${d3.toFixed(3)} m from sim B`);
  check('case 3B by the kernel (environment field) within 5 cm of sim B', d3 < 0.05);

  // Case 6B (a sphere in the MET atmosphere) by the kernel: drag from the
  // environment model, with NASA's solar activity (F10.7 128.8, Ap 15.7),
  // flattening (1/298.3) and MET-1999's whole-minute clock, and the field
  // off (point mass only, as the case has it).
  const sph = VEHICLES.sphere;
  const env6 = makeEnvironment({ bodiesAt: () => [] }, { epochMs: EPOCH_MS, mass: sph.mass, area: sph.area, cd: sph.cd, cr: 0, earth: { degree: 0, leapSeconds: 32, dut1: -0.469 }, drag: { sw: { f107: 128.8, f107bar: 128.8, ap: 15.7 }, flattening: FLATTENING, met: { wholeMinutes: true } } });
  const e0 = initialState(CASES['06B']);
  const s6 = createState(toKm(e0.r), toKm(e0.v), 0);
  advance(s6, 28800, { bodiesAt: () => [], muSun: MU / 1e9, sunRadius: 6000, hMax: 60, eta: 0.002, extraAccel: (t, r, out, mid, v) => { out[0] = out[1] = out[2] = 0; return env6(t, r, v, out); } });
  const d6 = dist(s6.r.map((x) => x * 1e3), fx.cases['06B'].tools.B.at(-1).r);
  console.log(`  case 6B, kernel with the environment's drag (MET) after 8 h: ${d6.toFixed(3)} m from sim B`);
  check('case 6B by the kernel (environment drag) within 5 cm of sim B', d6 < 0.05);
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
