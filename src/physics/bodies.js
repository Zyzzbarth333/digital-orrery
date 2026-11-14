// src/physics/bodies.js
//
// The bodies the spacecraft kernel (nbody.js) pulls toward: the planets and
// the Moon, with positions from astronomy-engine (heliocentric J2000
// equatorial, km) interpolated between cached nodes, and GM values from DE442.
//
//   const sys = solarSystemBodies({ epochMs });
//   advance(state, t, { bodiesAt: sys.bodiesAt, muSun: sys.muSun });
//
// Time t is in TT seconds from epochMs (sys.msAt and sys.secondsAt convert). Pluto is left out: its pull at
// 1 AU is about 1e-13 of the Sun's.

import { HermiteEphemeris } from './nbody.js';
import { helioStateEqjAtTt, ttSeconds, utcMsAtTt } from './ephemeris.js';
import { bodyAxesEqj } from './orientation.js';
import { ZONAL_CUTOFF } from './zonal.js';
import { PLANETS } from '../utils/constants.js';

// GM (km^3/s^2) from DE442 (python/data/gm_de442.tpc), matched to what each
// position is. Mercury, Venus and Mars to Neptune are placed at their system
// barycentres, so they carry the whole system's GM (planet plus moons). Earth
// and the Moon are separate bodies with their own GMs. constants.js holds
// planet-only GMs (NAIF 599 etc.), which at a barycentre would leave out the
// moons: Jupiter 2.1e-4, Saturn 2.5e-4, Neptune 2.1e-4 too weak.
const GM = {
  sun: 1.32712440041253311e11,
  mercury: 2.20318685514000026e4,
  venus: 3.24858592000000004e5,
  earth: 3.98600435543530795e5,     // Earth itself (399)
  moon: 4.90280010414134904e3,      // Moon (301)
  mars: 4.28283758157561024e4,      // Mars system barycentre (4)
  jupiter: 1.26712764099999979e8,   // Jupiter system barycentre (5)
  saturn: 3.79405848417999968e7,
  uranus: 5.79455639999999851e6,
  neptune: 6.83652710058039892e6,
};
const MOON_RADIUS = 1737.4;      // km (IAU mean)

// Node spacing per body: tight enough that interpolation error stays well
// under a kilometre (the Moon and Earth's monthly wobble set the inner ones).
const SPACING = {
  mercury: 6 * 3600, venus: 6 * 3600, earth: 2 * 3600, moon: 3600, mars: 6 * 3600,
  jupiter: 86400, saturn: 86400, uranus: 2 * 86400, neptune: 2 * 86400,
};

