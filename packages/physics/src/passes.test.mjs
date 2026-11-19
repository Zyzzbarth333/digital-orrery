// packages/physics/src/passes.test.mjs
//
// Satellite passes over a place (passes.js) against Heavens-Above's
// predictions for the same element set, and its frames against the app's
// own Earth orientation.
//
//   node packages/physics/src/passes.test.mjs
//
// References:
// - Heavens-Above, ISS (25544): the element set in use (epoch 17 Nov 2026
//   20:24:46 UTC), every pass over Greenwich and Sydney Observatory from
//   18 to 28 Nov 2026 above 10 deg, and seven passes in detail
//   (fixtures/passes_heavens_above.json).
// - The Earth's orientation: orientation.js earthFixedAxes (checked against
//   CSPICE's ITRF93 in orientation.test.mjs).

import './deNode.js';
import { readFileSync } from 'node:fs';
import { ommFromTle, satrecOf, stateTeme, temeToEqj, apply } from './satellites.js';
import { siteOf, subPoint, temeToItrf, lookAt, findPasses, sunElevation } from './passes.js';
import { earthFixedAxes } from './orientation.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const fx = JSON.parse(readFileSync(new URL('./fixtures/passes_heavens_above.json', import.meta.url), 'utf8'));
const sat = satrecOf(ommFromTle(fx.tle[0], fx.tle[1]));
const MJD_UNIX = 40587;
const mjdMs = (mjd) => (mjd - MJD_UNIX) * 86400e3;
// A "hh:mm:ss" from Heavens-Above as the instant nearest a reference one.
const near = (hms, refMs) => {
  const [h, m, s] = hms.split(':').map(Number);
  const day = Math.floor(refMs / 86400e3) * 86400e3, t = day + (h * 3600 + m * 60 + s) * 1000;
  return [t - 86400e3, t, t + 86400e3].reduce((best, x) => (Math.abs(x - refMs) < Math.abs(best - refMs) ? x : best));
};
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
// How far an azimuth is outside a 16-point compass sector (0 inside it).
const outside = (az, point) => {
  const c = COMPASS.indexOf(point) * 22.5, d = Math.abs(((az - c + 540) % 360) - 180);
  return Math.max(0, d - 11.25);
};
const deg = (s) => Number(s.replace(/[°\s].*$/, ''));

// ----- Frames -----
console.log('TEME -> ITRF (W R3(GMST)) against the app\'s Earth orientation (J2000 -> ITRF93)');
{
  let worst = 0;
  for (let k = 0; k <= 10; k++) {
    const t = sat.epochMs + k * 86400e3;
    const s = stateTeme(sat, t);
    const a = apply(temeToItrf(t), s.r), b = apply(earthFixedAxes(t).M, apply(temeToEqj(t), s.r));
    worst = Math.max(worst, dist(a, b));
  }
  // The difference is the IERS corrections to the 1980 nutation, which
  // earthFixedAxes has and SGP4's TEME does not (0.05" or so, 1.7 m at the
  // ISS's 6,800 km).
  check(worst < 5e-3, `the ISS over 10 days from its epoch: the two agree within 5 m (worst ${(worst * 1e3).toFixed(2)} m)`);
}

console.log('WGS-84 sites and sub-points');
{
  let worst = 0;
  for (const [lat, lon, hgt] of [[51.4769, -0.0005, 0.046], [-33.8597, 151.2048, 0.045], [89.9, 10, 0], [0, -120, 420], [-60, 45, 35786]]) {
    const p = subPoint(siteOf(lat, lon, hgt).r);
    worst = Math.max(worst, Math.abs(p.latDeg - lat) * 111e3, Math.abs(((p.lonDeg - lon + 540) % 360) - 180) * 111e3 * Math.cos(lat * Math.PI / 180), Math.abs(p.heightKm - hgt) * 1e3);
  }
  check(worst < 1e-3, `site -> ITRF -> geodetic, from the pole to GEO height: back within 1 mm (worst ${(worst * 1e3).toFixed(4)} mm)`);
}

