// src/physics/magnetic.fetch.mjs
//
// Builds the magnetic-field and aurora data (docs/physics/magnetic-fields.md):
//
//   npm run fetch:magnetic
//
// - src/physics/magnetic.data.js: the planets' internal fields as Schmidt
//   semi-normalised Gauss coefficients (nT):
//   - Earth, IGRF-14 (IAGA Working Group V-MOD, Alken et al. 2025): every
//     epoch 1900 to 2025 to degree 13 (10 before 2000) and the 2025-30
//     secular variation, from NOAA NCEI's copy of the official table;
//   - Jupiter, JRM33 (Connerney et al. 2022) to degree 13, the degree its
//     authors say the coefficients are well resolved to (the model goes to
//     30), from the paper's own supporting Table S1 (JRM33.mod);
//   - Saturn, Cassini 11 (Dougherty et al. 2018, Cao et al. 2020) to degree
//     11, axisymmetric, from the coefficient file of libinternalfield
//     (M. James, MIT licence), which transcribes the papers' table.
// - Mars's crustal field, Langlais et al. 2019 to degree 134 (from
//   libinternalfield's transcription): its coefficients as a test fixture
//   (src/physics/fixtures/langlais2019.json), and the app's map of the
//   radial field on the 3,393.5 km sphere, 720 x 360 cells, one signed byte
//   each on marsCrustal.js's asinh scale (public/data/mars-crustal-br.bin).
// - public/data/kp.json: the planetary Kp index every three hours from 2000,
//   observed and then CelesTrak's 45-day prediction, from the same SW-All.csv
//   as the atmosphere's space weather (environment.fetch.mjs), read from its
//   cache when it is there. Each character is Kp in thirds, '0' + 3 Kp
//   ('0' Kp 0, '1' 0+, '2' 1-, '3' 1o, ...); '~' where there is none.
//
// Raw downloads are cached in ~/.cache/digital-orrery.

import fs from 'node:fs';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
const CACHE = `${process.env.HOME}/.cache/digital-orrery`;
fs.mkdirSync(`${CACHE}/magnetic`, { recursive: true });

