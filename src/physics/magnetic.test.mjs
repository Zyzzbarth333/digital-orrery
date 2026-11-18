// src/physics/magnetic.test.mjs
//
// The planets' magnetic fields (magnetic.js) against published values:
//   - the spherical-harmonic sum on IGRF-13 against NOAA's Geomag 7.0
//     calculator's own published sample output, and IGRF-14 where the two
//     generations agree (to 2015);
//   - JRM33's dipole and surface field against Connerney et al. 2022, and
//     the Io flux tube's footprints against the paper's Tables S2 and S3;
//   - Cassini 11 against Cao et al. 2020 (Table 5, and the magnetic
//     equator's northward offset);
//   - the Voyager offset tilted dipoles against Garrett et al.'s tables of
//     Ness et al., and Uranus's against Connerney's Q3 dipole terms.
//
//   node src/physics/magnetic.test.mjs

import fs from 'node:fs';
import {
  harmonicField, northEastDown, igrfCoeffs, magneticModel, footprint, traceLine, seedPoints, offsetDipole,
  eccentricDipole, dipoleAngles, coeffIndex, OTD,
} from './magnetic.js';
import { IGRF, CASSINI11 } from './magnetic.data.js';
import { BELTS, beltWeight, traceShell, resample } from './belts.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const DEG = Math.PI / 180;
const fixture = (f) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

// ---- IGRF against NOAA's Geomag 7.0 ----
//
// NOAA NCEI's calculator program ships its sample coordinates run on
// IGRF-13 (sample_out_IGRF13.txt). The same sum on the same coefficients
// should give its numbers to its rounding (0.1 nT, 1 arcmin).
console.log('IGRF against NOAA Geomag 7.0');
const noaa = fixture('noaa-geomag70-igrf13.json');
const igrf13 = (year) => {
  const { DGRF2015, IGRF2020, sv2020 } = noaa.igrf13;
  if (year >= 2020) return IGRF2020.map((g, i) => g + sv2020[i] * (year - 2020));
  const f = (year - 2015) / 5;
  return DGRF2015.map((g, i) => g + f * (IGRF2020[i] - g));
};
// Geomag's dates: decimal years, or y,m,d as year + day of year / days in year.
function year(s) {
  if (!s.includes(',')) return Number(s);
  const [y, m, d] = s.split(',').map(Number), leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const before = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][m - 1] + (m > 2 && leap ? 1 : 0);
  return y + (before + d) / (365 + (leap ? 1 : 0));
}
const angle = (s) => {
  if (!s.includes(',')) return Number(s);
  const [d, m = 0, sec = 0] = s.split(',').map((v) => Number(v || 0)), sign = s.trim().startsWith('-') ? -1 : 1;
  return sign * (Math.abs(d) + m / 60 + sec / 3600);
};
const heightKm = (s) => ({ K: 1, M: 1e-3, F: 0.3048e-3 })[s[0]] * Number(s.slice(1));
const dm = (s) => { const [d, m] = s.split(' ').map((v) => parseFloat(v)); return (s.includes('-') ? -1 : 1) * (Math.abs(d) + Math.abs(m) / 60); };
let worst13 = 0, worstAng = 0;
for (const r of noaa.rows) {
  const t = year(r.date), c = igrf13(t);
  const out = northEastDown(harmonicField(c, 13), 6371.2, angle(r.lat), angle(r.lon), heightKm(r.alt), { geocentric: r.coord === 'C' });
  const dn = Math.max(...['X', 'Y', 'Z', 'H', 'F'].map((k) => Math.abs(out[k] - r[k])));
  // Geomag prints D and I to the minute, truncated or rounded: one minute either way.
  const da = Math.max(Math.abs(out.D - dm(r.D)), Math.abs(out.I - dm(r.I))) * 60;
  worst13 = Math.max(worst13, dn); worstAng = Math.max(worstAng, da);
}
check(worst13 < 0.11, `IGRF-13 at Geomag's 20 sample points (2015-2024.5, 0-30,000 ft, geodetic and geocentric): X Y Z H F within ${worst13.toFixed(3)} nT (limit 0.11, its rounding)`);
check(worstAng < 1.01, `  and D, I within ${worstAng.toFixed(2)} arcmin (limit 1, its printed minute)`);

