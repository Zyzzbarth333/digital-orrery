// src/physics/smallbodies.build.mjs
//
// Builds the small bodies the app draws (public/data/smallbodies.bin and
// smallbodies.json) from the SBDB pages smallbodies.fetch.mjs caches.
//
//   npm run build:smallbodies
//
// Kept: the main belt brighter than H 15, and every near-Earth asteroid,
// Jupiter trojan, centaur, trans-Neptunian object and periodic comet
// (e < 0.995; Pluto is left out, the app has it as a planet). Each orbit is
// carried to one epoch, 2026-01-01 00:00 TT, by two-body motion (the drawn
// orbits are Keplerian, so nothing is lost; a body's real orbit drifts
// from it by the planets' pull, most for the near-Earth asteroids), and
// packed in 16 bytes (smallBodies.js decodes it):
//   a (au, float32), e (uint16, x 65535), i, node, peri, M (uint16, x 65535
//   / 2 pi: 0.0055 deg), H (uint8, (H + 2) x 7: H -2 to 34.4 in 0.14 mag
//   steps; a comet's M1), and a byte of class (bits 0-4, SB_CLASSES) and,
//   for a comet, its K1 (bits 5-7, the nearest of SB_K1). A body with no
//   magnitude gets H 18, faint.
// The named ones (dwarf planets, mission targets, famous comets; NOTABLE in
// smallBodies.js, by designation) go to the JSON at full precision, for
// labels.

import fs from 'node:fs';
import { GROUPS, CACHE } from './smallbodies.fetch.mjs';
import { SB_CLASSES, SB_EPOCH_JD, SB_K1, NOTABLE } from './smallBodies.js';

const K = 0.01720209895;                     // Gaussian gravitational constant, rad/day (au, solar masses)
const D2R = Math.PI / 180, TAU = 2 * Math.PI;
const wrap = (x) => ((x % TAU) + TAU) % TAU;

// The named bodies' elements at the epoch, from Horizons
// (smallbodies.horizons.mjs): SBDB's solutions for some are years old.
const FRESH = JSON.parse(fs.readFileSync(new URL('./fixtures/smallbodies_named.json', import.meta.url))).elements;

const rows = [];
for (const g of GROUPS) {
  const files = fs.readdirSync(CACHE).filter((f) => f.startsWith(g.key + '_')).sort();
  for (const f of files) {
    const { fields, data } = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8'));
    const ix = Object.fromEntries(fields.map((n, i) => [n, i]));
    for (const d of data) rows.push({ group: g.key, d, ix });
  }
}
console.log(`${rows.length} rows read`);

const kept = [], named = [];
let skipped = 0;
for (const { group, d, ix } of rows) {
  const num = (k) => (d[ix[k]] === null || d[ix[k]] === undefined ? NaN : Number(d[ix[k]]));
  const spkid = String(d[ix.spkid]), pdes = String(d[ix.pdes]), cls = d[ix.class];
  if (pdes === '134340') { skipped++; continue; }            // Pluto: a planet in the app
  const e = num('e'), i = num('i') * D2R, node = num('om') * D2R, peri = num('w') * D2R, epoch = num('epoch');
  let a, M0, H, k1 = 0;
  if (group === 'comets') {
    const q = num('q'), tp = num('tp');
    if (!(e < 0.995) || !(q > 0)) { skipped++; continue; }
    a = q / (1 - e);
    M0 = K / Math.pow(a, 1.5) * (epoch - tp);               // mean anomaly at the epoch from perihelion time
    H = num('M1');
    // Its K1 (total magnitude's slope with log r), as the nearest of SB_K1;
    // 10 when SBDB has none.
    const K1 = Number.isFinite(num('K1')) ? num('K1') : 10;
    k1 = SB_K1.reduce((best, v, j) => (Math.abs(v - K1) < Math.abs(SB_K1[best] - K1) ? j : best), 0);
  } else {
    a = num('a'); M0 = num('ma') * D2R; H = num('H');
  }
  if (group === 'mainbelt' && !(H <= 15)) continue;
  if (![a, e, i, node, peri, M0, epoch].every(Number.isFinite) || !(a > 0) || !(e >= 0 && e < 0.995)) { skipped++; continue; }
  const n = K / Math.pow(a, 1.5);
  let M = wrap(M0 + n * (SB_EPOCH_JD - epoch));
  const fresh = FRESH[pdes];
  if (fresh) { a = fresh.a; M = wrap(fresh.M); }
  const code = SB_CLASSES.indexOf(cls) >= 0 ? SB_CLASSES.indexOf(cls) : SB_CLASSES.indexOf(group === 'comets' ? 'COM' : 'AST');
  const el = fresh ? { a, e: fresh.e, i: fresh.i, node: fresh.node, peri: fresh.peri, M } : { a, e, i, node, peri, M };
  kept.push({ ...el, H: Number.isFinite(H) ? H : 18, code, k1 });
  const label = NOTABLE[pdes];
  if (label) named.push({ pdes, spkid, name: label.name ?? (d[ix.name] || d[ix.pdes]), kind: label.kind, cls, ...el, H: Number.isFinite(H) ? H : null, diameter: num('diameter') || null, epochJd: SB_EPOCH_JD, elements: fresh ? 'JPL Horizons at the epoch' : 'SBDB' });
}

const buf = Buffer.alloc(kept.length * 16), u16 = (x) => Math.max(0, Math.min(65535, Math.round(x)));
kept.forEach((k, j) => {
  const o = j * 16;
  buf.writeFloatLE(k.a, o);
  buf.writeUInt16LE(u16(k.e * 65535), o + 4);
  buf.writeUInt16LE(u16(wrap(k.i) / TAU * 65535), o + 6);
  buf.writeUInt16LE(u16(wrap(k.node) / TAU * 65535), o + 8);
  buf.writeUInt16LE(u16(wrap(k.peri) / TAU * 65535), o + 10);
  buf.writeUInt16LE(u16(k.M / TAU * 65535), o + 12);
  buf.writeUInt8(Math.max(0, Math.min(255, Math.round((k.H + 2) * 7))), o + 14);
  buf.writeUInt8(k.code | (k.k1 << 5), o + 15);
});
fs.mkdirSync(new URL('../../public/data/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../../public/data/smallbodies.bin', import.meta.url), buf);
const counts = {};
for (const k of kept) counts[SB_CLASSES[k.code]] = (counts[SB_CLASSES[k.code]] ?? 0) + 1;
const missing = Object.keys(NOTABLE).filter((s) => !named.some((n) => n.pdes === s));
fs.writeFileSync(new URL('../../public/data/smallbodies.json', import.meta.url), JSON.stringify({
  source: 'JPL Small-Body Database query API (ssd-api.jpl.nasa.gov/sbdb_query.api), fetched ' + new Date(fs.statSync(CACHE).mtimeMs).toISOString().slice(0, 10),
  epochJd: SB_EPOCH_JD, count: kept.length, classes: SB_CLASSES, counts, named,
}));
console.log(`kept ${kept.length} (skipped ${skipped}): ${JSON.stringify(counts)}`);
console.log(`named ${named.length}${missing.length ? `; not found: ${missing.map((s) => NOTABLE[s].name).join(', ')}` : ''}`);
console.log(`smallbodies.bin ${(buf.length / 1e6).toFixed(2)} MB`);
