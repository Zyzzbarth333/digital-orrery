// validation/golden.api.mjs
//
// The physics' public answers for fixed inputs, for the golden snapshot
// (golden.mjs, ADR-0001 phase C). Nothing in the physics draws random
// numbers, so fixed inputs are a fixed seed. Every value is kept whole
// (canon), so a comparison can be bit for bit.
//
// It installs no data: the caller does first (deNode.js under Node; the
// browser's fetch loader elsewhere), so the same module can run in a
// browser engine. The inputs live here, not in src/physics/fixtures, so the
// snapshot does not depend on files that move.
//
//   ephemeris   the planets, the Moon and Pluto from the Sun, and the
//               barycentres, inside DE442, in its blends and outside it;
//               time scales; the Earth's orientation
//   moons       satellites from their tables, in and out of the inner
//               moons' core years, and from the mean elements
//   asteroids   SB441's first bodies
//   kernel      kernelHost.js stepping a low Earth orbit, a cruise and a
//               finite burn (no time budget, so no wall clock)
//   journey     solveJourney and journeyPath for Earth to Mars and the
//               Moon and back, and the kernel's flight of each
//   satellites  SGP4 and SDP4 (Vallado et al. 2006's verification TLEs)
//               in TEME and J2000

import { helioStateEqj, helioStateEqjAtTt, ttSeconds, utcMsAtTt, deltaT } from '../src/physics/ephemeris.js';
import { baryStateEqj, BARY_KEYS } from '../src/physics/barycentres.js';
import { eopAt } from '../src/physics/eop.js';
import { earthFixedMatrix } from '../src/physics/earthRotation.js';
import { moonStateEqjAtTt } from '../src/physics/moons.js';
import { irregularStateEqjAtTt, irregularSource, IRREGULARS_OF } from '../src/physics/irregularMoons.js';
import { sbIds, sbHelioState } from '../src/physics/sbTable.js';
import { createKernelHost, KERNEL_EPOCH_MS } from '../src/physics/kernelHost.js';
import { solarSystemBodies } from '../src/physics/bodies.js';
import * as J from '../src/physics/journey.js';
import { planFlight, flyJourney } from '../src/physics/journeyFlight.js';
import { ommFromTle, satrecOf, stateTeme, stateEqj } from '../src/physics/satellites.js';

