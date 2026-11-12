// src/physics/artemis2.validate.mjs
//
// Flies Artemis II's coast arcs with the app's kernel and compares them with
// the flown trajectory: JSC/FOD/NAV's reconstructed best estimated trajectory
// (BET revF), sampled from NAIF's SPK every 10 minutes by c/artemis2_ref.c
// into fixtures/artemis2_bet.json. See docs/validation/artemis2.md.
//
// Three checks, all with advance() from nbody.js, the integrator the app
// steps craft with (Encke near a primary, Cowell elsewhere), the app's
// ephemeris (DE442's Earth and Moon) and Earth's and the Moon's J2:
//
//  1. Coast arcs. Each starts from the BET's state just after one burn and
//     runs to just before the next. A second run with point masses only
//     shows what J2 buys.
//  2. The gravity model alone. The real flight also felt a steady push of a
//     few um/s^2 (vents and thrusters, which the BET models and the app
//     cannot know). Each arc's push is estimated, as a constant, from its
//     first half only; the second half is then predicted.
//  3. The whole mission with Orion's burns. From just after translunar
//     injection to entry interface in one run, with each burn applied as
//     the BET shows it: its velocity and position change, measured from the
//     BET alone across the gap between two arcs.
//
//   node src/physics/artemis2.validate.mjs [--json out.json]

import './deNode.js';                 // DE442's Earth and Moon, as in the app
import fs from 'node:fs';
import { createState, advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';

const bet = JSON.parse(fs.readFileSync(new URL('./fixtures/artemis2_bet.json', import.meta.url)));
const rows = bet.states.map((s) => ({
  ms: Date.parse(s[0]), seg: s[1], r: s.slice(2, 5), v: s.slice(5, 8), moonR: s.slice(8, 11), moonV: s.slice(11, 14),
}));
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const sysPoint = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS, zonal: false });
const kt = (ms) => (ms - KERNEL_EPOCH_MS) / 1000;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const MOON_RADIUS = 1737.4;               // km, IAU mean radius

// Coast arcs between the burns found in the BET (docs/validation/artemis2.md
// lists them): each starts at the first sample at or after `from`.
const ARCS = [
  { name: 'Outbound, after translunar injection', from: '2026-04-03T00:02:48.802Z', to: '2026-04-05T01:20:00Z' },
  { name: 'Outbound, to the correction', from: '2026-04-05T01:50:00Z', to: '2026-04-06T03:00:00Z' },
  { name: 'Lunar flyby', from: '2026-04-06T03:10:00Z', to: '2026-04-08T00:00:00Z', flyby: true },
  { name: 'Return', from: '2026-04-08T00:10:00Z', to: '2026-04-10T02:50:00Z' },
  { name: 'Return, between corrections', from: '2026-04-10T03:00:00Z', to: '2026-04-10T18:50:00Z' },
  { name: 'Final approach to entry', from: '2026-04-10T19:00:00Z', to: '2026-04-10T23:29:00Z' },
];
const at = (iso) => rows.find((p) => p.ms >= Date.parse(iso));

// A heliocentric state from a BET row (geocentric) on the app's Earth.
function helioOf(p) {
  const e = helioStateEqj('earth', new Date(p.ms));
  return createState(add(p.r, e.r), add(p.v, e.v), kt(p.ms));
}
const constant = (a) => (a ? (t, r, out) => { out[0] = a[0]; out[1] = a[1]; out[2] = a[2]; return out; } : null);

// Fly one arc; returns per-sample errors (BET minus ours, geocentric).
// push: a constant extra acceleration (km/s^2), or null.
function fly(arc, { pointMasses = false, push = null, to = arc.to } = {}) {
  const t0 = Date.parse(arc.from), t1 = Date.parse(to);
  const pts = rows.filter((p) => p.ms >= t0 && p.ms <= t1);
  const first = pts[0];
  const state = helioOf(first);
  const s = pointMasses ? sysPoint : sys;
  const opts = { bodiesAt: s.bodiesAt, muSun: s.muSun, maxSteps: 1e7, extraAccel: constant(push) };
  const out = [];
  for (const p of pts) {
    if (p.ms > first.ms) advance(state, kt(p.ms), opts);
    const e = helioStateEqj('earth', new Date(p.ms)), m = helioStateEqj('moon', new Date(p.ms));
    const r = sub(state.r, e.r), v = sub(state.v, e.v);
    out.push({
      ms: p.ms, r, v, dr: norm(sub(r, p.r)), dv: norm(sub(v, p.v)) * 1000,
      moonR: sub(m.r, e.r), moonV: sub(m.v, e.v), bet: p,
    });
  }
  return out;
}

