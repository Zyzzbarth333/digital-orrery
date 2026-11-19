// packages/physics/src/flyby.test.mjs
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
//      which measure those moons' J2 and C22; 3d to 3f Europa, Enceladus
//      and Saturn itself; 3g and 3h Voyager 2 at Neptune and at Uranus
//      against NAIF's reconstructions, with the steps in their velocity
//      (Voyager's thruster firings) found and put back;
//   4. impacts on a moon, found where the step crossed its surface;
//   5. the large moons' degree-2 fields (J2 and C22), and Jupiter's zonal
//      field to J12.
// docs/validation.md#the-moons-pull-flybys-of-ganymede-io-and-titan-flybytestmjs and docs/physics/nbody-kernel.md#moons.
//
//   node packages/physics/src/flyby.test.mjs

import fs from 'node:fs';
import { advance, createState, HermiteEphemeris } from './nbody.js';
import { solarSystemBodies, MOON_SPACING } from './bodies.js';
import './moonNode.js';
import { MAJOR_MOONS_OF as MOONS_OF, systemEqjAtTt } from './moons.js';
import { MOON_DATA } from './moons.data.js';
import { helioStateEqjAtTt, ttSeconds, utcMsAtTt } from './ephemeris.js';
import { zonalTerms } from './zonal.js';
import { dot, unit } from './vec.js';

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
  // NODE_TOL is 10 m for a circular orbit. What is left is the satellite
  // tables' node velocities, a few cm/s off their positions' slope, times
  // the spacing: Saturn's centre's 6-hour nodes carry its moons 29-31 m.
  check(worst < 0.04, `largest interpolation error ${(worst * 1000).toFixed(1)} m (${worstKey}), under 40 m`);
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
  // A periapsis of the planet itself (Cassini's Grand Finale): no moon to
  // place, so Horizons' moons are the run the others vary.
  const atPlanet = key === planet;
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
  const implied = atPlanet ? null : fx.craftMoon.filter((r) => craft.has(r[0].toFixed(6))).map((r) => {
    const j = craft.get(r[0].toFixed(6)), c = centreAt.get(r[0].toFixed(6));
    return [r[0], ...[1, 2, 3, 4, 5, 6].map((i) => j[i] - r[i] - c[i])];
  });
  const flown = fx.craft.filter((r) => r[0] >= fx.span[0] - 1e-7 && r[0] <= fx.span[1] + 1e-7);
  // The kernel's epoch an hour before the first row, so its first nodes
  // (multiples of their spacing from the epoch) lie inside the tables.
  const epochMs = utcMsAtTt(ttOf(flown[0][0]) - 3600);
  // Where the moon really is (as the craft's track has it), for the
  // distance from it in every run.
  const trackSats = () => horizonsMoons(atPlanet ? fx.moons : { ...fx.moons, [key]: implied });
  const real = solarSystemBodies({ epochMs, satellites: trackSats() });
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
  };
  if (!atPlanet) runs[`JPL's moons, ${key} as the track has it`] = fly({ satellites: trackSats() });
  if (degree2) runs[`the same, without ${key}'s J2 and C22`] = fly({ satellites: trackSats() }, (sys, k) => { const m = sys.bodyAt(k, 0); m.j2 = 0; m.c22 = 0; });
  for (const [name, v] of Object.entries(variants)) runs[name] = fly({ satellites: trackSats() }, v.tweak, v.extraOf, v.setup, v.advance);
  const after = flown.slice(1).findIndex((r) => r[0] > hzClose[0]);
  const R = atPlanet ? real.bodyAt(planet, 0).radius : MOON_DATA[key].radiusKm, hours = (fx.span[1] - hzClose[0]) * 24;
  // The two moons: Horizons' against the one the track implies, at closest approach.
  let moonGap = NaN;
  if (!atPlanet) {
    const iCA = implied.reduce((a, b) => (Math.abs(b[0] - hzClose[0]) < Math.abs(a[0] - hzClose[0]) ? b : a));
    const hz = fx.moons[key].find((r) => r[0] === iCA[0]);
    moonGap = Math.hypot(hz[1] - iCA[1], hz[2] - iCA[2], hz[3] - iCA[3]);
  }
  // The kernel's own moon (its Hermite nodes through the track's table)
  // against the table, about the barycentre, over the hour about closest
  // approach.
  let nodeGap = 0, centreGap = 0;
  for (const r of fx.centre.filter((q) => Math.abs(q[0] - hzClose[0]) < 1 / 48)) {
    const t = ttOf(r[0]) - tt0, b = bary(t).r, p = real.bodyAt(planet, t).r;
    centreGap = Math.max(centreGap, Math.hypot(...[0, 1, 2].map((i) => p[i] - b[i] - r[1 + i])));
    const m = !atPlanet && implied.find((q) => q[0].toFixed(6) === r[0].toFixed(6));
    if (m) { const k = real.bodyAt(key, t).r; nodeGap = Math.max(nodeGap, Math.hypot(...[0, 1, 2].map((i) => k[i] - b[i] - r[1 + i] - m[1 + i]))); }
  }
  console.log(`  ${atPlanet ? '' : `the kernel's ${key} (its Hermite nodes) within ${(nodeGap * 1000).toFixed(1)} m of the track's, `}${planet}'s centre within ${(centreGap * 1000).toFixed(1)} m, over the hour about closest approach`);
  const ref = fx.source.startsWith('NAIF') ? 'NAIF' : 'Horizons';
  console.log(`  ${ref}: closest approach ${hzCA.toFixed(1)} km from ${key}'s centre (${(hzCA - R).toFixed(0)} km up), ${Math.hypot(hzClose[4], hzClose[5], hzClose[6]).toFixed(2)} km/s${atPlanet ? '' : `; ${ref}'s ${key} and the track's ${moonGap.toFixed(2)} km apart`}`);
  console.log(`  ${fx.craftName} from ${ref}, km: run${' '.repeat(Math.max(1, 22 - fx.craftName.length))}3 min after CA ${hours.toFixed(1).padStart(5)} h after CA   closest to ${key}`);
  for (const [name, r] of Object.entries(runs)) {
    console.log(`  ${name.padEnd(46)} ${r.err[after].toFixed(3).padStart(10)} ${r.err.at(-1).toFixed(3).padStart(14)} ${r.closest.toFixed(2).padStart(14)}`);
  }
  // FLYBY_OUT=dir writes each case's errors, for plotting.
  if (process.env.FLYBY_OUT) fs.writeFileSync(`${process.env.FLYBY_OUT}/${key}.json`, JSON.stringify({ jd: flown.slice(1).map((r) => r[0]), ...Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.err])) }));
  return { runs: Object.values(runs), names: Object.keys(runs), byName: runs, ref, hzCA, epochMs, hours, jd: flown.slice(1).map((r) => r[0]), caJd: hzClose[0] };
}

