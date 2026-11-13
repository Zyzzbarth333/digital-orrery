// src/physics/artemis1.validate.mjs
//
// Artemis I flown by the app's kernel against NASA's as-flown trajectory
// (docs/validation/artemis1.md). The reference is NASA/JSC navigation's
// as-flown ephemeris through JPL Horizons (fixtures/artemis1.json,
// npm run fetch:artemis1): Orion from after the translunar injection burn
// (16 Nov 2022) to just before entry (11 Dec).
//
// That ephemeris is NASA's navigation solutions joined end to end, each a
// prediction from one orbit determination. Between events (burns, and the
// joins where the next solution takes over) it is NASA's own propagation,
// so the coast arcs compare the kernel with NASA's flight-dynamics model;
// the steps at the joins show how far the real flight drifted from each
// prediction.

import fs from 'node:fs';
import { helioOf, geocentric, sys, kt, MOON_RADIUS } from './artemis2.lib.mjs';
import { advance } from './nbody.js';
import { helioStateEqj } from './ephemeris.js';
import { makeEnvironment } from './environment.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/artemis1.json', import.meta.url)));
const row = (s) => ({ ms: Date.parse(s[0]), r: s.slice(1, 4), v: s.slice(4, 7) });
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const hhmm = (ms) => new Date(ms).toISOString().slice(5, 19).replace('T', ' ');
const FT = 0.3048, MILE = 1.609344, RE = 6378.137;
const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 };

// Gravity alone from state a to time ms; geocentric result.
function coast(a, ms, env = null) {
  const s = helioOf(a);
  advance(s, kt(ms), env ? { ...opts, extraAccel: (t, r, out, mid, v) => { out[0] = out[1] = out[2] = 0; return env(t, r, v, out); }, stepCap: env.stepCap } : opts);
  return geocentric(s, ms);
}
const moonAt = (ms) => sub(helioStateEqj('moon', new Date(ms)).r, helioStateEqj('earth', new Date(ms)).r);

// NASA's as-flown burns: ignition (UTC) and delta-v from the post-flight
// review column of AAS 23-363 (Table 1, Fig. 7), duration and engine from
// Belair et al. (Artemis I engine performance, Table 1). OMS-E: the main
// engine; aux: auxiliary thrusters; RCS: reaction control.
const AAS = 'https://ntrs.nasa.gov/api/citations/20230010480/downloads/AAS_23-363_artemis1-operations_rev2.pdf';
const NASA_BURNS = [
  ['OTC-1', '2022-11-16T14:32:39Z', 114.67, 30.5, 'OMS-E'], ['OTC-2', '2022-11-17T11:32:39Z', 0.73, 8.6, 'RCS'],
  ['OTC-3', '2022-11-20T12:12:44Z', 2.87, 5.5, 'aux'], ['OTC-4', '2022-11-21T06:44:14Z', 0.71, 7.5, 'RCS'],
  ['Outbound powered flyby', '2022-11-21T12:44:14Z', 586.09, 149.6, 'OMS-E'], ['OTC-5', '2022-11-22T06:02:44Z', 3.21, 5.6, 'aux'],
  ['OTC-6', '2022-11-24T21:52:28Z', 8.79, 15.2, 'aux'], ['DRO insertion', '2022-11-25T21:52:28Z', 362.99, 87.9, 'OMS-E'],
  ['DRO maintenance 1', '2022-11-26T21:52:28Z', 0.05, 1.23, 'RCS'], ['DRO maintenance 3', '2022-11-30T21:53:56Z', 43.37, 94.9, 'aux'],
  ['DRO departure', '2022-12-01T21:53:56Z', 454.34, 105.1, 'OMS-E'], ['RTC-1', '2022-12-02T03:53:56Z', 0.48, 4.8, 'RCS'],
  ['RTC-2', '2022-12-04T16:43:20Z', 1.71, 17, 'RCS'], ['RTC-3', '2022-12-05T10:43:20Z', 2.05, 21.92, 'RCS'],
  ['Return powered flyby', '2022-12-05T16:43:20Z', 960.97, 207.1, 'OMS-E'], ['RTC-4', '2022-12-06T10:43:20Z', 0.50, 5, 'RCS'],
  ['RTC-5', '2022-12-10T20:20:14Z', 5.00, 7.2, 'aux'], ['RTC-6', '2022-12-11T12:20:14Z', 0.98, 8.4, 'RCS'],
].map(([name, utc, ftps, s, engine]) => ({ name, ms: Date.parse(utc), dv: ftps * FT / 1000, s, engine }));

