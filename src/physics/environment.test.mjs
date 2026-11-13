// src/physics/environment.test.mjs
//
// The forces beyond gravity's point masses and J2 (environment.js), each
// against an independent reference (docs/physics/environment.md).

import './deNode.js';
import { makeEnvironment, shadow, SOLAR_PRESSURE, AU } from './environment.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';
import { earthFixedMatrix } from './earthRotation.js';
import { createState, advance } from './nbody.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const kt = (ms) => (ms - KERNEL_EPOCH_MS) / 1000;

header('SUNLIGHT: the pressure, and shadows against a real eclipse');
{
  // At 1 AU in full sunlight a craft of 1 m^2 per 1000 kg with Cr = 1
  // feels P / 1000.
  const env = makeEnvironment(sys, { mass: 1000, area: 1, cr: 1, shadowBodies: [] });
  const r = [AU, 0, 0], out = env(0, r, [0, 0, 0], [0, 0, 0]);
  check('1 m^2 per tonne at 1 AU: P/1000 = 4.54e-9 m/s^2, away from the Sun', Math.abs(norm(out) * 1e3 / (SOLAR_PRESSURE / 1000) - 1) < 1e-12 && out[0] > 0);
  const out2 = env(0, [2 * AU, 0, 0], [0, 0, 0], [0, 0, 0]);
  check('falls with the square of the distance', Math.abs(norm(out) / norm(out2) - 4) < 1e-12);
}

