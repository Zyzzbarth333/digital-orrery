// src/physics/porkchop.js
//
// Porkchop (launch-window) grid driven by the verified Lambert solver in
// orbital.js. Pure ES module: the ephemeris is passed in as a function, so the
// grid runs the same in the browser and under Node tests.
//
// Units: km, km/s, s, km^3/s^2. Dates are JS Date objects (UTC).
//
// For each (departure date, time of flight) cell it solves the zero-rev
// prograde Lambert arc between the two planets' heliocentric positions and
// reports:
//   c3       departure characteristic energy |v_inf,dep|^2  (km^2/s^2)
//   vinfArr  arrival hyperbolic excess speed                (km/s)
//   dvDep    burn from a circular parking orbit to v_inf,dep (km/s)
//   dvArr    capture burn into a circular orbit at arrival   (km/s), or 0
//            when arrival.capture is false (flyby)
//   dvTotal  dvDep + dvArr
//   type     1 (transfer angle < 180 deg) or 2 (> 180 deg)
// A cell with no trustworthy Lambert solution (e.g. a transfer angle of
// exactly 180 deg) holds NaN.

import { lambert } from './orbital.js';

const DAY = 86400.0;

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function norm(a) { return Math.hypot(a[0], a[1], a[2]); }

// Burn from a circular orbit of radius r about a body with parameter mu onto a
// hyperbola with excess speed vinf (the Oberth-assisted departure/capture).
export function hyperbolicBurn(vinf, mu, r) {
  return Math.sqrt(vinf * vinf + 2.0 * mu / r) - Math.sqrt(mu / r);
}

// Solve one transfer. dep/arr states are { r: [km], v: [km/s] } heliocentric,
// in an ecliptic frame (so "prograde" means +z angular momentum).
export function transferBetween(depState, arrState, tofSec, muSun, departure, arrival) {
  const sol = lambert(depState.r, arrState.r, tofSec, muSun, true);
  if (!sol) return null;
  const vinfDepVec = sub(sol.v1, depState.v);
  const vinfArrVec = sub(sol.v2, arrState.v);
  const vinfDep = norm(vinfDepVec);
  const vinfArr = norm(vinfArrVec);
  const dvDep = hyperbolicBurn(vinfDep, departure.mu, departure.rPark);
  const dvArr = arrival.capture === false ? 0.0 : hyperbolicBurn(vinfArr, arrival.mu, arrival.rPark);
  const r1 = depState.r, r2 = arrState.r;
  const crossZ = r1[0] * r2[1] - r1[1] * r2[0];
  return {
    v1: sol.v1, v2: sol.v2, vinfDepVec, vinfArrVec,
    c3: vinfDep * vinfDep, vinfDep, vinfArr, dvDep, dvArr, dvTotal: dvDep + dvArr,
    type: crossZ >= 0.0 ? 1 : 2,
  };
}

// Build the grid.
//   opts.stateOf(bodyKey, date) -> { r, v }   ephemeris (km, km/s, ecliptic)
//   opts.departure  { key, mu, rPark }       mu km^3/s^2, rPark km
//   opts.arrival    { key, mu, rPark, capture }
//   opts.muSun
//   opts.depStart   Date of the first departure column
//   opts.depDays    array of departure offsets in days from depStart
//   opts.tofDays    array of times of flight in days
// Returns typed arrays indexed [iTof * nDep + iDep] plus the minimum cell.
export function porkchopGrid(opts) {
  const { stateOf, departure, arrival, muSun, depStart, depDays, tofDays } = opts;
  const nDep = depDays.length, nTof = tofDays.length, n = nDep * nTof;
  const c3 = new Float64Array(n).fill(NaN);
  const vinfArr = new Float64Array(n).fill(NaN);
  const dvDep = new Float64Array(n).fill(NaN);
  const dvArr = new Float64Array(n).fill(NaN);
  const dvTotal = new Float64Array(n).fill(NaN);
  const type = new Uint8Array(n);

  // Planet states are cached per (body, offset in days): arrival dates repeat
  // across the grid whenever the steps share a common day spacing.
  const t0 = depStart.getTime();
  const cache = new Map();
  const state = (key, offsetDays) => {
    const k = key + '|' + offsetDays.toFixed(6);
    let s = cache.get(k);
    if (!s) { s = stateOf(key, new Date(t0 + offsetDays * DAY * 1000.0)); cache.set(k, s); }
    return s;
  };

  let best = null;
  let bestC3 = null;
  for (let j = 0; j < nTof; j++) {
    for (let i = 0; i < nDep; i++) {
      const dep = state(departure.key, depDays[i]);
      const arr = state(arrival.key, depDays[i] + tofDays[j]);
      const t = transferBetween(dep, arr, tofDays[j] * DAY, muSun, departure, arrival);
      if (!t) continue;
      const idx = j * nDep + i;
      c3[idx] = t.c3; vinfArr[idx] = t.vinfArr;
      dvDep[idx] = t.dvDep; dvArr[idx] = t.dvArr; dvTotal[idx] = t.dvTotal;
      type[idx] = t.type;
      if (!best || t.dvTotal < dvTotal[best.idx]) best = { idx, iDep: i, iTof: j };
      if (!bestC3 || t.c3 < c3[bestC3.idx]) bestC3 = { idx, iDep: i, iTof: j };
    }
  }

  const describe = (b) => b && ({
    ...b,
    departure: new Date(t0 + depDays[b.iDep] * DAY * 1000.0),
    arrival: new Date(t0 + (depDays[b.iDep] + tofDays[b.iTof]) * DAY * 1000.0),
    tofDays: tofDays[b.iTof],
    c3: c3[b.idx], vinfArr: vinfArr[b.idx], dvDep: dvDep[b.idx],
    dvArr: dvArr[b.idx], dvTotal: dvTotal[b.idx], type: type[b.idx],
  });

  return {
    nDep, nTof, depStart, depDays, tofDays,
    c3, vinfArr, dvDep, dvArr, dvTotal, type,
    minTotal: describe(best),
    minC3: describe(bestC3),
  };
}

// Evenly spaced inclusive range helper.
export function range(start, stop, step) {
  const out = [];
  const n = Math.floor((stop - start) / step + 1e-9);
  for (let k = 0; k <= n; k++) out.push(start + k * step);
  return out;
}

// Hohmann departure excess speed from a circular orbit r1 to r2 about a
// body of parameter mu, signed: positive along the departure body's motion
// (outward, r2 > r1), negative against it (inward, r2 < r1).
export function hohmannVinf(r1, r2, mu) {
  return Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
}
