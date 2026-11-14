// src/physics/smallbodies.test.mjs
//
// The small bodies the app draws (smallBodies.js, src/scene/smallBodies.ts):
// the drawn two-body orbits against JPL Horizons, what the 16-byte packing
// costs, and the vertex shader's Kepler solve (a fixed 12 Newton steps in
// float32) against the exact one, for every body.
//
//   node src/physics/smallbodies.test.mjs

import fs from 'node:fs';
import { decodeSmallBodies, positionAu, SB_EPOCH_JD, SB_CLASSES, SB_CLASS_NAMES, smallBodyFacts, diameterFromH } from './smallBodies.js';
import { GRID, loadBelt, buildBelt } from './beltGrid.js';

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

{
  header("The faint belt's grid (beltGrid.js): binning keeps each body's light and place");
  // The main-belt points stand in for the faint file (the same packing).
  const all = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength);
  const B = loadBelt(all), days = 400;
  const grid = buildBelt(B, days);
  const { nx, ny, nz, halfXY, halfZ } = GRID;
  const cx = (ix) => -halfXY + (ix + 0.5) * (2 * halfXY / nx), cy = (iy) => -halfXY + (iy + 0.5) * (2 * halfXY / ny), cz = (iz) => -halfZ + (iz + 0.5) * (2 * halfZ / nz);
  // The grid's total and light-weighted centre...
  let s0 = 0, s1 = [0, 0, 0];
  for (let iz = 0; iz < nz; iz++) for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const v = grid[(iz * ny + iy) * nx + ix]; if (!v) continue;
    s0 += v; s1[0] += v * cx(ix); s1[1] += v * cy(iy); s1[2] += v * cz(iz);
  }
  // ...against the bodies' own, placed by the exact solution.
  let t0 = 0, t1 = [0, 0, 0], inside = 0;
  for (let j = 0; j < d.count; j++) {
    const p = positionAu({ a: d.a[j], e: d.e[j], i: d.i[j], node: d.node[j], peri: d.peri[j], M: d.M[j] }, SB_EPOCH_JD + days);
    const gx = (p[0] + halfXY) * nx / (2 * halfXY) - 0.5, gy = (p[1] + halfXY) * ny / (2 * halfXY) - 0.5, gz = (p[2] + halfZ) * nz / (2 * halfZ) - 0.5;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= nx - 1 || gy >= ny - 1 || gz >= nz - 1) continue;
    const w = Math.pow(10, -0.4 * d.H[j]) / (p[0] ** 2 + p[1] ** 2 + p[2] ** 2);
    t0 += w; t1 = t1.map((x, k) => x + w * p[k]); inside++;
  }
  const centre = dist(s1.map((x) => x / s0), t1.map((x) => x / t0));
  console.log(`  ${inside} of ${d.count} bodies inside the grid; light ${(s0 / t0).toFixed(5)} of theirs; centre ${(centre * AU).toFixed(0)} km apart`);
  check('the grid holds the light of the bodies inside it (to 0.1%)', Math.abs(s0 / t0 - 1) < 1e-3);
  check('its light-weighted centre is theirs (within 0.001 au)', centre < 1e-3);
  const belt = new URL('../../public/data/smallbodies-belt.bin', import.meta.url);
  if (fs.existsSync(belt)) {
    const fb = fs.readFileSync(belt), FB = loadBelt(fb.buffer.slice(fb.byteOffset, fb.byteOffset + fb.byteLength));
    const t = performance.now(); buildBelt(FB, days);
    console.log(`  the faint belt (${FB.count} bodies) binned in ${(performance.now() - t).toFixed(0)} ms`);
  }
}

header('THE DATA PLATE\'S FACTS (smallBodyFacts, diameterFromH)');
{
  const byName = Object.fromEntries(meta.named.map((b) => [b.name, b]));
  const C = byName.Ceres, H = byName['1P/Halley'];
  const fc = smallBodyFacts(C, SB_EPOCH_JD), fh = smallBodyFacts(H, SB_EPOCH_JD);
  console.log(`  Ceres: period ${(fc.periodDays / 365.25).toFixed(3)} yr, q ${fc.perihelion.toFixed(3)} au, Q ${fc.aphelion.toFixed(3)} au, ${fc.speedKms.toFixed(2)} km/s at ${fc.dist.toFixed(3)} au`);
  console.log(`  Halley: period ${(fh.periodDays / 365.25).toFixed(2)} yr, q ${fh.perihelion.toFixed(3)} au, Q ${fh.aphelion.toFixed(2)} au`);
  // NASA's Ceres page: 4.6 years, 2.55 to 2.99 au from the Sun; Halley's:
  // 76 years, 0.6 au at perihelion. Osculating elements at 2026 differ a
  // little from those means.
  check('Ceres goes round in 4.6 years, between 2.55 and 2.99 au', Math.abs(fc.periodDays / 365.25 - 4.6) < 0.05 && Math.abs(fc.perihelion - 2.55) < 0.02 && Math.abs(fc.aphelion - 2.99) < 0.02);
  check('Halley goes round in about 76 years, about 0.59 au from the Sun at perihelion', Math.abs(fh.periodDays / 365.25 - 75.5) < 1.5 && Math.abs(fh.perihelion - 0.586) < 0.02);
  // Vis-viva against the speed from differencing the drawn positions a minute apart.
  const p0 = positionAu(C, SB_EPOCH_JD - 30 / 86400), p1 = positionAu(C, SB_EPOCH_JD + 30 / 86400);
  const vNum = dist(p0, p1) * AU / 60;
  check(`vis-viva speed matches the drawn motion (${fc.speedKms.toFixed(4)} against ${vNum.toFixed(4)} km/s)`, Math.abs(fc.speedKms - vNum) < 1e-3);
  check('the distance is the position\'s length', Math.abs(fc.dist - Math.hypot(...fc.r)) < 1e-12);
  // H and albedo to diameter: by definition 1329 km at H 0 and albedo 1;
  // Ceres, H 3.34 with SBDB's albedo 0.090, against its measured 939.4 km.
  const dc = diameterFromH(C.H, 0.09);
  check('1329 km at H = 0 and albedo 1', Math.abs(diameterFromH(0, 1) - 1329) < 1e-9);
  check(`Ceres's diameter from H ${C.H} and albedo 0.090: ${dc.toFixed(0)} km (SBDB ${C.diameter} km)`, Math.abs(dc - C.diameter) / C.diameter < 0.03);
  check('every named body has a class the plate can name', meta.named.every((b) => SB_CLASS_NAMES[b.cls]));
}

console.log('='.repeat(60));
console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