// Closest approach to the Moon: the sample with the least distance, refined
// by cubic Hermite interpolation of the Moon-relative state over the
// neighbouring 10-minute intervals.
function closest(samples, rel) {
  let k = 0;
  samples.forEach((s, i) => { if (norm(rel(s).r) < norm(rel(samples[k]).r)) k = i; });
  let best = { d: Infinity, ms: 0 };
  for (let i = Math.max(0, k - 1); i < Math.min(samples.length - 1, k + 1); i++) {
    const a = rel(samples[i]), b = rel(samples[i + 1]), h = (samples[i + 1].ms - samples[i].ms) / 1000;
    for (let s = 0; s <= 600; s++) {
      const u = s / 600, h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
      const p = [0, 1, 2].map((j) => h00 * a.r[j] + h10 * h * a.v[j] + h01 * b.r[j] + h11 * h * b.v[j]);
      const d = norm(p);
      if (d < best.d) best = { d, ms: samples[i].ms + u * h * 1000 };
    }
  }
  return { altitude: best.d - MOON_RADIUS, utc: new Date(Math.round(best.ms)).toISOString() };
}

const results = [];
const fmt = (x, n = 1) => x.toFixed(n).padStart(9);
console.log('Artemis II coast arcs flown by the kernel vs the reconstructed trajectory (BET revF)');
console.log('position error in km, velocity error in m/s, at the end of each arc\n');
console.log('arc'.padEnd(40) + 'days'.padStart(6) + '  |  the kernel: end km   max km  end m/s  |  point masses: end km   max km  end m/s');
const wall = performance.now();
for (const arc of ARCS) {
  const a = fly(arc), b = fly(arc, { pointMasses: true });
  const days = (a.at(-1).ms - a[0].ms) / 86400e3;
  const sum = (s) => ({ end: s.at(-1).dr, max: Math.max(...s.map((x) => x.dr)), endV: s.at(-1).dv });
  const ra = sum(a), rb = sum(b);
  const res = {
    name: arc.name, from: new Date(a[0].ms).toISOString(), to: new Date(a.at(-1).ms).toISOString(), days,
    kernel: ra, pointMasses: rb,
    series: a.map((x, i) => [x.ms, x.dr, b[i].dr]),
  };
  if (arc.flyby) {
    res.closest = {
      bet: closest(a, (s) => ({ r: sub(s.bet.r, s.bet.moonR), v: sub(s.bet.v, s.bet.moonV) })),
      kernel: closest(a, (s) => ({ r: sub(s.r, s.moonR), v: sub(s.v, s.moonV) })),
      pointMasses: closest(b, (s) => ({ r: sub(s.r, s.moonR), v: sub(s.v, s.moonV) })),
    };
  }
  results.push(res);
  console.log(arc.name.padEnd(40) + fmt(days, 2).slice(3) + '  |' + fmt(ra.end) + fmt(ra.max) + fmt(ra.endV, 2) + '  |  ' + fmt(rb.end) + fmt(rb.max) + fmt(rb.endV, 2));
}
const fb = results.find((r) => r.closest).closest;

// 2. The steady push, as a constant, by least squares on an arc's first
// half: three partial derivatives by finite differences (the residual is
// linear in so small an acceleration), then the normal equations.
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
console.log('arc'.padEnd(40) + '   push um/s^2   end km (was)');
const gravity = [];
for (const [i, arc] of ARCS.entries()) {
  const mid = new Date((Date.parse(arc.from) + Date.parse(arc.to)) / 2).toISOString();
  const push = fitPush(arc, mid);
  const end = fly(arc, { push }).at(-1).dr;
  gravity.push({ name: arc.name, pushUm: norm(push) * 1e9, end, series: fly(arc, { push }).map((x) => [x.ms, x.dr]) });
  console.log(arc.name.padEnd(40) + fmt(norm(push) * 1e9, 2) + fmt(end) + `  (${results[i].kernel.end.toFixed(1)})`);
}

