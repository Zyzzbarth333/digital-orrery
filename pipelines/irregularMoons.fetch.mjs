// pipelines/irregularMoons.fetch.mjs
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
//   and its size, shape and spin, from NEOWISE, T. Denk's table and
//   chapter, the Minor Planet Center's circulars and S. S. Sheppard's
//   tables (below; docs/frontend/moons.md#sizes-and-shapes);
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
import { elementState } from '@digital-orrery/physics/moons.js';

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

// ----- Sizes, shapes and spins (docs/frontend/moons.md#sizes-and-shapes) -----
// Each moon's diameter, best source first:
//   1. measured: the thermal-infrared diameters of NEOWISE, Grav et al.
//      (2015, ApJ 809, 3, Table 3), for 11 of Jupiter's and 2 of Saturn's;
//   2. Saturn's: T. Denk's overview table of Saturn's irregular moons (its
//      "Size" column, from H at an assumed albedo of 0.06), or, for those
//      announced since, the absolute magnitude H in their Minor Planet
//      Electronic Circular, by the same formula and albedo;
//   3. Jupiter's and Neptune's: S. S. Sheppard's moon tables (their "Size"
//      column; the albedo assumed is not stated).
// Shapes: where a lightcurve gives the minimum ratio of the equatorial axes
// a/b (Denk et al. 2018, Table 3, 22 of Saturn's) or the moon has been
// resolved (Himalia, Porco et al. 2003: radii 75 x 60 km), an ellipsoid
// a x b x b with that ratio and the moon's volume; the rest are spheres.
// Spins: the rotation periods of the same table and Pilcher et al. (2012)
// for Himalia.
const SHEPPARD = 'https://sites.google.com/carnegiescience.edu/sheppard/moons/';
const DENK_TABLE = 'https://tilmanndenk.de/wp-content/uploads/OSM_7_Table.txt';
const MPEC = 'https://minorplanetcenter.net/mpec/';
const DENK_ALBEDO = 0.06;
// Denk's own formula (his table's note 9): D = 1 au (2 / sqrt(p))
// 10^(-0.2 (H - M_sun)), with 1 au = 149,597,870.7 km and the Sun's
// apparent V magnitude M_sun = -26.71: 1361 km / sqrt(p) 10^(-H/5).
const AU_KM = 149597870.7, M_SUN = -26.71;
const diameterFromH = (H, p) => AU_KM * (2 / Math.sqrt(p)) * 10 ** (-0.2 * (H - M_SUN));
// Grav et al. (2015), Table 3: diameter (km), its error, visible albedo (%).
const NEOWISE = {
  Himalia: [139.6, 1.7, 5.7], Elara: [79.9, 1.7, 4.6], Pasiphae: [57.8, 0.8, 4.4], Sinope: [35.0, 0.6, 4.2], Lysithea: [42.2, 0.7, 3.6],
  Carme: [46.7, 0.9, 3.5], Ananke: [29.1, 0.6, 3.8], Leda: [21.5, 1.7, 3.4], Callirrhoe: [9.6, 1.3, 5.2], Kalyke: [6.9, 1.3, 2.9],
  Praxidike: [7.0, 0.7, 2.9], Albiorix: [28.6, 5.4, 6.2], Siarnaq: [39.3, 5.9, 5.0],
};
// Denk et al. (2018), Table 3: rotation period (h), (a/b)min (null where the
// table gives none), and whether the period is marked uncertain.
const DENK2018 = {
  Kiviuq: [21.97, 2.32], Ijiraq: [13.03, 1.08], Paaliaq: [18.79, 1.05], Tarqeq: [76.13, 1.32], Siarnaq: [10.18785, 1.17],
  Albiorix: [13.33, 1.34], Bebhionn: [16.33, 1.41], Erriapus: [28.15, 1.51], Tarvos: [10.691, 1.08], Narvi: [10.21, null],
  Bestla: [14.6238, 1.47], Skathi: [11.10, 1.27], Skoll: [7.26, 1.14, true], Hyrrokkin: [12.76, 1.27], Greip: [12.75, 1.18, true],
  Suttungr: [7.67, 1.18], Thrymr: [38.79, 1.21, true], Mundilfari: [6.74, 1.43], Hati: [5.45, 1.42], Bergelmir: [8.13, 1.13],
  Kari: [7.70, null], Loge: [6.9, 1.04, true], Ymir: [11.92220, 1.37], Fornjot: [9.5, 1.11, true],
};
// Himalia: Porco et al. (2003), radii 75 +- 10 by 60 +- 10 km from Cassini's
// images; Pilcher et al. (2012), synodic period 7.7819 +- 0.0005 h.
const HIMALIA = { ab: 75 / 60, periodH: 7.7819 };
// The circulars that announced the moons Denk's table does not have yet.
const MPECS = ['K25/K25EF3', 'K25/K25EF4', 'K25/K25EF5', 'K26/K26F14', 'K26/K26G68', 'K26/K26G69', 'K26/K26G70',
  'K26/K26G71', 'K26/K26G72', 'K26/K26G74', 'K26/K26G75'];