// IGRF-14 keeps IGRF-13's definitive models to 2015: the same field there.
const same = [2000, 2005, 2010, 2015].every((y) => {
  const e = IGRF.epochs.indexOf(y);
  return e >= 0 && (y < 2015 || IGRF.coeffs[e].every((g, i) => Math.abs(g - noaa.igrf13.DGRF2015[i]) < 1e-9));
});
check(same, 'IGRF-14 holds IGRF-13\'s DGRF 2015 unchanged');
for (const r of noaa.rows.filter((x) => year(x.date) < 2015.01)) {
  const out = northEastDown(harmonicField(igrfCoeffs(year(r.date)), 13), IGRF.a, angle(r.lat), angle(r.lon), heightKm(r.alt));
  const dn = Math.max(...['X', 'Y', 'Z'].map((k) => Math.abs(out[k] - r[k])));
  check(dn < 0.3, `IGRF-14 at ${r.date}, ${r.lat} ${r.lon} ${r.alt}: X ${out.X.toFixed(1)} Y ${out.Y.toFixed(1)} Z ${out.Z.toFixed(1)} nT, NOAA ${r.X} ${r.Y} ${r.Z} (worst ${dn.toFixed(2)} nT, limit 0.3: two weeks of secular change)`);
}

// The eccentric dipole of IGRF-14 for 2025: the geomagnetic north pole is
// where the moment's other end comes out, 80.8 N 72.7 W (NOAA lists the
// IGRF-14 2025 geomagnetic north pole at 80.8 N, 72.6 W).
const earth = magneticModel('earth', new Date('2025-01-01T00:00:00Z'));
const m = earth.dipole.m, M = Math.hypot(...m);
const poleLat = Math.asin(-m[2] / M) / DEG, poleLon = Math.atan2(-m[1], -m[0]) / DEG;
check(Math.abs(poleLat - 80.8) < 0.1 && Math.abs(poleLon + 72.6) < 0.2, `IGRF-14 2025 geomagnetic north pole ${poleLat.toFixed(2)} N ${(-poleLon).toFixed(2)} W, dipole tilt ${earth.dipole.tilt.toFixed(2)} deg`);
const off = Math.hypot(...earth.dipole.centre) * IGRF.a;
check(off > 450 && off < 700, `IGRF-14 2025 eccentric dipole ${off.toFixed(0)} km from the centre (Fraser-Smith 1987 found about 470 km in 1980, growing about 2 km/yr)`);

// ---- the sums ----
// A dipole as harmonics is the same field as the closed form.
const pure = harmonicField([1000, 200, -300, 0, 0, 0, 0, 0], 2), closed = offsetDipole([200, -300, 1000], [0, 0, 0]);
const a = pure(0.3, -0.7, 1.4, [0, 0, 0]), b = closed(0.3, -0.7, 1.4, [0, 0, 0]);
check(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9, 'degree-1 harmonics equal the dipole formula (3 (m.r) r - m r^2) / r^5');
// curl-free and divergence-free: the potential field of a degree 13 sum.
{
  const f = harmonicField(igrfCoeffs(2025), 13), h = 1e-5, p = [0.6, 0.5, 0.9];
  const B = (x) => f(x[0], x[1], x[2], [0, 0, 0]);
  const d = (i, j) => { const q1 = p.slice(), q2 = p.slice(); q1[j] += h; q2[j] -= h; return (B(q1)[i] - B(q2)[i]) / (2 * h); };
  const div = d(0, 0) + d(1, 1) + d(2, 2), curl = Math.hypot(d(2, 1) - d(1, 2), d(0, 2) - d(2, 0), d(1, 0) - d(0, 1));
  const scale = Math.hypot(...B(p));
  check(Math.abs(div) / scale < 1e-6 && curl / scale < 1e-6, `IGRF-14 sum is a potential field: |div B| ${(Math.abs(div) / scale).toExponential(1)}, |curl B| ${(curl / scale).toExponential(1)} of |B| per unit a`);
}

