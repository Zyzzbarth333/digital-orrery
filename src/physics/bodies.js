// src/physics/bodies.js
//
// The bodies the spacecraft kernel (nbody.js) pulls toward: the planets, the
// Moon, Pluto and the planets' major moons, with positions from DE442's
// table (astronomy-engine outside 2000-2050; ephemeris.js) and moons.js
// (heliocentric J2000 equatorial, km)
// interpolated between cached nodes, and GM values from DE442 and the NAIF
// satellite kernels.
//
//   const sys = solarSystemBodies({ epochMs });
//   advance(state, t, { bodiesAt: sys.bodiesAt, muSun: sys.muSun });
//
// Time t is in TT seconds from epochMs (sys.msAt and sys.secondsAt convert).
//
// A planet with moons (Mars to Neptune, and Pluto) is one body at its system
// barycentre, with the system's GM, while the craft is far from it: that is
// exact for the moons' monopole, and what is left (their quadrupole) is
// 1e-14 km/s^2 where Jupiter's system splits. Within EXPAND times the
// system's sphere of influence the kernel splits it (focus): the planet at
// its own centre with its own GM and J2, and each moon at its own place with
// its own GM, all from moons.js. The split costs nothing in cruise, where
// the moons' ephemerides are never evaluated. Pluto is in the list at all
// only within REACH of it. docs/physics/nbody-kernel.md#moons.
//
// Which systems are split is state, set by focus(r, t) from the craft's
// position: the kernel calls it at the start and after every step
// (bodiesAt.focus). Each craft should have its own view (sys.view()), so one
// craft's position does not fold up another's system. bodyAt(key, t) finds
// any body, moon or planet centre, whatever the focus.

import { HermiteEphemeris } from './nbody.js';
import { helioStateEqjAtTt, ttSeconds, utcMsAtTt } from './ephemeris.js';
import { bodyAxesEqj } from './orientation.js';
import { ZONAL_CUTOFF } from './zonal.js';
import { MOON_DATA } from './moons.data.js';
import { MAJOR_MOONS_OF, moonStateEqjAtTt, planetOffsetEqjAtTt } from './moons.js';
import { PLANETS } from '../utils/constants.js';

// GM (km^3/s^2) from DE442 (python/data/gm_de442.tpc), matched to what each
// position is. Mercury, Venus and, while the craft is far from them, Mars to
// Pluto are placed at their system barycentres, so they carry the whole
// system's GM (planet plus moons). Earth and the Moon are separate bodies
// with their own GMs. constants.js holds planet-only GMs (NAIF 599 etc.),
// which at a barycentre would leave out the moons: Jupiter 2.1e-4, Saturn
// 2.5e-4, Neptune 2.1e-4 too weak.
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
  pluto: 9.75500000000000000e2,     // Pluto system barycentre (9)
};

// Planet-only GMs (km^3/s^2), for the planet at its own centre when its
// system is split: each from the NAIF satellite kernel that fitted it, as
// its gm_*.tpc file gives it (BODY499_GM etc.). The system GM less these is
// the moons' share: the moons here hold all but 0.02 % of it for Jupiter and
// Saturn and 0.1 % for Neptune and Pluto; Uranus's small moons leave out
// 0.7 % (4.5 km^3/s^2, 8e-7 of the system), Jupiter's 2.4 km^3/s^2.
export const PLANET_GM = {
  mars: 4.282837485735626e4,        // NAIF 499, mar099s (DE440)
  jupiter: 1.266865319003704e8,     // NAIF 599, jup365 (DE440)
  saturn: 3.793120623436167e7,      // NAIF 699, sat441 (DE440)
  uranus: 5.793950610340896e6,      // NAIF 799, ura184 (DE442)
  neptune: 6.835099968446816e6,     // NAIF 899, nep097 (DE441)
  pluto: 8.693261226311508e2,       // NAIF 999, plu060 (DE440)
};
const MOON_RADIUS = 1737.4;      // km (IAU mean)

// Node spacing per body: tight enough that interpolation error stays well
// under a kilometre (the Moon and Earth's monthly wobble set the inner ones).
const SPACING = {
  mercury: 6 * 3600, venus: 6 * 3600, earth: 2 * 3600, moon: 3600, mars: 6 * 3600,
  jupiter: 86400, saturn: 86400, uranus: 2 * 86400, neptune: 2 * 86400, pluto: 2 * 86400,
};