// The total solar eclipse of 21 August 2017, from NASA's eclipse tables
// (F. Espenak, eclipse.gsfc.nasa.gov, SE2017Aug21Tpath.html): at 17:20 UT
// the path crossed Oregon with its central line at 44 44.0 N, 121 38.0 W
// (totality 2 m 02.6 s), northern limit 45 11.9 N, 121 50.6 W, southern
// limit 44 16.0 N, 121 26.0 W; greatest eclipse at 18:25:31.8 UT,
// 36 58.0 N, 87 40.3 W. A point on the ground (WGS-84) is put in the
// heliocentric frame through the Earth's rotation (IAU 1976/1980), and only
// the Moon occults it.
const dm = (d, m) => d + m / 60;
function groundHelio(latDeg, lonDeg, ms) {
  const a = 6378.137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180, N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  const ecef = [N * Math.cos(la) * Math.cos(lo), N * Math.cos(la) * Math.sin(lo), N * (1 - e2) * Math.sin(la)];
  const { M } = earthFixedMatrix(ms, { leapSeconds: 37, dut1: 0.3 });
  const eci = [0, 1, 2].map((i) => M[0][i] * ecef[0] + M[1][i] * ecef[1] + M[2][i] * ecef[2]);
  const E = helioStateEqj('earth', new Date(ms)).r;
  return [E[0] + eci[0], E[1] + eci[1], E[2] + eci[2]];
}
// NASA's eclipse predictions take the umbra from a Moon of k = 0.272281
// Earth radii (1,736.66 km, allowing for valleys on the limb) and a Sun of
// 959.63" at 1 AU (696,000 km); the app's mean radii (1,737.4 km and the
// IAU's 695,700 km) make the umbra about 1.5 km wider at the Earth.
const NASA_MOON = 0.272281 * 6378.137, NASA_SUN = 959.63 / 206264.806 * AU;
const moon = sys.bodiesAt(0).find((b) => b.key === 'moon');
function visibleAt(latDeg, lonDeg, ms, radii = 'nasa') {
  const p = groundHelio(latDeg, lonDeg, ms), m = helioStateEqj('moon', new Date(ms));
  return radii === 'nasa' ? shadow(p, [{ r: m.r, v: m.v, radius: NASA_MOON }], NASA_SUN) : shadow(p, [{ r: m.r, v: m.v, radius: moon.radius }]);
}
{
  const t1720 = Date.UTC(2017, 7, 21, 17, 20);
  const central = visibleAt(dm(44, 44.0), -dm(121, 38.0), t1720);
  const greatest = visibleAt(dm(36, 58.0), -dm(87, 40.3), Date.UTC(2017, 7, 21, 18, 25, 31.8));
  console.log(`  17:20 UT on the central line in Oregon: Sun ${(central * 100).toFixed(3)} % visible; greatest eclipse in Kentucky: ${(greatest * 100).toFixed(3)} %`);
  check('total on the central line at 17:20 UT and at greatest eclipse', central === 0 && greatest === 0);
  // The limits: 10 km outside each is out of the umbra, 10 km inside is in.
  const step = 10 / 111.2;   // degrees of latitude for 10 km
  const nIn = visibleAt(dm(45, 11.9) - step, -dm(121, 50.6), t1720), nOut = visibleAt(dm(45, 11.9) + step, -dm(121, 50.6), t1720);
  const sIn = visibleAt(dm(44, 16.0) + step, -dm(121, 26.0), t1720), sOut = visibleAt(dm(44, 16.0) - step, -dm(121, 26.0), t1720);
  console.log(`  10 km inside and outside the limits: north ${nIn.toFixed(4)} / ${nOut.toFixed(4)}, south ${sIn.toFixed(4)} / ${sOut.toFixed(4)}`);
  check('the umbra\'s edges fall within 10 km of NASA\'s northern and southern limits', nIn === 0 && nOut > 0 && sIn === 0 && sOut > 0);
  // Totality on the central line point: from the Sun's last sliver to its
  // first, found by bisection either side of 17:20.
  const lat = dm(44, 44.0), lon = -dm(121, 38.0);
  const totality = (radii) => {
    const edge = (a, b) => { for (let k = 0; k < 40; k++) { const m = (a + b) / 2; if ((visibleAt(lat, lon, m, radii) === 0) === (visibleAt(lat, lon, a, radii) === 0)) a = m; else b = m; } return (a + b) / 2; };
    return [edge(t1720 - 180e3, t1720), edge(t1720, t1720 + 180e3)];
  };
  const [start, end] = totality('nasa'), dur = (end - start) / 1000;
  const [s2, e2] = totality('app');
  console.log(`  totality there: ${new Date(start).toISOString().slice(11, 22)} to ${new Date(end).toISOString().slice(11, 22)} UT, ${dur.toFixed(1)} s with NASA's radii (NASA: 122.6 s); ${((e2 - s2) / 1000).toFixed(1)} s with the app's mean radii`);
  check('with NASA\'s radii, totality on the central line lasts within 1 s of NASA\'s 2 m 02.6 s', Math.abs(dur - 122.6) < 1);
}

