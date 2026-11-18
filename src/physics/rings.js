// src/physics/rings.js
//
// The rings of Jupiter, Uranus and Neptune: where each one is, how wide and
// how dense, from published tables (docs/frontend/rings.md). Saturn's come
// from a measured optical-depth profile instead (python/textures/sources.py).
// No three.js here, so the checks run in Node (rings.test.mjs).
//
// Units: km, degrees, days; times are Julian dates in TDB (TT is used for it:
// they differ by under 2 ms). Directions are J2000 equatorial (ICRF).
//
// Longitudes follow French et al. (2024) for Uranus and Porco et al. (1995)
// for Neptune: measured from the ascending node of the planet's equator on
// the J2000 Earth equator, prograde about the ring system's angular momentum,
// in the equator and then, for an inclined ring, along its own plane from
// its node (a "dogleg" longitude).

const D = Math.PI / 180;

// --------------------------------------------------------------- Uranus

// French, R.G., et al. 2024, "The Uranus system from occultation
// observations (1977-2006): rings, pole direction, gravity field, and masses
// of Cressida, Cordelia, and Ophelia", Icarus 411, 115957, Table 5 (keplerian
// elements of each ring's centre (COR) and inner and outer edges (IER, OER))
// and Table 6 (normal modes; the largest at the centre is kept). Epoch TDB
// 1986 Jan 19 12:00. Rings with no fitted eccentricity or inclination
// (eta, delta, lambda; epsilon's and gamma's inclination) had them held at 0.
export const URANUS_EPOCH_JD = 2446450.0;

// Edge: [a, a e, varpi0, varpi-dot]. Centre adds [a sin i, Omega0, Omega-dot].
// mode: [m, A_m (km), delta_m (deg), Omega_p (deg/day)], r -= A_m cos(m (lambda - delta_m - Omega_p t)),
// for m = 0 r -= A_0 cos(Omega_p t + delta_0).
export const URANUS_NARROW = [
  { name: '6', ier: [41835.920, 42.068, 181.733, 2.7620198], oer: [41838.237, 42.930, 181.526, 2.7619237],
    cor: [41837.092, 42.499, 181.657, 2.7619579, 44.643, 89.727, -2.7565287] },
  { name: '5', ier: [42233.577, 80.052, 176.823, 2.6715990], oer: [42236.261, 80.463, 176.851, 2.6715450],
    cor: [42234.893, 80.237, 176.819, 2.6715756, 40.951, 296.068, -2.6663516] },
  { name: '4', ier: [42569.511, 44.931, 256.398, 2.5978170], oer: [42572.743, 45.742, 255.294, 2.5981594],
    cor: [42571.124, 45.347, 255.880, 2.5980293, 23.413, 336.828, -2.5932795] },
  { name: 'alpha', ier: [44714.884, 32.512, 205.885, 2.1851508], oer: [44722.161, 35.335, 206.243, 2.1857991],
    cor: [44718.473, 33.916, 206.074, 2.1855003, 12.005, 203.837, -2.1813455] },
  { name: 'beta', ier: [45656.770, 18.573, 319.589, 2.0309488], oer: [45665.286, 21.745, 316.622, 2.0308319],
    cor: [45661.056, 20.106, 317.925, 2.0308229, 4.004, 232.878, -2.0279790] },
  { name: 'eta', ier: [47174.853, 0, 0, 0], oer: [47177.080, 0, 0, 0], cor: [47176.009, 0, 0, 0, 0, 0, 0],
    mode: [3, 0.600, 75.901, 776.584048] },
  { name: 'gamma', ier: [47624.606, 5.016, 47.274, 1.7516631], oer: [47627.865, 5.470, 47.145, 1.7524301],
    cor: [47626.170, 5.306, 48.720, 1.7514650, 0, 0, 0], mode: [0, 5.509, 311.695, 1145.576845] },
  { name: 'delta', ier: [48297.775, 0, 0, 0], oer: [48302.752, 0, 0, 0], cor: [48300.227, 0, 0, 0, 0, 0, 0],
    mode: [2, 3.169, 170.383, 562.516205] },
  // Lambda: centre only (Table 5); its width is the Ring-Moon Systems Node's 2.3 km.
  { name: 'lambda', ier: [50026.557 - 1.15, 0, 0, 0], oer: [50026.557 + 1.15, 0, 0, 0], cor: [50026.557, 0, 0, 0, 0, 0, 0] },
  { name: 'epsilon', ier: [51120.014, 386.530, 307.089, 1.3632690], oer: [51178.588, 425.242, 307.061, 1.3632618],
    cor: [51149.279, 405.894, 307.076, 1.3632575, 0, 0, 0] },
];