// 3. The whole mission with the burns. Each burn's effect is measured from
// the BET alone: its state just before the burn, carried across the gap by
// the kernel's gravity, falls short of its state just after by the burn's
// velocity and position change. Our run gets the same change at the same
// time.
const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 };
const burns = ARCS.slice(1).map((arc, i) => {
  const a = at(ARCS[i].to) && rows.filter((p) => p.ms <= Date.parse(ARCS[i].to)).at(-1), b = at(arc.from);
  const g = helioOf(a);
  advance(g, kt(b.ms), opts);
  const e = helioStateEqj('earth', new Date(b.ms));
  return { from: a.ms, to: b.ms, dr: sub(b.r, sub(g.r, e.r)), dv: sub(b.v, sub(g.v, e.v)) };
});
const missionPts = rows.filter((p) => p.ms >= Date.parse(ARCS[0].from) && p.ms <= Date.parse(ARCS.at(-1).to));
const run = helioOf(missionPts[0]);
const mission = [];
for (const p of missionPts) {
  if (p.ms > run.t * 1000 + KERNEL_EPOCH_MS) advance(run, kt(p.ms), opts);
  const burn = burns.find((x) => x.to === p.ms);
  if (burn) for (let k = 0; k < 3; k++) { run.r[k] += burn.dr[k]; run.v[k] += burn.dv[k]; }
  const e = helioStateEqj('earth', new Date(p.ms)), m = helioStateEqj('moon', new Date(p.ms));
  const r = sub(run.r, e.r), v = sub(run.v, e.v);
  mission.push({ ms: p.ms, r, v, dr: norm(sub(r, p.r)), dv: norm(sub(v, p.v)) * 1000, moonR: sub(m.r, e.r), moonV: sub(m.v, e.v), bet: p });
}
const missionClosest = closest(mission, (s) => ({ r: sub(s.r, s.moonR), v: sub(s.v, s.moonV) }));
const entry = mission.at(-1);
// Along the path, the error is mostly timing: how far ahead (negative: early)
// our craft is, divided by the speed.
const along = (x) => { const u = x.bet.v, sp = norm(u); return ((x.r[0] - x.bet.r[0]) * u[0] + (x.r[1] - x.bet.r[1]) * u[1] + (x.r[2] - x.bet.r[2]) * u[2]) / sp / sp; };
const entryLead = along(entry);
const crossTrack = Math.sqrt(Math.max(0, entry.dr ** 2 - (entryLead * norm(entry.bet.v)) ** 2));
console.log('\n3. the whole mission from just after translunar injection, with the burns as the BET shows them');
for (const b of burns) console.log(`  burn ${new Date(b.to).toISOString().slice(0, 16)}  dv ${(norm(b.dv) * 1000).toFixed(2)} m/s`);
console.log(`  closest approach, predicted 4 days ahead: ${missionClosest.altitude.toFixed(1)} km at ${missionClosest.utc}`);
console.log(`  at entry interface (${new Date(entry.ms).toISOString().slice(0, 16)}): ${entry.dr.toFixed(1)} km off, of which ${Math.abs(entryLead).toFixed(1)} s ${entryLead > 0 ? 'ahead' : 'behind'} along the path and ${crossTrack.toFixed(1)} km across it`);

console.log('\nclosest approach to the Moon (altitude above the 1737.4 km mean radius)');
for (const [k, c] of Object.entries({ ...fb, wholeMission: missionClosest })) console.log(`  ${k.padEnd(12)} ${c.altitude.toFixed(1).padStart(8)} km at ${c.utc}`);

// The app's Moon against DE442's, over the mission.
const moonErr = rows.map((p) => norm(sub(sub(helioStateEqj('moon', new Date(p.ms)).r, helioStateEqj('earth', new Date(p.ms)).r), p.moonR)));
console.log(`\nthe app's Moon vs DE442 (geocentric): mean ${(moonErr.reduce((s, x) => s + x, 0) / moonErr.length).toFixed(2)} km, max ${Math.max(...moonErr).toFixed(2)} km`);
console.log(`(${((performance.now() - wall) / 1000).toFixed(1)} s)`);

// Regression bounds: today's results with some margin, so a change that makes
// the kernel worse against real flight data fails the tests.
let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
console.log('');
const arcs = results;
check('flyby: closest approach within 3 km of the flown altitude', Math.abs(fb.kernel.altitude - fb.bet.altitude) < 3);
check('flyby: closest approach within 30 s of the flown time', Math.abs(Date.parse(fb.kernel.utc) - Date.parse(fb.bet.utc)) < 30e3);
check('every coast arc ends within 60 km', arcs.every((r) => r.kernel.end < 60));
check('the first arc, which starts low over Earth, ends within 25 km', arcs[0].kernel.end < 25);
check('gravity model: every arc predicted within 20 km once its push is known', gravity.every((g) => g.end < 20));
check('whole mission with the burns: within 400 km at entry interface', entry.dr < 400);
check('whole mission with the burns: closest approach within 10 km of the flown altitude', Math.abs(missionClosest.altitude - fb.bet.altitude) < 10);
check("the app's Moon within 5 m of DE442 over the mission", Math.max(...moonErr) < 0.005);
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ results, gravity, mission: mission.map((x) => [x.ms, x.dr]), burns: burns.map((b) => [b.to, norm(b.dv) * 1000]), moonErrMaxKm: Math.max(...moonErr), entryLead, crossTrack, missionClosest }));
