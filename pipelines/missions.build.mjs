// pipelines/missions.build.mjs
//
// Builds a real mission beyond Artemis from its JPL Horizons trajectory
// (missions.data.mjs): the validation fixture, src/physics/fixtures/<id>.json,
// and the app's mission file, public/missions/<id>.json.
//
//   npm run build:missions -- juno2013      (needs a network the first time)
//
// Horizons' answers are cached in ~/.cache/digital-orrery/missions/<id>.
//
// 1. The whole span every `step`, flown step by step by the kernel's
//    gravity: a step whose velocity is over `threshold` from the kernel's is
//    an event (a burn, or a join between navigation solutions).
// 2. Each event fetched every `fine` (10 s) from an hour before to an hour
//    after. A burn's thrust spreads over its steps; an event of under
//    `minBurn` is left as a join. Each burn is kept as the app flies it:
//    each fine interval's change beyond gravity, steered in the orbital
//    frame about the body whose sphere of influence holds it.
// 3. The fixture keeps every event's fine samples, the trajectory every
//    day, and the dense windows (the flybys every minute); the coast arcs
//    run between the events.
// 4. The mission file keeps the flown path every `keep.cruise`, more finely
//    near the bodies, and through every burn; between them it is
//    interpolated (RealMission.flownAt), and the script reports how far that
//    is from every coarse sample left out.

import '../src/physics/deNode.js';
import fs from 'node:fs';
import { MISSIONS } from '../validation/missions.data.mjs';
import { vectors, toRow, stepResiduals, findEvents, burnFromSamples, ringingRegions, steadyBurn, fitSteadyBurn, norm, sub, iso, bodyState, distanceTo, sys, kt, coast } from '../validation/flown.lib.mjs';
import { RealMission } from '../src/physics/realMission.js';
import { primaryOf } from '../src/physics/nbody.js';
import { makeEnvironment } from '../src/physics/environment.js';

const id = process.argv[2];
const M = MISSIONS[id];
if (!M) throw new Error(`no mission '${id}': one of ${Object.keys(MISSIONS).join(', ')}`);
const r6 = (x) => Math.round(x * 1e6) / 1e6, r9 = (x) => Math.round(x * 1e9) / 1e9;
const fetchRows = async (a, b, step, about = M.centre) => (await vectors(id, M.horizons, about, a, b, step)).map(toRow);
// Rows about one body moved onto another with the app's bodies. Near a
// planet the trajectory is fetched about the planet and moved onto the
// mission's centre this way: the planet is then where the kernel has it.
// Heliocentric, the Earth of Horizons' ephemeris and the app's differ by
// metres, and at a 560 km perigee each metre is a gravity gradient worth
// 7 mm/s over the pass.
const recentre = (rows, from, to) => from === to ? rows : rows.map((p) => {
  const F = bodyState(from, p.ms), T = bodyState(to, p.ms);
  return { ms: p.ms, r: p.r.map((x, k) => x + F.r[k] - T.r[k]), v: p.v.map((x, k) => x + F.v[k] - T.v[k]) };
});
const state = (p) => [new Date(p.ms).toISOString(), ...p.r.map((x) => Number(x.toPrecision(13))), ...p.v.map((x) => Number(x.toPrecision(13)))];

// 1. The coarse trajectory and its events.
const coarse = await fetchRows(M.span[0], M.span[1], M.step);
// The full environment (the planets' fields beyond J2, sunlight on the
// craft): close to a planet or the Moon its field would otherwise look like
// thrust. The coarse steps are flown in it too where the file asks
// (coarseEnv: LRO's lunar orbit).
const env = makeEnvironment(sys, { mass: M.craft.dryMass + M.craft.fuel, area: M.craft.area, cr: M.craft.cr });
const steps = stepResiduals(coarse, M.centre, M.coarseEnv ? env : null);
const events = findEvents(steps, M.threshold, 3, M.jumpKm);
console.log(`${coarse.length} samples every ${M.step}; ${events.length} events over ${(M.threshold * 1e6).toFixed(1)} mm/s`);