// ---- Jupiter: JRM33 ----
console.log('Jupiter: JRM33 and con2020 (Connerney et al. 2022, 2020)');
const J = magneticModel('jupiter');
check(Math.abs(J.dipole.moment / 1e5 - 4.177) < 0.0005, `JRM33 dipole moment ${(J.dipole.moment / 1e5).toFixed(4)} G R_J^3 (paper 4.177)`);
check(Math.abs(J.dipole.tilt - 10.25) < 0.005, `  tilt ${J.dipole.tilt.toFixed(3)} deg (paper 10.25)`);
check(Math.abs((360 - J.dipole.lonEast) - 196.38) < 0.005, `  toward ${(360 - J.dipole.lonEast).toFixed(3)} deg System III west (paper 196.38)`);
// The field on the dynamically flattened (1/15.4) surface: "from a minimum
// of just under 2 Gauss to a maximum of almost 22 Gauss" (the paper's
// maps, to degree 18); to degree 13 the peak is a little lower.
{
  const pol = 1 - 1 / 15.4, bb = [0, 0, 0];
  let lo = Infinity, hi = 0, hiLat = 0;
  for (let la = -89.5; la < 90; la += 1) for (let lo2 = 0; lo2 < 360; lo2 += 1) {
    // Planetocentric latitude on the spheroid.
    const c = Math.cos(la * DEG), s = Math.sin(la * DEG), r = 1 / Math.sqrt(c * c + (s * s) / (pol * pol));
    J.internal(r * c * Math.cos(lo2 * DEG), r * c * Math.sin(lo2 * DEG), r * s, bb);
    const B = Math.hypot(...bb) / 1e5;
    if (B < lo) lo = B;
    if (B > hi) { hi = B; hiLat = la; }
  }
  check(lo > 1.7 && lo < 2.0, `JRM33 surface minimum ${lo.toFixed(2)} G (paper: just under 2)`);
  check(hi > 19 && hi < 22, `JRM33 surface maximum ${hi.toFixed(2)} G at ${hiLat.toFixed(1)} deg (paper: almost 22 to degree 18; degree 13 here)`);
}
// The Io flux tube's footprints (5.9 R_J), JRM33 + con2020 against the
// paper's Tables S2 and S3 (degree 18, planetocentric latitude, on the
// 1/15.4 spheroid), every 5 deg of Io's longitude.
{
  const fx = fixture('jrm33_io_footprints.json'), surf = { eq: 1, pol: 1 - 1 / 15.4 };
  let worst = 0, sum2 = 0, n = 0, peakN = [0, 0], peakS = [0, 0];
  const bb = [0, 0, 0];
  for (const [hemi, rows] of [['north', fx.north], ['south', fx.south]]) {
    for (const [wl, lat, wlon] of rows) {
      const e = -wl * DEG, p = [5.9 * Math.cos(e), 5.9 * Math.sin(e), 0];
      const fp = [footprint(J, p, 1, surf), footprint(J, p, -1, surf)].find((q) => q && (hemi === 'north') === (q[2] > 0));
      const la = Math.atan2(fp[2], Math.hypot(fp[0], fp[1])) / DEG, lw = (((-Math.atan2(fp[1], fp[0])) / DEG) % 360 + 360) % 360;
      let dl = Math.abs(lw - wlon); dl = Math.min(dl, 360 - dl);
      const err = Math.hypot(la - lat, dl * Math.cos(lat * DEG));
      worst = Math.max(worst, err); sum2 += err * err; n++;
      const B = Math.hypot(...J.internal(fp[0], fp[1], fp[2], bb)) / 1e5;
      if (hemi === 'north' && B > peakN[0]) peakN = [B, wl];
      if (hemi === 'south' && B > peakS[0]) peakS = [B, wl];
    }
  }
  check(worst < 1.5, `Io footprints at ${n} longitudes: within ${worst.toFixed(2)} deg of arc of the paper's (rms ${Math.sqrt(sum2 / n).toFixed(2)}; limit 1.5, degree 13 against its 18)`);
  // "approach a maximum of 20 Gauss in the north ... and 12 Gauss in the south".
  check(Math.abs(peakN[0] - 20) < 1.5 && Math.abs(peakS[0] - 12) < 1, `|B| along the Io footprint peaks at ${peakN[0].toFixed(1)} G north and ${peakS[0].toFixed(1)} G south (paper: about 20 and 12)`);
}
// Europa's (9.4 R_J) and Ganymede's (15 R_J) footprints against the same
// tables, where the current sheet matters more.
{
  const fx = fixture('jrm33_io_footprints.json'), surf = { eq: 1, pol: 1 - 1 / 15.4 };
  for (const [moon, r, limit] of [['europa', 9.4, 1.5], ['ganymede', 15.0, 2.5]]) {
    let worst = 0, sum2 = 0, n = 0;
    for (const hemi of ['north', 'south']) for (const [wl, lat, wlon] of fx[moon][hemi]) {
      const e = -wl * DEG, p = [r * Math.cos(e), r * Math.sin(e), 0];
      const fp = [footprint(J, p, 1, surf), footprint(J, p, -1, surf)].find((q) => q && (hemi === 'north') === (q[2] > 0));
      const la = Math.atan2(fp[2], Math.hypot(fp[0], fp[1])) / DEG, lw = (((-Math.atan2(fp[1], fp[0])) / DEG) % 360 + 360) % 360;
      let dl = Math.abs(lw - wlon); dl = Math.min(dl, 360 - dl);
      const err = Math.hypot(la - lat, dl * Math.cos(lat * DEG));
      worst = Math.max(worst, err); sum2 += err * err; n++;
    }
    check(worst < limit, `${moon[0].toUpperCase() + moon.slice(1)}'s footprints at ${n} longitudes: within ${worst.toFixed(2)} deg of arc of the paper's, rms ${Math.sqrt(sum2 / n).toFixed(2)} (limit ${limit})`);
  }
}
// The current sheet: Edwards et al.'s forms are smooth across rho = r0 and
// the field is divergence-free away from the sheet's edges.
{
  const bb = [0, 0, 0], at = (x, y, z) => J.field(x, y, z, bb).slice();
  const h = 1e-4, p = [12, 3, 6];
  const d = (i, j) => { const q1 = p.slice(), q2 = p.slice(); q1[j] += h; q2[j] -= h; return (at(...q1)[i] - at(...q2)[i]) / (2 * h); };
  const div = d(0, 0) + d(1, 1) + d(2, 2), B = Math.hypot(...at(...p));
  check(Math.abs(div) / B < 1e-3, `JRM33 + con2020 at 12, 3, 6 R_J: |div B| ${(Math.abs(div) / B).toExponential(1)} of |B| per R_J`);
  // Field lines from further out land closer to the magnetic poles (the
  // dipole axis): from Io's orbit, 10 and 20 R_J, at every 30 deg of
  // longitude, in both hemispheres.
  const u = J.dipole.m.map((v) => v / J.dipole.moment);
  let ordered = true, moved = 0;
  const surf = { eq: 1, pol: 1 - 1 / 15.4 };
  for (let wl = 0; wl < 360; wl += 30) {
    for (const sign of [1, -1]) {
      const lats = [5.9, 10, 20].map((r) => {
        const q = footprint(J, [r * Math.cos(-wl * DEG), r * Math.sin(-wl * DEG), 0], sign, surf);
        return q ? 90 - Math.acos(Math.abs(q[0] * u[0] + q[1] * u[1] + q[2] * u[2]) / Math.hypot(...q)) / DEG : NaN;
      });
      ordered &&= lats[0] < lats[1] && lats[1] < lats[2];
      moved = Math.max(moved, lats[2] - lats[0]);
    }
  }
  check(ordered, `footprints from 5.9, 10 and 20 R_J lie ever closer to the dipole's poles at every longitude (up to ${moved.toFixed(1)} deg apart)`);
}

