// src/physics/moons.fetch.mjs
//
// The data behind the major moons (moons.js), fetched once and committed:
// - moons.data.js: for each moon, its row of JPL's planetary satellite mean
//   elements (https://ssd.jpl.nasa.gov/sats/elem/), the fallback outside
//   the satellite-ephemeris tables (moonTables.js); its radius, GM and
//   geometric albedo from the header of its JPL Horizons object page; and,
//   for the moons drawn from the elements, corrections to the mean anomaly,
//   its rate, the periapsis and the node, fitted to Horizons vectors from
//   2000 to 2050 (docs/frontend/moons.md);
// - fixtures/moons_horizons.json: Horizons planetocentric ICRF vectors for
//   each moon, daily over November 2026 and yearly from 2000 to 2050, and
//   each planet's centre relative to its system barycentre over the month,
//   to check the model against (moons.test.mjs).
//
// Raw downloads are kept under ~/.cache/digital-orrery/moons (not
// committed); delete that folder to fetch afresh.
//
//   npm run fetch:moons

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns';

dns.setDefaultResultOrder('ipv4first');
const CACHE = path.join(os.homedir(), '.cache', 'digital-orrery', 'moons');
fs.mkdirSync(path.join(CACHE, 'horizons'), { recursive: true });
const ELEM_URL = 'https://ssd.jpl.nasa.gov/sats/elem/';
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const UA = { 'User-Agent': 'digital-orrery data fetch' };

// key, NAIF id, planet (key and NAIF centre id), in order out from each
// planet. The twenty major moons pull on spacecraft in the kernel
// (bodies.js); the others are drawn only.
export const MAJOR_MOONS = new Set(['phobos', 'deimos', 'io', 'europa', 'ganymede', 'callisto', 'mimas', 'enceladus', 'tethys',
  'dione', 'rhea', 'titan', 'iapetus', 'miranda', 'ariel', 'umbriel', 'titania', 'oberon', 'triton', 'charon']);
export const MOON_IDS = [
  ['phobos', 401, 'mars', 499], ['deimos', 402, 'mars', 499],
  ['metis', 516, 'jupiter', 599], ['adrastea', 515, 'jupiter', 599], ['amalthea', 505, 'jupiter', 599], ['thebe', 514, 'jupiter', 599],
  ['io', 501, 'jupiter', 599], ['europa', 502, 'jupiter', 599], ['ganymede', 503, 'jupiter', 599], ['callisto', 504, 'jupiter', 599],
  ['mimas', 601, 'saturn', 699], ['methone', 632, 'saturn', 699], ['enceladus', 602, 'saturn', 699], ['tethys', 603, 'saturn', 699],
  ['telesto', 613, 'saturn', 699], ['calypso', 614, 'saturn', 699], ['dione', 604, 'saturn', 699], ['helene', 612, 'saturn', 699],
  ['polydeuces', 634, 'saturn', 699], ['rhea', 605, 'saturn', 699], ['titan', 606, 'saturn', 699], ['hyperion', 607, 'saturn', 699],
  ['iapetus', 608, 'saturn', 699], ['phoebe', 609, 'saturn', 699],
  ['miranda', 705, 'uranus', 799], ['ariel', 701, 'uranus', 799], ['umbriel', 702, 'uranus', 799], ['titania', 703, 'uranus', 799],
  ['oberon', 704, 'uranus', 799], ['francisco', 722, 'uranus', 799], ['caliban', 716, 'uranus', 799], ['stephano', 720, 'uranus', 799],
  ['s2023u1', 75051, 'uranus', 799], ['trinculo', 721, 'uranus', 799], ['sycorax', 717, 'uranus', 799], ['margaret', 723, 'uranus', 799],
  ['prospero', 718, 'uranus', 799], ['setebos', 719, 'uranus', 799], ['ferdinand', 724, 'uranus', 799],
  ['naiad', 803, 'neptune', 899], ['triton', 801, 'neptune', 899], ['nereid', 802, 'neptune', 899],
  ['charon', 901, 'pluto', 999], ['styx', 905, 'pluto', 999], ['nix', 902, 'pluto', 999], ['kerberos', 904, 'pluto', 999],
  ['hydra', 903, 'pluto', 999],
];
// The name in the elements table, and the one shown, where they differ.
const ROW_NAME = { s2023u1: 'S2023_U1' };
const SHOWN_NAME = { s2023u1: 'S/2023 U 1' };
// A moon with no measured size (Horizons gives none, or only a bound) is
// drawn at this radius, and says so.
const NOMINAL_RADIUS_KM = 10;
const MONTH = ['2026-11-01', '2026-12-01'];
const YEARS = Array.from({ length: 51 }, (_, k) => `${2000 + k}-01-01`);
const G = 6.6743e-20;                 // km^3 / (kg s^2), CODATA 2018

