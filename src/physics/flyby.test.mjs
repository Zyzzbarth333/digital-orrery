// src/physics/flyby.test.mjs
//
// The moons' pull in the kernel (bodies.js splits a planet's system into
// the planet and its moons near it):
//   1. the Hermite nodes hold each moon and planet centre to its model;
//   2. a system is split only near it, and in cruise its moons are never
//      evaluated;
//   3. Juno's flyby of Ganymede on 7 June 2021 against JPL's reconstructed
//      trajectory (fixtures/flyby_juno_ganymede.json, flyby.fetch.mjs):
//      with the moons the kernel follows Juno through the pass, without
//      them it misses by thousands of kilometres; 3b and 3c, Juno at Io
//      (PJ57, 30 December 2023) and Cassini at Titan (T45, 31 July 2008),
//      which measure those moons' J2 and C22;
//   4. impacts on a moon, found where the step crossed its surface;
//   5. the large moons' degree-2 fields (J2 and C22).
// docs/validation.md#the-moons-pull-flybys-of-ganymede-io-and-titan-flybytestmjs and docs/physics/nbody-kernel.md#moons.
//
//   node src/physics/flyby.test.mjs

import fs from 'node:fs';
import { advance, createState, HermiteEphemeris } from './nbody.js';
import { solarSystemBodies, MOON_SPACING } from './bodies.js';
import './moonNode.js';
import { MAJOR_MOONS_OF as MOONS_OF, systemEqjAtTt } from './moons.js';
import { MOON_DATA } from './moons.data.js';
import { helioStateEqjAtTt, ttSeconds, utcMsAtTt } from './ephemeris.js';

let failed = 0;
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++; };
const header = (s) => console.log(`\n${s}`);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const DAY = 86400;

header('CASE 1: interpolation of the split systems against their models');
{
  // Every planet centre and moon at 2,000 random times over 20 days, from the
  // kernel's Hermite nodes against moons.js and astronomy-engine directly.
  const epochMs = Date.UTC(2026, 10, 12), tt0 = ttSeconds(epochMs);
  const sys = solarSystemBodies({ epochMs });
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let worst = 0, worstKey = '';
  for (const planet of Object.keys(MOONS_OF)) {
    for (let i = 0; i < 2000; i++) {
      const t = rand() * 20 * DAY;
      const bary = helioStateEqjAtTt(planet, tt0 + t).r, s = systemEqjAtTt(planet, tt0 + t);
      // astronomy-engine's Pluto is differenced in bodies.js; its position is the same.
      const centre = bary.map((x, j) => x + s.offset.r[j]);
      for (const k of [planet, ...MOONS_OF[planet]]) {
        const want = k === planet ? centre : centre.map((x, j) => x + s.moons[k].r[j]);
        const e = dist(sys.bodyAt(k, t).r, want);
        if (e > worst) { worst = e; worstKey = k; }
      }
    }
  }
  console.log(`  moon spacings (s): ${Object.entries(MOON_SPACING).filter(([k]) => Object.values(MOONS_OF).flat().includes(k)).map(([k, d]) => `${k} ${d}`).join(', ')}`);
  // NODE_TOL is 100 m for a circular orbit; Phobos's eccentricity adds a little.
  check(worst < 0.15, `largest interpolation error ${(worst * 1000).toFixed(1)} m (${worstKey}), under 150 m`);
}