// ---- Saturn: Cassini 11 ----
console.log('Saturn: Cassini 11 (Cao et al. 2020)');
const table5 = [21140, 1581, 2260, 91, 12.6, 17.2, -59.6, -10.5, -12.9, 15, 18];
check(table5.every((g, i) => Math.abs(CASSINI11.coeffs[coeffIndex(i + 1, 0)] - g) <= 0.5) && CASSINI11.coeffs.every((g, i) => g === 0 || [...Array(11)].some((_, n) => coeffIndex(n + 1, 0) === i)),
  'Cassini 11: g10 to g11,0 as Cao et al. 2020 Table 5 (to its rounding), no other terms');
const S = magneticModel('saturn');
check(S.dipole.tilt === 0, `Cassini 11 dipole tilt ${S.dipole.tilt} deg (Cao et al.: under 0.007)`);
// "the magnetic equator ... shifted northward ... ~2300 km (0.0382 R_S)":
// the quadrupole's eccentric dipole sits that far north.
check(Math.abs(S.dipole.centre[2] * 60268 - 2300) < 150, `Cassini 11 eccentric dipole ${(S.dipole.centre[2] * 60268).toFixed(0)} km north of the centre (Cao et al.: the magnetic equator about 2300 km north)`);
// ---- Uranus and Neptune: Voyager's offset tilted dipoles ----
console.log('Uranus and Neptune: Voyager 2 (Ness et al. 1986, 1989)');
for (const [k, want] of [['uranus', { M: 0.230, tilt: 60, off: 0.310 }], ['neptune', { M: 0.133, tilt: 46.8, off: 0.55 }]]) {
  const md = magneticModel(k), d = md.dipole, off = Math.hypot(...d.centre);
  check(Math.abs(d.moment / 1e5 - want.M) < 0.002 && Math.abs(d.tilt - want.tilt) < 0.2 && Math.abs(off - want.off) < 0.005,
    `${k}: moment ${(d.moment / 1e5).toFixed(3)} G R^3, tilt ${d.tilt.toFixed(2)} deg, centre ${off.toFixed(3)} R off (Ness: ${want.M}, ${want.tilt}, ${want.off})`);
}
// Connerney et al. 1987's Q3 dipole terms for Uranus (Garrett, JPL 15-7,
// Table 3, gauss, Voyager frame) point within a few degrees of the OTD's
// moment, once both are turned into the IAU frame the same way.
{
  const q3 = [0.11579, -0.15684, 0.11893], q3iau = [q3[0], -q3[1], -q3[2]].map((v) => v * 1e5);
  const o = OTD.uranus.m, cos = (q3iau[0] * o[0] + q3iau[1] * o[1] + q3iau[2] * o[2]) / (Math.hypot(...q3iau) * Math.hypot(...o));
  check(Math.acos(cos) / DEG < 6, `Uranus OTD and Q3 dipole moments ${(Math.acos(cos) / DEG).toFixed(2)} deg apart; Q3 tilt ${dipoleAngles(q3iau).tilt.toFixed(1)} deg (Connerney: 58.6)`);
  // The moment points into the IAU southern hemisphere, the offset north.
  check(o[2] < 0 && OTD.uranus.centre[2] > 0, 'Uranus: field lines leave the IAU southern hemisphere; the dipole sits 0.31 R_U toward the IAU north');
}

