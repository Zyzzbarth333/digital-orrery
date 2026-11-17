// src/physics/satellites.fetch.mjs
//
// `npm run fetch:satellites`: a dated snapshot of CelesTrak's GP element
// sets (the orbits the US Space Force publishes for every tracked object,
// as OMM keywords), for the satellites layer (docs/frontend/satellites.md).
//
//   public/data/satellites.csv    every active satellite, as CelesTrak sends it
//   public/data/satellites.json   when it was fetched, and the named ones
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
// - only what is used: four group queries.

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
// By catalogue number: the ISS (Zarya), Tianhe (Tiangong's core) and Hubble.
const NAMED_IDS = [
  { id: 25544, name: 'ISS', group: 'station' },
  { id: 48274, name: 'Tiangong', group: 'station' },
  { id: 20580, name: 'Hubble', group: 'science' },
];

async function group(name) {
  await mkdir(CACHE, { recursive: true });
  const kept = (await readdir(CACHE)).filter((f) => f.startsWith(`${name}-`) && f.endsWith('.csv')).sort().at(-1);
  if (kept) {
    const at = Number(kept.slice(name.length + 1, -4));
    if (Date.now() - at < FRESH_MS) {
      console.log(`${name}: from the cache (${((Date.now() - at) / 60e3).toFixed(0)} min old)`);
      return { text: await readFile(join(CACHE, kept), 'utf8'), at };
    }
  }
  const url = `${BASE}?GROUP=${encodeURIComponent(name)}&FORMAT=csv`;
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

const epochs = rows.map((r) => Date.parse(`${r.EPOCH}Z`)).filter(Number.isFinite).sort((a, b) => a - b);
const meta = {
  source: 'CelesTrak GP element sets (celestrak.org), from the US Space Force via Space-Track.org',
  query: `${BASE}?GROUP=active&FORMAT=csv`,
  fetched: new Date(active.at).toISOString(),
  count: rows.length,
  epochs: { first: new Date(epochs[0]).toISOString(), median: new Date(epochs[epochs.length >> 1]).toISOString(), last: new Date(epochs.at(-1)).toISOString() },
  named,
};
// CelesTrak ends its lines with CRLF; the repository keeps LF.
await writeFile(join(ROOT, 'public', 'data', 'satellites.csv'), active.text.replace(/\r\n/g, '\n'));
await writeFile(join(ROOT, 'public', 'data', 'satellites.json'), `${JSON.stringify(meta, null, 1)}\n`);
console.log(`${rows.length} satellites, ${named.length} named (${['station', 'science', 'gps', 'galileo', 'weather'].map((g) => `${named.filter((n) => n.group === g).length} ${g}`).join(', ')}); median epoch ${meta.epochs.median}`);
