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
import { NASA_BURNS, AAS } from './artemis1.lib.mjs';
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

// NASA's as-flown burns (AAS 23-363, Belair et al.): artemis1.lib.mjs.


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

header("CASE 5: the app's mission file (public/missions/artemis1.json), flown as the app flies it");
{
  // Orion as the app flies it (src/app/mission.ts's ORION): the full
  // environment with the random vent model, through the Craft model and the
  // kernel host in one-minute frames, from just after injection to just
  // before entry. Three ways: every burn replayed as flown; a tracking fix
  // every 12 h; and, as the app flies it by default, no fixes and every burn
  // after the first aimed from the craft (RealMission.aimStep).
  const { RealMission } = await import('./realMission.js');
  const { Craft } = await import('./craft.js');
  const { KernelClient } = await import('./kernelClient.js');
  const { kernelMs } = await import('./kernelHost.js');
  const file = new RealMission(JSON.parse(fs.readFileSync(new URL('../../public/missions/artemis1.json', import.meta.url))));
  const ORION = { dryMass: 25036, fuel: 500, area: 92, cr: 1.3, vent: {} };
  const flyApp = ({ aimed = false, fixHours = null } = {}) => {
    const s0 = file.startState(), c = new Craft({ name: file.name, r: s0.r, v: s0.v, t: s0.t, sys, ...ORION });
    c.setScript(file.script());
    const client = new KernelClient(), run = { aimNext: 0, aimedDv: 0 };
    const step = (t) => { c.advanceClock(t); if (aimed) file.aimStep(c, sys, run); client.tick([c]); if (aimed) { file.aimStep(c, sys, run); client.tick([c]); } };
    let worst = 0, prev = file.startMs;
    const lows = [{ d: Infinity }, { d: Infinity }];
    for (let ms = file.startMs + 60e3; ms <= file.endMs && !c.crashed && !c.error; ms += 60e3) {
      for (const f of file.fixesBetween(prev, ms, fixHours)) { step(kt(f)); const x = file.fixAt(f); c.setState(x.r, x.v, x.t); }
      prev = ms;
      step(kt(ms));
      const at = kernelMs(c.kState.t), d = file.distanceFromFlown(c.kState.r, at);
      if (d !== null) worst = Math.max(worst, d);
      const dm = norm(sub(geocentric(c.kState, at).r, moonAt(at))) - MOON_RADIUS, k = at < Date.parse('2022-11-28') ? 0 : 1;
      if (dm < lows[k].d) lows[k] = { d: dm, ms: at };
    }
    const end = file.distanceFromFlown(c.kState.r, kernelMs(c.kState.t));
    return { worst, end, lows, aimedDv: run.aimedDv, error: c.error, crashed: c.crashed };
  };
  const show = (label, x) => console.log(`  ${label.padEnd(44)} flybys ${x.lows.map((l) => `${l.d.toFixed(1)} km`).join(' and ')}   at the end ${x.end.toFixed(1)} km, worst ${x.worst.toFixed(1)} km${x.crashed ? ', crashed' : ''}`);
  const blind = flyApp(), fix12 = flyApp({ fixHours: 12 }), aimed = flyApp({ aimed: true });
  console.log(`  the file's flybys: ${file.data.flyby.altitudeKm} and ${file.data.returnFlyby.altitudeKm} km`);
  show('every burn replayed as flown', blind);
  show('a fix every 12 h', fix12);
  show(`no fixes, burns aimed (+${aimed.aimedDv.toFixed(2)} m/s)`, aimed);
  check(`the file's burns add up to NASA's (each within 1 % above 1 m/s, 0.05 m/s below)`, file.burns.every((b, i) => { const nb = NASA_BURNS[i]; return nb.dv * 1000 > 1 ? Math.abs(b.mps / (nb.dv * 1000) - 1) < 0.01 : Math.abs(b.mps - nb.dv * 1000) < 0.05; }));
  check(`with a fix every 12 h: within 10 km at the end and 500 km throughout, both flybys within 2 km of the flown`, fix12.end < 10 && fix12.worst < 500 && Math.abs(fix12.lows[0].d - file.data.flyby.altitudeKm) < 2 && Math.abs(fix12.lows[1].d - file.data.returnFlyby.altitudeKm) < 2);
  check(`as the app flies it, aimed with no fixes: within 5 km at the end and 500 km throughout, both flybys within 10 km of the flown (blind: ${blind.worst.toFixed(0)} km)`, !aimed.error && aimed.end < 5 && aimed.worst < 500 && Math.abs(aimed.lows[0].d - file.data.flyby.altitudeKm) < 10 && Math.abs(aimed.lows[1].d - file.data.returnFlyby.altitudeKm) < 10);
  check(`the aimed burns add under 50 m/s to the flown ones over 25 days (${aimed.aimedDv.toFixed(2)} m/s)`, aimed.aimedDv < 50);
}

console.log(`Sources: NASA as-flown burns, AAS 23-363 (${AAS}); Belair et al., Artemis I engine performance (NTRS 20240003648).`);
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
