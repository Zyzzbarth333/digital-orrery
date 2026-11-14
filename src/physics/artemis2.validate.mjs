// src/physics/artemis2.validate.mjs
//
// Flies Artemis II with the app's kernel and compares it with the flown
// trajectory: JSC/FOD/NAV's reconstructed best estimated trajectory (BET
// revF), sampled from NAIF's SPK by c/artemis2_ref.c. See
// docs/validation/artemis2.md. Everything uses advance() from nbody.js, the
// integrator the app steps craft with (Encke near a primary, Cowell
// elsewhere), the app's ephemeris (DE442's Earth and Moon) and Earth's and
// the Moon's J2. Shared pieces are in artemis2.lib.mjs.
//
//  1. Coast arcs. Each starts from the BET's state just after one burn and
//     runs to just before the next; a second run with point masses only
//     shows what J2 buys.
//  2. The gravity model alone. The real flight also felt a steady push of a
//     few um/s^2 (vents and thrusters). Each arc's push is estimated, as a
//     constant, from its first half only; the second half is predicted.
//  3. The burns, reconstructed from the BET every 5 s, against what NASA
//     published.
//  4. The whole mission in one run, with the burns replayed as flown:
//     from just after translunar injection, and from before it with the
//     injection burn flown too.
//  5. Tracking fixes. As a navigation team would, reset the craft to the
//     flown state every few hours, and see how close it stays in between.
//  6. The app's own path: the mission file (public/missions/artemis2.json)
//     flown by the Craft model through the kernel host, frame by frame,
//     as the app flies it.
//  7. Our own plan, independent of the flown data after the start:
//     artemis2.design.mjs designs the injection burn from NASA's published
//     targets (about a minute; its result is fixtures/artemis2_design.json).
//     Here the saved design is flown again, checked against those targets,
//     and compared with what NASA planned and what Orion flew.
//
//   node src/physics/artemis2.validate.mjs [--json out.json]

import fs from 'node:fs';
import { advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS, kernelSeconds, kernelMs } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';
import { Craft } from './craft.js';
import { KernelClient } from './kernelClient.js';
import { RealMission } from './realMission.js';
import { flyDesign, TARGETS, MASS0 } from './artemis2.design.mjs';
import {
  rows, sys, kt, sub, norm, helioOf, geocentric, closest, craftMoon, betMoon, splitError,
  reconstructBurns, matchNasa, flyMission,
} from './artemis2.lib.mjs';

const sysPoint = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS, zonal: false });
const fmt = (x, n = 1) => x.toFixed(n).padStart(9);
const wall = performance.now();

// Coast arcs between the burns: each starts at the first sample at or after
// `from`.
const ARCS = [
  { name: 'Outbound, after translunar injection', from: '2026-04-03T00:02:48.802Z', to: '2026-04-05T01:20:00Z' },
  { name: 'Outbound, to the correction', from: '2026-04-05T01:50:00Z', to: '2026-04-06T03:00:00Z' },
  { name: 'Lunar flyby', from: '2026-04-06T03:10:00Z', to: '2026-04-08T00:00:00Z', flyby: true },
  { name: 'Return', from: '2026-04-08T00:10:00Z', to: '2026-04-10T02:50:00Z' },
  { name: 'Return, between corrections', from: '2026-04-10T03:00:00Z', to: '2026-04-10T18:50:00Z' },
  { name: 'Final approach to entry', from: '2026-04-10T19:00:00Z', to: '2026-04-10T23:29:00Z' },
];
const BEFORE_TLI = '2026-04-02T23:39:00Z', AFTER_TLI = ARCS[0].from, ENTRY = ARCS.at(-1).to;

const constant = (a) => (a ? (t, r, out) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; } : null);

// Fly one arc; returns per-sample errors (BET minus ours, geocentric).
// push: a constant extra acceleration (km/s^2), or null.
function fly(arc, { pointMasses = false, push = null, to = arc.to } = {}) {
  const pts = rows.filter((p) => p.ms >= Date.parse(arc.from) && p.ms <= Date.parse(to));
  const state = helioOf(pts[0]);
  const s = pointMasses ? sysPoint : sys;
  const opts = { bodiesAt: s.bodiesAt, muSun: s.muSun, maxSteps: 1e7, extraAccel: constant(push) };
  return pts.map((p, i) => {
    if (i) advance(state, kt(p.ms), opts);
    const g = geocentric(state, p.ms);
    const m = helioStateEqj('moon', new Date(p.ms)), e = helioStateEqj('earth', new Date(p.ms));
    return { ms: p.ms, r: g.r, v: g.v, dr: norm(sub(g.r, p.r)), dv: norm(sub(g.v, p.v)) * 1000, moonR: sub(m.r, e.r), moonV: sub(m.v, e.v), bet: p };
  });
}