header('CASE 2: a system splits only near it');
{
  const epochMs = Date.UTC(2026, 10, 12);
  const sys = solarSystemBodies({ epochMs });
  const E = sys.bodyAt('earth', 0), J = sys.bodyAt('jupiter', 0);
  // Cruise: 200 days outward from the Earth, never near a planet with
  // moons. Io's nodes are counted before and after (bodyAt makes two).
  const io = sys.bodyAt('io', 0).eph.b, n0 = io.nodes.size;
  const vE = E.eph.velocity(0);
  const st = createState([E.r[0] + 3e6, E.r[1], E.r[2]], [vE[0], vE[1] + 3, vE[2]], 0);
  advance(st, 200 * DAY, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 });
  check(sys.split().length === 0 && !sys.bodiesAt(st.t).some((b) => b.key === 'io'), `200 days of cruise: no system split, no moon in the list (${sys.bodiesAt(st.t).length} bodies)`);
  check(io.nodes.size === n0, `Io's ephemeris was never evaluated in cruise (${n0} nodes before, ${io.nodes.size} after)`);
  // Near Jupiter: split inside 1.25 spheres of influence, folded beyond 1.5.
  const soi = Math.hypot(...J.r) * (sys.bodyAt('jupiter', 0).mu / sys.muSun) ** 0.4;
  const at = (k) => [J.r[0] + k * soi, J.r[1], J.r[2]];
  sys.focus(at(1.3), 0); const a = sys.split().join();
  sys.focus(at(1.2), 0); const b = sys.split().join();
  sys.focus(at(1.4), 0); const c = sys.split().join();
  sys.focus(at(1.6), 0); const d = sys.split().join();
  check(a === '' && b === 'jupiter' && c === 'jupiter' && d === '', `Jupiter at 1.3, 1.2, 1.4, 1.6 SOI: '${a}', '${b}', '${c}', '${d}' (splits inside 1.25, folds beyond 1.5)`);
  // Pluto: in the list only within 5 AU of it, split with Charon near it.
  const Pl = sys.bodyAt('pluto', 0), AU = 1.495978707e8, has = (k) => sys.bodiesAt(0).some((b) => b.key === k);
  const unit = Pl.r.map((x) => x / Math.hypot(...Pl.r));
  const nearPluto = (d) => Pl.r.map((x, i) => x - d * unit[i]);
  sys.focus(nearPluto(6 * AU), 0); const p6 = has('pluto');
  sys.focus(nearPluto(4 * AU), 0); const p4 = has('pluto') && !has('charon');
  sys.focus(nearPluto(1e6), 0); const p0 = has('pluto') && has('charon');
  sys.focus(nearPluto(8 * AU), 0); const p8 = has('pluto');
  check(!p6 && p4 && p0 && !p8, `Pluto: away at 6 AU, folded at 4 AU, split at 10^6 km, away again at 8 AU`);
  // Two views keep their own split.
  const v1 = sys.view(), v2 = sys.view();
  v1.focus(at(0.5), 0); v2.focus(at(5), 0);
  check(v1.split().join() === 'jupiter' && v2.split().join() === '' && v1.bodiesAt(0).length === v2.bodiesAt(0).length + 4,
    `views: one craft near Jupiter (${v1.bodiesAt(0).length} bodies), one far (${v2.bodiesAt(0).length})`);
}