// Every minute of every event, carried a minute by gravity alone: what is
// left in the next minute's velocity is the thrust (or the join's step).
const events = fx.events.map((e) => {
  const m = e.minutes.map(row);
  const steps = m.slice(0, -1).map((x, i) => { const g = coast(x, m[i + 1].ms); return { ms: x.ms, dv: sub(m[i + 1].v, g.v), dr: sub(m[i + 1].r, g.r) }; });
  const sum = (f, list = steps) => list.reduce((acc, x) => [acc[0] + f(x)[0], acc[1] + f(x)[1], acc[2] + f(x)[2]], [0, 0, 0]);
  return { kind: e.kind, a: m[0], b: m.at(-1), steps, dv: sum((x) => x.dv), dr: sum((x) => x.dr), sum };
});
// A burn's delta-v: the whole event's. Horizons' interpolation of the
// ephemeris rings around a burn, so single minutes swing either side of
// the thrust and only the event as a whole adds up.
const burnDv = (e) => norm(e.dv);

header("CASE 1: the burns, against NASA's as-flown figures");
console.log('  burn                     NASA ignition     dv NASA       ours        difference   engine');
const found = new Set();
let worstBig = 0, worstSmall = 0;
for (const nb of NASA_BURNS) {
  const e = events.find((x) => x.a.ms <= nb.ms && nb.ms <= x.b.ms);
  if (!e) { console.log(`  ${nb.name.padEnd(24)} ${hhmm(nb.ms)}  not found`); continue; }
  found.add(e);
  const ours = burnDv(e), d = ours - nb.dv;
  if (nb.dv > 0.001) worstBig = Math.max(worstBig, Math.abs(d / nb.dv));
  else worstSmall = Math.max(worstSmall, Math.abs(d));
  console.log(`  ${nb.name.padEnd(24)} ${hhmm(nb.ms)}  ${(nb.dv * 1000).toFixed(3).padStart(8)} m/s ${(ours * 1000).toFixed(3).padStart(8)} m/s  ${(d * 1000 >= 0 ? '+' : '') + (d * 1000).toFixed(3).padStart(7)} m/s  ${nb.engine}`);
}
const extra = events.filter((e) => e.kind === 'burn' && !found.has(e));
// The last hours before entry, inside 50,000 km, show 6.7 m/s that no
// burn accounts for; likely the ephemeris's own sampling close to Earth.
for (const e of extra) console.log(`  not in NASA's list: ${hhmm(e.a.ms)} to ${hhmm(e.b.ms)}, ${(norm(e.dv) * 1000).toFixed(3)} m/s${norm(e.a.r) < 50000 ? ' (final approach inside 50,000 km: likely the ephemeris\'s own sampling near Earth)' : ''}`);
check('every one of NASA\'s 18 burns is found in the trajectory', found.size === NASA_BURNS.length);
check('delta-v within 1 % of NASA\'s for every burn over 1 m/s', worstBig < 0.01);
const small = NASA_BURNS.filter((nb) => nb.dv * 1000 <= 1);
const worstUnder1 = Math.max(...small.map((nb) => { const e = events.find((x) => x.a.ms <= nb.ms && nb.ms <= x.b.ms); return Math.abs(burnDv(e) - nb.dv); }));
// OTC-5 (0.98 m/s) has a 0.04 m/s thrust three minutes after it, which
// the minute sampling cannot separate, so the small burns are held to
// 0.05 m/s.
console.log(`  burns under 1 m/s: worst ${(worstUnder1 * 1000).toFixed(3)} m/s off`);
check('burns under 1 m/s within 0.05 m/s (OTC-5 carries a 0.04 m/s thrust 3 minutes later)', worstUnder1 < 0.05e-3);