// astronomy-engine's Pluto (outside DE442's table) has velocities that are
// not the derivative of its positions: a Hermite cubic through them is
// 0.4 km out at 6-hour nodes and 3 km at two days. Its velocity here is a
// central difference of the positions over a minute instead (5e-8 of its
// speed from the curve; DE442's own velocity agrees with that).
const DIFFERENCED = new Set(['pluto']);
const differenced = (key, tt0) => (t) => {
  const s = helioStateEqjAtTt(key, tt0 + t), a = helioStateEqjAtTt(key, tt0 + t - 60).r, b = helioStateEqjAtTt(key, tt0 + t + 60).r;
  return { r: s.r, v: [(b[0] - a[0]) / 120, (b[1] - a[1]) / 120, (b[2] - a[2]) / 120] };
};

// A split system's planet centre swings about the barycentre with its moons
// (Jupiter's by 20 km with Io, Pluto's by 2,100 km with Charon): nodes every
// 6 hours hold it to 0.04 km. Each moon about its planet gets the widest
// spacing that divides this and keeps the cubic's error, a n^4 D^4 / 384
// for orbit radius a and mean motion n, under NODE_TOL; Io, Europa,
// Ganymede and Callisto share Io's, since JupiterMoons gives all four at
// once. docs/physics/nbody-kernel.md#moons has the measured errors.
const CENTRE_SPACING = 6 * 3600;
const NODE_TOL = 0.1;               // km
const DIVISORS = [];
for (let d = 1; d <= CENTRE_SPACING; d++) if (CENTRE_SPACING % d === 0) DIVISORS.push(d);
function moonSpacing(key) {
  const m = MOON_DATA[key], n = 2 * Math.PI / (m.P * 86400);
  const D = (384 * NODE_TOL / m.a) ** 0.25 / n;
  return DIVISORS.filter((d) => d <= D).pop();
}
const GALILEAN = ['io', 'europa', 'ganymede', 'callisto'];
export const MOON_SPACING = Object.fromEntries(Object.keys(MOON_DATA).map((k) => [k, moonSpacing(k)]));
for (const k of GALILEAN) MOON_SPACING[k] = Math.min(...GALILEAN.map(moonSpacing));

// A system is split inside EXPAND times its sphere of influence and folded
// up again outside COLLAPSE times it. Inside the sphere a craft may be in
// Encke's method about the planet, whose reference conic needs the planet
// to stay one point, so the split always holds there.
export const EXPAND = 1.25, COLLAPSE = 1.5;

// Pluto is in the list only within REACH of it (and leaves it beyond 1.2
// times that): from 5 AU its pull is 2e-15 km/s^2, a kilometre in a year,
// and the inner solar system never comes within 28 AU of it. Elsewhere it
// would only add a tenth to every force sum.
export const REACH = { pluto: 5 * 1.495978707e8 };
// Faster than any of these planets moves about the Sun (Mars at perihelion,
// 26.5 km/s), with room for its sphere of influence changing size.
const VMAX = 30;                    // km/s

