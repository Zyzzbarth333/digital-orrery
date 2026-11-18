// src/physics/irregularMoons.fetch.mjs
//
// The data behind the irregular moons of Jupiter, Saturn and Neptune
// (irregularMoons.js), fetched once and committed:
// - irregularMoons.data.js: for each moon, its row of JPL's planetary
//   satellite mean elements (https://ssd.jpl.nasa.gov/sats/elem/), the
//   fallback outside the tables (and for the moons whose kernel is not
//   used here); its radius, GM and geometric albedo from its JPL Horizons
//   object page; its discovery from JPL's satellite discovery circumstances
//   (https://ssd.jpl.nasa.gov/sats/discovery.html); and corrections to the
//   elements' mean anomaly, its rate, the periapsis and the node, fitted to
//   Horizons vectors every 10 days from 2000 to 2050, as moons.fetch.mjs
//   does for the other moons (docs/frontend/moons.md#the-irregular-moons);
// - fixtures/irregular_moons_horizons.json: Horizons planetocentric ICRF
//   vectors of each moon at five dates from 2000 to 2049, not used in the
//   fit, to check the model against (irregularMoons.test.mjs).
//
// Raw downloads are kept under ~/.cache/digital-orrery/moons (not
// committed); delete a moon's files there to fetch it afresh.
//
//   npm run fetch:irregular-moons

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';
import { elementState } from './moons.js';

dns.setDefaultResultOrder('ipv4first');
const CACHE = path.join(os.homedir(), '.cache', 'digital-orrery', 'moons');
fs.mkdirSync(path.join(CACHE, 'horizons'), { recursive: true });
const ELEM_URL = 'https://ssd.jpl.nasa.gov/sats/elem/';
const DISC_URL = 'https://ssd.jpl.nasa.gov/sats/discovery.html';
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const UA = { 'User-Agent': 'digital-orrery data fetch' };
const PLANETS = { Jupiter: ['jupiter', 599], Saturn: ['saturn', 699], Neptune: ['neptune', 899] };
// The irregular moons already drawn as full moons (moons.data.js).
const ALREADY = new Set([802]);
// A moon with no measured size is drawn at this radius, and says so: the
// smallest found are 1 to 4 km across.
const NOMINAL_RADIUS_KM = 1.5;
// Check dates (TDB), not used in the fit.
const CHECKS = ['2000-01-02', '2013-07-01', '2026-11-18', '2040-01-01', '2049-12-01'];
const fetched = new Date().toISOString().slice(0, 10);

async function cached(name, url) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  for (let tries = 0; ; tries++) {
    try {
      const res = await fetch(url, { headers: UA });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      fs.writeFileSync(file, text);
      await new Promise((r) => setTimeout(r, 300));
      return text;
    } catch (err) {
      if (tries >= 3) throw err;
      await new Promise((r) => setTimeout(r, 5000 * (tries + 1)));
    }
  }
}
const horizons = (name, q) => cached(path.join('horizons', name),
  `${API}?${Object.entries({ format: 'text', ...q }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`);