// A planet's J4 written out again here, as an outside force, to check the
// kernel's (zonal.js): the gradient of V4 = -mu J4 R^4 P4(s) / r^5,
// s = z / r, z along the pole, P4(s) = (35 s^4 - 30 s^2 + 3) / 8:
//   a = -mu J4 R^4 [ p P4'(s) / r^6 - d (s P4'(s) + 5 P4(s)) / r^7 ].
// Jupiter's from Juno's gravity science (Durante et al. 2020, the PDS
// table GRV_JUGR_SHA_JUP_U_DUR2020): J4 = -586.6085e-6 at R = 71,492 km.
const J4_OF = { jupiter: { j4: -586.6085e-6, R: 71492 } };
// Jupiter's zonal terms beyond J2 kept only to degree nMax (0: J2 alone),
// for the runs without them.
const zonalTo = (planet, nMax) => (sys) => { const J = sys.bodyAt(planet, 0); J.zn = nMax && J.zn ? J.zn.filter((t) => t.n <= nMax && t.n % 2 === 0) : null; };
const jupiterTo = (nMax) => zonalTo('jupiter', nMax);
// Jupiter's tide from its moons (zonal.js addTide) switched off.
const noTide = (sys) => { sys.bodyAt('jupiter', 0).tide = null; };
// A planet as a point mass, no J2 or higher.
const pointMass = (planet) => (sys) => { const P = sys.bodyAt(planet, 0); P.j2 = 0; P.zn = null; };
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
const { runs: [none, ours, jpl, track], hzCA, epochMs } = flybyRuns('flyby_juno_ganymede.json', 'jupiter', { variants: { "the same, Jupiter's J2 alone": { tweak: jupiterTo(0) } } });
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
  // Six hours in to closest approach, 1,496 km up at 30 km/s, then on
  // through the perijove four hours later (12:40 TDB, 1.016 Jupiter radii
  // from the centre, 59 km/s) and two hours out. Io bends Juno by 0.12
  // km/s: 440 km an hour on. As at Ganymede, Horizons' Io is 9.8 km from
  // the one Juno's track has. With it:
  //   - an hour after the Io pass, 0.040 km is left; Io's J2 and C22 take
  //     that from 0.18 km, so the pass measures them, and Jupiter's J4
  //     from 0.051 km;
  //   - through the perijove Jupiter's field is the test: with its zonal
  //     terms to J12 (Durante et al. 2020), 0.27 km at the perijove and
  //     0.55 km two hours on; with J2 and J4 only, 0.79 km and 5.0 km;
  //     with J2 alone, 22 km and 150 km. Jupiter's tide from its moons
  //     (k22 = 0.565) moves that by 5 m.
  // The kernel's J4 matches the same term written out here as an outside
  // force. Neither finer nodes for Io nor tighter tolerances move what is
  // left; nor does Durante's own pole for Jupiter in place of the IAU's
  // (7e-6 rad apart, 12 m at the end). Jupiter's centre on 6-hour nodes
  // was 17 m off the table here and left 0.22 and 0.44 km, a partial
  // cancellation: on hourly nodes it is within 0.1 m. The rest is outside
  // the kernel's model: Jupiter's tesseral terms, the field the
  // reconstruction was fitted with, and Juno's own small forces.
  const R = flybyRuns('flyby_juno_io.json', 'jupiter', {
    degree2: true,
    variants: { "the same, Jupiter's J2 alone": { tweak: jupiterTo(0) },
      "the same, Jupiter's J2 and J4": { tweak: jupiterTo(4) },
      'the same, J2, and J4 outside the kernel': { tweak: jupiterTo(0), extraOf: j4Accel('jupiter') },
      "the same, without Jupiter's tide": { tweak: noTide },
      'the same, its nodes every 10 min': fineNodes,
      'the same, tolerances 1e-10 and 1e-9 km': { advance: { tolKm: 1e-10, cowellTolKm: 1e-9 } } },
  });
  const [none, ours, jpl, track, flat, j2, j24, outside, untided, nodes, tight] = R.runs, hzCA = R.hzCA;
  const at = (jd) => R.jd.findIndex((x) => x >= jd - 1e-7);
  const i1 = at(R.caJd + 1 / 24), iP = at(2460309.027777778), iE = R.jd.length - 1;   // PJ57, 12:40 TDB
  console.log('  Juno from Horizons, km: run                  1 h after the Io pass   at the perijove   2 h after it');
  R.names.forEach((n, k) => console.log(`  ${n.padEnd(46)} ${R.runs[k].err[i1].toFixed(3).padStart(10)} ${R.runs[k].err[iP].toFixed(3).padStart(17)} ${R.runs[k].err[iE].toFixed(3).padStart(14)}`));
  check(none.err[i1] > 300, `without the moons Juno is ${none.err[i1].toFixed(0)} km off an hour after the pass`);
  check(track.err[i1] < 0.045, `with JPL's moons and Io as Juno's track has it, ${track.err[i1].toFixed(3)} km off an hour after the pass`);
  check(flat.err[i1] > 3 * track.err[i1], `without Io's J2 and C22, ${flat.err[i1].toFixed(3)} km off: the pass measures them`);
  check(track.err[iP] < 0.35 && track.err[iE] < 0.7, `through the perijove, 1.016 Jupiter radii out: ${track.err[iP].toFixed(3)} km off there, ${track.err[iE].toFixed(3)} km two hours on`);
  check(j24.err[iE] > 8 * track.err[iE] && j2.err[iE] > 20 * j24.err[iE],
    `Jupiter's J6 to J12 take that from ${j24.err[iE].toFixed(2)} km (J2 and J4), and J4 from ${j2.err[iE].toFixed(1)} km (J2 alone)`);
  check(j2.err[i1] > track.err[i1] + 0.005, `an hour after the Io pass Jupiter's J4 is already a fifth of the error (${j2.err[i1].toFixed(3)} km with J2 alone)`);
  check(Math.abs(outside.err[iP] - j24.err[iP]) < 0.002, `the kernel's J4 against the same term written out as an outside force, at the perijove: ${j24.err[iP].toFixed(4)} and ${outside.err[iP].toFixed(4)} km`);
  check(Math.abs(untided.err[iE] - track.err[iE]) < 0.02, `Jupiter's tide from its moons moves it by ${((track.err[iE] - untided.err[iE]) * 1000).toFixed(0)} m: below what the check resolves`);
  check(Math.abs(nodes.err[iE] - track.err[iE]) < 0.01 && Math.abs(tight.err[iE] - track.err[iE]) < 0.01,
    `Io's nodes (${nodes.err[iE].toFixed(3)} km) and tighter tolerances (${tight.err[iE].toFixed(3)} km) change nothing`);
  check(jpl.err[i1] < 2 && Math.abs(ours.err[i1] - jpl.err[i1]) < 0.1, `with Horizons' own moons ${jpl.err[i1].toFixed(3)} km off, with moons.js's ${ours.err[i1].toFixed(3)} km`);
  check(Math.abs(track.closest - hzCA) < 0.1, `closest approach ${track.closest.toFixed(2)} km from Io's centre, Horizons ${hzCA.toFixed(2)} km`);
  check(ours.events.some((e) => e.type === 'primary' && e.to === 'io'), `the primary goes to Io (${ours.events.filter((e) => e.type === 'primary').map((e) => `${e.from}->${e.to}`).join(', ')})`);
}