// A page's text: its entities decoded (Sheppard's tables are escaped twice,
// inside an attribute), then its tags dropped.
function strip(h) {
  for (let prev = null; prev !== h;) {
    prev = h;
    h = h.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
  }
  return h.replace(/<[^>]+>/g, '');
}
// Sheppard's tables: designation or name, then a, i, e, peri, node, M,
// period, R magnitude, diameter (km), year.
const sheppard = {};
for (const [planet, page] of [['jupiter', 'jupitermoons'], ['neptune', 'neptunemoons']]) {
  const text = strip(await cached(`sheppard_${page}.html`, SHEPPARD + page));
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[IVXLC]+\s+)?(.*?)\s+(\d{5,9})\s+([\d.]+\s+){7}([\d.]+)\s+(\d{4})\s*$/);
    if (!m) continue;
    const size = Number(m[4]);
    const des = m[1].match(/S\/\d{4} ?[JN] ?\d+/);
    for (const k of [m[1], ...m[1].split(/\s+/), des?.[0]]) if (k) sheppard[`${planet}:${norm(k)}`] = size;
  }
}
// Denk's table (UTF-16): NAIF id, ..., H, R, size, lightcurve amplitude.
const denk = {};
{
  const file = path.join(CACHE, 'denk_osm7.txt');
  if (!fs.existsSync(file)) {
    const buf = await (await fetch(DENK_TABLE, { headers: UA })).arrayBuffer();
    fs.writeFileSync(file, new TextDecoder('utf-16le').decode(buf));
  }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!/^\|\s*\d{3,5}\s/.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const body = cells[2].split(/\s{2,}/);
    denk[Number(cells[0].split(/\s+/)[0])] = { H: Number(body[0]), sizeKm: Number(body[2]) };
  }
}
// The circulars' H, by designation.
const mpecH = {};
for (const id of MPECS) {
  const text = strip(await cached(`mpec_${id.split('/')[1]}.html`, `${MPEC}${id}.html`));
  const title = text.match(/MPEC \d{4}-[A-Z]\d+/)?.[0];
  for (const m of text.matchAll(/\n\s*(S\/\d{4} [JSN] \d+)\s*\n([\s\S]*?)(?=\n\s*S\/\d{4} [JSN] \d+\s*\n|$)/g)) {
    const h = m[2].match(/\bH\s+([\d.]+)/);
    if (h) mpecH[m[1]] = { H: Number(h[1]), mpec: title };
  }
}
let sizedBy = {};
for (const m of Object.values(moons)) {
  const n = NEOWISE[m.name], dk = denk[m.naif], sh = sheppard[`${m.planet}:${norm(m.name)}`], mp = mpecH[m.name];
  let size;
  if (n) size = { diameterKm: n[0], errKm: n[1], source: 'NEOWISE', note: 'measured in the thermal infrared (Grav et al. 2015)' };
  else if (m.planet === 'saturn' && dk) size = { diameterKm: dk.sizeKm, H: dk.H, source: 'Denk', note: `from H ${dk.H} at an assumed albedo of ${DENK_ALBEDO} (Denk's table)` };
  else if (m.planet === 'saturn' && mp) size = { diameterKm: Number(diameterFromH(mp.H, DENK_ALBEDO).toFixed(1)), H: mp.H, source: 'MPEC', note: `from H ${mp.H} (${mp.mpec}) at an assumed albedo of ${DENK_ALBEDO}` };
  else if (sh) size = { diameterKm: sh, source: 'Sheppard', note: 'estimated from its brightness (Sheppard\'s table)' };
  else throw new Error(`no size for ${m.name}`);
  sizedBy[size.source] = (sizedBy[size.source] ?? 0) + 1;
  m.size = size;
  m.radiusKm = Number((size.diameterKm / 2).toFixed(2));
  m.radiusNote = size.source === 'NEOWISE' ? undefined : `estimated: ${size.note}`;
  if (n) m.geometricAlbedo = Number((n[2] / 100).toFixed(3));
  // The shape, a x b x b with the moon's volume, and the spin.
  const dk18 = DENK2018[m.name];
  const ab = m.name === 'Himalia' ? HIMALIA.ab : dk18?.[1] ?? null;
  if (ab) {
    const b = m.radiusKm / Math.cbrt(ab);
    m.axesKm = [Number((ab * b).toFixed(2)), Number(b.toFixed(2)), Number(b.toFixed(2))];
    m.shapeNote = m.name === 'Himalia' ? 'a/b from Cassini\'s images (Porco et al. 2003), c taken as b'
      : 'a/b the minimum from its lightcurve (Denk et al. 2018), c taken as b';
  } else { m.axesKm = null; m.shapeNote = undefined; }
  const per = m.name === 'Himalia' ? HIMALIA.periodH : dk18?.[0] ?? null;
  m.rotation = per ? { periodH: per, source: m.name === 'Himalia' ? 'Pilcher et al. 2012' : 'Denk et al. 2018', uncertain: !!dk18?.[2] } : null;
}
console.log('sizes from', JSON.stringify(sizedBy));

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

