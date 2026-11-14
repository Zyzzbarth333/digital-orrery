// src/physics/smallbodies.horizons.mjs
//
// From JPL Horizons, for the small bodies the app names (smallBodies.js
// NOTABLE):
// - fixtures/smallbodies_named.json: each one's osculating heliocentric
//   ecliptic J2000 elements at the shared epoch (SB_EPOCH_JD), which the
//   build uses in place of the SBDB solution: some of those are years old
//   (Bennu's is from 2011, Halley's from 1967), and two-body motion from
//   then is millions of kilometres off by 2026;
// - fixtures/smallbodies_horizons.json: positions of a few of them on a few
//   dates, to check the drawn orbits against (smallbodies.test.mjs).
//
//   node src/physics/smallbodies.horizons.mjs

import fs from 'node:fs';
import dns from 'node:dns';
import { NOTABLE, SB_EPOCH_JD } from './smallBodies.js';

dns.setDefaultResultOrder('ipv4first');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
export const CHECK_BODIES = [
  { pdes: '1', command: "'1;'" }, { pdes: '4', command: "'4;'" }, { pdes: '101955', command: "'101955;'" },
  { pdes: '136199', command: "'136199;'" }, { pdes: '1P', command: "'DES=1P;CAP;'" },
];
export const CHECK_DATES = ['2026-01-01 00:00', '2026-07-01 00:00', '2027-01-01 00:00'];

const D2R = Math.PI / 180;
const ask = async (q) => {
  const url = `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const text = await (await fetch(url, { headers: { 'User-Agent': 'digital-orrery data fetch' } })).text();
  await new Promise((r) => setTimeout(r, 1200));
  return text;
};
const commandFor = (pdes) => (/^\d+$/.test(pdes) ? `'${pdes};'` : `'DES=${pdes};CAP;'`);

// The named bodies' elements at the epoch.
const named = { source: 'JPL Horizons API, osculating heliocentric (500@10) ecliptic J2000 elements, TDB', epochJd: SB_EPOCH_JD, fetched: new Date().toISOString().slice(0, 10), elements: {} };
for (const pdes of Object.keys(NOTABLE)) {
  const text = await ask({ format: 'text', COMMAND: commandFor(pdes), EPHEM_TYPE: "'ELEMENTS'", CENTER: "'500@10'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'", OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'", TIME_TYPE: "'TDB'", TLIST: `'${SB_EPOCH_JD}'`, TLIST_TYPE: "'JD'" });
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0) { console.warn(`no elements for ${pdes}: ${text.slice(-300)}`); continue; }
  // JDTDB, Calendar, EC, QR, IN, OM, W, Tp, N, MA, TA, A, AD, PR
  const f = text.slice(i0 + 5, i1).trim().split(',').map((x) => x.trim());
  named.elements[pdes] = { e: Number(f[2]), i: Number(f[4]) * D2R, node: Number(f[5]) * D2R, peri: Number(f[6]) * D2R, M: Number(f[9]) * D2R, a: Number(f[11]) };
  console.log(pdes, named.elements[pdes].a.toFixed(4), named.elements[pdes].e.toFixed(4));
}
fs.writeFileSync(new URL('./fixtures/smallbodies_named.json', import.meta.url), JSON.stringify(named, null, 1));

const out = { source: 'JPL Horizons API, heliocentric (500@10) ecliptic J2000 vectors, TT', fetched: new Date().toISOString().slice(0, 10), bodies: {} };
for (const b of CHECK_BODIES) {
  const q = {
    format: 'text', COMMAND: b.command, EPHEM_TYPE: "'VECTORS'", CENTER: "'500@10'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'J2000'",
    VEC_TABLE: "'1'", OUT_UNITS: "'AU-D'", CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'TT'",
    TLIST: CHECK_DATES.map((d) => `'${d}'`).join(' '),
  };
  const url = `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const text = await (await fetch(url, { headers: { 'User-Agent': 'digital-orrery data fetch' } })).text();
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0) throw new Error(`no vectors for ${b.pdes}:\n${text.slice(-600)}`);
  out.bodies[b.pdes] = text.slice(i0 + 5, i1).trim().split('\n').map((l) => { const f = l.split(',').map((s) => s.trim()); return { jd: Number(f[0]), r: [Number(f[2]), Number(f[3]), Number(f[4])] }; });
  console.log(b.pdes, out.bodies[b.pdes].length, 'dates');
  await new Promise((r) => setTimeout(r, 1500));
}
fs.writeFileSync(new URL('./fixtures/smallbodies_horizons.json', import.meta.url), JSON.stringify(out, null, 1));
