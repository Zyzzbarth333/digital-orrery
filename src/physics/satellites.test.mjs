// src/physics/satellites.test.mjs
//
// The satellites layer's physics (satellites.js): SGP4 against Vallado's
// verification set, TEME -> J2000 against Vallado's worked example, one
// satellite against JPL Horizons, and the shipped snapshot.
//
//   node src/physics/satellites.test.mjs
//
// References:
// - Vallado, Crawford, Hujsak and Kelso, "Revisiting Spacetrack Report #3",
//   AIAA 2006-6753, rev. 3: the 33 verification cases (SGP4-VER.TLE) and
//   its MATLAB code's output (fixtures/sgp4_verification.json); Appendix C,
//   eq. C-3, the TEME -> J2000 example for satellite 00005.
// - JPL Horizons, the ISS (-125544): fixtures/iss_horizons.json.
// - The snapshot's debris, rocket bodies and analyst objects
//   (npm run fetch:satellites): each placed above the ground.

import { readFileSync } from 'node:fs';
import { ommFromTle, satrecOf, stateTeme, stateEqj, temeToEqj, apply, parseGpCsv, epochMs, inShadow, meanOrbit, groundSpeeds, R_EARTH_KM } from './satellites.js';
import { earthFixedMatrix } from './earthRotation.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

// ----- SGP4 and SDP4: Vallado's verification set -----
console.log('SGP4/SDP4 against Vallado et al. 2006 (AIAA 2006-6753), 33 cases, opsmode a, WGS-72');
{
  const { cases } = fixture('sgp4_verification.json');
  // Near-Earth (SGP4) and deep-space (SDP4) apart: satellite.js reads an
  // OMM's EPOCH through a Date, to the whole millisecond, for SDP4's
  // lunar-solar set-up (the time since epoch here is exact), which moves a
  // deep-space state by up to a few centimetres (WIND, epoch 11:59:59.999136).
  const worst = { n: { r: 0, v: 0, at: '', rows: 0 }, d: { r: 0, v: 0, at: '', rows: 0 } };
  let failedAt = null;
  for (const c of cases) {
    const id = c.l1.slice(2, 7);
    const sat = satrecOf(ommFromTle(c.l1, c.l2));
    // 33334 is the set's "error code 2" case: SGP4 must refuse it (the
    // MATLAB output prints the last state it had, 33333's).
    if (id === '33334') {
      check(stateTeme(sat, sat.epochMs) === null && sat.rec.error > 0, `33334 (mean motion 1e-5 rev/day) refused, error ${sat.rec.error}`);
      continue;
    }
    const w = worst[sat.rec.method === 'd' ? 'd' : 'n'];
    for (const [t, ...rv] of c.rows) {
      const s = stateTeme(sat, sat.epochMs + t * 60e3);
      if (!s) { failedAt ??= `${id} at ${t} min (error ${sat.rec.error})`; continue; }
      const dr = dist(s.r, rv.slice(0, 3)), dv = dist(s.v, rv.slice(3, 6));
      if (dr > w.r) { w.r = dr; w.at = `${id} at ${t} min`; }
      w.v = Math.max(w.v, dv);
      w.rows++;
    }
  }
  check(failedAt === null, `every listed time propagates${failedAt ? ` (not ${failedAt})` : ''}`);
  check(worst.n.rows + worst.d.rows === 666, `${worst.n.rows + worst.d.rows} states compared (of 667, less 33334's)`);
  check(worst.n.r < 1e-6 && worst.n.v < 1e-9, `near-Earth, ${worst.n.rows} states: within 1 mm and 1 µm/s (worst ${(worst.n.r * 1e6).toFixed(4)} mm, ${(worst.n.v * 1e9).toFixed(4)} µm/s)`);
  check(worst.d.r < 0.1e-3 && worst.d.v < 0.1e-6, `deep-space, ${worst.d.rows} states: within 10 cm and 0.1 mm/s (worst ${(worst.d.r * 1e6).toFixed(1)} mm, ${worst.d.at}; ${(worst.d.v * 1e9).toFixed(1)} µm/s)`);
}