// A moon's heliocentric ephemeris: its planet's centre plus the moon about
// it, each a Hermite cubic. The moon's spacing divides the centre's, so its
// nodes are the sum's (Encke's steps end on the primary's nodes).
class SumEphemeris {
  constructor(a, b) { this.a = a; this.b = b; this.spacing = b.spacing; this.tmp = [0, 0, 0]; }
  position(t, out = [0, 0, 0]) { return this.add(this.a.position(t, out), this.b.position(t, this.tmp)); }
  velocity(t, out = [0, 0, 0]) { return this.add(this.a.velocity(t, out), this.b.velocity(t, this.tmp)); }
  acceleration(t, out = [0, 0, 0]) { return this.add(this.a.acceleration(t, out), this.b.acceleration(t, this.tmp)); }
  add(out, x) { out[0] += x[0]; out[1] += x[1]; out[2] += x[2]; return out; }
}

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
// Pluto and the moons have none here. A split system's J2 stays with the
// planet's centre.
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
// The large moons' degree-2 fields, unnormalised, with the reference radius
// they are referred to (docs/physics/nbody-kernel.md#moons has the sources):
//   Io:       Park et al. 2025, Nature 638, 69 (Juno and Galileo):
//             J2 = 1834.6e-6, C22 = 549.6e-6; R = 1821.6 km (mean radius).
//   Europa:   Gomez Casajus et al. 2021, Icarus 358, 114187 (Galileo
//             reanalysed): J2 = 437.6e-6 (+-77.5), C22 = 138.62e-6;
//             R = 1560.8 km (mean radius), as a JUICE review tabulates them.
//   Ganymede: Gomez Casajus et al. 2022, GRL 49, e2022GL099475 (Juno and
//             Galileo), its dataset (Zenodo 6949645): normalised 5.948167e-5
//             and 6.128513e-5, so J2 = 133.0e-6, C22 = 39.56e-6; R = 2631.2.
//   Callisto: Anderson et al. 2001, Icarus 153, 157: J2 = 32.7e-6, C22 =
//             10.2e-6; R = 2410.3 km, as the same review tabulates them.
//   Titan:    Iess et al. 2010, Science 327, 1367, Table 1 (SOL1):
//             J2 = 31.808e-6, C22 = 9.983e-6; R = 2575 km.
// Each turns with its orbit (x toward the planet, z the orbit's pole).
const MOON_ZONAL = {
  io: { j2: 1834.6e-6, c22: 549.6e-6, rJ2: 1821.6 },
  europa: { j2: 437.6e-6, c22: 138.62e-6, rJ2: 1560.8 },
  ganymede: { j2: 133.0e-6, c22: 39.56e-6, rJ2: 2631.2 },
  callisto: { j2: 32.7e-6, c22: 10.2e-6, rJ2: 2410.3 },
  titan: { j2: 31.808e-6, c22: 9.983e-6, rJ2: 2575 },
};
const POLE_REFRESH = 86400;   // s
// Surfaces that are not the mean sphere, for impacts (nbody.below): the
// Earth's sea level is the WGS-84 ellipsoid, a = 6378.137 km, 1/f =
// 298.257223563 (NIMA TR8350.2), about the pole of date.
const SURFACE = { earth: { a: 6378.137, c: 6378.137 * (1 - 1 / 298.257223563) } };

