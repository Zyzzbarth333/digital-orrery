// src/physics/barycentres.test.mjs
//
// The barycentres (barycentres.js) against JPL Horizons
// (fixtures/moons_horizons.json, from moons.fetch.mjs): the solar system
// barycentre (0) and the Earth-Moon barycentre (3) about the Sun's centre,
// daily over November 2026 and on 1 January of each year 2000-2050. The
// planet systems' barycentres are astronomy-engine's planets, checked in
// moons.test.mjs.
//
//   node src/physics/barycentres.test.mjs

import fs from 'node:fs';
import './deNode.js';                 // DE442's Earth and Moon, as in the app
import { baryStateEqj, baryGm } from './barycentres.js';
import { utcMsAtTt } from './ephemeris.js';
import * as Astronomy from 'astronomy-engine';

const hz = JSON.parse(fs.readFileSync(new URL('./fixtures/moons_horizons.json', import.meta.url)));
const dateOf = (jd) => new Date(utcMsAtTt((jd - 2451545) * 86400));
const AU_KM = 149597870.7;
// The DE442 table starts at J2000 (2000-01-01 12:00 TDB); before it the
// Earth and Moon are astronomy-engine's.
const IN_TABLE = (jd) => jd >= 2451545.0;

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const worst = (key, rows) => Math.max(...rows.map(([jd, x, y, z]) => { const r = baryStateEqj(key, dateOf(jd)).r; return Math.hypot(r[0] - x, r[1] - y, r[2] - z); }));
const size = (rows) => Math.max(...rows.map(([, x, y, z]) => Math.hypot(x, y, z)));

// The SSB from every planet's GM-weighted position: within 150 km, where
// astronomy-engine's own (the four giants only) is up to 1,500 km out.
for (const span of ['month', 'years']) {
  const rows = hz.bary[0][span];
  const own = Math.max(...rows.map(([jd, x, y, z]) => { const s = Astronomy.HelioVector(Astronomy.Body.SSB, dateOf(jd)); return Math.hypot(s.x * AU_KM - x, s.y * AU_KM - y, s.z * AU_KM - z); }));
  const e = worst('ssb', rows);
  check(e < 200, `SSB about the Sun, ${span === 'month' ? 'Nov 2026 daily' : '2000-2050 yearly'}: ${e.toFixed(1)} km (it lies up to ${size(rows).toFixed(0)} km from the Sun's centre; astronomy-engine's own SSB ${own.toFixed(0)} km)`);
}

// The Earth-Moon barycentre from DE442's Earth and Moon: the fixture's
// rounding (0.1 km) inside the table.
for (const span of ['month', 'years']) {
  const rows = hz.bary[3][span].filter(([jd]) => IN_TABLE(jd));
  const e = worst('emb', rows);
  check(e < 0.2, `Earth-Moon barycentre about the Sun, ${span === 'month' ? 'Nov 2026 daily' : '2000-2050 yearly'} (${rows.length} dates in the DE442 table): ${e.toFixed(3)} km`);
}

check(Math.abs(baryGm('ssb') / 1.32712440041253311e11 - 1.00134) < 1e-4, `the solar system's GM is ${(baryGm('ssb') / 1.32712440041253311e11).toFixed(6)} of the Sun's`);

if (failed) { console.log(`\n${failed} barycentre check(s) failed`); process.exit(1); }
console.log('\nbarycentres: all checks passed');
