// src/physics/barycentres.js
//
// The barycentres the app can show and centre on, heliocentric J2000
// equatorial (EQJ), km and km/s:
//
//   baryStateEqj(key, date) -> { r, v }
//
// - ssb: the solar system barycentre, DE442's own within 2000-2050 (the
//   Sun's series in deTable.js, negated), blended at the table's ends into
//   what is used outside it,
//     r_SSB = sum(GM_i r_i) / (GM_Sun + sum GM_i)
//   over the planets (Mars to Neptune as systems), Earth, the Moon and
//   Pluto, at their ephemeris positions with DE442's GMs. astronomy-engine's
//   own SSB counts only the four giants, which leaves out the inner
//   planets' pull on the Sun (Earth's alone moves it 450 km).
// - emb: the Earth-Moon barycentre, from Earth and the Moon (DE442).
// - mars-bary ... pluto-bary: each planet system's barycentre, which is
//   what the ephemeris gives for Mars to Pluto (DE442's, and
//   astronomy-engine's outside it: moons.test.mjs shows both).
//
// Checked against JPL Horizons in moons.test.mjs.

import { helioStateEqj, deSsbEqj, blendSsb } from './ephemeris.js';
import { bodyConstants, MU_SUN } from './bodies.js';

const PLANETS = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const GM_PLUTO_SYSTEM = 975.5;                  // DE442 (Pluto and Charon)
const gmOf = (k) => (k === 'pluto' ? GM_PLUTO_SYSTEM : bodyConstants(k).mu);

export const BARY_KEYS = ['ssb', 'emb', 'mars-bary', 'jupiter-bary', 'saturn-bary', 'uranus-bary', 'neptune-bary', 'pluto-bary'];

// GM of everything a barycentre is the centre of (km^3/s^2).
export function baryGm(key) {
  if (key === 'ssb') return MU_SUN + PLANETS.reduce((a, k) => a + gmOf(k), 0);
  if (key === 'emb') return gmOf('earth') + gmOf('moon');
  return gmOf(key.replace('-bary', ''));
}

export function baryStateEqj(key, date) {
  const de = key === 'ssb' ? deSsbEqj(date) : null;
  if (de && de.w === 1) return de.s;
  if (key === 'ssb' || key === 'emb') {
    const members = key === 'ssb' ? PLANETS : ['earth', 'moon'];
    const r = [0, 0, 0], v = [0, 0, 0];
    let total = key === 'ssb' ? MU_SUN : 0;
    for (const k of members) {
      const s = helioStateEqj(k, date), gm = gmOf(k);
      total += gm;
      for (let j = 0; j < 3; j++) { r[j] += gm * s.r[j]; v[j] += gm * s.v[j]; }
    }
    const sum = { r: r.map((x) => x / total), v: v.map((x) => x / total) };
    return de ? blendSsb(de, sum) : sum;
  }
  return helioStateEqj(key.replace('-bary', ''), date);
}
