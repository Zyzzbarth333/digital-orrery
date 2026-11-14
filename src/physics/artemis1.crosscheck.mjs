// src/physics/artemis1.crosscheck.mjs
//
// Artemis I three ways (docs/validation/artemis1.md, "Cross-checks"):
//
//   npm run crosscheck:artemis1
//
// 1. The model, force by force: every coast arc between events flown with
//    gravity alone, then adding sunlight pressure, the Earth's and Moon's
//    fields, the Earth's tides and relativity in turn.
// 2. The numbers: the full model flown by the kernel at its default step
//    and at a half, a quarter and an eighth of it, and by a plain
//    fixed-step Runge-Kutta written here (a different method from the
//    kernel's), so the integrator's own error is measured. (Encke's method
//    never takes over on these arcs: between the Earth and the Moon the
//    motion is far from a single conic, so the kernel flies them by Cowell.)
//    Part 1 flies at an eighth of the default step, where that error is
//    centimetres.
// 3. The data: fresh states from JPL Horizons at a dozen instants, asked
//    for in TDB rather than UTC, against the fixture (the time scales and
//    the stored numbers), and the Moon's and the Sun's positions there
//    against the app's own (the bodies the kernel flies through). The
//    Horizons replies are cached in ~/.cache/digital-orrery/artemis1.

import fs from 'node:fs';
import dns from 'node:dns';
import { helioOf, geocentric, sys, kt } from './artemis2.lib.mjs';
import { advance, accelHeliocentric } from './nbody.js';
import { createState } from './nbody.js';
import { helioStateEqj } from './ephemeris.js';
import { makeEnvironment } from './environment.js';
import { tdbSeconds } from './timescale.js';
import { massAfterBurns } from './artemis1.lib.mjs';
import { ORION_CRAFT, ORION_ENGINE } from './orion.js';

dns.setDefaultResultOrder('ipv4first');
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/artemis1.json', import.meta.url)));
const row = (s) => ({ ms: Date.parse(s[0]), r: s.slice(1, 4), v: s.slice(4, 7) });
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const line = (s) => console.log(`${'='.repeat(72)}\n${s}\n${'='.repeat(72)}`);
let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };

// The arcs: from a minute after each event to a minute before the next.
const starts = [row(fx.first), ...fx.events.map((e) => row(e.minutes.at(-1)))];
const ends = [...fx.events.map((e) => row(e.minutes[0])), row(fx.last)];
const arcs = starts.map((a, i) => [a, ends[i]]).filter(([a, b]) => b.ms - a.ms >= 3600e3);

const FINE = { eta: 0.00125 };
function fly(a, ms, env, extra = FINE) {
  const s = helioOf(a);
  const o = { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e8, ...extra };
  if (env) { o.extraAccel = (t, r, out, mid, v) => { out[0] = out[1] = out[2] = 0; return env(t, r, v, out, mid); }; o.stepCap = env.stepCap; }
  advance(s, kt(ms), o);
  return geocentric(s, ms).r;
}
// Orion as a cannonball with the app's Cr A/m at the start (ORION_CRAFT,
// the validation's fit), its mass falling at each burn.
const after = massAfterBurns(ORION_ENGINE.isp * 9.80665 / 1000).map((x) => ({ t: kt(x.ms), ratio: x.ratio }));
const M0 = 26000;
const ORION = {
  mass: M0, area: ORION_CRAFT.area * M0 / (ORION_CRAFT.dryMass + ORION_CRAFT.fuel), cr: ORION_CRAFT.cr,
  massAt: (t) => { let f = 1; for (const x of after) if (x.t <= t) f = x.ratio; return M0 * f; },
};
const TIERS = [
  ['Gravity: point masses, and J2 of the Earth, Moon and planets', null],
  ['+ sunlight pressure, with shadows', { ...ORION, earth: { degree: 0, tides: false }, moon: { degree: 0 }, relativity: false }],
  ["+ the Earth's field to degree 20, the Moon's to 50", { ...ORION, earth: { tides: false }, relativity: false }],
  ["+ the Earth's solid tides", { ...ORION, relativity: false }],
  ['+ relativity (the full model)', { ...ORION }],
];

