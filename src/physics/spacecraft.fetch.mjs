// src/physics/spacecraft.fetch.mjs
//
// `npm run fetch:spacecraft`: the spacecraft layer's trajectories
// (spacecraft.js, docs/frontend/spacecraft.md), from JPL Horizons, for
// 2026 and 2027.
//
// For each craft it asks Horizons for states about the craft's centre body
// (J2000 equatorial, UT) every few minutes, cached in
// ~/.cache/digital-orrery/horizons-craft/. Then, day by day, it keeps the
// fewest of them that still give every sample within TOL_KM when filled in
// by spacecraft.js: it tries a Kepler blend and a cubic about the centre,
// and for a probe in cruise a Kepler blend about any planet it passes
// within 2 million km of that day, each at every spacing that divides the
// day, and keeps the longest that passes. A day nothing passes keeps every
// sample, and says so.
//
// Writes public/data/spacecraft/ (index.json, a .json and .bin a month)
// and src/physics/fixtures/spacecraft_horizons.json: Horizons samples that
// were not kept, one a month a craft, for spacecraft.test.mjs.
//
// Horizons asks for no more than one request at a time; the script waits
// a second between them, and stops on any answer it can't read.

import './deNode.js';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { helioStateEqj } from './ephemeris.js';
import { bodyConstants, PLANET_GM, MU_SUN } from './bodies.js';
import { stateIn, KEPLER, HERMITE } from './spacecraft.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(homedir(), '.cache', 'digital-orrery', 'horizons-craft');
const OUT = join(ROOT, 'public', 'data', 'spacecraft');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const START = Date.UTC(2026, 0, 1), END = Date.UTC(2028, 0, 1);
const DAY = 86400e3;
export const TOL_KM = 2;
const FLYBY_KM = 2e6;

// The centres: Horizons' code and GM (the planet's own where its moons are
// separate, as bodies.js gives them).
export const CENTRES = {
  sun: { naif: 10, mu: MU_SUN },
  mercury: { naif: 199, mu: bodyConstants('mercury').mu },
  venus: { naif: 299, mu: bodyConstants('venus').mu },
  earth: { naif: 399, mu: bodyConstants('earth').mu },
  moon: { naif: 301, mu: bodyConstants('moon').mu },
  mars: { naif: 499, mu: PLANET_GM.mars },
  jupiter: { naif: 599, mu: PLANET_GM.jupiter },
};
const CENTRE_KEYS = Object.keys(CENTRES);

