// src/physics/asteroids.test.mjs
//
// The largest asteroids: SB441's table (sbTable.js) against SB441 itself
// and JPL Horizons, what it fixes in the drawn labels (smallBodies.js), its
// two-body continuation outside 2000-2050, and the sixteen perturbers'
// gravity in the spacecraft kernel (asteroids.js, bodies.js): a cruise, a
// Dawn-like orbit about Vesta and a Psyche-like approach.
//
//   node src/physics/asteroids.test.mjs

import './deNode.js';
import fs from 'node:fs';
import { sbHelioState, sbIds, sbSpan, kepler } from './sbTable.js';
import { PERTURBERS } from './asteroids.js';
import { positionAu, keplerAu, naifIdOf, exactOrbit, decodeSmallBodies, SB_EPOCH_JD, smallBodyFacts } from './smallBodies.js';
import { solarSystemBodies } from './bodies.js';
import { advance, createState } from './nbody.js';
import { ttSeconds } from './ephemeris.js';
import { tdbFromTt } from './timescale.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const AU = 149597870.7, DAY = 86400;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const fixture = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const meta = JSON.parse(fs.readFileSync(new URL('../../public/data/smallbodies.json', import.meta.url)));
const TNO = (n) => n >= 50000 && n !== 65803 && n !== 99942 && n !== 101955 && n !== 162173;

header('THE TABLE');
{
  const ids = sbIds();
  console.log(`  ${ids.length} asteroids: ${ids.map((id) => id - 2000000).join(', ')}`);
  check('it holds all sixteen of SB441-N16\'s perturbers', PERTURBERS.every((a) => ids.includes(a.id)));
  const named = meta.named.filter((n) => ids.includes(naifIdOf(n.pdes)));
  console.log(`  named in the app and in the table: ${named.map((n) => n.name).join(', ')}`);
  check('and the bodies the app names that sb441-n373s covers (14)', named.length === 14);
  // From 2000-01-01 00:00 TDB to the end of each series' last interval, a
  // little past 2050 (the Sun's ends on 2050 February 9).
  const end2050 = (Date.UTC(2050, 0, 1) - Date.UTC(2000, 0, 1, 12)) / 1000;
  check('it spans 2000 to 2050 (TDB)', sbIds().every((id) => sbSpan(id)[0] === -43200 && sbSpan(id)[1] >= end2050));
}

header('AGAINST SB441 (spkezr_c through c/sb_cheb.c, 11 dates from 2000 to 2050)');
{
  const ref = fixture('asteroids_sb441.json');
  let worstR = 0, worstV = 0, at = '';
  for (const [id, rows] of Object.entries(ref.bodies)) {
    rows.forEach((s, k) => {
      const t = sbHelioState(Number(id), ref.et[k]);
      const e = dist(t.r, s), ev = dist(t.v, s.slice(3));
      if (e > worstR) { worstR = e; at = `${Number(id) - 2000000} on ${ref.dates[k]}`; }
      worstV = Math.max(worstV, ev);
    });
  }
  console.log(`  worst ${(worstR * 1000).toFixed(0)} m (${at}), velocity ${(worstV * 1e6).toFixed(2)} mm/s`);
  check('every position within 1 km of SB441', worstR < 1);
  check('every velocity within 5 mm/s of SB441', worstV < 5e-6);
}

header('AGAINST JPL HORIZONS (each body\'s current orbit solution)');
{
  // Horizons integrates each asteroid from its newest solution in the
  // Small-Body Database; SB441 from those of 2021. They part by what the
  // orbits have learned since: tens to hundreds of km in the main belt,
  // and for the distant trans-Neptunian objects, observed over a small arc
  // of their orbits, tens of thousands.
  const fx = fixture('asteroids_horizons.json');
  let worstBelt = 0, worstTno = 0, worstNow = 0;
  for (const [n, b] of Object.entries(fx.bodies)) {
    const errs = b.rows.map((r) => dist(sbHelioState(2000000 + Number(n), (r.jd - 2451545) * DAY).r, r.r));
    const named = meta.named.find((m) => m.pdes === n);
    // The two-body ellipse the labels used before, from Horizons' elements
    // at 2026: what the table takes the place of.
    const kep = named ? Math.max(...b.rows.map((r) => dist(keplerAu(named, r.jd).map((x) => x * AU), eqjToEclKm(r.r)))) : null;
    const worst = Math.max(...errs);
    if (TNO(Number(n))) worstTno = Math.max(worstTno, worst); else { worstBelt = Math.max(worstBelt, worst); worstNow = Math.max(worstNow, errs[5]); }
    const name = PERTURBERS.find((a) => a.number === Number(n))?.name ?? named?.name ?? n;
    console.log(`  ${name.padEnd(12)} worst ${worst.toFixed(0).padStart(6)} km${kep ? `   (two-body ellipse: ${(kep / 1e6).toFixed(1)} million km)` : ''}`);
  }
  check('the main belt and Eros within 400 km of Horizons, 2000 to 2050', worstBelt < 400);
  check('and within 200 km on 2025-01-01', worstNow < 200);
  check('the trans-Neptunian objects within 250,000 km (the two-body ellipses: millions)', worstTno < 2.5e5);
}

