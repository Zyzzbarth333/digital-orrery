// src/physics/scintillation.test.mjs
//
// The twinkling model (scintillation.js): the turbulence profile against
// the figures it is named for, the scaling with airmass and height, the
// strong-turbulence limit, and the refractivity of air.
//
//   node src/physics/scintillation.test.mjs

import { hv57, friedR0, isoplanaticAngle, rytovZenith, scintillationIndex, edlenRefractivity, twinkleAt } from './scintillation.js';

let failed = 0;
function check(ok, what) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed++;
}

// Hufnagel-Valley 5/7 is named for r0 = 5 cm and theta0 = 7 urad looking
// straight up at 0.5 um (e.g. pyBSM's hufnagel_valley_turbulence_profile).
check(Math.abs(hv57(0) - (1.7e-14 + 2.7e-16)) < 1e-18, `Cn2 at the ground ${hv57(0).toExponential(3)} m^-2/3`);
const r0 = friedR0(), th0 = isoplanaticAngle();
check(Math.abs(r0 - 0.05) < 0.002, `r0 ${(r0 * 100).toFixed(2)} cm (5)`);
check(Math.abs(th0 - 7e-6) < 0.3e-6, `isoplanatic angle ${(th0 * 1e6).toFixed(2)} urad (7)`);

// Weak turbulence: the scintillation index equals the Rytov variance; it
// grows as sec(z)^(11/6); strong turbulence saturates it near 1 (it peaks
// a little above 1 where the turbulence focuses light, then falls to 1).
const R0 = rytovZenith(0);
check(Math.abs(scintillationIndex(1e-3) / 1e-3 - 1) < 0.01, 'weak: sigma_I^2 = sigma_R^2');
check(R0 > 0.1 && R0 < 0.4, `Rytov variance at the zenith from the ground ${R0.toFixed(3)}`);
const sec60 = 2, sR60 = R0 * sec60 ** (11 / 6);
check(Math.abs(sR60 / R0 - 2 ** (11 / 6)) < 1e-12, `60 deg from the zenith: ${(sR60 / R0).toFixed(3)} x the zenith's (2^(11/6))`);
const big = [10, 100, 1e4].map(scintillationIndex);
check(big.every((v) => v > 0.9 && v < 1.4) && Math.abs(big[2] - 1) < 0.05, `strong: sigma_I^2 ${big.map((v) => v.toFixed(3)).join(', ')} -> 1`);
const mono = [0, 30, 45, 60, 70].map((z) => scintillationIndex(R0 / Math.cos((z * Math.PI) / 180) ** (11 / 6)));
check(mono.every((v, i) => i === 0 || v > mono[i - 1]), `rises with airmass to 70 deg: ${mono.map((v) => v.toFixed(3)).join(' < ')}`);

// Height: most of the turbulence is in the lowest 10 km; above 20 km the
// stars are steady.
const t10 = twinkleAt(10000).R0, t20 = twinkleAt(20000).R0, t30 = twinkleAt(30000).R0;
check(t10 < 0.2 * R0 && t20 < 0.01 * R0 && t30 === 0, `Rytov variance at 10, 20, 30 km: ${(t10 / R0).toFixed(3)}, ${(t20 / R0).toExponential(1)}, ${t30} of the ground's`);

// Edlen (1966) for standard air: n - 1 = 2.7782e-4 at 550 nm; blue bends
// more than red by about 1.5 %.
const n550 = edlenRefractivity(0.55), nb = edlenRefractivity(0.45), nr = edlenRefractivity(0.65);
check(Math.abs(n550 - 2.7782e-4) < 2e-8, `n - 1 at 550 nm ${n550.toExponential(4)}`);
check(nb > nr && Math.abs((nb - nr) / n550 - 0.015) < 0.002, `(n_450 - n_650) / (n - 1) = ${((nb - nr) / n550 * 100).toFixed(2)} %`);

// The eye's share: a few per cent of the scintillation's variance at the
// zenith (the pattern crosses a Fresnel zone in a few ms, the eye averages
// over 0.1 s).
const g = twinkleAt(0);
check(g.tau > 0.02 && g.tau < 0.2, `eye's share of the variance at the zenith ${g.tau.toFixed(3)}`);

if (failed) { console.log(`\n${failed} scintillation check(s) failed`); process.exit(1); }
console.log('\nscintillation: all checks passed');