// ----- Heavens-Above -----
const FROM = Date.UTC(2026, 10, 18), DAYS = 10;
for (const site of fx.sites) {
  console.log(`Heavens-Above, ISS over ${site.name} (${site.lat}, ${site.lon}), 18-28 Nov 2026, passes above 10°`);
  const s = siteOf(site.lat, site.lon, site.heightM / 1000);
  const t0 = performance.now();
  const ours = findPasses(sat, s, FROM, { days: DAYS, minPeakDeg: 10 });
  const ms = performance.now() - t0;
  const inSpan = ours.filter((p) => p.peak.t < FROM + DAYS * 86400e3 && p.peak.t >= FROM);
  // Heavens-Above lists a pass that just reaches 10 deg; ours lists those
  // whose peak is 10 deg or more, so a peak within rounding of 10 can fall
  // either side: pair them by culmination.
  const pairs = [], unmatched = [];
  for (const row of site.summary) {
    const tPeak = mjdMs(row[0]);
    const p = inSpan.find((q) => Math.abs(q.peak.t - tPeak) < 60e3);
    if (p) pairs.push([row, p]); else unmatched.push(row);
  }
  const extra = inSpan.filter((p) => !pairs.some(([, q]) => q === p));
  const grazing = (rows) => rows.every((r) => r[6] <= 10);
  check(unmatched.length === 0 || grazing(unmatched), `all ${site.summary.length} of Heavens-Above's passes found${unmatched.length ? ` (but ${unmatched.map((r) => `${r[1]} ${r[5]} at ${r[6]}°`).join(', ')}: grazing 10°)` : ''}, ${extra.length} more of ours (${extra.map((p) => `peak ${p.peak.elDeg.toFixed(2)}°`).join(', ') || 'none'}), in ${ms.toFixed(0)} ms`);
  check(extra.every((p) => p.peak.elDeg < 10.5), 'any pass of ours they leave out peaks under 10.5°');
  let dPeak = 0, dElPeak = 0, dCross = 0, dCompass = 0, nCross = 0, crossAt = '', compassAt = '';
  const kindOff = [];
  for (const [row, p] of pairs) {
    const tPeak = mjdMs(row[0]);
    dPeak = Math.max(dPeak, Math.abs(p.peak.t - tPeak) / 1000);
    dElPeak = Math.max(dElPeak, Math.abs(p.peak.elDeg - row[6]));
    // A pass that peaks within a degree of 10 crosses it at times a
    // hundredth of a degree moves by seconds (theirs move by 4 s between
    // their summary and their details): left out here.
    if (p.above && p.peak.elDeg >= 11) {
      nCross++;
      const c = Math.max(Math.abs(p.above.up.t - near(row[2], tPeak)), Math.abs(p.above.down.t - near(row[8], tPeak))) / 1000;
      if (c > dCross) { dCross = c; crossAt = `${row[1]} ${row[5]}, peak ${p.peak.elDeg.toFixed(2)}°`; }
      const o = Math.max(outside(p.above.up.azDeg, row[4]), p.peak.elDeg > 85 ? 0 : outside(p.peak.azDeg, row[7]), outside(p.above.down.azDeg, row[10]));
      if (o > dCompass) { dCompass = o; compassAt = `${row[1]} ${row[5]}, peak ${p.peak.elDeg.toFixed(2)}° at ${p.peak.azDeg.toFixed(1)}°, ${p.above.up.azDeg.toFixed(1)}° to ${p.above.down.azDeg.toFixed(1)}°, theirs ${row[4]} ${row[7]} ${row[10]}`; }
    }
    const kind = { visible: 'visible', daylight: 'daylight', 'night (unlit)': 'unlit' }[row[11]];
    if (kind !== p.kind) kindOff.push(`${row[1]} ${row[5]}: theirs ${row[11]}, ours ${p.kind} (Sun ${p.sunElDeg.toFixed(2)}°)`);
  }
  check(dPeak < 1, `culmination times within 1 s of theirs (worst ${dPeak.toFixed(3)} s)`);
  check(dElPeak <= 0.55, `peak elevations within their whole degree (worst ${dElPeak.toFixed(2)}° from it)`);
  check(dCross <= 1.5, `10° crossings within their whole second, ${nCross} passes peaking at 11° or more (worst ${dCross.toFixed(2)} s, ${crossAt})`);
  check(dCompass < 0.5, `directions at 10°, peak and 10° in their 16-point compass sector (worst ${dCompass.toFixed(2)}° outside, ${compassAt})`);
  check(kindOff.length === 0, `visible, daylight or unlit as they have it, ${pairs.length} passes${kindOff.length ? `: ${kindOff.join('; ')}` : ''}`);

  // The detailed passes: each event's time, and where the satellite is at
  // their time of it. Their times are whole seconds and their angles whole
  // degrees, so a direction may be off by its motion in a second plus half
  // a degree in each angle, and a range by its rate in a second.
  let dT = 0, dRise = 0, dDir = 0, dRange = 0, dSun = 0, n = 0, worstAt = '';
  const sep = (a1, e1, a2, e2) => {
    const r = Math.PI / 180, c = Math.sin(e1 * r) * Math.sin(e2 * r) + Math.cos(e1 * r) * Math.cos(e2 * r) * Math.cos((a1 - a2) * r);
    return Math.acos(Math.min(1, c)) / r;
  };
  for (const d of site.details) {
    const tPeak = mjdMs(d.mjd);
    const p = ours.find((q) => Math.abs(q.peak.t - tPeak) < 60e3);
    const grazing = p.peak.elDeg < 11;
    for (const [event, hms, alt, az, range, , sunAlt] of d.rows) {
      const t = near(hms, tPeak);
      const ev = {
        'Rises': p.rise, 'Sets': p.set, 'Maximum altitude': p.peak,
        'Reaches altitude 10°': p.above?.up, 'Drops below altitude 10°': p.above?.down,
        // Our visible span starts or ends at the shadow's edge.
        'Enters shadow': p.visible?.to, 'Exits shadow': p.visible?.from,
      }[event];
      const dt = ev ? Math.abs(ev.t - t) / 1000 : Infinity;
      if (event === 'Rises' || event === 'Sets') dRise = Math.max(dRise, dt);
      else if (!(grazing && event.includes('10°')) && dt > dT) { dT = dt; worstAt = `${event} ${hms}`; }
      const here = lookAt(sat, s, t), next = lookAt(sat, s, t + 1000);
      const rate = sep(here.azDeg, here.elDeg, next.azDeg, next.elDeg);
      dDir = Math.max(dDir, sep(here.azDeg, here.elDeg, deg(az), deg(alt)) - rate - 0.71);
      dRange = Math.max(dRange, Math.abs(here.rangeKm - Number(range.replace(/,/g, ''))) - Math.abs(next.rangeKm - here.rangeKm));
      dSun = Math.max(dSun, Math.abs(sunElevation(s, t) - deg(sunAlt)));
      n++;
    }
  }
  check(dT <= 1.5, `${site.details.length} passes in detail, ${n} events: culminations, 10° crossings and shadow edges within 1.5 s (worst ${dT.toFixed(2)} s, ${worstAt})`);
  check(dRise <= 1.5, `rises and sets at 0°, geometric, within 1.5 s (worst ${dRise.toFixed(2)} s)`);
  check(dDir <= 0, `directions at their times within their rounding (worst ${dDir.toFixed(2)}° beyond it)`);
  check(dRange <= 0.5, `ranges at their times within 0.5 km past a second's change (worst ${dRange.toFixed(2)} km)`);
  check(dSun < 0.06, `the Sun's altitude within 0.06° (worst ${dSun.toFixed(3)}°)`);
}

if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1); }
console.log('\nAll pass checks passed.');