// Fraction of each ring's optical depth in micron dust, which scatters
// forward (lambda is the dusty one of the narrow rings, bright at high
// phase in Voyager images; the others are nearly dust-free).
export const URANUS_DUST = { lambda: 1 };

// The broad, faint rings and dust bands: the Ring-Moon Systems Node's "Vital
// Statistics for Uranus's Rings" (from Nicholson et al. 2018, "The rings of
// Uranus", in Planetary Ring Systems, and Showalter and Lissauer 2006,
// Science 311, 973): [name, centre km, width km, normal optical depth].
// All dust.
export const URANUS_BROAD = [
  ['zeta CC', 30863, 8050, 0.0001], ['zeta C', 36639, 2960, 0.0005], ['dust sheet', 38440, 23200, 0.005],
  ['zeta', 39600, 3500, 0.0045], ['alpha-4', 43027, 3353, 0.002], ['beta-alpha', 44879, 312, 0.002],
  ['eta C', 47201, 40, 0.02], ['delta C', 48289, 15, 0.03], ['lambda C', 49936, 3.1, 0.15],
  ['nu', 67300, 3800, 0.0000056], ['mu', 97700, 17000, 0.0000085],
];

// --------------------------------------------------------------- Neptune

// de Pater, I., et al. 2018, "The rings of Neptune", in Planetary Ring
// Systems (Tiscareno and Murray, eds.), Cambridge University Press,
// Table 5.1 (from Porco et al. 1995): radius, width, normal optical depth,
// dust fraction. Arago has no measured depth and is left out.
export const NEPTUNE_BROAD = [
  ['Galle', 42000, 2000, 1e-4], ['Lassell', 55200, 4000, 1e-4],
];
export const NEPTUNE_NARROW = [
  { name: 'Le Verrier', a: 53200, width: 100, tau: 0.003, dust: 0.5 },
  // The Adams ring outside the arcs; the arcs themselves are ADAMS_ARCS.
  // a = 62932.7 km (Porco 1991, via Giuliatti Winter et al. 2020, Table 2).
  { name: 'Adams', a: 62932.7, width: 15, tau: 0.003, dust: 0.3 },
];
export const ADAMS_ARC_TAU = 0.1, ADAMS_ARC_DUST = 0.5;

// The arcs, at Voyager 2 (1989): leading offsets of each arc's centre from
// Fraternite's and their lengths (deg). Fraternite is 9.6 deg long (de Pater
// et al. 2018); the Ring-Moon Systems Node's "Vital Statistics for Neptune's
// Rings" (from Porco et al. 1995) puts the trailing Egalite 10.7 deg ahead
// of Fraternite, Liberte 12 deg ahead of the leading Egalite, and Courage 7.3
// deg ahead of Liberte; Liberte and Egalite are about 4 deg long and Courage
// 2 (Giuliatti Winter et al. 2020, after Porco 1991). Egalite's 4 deg are
// split as Voyager saw it, about 3 deg trailing and 1 deg leading (Porco 1991).
export const ADAMS_ARCS = [
  { name: 'Fraternite', offset: 0, length: 9.6 },
  { name: 'Egalite 1', offset: 10.7, length: 3 },
  { name: 'Egalite 2', offset: 13.2, length: 1 },
  { name: 'Liberte', offset: 25.2, length: 4 },
  { name: 'Courage', offset: 32.5, length: 2 },
];