// Ignition from the 5 s samples: the first step whose acceleration beyond
// gravity exceeds half the burn's peak (DRO insertion, for one, starts
// with a minute of lower thrust before the main engine).
const fine = fx.burns5s.map(row);
const windows = [[]];
fine.forEach((x, i) => { if (i && x.ms - fine[i - 1].ms > 10e3) windows.push([]); windows.at(-1).push(x); });
let worstIgn = 0;
for (const w of windows) {
  const acc = w.slice(0, -1).map((x, i) => ({ ms: x.ms, a: norm(sub(w[i + 1].v, coast(x, w[i + 1].ms).v)) * 1000 / ((w[i + 1].ms - x.ms) / 1000) }));
  const peak = Math.max(...acc.map((x) => x.a));
  const ign = acc.find((x) => x.a > peak / 2)?.ms ?? null;
  const nb = NASA_BURNS.find((x) => Math.abs(x.ms - (ign ?? 0)) < 300e3);
  const off = ign !== null && nb ? (ign - nb.ms) / 1000 : NaN;
  if (Number.isFinite(off)) worstIgn = Math.max(worstIgn, Math.abs(off));
  console.log(`  ${(nb?.name ?? '?').padEnd(24)} ignition in the 5 s samples ${ign ? hhmm(ign) : 'not found'} (${Number.isFinite(off) ? `${off >= 0 ? '+' : ''}${off} s against NASA` : 'no match'})`);
}
check('the six large burns ignite within 10 s of NASA\'s times (5 s samples)', windows.length === 6 && worstIgn <= 10);

header('CASE 2: the joins between navigation solutions');
const joins = events.filter((e) => e.kind === 'join');
const jdv = joins.map((e) => norm(e.dv) * 1000).sort((a, b) => a - b), jdr = joins.map((e) => norm(e.dr) * 1000).sort((a, b) => a - b);
console.log(`  ${joins.length} joins: velocity steps ${jdv[0].toFixed(3)} to ${jdv.at(-1).toFixed(3)} m/s (median ${jdv[jdv.length >> 1].toFixed(3)}), position steps median ${jdr[jdr.length >> 1].toFixed(0)} m, largest ${jdr.at(-1).toFixed(0)} m`);
console.log('  (each is the next orbit determination correcting the last prediction: how far the real flight drifted from it)');

header('CASE 3: coast arcs between events, flown by the kernel');
// From each event's "after" state to the next event's "before" state (and
// from the start, and to the end).
const arcs = [];
const starts = [row(fx.first), ...events.map((e) => e.b)], ends = [...events.map((e) => e.a), row(fx.last)];
for (let i = 0; i < starts.length; i++) if (ends[i].ms - starts[i].ms >= 3600e3) arcs.push([starts[i], ends[i]]);
// The full environment (environment.js): the Earth's and Moon's fields,
// the Earth's tides, relativity, and sunlight pressure with the Earth's and
// Moon's shadows, Orion as a cannonball with Cr A/m = 4.6e-3 m^2/kg (Cr 1.3, 92 m^2 for 26 t
// of capsule, service module and arrays), fitted once across these arcs;
// about 2.1e-8 m/s^2 at 1 AU.
const srp = makeEnvironment(sys, { mass: 26000, area: 92, cr: 1.3 });
const errs = arcs.map(([a, b]) => ({ hours: (b.ms - a.ms) / 3.6e6, plain: norm(sub(coast(a, b.ms).r, b.r)) * 1000, sun: norm(sub(coast(a, b.ms, srp).r, b.r)) * 1000 }));
const stat = (f) => ({ worst: Math.max(...errs.map(f)), rms: Math.sqrt(errs.reduce((s, x) => s + f(x) ** 2, 0) / errs.length) });
const P = stat((x) => x.plain), Q = stat((x) => x.sun);
const long = errs.reduce((a, b) => (b.hours > a.hours ? b : a));
console.log(`  ${arcs.length} arcs of ${Math.min(...errs.map((x) => x.hours)).toFixed(1)} to ${Math.max(...errs.map((x) => x.hours)).toFixed(1)} h (${errs.reduce((s, x) => s + x.hours, 0).toFixed(0)} h in all)`);
console.log(`  gravity only:                      worst ${P.worst.toFixed(1)} m, rms ${P.rms.toFixed(1)} m; the longest (${long.hours.toFixed(1)} h) ${long.plain.toFixed(1)} m`);
console.log(`  the full environment (sunlight pressure at Cr A/m 4.6e-3 m^2/kg, fields, tides, relativity): worst ${Q.worst.toFixed(1)} m, rms ${Q.rms.toFixed(1)} m; the longest ${long.sun.toFixed(1)} m`);
check('every coast arc ends within 100 m of NASA\'s ephemeris (up to 25 h)', P.worst < 100);
check('the full environment, sunlight pressure on Orion most of all, at least halves the rms: NASA\'s model includes it', Q.rms < P.rms / 2);