// ----- TEME -> J2000: Vallado et al. 2006, Appendix C -----
console.log('TEME -> J2000, "of date", against Vallado et al. 2006 eq. C-3 (satellite 00005, 2000 day 182.78495062 UTC)');
{
  const tMs = Date.UTC(2000, 0, 1) + (182.78495062 - 1) * 86400e3;
  // SGP4's state there (their Appendix C, from Sec. 9.7.4) ...
  const rT = [-9060.47373569, 4658.70952502, 813.68673153], vT = [-2.232832783, -4.110453490, -3.157345433];
  const { cases } = fixture('sgp4_verification.json');
  const c5 = cases.find((c) => c.l1.startsWith('1 00005'));
  const sat = satrecOf(ommFromTle(c5.l1, c5.l2));
  const s = stateTeme(sat, tMs);
  check(dist(s.r, rT) < 1e-5, `SGP4 gives their TEME state at 3 days: ${(dist(s.r, rT) * 1e6).toFixed(2)} mm off`);
  // ... and their J2000 vector.
  const M = temeToEqj(tMs);
  const r = apply(M, rT), v = apply(M, vT);
  const rJ = [-9059.9415541, 4659.6971990, 813.9569402], vJ = [-2.233347413, -4.110136158, -3.157394560];
  check(dist(r, rJ) < 2e-3, `r within 2 m: ${(dist(r, rJ) * 1e3).toFixed(2)} m (the frame turns it by ${(dist(r, rT) * 1e3).toFixed(0)} m)`);
  check(dist(v, vJ) < 2e-6, `v within 2 mm/s: ${(dist(v, vJ) * 1e6).toFixed(2)} mm/s`);
  // Their matrix's off-diagonal terms (eq. C-2), to the 1e-7 they print.
  // (They print it the other way about: theirs is our transpose.)
  const want = [[0, 1, -0.0001110], [0, 2, -0.0000185], [1, 2, 0.0000220]];
  const off = Math.max(...want.map(([i, j, w]) => Math.abs(M[j][i] - w)));
  check(off < 1.5e-7, `matrix as eq. C-2's to the digits printed: ${off.toExponential(1)}`);
}

// ----- One satellite against an independent source: JPL Horizons' ISS -----
console.log('The ISS against JPL Horizons (-125544, geocentric ICRF)');
{
  const f = fixture('iss_horizons.json');
  const sat = satrecOf(f.omm);
  let worstR = 0, worstV = 0;
  for (const h of f.vectors) {
    const ms = (h.jdUt - 2440587.5) * 86400e3;
    const s = stateEqj(sat, ms);
    worstR = Math.max(worstR, dist(s.r, h.r));
    worstV = Math.max(worstV, dist(s.v, h.v));
  }
  const span = (f.vectors.at(-1).jdUt - f.vectors[0].jdUt) * 24;
  check(worstR < 0.5, `${f.vectors.length} states over ${span.toFixed(0)} h about epoch, within 0.5 km: worst ${(worstR * 1e3).toFixed(0)} m`);
  check(worstV < 5e-4, `velocity within 0.5 m/s: worst ${(worstV * 1e3).toFixed(2)} m/s`);
  // Without the frame turn the ISS would sit 20 km off (precession since
  // 2000 alone is 0.37 deg): the check sees the frame.
  const ms = (f.vectors[0].jdUt - 2440587.5) * 86400e3;
  check(dist(stateTeme(sat, ms).r, f.vectors[0].r) > 10, `TEME as it is would be ${dist(stateTeme(sat, ms).r, f.vectors[0].r).toFixed(1)} km off`);
}