fs.writeFileSync(new URL('../packages/physics/src/irregularMoons.data.js', import.meta.url), `// packages/physics/src/irregularMoons.data.js (written by irregularMoons.fetch.mjs; do not edit)
//
// The irregular moons of Jupiter, Saturn and Neptune (irregularMoons.js).
// Elements: JPL Solar System Dynamics, Planetary Satellite Mean Elements,
// ${ELEM_URL}, fetched ${fetched}: referred to the J2000 ecliptic, epoch
// as given (2000-01-01.5 TDB; 2020-01-01.0 for Neptune's); a in km, angles
// in degrees, P in days, P apsis and P node in years. kernel: the JPL
// satellite ephemeris they are fitted to. retrograde: i over 90 degrees.
// GM and geometric albedo: each moon's JPL Horizons object page, fetched
// ${fetched} (the albedo NEOWISE's, Grav et al. 2015, where it has one).
// size: the diameter (km) and where it is from: NEOWISE (measured, Grav et
// al. 2015), Denk (T. Denk's table, ${DENK_TABLE}, from H at an albedo of
// ${DENK_ALBEDO}), MPEC (the Minor Planet Electronic Circular's H, the same
// way) or Sheppard (S. S. Sheppard's tables, ${SHEPPARD}); radiusKm is half
// of it. axesKm: an ellipsoid a x b x b of the same volume where the
// lightcurve (Denk et al. 2018, Table 3) or images (Himalia, Porco et al.
// 2003) give a/b; rotation: the period (h) from the same, or Pilcher et al.
// (2012) for Himalia. discovery: JPL's Planetary Satellite Discovery
// Circumstances, ${DISC_URL}. All fetched ${fetched}.
// fit: corrections fitted to Horizons every 10 days over 2000-2050, as for
// the other moons (moons.data.js): M += dM + dn t, w += dW, node += dNode;
// rmsKm and maxKm are what is left there, unfittedMaxKm the table's own.

export const IRREGULAR_DATA = ${JSON.stringify(moons, null, 1)};
`);
fs.writeFileSync(new URL('../packages/physics/src/fixtures/irregular_moons_horizons.json', import.meta.url), JSON.stringify(checks));
console.log(`wrote ${Object.keys(moons).length} moons`);
