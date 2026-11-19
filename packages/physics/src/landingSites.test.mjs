// packages/physics/src/landingSites.test.mjs
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
//   node packages/physics/src/landingSites.test.mjs

import fs from 'node:fs';
import './deNode.js';                 // DE442's Moon, as in the app
import { LANDING_SITES, SITE_BY_KEY, SITE_SOURCES, TIME_SOURCES, MOON_RADIUS_KM, SMALL_BODY_NAMES, siteOffsetEqj, siteUnit, siteFixedKm, siteNormal, siteRadii, siteBody, onSmallBody, sunElevationDeg, landedText } from './landingSites.js';
import { bodyAxesEqj } from './orientation.js';

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
  const ok = !keys.has(s.key) && s.source in SITE_SOURCES && (!s.timeSource || s.timeSource in TIME_SOURCES || s.timeSource in SITE_SOURCES)
    && (siteBody(s) === 'moon' || onSmallBody(s) || siteRadii(s) !== null)
    && Math.abs(s.lat) <= 90 && s.lon > -180 && s.lon <= 180 && !/Invalid|NaN/.test(landedText(s.landed))
    && (s.kind !== 'crewed' || (s.crew?.length === 2)) && (s.kind === 'estimate' ? s.uncM === undefined : true);
  if (!ok) check(false, `${s.key}: a field is missing or out of range`);
  keys.add(s.key);
}
const byKind = LANDING_SITES.reduce((a, s) => ({ ...a, [s.kind]: (a[s.kind] ?? 0) + 1 }), {});
check(failed === 0, `${LANDING_SITES.length} sites, each sourced and dated: ${Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(', ')}`);
// Each body's in date order, as the rail lists them, the Moon's first.
const byBody = new Map();
for (const s of LANDING_SITES) byBody.set(siteBody(s), [...(byBody.get(siteBody(s)) ?? []), s]);
const order = [...byBody.values()].every((l) => l.every((s, i) => i === 0 || s.landed >= l[i - 1].landed));
check(order && siteBody(LANDING_SITES[0]) === 'moon', `each body's listed in the order they landed (${[...byBody].map(([b, l]) => `${b} ${l.length}`).join(', ')})`);
// Each body grouped together.
const runs = LANDING_SITES.filter((s, i) => i === 0 || siteBody(s) !== siteBody(LANDING_SITES[i - 1])).length;
check(runs === byBody.size, `each body's sites listed together (${runs} runs, ${byBody.size} bodies)`);

console.log('Off the Moon: on the reference ellipsoid, up along its normal');
// A point on Mars's ellipsoid: r between the polar and equatorial radii,
// the normal tilted from the radial by under the flattening (0.34°), and
// on the equator and at a pole the two the same.
for (const key of ['viking2', 'phoenix', 'curiosity', 'galileoProbe', 'cassini', 'venera13', 'huygens', 'messenger']) {
  const site = SITE_BY_KEY[key], a = siteRadii(site), p = siteFixedKm(site), r = Math.hypot(...p);
  const on = Math.abs((p[0] / a[0]) ** 2 + (p[1] / a[1]) ** 2 + (p[2] / a[2]) ** 2 - 1) < 1e-12;
  const u = siteUnit(site), n = siteNormal(site);
  const tilt = Math.acos(Math.min(1, u[0] * n[0] + u[1] * n[1] + u[2] * n[2])) / (Math.PI / 180);
  const f = (Math.max(...a) - Math.min(...a)) / Math.max(...a);
  check(on && r <= Math.max(...a) + 1e-9 && r >= Math.min(...a) - 1e-9 && tilt <= f / (Math.PI / 180) + 1e-9,
    `${key.padEnd(13)} on ${siteBody(site)}'s ellipsoid at ${r.toFixed(3)} km, its up ${tilt.toFixed(3)}° from the radial (flattening ${(f * 100).toFixed(2)} %)`);
}
// The Sun's elevation from the normal: the Sun straight above the point
// stands at 90° less the normal's tilt.
{
  const site = SITE_BY_KEY.phoenix, date = new Date('2026-01-01T00:00Z'), axes = bodyAxesEqj('mars', date);
  const out = siteOffsetEqj(site, date, null, axes);
  const u = siteUnit(site), n = siteNormal(site), tilt = Math.acos(u[0] * n[0] + u[1] * n[1] + u[2] * n[2]) / (Math.PI / 180);
  const el = sunElevationDeg(site, out, axes);
  check(Math.abs(el - (90 - tilt)) < 1e-6, `a Sun along the radial over Phoenix stands ${el.toFixed(4)}° up (90° less the normal's ${tilt.toFixed(4)}°)`);
}
// The small bodies' sites are given, not drawn: no radii.
check(LANDING_SITES.filter(onSmallBody).every((s) => siteRadii(s) === null && s.body in SMALL_BODY_NAMES), 'small bodies\' sites have no ellipsoid, and a name');

console.log(failed ? `\n${failed} landing-site check(s) failed` : '\nAll landing-site checks passed');
process.exit(failed ? 1 : 0);
