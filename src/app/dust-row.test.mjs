// src/app/dust-row.test.mjs: what Mars's plate says of the dust drawn
// (dust-row.ts dustRow), and how the dust layer finds a date's map and
// sums it up (marsDust.ts mapFor, mapStats, cdodOf): a date outside the
// maps' sols has none, and the plate says so.
//
// They are TypeScript, so Vite's module runner loads them.
//
//   node src/app/dust-row.test.mjs

import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const load = async (id) => (await runnerImport(id, { root, configFile: false, logLevel: 'error' })).module;
const { dustRow } = await load('/src/app/dust-row.ts');
const { mapFor, mapStats, cdodOf } = await load('/src/scene/marsDust.ts');
const { marsYearStart, SOL_S } = await load('/packages/physics/src/marsTime.js');

let passed = 0, failed = 0;
function check(name, fn) {
  let ok;
  try { ok = fn(); } catch (err) { ok = false; console.log(`        threw ${err}`); }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) passed++; else failed++;
}

const INDEX = {
  grid: { nLon: 120, nLat: 60, lon0: -180, lat0: -88.5, step: 3 }, maxCdod: 6.5, visible: 2.6, variable: 'cdod',
  // As the pipeline writes them (public/marsdust/index.json).
  years: [
    { my: 24, file: 'my24.bin', start: Date.parse('1999-03-03T22:31:00Z'), soy: 227, sols: 442, version: '2.0' },
    { my: 34, file: 'my34.bin', start: Date.parse('2017-05-05T12:46:00Z'), soy: 1, sols: 668, version: '2.5' },
  ],
};
const solMs = SOL_S * 1000;

console.log('mapFor: the map for a date');
check('half a sol into map 395 of MY 34 is that map, its sol 396', () => {
  const at = mapFor(INDEX, INDEX.years[1].start + 395.5 * solMs);
  return at.year?.file === 'my34.bin' && at.k === 395 && at.sol === 396 && at.my === 34;
});
check('15 June 2018, the global dust storm: MY 34, Ls 193', () => {
  const at = mapFor(INDEX, Date.UTC(2018, 5, 15));
  return at.year?.my === 34 && at.ls > 193 && at.ls < 194;
});
check('the first map of MY 24 is its sol 227; before it, none', () => mapFor(INDEX, INDEX.years[0].start + 1).sol === 227
  && mapFor(INDEX, INDEX.years[0].start - 1).year === null && mapFor(INDEX, marsYearStart(24) + 50.5 * solMs).my === 24);
check('the last map of a year ends where its sols do', () => mapFor(INDEX, INDEX.years[1].start + 668 * solMs - 1).k === 667
  && mapFor(INDEX, INDEX.years[1].start + 668 * solMs).year === null);
check('a year with no file has none (MY 37, 2023)', () => mapFor(INDEX, Date.UTC(2023, 5, 1)).year === null);

console.log('cdodOf, mapStats: the bytes decoded');
check('byte 255 is the top of the encoding, 0 is clear', () => cdodOf(255, 6.5) === 6.5 && cdodOf(0, 6.5) === 0);
check('the mean of a uniform map is its value', () => {
  const s = mapStats(new Uint8Array(7200).fill(128), INDEX);
  return Math.abs(s.mean - cdodOf(128, 6.5)) < 1e-12 && s.max === cdodOf(128, 6.5);
});
check('the mean weights cells by area: a dusty pole counts for little', () => {
  const b = new Uint8Array(7200);
  b.fill(255, 59 * 120);                       // the northernmost row, 87 to 90 N
  const s = mapStats(b, INDEX);
  return s.max === 6.5 && Math.abs(s.mean - 6.5 * (1 - Math.sin(87 * Math.PI / 180)) / 2) < 1e-9;
});

console.log('dustRow: the plate');
const drawn = dustRow({ status: 'drawn', my: 34, sol: 395, ls: 193.43, mean: 1.234, max: 3.21, version: '2.5' });
check('a drawn sol gives its optical depth, sol, Ls and source', () => drawn.label === 'Dust' && drawn.value === '1.2' && drawn.src === 'LMD'
  && drawn.detail.includes('MY 34 sol 395, Ls 193.4°') && drawn.alt.includes('up to 3.2'));
check('a clear sol keeps two decimals', () => dustRow({ status: 'drawn', my: 30, sol: 10, ls: 5, mean: 0.123, max: 0.31, version: '2.0' }).value === '0.12');
const none = dustRow({ status: 'none', my: 37, ls: 120.04 });
check('outside the maps: no observation for this date', () => none.value === 'No observation' && none.alt === 'for this date' && none.detail.startsWith('MY 37, Ls 120.0°'));
check('too fast: not drawn', () => dustRow({ status: 'fast' }).value === 'Not drawn');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