async function cached(name, url) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const text = await (await fetch(url, { headers: UA })).text();
  fs.writeFileSync(file, text);
  await new Promise((r) => setTimeout(r, 1200));
  return text;
}
const horizons = (name, q) => cached(path.join('horizons', name),
  `${API}?${Object.entries({ format: 'text', ...q }).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`);

// The elements table, as text lines (one cell per line).
function cells(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<(tr|td|th|br|p|h\d|li|div)[^>]*>/g, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .split('\n').map((s) => s.trim()).filter(Boolean);
}

const num = (s) => (s === '-' || s === undefined ? null : Number(s));

// A row: planet, satellite, code, ephemeris, frame, epoch, a, e, w, M, i,
// node, P, P apsis, P node, then (Laplace frame only) the Laplace pole's
// RA, Dec and its tilt from the planet's equator.
function parseRow(c, i) {
  const frame = c[i + 4];
  const row = {
    naif: Number(c[i + 2]), ephemeris: c[i + 3], frame, epoch: c[i + 5],
    a: num(c[i + 6]), e: num(c[i + 7]), w: num(c[i + 8]), M: num(c[i + 9]), i: num(c[i + 10]), node: num(c[i + 11]),
    P: num(c[i + 12]), Papsis: num(c[i + 13]), Pnode: num(c[i + 14]),
  };
  if (frame === 'Laplace') Object.assign(row, { poleRa: num(c[i + 15]), poleDec: num(c[i + 16]), tilt: num(c[i + 17]) });
  return row;
}

// Radius (mean, or the volume-equivalent sphere of a triaxial a x b x c),
// GM (or G times the mass) and geometric albedo, from a Horizons header.
function parseHeader(text) {
  // "Radius (km) = 8.2", "Mean radius (km) = 83.5", "Radius (km),mean = 16",
  // "Radius (km) = 16.3x11.8x9.8", "Radii (IAU2015): 1.94 x 1.29 x 1.21 km",
  // "Radius (km) = ~30"; or "< 50 km", or nothing, for a moon not measured.
  const rad = text.match(/Radi(?:us \(km[^)]*\)[^=\n]*=|i \(IAU ?2015\):)\s*~?\s*([\d.]+)\s*(?:x\s*([\d.]+)\s*x\s*([\d.]+))?/i);
  const bound = text.match(/Radius \(km\)\s*=\s*<\s*([\d.]+)/i);
  const approx = /Radius \(km\)\s*=\s*~/i.test(text);
  const radiusKm = !rad ? NOMINAL_RADIUS_KM : rad[2] ? Math.cbrt(Number(rad[1]) * Number(rad[2]) * Number(rad[3])) : Number(rad[1]);
  const radiusNote = !rad ? `not measured${bound ? ` (under ${bound[1]} km)` : ''}; drawn at a nominal ${NOMINAL_RADIUS_KM} km`
    : rad[2] ? `volume-equivalent of ${rad[1]} x ${rad[2]} x ${rad[3]}` : approx ? 'approximate' : undefined;
  const gmM = text.match(/GM\s*\(km\^3\/s\^2\)\s*=\s*([\d.]+)/);
  let gm = gmM ? Number(gmM[1]) : null;
  if (gm === null) {
    const m = text.match(/Mass \(10\^(\d+) kg ?\)\s*=\s*([\d.]+)\s*\(10\^(-?\d+)\)/);
    if (m) gm = G * Number(m[2]) * 10 ** (Number(m[1]) + Number(m[3]));
  }
  const alb = text.match(/Geometric Albedo\s*=\s*([\d.]+)/i);
  return { radiusKm: Number(radiusKm.toFixed(2)), radiusNote,
    gm, gmNote: gmM ? undefined : gm === null ? 'not measured' : 'G x mass', geometricAlbedo: alb ? Number(alb[1]) : null };
}

