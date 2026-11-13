// src/physics/zonal.js
//
// The oblateness term of a body's gravity: the J2 (degree 2, order 0) zonal
// harmonic. Relative to the body's centre, at d = r_craft - r_body with
// z = d . p (p the body's spin pole, unit, J2000 equatorial):
//
//   a_J2 = (3/2) J2 mu R^2 / |d|^5 [ (5 z^2/|d|^2 - 1) d - 2 z p ]
//
// R is the reference radius the J2 value was fitted with. In the body's own
// frame this is the familiar
//   a_x = -(3/2) J2 mu R^2 x / |d|^5 (1 - 5 z^2/|d|^2), and the same for y,
//   a_z = -(3/2) J2 mu R^2 z / |d|^5 (3 - 5 z^2/|d|^2).
//
// Only the direct term on the craft is applied. The matching force on the
// body itself (the Sun's and Moon's pull on its bulge) is already in its
// ephemeris. Beyond ZONAL_CUTOFF reference radii the term is left out: there
// it is under 1.5 J2 / 100^2 of the body's point-mass pull (2e-7 for Earth).

export const ZONAL_CUTOFF = 100;

// Adds the J2 acceleration of body b ({ mu, j2, rJ2, pole }) at the
// craft-minus-body offset (dx, dy, dz), with d2 = |d|^2, into out.
export function addJ2(dx, dy, dz, d2, b, out) {
  const p = b.pole;
  const z = dx * p[0] + dy * p[1] + dz * p[2];
  const k = 1.5 * b.j2 * b.mu * b.rJ2 * b.rJ2 / (d2 * d2 * Math.sqrt(d2));
  const q = 5 * z * z / d2 - 1;
  out[0] += k * (q * dx - 2 * z * p[0]);
  out[1] += k * (q * dy - 2 * z * p[1]);
  out[2] += k * (q * dz - 2 * z * p[2]);
}

// Below a body's surface: its ellipsoid (b.surface = { a, c }, equatorial and
// polar radii, about b.pole) where it has one, else the sphere of b.radius.
// The Earth's is WGS-84, so a craft comes down at sea level, at 6,378 km on
// the equator and 6,357 km at the poles, not on the mean sphere.
export function below(r, b) {
  if (!(b.radius > 0)) return false;
  const dx = r[0] - b.r[0], dy = r[1] - b.r[1], dz = r[2] - b.r[2];
  const d2 = dx * dx + dy * dy + dz * dz, S = b.surface;
  if (!S || !b.pole) return d2 < b.radius * b.radius;
  if (d2 > S.a * S.a) return false;
  const z = dx * b.pole[0] + dy * b.pole[1] + dz * b.pole[2];
  return (d2 - z * z) / (S.a * S.a) + (z * z) / (S.c * S.c) < 1;
}
