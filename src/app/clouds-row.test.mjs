// src/app/clouds-row.test.mjs: what the Earth's plate says of the clouds
// drawn (clouds-row.ts cloudsRow), and what the clouds layer publishes for
// it (clouds.ts drawnInfo, gibsCredit), down to a load where GIBS gave no
// day any of the globe: the plate once read the newest day of an empty
// list and the app came down.
//
// They are TypeScript, so Vite's module runner loads them.
//
//   node src/app/clouds-row.test.mjs

import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const load = async (id) => (await runnerImport(id, { root, configFile: false, logLevel: 'error' })).module;
const { cloudsRow } = await load('/src/app/clouds-row.ts');
const { drawnInfo, gibsCredit, GEO_LAYERS } = await load('/src/scene/clouds.ts');

let passed = 0, failed = 0;
function check(name, fn) {
  let ok;
  try { ok = fn(); } catch (err) { ok = false; console.log(`        threw ${err}`); }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) passed++; else failed++;
}
const texts = (row) => [row.value, row.alt ?? '', row.detail ?? ''].join(' | ');

const LAYER = 'VIIRS_NOAA21_CorrectedReflectance_TrueColor';
const DAYS = ['2026-11-10', '2026-11-09', '2026-11-08'];
const FRAME = '2026-11-10T14:20:00Z';

console.log('drawnInfo: what a load drew');
check('three days with a share each are drawn newest first', () => {
  const info = drawnInfo(LAYER, [], null, DAYS, [0.41, 0.3, 0.1]);
  return info.geo === null && info.days.map((d) => d.day).join(' ') === DAYS.join(' ') && info.days[0].share === 0.41;
});
check('a day that gave none of the globe is left out', () => {
  const info = drawnInfo(LAYER, [], null, DAYS, [0.41, 0, 0.1]);
  return info.days.map((d) => d.day).join(' ') === '2026-11-10 2026-11-08';
});
check('without the worker (no shares) only the newest day, share unknown', () => {
  const info = drawnInfo(LAYER, GEO_LAYERS, FRAME, DAYS);
  return info.geo === null && info.days.length === 1 && info.days[0].day === DAYS[0] && Number.isNaN(info.days[0].share);
});
check('no day and no frame gave any of the globe: nothing is published as drawn', () =>
  drawnInfo(LAYER, [], null, DAYS, [0, 0, 0]) === null);
check('the same with the GOES frames asked for and none of them drawn either', () =>
  drawnInfo(LAYER, GEO_LAYERS, FRAME, DAYS, [0, 0, 0, 0, 0]) === null);
check('GOES drawn but no day: the frame, and no days', () => {
  const info = drawnInfo(LAYER, GEO_LAYERS, FRAME, DAYS, [0.2, 0.15, 0, 0, 0]);
  return info.geo?.time === FRAME && info.geo.parts.length === 2 && info.days.length === 0;
});

console.log('gibsCredit: the credit line');
check('days drawn: the layer and the days', () =>
  gibsCredit(drawnInfo(LAYER, [], null, DAYS, [0.41, 0.3, 0])) === 'VIIRS NOAA21 CorrectedReflectance TrueColor, 2026-11-10 over 2026-11-09: NASA GIBS / EOSDIS');
check('GOES only: the frame, no empty list of days', () => {
  const c = gibsCredit(drawnInfo(LAYER, GEO_LAYERS, FRAME, DAYS, [0.2, 0.15, 0, 0, 0]));
  return c === 'GOES-East and GOES-West GeoColor 2026-11-10 14:20 UTC: NASA GIBS / EOSDIS';
});

console.log('cloudsRow: the Earth plate\'s Clouds row');
check('a day drawn: the row gives that day', () => {
  const row = cloudsRow({ layer: LAYER, geo: null, days: [{ day: '2026-11-10', share: 0.84 }] });
  return row?.label === 'Clouds' && row.value === '2026-11-10' && row.alt === 'that day, not live';
});
check('three days: the newest, the others under it, each one\'s share', () => {
  const row = cloudsRow({ layer: LAYER, geo: null, days: [{ day: '2026-11-10', share: 0.41 }, { day: '2026-11-09', share: 0.3 }, { day: '2026-11-08', share: 0.1 }] });
  return row?.value === '2026-11-10' && row.alt === 'newest pass; 11-09, 11-08 under it' && row.detail.includes('2026-11-10 41 %, 2026-11-09 30 %, 2026-11-08 10 % of the globe');
});
check('no days and no frame: no Clouds row, and no throw', () =>
  cloudsRow({ layer: LAYER, geo: null, days: [] }) === null);
check('GOES frame but no days: the frame\'s row, nothing said of a day', () => {
  const row = cloudsRow({ layer: LAYER, geo: { time: FRAME, parts: [{ name: 'GOES-East', share: 0.2 }] }, days: [] });
  return row?.value === '14:20 UTC' && row.alt === '2026-11-10, GOES' && !/undefined|elsewhere/i.test(texts(row)) && row.detail.startsWith('GOES-East 20 % of the globe');
});
check('GOES frame over days: the frame, and the days elsewhere', () => {
  const row = cloudsRow({ layer: LAYER, geo: { time: FRAME, parts: [{ name: 'GOES-East', share: 0.2 }] }, days: [{ day: '2026-11-10', share: 0.4 }] });
  return row?.alt === '2026-11-10, GOES; elsewhere 11-10' && row.detail.includes('Elsewhere VIIRS NOAA-21') && row.detail.includes('2026-11-10 40 % of the globe');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