function vectors(text) {
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0) throw new Error(`no vectors:\n${text.slice(-600)}`);
  return text.slice(i0 + 5, i1).trim().split('\n').map((l) => {
    const f = l.split(',').map((s) => s.trim());
    return [Number(f[0]), Number(Number(f[2]).toFixed(3)), Number(Number(f[3]).toFixed(3)), Number(Number(f[4]).toFixed(3))];
  });
}
const VEC = { EPHEM_TYPE: "'VECTORS'", REF_PLANE: "'FRAME'", REF_SYSTEM: "'ICRF'", VEC_TABLE: "'1'", OUT_UNITS: "'KM-S'", CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'TDB'" };

const fetched = new Date().toISOString().slice(0, 10);
const c = cells(await cached('elem.html', ELEM_URL));
const moons = {};
const checks = { source: 'JPL Horizons API: planetocentric (500@x99) ICRF vectors in km, TDB; JD TDB, x, y, z', fetched, month: {}, years: {}, centres: {} };
const dense = {}, quarter = {};
for (const [key, id, planet, centre] of MOON_IDS) {
  const rowName = ROW_NAME[key] ?? key[0].toUpperCase() + key.slice(1);
  const name = SHOWN_NAME[key] ?? rowName;
  const at = c.findIndex((s, k) => s === rowName && c[k + 1] === String(id));
  if (at < 0) throw new Error(`no row for ${rowName}`);
  const header = parseHeader(await horizons(`hdr_${id}.txt`, { COMMAND: `'${id}'`, OBJ_DATA: "'YES'", MAKE_EPHEM: "'NO'" }));
  moons[key] = { name, planet, major: MAJOR_MOONS.has(key), ...parseRow(c, at - 1), ...header };
  const q = { ...VEC, COMMAND: `'${id}'`, CENTER: `'500@${centre}'` };
  checks.month[key] = vectors(await horizons(`month_${id}.txt`, { ...q, START_TIME: `'${MONTH[0]}'`, STOP_TIME: `'${MONTH[1]}'`, STEP_SIZE: "'1 d'" }));
  checks.years[key] = vectors(await horizons(`years_${id}.txt`, { ...q, TLIST: YEARS.map((d) => `'${d}'`).join(' '), TLIST_TYPE: "'CAL'" }));
  dense[key] = vectors(await horizons(`weekly_${id}.txt`, { ...q, START_TIME: "'2000-01-01'", STOP_TIME: "'2050-01-01'", STEP_SIZE: "'7 d'" }));
  quarter[key] = vectors(await horizons(`6h_${id}.txt`, { ...q, START_TIME: "'2010-01-01'", STOP_TIME: "'2010-03-02'", STEP_SIZE: "'6 h'" }));
}
// Each planet's centre relative to its system barycentre.
for (const [planet, n] of [['mars', 4], ['jupiter', 5], ['saturn', 6], ['uranus', 7], ['neptune', 8], ['pluto', 9]]) {
  checks.centres[planet] = vectors(await horizons(`centre_${n}99.txt`, { ...VEC, COMMAND: `'${n}99'`, CENTER: `'500@${n}'`, START_TIME: `'${MONTH[0]}'`, STOP_TIME: `'${MONTH[1]}'`, STEP_SIZE: "'1 d'" }));
}

// Which point astronomy-engine's planets are (barycentre or centre), and
// the moons' places in other frames: heliocentric (500@10) vectors of each
// system's barycentre and its planet's centre, and a few moons about the
// Sun and about their system's barycentre, over the same month.
checks.helio = {};
for (const n of [4, 5, 6, 7, 8, 9]) for (const id of [n, n * 100 + 99]) {
  checks.helio[id] = vectors(await horizons(`helio_${id}_month.txt`, { ...VEC, COMMAND: `'${id}'`, CENTER: "'500@10'", START_TIME: `'${MONTH[0]}'`, STOP_TIME: `'${MONTH[1]}'`, STEP_SIZE: "'1 d'" }));
}
// The solar system (0) and Earth-Moon (3) barycentres about the Sun, for
// barycentres.js: daily over the month and yearly 2000-2050.
checks.bary = {};
for (const id of [0, 3]) {
  checks.bary[id] = {
    month: vectors(await horizons(`helio_${id}_month.txt`, { ...VEC, COMMAND: `'${id}'`, CENTER: "'500@10'", START_TIME: `'${MONTH[0]}'`, STOP_TIME: `'${MONTH[1]}'`, STEP_SIZE: "'1 d'" })),
    years: vectors(await horizons(`helio_${id}_years.txt`, { ...VEC, COMMAND: `'${id}'`, CENTER: "'500@10'", TLIST: YEARS.map((d) => `'${d}'`).join(' '), TLIST_TYPE: "'CAL'" })),
  };
}
checks.moonsHelio = {};
checks.moonsBary = {};
for (const [key, id] of [['phobos', 401], ['io', 501], ['callisto', 504], ['titan', 606], ['titania', 703], ['triton', 801], ['charon', 901]]) {
  checks.moonsHelio[key] = vectors(await horizons(`helio_${id}_month.txt`, { ...VEC, COMMAND: `'${id}'`, CENTER: "'500@10'", START_TIME: `'${MONTH[0]}'`, STOP_TIME: `'${MONTH[1]}'`, STEP_SIZE: "'1 d'" }));
  const bary = String(id)[0];
  checks.moonsBary[key] = vectors(await horizons(`bary_${id}_month.txt`, { ...VEC, COMMAND: `'${id}'`, CENTER: `'500@${bary}'`, START_TIME: `'${MONTH[0]}'`, STOP_TIME: `'${MONTH[1]}'`, STEP_SIZE: "'1 d'" }));
}

const DATA = new URL('./moons.data.js', import.meta.url);
const writeData = () => fs.writeFileSync(DATA, `// src/physics/moons.data.js (written by moons.fetch.mjs; do not edit)
//
// Source: JPL Solar System Dynamics, Planetary Satellite Mean Elements,
// ${ELEM_URL}, fetched ${fetched}. Epoch as given (2000-01-01.5 TDB, or
// 2020-01-01.0 for Uranus's irregular moons); a in km, angles in degrees,
// P in days, P apsis and P node in years. Laplace-frame rows carry the
// Laplace pole (ICRF RA, Dec) and its tilt from the planet's equator;
// equatorial-frame rows are referred to the planet's equator (Uranus's
// about the pole its moons orbit); ecliptic-frame rows to the J2000
// ecliptic. Triton's 675.2 yr, in the table's apsis column, is used as its
// node's period (its orbit is circular). These are the fallback outside
// 2000-2049: there every moon comes from JPL's satellite ephemerides
// (moonTables.js), and the elements are not used.
// Radius (mean, or the volume-equivalent sphere), GM (or G x mass) and
// geometric albedo: each moon's JPL Horizons object page, fetched ${fetched};
// a moon with no measured radius is drawn at a nominal ${NOMINAL_RADIUS_KM} km. major: the
// twenty moons that pull on spacecraft in the kernel (bodies.js).
// fit: corrections fitted to Horizons over 2000-2050: M += dM + dn t
// (deg, deg/day, t in days from J2000), w += dW, node += dNode (deg);
// rmsKm and maxKm are what is left of the fit there. Io to Callisto have
// none: astronomy-engine's JupiterMoons is their fallback.

export const MOON_DATA = ${JSON.stringify(moons, null, 1)};
`);
writeData();
const { elementState } = await import(`./moons.js?${Date.now()}`);

// The fit. The table's epoch angles and periods do not hold a moon's place:
// its periods are rounded (Phobos's to four digits, which loses 80 deg
// every five years), its Saturn rows' epoch angles are off by up to 160 deg
// against Horizons at the epoch itself, and P is the period of the mean
// longitude for some planets' rows and of the mean anomaly for others. So
// each element moon gets corrections to its mean anomaly (dM + dn t), its
// argument of periapsis (dW) and its node (dNode), fitted to Horizons:
// first the mean anomaly alone on 6-hourly samples over two months (no
// aliasing for a rate error under 720 deg/day), then all four by
// Gauss-Newton on the weekly samples over 50 years. a, e, i, the
// reference plane and the precession periods stay the table's.
const J2000_JD = 2451545.0;
const errors = (m, rows) => rows.map(([jd, x, y, z]) => { const { r } = elementState(m, jd - J2000_JD); return Math.hypot(r[0] - x, r[1] - y, r[2] - z); });
const rms = (e) => Math.sqrt(e.reduce((a, b) => a + b * b, 0) / e.length);
// The along-orbit angle from the model to Horizons, unwrapped, fitted by a
// line in t.
function fitAlong(m, rows) {
  const ts = [], ds = [];
  let prev = 0;
  for (const [jd, x, y, z] of rows) {
    const t = jd - J2000_JD;
    const { r, h } = elementState(m, t);
    const cr = [r[1] * z - r[2] * y, r[2] * x - r[0] * z, r[0] * y - r[1] * x];
    let d = Math.atan2(cr[0] * h[0] + cr[1] * h[1] + cr[2] * h[2], r[0] * x + r[1] * y + r[2] * z) * (180 / Math.PI);
    while (d - prev > 180) d -= 360;
    while (d - prev < -180) d += 360;
    prev = d;
    ts.push(t); ds.push(d);
  }
  const n = ts.length, mt = ts.reduce((a, b) => a + b) / n, md = ds.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { sxy += (ts[k] - mt) * (ds[k] - md); sxx += (ts[k] - mt) ** 2; }
  const slope = sxy / sxx;
  m.fit.dn += slope;
  m.fit.dM += md - slope * mt;
}
// Gauss-Newton (Levenberg-damped) on dM, dn, dW, dNode against positions.
const PARAMS = ['dM', 'dn', 'dW', 'dNode'];
const STEP = { dM: 1e-3, dn: 1e-8, dW: 1e-3, dNode: 1e-3 };
function residuals(m, rows) {
  const out = new Float64Array(rows.length * 3);
  rows.forEach(([jd, x, y, z], k) => { const { r } = elementState(m, jd - J2000_JD); out[3 * k] = r[0] - x; out[3 * k + 1] = r[1] - y; out[3 * k + 2] = r[2] - z; });
  return out;
}
function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
function gaussNewton(m, rows) {
  let lambda = 1e-3;
  let res = residuals(m, rows), cost = res.reduce((a, b) => a + b * b, 0);
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
  if (['io', 'europa', 'ganymede', 'callisto'].includes(key)) continue;
  // Triton's orbit is circular, so it has no apsis: its row's 675.2 yr is
  // the node's period (299.4 yr, in the node column, leaves 50,000 km
  // against Horizons where 675.2 leaves 9,000 before the fit).
  if (key === 'triton') { m.Pnode = m.Papsis; m.Papsis = null; }
  m.fit = { dM: 0, dn: 0, dW: 0, dNode: 0 };
  fitAlong(m, quarter[key]);
  for (let k = 0; k < 3; k++) fitAlong(m, dense[key]);
  const before = rms(errors(m, dense[key]));
  gaussNewton(m, dense[key]);
  const err = errors(m, dense[key]);
  m.fit = { dM: wrap(m.fit.dM), dn: Number(m.fit.dn.toExponential(6)), dW: wrap(m.fit.dW), dNode: wrap(m.fit.dNode), rmsKm: Math.round(rms(err)), maxKm: Math.round(Math.max(...err)) };
  console.log(key.padEnd(10), JSON.stringify(m.fit), 'along-only rms', Math.round(before));
}
writeData();
const round = (rows) => rows.map(([jd, x, y, z]) => [jd, Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(z * 10) / 10]);
for (const k of Object.keys(checks.month)) { checks.month[k] = round(checks.month[k]); checks.years[k] = round(checks.years[k]); }
for (const g of ['helio', 'moonsHelio', 'moonsBary']) for (const k of Object.keys(checks[g])) checks[g][k] = round(checks[g][k]);
for (const k of Object.keys(checks.bary)) for (const span of ['month', 'years']) checks.bary[k][span] = round(checks.bary[k][span]);
fs.writeFileSync(new URL('./fixtures/moons_horizons.json', import.meta.url), JSON.stringify(checks));
