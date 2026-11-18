// src/physics/satellites.fetch.mjs
//
// `npm run fetch:satellites`: a dated snapshot of CelesTrak's GP element
// sets (the orbits the US Space Force publishes for every tracked object,
// as OMM keywords), for the satellites layer (docs/frontend/satellites.md).
//
//   public/data/satellites.csv                 every active satellite, as CelesTrak sends it
//   public/data/satellites-debris.csv          the debris of the breakups CelesTrak lists
//   public/data/satellites-rocket-bodies.csv   spent rocket stages ("R/B" in the name)
//   public/data/satellites-analyst.csv         analyst objects: tracked, not identified
//   public/data/satellites.json                when it was fetched, the named ones,
//                                              the debris clouds and the counts
//
// The extra files are CelesTrak's CSV too, one header and the rows of the
// queries behind them, each object once (an object in an earlier file is
// left out of a later one).
//
// The named ones are drawn with their orbits and listed in the rail: the
// ISS, China's Tiangong (its core module Tianhe), the Hubble Space
// Telescope, the GPS and Galileo constellations, and the weather
// satellites in geostationary orbit.
//
// CelesTrak's usage policy (https://celestrak.org/usage-policy.php), which
// this follows:
// - GP data changes once every 2 hours, so nothing is fetched more often:
//   each answer is kept in ~/.cache/digital-orrery/celestrak/ and reused
//   while it is under 2 hours old;
// - FORMAT=csv (a third the size of JSON), compressed in transit;
// - any answer but HTTP 200 stops the script at once, with the answer
//   printed for a person to read, and no retry;
// - only what is used: nine queries, each a documented GP query
//   (https://celestrak.org/NORAD/documentation/gp-data-formats.php). The
//   debris clouds and the analyst objects are groups on CelesTrak's
//   Current Data page; it has no group for rocket bodies, so they come
//   from the NAME query ("parts of their name"), whose own example is
//   "COSMOS 2251 DEB": NAME=R/B. COSMOS 1408's debris (the 2021 test) is
//   no longer a group there, nearly all of it having come down.

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGpCsv, isGeostationary } from './satellites.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CACHE = join(homedir(), '.cache', 'digital-orrery', 'celestrak');
const BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const FRESH_MS = 2 * 3600e3;
const GROUPS = ['active', 'gps-ops', 'galileo', 'weather'];
// The breakups whose debris CelesTrak keeps as groups: the group, the
// parent's international designator (every piece is catalogued under its
// parent's launch), and the event. Sources in docs/frontend/satellites.md.
const CLOUDS = [
  { key: 'fengyun-1c', group: 'fengyun-1c-debris', name: 'Fengyun-1C', intdes: '1999-025', event: 'Destroyed by a Chinese anti-satellite missile', date: '2007-01-11' },
  { key: 'cosmos-2251', group: 'cosmos-2251-debris', name: 'Cosmos 2251', intdes: '1993-036', event: 'Collided with Iridium 33', date: '2009-02-10' },
  { key: 'iridium-33', group: 'iridium-33-debris', name: 'Iridium 33', intdes: '1997-051', event: 'Collided with Cosmos 2251', date: '2009-02-10' },
];
// Rocket bodies by name, and the analyst objects' group.
const ROCKET_BODIES = { key: 'name-R_B', param: 'NAME', value: 'R/B' };
const ANALYST = 'analyst';
// By catalogue number: the ISS (Zarya), Tianhe (Tiangong's core) and Hubble.
const NAMED_IDS = [
  { id: 25544, name: 'ISS', group: 'station' },
  { id: 48274, name: 'Tiangong', group: 'station' },
  { id: 20580, name: 'Hubble', group: 'science' },
];

// A GP query's answer: kept in the cache under key, or fetched.
async function group(name, param = 'GROUP', value = name) {
  await mkdir(CACHE, { recursive: true });
  const kept = (await readdir(CACHE)).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.csv')).sort().at(-1);
  if (kept) {
    const at = Number(kept.slice(name.length + 1, -4));
    if (Date.now() - at < FRESH_MS) {
      console.log(`${name}: from the cache (${((Date.now() - at) / 60e3).toFixed(0)} min old)`);
      return { text: await readFile(join(CACHE, kept), 'utf8'), at };
    }
  }
  const url = `${BASE}?${param}=${encodeURIComponent(value)}&FORMAT=csv`;
  // Node's fetch asks for gzip and brotli and unpacks them.
  const res = await fetch(url, { headers: { 'User-Agent': 'digital-orrery fetch:satellites' } });
  const text = await res.text();
  if (res.status !== 200) {
    console.error(`CelesTrak answered HTTP ${res.status} for ${url}; stopping, as its usage policy asks. Its answer:\n${text.slice(0, 2000)}`);
    process.exit(1);
  }
  const at = Date.now();
  await writeFile(join(CACHE, `${name}-${at}.csv`), text);
  console.log(`${name}: fetched, ${(text.length / 1024).toFixed(0)} KB`);
  return { text, at };
}

const fetched = {};
for (const g of GROUPS) fetched[g] = await group(g);
for (const c of CLOUDS) fetched[c.group] = await group(c.group);
fetched[ROCKET_BODIES.key] = await group(ROCKET_BODIES.key, ROCKET_BODIES.param, ROCKET_BODIES.value);
fetched[ANALYST] = await group(ANALYST);
const active = fetched.active;
const rows = parseGpCsv(active.text);
if (rows.length < 1000) throw new Error(`only ${rows.length} active satellites: not a full catalogue`);
const byId = new Map(rows.map((r) => [r.NORAD_CAT_ID, r]));

