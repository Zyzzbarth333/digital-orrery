// src/chart/chart.test.mjs: the chart view's sheet grids, projections and
// elevation files (docs/frontend/chart.md).
//
// - Sheets: known places on their known sheets (Apollo 11 on LAC 60, Jezero
//   on MC-13, Caloris on H-4, Maat Mons on V-26), every set's count, and the
//   sheets of each set tiling the sphere once.
// - Projections: forward and inverse agree everywhere, and the polar views
//   put longitude 0 down the page from the north pole, up it from the south,
//   with east anticlockwise round the north pole.
// - Elevation: the decoder undoes the pipeline's predictor and zigzag
//   (a JavaScript copy of the encoder here), and, where public/charts is
//   fetched, the grids are the right way round: Olympus Mons and Hellas,
//   Everest and the Challenger Deep, Maxwell Montes, the South Pole-Aitken
//   basin are where they should be.
//
// TypeScript, so Vite's module runner loads them.
//
//   node src/chart/chart.test.mjs

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const load = async (id) => (await runnerImport(id, { root, configFile: false, logLevel: 'error' })).module;
const { SHEET_SETS, sheetAt, allSheets } = await load('/src/chart/sheets.ts');
const { forward, inverse } = await load('/src/chart/projection.ts');
const { unpredict, decodeGrid, sampleGrid, NODATA } = await load('/src/chart/elevation.ts');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}: ${e.message}`); }
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg ?? ''} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); };
const near = (a, b, tol, msg) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${msg ?? ''} ${a} vs ${b} (tol ${tol})`); };
const D = Math.PI / 180;

console.log('sheet grids');
await check('known places on their sheets', () => {
  const at = (body, lat, lon) => sheetAt(SHEET_SETS[body], lat, lon)?.code;
  eq(at('moon', 0.67416, 23.47314), 'LAC-60', 'Apollo 11');
  eq(at('moon', 9.62, -20.08), 'LAC-58', 'Copernicus');
  eq(at('moon', -43.3, -11.2), 'LAC-112', 'Tycho');
  eq(at('moon', 89.5, 10), 'LAC-1', 'north pole');
  eq(at('mars', 18.4, 77.5), 'MC-13', 'Jezero');
  eq(at('mars', 18.65, -133.8), 'MC-9', 'Olympus Mons');
  eq(at('mars', -42.4, 70.5), 'MC-28', 'Hellas');
  eq(at('mercury', 31.6, 162.0), 'H-4', 'Caloris Planitia');
  eq(at('mercury', -11.3, -31.3), 'H-6', 'Kuiper');
  eq(at('mercury', 57.8, 16.6), 'H-5', 'Hokusai');
  eq(at('venus', 0.5, 194.6 - 360), 'V-26', 'Maat Mons');
  eq(at('venus', 65.2, 3.3), 'V-2', 'Maxwell Montes');
});
await check('each set has its sheets once, tiling the sphere', () => {
  for (const [body, n] of [['mars', 30], ['mercury', 15], ['venus', 62], ['moon', 144]]) {
    const s = allSheets(SHEET_SETS[body]);
    eq(s.length, n, `${body} count`);
    eq(s.map((x) => x.n).join(), Array.from({ length: n }, (_, i) => i + 1).join(), `${body} numbers`);
    // Area on the unit sphere: (east - west) * (sin north - sin south).
    const area = s.reduce((a, x) => a + (x.east - x.west) * D * (Math.sin(x.north * D) - Math.sin(x.south * D)), 0);
    near(area, 4 * Math.PI, 1e-9, `${body} area`);
    for (const x of s) if (!x.polar) eq(sheetAt(SHEET_SETS[body], (x.north + x.south) / 2, (x.east + x.west) / 2).n, x.n, `${body} centre of ${x.code}`);
  }
});

console.log('projections');
await check('forward and inverse agree', () => {
  for (const proj of ['eq', 'n', 's']) {
    const v = { proj, lon0: 0.7, lat0: proj === 'eq' ? 0.2 : 0, px: 13, py: -21, scale: 300, w: 900, h: 600 };
    for (let k = 0; k < 400; k++) {
      const lat = (proj === 'n' ? 10 + 79 * Math.random() : proj === 's' ? -10 - 79 * Math.random() : -89 + 178 * Math.random()) * D;
      const lon = (-180 + 360 * Math.random()) * D;
      const [x, y] = forward(v, lat, lon);
      const back = inverse(v, x, y);
      near(back[0], lat, 1e-9, `${proj} lat`);
      near(Math.cos(back[1] - lon), 1, 1e-12, `${proj} lon`);
    }
  }
});
await check('polar views: 0 deg down from the north pole, up from the south; east anticlockwise round the north', () => {
  const n = { proj: 'n', lon0: 0, lat0: 0, px: 0, py: 0, scale: 100, w: 200, h: 200 };
  const [, y0] = forward(n, 80 * D, 0);
  if (!(y0 > 100)) throw new Error('north: lon 0 not below the pole');
  const [x90] = forward(n, 80 * D, 90 * D);
  if (!(x90 > 100)) throw new Error('north: 90 E not to the right');
  const s = { ...n, proj: 's' };
  const [, ys] = forward(s, -80 * D, 0);
  if (!(ys < 100)) throw new Error('south: lon 0 not above the pole');
  const [xs90] = forward(s, -80 * D, 90 * D);
  if (!(xs90 > 100)) throw new Error('south: 90 E not to the right');
});