function cells(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<(tr|td|th|br|p|h\d|li|div)[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .split('\n').map((s) => s.trim()).filter(Boolean);
}
const num = (s) => (s === '-' || s === undefined ? null : Number(s));

// "S2003_J_2", "S2003_J2", "S/2003 J2" -> "S/2003 J 2"; a name as it is.
// JPL's table spells Megaclite "Magaclite" and cuts Philophrosyne short.
const FIX_NAME = { Magaclite: 'Megaclite', Philophrosyn: 'Philophrosyne' };
function shownName(row) {
  const m = row.replace(/\s/g, '').match(/^S\/?(\d{4})_?([JSN])_?(\d+)$/);
  return m ? `S/${m[1]} ${m[2]} ${m[3]}` : FIX_NAME[row] ?? row;
}
const keyOf = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Radius, GM and geometric albedo from a Horizons header (as moons.fetch.mjs).
function parseHeader(text) {
  const rad = text.match(/Radi(?:us \(km[^)]*\)[^=\n]*=|i \(IAU ?2015\):)\s*~?\s*([\d.]+)\s*(?:x\s*([\d.]+)\s*x\s*([\d.]+))?/i);
  const approx = /Radius \(km\)\s*=\s*~/i.test(text);
  const radiusKm = !rad ? NOMINAL_RADIUS_KM : rad[2] ? Math.cbrt(Number(rad[1]) * Number(rad[2]) * Number(rad[3])) : Number(rad[1]);
  const radiusNote = !rad ? `not measured; drawn at a nominal ${NOMINAL_RADIUS_KM} km`
    : rad[2] ? `volume-equivalent of ${rad[1]} x ${rad[2]} x ${rad[3]}` : approx ? 'approximate' : undefined;
  const gmM = text.match(/GM\s*\(km\^3\/s\^2\)\s*=\s*([\d.]+)/);
  const alb = text.match(/Geometric Albedo\s*=\s*([\d.]+)/i);
  return { radiusKm: Number(radiusKm.toFixed(2)), radiusNote, gm: gmM ? Number(gmM[1]) : null, gmNote: gmM ? undefined : 'not measured',
    geometricAlbedo: alb ? Number(alb[1]) : null };
}
function vectors(text) {
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0) throw new Error(`no vectors:\n${text.slice(-600)}`);
  return text.slice(i0 + 5, i1).trim().split('\n').map((l) => {
    const f = l.split(',').map((s) => s.trim());
    return [Number(f[0]), Number(Number(f[2]).toFixed(1)), Number(Number(f[3]).toFixed(1)), Number(Number(f[4]).toFixed(1))];
  });
}
const VEC = { EPHEM_TYPE: "'VECTORS'", REF_PLANE: "'FRAME'", REF_SYSTEM: "'ICRF'", VEC_TABLE: "'1'", OUT_UNITS: "'KM-S'", CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'TDB'" };

// The discovery table: name, provisional designation, year, discoverers,
// reference.
const disc = new Map();
{
  const html = await cached('discovery.html', DISC_URL);
  for (const r of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []) {
    const c = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim());
    if (c.length !== 6) continue;
    const d = { year: c[3], by: c[4], ref: c[5] };
    if (c[1]) disc.set(norm(c[1]), d);
    for (const des of c[2].split('=')) if (des.trim()) disc.set(norm(des), d);
  }
}

// The elements table's irregular rows (the ecliptic frame) for the three
// planets.
const c = cells(await cached('elem.html', ELEM_URL));
const rows = [];
for (let k = 0; k < c.length - 15; k++) {
  if (!(c[k] in PLANETS) || !/^\d+$/.test(c[k + 2]) || c[k + 4] !== 'ecliptic') continue;
  const naif = Number(c[k + 2]);
  if (ALREADY.has(naif)) continue;
  rows.push({ planetRow: c[k], rowName: c[k + 1], naif, ephemeris: c[k + 3], frame: 'ecliptic', epoch: c[k + 5],
    a: num(c[k + 6]), e: num(c[k + 7]), w: num(c[k + 8]), M: num(c[k + 9]), i: num(c[k + 10]), node: num(c[k + 11]),
    P: num(c[k + 12]), Papsis: num(c[k + 13]), Pnode: num(c[k + 14]) });
}
console.log(`${rows.length} irregular moons in the elements table`);

