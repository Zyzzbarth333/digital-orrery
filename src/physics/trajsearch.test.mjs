// src/physics/trajsearch.test.mjs
//
// The trajectory search (trajsearch.js) against NASA Ames's Trajectory
// Browser: for each planet and each direct transfer NASA lists as a
// launch-window optimum (public/trajbrowser/planets.json, 2026-2040), our
// search's optimum for the same opportunity, with NASA's constants for the
// destination. The two use the same method (patched conics, a Lambert
// heliocentric leg, the same delta-v conventions) but different ephemerides
// and NASA starts its legs at the planets' spheres of influence, so they
// agree closely, not exactly. Also checks the module's shape for reuse
// (pure, ephemeris passed in, plain objects out).

import './deNode.js';
import fs from 'node:fs';
import { searchTransfers, transfer } from './trajsearch.js';
import { helioStateEcl } from './ephemeris.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const DAY_MS = 86400e3, iso = (ms) => new Date(ms).toISOString().slice(0, 10);

const tb = JSON.parse(fs.readFileSync(new URL('../../public/trajbrowser/planets.json', import.meta.url)));
const LETTER = { mercury: 'Me', venus: 'V', mars: 'M', jupiter: 'J', saturn: 'S', uranus: 'U', neptune: 'N' };
const TOF = { mercury: [60, 250], venus: [80, 260], mars: [120, 450], jupiter: [500, 1200], saturn: [1000, 2600], uranus: [2000, 4380], neptune: [3000, 4380] };
const EARTH = { mu: 398600.4418, rPark: 6371 + 200 };   // NASA's, from its pages

header("CASE 1: our transfer between NASA's dates (direct routes)");
// Same launch and arrival dates, so any difference is the modelling alone:
// NASA starts its heliocentric leg at the planets' spheres of influence and
// uses its own ephemeris; ours runs centre to centre on the app's.
const rows = [];
for (const [key, entry] of Object.entries(tb.bodies)) {
  if (!entry.body) continue;
  for (const kind of ['rendezvous', 'flyby']) {
    for (const t of (entry[kind] ?? []).filter((x) => x.route === `E${LETTER[key]}`)) {
      const o = transfer({ stateOf: helioStateEcl, muSun: 132712440018, to: key, kind, departure: EARTH, arrival: { mu: entry.body.muKm3s2, rPeri: entry.body.rPeriKm } }, t.depMs, (t.arrMs - t.depMs) / DAY_MS);
      const dv = t.injectionDv + t.postDv;
      // The transfer angle, Earth at launch to the planet at arrival: near 0
      // or 360 deg the transfer plane is undefined and a single conic needs
      // a huge plane change (NASA's routes break the plane with a deep-space
      // manoeuvre there).
      const e = helioStateEcl('earth', new Date(t.depMs)).r, pl = helioStateEcl(key, new Date(t.arrMs)).r;
      const ang = Math.acos(Math.max(-1, Math.min(1, (e[0] * pl[0] + e[1] * pl[1] + e[2] * pl[2]) / Math.hypot(...e) / Math.hypot(...pl)))) * 180 / Math.PI;
      // A flight time at the minimum of a multi-revolution family: just below
      // it there is no solution, and the two ephemerides put NASA's dates on
      // opposite sides of it (Mars 2026-03-13: 654.3 d against a 1-rev
      // minimum of 654.5 d here). Such a case is compared one day longer.
      let edge = null;
      if (o && Math.abs(o.totalDv / dv - 1) > 0.2) {
        const o2 = transfer({ stateOf: helioStateEcl, muSun: 132712440018, to: key, kind, departure: EARTH, arrival: { mu: entry.body.muKm3s2, rPeri: entry.body.rPeriKm } }, t.depMs, (t.arrMs - t.depMs) / DAY_MS + 1);
        if (o2 && o2.revs > 0 && Math.abs(o2.totalDv / dv - 1) < 0.05) edge = o2;
      }
      rows.push({ key, kind, t, o, dv, c3: t.c3, nearLine: ang < 5, edge });
    }
  }
}
for (const r of rows) {
  console.log(`  ${r.key.padEnd(8)} ${r.kind.padEnd(10)} ${iso(r.t.depMs)} ${String(Math.round((r.t.arrMs - r.t.depMs) / DAY_MS)).padStart(5)} d  C3 NASA ${r.c3.toFixed(2).padStart(6)} ours ${r.o ? r.o.c3.toFixed(2).padStart(6) : '  none'}  dv NASA ${r.dv.toFixed(3)} ours ${r.o ? `${r.o.totalDv.toFixed(3)} (${((r.o.totalDv / r.dv - 1) * 100).toFixed(2)} %)` : 'none'}`);
}
const got = rows.filter((r) => r.o), line = got.filter((r) => r.nearLine), edges = got.filter((r) => r.edge), fair = got.filter((r) => !r.nearLine && !r.edge);
for (const r of line) console.log(`  excluded: ${r.key} ${r.kind} ${iso(r.t.depMs)}, Earth and the planet within 5 deg of a line through the Sun (transfer plane undefined)`);
for (const r of edges) console.log(`  at a multi-revolution minimum: ${r.key} ${r.kind} ${iso(r.t.depMs)}, one day longer: ${r.edge.revs}-rev ${r.edge.branch}, C3 ${r.edge.c3.toFixed(2)} (NASA ${r.c3.toFixed(2)}), ${r.edge.totalDv.toFixed(3)} km/s (${((r.edge.totalDv / r.dv - 1) * 100).toFixed(2)} %)`);
const pct = (r) => Math.abs(r.o.totalDv / r.dv - 1);
const worstOf = (list) => Math.max(...list.map(pct));
const fastGiants = fair.filter((r) => r.key === 'jupiter'), rest = fair.filter((r) => r.key !== 'jupiter');
const mean = fair.reduce((s, r) => s + pct(r), 0) / fair.length;
console.log(`  ${got.length} of ${rows.length} solved; ${fair.length} compared: mean ${(mean * 100).toFixed(2)} %, worst ${(worstOf(rest) * 100).toFixed(2)} % (${(worstOf(fastGiants) * 100).toFixed(2)} % for the fast Jupiter flybys)`);
check("every direct NASA transfer is solved between its dates", got.length === rows.length);
check('total delta-v within 5 % of NASA, Jupiter aside', worstOf(rest) < 0.05);
check('fast Jupiter flybys within 10 % (NASA patches at a 48-million-km sphere of influence)', worstOf(fastGiants) < 0.10);
check('at most one case with an undefined transfer plane, and at most one at a multi-revolution minimum', line.length <= 1 && edges.length <= 1);

