// src/physics/eop.js
//
// The Earth's orientation parameters by date, from NAIF's Earth PCKs: the
// daily UT1 - UTC, polar motion (xp, yp) and IERS corrections to the 1980
// nutation (ddpsi, ddeps) that make earthRotation.js's IAU 1976/1980 model
// reproduce NAIF's ITRF93, as eop.build.mjs fits them
// (public/ephemeris/earth-orientation-2000-2126.bin, 336 KB;
// docs/physics/orientation.md#earth).
//
//   eopAt(ms) -> { dut1, xp, yp, ddpsi, ddeps } | null   s, arcsec
//
// null outside the table (before 2000, after Nov 2126) or before it is
// installed: earthRotation.js then treats UTC as UT1 and leaves out polar
// motion, as the app did before (180 m at the surface).
//
// The table has two segments, one per kernel. The first, from 2000 to
// Feb 2027, is measured to the high-precision file's last datum and JPL's
// prediction for three months after; the second, to Nov 2126, is NAIF's
// long-term file, which holds polar motion and the nutation corrections
// and keeps UT1 at the rate of TAI apart from the zonal tides, so it stores
// UT1 - UTC alone. It is joined onto the first (eop.build.mjs), so where
// NAIF's ITRF93 jumps 85 m in Feb 2027 the table does not. Between days,
// four-point Lagrange interpolation (as the IERS's interp.f does for its
// daily values) within a segment, of UT1 - TAI so that a leap second does
// not jump.
//
// Installed once per thread, like the DE442 table: deLoad.js in the
// browser, deNode.js under Node.
//
// File: little-endian. Float64 [format = 1, nseg], then per segment
// [first MJD (UTC 0h), days, fields (5, or 1 when the pole is held), xp,
// yp, ddpsi, ddeps (the held values)], then per segment Float32 arrays,
// one per field: dut1 (s), then xp, yp, ddpsi, ddeps (arcsec).

import { ttMinusUtc } from './timescale.js';

export const EOP_FORMAT = 1;
const MJD_UNIX = 40587;
const FIELDS = ['dut1', 'xp', 'yp', 'ddpsi', 'ddeps'];
let segments = null;

export function parseEop(buffer) {
  const h = new Float64Array(buffer, 0, 2);
  if (h[0] !== EOP_FORMAT) throw new Error(`eop: unknown format ${h[0]}`);
  const nseg = h[1], head = new Float64Array(buffer, 0, 2 + 7 * nseg);
  let off = head.byteLength;
  const segs = [];
  for (let k = 0; k < nseg; k++) {
    const [mjd0, n, nf, ...held] = head.subarray(2 + 7 * k, 9 + 7 * k);
    const s = { mjd0, n, held: nf === 1 ? held : null, leap: new Float64Array(n) };
    for (let j = 0; j < nf; j++, off += 4 * n) s[FIELDS[j]] = new Float32Array(buffer, off, n);
    // TAI - UTC at each day's 0h, to interpolate UT1 - TAI.
    for (let i = 0; i < n; i++) s.leap[i] = ttMinusUtc((mjd0 + i - MJD_UNIX) * 86400e3) - 32.184;
    segs.push(s);
  }
  if (off !== buffer.byteLength) throw new Error('eop: size does not match its header');
  return segs;
}

export function installEop(parsed) { segments = parsed; }
export function eopInstalled() { return segments !== null; }

// The span covered, as UTC ms.
export function eopSpan() {
  if (!segments) return null;
  const last = segments[segments.length - 1];
  return [(segments[0].mjd0 - MJD_UNIX) * 86400e3, (last.mjd0 + last.n - 1 - MJD_UNIX) * 86400e3];
}

export function eopAt(ms) {
  if (!segments) return null;
  const mjd = ms / 86400e3 + MJD_UNIX;
  const s = segments.find((g) => mjd >= g.mjd0 && mjd <= g.mjd0 + g.n - 1);
  if (!s) return null;
  const x = mjd - s.mjd0;
  // The four nodes around x, shifted inside the segment at its ends.
  const i0 = Math.max(0, Math.min(s.n - 4, Math.floor(x) - 1));
  const w = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) {
    let l = 1;
    for (let k = 0; k < 4; k++) if (k !== j) l *= (x - (i0 + k)) / (j - k);
    w[j] = l;
  }
  const at = (a, f = (i) => a[i]) => w[0] * f(i0) + w[1] * f(i0 + 1) + w[2] * f(i0 + 2) + w[3] * f(i0 + 3);
  const dut1 = at(s.dut1, (i) => s.dut1[i] - s.leap[i]) + (ttMinusUtc(ms) - 32.184);
  if (s.held) return { dut1, xp: s.held[0], yp: s.held[1], ddpsi: s.held[2], ddeps: s.held[3] };
  return { dut1, xp: at(s.xp), yp: at(s.yp), ddpsi: at(s.ddpsi), ddeps: at(s.ddeps) };
}
