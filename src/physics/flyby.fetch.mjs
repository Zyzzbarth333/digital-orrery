// src/physics/flyby.fetch.mjs
//
// JPL Horizons vectors for Juno's flyby of Ganymede on 7 June 2021, the
// check case for the moons' pull in the kernel (flyby.test.mjs,
// docs/validation.md#the-moons-pull-junos-ganymede-flyby-flybytestmjs). Writes
// fixtures/flyby_juno_ganymede.json:
//   juno     Juno (-61) about the Jupiter system barycentre (5)
//   centre   Jupiter's centre (599) about the barycentre (5)
//   moons    Io, Europa, Ganymede, Callisto (501-504) about Jupiter's centre
//            (599)
//   junoGanymede  Juno about Ganymede's centre (503)
//   close    Juno about Ganymede's centre, every 10 s through closest
//            approach
// all geometric, ICRF, TDB, km and km/s, every 10 minutes from 06:00 on 7
// June to 12:00 on 8 June 2021 TDB (wide enough for the kernel's nodes).
// The span flown (span) is 08:00 to 02:00: nine hours either side of closest
// approach (16:57:20 TDB, 3,677 km from Ganymede's centre), and six hours
// before the perijove that followed (PJ34, 07:46 on 8 June, where Jupiter's
// higher harmonics, which the kernel leaves out, take over). Horizons' Juno
// is JPL's reconstructed trajectory (spk_rec_110805_*_260824).
//
// Raw downloads are kept under ~/.cache/digital-orrery/flyby (not
// committed); delete that folder to fetch afresh.
//
//   npm run fetch:flyby

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
const CACHE = path.join(os.homedir(), '.cache', 'digital-orrery', 'flyby');
fs.mkdirSync(CACHE, { recursive: true });
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const UA = { 'User-Agent': 'digital-orrery data fetch' };
const START = '2021-06-07 08:00', STOP = '2021-06-08 02:00', STEP = '10 m';
const WIDE = ['2021-06-07 06:00', '2021-06-08 12:00'];
const CLOSE = ['2021-06-07 16:47:20', '2021-06-07 17:07:20', '120'];   // 10 s steps

async function horizons(name, q) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const query = { format: 'text', EPHEM_TYPE: "'VECTORS'", REF_PLANE: "'FRAME'", REF_SYSTEM: "'ICRF'", VEC_TABLE: "'2'",
    OUT_UNITS: "'KM-S'", CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'TDB'", VEC_CORR: "'NONE'", ...q };
  const url = `${API}?${Object.entries(query).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
  const text = await (await fetch(url, { headers: UA })).text();
  fs.writeFileSync(file, text);
  await new Promise((r) => setTimeout(r, 1200));
  return text;
}

// Rows of [JD TDB, x, y, z, vx, vy, vz], rounded to 1e-4 km and 1e-7 km/s
// (Horizons prints more digits than that).
function vectors(text) {
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0) throw new Error(`no vectors:\n${text.slice(-600)}`);
  return text.slice(i0 + 5, i1).trim().split('\n').map((l) => {
    const f = l.split(',').map((s) => s.trim());
    return [Number(f[0]), ...[2, 3, 4].map((i) => Number(Number(f[i]).toFixed(4))), ...[5, 6, 7].map((i) => Number(Number(f[i]).toFixed(7)))];
  });
}

const wide = { START_TIME: `'${WIDE[0]}'`, STOP_TIME: `'${WIDE[1]}'`, STEP_SIZE: `'${STEP}'` };
const out = {
  source: 'JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), geometric, ICRF, TDB; fetched by flyby.fetch.mjs',
  // The span flown (JD TDB): the tables run wider, for the kernel's nodes.
  span: [START, STOP].map((d) => Date.parse(`${d.replace(' ', 'T')}Z`) / 86400000 + 2440587.5),
  juno: vectors(await horizons('juno_5_wide.txt', { COMMAND: "'-61'", CENTER: "'500@5'", ...wide })),
  centre: vectors(await horizons('599_5_wide.txt', { COMMAND: "'599'", CENTER: "'500@5'", ...wide })),
  moons: {},
  junoGanymede: vectors(await horizons('juno_503_wide.txt', { COMMAND: "'-61'", CENTER: "'500@503'", ...wide })),
  close: vectors(await horizons('juno_503.txt', { COMMAND: "'-61'", CENTER: "'500@503'",
    START_TIME: `'${CLOSE[0]}'`, STOP_TIME: `'${CLOSE[1]}'`, STEP_SIZE: `'${CLOSE[2]}'` })),
};
for (const [key, id] of [['io', 501], ['europa', 502], ['ganymede', 503], ['callisto', 504]]) {
  out.moons[key] = vectors(await horizons(`${id}_599_wide.txt`, { COMMAND: `'${id}'`, CENTER: "'500@599'", ...wide }));
}
const ca = out.close.reduce((a, b) => (Math.hypot(b[1], b[2], b[3]) < Math.hypot(a[1], a[2], a[3]) ? b : a));
console.log(`closest approach JD ${ca[0]} TDB, ${Math.hypot(ca[1], ca[2], ca[3]).toFixed(1)} km from Ganymede's centre, ${Math.hypot(ca[4], ca[5], ca[6]).toFixed(3)} km/s`);
fs.writeFileSync(new URL('./fixtures/flyby_juno_ganymede.json', import.meta.url), JSON.stringify(out));
console.log(`wrote fixtures/flyby_juno_ganymede.json (${out.juno.length} rows a table)`);
