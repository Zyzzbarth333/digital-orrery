// src/physics/artemis2.validate.mjs
//
// Flies Artemis II's coast arcs with the app's kernel and compares them with
// the flown trajectory: JSC/FOD/NAV's reconstructed best estimated trajectory
// (BET revF), sampled from NAIF's SPK every 10 minutes by c/artemis2_ref.c
// into fixtures/artemis2_bet.json. See docs/validation/artemis2.md.
//
// Each arc starts from the BET's state just after one burn and runs to just
// before the next, so it tests the gravity model alone: the kernel's point
// masses (Sun, planets, Moon on the app's ephemeris). A second run adds
// Earth's J2, which the kernel does not have yet, to show what it would buy.
// Both runs use advance() from nbody.js, the integrator the app steps craft
// with (Encke near a primary, Cowell elsewhere).
//
//   node src/physics/artemis2.validate.mjs [--json out.json]

import fs from 'node:fs';
import { createState, advance } from './nbody.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';
import { bodyAxesEqj } from './orientation.js';

const bet = JSON.parse(fs.readFileSync(new URL('./fixtures/artemis2_bet.json', import.meta.url)));
const rows = bet.states.map((s) => ({
  ms: Date.parse(s[0]), seg: s[1], r: s.slice(2, 5), v: s.slice(5, 8), moonR: s.slice(8, 11), moonV: s.slice(11, 14),
}));
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const kt = (ms) => (ms - KERNEL_EPOCH_MS) / 1000;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const MOON_RADIUS = 1737.4;               // km, IAU mean radius

// Earth's J2 (EGM2008, unnormalised, with its reference radius) about the
// pole of date from orientation.js.
const J2 = 1.0826267e-3, RE = 6378.1363, MU_E = 398600.4415;
function j2Accel(pole) {
  return (t, r, out) => {
    const e = sys.bodiesAt(t).find((b) => b.key === 'earth').r;
    const d = sub(r, e), rn = norm(d), z = dot(d, pole);
    const k = 1.5 * J2 * MU_E * RE * RE / rn ** 5, q = 5 * z * z / (rn * rn);
    for (let i = 0; i < 3; i++) out[i] = k * ((q - 1) * d[i] - 2 * z * pole[i]);
    return out;
  };
}

// Coast arcs between the burns found in the BET (docs/validation/artemis2.md
// lists them): each starts at the first sample at or after `from`.
const ARCS = [
  { name: 'Outbound, after translunar injection', from: '2026-04-03T00:02:48.802Z', to: '2026-04-05T01:20:00Z' },
  { name: 'Outbound, to the correction', from: '2026-04-05T01:50:00Z', to: '2026-04-06T03:00:00Z' },
  { name: 'Lunar flyby', from: '2026-04-06T03:10:00Z', to: '2026-04-08T00:00:00Z', flyby: true },
  { name: 'Return', from: '2026-04-08T00:10:00Z', to: '2026-04-10T02:50:00Z' },
  { name: 'Return, between corrections', from: '2026-04-10T03:00:00Z', to: '2026-04-10T18:50:00Z' },
  { name: 'Final approach to entry', from: '2026-04-10T19:00:00Z', to: '2026-04-10T23:29:00Z' },
  { name: 'Whole mission, no burns flown', from: '2026-04-03T00:02:48.802Z', to: '2026-04-10T23:29:00Z', whole: true },
];

// Fly one arc; returns per-sample errors (BET minus ours, geocentric).
function fly(arc, { j2 = false } = {}) {
  const t0 = Date.parse(arc.from), t1 = Date.parse(arc.to);
  const pts = rows.filter((p) => p.ms >= t0 && p.ms <= t1);
  const first = pts[0];
  const earth0 = helioStateEqj('earth', new Date(first.ms));
  const state = createState(add(first.r, earth0.r), add(first.v, earth0.v), kt(first.ms));
  const pole = bodyAxesEqj('earth', new Date(first.ms))[2];
  const opts = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7, extraAccel: j2 ? j2Accel(pole) : null };
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
console.log('arc'.padEnd(40) + 'days'.padStart(6) + '  |  point masses: end km   max km  end m/s  |  with J2: end km   max km  end m/s');
const wall = performance.now();
for (const arc of ARCS) {
  const a = fly(arc), b = fly(arc, { j2: true });
  const days = (a.at(-1).ms - a[0].ms) / 86400e3;
  const sum = (s) => ({ end: s.at(-1).dr, max: Math.max(...s.map((x) => x.dr)), endV: s.at(-1).dv });
  const ra = sum(a), rb = sum(b);
  const res = {
    name: arc.name, from: new Date(a[0].ms).toISOString(), to: new Date(a.at(-1).ms).toISOString(), days,
    pointMasses: ra, withJ2: rb,
    series: a.map((x, i) => [x.ms, x.dr, b[i].dr]),
  };
  if (arc.flyby) {
    res.closest = {
      bet: closest(a, (s) => ({ r: sub(s.bet.r, s.bet.moonR), v: sub(s.bet.v, s.bet.moonV) })),
      kernel: closest(a, (s) => ({ r: sub(s.r, s.moonR), v: sub(s.v, s.moonV) })),
      kernelJ2: closest(b, (s) => ({ r: sub(s.r, s.moonR), v: sub(s.v, s.moonV) })),
    };
  }
  results.push(res);
  console.log(arc.name.padEnd(40) + fmt(days, 2).slice(3) + '  |' + fmt(ra.end) + fmt(ra.max) + fmt(ra.endV, 2) + '  |  ' + fmt(rb.end) + fmt(rb.max) + fmt(rb.endV, 2));
}
const fb = results.find((r) => r.closest).closest;
console.log('\nclosest approach to the Moon (altitude above the 1737.4 km mean radius)');
for (const [k, c] of Object.entries(fb)) console.log(`  ${k.padEnd(9)} ${c.altitude.toFixed(1).padStart(8)} km at ${c.utc}`);

// The app's Moon against DE442's, over the mission.
const moonErr = rows.map((p) => norm(sub(sub(helioStateEqj('moon', new Date(p.ms)).r, helioStateEqj('earth', new Date(p.ms)).r), p.moonR)));
console.log(`\nthe app's Moon vs DE442 (geocentric): mean ${(moonErr.reduce((s, x) => s + x, 0) / moonErr.length).toFixed(2)} km, max ${Math.max(...moonErr).toFixed(2)} km`);
console.log(`(${((performance.now() - wall) / 1000).toFixed(1)} s)`);

// Regression bounds: today's results with some margin, so a change that makes
// the kernel worse against real flight data fails the tests.
let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
console.log('');
const arcs = results.filter((r) => !r.name.startsWith('Whole'));
check('flyby: closest approach within 3 km of the flown altitude', Math.abs(fb.kernel.altitude - fb.bet.altitude) < 3);
check('flyby: closest approach within 30 s of the flown time', Math.abs(Date.parse(fb.kernel.utc) - Date.parse(fb.bet.utc)) < 30e3);
check('every coast arc but the first (J2) ends within 100 km', arcs.slice(1).every((r) => r.pointMasses.end < 100));
check('with J2, every coast arc ends within 100 km', arcs.every((r) => r.withJ2.end < 100));
check("the app's Moon within 15 km of DE442 over the mission", Math.max(...moonErr) < 15);
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;

const jsonAt = process.argv.indexOf('--json');
if (jsonAt > 0) fs.writeFileSync(process.argv[jsonAt + 1], JSON.stringify({ results, moonErrMaxKm: Math.max(...moonErr) }));