// Cases 3, 3b and 3c: a craft's flyby of a moon against JPL's
// reconstruction (fixtures/flyby_<craft>_<moon>.json, flyby.fetch.mjs). The
// craft is started on its Horizons state at the first row of the span and
// flown to each later row; its distance from Horizons' is the error.
const J2000_JD = 2451545.0;
const ttOf = (jd) => (jd - J2000_JD) * 86400;       // TDB as TT: under 2 ms apart
// A Horizons table as a Hermite cubic through its rows (positions and
// velocities every 10 minutes: 1e-4 km for Io).
function table(rows) {
  const t0 = ttOf(rows[0][0]), D = ttOf(rows[1][0]) - t0;
  const H = new HermiteEphemeris((t) => { const k = Math.round(t / D), r = rows[k]; return { r: r.slice(1, 4), v: r.slice(4, 7) }; }, D);
  return (tt) => ({ r: H.position(tt - t0), v: H.velocity(tt - t0) });
}
function flybyRuns(file, planet, { degree2 = false, variants = {} } = {}) {
  const fx = JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
  const key = fx.moon;
  const horizonsMoons = (moons) => {
    const m = Object.fromEntries(Object.entries(moons).map(([k, rows]) => [k, table(rows)]));
    const c = table(fx.centre);
    return { moon: (k, tt) => m[k](tt), offset: (_, tt) => c(tt) };
  };
  // Horizons' craft about the moon is not its craft about the barycentre
  // less the moon about it: the two differ by the difference between
  // Horizons' moon and the one the craft's reconstructed trajectory was
  // fitted with. That moon is the craft about the barycentre less the
  // craft about the moon, less the centre.
  const craft = new Map(fx.craft.map((r) => [r[0].toFixed(6), r]));
  const centreAt = new Map(fx.centre.map((r) => [r[0].toFixed(6), r]));
  const implied = fx.craftMoon.filter((r) => craft.has(r[0].toFixed(6))).map((r) => {
    const j = craft.get(r[0].toFixed(6)), c = centreAt.get(r[0].toFixed(6));
    return [r[0], ...[1, 2, 3, 4, 5, 6].map((i) => j[i] - r[i] - c[i])];
  });
  const flown = fx.craft.filter((r) => r[0] >= fx.span[0] - 1e-7 && r[0] <= fx.span[1] + 1e-7);
  // The kernel's epoch an hour before the first row, so its first nodes
  // (multiples of their spacing from the epoch) lie inside the tables.
  const epochMs = utcMsAtTt(ttOf(flown[0][0]) - 3600);
  // Where the moon really is (as the craft's track has it), for the
  // distance from it in every run.
  const real = solarSystemBodies({ epochMs, satellites: horizonsMoons({ ...fx.moons, [key]: implied }) });
  const tt0 = ttSeconds(epochMs);
  const bary = (t) => helioStateEqjAtTt(planet, tt0 + t);
  // tweak(sys, key) changes a body before the run; extraOf(sys) gives an
  // extra acceleration (a force the kernel leaves out).
  // setup() runs before the bodies are built and returns its undo.
  const fly = (opts, tweak = null, extraOf = null, setup = null, adv = {}) => {
    const undo = setup ? setup(key) : null;
    const sys = solarSystemBodies({ epochMs, ...opts });
    if (undo) undo();
    if (tweak) tweak(sys, key);
    const extraAccel = extraOf ? extraOf(sys) : null;
    const j0 = flown[0], t0 = ttOf(j0[0]) - tt0, b0 = bary(t0);
    const st = createState(b0.r.map((x, i) => x + j0[1 + i]), b0.v.map((x, i) => x + j0[4 + i]), t0);
    const out = { err: [], events: [], closest: Infinity };
    for (const row of flown.slice(1)) {
      const t = ttOf(row[0]) - tt0;
      // Through closest approach in 10 s pieces, for the distance from the moon.
      if (row[0] > fx.close[0][0] && row[0] - 10 / 1440 < fx.close.at(-1)[0]) {
        while (st.t < t - 1e-6) {
          const res = advance(st, Math.min(t, st.t + 10), { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7, extraAccel, ...adv });
          out.events.push(...res.events);
          out.closest = Math.min(out.closest, dist(st.r, real.bodyAt(key, st.t).r));
        }
      } else {
        const res = advance(st, t, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7, extraAccel, ...adv });
        out.events.push(...res.events);
      }
      const b = bary(t).r;
      out.err.push(Math.hypot(...[0, 1, 2].map((i) => st.r[i] - b[i] - row[1 + i])));
    }
    return out;
  };
  const hzClose = fx.close.reduce((a, b) => (Math.hypot(b[1], b[2], b[3]) < Math.hypot(a[1], a[2], a[3]) ? b : a));
  const hzCA = Math.hypot(hzClose[1], hzClose[2], hzClose[3]);
  const runs = {
    'no moons (system at its barycentre)': fly({ moons: false }),
    'moons from moons.js': fly({}),
    "JPL's moons (Horizons')": fly({ satellites: horizonsMoons(fx.moons) }),
    [`JPL's moons, ${key} as the track has it`]: fly({ satellites: horizonsMoons({ ...fx.moons, [key]: implied }) }),
  };
  const trackSats = () => horizonsMoons({ ...fx.moons, [key]: implied });
  if (degree2) runs[`the same, without ${key}'s J2 and C22`] = fly({ satellites: trackSats() }, (sys, k) => { const m = sys.bodyAt(k, 0); m.j2 = 0; m.c22 = 0; });
  for (const [name, v] of Object.entries(variants)) runs[name] = fly({ satellites: trackSats() }, v.tweak, v.extraOf, v.setup, v.advance);
  const after = flown.slice(1).findIndex((r) => r[0] > hzClose[0]);
  const R = MOON_DATA[key].radiusKm, hours = (fx.span[1] - hzClose[0]) * 24;
  // The two moons: Horizons' against the one the track implies, at closest approach.
  const iCA = implied.reduce((a, b) => (Math.abs(b[0] - hzClose[0]) < Math.abs(a[0] - hzClose[0]) ? b : a));
  const hz = fx.moons[key].find((r) => r[0] === iCA[0]);
  const moonGap = Math.hypot(hz[1] - iCA[1], hz[2] - iCA[2], hz[3] - iCA[3]);
  // The kernel's own moon (its Hermite nodes through the track's table)
  // against the table, about the barycentre, over the hour about closest
  // approach.
  let nodeGap = 0, centreGap = 0;
  for (const r of implied.filter((q) => Math.abs(q[0] - hzClose[0]) < 1 / 48)) {
    const t = ttOf(r[0]) - tt0, c = centreAt.get(r[0].toFixed(6)), b = bary(t).r, m = real.bodyAt(key, t).r, p = real.bodyAt(planet, t).r;
    nodeGap = Math.max(nodeGap, Math.hypot(...[0, 1, 2].map((i) => m[i] - b[i] - c[1 + i] - r[1 + i])));
    centreGap = Math.max(centreGap, Math.hypot(...[0, 1, 2].map((i) => p[i] - b[i] - c[1 + i])));
  }
  console.log(`  the kernel's ${key} (its Hermite nodes) within ${(nodeGap * 1000).toFixed(1)} m of the track's, ${planet}'s centre within ${(centreGap * 1000).toFixed(1)} m, over the hour about closest approach`);
  console.log(`  Horizons: closest approach ${hzCA.toFixed(1)} km from ${key}'s centre (${(hzCA - R).toFixed(0)} km up), ${Math.hypot(hzClose[4], hzClose[5], hzClose[6]).toFixed(2)} km/s; Horizons' ${key} and the track's ${moonGap.toFixed(2)} km apart`);
  console.log(`  ${fx.craftName} from Horizons, km: run${' '.repeat(Math.max(1, 22 - fx.craftName.length))}3 min after CA ${hours.toFixed(1).padStart(5)} h after CA   closest to ${key}`);
  for (const [name, r] of Object.entries(runs)) {
    console.log(`  ${name.padEnd(46)} ${r.err[after].toFixed(3).padStart(10)} ${r.err.at(-1).toFixed(3).padStart(14)} ${r.closest.toFixed(2).padStart(14)}`);
  }
  // FLYBY_OUT=dir writes each case's errors, for plotting.
  if (process.env.FLYBY_OUT) fs.writeFileSync(`${process.env.FLYBY_OUT}/${key}.json`, JSON.stringify({ jd: flown.slice(1).map((r) => r[0]), ...Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.err])) }));
  return { runs: Object.values(runs), hzCA, epochMs, hours };
}