// ---- field lines ----
console.log('Field lines');
// On a centred dipole a line from magnetic latitude lambda crosses the
// equator at L = 1 / cos^2 lambda and lands at -lambda.
{
  const model = { field: offsetDipole([0, 0, -30000], [0, 0, 0]), dipole: { m: [0, 0, -30000], centre: [0, 0, 0] }, rMax: 20 };
  for (const lat of [30, 60]) {
    const t = traceLine(model, [Math.cos(lat * DEG), 0, -Math.sin(lat * DEG)]);
    let rmax = 0;
    for (let i = 0; i < t.strength.length; i++) rmax = Math.max(rmax, Math.hypot(t.points[3 * i], t.points[3 * i + 1], t.points[3 * i + 2]));
    const L = 1 / Math.cos(lat * DEG) ** 2, end = t.points.slice(-3);
    check(t.closed && Math.abs(rmax / L - 1) < 1e-3 && Math.abs(Math.asin(end[2]) / DEG - lat) < 0.01,
      `dipole line from ${lat} deg: apex ${rmax.toFixed(4)} (L ${L.toFixed(4)}), lands at ${(Math.asin(end[2]) / DEG).toFixed(3)} deg`);
  }
}
// Seeds sit on the surface.
{
  const seeds = seedPoints(magneticModel('neptune'), { eq: 1, pol: 0.983 }, [20, 50], 8);
  const err = Math.max(...seeds.map((s) => Math.abs((s.p[0] ** 2 + s.p[1] ** 2) + (s.p[2] / 0.983) ** 2 - 1)));
  check(seeds.length === 16 && err < 1e-12, `seed points on Neptune's spheroid (${seeds.length}, off by ${err.toExponential(1)})`);
}
// eccentricDipole is exact for a displaced dipole's own harmonics: a dipole
// at (0, 0, 0.05) has g20 = 2 g10 0.05, g21 = sqrt(3) g11 0.05 ... to first order.
{
  const g10 = -30000, z0 = 0.05, c = new Array(8).fill(0);
  c[0] = g10; c[3] = 2 * g10 * z0;
  const e = eccentricDipole(c);
  check(Math.abs(e.centre[2] - z0) < 1e-12, `eccentric dipole of an axial offset: ${e.centre[2].toFixed(6)} (set ${z0})`);
}

