// src/physics/bodyfacts.js
//
// The slower facts of a body, for the data plate: how fast it turns, its
// solar day, the tilt of its axis, its mean density and escape speed; and,
// for the Sun, how it turns by latitude, its orbit of the Galaxy and how
// far it sits from the solar system's barycentre. Pure: no DOM.
//
// Rotation comes from the IAU WGCCRE 2015 report (Archinal et al. 2018,
// Celestial Mechanics and Dynamical Astronomy 130:22), through
// astronomy-engine's RotationAxis, the model the app already turns the
// bodies' surface maps with (orientation.js):
//   W(d) = W0 + Ẇ d + (periodic terms),   d in days from J2000
// The sidereal rotation period is 360° / |Ẇ|, with Ẇ the mean rate
// (W over 1,000 days, so the Moon's and Mercury's librations average out).
// Its sense: the IAU puts a planet's north pole on the north side of the
// invariable plane, so a planet turning backwards (Venus, Uranus) has
// Ẇ < 0; a dwarf planet's pole is the positive one (right hand), so Ẇ > 0.
// Either way the spin axis is sign(Ẇ) times the pole, and the tilt is its
// angle to the orbit's normal: over 90° the body turns backwards.

import * as Astronomy from 'astronomy-engine';
import { eqjToEcl } from './ephemeris.js';

const BODY = {
  sun: Astronomy.Body.Sun, mercury: Astronomy.Body.Mercury, venus: Astronomy.Body.Venus,
  earth: Astronomy.Body.Earth, moon: Astronomy.Body.Moon, mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter, saturn: Astronomy.Body.Saturn, uranus: Astronomy.Body.Uranus,
  neptune: Astronomy.Body.Neptune, pluto: Astronomy.Body.Pluto,
};

const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const DAY_MS = 86400000;

// G, CODATA 2018, in km^3 kg^-1 s^-2 (GM in km^3/s^2 over G is the mass).
export const G_KM = 6.67430e-20;

const rates = new Map();
/** Mean rate of the prime meridian, deg/day (IAU WGCCRE 2015). */
export function spinRate(key) {
  let r = rates.get(key);
  if (r === undefined) {
    const span = 1000;
    const a = Astronomy.RotationAxis(BODY[key], new Date(J2000_MS));
    const b = Astronomy.RotationAxis(BODY[key], new Date(J2000_MS + span * DAY_MS));
    r = (b.spin - a.spin) / span;
    rates.set(key, r);
  }
  return r;
}

/** Sidereal rotation period, days. */
export const siderealDays = (key) => 360 / Math.abs(spinRate(key));

/** The spin axis (unit, ecliptic J2000): the pole, flipped when Ẇ < 0. */
export function spinAxisEcl(key, date) {
  const ax = Astronomy.RotationAxis(BODY[key], date);
  const s = Math.sign(spinRate(key));
  return eqjToEcl([ax.north.x * s, ax.north.y * s, ax.north.z * s]);
}

const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) / DEG;

/** Axial tilt, deg: the spin axis against the orbit normal r × v (any frame
 *  r and v are in, as long as it is the ecliptic J2000 one). The Sun's is
 *  against the ecliptic's pole. */
export function obliquity(key, date, rel) {
  const n = rel ? unit(cross(rel.r, rel.v)) : [0, 0, 1];
  return angle(spinAxisEcl(key, date), n);
}

/** Solar day, days: the rotation relative to the Sun's direction. ω is the
 *  signed spin rate (negative when the tilt is over 90°) and n the mean
 *  motion about the Sun, both deg/day:  P = 360 / |ω − n|. */
export function solarDays(key, date, rel, orbitDays) {
  const w = 360 / siderealDays(key) * (obliquity(key, date, rel) > 90 ? -1 : 1);
  const n = 360 / orbitDays;
  return 360 / Math.abs(w - n);
}

/** Mean density, kg/m^3: the mass over the volume of the mean sphere. */
export const density = (gm, radiusKm) => (gm / G_KM) / (4 / 3 * Math.PI * radiusKm ** 3) / 1e9;

/** Escape speed from the mean surface, km/s. */
export const escapeSpeed = (gm, radiusKm) => Math.sqrt(2 * gm / radiusKm);

// The Sun turns faster at its equator than near its poles. Howard, Harvey
// & Forgach (1990, Solar Physics 130, 295), from small magnetic features,
// sidereal: ω(φ) = A + B sin²φ + C sin⁴φ, in µrad/s (SunPy's default model).
export const SUN_ROTATION = { A: 2.894, B: -0.428, C: -0.370 };
/** The Sun's sidereal rotation period at latitude φ (deg), days. */
export function sunRotationDays(latDeg) {
  const s2 = Math.sin(latDeg * DEG) ** 2;
  const { A, B, C } = SUN_ROTATION;
  const w = (A + B * s2 + C * s2 * s2) * 1e-6;                // rad/s
  return 2 * Math.PI / w / 86400;
}

// The Sun's orbit of the Galaxy. Sgr A*, at the Galaxy's centre, drifts
// across the sky by 6.379 mas/yr along the Galactic plane (Reid & Brunthaler
// 2004, ApJ 616, 872): the Sun's own motion round it. As an angular rate,
// Ω = 4.74047 µ km/s/kpc (4.74047 km/s is 1 AU/yr), and the period is 2π/Ω,
// whatever the distance to the centre.
export const SGR_A_PROPER_MOTION = 6.379;                     // mas/yr
const KPC_KM = 3.0856775814913673e16;
const YEAR_S = 365.25 * 86400;
/** The Sun's Galactic orbital period, years. */
export function galacticYears(mu = SGR_A_PROPER_MOTION) {
  const omega = 4.74047 * mu;                                  // km/s per kpc
  return 2 * Math.PI * KPC_KM / omega / YEAR_S;
}

/** The solar-system barycentre from the Sun's centre, km (astronomy-engine:
 *  the Sun and the giant planets' masses, r_SSB = Σ μᵢ rᵢ / Σ μ). */
export function sunFromBarycentreKm(date) {
  const v = Astronomy.HelioVector(Astronomy.Body.SSB, date);
  return Math.hypot(v.x, v.y, v.z) * 149597870.7;
}