const moons = {};
const checks = { source: 'JPL Horizons API: planetocentric (500@x99) ICRF vectors in km, TDB; JD TDB, x, y, z', fetched, dates: CHECKS, moons: {} };
const dense = {};
// Four moons at a time (Horizons answers each in a second or two).
async function fetchMoon(row) {
  const [planet, centre] = PLANETS[row.planetRow];
  const name = shownName(row.rowName), key = keyOf(name);
  const d = disc.get(norm(name)) ?? disc.get(norm(row.rowName));
  if (!d) console.warn(`${name}: no discovery row`);
  const hdr = await horizons(`hdr_${row.naif}.txt`, { COMMAND: `'${row.naif}'`, OBJ_DATA: "'YES'", MAKE_EPHEM: "'NO'" });
  // Horizons must know it as a moon of this planet (55524 there is an asteroid).
  if (!new RegExp(`/ \\(${row.planetRow}\\)`).test(hdr)) { console.warn(`${name} (${row.naif}): not a ${row.planetRow} moon in Horizons, left out`); return null; }
  const q = { ...VEC, COMMAND: `'${row.naif}'`, CENTER: `'500@${centre}'` };
  const chk = vectors(await horizons(`irrchk_${row.naif}.txt`, { ...q, TLIST: CHECKS.map((s) => `'${s}'`).join(' '), TLIST_TYPE: "'CAL'" }));
  const dn = vectors(await horizons(`irr10d_${row.naif}.txt`, { ...q, START_TIME: "'2000-01-01'", STOP_TIME: "'2050-01-01'", STEP_SIZE: "'10 d'" }));
  const { planetRow, rowName, ...el } = row;
  process.stdout.write('.');
  return { key, chk, dn, moon: { name, planet, ...el, kernel: row.ephemeris.toLowerCase(), retrograde: row.i > 90, ...parseHeader(hdr),
    discovery: d ? { year: d.year, by: d.by, ref: d.ref } : null } };
}
const got = new Array(rows.length);
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => { while (next < rows.length) { const j = next++; got[j] = await fetchMoon(rows[j]); } }));
for (const g of got) {
  if (!g) continue;
  moons[g.key] = g.moon; checks.moons[g.key] = g.chk; dense[g.key] = g.dn;
}
console.log();

// The fit (as moons.fetch.mjs): the along-orbit angle by a line in t, then
// dM, dn, dW and dNode by damped Gauss-Newton on the 10-day samples.
const J2000_JD = 2451545.0;
const errors = (m, rows) => rows.map(([jd, x, y, z]) => { const { r } = elementState(m, jd - J2000_JD); return Math.hypot(r[0] - x, r[1] - y, r[2] - z); });
const rms = (e) => Math.sqrt(e.reduce((a, b) => a + b * b, 0) / e.length);
function fitAlong(m, rows) {
  const ts = [], ds = [];
  let prev = 0;
  for (const [jd, x, y, z] of rows) {
    const t = jd - J2000_JD, { r, h } = elementState(m, t);
    const cr = [r[1] * z - r[2] * y, r[2] * x - r[0] * z, r[0] * y - r[1] * x];
    let dd = Math.atan2(cr[0] * h[0] + cr[1] * h[1] + cr[2] * h[2], r[0] * x + r[1] * y + r[2] * z) * (180 / Math.PI);
    while (dd - prev > 180) dd -= 360;
    while (dd - prev < -180) dd += 360;
    prev = dd;
    ts.push(t); ds.push(dd);
  }
  const n = ts.length, mt = ts.reduce((a, b) => a + b) / n, md = ds.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (ts[k] - mt) * (ds[k] - md); sxx += (ts[k] - mt) ** 2; }
  const slope = sxy / sxx;
  m.fit.dn += slope;
  m.fit.dM += md - slope * mt;
}
const PARAMS = ['dM', 'dn', 'dW', 'dNode'];
const STEP = { dM: 1e-3, dn: 1e-8, dW: 1e-3, dNode: 1e-3 };
function residuals(m, rows) {
  const out = new Float64Array(rows.length * 3);
  rows.forEach(([jd, x, y, z], k) => { const { r } = elementState(m, jd - J2000_JD); out[3 * k] = r[0] - x; out[3 * k + 1] = r[1] - y; out[3 * k + 2] = r[2] - z; });
  return out;
}
function solve(A, b) {
  const n = b.length;
  for (let cc = 0; cc < n; cc++) {
    let p = cc;
    for (let r = cc + 1; r < n; r++) if (Math.abs(A[r][cc]) > Math.abs(A[p][cc])) p = r;
    [A[cc], A[p]] = [A[p], A[cc]]; [b[cc], b[p]] = [b[p], b[cc]];
    for (let r = cc + 1; r < n; r++) { const f = A[r][cc] / A[cc][cc]; for (let k = cc; k < n; k++) A[r][k] -= f * A[cc][k]; b[r] -= f * b[cc]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
function gaussNewton(m, rows) {
  let lambda = 1e-3, res = residuals(m, rows), cost = res.reduce((a, b) => a + b * b, 0);
  for (let it = 0; it < 30; it++) {
    const J = PARAMS.map((p) => { const mm = { ...m, fit: { ...m.fit, [p]: m.fit[p] + STEP[p] } }; const r1 = residuals(mm, rows); return r1.map((v, k) => (v - res[k]) / STEP[p]); });
    const A = PARAMS.map((_, i) => PARAMS.map((_, j) => J[i].reduce((s, v, k) => s + v * J[j][k], 0)));
    const g = PARAMS.map((_, i) => -J[i].reduce((s, v, k) => s + v * res[k], 0));
    let improved = false;
    for (let tries = 0; tries < 8 && !improved; tries++) {
      const Ad = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) : v)));
      const dx = solve(Ad, g.slice());
      const trial = { ...m, fit: { ...m.fit } };
      PARAMS.forEach((p, i) => { trial.fit[p] += dx[i]; });
      const r2 = residuals(trial, rows), c2 = r2.reduce((a, b) => a + b * b, 0);
      if (c2 < cost) { m.fit = trial.fit; res = r2; improved = c2 > cost * (1 - 1e-6) ? null : true; cost = c2; lambda /= 3; } else lambda *= 4;
      if (improved === null) return;
    }
    if (!improved) return;
  }
}
const wrap = (x) => Number((((x % 360) + 540) % 360 - 180).toFixed(4));
for (const [key, m] of Object.entries(moons)) {
  const raw = Math.max(...errors(m, dense[key]));
  m.fit = { dM: 0, dn: 0, dW: 0, dNode: 0 };
  for (let k = 0; k < 3; k++) fitAlong(m, dense[key]);
  gaussNewton(m, dense[key]);
  const err = errors(m, dense[key]);
  m.fit = { dM: wrap(m.fit.dM), dn: Number(m.fit.dn.toExponential(6)), dW: wrap(m.fit.dW), dNode: wrap(m.fit.dNode),
    rmsKm: Math.round(rms(err)), maxKm: Math.round(Math.max(...err)), unfittedMaxKm: Math.round(raw) };
  console.log(key.padEnd(12), m.kernel, JSON.stringify(m.fit));
}

