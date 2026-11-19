// src/physics/sgp4.js
//
// The two parts of satellite.js (MIT, pinned at 7.1.0 in package.json) that
// satellites.js uses: the OMM reader and SGP4/SDP4 itself.
//
// Imported by the package's name, so it resolves from any checkout (a git
// worktree has no node_modules of its own; Node and Vite find the
// repository's by walking up). The package's index also exports a
// WebAssembly build whose top-level await the workers' bundle can't hold,
// and which the app has no use for: in Node (the tests) that costs nothing,
// and in the app's bundles vite.config.js's satelliteLite plugin serves this
// specifier as just the two files these come from (dist/io.js and
// dist/propagation/sgp4.js, as in 7.1.0: check them when the version
// changes).

//
// sgp4 is wrapped to keep a deep-space orbit's resonance integrator where
// it got to. For a 12- or 24-hour orbit (GPS, Molniya, the geostationary
// belt) SDP4 integrates the resonance terms in 720-minute steps from the
// element set's epoch. Vallado's code keeps the integrator's time and
// state (atime, xli, xni) on the record, so the next call carries on from
// there; satellite.js 7.1.0's sgp4 drops them (dist/propagation/sgp4.js
// keeps only em, argpm, inclm, mm, nodem and nm from dspace), so every
// call integrated from the epoch again. Its cost grew with the clock's
// distance from the epoch: three years on, 2,200 steps per satellite per
// call, and the satellite layer places its named ones every frame on the
// main thread (docs/performance.md#a-long-run). resonance() below runs the
// same steps as dspace and stores where they stop, so dspace takes up from
// there with nothing left to step: the same arithmetic, the same answers
// (satellites.test.mjs compares them with the unwrapped sgp4).

import { json2satrec, sgp4 as sgp4Raw } from 'satellite.js';

export { json2satrec };

export function sgp4(rec, tsince) {
  if (rec.method === 'd' && rec.irez !== 0) resonance(rec, tsince);
  return sgp4Raw(rec, tsince);
}

// dspace's resonance integration (satellite.js dist/propagation/dspace.js,
// after Vallado et al. 2006), up to the last whole step before t (minutes
// from the epoch), from where the record's last call left it, or from the
// epoch where dspace would restart.
const STEP = 720.0, STEP2 = 259200.0;
const FASX2 = 0.13130908, FASX4 = 2.8843198, FASX6 = 0.37448087;
const G22 = 5.7686396, G32 = 0.95240898, G44 = 1.8014998, G52 = 1.050833, G54 = 4.4108898;
function resonance(r, t) {
  let { atime, xli, xni } = r;
  if (atime === 0.0 || t * atime <= 0.0 || Math.abs(t) < Math.abs(atime)) {
    atime = 0.0;
    xni = r.no;
    xli = r.xlamo;
  }
  const delt = t > 0.0 ? STEP : -STEP;
  while (Math.abs(t - atime) >= STEP) {
    let xndt, xnddt;
    const xldot = xni + r.xfact;
    if (r.irez !== 2) {
      xndt = r.del1 * Math.sin(xli - FASX2) + r.del2 * Math.sin(2.0 * (xli - FASX4)) + r.del3 * Math.sin(3.0 * (xli - FASX6));
      xnddt = r.del1 * Math.cos(xli - FASX2) + 2.0 * r.del2 * Math.cos(2.0 * (xli - FASX4)) + 3.0 * r.del3 * Math.cos(3.0 * (xli - FASX6));
    } else {
      const xomi = r.argpo + r.argpdot * atime, x2omi = xomi + xomi, x2li = xli + xli;
      xndt = r.d2201 * Math.sin(x2omi + xli - G22) + r.d2211 * Math.sin(xli - G22) + r.d3210 * Math.sin(xomi + xli - G32)
        + r.d3222 * Math.sin(-xomi + xli - G32) + r.d4410 * Math.sin(x2omi + x2li - G44) + r.d4422 * Math.sin(x2li - G44)
        + r.d5220 * Math.sin(xomi + xli - G52) + r.d5232 * Math.sin(-xomi + xli - G52) + r.d5421 * Math.sin(xomi + x2li - G54)
        + r.d5433 * Math.sin(-xomi + x2li - G54);
      xnddt = r.d2201 * Math.cos(x2omi + xli - G22) + r.d2211 * Math.cos(xli - G22) + r.d3210 * Math.cos(xomi + xli - G32)
        + r.d3222 * Math.cos(-xomi + xli - G32) + r.d5220 * Math.cos(xomi + xli - G52) + r.d5232 * Math.cos(-xomi + xli - G52)
        + 2.0 * (r.d4410 * Math.cos(x2omi + x2li - G44) + r.d4422 * Math.cos(x2li - G44) + r.d5421 * Math.cos(xomi + x2li - G54)
        + r.d5433 * Math.cos(-xomi + x2li - G54));
    }
    xnddt *= xldot;
    xli += xldot * delt + xndt * STEP2;
    xni += xndt * delt + xnddt * STEP2;
    atime += delt;
  }
  r.atime = atime;
  r.xli = xli;
  r.xni = xni;
}
