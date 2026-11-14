// src/physics/deTable.test.mjs
//
// The DE442 table's ends (ephemeris.js): 2000-2050 is DE442 alone, and at
// each end of the table each body is blended into astronomy-engine, so
// nothing jumps where one gives way to the other. Checked for every body
// and the SSB:
//   - DE442 alone from 2000-01-01 12:00 TDB to 2051-01-01;
//   - at each end, within a metre of astronomy-engine;
//   - inside the blend, velocity the derivative of position (as far as
//     astronomy-engine's own velocity is: Pluto's is not);
//   - the ramp's own acceleration under 1.5 % of the Sun's pull there;
//   - through helioStateEqjAtTt (the kernel), no jump across the end.
//
//   node src/physics/deTable.test.mjs

import './deNode.js';
import * as Astronomy from 'astronomy-engine';
import { helioStateEqj, helioStateEqjAtTt, fromDe442, utcMsAtTt, BLEND_DAYS } from './ephemeris.js';
import { baryStateEqj } from './barycentres.js';
import { deKeySpan, deHelioState } from './deTable.js';

const AU_KM = 149597870.7, DAY = 86400, MU_SUN = 1.32712440041253311e11;
const KEYS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const AE_BODY = { mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'Moon', mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto' };
// TDB seconds -> Date (TDB - TT is under 2 ms, a metre at most here).
const dateAt = (et) => new Date(utcMsAtTt(et));
const ae = (key, et) => { const s = Astronomy.HelioState(Astronomy.Body[AE_BODY[key]], dateAt(et)); return [s.x, s.y, s.z].map((x) => x * AU_KM); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// 2000-2050 is DE442's alone, at both ends and in between.
const CORE = ['2000-01-01T12:00:00Z', '2026-11-14T00:00:00Z', '2050-12-31T23:00:00Z'].map((d) => new Date(d));
check(CORE.every((d) => [...KEYS, 'ssb'].every((k) => fromDe442(k, d))), 'every body and the SSB are DE442 alone on 2000-01-01, 2026-11-14 and 2050-12-31');

for (const key of KEYS) {
  const [t0, t1] = deKeySpan(key), T = BLEND_DAYS[key] * DAY;
  // At each end, the blend has handed over to astronomy-engine.
  const edge = Math.max(dist(helioStateEqj(key, dateAt(t0 + 1)).r, ae(key, t0 + 1)), dist(helioStateEqj(key, dateAt(t1 - 1)).r, ae(key, t1 - 1)));
  // The jump the blend smooths: DE442 against astronomy-engine where the
  // blend begins.
  const jump = dist(helioStateEqj(key, dateAt(t1 - T)).r, ae(key, t1 - T));
  // Inside the blend at the late end: velocity against a central
  // difference of positions (h = 60 s). And what the ramp itself adds to
  // the acceleration, 2 w' (v_DE - v_AE) + w'' (r_DE - r_AE): the blend's
  // second difference less w a_DE + (1 - w) a_AE (h = 1 day for the outer
  // planets, 1 h inside), as a share of the Sun's pull. The rest, (1 - w)
  // (a_AE - a_DE), is astronomy-engine's own, which beyond the table it has
  // in full (2 % of the Sun's for Pluto, whose positions are piecewise).
  const wAt = (et) => { const x = Math.min(1, (t1 - et) / T); return x * x * x * (10 - 15 * x + 6 * x * x); };
  const deR = (et) => deHelioState(key, et).r;
  const h = 60, hA = T > 100 * DAY ? DAY : 3600;
  let dv = 0, dvAe = 0, extra = 0;
  const aeV = (et) => { const s = Astronomy.HelioState(Astronomy.Body[AE_BODY[key]], dateAt(et)); return [s.vx, s.vy, s.vz].map((x) => (x * AU_KM) / DAY); };
  for (let i = 1; i < 40; i++) {
    const et = t1 - T + (T * i) / 40;
    const p = (t) => helioStateEqj(key, dateAt(t)).r;
    const v = helioStateEqj(key, dateAt(et)).v, a = p(et - h), b = p(et + h);
    dv = Math.max(dv, Math.hypot(...[0, 1, 2].map((j) => (b[j] - a[j]) / (2 * h) - v[j])));
    const u = aeV(et), c = ae(key, et - h), e = ae(key, et + h);
    dvAe = Math.max(dvAe, Math.hypot(...[0, 1, 2].map((j) => (e[j] - c[j]) / (2 * h) - u[j])));
    const pa = p(et - hA), pb = p(et), pc = p(et + hA), qa = ae(key, et - hA), qb = ae(key, et), qc = ae(key, et + hA);
    const da = deR(et - hA), db = deR(et), dc = deR(et + hA), w = wAt(et);
    const acc = [0, 1, 2].map((j) => ((pc[j] - 2 * pb[j] + pa[j]) - w * (dc[j] - 2 * db[j] + da[j]) - (1 - w) * (qc[j] - 2 * qb[j] + qa[j])) / (hA * hA));
    extra = Math.max(extra, Math.hypot(...acc) / (MU_SUN / (Math.hypot(...pb) ** 2)));
  }
  // Through the kernel's TT path, across the late end: 2 s apart, the body
  // moves under 0.2 km, so a jump would show.
  const tt = t1 - 0.0016;
  const s0 = helioStateEqjAtTt(key, tt - 1), s1 = helioStateEqjAtTt(key, tt + 1);
  const across = dist(s0.r, s1.r), moved = 2 * Math.hypot(...s0.v);
  // The Moon's acceleration is the Earth's pull, not the Sun's: its blend
  // shares Earth's, so only the edge, velocity and TT checks apply.
  const accOk = key === 'moon' || extra < 0.015;
  check(edge < 1e-3 && dv < dvAe + 1e-6 && accOk && Math.abs(across - moved) < 1e-3,
    `${key.padEnd(8)} blend ${BLEND_DAYS[key]} d over a ${jump.toFixed(0)} km jump: at the ends ${(edge * 1e3).toFixed(3)} m from astronomy-engine; velocity within ${(dv * 1e6).toFixed(3)} mm/s (astronomy-engine's own ${(dvAe * 1e6).toFixed(3)}); the ramp's acceleration ${(extra * 100).toFixed(3)} % of the Sun's${key === 'moon' ? ' (not checked)' : ''}; across the end ${across.toFixed(4)} km in 2 s (moves ${moved.toFixed(4)})`);
}

// The SSB blends into the sum over every body (barycentres.js).
{
  const [, t1] = deKeySpan('ssb'), T = BLEND_DAYS.ssb * DAY;
  let dv = 0;
  for (let i = 1; i < 20; i++) {
    const et = t1 - T + (T * i) / 20, h = 60;
    const v = baryStateEqj('ssb', dateAt(et)).v, a = baryStateEqj('ssb', dateAt(et - h)).r, b = baryStateEqj('ssb', dateAt(et + h)).r;
    dv = Math.max(dv, Math.hypot(...[0, 1, 2].map((j) => (b[j] - a[j]) / (2 * h) - v[j])));
  }
  const tt = t1 - 0.0016, s0 = baryStateEqj('ssb', dateAt(tt - 1)), b = baryStateEqj('ssb', dateAt(tt + 1)).r;
  const across = dist(s0.r, b), moved = 2 * Math.hypot(...s0.v);
  check(dv < 1e-6 && Math.abs(across - moved) < 1e-3, `SSB blend ${BLEND_DAYS.ssb} d: velocity within ${(dv * 1e6).toFixed(4)} mm/s; across the end ${(across * 1e3).toFixed(2)} m in 2 s (moves ${(moved * 1e3).toFixed(2)})`);
}

if (failed) { console.log(`\n${failed} table check(s) failed`); process.exit(1); }
console.log('\ndeTable: all checks passed');