header('CASE 4: the lunar flybys and the farthest point');
// Outbound flyby: closest approach comes 9 minutes after the burn ends, so
// the kernel flies there from the 5 s state once the engine is off.
{
  const w = windows.find((x) => Math.abs(x[0].ms - Date.parse('2022-11-21T12:30Z')) < 60e3);
  const start = w.find((x) => x.ms === Date.parse('2022-11-21T12:50:00Z'));
  let best = { d: Infinity }, ref = { d: Infinity };
  for (const x of w.filter((y) => y.ms >= start.ms)) {
    const d = norm(sub(coast(start, x.ms).r, moonAt(x.ms))), dr = norm(sub(x.r, moonAt(x.ms)));
    if (d < best.d) best = { d, ms: x.ms };
    if (dr < ref.d) ref = { d: dr, ms: x.ms };
  }
  console.log(`  outbound: NASA 81 mi (${(81 * MILE).toFixed(1)} km) at 12:57 UTC; trajectory ${(ref.d - MOON_RADIUS).toFixed(1)} km at ${hhmm(ref.ms)}; kernel from 12:50 ${(best.d - MOON_RADIUS).toFixed(1)} km at ${hhmm(best.ms)}`);
  check('outbound closest approach within 1 km of NASA\'s 81 mi, and the kernel within 0.1 km of the trajectory', Math.abs(ref.d - MOON_RADIUS - 81 * MILE) < 1 && Math.abs(best.d - ref.d) < 0.1);
}
{
  // Return flyby: closest approach falls inside the burn, so from the
  // trajectory alone.
  const w = windows.find((x) => Math.abs(x[0].ms - Date.parse('2022-12-05T16:30Z')) < 60e3);
  const ref = w.map((x) => ({ d: norm(sub(x.r, moonAt(x.ms))), ms: x.ms })).reduce((a, b) => (b.d < a.d ? b : a));
  console.log(`  return:   NASA 80.6 mi (${(80.6 * MILE).toFixed(1)} km) at 16:43 UTC; trajectory ${(ref.d - MOON_RADIUS).toFixed(1)} km at ${hhmm(ref.ms)}`);
  check('return closest approach within 1 km of NASA\'s 80.6 mi', Math.abs(ref.d - MOON_RADIUS - 80.6 * MILE) < 1);
}
{
  // Farthest from Earth: NASA 268,563 mi above the surface (FD13 blog), at
  // 21:06:10 UTC on 28 Nov (AAS 23-363). The kernel flies the arc that holds it.
  const f = row(fx.farthest);
  const [a] = arcs.find(([x, y]) => x.ms <= f.ms && f.ms <= y.ms);
  let best = { d: 0 };
  for (let ms = f.ms - 3600e3; ms <= f.ms + 3600e3; ms += 60e3) { const d = norm(coast(a, ms).r); if (d > best.d) best = { d, ms }; }
  const nasa = 268563 * MILE;
  console.log(`  farthest: NASA ${nasa.toFixed(1)} km above the surface at 21:06:10 UTC; trajectory ${(norm(f.r) - RE).toFixed(1)} km at ${hhmm(f.ms)}; kernel from ${hhmm(a.ms)} ${(best.d - RE).toFixed(1)} km at ${hhmm(best.ms)}`);
  check('farthest point within 5 km of NASA\'s record, and the kernel within 0.1 km of the trajectory', Math.abs(norm(f.r) - RE - nasa) < 5 && Math.abs(best.d - norm(f.r)) < 0.1);
}

console.log(`Sources: NASA as-flown burns, AAS 23-363 (${AAS}); Belair et al., Artemis I engine performance (NTRS 20240003648).`);
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
