// src/physics/corona.test.mjs
//
// Baumbach's corona (corona.js): its value at the limb, its fall-off, and
// what it comes to in the scene's units beside the Sun's disc.
//
//   node src/physics/corona.test.mjs

import { baumbach } from './corona.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}

// At the limb: 1e-6 (0.0532 + 1.425 + 2.565) = 4.0432e-6 of the disc's centre.
check(Math.abs(baumbach(1) - 4.0432e-6) < 1e-12, `limb ${baumbach(1).toExponential(4)} of the disc's centre`);
// Falls off steeply close in, then as rho^-2.5 (the F corona's share grows).
const r = [1, 1.5, 2, 3, 4, 6].map(baumbach);
check(r.every((v, i) => i === 0 || v < r[i - 1]), `falls off: ${r.map((v) => v.toExponential(1)).join(', ')}`);
check(Math.abs(baumbach(6) / (1e-6 * 0.0532 * 6 ** -2.5) - 1) < 0.01, 'by 6 radii it is the rho^-2.5 term alone');
check(baumbach(2) / baumbach(1) < 0.01, `under a hundredth of the limb's by 2 radii (${(baumbach(2) / baumbach(1)).toFixed(3)})`);
// In the scene: the disc's centre is 46,000 / 0.805 of white (sun.ts), so the
// inner corona is about a quarter of white, faint but plain in totality.
const centre = 46000 / (0.3 + 0.93 * (2 / 3) - 0.23 * 0.5);
const limb = baumbach(1) * centre;
check(limb > 0.15 && limb < 0.35, `limb in the scene ${limb.toFixed(3)} of white`);

if (failed) { console.log(`\n${failed} corona check(s) failed`); process.exit(1); }
console.log('\ncorona: all checks passed');