// A planet's J4, which the kernel leaves out, as an extra acceleration on
// the craft: the gradient of V4 = -mu J4 R^4 P4(s) / r^5, s = z / r, z
// along the pole, P4(s) = (35 s^4 - 30 s^2 + 3) / 8:
//   a = -mu J4 R^4 [ p P4'(s) / r^6 - d (s P4'(s) + 5 P4(s)) / r^7 ].
// Jupiter's from Juno's gravity science (Iess et al. 2018, as Serra et al.
// 2019 tabulate it): J4 = -586.609e-6 at R = 71,492 km.
const J4_OF = { jupiter: { j4: -586.609e-6, R: 71492 } };
const j4Accel = (planet) => (sys) => {
  const { j4, R } = J4_OF[planet], P = sys.bodyAt(planet, 0), c = [0, 0, 0];
  return (t, r, out) => {
    P.eph.position(t, c);
    const d = [r[0] - c[0], r[1] - c[1], r[2] - c[2]], rn = Math.hypot(...d), p = P.pole;
    const s = (d[0] * p[0] + d[1] * p[1] + d[2] * p[2]) / rn;
    const P4 = (35 * s ** 4 - 30 * s * s + 3) / 8, dP4 = (140 * s ** 3 - 60 * s) / 8;
    const k = -P.mu * j4 * R ** 4, a = k * dP4 / rn ** 6, b = -k * (s * dP4 + 5 * P4) / rn ** 7;
    for (let i = 0; i < 3; i++) out[i] = a * p[i] + b * d[i];
    return out;
  };
};