// 2. Each event every `fine`, flown step by step in the full environment.
const fineEvents = [];
for (const e of events) {
  const a = Math.max(Date.parse(M.span[0] + 'Z'), coarse[e.a].ms - M.finePadMs), b = Math.min(Date.parse(M.span[1] + 'Z'), coarse[e.b + 1].ms + M.finePadMs);
  // The body whose sphere of influence holds it: the burn's frame, and
  // the frame it is fetched and flown in.
  const around = (await fetchRows(iso(a), iso(b), M.fine));
  const mid = around[Math.floor(around.length / 2)], C = bodyState(M.centre, mid.ms);
  const aboutKey = primaryOf(mid.r.map((x, k) => x + C.r[k]), sys.bodiesAt(kt(mid.ms)), sys.muSun);
  const own = aboutKey === M.centre ? around : await fetchRows(iso(a), iso(b), M.fine, aboutKey);
  const rows = recentre(own, aboutKey, M.centre);
  const s = stepResiduals(own, aboutKey, env);
  const sum = (list) => list.reduce((acc, x) => [acc[0] + x.dv[0], acc[1] + x.dv[1], acc[2] + x.dv[2]], [0, 0, 0]);
  if (M.burnFloor) {
    // Every push in the window, each its own burn (M.burnFloor, km/s in a
    // step): MESSENGER fired a burn's parts minutes apart, a main-engine
    // burn and a long one on the small thrusters (DSM-2's 2A and 2B), which
    // a share of the window's largest step would miss. Runs of steps over
    // the floor, a few steps apart at most; a run of one step, or under
    // minBurn, is a join. Near a planet what the environment's field leaves
    // (at Mercury, 1 to 3 mm/s a step at 200 to 230 km up; at Venus, under
    // 0.5) stays under the floor, and the pass is a join.
    // A jump in position (M.jumpKm) is a join's step too.
    const runs = [];
    s.forEach((x, i) => { if (norm(x.dv) <= M.burnFloor && !(norm(x.dr) > M.jumpKm)) return; const r = runs.at(-1); if (r && i - r[1] <= 3) r[1] = i; else runs.push([i, i]); });
    const pass = M.flybys.find((f) => { const t = Date.parse(f.utc); return t >= own[0].ms && t <= own.at(-1).ms; });
    if (!runs.length) {
      const all = sum(s);
      fineEvents.push({ kind: 'join', rows, own, mps: norm(all) * 1000, about: aboutKey, onFrom: own[0].ms, onTo: own.at(-1).ms, fineSteps: s.length, ...(pass ? { pass: pass.body } : {}) });
      console.log(`  join ${iso(own[0].ms)} to ${iso(own.at(-1).ms)}  ${(norm(all) * 1000).toFixed(4).padStart(10)} m/s  in sum, no step over the floor${pass ? `: the pass of ${pass.body}` : ''}, about ${aboutKey}`);
    }
    for (const [p, q] of runs) {
      const run = s.slice(p, q + 1), mps = norm(sum(run)) * 1000;
      const kind = q > p && mps >= M.minBurn ? 'burn' : 'join';
      const i0 = Math.max(0, p - 1), i1 = Math.min(own.length - 1, q + 2);
      const jumpKm = Math.max(...run.map((x) => norm(x.dr)));
      fineEvents.push({ kind, rows, own, mps, about: aboutKey, onFrom: run[0].ms, onTo: run.at(-1).ms + run.at(-1).sec * 1000, fineSteps: run.length, burnRange: [own[i0].ms, own[i1].ms], ...(kind === 'join' ? { jumpKm } : {}) });
      console.log(`  ${kind.padEnd(4)} ${iso(run[0].ms)} to ${iso(run.at(-1).ms + run.at(-1).sec * 1000)}  ${mps.toFixed(4).padStart(10)} m/s  over ${run.length} steps${kind === 'join' ? `, a jump of ${jumpKm.toFixed(2)} km` : ''}, about ${aboutKey}`);
    }
    continue;
  }
  // Ringing across a join is set apart (each region its own join); the
  // thrust is the rest's steps over a twentieth of its largest.
  // Ringing: over 1 m/s of steps that add to under half that.
  const rings = ringingRegions(s).map(([p, q]) => { const j = s.slice(p, q + 1); return { p, q, j, net: norm(sum(j)) * 1000, gross: j.reduce((x, y) => x + norm(y.dv), 0) * 1000 }; })
    .filter((r) => r.gross > 1 && r.gross > 2 * r.net);
  const inRing = (i) => rings.some(({ p, q }) => i >= p && i <= q);
  const clean = s.map((x, i) => ({ ...x, i })).filter((x) => !inRing(x.i));
  const peak = Math.max(...clean.map((x) => norm(x.dv)));
  const on = clean.filter((x) => norm(x.dv) > peak / 20);
  const span = s.slice(on[0].i, on.at(-1).i + 1).filter((x, k) => !inRing(on[0].i + k));
  const mps = norm(sum(span)) * 1000;
  // Each ringing region: a join, when it is small beside the thrust in its
  // window (LRO's 4 m/s two minutes after lunar orbit insertion); or else a
  // burn whose samples ring (LRO's next four), flown as one steady push of
  // its whole change over the span its residuals cover.
  const big = rings.find((r) => r.net >= M.minBurn && r.net > mps);
  for (const r of rings.filter((x) => x !== big)) {
    const from = r.j[0].ms, to = r.j.at(-1).ms + r.j.at(-1).sec * 1000;
    fineEvents.push({ kind: 'join', rows, own, mps: r.net, about: aboutKey, onFrom: from, onTo: to, fineSteps: r.j.length, ring: [from, to] });
    console.log(`  join ${iso(from)} to ${iso(to)}  ${r.net.toFixed(4).padStart(10)} m/s  in sum; Horizons rings across it (${r.gross.toFixed(1)} m/s of steps), about ${aboutKey}`);
  }
  if (big) {
    // The span: every step over a hundredth of the largest, about the ring.
    const peakAll = Math.max(...s.map((x) => norm(x.dv)));
    const live = s.map((x, i) => ({ x, i })).filter((o) => norm(o.x.dv) > peakAll / 100 && o.i >= big.p - 60 && o.i <= big.q + 60);
    const from = live[0].x.ms, to = live.at(-1).x.ms + live.at(-1).x.sec * 1000;
    const dv = sum(s.slice(live[0].i, live.at(-1).i + 1)), m = norm(dv) * 1000;
    const mid = own.reduce((p, q) => (Math.abs(q.ms - (from + to) / 2) < Math.abs(p.ms - (from + to) / 2) ? q : p));
    fineEvents.push({ kind: 'burn', rows, own, mps: m, about: aboutKey, onFrom: from, onTo: to, fineSteps: live.length, ring: [from, to], steady: { from, to, dv, mid } });
    console.log(`  burn ${iso(from)} to ${iso(to)}  ${m.toFixed(4).padStart(10)} m/s  in sum, flown steady: Horizons rings across it (${big.gross.toFixed(1)} m/s of steps), about ${aboutKey}`);
    continue;
  }
  const kind = mps < M.minBurn ? 'join' : 'burn';
  // A burn whose steps outrun its engine (three times the craft's thrust
  // on its mass, where the file gives a thrust) can't be what was flown:
  // Horizons' interpolation rings across it (LRO's burns after insertion:
  // steps of up to 45 m/s^2 against its thrusters' 0.2). Flown steady, as
  // one push of its whole change over its span.
  const all = s.slice(on[0].i, on.at(-1).i + 1), dvAll = sum(all);
  const maxAccel = M.craft.thrust ? 3 * M.craft.thrust / (M.craft.dryMass + M.craft.fuel) : Infinity;
  const fastest = Math.max(...all.map((x) => norm(x.dv) * 1000 / x.sec));
  if (kind === 'burn' && fastest > maxAccel) {
    const from = on[0].ms, to = on.at(-1).ms + on.at(-1).sec * 1000, m = norm(dvAll) * 1000;
    const mid = own.reduce((p, q) => (Math.abs(q.ms - (from + to) / 2) < Math.abs(p.ms - (from + to) / 2) ? q : p));
    fineEvents.push({ kind: 'burn', rows, own, mps: m, about: aboutKey, onFrom: from, onTo: to, fineSteps: all.length, ring: [from, to], steady: { from, to, dv: dvAll, mid } });
    console.log(`  burn ${iso(from)} to ${iso(to)}  ${m.toFixed(4).padStart(10)} m/s  in sum, flown steady: its steps reach ${fastest.toFixed(1)} m/s^2, past the engine's ${maxAccel.toFixed(2)}, about ${aboutKey}`);
    continue;
  }
  // The rows the burn is taken from: its thrust and a step either side.
  const i0 = Math.max(0, on[0].i - 1), i1 = Math.min(own.length - 1, on.at(-1).i + 2);
  fineEvents.push({ kind, rows, own, mps, about: aboutKey, onFrom: on[0].ms, onTo: on.at(-1).ms + on.at(-1).sec * 1000, fineSteps: on.length, burnRange: [own[i0].ms, own[i1].ms] });
  console.log(`  ${kind.padEnd(4)} ${iso(on[0].ms)} to ${iso(on.at(-1).ms + 10e3)}  ${mps.toFixed(4).padStart(10)} m/s  over ${on.length} steps, about ${aboutKey}`);
}
fineEvents.sort((x, y) => x.onFrom - y.onFrom);

