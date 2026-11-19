// src/physics/discs.test.mjs
//
// The disc overlap behind the glare and the sky's adaptation (discs.js):
// against counting the overlap on a fine grid, and against eclipses.
//
//   node src/physics/discs.test.mjs

import { visibleFraction, sunVisible, sunlight } from './discs.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}

// Brute force: the share of disc a (centre 0) outside disc b (centre c on x).
function grid(a, b, c, n = 1200) {
  let inA = 0, seen = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = -a + (2 * a * (i + 0.5)) / n, y = -a + (2 * a * (j + 0.5)) / n;
    if (x * x + y * y > a * a) continue;
    inA++;
    if ((x - c) ** 2 + y * y > b * b) seen++;
  }
  return seen / inA;
}

// Twenty partial overlaps, small and large occluders, near and far.
let worst = 0, seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let k = 0; k < 20; k++) {
  const a = 1, b = 0.05 + 2 * rnd(), c = Math.abs(a - b) + (a + b - Math.abs(a - b)) * rnd();
  worst = Math.max(worst, Math.abs(visibleFraction(a, b, c) - grid(a, b, c)));
}
check(worst < 2e-3, `matches the grid count to ${worst.toExponential(1)} over 20 partial overlaps`);

// The limits.
check(visibleFraction(1, 0.3, 1.31) === 1 && visibleFraction(1, 1.05, 0.02) === 0, 'apart: all seen; inside a bigger disc: none');
check(Math.abs(visibleFraction(1, 0.5, 0) - 0.75) < 1e-15, 'a disc of half the radius, centred: 3/4 seen');
check(Math.abs(visibleFraction(1, 1, 0.5) - visibleFraction(1, 1, 0.5 + 1e-12)) < 1e-9, 'continuous through the partial range');

// Eclipses. The annular eclipse of 14 Oct 2023: magnitude 0.95204 at
// greatest eclipse, obscuration 0.90638 (central, so magnitude squared).
check(Math.abs(1 - visibleFraction(1, 0.95204, 0) - 0.90638) < 5e-5, `2023 annular: obscuration ${(1 - visibleFraction(1, 0.95204, 0)).toFixed(5)} (0.90638)`);
// The total eclipse of 8 Apr 2024: magnitude 1.0566, the disc fully hidden.
check(visibleFraction(1, 1.0566, 0.03) === 0, '2024 total: none of the disc seen');
// Venus's transit of 6 Jun 2012: its disc about 58" across on the Sun's
// 1891", so it hides (29/945.5)^2, about 0.09 %.
const vt = 1 - visibleFraction(945.5, 29, 400);
check(Math.abs(vt - (29 / 945.5) ** 2) < 1e-12, `2012 Venus transit hides ${(vt * 100).toFixed(3)} % of the disc`);

// Seen from a point: the deepest body counts, and says who casts it.
{
  const AU = 149597870.7;
  const sl = sunlight([AU, 0, 0], [{ key: 'earth', rel: [-10000, 0, 0], radius: 6378 }, { key: 'moon', rel: [0, 384400, 0], radius: 1737.4 }]);
  check(sl.state === 'lit' && sl.nu === 1 && sl.by === null, 'nothing between the point and the Sun: lit');
  const sl2 = sunlight([AU, 0, 0], [{ key: 'earth', rel: [10000, 0, 0], radius: 6378 }, { key: 'moon', rel: [0, 384400, 0], radius: 1737.4 }]);
  check(sl2.state === 'umbra' && sl2.by === 'earth', 'the Earth ahead: its umbra');
  const ant = sunlight([AU, 0, 0], [{ key: 'moon', rel: [384400, 0, 0], radius: 1737.4 }]);
  check(ant.state === 'penumbra' && ant.nu > 0 && ant.nu < 0.1, `past the Moon's umbra's tip (374,000 km), on its line: annular, ${(ant.nu * 100).toFixed(1)} % of the Sun left`);
  check(Math.abs(sunVisible([AU, 0, 0], [400000, 0, 0], 1737.4) - visibleFraction(Math.asin(695700 / AU), Math.asin(1737.4 / 400000), 0)) < 1e-12,
    'sunVisible is the overlap of the two discs seen from the point');
}

if (failed) { console.log(`\n${failed} disc check(s) failed`); process.exit(1); }
console.log('\ndiscs: all checks passed');