// The moon's Hermite nodes every 10 minutes (the tables' own spacing)
// instead of at the spacing that holds it to NODE_TOL (bodies.js).
const fineNodes = { setup: (k) => { const was = MOON_SPACING[k]; MOON_SPACING[k] = 600; return () => { MOON_SPACING[k] = was; }; } };

header("CASE 3: Juno's flyby of Ganymede, 7 June 2021, against JPL's reconstruction");
const { runs: [none, ours, jpl, track], hzCA, epochMs } = flybyRuns('flyby_juno_ganymede.json', 'jupiter', { variants: { "the same, with Jupiter's J4": { extraOf: j4Accel('jupiter') } } });
// Ganymede bends Juno by 0.28 km/s: 9,300 km after nine hours. JPL's moons
// leave 23 km, all but 0.1 km of it the 11 km between the two Ganymedes
// (the fixed-step Cowell integrator added 4 km of its own). moons.js's
// Ganymede (the jup365 table) is within 0.3 km of Horizons', so its run
// matches Horizons' own; the fallback's left 320 km.
check(none.err.at(-1) > 5000, `without the moons Juno is ${none.err.at(-1).toFixed(0)} km off 9 h after the pass`);
check(track.err.at(-1) < 0.5, `with JPL's moons and Ganymede as Juno's track has it, ${track.err.at(-1).toFixed(2)} km off (the kernel's force model)`);
check(jpl.err.at(-1) < 30, `with Horizons' own moons, ${jpl.err.at(-1).toFixed(2)} km off`);
check(ours.err.at(-1) < 25 && Math.abs(ours.err.at(-1) - jpl.err.at(-1)) < 2, `with moons.js's moons, ${ours.err.at(-1).toFixed(2)} km off, within 2 km of Horizons' own moons' run`);
check(Math.abs(track.closest - hzCA) < 1, `closest approach ${track.closest.toFixed(2)} km from Ganymede's centre, Horizons ${hzCA.toFixed(2)} km`);
check(ours.events.some((e) => e.type === 'primary' && e.to === 'ganymede') && ours.events.some((e) => e.type === 'primary' && e.from === 'ganymede' && e.to === 'jupiter'),
  `the primary goes to Ganymede and back to Jupiter (${ours.events.filter((e) => e.type === 'primary').map((e) => `${e.from}->${e.to}`).join(', ')})`);

