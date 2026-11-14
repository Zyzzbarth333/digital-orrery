// src/physics/eop.build.mjs
//
// Builds the Earth orientation table (eop.js) from NAIF's ITRF93, as
// c/earth_orientation.c samples it: for each day, the UT1 - UTC, polar
// motion and nutation corrections that make earthRotation.js's IAU
// 1976/1980 model (the model NAIF builds ITRF93 with) match it, by least
// squares over seven instants an hour apart around 0h UTC. Polar motion
// turns with the crust and the nutation correction with the sky, so a
// window of a quarter turn tells them apart.
//
// NAIF's ITRF93 jumps where the long-term file takes over (Feb 2027, see
// below); the table joins it onto the newer data instead.
//
//   node src/physics/eop.build.mjs <samples.bin> [out.bin]
//
// Prints the fit's worst residual per segment; the default output is
// public/ephemeris/earth-orientation-2000-2126.bin.

import fs from 'node:fs';
import { earthFixedMatrix } from './earthRotation.js';
import { utcMsAtTt, ttSeconds } from './ephemeris.js';
import { ttMinusUtc } from './timescale.js';
import { EOP_FORMAT } from './eop.js';

const [inPath, outPath = new URL('../../public/ephemeris/earth-orientation-2000-2126.bin', import.meta.url)] = process.argv.slice(2);
if (!inPath) { console.error('usage: node src/physics/eop.build.mjs <samples.bin> [out.bin]'); process.exit(1); }

const raw = fs.readFileSync(inPath);
const f = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8);
if (f[0] !== 1) throw new Error(`unknown sample format ${f[0]}`);
const nseg = f[1], nsamp = f[2];
const segs = [];
for (let k = 0; k < nseg; k++) segs.push({ mjd0: f[3 + 2 * k], n: f[4 + 2 * k] });
let off = 3 + 2 * nseg;

const MJD_UNIX = 40587;
const leapAt = (ms) => ttMinusUtc(ms) - 32.184;           // TAI - UTC

// The small rotation taking the model's Earth-fixed axes to SPICE's, as a
// vector in the Earth-fixed frame (rad).
function residual(Mref, M) {
  const E = (i, j) => Mref[3 * i] * M[j][0] + Mref[3 * i + 1] * M[j][1] + Mref[3 * i + 2] * M[j][2];
  return [0.5 * (E(1, 2) - E(2, 1)), 0.5 * (E(2, 0) - E(0, 2)), 0.5 * (E(0, 1) - E(1, 0))];
}

// p: [UT1 - TAI at 0h (s), its rate (s/day), xp, yp, ddpsi, ddeps (arcsec)].
function model(p, s, tt0) {
  const leap = leapAt(s.ms);
  const dut1 = p[0] + p[1] * (s.tt - tt0) / 86400 + leap;
  return earthFixedMatrix(s.ms, { leapSeconds: leap, dut1, xp: p[2], yp: p[3], ddpsi: p[4], ddeps: p[5] }).M;
}

// Solves the normal equations (6 x 6) by Gaussian elimination.
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let j = r + 1; j < n; j++) s -= M[r][j] * x[j];
    x[r] = s / M[r][r];
  }
  return x;
}

const STEP = [1e-4, 1e-5, 1e-4, 1e-4, 1e-4, 1e-4];   // finite-difference steps
const RAD_TO_M = 6378137;                               // rad -> metres at the equator
const out = [];
let p = [-32 + 0.35, 0, 0, 0, 0, 0];