console.log('elevation files');
// The pipeline's encoder (python/charts/build_charts.py encode), in JavaScript.
function encode(t, w, h) {
  const n = w * h, out = new Uint8Array(2 * n);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const L = x ? t[i - 1] : 0, U = y ? t[i - w] : 0, UL = x && y ? t[i - w - 1] : 0;
    const r = ((t[i] - (L + U - UL)) << 16) >> 16, z = ((r << 1) ^ (r >> 31)) & 0xffff;
    out[i] = z & 0xff; out[n + i] = z >> 8;
  }
  return gzipSync(out);
}
await check('decoder undoes the encoder, extremes and no data included', async () => {
  const w = 53, h = 37, t = new Int16Array(w * h);
  for (let i = 0; i < t.length; i++) t[i] = Math.round(Math.sin(i * 0.37) * 12000 + (i % 7) * 900);
  t.fill(NODATA, 3 * w, 4 * w); t[100] = 32767; t[101] = -32767;
  const g = await decodeGrid(encode(t, w, h), w, h);
  for (let i = 0; i < t.length; i++) if (g[i] !== t[i]) throw new Error(`at ${i}: ${g[i]} != ${t[i]}`);
  const { gunzip } = await load('/src/chart/elevation.ts');
  const plain = await gunzip(new Uint8Array([1, 2, 3]));
  if (plain.length !== 3) throw new Error('bytes already gunzipped (Content-Encoding) were not passed through');
  let threw = false;
  try { unpredict(new Uint8Array(10), w, h); } catch { threw = true; }
  if (!threw) throw new Error('a short grid was not refused');
});

const charts = `${root}public/charts`;
if (!existsSync(`${charts}/index.json`)) {
  console.log('  skip real-data checks: no public/charts (npm run data)');
} else {
  const index = JSON.parse(readFileSync(`${charts}/index.json`, 'utf8'));
  const grids = {};
  for (const body of ['mars', 'earth', 'venus', 'moon', 'mercury']) {
    const e = index.bodies[body].elevation;
    grids[body] = { e, g: await decodeGrid(readFileSync(`${charts}/${e.base}`), e.baseWidth, e.baseWidth / 2) };
  }
  const at = (body, lat, lon) => { const { e, g } = grids[body]; return sampleGrid((x, y) => g[y * e.baseWidth + x], e.baseWidth, lat * D, lon * D); };
  await check('Mars: Olympus Mons high, Hellas low (MOLA)', () => {
    if (!(at('mars', 18.65, -133.8) > 18000)) throw new Error(`Olympus Mons ${at('mars', 18.65, -133.8)} m`);
    if (!(at('mars', -42.4, 70.5) < -6000)) throw new Error(`Hellas ${at('mars', -42.4, 70.5)} m`);
  });
  await check('Earth: Everest high, the Challenger Deep low (ETOPO 2022)', () => {
    if (!(at('earth', 27.99, 86.93) > 4500)) throw new Error(`Everest ${at('earth', 27.99, 86.93)} m`);
    if (!(at('earth', 11.35, 142.2) < -8000)) throw new Error(`Challenger Deep ${at('earth', 11.35, 142.2)} m`);
  });
  await check('Venus: Maxwell Montes high (Magellan)', () => { if (!(at('venus', 65.2, 3.3) > 7000)) throw new Error(`Maxwell ${at('venus', 65.2, 3.3)} m`); });
  await check('Moon: the South Pole-Aitken basin low, the far-side highlands high (LOLA)', () => {
    if (!(at('moon', -62, -148) < -5000)) throw new Error(`SPA ${at('moon', -62, -148)} m`);
    if (!(at('moon', 5, -158) > 5000)) throw new Error(`Korolev highlands ${at('moon', 5, -158)} m`);
  });
  await check('Mercury: Caloris floor below its rim (MESSENGER)', () => {
    if (!(at('mercury', 31.6, 162.0) < at('mercury', 40, 140))) throw new Error('Caloris not low');
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
