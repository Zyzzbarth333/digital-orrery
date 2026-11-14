// src/physics/moons.test.mjs
//
// The major moons (moons.js) against JPL Horizons (fixtures/moons_horizons.json,
// from moons.fetch.mjs): planetocentric positions daily over November 2026
// and yearly 2000-2050, and each planet's centre about its system
// barycentre. The limits are the errors found when the fit was made, with
// a little room; docs/frontend/moons.md lists them.
//
// Every Horizons vector here is geometric, in the ICRF, at TDB. The moons'
// are about their planet's body centre (Titan about 699, not the Saturn
// barycentre 6 nor the solar system barycentre); the frame checks below
// also take them about the system barycentre and about the Sun's centre.
//
//   node src/physics/moons.test.mjs

import fs from 'node:fs';
import { moonStateEqj, planetCentreOffsetEqj, systemEqj, MOON_KEYS, MOONS_OF } from './moons.js';
import { MOON_DATA } from './moons.data.js';
import { bodyAxesEqj } from './orientation.js';
import { utcMsAtTt, helioStateEqj } from './ephemeris.js';

const hz = JSON.parse(fs.readFileSync(new URL('./fixtures/moons_horizons.json', import.meta.url)));
const J2000_JD = 2451545.0;
// JD TDB -> Date (UTC), through TT (TDB - TT is under 2 ms).
const dateOf = (jd) => new Date(utcMsAtTt((jd - J2000_JD) * 86400));
const err = (key, rows) => rows.map(([jd, x, y, z]) => { const { r } = moonStateEqj(key, dateOf(jd)); return Math.hypot(r[0] - x, r[1] - y, r[2] - z); });

// Largest error allowed (km): November 2026 daily, and 2000-2050 yearly.
const LIMIT = {
  phobos: [700, 700], deimos: [200, 200],
  io: [300, 400], europa: [600, 800], ganymede: [800, 1200], callisto: [2000, 3500],
  mimas: [100000, 150000], enceladus: [2500, 2500], tethys: [12000, 13000], dione: [800, 800], rhea: [1100, 1100],
  titan: [2000, 2000], iapetus: [12000, 12000],
  miranda: [4500, 4500], ariel: [1200, 1200], umbriel: [800, 800], titania: [2200, 2200], oberon: [3000, 3000],
  triton: [300, 300], charon: [40, 40],
};

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

console.log('moon         a (km)    Nov 2026 max  2000-2050 max   (km; limit)');
for (const key of MOON_KEYS) {
  const mo = Math.max(...err(key, hz.month[key])), yr = Math.max(...err(key, hz.years[key]));
  const [lm, ly] = LIMIT[key];
  check(mo < lm && yr < ly, `${key.padEnd(10)} ${String(MOON_DATA[key].a).padStart(8)} ${mo.toFixed(0).padStart(12)} ${yr.toFixed(0).padStart(14)}   (${lm}, ${ly})`);
}

// The planet's centre about its barycentre, from the moons here, against
// Horizons (x99 about x): Pluto's is 2,100 km.
const CENTRE_LIMIT = { mars: 0.01, jupiter: 2, saturn: 5, uranus: 2, neptune: 1, pluto: 4 };
for (const planet of Object.keys(MOONS_OF)) {
  const rows = hz.centres[planet];
  const e = rows.map(([jd, x, y, z]) => { const c = planetCentreOffsetEqj(planet, dateOf(jd)); return Math.hypot(c[0] - x, c[1] - y, c[2] - z); });
  const size = Math.max(...rows.map(([, x, y, z]) => Math.hypot(x, y, z)));
  check(Math.max(...e) < CENTRE_LIMIT[planet], `${planet} centre about barycentre: up to ${size.toFixed(2)} km, error ${Math.max(...e).toFixed(3)} km (limit ${CENTRE_LIMIT[planet]})`);
}

// Which point astronomy-engine's planets are. Its error against DE is slow
// over a month, so astronomy-engine minus a Horizons point, less a
// quadratic in time, leaves only the part that moves with the moons: about
// 1 km against the system barycentre, the moons' whole pull (137 km for
// Jupiter to 2,116 km for Pluto) against the planet's centre. So it gives
// barycentres, and the scene must offset each planet to its centre.
function wobble(rows) {
  const t = rows.map((r) => r[0] - rows[0][0]);
  let sum = 0;
  for (let c = 1; c <= 3; c++) {
    const y = rows.map((r) => r[c]);
    const S = (f) => t.reduce((a, ti, i) => a + f(ti, y[i]), 0);
    const A = [[S(() => 1), S((x) => x), S((x) => x * x)], [S((x) => x), S((x) => x * x), S((x) => x ** 3)], [S((x) => x * x), S((x) => x ** 3), S((x) => x ** 4)]];
    const b = [S((x, v) => v), S((x, v) => x * v), S((x, v) => x * x * v)];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const co = [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? b[i] : v)))) / det(A));
    sum += y.reduce((a, v, i) => a + (v - co[0] - co[1] * t[i] - co[2] * t[i] ** 2) ** 2, 0);
  }
  return Math.sqrt(sum / rows.length);
}
const NAIF = { mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8, pluto: 9 };
for (const [planet, n] of Object.entries(NAIF)) {
  const diff = (rows) => rows.map(([jd, x, y, z]) => { const r = helioStateEqj(planet, dateOf(jd)).r; return [jd, r[0] - x, r[1] - y, r[2] - z]; });
  const wb = wobble(diff(hz.helio[n])), wc = wobble(diff(hz.helio[n * 100 + 99]));
  // Mars's moons move it by millimetres: nothing to tell apart there.
  const ok = planet === 'mars' ? true : wb < 3 && wc > 10 * wb;
  check(ok, `astronomy-engine's ${planet} is its system barycentre: wobble ${wb.toFixed(2)} km against Horizons ${n}, ${wc.toFixed(2)} km against ${n}99`);
}

