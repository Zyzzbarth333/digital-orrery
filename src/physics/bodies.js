// src/physics/bodies.js
//
// The bodies the spacecraft kernel (nbody.js) pulls toward: the planets and
// the Moon, with positions from astronomy-engine (heliocentric J2000
// equatorial, km) interpolated between cached nodes, and GM values from
// constants.js (SPICE).
//
//   const sys = solarSystemBodies({ epochMs });
//   advance(state, t, { bodiesAt: sys.bodiesAt, muSun: sys.muSun });
//
// Time t is in seconds from epochMs (UTC). Pluto is left out: its pull at
// 1 AU is about 1e-13 of the Sun's.

import { HermiteEphemeris } from './nbody.js';
import { helioStateEqj } from './ephemeris.js';
import { GRAVITATIONAL_PARAMETERS, PLANETS } from '../utils/constants.js';

const MOON_GM = 4902.800118;     // km^3/s^2 (DE440)
const MOON_RADIUS = 1737.4;      // km (IAU mean)

// Node spacing per body: tight enough that interpolation error stays well
// under a kilometre (the Moon and Earth's monthly wobble set the inner ones).
const SPACING = {
  mercury: 6 * 3600, venus: 6 * 3600, earth: 2 * 3600, moon: 3600, mars: 6 * 3600,
  jupiter: 86400, saturn: 86400, uranus: 2 * 86400, neptune: 2 * 86400,
};

export const KERNEL_BODIES = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

export function bodyConstants(key) {
  if (key === 'moon') return { mu: MOON_GM, radius: MOON_RADIUS, parent: 'earth' };
  return { mu: GRAVITATIONAL_PARAMETERS[key] / 1e9, radius: PLANETS[key].radius, parent: null };
}

export function solarSystemBodies({ epochMs, keys = KERNEL_BODIES }) {
  const muSun = GRAVITATIONAL_PARAMETERS.sun / 1e9;
  const list = keys.map((key) => {
    const c = bodyConstants(key);
    const eph = new HermiteEphemeris((t) => helioStateEqj(key, new Date(epochMs + t * 1000)), SPACING[key]);
    return { key, mu: c.mu, radius: c.radius, parent: c.parent, r: [0, 0, 0], eph };
  });
  let lastT = NaN;
  // Returns the same array each call with positions updated in place, so the
  // kernel's inner loop allocates nothing.
  const bodiesAt = (t) => {
    if (t !== lastT) {
      for (const b of list) b.eph.position(t, b.r);
      lastT = t;
    }
    return list;
  };
  return { muSun, bodiesAt, keys, epochMs };
}
