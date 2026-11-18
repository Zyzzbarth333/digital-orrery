// src/physics/irregularMoons.test.mjs
//
// The irregular moons of Jupiter, Saturn and Neptune (irregularMoons.js)
// against JPL Horizons (fixtures/irregular_moons_horizons.json, from
// irregularMoons.fetch.mjs): each moon about its planet's centre at five
// dates from 2000 to 2049, none of them used in any fit. From the tables
// (all 381, from JPL's eight kernels) each should be within about a
// kilometre of Horizons; from the mean elements, the fallback outside
// 2000-2049, within what their fit left over 2000-2050, with a quarter
// more room. docs/frontend/moons.md lists
// the results.
//
//   node src/physics/irregularMoons.test.mjs

import fs from 'node:fs';
import './deNode.js';                 // DE442's table and the moons' tables, as in the app
import { IRREGULAR_DATA, IRREGULAR_KEYS, IRREGULARS_OF, TABLE_KERNELS, irregularStateEqjAtTt, irregularSource } from './irregularMoons.js';
import { setMoonTablesEnabled, MOON_TABLE_YEARS } from './moonTables.js';
import { MOON_DATA } from './moons.data.js';

const hz = JSON.parse(fs.readFileSync(new URL('./fixtures/irregular_moons_horizons.json', import.meta.url)));
const J2000_JD = 2451545.0;
const ttOf = (jd) => (jd - J2000_JD) * 86400;          // TDB taken as TT (under 2 ms)
// From the tables: each series within 0.5 km of the SPK, the planet's
// centre within 0.5 km too, and Horizons' vectors rounded to 0.1 km.
const TABLE_LIMIT_KM = 1.0;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const err = (key, rows) => rows.map(([jd, x, y, z]) => { const { r } = irregularStateEqjAtTt(key, ttOf(jd)); return Math.hypot(r[0] - x, r[1] - y, r[2] - z); });

const counts = Object.fromEntries(Object.entries(IRREGULARS_OF).map(([p, l]) => [p, l.length]));
console.log(`${IRREGULAR_KEYS.length} irregular moons: ${JSON.stringify(counts)}`);
check(IRREGULAR_KEYS.every((k) => hz.moons[k]?.length === hz.dates.length), `every moon has Horizons vectors at the ${hz.dates.length} check dates (${hz.dates.join(', ')})`);
check(IRREGULAR_KEYS.every((k) => !(k in MOON_DATA) && !Object.values(MOON_DATA).some((m) => m.naif === IRREGULAR_DATA[k].naif)), 'none is already one of the full moons (Nereid and Uranus\'s ten are)');
const named = ['himalia', 'elara', 'pasiphae', 'sinope', 'lysithea', 'carme', 'ananke', 'leda', 'themisto', 'callirrhoe',
  'ymir', 'paaliaq', 'kiviuq', 'siarnaq', 'tarvos', 'ijiraq', 'albiorix', 'mundilfari', 'halimede', 'sao', 'laomedeia', 'psamathe', 'neso'];
check(named.every((k) => k in IRREGULAR_DATA), `the ${named.length} asked-for moons are here (missing: ${named.filter((k) => !(k in IRREGULAR_DATA)).join(', ') || 'none'})`);

const TABLED = IRREGULAR_KEYS.filter((k) => TABLE_KERNELS.has(IRREGULAR_DATA[k].kernel));
const at2026 = ttOf(2461362.5);
check(TABLED.length === IRREGULAR_KEYS.length && TABLED.every((k) => irregularSource(k, at2026) === 'table'), `all ${TABLED.length} moons come from the tables in 2026 (${[...TABLE_KERNELS].join(', ')})`);

// The tables' files: one a system a year, 2000-2049.
{
  let bytes = 0, files = 0;
  for (const p of ['jupiter', 'saturn', 'neptune']) for (let y = MOON_TABLE_YEARS[0]; y <= MOON_TABLE_YEARS[1]; y++) {
    const u = new URL(`../../public/ephemeris/moons/${p}-irregular-${y}.bin`, import.meta.url);
    if (fs.existsSync(u)) { bytes += fs.statSync(u).size; files++; }
  }
  check(files === 150 && bytes < 30e6, `${files} irregular-moon table files, ${(bytes / 1e6).toFixed(2)} MB (under 30 MB)`);
}