// Oblateness: J2 (unnormalised, = -sqrt(5) times the normalised C20) and the
// reference radius it was fitted with, each from the field's primary source.
//   Mercury: MESSENGER, JGMESS160A (Konopliv et al. 2020, Icarus 335,
//            113500), PDS Geosciences Node: C20 = -2.250253697653e-5,
//            R = 2440.0 km (permanent tide excluded).
//   Venus:   Magellan, MGNP180U (Konopliv et al. 1999, Icarus 139, 3), PDS
//            shgj180u.a01: C20 = -1.96972335776e-6, R = 6051.0 km.
//   Earth:   EGM2008 (Pavlis et al. 2012, JGR 117, B04406), tide-free
//            C20 = -4.84165143790815e-4, R = 6378.1363 km.
//   Moon:    GRAIL GL0660B (Konopliv et al. 2013, JGR Planets 118, 1415), from
//            jggrx_0660b_sha.tab on the PDS Geosciences Node:
//            C20 = -9.088083466222001e-5, R = 1738.0 km.
//   Mars:    MRO120D, PDS jgmro_120d_sha.tab: C20 = -8.750220924537e-4,
//            R = 3396.0 km (permanent tide excluded).
//   Jupiter: Juno (Durante et al. 2020, GRL 47, e2019GL086572), PDS table
//            GRV_JUGR_SHA_JUP_U_DUR2020: J2 = 14696.5735e-6 unnormalised,
//            R = 71492 km.
//   Saturn:  Cassini's Grand Finale (Iess et al. 2019, Science 364,
//            eaat2965): J2 = 16290.573e-6, R = 60330 km.
//   Uranus:  Jacobson 2014, AJ 148, 76, Table 12: J2 = 3510.7e-6,
//            R = 25559 km.
//   Neptune: Jacobson 2009, AJ 137, 4322, Table 5: J2 = 3408.43e-6,
//            R = 25225 km.
// The pole is the body's spin axis of date (orientation.js), refreshed once a
// simulated day: Earth's moves 0.14" a day.
export const ZONAL = {
  mercury: { j2: 2.250253697653e-5 * Math.sqrt(5), rJ2: 2440.0 },
  venus: { j2: 1.96972335776e-6 * Math.sqrt(5), rJ2: 6051.0 },
  earth: { j2: 4.84165143790815e-4 * Math.sqrt(5), rJ2: 6378.1363 },
  moon: { j2: 9.088083466222001e-5 * Math.sqrt(5), rJ2: 1738.0 },
  mars: { j2: 8.750220924537e-4 * Math.sqrt(5), rJ2: 3396.0 },
  jupiter: { j2: 14696.5735e-6, rJ2: 71492 },
  saturn: { j2: 16290.573e-6, rJ2: 60330 },
  uranus: { j2: 3510.7e-6, rJ2: 25559 },
  neptune: { j2: 3408.43e-6, rJ2: 25225 },
};
const POLE_REFRESH = 86400;   // s
// Surfaces that are not the mean sphere, for impacts (nbody.below): the
// Earth's sea level is the WGS-84 ellipsoid, a = 6378.137 km, 1/f =
// 298.257223563 (NIMA TR8350.2), about the pole of date.
const SURFACE = { earth: { a: 6378.137, c: 6378.137 * (1 - 1 / 298.257223563) } };

export const KERNEL_BODIES = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];

export function bodyConstants(key) {
  if (key === 'moon') return { mu: GM.moon, radius: MOON_RADIUS, parent: 'earth' };
  return { mu: GM[key], radius: PLANETS[key].radius, parent: null };
}

export const MU_SUN = GM.sun;

// zonal: false leaves out every J2 (point masses only), for comparisons.
export function solarSystemBodies({ epochMs, keys = KERNEL_BODIES, zonal = true }) {
  const muSun = GM.sun;
  // t: TT seconds from epochMs (kernelHost.kernelSeconds), so uniform
  // through leap seconds; msAt and secondsAt convert to and from UTC.
  const tt0 = ttSeconds(epochMs);
  const msAt = (t) => utcMsAtTt(tt0 + t), secondsAt = (ms) => ttSeconds(ms) - tt0;
  const list = keys.map((key) => {
    const c = bodyConstants(key);
    const eph = new HermiteEphemeris((t) => helioStateEqjAtTt(key, tt0 + t), SPACING[key]);
    const b = { key, mu: c.mu, radius: c.radius, parent: c.parent, r: [0, 0, 0], eph };
    const z = zonal && ZONAL[key];
    if (z) Object.assign(b, { j2: z.j2, rJ2: z.rJ2, j2Cut2: (ZONAL_CUTOFF * z.rJ2) ** 2, pole: [0, 0, 1], poleT: NaN });
    if (z && SURFACE[key]) b.surface = SURFACE[key];
    return b;
  });
  let lastT = NaN;
  // Returns the same array each call with positions updated in place, so the
  // kernel's inner loop allocates nothing.
  const bodiesAt = (t) => {
    if (t !== lastT) {
      for (const b of list) {
        b.eph.position(t, b.r);
        if (b.j2 && !(Math.abs(t - b.poleT) < POLE_REFRESH)) {
          b.pole = bodyAxesEqj(b.key, new Date(msAt(t)))[2];
          b.poleT = t;
        }
      }
      lastT = t;
    }
    return list;
  };
  return { muSun, bodiesAt, keys, epochMs, msAt, secondsAt };
}