// Fraternite's centre, measured: [JD TDB at Neptune, longitude deg].
//  - Voyager 2: 251.88 deg at JD 2447757.0 (Porco et al. 1995, as given by
//    Renner et al. 2014 and Souami et al. 2022);
//  - VLT/NACO, 2007 Aug 31 (MJD 54343.00767 UTC, 29.079 au from Earth):
//    349.01 +/- 0.60 deg (Renner et al. 2014, A&A 563, A133);
//  - VLT/SPHERE, 2016 Aug 23 (MJD 57623.23185137 UTC, 28.959 au):
//    217.43 +/- 0.30 deg (Souami et al. 2022, A&A 657, A134).
// The ground-based epochs are converted to TDB and back by the light time.
// Their mean motions disagree by 1e-3 deg/day (a degree a decade: the arcs
// drift), so the longitude is interpolated between measurements and carried
// on at the nearest pair's rate outside them.
const LIGHT_DAY_PER_AU = 499.004784 / 86400;
export function earthEpochToNeptune(mjdUtc, distanceAu, ttMinusUtcS) {
  return mjdUtc + 2400000.5 + ttMinusUtcS / 86400 - distanceAu * LIGHT_DAY_PER_AU;
}
export const FRATERNITE_FIXES = [
  { jd: 2447757.0, lon: 251.88, sigma: 0.2, source: 'Voyager 2 (Porco et al. 1995)' },
  { jd: earthEpochToNeptune(54343.00767, 29.079, 65.184), lon: 349.01, sigma: 0.6, source: 'VLT/NACO (Renner et al. 2014)' },
  { jd: earthEpochToNeptune(57623.23185137, 28.959, 68.184), lon: 217.43, sigma: 0.3, source: 'VLT/SPHERE (Souami et al. 2022)' },
];
const ARC_N0 = 820.1118;      // deg/day, near every published value; only picks the whole turns

// The unwrapped segment rates between successive fixes.
export function fraterniteRates() {
  const out = [];
  for (let i = 1; i < FRATERNITE_FIXES.length; i++) {
    const a = FRATERNITE_FIXES[i - 1], b = FRATERNITE_FIXES[i];
    const dt = b.jd - a.jd;
    const turns = Math.round((ARC_N0 * dt - (b.lon - a.lon)) / 360);
    out.push((b.lon - a.lon + 360 * turns) / dt);
  }
  return out;
}

// Fraternite's centre longitude (deg, 0-360) at a JD (TDB).
export function fraterniteLongitude(jd) {
  const f = FRATERNITE_FIXES, n = fraterniteRates();
  let i = 0;
  while (i < n.length - 1 && jd > f[i + 1].jd) i++;
  const lon = f[i].lon + n[i] * (jd - f[i].jd);
  return ((lon % 360) + 360) % 360;
}

// --------------------------------------------------------------- Jupiter

// de Pater, I., et al. 2018, "The rings of Jupiter", in Planetary Ring
// Systems, Table 6.1 (from Ockert-Bell et al. 1999, de Pater et al. 1999,
// 2008): radial extent, vertical thickness, normal optical depth. The main
// ring's depth is Throop et al. (2004, Icarus 172, 59): dust 4.7e-6 and
// parent bodies 1.3e-6, the dust inside a bright ~800 km annulus at its
// outer edge. The gossamer rings are dust on the inclined orbits of
// Amalthea and Thebe, drifting inward (Burns et al. 1999, Science 284,
// 1146), so each is as thick as its moon's orbit is tilted (moons.data.js:
// 0.4 and 1.1 deg) and densest toward its top and bottom edges.
export const JUPITER = {
  halo: { inner: 100000, outer: 122400, tau: 1e-6 },
  main: { inner: 122400, outer: 129100, annulus: 800, tauDust: 4.7e-6, tauBodies: 1.3e-6, thickness: 100 },
  amalthea: { inner: 122400, outer: 181350, tau: 1e-7, inclination: 0.4 },
  thebe: { inner: 122400, outer: 221900, tau: 1e-8, inclination: 1.1 },
  thebeExtension: { inner: 221900, outer: 270000, tau: 1e-9, thickness: 9000 },
};

// ------------------------------------------------------- ring geometry

/** A ring edge's (or centre's) elements at a JD: a, e, varpi (deg). */
export function edgeAt(edge, jd) {
  const [a, ae, w0, wdot] = edge;
  return { a, e: ae / a, varpi: w0 + wdot * (jd - URANUS_EPOCH_JD) };
}

/** Radius of a ring edge at true longitude lambda (deg) and JD, with the
 * ring's normal mode if it has one. */
