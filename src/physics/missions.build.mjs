// src/physics/missions.build.mjs
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

import './deNode.js';
import fs from 'node:fs';
import { MISSIONS } from './missions.data.mjs';
import { vectors, toRow, stepResiduals, findEvents, burnFromSamples, norm, sub, iso, bodyState, distanceTo, sys, kt, coast } from './flown.lib.mjs';
import { RealMission } from './realMission.js';
import { primaryOf } from './nbody.js';
import { makeEnvironment } from './environment.js';

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
const steps = stepResiduals(coarse, M.centre);
const events = findEvents(steps, M.threshold);
console.log(`${coarse.length} samples every ${M.step}; ${events.length} events over ${(M.threshold * 1e6).toFixed(1)} mm/s`);

// 2. Each event every `fine`, flown step by step in the full environment
// (the planets' fields beyond J2, sunlight on the craft): close to a
// planet its field would otherwise look like thrust.
const env = makeEnvironment(sys, { mass: M.craft.dryMass + M.craft.fuel, area: M.craft.area, cr: M.craft.cr });
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
  const net = s.reduce((acc, x) => [acc[0] + x.dv[0], acc[1] + x.dv[1], acc[2] + x.dv[2]], [0, 0, 0]);
  const mps = norm(net) * 1000;
  // Where the thrust is: the steps over a twentieth of the largest.
  const peak = Math.max(...s.map((x) => norm(x.dv)));
  const on = s.filter((x) => norm(x.dv) > peak / 20);
  const kind = mps < M.minBurn ? 'join' : 'burn';
  fineEvents.push({ kind, rows, own, mps, about: aboutKey, onFrom: on[0].ms, onTo: on.at(-1).ms + on.at(-1).sec * 1000, fineSteps: on.length });
  console.log(`  ${kind.padEnd(4)} ${iso(on[0].ms)} to ${iso(on.at(-1).ms + 10e3)}  ${mps.toFixed(4).padStart(10)} m/s  over ${on.length} steps, about ${aboutKey}`);
}

// Each burn named: the published one it matches (by its day, or within an
// hour of its ignition), or "Correction, <date>".
const used = new Set();
const burns = fineEvents.filter((e) => e.kind === 'burn').map((e) => {
  // About the Sun, along fixed J2000 directions (realMission.js script()).
  const eqj = e.about === 'sun';
  let b = burnFromSamples(e.own, e.about, e.about, env, eqj);
  // A long, gentle push (DART's 19 hours on 12-13 September) is resolved
  // by the minute: by the 10 s it would be thousands of intervals.
  if (b.intervals.length > 600) {
    const minute = (rows) => rows.filter((p) => p.ms % 60e3 === 0);
    e.own = minute(e.own); e.rows = minute(e.rows);
    b = burnFromSamples(e.own, e.about, e.about, env, eqj);
  }
  const day = new Date(b.ignitionMs).toISOString().slice(0, 10);
  const pub = M.published.find((p) => !used.has(p) && (p.utc ? Math.abs(Date.parse(p.utc) - b.ignitionMs) < 3600e3 : p.day ? p.day === day : p.mps && Math.abs(norm(b.dv) * 1000 - p.mps) < 0.02 * p.mps));
  if (pub) used.add(pub);
  const mps = norm(b.dv) * 1000;
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
    const pad = e.kind === 'burn' ? 600e3 : 60e3;
    return { kind: e.kind, mps: Math.round(e.mps * 1e4) / 1e4, about: e.about, rows: e.own.filter((p) => p.ms >= e.onFrom - pad && p.ms <= e.onTo + pad).map(state) };
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
const fixPath = new URL(`./fixtures/${id}.json`, import.meta.url);
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
  for (const p of dense) { const d = distanceTo(f.body, p, M.centre); if (!best || d < best.d) best = { d, ms: p.ms }; }
  return { body: f.body, utc: new Date(best.ms).toISOString().slice(0, 19) + 'Z', distanceKm: Math.round(best.d * 10) / 10, nearMs: t };
});
const out = {
  name: M.name,
  craft: M.craftName,
  summary: M.summary,
  source: `${M.source}; burns from it and as published, by src/physics/missions.build.mjs`,
  frame: `J2000 equatorial (EQJ), ${M.centre === 'sun' ? 'heliocentric' : 'geocentric'}, km and km/s`,
  centre: M.centre,
  // The burns after the first are aimed in the craft's own environment.
  aimInEnvironment: true,
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
    key: b.name, name: b.name, about: b.e.about, ...(b.e.about === 'sun' ? { frame: 'eqj' } : {}), mps: Math.round(b.mps * 1e3) / 1e3,
    // What NASA published, as the MISSION tab shows it beside ours.
    ...(b.pub ? { nasa: `${b.pub.mps ? `${b.pub.mps} m/s` : 'no delta-v published'}${b.pub.seconds ? ` over ${b.pub.seconds} s` : ''} on the ${b.pub.engine}` } : {}),
    intervals: b.intervals,
  })),
  // [ms, x, y, z, vx, vy, vz]
  flown: flown.map((p) => [p.ms, ...p.r.map(r6), ...p.v.map(r9)]),
};
const path = new URL(`../../public/missions/${id}.json`, import.meta.url);
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