for (const seg of segs) {
  const rec = { mjd0: seg.mjd0, n: seg.n, dut1: new Float64Array(seg.n), xp: new Float64Array(seg.n), yp: new Float64Array(seg.n), ddpsi: new Float64Array(seg.n), ddeps: new Float64Array(seg.n) };
  let worst = 0;
  for (let d = 0; d < seg.n; d++) {
    const ms0 = (seg.mjd0 + d - MJD_UNIX) * 86400e3, tt0 = ttSeconds(ms0);
    const samples = [];
    for (let k = 0; k < nsamp; k++, off += 10) {
      const tt = f[off];
      samples.push({ tt, ms: utcMsAtTt(tt), M: f.subarray(off + 1, off + 10) });
    }
    let res = 0;
    for (let it = 0; it < 6; it++) {
      const r0 = samples.map((s) => residual(s.M, model(p, s, tt0)));
      const J = samples.map((s, k) => p.map((_, j) => {
        const q = [...p]; q[j] += STEP[j];
        const r = residual(s.M, model(q, s, tt0));
        return [0, 1, 2].map((i) => (r[i] - r0[k][i]) / STEP[j]);
      }));
      const A = p.map(() => new Array(6).fill(0)), b = new Array(6).fill(0);
      samples.forEach((_, k) => { for (let i = 0; i < 3; i++) for (let a = 0; a < 6; a++) {
        b[a] -= J[k][a][i] * r0[k][i];
        for (let c = 0; c < 6; c++) A[a][c] += J[k][a][i] * J[k][c][i];
      } });
      const dx = solve(A, b);
      p = p.map((v, j) => v + dx[j]);
      if (Math.abs(dx[0]) < 1e-6 && Math.max(...dx.slice(2).map(Math.abs)) < 1e-5) {   // 1 us, 10 uas: 0.5, 0.3 mm
        res = Math.max(...samples.map((s) => Math.hypot(...residual(s.M, model(p, s, tt0)))));
        break;
      }
      if (it === 5) throw new Error(`day MJD ${seg.mjd0 + d}: the fit did not converge`);
    }
    worst = Math.max(worst, res);
    rec.dut1[d] = p[0] + leapAt(ms0);
    rec.xp[d] = p[2]; rec.yp[d] = p[3]; rec.ddpsi[d] = p[4]; rec.ddeps[d] = p[5];
  }
  console.log(`segment MJD ${seg.mjd0}-${seg.mjd0 + seg.n - 1}: ${seg.n} days, worst fit residual ${(worst * RAD_TO_M * 1000).toFixed(3)} mm`);
  out.push(rec);
}

// A segment whose pole stays put (NAIF's long-term file holds polar motion
// and the nutation corrections) keeps those as constants, UT1 - UTC daily.
// It is joined onto the segment before it: NAIF built its long-term file
// from an older EOP file (Aug 2026), whose held values are by Feb 2027 far
// from the high-precision file's (177 ms of UT1, 80 m at the equator, in
// the Nov 2026 kernels). So the held pole takes the newer file's last
// values and UT1 - UTC moves by the difference at the junction, keeping
// the long-term file's shape (UT1 at the rate of TAI, with the zonal tides):
// NAIF's own extension, made from the newest data.
const POLE = ['xp', 'yp', 'ddpsi', 'ddeps'];
const spread = (a) => Math.max(...a) - Math.min(...a);
const header = [EOP_FORMAT, out.length];
const blocks = [];
out.forEach((r, k) => {
  const held = POLE.every((f) => spread(r[f]) < 1e-6);      // arcsec
  let pole = POLE.map((f) => r[f].reduce((a, b) => a + b) / r.n);
  if (held && k > 0) {
    const prev = out[k - 1], last = prev.n - 1, gap = r.mjd0 - (prev.mjd0 + last);
    if (gap !== 0) throw new Error(`segment ${k} does not start where segment ${k - 1} ends`);
    const du = prev.dut1[last] - r.dut1[0];
    const was = pole;
    pole = POLE.map((f) => prev[f][last]);
    for (let i = 0; i < r.n; i++) r.dut1[i] += du;
    console.log(`  joined at MJD ${r.mjd0}: UT1 - UTC moved ${(du * 1000).toFixed(1)} ms, `
      + POLE.map((f, j) => `${f} ${((pole[j] - was[j]) * 1000).toFixed(1)}`).join(', ') + ' mas');
  }
  header.push(r.mjd0, r.n, held ? 1 : 5, ...(held ? pole : [0, 0, 0, 0]));
  blocks.push(Float32Array.from(r.dut1));
  if (!held) for (const f of POLE) blocks.push(Float32Array.from(r[f]));
  console.log(`  segment ${k}: ${held ? 'pole held' : 'pole daily'}, UT1 - UTC ${r.dut1[0].toFixed(4)} .. ${r.dut1[r.n - 1].toFixed(4)} s`);
});
const head = Float64Array.from(header);
const buf = Buffer.concat([Buffer.from(head.buffer), ...blocks.map((b) => Buffer.from(b.buffer))]);
fs.writeFileSync(outPath, buf);
console.log(`wrote ${outPath instanceof URL ? outPath.pathname : outPath} (${(buf.length / 1024).toFixed(0)} KB)`);