// The craft's mass as the burns draw it (the rocket equation at its Isp),
// for the length of a burn fitted steady: its change at the engine's
// thrust.
let massNow = M.craft.dryMass + M.craft.fuel;
const ve = M.craft.isp * 9.80665 / 1000;
const craftEnv = { mass: M.craft.dryMass + M.craft.fuel, area: M.craft.area, cr: M.craft.cr };

// Each burn named: the published one it matches (by its day, or within an
// hour of its ignition; a part of a burn, within ten minutes), or
// "Correction, <date>".
const used = new Set();
const burns = fineEvents.filter((e) => e.kind === 'burn').map((e) => {
  // About the Sun, along fixed J2000 directions (realMission.js script()).
  const eqj = e.about === 'sun';
  const inRange = (rows) => rows.filter((p) => p.ms >= e.burnRange[0] && p.ms <= e.burnRange[1]);
  // A burn whose samples ring: one steady push (steadyBurn).
  let b;
  if (e.steady) {
    // As the engine would fly it: its length the change at the thrust on
    // the mass now, centred on the ringing, fitted to the samples either side.
    const sec = M.craft.thrust ? massNow * e.mps / M.craft.thrust : (e.steady.to - e.steady.from) / 1000;
    const fit = fitSteadyBurn(e.own, e.steady.from, e.steady.to, e.about, sec, craftEnv);
    e.fit = fit;
    console.log(`  ${new Date(fit.t0).toISOString().slice(0, 19)}: fitted steady over ${((fit.t1 - fit.t0) / 1000).toFixed(0)} s, ${(norm(fit.dv) * 1000).toFixed(3)} m/s (the samples' sum ${e.mps.toFixed(3)}); at the sample after, ${(fit.missKm * 1000).toFixed(0)} m and ${fit.offMms.toFixed(0)} mm/s off`);
    b = steadyBurn(fit.t0, fit.t1, fit.dv, null, e.about, true);
  } else b = burnFromSamples(inRange(e.own), e.about, e.about, env, eqj, M.burnFloor);
  // A long, gentle push (DART's 19 hours on 12-13 September) is resolved
  // by the minute: by the 10 s it would be thousands of intervals.
  massNow *= Math.exp(-norm(b.dv) / ve);
  if (!e.steady && b.intervals.length > 600) {
    const minute = (rows) => rows.filter((p) => p.ms % 60e3 === 0);
    e.own = minute(e.own); e.rows = minute(e.rows);
    b = burnFromSamples(inRange(e.own), e.about, e.about, env, eqj, M.burnFloor);
  }
  const day = new Date(b.ignitionMs).toISOString().slice(0, 10);
  const pub = M.published.find((p) => !used.has(p) && (p.part ? Math.abs(Date.parse(p.utc) - b.ignitionMs) < 600e3 : p.endUtc && !p.towardMs ? Math.abs(Date.parse(p.endUtc) - b.cutoffMs) < 600e3 : p.utc ? Math.abs(Date.parse(p.utc) - b.ignitionMs) < 3600e3 : p.day ? p.day === day : p.mps && Math.abs(norm(b.dv) * 1000 - p.mps) < 0.02 * p.mps));
  if (pub) used.add(pub);
  // Against a published vector (MESSENGER's, whose length is the change
  // along the path), the change along its path (b.along: over |dv| for a
  // burn steered as it fires).
  const mps = (pub?.eme && b.along ? b.along : norm(b.dv)) * 1000;
  return { ...b, e, pub, mps, name: pub?.name ?? `Correction, ${day}` };
});

