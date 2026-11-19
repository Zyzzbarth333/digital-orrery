// packages/physics/src/umbra.js
//
// Sunlight bent into a planet's shadow by its atmosphere: why the Moon in
// a total lunar eclipse is copper, not black (docs/frontend/lighting.md#eclipses).
//
// A ray of sunlight grazing the Earth at tangent height h is bent toward
// the shadow's axis by delta(h) = delta0 exp(-h / H): twice the refraction
// at the horizon (34.5', Bennett 1982) at the ground, falling with the
// air's density scale height H. On its way through it loses light to the
// air: Rayleigh scattering, aerosols and ozone, the same medium the sky is
// drawn with (atmosphere.ts, Bruneton's reference model), integrated along
// the straight tangent path. A point a distance L behind the planet and rho
// off the shadow's axis (both in planet radii) is reached from the near
// limb by rays bent by (1 - rho) / L, and from the far limb by rays bent
// across the axis by (1 + rho) / L. Each limb's annulus of width dh at
// radius 1 spreads over a ring of radius rho and width L |d delta / dh| dh
// = L delta dh / H, so its irradiance, relative to direct sunlight, is
//
//     E / E0 = T(h) H / (rho L delta),
//
// the classical refraction-and-extinction model of the eclipsed Moon (Link
// 1969; García Muñoz and Pallé 2011 add the scattered light it leaves out).
// The axis is a focus (rho -> 0); the Sun's disc, a radians across,
// spreads it over rho ~ L a. Clouds, which cut off the lowest rays, and
// volcanic aerosols, which darken some eclipses by magnitudes (the Danjon
// scale), are left out: this is a clear sky. Pure ES module.

export const REFRACTION_HORIZON_RAD = (34.5 / 60) * (Math.PI / 180);   // Bennett 1982 at 0 deg altitude
export const DEFLECTION_GROUND_RAD = 2 * REFRACTION_HORIZON_RAD;       // in and out: about 1.15 deg
export const REFRACTIVITY_SCALE_KM = 8;                                 // the density's scale height

// The Earth's shadow on the Moon is that of the Earth enlarged by an
// occulting layer 87 km high, uniform over its oblate figure (Herald and
// Sinnott 2014, from 22,539 crater timings in 94 lunar eclipses; Danjon's
// 1951 rule took 75 km, the older almanacs 2 % of the shadow).
export const EARTH_OCCULTING_KM = 87;

// The umbra's and penumbra's angular radii (rad) seen from the Earth's
// centre at the Moon's distance dMoon (km), with the Sun dSun away: the
// Earth's parallax there plus the Sun's, less or plus its semi-diameter.
export function shadowRadii(dMoon, dSun, earthKm = 6371.0 + EARTH_OCCULTING_KM, sunKm = 695700) {
  const pm = Math.asin(earthKm / dMoon), ps = Math.asin(earthKm / dSun), s = Math.asin(sunKm / dSun);
  return { umbra: pm + ps - s, penumbra: pm + ps + s };
}

// Extinction (1/km) at height z km in an atmosphere.js / atmosphere.ts medium.
function extinction(atmo, z, out) {
  const r = Math.exp(-z / atmo.rayleighHKm), m = Math.exp(-z / atmo.mieHKm);
  const o = Math.max(0, 1 - Math.abs(z - atmo.ozoneCentreKm) / atmo.ozoneHalfWidthKm);
  for (let i = 0; i < 3; i++) out[i] = atmo.rayleigh[i] * r + atmo.mieExtinct[i] * m + atmo.ozone[i] * o;
  return out;
}

// The transmittance [R, G, B] of a straight ray through the whole
// atmosphere that passes radiusKm + hKm from the planet's centre.
export function grazingTransmittance(atmo, hKm, radiusKm, steps = 400) {
  const r0 = radiusKm + hKm, rTop = radiusKm + atmo.topKm;
  if (r0 >= rTop) return [1, 1, 1];
  const sMax = Math.sqrt(rTop * rTop - r0 * r0);
  const tau = [0, 0, 0], k = [0, 0, 0];
  // Steps finer near the tangent point, where the air is densest: s = sMax u^2.
  for (let i = 0; i < steps; i++) {
    const u0 = i / steps, u1 = (i + 1) / steps, um = (u0 + u1) / 2;
    const s = sMax * um * um, ds = sMax * (u1 * u1 - u0 * u0);
    extinction(atmo, Math.hypot(r0, s) - radiusKm, k);
    for (let c = 0; c < 3; c++) tau[c] += 2 * k[c] * ds;              // both halves of the path
  }
  return tau.map((t) => Math.exp(-t));
}

// The tangent height (km) whose rays are bent by delta (rad), or null for
// a bend larger than the air at the ground gives.
export function tangentHeight(delta) {
  if (!(delta > 0) || delta > DEFLECTION_GROUND_RAD) return null;
  return REFRACTIVITY_SCALE_KM * Math.log(DEFLECTION_GROUND_RAD / delta);
}

// The table the shaders interpolate: T(h) at n heights from 0 to maxKm.
export function umbraTable(atmo, radiusKm, n = 24, maxKm = 60) {
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) t.set(grazingTransmittance(atmo, (maxKm * i) / (n - 1), radiusKm), 3 * i);
  return { table: t, n, maxKm };
}

// The light refracted to a point L planet radii behind the planet, rho
// radii off the axis, relative to direct sunlight [R, G, B]; sunAngle is
// the Sun's angular radius seen from there (rad).
export function umbraLight(atmo, radiusKm, L, rho, sunAngle = 0.00465) {
  const H = REFRACTIVITY_SCALE_KM / radiusKm;
  const rhoEff = Math.hypot(rho, L * sunAngle);
  const out = [0, 0, 0];
  for (const delta of [(1 - rho) / L, (1 + rho) / L]) {
    const h = tangentHeight(delta);
    if (h === null) continue;
    const T = grazingTransmittance(atmo, h, radiusKm);
    const dilution = Math.min(1, H / (rhoEff * L * delta));
    for (let c = 0; c < 3; c++) out[c] += T[c] * dilution;
  }
  return out;
}
