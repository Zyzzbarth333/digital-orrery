// src/physics/entry.test.mjs
//
// The entry model (entry.js, through environment.js and the kernel): the
// lift's direction, the guidance's fast prediction against the kernel, and
// the guidance landing a capsule on its target, directly and by a skip.
//
//   node src/physics/entry.test.mjs

import './deNode.js';
import { liftDirection, predict, earthFixedUnit } from './entry.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS, kernelSeconds, kernelMs, stepCraft } from './kernelHost.js';
import { helioStateEqj } from './ephemeris.js';
import { earthFixedAt, makeEnvironment } from './environment.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = norm(a); return a.map((x) => x / n); };
const D2R = Math.PI / 180;

header('THE LIFT: across the air, up at no bank, toward the orbit normal at +90 degrees');
{
  const r = [6500, 300, 100], v = [-1, 7.5, 2];
  const L0 = liftDirection(r, v, 0), L90 = liftDirection(r, v, Math.PI / 2), L180 = liftDirection(r, v, Math.PI);
  const n = unit(cross(r, v));
  check('unit length and across the velocity at any bank', [0.3, 1.2, 2.5].every((s) => { const L = liftDirection(r, v, s); return Math.abs(norm(L) - 1) < 1e-12 && Math.abs(dot(L, unit(v))) < 1e-12; }));
  check('at no bank it points up, in the plane of radius and velocity', dot(L0, unit(r)) > 0.99 && Math.abs(dot(L0, n)) < 1e-12);
  check('at +90 degrees along the orbit normal r x v; at 180 down', dot(L90, n) > 1 - 1e-12 && dot(L180, unit(r)) < -0.99);
}

// An Orion-like capsule returning from the Moon: 122 km up, 11 km/s, 5.8
// degrees below the horizon, heading east-north-east over the Pacific.
const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
const T0MS = Date.parse('2022-12-11T17:20:00Z'), t0 = kernelSeconds(new Date(T0MS));
const fixed = earthFixedAt(KERNEL_EPOCH_MS);
const M0 = fixed(t0);
const toInertial = (x) => [0, 1, 2].map((j) => M0[0][j] * x[0] + M0[1][j] * x[1] + M0[2][j] * x[2]);
const start = (() => {
  const up = toInertial(earthFixedUnit(10, -170)), pole = M0[2];
  const east = unit(cross(pole, up)), north = cross(up, east);
  const head = 70 * D2R, gamma = -5.8 * D2R, along = east.map((e, i) => Math.sin(head) * e + Math.cos(head) * north[i]);
  const r = up.map((x) => x * (6378.137 + 122));
  const v = along.map((x, i) => 11.0 * (Math.cos(gamma) * x + Math.sin(gamma) * up[i]));
  return { r, v };
})();
const CAP = { mass: 9300, area: 19.6, cd: 1.3, ld: 0.27 };
const E = helioStateEqj('earth', new Date(T0MS));
// Fly the kernel to the ground (or the time limit), carrying the guidance's
// state between one-minute requests as the app does.
function fly(entry, limit = 4000, trace = false) {
  let r = start.r.map((x, i) => x + E.r[i]), v = start.v.map((x, i) => x + E.v[i]), t = t0, state = null, minAlt = Infinity, skipTop = null, prevAlt = 122;
  const env = { mass: CAP.mass, area: CAP.area, cd: CAP.cd, cr: 0, earth: { degree: 2 }, entry };
  while (t - t0 < limit) {
    const res = stepCraft(sys, { id: 1, version: 0, r, v, t, tEnd: t + 60, maxSteps: 1e6, primary: 'earth', burns: [], env: { ...env, entry: { ...entry, state } } });
    if (res.envState?.entry) state = res.envState.entry;
    if (trace) { const ee = sys.bodiesAt(res.t).find((b) => b.key === 'earth'); console.log(`    ${(res.t - t0).toFixed(0).padStart(5)} s  alt ${(norm(sub(res.r, ee.r)) - 6378.137).toFixed(2)} complete ${res.complete} steps ${res.steps} t ${(res.t - t).toFixed(1)}  bank ${state ? (state.sign * state.sigma / D2R).toFixed(1) : '-'}${state?.held ? ' held' : ''}`); }
    const e = sys.bodiesAt(res.t).find((b) => b.key === 'earth');
    const rel = sub(res.r, e.r), alt = norm(rel) - 6378.137;
    if (alt > prevAlt && prevAlt < minAlt) minAlt = prevAlt;
    if (alt < prevAlt && prevAlt > (skipTop ?? 0) && minAlt < 100) skipTop = prevAlt;
    prevAlt = alt;
    r = res.r; v = res.v; t = res.t;
    if (res.events.some((x) => x.type === 'impact')) {
      const M = fixed(t), g = [dot(M[0], rel), dot(M[1], rel), dot(M[2], rel)];
      // Speed over the ground: less the Earth's turn at that place.
      const ve = sub(v, e.eph.velocity(t)), w = cross(M[2], rel).map((q) => q * 7.2921158553e-5);
      return { t: t - t0, ef: unit(g), skipTop, speed: norm(sub(ve, w)) };
    }
  }
  return null;
}
const angle = (a, b) => Math.acos(Math.min(1, dot(a, b)));