fs.writeFileSync(new URL('./irregularMoons.data.js', import.meta.url), `// src/physics/irregularMoons.data.js (written by irregularMoons.fetch.mjs; do not edit)
//
// The irregular moons of Jupiter, Saturn and Neptune (irregularMoons.js).
// Elements: JPL Solar System Dynamics, Planetary Satellite Mean Elements,
// ${ELEM_URL}, fetched ${fetched}: referred to the J2000 ecliptic, epoch
// as given (2000-01-01.5 TDB; 2020-01-01.0 for Neptune's); a in km, angles
// in degrees, P in days, P apsis and P node in years. kernel: the JPL
// satellite ephemeris they are fitted to. retrograde: i over 90 degrees.
// Radius, GM and geometric albedo: each moon's JPL Horizons object page,
// fetched ${fetched}; a moon with no measured radius is drawn at a nominal
// ${NOMINAL_RADIUS_KM} km. discovery: JPL's Planetary Satellite Discovery
// Circumstances, ${DISC_URL}, fetched ${fetched}.
// fit: corrections fitted to Horizons every 10 days over 2000-2050, as for
// the other moons (moons.data.js): M += dM + dn t, w += dW, node += dNode;
// rmsKm and maxKm are what is left there, unfittedMaxKm the table's own.

export const IRREGULAR_DATA = ${JSON.stringify(moons, null, 1)};
`);
fs.writeFileSync(new URL('./fixtures/irregular_moons_horizons.json', import.meta.url), JSON.stringify(checks));
console.log(`wrote ${Object.keys(moons).length} moons`);