line('1. THE MODEL, FORCE BY FORCE: 77 coast arcs against NASA\'s ephemeris');
const stats = (xs) => { const s = xs.slice().sort((a, b) => a - b); return { worst: s.at(-1), rms: Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length), median: s[s.length >> 1] }; };
const results = [];
for (const [name, opts] of TIERS) {
  const env = opts ? makeEnvironment(sys, opts) : null;
  const ends = arcs.map(([a, b]) => fly(a, b.ms, env));
  const miss = ends.map((r, i) => norm(sub(r, arcs[i][1].r)) * 1000);
  results.push({ name, ends, miss, ...stats(miss) });
  const S = results.at(-1);
  console.log(`  ${name.padEnd(62)} worst ${S.worst.toFixed(1).padStart(5)} m, rms ${S.rms.toFixed(1).padStart(5)} m, median ${S.median.toFixed(1).padStart(5)} m`);
}
const hours = arcs.map(([a, b]) => (b.ms - a.ms) / 3.6e6);
console.log(`  (${arcs.length} arcs, ${Math.min(...hours).toFixed(1)} to ${Math.max(...hours).toFixed(1)} h, ${hours.reduce((a, b) => a + b, 0).toFixed(0)} h in all; flown at an eighth of the kernel's default step)`);
// What each force moved the arc ends by, largest over the arcs.
for (let k = 1; k < results.length; k++) {
  const d = results[k].ends.map((r, i) => norm(sub(r, results[k - 1].ends[i])) * 1000);
  console.log(`  ${results[k].name.replace('+ ', '').padEnd(60)} moves an arc's end by up to ${d.reduce((a, b) => Math.max(a, b), 0).toFixed(2)} m`);
}
const full = results.at(-1), grav = results[0];
check('the full model ends every arc within 50 m of NASA\'s ephemeris', full.worst < 50);
check('the full model is closer than gravity alone, in rms', full.rms < grav.rms);

line('2. THE NUMBERS: the full model by the kernel at four steps, and by RK4');
{
  const env = makeEnvironment(sys, ORION);
  // Classical RK4 at a fixed step h (s), heliocentric, the same forces.
  const rk4 = (a, ms, h) => {
    const s = helioOf(a), tEnd = kt(ms);
    const f = (t, y, out) => {
      const g = accelHeliocentric([y[0], y[1], y[2]], sys.bodiesAt(t), sys.muSun, [0, 0, 0]);
      const e = env(t, [y[0], y[1], y[2]], [y[3], y[4], y[5]], [0, 0, 0], t);
      out[0] = y[3]; out[1] = y[4]; out[2] = y[5]; out[3] = g[0] + e[0]; out[4] = g[1] + e[1]; out[5] = g[2] + e[2];
    };
    let t = s.t, y = [...s.r, ...s.v];
    const k1 = new Array(6), k2 = new Array(6), k3 = new Array(6), k4 = new Array(6), tmp = new Array(6);
    while (t < tEnd) {
      const dt = Math.min(h, tEnd - t);
      f(t, y, k1);
      for (let i = 0; i < 6; i++) tmp[i] = y[i] + 0.5 * dt * k1[i]; f(t + 0.5 * dt, tmp, k2);
      for (let i = 0; i < 6; i++) tmp[i] = y[i] + 0.5 * dt * k2[i]; f(t + 0.5 * dt, tmp, k3);
      for (let i = 0; i < 6; i++) tmp[i] = y[i] + dt * k3[i]; f(t + dt, tmp, k4);
      for (let i = 0; i < 6; i++) y[i] += dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
      t += dt;
    }
    return geocentric(createState(y.slice(0, 3), y.slice(3), t), ms).r;
  };
  const ref = arcs.map(([a, b]) => rk4(a, b.ms, 5));
  const r10 = arcs.map(([a, b]) => rk4(a, b.ms, 10));
  const dRK = Math.max(...r10.map((r, i) => norm(sub(r, ref[i])) * 1000));
  console.log(`  RK4 at 10 s against RK4 at 5 s: up to ${dRK.toFixed(4)} m (RK4 has converged)`);
  const rows = [];
  for (const eta of [0.01, 0.005, 0.0025, 0.00125]) {
    const d = arcs.map(([a, b], i) => norm(sub(fly(a, b.ms, env, { eta }), ref[i])) * 1000);
    rows.push({ eta, ...stats(d) });
    console.log(`  the kernel at ${eta === 0.01 ? 'its default step' : `1/${Math.round(0.01 / eta)} of it`}`.padEnd(40) + ` against RK4: worst ${stats(d).worst.toFixed(3)} m, rms ${stats(d).rms.toFixed(3)} m`);
  }
  check('the kernel and an independent RK4 agree as the step shrinks (within 0.1 m at 1/8 of the default step)', rows.at(-1).worst < 0.1);
  check("at 1/8 of the default step the integrator's error is under a hundredth of the model's rms miss", rows.at(-1).rms < 0.01 * full.rms);
  console.log(`  at the app's default step the integrator adds up to ${rows[0].worst.toFixed(1)} m to an arc (rms ${rows[0].rms.toFixed(2)} m)`);
}