header('THE PREDICTION against the kernel, at a held bank');
{
  for (const bankDeg of [75, 100, 120]) {
    const k = fly({ ld: CAP.ld, bank: bankDeg * D2R });
    // As the guidance predicts: with the kernel's own upper air, looked up
    // where the capsule is.
    const upperAt = makeEnvironment(sys, { mass: CAP.mass, area: CAP.area, cd: CAP.cd, cr: 0, earth: { degree: 0 } }).upperAir;
    const p = predict(start.r, start.v, bankDeg * D2R, { ld: CAP.ld, cdaPerMass: CAP.cd * CAP.area / CAP.mass, pole: M0[2], upperAt, M0, t0, hStop: 0 });
    if (!k || !p) { check(`bank ${bankDeg} deg: both come down`, false); continue; }
    // The prediction stops at sea level in inertial axes; the kernel's
    // landing is Earth-fixed: turn the prediction's by the Earth's rotation.
    const Mp = fixed(t0 + p.t), pe = unit([dot(Mp[0], p.r), dot(Mp[1], p.r), dot(Mp[2], p.r)]);
    const d = angle(pe, k.ef) * 6371;
    console.log(`  bank ${String(bankDeg).padStart(3)} deg: kernel lands after ${k.t.toFixed(0)} s, prediction after ${p.t.toFixed(0)} s, ${d.toFixed(1)} km apart; downrange ${(angle(unit(start.r.map((x, i) => x)), toInertial(k.ef)) * 6371).toFixed(0)} km`);
    check(`bank ${bankDeg} deg: the guidance's prediction lands within 1 % of the range of the kernel's flight`, d < 0.01 * angle(unit(toInertial(earthFixedUnit(10, -170))), toInertial(k.ef)) * 6371 + 5);
  }
}

header('THE GUIDANCE lands the capsule on its target');
{
  // A target the capsule can reach: where it lands at a held bank of 100
  // degrees, moved 100 km further on and 0.3 degrees to the right. The
  // guidance has to find its own bank. (The skip is checked on Artemis I,
  // below.)
  const e2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
  const ll = (u) => ({ lat: Math.atan(Math.tan(Math.asin(u[2])) / (1 - e2)) / D2R, lon: Math.atan2(u[1], u[0]) / D2R });
  const u0 = earthFixedUnit(10, -170);
  for (const [label, held] of [['a direct entry', 100]]) {
    const k = fly({ ld: CAP.ld, bank: held * D2R }, 6000);
    const fwd = unit(cross(cross(u0, k.ef), k.ef)), side = unit(cross(k.ef, fwd));
    // To the right: a held positive bank turns left all the way, so its
    // landing is already the farthest left the capsule reaches, and only
    // reversing the bank brings it right.
    const T = unit(k.ef.map((x, i) => x + (100 / 6371) * fwd[i] - Math.tan(0.3 * D2R) * side[i]));
    const g = fly({ ld: CAP.ld, target: ll(T), chutes: { drogue: { height: 7.6, cda: 2 * 0.6 * 38 }, main: { height: 2.9, cda: 3 * 0.85 * 960 } } }, 6000, process.env.TRACE === label);
    const miss = g ? angle(T, g.ef) * 6371 : Infinity;
    const nT = unit(cross(u0, T)), downBeyond = g ? (angle(u0, g.ef) - angle(u0, T)) * 6371 : NaN, aside = g ? Math.asin(dot(nT, g.ef)) * 6371 : NaN;
    console.log(`  ${label} to ${(angle(u0, T) * 6371).toFixed(0)} km (${held} deg held lands ${(angle(u0, k.ef) * 6371).toFixed(0)} km${k.skipTop ? `, skipping to ${k.skipTop.toFixed(0)} km` : ''}): ${g ? `guided down after ${(g.t / 60).toFixed(1)} min, ${miss.toFixed(1)} km from the target (${downBeyond.toFixed(1)} beyond, ${aside.toFixed(1)} aside), at ${(g.speed * 1000).toFixed(1)} m/s${g.skipTop ? `, skipping to ${g.skipTop.toFixed(0)} km` : ''}` : 'did not come down'}`);
    check(`${label}: lands within 5 km of the target, under the mains at under 12 m/s`, g && miss < 5 && g.speed < 0.012);
  }
}