// Each run's error at row i, for the table of a case.
const row = (R, cols) => {
  console.log(`  ${R.craftName} from ${R.ref}, km: run`.padEnd(48) + cols.map(([h]) => h.padStart(16)).join(''));
  R.names.forEach((n, k) => console.log(`  ${n.padEnd(46)}${cols.map(([, i]) => R.runs[k].err[i].toFixed(3).padStart(16)).join('')}`));
};
const atJd = (R, jd) => R.jd.findIndex((x) => x >= jd - 1e-7);
// A planet's J2 (and J4) moved by its published uncertainty.
const shiftZonal = (planet, n, dJ) => (sys) => {
  const P = sys.bodyAt(planet, 0);
  if (n === 2) P.j2 += dJ; else P.zn = P.zn.map((t) => (t.n === n ? { ...t, J: t.J + dJ } : t));
};

header("CASE 3d: Juno's flyby of Europa, 29 September 2022 (PJ45), against JPL's reconstruction");
{
  // Six hours in to closest approach, 355 km up at 23.6 km/s, then on
  // through the perijove seven and a half hours later (17:10 TDB, 1.04
  // Jupiter radii) and two hours out. Horizons' Europa is 1.7 km from the
  // one Juno's track has. With it:
  //   - an hour after the pass 5 m is left; Europa's J2 and C22 take that
  //     from 0.13 km, so the pass measures them (Europa's J2 is the least
  //     certain of the moons' fields, +-77.5e-6 of 437.6e-6);
  //   - through the perijove, with Jupiter's field to J12, 0.14 km at the
  //     perijove and 0.10 km two hours on; with J2 and J4 only, 3.3 km;
  //     with J2 alone, 110 km.
  // Jupiter's tide from its moons moves it by under 0.01 km.
  const R = flybyRuns('flyby_juno_europa.json', 'jupiter', {
    degree2: true,
    variants: { "the same, Jupiter's J2 alone": { tweak: jupiterTo(0) }, "the same, Jupiter's J2 and J4": { tweak: jupiterTo(4) },
      "the same, without Jupiter's tide": { tweak: noTide } },
  });
  const [none, ours, jpl, track, flat, j2, j24, untided] = R.runs;
  const i1 = atJd(R, R.caJd + 1 / 24), iP = atJd(R, 2459852.215277778), iE = R.jd.length - 1;   // PJ45, 17:10 TDB
  R.craftName = 'Juno';
  row(R, [['1 h after', i1], ['at the perijove', iP], ['2 h after it', iE]]);
  check(none.err[i1] > 300, `without the moons Juno is ${none.err[i1].toFixed(0)} km off an hour after the pass`);
  check(track.err[i1] < 0.02 && flat.err[i1] > 10 * track.err[i1],
    `an hour after the pass ${(track.err[i1] * 1000).toFixed(0)} m off with Europa where Juno's track has it; ${flat.err[i1].toFixed(3)} km without Europa's J2 and C22: the pass measures them`);
  check(track.err[iP] < 0.2 && track.err[iE] < 0.15, `through the perijove: ${track.err[iP].toFixed(3)} km off there, ${track.err[iE].toFixed(3)} km two hours on`);
  check(j24.err[iE] > 10 * track.err[iE] && j2.err[iE] > 50, `Jupiter's J6 to J12 take that from ${j24.err[iE].toFixed(2)} km (J2 and J4), and J4 from ${j2.err[iE].toFixed(0)} km (J2 alone)`);
  check(Math.abs(untided.err[iE] - track.err[iE]) < 0.02, `Jupiter's tide moves it by ${((untided.err[iE] - track.err[iE]) * 1000).toFixed(0)} m: below what the check resolves`);
  check(jpl.err[i1] < 1 && ours.err[i1] < 1, `with Horizons' own moons ${jpl.err[i1].toFixed(3)} km off, with moons.js's ${ours.err[i1].toFixed(3)} km`);
  check(Math.abs(track.closest - R.hzCA) < 0.1, `closest approach ${track.closest.toFixed(2)} km from Europa's centre, Horizons ${R.hzCA.toFixed(2)} km`);
}

