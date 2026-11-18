// src/physics/flyby.fetch.mjs
//
// JPL Horizons vectors for three moon flybys, the check cases for the
// moons' pull in the kernel (flyby.test.mjs,
// docs/validation.md#the-moons-pull-flybys-of-ganymede-io-and-titan-flybytestmjs):
//
//   ganymede  Juno (-61) at Ganymede, 7 June 2021, 3,677 km from its centre (1,046 km up)
//   io        Juno at Io, 30 December 2023 (PJ57), 3,317 km (1,496 km up)
//   titan     Cassini (-82) at Titan, 31 July 2008 (T45), 4,189 km (1,613 km up)
//   europa    Juno at Europa, 29 September 2022 (PJ45), 1,916 km (355 km up)
//   enceladus Cassini at Enceladus, 30 November 2010 (E12), 295 km (43 km up)
//   saturn    Cassini's Grand Finale periapsis, Rev 278, 10 June 2017, 63,623 km
//             from Saturn's centre (a planet, not a moon: no implied moon)
//   triton    Voyager 2 (-32) past Neptune (29,240 km) and Triton (39,783 km),
//             25 August 1989
//   miranda   Voyager 2 past Miranda (28,243 km) and Uranus (107,153 km),
//             24 January 1986
//
// Each writes fixtures/flyby_<craft>_<target>.json:
//   craft      the craft about its planet's system barycentre (5, 6)
//   centre     the planet's centre (599, 699) about the barycentre
//   moons      the major moons about the planet's centre
//   craftMoon  the craft about the moon's centre
//   close      the craft about the moon's centre, every 10 s through
//              closest approach
// all geometric, ICRF, TDB, km and km/s, every 10 minutes over a span wider
// than the one flown (span), for the kernel's nodes. Horizons' Juno is
// JPL's reconstructed trajectory (spk_rec_110805_*_260824), its Cassini
// the final post-mission reconstruction (2004 to the end of the mission).
//
// Ganymede: the span flown is nine hours either side of closest approach
// (16:57:20 TDB), and six hours before the perijove that followed (PJ34,
// 07:46 on 8 June), where Jupiter's higher harmonics, which the kernel
// leaves out, take over. Io: six hours before closest approach (08:37 TDB)
// to one after, ending three hours before PJ57 (12:40 TDB). Titan: nine
// hours either side of closest approach (02:14 TDB), 19 to 20 Saturn radii
// out. Each wide span runs six hours past the last row: the kernel's
// planet-centre nodes are six hours apart.
//
// Raw downloads are kept under ~/.cache/digital-orrery/flyby (not
// committed); delete that folder to fetch afresh.
//
//   npm run fetch:flyby              (every case)
//   npm run fetch:flyby -- io titan  (some)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';
import { execFileSync } from 'node:child_process';

dns.setDefaultResultOrder('ipv4first');
const CACHE = path.join(os.homedir(), '.cache', 'digital-orrery', 'flyby');
fs.mkdirSync(CACHE, { recursive: true });
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const UA = { 'User-Agent': 'digital-orrery data fetch' };
const STEP = '10 m';

const JUPITER = { bary: 5, centre: 599, moons: [['io', 501], ['europa', 502], ['ganymede', 503], ['callisto', 504]] };
const SATURN = { bary: 6, centre: 699, moons: [['mimas', 601], ['enceladus', 602], ['tethys', 603], ['dione', 604], ['rhea', 605], ['titan', 606], ['iapetus', 608]] };
const URANUS = { bary: 7, centre: 799, moons: [['ariel', 701], ['umbriel', 702], ['titania', 703], ['oberon', 704], ['miranda', 705]] };
const NEPTUNE = { bary: 8, centre: 899, moons: [['triton', 801]] };
const CASES = {
  // Raw file names as first fetched (juno_5_wide.txt and so on).
  ganymede: { craft: ['juno', -61], moon: 503, system: JUPITER, span: ['2021-06-07 08:00', '2021-06-08 02:00'],
    wide: ['2021-06-07 06:00', '2021-06-08 12:00'], close: ['2021-06-07 16:47:20', '2021-06-07 17:07:20'], prefix: '' },
  io: { craft: ['juno', -61], moon: 501, system: JUPITER, span: ['2023-12-30 02:30', '2023-12-30 14:40'],
    wide: ['2023-12-30 00:30', '2023-12-30 21:00'], close: ['2023-12-30 08:27:00', '2023-12-30 08:47:00'], prefix: 'pj57_' },
  europa: { craft: ['juno', -61], moon: 502, system: JUPITER, span: ['2022-09-29 03:40', '2022-09-29 19:10'],
    wide: ['2022-09-29 01:40', '2022-09-30 02:00'], close: ['2022-09-29 09:27:00', '2022-09-29 09:47:00'], prefix: 'pj45_' },
  // E12, one of the three passes Iess et al. 2014 measured Enceladus's
  // field on: 48 km over the north pole, away from the plumes.
  enceladus: { craft: ['cassini', -82], moon: 602, system: SATURN, span: ['2010-11-30 02:55', '2010-11-30 20:55'],
    wide: ['2010-11-30 00:30', '2010-12-01 04:00'], close: ['2010-11-30 11:50:00', '2010-11-30 12:00:00'], prefix: 'e12_' },
  // A periapsis, not a moon's pass: the target is Saturn's centre.
  saturn: { craft: ['cassini', -82], moon: 699, system: SATURN, span: ['2017-06-10 06:55', '2017-06-10 18:55'],
    wide: ['2017-06-10 04:30', '2017-06-11 02:00'], close: ['2017-06-10 12:45:00', '2017-06-10 13:05:00'], prefix: 'rev278_' },
  // Horizons' Voyager 2 before 29 August 1989 is a patched-conic design
  // trajectory, so this case reads NAIF's reconstruction of the encounter
  // (vgr2_nep097.bsp: R. Jacobson, 2022, with nep097's Neptune and Triton)
  // through c/flyby_ref instead.
  triton: { craft: ['voyager2', -32], moon: 801, system: NEPTUNE, span: ['1989-08-24 21:00', '1989-08-25 15:00'],
    wide: ['1989-08-24 19:00', '1989-08-25 22:00'], close: ['1989-08-25 09:02:00', '1989-08-25 09:22:00'], prefix: 'vgr2spk_',
    spk: ['lsk/naif0012.tls', 'spk/missions/voyager2/vgr2_nep097.bsp'] },
  // The same at Uranus: vgr2.ura182.bsp (R. Jacobson, 2025, with URA182's
  // Uranus and moons merged in by NAIF). Twelve hours either side of
  // Uranus's closest approach (18:00 TDB); Miranda's is at 17:04.
  miranda: { craft: ['voyager2', -32], moon: 705, system: URANUS, span: ['1986-01-24 10:00', '1986-01-25 06:00'],
    wide: ['1986-01-24 04:00', '1986-01-25 13:00'], close: ['1986-01-24 16:54:00', '1986-01-24 17:14:00'], prefix: 'vgr2ura_',
    spk: ['lsk/naif0012.tls', 'spk/missions/voyager2/vgr2.ura182.bsp'] },
  titan: { craft: ['cassini', -82], moon: 606, system: SATURN, span: ['2008-07-30 17:10', '2008-07-31 11:10'],
    wide: ['2008-07-30 15:00', '2008-07-31 18:00'], close: ['2008-07-31 02:04:00', '2008-07-31 02:24:00'], prefix: 't45_' },
};