// Equatorial to ecliptic J2000 (positionAu's rotation), km.
function eqjToEclKm(r) {
  const e = 84381.448 / 3600 * Math.PI / 180, c = Math.cos(e), s = Math.sin(e);
  return [r[0], c * r[1] + s * r[2], -s * r[1] + c * r[2]];
}

header('THE LABELS (smallBodies.positionAu)');
{
  // positionAu takes the table for a body it covers, the ellipse for the
  // rest; both are ecliptic J2000 au.
  const ceres = meta.named.find((n) => n.pdes === '1'), bennu = meta.named.find((n) => n.pdes === '101955');
  const jd = 2461041.5 + 3000;
  const s = sbHelioState(2000001, tdbFromTt((jd - 2451545) * DAY));
  check('Ceres from the table, rotated to the ecliptic', dist(positionAu(ceres, jd).map((x) => x * AU), eqjToEclKm(s.r)) < 1e-3);
  check('Bennu (not in SB441\'s list) on its ellipse', dist(positionAu(bennu, jd), keplerAu(bennu, jd)) === 0);
  let worst = 0;
  for (let y = 2000; y <= 2049; y += 0.25) {
    const jd2 = 2451545 + (y - 2000) * 365.25;
    worst = Math.max(worst, dist(keplerAu(ceres, jd2), positionAu(ceres, jd2)) * AU);
  }
  console.log(`  Ceres's 2026 ellipse against SB441, 2000 to 2050: up to ${(worst / 1e6).toFixed(1)} million km`);
  // The data plate (smallBodyFacts): for a covered body, the table's place
  // and its osculating ellipse now, so vis-viva gives the table's speed.
  const jd3 = 2451545 + 40 * 365.25, f = smallBodyFacts(ceres, jd3), fb = smallBodyFacts(bennu, jd3);
  const v = sbHelioState(2000001, tdbFromTt((jd3 - 2451545) * DAY)).v;
  console.log(`  the plate in 2040: Ceres a ${f.a.toFixed(4)} au (2026: ${ceres.a.toFixed(4)}), ${f.speedKms.toFixed(4)} km/s against the table's ${Math.hypot(...v).toFixed(4)}`);
  check('the plate takes Ceres\'s place and osculating ellipse from the table (speed to 1 m/s)', f.exact && Math.abs(f.speedKms - Math.hypot(...v)) < 1e-3 && dist(f.r, positionAu(ceres, jd3)) === 0);
  check('and Bennu\'s from its 2026 ellipse', !fb.exact && fb.a === bennu.a);
}

