// src/physics/pck.build.mjs
//
// Writes src/physics/pck.data.js from NAIF's text PCK pck00011_n0066.tpc
// (the IAU WGCCRE 2015 report's constants as NAIF keeps them; the kernel
// is not in the repo, python/README.md says where to get it):
//
//   npm run build:pck            (or: node src/physics/pck.build.mjs [path/to/pck00011_n0066.tpc])
//
// - RADII: the triaxial ellipsoid (a, b, c) of every body the scene draws
//   that has one, km along its body-fixed X (0 deg longitude), Y and Z
//   (north pole). Uranus's irregular moons, Naiad and Pluto's small moons
//   have none: the scene draws them as spheres of their Horizons radius.
// - ROTATION: the IAU pole and prime meridian of every moon that has one,
//   with its nutation-precession (libration) terms, and the angles those
//   terms are of (BODYn_NUT_PREC_ANGLES of each system). The others turn
//   with their orbits (orientation.js).
//
// Only \begindata blocks are read, and a later assignment replaces an
// earlier one, as SPICE's pool does. mars_konopliv_2026_n0066_v1.tpc,
// which the CSPICE reference loads after this kernel, repeats Phobos's and
// Deimos's models and Mars's first 15 angles unchanged.

import fs from 'node:fs';
import { MOON_DATA } from './moons.data.js';

const SRC = process.argv[2] ?? new URL('../../python/data/kernels/pck/pck00011_n0066.tpc', import.meta.url).pathname;
const OUT = new URL('./pck.data.js', import.meta.url);

export function parseTextKernel(text) {
  const pool = {};
  let data = false;
  let body = '';
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '\\begindata') { data = true; continue; }
    if (t === '\\begintext') { data = false; continue; }
    if (data) body += line + '\n';
  }
  // NAME = value | NAME = ( v v v ) | NAME += ( ... ); numbers only (strings skipped).
  const re = /([A-Za-z0-9_]+)\s*(\+?=)\s*(\([^)]*\)|'[^']*'|[^\s()]+)/g;
  for (const m of body.matchAll(re)) {
    const [, name, op, raw] = m;
    if (raw.startsWith("'") || raw.includes("'")) continue;
    const vals = raw.replace(/[()]/g, ' ').split(/[\s,]+/).filter(Boolean).map((s) => Number(s.replace(/[dD]/, 'e')));
    if (vals.some((v) => !Number.isFinite(v))) throw new Error(`pck: bad value in ${name}`);
    const key = name.toUpperCase();
    pool[key] = op === '+=' && pool[key] ? pool[key].concat(vals) : vals;
  }
  return pool;
}

// The bodies the scene draws, by NAIF id.
const BODY_IDS = { sun: 10, mercury: 199, venus: 299, earth: 399, moon: 301, mars: 499, jupiter: 599,
  saturn: 699, uranus: 799, neptune: 899, pluto: 999 };
for (const [k, m] of Object.entries(MOON_DATA)) BODY_IDS[k] = m.naif;

function main() {
  const pool = parseTextKernel(fs.readFileSync(SRC, 'utf8'));
  const need = (n) => { if (!pool[n]) throw new Error(`pck: ${n} missing`); return pool[n]; };
  const radii = {};
  for (const [k, id] of Object.entries(BODY_IDS)) {
    if (pool[`BODY${id}_RADII`]) radii[k] = pool[`BODY${id}_RADII`];
    else if (!MOON_DATA[k]) need(`BODY${id}_RADII`);
  }
  const rotation = {};
  const systems = new Set();
  const trim = (a) => { let n = a.length; while (n > 0 && a[n - 1] === 0) n--; return a.slice(0, n); };
  for (const [k, m] of Object.entries(MOON_DATA)) {
    const id = m.naif;
    if (!pool[`BODY${id}_POLE_RA`]) continue;
    const r = { ra: need(`BODY${id}_POLE_RA`), dec: need(`BODY${id}_POLE_DEC`), pm: need(`BODY${id}_PM`) };
    const nr = trim(pool[`BODY${id}_NUT_PREC_RA`] ?? []), nd = trim(pool[`BODY${id}_NUT_PREC_DEC`] ?? []), np = trim(pool[`BODY${id}_NUT_PREC_PM`] ?? []);
    if (nr.length || nd.length || np.length) {
      Object.assign(r, { nutRa: nr, nutDec: nd, nutPm: np, system: Math.floor(id / 100) });
      systems.add(Math.floor(id / 100));
    }
    rotation[k] = r;
  }
  // Each system's angles: (A_j + B_j T [+ C_j T^2 ...]) deg, T in Julian
  // centuries TDB; MAX_PHASE_DEGREE (default 1) sets the terms per angle.
  const angles = {};
  for (const s of [...systems].sort()) {
    const flat = need(`BODY${s}_NUT_PREC_ANGLES`);
    const per = (pool[`BODY${s}_MAX_PHASE_DEGREE`]?.[0] ?? 1) + 1;
    const used = Math.max(...Object.values(rotation).filter((r) => r.system === s).map((r) => Math.max(r.nutRa.length, r.nutDec.length, r.nutPm.length)));
    angles[s] = [];
    for (let j = 0; j < used; j++) angles[s].push(flat.slice(per * j, per * j + per));
  }
  const fmt = (o) => JSON.stringify(o).replace(/"([a-z][A-Za-z]*|\d+)":/g, '$1: ');
  const lines = [
    '// src/physics/pck.data.js (written by pck.build.mjs; do not edit)',
    '//',
    `// Source: NAIF, ${SRC.split('/').pop()} (IAU WGCCRE 2015 report, Archinal et al. 2018,`,
    '// with its later corrections). RADII: km along body-fixed X, Y, Z. Rotation:',
    '// RA, Dec (deg; deg per Julian century T), PM W (deg; deg per day d, per day^2),',
    '// nutation-precession coefficients (deg) of the system\'s angles (deg; per T).',
    '',
    `export const RADII = {\n${Object.entries(radii).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')}\n};`,
    '',
    `export const ROTATION = {\n${Object.entries(rotation).map(([k, v]) => `  ${k}: ${fmt(v)},`).join('\n')}\n};`,
    '',
    `export const NUT_PREC_ANGLES = {\n${Object.entries(angles).map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`).join('\n')}\n};`,
    '',
  ];
  fs.writeFileSync(OUT, lines.join('\n'));
  console.log(`wrote ${OUT.pathname}: ${Object.keys(radii).length} ellipsoids, ${Object.keys(rotation).length} rotation models`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
