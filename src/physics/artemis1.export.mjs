// src/physics/artemis1.export.mjs
//
// Writes public/missions/artemis1.json, Artemis I for the app's Real
// missions (docs/frontend/mission.md#real-missions), in the same form as
// Artemis II's (artemis2.export.mjs): Orion's flown state at the start, its
// burns as flown, and the flown trajectory.
//
//   npm run export:artemis1      (after npm run fetch:artemis1)
//
// The source is NASA/JSC navigation's as-flown ephemeris through JPL
// Horizons, from just after the translunar injection burn (16 Nov 2022
// 08:47 UTC) to just before entry (11 Dec 17:19): Orion every minute (the
// cache artemis1.fetch.mjs keeps in ~/.cache/digital-orrery/artemis1) and
// every 5 s through the six large burns (fixtures/artemis1.json).
//
// - The flown path: every 10 minutes; every 2 minutes within 30,000 km of
//   the Earth; every minute within 15,000 km of it, within 8,000 km of the
//   Moon and through every event; and every 5 s through the large burns.
//   Interpolated between them it is within 8 m of every minute left out.
// - The burns: NASA's 18 (artemis1.lib.mjs). The six large ones, sampled
//   every 5 s, as each 5 s interval's change beyond gravity, as Artemis II's
//   are. The twelve small ones, which only the minutes resolve, as one steady
//   push over NASA's duration from NASA's ignition time, along the change
//   their whole event shows. Each is steered in the orbital frame about the
//   body whose sphere of influence holds it (the Moon for the flybys and the
//   distant retrograde orbit), as Orion's were.

import './deNode.js';
import fs from 'node:fs';
import { NASA_BURNS, parseHorizons } from './artemis1.lib.mjs';
import { helioOf, geocentric, sys, kt, vnb } from './artemis2.lib.mjs';
import { advance } from './nbody.js';
import { helioStateEqj } from './ephemeris.js';
import { RealMission } from './realMission.js';

const CACHE = `${process.env.HOME}/.cache/digital-orrery/artemis1/2022-11-16-08-47_2022-12-11-17-19_1m.txt`;
if (!fs.existsSync(CACHE)) throw new Error(`no ${CACHE}: run npm run fetch:artemis1 first`);
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/artemis1.json', import.meta.url)));
const row = (s) => ({ ms: Date.parse(s[0]), r: s.slice(1, 4), v: s.slice(4, 7) });
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const r6 = (x) => Math.round(x * 1e6) / 1e6, r9 = (x) => Math.round(x * 1e9) / 1e9;
const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 };
const MOON_SOI = 66100;

// Gravity alone from state a to time ms; geocentric result.
function coast(a, ms) {
  const s = helioOf(a);
  advance(s, kt(ms), opts);
  return geocentric(s, ms);
}
// The Moon's geocentric state.
const moonAt = (ms) => {
  const m = helioStateEqj('moon', new Date(ms)), e = helioStateEqj('earth', new Date(ms));
  return { r: sub(m.r, e.r), v: sub(m.v, e.v) };
};
// The state halfway between two samples h seconds apart, by cubic Hermite.
const hermiteMid = (a, b, h) => ({
  r: [0, 1, 2].map((k) => (a.r[k] + b.r[k]) / 2 + (a.v[k] - b.v[k]) * h / 8),
  v: [0, 1, 2].map((k) => 1.5 * (b.r[k] - a.r[k]) / h - (a.v[k] + b.v[k]) / 4),
});
// The orbital frame about a body at a geocentric state and time.
const frameAbout = (about, p, ms) => {
  if (about === 'earth') return vnb(p.r, p.v);
  const m = moonAt(ms);
  return vnb(sub(p.r, m.r), sub(p.v, m.v));
};

// ---------------- the flown path ----------------
const minutes = parseHorizons(fs.readFileSync(CACHE, 'utf8')).map(row);
const eventMs = fx.events.map((e) => [Date.parse(e.minutes[0][0]), Date.parse(e.minutes.at(-1)[0])]);
const fine = fx.burns5s.map(row);
const keep = (p, i) => i === 0 || i === minutes.length - 1 || p.ms % 600e3 === 0 || (norm(p.r) < 30000 && p.ms % 120e3 === 0) || norm(p.r) < 15000 ||
  norm(sub(p.r, moonAt(p.ms).r)) < 8000 || eventMs.some(([a, b]) => p.ms >= a - 60e3 && p.ms <= b + 60e3);
const byMs = new Map();
minutes.forEach((p, i) => { if (keep(p, i)) byMs.set(p.ms, p); });
for (const p of fine) byMs.set(p.ms, p);
const flown = [...byMs.values()].sort((a, b) => a.ms - b.ms);

// ---------------- the burns ----------------
const windows = [[]];
fine.forEach((x, i) => { if (i && x.ms - fine[i - 1].ms > 10e3) windows.push([]); windows.at(-1).push(x); });
const eventOf = (ms) => fx.events.find((e) => Date.parse(e.minutes[0][0]) <= ms && ms <= Date.parse(e.minutes.at(-1)[0]));