// Every number kept exactly: JSON's shortest form reads back to the same
// double, and -0, NaN and the infinities, which JSON has not, become
// strings. Typed arrays and Maps become arrays and objects; functions go.
export function canon(x) {
  if (typeof x === 'number') {
    if (Object.is(x, -0)) return '-0';
    return Number.isFinite(x) ? x : String(x);
  }
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x;
  if (ArrayBuffer.isView(x)) return Array.from(/** @type {any} */ (x), canon);
  if (Array.isArray(x)) return x.map(canon);
  if (x instanceof Map) return Object.fromEntries([...x].map(([k, v]) => [String(k), canon(v)]));
  if (x instanceof Date) return x.toISOString();
  const out = {};
  for (const k of Object.keys(x).sort()) {
    const v = canon(x[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const D = (s) => Date.parse(s);
// Inside DE442 (2000-2050), at its ends, in the blends and outside.
const DATES = ['1973-11-03T17:45:00Z', '1999-12-01T00:00:00Z', '2000-01-01T12:00:00Z', '2012-08-06T05:17:57Z', '2026-11-19T00:00:00Z', '2050-12-31T23:00:00Z', '2052-06-01T00:00:00Z', '2075-01-01T00:00:00Z'];
const PLANETS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

function ephemeris() {
  const out = { helio: {}, helioAtTt: {}, bary: {}, time: {}, eop: {}, earthFixed: {} };
  for (const iso of DATES) {
    const date = new Date(D(iso)), tt = ttSeconds(D(iso));
    out.helio[iso] = Object.fromEntries(PLANETS.map((k) => [k, helioStateEqj(k, date)]));
    out.helioAtTt[iso] = Object.fromEntries(PLANETS.map((k) => [k, helioStateEqjAtTt(k, tt + 0.25)]));
    out.bary[iso] = Object.fromEntries(BARY_KEYS.map((k) => [k, baryStateEqj(k, date)]));
    out.time[iso] = { tt, back: utcMsAtTt(tt), deltaT: deltaT(D(iso) / 86400e3) };
    out.eop[iso] = eopAt(D(iso));
    out.earthFixed[iso] = earthFixedMatrix(D(iso));
  }
  return out;
}

// Galilean, Saturnian, Martian and Neptunian moons from the main tables;
// Mimas and Miranda (inner) in and out of 2020-2035; and the two innermost
// irregular moons of Jupiter, Saturn and Neptune (irregularMoons.js).
const MOONS = ['io', 'europa', 'ganymede', 'callisto', 'phobos', 'deimos', 'titan', 'enceladus', 'mimas', 'iapetus', 'phoebe', 'miranda', 'triton', 'nereid'];
const MOON_DATES = ['2003-01-01T00:00:00Z', '2026-11-19T00:00:00Z', '2041-07-04T00:00:00Z', '2060-01-01T00:00:00Z'];
function moons() {
  const out = {};
  for (const iso of MOON_DATES) {
    const tt = ttSeconds(D(iso));
    const irregular = ['jupiter', 'saturn', 'neptune'].flatMap((p) => IRREGULARS_OF[p].slice(0, 2));
    out[iso] = {
      ...Object.fromEntries(MOONS.map((k) => [k, moonStateEqjAtTt(k, tt)])),
      irregular: Object.fromEntries(irregular.map((k) => [k, { source: irregularSource(k, tt), state: irregularStateEqjAtTt(k, tt) }])),
    };
  }
  return out;
}

function asteroids() {
  const ids = sbIds().slice(0, 8), out = { ids };
  for (const iso of ['2001-05-01T00:00:00Z', '2026-11-19T00:00:00Z', '2049-02-01T00:00:00Z']) {
    const et = ttSeconds(D(iso));
    out[iso] = Object.fromEntries(ids.map((id) => [id, sbHelioState(id, et)]));
  }
  return out;
}

// Seconds from KERNEL_EPOCH_MS, as the kernel counts (kernelHost.js).
const kernelT = (ms) => ttSeconds(ms) - ttSeconds(KERNEL_EPOCH_MS);
function kernel() {
  const ms = D('2026-11-19T00:00:00Z'), t = kernelT(ms), E = helioStateEqj('earth', new Date(ms));
  const add = (a, b) => a.map((x, i) => x + b[i]);
  // 400 km up, a little faster than circular (7.67 km/s), inclined 35 deg.
  const leo = { r: add(E.r, [6778, 0, 0]), v: add(E.v, [0, 6.3, 4.4]) };
  const crafts = [
    { id: 1, version: 1, ...leo, t, tEnd: t + 3 * 3600, primary: 'earth', thrust: null },
    { id: 2, version: 1, r: add(E.r, [2.0e6, -1.0e6, 3.0e5]), v: add(E.v, [0.6, 1.1, -0.2]), t, tEnd: t + 20 * 86400, primary: null, thrust: null },
    { id: 3, version: 1, ...leo, t, tEnd: t + 2 * 3600, primary: 'earth', thrust: null,
      burns: [{ t0: t + 600, t1: t + 1500, dir: [1, 0, 0], F: 20000, m0: 9000, mdot: 6, frame: 'vnb', about: 'earth' }] },
  ];
  const host = createKernelHost(), reply = host.handle({ type: 'step', crafts: structuredClone(crafts) });
  // A second request carries the cruise on from where the first stopped.
  const on = reply.crafts[1], again = host.handle({ type: 'step', crafts: [{ ...crafts[1], r: on.r, v: on.v, t: on.t, tEnd: on.t + 5 * 86400 }] });
  const drop = ({ ms: _wall, ...rest }) => rest;   // the reply's wall time
  return { crafts, reply: drop(reply), again: drop(again) };
}

const JOURNEYS = {
  earthMars: { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z') }] },
  moonTrip: { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-12-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'moon', kind: 'orbit', altKm: 100, stayDays: 3, dateMs: D('2026-12-05T00:00:00Z') },
    { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D('2026-12-12T00:00:00Z') }] },
};
function journey() {
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), out = {};
  for (const [name, j] of Object.entries(JOURNEYS)) {
    const sol = J.solveJourney(j), flight = flyJourney(sys, planFlight(sol));
    out[name] = {
      sol, ledger: J.ledgerLines(sol), path: J.journeyPath(sol, 24),
      // The flight, with every 8th sample of its path.
      flight: { ...flight, path: flight.path.filter((_, i) => i % 8 === 0) },
    };
  }
  return out;
}

// Near-Earth (00005, 06251, 28057) and deep-space (09880, 22312, 28626)
// from Vallado et al.'s SGP4-VER.TLE (fixtures/sgp4_verification.json).
const TLES = [
  ['1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753', '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667'],
  ['1 06251U 62025E   06176.82412014  .00008885  00000-0  12808-3 0  3985', '2 06251  58.0579  54.0425 0030035 139.1568 221.1854 15.56387291  6774'],
  ['1 28057U 03049A   06177.78615833  .00000060  00000-0  35940-4 0  1836', '2 28057  98.4283 247.6961 0000884  88.1964 271.9322 14.35478080140550'],
  ['1 09880U 77021A   06176.56157475  .00000421  00000-0  10000-3 0  9814', '2 09880  64.5968 349.3786 7069051 270.0229  16.3320  2.00813614112380'],
  ['1 22312U 93002D   06094.46235912  .99999999  81888-5  49949-3 0  3953', '2 22312  62.1486  77.4698 0308723 267.9229  88.7392 15.95744531 98783'],
  ['1 28626U 05008A   06176.46683397 -.00000205  00000-0  10000-3 0  2190', '2 28626   0.0019 286.9433 0000335  13.7918  55.6504  1.00270176  4891'],
];
function satellites() {
  const out = {};
  for (const [l1, l2] of TLES) {
    const sat = satrecOf(ommFromTle(l1, l2)), id = l1.slice(2, 7);
    out[id] = { omm: sat.omm, epochMs: sat.epochMs, at: {} };
    for (const min of [0, 360, 720, 1440, 4320]) {
      const ms = sat.epochMs + min * 60000;
      out[id].at[min] = { teme: stateTeme(sat, ms), eqj: stateEqj(sat, ms) };
    }
  }
  return out;
}

export const SECTIONS = { ephemeris, moons, asteroids, kernel, journey, satellites };

/** Every section, canonical. @param {string[]} [only] */
export function apiSnapshot(only = Object.keys(SECTIONS)) {
  return Object.fromEntries(only.map((k) => [k, canon(SECTIONS[k]())]));
}