// The craft: Horizons ID, the centre their path is held about, the
// sampling to check against (minutes), and the rail's group.
export const CRAFT = [
  { key: 'bepicolombo', name: 'BepiColombo (MPO)', short: 'BepiColombo', id: -121, centre: 'mercury', fine: 4, group: 'mercury' },
  { key: 'lro', name: 'Lunar Reconnaissance Orbiter', short: 'LRO', id: -85, centre: 'moon', fine: 10, group: 'moon' },
  { key: 'chandrayaan2', name: 'Chandrayaan-2 orbiter', short: 'Chandrayaan-2', id: -152, centre: 'moon', fine: 10, group: 'moon' },
  { key: 'danuri', name: 'Danuri (KPLO)', short: 'Danuri', id: -155, centre: 'moon', fine: 10, group: 'moon' },
  { key: 'capstone', name: 'CAPSTONE', short: 'CAPSTONE', id: -1176, centre: 'moon', fine: 10, group: 'moon' },
  { key: 'mro', name: 'Mars Reconnaissance Orbiter', short: 'MRO', id: -74, centre: 'mars', fine: 4, group: 'mars' },
  { key: 'odyssey', name: '2001 Mars Odyssey', short: 'Mars Odyssey', id: -53, centre: 'mars', fine: 4, group: 'mars' },
  { key: 'maven', name: 'MAVEN', short: 'MAVEN', id: -202, centre: 'mars', fine: 4, group: 'mars' },
  { key: 'mex', name: 'Mars Express', short: 'Mars Express', id: -41, centre: 'mars', fine: 4, group: 'mars' },
  { key: 'tgo', name: 'ExoMars Trace Gas Orbiter', short: 'TGO', id: -143, centre: 'mars', fine: 4, group: 'mars' },
  { key: 'hope', name: 'Hope (Emirates Mars Mission)', short: 'Hope', id: -62, centre: 'mars', fine: 10, group: 'mars' },
  { key: 'juno', name: 'Juno', short: 'Juno', id: -61, centre: 'jupiter', fine: 10, group: 'jupiter' },
  { key: 'jwst', name: 'James Webb Space Telescope', short: 'JWST', id: -170, centre: 'earth', fine: 60, group: 'lagrange' },
  { key: 'roman', name: 'Nancy Grace Roman Space Telescope', short: 'Roman', id: -211, centre: 'earth', fine: 60, group: 'lagrange' },
  { key: 'euclid', name: 'Euclid', short: 'Euclid', id: -680, centre: 'earth', fine: 60, group: 'lagrange' },
  { key: 'gaia', name: 'Gaia', short: 'Gaia', id: -139479, centre: 'earth', fine: 60, group: 'lagrange' },
  { key: 'soho', name: 'SOHO', short: 'SOHO', id: -21, centre: 'earth', fine: 60, group: 'lagrange' },
  { key: 'dscovr', name: 'DSCOVR', short: 'DSCOVR', id: -78, centre: 'earth', fine: 60, group: 'lagrange' },
  { key: 'parker', name: 'Parker Solar Probe', short: 'Parker', id: -96, centre: 'sun', fine: 30, group: 'cruise' },
  { key: 'solo', name: 'Solar Orbiter', short: 'Solar Orbiter', id: -144, centre: 'sun', fine: 30, group: 'cruise' },
  { key: 'juice', name: 'JUICE', short: 'JUICE', id: -28, centre: 'sun', fine: 30, group: 'cruise' },
  { key: 'clipper', name: 'Europa Clipper', short: 'Europa Clipper', id: -159, centre: 'sun', fine: 30, group: 'cruise' },
  { key: 'psyche', name: 'Psyche', short: 'Psyche', id: -255, centre: 'sun', fine: 30, group: 'cruise' },
  { key: 'lucy', name: 'Lucy', short: 'Lucy', id: -49, centre: 'sun', fine: 30, group: 'cruise' },
  { key: 'hera', name: 'Hera', short: 'Hera', id: -91, centre: 'sun', fine: 30, group: 'cruise' },
  { key: 'newhorizons', name: 'New Horizons', short: 'New Horizons', id: -98, centre: 'sun', fine: 60, group: 'cruise' },
  { key: 'voyager1', name: 'Voyager 1', short: 'Voyager 1', id: -31, centre: 'sun', fine: 60, group: 'cruise' },
  { key: 'voyager2', name: 'Voyager 2', short: 'Voyager 2', id: -32, centre: 'sun', fine: 60, group: 'cruise' },
];

const iso = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
// "A.D. 2026-JAN-05 12:00:00.0000" -> ms
function horizonsDate(s) {
  const m = /(\d{4})-([A-Z]{3})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? Date.UTC(+m[1], MONTHS[m[2]], +m[3], +m[4], +m[5], +m[6]) : NaN;
}