console.log('\nFrom the tables (km from Horizons, worst of the five dates):');
const worstBy = {};
// S/2023 S 38 (e = 0.909) is fitted to 1000 km, not 0.5 (c/moon_cheb.c tol_of).
const LOOSE = 'S/2023 S 38', LOOSE_LIMIT_KM = 1001;
for (const k of TABLED) {
  const e = Math.max(...err(k, hz.moons[k]));
  if (IRREGULAR_DATA[k].name === LOOSE) { check(e <= LOOSE_LIMIT_KM, `${LOOSE} (e ${IRREGULAR_DATA[k].e}, fitted to 1000 km): ${e.toFixed(1)} km at these dates`); continue; }
  const kern = IRREGULAR_DATA[k].kernel;
  if (!worstBy[kern] || e > worstBy[kern][1]) worstBy[kern] = [k, e];
  if (e > TABLE_LIMIT_KM) check(false, `${IRREGULAR_DATA[k].name} ${e.toFixed(3)} km (limit ${TABLE_LIMIT_KM})`);
}
for (const [kern, [k, e]] of Object.entries(worstBy)) check(e <= TABLE_LIMIT_KM, `${kern}: every moon${kern === 'sat455' ? ` but ${LOOSE}` : ''} within ${TABLE_LIMIT_KM} km; worst ${IRREGULAR_DATA[k].name}, ${e.toFixed(3)} km`);

console.log('\nFrom the mean elements (tables off; km, worst of the five dates):');
setMoonTablesEnabled(false);
const rows = [];
for (const k of IRREGULAR_KEYS) {
  const m = IRREGULAR_DATA[k], e = Math.max(...err(k, hz.moons[k]));
  rows.push([k, e, e / m.a]);
  // The fit's own worst over 2000-2050, every 10 days; five other dates
  // should not go past it by more than a quarter.
  if (!(e <= 1.25 * m.fit.maxKm + 1)) check(false, `${m.name} ${Math.round(e)} km from Horizons (fit's worst ${m.fit.maxKm} km)`);
}
setMoonTablesEnabled(true);
for (const p of ['jupiter', 'saturn', 'neptune']) {
  const r = rows.filter(([k]) => IRREGULAR_DATA[k].planet === p).sort((a, b) => a[2] - b[2]);
  const med = r[Math.floor(r.length / 2)], worst = r[r.length - 1];
  check(r.every(([k, e]) => e <= 1.25 * IRREGULAR_DATA[k].fit.maxKm + 1),
    `${p}: ${r.length} moons within their fit's worst; median ${(100 * med[2]).toFixed(1)} % of a (${IRREGULAR_DATA[med[0]].name}, ${Math.round(med[1]).toLocaleString('en')} km), worst ${(100 * worst[2]).toFixed(1)} % (${IRREGULAR_DATA[worst[0]].name}, ${Math.round(worst[1]).toLocaleString('en')} km)`);
}

// Which way they go round: retrograde, i over 90 degrees to the ecliptic.
{
  const retro = IRREGULAR_KEYS.filter((k) => IRREGULAR_DATA[k].retrograde).length;
  const h = IRREGULAR_KEYS.every((k) => {
    const s = irregularStateEqjAtTt(k, at2026), r = s.r, v = s.v;
    // The orbit's pole against the ecliptic's (ICRF), from the state itself.
    const hz_ = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    const eps = (84381.448 / 3600) * (Math.PI / 180), pole = [0, -Math.sin(eps), Math.cos(eps)];
    const cosI = (hz_[0] * pole[0] + hz_[1] * pole[1] + hz_[2] * pole[2]) / Math.hypot(...hz_);
    return (cosI < 0) === IRREGULAR_DATA[k].retrograde;
  });
  check(h, `${retro} of ${IRREGULAR_KEYS.length} retrograde, and each one's state now goes round the way its elements say`);
}
// GMs where Horizons gives one, for the plate (none pulls on spacecraft).
{
  const withGm = IRREGULAR_KEYS.filter((k) => IRREGULAR_DATA[k].gm !== null);
  check(IRREGULAR_DATA.himalia.gm > 0.1 && IRREGULAR_DATA.himalia.gm < 0.2, `Himalia's GM ${IRREGULAR_DATA.himalia.gm} km^3/s^2 (Horizons); ${withGm.length} with a GM: ${withGm.map((k) => IRREGULAR_DATA[k].name).join(', ')}`);
}
check(IRREGULAR_KEYS.filter((k) => IRREGULAR_DATA[k].discovery).length >= IRREGULAR_KEYS.length - 2, `${IRREGULAR_KEYS.filter((k) => IRREGULAR_DATA[k].discovery).length} of ${IRREGULAR_KEYS.length} have a discovery row`);

console.log(failed ? `\n${failed} FAILED` : '\nall irregular-moon checks passed');
process.exit(failed ? 1 : 0);
