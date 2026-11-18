// src/scene/layerComposite.test.mjs
//
// The Earth's cloud layers (layerComposite.js): which geostationary frame
// is asked for, where the Sun is overhead (against astronomy-engine), and
// the layering: newest first, no-data skipped, a geostationary frame only
// where the Sun was up and its satellite sees the ground.
//
//   node src/scene/layerComposite.test.mjs

import * as Astronomy from 'astronomy-engine';
import { compositeLayers, geoFrame, maskWeight, subsolar, GEO_LAG_MS } from './layerComposite.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}

console.log('The frame asked for');
const now = Date.parse('2026-11-18T11:18:00Z');
check(geoFrame(now, now, 1) === Date.parse('2026-11-18T10:10:00Z'), 'at now: the 10-minute frame an hour back (GIBS is 40-60 minutes behind)');
check(geoFrame(Date.parse('2026-11-01T15:47:30Z'), now, 1) === Date.parse('2026-11-01T15:40:00Z'), 'in the past: the frame at or before the sim time');
check(geoFrame(now, now, 3600) === null, 'none while time runs faster than 10 minutes a second');
check(geoFrame(now + 4 * GEO_LAG_MS, now, 1) === null, 'none for a sim time hours ahead of now');

console.log('The point under the Sun');
let worst = 0;
for (const iso of ['2026-03-20T12:00:00Z', '2026-06-21T03:15:00Z', '2026-11-18T10:20:00Z', '2025-09-07T18:11:00Z', '2015-01-24T06:00:00Z']) {
  const ms = Date.parse(iso), s = subsolar(ms);
  const t = Astronomy.MakeTime(new Date(ms));
  const eq = Astronomy.Equator(Astronomy.Body.Sun, t, new Astronomy.Observer(0, 0, 0), true, true);
  const gast = Astronomy.SiderealTime(t);
  const lat = eq.dec, lon = (((eq.ra - gast) * 15 + 540) % 360) - 180;
  const d = Math.acos(Math.min(1, Math.sin(lat * Math.PI / 180) * Math.sin(s.lat * Math.PI / 180)
    + Math.cos(lat * Math.PI / 180) * Math.cos(s.lat * Math.PI / 180) * Math.cos((lon - s.lon) * Math.PI / 180))) * 180 / Math.PI;
  worst = Math.max(worst, d);
}
check(worst < 0.5, `within ${worst.toFixed(2)} deg of astronomy-engine's at five dates`);

console.log('Layering');
const W = 360, H = 180;
const solid = (r, g, b) => { const a = new Uint8ClampedArray(W * H * 4); for (let i = 0; i < W * H; i++) a.set([r, g, b, 255], 4 * i); return a; };
const at = (out, latDeg, lonDeg) => { const y = Math.floor((latDeg + 90) * H / 180), x = Math.floor((lonDeg + 180) * W / 360); return [...out.slice(4 * (y * W + x), 4 * (y * W + x) + 4)]; };
// A newest layer with no data in its western half, an older one whole.
const half = solid(200, 0, 0);
for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) half.set([0, 0, 0, 255], 4 * (y * W + x));
let r = compositeLayers([{ data: half }, { data: solid(0, 200, 0) }], W, H);
check(at(r.out, 10, 90)[0] === 200 && at(r.out, 10, -90)[1] === 200, 'each pixel from the newest layer with data there');
check(Math.abs(r.shares[0] - 0.5) < 1e-9 && Math.abs(r.shares[1] - 0.5) < 1e-9, 'shares 50 % and 50 %');
r = compositeLayers([{ data: null }, { data: solid(5, 5, 5) }], W, H);
check(r.shares[1] === 0 && at(r.out, 0, 0)[3] === 0, 'a missing layer is skipped, and near-black is no data (left transparent)');
// A geostationary frame over the Americas at local noon there.
const mask = { satLon: -75.2, reachDeg: 70, sunLat: 0, sunLon: -75.2, sunCos: 0.1 };
r = compositeLayers([{ data: solid(0, 0, 200), mask }, { data: solid(0, 200, 0) }], W, H);
check(at(r.out, 0, -75)[2] === 200 && at(r.out, 0, 105)[1] === 200 && at(r.out, 0, -165)[1] === 200,
  'a geostationary frame only within its reach: under the satellite, not on the far side or 90 deg away');
// Full to 60 deg, fading to nothing at 70: half of (1 - cos 60) + (cos 60 - cos 70) / 2.
const c60 = Math.cos(60 * Math.PI / 180), c70 = Math.cos(70 * Math.PI / 180), want = 0.5 * ((1 - c60) + (c60 - c70) / 2);
check(Math.abs(r.shares[0] - want) < 0.005 && Math.abs(r.shares[0] + r.shares[1] - 1) < 1e-6,
  `its share ${(r.shares[0] * 100).toFixed(1)} % of the globe (${(want * 100).toFixed(1)} % for a cap faded over its last 10 deg), the rest the layer beneath`);
const mid = at(r.out, 0, -75.2 + 65);
check(Math.abs(mid[2] - 100) < 12 && Math.abs(mid[1] - 100) < 12, `65 deg from the satellite (the pixel 65.7), about half each: ${mid.slice(0, 3).join(', ')}`);
r = compositeLayers([{ data: solid(0, 0, 200), mask }, { data: null }], W, H);
check(at(r.out, 0, -75.2 + 65)[2] === 200, 'drawn in full where nothing lies beneath it');
const dusk = { ...mask, sunLon: -75.2 + 80 };
check(maskWeight(dusk, 0, -100) === 0 && maskWeight(dusk, 0, -40) > 0.9, 'and only where the Sun was up: not on its night side');

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nall passed');
