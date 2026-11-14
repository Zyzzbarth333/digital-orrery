// src/physics/bodyfacts.test.mjs
//
// The data plate's slower facts (bodyfacts.js) against NASA's planetary
// fact sheets (NSSDCA, D. R. Williams: nssdc.gsfc.nasa.gov/planetary/
// factsheet), and the Sun's against their papers. The rotation is the IAU
// WGCCRE 2015 model; NSSDCA rounds and in two places uses other values,
// noted where they are checked.

import './deNode.js';                 // DE442's Earth and Moon, as in the app
import assert from 'node:assert/strict';
import { helioStateEcl } from './ephemeris.js';
import { MU_SUN } from './bodies.js';
import {
  spinRate, siderealDays, obliquity, solarDays, density, escapeSpeed,
  sunRotationDays, galacticYears, sunFromBarycentreKm,
} from './bodyfacts.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: ${got} against ${want} (±${tol})`);
const date = new Date(Date.UTC(2026, 10, 14));
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => a.map((x, i) => x - b[i]);

// The state the tilt is measured against: heliocentric, the Moon's about
// the Earth; and the year that sets the solar day (the Earth's, for the Moon).
function orbit(key) {
  const st = helioStateEcl(key, date);
  const e = helioStateEcl('earth', date);
  const rel = key === 'moon' ? { r: sub(st.r, e.r), v: sub(st.v, e.v) } : st;
  const h = key === 'moon' ? e : st;
  const r = norm(h.r), v = norm(h.v), a = 1 / (2 / r - (v * v) / MU_SUN);
  return { rel, year: 2 * Math.PI * Math.sqrt(a ** 3 / MU_SUN) / 86400 };
}

// NSSDCA: sidereal rotation (h, negative retrograde), length of day (h),
// obliquity to orbit (deg), mean density (kg/m^3), escape velocity (km/s).
const NSSDCA = {
  mercury: [1407.6, 4222.6, 0.034, 5429, 4.3],
  venus: [-5832.5, 2802.0, 177.4, 5243, 10.36],
  earth: [23.9345, 24.0, 23.44, 5514, 11.19],
  moon: [655.720, 708.7, 6.687, 3344, 2.38],
  mars: [24.6229, 24.6597, 25.19, 3934, 5.03],
  jupiter: [9.9250, 9.9259, 3.13, 1326, 59.5],
  saturn: [10.656, 10.656, 26.73, 687, 35.5],
  uranus: [-17.24, 17.24, 97.77, 1270, 21.3],
  neptune: [16.11, 16.11, 28.32, 1638, 23.5],
  pluto: [-153.2928, 153.2820, 122.53, 1850, 1.21],
};
// The app's own GM (DE442 and the satellite kernels) and IAU mean radius.
const GM_R = {
  mercury: [22031.868551, 2439.4], venus: [324858.592, 6051.8], earth: [398600.435436, 6371.0084],
  moon: [4902.800118, 1737.4], mars: [42828.37485735626, 3389.5], jupiter: [1.266865319003704e8, 69911],
  saturn: [3.793120623436167e7, 58232], uranus: [5.793950610340896e6, 25362],
  neptune: [6.835099968446816e6, 24622], pluto: [869.3261226311508, 1188.3],
};

ok('sidereal rotation, against NSSDCA', () => {
  for (const [k, [p]] of Object.entries(NSSDCA)) {
    const got = siderealDays(k) * 24;
    // Neptune: NSSDCA gives Voyager 2's radio period, 16.11 h; the IAU model
    // (and NAIF's pck00011) turns at 541.1397757°/day, 15.966 h.
    if (k === 'neptune') { near(got, 360 / 541.1397757 * 24, 1e-4, k); continue; }
    near(got, Math.abs(p), Math.abs(p) * 2e-4, `${k} rotation (h)`);
  }
  // Retrograde: Ẇ < 0 for the planets turning backwards (IAU north pole).
  assert.ok(spinRate('venus') < 0 && spinRate('uranus') < 0 && spinRate('earth') > 0);
});

ok('axial tilt, against NSSDCA', () => {
  for (const [k, [, , eps]] of Object.entries(NSSDCA)) {
    const got = obliquity(k, date, orbit(k).rel);
    // Pluto: the IAU 2015 pole gives 119.6°; NSSDCA lists 122.53°.
    // The Moon: the osculating plane rocks; NSSDCA's is the mean, 6.687°.
    const tol = k === 'pluto' ? 3.5 : k === 'moon' ? 0.2 : k === 'jupiter' ? 0.02 : 0.05;
    near(got, eps, tol, `${k} tilt (deg)`);
  }
  near(obliquity('sun', date), 7.25, 0.01, 'the Sun\'s equator to the ecliptic');
});

ok('solar day, against NSSDCA', () => {
  for (const [k, [, day]] of Object.entries(NSSDCA)) {
    if (k === 'neptune') continue;                 // its rotation differs, above
    const { rel, year } = orbit(k);
    near(solarDays(k, date, rel, year) * 24, day, day * 4e-4, `${k} day (h)`);
  }
});

ok('mean density and escape speed, against NSSDCA', () => {
  for (const [k, [, , , rho, esc]] of Object.entries(NSSDCA)) {
    const [gm, R] = GM_R[k];
    near(density(gm, R), rho, rho * 0.01, `${k} density`);
    // NSSDCA takes the giants' escape speed at the 1-bar equator, not the
    // mean radius, and gives Mercury's to 0.1 km/s.
    const Req = { jupiter: 71492, saturn: 60268, uranus: 25559, neptune: 24764 }[k] ?? R;
    near(escapeSpeed(gm, Req), esc, k === 'mercury' ? 0.05 : Math.max(0.01, esc * 0.005), `${k} escape speed`);
  }
  near(density(MU_SUN, 695700), 1408, 3, 'the Sun\'s density');           // NSSDCA Sun fact sheet
  near(escapeSpeed(MU_SUN, 695700), 617.6, 0.3, 'the Sun\'s escape speed');
});

ok('the Sun: rotation by latitude, its Galactic orbit and its barycentre', () => {
  // Howard, Harvey & Forgach 1990: 2.894 µrad/s at the equator.
  near(sunRotationDays(0), 2 * Math.PI / 2.894e-6 / 86400, 1e-9, 'equator');
  assert.ok(sunRotationDays(0) > 24.5 && sunRotationDays(0) < 25.5 && sunRotationDays(90) > 33 && sunRotationDays(90) < 36);
  near(siderealDays('sun'), 360 / 14.1844, 1e-9, 'IAU (Carrington) rate');
  // Reid & Brunthaler 2004: (Θ0 + V⊙)/R0 = 30.24 km/s/kpc.
  near(2 * Math.PI * 3.0856775814913673e16 / 30.24 / (365.25 * 86400) / 1e6, galacticYears() / 1e6, 0.5, 'Galactic year (Myr)');
  // The barycentre is within about 2.2 solar radii of the Sun's centre.
  const d = sunFromBarycentreKm(date);
  assert.ok(d > 0 && d < 2.2 * 695700, `barycentre ${d} km`);
});

console.log(`bodyfacts: ${n} passed`);
