// src/physics/environment.test.mjs
//
// The forces beyond gravity's point masses and J2 (environment.js), each
// against an independent reference (docs/physics/environment.md).

import './deNode.js';
import { makeEnvironment, shadow, SOLAR_PRESSURE, AU, solidTide, earthFixedAt, LIGHT } from './environment.js';
import { MU_SUN, bodyConstants } from './bodies.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';
import { earthFixedMatrix } from './earthRotation.js';
import { createState, advance } from './nbody.js';
import { bodyAxesEqj } from './orientation.js';

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
  const env = makeEnvironment(sys, { mass: 1000, area: 1, cr: 1, shadowBodies: [], relativity: false });
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
  // With J2 alone it stays in its orbit. (The run reports an impact at day
  // 67, which is the leap second of 1 July 1972: the kernel counts UTC
  // seconds, so the bodies jump by a second of motion there.)
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

header('RELATIVITY: the Schwarzschild term against perihelion and perigee advance');
{
  // The angle of the eccentricity vector after a run with and without
  // relativity, against the classical advance per orbit,
  //   d(omega) = 6 pi mu / (c^2 a (1 - e^2)).
  const ecc = (r, v, mu) => { const rr = norm(r), vr = r[0] * v[0] + r[1] * v[1] + r[2] * v[2], v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]; return r.map((x, i) => ((v2 - mu / rr) * x - vr * v[i]) / mu); };
  const angle = (a, b) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norm(a) * norm(b))));
  const advanceOf = (sysx, mu, a, e, centre, orbits) => {
    const T = 2 * Math.PI * Math.sqrt(a ** 3 / mu), rp = a * (1 - e), vp = Math.sqrt(mu * (1 + e) / rp);
    const run = (rel) => {
      const env = makeEnvironment(sysx, { area: 0, earth: { degree: 0 }, moon: { degree: 0 }, relativity: rel });
      const c = centre(0);
      const st = createState([c.r[0] + rp, c.r[1], c.r[2]], [c.v[0], c.v[1] + vp, c.v[2]], 0);
      // Both runs take the same path through the integrator (an extra
      // acceleration, zero without relativity), so its own error cancels.
      advance(st, orbits * T, { bodiesAt: sysx.bodiesAt, muSun: sysx.muSun, hMax: T / 4000, encke: false, extraAccel: (t, r, out, mid, vv) => { out[0] = out[1] = out[2] = 0; return env ? env(t, r, vv, out, mid) : out; } });
      const c1 = centre(st.t);
      return ecc(st.r.map((x, i) => x - c1.r[i]), st.v.map((x, i) => x - c1.v[i]), mu);
    };
    return { got: angle(run(true), run(false)), want: orbits * 6 * Math.PI * mu / (LIGHT * LIGHT * a * (1 - e * e)) };
  };
  // Mercury's orbit about the Sun alone: 42.98"/century (Einstein's 43").
  const sunOnly = { bodiesAt: () => [], muSun: MU_SUN };
  const merc = advanceOf(sunOnly, MU_SUN, 0.387098 * AU, 0.205630, () => ({ r: [0, 0, 0], v: [0, 0, 0] }), 10);
  const perCentury = (x) => x / 10 * (36525 / 87.9691) * 206264.806;
  console.log(`  Mercury, 10 orbits: ${perCentury(merc.got).toFixed(2)}"/century; the formula ${perCentury(merc.want).toFixed(2)}"/century`);
  check("Mercury's perihelion advances 43\"/century (within 0.5 %)", Math.abs(merc.got / merc.want - 1) < 0.005);
  // The Earth's terms, orbit-averaged by Gauss's equation for an orbit in
  // the equator (every force in its plane):
  //   d(varpi)/dt = sqrt(p/mu)/e [ -R cos nu + S (1 + r/p) sin nu ],
  // R and S the radial and along-track pushes, averaged over the mean
  // anomaly. Against Schwarzschild's 3 mu^1.5 / (c^2 a^2.5 (1 - e^2)) less
  // Lense-Thirring's 4 mu J / (c^2 a^3 (1 - e^2)^1.5), J = 980 km^2/s.
  // (Flying it through the kernel instead, the Sun's tide on the orbit
  // hides an effect this small.)
  const muE = bodyConstants('earth').mu, still = [AU, 0, 0];
  const pole = earthFixedAt(KERNEL_EPOCH_MS)(0)[2];
  const es = { muSun: 1e-30, bodiesAt: () => [{ key: 'earth', mu: muE, radius: 6378, r: still, eph: { velocity: (t, v) => { v[0] = v[1] = v[2] = 0; return v; } } }] };
  const px = (() => { const w = [1, 0, 0].map((x, i) => x - pole[0] * pole[i]); return w.map((x) => x / norm(w)); })();
  const py = [pole[1] * px[2] - pole[2] * px[1], pole[2] * px[0] - pole[0] * px[2], pole[0] * px[1] - pole[1] * px[0]];
  const envE = makeEnvironment(es, { area: 0, earth: { degree: 0 }, moon: { degree: 0 } });
  const A = 12270, E = 0.1, p = A * (1 - E * E), N = 20000;
  let rate = 0;
  for (let k = 0; k < N; k++) {
    const M = 2 * Math.PI * (k + 0.5) / N;
    let EA = M; for (let j = 0; j < 30; j++) EA -= (EA - E * Math.sin(EA) - M) / (1 - E * Math.cos(EA));
    const nu = 2 * Math.atan2(Math.sqrt(1 + E) * Math.sin(EA / 2), Math.sqrt(1 - E) * Math.cos(EA / 2)), rr = p / (1 + E * Math.cos(nu));
    const vr = Math.sqrt(muE / p) * E * Math.sin(nu), vt = Math.sqrt(muE / p) * (1 + E * Math.cos(nu));
    const rh = px.map((x, i) => Math.cos(nu) * x + Math.sin(nu) * py[i]), th = px.map((x, i) => -Math.sin(nu) * x + Math.cos(nu) * py[i]);
    const r = rh.map((x, i) => still[i] + rr * x), v = rh.map((x, i) => vr * x + vt * th[i]);
    const f = envE(0, r, v, [0, 0, 0]);
    const R = f[0] * rh[0] + f[1] * rh[1] + f[2] * rh[2], S = f[0] * th[0] + f[1] * th[1] + f[2] * th[2];
    rate += Math.sqrt(p / muE) / E * (-R * Math.cos(nu) + S * (1 + rr / p) * Math.sin(nu)) / N;
  }
  const schw = 3 * muE ** 1.5 / (LIGHT * LIGHT * A ** 2.5 * (1 - E * E)), lt = 4 * muE * 980 / (LIGHT * LIGHT * A ** 3 * (1 - E * E) ** 1.5);
  const yr = 365.25 * 86400 * 206264.806;
  console.log(`  a 12,270 km equatorial Earth orbit, e = 0.1, orbit-averaged: perigee advance ${(rate * yr).toFixed(4)}"/year; Schwarzschild ${(schw * yr).toFixed(4)} less Lense-Thirring ${(lt * yr).toFixed(4)} = ${((schw - lt) * yr).toFixed(4)}"/year (LAGEOS: about 3.28 and 0.03)`);
  check("the Earth's terms advance the perigee as the formulas have it (within 0.1 %)", Math.abs(rate / (schw - lt) - 1) < 0.001);
}

