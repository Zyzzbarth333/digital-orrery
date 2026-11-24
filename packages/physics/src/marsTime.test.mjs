// packages/physics/src/marsTime.test.mjs
//
// Mars's calendar (marsTime.js): Allison and McEwen's worked example, the
// series against the Sun's direction from Mars in DE442 about the IAU pole
// the scene turns Mars on, and the Mars years' first days.
//
//   node packages/physics/src/marsTime.test.mjs

import './deNode.js';
import { marsLs, marsLsTime, marsSeason, marsYearStart, SOL_S } from './marsTime.js';
import { helioStateEqj } from './ephemeris.js';
import { bodyAxesEqj } from './orientation.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a) => { const n = Math.hypot(...a); return a.map((x) => x / n); };
const wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

console.log('Ls by the series');
// Allison and McEwen's example (Mars24's check): 6 Jan 2000, 00:00 UTC.
const ls0 = marsLs(Date.UTC(2000, 0, 6));
check(Math.abs(ls0 - 277.18758) < 5e-4, `6 Jan 2000 00:00 UTC: Ls ${ls0.toFixed(5)} deg (Mars24: 277.18758)`);

// The Sun seen from Mars, from DE442's state, in Mars's orbit plane from
// the node where it crosses the equator northward (the pole: IAU).
function lsGeometric(ms) {
  const d = new Date(ms);
  const { r, v } = helioStateEqj('mars', d);
  const h = unit(cross(r, v));
  const e = unit(cross(bodyAxesEqj('mars', d)[2], h));
  const s = unit(r.map((x) => -x));
  return ((Math.atan2(dot(s, cross(h, e)), dot(s, e)) * 180) / Math.PI + 360) % 360;
}
let worst = 0;
for (let ms = Date.UTC(1999, 3, 1); ms < Date.UTC(2023, 0, 1); ms += 5.3 * 86400e3) worst = Math.max(worst, Math.abs(wrap180(marsLs(ms) - lsGeometric(ms))));
check(worst < 0.02, `against DE442 and the IAU pole, April 1999 to 2022 every 5.3 days: within ${worst.toFixed(4)} deg`);

console.log('Mars years');
// MY 24 began in July 1998 and MY 37 in December 2022 (the dust maps'
// span, MY 24 to MY 36).
const day = (my) => new Date(marsYearStart(my)).toISOString().slice(0, 10);
check(day(24) === '1998-07-14' && day(34) === '2017-05-05' && day(37) === '2022-12-26', `MY 24, 34 and 37 began ${day(24)}, ${day(34)}, ${day(37)}`);
const lens = [24, 30, 36].map((my) => (marsYearStart(my + 1) - marsYearStart(my)) / (SOL_S * 1000));
check(lens.every((n) => Math.abs(n - 668.6) < 0.1), `a Mars year is ${lens.map((n) => n.toFixed(2)).join(', ')} sols (668.6)`);
const s = marsSeason(marsYearStart(34) + 1000);
check(s.my === 34 && s.sol > 0 && s.sol < 1e-4 && (s.ls < 1e-4 || s.ls > 360 - 1e-4), 'a second after MY 34 began: MY 34, sol 0, Ls 0');
const before = marsSeason(marsYearStart(34) - 1000);
check(before.my === 33 && before.sol > 668, `a second before: MY 33, sol ${before.sol.toFixed(2)}`);
const storm = marsSeason(Date.UTC(2018, 5, 15));
check(storm.my === 34 && storm.ls > 185 && storm.ls < 200, `15 June 2018, the global dust storm: MY ${storm.my}, Ls ${storm.ls.toFixed(1)} deg`);
const t = marsLsTime(34, 250);
check(Math.abs(wrap180(marsLs(t) - 250)) < 1e-6 && marsSeason(t).my === 34, `MY 34 Ls 250 is ${new Date(t).toISOString().slice(0, 10)}`);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
