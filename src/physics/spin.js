// src/physics/spin.js
//
// Which way, and how fast, each body turns
// (docs/physics/gravity-guides.md#spin-axes-and-direction): the rate W1 of
// its IAU prime meridian angle W = W0 + W1 d, degrees per day, about its
// IAU pole. W1 > 0 turns it counterclockwise seen from above that pole.
//
// Sun, planets, the Moon and Pluto: the IAU WGCCRE 2015 report (Archinal
// et al. 2018, Celest. Mech. Dyn. Astr. 130:22, tables 1 and 2), as
// astronomy-engine's RotationAxis evaluates them; Earth's is the IAU rate
// (the app turns Earth by ITRF93, whose rate is the same to 1e-8). The
// planets' moons: W1 from NAIF's pck00011 (pck.data.js), the same report.
// A moon with no IAU model is drawn turning with its orbit (orientation.js)
// and so has none here: it is synchronous.
//
// The IAU "north" pole of a planet or moon is the one on the north side of
// the solar system's invariable plane, so a negative W1 is retrograde
// rotation (Venus, Uranus). For dwarf planets the IAU uses the right-hand
// rule instead (the positive pole, W1 > 0): Pluto's lies south of the
// invariable plane, so it too turns retrograde.

import { ROTATION } from './pck.data.js';

export const IAU_W1 = {
  sun: 14.1844,
  mercury: 6.1385108,
  venus: -1.4813688,
  earth: 360.9856235,
  moon: 13.17635815,
  mars: 350.891982443297,
  jupiter: 870.536,          // System III
  saturn: 810.7939024,
  uranus: -501.1600928,
  neptune: 541.1397757,
  pluto: 56.3625225,
};

// { w1 (deg/day), periodDays (sidereal), source } or null for a moon with
// no IAU model (synchronous with its orbit).
export function spinRate(key) {
  const w1 = IAU_W1[key] ?? ROTATION[key]?.pm[1];
  if (w1 === undefined) return null;
  return { w1, periodDays: 360 / Math.abs(w1), source: key in IAU_W1 ? 'IAU WGCCRE 2015' : 'IAU WGCCRE 2015 (NAIF pck00011)' };
}