header("ARTEMIS I AND II: Orion's entries from the end of the flight data, against NASA's");
{
  // From the last flown state (Artemis I: 17:19, just before entry
  // interface; Artemis II: 23:29, 24 minutes before), as the crew module
  // (orion.js), guided to the mission's target, to the sea.
  const fs = await import('node:fs');
  const { orionFor, ORION_ENTRIES } = await import('./orion.js');
  const { heightAbove } = await import('./entry.js');
  const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19);
  for (const id of ['artemis1', 'artemis2']) {
    const C = orionFor(id), EN = ORION_ENTRIES[id], F = EN.flown;
    const d = JSON.parse(fs.readFileSync(new URL(`../../public/missions/${id}.json`, import.meta.url)));
    const last = d.flown.at(-1), Ee = helioStateEqj('earth', new Date(last[0]));
    let r = last.slice(1, 4).map((x, i) => x + Ee.r[i]), v = last.slice(4, 7).map((x, i) => x + Ee.v[i]), t = kernelSeconds(new Date(last[0])), state = null;
    let phase = 'in', prevH = Infinity, dip = null, top = null, drogues = null, mains = null, land = null, speed = 0;
    for (let k = 0; k < 2000 && !land; k++) {
      const res = stepCraft(sys, { id: 1, version: 0, r, v, t, tEnd: t + 5, maxSteps: 1e6, primary: 'earth', burns: [], env: { mass: C.mass, area: C.area, cd: C.cd, cr: 1.3, entry: { aero: C.aero, chutes: C.chutes, target: EN.target, state } } });
      state = res.envState?.entry ?? state;
      const e = sys.bodiesAt(res.t).find((b) => b.key === 'earth'), rel = sub(res.r, e.r), M = fixed(res.t), h = heightAbove(rel, M[2]);
      if (phase === 'in' && h < 100 && h > prevH) { dip = prevH; phase = 'up'; }
      if (phase === 'up' && h < prevH) { top = prevH; phase = 'down'; }
      if (!drogues && h < C.chutes.drogue.height) drogues = kernelMs(res.t);
      if (!mains && h < C.chutes.main.height) mains = kernelMs(res.t);
      prevH = h; r = res.r; v = res.v; t = res.t;
      if (res.events.some((x) => x.type === 'impact')) {
        const ve = sub(v, e.eph.velocity(t)), w = cross(M[2], rel).map((q) => q * 7.2921158553e-5);
        land = { ms: kernelMs(t), ef: unit([dot(M[0], rel), dot(M[1], rel), dot(M[2], rel)]) };
        speed = norm(sub(ve, w)) * 1000;
      }
    }
    const miss = land ? angle(land.ef, earthFixedUnit(EN.target.lat, EN.target.lon)) * 6371 : Infinity;
    console.log(`  ${d.name}: ${dip ? `dips to ${dip.toFixed(1)} km${F.firstDipKm ? ` (flown ${F.firstDipKm})` : ''}, skips to ${top?.toFixed(1)} km${F.skipApogeeKm ? ` (flown ${F.skipApogeeKm.toFixed(1)})` : ' (flown: no climb back out)'}` : 'no skip'}; drogues ${drogues ? hhmmss(drogues) : '-'} (flown ${hhmmss(F.droguesMs)}), mains ${mains ? hhmmss(mains) : '-'} (flown ${hhmmss(F.mainsMs)}), down ${land ? hhmmss(land.ms) : '-'} (flown ${hhmmss(F.splashdownMs)}) at ${speed.toFixed(1)} m/s, ${miss.toFixed(1)} km from ${EN.approximateTarget ? 'the approximate target' : "NASA's splashdown"}`);
    const within = (a, b, s) => a && Math.abs(a - b) < s * 1000;
    if (id === 'artemis1') {
      check("Artemis I: a skip like the flown one (dip 50-65 km, top 80-105 km; flown 61 and 87.6)", dip > 50 && dip < 65 && top > 80 && top < 105);
      check("Artemis I: drogues and mains within 90 s of NASA's times, down under the mains at under 12 m/s", within(drogues, F.droguesMs, 90) && within(mains, F.mainsMs, 90) && speed < 12);
      check("Artemis I: down within 15 km of NASA's splashdown (NASA: 2.1 nmi from its target)", miss < 15);
    } else {
      check("Artemis II: drogues, mains and splashdown within 2 minutes of NASA's, under 12 m/s", within(drogues, F.droguesMs, 120) && within(mains, F.mainsMs, 120) && within(land?.ms, F.splashdownMs, 120) && speed < 12);
      check('Artemis II: down within 5 km of the (approximate) target', miss < 5);
    }
  }
}

console.log('='.repeat(60));
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