// ---------------- 1. coast arcs ----------------
console.log('Artemis II flown by the kernel vs the reconstructed trajectory (BET revF)\n');
console.log('1. coast arcs: error at the end of each');
console.log('arc'.padEnd(40) + 'days'.padStart(6) + '  |  the kernel: end km   max km  end m/s  |  point masses: end km   max km  end m/s');
const results = [];
for (const arc of ARCS) {
  const a = fly(arc), b = fly(arc, { pointMasses: true });
  const days = (a.at(-1).ms - a[0].ms) / 86400e3;
  const sum = (s) => ({ end: s.at(-1).dr, max: Math.max(...s.map((x) => x.dr)), endV: s.at(-1).dv });
  const ra = sum(a), rb = sum(b);
  const res = { name: arc.name, days, kernel: ra, pointMasses: rb, series: a.map((x, i) => [x.ms, x.dr, b[i].dr]) };
  if (arc.flyby) res.closest = { bet: closest(a, betMoon), kernel: closest(a, craftMoon), pointMasses: closest(b, craftMoon) };
  results.push(res);
  console.log(arc.name.padEnd(40) + fmt(days, 2).slice(3) + '  |' + fmt(ra.end) + fmt(ra.max) + fmt(ra.endV, 2) + '  |  ' + fmt(rb.end) + fmt(rb.max) + fmt(rb.endV, 2));
}
const fb = results.find((r) => r.closest).closest;
console.log(`  flyby arc, closest approach: flown ${fb.bet.altitude.toFixed(1)} km at ${fb.bet.utc.slice(11, 19)}; the kernel ${fb.kernel.altitude.toFixed(1)} km at ${fb.kernel.utc.slice(11, 19)}`);

// ---------------- 2. the gravity model alone ----------------
// The steady push, as a constant, by least squares on an arc's first half:
// three partial derivatives by finite differences (the residual is linear
// in so small an acceleration), then the normal equations.
function fitPush(arc, to) {
  const base = fly(arc, { to }), eps = 1e-9;
  const cols = [0, 1, 2].map((k) => {
    const a = [0, 0, 0]; a[k] = eps;
    return fly(arc, { to, push: a }).map((x, i) => sub(x.r, base[i].r).map((d) => d / eps));
  });
  const N = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  base.forEach((x, i) => {
    const res = sub(x.bet.r, x.r);
    for (let r = 0; r < 3; r++) {
      b[r] += cols[r][i][0] * res[0] + cols[r][i][1] * res[1] + cols[r][i][2] * res[2];
      for (let c = 0; c < 3; c++) N[r][c] += cols[r][i][0] * cols[c][i][0] + cols[r][i][1] * cols[c][i][1] + cols[r][i][2] * cols[c][i][2];
    }
  });
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(N);
  return [0, 1, 2].map((k) => det(N.map((row, r) => row.map((v, c) => (c === k ? b[r] : v)))) / D);
}
console.log('\n2. the gravity model alone: steady push estimated from the first half of each arc, second half predicted');
console.log('arc'.padEnd(40) + '   push um/s^2   end km (without)');
const gravity = [];
for (const [i, arc] of ARCS.entries()) {
  const mid = new Date((Date.parse(arc.from) + Date.parse(arc.to)) / 2).toISOString();
  const push = fitPush(arc, mid);
  const series = fly(arc, { push }).map((x) => [x.ms, x.dr]);
  gravity.push({ name: arc.name, pushUm: norm(push) * 1e9, end: series.at(-1)[1], series });
  console.log(arc.name.padEnd(40) + fmt(norm(push) * 1e9, 2) + fmt(series.at(-1)[1]) + `  (${results[i].kernel.end.toFixed(1)})`);
}

// ---------------- 3. the burns ----------------
const burns = matchNasa(reconstructBurns());
console.log('\n3. the burns, from the BET every 5 s, against NASA');
console.log('burn     mid-burn UTC           seconds      delta-v                  direction (prograde/in-plane/normal)   NASA');
for (const b of burns) {
  console.log(`${b.key.padEnd(8)} ${new Date(b.tMid).toISOString().slice(0, 19)}  ${fmt(b.seconds)}  ${(b.mag * 1000).toFixed(3).padStart(9)} m/s ${b.ftps.toFixed(1).padStart(7)} ft/s   ${b.dir.map((x) => x.toFixed(3).padStart(6)).join(' ')}          ${b.nasa ? b.nasa.note : 'not in NASA\'s posts'}`);
}
const tli = burns.find((b) => b.key === 'TLI');
console.log(`  injection burn on the rocket equation: ${(tli.rocket.a0 * 1000).toFixed(3)} m/s^2 at ignition, exhaust velocity ${(tli.rocket.ve * 1000).toFixed(0)} m/s (Isp ${(tli.rocket.ve * 1000 / 9.80665).toFixed(1)} s), mass ratio ${(1 - tli.seconds / tli.rocket.tau).toFixed(3)}`);