// One request: states of `id` about `centre` from t0 to t1 (UTC ms) every
// `fine` minutes. Cached. Returns { samples, text } or { before, after }
// when Horizons says the span is outside its data.
async function ask(id, centre, fine, t0, t1) {
  const file = join(CACHE, `${id}_${centre}_${t0}_${t1}_${fine}.json`);
  let text;
  if (existsSync(file)) text = JSON.parse(await readFile(file, 'utf8')).result;
  else {
    const p = new URLSearchParams({
      format: 'json', COMMAND: `'${id}'`, OBJ_DATA: 'YES', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS',
      CENTER: `'500@${CENTRES[centre].naif}'`, REF_PLANE: 'FRAME', REF_SYSTEM: 'ICRF', VEC_TABLE: '2', OUT_UNITS: 'KM-S',
      TIME_TYPE: 'UT', CSV_FORMAT: 'YES', VEC_LABELS: 'NO',
      START_TIME: `'${iso(t0)}'`, STOP_TIME: `'${iso(t1)}'`, STEP_SIZE: `'${fine} m'`,
    });
    await sleep(1000);
    const res = await fetch(`${API}?${p}`);
    if (res.status !== 200) throw new Error(`Horizons HTTP ${res.status} for ${id}`);
    const body = await res.json();
    text = body.result ?? '';
    await writeFile(file, JSON.stringify({ result: text }));
  }
  const prior = /No ephemeris for target .* prior to A\.D\. ([^\n]+)/.exec(text);
  const after = /No ephemeris for target .* after A\.D\. ([^\n]+)/.exec(text);
  if (prior || after) return { before: prior ? horizonsDate(prior[1]) : NaN, after: after ? horizonsDate(after[1]) : NaN, text };
  // Or, from the SPICE toolkit underneath: "Insufficient ephemeris data ...
  // at the ephemeris epoch 2026 NOV 30 00:01:09.183": the data end there
  // (or, at the very start, the span holds none).
  const gap = /Insufficient ephemeris data[\s\S]*?at the ephemeris\s+epoch\s+(\d{4}) ([A-Z]{3}) (\d{2})\s+(\d{2}):(\d{2})/.exec(text);
  if (gap) {
    // TDB, 69 s ahead of UTC (and a minute's margin).
    const e = Date.UTC(+gap[1], MONTHS[gap[2]], +gap[3], +gap[4], +gap[5]) - 130e3;
    return e > t0 + DAY ? { before: NaN, after: e, text } : { before: NaN, after: t0, text };
  }
  const i = text.indexOf('$$SOE'), j = text.indexOf('$$EOE');
  if (i < 0 || j < 0) throw new Error(`Horizons gave no states for ${id} ${iso(t0)} to ${iso(t1)}:\n${text.slice(0, 1500)}`);
  const samples = text.slice(i + 5, j).trim().split('\n').map((l) => {
    const f = l.split(',').map((x) => x.trim());
    const t = Math.round(((Number(f[0]) - 2440587.5) * DAY) / 60e3) * 60e3;
    return { t, r: f.slice(2, 5).map(Number), v: f.slice(5, 8).map(Number) };
  });
  return { samples, text };
}

// Every sample of a craft over the span, in requests of up to ~15,000 rows,
// trimmed to the days Horizons covers.
async function samplesOf(c) {
  const perMonth = 31 * 1440 / c.fine, months = Math.max(1, Math.floor(15000 / perMonth));
  const out = [];
  let meta = '';
  for (let m0 = 0; m0 < 24; m0 += months) {
    let t0 = Date.UTC(2026, m0, 1), t1 = Math.min(END, Date.UTC(2026, m0 + months, 1));
    for (let tries = 0; tries < 3; tries++) {
      const got = await ask(c.id, c.centre, c.fine, t0, t1);
      if (!meta) meta = got.text;
      if (got.samples) { out.push(...got.samples.filter((s) => !out.length || s.t > out[out.length - 1].t)); break; }
      // Outside its data: whole days inside it only.
      if (Number.isFinite(got.before)) t0 = Math.ceil(got.before / DAY) * DAY;
      if (Number.isFinite(got.after)) t1 = Math.floor(got.after / DAY) * DAY;
      if (!(t1 - t0 >= DAY)) break;
    }
  }
  const name = /Target body name: ([^\n{]+)/.exec(meta)?.[1]?.trim() ?? null;
  const revised = /Revised:\s*([A-Za-z]{3} \d{1,2}, \d{4})/.exec(meta)?.[1] ?? null;
  // Horizons' table of the trajectories it joins: reconstructed (flown and
  // fitted to tracking), preliminary, or predicted, with their spans (TDB).
  const legs = [];
  for (const l of meta.split('\n')) {
    const m = /^\s{1,4}(\S.*?)\s{2,}(\d{4}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2})\s+(\d{4}-[A-Z][a-z]{2}-\d{2} \d{2}:\d{2})\s*$/.exec(l);
    if (m) legs.push({ name: m[1].trim(), start: m[2], stop: m[3] });
  }
  return { samples: out, name, revised, legs };
}