// The moons as the scene composes them, against Horizons in two other
// frames: about the system barycentre (the moon about the planet's centre
// plus the centre's offset), and about the Sun (astronomy-engine's
// barycentre, plus the offset, plus the moon). Heliocentric, both planet and
// moon carry astronomy-engine's error for the planet (16,000 km for
// Jupiter to 335,000 km for Neptune), so the moon's place about its planet
// is checked there, as scene moon minus scene planet against Horizons moon
// minus Horizons planet centre. Horizons' own frames agree to 0.2 km.
for (const key of Object.keys(hz.moonsBary)) {
  const planet = MOON_DATA[key].planet, n = NAIF[planet];
  let eb = 0, eNo = 0, erel = 0, eSelf = 0;
  hz.moonsBary[key].forEach(([jd, x, y, z], i) => {
    const d = dateOf(jd), sys = systemEqj(planet, d), m = sys.moons[key].r, o = sys.offset.r;
    eb = Math.max(eb, Math.hypot(m[0] + o[0] - x, m[1] + o[1] - y, m[2] + o[2] - z));
    eNo = Math.max(eNo, Math.hypot(m[0] - x, m[1] - y, m[2] - z));
    const mh = hz.moonsHelio[key][i], ph = hz.helio[n * 100 + 99][i], mc = hz.month[key][i], c = hz.centres[planet][i];
    erel = Math.max(erel, Math.hypot(m[0] - (mh[1] - ph[1]), m[1] - (mh[2] - ph[2]), m[2] - (mh[3] - ph[3])));
    eSelf = Math.max(eSelf, Math.hypot(mc[1] + c[1] - x, mc[2] + c[2] - y, mc[3] + c[3] - z));
  });
  const [lm] = LIMIT[key];
  check(eb < lm && erel < lm && eSelf < 0.2, `${key.padEnd(8)} about barycentre ${n}: ${eb.toFixed(0)} km (${eNo.toFixed(0)} without the planet's offset); about the Sun, relative to the planet: ${erel.toFixed(0)} km; Horizons frames agree to ${eSelf.toFixed(2)} km`);
}

// Data: every moon has a radius, a GM and a period.
for (const key of MOON_KEYS) {
  const m = MOON_DATA[key];
  check(m.radiusKm > 1 && m.gm > 0 && m.P > 0, `${key} radius ${m.radiusKm} km, GM ${m.gm}, P ${m.P} d`);
}

// Body frame (bodyAxesEqj, pck00011): Z is the IAU's north pole, checked
// here against the WGCCRE 2015 report's own formulae, so the USGS maps,
// east-positive about it, go on the right way round. Triton (retrograde)
// and the Uranian moons have it opposite their orbit's pole; Charon takes
// the right-hand pole, as a dwarf planet's moon. Triton's pole precesses
// about Neptune's, by the IAU's series in N7.
{
  const D = Math.PI / 180;
  const dir = (ra, dec) => [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)];
  const date = new Date(Date.UTC(2026, 10, 14));
  const T = (date - Date.UTC(2000, 0, 1, 12)) / 864e5 / 36525;
  const N = (177.85 + 52.316 * T) * D;
  const tRa = 299.36 - 32.35 * Math.sin(N) - 6.28 * Math.sin(2 * N) - 2.08 * Math.sin(3 * N) - 0.74 * Math.sin(4 * N)
    - 0.28 * Math.sin(5 * N) - 0.11 * Math.sin(6 * N) - 0.07 * Math.sin(7 * N) - 0.02 * Math.sin(8 * N) - 0.01 * Math.sin(9 * N);
  const tDec = 41.17 + 22.55 * Math.cos(N) + 2.10 * Math.cos(2 * N) + 0.55 * Math.cos(3 * N) + 0.16 * Math.cos(4 * N)
    + 0.05 * Math.cos(5 * N) + 0.02 * Math.cos(6 * N) + 0.01 * Math.cos(7 * N);
  const IAU = { phobos: dir(317.68, 52.90), io: dir(268.05, 64.50), rhea: dir(40.38, 83.55),
    ariel: dir(257.43, -15.10), titania: dir(257.43, -15.10), triton: dir(tRa, tDec), charon: dir(132.993, -6.163) };
  for (const [key, pole] of Object.entries(IAU)) {
    const [X, Y, Z] = bodyAxesEqj(key, date);
    const off = Math.acos(Math.min(1, Z[0] * pole[0] + Z[1] * pole[1] + Z[2] * pole[2])) / D;
    const XxY = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    const handed = Math.hypot(XxY[0] - Z[0], XxY[1] - Z[1], XxY[2] - Z[2]) < 1e-9;
    check(off < 1.5 && handed, `${key.padEnd(8)} body pole ${off.toFixed(2)} deg from the IAU's north pole (limit 1.5), right-handed`);
  }
}

if (failed) { console.log(`\n${failed} moon check(s) failed`); process.exit(1); }
console.log('\nmoons: all checks passed');
