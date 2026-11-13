// src/physics/artemis1.fetch.mjs
//
// Builds src/physics/fixtures/artemis1.json from Artemis I's flown
// trajectory in JPL Horizons (object -1023, "Artemis I / Spacecraft"),
// whose source is NASA/JSC navigation's as-flown ephemeris,
// Post_TLI_Orion_AsFlown_20221213_EPH_OEM: 16 Nov 2022 08:46 to 11 Dec
// 17:20 TDB, after the translunar injection burn to just before entry.
// NAIF holds no Artemis I kernel; this is the published source.
//
//   npm run fetch:artemis1
//
// Horizons' answers are cached in ~/.cache/digital-orrery/artemis1: Orion
// every minute for the whole flight (Earth-centred, ICRF axes, km, km/s,
// UTC), and every 5 s around the six large burns.
//
// The ephemeris is NASA's navigation solutions joined end to end. Each
// piece is a prediction from one orbit determination, so between events
// it is smooth; the events are Orion's burns and the joins, where the next
// solution takes over with a small step in velocity. Every minute is
// flown by the app's kernel and compared with the next: a minute whose
// velocity differs by more than 5 mm/s marks an event (minutes within 5
// of each other are one event). A burn spreads over minutes; a join is a
// single step, so an event whose largest minute holds more than 1.5 times
// its whole change is a join. The fixture keeps, for each event, Orion
// every minute through it, and so the coast arcs between events; the 5 s samples of the six large burns; the track every 30
// minutes; and the farthest point from Earth.

import './deNode.js';
import fs from 'node:fs';
import dns from 'node:dns';
import { createState, advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS, kernelSeconds, kernelMs } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';

dns.setDefaultResultOrder('ipv4first');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const CACHE = `${process.env.HOME}/.cache/digital-orrery/artemis1`;
fs.mkdirSync(CACHE, { recursive: true });

// Windows (UTC) around the six large burns found in the minute data,
// sampled every 5 s: the outbound correction (16 Nov), the outbound powered
// flyby (21 Nov), DRO insertion (25 Nov), the DRO maintenance burn
// (30 Nov), DRO departure (1 Dec) and the return powered flyby (5 Dec).
export const BURN_WINDOWS = [
  ['2022-11-16 14:25', '2022-11-16 14:45'], ['2022-11-21 12:30', '2022-11-21 13:00'],
  ['2022-11-25 21:45', '2022-11-25 22:05'], ['2022-11-30 21:45', '2022-11-30 22:05'],
  ['2022-12-01 21:45', '2022-12-01 22:05'], ['2022-12-05 16:30', '2022-12-05 17:00'],
];

// step: '1m', or 's5' for every 5 s (Horizons takes no seconds unit, so
// it is asked for that many equal intervals).
async function vectors(start, stop, step) {
  const span = (Date.parse(stop.replace(' ', 'T') + 'Z') - Date.parse(start.replace(' ', 'T') + 'Z')) / 1000;
  const stepSize = step.startsWith('s') ? String(Math.round(span / Number(step.slice(1)))) : step;
  const q = {
    format: 'text', COMMAND: "'-1023'", EPHEM_TYPE: "'VECTORS'", CENTER: "'500@399'",
    REF_PLANE: "'FRAME'", REF_SYSTEM: "'ICRF'", VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'",
    CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'UT'", TIME_DIGITS: "'FRACSEC'",
    START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: `'${stepSize}'`,
  };
  const name = `${CACHE}/${start}_${stop}_${step}.txt`.replace(/[ :]/g, '-');
  let text;
  if (fs.existsSync(name)) text = fs.readFileSync(name, 'utf8');
  else {
    const url = `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'digital-orrery trajectory validation' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    fs.writeFileSync(name, text);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const i0 = text.indexOf('$$SOE'), i1 = text.indexOf('$$EOE');
  if (i0 < 0 || i1 < 0) { fs.unlinkSync(name); throw new Error(`no data from Horizons for ${start} to ${stop}:\n${text.slice(-500)}`); }
  const body = text.slice(i0 + 5, i1).trim();
  // JDUT, calendar, X, Y, Z, VX, VY, VZ
  return body.split('\n').map((line) => {
    const f = line.split(',').map((s) => s.trim());
    const ms = (Number(f[0]) - 2440587.5) * 86400e3;
    return [new Date(Math.round(ms)).toISOString(), ...f.slice(2, 8).map(Number)];
  });
}

const SOURCE = 'JPL Horizons, Artemis I (-1023): NASA/JSC navigation as-flown ephemeris Post_TLI_Orion_AsFlown_20221213_EPH_OEM';
const flown = await vectors('2022-11-16 08:47', '2022-12-11 17:19', '1m');
const burns = [];
for (const [a, b] of BURN_WINDOWS) burns.push(...await vectors(a, b, 's5'));
const rows = flown.map((s) => ({ ms: Date.parse(s[0]), r: s.slice(1, 4), v: s.slice(4, 7) }));

// Fly every minute with the kernel.
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const kt = (ms) => kernelSeconds(new Date(ms));
const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 };
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const minute = [];
for (let i = 0; i + 1 < rows.length; i++) {
  const e0 = helioStateEqj('earth', new Date(rows[i].ms));
  const s = createState(rows[i].r.map((x, k) => x + e0.r[k]), rows[i].v.map((x, k) => x + e0.v[k]), kt(rows[i].ms));
  advance(s, kt(rows[i + 1].ms), opts);
  const e1 = helioStateEqj('earth', new Date(rows[i + 1].ms));
  minute.push([0, 1, 2].map((k) => rows[i + 1].v[k] - (s.v[k] - e1.v[k])));
}
const events = [];
minute.forEach((dv, i) => {
  if (norm(dv) <= 5e-6) return;
  const e = events.at(-1);
  if (e && i - e.b <= 5) { e.b = i; e.peak = Math.max(e.peak, norm(dv)); } else events.push({ a: i, b: i, peak: norm(dv) });
});
for (const e of events) {
  const net = [0, 0, 0];
  for (let i = e.a; i <= e.b; i++) for (let k = 0; k < 3; k++) net[k] += minute[i][k];
  e.kind = e.peak <= 1.5 * norm(net) ? 'burn' : 'join';
}
const state = (i) => flown[i].map((x, k) => (k ? Number(x.toPrecision(13)) : x));
let far = 0;
rows.forEach((x, i) => { if (norm(x.r) > norm(rows[far].r)) far = i; });
const out = {
  source: SOURCE, url: 'https://ssd.jpl.nasa.gov/horizons/',
  frame: 'ICRF (J2000 equatorial), Earth-centred, km and km/s, UTC', fields: ['utc', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
  // Each event: kind, and Orion's state every minute from the minute it
  // starts to a minute after it ends (the next arc starts from the last).
  events: events.map((e) => ({ kind: e.kind, minutes: Array.from({ length: Math.min(rows.length - 1, e.b + 2) - e.a + 1 }, (_, k) => state(e.a + k)) })),
  first: state(0), last: state(rows.length - 1),
  burns5s: burns.map((s) => s.map((x, k) => (k ? Number(x.toPrecision(11)) : x))),
  track30: flown.filter((_, i) => i % 30 === 0).map((s) => s.map((x, k) => (k ? Number(x.toPrecision(10)) : x))),
  farthest: state(far),
};
const path = new URL('./fixtures/artemis1.json', import.meta.url);
fs.writeFileSync(path, JSON.stringify(out));
console.log(`${events.length} events (${events.filter((e) => e.kind === 'burn').length} burns); wrote fixtures/artemis1.json, ${(fs.statSync(path).size / 1024).toFixed(0)} kB`);
