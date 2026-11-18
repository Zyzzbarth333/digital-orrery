// src/physics/landingSites.test.mjs
//
// The Moon's landing sites (landingSites.js), placed as the app draws them:
// each site's published latitude and longitude on the 1,737.4 km sphere,
// turned into J2000 by the app's own lunar orientation (orientation.js's
// bodyAxesEqj('moon')), against CSPICE turning the same point out of
// MOON_ME with NAIF's moon_pa_de440 kernel (fixtures/landing_sites_spice.json,
// from c/landing_sites_ref.c). Ten sites, from Apollo 11 to IM-2 near the
// south pole and Chang'e 4 and 6 on the far side, at four instants from
// Apollo 11's landing to today. The fixture's coordinates were typed from
// the sources separately from landingSites.js, so they are compared too.
// Then the table's own sanity: every site has a source, a place on the
// sphere and a landing date.
//
//   node src/physics/landingSites.test.mjs

import fs from 'node:fs';
import './deNode.js';                 // DE442's Moon, as in the app
import { LANDING_SITES, SITE_BY_KEY, SITE_SOURCES, TIME_SOURCES, MOON_RADIUS_KM, siteOffsetEqj, siteUnit, landedText } from './landingSites.js';

const ref = JSON.parse(fs.readFileSync(new URL('./fixtures/landing_sites_spice.json', import.meta.url)));
// Measured Nov 2026: 85 m at worst (the app's lunar orientation is about
// 0.003° from MOON_ME, orientation.test.mjs). About three times that, as there.
const TOL_KM = 0.25;
let failed = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const parseUtc = (s) => {          // "1969 JUL 20 20:17:40 UTC"
  const [y, mon, d, hms] = s.split(' ');
  const [hh, mm, ss] = hms.split(':').map(Number);
  return new Date(Date.UTC(Number(y), MONTHS.indexOf(mon), Number(d), hh, mm, ss));
};

console.log('Landing sites vs CSPICE (MOON_ME -> J2000, moon_pa_de440), on the 1,737.4 km sphere');
check(ref.meta.radiusKm === MOON_RADIUS_KM, `the same sphere: ${ref.meta.radiusKm} km`);
let worst = 0, worstAt = '';
for (const row of ref.sites) {
  const site = SITE_BY_KEY[row.key];
  if (!site) { check(false, `${row.key}: not in the table`); continue; }
  // The two copies of the coordinates, the fixture's longitude as printed (0-360 E).
  const dLon = ((site.lon - row.lon) % 360 + 540) % 360 - 180;
  check(Math.abs(site.lat - row.lat) < 1e-9 && Math.abs(dLon) < 1e-9, `${row.key.padEnd(13)} coordinates as the source prints them (${row.lat}, ${row.lon} E): ${row.source}`);
  // The body-fixed point itself (latrec_c).
  const u = siteUnit(site), fixed = row.meFixedKm;
  const dFixed = Math.hypot(u[0] * MOON_RADIUS_KM - fixed[0], u[1] * MOON_RADIUS_KM - fixed[1], u[2] * MOON_RADIUS_KM - fixed[2]);
  let rowWorst = 0;
  for (const e of row.j2000) {
    const r = siteOffsetEqj(site, parseUtc(e.utc));
    const d = Math.hypot(r[0] - e.km[0], r[1] - e.km[1], r[2] - e.km[2]);
    rowWorst = Math.max(rowWorst, d);
    if (d > worst) { worst = d; worstAt = `${row.key}, ${e.utc}`; }
  }
  check(dFixed < 1e-9 && rowWorst <= TOL_KM, `${row.key.padEnd(13)} in J2000 within ${(rowWorst * 1000).toFixed(0)} m of SPICE at ${row.j2000.length} instants (body-fixed ${dFixed.toExponential(1)} km; tolerance ${TOL_KM * 1000} m)`);
}
console.log(`  worst: ${(worst * 1000).toFixed(0)} m (${worstAt})`);

console.log('The table');
const keys = new Set();
for (const s of LANDING_SITES) {
  const ok = !keys.has(s.key) && s.source in SITE_SOURCES && (!s.timeSource || s.timeSource in TIME_SOURCES)
    && Math.abs(s.lat) <= 90 && s.lon > -180 && s.lon <= 180 && !/Invalid|NaN/.test(landedText(s.landed))
    && (s.kind !== 'crewed' || (s.crew?.length === 2)) && (s.kind === 'estimate' ? s.uncM === undefined : true);
  if (!ok) check(false, `${s.key}: a field is missing or out of range`);
  keys.add(s.key);
}
const byKind = LANDING_SITES.reduce((a, s) => ({ ...a, [s.kind]: (a[s.kind] ?? 0) + 1 }), {});
check(failed === 0, `${LANDING_SITES.length} sites, each sourced and dated: ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}`);
// In date order, as the rail lists them.
const order = LANDING_SITES.every((s, i) => i === 0 || s.landed >= LANDING_SITES[i - 1].landed);
check(order, 'listed in the order they landed');

console.log(failed ? `\n${failed} landing-site check(s) failed` : '\nAll landing-site checks passed');
process.exit(failed ? 1 : 0);