header("CASE 3e: Cassini's flyby of Enceladus, 30 November 2010 (E12), against JPL's reconstruction");
{
  // One of the three passes Iess et al. 2014 measured Enceladus's field
  // on: 43 km above its mean radius over the north pole, away from the
  // plumes, at 6.3 km/s, nine hours either side. Horizons' Enceladus is
  // 0.64 km from the one Cassini's track has. With it, 0.16 km is left
  // nine hours on; Enceladus's J2 and C22 take that from 0.88 km. (A
  // higher pass, E8 at 1,594 km, showed a 0.25 m/s change at closest
  // approach that no force here accounts for, nor Enceladus's GM a quarter
  // larger: an event in the reconstruction, so it is not used.)
  const R = flybyRuns('flyby_cassini_enceladus.json', 'saturn', {
    degree2: true, variants: { 'the same, tolerances 1e-10 and 1e-9 km': { advance: { tolKm: 1e-10, cowellTolKm: 1e-9 } } },
  });
  const [none, ours, jpl, track, flat, tight] = R.runs;
  check(none.err.at(-1) > 100, `without the moons Cassini is ${none.err.at(-1).toFixed(0)} km off nine hours on`);
  check(track.err.at(-1) < 0.25, `with Enceladus where Cassini's track has it, ${track.err.at(-1).toFixed(3)} km off nine hours on`);
  check(flat.err.at(-1) > 4 * track.err.at(-1), `without Enceladus's J2 and C22, ${flat.err.at(-1).toFixed(3)} km: the pass measures them`);
  check(Math.abs(tight.err.at(-1) - track.err.at(-1)) < 0.005, `tighter tolerances change nothing (${tight.err.at(-1).toFixed(3)} km)`);
  check(jpl.err.at(-1) < 1 && ours.err.at(-1) < 2, `with Horizons' own moons ${jpl.err.at(-1).toFixed(3)} km off, with moons.js's ${ours.err.at(-1).toFixed(3)} km`);
  // Sampled every 10 s at 6.3 km/s, the closest sample can be 1.6 km off the true minimum.
  check(Math.abs(track.closest - R.hzCA) < 2, `closest sampled approach ${track.closest.toFixed(1)} km from Enceladus's centre, Horizons ${R.hzCA.toFixed(1)} km (10 s samples)`);
  check(ours.events.some((e) => e.type === 'primary' && e.to === 'enceladus'), `the primary goes to Enceladus (${ours.events.filter((e) => e.type === 'primary').map((e) => `${e.from}->${e.to}`).join(', ')})`);
}

header("CASE 3f: Cassini's Grand Finale periapsis on Rev 278, 10 June 2017, against JPL's reconstruction");
{
  // One of the five gravity passes Iess et al. 2019 measured Saturn's
  // field on: between the rings and the planet, 63,623 km from its centre
  // at 33.8 km/s, six hours either side. With JPL's moons, 0.05 km off at
  // periapsis and 0.32 km six hours on; with Saturn's J2 and J4 only,
  // 2.6 km; with J2 alone, 114 km. J10 and J12 move it by 10 m. Not in the
  // kernel: the rings' own pull (0.41 Mimas masses, Iess et al. 2019),
  // Saturn's tides and its deep winds' time-varying field.
  const R = flybyRuns('flyby_cassini_saturn.json', 'saturn', {
    variants: { "the same, Saturn's J2 alone": { tweak: zonalTo('saturn', 0) }, "the same, Saturn's J2 and J4": { tweak: zonalTo('saturn', 4) },
      "the same, Saturn's J2 to J8": { tweak: zonalTo('saturn', 8) } },
  });
  const [none, ours, jpl, j2, j24, j28] = R.runs, iC = atJd(R, R.caJd), iE = R.jd.length - 1;
  R.craftName = 'Cassini';
  row(R, [['at periapsis', iC], ['6 h after', iE]]);
  check(none.err[iE] > 500, `without the moons Cassini is ${none.err[iE].toFixed(0)} km off six hours on`);
  check(jpl.err[iC] < 0.1 && jpl.err[iE] < 0.4, `with JPL's moons ${jpl.err[iC].toFixed(3)} km off at periapsis, ${jpl.err[iE].toFixed(3)} km six hours on`);
  check(j2.err[iE] > 100 && j24.err[iE] > 5 * jpl.err[iE], `Saturn's J6 to J12 take that from ${j24.err[iE].toFixed(2)} km (J2 and J4), and J4 from ${j2.err[iE].toFixed(0)} km (J2 alone)`);
  check(Math.abs(j28.err[iE] - jpl.err[iE]) < 0.03, `J10 and J12 move it by ${((jpl.err[iE] - j28.err[iE]) * 1000).toFixed(0)} m`);
  check(ours.err[iE] < 0.5, `with moons.js's moons, ${ours.err[iE].toFixed(3)} km`);
  check(Math.abs(jpl.closest - R.hzCA) < 0.1, `periapsis ${jpl.closest.toFixed(2)} km from Saturn's centre, Horizons ${R.hzCA.toFixed(2)} km`);
}