// ---- Mercury: MESSENGER's offset dipole ----
console.log("Mercury: MESSENGER (Anderson et al. 2012)");
{
  const M = magneticModel('mercury');
  check(Math.abs(M.dipole.moment - 190) < 1e-9 && M.dipole.m[2] < 0 && Math.abs(M.dipole.centre[2] * 2440 - 479) < 1e-9,
    `Mercury: 190 nT R_M^3, moment southward, centre 479 km north (Anderson et al.: 190, southward, 479 +- 6 km)`);
  // An axial dipole moved z0 along its axis has g_n0 = n g10 z0^(n-1): the
  // terms libinternalfield's anderson2012 file lists (-190, -74.6, -22.0, -5.7 nT).
  const z0 = 479 / 2440, want = [-190, -74.6, -22.0, -5.7];
  const got = want.map((_, i) => (i + 1) * -190 * z0 ** i);
  check(got.every((g, i) => Math.abs(g - want[i]) < 0.06), `its expansion g10..g40 ${got.map((g) => g.toFixed(1)).join(', ')} nT (libinternalfield: ${want.join(', ')})`);
  const c = new Array(24).fill(0);
  want.forEach((g, i) => { c[coeffIndex(i + 1, 0)] = g; });
  check(Math.abs(eccentricDipole(c).centre[2] * 2440 - 479) < 1, `the eccentric dipole of those terms sits ${(eccentricDipole(c).centre[2] * 2440).toFixed(0)} km north`);
}

// ---- radiation belts ----
console.log('Radiation belts');
{
  // A centred dipole's L-shell reaches L at the equator and the surface at
  // cos^2 lambda = 1 / L.
  const model = { field: offsetDipole([0, 0, -30000], [0, 0, 0]), dipole: { m: [0, 0, -30000], centre: [0, 0, 0] }, rMax: 20 };
  const [line] = traceShell(model, 4, 1, { eq: 1, pol: 1 });
  let rmax = 0;
  for (let i = 0; i < line.strength.length; i++) rmax = Math.max(rmax, Math.hypot(line.points[3 * i], line.points[3 * i + 1], line.points[3 * i + 2]));
  const r = resample(line.points, 41, model), ends = [r.lat[0], r.lat[40]].map(Math.abs);
  check(Math.abs(rmax - 4) < 1e-6 && ends.every((l) => Math.abs(l - 60) < 0.01) && Math.abs(r.lat[20]) < 0.5,
    `dipole L = 4 shell: apex ${rmax.toFixed(6)}, feet at ${ends.map((l) => l.toFixed(3)).join(' and ')} deg (60), middle ${r.lat[20].toFixed(2)} deg`);
  check(beltWeight(BELTS.earth[1], 4.6) === 1 && beltWeight(BELTS.earth[1], 3) === 0 && beltWeight(BELTS.earth[0], 2.5) === 0, 'belt weights: 1 at the peak, 0 at the edges and in the slot');
  // The inner belt comes nearest the Earth over the South Atlantic, where
  // the dipole's offset and tilt bring it down (the South Atlantic Anomaly):
  // along the L = 1.25 shell, the lowest point of each line's weakest field.
  const E = magneticModel('earth', new Date('2025-01-01T00:00:00Z'));
  let low = [Infinity, 0, 0];
  for (const l of traceShell(E, 1.25, 72, { eq: 6378.137 / 6371.2, pol: 6356.752 / 6371.2 })) {
    let k = 0;
    for (let i = 1; i < l.strength.length; i++) if (l.strength[i] < l.strength[k]) k = i;
    const p = [l.points[3 * k], l.points[3 * k + 1], l.points[3 * k + 2]], h = (Math.hypot(...p) - 1) * 6371.2;
    if (h < low[0]) low = [h, Math.asin(p[2] / Math.hypot(...p)) / DEG, Math.atan2(p[1], p[0]) / DEG];
  }
  check(low[2] > -80 && low[2] < -10 && low[1] < 0, `IGRF-14's L = 1.25 shell is lowest, ${low[0].toFixed(0)} km up, at ${low[1].toFixed(1)} N ${low[2].toFixed(1)} E: over the South Atlantic`);
}

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nall magnetic field checks passed');