header("CASE 1b: our search finds NASA's Mars and Venus opportunities");
// Where both searches cover the same flight times (the inner planets), our
// optimum for each opportunity against NASA's.
for (const key of ['venus', 'mars']) {
  const entry = tb.bodies[key];
  const [lo, hi] = TOF[key];
  const ours = searchTransfers({
    stateOf: helioStateEcl, muSun: 132712440018, to: key, kind: 'rendezvous',
    launchStartMs: Date.UTC(tb.years[0], 0, 1), launchEndMs: Date.UTC(tb.years[1] + 1, 0, 1),
    tofMinDays: lo, tofMaxDays: hi, departure: EARTH, arrival: { mu: entry.body.muKm3s2, rPeri: entry.body.rPeriKm },
  });
  const theirs = entry.rendezvous.filter((x) => x.route === `E${LETTER[key]}` && (x.arrMs - x.depMs) / DAY_MS <= hi);
  let worstPct = 0, worstDays = 0, missing = 0;
  for (const t of theirs) {
    const o = ours.optima.reduce((b, x) => (Math.abs(x.depMs - t.depMs) < 120 * DAY_MS && (!b || Math.abs(x.depMs - t.depMs) < Math.abs(b.depMs - t.depMs)) ? x : b), null);
    const dv = t.injectionDv + t.postDv;
    if (!o) { missing++; console.log(`  ${key} NASA ${iso(t.depMs)} ${dv.toFixed(3)} km/s | ours: none`); continue; }
    worstPct = Math.max(worstPct, Math.abs(o.totalDv / dv - 1)); worstDays = Math.max(worstDays, Math.abs(o.depMs - t.depMs) / DAY_MS);
    console.log(`  ${key} NASA ${iso(t.depMs)} ${String(Math.round((t.arrMs - t.depMs) / DAY_MS)).padStart(4)} d ${dv.toFixed(3)} km/s | ours ${iso(o.depMs)} ${String(Math.round(o.tofDays)).padStart(4)} d ${o.totalDv.toFixed(3)} km/s (${((o.totalDv / dv - 1) * 100).toFixed(2)} %)`);
  }
  console.log(`  ${key}: ${theirs.length - missing} of ${theirs.length} found; worst ${(worstPct * 100).toFixed(2)} %, ${worstDays.toFixed(0)} d`);
  check(`${key}: every NASA opportunity found, within 3.5 % and 30 days`, missing === 0 && worstPct < 0.035 && worstDays < 30);
}

header('CASE 2: the shape the portfolio reuses');
{
  const opts = { stateOf: helioStateEcl, muSun: 132712440018, to: 'mars', departure: EARTH, arrival: { mu: 42828.39, rPeri: 3639.5 } };
  const t = transfer(opts, Date.UTC(2026, 10, 8), 301);
  check('transfer() returns a plain object of numbers (its branch a name, v_inf a 3-vector)', t && typeof t === 'object' && Object.entries(t).every(([k, v]) => (k === 'branch' ? typeof v === 'string' : k === 'vinfDepVec' ? v.length === 3 && v.every(Number.isFinite) : typeof v === 'number' && Number.isFinite(v))));
  const r = searchTransfers({ ...opts, launchStartMs: Date.UTC(2026, 0, 1), launchEndMs: Date.UTC(2027, 0, 1), tofMinDays: 120, tofMaxDays: 450 });
  check('searchTransfers() returns { optima: plain objects, evaluated }', Array.isArray(r.optima) && r.optima.every((x) => Object.getPrototypeOf(x) === Object.prototype) && Number.isInteger(r.evaluated));
  check('the module imports nothing but orbital.js', !/from '(?!\.\/orbital\.js')/.test(fs.readFileSync(new URL('./trajsearch.js', import.meta.url), 'utf8')));
  check('a result carries no Date or class instances (structured-clone and JSON safe)', JSON.parse(JSON.stringify(t)).totalDv === t.totalDv && typeof t.branch === 'string');
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