header("THE MOON'S FIELD: Apollo's subsatellites against the lunar mascons");
{
  // Apollo 16's subsatellite PFS-2 was released at 21:56:09 UT on 24 April
  // 1972 into a 90 x 130 km lunar orbit inclined 10 deg (retrograde, as
  // Apollo flew), and the mascons brought it down 34 days later (NASA:
  // impact 21:00 UT, 29 May 1972). Apollo 15's PFS-1, released at 21:00:31
  // UT on 4 August 1971 into 102 x 139 km at 28.5 deg, lasted about 537
  // days. Sources: NASA's Apollo 16 subsatellite page; Skyrocket (space.
  // skyrocket.de/doc_sdat/pfs.htm). Neither gives the orbit's node, so
  // PFS-2 is flown at four, with GRAIL GL0660B to degree 30.
  const { bodyAxesEqj } = await import('./orientation.js');
  const { PA_TO_ME } = await import('./grail.js');
  const { elementsToRv } = await import('./orbital.js');
  const { stepCraft } = await import('./kernelHost.js');
  const fly = ({ ms, peri, apo, inc, node, degree, days }) => {
    const A = bodyAxesEqj('moon', new Date(ms));
    const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => PA_TO_ME[0][i] * A[0][j] + PA_TO_ME[1][i] * A[1][j] + PA_TO_ME[2][i] * A[2][j]));
    const a = 1738 + (peri + apo) / 2, e = (apo - peri) / (2 * a);
    const el = elementsToRv({ a, e, i: inc * Math.PI / 180, raan: node * Math.PI / 180, argp: 0, nu: 0 }, 4902.8003);
    const toJ = (p) => [0, 1, 2].map((j) => M[0][j] * p[0] + M[1][j] * p[1] + M[2][j] * p[2]);
    const m = helioStateEqj('moon', new Date(ms));
    let r = toJ(el.r).map((x, i) => x + m.r[i]), v = toJ(el.v).map((x, i) => x + m.v[i]), t = kt(ms);
    const t0 = t;
    while (t - t0 < days * 86400) {
      const res = stepCraft(sys, { id: 1, version: 0, r, v, t, tEnd: t + 6 * 3600, maxSteps: 1e7, primary: 'moon', env: { mass: 40, area: 0, moon: { degree } } });
      r = res.r; v = res.v; t = res.t;
      if (res.events.some((x) => x.type === 'impact')) return (t - t0) / 86400;
    }
    return null;
  };
  const pfs2 = Date.UTC(1972, 3, 24, 21, 56, 9);
  const lives = [0, 90, 180, 270].map((node) => fly({ ms: pfs2, peri: 90, apo: 130, inc: 170, node, degree: 30, days: 70 }));
  const j2only = fly({ ms: pfs2, peri: 90, apo: 130, inc: 170, node: 0, degree: 0, days: 70 });
  const pfs1 = fly({ ms: Date.UTC(1971, 7, 4, 21, 0, 31), peri: 102, apo: 139, inc: 151.5, node: 0, degree: 30, days: 120 });
  console.log(`  PFS-2 with the field, nodes 0/90/180/270 deg: impact after ${lives.map((x) => (x === null ? 'none' : x.toFixed(1))).join(', ')} days (NASA: 34); with J2 alone: ${j2only === null ? 'still up after 70 days' : `${j2only.toFixed(1)} days`}`);
  console.log(`  PFS-1 with the field: ${pfs1 === null ? 'still up after 120 days (it lasted about 537)' : `down after ${pfs1.toFixed(1)} days`}`);
  check('PFS-2 comes down within 70 days at every node, and NASA\'s 34 days lies within the spread', lives.every((x) => x !== null) && Math.min(...lives) < 34 && Math.max(...lives) > 34);
  // With J2 alone it comes down too, eventually (the Earth's tide slowly
  // raises a low lunar orbit's eccentricity), but later than with the
  // field at every node.
  check('the mascons bring it down sooner than J2 alone at every node', (j2only === null || j2only > Math.max(...lives)));
  check('PFS-1, nearer a frozen inclination, stays up for 120 days', pfs1 === null);
}

