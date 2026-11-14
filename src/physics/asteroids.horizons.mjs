// src/physics/asteroids.horizons.mjs
//
// From JPL Horizons, for the asteroids SB441's table holds (sbTable.js):
// heliocentric J2000 equatorial vectors every five years from 2000 to 2050,
// to check the table's positions against (asteroids.test.mjs), in
// fixtures/asteroids_horizons.json. Horizons integrates each body from its
// current orbit solution in the Small-Body Database; SB441 from the 2021
// solutions, so the two differ by what the orbits have learned since.
//
//   node src/physics/asteroids.horizons.mjs

import fs from 'node:fs';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
export const CHECK_NUMBERS = [1, 2, 3, 4, 7, 10, 15, 16, 31, 52, 65, 87, 88, 107, 511, 704, 21, 433, 50000, 90377, 90482, 136108, 136199, 136472, 225088];
// The same dates as c/sb_cheb.c's SPK reference (fixtures/asteroids_sb441.json).
export const CHECK_DATES = [...Array.from({ length: 10 }, (_, k) => `${2000 + 5 * k}-01-01 12:00`), '2049-12-31 12:00'];

const out = { source: 'JPL Horizons API, heliocentric (500@10) J2000 equatorial (FRAME) vectors, km, TDB', fetched: new Date().toISOString().slice(0, 10), bodies: {} };
for (const n of CHECK_NUMBERS) {
  const q = {
    format: 'text', COMMAND: `'${n};'`, EPHEM_TYPE: "'VECTORS'", CENTER: "'500@10'", REF_PLANE: "'FRAME'", REF_SYSTEM: "'J2000'",
    VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'", CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'TDB'",
    TLIST: CHECK_DATES.map((d) => `'${d}'`).join(' '),
  };
  const url = `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const text = await (await fetch(url, { headers: { 'User-Agent': 'digital-orrery data fetch' } })).text();
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0) throw new Error(`no vectors for ${n}:\n${text.slice(-600)}`);
  // The orbit solution Horizons used, as its header gives it.
  const soln = (text.match(/soln ref\.\s*=\s*([^,\n]+)/i) ?? [])[1]?.trim() ?? null;
  out.bodies[n] = {
    soln,
    rows: text.slice(i0 + 5, i1).trim().split('\n').map((l) => {
      const f = l.split(',').map((s) => s.trim());
      return { jd: Number(f[0]), r: [Number(f[2]), Number(f[3]), Number(f[4])], v: [Number(f[5]), Number(f[6]), Number(f[7])] };
    }),
  };
  console.log(n, out.bodies[n].rows.length, 'dates', soln ?? '');
  await new Promise((r) => setTimeout(r, 1200));
}
fs.writeFileSync(new URL('./fixtures/asteroids_horizons.json', import.meta.url), JSON.stringify(out, null, 1));
