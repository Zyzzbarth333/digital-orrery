// src/physics/artemis2.export.mjs
//
// Writes public/missions/artemis2.json, the Artemis II mission the app loads
// (docs/frontend/mission.md#real-missions): Orion's flown state before
// translunar injection, its burns as flown (each 5 s interval's direction
// in the orbital frame about Earth and its acceleration, reconstructed from
// JSC's BET by artemis2.lib.mjs), what NASA published about each, and the
// flown trajectory (for the comparison and tracking fixes).
//
//   node src/physics/artemis2.export.mjs

import fs from 'node:fs';
import { rows, fineRows, nearRows, reconstructBurns, matchNasa } from './artemis2.lib.mjs';

const START = '2026-04-02T23:39:00Z', END = '2026-04-10T23:29:00Z';
const r3 = (x) => Math.round(x * 1e3) / 1e3, r7 = (x) => Math.round(x * 1e7) / 1e7;
const NAMES = { TLI: 'Translunar injection', 'trim-1': 'Trim', 'trim-2': 'Trim', OTC: 'Outbound correction', 'RTC-1': 'Return correction 1', 'RTC-2': 'Return correction 2', 'RTC-3': 'Return correction 3' };

// The flown trajectory: every 10 minutes, every minute near Earth, every 5 s
// through each burn, so cubic interpolation never bridges a burn and stays
// within metres near Earth.
const byMs = new Map();
for (const p of [...rows, ...nearRows, ...fineRows]) byMs.set(p.ms, p);
const flown = [...byMs.values()].filter((p) => p.ms >= Date.parse(START) && p.ms <= Date.parse(END)).sort((a, b) => a.ms - b.ms);
const start = flown[0];
const burns = matchNasa(reconstructBurns()).map((b) => ({
  key: b.key,
  name: NAMES[b.key] ?? b.key,
  mps: Math.round(b.mag * 1e6) / 1e3,
  nasa: b.nasa ? b.nasa.note : null,
  // [t0 ms, t1 ms, prograde, in-plane, normal, acceleration m/s^2]
  intervals: b.profile.map((x) => [x.t0, x.t1, ...x.dir.map((d) => Math.round(d * 1e6) / 1e6), Math.round(x.a * 1e9) / 1e6]),
}));

const out = {
  name: 'Artemis II',
  craft: 'Orion (Artemis II)',
  summary: 'Crewed lunar flyby, 2-10 April 2026. Starts in high Earth orbit ten minutes before translunar injection; every burn is flown as Orion flew it.',
  source: 'JSC/FOD/NAV best estimated trajectory BET revF, via NAIF art002_rec_260402_260410_jsc_bet_revf.bsp; burns reconstructed by src/physics/artemis2.lib.mjs',
  frame: 'J2000 equatorial (EQJ), geocentric, km and km/s',
  start: { ms: start.ms, r: start.r.map(r3), v: start.v.map(r7) },
  endMs: flown.at(-1).ms,
  flyby: { altitudeKm: 6545.0, utc: '2026-04-06T23:00:49Z' },
  burns,
  // [ms, x, y, z, vx, vy, vz]
  flown: flown.map((p) => [p.ms, ...p.r.map(r3), ...p.v.map(r7)]),
};
const path = new URL('../../public/missions/artemis2.json', import.meta.url);
fs.mkdirSync(new URL('.', path), { recursive: true });
fs.writeFileSync(path, JSON.stringify(out));
console.log(`wrote ${path.pathname}: ${burns.length} burns, ${burns.reduce((n, b) => n + b.intervals.length, 0)} intervals, ${out.flown.length} flown samples, ${(fs.statSync(path).size / 1024).toFixed(0)} kB`);