// The samples of one day about another centre: shifted by the centres'
// heliocentric states (DE442).
function about(samples, from, to) {
  if (from === to) return samples;
  return samples.map((s) => {
    const d = new Date(s.t);
    const a = from === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : helioStateEqj(from, d);
    const b = to === 'sun' ? { r: [0, 0, 0], v: [0, 0, 0] } : helioStateEqj(to, d);
    return { t: s.t, r: s.r.map((x, i) => x + a.r[i] - b.r[i]), v: s.v.map((x, i) => x + a.v[i] - b.v[i]) };
  });
}

// The worst error of one way at one spacing (every m-th sample a node).
function worst(day, way, mu, m) {
  const n = (day.length - 1) / m, states = new Float64Array((n + 1) * 6);
  for (let k = 0; k <= n; k++) { const s = day[k * m]; states.set([...s.r, ...s.v], k * 6); }
  const seg = { way, t0: day[0].t, dt: (day[m].t - day[0].t) / 1000, n, states, t1: day[day.length - 1].t };
  let e = 0;
  for (let j = 0; j < day.length; j++) {
    if (j % m === 0) continue;
    const p = stateIn(seg, day[j].t, mu).r, q = day[j].r;
    e = Math.max(e, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    if (!(e <= TOL_KM)) return e;
  }
  return e;
}

// Pick a day's centre, way and spacing.
function choose(c, day) {
  const per = day.length - 1;
  const divisors = []; for (let m = per; m >= 1; m--) if (per % m === 0) divisors.push(m);
  const centres = [c.centre];
  if (c.centre === 'sun') for (const p of ['venus', 'earth', 'mars']) {
    const near = day.some((s) => { const b = helioStateEqj(p, new Date(s.t)).r; return Math.hypot(s.r[0] - b[0], s.r[1] - b[1], s.r[2] - b[2]) < FLYBY_KM; });
    if (near) centres.push(p);
  }
  let best = null;
  for (const centre of centres) {
    const d = about(day, c.centre, centre);
    for (const way of [KEPLER, HERMITE]) {
      for (const m of divisors) {
        if (best && m < best.m) break;
        const e = worst(d, way, CENTRES[centre].mu, m);
        if (e <= TOL_KM) { if (!best || m > best.m || (m === best.m && e < best.err)) best = { centre, way, m, err: e, day: d }; break; }
        if (m === 1) { /* every sample a node: exact at them */ }
      }
    }
  }
  // Nothing passed (a close flyby between samples): every sample kept.
  return best ?? { centre: c.centre, way: KEPLER, m: 1, err: NaN, day };
}

await mkdir(CACHE, { recursive: true });
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const months = new Map();    // 'YYYY-MM' -> { segments, chunks: [], bytes }
const craftOut = [], heldOut = [];
// CRAFT=mro,lro: only those (for trying the script; the files then hold only them).
const ONLY = process.env.CRAFT?.split(',');
for (const [ci, c] of CRAFT.entries()) {
  if (ONLY && !ONLY.includes(c.key)) continue;
  void ci;
  const at = craftOut.length;     // its place in index.json's list
  const { samples, name, revised, legs } = await samplesOf(c);
  const step = c.fine * 60e3;
  let days = 0, maxErr = 0, kept = 0, failed = 0, conic = 0;
  const spacing = new Set();
  for (let t = START; t < END; t += DAY) {
    const i0 = samples.findIndex((s) => s.t === t);
    if (i0 < 0) continue;
    const per = DAY / step;
    if (samples[i0 + per]?.t !== t + DAY) continue;
    const day = samples.slice(i0, i0 + per + 1);
    const pick = choose(c, day);
    days++;
    if (Number.isFinite(pick.err)) maxErr = Math.max(maxErr, pick.err); else failed++;
    spacing.add(pick.m * c.fine);
    // An orbiter one conic fits all day within 2 km: no real gravity field
    // allows that, so Horizons' prediction there is a simplified one.
    const s0 = day[0], mu0 = CENTRES[c.centre].mu;
    const bound = Math.hypot(...s0.v) ** 2 / 2 - mu0 / Math.hypot(...s0.r) < 0;
    if (c.centre !== 'sun' && c.group !== 'lagrange' && bound && pick.m * c.fine === 1440 && pick.way === KEPLER) conic++;
    const nodes = pick.day.filter((_, j) => j % pick.m === 0);
    kept += nodes.length;
    const far = nodes.some((s) => Math.hypot(...s.r) > 1e5);
    const arr = far ? new Float64Array(nodes.length * 6) : new Float32Array(nodes.length * 6);
    nodes.forEach((s, k) => arr.set([...s.r, ...s.v], k * 6));
    const key = new Date(t).toISOString().slice(0, 7);
    if (!months.has(key)) months.set(key, { segments: [], chunks: [], bytes: 0 });
    const mo = months.get(key);
    // 8-byte alignment for float64.
    const pad = (8 - (mo.bytes % 8)) % 8;
    if (pad) { mo.chunks.push(new Uint8Array(pad)); mo.bytes += pad; }
    mo.segments.push([at, pick.way, CENTRE_KEYS.indexOf(pick.centre), t, pick.m * c.fine * 60, nodes.length - 1, mo.bytes, far ? 1 : 0]);
    mo.chunks.push(new Uint8Array(arr.buffer)); mo.bytes += arr.byteLength;
    // One held-out sample a month: mid-way between two nodes, about the
    // craft's own centre.
    if (pick.m > 1 && new Date(t).getUTCDate() === 15) {
      const j = Math.floor(pick.m / 2) + pick.m * Math.floor(day.length / pick.m / 2);
      if (j < day.length && j % pick.m) heldOut.push({ craft: c.key, t: day[j].t, centre: c.centre, r: day[j].r, v: day[j].v });
    }
  }
  const sp = [...spacing].sort((a, b) => a - b);
  craftOut.push({ key: c.key, name: c.name, short: c.short, id: c.id, group: c.group, centre: c.centre, target: name, revised, days, nodes: kept,
    spacingMin: sp.length ? [sp[0], sp[sp.length - 1]] : null, maxErrKm: +maxErr.toFixed(3), daysAllSamples: failed, conicDays: conic, legs });
  console.log(`${c.key.padEnd(12)} ${String(days).padStart(3)} days, ${String(kept).padStart(6)} states, every ${sp[0]}-${sp[sp.length - 1]} min, worst ${maxErr.toFixed(2)} km${failed ? `, ${failed} days with every sample` : ''}${conic ? `, ${conic} days one conic` : ''}${revised ? `; Horizons revised ${revised}` : ''}`);
}

let total = 0;
for (const [key, mo] of [...months].sort()) {
  const buf = Buffer.concat(mo.chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  await writeFile(join(OUT, `${key}.bin`), buf);
  await writeFile(join(OUT, `${key}.json`), JSON.stringify({ segments: mo.segments }));
  total += buf.length;
}
await writeFile(join(OUT, 'index.json'), `${JSON.stringify({
  source: 'JPL Horizons (ssd.jpl.nasa.gov/horizons), states about each centre, ICRF, UT',
  fetched: new Date().toISOString(), span: [new Date(START).toISOString(), new Date(END).toISOString()], tolKm: TOL_KM,
  centres: CENTRE_KEYS.map((k) => ({ key: k, naif: CENTRES[k].naif, mu: CENTRES[k].mu })),
  craft: craftOut, months: [...months.keys()].sort(),
}, null, 1)}\n`);
await writeFile(join(ROOT, 'src', 'physics', 'fixtures', 'spacecraft_horizons.json'), `${JSON.stringify({
  source: 'JPL Horizons API: states not kept by npm run fetch:spacecraft, one a month a craft, about the craft\'s own centre (ICRF, UT, km and km/s)',
  samples: heldOut,
})}\n`);
console.log(`${craftOut.length} craft, ${months.size} months, ${(total / 1e6).toFixed(2)} MB; ${heldOut.length} held-out samples`);