export function edgeRadius(ring, which, lambda, jd) {
  const { a, e, varpi } = edgeAt(ring[which], jd);
  let r = (a * (1 - e * e)) / (1 + e * Math.cos((lambda - varpi) * D));
  if (ring.mode) r -= modeOffset(ring.mode, lambda, jd);
  return r;
}

export function modeOffset(mode, lambda, jd) {
  const [m, A, delta, Op] = mode;
  const t = jd - URANUS_EPOCH_JD;
  return m === 0 ? A * Math.cos((Op * t + delta) * D) : A * Math.cos(m * (lambda - delta - Op * t) * D);
}

/** A ring's radial width at a longitude (km). */
export function ringWidth(ring, lambda, jd) {
  return edgeRadius(ring, 'oer', lambda, jd) - edgeRadius(ring, 'ier', lambda, jd);
}

/** Inclination (deg) and node (deg) of a ring's plane at a JD. */
export function ringPlaneAt(ring, jd) {
  const [a, , , , asini, O0, Odot] = ring.cor;
  return { i: Math.asin(asini / a) / D, node: O0 + Odot * (jd - URANUS_EPOCH_JD) };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

/** The reference direction of ring longitudes: the ascending node of the
 * equator (whose pole is P, the system's angular momentum) on the J2000
 * Earth equator, and the direction 90 deg ahead of it. */
export function equatorNode(pole) {
  const N = norm(cross([0, 0, 1], pole));
  return { N, Q: cross(pole, N) };
}

/** A ring plane's axes: X its ascending node on the equator, Y 90 deg
 * ahead along the ring, n its normal; a point at dogleg longitude lambda
 * lies along cos(lambda - node) X + sin(lambda - node) Y. */
export function ringAxes(pole, iDeg, nodeDeg) {
  const { N, Q } = equatorNode(pole);
  const c = Math.cos(nodeDeg * D), s = Math.sin(nodeDeg * D);
  const X = [c * N[0] + s * Q[0], c * N[1] + s * Q[1], c * N[2] + s * Q[2]];
  const PX = cross(pole, X);
  const ci = Math.cos(iDeg * D), si = Math.sin(iDeg * D);
  const Y = [ci * PX[0] + si * pole[0], ci * PX[1] + si * pole[1], ci * PX[2] + si * pole[2]];
  return { X, Y, n: cross(X, Y) };
}

/** JD (TDB, as TT) from TT seconds past J2000 (ephemeris.ttSeconds). */
export const jdFromTt = (tt) => 2451545.0 + tt / 86400;

// ------------------------------------------------------------ photometry

// Ring particles: geometric albedo, the A of the ring layer's
// single-scattering reflectance (docs/frontend/lighting.md#saturns-rings):
// Uranus's and Neptune's about 0.015 (NASA NSSDC ring fact sheets), the
// parent bodies of Jupiter's main ring 0.05, Adrastea's (de Pater et al. 2018).
export const PARTICLE_ALBEDO = { jupiter: 0.05, uranus: 0.015, neptune: 0.015 };

// Dust: micron grains, single-scattering albedo DUST.albedo, phase function
// P(theta) (theta the scattering angle, 0 straight on; normalised so its
// mean over the sphere is 1) half isotropic, half a Henyey-Greenstein lobe of
// asymmetry g. Shaped to Throop et al. (2004): flat from 1 to about 130 deg
// phase, then rising to tens of times brighter in forward scattering; with
// the main ring's dust depth this gives a normal I/F of a few 1e-6 at high
// phase and near 1e-7 at low phase, as Galileo and Keck measured
// (de Pater et al. 2018, Figs. 6.3 and 6.5).
export const DUST = { albedo: 0.3, g: 0.7, lobe: 0.5 };

export function dustPhase(thetaDeg) {
  const { g, lobe } = DUST;
  const c = Math.cos(thetaDeg * D);
  return (1 - lobe) + lobe * (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5);
}

/** Normal reflectance (mu I/F) of an optically thin layer of dust of
 * normal depth tau at phase angle alpha (deg). */
export function dustNormalIF(tau, alphaDeg) {
  return (DUST.albedo * dustPhase(180 - alphaDeg) / 4) * tau;
}