header("THE EARTH'S TIDES: the Love-number response to the Moon and the Sun");
{
  // Averaged over the Moon's 18.6-year nodal cycle, the tide's change in
  // C20 is the permanent tide: IERS 2010 eq. 6.14, dC20 = A0 H0 k20 with
  // A0 = 4.4228e-8, H0 = -0.31460 m. EGM2008's own tide-free and zero-tide
  // C20 differ by this with k = 0.3 (-4.1736e-9), so ours should be that
  // times k20 / 0.3.
  const fixed = earthFixedAt(KERNEL_EPOCH_MS), R = 6378.1363;
  const ratios = [bodyConstants('moon').mu / bodyConstants('earth').mu, MU_SUN / bodyConstants('earth').mu];
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  for (let d = 0; d < 6798; d += 0.5) {
    const ms = Date.UTC(2000, 0, 1) + d * 86400e3, t = kt(ms), M = fixed(t);
    const e = helioStateEqj('earth', new Date(ms)).r, m = helioStateEqj('moon', new Date(ms)).r;
    const rot = (u) => [0, 1, 2].map((i) => M[i][0] * u[0] + M[i][1] * u[1] + M[i][2] * u[2]);
    const c20 = solidTide([rot(m.map((x, i) => x - e[i])), rot(e.map((x) => -x))], ratios, R).C[2][0];
    sum += c20; n++; lo = Math.min(lo, c20); hi = Math.max(hi, c20);
  }
  const want = 4.4228e-8 * -0.31460 * 0.30190;
  console.log(`  dC20 over 18.6 years: mean ${(sum / n).toExponential(4)}, range ${lo.toExponential(2)} to ${hi.toExponential(2)}; IERS permanent tide ${want.toExponential(4)}`);
  check('the mean change in C20 is the permanent tide of IERS 2010 (within 1 %)', Math.abs(sum / n / want - 1) < 0.01);
  // Through the environment, against the closed form for a Love number k2
  // the same at every order (degree 2 only):
  //   a = sum_j 3 k2 GM_j R^5 / (r_j^3 r^4) [ u s_j + (1 - 5 u^2)/2 r_hat ],
  // u = r_hat . s_j: the gradient of k2 GM_j R^5 P2(u) / (r_j^3 r^3).
  const env = makeEnvironment(sys, { area: 0, relativity: false, earth: { degree: 2, tides: true }, moon: { degree: 0 } });
  const envNo = makeEnvironment(sys, { area: 0, relativity: false, earth: { degree: 2, tides: false }, moon: { degree: 0 } });
  const t = kt(Date.UTC(2024, 0, 1)), bs = sys.bodiesAt(t), E = bs.find((b) => b.key === 'earth').r, Mn = bs.find((b) => b.key === 'moon').r;
  const closed = (rg) => {
    const out = [0, 0, 0], r = norm(rg), rh = rg.map((x) => x / r);
    for (const [p, mu] of [[Mn.map((x, i) => x - E[i]), bodyConstants('moon').mu], [E.map((x) => -x), MU_SUN]]) {
      const d = norm(p), sh = p.map((x) => x / d), u = rh[0] * sh[0] + rh[1] * sh[1] + rh[2] * sh[2];
      const k = 3 * 0.3 * mu * R ** 5 / (d ** 3 * r ** 4);
      for (let i = 0; i < 3; i++) out[i] += k * (u * sh[i] + (1 - 5 * u * u) / 2 * rh[i]);
    }
    return out;
  };
  let big = 0, worst = 0;
  for (let k = 0; k < 24; k++) {
    const a = 2 * Math.PI * k / 24, rg = [6778 * Math.cos(a), 6778 * Math.sin(a), 0], r = rg.map((x, i) => x + E[i]);
    const d = env(t, r, [0, 0, 0], [0, 0, 0]).map((x, i) => x - envNo(t, r, [0, 0, 0], [0, 0, 0])[i]), c = closed(rg);
    big = Math.max(big, norm(d) * 1e3); worst = Math.max(worst, norm(d.map((x, i) => x - c[i])) / norm(c));
  }
  console.log(`  at 400 km, round the equator: the tide pulls up to ${big.toExponential(2)} m/s^2; the closed form with k2 = 0.3 agrees to ${(worst * 100).toFixed(1)} %`);
  check('the tide in low orbit matches the closed form for k2 = 0.3 (within 4 %: the k_2m differ by 1 %, and degree 3 adds about 2 %)', worst < 0.04);
}