line("3. THE DATA: fresh states from JPL Horizons, asked for in TDB");
{
  const API = 'https://ssd.jpl.nasa.gov/api/horizons.api', CACHE = `${process.env.HOME}/.cache/digital-orrery/artemis1`;
  fs.mkdirSync(CACHE, { recursive: true });
  // A dozen instants spread over the flight, on the fixture's half-hours.
  const picks = fx.track30.filter((_, i) => i % 100 === 37).map((s) => row(s));
  const jd = (ms) => 2451545.0 + tdbSeconds(ms) / 86400;
  async function vectors(target, center) {
    const tlist = picks.map((p) => jd(p.ms).toFixed(9)).join(' ');
    const q = { format: 'text', COMMAND: `'${target}'`, EPHEM_TYPE: "'VECTORS'", CENTER: `'${center}'`, REF_PLANE: "'FRAME'", REF_SYSTEM: "'ICRF'",
      VEC_TABLE: "'2'", OUT_UNITS: "'KM-S'", CSV_FORMAT: "'YES'", VEC_LABELS: "'NO'", TIME_TYPE: "'TDB'", TLIST: `'${tlist}'`, TLIST_TYPE: "'JD'" };
    const name = `${CACHE}/spot_${target}_${center}.txt`.replace(/@/g, 'at');
    let text;
    if (fs.existsSync(name)) text = fs.readFileSync(name, 'utf8');
    else {
      const url = `${API}?${Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'digital-orrery trajectory validation' } });
      if (!res.ok) throw new Error(`Horizons: HTTP ${res.status}`);
      text = await res.text();
      if (!text.includes('$$SOE')) throw new Error(`Horizons gave no data:\n${text.slice(-400)}`);
      fs.writeFileSync(name, text);
    }
    return text.slice(text.indexOf('$$SOE') + 5, text.indexOf('$$EOE')).trim().split('\n').map((l) => l.split(',').map((x) => x.trim())).map((f) => ({ jd: Number(f[0]), r: f.slice(2, 5).map(Number), v: f.slice(5, 8).map(Number) }));
  }
  const orion = await vectors('-1023', '500@399'), moon = await vectors('301', '500@399'), sun = await vectors('10', '500@399');
  let dO = 0, dM = 0, dS = 0, dJ = 0;
  picks.forEach((p, i) => {
    dJ = Math.max(dJ, Math.abs(orion[i].jd - jd(p.ms)) * 86400);
    dO = Math.max(dO, norm(sub(orion[i].r, p.r)) * 1000);
    const e = helioStateEqj('earth', new Date(p.ms)), m = helioStateEqj('moon', new Date(p.ms));
    dM = Math.max(dM, norm(sub(moon[i].r, sub(m.r, e.r))) * 1000);
    dS = Math.max(dS, norm(sub(sun[i].r, e.r.map((x) => -x))));
  });
  console.log(`  ${picks.length} instants, ${picks[0].ms && new Date(picks[0].ms).toISOString().slice(0, 10)} to ${new Date(picks.at(-1).ms).toISOString().slice(0, 10)}; Horizons' epochs match ours to ${(dJ * 1e3).toFixed(2)} ms`);
  console.log(`  Orion: the fixture (asked in UTC) against Horizons asked in TDB: up to ${dO.toFixed(3)} m apart`);
  console.log(`  the Moon from the Earth: the app's (DE442) against Horizons': up to ${dM.toFixed(1)} m`);
  console.log(`  the Sun from the Earth: up to ${dS.toFixed(3)} km`);
  check('the fixture is the same trajectory asked for in TDB (within 1 m): the UTC-TDB conversion is right', dO < 1);
  check('the Moon the kernel flies by is where Horizons has it (within 100 m)', dM < 100);
  check('so is the Sun (within 10 km)', dS < 10);
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
