// src/physics/moons.test.mjs
//
// The moons (moons.js) against JPL Horizons (fixtures/moons_horizons.json,
// from moons.fetch.mjs): planetocentric positions daily over November 2026
// and yearly 2000-2050, and each planet's centre about its system
// barycentre. Twice: from the satellite-ephemeris tables (moonTables.js),
// which should hold every moon within about a kilometre of Horizons, and
// from the fallback (the mean elements and astronomy-engine), whose limits
// are the errors found when its fit was made, with a little room.
// docs/frontend/moons.md lists both.
//
// Every Horizons vector here is geometric, in the ICRF, at TDB. The moons'
// are about their planet's body centre (Titan about 699, not the Saturn
// barycentre 6 nor the solar system barycentre); the frame checks below
// also take them about the system barycentre and about the Sun's centre.
//
//   node src/physics/moons.test.mjs

import fs from 'node:fs';
import './deNode.js';                 // DE442's table and the moons' tables, as in the app
import * as Astronomy from 'astronomy-engine';
import { moonStateEqj, planetCentreOffsetEqj, systemEqj, MOON_KEYS, MOONS_OF, MAJOR_MOONS_OF, moonSource } from './moons.js';
import { MOON_DATA } from './moons.data.js';
import { bodyAxesEqj } from './orientation.js';
import { setMoonTablesEnabled, MOON_TABLE_YEARS, INNER_CORE_YEARS, parseMoonChunk } from './moonTables.js';
import { utcMsAtTt, helioStateEqj } from './ephemeris.js';

const hz = JSON.parse(fs.readFileSync(new URL('./fixtures/moons_horizons.json', import.meta.url)));
const J2000_JD = 2451545.0;
// JD TDB -> Date (UTC), through TT (TDB - TT is under 2 ms).
const dateOf = (jd) => new Date(utcMsAtTt((jd - J2000_JD) * 86400));
// Largest error allowed (km) from the fallback: November 2026 daily, and
// 2000-2050 yearly. Every moon in the fixture has one.
const LIMIT = {
  phobos: [700, 700], deimos: [200, 200],
  io: [300, 400], europa: [600, 800], ganymede: [800, 1200], callisto: [2000, 3500],
  mimas: [100000, 150000], enceladus: [2500, 2500], tethys: [12000, 13000], dione: [800, 800], rhea: [1100, 1100],
  titan: [2000, 2000], iapetus: [12000, 12000],
  miranda: [4500, 4500], ariel: [1200, 1200], umbriel: [800, 800], titania: [2200, 2200], oberon: [3000, 3000],
  triton: [300, 300], charon: [40, 40],
};
// From the tables, every moon: the fit leaves each series within 0.5 km of
// the SPK, so a moon about its planet within 1 km; Horizons serves the
// same solutions (nep098 for Neptune), and the worst found is 0.58 km.
const TABLE_LIMIT_KM = 0.75;
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const err = (key, rows) => rows.map(([jd, x, y, z]) => { const { r } = moonStateEqj(key, dateOf(jd)); return Math.hypot(r[0] - x, r[1] - y, r[2] - z); });

// Every moon is in the fixture and the tables.
// S/2025 U 1 is not in Horizons: its table is checked against ura184 by
// c/moon_cheb.c alone.
const IN_HZ = MOON_KEYS.filter((k) => MOON_DATA[k].horizons !== false);
check(IN_HZ.every((k) => hz.month[k] && hz.years[k]), `${IN_HZ.length} of the ${MOON_KEYS.length} moons have Horizons vectors (not: ${MOON_KEYS.filter((k) => !IN_HZ.includes(k)).join(', ')})`);
check(MOON_KEYS.every((k) => moonSource(k, new Date(Date.UTC(2026, 10, 14))) === 'table'), `all ${MOON_KEYS.length} moons come from the tables in 2026`);

