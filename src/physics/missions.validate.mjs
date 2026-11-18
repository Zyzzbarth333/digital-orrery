// src/physics/missions.validate.mjs
//
// The real missions beyond Artemis flown by the app's kernel against their
// reconstructed trajectories (docs/validation/<id>.md). Each mission's
// reference is its navigation team's reconstruction through JPL Horizons,
// held as a fixture (src/physics/fixtures/<id>.json, npm run
// build:missions -- <id>); its published burns and flybys are in
// missions.data.mjs. Every mission gets the same five cases:
//
//   1. the burns, against what was published;
//   2. the joins between navigation solutions;
//   3. the coast arcs between events, flown by the kernel: gravity alone,
//      then the full environment with the sunlight pressure fitted;
//   4. the flybys, flown through by the kernel;
//   5. the app's mission file, flown as the app flies it.
//
//   node src/physics/missions.validate.mjs [id ...]   (all, by default)

import './deNode.js';
import fs from 'node:fs';
import { MISSIONS } from './missions.data.mjs';
import { toRow, coast, about, steadyBurn, fitSteadyBurn, norm, sub, add, dot, cross, unit, sys, kt, bodyState, distanceTo, closestApproach, burnFromSamples } from './flown.lib.mjs';
import { makeEnvironment } from './environment.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const hhmm = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const RE = 6378.137, F_WGS84 = 1 / 298.257223563;
const G0 = 9.80665;
const RADIUS = { earth: RE, moon: 1737.4, venus: 6051.8, mercury: 2439.4, mars: 3396.2 };

// Height above the WGS-84 ellipsoid of a geocentric J2000 position at ms
// (Bowring's method in one step; the latitude is all that matters).
function geodeticHeight(r, ms) {
  const { earthFixedAxes } = ORI;
  const A = earthFixedAxes(ms).M;   // rows: the Earth-fixed axes in J2000
  const x = dot(A[0], r), y = dot(A[1], r), z = dot(A[2], r);
  const a = RE, b = a * (1 - F_WGS84), e2 = 1 - (b * b) / (a * a), p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 5; i++) { const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2); lat = Math.atan2(z + e2 * N * Math.sin(lat), p); }
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return { h: p / Math.cos(lat) - N, lat: lat * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI };
}
const ORI = await import('./orientation.js');

