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
// The drag cases use NASA's atmosphere density along the path (sim B's,
// every 60 s), because the MET model that made it is not public.
//
// Fixture: fixtures/nesc_orbital.json (npm run fetch:nesc).

import './deNode.js';
import fs from 'node:fs';
import { runCase, CASES, MU, initialState, ORBITS, EPOCH_MS, VEHICLES } from './nesc.lib.mjs';
import { geopotential, normFactor } from './geopotential.js';
import { rotationalInvariants } from './rigidbody.js';
import { createState, advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { helioStateEqj } from './ephemeris.js';

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

// NASA's density for a drag case, smooth in time: 4-point Lagrange
// interpolation of its logarithm between the 60 s samples.
function densityOf(key) {
  const rho = fx.cases[key].densityB;
  if (!rho) return null;
  const lr = rho.map((x) => Math.log(x));
  return (t) => {
    const u = t / 60, i = Math.max(1, Math.min(lr.length - 3, Math.floor(u)));
    let s = 0;
    for (let a = i - 1; a <= i + 2; a++) {
      let w = 1;
      for (let b = i - 1; b <= i + 2; b++) if (b !== a) w *= (u - b) / (a - b);
      s += w * lr[a];
    }
    return Math.exp(s);
  };
}

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

// The cases whose drag uses NASA's MET density: they agree to about a
// metre, inside the tools' own spread, because the density is only known
// at 60 s samples. Every other case is exact to within a few mm.
const drag = ['06B', '07C', '07D', '11'];
const exact = Object.keys(CASES).filter((k) => !drag.includes(k));
const worst = (keys, f) => Math.max(...keys.map((k) => results[k][f]));
console.log(`  without MET drag: worst ${(worst(exact, 'r') * 1e3).toFixed(2)} mm to the closest tool; with it: worst ${worst(drag, 'r').toFixed(2)} m`);
check('every case without MET drag within 5 mm of a NASA tool after 8 h', worst(exact, 'r') < 5e-3);
check('the MET-drag cases within the NASA tools\' own spread (and under 2 m)', drag.every((k) => results[k].r <= results[k].spreadMax && results[k].r < 2));
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
  // An orbit about the Earth follows the table's Earth. The first table
  // (the Earth fitted directly) held position to 0.5 m but its
  // acceleration only to 1e-8 m/s^2, and gave 0.62 m here; fitted through
  // the Earth-Moon barycentre (deTable.js) it gives 0.12 m, the floor of
  // DE442's own records (its Earth's acceleration scatters by 3e-9 m/s^2)
  // in a heliocentric frame. sixdof.js, with the same Sun and Moon but the
  // Earth at the origin, matches sim B to 1 mm.
  check('case 4 by the kernel within 0.25 m of sim B (the floor of DE442\'s records)', d4 < 0.25);
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