async function cached(url, file) {
  const path = `${CACHE}/${file}`;
  if (!fs.existsSync(path)) {
    const res = await fetch(url, { headers: { 'User-Agent': 'digital-orrery magnetic model' } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(path, await res.text());
  }
  return fs.readFileSync(path, 'utf8');
}

// ---- IGRF-14 ----
const IGRF_URL = 'https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt';
const igrfText = await cached(IGRF_URL, 'magnetic/igrf14coeffs.txt');
const rows = igrfText.split(/\r?\n/).filter((l) => /^[gh] /.test(l)).map((l) => l.trim().split(/\s+/));
const header = igrfText.split(/\r?\n/).find((l) => l.startsWith('g/h')).trim().split(/\s+/);
const epochs = header.slice(3, -1).map(Number);           // 1900 ... 2025; the last column is the SV
const NI = 13;
// One flat array per epoch in the order g10 g11 h11 g20 g21 h21 g22 h22 ...
const idx = (n, m, h) => n * n - 1 + (m === 0 ? 0 : 2 * m - 1 + (h ? 1 : 0));
const size = NI * NI + 2 * NI;
const igrf = epochs.map(() => new Array(size).fill(0));
const sv = new Array(size).fill(0);
for (const r of rows) {
  const [c, n, m] = [r[0], Number(r[1]), Number(r[2])];
  const k = idx(n, m, c === 'h');
  epochs.forEach((_, e) => { igrf[e][k] = Number(r[3 + e]); });
  sv[k] = Number(r[3 + epochs.length]);
}
if (igrf.at(-1)[0] !== -29350 || sv[0] !== 12.6) throw new Error('IGRF-14: unexpected g10 for 2025');

// ---- JRM33 and Cassini 11 ----
const LIF = 'https://raw.githubusercontent.com/mattkjames7/libinternalfield/main/data/coeffs';
function readDat(text, nMax) {
  const out = new Array(nMax * nMax + 2 * nMax).fill(0);
  for (const l of text.split(/\r?\n/)) {
    const f = l.trim().split(/\s+/);
    if (!/^[gh]$/.test(f[0])) continue;
    const n = Number(f[1]), m = Number(f[2]);
    if (n <= nMax) out[idx(n, m, f[0] === 'h')] = Number(f[3]);
  }
  return out;
}
// JRM33.mod: index, coefficient (nT), (resolution), then the name in fixed
// columns ("g 1 0", "h3029"); the last three lines are the external field.
const JRM33_URL = 'https://authors.library.caltech.edu/records/dds0z-2vx98/files/2021je007055-sup-0002-table_si-s01.txt?download=1';
const jrm33 = new Array(13 * 13 + 2 * 13).fill(0);
for (const l of (await cached(JRM33_URL, 'magnetic/2021je007055-sup-0002-table_si-s01.txt')).split(/\r?\n/).slice(1)) {
  const m = /^\s*\d+\s+(\S+)\s+\(\S*\)\s([gh])(..)(..)/.exec(l);
  if (!m) continue;
  const n = Number(m[3]), mm = Number(m[4]);
  if (n <= 13) jrm33[idx(n, mm, m[2] === 'h')] = Number(m[1]);
}
const cassini11 = readDat(await cached(`${LIF}/saturn/cassini11.dat`, 'magnetic/cassini11.dat'), 11);
if (jrm33[0] !== 410993.4 || cassini11[0] !== 21140.2) throw new Error('JRM33 or Cassini 11: unexpected g10');

const fmt = (a) => `[${a.map((v) => (Number.isInteger(v) ? v : Number(v.toPrecision(8)))).join(',')}]`;
const js = `// src/physics/magnetic.data.js: written by magnetic.fetch.mjs (npm run fetch:magnetic); do not edit.
//
// Schmidt semi-normalised Gauss coefficients in nT, in the order
// g10 g11 h11 g20 g21 h21 g22 h22 ... (see magnetic.js).

// IGRF-14 (IAGA V-MOD; ${IGRF_URL}), at each epoch, and its 2025-30 secular variation (nT/yr).
export const IGRF = {
  a: 6371.2, n: ${NI}, epochs: ${JSON.stringify(epochs)},
  coeffs: [
${igrf.map((c) => `    ${fmt(c)},`).join('\n')}
  ],
  sv: ${fmt(sv)},
};

// JRM33 (Connerney et al. 2022, doi:10.1029/2021JE007055, supporting Table S1) to degree 13, System III (1965), R_J 71,492 km.
export const JRM33 = { a: 71492, n: 13, coeffs: ${fmt(jrm33)} };

// Cassini 11 (Dougherty et al. 2018, doi:10.1126/science.aat5434; Cao et al. 2020, doi:10.1016/j.icarus.2019.113541), R_S 60,268 km.
export const CASSINI11 = { a: 60268, n: 11, coeffs: ${fmt(cassini11)} };
`;
fs.writeFileSync(new URL('./magnetic.data.js', import.meta.url), js);
console.log(`magnetic.data.js: IGRF-14 ${epochs[0]}-${epochs.at(-1)}, JRM33 to 13, Cassini 11 to 11 (${(js.length / 1024).toFixed(0)} kB)`);

// ---- Mars's crustal field ----
{
  const { radialFieldGrid, encodeBr } = await import('./marsCrustal.js');
  const NM = 134, mars = readDat(await cached(`${LIF}/mars/langlais2019.dat`, 'magnetic/langlais2019.dat'), NM);
  fs.writeFileSync(new URL('./fixtures/langlais2019.json', import.meta.url), JSON.stringify({
    source: 'Langlais et al. 2019 (doi:10.1029/2018JE005854), via libinternalfield (MIT): Schmidt g/h (nT) to degree 134 in magnetic.js order, reference radius 3393.5 km',
    a: 3393.5, n: NM, coeffs: mars,
  }));
  const grid = radialFieldGrid(mars, NM, 1, 720, 360), bytes = new Int8Array(grid.length);
  for (let i = 0; i < grid.length; i++) bytes[i] = encodeBr(grid[i]);
  fs.writeFileSync(new URL('../../public/data/mars-crustal-br.bin', import.meta.url), bytes);
  let lo = Infinity, hi = -Infinity;
  for (const v of grid) { if (v < lo) lo = v; if (v > hi) hi = v; }
  console.log(`mars-crustal-br.bin: 720 x 360, Br ${lo.toFixed(0)} to ${hi.toFixed(0)} nT`);
}

// ---- Kp ----
const SW_URL = 'https://celestrak.org/SpaceData/SW-All.csv';
fs.mkdirSync(`${CACHE}/spaceweather`, { recursive: true });
const sw = (await cached(SW_URL, 'spaceweather/SW-All.csv')).trim().split(/\r?\n/);
const cols = sw[0].split(',');
const iDate = cols.indexOf('DATE'), iKp = cols.indexOf('KP1'), iType = cols.indexOf('F10.7_DATA_TYPE');
let kp = '', start = null, lastObserved = null, last = -1;
for (const l of sw.slice(1)) {
  const f = l.split(',');
  if (f[iDate] < '2000-01-01') continue;
  start ??= f[iDate];
  let day = '';
  for (let j = 0; j < 8; j++) {
    const v = f[iKp + j];
    // Kp x 10 in the file (3+ is 33, 4- is 37): to thirds.
    day += v === '' ? '~' : String.fromCharCode(48 + Math.round(Number(v) * 3 / 10));
  }
  kp += day;
  if (f[iType] === 'OBS') lastObserved = f[iDate];
  if (!day.includes('~')) last = kp.length;
}
kp = kp.slice(0, last);
const kpOut = { source: 'CelesTrak SW-All.csv (T. S. Kelso; GFZ Potsdam Kp, NOAA SWPC predictions)', url: SW_URL,
  format: "Kp every 3 h from start 00 UT, one character each: '0' + 3 Kp, '~' none", start, lastObserved, kp };
const kpPath = new URL('../../public/data/kp.json', import.meta.url);
fs.writeFileSync(kpPath, JSON.stringify(kpOut));
console.log(`kp.json: ${kp.length / 8} days from ${start} (observed to ${lastObserved}), ${(fs.statSync(kpPath).size / 1024).toFixed(0)} kB`);