header('THE POINTS (src/scene/smallBodies.ts refreshes the covered bodies every 5 days)');
{
  // The scene finds each covered named body among the packed points by its
  // packed a, e and perihelion argument, and every five simulated days
  // packs its osculating elements from the table in their place. Here the
  // same, with keplerAu standing in for the shader.
  const bin = fs.readFileSync(new URL('../../public/data/smallbodies.bin', import.meta.url));
  const d = decodeSmallBodies(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const raw = new Uint16Array(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const TAU = 2 * Math.PI, u16 = (x) => Math.max(0, Math.min(65535, Math.round(x))), wrap = (x) => ((x % TAU) + TAU) % TAU;
  const covered = meta.named.filter((b) => exactOrbit(b.pdes, SB_EPOCH_JD));
  const found = covered.filter((b) => {
    const a = Math.fround(b.a), e = u16(b.e * 65535), w = u16(wrap(b.peri) / TAU * 65535);
    let hits = 0;
    for (let j = 0; j < d.count; j++) if (d.a[j] === a && raw[j * 8 + 2] === e && raw[j * 8 + 5] === w) hits++;
    return hits === 1;
  });
  check(`each of the ${covered.length} covered named bodies is one point, found by its packing`, found.length === covered.length);
  const q = (x) => Math.round(x * 65535) / 65535;
  let worst = 0, before = 0, worstOther = 0;
  for (const b of covered) {
    for (let y = 2000; y <= 2049.9; y += 0.5) {
      const jd = 2451545 + (y - 2000) * 365.25, el = exactOrbit(b.pdes, jd);
      // Packed as the scene packs it, then carried up to five days.
      const p = { a: Math.fround(el.a), e: q(el.e), i: q(el.i / TAU) * TAU, node: q(el.node / TAU) * TAU, peri: q(el.peri / TAU) * TAU, M: q(el.M / TAU) * TAU };
      // As seen from the Sun, as the packing test measures it (the rounding
      // of M is millions of km for Sedna, 500 au out on its orbit).
      const exact = positionAu(b, jd + 5), r = Math.hypot(...exact);
      worst = Math.max(worst, dist(keplerAu(p, jd + 5), exact) / r);
      if (b.pdes !== '90377') worstOther = Math.max(worstOther, dist(keplerAu(p, jd + 5), exact) / r);
      before = Math.max(before, dist(keplerAu(b, jd + 5), exact) / r);
    }
  }
  const arcmin = (x) => x * 180 / Math.PI * 60;
  console.log(`  2000 to 2050: refreshed points within ${arcmin(worst).toFixed(2)}' of the table as seen from the Sun, ${arcmin(worstOther).toFixed(2)}' but for Sedna (the 2026 ellipses: ${arcmin(before).toFixed(0)}')`);
  // Half a step of the packed M (2 pi / 65535) is 3.9' as seen from the Sun
  // at Sedna's perihelion (e = 0.85), 0.2' for a main-belt orbit.
  check('a refreshed point stays within the packing\'s own rounding of its body (4\'; 1\' but for Sedna)', arcmin(worst) < 4 && arcmin(worstOther) < 1);
}

header('OUTSIDE 2000-2050: two-body from the nearer end');
{
  let worstJoin = 0;
  for (const id of sbIds()) {
    const [t0, t1] = sbSpan(id);
    for (const [t, dir] of [[t0, -1], [t1, 1]]) {
      const a = sbHelioState(id, t), b = sbHelioState(id, t + dir * 60);
      // A minute past the end, against the end's own state carried a minute.
      worstJoin = Math.max(worstJoin, dist(b.r, a.r.map((x, d) => x + dir * 60 * a.v[d])));
      if (b.exact) failures++;
    }
  }
  console.log(`  a minute past either end, every body moves on from the end's state within ${(worstJoin * 1000).toFixed(2)} m`);
  check('the continuation starts where the table ends', worstJoin < 0.01);
  // The universal-variable propagator against the table over 30 days, and
  // back again.
  const a = sbHelioState(2000004, 8e8), k = kepler(a.r, a.v, 30 * DAY), back = kepler(k.r, k.v, -30 * DAY);
  check('two-body there and back returns to the start (1 mm)', dist(back.r, a.r) < 1e-6);
  const real = sbHelioState(2000004, 8e8 + 30 * DAY);
  console.log(`  Vesta 30 days on two-body, against SB441: ${dist(k.r, real.r).toFixed(0)} km (Jupiter's pull)`);
}

// ---------------- the kernel ----------------

header('IN THE KERNEL: cruise');
{
  // Two cruises, each with no asteroids, with them within reach of the
  // craft (bodies.ASTEROID_REACH, 1 AU: the default) and with all sixteen
  // everywhere: a craft leaving the Earth 3 km/s faster for 300 days, and
  // one on a circular orbit through the belt at 2.6 AU for a year.
  const epochMs = Date.UTC(2026, 10, 12);
  const run = (start, days, o) => {
    const sys = solarSystemBodies({ epochMs, ...o });
    const [r, v] = start(sys);
    const st = createState(r, v, 0);
    advance(st, days * DAY, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 });
    return st.r;
  };
  const fromEarth = (sys) => {
    const E = sys.bodyAt('earth', 0), rE = E.eph.position(0), vE = E.eph.velocity(0);
    return [[rE[0] + 3e6, rE[1], rE[2]], [vE[0], vE[1] + 3, vE[2]]];
  };
  const inBelt = (sys) => {
    const R = 2.6 * AU, v = Math.sqrt(sys.muSun / R);
    return [[R, 0, 0], [0, v * Math.cos(0.4), v * Math.sin(0.4)]];
  };
  for (const [name, start, days] of [['from the Earth, 300 days', fromEarth, 300], ['through the belt, a year', inBelt, 365]]) {
    const none = run(start, days, { asteroids: false }), near = run(start, days, {}), all = run(start, days, { asteroidReach: Infinity });
    const total = dist(all, none), dropped = dist(all, near);
    console.log(`  ${name}: the asteroids move the craft ${total.toFixed(3)} km; leaving out those beyond 1 AU changes that by ${dropped.toFixed(3)} km`);
    check(`${name}: their pull everywhere is under a few km`, total < 5);
    check(`${name}: what the reach leaves out is under 0.5 km`, dropped < 0.5);
  }
}

// A craft about asteroid key at date ms: relative state (km, km/s) in, the
// kernel's run over `days` out, sampled every hour, with and without the
// asteroids.
function about(key, ms, rel, vel, days, asteroids) {
  const sys = solarSystemBodies({ epochMs: ms, asteroids });
  const A = solarSystemBodies({ epochMs: ms, asteroids: [key] }).bodyAt(key, 0);
  const rA = A.eph.position(0), vA = A.eph.velocity(0);
  const st = createState([rA[0] + rel[0], rA[1] + rel[1], rA[2] + rel[2]], [vA[0] + vel[0], vA[1] + vel[1], vA[2] + vel[2]], 0);
  const path = [], events = [];
  for (let h = 1; h <= days * 24; h++) {
    const res = advance(st, h * 3600, { bodiesAt: sys.bodiesAt, muSun: sys.muSun, maxSteps: 1e7 });
    events.push(...res.events);
    path.push(dist(st.r, A.eph.position(st.t)));
  }
  return { path, events, primary: st.primary };
}

header('IN THE KERNEL: a Dawn-like orbit about Vesta (August 2011)');
{
  // Dawn's high-altitude mapping orbit: about 685 km up, 950 km from the
  // centre, a 12.3-hour period. Circular here, polar, for two days.
  const ms = Date.UTC(2011, 7, 1), R = 950, mu = PERTURBERS.find((a) => a.key === 'vesta').gm, v = Math.sqrt(mu / R);
  const T = 2 * Math.PI * Math.sqrt(R ** 3 / mu) / 3600;
  const on = about('vesta', ms, [R, 0, 0], [0, 0, v], 2, true), off = about('vesta', ms, [R, 0, 0], [0, 0, v], 2, false);
  const lo = Math.min(...on.path), hi = Math.max(...on.path);
  console.log(`  period ${T.toFixed(1)} h; with Vesta's GM the distance stays ${lo.toFixed(1)} to ${hi.toFixed(1)} km; primary ${on.primary}`);
  console.log(`  without the asteroids the craft drifts off: ${off.path.at(-1).toFixed(0)} km from Vesta after two days`);
  check('Vesta is the primary, and Encke follows the orbit within 2 km of 950 km', on.primary === 'vesta' && lo > R - 2 && hi < R + 2);
  check('without the asteroids there is no orbit (over 10,000 km away)', off.path.at(-1) > 1e4);
}

header('IN THE KERNEL: a Psyche-like approach (August 2029)');
{
  // From 15,000 km at 50 m/s, aimed 1,000 km off the centre. Psyche's pull
  // bends the path to a pericentre the two-body hyperbola about it
  // predicts; without it the craft passes at 1,000 km.
  const ms = Date.UTC(2029, 7, 1), mu = PERTURBERS.find((a) => a.key === 'psyche').gm;
  const rel = [-15000, 1000, 0], vel = [0.05, 0, 0];
  const on = about('psyche', ms, rel, vel, 6, true), off = about('psyche', ms, rel, vel, 6, false);
  // The two-body pericentre from the starting state.
  const r = Math.hypot(...rel), v2 = 0.05 ** 2, h = Math.abs(rel[0] * vel[1] - rel[1] * vel[0]);
  const energy = v2 / 2 - mu / r, e = Math.sqrt(1 + 2 * energy * h * h / (mu * mu)), rp = h * h / mu / (1 + e);
  const pOn = Math.min(...on.path), pOff = Math.min(...off.path);
  console.log(`  two-body pericentre ${rp.toFixed(1)} km; the kernel's with the asteroids ${pOn.toFixed(1)} km (hourly samples), without ${pOff.toFixed(1)} km`);
  console.log(`  primary: ${on.primary} (inside its sphere of influence, 19,000 km, from the start)`);
  check('with Psyche the pericentre is the hyperbola\'s (within 15 km)', on.primary === 'psyche' && Math.abs(pOn - rp) < 15);
  check('without it the craft passes 400 km further out', pOff - pOn > 400);
}

console.log('='.repeat(60));
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