const burns = NASA_BURNS.map((nb) => {
  const at = minutes.reduce((best, p) => (Math.abs(p.ms - nb.ms) < Math.abs(best.ms - nb.ms) ? p : best));
  const about = norm(sub(at.r, moonAt(at.ms).r)) < MOON_SOI ? 'moon' : 'earth';
  const w = windows.find((x) => x[0].ms <= nb.ms && nb.ms <= x.at(-1).ms);
  let intervals, dvTotal;
  if (w) {
    // Each 5 s interval's change beyond gravity; the burn runs from the
    // first interval over a twentieth of the peak to the last.
    const steps = w.slice(0, -1).map((a, i) => {
      const b = w[i + 1], sec = (b.ms - a.ms) / 1000, dv = sub(b.v, coast(a, b.ms).v);
      return { a, b, sec, dv, acc: norm(dv) / sec };
    });
    const peak = Math.max(...steps.map((s) => s.acc));
    const on = steps.map((s) => s.acc > peak / 20);
    const first = on.indexOf(true), last = on.lastIndexOf(true);
    const used = steps.slice(first, last + 1);
    dvTotal = used.reduce((acc, s) => add(acc, s.dv), [0, 0, 0]);
    intervals = used.map((s) => {
      const mid = hermiteMid(s.a, s.b, s.sec), L = frameAbout(about, mid, (s.a.ms + s.b.ms) / 2), m = norm(s.dv);
      return [s.a.ms, s.b.ms, ...L.map((ax) => Math.round(dot(s.dv, ax) / m * 1e6) / 1e6), Math.round(s.acc * 1e9) / 1e6];
    });
  } else {
    // The whole event's change beyond gravity, minute by minute, as one
    // steady push over NASA's duration.
    const m = eventOf(nb.ms).minutes.map(row);
    dvTotal = m.slice(0, -1).reduce((acc, a, i) => add(acc, sub(m[i + 1].v, coast(a, m[i + 1].ms).v)), [0, 0, 0]);
    const L = frameAbout(about, at, at.ms), mag = norm(dvTotal);
    intervals = [[nb.ms, nb.ms + nb.s * 1000, ...L.map((ax) => Math.round(dot(dvTotal, ax) / mag * 1e6) / 1e6), Math.round(mag / nb.s * 1e9) / 1e6]];
  }
  const mps = norm(dvTotal) * 1000;
  return {
    key: nb.name, name: nb.name, about, mps: Math.round(mps * 1e3) / 1e3,
    nasa: `${nb.ftps} ft/s (${(nb.dv * 1000).toFixed(2)} m/s) over ${nb.s} s on the ${nb.engine === 'OMS-E' ? 'main engine' : nb.engine === 'aux' ? 'auxiliary thrusters' : 'reaction control thrusters'}, AAS 23-363`,
    intervals,
  };
});

// ---------------- the flybys ----------------
const closest = (from, to) => {
  let best = null;
  for (const p of [...minutes, ...fine]) {
    if (p.ms < Date.parse(from) || p.ms > Date.parse(to)) continue;
    const d = norm(sub(p.r, moonAt(p.ms).r));
    if (!best || d < best.d) best = { d, ms: p.ms };
  }
  return { altitudeKm: Math.round((best.d - 1737.4) * 10) / 10, utc: new Date(best.ms).toISOString().slice(0, 19) + 'Z' };
};

const start = flown[0];
const out = {
  name: 'Artemis I',
  craft: 'Orion (Artemis I)',
  summary: 'Uncrewed flight to a distant retrograde orbit about the Moon, 16 November to 11 December 2022. Starts just after translunar injection; every burn is flown as Orion flew it.',
  source: 'NASA/JSC navigation as-flown ephemeris Post_TLI_Orion_AsFlown_20221213_EPH_OEM, via JPL Horizons (-1023); burns from it and from AAS 23-363, by src/physics/artemis1.export.mjs',
  frame: 'J2000 equatorial (EQJ), geocentric, km and km/s',
  start: { ms: start.ms, r: start.r.map(r6), v: start.v.map(r9) },
  endMs: flown.at(-1).ms,
  flyby: closest('2022-11-21T00:00Z', '2022-11-22T00:00Z'),
  returnFlyby: closest('2022-12-05T00:00Z', '2022-12-06T00:00Z'),
  burns,
  // [ms, x, y, z, vx, vy, vz]
  flown: flown.map((p) => [p.ms, ...p.r.map(r6), ...p.v.map(r9)]),
};
const path = new URL('../../public/missions/artemis1.json', import.meta.url);
fs.writeFileSync(path, JSON.stringify(out));

// How well the file's samples carry the path: every minute left out,
// interpolated from those kept.
const file = new RealMission(out);
let worst = 0, worstAt = 0;
for (const p of minutes) {
  if (byMs.has(p.ms)) continue;
  const d = norm(sub(file.flownAt(p.ms).r, p.r));
  if (d > worst) { worst = d; worstAt = p.ms; }
}
console.log('burn                       about   ours m/s   NASA m/s   intervals');
for (const [i, b] of burns.entries()) console.log(`${b.name.padEnd(26)} ${b.about.padEnd(6)} ${b.mps.toFixed(3).padStart(9)} ${(NASA_BURNS[i].dv * 1000).toFixed(3).padStart(10)}   ${b.intervals.length}`);
console.log(`flybys: ${out.flyby.altitudeKm} km at ${out.flyby.utc}, ${out.returnFlyby.altitudeKm} km at ${out.returnFlyby.utc}`);
console.log(`interpolation between the kept samples: worst ${(worst * 1000).toFixed(1)} m (${new Date(worstAt).toISOString()})`);
console.log(`wrote ${path.pathname}: ${burns.length} burns, ${flown.length} flown samples, ${(fs.statSync(path).size / 1024).toFixed(0)} kB`);