// The inner moons (those in the <system>-inner-<year>.bin files) are in the
// repo for 2020-2035 only; their other years are checked too if they have
// been built (npm run build:moon-tables, into public/ephemeris/moons-extra).
const readChunk = (path) => { const b = fs.readFileSync(new URL(`../../public/${path}`, import.meta.url)); return parseMoonChunk(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const INNER_IDS = new Set(['saturn', 'uranus', 'neptune'].flatMap((p) => [...readChunk(`ephemeris/moons/${p}-inner-2026.bin`).keys()]));
const INNER = MOON_KEYS.filter((k) => INNER_IDS.has(MOON_DATA[k].naif));
const EXTRA = fs.existsSync(new URL('../../public/ephemeris/moons-extra/uranus-inner-2000.bin', import.meta.url));
check(INNER.length === 29, `${INNER.length} inner moons in their own files; their years outside 2020-2035 are ${EXTRA ? 'built and checked' : 'not built, so left to the mean elements'}`);
{
  const at = new Date(Date.UTC(2010, 5, 1));
  const src = moonSource('puck', at), main = moonSource('miranda', at);
  check(main === 'table' && src === (EXTRA ? 'table' : 'elements'), `in 2010 Miranda comes from the table, Puck from ${src} (${EXTRA ? 'its extra file' : 'no extra file: a quiet fallback'})`);
}

console.log('\nFrom the tables:');
console.log('moon         a (km)    Nov 2026 max  2000-2050 max   (km; limit)');
const inSpan = (key, rows) => rows.filter(([jd]) => {
  const y = new Date((jd - 2440587.5) * 864e5).getUTCFullYear();     // the TDB year, as the files are cut
  if (INNER.includes(key) && !EXTRA) return y >= INNER_CORE_YEARS[0] && y <= INNER_CORE_YEARS[1];
  return y >= MOON_TABLE_YEARS[0] && y <= MOON_TABLE_YEARS[1] + 1;
});
for (const key of IN_HZ) {
  const mo = Math.max(...err(key, hz.month[key])), yr = Math.max(...err(key, inSpan(key, hz.years[key])));
  const lim = TABLE_LIMIT_KM;
  check(mo < lim && yr < lim, `${key.padEnd(10)} ${String(MOON_DATA[key].a).padStart(8)} ${mo.toFixed(3).padStart(12)} ${yr.toFixed(3).padStart(14)}   (${lim})`);
}

// The planet's centre about its barycentre, against Horizons (x99 about x):
// the tables carry JPL's own.
for (const planet of Object.keys(MOONS_OF)) {
  const rows = hz.centres[planet];
  const e = rows.map(([jd, x, y, z]) => { const c = planetCentreOffsetEqj(planet, dateOf(jd)); return Math.hypot(c[0] - x, c[1] - y, c[2] - z); });
  const size = Math.max(...rows.map(([, x, y, z]) => Math.hypot(x, y, z)));
  check(Math.max(...e) < 0.5, `${planet} centre about barycentre: up to ${size.toFixed(2)} km, error ${Math.max(...e).toFixed(3)} km (limit 0.5)`);
}

// The fallback, for dates outside 2000-2049 or before a year has loaded.
setMoonTablesEnabled(false);
console.log('\nFrom the fallback (mean elements; astronomy-engine for the Galilean moons):');
console.log('moon         a (km)    Nov 2026 max  2000-2050 max   (km; limit)');
for (const key of IN_HZ) {
  const mo = Math.max(...err(key, hz.month[key])), yr = Math.max(...err(key, hz.years[key]));
  const m = MOON_DATA[key], [lm, ly] = LIMIT[key] ?? [m.fit.maxKm * 1.2 + 10, m.fit.maxKm * 1.2 + 10];
  check(mo < lm && yr < ly, `${key.padEnd(10)} ${String(m.a).padStart(8)} ${mo.toFixed(0).padStart(12)} ${yr.toFixed(0).padStart(14)}   (${lm.toFixed(0)}, ${ly.toFixed(0)})`);
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
setMoonTablesEnabled(true);

// The app's planets from Mars out are their system barycentres, from
// DE442's table, against Horizons' barycentres (n about the Sun's centre).
// Horizons serves DE440 for these: the rows match DE440 through SPICE to
// 0.08 km (the fixture's 0.1 km rounding), and what is left here is
// DE440 against DE442 itself, which SPICE gives as 0.17 km (Mars), 14.1 km
// (Jupiter), 0.27 km (Saturn), 1,231 km (Uranus), 352 km (Neptune) and
// 1.7 km (Pluto) over this month: how far JPL moved those planets between
// the two fits. The table holds DE442 to under a metre (c/de_cheb.c).
// Before the table, astronomy-engine was 1,809 km (Mars) to 335,209 km
// (Neptune) out here.
const NAIF = { mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8, pluto: 9 };
const DE440_GAP = { mars: 0.17, jupiter: 14.06, saturn: 0.27, uranus: 1231.11, neptune: 351.91, pluto: 1.71 };
for (const [planet, n] of Object.entries(NAIF)) {
  const e = Math.max(...hz.helio[n].map(([jd, x, y, z]) => { const r = helioStateEqj(planet, dateOf(jd)).r; return Math.hypot(r[0] - x, r[1] - y, r[2] - z); }));
  check(Math.abs(e - DE440_GAP[planet]) < 0.15, `the app's ${planet} (DE442) against Horizons' barycentre ${n} (DE440): ${e.toFixed(3)} km, DE440 - DE442 is ${DE440_GAP[planet]} km`);
}

// Which point astronomy-engine's planets are (the fallback outside
// 2000-2050). Its error against DE is slow over a month, so
// astronomy-engine minus a Horizons point, less a quadratic in time, leaves
// only the part that moves with the moons: about 1 km against the system
// barycentre, the moons' whole pull (137 km for Jupiter to 2,116 km for
// Pluto) against the planet's centre. So it gives barycentres too, and the
// scene must offset each planet to its centre either way.
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
const AE_BODY = { mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto' };
const aeHelio = (planet, date) => { const v = Astronomy.HelioVector(Astronomy.Body[AE_BODY[planet]], date); return [v.x, v.y, v.z].map((x) => x * 149597870.7); };
for (const [planet, n] of Object.entries(NAIF)) {
  const diff = (rows) => rows.map(([jd, x, y, z]) => { const r = aeHelio(planet, dateOf(jd)); return [jd, r[0] - x, r[1] - y, r[2] - z]; });
  const wb = wobble(diff(hz.helio[n])), wc = wobble(diff(hz.helio[n * 100 + 99]));
  const off = Math.max(...diff(hz.helio[n]).map(([, x, y, z]) => Math.hypot(x, y, z)));
  // Mars's moons move it by millimetres: nothing to tell apart there.
  const ok = planet === 'mars' ? true : wb < 3 && wc > 10 * wb;
  check(ok, `astronomy-engine's ${planet} is its system barycentre: wobble ${wb.toFixed(2)} km against Horizons ${n}, ${wc.toFixed(2)} km against ${n}99 (off by up to ${off.toFixed(0)} km)`);
}

// The moons as the scene composes them, against Horizons in two other
// frames: about the system barycentre (the moon about the planet's centre
// plus the centre's offset), and about the Sun (the DE442 barycentre, plus
// the offset, plus the moon), where the moon now carries only its own
// error: with astronomy-engine's planets it carried theirs too (16,000 km
// for Jupiter to 335,000 km for Neptune). Also checked there relative to the
// planet, as scene moon minus scene planet against Horizons moon minus
// Horizons planet centre. Horizons' own frames agree to 0.2 km.
for (const key of Object.keys(hz.moonsBary)) {
  const planet = MOON_DATA[key].planet, n = NAIF[planet];
  let eb = 0, eNo = 0, erel = 0, eh = 0, eSelf = 0;
  hz.moonsBary[key].forEach(([jd, x, y, z], i) => {
    const d = dateOf(jd), sys = systemEqj(planet, d), m = sys.moons[key].r, o = sys.offset.r, b = helioStateEqj(planet, d).r;
    eb = Math.max(eb, Math.hypot(m[0] + o[0] - x, m[1] + o[1] - y, m[2] + o[2] - z));
    eNo = Math.max(eNo, Math.hypot(m[0] - x, m[1] - y, m[2] - z));
    const mh = hz.moonsHelio[key][i], ph = hz.helio[n * 100 + 99][i], mc = hz.month[key][i], c = hz.centres[planet][i];
    erel = Math.max(erel, Math.hypot(m[0] - (mh[1] - ph[1]), m[1] - (mh[2] - ph[2]), m[2] - (mh[3] - ph[3])));
    eh = Math.max(eh, Math.hypot(b[0] + o[0] + m[0] - mh[1], b[1] + o[1] + m[1] - mh[2], b[2] + o[2] + m[2] - mh[3]));
    eSelf = Math.max(eSelf, Math.hypot(mc[1] + c[1] - x, mc[2] + c[2] - y, mc[3] + c[3] - z));
  });
  const lm = TABLE_LIMIT_KM + 0.5, lh = 30;
  check(eb < lm && erel < lm && eh < lh && eSelf < 0.2, `${key.padEnd(8)} about barycentre ${n}: ${eb.toFixed(3)} km (${eNo.toFixed(0)} without the planet's offset); relative to the planet, about the Sun: ${erel.toFixed(3)} km (limit ${lm}); about the Sun: ${eh.toFixed(1)} km, the planet's own error (limit ${lh}); Horizons frames agree to ${eSelf.toFixed(2)} km`);
}

// Data: every moon has a radius (measured, down to Aegaeon's 0.33 km, or a
// nominal one that says so),
// a period, and a GM if it pulls on spacecraft.
for (const key of MOON_KEYS) {
  const m = MOON_DATA[key];
  const radius = m.radiusKm > 0.1 && (!/nominal/.test(m.radiusNote ?? '') || /not measured/.test(m.radiusNote));
  const gm = m.gm > 0 || (!m.major && m.gmNote === 'not measured');
  check(radius && gm && m.P > 0, `${key} radius ${m.radiusKm} km${m.radiusNote ? ` (${m.radiusNote})` : ''}, GM ${m.gm ?? m.gmNote}, P ${m.P} d`);
}
check(Object.values(MAJOR_MOONS_OF).flat().length === 20, `the kernel pulls with the twenty major moons: ${Object.values(MAJOR_MOONS_OF).flat().join(', ')}`);

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