// ----- The shipped snapshot -----
console.log('The snapshot (public/data/satellites.csv, satellites.json)');
{
  const text = readFileSync(new URL('../../public/data/satellites.csv', import.meta.url), 'utf8');
  const meta = JSON.parse(readFileSync(new URL('../../public/data/satellites.json', import.meta.url), 'utf8'));
  const rows = parseGpCsv(text);
  check(rows.length === meta.count && rows.length > 5000, `${rows.length} satellites, as satellites.json says`);
  const ids = new Set(rows.map((r) => r.NORAD_CAT_ID));
  check(meta.named.every((n) => ids.has(n.id)), `all ${meta.named.length} named ones are in it`);
  check([25544, 48274, 20580].every((id) => meta.named.some((n) => n.id === id)), 'the ISS, Tiangong and Hubble are named');
  // Everything propagates at the time it was fetched (the decayed and the
  // ill-fitted aside: under 0.5 %), and lies between the ground and 2 million km.
  const t = Date.parse(meta.fetched), M = temeToEqj(t);
  let bad = 0, deep = 0;
  for (const r of rows) {
    const sat = satrecOf(r);
    const s = stateEqj(sat, t, M);
    if (!s) { bad++; continue; }
    const d = Math.hypot(...s.r);
    if (!(d > R_EARTH_KM * 0.98 && d < 2e6)) bad++;
    if (sat.rec.method === 'd') deep++;
  }
  check(bad / rows.length < 0.005, `${rows.length - bad} of ${rows.length} placed at the fetch time (${bad} not)`);
  check(deep > 500, `${deep} deep-space (SDP4: period over 225 min)`);
  // The epochs, to the microsecond.
  check(Math.abs(epochMs('2026-11-17T08:01:45.793056') - (Date.UTC(2026, 10, 17, 8, 1, 45, 793) + 0.056)) < 1e-6, 'EPOCH read to the microsecond');
  // The ISS's orbit from its elements: about 415 km up, 92.9 minutes.
  const iss = meanOrbit(satrecOf(rows.find((r) => r.NORAD_CAT_ID === 25544)));
  check(iss.perigeeKm > 350 && iss.apogeeKm < 450 && Math.abs(iss.periodMin - 92.8) < 1.5, `ISS ${iss.perigeeKm.toFixed(0)} x ${iss.apogeeKm.toFixed(0)} km, ${iss.periodMin.toFixed(2)} min`);
  // Ground speed (the plate's): against the Earth-fixed frame differenced
  // over a second (earthFixedMatrix, from J2000), within 2 m/s for the ISS
  // and a geostationary one, and the track speed under the speed itself.
  const fixedSpeed = (sat) => {
    const at = (ms) => apply(earthFixedMatrix(ms).M, stateEqj(sat, ms).r);
    const a = at(t - 500), b = at(t + 500);
    return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  };
  for (const [id, what] of [[25544, 'ISS'], [rows.find((r) => r.MEAN_MOTION > 1.0 && r.MEAN_MOTION < 1.005 && r.ECCENTRICITY < 0.001 && r.INCLINATION < 1)?.NORAD_CAT_ID, 'geostationary']]) {
    const sat = satrecOf(rows.find((r) => r.NORAD_CAT_ID === id));
    const g = groundSpeeds(stateTeme(sat, t)), want = fixedSpeed(sat);
    check(Math.abs(g.relative - want) < 2e-3 && g.track <= g.relative, `${what} ${id}: ${g.relative.toFixed(4)} km/s over the ground (differenced ${want.toFixed(4)}), track ${g.track.toFixed(4)} km/s`);
  }
}

