// src/scene/sky.test.mjs: the interactive sky's rules (skyCatalogue.ts) and,
// where public/sky/ has been fetched (npm run data), its files.
//
// - the distance a parallax gives: a value only at plx/err >= 5, else a
//   range, else a least distance; none without a parallax;
// - Bayer and Flamsteed labels and the names FIND matches;
// - the pick: the brightest for its distance within the circle, not a
//   fainter star nearer the pointer, and nothing outside it;
// - the star plate's RA and Dec formats;
// - the catalogue files decode, and Betelgeuse is HIP 27989, alpha and 58
//   Ori, HR 2061, HD 39801, M2Ib, 7.63 +- 1.64 mas.
//
// They are TypeScript, so Vite's module runner loads them.
//
//   node src/scene/sky.test.mjs

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const load = async (id) => (await runnerImport(id, { root, configFile: false, logLevel: 'error' })).module;
const { distanceOf, bayerLabel, flamsteedLabel, starTitle, searchNames, choose, drawn, decodeInfo, nameOf, bvToKelvin } = await load('/src/scene/skyCatalogue.ts');
const { fmtRa, fmtDec, distanceRow } = await load('/src/app/star-plate.tsx');

let passed = 0, failed = 0;
function check(name, fn) {
  let ok;
  try { ok = fn(); } catch (err) { ok = false; console.log(`        threw ${err}`); }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) passed++; else failed++;
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

check('a good parallax gives one distance, with its error', () => {
  const d = distanceOf(100, 1);           // 10 pc
  return d.kind === 'value' && near(d.pc, 10, 1e-9) && near(d.errPc, 0.1, 1e-9);
});
check('plx/err just under 5 gives a range, not a value', () => {
  const d = distanceOf(7.63, 1.64);       // Betelgeuse in Hipparcos 1997: 4.65 sigma
  return d.kind === 'range' && near(d.minPc, 1000 / 9.27, 1e-6) && near(d.maxPc, 1000 / 5.99, 1e-6);
});
check('a parallax within its error of zero gives only a least distance', () => {
  const a = distanceOf(0.5, 1.2), b = distanceOf(-0.8, 1.0);
  return a.kind === 'beyond' && near(a.minPc, 1000 / 1.7, 1e-6) && b.kind === 'beyond' && near(b.minPc, 1000 / 0.2, 1e-6);
});
check('no parallax gives none', () => distanceOf(NaN, NaN).kind === 'none' && distanceOf(3, 0).kind === 'none');
check('the distance row never shows a bare 1/plx of a noisy parallax', () => {
  const r = distanceRow(distanceOf(7.63, 1.64));
  return r.value.includes(' to ') && !r.value.includes('±');
});

const betel = nameOf([4506, 'Betelgeuse', 'alp', null, 58, 2061, 'Ori']);
const alpCen = nameOf([1, null, 'alp', 1, null, 5459, 'Cen']);
check('Bayer and Flamsteed labels', () => bayerLabel(betel) === 'α Ori' && flamsteedLabel(betel) === '58 Ori' && bayerLabel(alpCen) === 'α¹ Cen');
check('a star is called by its IAU name, else its designations, else HIP', () =>
  starTitle(betel, 27989) === 'Betelgeuse' && starTitle(alpCen, 71683) === 'α¹ Cen'
  && starTitle(nameOf([2, null, null, null, null, 9, 'And']), 3) === 'HR 9' && starTitle(undefined, 12345) === 'HIP 12345');
check('FIND matches every way of writing a Bayer designation', () => {
  const n = searchNames(betel, 27989, 39801, (a) => (a === 'Ori' ? 'Orionis' : undefined));
  return ['Betelgeuse', 'α Ori', 'alpha Ori', 'alf Ori', 'alpha Orionis', '58 Ori', '58 Orionis', 'HR 2061', 'HD 39801', 'HIP 27989'].every((s) => n.includes(s));
});
check('FIND writes a superscript as a digit too ("alpha1 Cen")', () =>
  searchNames(alpCen, 71683, 128620, () => 'Centauri').includes('alpha1 Centauri'));

check('the pick takes the brighter star in the circle over a fainter one at the pointer', () =>
  choose([{ index: 1, mag: 5, dPx: 0 }, { index: 2, mag: 2, dPx: 7 }], 8) === 2);
check('but a star at the pointer wins over one a magnitude brighter at the edge', () =>
  choose([{ index: 1, mag: 4, dPx: 0 }, { index: 2, mag: 3, dPx: 8 }], 8) === 1);
check('nothing outside the circle is picked', () => choose([{ index: 1, mag: -1, dPx: 8.5 }], 8) === null && choose([], 8) === null);
check('a star the point layer does not draw cannot be picked', () =>
  drawn(9, 30, 1, 1) && !drawn(9, 30, 1, 0.01) && !drawn(11, 30, 1, 1));
check('B-V 0.65 is about the Sun\'s temperature', () => near(bvToKelvin(0.65), 5800, 150));

check('RA and Dec read as an atlas gives them', () =>
  fmtRa(88.79293899) === '05h 55m 10.31s' && fmtDec(7.40706399) === '+07° 24′ 25.4″' && fmtDec(-0.5) === '−00° 30′ 00.0″' && fmtRa(359.99999) === '00h 00m 00.00s');

const sky = `${root}public/sky`;
if (existsSync(`${sky}/stars-info.bin`)) {
  const b = readFileSync(`${sky}/stars-info.bin`);
  const info = decodeInfo(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const names = JSON.parse(readFileSync(`${sky}/names.json`, 'utf8')).stars.map(nameOf);
  const cons = JSON.parse(readFileSync(`${sky}/constellations.json`, 'utf8')).constellations;
  const pts = readFileSync(`${root}public/textures/stars/hipparcos.bin`).length / 10;
  check('stars-info.bin has a row for every star of the point layer', () => info.n === pts && info.n === 83392);
  const i = info.hip.indexOf(27989);
  const bn = names.find((n) => n.index === i);
  check('Betelgeuse decodes as the catalogues give it', () =>
    i >= 0 && info.hd[i] === 39801 && info.spTypes[info.sp[i]] === 'M2Ib' && near(info.plx[i], 7.63, 1e-4) && near(info.plxErr[i], 1.64, 1e-4)
    && near(info.ra[i], 88.7929, 1e-3) && near(info.dec[i], 7.4071, 1e-3)
    && bn?.iau === 'Betelgeuse' && bayerLabel(bn) === 'α Ori' && bn.flam === 58 && bn.hr === 2061);
  check('88 constellations, each with lines between stars of the layer', () =>
    cons.length === 88 && cons.every((c) => c.lines.length > 0 && c.lines.every(([a, b]) => a >= 0 && b < pts && a !== b)));
  check('Orion\'s lines join Betelgeuse', () => cons.find((c) => c.abbr === 'Ori').lines.some(([a, b]) => a === i || b === i));
} else {
  console.log('  (public/sky/ not fetched: the catalogue checks are skipped; npm run data)');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