// The reconstruction restarted on every row: the kernel flown from each
// 10-minute row of the craft's table to the next, against the table's
// velocity there (m/s). Away from the bodies 0.1 mm/s is left; an interval
// with over 1 mm/s and five times both its neighbours' is a step in the
// reconstruction's velocity, from a firing of Voyager's thrusters, which the
// reconstruction estimates and the kernel leaves out. withSteps() puts them
// back, each as a constant acceleration over its interval.
function intervals(file, planet, tweak = null) {
  const fx = JSON.parse(fs.readFileSync(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'));
  const m = Object.fromEntries(Object.entries(fx.moons).map(([k, rows]) => [k, table(rows)])), c = table(fx.centre);
  const rows = fx.craft.filter((r) => r[0] >= fx.span[0] - 1e-7 && r[0] <= fx.span[1] + 1e-7);
  const tt0 = ttOf(rows[0][0]) - 3600;
  const sys = solarSystemBodies({ epochMs: utcMsAtTt(tt0), satellites: { moon: (k, tt) => m[k](tt), offset: (_, tt) => c(tt) } });
  if (tweak) tweak(sys);
  const bary = (t) => helioStateEqjAtTt(planet, tt0 + t);
  const all = rows.slice(1).map((b, i) => {
    const a = rows[i], t0 = ttOf(a[0]) - tt0, t1 = ttOf(b[0]) - tt0, b0 = bary(t0);
    const st = createState(b0.r.map((x, k) => x + a[1 + k]), b0.v.map((x, k) => x + a[4 + k]), t0);
    advance(st, t1, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 });
    const B = bary(t1), dv = [0, 1, 2].map((k) => b[4 + k] + B.v[k] - st.v[k]);
    return { jd0: a[0], jd1: b[0], dv, n: Math.hypot(...dv) * 1000 };
  });
  const steps = all.filter((r, i) => r.n > 1e-3 && r.n > 5 * (all[i - 1]?.n ?? 0) && r.n > 5 * (all[i + 1]?.n ?? 0));
  // The root sum square over the intervals between two times, steps left out.
  const rss = (jd0, jd1) => Math.sqrt(all.filter((r) => r.jd0 >= jd0 - 1e-7 && r.jd1 <= jd1 + 1e-7 && !steps.includes(r)).reduce((a, r) => a + r.n * r.n, 0));
  return { all, steps, rss };
}
const withSteps = (steps) => (sys) => {
  const tt0 = ttSeconds(sys.epochMs), at = steps.map((s) => [ttOf(s.jd0) - tt0, ttOf(s.jd1) - tt0, s.dv]);
  return (t, r, out) => {
    out[0] = out[1] = out[2] = 0;
    for (const [a, b, dv] of at) if (t >= a && t < b) for (let k = 0; k < 3; k++) out[k] = dv[k] / (b - a);
    return out;
  };
};
const hhmm = (jd) => new Date((jd - 2440587.5) * 864e5).toISOString().slice(11, 16);
const stepList = (steps) => steps.map((s) => `${hhmm(s.jd0)} ${(s.n * 1000).toFixed(1)}`).join(', ');
// A planet's pole as orientation.js has it (astronomy-engine, IAU 2009),
// in place of the satellite kernel's (bodies.js poleAt).
const iauPole = (planet) => (sys) => { const P = sys.bodyAt(planet, 0); P.poleAt = null; P.poleT = NaN; };
const both = (...fs) => (sys) => fs.forEach((f) => f(sys));
// A planet's zonal field set to other values (J2, { n: Jn }, R).
const zonalOf = (planet, j2, jn, R) => (sys) => { const P = sys.bodyAt(planet, 0); P.j2 = j2; P.rJ2 = R; P.zn = zonalTerms(jn, R); };

header("CASE 3g: Voyager 2 at Neptune and Triton, 25 August 1989, against NAIF's reconstruction");
{
  // Seven hours in to Neptune (03:56 TDB, 29,240 km from its centre, at
  // 27 km/s), then Triton five hours later (39,783 km) and six hours out.
  // Horizons' Voyager 2 is a patched-conic design trajectory until 29
  // August 1989, so the reference is NAIF's reconstruction of the
  // encounter, vgr2_nep097.bsp (R. Jacobson, 2022), sampled by
  // c/flyby_ref; it sits 35 km from the design one at Triton.
  // Neptune's field is the test: as a point mass Voyager is 1,100 km off
  // at the end, with J2 alone 7 km. The field is nep097's, the one the
  // reconstruction was fitted with (bodies.js): its J2 and J4 are Jacobson
  // 2009's, which the kernel had, and its pole, 0.056 deg from the IAU's,
  // takes the miss from 3.2 km to 2.6 km. Neptune's J2 two sigma larger
  // (9e-6) lowers it further, to 1.6 km with the IAU pole, but the pass
  // restarted on every row says otherwise: through closest approach that
  // J2 doubles what is left. The rest is the reconstruction's own: six
  // steps in its velocity (31 and 56 mm/s before Triton, 56 mm/s after it)
  // and the residual through closest approach (up to 31 mm/s an interval),
  // which no change to the field takes away; with the steps put back,
  // 1.8 km.
  // Before 2000 the planets' places are astronomy-engine's; flown about
  // Neptune's barycentre, their error only enters through the Sun's tide.
  const file = 'flyby_voyager2_triton.json';
  const I = intervals(file, 'neptune'), J2UP = shiftZonal('neptune', 2, 9e-6 * (25225 / 24764) ** 2);
  const R = flybyRuns(file, 'neptune', {
    variants: { "the same, Neptune's J2 alone": { tweak: zonalTo('neptune', 0) }, 'the same, Neptune a point mass': { tweak: pointMass('neptune') },
      "the same, the IAU pole": { tweak: iauPole('neptune') },
      "the same, Jacobson 2009's field and the IAU pole": { tweak: both(iauPole('neptune'), zonalOf('neptune', 3408.43e-6, { 4: -33.40e-6 }, 25225)) },
      "the same, J2 two sigma larger, the IAU pole": { tweak: both(iauPole('neptune'), J2UP) },
      "the same, with the reconstruction's steps": { extraOf: withSteps(I.steps) } },
  });
  const [none, ours, jpl, track, j2, pm, iau, before, dj2, stepped] = R.runs, iN = atJd(R, 2447763.663194444), iE = R.jd.length - 1;
  R.craftName = 'Voyager 2';
  row(R, [['at Neptune', iN], ['6 h after Triton', iE]]);
  // Through closest approach: 02:20 to 05:50 TDB, Neptune within 120,000 km.
  const [ca0, ca1] = [2447763.597222, 2447763.743056];
  const rssOf = (tweak) => intervals(file, 'neptune', tweak).rss(ca0, ca1);
  const rIau = rssOf(iauPole('neptune')), rUp = rssOf(both(iauPole('neptune'), J2UP)), rNep = I.rss(ca0, ca1);
  console.log(`  steps in the reconstruction (TDB, mm/s): ${stepList(I.steps)}`);
  console.log(`  restarted on every row, through closest approach (rss, mm/s): nep097's field and pole ${(rNep * 1000).toFixed(1)}, the IAU pole ${(rIau * 1000).toFixed(1)}, J2 two sigma larger ${(rUp * 1000).toFixed(1)}`);
  check(none.err[iE] > 500, `without Triton (the system at its barycentre) Voyager 2 is ${none.err[iE].toFixed(0)} km off at the end`);
  check(track.err[iN] < 0.3 && track.err[iE] < 3, `with Triton, ${track.err[iN].toFixed(3)} km off at Neptune, ${track.err[iE].toFixed(2)} km six hours after Triton (under 3 km)`);
  check(pm.err[iE] > 100 * track.err[iE] && j2.err[iE] > 1.5 * track.err[iE], `Neptune as a point mass ${pm.err[iE].toFixed(0)} km, with J2 alone ${j2.err[iE].toFixed(1)} km: the pass measures its J2 and J4`);
  check(iau.err[iE] > track.err[iE] + 0.3 && Math.abs(before.err[iE] - iau.err[iE]) < 0.1 && rIau > rNep,
    `nep097's pole: ${track.err[iE].toFixed(2)} km, the IAU pole ${iau.err[iE].toFixed(2)} km (with Jacobson 2009's field, as before, ${before.err[iE].toFixed(2)} km)`);
  check(dj2.err[iE] < iau.err[iE] && rUp > 1.5 * rIau,
    `J2 two sigma larger: ${dj2.err[iE].toFixed(2)} km at the end, but ${(rUp * 1000).toFixed(0)} mm/s through closest approach against ${(rIau * 1000).toFixed(0)}: it makes up for the steps`);
  check(I.steps.length >= 4 && stepped.err[iE] < 0.8 * track.err[iE], `with the reconstruction's ${I.steps.length} steps put back, ${stepped.err[iE].toFixed(2)} km`);
  // Sampled every 10 s at 18 km/s; the error has grown to 1.3 km by Triton.
  check(Math.abs(track.closest - R.hzCA) < 2.5, `closest approach ${track.closest.toFixed(2)} km from Triton's centre, the reconstruction ${R.hzCA.toFixed(2)} km`);
}

header("CASE 3h: Voyager 2 at Miranda and Uranus, 24 January 1986, against NAIF's reconstruction");
{
  // Eight hours in to Miranda (17:04 TDB, 28,242 km from its centre, at
  // 20 km/s) and Uranus an hour later (18:00, 107,153 km, 4.2 radii), then
  // twelve hours out. The reference is NAIF's vgr2.ura182.bsp (R.
  // Jacobson, 2025), with URA182's Uranus and moons, the solution it was
  // fitted with (Jacobson and Park 2025): the kernel has URA182's field
  // and moon GMs (bodies.js). The flight starts at 10:00, after 50 minutes
  // of thruster firing in the reconstruction (0.24 m/s). Restarted on
  // every row, the pass shows Uranus's J2 (0.31 m/s over closest approach
  // as a point mass, against 0.6 mm/s), each moon's pull, and J4 and J6
  // faintly (0.63 mm/s without them). Flown through, the miss is the
  // reconstruction's eight steps (up to 60 mm/s, three of them 2-3 mm/s
  // as Voyager passed Miranda): with them put back, 2.3 km becomes 0.3 km.
  // URA182's field and GMs against Jacobson 2014's field and Horizons'
  // GMs (Oberon 205.34, Miranda 4.3), as before: 2.34 and 2.40 km.
  const file = 'flyby_voyager2_miranda.json';
  const I = intervals(file, 'uranus'), off = (k) => (sys) => { sys.bodyAt(k, 0).mu = 0; };
  const horizonsGm = (sys) => { for (const k of ['miranda', 'ariel', 'umbriel', 'titania', 'oberon']) sys.bodyAt(k, 0).mu = MOON_DATA[k].gm; };
  const ura111 = zonalOf('uranus', 3510.7e-6, { 4: -34.2e-6 }, 25559), S = { extraOf: withSteps(I.steps) };
  const moons = ['miranda', 'ariel', 'umbriel', 'titania', 'oberon'];
  const R = flybyRuns(file, 'uranus', {
    variants: { 'the same, Uranus a point mass': { tweak: pointMass('uranus') }, "the same, Uranus's J2 alone": { tweak: zonalTo('uranus', 0) },
      "the same, Jacobson 2014's field and Horizons' GMs": { tweak: both(ura111, horizonsGm) },
      "the same, with the reconstruction's steps": S,
      ...Object.fromEntries(moons.map((k) => [`the same, with the steps, without ${MOON_DATA[k].name}`, { ...S, tweak: off(k) }])) },
  });
  const [none, ours, jpl, track, pm, j2, before, stepped, ...without] = R.runs, iU = atJd(R, 2446455.25), iE = R.jd.length - 1;
  R.craftName = 'Voyager 2';
  row(R, [['at Uranus', iU], ['12 h after it', iE]]);
  // Through closest approach: 15:10 to 21:00 TDB, Uranus within 210,000 km.
  const [ca0, ca1] = [2446455.131944, 2446455.375];
  const rssOf = (tweak) => intervals(file, 'uranus', tweak).rss(ca0, ca1);
  const r0 = I.rss(ca0, ca1), rPm = rssOf(pointMass('uranus')), rJ2 = rssOf(zonalTo('uranus', 0)), rBefore = rssOf(both(ura111, horizonsGm));
  const rOff = Object.fromEntries(moons.map((k) => [k, rssOf(off(k))]));
  console.log(`  steps in the reconstruction (TDB, mm/s): ${stepList(I.steps)}`);
  console.log(`  restarted on every row, through closest approach (rss, mm/s): URA182 ${(r0 * 1000).toFixed(2)}, Uranus a point mass ${(rPm * 1000).toFixed(1)}, J2 alone ${(rJ2 * 1000).toFixed(2)}, Jacobson 2014's field and Horizons' GMs ${(rBefore * 1000).toFixed(2)}; without ${moons.map((k) => `${MOON_DATA[k].name} ${(rOff[k] * 1000).toFixed(2)}`).join(', ')}`);
  check(none.err[iE] > 50, `without the moons (the system at its barycentre) Voyager 2 is ${none.err[iE].toFixed(0)} km off at the end`);
  check(track.err[iU] < 1 && track.err[iE] < 3, `with the moons, ${track.err[iU].toFixed(3)} km off at Uranus, ${track.err[iE].toFixed(2)} km twelve hours after it (under 3 km)`);
  check(I.steps.length >= 6 && stepped.err[iE] < 0.5 && stepped.err[iE] < track.err[iE] / 4,
    `with the reconstruction's ${I.steps.length} steps put back, ${stepped.err[iE].toFixed(3)} km: the steps are the miss`);
  check(pm.err[iE] > 4 * track.err[iE] && rPm > 100 * r0, `Uranus as a point mass ${pm.err[iE].toFixed(1)} km, and ${(rPm * 1000).toFixed(0)} mm/s restarted on every row: the pass measures its J2`);
  // The table's rounding (1e-4 km, 1e-7 km/s) leaves about 0.07 mm/s an
  // interval, 0.4 mm/s over these 35.
  check(rJ2 > r0 && Math.abs(j2.err[iE] - track.err[iE]) < 0.01,
    `its J4 and J6 show only restarted (${(rJ2 * 1000).toFixed(2)} mm/s without them); flown, they move the miss by ${(Math.abs(j2.err[iE] - track.err[iE]) * 1000).toFixed(0)} m, 4.2 radii out`);
  check(moons.every((k) => rOff[k] > r0) && ['ariel', 'titania', 'oberon'].every((k) => rOff[k] > 2 * r0),
    `every moon's pull shows: restarted, ${(r0 * 1000).toFixed(2)} mm/s with all five, ${moons.map((k) => `${(rOff[k] * 1000).toFixed(2)} without ${MOON_DATA[k].name}`).join(', ')}`);
  check(rBefore > r0, `URA182's field and GMs against Jacobson 2014's and Horizons': ${(r0 * 1000).toFixed(2)} and ${(rBefore * 1000).toFixed(2)} mm/s restarted, ${track.err[iE].toFixed(2)} and ${before.err[iE].toFixed(2)} km flown`);
  check(without.every((w) => w.err[iE] > stepped.err[iE]), `with the steps, each moon left out: ${moons.map((k, i) => `${MOON_DATA[k].name} ${without[i].err[iE].toFixed(2)}`).join(', ')} km`);
  check(Math.abs(track.closest - R.hzCA) < 1, `closest approach ${track.closest.toFixed(2)} km from Miranda's centre, the reconstruction ${R.hzCA.toFixed(2)} km`);
}

header("CASE 3c: Cassini's flyby of Titan, 31 July 2008 (T45), against JPL's reconstruction");
{
  // Nine hours either side of closest approach, 1,613 km up at 6.2 km/s,
  // 19 to 20 Saturn radii out. Titan bends Cassini by 22,000 km over the
  // nine hours. Horizons' Titan is within 0.04 km of the one Cassini's
  // track has. With it, 4 m is left. A pass this slow is sensitive to
  // where Titan is: with its Hermite nodes three hours apart (bodies.js
  // NODE_TOL at 100 m, before) they put it 27 m from the table at closest
  // approach and Cassini 0.093 km off; two hours apart (10 m) 14 m and
  // 0.004 km, and nodes every 10 minutes change nothing more. Titan's J2
  // and C22 take the error from 0.37 km.
  const { runs: [none, ours, jpl, track, flat, nodes], hzCA } = flybyRuns('flyby_cassini_titan.json', 'saturn', {
    degree2: true, variants: { 'the same, its nodes every 10 min': fineNodes },
  });
  check(none.err.at(-1) > 10000, `without the moons Cassini is ${none.err.at(-1).toFixed(0)} km off 9 h after the pass`);
  check(track.err.at(-1) < 0.02, `with JPL's moons and Titan as Cassini's track has it, ${track.err.at(-1).toFixed(3)} km off`);
  check(Math.abs(nodes.err.at(-1) - track.err.at(-1)) < 0.01, `the same with Titan's nodes every 10 minutes, ${nodes.err.at(-1).toFixed(3)} km: the kernel's nodes no longer limit it`);
  check(flat.err.at(-1) > 3 * track.err.at(-1), `without Titan's J2 and C22, ${flat.err.at(-1).toFixed(3)} km off`);
  check(jpl.err.at(-1) < 0.4 && ours.err.at(-1) < 1, `with Horizons' own moons ${jpl.err.at(-1).toFixed(3)} km off, with moons.js's ${ours.err.at(-1).toFixed(3)} km`);
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

header("CASE 5: a moon's degree-2 field (J2 and C22), and Jupiter's zonals to J12, are the gradient of their potential");
{
  // Ganymede's field about tilted axes, against central differences of
  // U = -(mu R^2 J2 / 2)(3 z^2 / r^5 - 1 / r^3) + 3 mu R^2 C22 (x^2 - y^2) / r^5.
  const Z = unit([0.2, -0.3, 1]), X0 = unit([1, 0.4, 0.1]);
  const X = unit(X0.map((x, i) => x - dot(X0, Z) * Z[i]));
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  const b = { mu: 9887.83, j2: 133.0e-6, c22: 39.56e-6, rJ2: 2631.2, pole: Z, axisX: X, axisY: Y };
  const U = (d) => {
    const r2 = dot(d, d), r = Math.sqrt(r2), x = dot(d, X), y = dot(d, Y), z = dot(d, Z), R2 = b.rJ2 * b.rJ2;
    return -(b.mu * R2 * b.j2 / 2) * (3 * z * z / r ** 5 - 1 / r ** 3) + 3 * b.mu * R2 * b.c22 * (x * x - y * y) / r ** 5;
  };
  const { addJ2 } = await import('./zonal.js');
  let worst = 0;
  for (const d of [[3000, 1000, 500], [-2000, 2500, -1500], [500, -400, 3200], [4000, 0, 0]]) {
    const a = [0, 0, 0];
    addJ2(d[0], d[1], d[2], dot(d, d), b, a);
    const g = [0, 1, 2].map((i) => { const h = 1e-3, p = [...d], m = [...d]; p[i] += h; m[i] -= h; return (U(p) - U(m)) / (2 * h); });
    worst = Math.max(worst, Math.hypot(a[0] - g[0], a[1] - g[1], a[2] - g[2]) / Math.hypot(...g));
  }
  check(worst < 1e-6, `J2 + C22 acceleration against the potential's gradient: worst relative difference ${worst.toExponential(1)}`);
  // Jupiter's field to J12 the same way, against
  // U = -sum_n mu Jn R^n Pn(s) / r^(n+1), Pn by Bonnet's recursion (the
  // derivatives in zonal.js are checked, not used, here).
  {
    const { solarSystemBodies: ssb } = await import('./bodies.js');
    const Jb = ssb({ epochMs: Date.UTC(2026, 10, 12) }).bodyAt('jupiter', 0);
    const J = { mu: Jb.mu, j2: Jb.j2, rJ2: Jb.rJ2, zn: Jb.zn, pole: Z };
    const Jn = { 2: J.j2, ...Object.fromEntries(J.zn.map((t) => [t.n, t.J])) };
    const UJ = (d) => {
      const r = Math.hypot(...d), s = dot(d, Z) / r;
      let P0 = 1, P1 = s, U = 0;
      for (let n = 2; n <= 12; n++) {
        const P2 = ((2 * n - 1) * s * P1 - (n - 1) * P0) / n; P0 = P1; P1 = P2;
        U -= J.mu * (Jn[n] ?? 0) * J.rJ2 ** n * P1 / r ** (n + 1);
      }
      return U;
    };
    let worstJ = 0, worst6 = 0;
    // Points 1.05 to 1.6 Jupiter radii out, where every term to J12 acts.
    for (const d of [[60000, 40000, 20000], [-50000, 30000, -55000], [10000, -20000, 74000], [76000, 0, 0], [-30000, -60000, 40000]]) {
      const a = [0, 0, 0], a4 = [0, 0, 0];
      addJ2(d[0], d[1], d[2], dot(d, d), J, a);
      addJ2(d[0], d[1], d[2], dot(d, d), { ...J, zn: J.zn.filter((t) => t.n <= 4) }, a4);
      const g = [0, 1, 2].map((i) => { const h = 0.01, p = [...d], m = [...d]; p[i] += h; m[i] -= h; return (UJ(p) - UJ(m)) / (2 * h); });
      worstJ = Math.max(worstJ, Math.hypot(a[0] - g[0], a[1] - g[1], a[2] - g[2]) / Math.hypot(...g));
      worst6 = Math.max(worst6, Math.hypot(a[0] - a4[0], a[1] - a4[1], a[2] - a4[2]) / Math.hypot(...g));
    }
    check(worstJ < 1e-6 && worst6 > 1e-3, `Jupiter's zonal field to J12 against the potential's gradient: worst relative difference ${worstJ.toExponential(1)} (J5 to J12 are up to ${(worst6 * 100).toFixed(1)} % of the field's pull here)`);
  }
  // Jupiter's tide raised by a moon (zonal.js addTide), against
  // V = k2 GM_m R^5 / rm^3 [ P2(d . u / d) + P2(d . n / d) / 2 ] / d^3.
  {
    const { addTide } = await import('./zonal.js');
    const P2 = (x) => 1.5 * x * x - 0.5;
    const moon = { key: 'm', mu: 5959.9, r: [300000, 250000, 40000], pole: unit([0.05, -0.1, 1]) };
    const J = { key: 'j', r: [0, 0, 0], rJ2: 71492, tide: { k2: 0.565, raisers: ['m'] } };
    const list = [J, moon], rm = Math.hypot(...moon.r), u = moon.r.map((x) => x / rm);
    const K = J.tide.k2 * moon.mu * J.rJ2 ** 5 / rm ** 3;
    const V = (d) => { const r = Math.hypot(...d); return K * (P2(dot(d, u) / r) + 0.5 * P2(dot(d, moon.pole) / r)) / r ** 3; };
    let worstT = 0;
    for (const d of [[80000, 20000, 10000], [-60000, 90000, -30000], [10000, -20000, 120000]]) {
      const a = [0, 0, 0];
      addTide(d[0], d[1], d[2], dot(d, d), J, list, a);
      const g = [0, 1, 2].map((i) => { const h = 1, p = [...d], m = [...d]; p[i] += h; m[i] -= h; return (V(p) - V(m)) / (2 * h); });
      worstT = Math.max(worstT, Math.hypot(a[0] - g[0], a[1] - g[1], a[2] - g[2]) / Math.hypot(...g));
    }
    check(worstT < 1e-6, `Jupiter's tide from a moon against its potential's gradient: worst relative difference ${worstT.toExponential(1)}`);
  }
  // In the kernel the moons carry it, turning with their orbits.
  const sys = solarSystemBodies({ epochMs: Date.UTC(2026, 10, 12) });
  const G = sys.bodyAt('ganymede', 0), Jc = sys.bodyAt('jupiter', 0);
  const toJ = Jc.r.map((x, i) => x - G.r[i]), toJn = Math.hypot(...toJ);
  check(G.c22 > 0 && Math.abs(dot(G.axisX, toJ) / toJn - 1) < 1e-6 && Math.abs(dot(G.axisX, G.pole)) < 1e-12,
    `Ganymede's x axis points at Jupiter (cos ${(dot(G.axisX, toJ) / toJn).toFixed(9)}), its z along its orbit's pole`);
}

console.log(failed ? `\nflyby: ${failed} check(s) FAILED` : '\nflyby: all checks passed');
process.exit(failed ? 1 : 0);