header('VENTING AND THRUSTER PUFFS: the random pushes of a real craft');
{
  const { makeVent } = await import('./vent.js');
  // The wandering part: a Gauss-Markov process of sigma 1.3e-6 m/s^2 and
  // correlation time 1.5 days, over 3 axes and 2,000 days.
  const v = makeVent({ sunward: 0 }), dt = 3600, N = 48000, tau = 1.5 * 86400, lag = Math.round(tau / dt);
  let s2 = 0, c = 0, n = 0;
  const series = [0, 1, 2].map(() => []);
  for (let i = 0; i < N; i++) { const o = v(i * dt, [0, 0, 0], [0, 0, 0]); for (let k = 0; k < 3; k++) series[k].push(o[k]); }
  for (const xs of series) { for (const x of xs) { s2 += x * x; n++; } for (let i = 0; i + lag < xs.length; i++) c += xs[i] * xs[i + lag]; }
  const sd = Math.sqrt(s2 / n), rho = c / (3 * (N - lag)) / (sd * sd);
  console.log(`  wandering push: standard deviation ${(sd * 1e6).toFixed(3)} um/s^2 per axis (1.3), correlation ${rho.toFixed(3)} after one correlation time (e^-1 = 0.368)`);
  check('the wandering push has its standard deviation (within 10 %) and memory (within 0.05 of e^-1)', Math.abs(sd / 1.3e-6 - 1) < 0.1 && Math.abs(rho - Math.exp(-1)) < 0.05);
  // The same instant gives the same push whatever came before.
  const a = makeVent({}), b = makeVent({});
  b(5e5, [1, 0, 0], [0, 0, 0]); b(1e7, [1, 0, 0], [0, 0, 0]);
  const pa = a(123456.7, [0, 1, 0], [0, 0, 0]), pb = b(123456.7, [0, 1, 0], [0, 0, 0]);
  check('the push is a fixed function of time: the same instant gives the same push in any order', pa.every((x, i) => x === pb[i]));
  // Calibration against Artemis II: each coast arc of a day or two showed a
  // steady push of 1.3-3.4 um/s^2 leaning toward the Sun (cosine 0.3-0.8).
  // The model's one-day averages, over 300 days, with the Sun along +x.
  const cal = makeVent({ seed: 7 }), mags = [], coss = [];
  for (let d = 0; d < 300; d++) {
    const m = [0, 0, 0];
    for (let h = 0; h < 24; h++) { const o = cal((d * 24 + h) * 3600, [1, 0, 0], [0, 0, 0]); for (let k = 0; k < 3; k++) m[k] += o[k] / 24; }
    mags.push(norm(m) * 1e6); coss.push(m[0] / norm(m));
  }
  const med = (xs) => xs.slice().sort((x, y) => x - y)[xs.length >> 1];
  console.log(`  one-day pushes over 300 days: median ${med(mags).toFixed(2)} um/s^2, median cosine with the Sun ${med(coss).toFixed(2)} (Artemis II's arcs: 1.3-3.4, 0.3-0.8)`);
  check("one-day pushes like Artemis II's arcs: median size in 1.3-3.4 um/s^2, median sunward cosine in 0.3-0.8", med(mags) > 1.3 && med(mags) < 3.4 && med(coss) > 0.3 && med(coss) < 0.8);
  // Puffs: a craft at rest in empty space for a day takes each puff in
  // full through the kernel: the velocity it ends with is the sum of the
  // puffs' delta-vs (and the steady and wandering pushes).
  const opts = { sigma: 0, sunward: 0, seed: 3, puffs: { rate: 2, dv: 0.01 } };
  const pv = makeVent(opts), list = pv.puffsIn(0, 86400);
  const expect = [0, 0, 0];
  for (const p of list) for (let k = 0; k < 3; k++) expect[k] += p.a[k] * (p.t1 - p.t0);
  const envP = makeEnvironment({ bodiesAt: () => [] }, { mass: 1000, area: 0, earth: { degree: 0 }, moon: { degree: 0 }, vent: opts });
  const sP = createState([AU, 0, 0], [0, 0, 0], 0);
  advance(sP, 86400, { bodiesAt: () => [], muSun: 1e-30, hMax: 600, encke: false, stepCap: envP.stepCap, breakpoints: envP.breakpoints(0, 86400), extraAccel: (t, r, out, mid, vv) => { out[0] = out[1] = out[2] = 0; return envP(t, r, vv, out, mid); } });
  const got = sP.v.map((x) => x * 1000), err = norm(got.map((x, k) => x - expect[k]));
  console.log(`  ${list.length} puffs in a day, ${(norm(expect) * 1000).toFixed(2)} mm/s in all; the kernel delivers them to ${(err * 1e6).toFixed(2)} um/s`);
  check('the kernel delivers every puff in full (within 1 % of their sum)', list.length > 20 && err < 0.01 * norm(expect));
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