header("THE PLANETS' J2: a Jupiter orbiter's node regresses as the theory has it");
{
  // A circular orbit at 3 Jupiter radii, 30 degrees to Jupiter's equator,
  // for 10 days: the node turns at -3/2 n J2 (R/a)^2 cos i.
  const js = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS, keys: ['jupiter'] });
  const ms = Date.UTC(2024, 0, 1), t0 = kt(ms), J = js.bodiesAt(t0)[0], muJ = J.mu, R = 71492, a = 3 * R, inc = 30 * Math.PI / 180;
  const pole = bodyAxesEqj('jupiter', new Date(ms))[2];
  const cr = (u, w) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const e1 = (() => { const c = cr(pole, [0, 0, 1]); return c.map((x) => x / norm(c)); })(), e2 = cr(pole, e1);
  const vJ = [0, 0, 0]; J.eph.velocity(t0, vJ);
  const vc = Math.sqrt(muJ / a);
  const st = createState(e1.map((x, i) => J.r[i] + a * x), e2.map((x, i) => vJ[i] + vc * (Math.cos(inc) * x + Math.sin(inc) * pole[i])), t0);
  const nodeOf = (r, v) => { const h = cr(r, v), n = cr(pole, h); return Math.atan2(n[0] * e2[0] + n[1] * e2[1] + n[2] * e2[2], n[0] * e1[0] + n[1] * e1[1] + n[2] * e1[2]); };
  const n0 = nodeOf(st.r.map((x, i) => x - J.r[i]), st.v.map((x, i) => x - vJ[i]));
  advance(st, t0 + 10 * 86400, { bodiesAt: js.bodiesAt, muSun: js.muSun, encke: false });
  const J1 = js.bodiesAt(st.t)[0], vJ1 = [0, 0, 0]; J1.eph.velocity(st.t, vJ1);
  const n1 = nodeOf(st.r.map((x, i) => x - J1.r[i]), st.v.map((x, i) => x - vJ1[i]));
  const got = (n1 - n0) * 180 / Math.PI, want = -1.5 * Math.sqrt(muJ / a ** 3) * 14696.5735e-6 * (R / a) ** 2 * Math.cos(inc) * 10 * 86400 * 180 / Math.PI;
  console.log(`  node after 10 days: ${got.toFixed(3)} deg; secular theory ${want.toFixed(3)} deg`);
  check("Jupiter's J2 turns the node as theory has it (within 2 %)", Math.abs(got / want - 1) < 0.02);
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