// 3. The fixture.
const dense = [], denseOwn = [];
for (const w of M.dense) {
  const own = await fetchRows(w.from, w.to, w.step, w.about ?? M.centre);
  denseOwn.push({ about: w.about ?? M.centre, rows: own });
  dense.push(...recentre(own, w.about ?? M.centre, M.centre));
}
const daily = coarse.filter((p, i) => i === 0 || i === coarse.length - 1 || p.ms % 86400e3 === 0);
// The last sample of all: the span's end may fall between the coarse steps
// (DART's ends on a segment's edge), inside an event's fine samples.
const lastRow = [coarse.at(-1), ...fineEvents.map((e) => e.rows.at(-1))].reduce((a, b) => (b.ms > a.ms ? b : a));
// A target struck (DART's Dimorphos): its state about the centre every
// second from a minute before the span's end to the impact, from Horizons.
const I = M.impact;
const target = I ? (await vectors(id, I.horizons, M.centre, iso(lastRow.ms - 60e3), iso(Math.ceil((Date.parse(I.utc) + 2e3) / 1e3) * 1e3), 's1')).map(toRow) : null;
// The target's state at ms, linear between its seconds (it moves 23 km/s
// about the Sun on a curve whose sag over a second is micrometres).
const targetAt = (ms) => {
  const j = target.findIndex((p) => p.ms > ms), a = target[j - 1], b = target[j], u = (ms - a.ms) / (b.ms - a.ms);
  return { r: a.r.map((x, k) => x + u * (b.r[k] - x)), v: a.v.map((x, k) => x + u * (b.v[k] - x)) };
};
// The final solution (M.final): every second about the target, placed on
// its ephemeris, and carried by the kernel to the published impact time.
let finalAbout = [], finalRows = [];
if (M.final) {
  finalAbout = (await vectors(id, M.horizons, `500@${I.horizons}`, M.final.from, M.final.to, 's1')).map(toRow);
  finalRows = finalAbout.map((p) => { const T = targetAt(p.ms); return { ms: p.ms, r: p.r.map((x, k) => x + T.r[k]), v: p.v.map((x, k) => x + T.v[k]) }; });
  const tI = Date.parse(I.utc), z = finalRows.at(-1);
  if (tI > z.ms) finalRows.push({ ms: tI, ...coast(z, tI, M.centre) });
}
const fixture = {
  id, source: M.source, url: 'https://ssd.jpl.nasa.gov/horizons/', centre: M.centre,
  frame: `ICRF (J2000 equatorial), ${M.centre}-centred, km and km/s, UTC`, fields: ['utc', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
  step: M.step, fine: M.fine,
  // Each event every `fine`, about the body whose sphere holds it (`about`),
  // from 10 minutes before its thrust to 10 minutes after (a join's, a
  // minute either side).
  events: fineEvents.map((e) => {
    // (A burn fitted steady keeps 40 minutes either side: its fit flies
    // from ten before to half an hour after.)
    const pad = e.steady ? 2400e3 : e.kind === 'burn' ? 600e3 : 60e3;
    return { kind: e.kind, mps: Math.round(e.mps * 1e4) / 1e4, about: e.about, ...(e.jumpKm ? { jumpKm: Math.round(e.jumpKm * 1000) / 1000 } : {}), ...(e.pass ? { pass: e.pass } : {}), ...(e.burnRange ? { burnRange: e.burnRange } : {}), ...(e.ring ? { ring: e.ring, steady: !!e.steady } : {}), ...(e.fit ? { fit: [e.fit.t0, e.fit.t1], fitCentreMs: e.fit.centreMs } : {}), rows: e.own.filter((p) => p.ms >= e.onFrom - pad && p.ms <= e.onTo + pad).map(state) };
  }),
  daily: daily.map(state),
  last: state(lastRow),
  ...(target ? { target: { body: I.body, rows: target.map(state) } } : {}),
  // The final solution about the target (DART's, from its last images).
  ...(finalAbout.length ? { final: { about: I.body, rows: finalAbout.map(state) } } : {}),
  // The dense windows (the flybys), each about its own body.
  dense: denseOwn.map((w) => ({ about: w.about, rows: w.rows.map(state) })),
  // The coarse steps' residuals under gravity alone, mm/s: quantiles, for
  // the validation's account of what the kernel leaves out.
  stepResidualMmS: (() => { const d = steps.map((s) => norm(s.dv) * 1e6).sort((x, y) => x - y); return [0.5, 0.9, 0.99].map((q) => Math.round(d[Math.floor(q * d.length)] * 1e4) / 1e4); })(),
};
const fixPath = new URL(`../src/physics/fixtures/${id}.json`, import.meta.url);
fs.writeFileSync(fixPath, JSON.stringify(fixture));

// 4. The mission file.
const byMs = new Map();
const near = (p) => M.keep.near.reduce((every, n) => (distanceTo(n.body, p, M.centre) < n.km ? Math.min(every, n.every) : every), M.keep.cruise);
coarse.forEach((p, i) => { if (i === 0 || i === coarse.length - 1 || p.ms % near(p) === 0) byMs.set(p.ms, p); });
for (const p of dense) if (p.ms % near(p) === 0) byMs.set(p.ms, p);
byMs.set(lastRow.ms, lastRow);
for (const p of finalRows) byMs.set(p.ms, p);
for (const b of burns) for (const p of b.e.rows) if (p.ms >= b.e.onFrom - 600e3 && p.ms <= b.e.onTo + 600e3) byMs.set(p.ms, p);
// A join between navigation solutions is a step in velocity: the samples
// either side of it are kept so the interpolation does not smear it.
for (const e of fineEvents.filter((x) => x.kind === 'join')) for (const p of e.rows) if (p.ms >= e.onFrom - 60e3 && p.ms <= e.onTo + 60e3) byMs.set(p.ms, p);
const flown = [...byMs.values()].sort((a, b) => a.ms - b.ms);
const start = flown[0];
const closest = M.flybys.map((f) => {
  const t = Date.parse(f.utc);
  let best = null;
  // Within two days of the published time (MESSENGER passes Venus twice).
  for (const p of dense) { if (Math.abs(p.ms - t) > 2 * 864e5) continue; const d = distanceTo(f.body, p, M.centre); if (!best || d < best.d) best = { d, ms: p.ms }; }
  return { body: f.body, utc: new Date(best.ms).toISOString().slice(0, 19) + 'Z', distanceKm: Math.round(best.d * 10) / 10, nearMs: t };
});
const out = {
  name: M.name,
  craft: M.craftName,
  summary: M.summary,
  source: `${M.source}; burns from it and as published, by pipelines/missions.build.mjs`,
  frame: `J2000 equatorial (EQJ), ${M.centre === 'sun' ? 'heliocentric' : 'geocentric'}, km and km/s`,
  centre: M.centre,
  // The burns after the first are aimed in the craft's own environment.
  aimInEnvironment: true,
  ...(M.fixHours ? { fixHours: M.fixHours } : {}),
  // The tag beside the readouts that come from it.
  sourceTag: 'JPL',
  craftModel: { dryMass: M.craft.dryMass, fuel: M.craft.fuel, area: Math.round(M.craft.area * 10) / 10, cr: M.craft.appCr ?? M.craft.cr, scriptIsp: M.craft.isp, ...(M.craft.thrust ? { thrust: M.craft.thrust, isp: M.craft.isp } : {}) },
  start: { ms: start.ms, r: start.r.map(r6), v: start.v.map(r9) },
  endMs: flown.at(-1).ms,
  flybys: closest.map(({ body, utc, distanceKm }) => ({ body, utc, distanceKm })),
  // The body struck, and its state about the centre at the impact
  // (interpolated to the published time from Horizons' seconds).
  ...(I ? { impact: { body: I.body, utc: I.utc, ...(() => { const ms = Date.parse(I.utc), j = target.findIndex((p) => p.ms > ms), a = target[j - 1], b = target[j], u = (ms - a.ms) / (b.ms - a.ms); return { r: a.r.map((x, k) => r6(x + u * (b.r[k] - x))), v: a.v.map((x, k) => r9(x + u * (b.v[k] - x))) }; })() } } : {}),
  burns: burns.map((b) => ({
    key: b.name, name: b.name, about: b.e.about, ...(b.e.about === 'sun' || b.e.steady ? { frame: 'eqj' } : {}), mps: Math.round(b.mps * 1e3) / 1e3,
    // What NASA published, as the MISSION tab shows it beside ours.
    ...(b.pub ? { nasa: `${b.pub.mps ? `${b.pub.mps} m/s` : b.pub.of ? `part of ${b.pub.of}, ${b.pub.ofMps} m/s in all` : 'no delta-v published'}${b.pub.seconds ? ` over ${b.pub.seconds} s` : ''} on the ${b.pub.engine}` } : {}),
    intervals: b.intervals,
  })),
  // [ms, x, y, z, vx, vy, vz]
  flown: flown.map((p) => [p.ms, ...p.r.map(r6), ...p.v.map(r9)]),
};
const path = new URL(`../public/missions/${id}.json`, import.meta.url);
fs.writeFileSync(path, JSON.stringify(out));

// How well the file carries the path: every coarse and dense sample left
// out, interpolated from those kept.
const file = new RealMission(out);
let worst = 0, worstAt = 0;
for (const p of [...coarse, ...dense]) {
  if (byMs.has(p.ms)) continue;
  const g = file.flownAt(p.ms);
  if (!g) continue;
  const d = norm(sub(g.r, p.r));
  if (d > worst) { worst = d; worstAt = p.ms; }
}
console.log('burn                         about    ours m/s   published   ignition (UTC)        cutoff');
for (const b of burns) console.log(`  ${b.name.padEnd(26)} ${b.e.about.padEnd(7)} ${b.mps.toFixed(3).padStart(9)} ${String(b.pub?.mps ?? '—').padStart(10)}   ${new Date(b.ignitionMs).toISOString().slice(0, 19)}   ${new Date(b.cutoffMs).toISOString().slice(11, 19)}`);
for (const c of closest) console.log(`flyby: ${c.body} ${c.distanceKm} km from its centre at ${c.utc}`);
console.log(`interpolation between the kept samples: worst ${(worst * 1000).toFixed(1)} m (${new Date(worstAt).toISOString()})`);
console.log(`wrote fixtures/${id}.json (${(fs.statSync(fixPath).size / 1024).toFixed(0)} kB) and public/missions/${id}.json: ${burns.length} burns, ${flown.length} samples, ${(fs.statSync(path).size / 1024).toFixed(0)} kB`);