// The named ones, each once, in the rail's order.
const named = [];
const add = (id, name, grp) => {
  if (!byId.has(id) || named.some((n) => n.id === id)) return;
  named.push({ id, name, group: grp });
};
for (const n of NAMED_IDS) add(n.id, n.name, n.group);
const tidy = (s) => s.replace(/\s+/g, ' ').trim();
for (const r of parseGpCsv(fetched['gps-ops'].text)) add(r.NORAD_CAT_ID, tidy(r.OBJECT_NAME), 'gps');
for (const r of parseGpCsv(fetched.galileo.text)) add(r.NORAD_CAT_ID, tidy(r.OBJECT_NAME), 'galileo');
for (const r of parseGpCsv(fetched.weather.text)) if (isGeostationary(r)) add(r.NORAD_CAT_ID, tidy(r.OBJECT_NAME), 'weather');
for (const n of NAMED_IDS) if (!named.some((m) => m.id === n.id)) console.warn(`${n.name} (${n.id}) is not in the active list`);

const spread = (list) => {
  const e = list.map((r) => Date.parse(`${r.EPOCH}Z`)).filter(Number.isFinite).sort((a, b) => a - b);
  return { first: new Date(e[0]).toISOString(), median: new Date(e[e.length >> 1]).toISOString(), last: new Date(e.at(-1)).toISOString() };
};

// The debris, rocket bodies and analyst objects: each object once, in the
// first file it falls in (active, debris, rocket bodies, analyst).
const header = (text) => text.split(/\r?\n/, 1)[0].trim();
const seen = new Set(byId.keys());
// Each row with its line as CelesTrak sent it; a row the reader refuses
// (no catalogue number or mean motion) is left out and counted.
const keep = (text, test = () => true) => {
  const [head, ...body] = text.split(/\r?\n/).filter((l) => l.trim());
  if (head.trim() !== header(active.text)) throw new Error(`columns differ from the active group's: ${head}`);
  const out = [];
  let refused = 0;
  for (const line of body) {
    const r = parseGpCsv(`${head}\n${line}`)[0];
    if (!r) { refused++; continue; }
    if (!seen.has(r.NORAD_CAT_ID) && test(r)) { seen.add(r.NORAD_CAT_ID); out.push({ r, line }); }
  }
  if (refused) console.warn(`${refused} rows not read`);
  return out;
};
const debris = [], clouds = [];
for (const c of CLOUDS) {
  const got = keep(fetched[c.group].text);
  const stray = got.filter(({ r }) => !r.OBJECT_ID.startsWith(c.intdes));
  if (stray.length) throw new Error(`${c.group}: ${stray.length} not of ${c.intdes} (${stray[0].r.OBJECT_NAME}, ${stray[0].r.OBJECT_ID}); the app finds a cloud's pieces by its designator`);
  debris.push(...got);
  const { group: g, ...rest } = c;
  clouds.push({ ...rest, query: `${BASE}?GROUP=${g}&FORMAT=csv`, count: got.length, epochs: spread(got.map((x) => x.r)) });
}
// "R/B" as a word: the NAME query matches any part of a name.
const rocketBodies = keep(fetched[ROCKET_BODIES.key].text, (r) => /(^|[\s(])R\/B(\b|$)/.test(r.OBJECT_NAME));
const analyst = keep(fetched[ANALYST].text);
const layer = (key, list, query, at) => ({ file: `satellites-${key}.csv`, query, fetched: new Date(at).toISOString(), count: list.length, epochs: spread(list.map((x) => x.r)) });

const epochs = rows.map((r) => Date.parse(`${r.EPOCH}Z`)).filter(Number.isFinite).sort((a, b) => a - b);
const meta = {
  source: 'CelesTrak GP element sets (celestrak.org), from the US Space Force via Space-Track.org',
  query: `${BASE}?GROUP=active&FORMAT=csv`,
  fetched: new Date(active.at).toISOString(),
  count: rows.length,
  epochs: { first: new Date(epochs[0]).toISOString(), median: new Date(epochs[epochs.length >> 1]).toISOString(), last: new Date(epochs.at(-1)).toISOString() },
  named,
  layers: {
    debris: { ...layer('debris', debris, CLOUDS.map((c) => `${BASE}?GROUP=${c.group}&FORMAT=csv`).join(' '), Math.min(...CLOUDS.map((c) => fetched[c.group].at))), clouds },
    'rocket-bodies': layer('rocket-bodies', rocketBodies, `${BASE}?NAME=${encodeURIComponent(ROCKET_BODIES.value)}&FORMAT=csv`, fetched[ROCKET_BODIES.key].at),
    analyst: layer('analyst', analyst, `${BASE}?GROUP=${ANALYST}&FORMAT=csv`, fetched[ANALYST].at),
  },
};
// CelesTrak ends its lines with CRLF; the repository keeps LF.
await writeFile(join(ROOT, 'public', 'data', 'satellites.csv'), active.text.replace(/\r\n/g, '\n'));
for (const [key, list] of [['debris', debris], ['rocket-bodies', rocketBodies], ['analyst', analyst]]) {
  await writeFile(join(ROOT, 'public', 'data', `satellites-${key}.csv`), `${[header(active.text), ...list.map((x) => x.line)].join('\n')}\n`);
}
await writeFile(join(ROOT, 'public', 'data', 'satellites.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(`${rows.length} satellites, ${named.length} named (${['station', 'science', 'gps', 'galileo', 'weather'].map((g) => `${named.filter((n) => n.group === g).length} ${g}`).join(', ')}); median epoch ${meta.epochs.median}`);
console.log(`debris: ${debris.length} (${clouds.map((c) => `${c.name} ${c.count}`).join(', ')}); rocket bodies: ${rocketBodies.length}; analyst objects: ${analyst.length}`);
