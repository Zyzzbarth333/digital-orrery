// src/physics/smallbodies.test.mjs
//
// The small bodies the app draws (smallBodies.js, src/scene/smallBodies.ts):
// the drawn two-body orbits against JPL Horizons, what the 16-byte packing
// costs, and the vertex shader's Kepler solve (a fixed 12 Newton steps in
// float32) against the exact one, for every body.
//
//   node src/physics/smallbodies.test.mjs

import fs from 'node:fs';
import { decodeSmallBodies, positionAu, SB_EPOCH_JD, SB_CLASSES } from './smallBodies.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const AU = 149597870.7, TAU = 2 * Math.PI;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
const meta = JSON.parse(fs.readFileSync(new URL('../../public/data/smallbodies.json', import.meta.url)));
const bin = fs.readFileSync(new URL('../../public/data/smallbodies.bin', import.meta.url));
const d = decodeSmallBodies(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

header('THE FILE');
{
  console.log(`  ${d.count} bodies, ${meta.named.length} named; ${Object.entries(meta.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  check('the file holds what its description counts', d.count === meta.count && Object.values(meta.counts).reduce((a, b) => a + b, 0) === d.count);
  check('every orbit is an ellipse with a positive semi-major axis', d.a.every((a) => a > 0) && d.e.every((e) => e >= 0 && e < 0.996));
  check('every class is one the app knows', d.cls.every((c) => c < SB_CLASSES.length));
}

header('AGAINST JPL HORIZONS: the drawn orbits are two-body ellipses');
{
  // Horizons integrates each body with the planets' pull; the app carries the
  // osculating ellipse of the SBDB solution. The difference grows from the
  // osculation epoch (a few weeks before 2026) by the planets' perturbations.
  const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/smallbodies_horizons.json', import.meta.url)));
  let worst = 0;
  for (const [pdes, rows] of Object.entries(fx.bodies)) {
    const b = meta.named.find((n) => n.pdes === pdes);
    const errs = rows.map((r) => dist(positionAu(b, r.jd), r.r));
    worst = Math.max(worst, ...errs);
    console.log(`  ${b.name.padEnd(12)} ${errs.map((e, k) => `${['Jan 2026', 'Jul 2026', 'Jan 2027'][k]} ${(e * AU / 1000).toFixed(0).padStart(6)} thousand km`).join('   ')}  (${(errs.at(-1) / Math.hypot(...rows.at(-1).r) * 180 / Math.PI * 60).toFixed(2)}' as seen from the Sun)`);
  }
  check('within 0.01 au (1.5 million km) of Horizons for a year from the epoch: right for showing where the bodies are', worst < 0.01);
}

header('THE PACKING: 16 bytes a body');
{
  // Quantising each angle to 2 pi / 65535 and e to 1 / 65535, as the build
  // does, moves a body by at most this much a year on.
  const q = (x) => Math.round(((x % TAU) + TAU) % TAU / TAU * 65535) * TAU / 65535;
  let worst = 0;
  for (const b of meta.named) {
    const p = { a: Math.fround(b.a), e: Math.round(b.e * 65535) / 65535, i: q(b.i), node: q(b.node), peri: q(b.peri), M: q(b.M) };
    for (const days of [0, 365]) worst = Math.max(worst, dist(positionAu(p, SB_EPOCH_JD + days), positionAu(b, SB_EPOCH_JD + days)) / Math.hypot(...positionAu(b, SB_EPOCH_JD + days)));
  }
  console.log(`  named bodies, packed against full precision: worst ${(worst * 180 / Math.PI * 3600).toFixed(1)}" as seen from the Sun`);
  // A near-parabolic orbit magnifies the rounding of e (q = a (1 - e)); 2'
  // is far below what a point on screen shows, and the labels use the full
  // precision of smallbodies.json.
  check('the packing moves a body by under 2 arcminutes as seen from the Sun', worst * 180 / Math.PI * 60 < 2);
}

header("THE SHADER'S KEPLER SOLVE (Danby's start, 12 Newton steps, float32) against the exact");
{
  const f = Math.fround;
  const shader = (j, days) => {
    const a = d.a[j], e = d.e[j];
    const n = f(0.01720209895 / f(a * f(Math.sqrt(a))));
    let M = f(d.M[j] + f(n * days)); M = f(M - TAU * Math.floor(M / TAU));
    let E = f(M + 0.85 * e * (Math.sin(M) < 0 ? -1 : 1));
    for (let k = 0; k < 12; k++) E = f(E - f(f(E - f(e * f(Math.sin(E)))) - M) / f(1 - f(e * f(Math.cos(E)))));
    const x = f(a * f(Math.cos(E) - e)), y = f(a * f(Math.sqrt(1 - e * e)) * f(Math.sin(E)));
    const cw = Math.cos(d.peri[j]), sw = Math.sin(d.peri[j]), cn = Math.cos(d.node[j]), sn = Math.sin(d.node[j]), ci = Math.cos(d.i[j]), si = Math.sin(d.i[j]);
    const xp = cw * x - sw * y, yp = sw * x + cw * y;
    return [cn * xp - sn * ci * yp, sn * xp + cn * ci * yp, si * yp];
  };
  let worst = 0, worstE = 0, nWorse = 0;
  for (const days of [-3650, 0, 2000, 3650]) {
    for (let j = 0; j < d.count; j++) {
      const b = { a: d.a[j], e: d.e[j], i: d.i[j], node: d.node[j], peri: d.peri[j], M: d.M[j] };
      const err = dist(shader(j, days), positionAu(b, SB_EPOCH_JD + days)) / Math.hypot(...positionAu(b, SB_EPOCH_JD + days));
      if (err > worst) { worst = err; worstE = d.e[j]; }
      if (err > 1e-4) nWorse++;
    }
  }
  console.log(`  ${d.count} bodies at four dates over 20 years: worst ${(worst * 180 / Math.PI * 3600).toFixed(1)}" as seen from the Sun (e = ${worstE.toFixed(3)}); ${nWorse} over 20"`);
  // float32 runs out of digits for a comet of e near 0.99 close to its
  // perihelion (cos E - e is then small); the rest are well under 20".
  check('the shader puts every body within 2 arcminutes of the exact solution', worst * 180 / Math.PI * 60 < 2);
}

console.log('='.repeat(60));
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