const ids = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MISSIONS);
for (const id of ids) {
  const M = MISSIONS[id], C = M.checks;
  const fixPath = new URL(`./fixtures/${id}.json`, import.meta.url);
  if (!fs.existsSync(fixPath)) { console.log(`${id}: no fixture; run npm run build:missions -- ${id} (skipped)`); continue; }
  const fx = JSON.parse(fs.readFileSync(fixPath));
  const centre = fx.centre;
  const events = fx.events.map((e) => ({ ...e, rows: e.rows.map(toRow) }));
  const mass0 = M.craft.dryMass + M.craft.fuel;
  console.log(`\n${'#'.repeat(72)}\n# ${M.name} (${id}): ${M.source}\n${'#'.repeat(72)}`);

  // ---------------------------------------------------------------- 1
  header(`${id} CASE 1: the burns, against the published figures`);
  const env0 = makeEnvironment(sys, { mass: mass0, area: M.craft.area, cr: M.craft.cr });
  // A burn from its 10 s samples, or one whose samples ring, as one steady
  // push of the change across its span (steadyBurn).
  const steadyOf = (e) => {
    // Refitted from the samples either side, over the build's length.
    const fit = fitSteadyBurn(e.rows, e.ring[0], e.ring[1], e.about, (e.fit[1] - e.fit[0]) / 1000, { mass: mass0, area: M.craft.area, cr: M.craft.cr }, { centreMs: e.fitCentreMs });
    return { ...steadyBurn(fit.t0, fit.t1, fit.dv, null, e.about, true), fit };
  };
  const burns = events.filter((e) => e.kind === 'burn').map((e) => ({ e, ...(e.steady
    ? steadyOf(e)
    : burnFromSamples(e.burnRange ? e.rows.filter((p) => p.ms >= e.burnRange[0] && p.ms <= e.burnRange[1]) : e.rows, e.about, e.about, env0, e.about === 'sun')) }));
  console.log('  burn                       ignition (UTC)       cutoff     length    ours m/s  published');
  const matched = M.published.map((p) => {
    const b = burns.find((x) => (p.endUtc && !p.towardMs ? Math.abs(Date.parse(p.endUtc) - x.cutoffMs) < 600e3 : p.utc ? Math.abs(Date.parse(p.utc) - x.ignitionMs) < 3600e3 : p.day ? new Date(x.ignitionMs).toISOString().startsWith(p.day) : false) || (p.mps && Math.abs(norm(x.dv) * 1000 - p.mps) < 0.02 * p.mps));
    return { p, b };
  });
  for (const b of burns) {
    const m = matched.find((x) => x.b === b), mps = norm(b.dv) * 1000, len = (b.cutoffMs - b.ignitionMs) / 1000;
    console.log(`  ${(m?.p.name ?? 'found in the trajectory').padEnd(26)} ${hhmm(b.ignitionMs)}  ${hhmm(b.cutoffMs).slice(11)}  ${String(Math.round(len)).padStart(5)} s  ${mps.toFixed(3).padStart(9)}  ${m?.p.mps ? `${m.p.mps} m/s` : '—'}${m?.p.seconds ? `, ${m.p.seconds} s` : ''}`);
  }
  check(`every published burn is found in the trajectory (${M.published.length})`, matched.every((x) => x.b));
  // Burns fitted steady (their samples ring): what one steady push leaves.
  const steadyFits = burns.filter((b) => b.fit);
  for (const b of steadyFits) console.log(`  ${hhmm(b.ignitionMs)}: fitted steady over ${((b.cutoffMs - b.ignitionMs) / 1000).toFixed(0)} s, ${(norm(b.dv) * 1000).toFixed(3)} m/s (its samples' sum ${b.e.mps.toFixed(3)}); half an hour on, ${(b.fit.missKm * 1000).toFixed(0)} m and ${(b.fit.offMms / 1000).toFixed(2)} m/s from the reconstruction`);
  if (steadyFits.length) check(`each burn fitted steady leaves under ${C.steadyOffMms / 1000} m/s half an hour on, and is within 6 % of its samples' sum`, steadyFits.every((b) => b.fit.offMms < C.steadyOffMms && Math.abs(norm(b.dv) * 1000 / b.e.mps - 1) < 0.06));
  // Published times without a delta-v: an ignition (LICIACube's release),
  // or a span of thrusting (SMART Nav's toward Dimorphos).
  for (const { p, b } of matched.filter((x) => x.b && !x.p.mps)) {
    if (p.utc) check(`${p.name}: at ${hhmm(b.ignitionMs)} against ${hhmm(Date.parse(p.utc))} published (within a minute: published to the minute)`, Math.abs(b.ignitionMs - Date.parse(p.utc)) <= 60e3);
    if (p.towardMs) check(`${p.name}: thrusting from ${hhmm(b.ignitionMs)} against ${hhmm(p.towardMs)} published ("50 minutes prior to impact"; within a minute)`, Math.abs(b.ignitionMs - p.towardMs) <= 60e3);
    if (p.endUtc) check(`${p.name}: thrust ends ${hhmm(b.cutoffMs)} against ${hhmm(Date.parse(p.endUtc))} published (within the 10 s sampling)`, Math.abs(b.cutoffMs - Date.parse(p.endUtc)) <= 10e3);
    if (p.seconds && !p.lengthUnresolved) {
      const len = (b.cutoffMs - b.ignitionMs) / 1000, tolS = p.seconds % 60 ? 2 : 60;
      check(`${p.name}: ${len.toFixed(0)} s against ${p.seconds} s published (within ${tolS} s, a figure given to the ${tolS === 2 ? 'second' : 'minute'}, and the 10 s sampling)`, Math.abs(len - p.seconds) <= tolS + 10);
    }
  }
  for (const { p, b } of matched.filter((x) => x.b && x.p.mps)) {
    const mps = norm(b.dv) * 1000, len = (b.cutoffMs - b.ignitionMs) / 1000;
    // A published figure rounded to whole m/s ("about 344 m/s") is held to
    // its rounding plus a tenth of a percent.
    const tol = 0.5 + 1e-3 * p.mps;
    check(`${p.name}: ${mps.toFixed(2)} m/s against ${p.mps} m/s published (within ${tol.toFixed(2)} m/s)`, Math.abs(mps - p.mps) < tol);
    if (p.seconds && !p.lengthUnresolved) {
      // "29 minutes 39 seconds" to the second; "30 minutes" to the minute.
      const tolS = p.seconds % 60 ? 2 : 60;
      check(`${p.name}: ${len.toFixed(0)} s against ${p.seconds} s published (within ${tolS} s, a figure given to the ${tolS === 2 ? 'second' : 'minute'}, and the ${fx.fine.slice(1)} s sampling)`, Math.abs(len - p.seconds) <= tolS + 10);
    }
    if (p.utc) check(`${p.name}: ignition ${hhmm(b.ignitionMs)} against ${hhmm(Date.parse(p.utc))} published (within ${(p.utcTolS ?? 60) / 60} min${p.utcTolS ? `: ${p.utcNote}` : ''})`, Math.abs(b.ignitionMs - Date.parse(p.utc)) <= (p.utcTolS ?? 60) * 1000);
  }

  // ---------------------------------------------------------------- 2
  header(`${id} CASE 2: the joins between navigation solutions`);
  const joins = events.filter((e) => e.kind === 'join');
  for (const j of joins) console.log(`  ${hhmm(j.rows[0].ms)}  ${(j.mps * 1000).toFixed(2)} mm/s about ${j.about}`);
  console.log(`  the coarse ${fx.step} steps flown by gravity alone leave ${fx.stepResidualMmS.join(', ')} mm/s (median, 90th, 99th percentile): the forces the kernel leaves out, sunlight most of all`);

  // ---------------------------------------------------------------- 3
  header(`${id} CASE 3: coast arcs between events, flown by the kernel`);
  // From each event's last sample to the next one's first (and from the
  // start, and to the end), each about the body its samples are about.
  const first = { ...toRow(fx.daily[0]), about: centre }, last = { ...toRow(fx.last ?? fx.daily.at(-1)), about: centre };
  const starts = [first, ...events.map((e) => ({ ...e.rows.at(-1), about: e.about }))];
  const ends = [...events.map((e) => ({ ...e.rows[0], about: e.about })), last];
  // Arcs of a day or more (M.minArcH: LRO's in lunar orbit are a day or less).
  const arcs = starts.map((a, i) => [a, ends[i]]).filter(([a, b]) => b.ms - a.ms >= (M.minArcH ?? 24) * 3600e3);
  // The craft's mass falls at each burn: the rocket equation at the engine's
  // Isp, each burn's change drawn at its cutoff.
  const ve = M.craft.isp * G0 / 1000;
  const massSteps = []; let m = mass0;
  for (const b of burns) { m *= Math.exp(-norm(b.dv) / ve); massSteps.push({ t: kt(b.cutoffMs), m }); }
  const massAt = (t) => { let x = mass0; for (const s of massSteps) if (s.t <= t) x = s.m; return x; };
  const dark = makeEnvironment(sys, { mass: mass0, area: M.craft.area, cr: 0, massAt });
  const lit = makeEnvironment(sys, { mass: mass0, area: M.craft.area, cr: M.craft.cr, massAt });
  const REF = M.craft.cr * M.craft.area / mass0;
  const errs = arcs.map(([a, b]) => {
    const e0 = sub(coast(a, b.ms, a.about, dark, b.about).r, b.r);
    const plain = norm(sub(coast(a, b.ms, a.about, null, b.about).r, b.r));
    // Sunlight is a small push: the end moves in proportion to its strength.
    const push = sub(sub(coast(a, b.ms, a.about, lit, b.about).r, b.r), e0);
    return { a, b, days: (b.ms - a.ms) / 864e5, plain, e0, push };
  });
  const k2 = errs.reduce((s, x) => s + dot(x.push, x.push), 0);
  const k = -errs.reduce((s, x) => s + dot(x.e0, x.push), 0) / k2;
  const fitted = errs.map((x) => norm(add(x.e0, x.push.map((y) => y * k))));
  const atNominal = errs.map((x) => norm(add(x.e0, x.push)));
  console.log('  arc                                  days    gravity only    full, Cr A/m as built    full, fitted');
  errs.forEach((x, i) => console.log(`  ${hhmm(x.a.ms).slice(0, 16)} to ${hhmm(x.b.ms).slice(0, 16)} ${x.days.toFixed(1).padStart(6)} ${x.plain.toFixed(1).padStart(12)} km ${atNominal[i].toFixed(2).padStart(14)} km ${fitted[i].toFixed(3).padStart(14)} km`));
  const rms = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
  console.log(`  sunlight: Cr A/m as built ${(REF * 1e3).toFixed(2)}e-3 m^2/kg at the start; the arcs fit ${(k * REF * 1e3).toFixed(3)}e-3 (${(k * 100).toFixed(1)} % of it)`);
  console.log(`  rms at the arcs' ends: gravity only ${rms(errs.map((x) => x.plain)).toFixed(1)} km, full environment as built ${rms(atNominal).toFixed(2)} km, fitted ${rms(fitted).toFixed(3)} km`);
  check(`every coast arc ends within ${C.arcFittedKm} km of the reconstruction with the full environment and the sunlight fitted`, Math.max(...fitted) < C.arcFittedKm);
  check(`sunlight on the craft explains the arcs: fitted, the rms falls at least ${C.arcGain} times from gravity alone`, rms(fitted) * C.arcGain < rms(errs.map((x) => x.plain)));
  check(`the fitted sunlight is within ${C.crFitPct} % of the craft as built (Cr ${M.craft.cr}, ${M.craft.area.toFixed(1)} m^2)`, Math.abs(k - 1) * 100 < C.crFitPct);
  // The app flies the craft with the fitted strength (craft.appCr), as it
  // flies Orion with Artemis I's.
  if (M.craft.appCr) check(`the app's craft (Cr ${M.craft.appCr}) is within 2 % of the fit (Cr ${(M.craft.cr * k).toFixed(3)})`, Math.abs(M.craft.appCr / (M.craft.cr * k) - 1) < 0.02);

  // The orbits reached (M.orbits): osculating about the body, from the
  // first sample after the burn named (or the last sample of all), its
  // periapsis and apoapsis heights above the mean radius.
  if (M.orbits) {
    header(`${id} CASE 3b: the orbits reached`);
    const { rvToElements } = await import('./orbital.js');
    for (const o of M.orbits) {
      const e = o.after === 'last' ? null : matched.find((x) => x.p.name === o.after)?.b?.e;
      const p = o.after === 'last' ? { ...toRow(fx.last), about: centre } : { ...e.rows.at(-1), about: e.about };
      const key = 'moon', B = bodyState(key, p.ms), C0 = bodyState(p.about, p.ms);
      const r = sub(add(p.r, C0.r), B.r), vv = sub(add(p.v, C0.v), B.v);
      const el = rvToElements(r, vv, sys.bodyAt(key, kt(p.ms)).mu);
      const peri = el.a * (1 - el.e) - RADIUS[key], apo = el.a * (1 + el.e) - RADIUS[key];
      console.log(`  after ${o.after}: ${peri.toFixed(1)} by ${apo.toFixed(1)} km, inclination ${(el.i * 180 / Math.PI).toFixed(2)} deg to the J2000 equator (published ${o.periKm} by ${o.apoKm} km: ${o.note})`);
      check(`after ${o.after}, the orbit within ${C.orbitPct} % of the published ${o.periKm} by ${o.apoKm} km (osculating, at one instant)`, Math.abs(peri / o.periKm - 1) * 100 < C.orbitPct && Math.abs(apo / o.apoKm - 1) * 100 < C.orbitPct);
    }
  }
  // The body's field by degree (M.fieldDegrees) on the last coast arc.
  if (M.fieldDegrees) {
    // The longest arc about the body.
    const FD = M.fieldDegrees, [a, b] = arcs.filter(([x]) => x.about === FD.body).reduce((p, q) => (q[1].ms - q[0].ms > p[1].ms - p[0].ms ? q : p));
    header(`${id} CASE 3c: the ${FD.body}'s field by degree, ${hhmm(a.ms)} to ${hhmm(b.ms)}`);
    const rows = [];
    for (const n of FD.degrees) {
      const e = makeEnvironment(sys, { mass: mass0, area: M.craft.area, cr: M.craft.cr * k, massAt, [FD.body]: { degree: n } });
      rows.push({ n, d: norm(sub(coast(a, b.ms, a.about, e, b.about).r, b.r)) });
    }
    for (const x of rows) console.log(`  degree ${String(x.n).padStart(3)}: ${x.d.toFixed(3)} km at the end`);
    check(`each degree up to ${FD.degrees.at(-1)} brings the arc closer to the reconstruction, or leaves it within a metre`, rows.every((x, i) => i === 0 || x.d < rows[i - 1].d + 1e-3));
    check(`with the field to degree ${FD.degrees.at(-1)}, the arc ends within ${C.fieldKm} km`, rows.at(-1).d < C.fieldKm);
  }

  // ---------------------------------------------------------------- 4
  if (M.flybys.length) header(`${id} CASE 4: the flybys`);
  const crCraft = { mass: mass0, area: M.craft.area, cr: M.craft.cr * k, massAt };
  const full = makeEnvironment(sys, crCraft);
  for (const [i, f] of M.flybys.entries()) {
    const w = fx.dense.find((d) => d.about === f.body) ?? fx.dense[i];
    const rows = w.rows.map(toRow);
    const ca = closestApproach(f.body, rows, w.about);
    const at = rows.reduce((p, q) => (Math.abs(q.ms - ca.ms) < Math.abs(p.ms - ca.ms) ? q : p));
    const R = RADIUS[f.body];
    const g = f.body === 'earth' ? geodeticHeight(coast(at, ca.ms, w.about).r, ca.ms) : null;
    console.log(`  ${f.body}: published ${f.altitudeKm} km at ${f.utc.slice(11, 16)} UTC; the trajectory ${(ca.d - R).toFixed(2)} km above the equatorial radius at ${hhmm(ca.ms)}${g ? `, ${g.h.toFixed(2)} km above the ellipsoid at ${g.lat.toFixed(2)}, ${g.lon.toFixed(2)}` : ''}`);
    check(`closest approach within ${C.flybyKm} km of the published height and a minute of the published time`, Math.abs((g ? g.h : ca.d - R) - f.altitudeKm) < C.flybyKm && Math.abs(ca.ms - Date.parse(f.utc)) <= 90e3);
    // The kernel through the flyby, from the window's first sample.
    const a = rows[0], z = rows.at(-1);
    let best = { d: Infinity };
    for (let ms = ca.ms - 120e3; ms <= ca.ms + 120e3; ms += 1000) {
      const s = coast(a, ms, w.about, full), d = norm(sub(add(s.r, bodyState(w.about, ms).r), bodyState(f.body, ms).r));
      if (d < best.d) best = { d, ms };
    }
    const endG = coast(a, z.ms, w.about, null), endF = coast(a, z.ms, w.about, full);
    console.log(`  the kernel from ${hhmm(a.ms)}: closest ${(best.d - R).toFixed(3)} km at ${hhmm(best.ms)}; at ${hhmm(z.ms)} ${norm(sub(endF.r, z.r)).toFixed(3)} km and ${(norm(sub(endF.v, z.v)) * 1e6).toFixed(2)} mm/s off (gravity alone, J2 the only zonal term: ${norm(sub(endG.r, z.r)).toFixed(2)} km, ${(norm(sub(endG.v, z.v)) * 1e6).toFixed(1)} mm/s)`);
    check(`the kernel flies the flyby within ${C.flybyKernelM} m of the reconstruction's closest approach, and ends within ${C.flybyEndKm} km`, Math.abs(best.d - ca.d) * 1000 < C.flybyKernelM && norm(sub(endF.r, z.r)) < C.flybyEndKm);
    if (f.helioKmh) {
      // The speed about the Sun on the way in and out: the planet's velocity
      // plus the craft's asymptotic velocity (a patched conic), at the
      // window's two ends. The release's figures are rounded, and do not
      // say where they were taken; this is reported, not checked.
      const mu = 398600.4418, vin = (p, sign) => {
        const h = cross(p.r, p.v), ev = sub(cross(p.v, h).map((x) => x / mu), unit(p.r)), e = norm(ev);
        const nu = Math.acos(-1 / e) * sign, P = unit(ev), Q = unit(cross(h, ev)), s = Math.sqrt(dot(p.v, p.v) - 2 * mu / norm(p.r));
        // Inbound, the craft moves against the asymptote it came in along.
        return add(P.map((x) => x * Math.cos(nu) * s * sign), Q.map((x) => x * Math.sin(nu) * s * sign));
      };
      const sp = (p, sign) => norm(add(vin(p, sign), bodyState(f.body, p.ms).v)) * 3600;
      console.log(`  speed about the Sun, the Earth's velocity plus the asymptotes': ${sp(a, -1).toFixed(0)} km/h in, ${sp(z, 1).toFixed(0)} km/h out, ${(sp(z, 1) - sp(a, -1)).toFixed(0)} km/h gained (the release: ${f.helioKmh[0]} to ${f.helioKmh[1]} km/h)`);
      check('the speed about the Sun in and out within 1,000 km/h of the release\'s (given to the thousand)', Math.abs(sp(a, -1) - f.helioKmh[0]) < 1000 && Math.abs(sp(z, 1) - f.helioKmh[1]) < 1000);
      if (f.turnKms) {
        // The change in velocity the flyby gave, as a vector: the asymptotes'
        // difference, 2 v_inf sin(turn / 2).
        const turn = norm(sub(vin(z, 1), vin(a, -1)));
        console.log(`  the flyby's change in velocity: |v_inf out - v_inf in| = ${turn.toFixed(3)} km/s (the press kit: about ${f.turnKms} km/s)`);
        // The kit's figure is 16,330 mph, 7.300 km/s, and it does not say
        // how it was measured (at the asymptotes, or a sphere of influence's
        // edge, or planned): held to 0.1 km/s, and the gap reported.
        check('the change in velocity within 0.1 km/s of the press kit\'s (it does not say how it measured it)', Math.abs(turn - f.turnKms) < 0.1);
      }
    }
    if (f.body === 'earth') {
      // The flyby anomaly: Anderson et al. (2008, Phys. Rev. Lett. 100,
      // 091102) fitted dv_inf = K v_inf (cos d_in - cos d_out), K = 2 w R / c,
      // to six Earth flybys, d the declinations of the incoming and outgoing
      // asymptotes. The kernel has no such term: what it leaves at the end of
      // the pass is the bound on one in the reconstruction.
      const K = 2 * 7.2921158553e-5 * RE / 299792.458;
      const vinf = (p) => { const v2 = dot(p.v, p.v) - 2 * 398600.4418 / norm(p.r); return Math.sqrt(Math.max(v2, 0)); };
      const asym = (p, sign) => {
        // The asymptote's direction from the osculating hyperbola.
        const mu = 398600.4418, h = cross(p.r, p.v), ev = sub(cross(p.v, h).map((x) => x / mu), unit(p.r));
        const e = norm(ev), nu = Math.acos(-1 / e) * sign, P = unit(ev), Q = unit(cross(h, ev));
        return add(P.map((x) => x * Math.cos(nu)), Q.map((x) => x * Math.sin(nu)));
      };
      const dIn = Math.asin(-asym(a, -1)[2]), dOut = Math.asin(asym(z, 1)[2]);
      const v = vinf(a), pred = K * v * (Math.cos(dIn) - Math.cos(dOut)) * 1e6;
      console.log(`  flyby anomaly: v_inf ${v.toFixed(3)} km/s, asymptotes at declination ${(dIn * 180 / Math.PI).toFixed(1)} in and ${(dOut * 180 / Math.PI).toFixed(1)} out; Anderson's formula would give ${pred.toFixed(2)} mm/s; the kernel, with no such term, ends the pass ${((vinf(endF) - vinf(z)) * 1e6).toFixed(2)} mm/s from the reconstruction's v_inf`);
      check(`no anomaly at Juno's Earth flyby: the kernel's v_inf after the pass within ${C.anomalyMmS} mm/s of the reconstruction's, under Anderson's ${pred.toFixed(1)} mm/s`, Math.abs(vinf(endF) - vinf(z)) * 1e6 < C.anomalyMmS && C.anomalyMmS < Math.abs(pred));
    }
  }

  // The impact: the kernel from the last reconstructed sample to the body
  // struck, on Horizons' ephemeris of it.
  const I = M.impact;
  let impact = null;
  if (I) {
    const T = fx.target.rows.map(toRow), last0 = toRow(fx.last);
    // The target's state at ms, by cubic Hermite between its seconds.
    const targetAt = (ms) => {
      const j = T.findIndex((p) => p.ms > ms), a = T[j - 1], b = T[j], h = (b.ms - a.ms) / 1000, u = (ms - a.ms) / 1000 / h;
      const h00 = 2 * u ** 3 - 3 * u * u + 1, h10 = u ** 3 - 2 * u * u + u, h01 = -2 * u ** 3 + 3 * u * u, h11 = u ** 3 - u * u;
      return { r: [0, 1, 2].map((k) => h00 * a.r[k] + h10 * h * a.v[k] + h01 * b.r[k] + h11 * h * b.v[k]), v: [0, 1, 2].map((k) => a.v[k] + u * (b.v[k] - a.v[k])) };
    };
    // The closest approach to the target's centre, by the millisecond near it.
    const closestTo = (from, env) => {
      let best = { d: Infinity };
      const tEnd = T.at(-1).ms - 1;
      for (let ms = from.ms; ms < tEnd; ms += 100) { const s = coast(from, ms, centre, env), d = norm(sub(s.r, targetAt(ms).r)); if (d < best.d) best = { d, ms }; }
      for (let ms = best.ms - 100; ms <= best.ms + 100; ms += 1) { const s = coast(from, ms, centre, env), d = norm(sub(s.r, targetAt(ms).r)); if (d <= best.d) best = { d, ms, s }; }
      return best;
    };
    header(`${id} CASE 4: the impact on ${I.body}`);
    const tPub = Date.parse(I.utc), fmtMs = (ms) => `${hhmm(ms).slice(11)}.${String(ms % 1000).padStart(3, '0')}`;
    console.log(`  published (${I.note}): ${fmtMs(tPub)} UTC (± ${I.utcErrS} s), ${I.speedKms} km/s (± ${I.speedErrKms}), ${I.offsetM} ± ${I.offsetErrM} m from the centre of the figure`);
    // The final solution, from DART's last images: its first sample about
    // the target, placed on the target's ephemeris and flown by the kernel.
    const F = fx.final.rows.map(toRow), f0 = F[0], T0 = targetAt(f0.ms);
    const fromFinal = { ms: f0.ms, r: add(f0.r, T0.r), v: add(f0.v, T0.v) };
    const kF = closestTo(fromFinal, full), relF = norm(sub(kF.s.v, targetAt(kF.ms).v));
    console.log(`  the final solution, flown by the kernel from ${fmtMs(f0.ms)} (${norm(f0.r).toFixed(1)} km out): ${(kF.d * 1000).toFixed(1)} m from ${I.body}'s centre at ${fmtMs(kF.ms)}, at ${relF.toFixed(5)} km/s`);
    console.log(`  its closest approach to the centre comes ${((kF.ms - tPub) / 1000).toFixed(3)} s after the published impact, ${((kF.ms - tPub) * relF).toFixed(0)} m along the track: about ${I.body}'s radius, as the impact is on its surface`);
    check(`the final solution passes within ${C.impactOffsetM} m of the published ${I.offsetM} m from the centre`, Math.abs(kF.d * 1000 - I.offsetM) < C.impactOffsetM);
    check(`and reaches the centre's closest point within ${C.impactS} s after the published impact (the surface is struck first)`, kF.ms >= tPub && (kF.ms - tPub) / 1000 < C.impactS);
    check(`at ${relF.toFixed(5)} km/s, within the published ${I.speedKms} ± ${I.speedErrKms} km/s`, Math.abs(relF - I.speedKms) <= I.speedErrKms);
    // The reconstruction before the final images, flown on from its last
    // sample: what those images corrected.
    const k0 = closestTo(last0, full);
    console.log(`  the reconstruction before the final images, flown on from ${fmtMs(last0.ms)}: ${(k0.d * 1000).toFixed(1)} m from the centre at ${fmtMs(k0.ms)}: ${((kF.ms - k0.ms) / 1000).toFixed(3)} s and ${(Math.abs(kF.ms - k0.ms) * relF / 1000).toFixed(2)} km along the track, ${(Math.abs(k0.d - kF.d) * 1000).toFixed(0)} m across it, from the final one`);
    console.log(`  (the two are estimates of one flight, the final one fitted to DART's last images: the earlier one, ${(k0.d * 1000).toFixed(0)} m from the centre of a body 177 by 174 by 116 m, would have had it graze or pass beside ${I.body})`);
    impact = { targetAt, closestTo };
  }

  // ---------------------------------------------------------------- 5
  header(`${id} CASE 5: the app's mission file (public/missions/${id}.json), flown as the app flies it`);
  {
    const { RealMission } = await import('./realMission.js');
    const { Craft } = await import('./craft.js');
    const { KernelClient } = await import('./kernelClient.js');
    const { kernelMs } = await import('./kernelHost.js');
    const data = JSON.parse(fs.readFileSync(new URL(`../../public/missions/${id}.json`, import.meta.url)));
    const file = new RealMission({ ...data, id });
    const model = { ...data.craftModel, vent: null };
    // Frames of an hour (the app at high warp), of a minute within a day of
    // each flyby.
    const near = data.flybys.map((f) => Date.parse(f.utc));
    // fixHours: a tracking fix that often (the file's own, data.fixHours,
    // as the app flies it by default).
    const flyApp = ({ aimed = false, fixHours = null } = {}) => {
      const s0 = file.startState(), c = new Craft({ name: file.name, r: s0.r, v: s0.v, t: s0.t, sys, ...model });
      c.setScript(file.script());
      const client = new KernelClient(), run = { aimNext: 0, aimedDv: 0 };
      const step = (t) => { c.advanceClock(t); if (aimed) file.aimStep(c, sys, run); client.tick([c]); if (aimed) { file.aimStep(c, sys, run); client.tick([c]); } };
      let worst = 0, prev = file.startMs;
      const lows = data.flybys.map(() => ({ d: Infinity }));
      for (let ms = file.startMs; ms < file.endMs && !c.crashed && !c.error;) {
        ms = Math.min(file.endMs, ms + (near.some((x) => Math.abs(x - ms) < 864e5) ? 60e3 : 3600e3));
        for (const f of file.fixesBetween(prev, ms, fixHours)) { step(kt(f)); const x = file.fixAt(f); c.setState(x.r, x.v, x.t); }
        prev = ms;
        step(kt(ms));
        const at = kernelMs(c.kState.t), d = file.distanceFromFlown(c.kState.r, at);
        if (d !== null) worst = Math.max(worst, d);
        data.flybys.forEach((f, i) => {
          const B = bodyState(f.body, at), dd = norm(sub(c.kState.r, B.r)) - RADIUS[f.body];
          if (Math.abs(at - near[i]) < 864e5 && dd < lows[i].d) lows[i] = { d: dd, ms: at };
        });
      }
      const endState = { ms: kernelMs(c.kState.t), ...about({ r: c.kState.r, v: c.kState.v }, kernelMs(c.kState.t), centre) };
      return { worst, end: file.distanceFromFlown(c.kState.r, kernelMs(c.kState.t)), lows, aimedDv: run.aimedDv, error: c.error, crashed: c.crashed, endState };
    };
    const show = (label, x) => console.log(`  ${label.padEnd(36)} ${x.lows.length ? `flybys ${x.lows.map((l) => `${l.d.toFixed(1)} km`).join(', ')}   ` : ''}at the end ${x.end.toFixed(1)} km, worst ${x.worst.toFixed(1)} km${x.crashed ? ', crashed' : ''}${x.error ? `, ${x.error}` : ''}`);
    // As the app flies it by default: aimed, or (a file with fixHours) the
    // burns as flown with a tracking fix that often.
    const blind = flyApp(), aimed = data.fixHours ? flyApp({ fixHours: data.fixHours }) : flyApp({ aimed: true });
    const aimedOnly = data.fixHours ? flyApp({ aimed: true }) : null;
    const flownLow = data.flybys.map((f) => f.distanceKm - RADIUS[f.body]);
    if (flownLow.length) console.log(`  the file's flybys: ${flownLow.map((x) => `${x.toFixed(1)} km`).join(', ')} (at the minute nearest)`);
    show('every burn replayed as flown', blind);
    show(data.fixHours ? `burns as flown, a fix every ${data.fixHours} h` : `burns aimed (+${aimed.aimedDv.toFixed(2)} m/s)`, aimed);
    if (aimedOnly) show(`burns aimed, no fixes (+${aimedOnly.aimedDv.toFixed(2)} m/s)`, aimedOnly);
    check(`the file's burns are the trajectory's: each published one within 1 %`, matched.filter((x) => x.b && x.p.mps).every(({ p }) => { const fb = data.burns.find((b) => b.name === p.name); return fb && Math.abs(fb.mps / p.mps - 1) < 0.01; }));
    check(`as the app flies it${data.fixHours ? `, with a fix every ${data.fixHours} h` : ', aimed'}: within ${C.appEndKm} km at the end and ${C.appWorstKm} km throughout, every flyby within ${C.appFlybyKm} km of the flown`, !aimed.error && aimed.end < C.appEndKm && aimed.worst < C.appWorstKm && aimed.lows.every((l, i) => Math.abs(l.d - flownLow[i]) < C.appFlybyKm));
    check(`the aimed burns add under ${C.appAimedMps} m/s to the flown ones (${aimed.aimedDv.toFixed(2)} m/s)`, aimed.aimedDv < C.appAimedMps);
    if (impact) {
      // Each flight's end, flown on to the target.
      const miss = (x) => impact.closestTo(x.endState, full);
      const mb = miss(blind), ma = miss(aimed);
      console.log(`  on to ${I.body}: blind, ${(mb.d * 1000).toFixed(0)} m from its centre; aimed, ${(ma.d * 1000).toFixed(0)} m (it is 177 by 174 by 116 m; published ${I.offsetM} m)`);
      check(`as the app flies it, aimed, DART passes within ${C.appImpactKm * 1000} m of ${I.body}'s centre`, ma.d < C.appImpactKm);
    }
  }
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
