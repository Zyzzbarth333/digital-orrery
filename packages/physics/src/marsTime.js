// packages/physics/src/marsTime.js
//
// Mars's calendar: the season (areocentric solar longitude, Ls) and the
// Mars year (MY) at a UTC instant, as the Mars dust maps and the
// literature count them (docs/frontend/mars-dust.md).
//
// Ls is the Sun's longitude seen from Mars, from the Martian vernal
// equinox (Ls 0, northern spring) along Mars's orbit: 90 northern summer,
// 180 autumn, 270 winter. It comes from Allison and McEwen's series [1]
// (the Mars24 algorithm): a mean anomaly and fictitious mean Sun, the
// equation of centre to the fifth harmonic, and seven planetary
// perturbation terms, in TT. marsTime.test.mjs checks it against the Sun's
// direction from Mars in DE442 about the IAU pole the scene draws Mars
// turning on.
//
// A Mars year begins at Ls 0. MY 1 is the one that began on 11 April 1955
// (Clancy et al. [2]), so MY 24 began in July 1998 and MY 36 ended in
// December 2022. Pure ES module.
//
// [1] M. Allison and M. McEwen, "A post-Pathfinder evaluation of
//     areocentric solar coordinates with improved timing recipes for Mars
//     seasonal/diurnal climate studies," Planet. Space Sci., vol. 48,
//     no. 2-3, pp. 215-235, 2000, doi: 10.1016/S0032-0633(99)00092-6.
// [2] R. T. Clancy et al., "An intercomparison of ground-based millimeter,
//     MGS TES, and Viking atmospheric temperature measurements: Seasonal
//     and interannual variability of temperatures and dust loading in the
//     global Mars atmosphere," J. Geophys. Res., vol. 105, no. E4,
//     pp. 9553-9571, 2000, doi: 10.1029/1999JE001089.

import { ttSeconds } from './ephemeris.js';

const DEG = Math.PI / 180;
const DAY_MS = 86400e3;
export const SOL_S = 88775.244147;                   // the mean solar day [1]
// About a Mars year (days), only to guess where an equinox is before the
// series finds it.
const YEAR_GUESS_D = 686.9726;
// Ls 0 of MY 1 [2]: 11 April 1955, near 00 UTC; found exactly by the series.
const MY1_GUESS_MS = Date.UTC(1955, 3, 11);

// The perturbations' amplitude (deg), period (Julian years) and phase (deg) [1, Table 5].
const PBS = [
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095],
];

const wrap360 = (x) => ((x % 360) + 360) % 360;
const wrap180 = (x) => wrap360(x + 180) - 180;

// Ls (deg, 0 to 360) at a UTC instant (Unix ms) [1, eqs. 14-19].
export function marsLs(ms) {
  const dt = ttSeconds(ms) / 86400;                  // TT days past J2000
  const M = (19.3871 + 0.52402073 * dt) * DEG;
  const alphaFms = 270.3871 + 0.524038496 * dt;
  let pbs = 0;
  for (const [A, tau, phi] of PBS) pbs += A * Math.cos(((0.985626 * dt) / tau + phi) * DEG);
  const eoc = (10.691 + 3.0e-7 * dt) * Math.sin(M) + 0.623 * Math.sin(2 * M) + 0.050 * Math.sin(3 * M)
    + 0.005 * Math.sin(4 * M) + 0.0005 * Math.sin(5 * M) + pbs;
  return wrap360(alphaFms + eoc);
}

// The instant (ms) at which a Mars year began (Ls 0), to well under a second.
export function marsYearStart(my) {
  let t = MY1_GUESS_MS + (my - 1) * YEAR_GUESS_D * DAY_MS;
  for (let k = 0; k < 20; k++) {
    const rate = wrap180(marsLs(t + DAY_MS / 2) - marsLs(t - DAY_MS / 2)) / DAY_MS;   // deg per ms
    const step = wrap180(marsLs(t)) / rate;
    t -= step;
    if (Math.abs(step) < 1) break;
  }
  return t;
}

// The Mars year, its Ls and the sols since its start, at a UTC instant.
export function marsSeason(ms) {
  let my = Math.floor((ms - MY1_GUESS_MS) / (YEAR_GUESS_D * DAY_MS)) + 1;
  let start = marsYearStart(my);
  if (ms < start) start = marsYearStart(--my);
  else {
    const next = marsYearStart(my + 1);
    if (ms >= next) { my++; start = next; }
  }
  return { my, ls: marsLs(ms), sol: (ms - start) / (SOL_S * 1000) };
}

// The instant within a Mars year at which Ls reaches a value (deg).
export function marsLsTime(my, ls) {
  const start = marsYearStart(my), end = marsYearStart(my + 1);
  let t = start + (wrap360(ls) / 360) * (end - start);
  for (let k = 0; k < 20; k++) {
    const rate = wrap180(marsLs(t + DAY_MS / 2) - marsLs(t - DAY_MS / 2)) / DAY_MS;
    const step = wrap180(marsLs(t) - ls) / rate;
    t -= step;
    if (Math.abs(step) < 1) break;
  }
  return t;
}
