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

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