header("CASE 3b: Juno's flyby of Io, 30 December 2023 (PJ57), against JPL's reconstruction");
{
  // Six hours in to closest approach, 1,496 km up at 30 km/s, then an hour
  // out, ending three hours before the perijove (where Jupiter's higher
  // harmonics take over). Io bends Juno by 0.12 km/s: 440 km an hour on.
  // As at Ganymede, Horizons' Io is 9.8 km from the one Juno's track has.
  // With it, 0.05 km is left an hour on; Io's J2 and C22 take it from
  // 0.20 km, so the pass measures them. Of what is left, a fifth is
  // Jupiter's J4 (0.040 km with it, which the kernel leaves out); neither
  // the kernel's nodes for Io nor tighter tolerances move it.
  const { runs: [none, ours, jpl, track, flat, j4, nodes, tight], hzCA } = flybyRuns('flyby_juno_io.json', 'jupiter', {
    degree2: true,
    variants: { "the same, with Jupiter's J4": { extraOf: j4Accel('jupiter') }, 'the same, its nodes every 10 min': fineNodes,
      'the same, tolerances 1e-10 and 1e-9 km': { advance: { tolKm: 1e-10, cowellTolKm: 1e-9 } } },
  });
  check(none.err.at(-1) > 300, `without the moons Juno is ${none.err.at(-1).toFixed(0)} km off an hour after the pass`);
  check(track.err.at(-1) < 0.1, `with JPL's moons and Io as Juno's track has it, ${track.err.at(-1).toFixed(3)} km off`);
  check(flat.err.at(-1) > 3 * track.err.at(-1), `without Io's J2 and C22, ${flat.err.at(-1).toFixed(3)} km off: the pass measures them`);
  check(j4.err.at(-1) < track.err.at(-1) && Math.abs(nodes.err.at(-1) - track.err.at(-1)) < 0.005 && Math.abs(tight.err.at(-1) - track.err.at(-1)) < 0.005,
    `of what is left, Jupiter's J4 is a fifth (${j4.err.at(-1).toFixed(3)} km with it); Io's nodes (${nodes.err.at(-1).toFixed(3)}) and the tolerances (${tight.err.at(-1).toFixed(3)}) change nothing`);
  check(jpl.err.at(-1) < 2 && Math.abs(ours.err.at(-1) - jpl.err.at(-1)) < 0.1, `with Horizons' own moons ${jpl.err.at(-1).toFixed(3)} km off, with moons.js's ${ours.err.at(-1).toFixed(3)} km`);
  check(Math.abs(track.closest - hzCA) < 0.1, `closest approach ${track.closest.toFixed(2)} km from Io's centre, Horizons ${hzCA.toFixed(2)} km`);
  check(ours.events.some((e) => e.type === 'primary' && e.to === 'io'), `the primary goes to Io (${ours.events.filter((e) => e.type === 'primary').map((e) => `${e.from}->${e.to}`).join(', ')})`);
}

header("CASE 3c: Cassini's flyby of Titan, 31 July 2008 (T45), against JPL's reconstruction");
{
  // Nine hours either side of closest approach, 1,613 km up at 6.2 km/s,
  // 19 to 20 Saturn radii out. Titan bends Cassini by 22,000 km over the
  // nine hours. Horizons' Titan is within 0.04 km of the one Cassini's
  // track has. With it, 0.09 km is left, and nearly all of it is the
  // kernel's own Titan: its Hermite nodes, three hours apart (held to
  // 100 m, bodies.js NODE_TOL), put it 27 m from the table at closest
  // approach, and with nodes every 10 minutes 0.007 km is left. Titan's J2
  // and C22 take the error from 0.43 km.
  const { runs: [none, ours, jpl, track, flat, nodes], hzCA } = flybyRuns('flyby_cassini_titan.json', 'saturn', {
    degree2: true, variants: { 'the same, its nodes every 10 min': fineNodes },
  });
  check(none.err.at(-1) > 10000, `without the moons Cassini is ${none.err.at(-1).toFixed(0)} km off 9 h after the pass`);
  check(track.err.at(-1) < 0.15, `with JPL's moons and Titan as Cassini's track has it, ${track.err.at(-1).toFixed(3)} km off`);
  check(nodes.err.at(-1) < 0.02, `the same with Titan's nodes every 10 minutes, ${nodes.err.at(-1).toFixed(3)} km: the rest was the kernel's interpolation of Titan`);
  check(flat.err.at(-1) > 3 * track.err.at(-1), `without Titan's J2 and C22, ${flat.err.at(-1).toFixed(3)} km off`);
  check(jpl.err.at(-1) < 0.5 && ours.err.at(-1) < 1.5, `with Horizons' own moons ${jpl.err.at(-1).toFixed(3)} km off, with moons.js's ${ours.err.at(-1).toFixed(3)} km`);
  check(Math.abs(track.closest - hzCA) < 0.1, `closest approach ${track.closest.toFixed(2)} km from Titan's centre, Horizons ${hzCA.toFixed(2)} km`);
}