export const KERNEL_BODIES = ['mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];

// For a planet with moons, its system barycentre's (the body far from it).
export function bodyConstants(key) {
  if (key === 'moon') return { mu: GM.moon, radius: MOON_RADIUS, parent: 'earth' };
  const m = MOON_DATA[key];
  if (m) return { mu: m.gm, radius: m.radiusKm, parent: m.planet };
  return { mu: GM[key], radius: PLANETS[key].radius, parent: null };
}

export const MU_SUN = GM.sun;

// zonal: false leaves out every J2 (point masses only), and moons: false
// never splits a system (the planet stays at its barycentre with the
// system's GM), for comparisons. satellites replaces moons.js as the source
// of the moons, for tests against JPL's own: { moon(key, tt) -> { r, v }
// about the planet's centre, offset(planet, tt) -> { r, v } the centre about
// the barycentre }, EQJ km and km/s at TT seconds past J2000.
export function solarSystemBodies({ epochMs, keys = KERNEL_BODIES, zonal = true, moons = true, satellites = null }) {
  const muSun = GM.sun;
  // t: TT seconds from epochMs (kernelHost.kernelSeconds), so uniform
  // through leap seconds; msAt and secondsAt convert to and from UTC.
  const tt0 = ttSeconds(epochMs);
  const msAt = (t) => utcMsAtTt(tt0 + t), secondsAt = (ms) => ttSeconds(ms) - tt0;
  const sat = satellites ?? { moon: moonStateEqjAtTt, offset: planetOffsetEqjAtTt };
  const withJ2 = (b) => {
    const z = zonal && ZONAL[b.key];
    if (z) Object.assign(b, { j2: z.j2, rJ2: z.rJ2, j2Cut2: (ZONAL_CUTOFF * z.rJ2) ** 2, pole: [0, 0, 1], poleT: NaN });
    if (z && SURFACE[b.key]) b.surface = SURFACE[b.key];
    return b;
  };
  const body = (key, mu, radius, parent, eph) => ({ key, mu, radius, parent, r: [0, 0, 0], eph, t: NaN });

  // Each entry is a body or, for a planet with moons or a reach, a group:
  // { key, bary, centre, moons, soiK, reach }. A group is in one of three
  // states in a view: away (beyond its reach: not in the list), folded (its
  // barycentre) or split (its centre and moons).
  const byKey = new Map();
  const groups = [];
  const entries = keys.map((key) => {
    const c = bodyConstants(key);
    const helio = DIFFERENCED.has(key) ? differenced(key, tt0) : (t) => helioStateEqjAtTt(key, tt0 + t);
    const b = withJ2(body(key, c.mu, c.radius, c.parent, new HermiteEphemeris(helio, SPACING[key])));
    byKey.set(key, b);
    const splits = moons && MAJOR_MOONS_OF[key];
    if (!splits && !REACH[key]) return b;
    const G = { key, bary: b, centre: null, moons: [], soiK: (c.mu / muSun) ** 0.4, reach: REACH[key] ?? Infinity };
    if (splits) {
      // The centre from the barycentre's own cubic (cheap, and smooth) plus
      // the moons' offset.
      const centreAt = (t) => {
        const o = sat.offset(key, tt0 + t), r = b.eph.position(t), v = b.eph.velocity(t);
        return { r: [r[0] + o.r[0], r[1] + o.r[1], r[2] + o.r[2]], v: [v[0] + o.v[0], v[1] + o.v[1], v[2] + o.v[2]] };
      };
      G.centre = withJ2(body(key, PLANET_GM[key], c.radius, null, new HermiteEphemeris(centreAt, CENTRE_SPACING)));
      byKey.set(key, G.centre);
      G.moons = MAJOR_MOONS_OF[key].map((k) => {
        const about = new HermiteEphemeris((t) => sat.moon(k, tt0 + t), MOON_SPACING[k]);
        const m = body(k, MOON_DATA[k].gm, MOON_DATA[k].radiusKm, key, new SumEphemeris(G.centre.eph, about));
        const z = zonal && MOON_ZONAL[k];
        if (z) Object.assign(m, { j2: z.j2, c22: z.c22, rJ2: z.rJ2, j2Cut2: (ZONAL_CUTOFF * z.rJ2) ** 2, pole: [0, 0, 1], axisX: [1, 0, 0], axisY: [0, 1, 0], orbitEph: about });
        byKey.set(k, m);
        return m;
      });
    }
    groups.push(G);
    return G;
  });
  const AWAY = 1, FOLDED = 0, SPLIT = 2;      // a group's state: 2 bits each

  // placed counts position updates, so a view can tell that no other view
  // has moved a body it shares since it last looked.
  let placed = 0;
  const ra = [0, 0, 0], va = [0, 0, 0];
  const place = (b, t) => {
    b.eph.position(t, b.r);
    if (b.orbitEph) {
      // A moon turns with its orbit: x toward the planet, z along the
      // orbit's pole, at every placing.
      b.orbitEph.position(t, ra); b.orbitEph.velocity(t, va);
      const rn = Math.hypot(ra[0], ra[1], ra[2]);
      const zx = ra[1] * va[2] - ra[2] * va[1], zy = ra[2] * va[0] - ra[0] * va[2], zz = ra[0] * va[1] - ra[1] * va[0];
      const zn = Math.hypot(zx, zy, zz);
      const X = b.axisX, Z = b.pole, Y = b.axisY;
      X[0] = -ra[0] / rn; X[1] = -ra[1] / rn; X[2] = -ra[2] / rn;
      Z[0] = zx / zn; Z[1] = zy / zn; Z[2] = zz / zn;
      Y[0] = Z[1] * X[2] - Z[2] * X[1]; Y[1] = Z[2] * X[0] - Z[0] * X[2]; Y[2] = Z[0] * X[1] - Z[1] * X[0];
    } else if (b.j2 && !(Math.abs(t - b.poleT) < POLE_REFRESH)) {
      b.pole = bodyAxesEqj(b.key, new Date(msAt(t)))[2];
      b.poleT = t;
    }
    b.t = t;
    placed++;
  };

  // The body list for each combination of group states, built once.
  const lists = new Map();
  const listFor = (state) => {
    let list = lists.get(state);
    if (!list) {
      list = [];
      for (const e of entries) {
        if (!e.bary) { list.push(e); continue; }
        const g = (state >> (2 * groups.indexOf(e))) & 3;
        if (g === SPLIT) list.push(e.centre, ...e.moons); else if (g === FOLDED) list.push(e.bary);
      }
      lists.set(state, list);
    }
    return list;
  };

  // A group starts away if it has a reach (so a view never focused lists
  // what the kernel listed before the moons), folded otherwise.
  let start = 0;
  groups.forEach((G, i) => { if (G.reach < Infinity) start |= AWAY << (2 * i); });

  const view = () => {
    let state = start, list = listFor(start), lastT = NaN, lastPlaced = -1;
    // Returns the same array for the same states each call, with positions
    // updated in place, so the kernel's inner loop allocates nothing.
    const bodiesAt = (t) => {
      if (t === lastT && placed === lastPlaced) return list;
      for (let i = 0; i < list.length; i++) if (list[i].t !== t) place(list[i], t);
      lastT = t; lastPlaced = placed;
      return list;
    };
    // Moves each group to the state the craft at r calls for: within reach
    // or not, split within EXPAND spheres of influence and folded beyond
    // COLLAPSE. The distance is from the barycentre or the centre, whichever
    // the list has (they differ by under 2,200 km). Each full check notes how
    // far the craft is from the nearest edge; until the craft could have
    // covered that, counting the planets' own motion at up to VMAX, nothing
    // can change and the check is skipped (in low Earth orbit, for weeks).
    const fr = [0, 0, 0];
    let ft = NaN, margin = 0;
    const focus = (r, t) => {
      if (margin > 0) {
        const mx = r[0] - fr[0], my = r[1] - fr[1], mz = r[2] - fr[2];
        if (Math.sqrt(mx * mx + my * my + mz * mz) + VMAX * Math.abs(t - ft) < margin) return;
      }
      let s = state, m = Infinity;
      for (let i = 0; i < groups.length; i++) {
        const G = groups[i], g = (s >> (2 * i)) & 3;
        const b = g === SPLIT ? G.centre : G.bary;
        if (b.t !== t) place(b, t);
        const p = b.r;
        const dx = r[0] - p[0], dy = r[1] - p[1], dz = r[2] - p[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        let n = g;
        if (g === AWAY) { if (d < G.reach) n = FOLDED; } else if (d > 1.2 * G.reach) n = AWAY;
        if (n === AWAY) { m = Math.min(m, Math.abs(d - G.reach)); } else {
          m = Math.min(m, Math.abs(d - 1.2 * G.reach));
          if (G.centre) {
            const R = G.soiK * Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
            if (n === SPLIT ? d > COLLAPSE * R : d < EXPAND * R) n = n === SPLIT ? FOLDED : SPLIT;
            m = Math.min(m, Math.abs(d - (n === SPLIT ? COLLAPSE : EXPAND) * R));
          }
        }
        if (n !== g) s = (s & ~(3 << (2 * i))) | (n << (2 * i));
      }
      if (s !== state) { state = s; list = listFor(s); lastT = NaN; }
      fr[0] = r[0]; fr[1] = r[1]; fr[2] = r[2]; ft = t; margin = m;
    };
    bodiesAt.focus = focus;
    const split = () => groups.filter((_, i) => ((state >> (2 * i)) & 3) === SPLIT).map((G) => G.key);
    return { bodiesAt, focus, split };
  };
  const main = view();

  // Any body by key at t, in the list or not: a planet with moons is its
  // centre.
  const bodyAt = (key, t) => {
    const b = byKey.get(key);
    if (!b) return null;
    if (b.t !== t) place(b, t);
    return b;
  };

  const common = { muSun, bodyAt, keys, systems: groups.filter((G) => G.centre).map((G) => G.key), epochMs, msAt, secondsAt };
  return {
    ...common, bodiesAt: main.bodiesAt, focus: main.focus, split: main.split,
    view: () => { const v = view(); return { ...common, bodiesAt: v.bodiesAt, focus: v.focus, split: v.split }; },
  };
}