// ---------------- 4. the whole mission with the burns ----------------
const report = (name, d) => {
  const c = closest(d, craftMoon), e = splitError(d.at(-1));
  console.log(`  ${name.padEnd(46)} flyby ${c.altitude.toFixed(1).padStart(8)} km at ${c.utc.slice(11, 19)}   entry ${fmt(d.at(-1).dr)} km (${Math.abs(e.lead).toFixed(0)} s ${e.lead > 0 ? 'early' : 'late'}, ${e.cross.toFixed(0)} km across)`);
  return { closest: c, entry: d.at(-1).dr, lead: e.lead, cross: e.cross, worst: Math.max(...d.map((x) => x.dr)), series: d.map((x) => [x.ms, x.dr]) };
};
console.log('\n4. the whole mission in one run, burns replayed as flown (flown: flyby 6,545.0 km at 23:00:49)');
const afterTli = burns.filter((b) => b.key !== 'TLI');
const missionAfter = report('from just after the injection burn', flyMission({ from: AFTER_TLI, to: ENTRY, burns: afterTli, replay: true }));
const missionBefore = report('from before it, flying the injection burn too', flyMission({ from: BEFORE_TLI, to: ENTRY, burns, replay: true }));
const justAfter = (opt) => flyMission({ from: BEFORE_TLI, to: '2026-04-03T00:02:00Z', burns: [tli], ...opt }).at(-1);
const tliReplayed = justAfter({ replay: true }), tliModelled = justAfter({});
console.log(`  just after the injection burn: replayed ${tliReplayed.dr.toFixed(2)} km, ${tliReplayed.dv.toFixed(3)} m/s off; flown in one fixed direction ${tliModelled.dr.toFixed(2)} km, ${tliModelled.dv.toFixed(3)} m/s off`);

// ---------------- 5. tracking fixes ----------------
console.log('\n5. tracking fixes: the craft reset to the flown state every few hours (from before the injection burn)');
const fixes = [24, 12, 6, 3].map((h) => {
  const d = flyMission({ from: BEFORE_TLI, to: ENTRY, burns, replay: true, fixHours: h });
  const r = report(`a fix every ${h} h`, d);
  const sorted = d.map((x) => x.dr).sort((p, q) => p - q);
  console.log(`  ${''.padEnd(46)} between fixes: median ${sorted[sorted.length >> 1].toFixed(1)} km, worst ${r.worst.toFixed(0)} km`);
  return { hours: h, median: sorted[sorted.length >> 1], ...r };
});

