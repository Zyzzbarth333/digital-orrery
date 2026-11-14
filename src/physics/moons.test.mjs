// src/physics/moons.test.mjs
//
// The major moons (moons.js) against JPL Horizons (fixtures/moons_horizons.json,
// from moons.fetch.mjs): planetocentric positions daily over November 2026
// and yearly 2000-2050, and each planet's centre about its system
// barycentre. The limits are the errors found when the fit was made, with
// a little room; docs/frontend/moons.md lists them.
//
//   node src/physics/moons.test.mjs

import fs from 'node:fs';
import { moonStateEqj, planetCentreOffsetEqj, MOON_KEYS, MOONS_OF } from './moons.js';
import { MOON_DATA } from './moons.data.js';
import { utcMsAtTt } from './ephemeris.js';

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

// Data: every moon has a radius, a GM and a period.
for (const key of MOON_KEYS) {
  const m = MOON_DATA[key];
  check(m.radiusKm > 1 && m.gm > 0 && m.P > 0, `${key} radius ${m.radiusKm} km, GM ${m.gm}, P ${m.P} d`);
}

if (failed) { console.log(`\n${failed} moon check(s) failed`); process.exit(1); }
console.log('\nmoons: all checks passed');