// ----- The debris, rocket bodies and analyst objects -----
// Each file parses, holds the count satellites.json gives, and every object
// in it is placed by SGP4 above the ground (the WGS-84 ellipsoid) at the
// time its query was fetched. No object is in two files, or among the
// active ones.
console.log('The snapshot\'s other sets (satellites-debris.csv, -rocket-bodies.csv, -analyst.csv)');
{
  const meta = JSON.parse(readFileSync(new URL('../../public/data/satellites.json', import.meta.url), 'utf8'));
  const read = (f) => parseGpCsv(readFileSync(new URL(`../../public/data/${f}`, import.meta.url), 'utf8'));
  const seen = new Set(read('satellites.csv').map((r) => r.NORAD_CAT_ID));
  const WGS84_A = 6378.137, WGS84_B = 6356.752;
  for (const key of ['debris', 'rocket-bodies', 'analyst']) {
    const L = meta.layers[key];
    const rows = read(L.file);
    check(rows.length === L.count && rows.length > 100, `${key}: ${rows.length} objects, as satellites.json says`);
    const t = Date.parse(L.fetched), M = temeToEqj(t);
    let unplaced = 0, low = Infinity, high = 0, twice = 0;
    for (const r of rows) {
      if (seen.has(r.NORAD_CAT_ID)) twice++;
      seen.add(r.NORAD_CAT_ID);
      const s = stateEqj(satrecOf(r), t, M);
      if (!s) { unplaced++; continue; }
      const d = Math.hypot(...s.r), sinLat = s.r[2] / d;
      const h = d - (WGS84_A * WGS84_B) / Math.hypot(WGS84_B * Math.sqrt(1 - sinLat * sinLat), WGS84_A * sinLat);
      low = Math.min(low, h); high = Math.max(high, d);
    }
    check(unplaced === 0, `${key}: every one placed by SGP4 at ${L.fetched.slice(0, 16)} UTC (${unplaced} not)`);
    check(low > 100 && high < 2e6, `${key}: all above the ground, the lowest ${low.toFixed(0)} km up, the farthest ${high.toFixed(0)} km from the Earth's centre`);
    check(twice === 0, `${key}: none in an earlier file (${twice})`);
    if (key === 'debris') {
      // Each cloud's pieces carry its parent's international designator,
      // which the app picks them out by.
      const counts = L.clouds.map((c) => rows.filter((r) => r.OBJECT_ID.startsWith(c.intdes)).length);
      check(L.clouds.length === 3 && counts.every((n, k) => n === L.clouds[k].count) && counts.reduce((a, b) => a + b) === rows.length,
        `the ${L.clouds.length} clouds by designator: ${L.clouds.map((c, k) => `${c.name} ${counts[k]}`).join(', ')}`);
    }
    if (key === 'rocket-bodies') check(rows.every((r) => /(^|[\s(])R\/B(\b|$)/.test(r.OBJECT_NAME)), 'rocket bodies: every name holds "R/B"');
  }
}

// ----- The Earth's shadow -----
console.log("The Earth's shadow (cylinder)");
{
  const sun = [1, 0, 0];
  check(inShadow([-7000, 0, 0], sun), 'behind the Earth, on the axis: in shadow');
  check(!inShadow([7000, 0, 0], sun), 'on the day side: lit');
  check(!inShadow([-7000, 6400, 0], sun) && inShadow([-7000, 6300, 0], sun), 'the edge at the Earth\'s radius');
  check(!inShadow([-42164 * Math.cos(0.2), 0, 42164 * Math.sin(0.2)], sun), 'GEO 11.5 deg off the axis (an equinox season\'s edge): lit');
  // The ISS over one orbit at its epoch: a third or so of each orbit is in
  // shadow, from about 0 at a high beta angle to 40 % at beta 0.
  const f = fixture('iss_horizons.json');
  const sat = satrecOf(f.omm);
  let dark = 0, n = 0;
  // The Sun's direction from the Earth at epoch (low precision is plenty:
  // the Sun moves 1 deg a day).
  const d = (sat.epochMs - Date.UTC(2000, 0, 1, 12)) / 86400e3, g = (357.529 + 0.98560028 * d) * Math.PI / 180;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * Math.PI / 180, eps = 23.439 * Math.PI / 180;
  const s = [Math.cos(L), Math.cos(eps) * Math.sin(L), Math.sin(eps) * Math.sin(L)];
  for (let m = 0; m < 93; m += 0.5, n++) if (inShadow(stateEqj(sat, sat.epochMs + m * 60e3).r, s)) dark++;
  check(dark / n >= 0 && dark / n < 0.42, `ISS in shadow for ${(dark / n * 100).toFixed(0)} % of an orbit`);
}

if (failed) { console.log(`\n${failed} satellite check(s) failed`); process.exit(1); }
console.log('\nsatellites: all checks passed');