header('CASE 4: an impact on a moon');
{
  const sys = solarSystemBodies({ epochMs });
  const G = sys.bodyAt('ganymede', 0), vG = G.eph.velocity(0);
  // 20,000 km out, falling straight in at 3 km/s.
  const st = createState([G.r[0] + 20000, G.r[1], G.r[2]], [vG[0] - 3, vG[1], vG[2]], 0);
  const res = advance(st, 3 * 3600, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 });
  const hit = res.events.find((e) => e.type === 'impact');
  const G1 = sys.bodyAt('ganymede', st.t);
  // The impact is found where the step crossed the surface, on its dense
  // output (impact.js). Found at the end of the step, as before, it was up
  // to 1 % of Ganymede's dynamical time at its surface late (14 s): 46 km
  // below it at the speed of the fall.
  const depth = G1.radius - dist(st.r, G1.r);
  const speed = dist(st.v, G1.eph.velocity(st.t));
  check(hit?.body === 'ganymede' && Math.abs(depth) < 1e-3 && st.t === hit.t && Math.abs(hit.speed - speed) < 1e-9,
    `impact on ${hit?.body} after ${hit ? (hit.t / 60).toFixed(3) : '-'} min, ${(depth * 1000).toFixed(4)} m below the surface (within 1 m), at ${hit ? (hit.speed * 1000).toFixed(1) : '-'} m/s`);
}

header("CASE 5: a moon's degree-2 field (J2 and C22) is the gradient of its potential");
{
  // Ganymede's field about tilted axes, against central differences of
  // U = -(mu R^2 J2 / 2)(3 z^2 / r^5 - 1 / r^3) + 3 mu R^2 C22 (x^2 - y^2) / r^5.
  const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const Z = unit([0.2, -0.3, 1]), X0 = unit([1, 0.4, 0.1]);
  const dotp = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const X = unit(X0.map((x, i) => x - dotp(X0, Z) * Z[i]));
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  const b = { mu: 9887.83, j2: 133.0e-6, c22: 39.56e-6, rJ2: 2631.2, pole: Z, axisX: X, axisY: Y };
  const U = (d) => {
    const r2 = dotp(d, d), r = Math.sqrt(r2), x = dotp(d, X), y = dotp(d, Y), z = dotp(d, Z), R2 = b.rJ2 * b.rJ2;
    return -(b.mu * R2 * b.j2 / 2) * (3 * z * z / r ** 5 - 1 / r ** 3) + 3 * b.mu * R2 * b.c22 * (x * x - y * y) / r ** 5;
  };
  const { addJ2 } = await import('./zonal.js');
  let worst = 0;
  for (const d of [[3000, 1000, 500], [-2000, 2500, -1500], [500, -400, 3200], [4000, 0, 0]]) {
    const a = [0, 0, 0];
    addJ2(d[0], d[1], d[2], dotp(d, d), b, a);
    const g = [0, 1, 2].map((i) => { const h = 1e-3, p = [...d], m = [...d]; p[i] += h; m[i] -= h; return (U(p) - U(m)) / (2 * h); });
    worst = Math.max(worst, Math.hypot(a[0] - g[0], a[1] - g[1], a[2] - g[2]) / Math.hypot(...g));
  }
  check(worst < 1e-6, `J2 + C22 acceleration against the potential's gradient: worst relative difference ${worst.toExponential(1)}`);
  // In the kernel the moons carry it, turning with their orbits.
  const sys = solarSystemBodies({ epochMs: Date.UTC(2026, 10, 12) });
  const G = sys.bodyAt('ganymede', 0), Jc = sys.bodyAt('jupiter', 0);
  const toJ = Jc.r.map((x, i) => x - G.r[i]), toJn = Math.hypot(...toJ);
  check(G.c22 > 0 && Math.abs(dotp(G.axisX, toJ) / toJn - 1) < 1e-6 && Math.abs(dotp(G.axisX, G.pole)) < 1e-12,
    `Ganymede's x axis points at Jupiter (cos ${(dotp(G.axisX, toJ) / toJn).toFixed(9)}), its z along its orbit's pole`);
}

console.log(failed ? `\nflyby: ${failed} check(s) FAILED` : '\nflyby: all checks passed');
process.exit(failed ? 1 : 0);