// ---------------- 6. the app's own path ----------------
console.log("\n6. the app's path: the mission file flown by the Craft model and the kernel host, one-minute frames");
const file = new RealMission(JSON.parse(fs.readFileSync(new URL('../../public/missions/artemis2.json', import.meta.url))));
// Orion as the app flies it (src/app/mission.ts's ORION): the full
// environment, sunlight on 92 m^2 and the random vent model.
const ORION = { dryMass: 25036, fuel: 500, area: 92, cr: 1.3, vent: {} };
async function flyApp(fixHours, { aimed = false, env = false, viaClient = false } = {}) {
  // By default the environment off (no area, so no sunlight or drag; J2
  // alone for the Earth), as in the replay it is checked against.
  const s0 = file.startState(), c = new Craft({ name: file.name, r: s0.r, v: s0.v, t: s0.t, sys, ...(env ? ORION : { area: 0, earth: { degree: 0 } }) });
  c.setScript(file.script());
  const client = new KernelClient(), run = { aimNext: 0, aimedDv: 0 };
  // viaClient: aimed as the app aims, through KernelClient.aim (here on
  // this thread, its answer a promise taken up a frame later).
  const aimer = viaClient ? (req) => client.aim(req) : null;
  const step = async (t) => {
    c.advanceClock(t);
    if (aimed) file.aimStep(c, sys, run, false, aimer);
    client.tick([c]);
    if (aimed) { if (aimer) await null; file.aimStep(c, sys, run, false, aimer); client.tick([c]); }
  };
  let worst = 0, prev = file.startMs;
  const track = [];
  for (let ms = file.startMs + 60e3; ms <= file.endMs; ms += 60e3) {
    for (const f of file.fixesBetween(prev, ms, fixHours)) {
      await step(kt(f));
      const x = file.fixAt(f); c.setState(x.r, x.v, x.t);
    }
    prev = ms;
    await step(kt(ms));
    const at = kernelMs(c.kState.t), d = file.distanceFromFlown(c.kState.r, at);
    if (d !== null) worst = Math.max(worst, d);
    const g = geocentric(c.kState, at), m = helioStateEqj('moon', new Date(at)), e = helioStateEqj('earth', new Date(at));
    track.push({ ms: at, r: g.r, v: g.v, moonR: sub(m.r, e.r), moonV: sub(m.v, e.v) });
  }
  const end = file.distanceFromFlown(c.kState.r, kernelMs(c.kState.t));
  const cl = closest(track, craftMoon);
  const label = (fixHours ? `a fix every ${fixHours} h` : 'no fixes') + (env ? ', full environment' : '') + (aimed ? `, aimed (+${run.aimedDv.toFixed(2)} m/s)` : '');
  console.log(`  ${label.padEnd(46)} flyby ${cl.altitude.toFixed(1).padStart(8)} km at ${cl.utc.slice(11, 19)}   entry ${fmt(end)} km, worst ${worst.toFixed(1)} km${c.error ? ', ' + c.error : ''}`);
  return { closest: cl, end, worst, error: c.error, aimedDv: run.aimedDv };
}
const app = await flyApp(null), app12 = await flyApp(12);
// As the app flies it by default: the full environment with its random vent,
// no fixes, the corrections aimed from the craft; and the same replayed
// blind, which the flyby turns into thousands of kilometres.
const appBlind = await flyApp(null, { env: true }), appAimed = await flyApp(null, { env: true, aimed: true });
const appAimedAsync = await flyApp(null, { env: true, aimed: true, viaClient: true });

// ---------------- 7. our own plan ----------------
const plan = JSON.parse(fs.readFileSync(new URL('./fixtures/artemis2_design.json', import.meta.url)));
const pf = flyDesign(plan.dvKms, plan.ignitionMs), pc = plan.comparison;
const ftps = (kms) => kms * 1e6 / 304.8, tli7 = burns.find((b) => b.key === 'TLI');
const angle = (a, b) => Math.acos(Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / Math.hypot(...a) / Math.hypot(...b))) * 180 / Math.PI;
console.log('\n7. our own plan: the injection burn designed from the pre-TLI orbit and NASA\'s published targets');
console.log(`  burn       ours ${ftps(pf.mag).toFixed(1)} ft/s over ${pf.seconds.toFixed(1)} s from ${new Date(plan.ignitionMs).toISOString().slice(11, 19)}; NASA planned 1,274 ft/s over 349 s from about 23:49; flown ${tli7.ftps.toFixed(1)} ft/s over ${tli7.seconds.toFixed(1)} s`);
console.log(`  direction  ours and flown ${angle(plan.dvKms, tli7.dir).toFixed(1)} deg apart (orbital frame); Orion's mass at ignition, from NASA's plan and the engine, ${MASS0.toFixed(0)} kg`);
console.log(`  flyby      ${pf.flyby.altitude.toFixed(2)} km at ${pf.flyby.utc.slice(11, 19)} (NASA: 6,545.2 km at 23:00:46)`);
console.log(`  entry      ${new Date(pf.ei.ms).toISOString().slice(11, 19)} at ${pf.ei.fpa.toFixed(2)} deg, ${pf.ei.speed.toFixed(4)} km/s, over ${pc.oursEi.lat.toFixed(2)} ${pc.oursEi.lon.toFixed(2)}; flown ${new Date(pc.flownEi.ms).toISOString().slice(11, 19)} at ${pc.flownEi.fpa.toFixed(2)} deg, ${pc.flownEi.speed.toFixed(4)} km/s, over ${pc.flownEi.lat.toFixed(2)} ${pc.flownEi.lon.toFixed(2)}`);
console.log(`  path       at most ${pc.max.toFixed(0)} km from the flown one; farthest from Earth ${pc.farthest.ours.km.toFixed(0)} km (flown ${pc.farthest.flown.km.toFixed(0)} km; NASA 252,756 mi from the surface)`);

// The app's Moon against DE442's, over the mission.
const moonErr = rows.map((p) => norm(sub(sub(helioStateEqj('moon', new Date(p.ms)).r, helioStateEqj('earth', new Date(p.ms)).r), p.moonR)));
console.log(`\nthe app's Moon vs DE442 (geocentric): max ${(Math.max(...moonErr) * 1000).toFixed(2)} m`);
console.log(`(${((performance.now() - wall) / 1000).toFixed(1)} s)`);

