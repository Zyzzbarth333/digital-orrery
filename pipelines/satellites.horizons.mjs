// pipelines/satellites.horizons.mjs
//
// `npm run fetch:satellites-horizons`: the independent check of the
// satellites layer (satellites.test.mjs). JPL Horizons' ISS (-125544):
// geocentric ICRF positions and velocities, worked out by JPL's own code,
// at times around the epoch of the ISS element set in the snapshot
// (public/data/satellites.csv), which is kept with them, so the check
// stays put when the snapshot is fetched again.
//
//   packages/physics/src/fixtures/iss_horizons.json
//
// Run it after `npm run fetch:satellites`. Horizons says its ISS is
// "TLE-based", so the two share the element set's own error (a kilometre
// or so a day from epoch) only where they share an element set: the check
// is of SGP4, the epoch and the TEME -> J2000 turn, not of the ISS's true
// track.

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGpCsv, epochMs } from '@digital-orrery/physics/satellites.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';

const rows = parseGpCsv(await readFile(join(ROOT, 'public', 'data', 'satellites.csv'), 'utf8'));
const iss = rows.find((r) => r.NORAD_CAT_ID === 25544);
if (!iss) throw new Error('no ISS (25544) in the snapshot');
const t0 = epochMs(iss.EPOCH);
// Every 90 minutes from 6 h before the epoch to 6 h after, on whole minutes.
const times = [];
for (let h = -6; h <= 6; h += 1.5) times.push(Math.round((t0 + h * 3600e3) / 60e3) * 60e3);
const jd = (ms) => (ms / 86400e3 + 2440587.5).toFixed(9);
const params = new URLSearchParams({
  format: 'json', COMMAND: "'-125544'", OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS',
  CENTER: "'500@399'", REF_PLANE: 'FRAME', REF_SYSTEM: 'ICRF', VEC_TABLE: '2', OUT_UNITS: 'KM-S',
  TIME_TYPE: 'UT', CSV_FORMAT: 'YES', VEC_LABELS: 'NO', TLIST_TYPE: 'JD', TLIST: times.map(jd).join(' '),
});
const res = await fetch(`${API}?${params}`);
if (res.status !== 200) throw new Error(`Horizons answered HTTP ${res.status}`);
const out = (await res.json()).result;
const body = out.slice(out.indexOf('$$SOE') + 5, out.indexOf('$$EOE')).trim().split('\n');
const vectors = body.map((l) => {
  const f = l.split(',').map((s) => s.trim());
  return { jdUt: Number(f[0]), r: f.slice(2, 5).map(Number), v: f.slice(5, 8).map(Number) };
});
if (vectors.length !== times.length) throw new Error(`Horizons gave ${vectors.length} vectors for ${times.length} times:\n${out.slice(0, 3000)}`);
const revised = /Revised:\s*([A-Za-z]{3} \d+, \d{4})/.exec(out)?.[1] ?? null;
await writeFile(join(ROOT, 'src', 'physics', 'fixtures', 'iss_horizons.json'), `${JSON.stringify({
  source: `JPL Horizons API, ISS (-125544), geocentric ICRF (500@399, REF_PLANE=FRAME), UT, km and km/s; fetched ${new Date().toISOString().slice(0, 10)}${revised ? `, Horizons' ISS revised ${revised}` : ''}`,
  omm: iss,
  vectors,
}, null, 1)}\n`);
console.log(`ISS at epoch ${iss.EPOCH}: ${vectors.length} Horizons vectors${revised ? ` (revised ${revised})` : ''}`);