// The same table from SPK kernels, by c/flyby_ref (FLYBY_REF names the
// built tool, default c/build/flyby_ref; kernels under python/data/kernels,
// or KERNELS).
const KERNELS = process.env.KERNELS ?? path.join(path.dirname(new URL(import.meta.url).pathname), '../../python/data/kernels');
const REF = process.env.FLYBY_REF ?? path.join(path.dirname(new URL(import.meta.url).pathname), '../../c/build/flyby_ref');
function spkTable(name, kernels, target, centre, start, stop, step) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const text = execFileSync(REF, [String(target), String(centre), start, stop, String(step), ...kernels.map((k) => path.join(KERNELS, k))], { encoding: 'utf8' });
  fs.writeFileSync(file, text);
  return text;
}

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
const jd = (d) => Date.parse(`${d.replace(' ', 'T')}Z`) / 86400000 + 2440587.5;

const want = process.argv.slice(2);
for (const [key, C] of Object.entries(CASES)) {
  if (want.length && !want.includes(key)) continue;
  const [name, id] = C.craft, S = C.system, p = C.prefix;
  const wide = { START_TIME: `'${C.wide[0]}'`, STOP_TIME: `'${C.wide[1]}'`, STEP_SIZE: `'${STEP}'` };
  // A table from Horizons, or from the case's SPK kernels.
  const get = async (file, q) => {
    if (!C.spk) return horizons(file, q);
    const un = (x) => x.replace(/^'|'$/g, '').replace(/^500@/, '');
    const step = q.STEP_SIZE === "'120'" ? 10 : 600;
    return spkTable(file, C.spk, un(q.COMMAND), un(q.CENTER), un(q.START_TIME), un(q.STOP_TIME), step);
  };
  const out = {
    source: C.spk ? `NAIF SPK (${C.spk.slice(1).join(', ')}) via c/flyby_ref, geometric, J2000, TDB; fetched by flyby.fetch.mjs` : 'JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), geometric, ICRF, TDB; fetched by flyby.fetch.mjs',
    craftName: name, moon: key,
    // The span flown (JD TDB): the tables run wider, for the kernel's nodes.
    span: C.span.map(jd),
    craft: vectors(await get(`${p}${name}_${S.bary}_wide.txt`, { COMMAND: `'${id}'`, CENTER: `'500@${S.bary}'`, ...wide })),
    centre: vectors(await get(`${p}${S.centre}_${S.bary}_wide.txt`, { COMMAND: `'${S.centre}'`, CENTER: `'500@${S.bary}'`, ...wide })),
    moons: {},
    craftMoon: vectors(await get(`${p}${name}_${C.moon}_wide.txt`, { COMMAND: `'${id}'`, CENTER: `'500@${C.moon}'`, ...wide })),
    close: vectors(await get(`${p}${name}_${C.moon}.txt`, { COMMAND: `'${id}'`, CENTER: `'500@${C.moon}'`,
      START_TIME: `'${C.close[0]}'`, STOP_TIME: `'${C.close[1]}'`, STEP_SIZE: "'120'" })),   // 10 s steps
  };
  for (const [k, mid] of S.moons) {
    out.moons[k] = vectors(await get(`${p}${mid}_${S.centre}_wide.txt`, { COMMAND: `'${mid}'`, CENTER: `'500@${S.centre}'`, ...wide }));
  }
  const ca = out.close.reduce((a, b) => (Math.hypot(b[1], b[2], b[3]) < Math.hypot(a[1], a[2], a[3]) ? b : a));
  console.log(`${key}: closest approach JD ${ca[0]} TDB, ${Math.hypot(ca[1], ca[2], ca[3]).toFixed(1)} km from the centre, ${Math.hypot(ca[4], ca[5], ca[6]).toFixed(3)} km/s`);
  const file = `fixtures/flyby_${name}_${key}.json`;
  fs.writeFileSync(new URL(`./${file}`, import.meta.url), JSON.stringify(out));
  console.log(`wrote ${file} (${out.craft.length} rows a table)`);
}