// Regression bounds: today's results with some margin, so a change that makes
// the kernel worse against real flight data fails the tests.
let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const byKey = (k) => burns.find((b) => b.key === k);
console.log('');
check('flyby arc: closest approach within 3 km and 30 s of the flown', Math.abs(fb.kernel.altitude - fb.bet.altitude) < 3 && Math.abs(Date.parse(fb.kernel.utc) - Date.parse(fb.bet.utc)) < 30e3);
check('every coast arc ends within 60 km, the first within 25 km', results.every((r) => r.kernel.end < 60) && results[0].kernel.end < 25);
check('gravity model: every arc predicted within 20 km once its push is known', gravity.every((g) => g.end < 20));
check('injection burn: delta-v within 0.5 % of NASA\'s planned 1,274 ft/s, duration within 5 s of 350 s', Math.abs(tli.ftps / 1274 - 1) < 0.005 && Math.abs(tli.seconds - 350) < 5);
check('return corrections 1 and 2 within 0.1 ft/s of NASA\'s 1.6 and 5.3 ft/s', Math.abs(byKey('RTC-1').ftps - 1.6) < 0.1 && Math.abs(byKey('RTC-2').ftps - 5.3) < 0.1);
check('injection burn replayed: within 0.05 m/s of the flown state just after', tliReplayed.dv < 0.05);
// The injection burn's replay is 0.012 m/s off, which the four days to the
// Moon grow to about 34 km of flyby altitude: the bound allows for that.
check('whole mission from before the injection burn: flyby within 60 km of the flown altitude', Math.abs(missionBefore.closest.altitude - fb.bet.altitude) < 60);
check('a fix every 12 h: within 5 km at entry, never more than 1,000 km off', fixes[1].entry < 5 && fixes[1].worst < 1000);
check("the app's Moon within 5 m of DE442 over the mission", Math.max(...moonErr) < 0.005);
check("the app's path flies the mission file without error, to within 2 km of the replay's flyby", !app.error && Math.abs(app.closest.altitude - missionBefore.closest.altitude) < 2);
check("the app's path with a fix every 12 h: within 5 km at entry, never more than 10 km off", app12.end < 5 && app12.worst < 10);
check(`the app's path as it flies by default, corrections aimed, no fixes: within 5 km at entry and 150 km throughout (blind: ${appBlind.worst.toFixed(0)} km)`, !appAimed.error && appAimed.end < 5 && appAimed.worst < 150);
check(`the aimed corrections add under 10 m/s to the flown ones (${appAimed.aimedDv.toFixed(2)} m/s)`, appAimed.aimedDv < 10);
// The extra frame held at each burn splits the kernel's steps differently:
// a few tenths of a metre by entry.
check(`aimed as the app aims them, through the kernel client a frame later, the same flight (${(Math.abs(appAimedAsync.end - appAimed.end) * 1000).toFixed(2)} m apart at entry, ${Math.abs(appAimedAsync.aimedDv - appAimed.aimedDv).toExponential(1)} m/s in the aims)`, Math.abs(appAimedAsync.end - appAimed.end) < 0.01 && Math.abs(appAimedAsync.aimedDv - appAimed.aimedDv) < 0.01);
check('our plan still meets NASA\'s flyby (1 km, 5 s) and entry time (5 s)', Math.abs(pf.flyby.altitude - TARGETS.flybyAltKm) < 1 && Math.abs(Date.parse(pf.flyby.utc) - TARGETS.flybyMs) < 5e3 && Math.abs(pf.ei.ms - TARGETS.eiMs) < 5e3);
check('our plan\'s injection burn within 1 % of NASA\'s planned 1,274 ft/s and 3 s of its 349 s, igniting within 2 min of 23:49', Math.abs(ftps(pf.mag) / 1274 - 1) < 0.01 && Math.abs(pf.seconds - 349) < 3 && Math.abs(plan.ignitionMs - TARGETS.planIgnitionMs) < 120e3);
check('our plan stays within 300 km of the flown path, and its farthest from Earth within 10 km of the flown', pc.max < 300 && Math.abs(pc.farthest.ours.km - pc.farthest.flown.km) < 10);
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) {
  fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify({
    results, gravity, missionAfter, missionBefore, fixes,
    burns: burns.map((b) => ({ key: b.key, ms: b.tMid, mps: b.mag * 1000, ftps: b.ftps, seconds: b.seconds, dir: b.dir, nasa: b.nasa })),
  }));
}
