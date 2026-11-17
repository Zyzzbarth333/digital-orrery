// src/physics/impact.js
//
// Where inside a step the craft met a surface (docs/physics/nbody-kernel.md#impacts).
//
// The kernel tests for the ground at the end of each step, so a step that
// ends below a surface has crossed it somewhere inside. Each integrator
// hands over its continuous extension of the step just taken (state(s) for
// s in [0, 1] of the step: Dormand-Prince's dense output, or a cubic
// Hermite through the step's ends for Yoshida's and the leapfrog), and the
// crossing is the first root of the surface's level along it:
//
//   L(s) = sqrt( (|d|^2 - z^2) / a^2 + z^2 / c^2 ) - 1,
//
// d the craft less the body's centre at the time of s, z = d . pole, a and c
// the body's equatorial and polar radii (zonal.js below(): the ellipsoid
// where the body has one, else the sphere, where L = |d| / R - 1). L is
// negative exactly where below() is true, and near the surface it is the
// height over the local radius.
//
// The root: L sampled at eighths of the step for the first sign change
// (so a step that dips in and out and in again is caught at the first
// entry), then the Illinois form of regula falsi down to a microsecond.

// The surface's level L (above) at heliocentric r for body b; for the Sun,
// b = { radius } with its centre at the origin.
export function surfaceLevel(r, b) {
  const c = b.r ?? ORIGIN;
  const dx = r[0] - c[0], dy = r[1] - c[1], dz = r[2] - c[2];
  const d2 = dx * dx + dy * dy + dz * dz, S = b.surface;
  if (!S || !b.pole) return Math.sqrt(d2) / b.radius - 1;
  const z = dx * b.pole[0] + dy * b.pole[1] + dz * b.pole[2];
  return Math.sqrt((d2 - z * z) / (S.a * S.a) + (z * z) / (S.c * S.c)) - 1;
}
const ORIGIN = [0, 0, 0];

// The first s in (0, 1] where level(s) changes sign from positive, for a
// step of |H| seconds: level(0) > 0 >= level(1) is the usual case. Returns
// null when level(0) is not above the surface (the step began below it).
const SAMPLES = 8;
const T_TOL = 1e-6;   // s
export function firstCrossing(level, H) {
  let s0 = 0, f0 = level(0);
  if (!(f0 > 0)) return null;
  let s1 = 1, f1 = NaN;
  for (let k = 1; k <= SAMPLES; k++) {
    const s = k / SAMPLES, f = level(s);
    if (!(f > 0)) { s1 = s; f1 = f; break; }
    s0 = s; f0 = f;
  }
  if (Number.isNaN(f1)) return 1;   // no sign change on the samples: the end, as before
  const tol = T_TOL / Math.max(Math.abs(H), T_TOL);
  let side = 0;
  for (let i = 0; i < 100 && s1 - s0 > tol; i++) {
    let s = (s0 * f1 - s1 * f0) / (f1 - f0);
    if (!(s > s0 && s < s1)) s = 0.5 * (s0 + s1);
    const f = level(s);
    if (f > 0) { s0 = s; f0 = f; if (side === -1) f1 *= 0.5; side = -1; } else { s1 = s; f1 = f; if (side === 1) f0 *= 0.5; side = 1; }
    if (f === 0) return s;
  }
  // The end at or just below the surface, so the state reported is on it
  // to a microsecond and below() holds there.
  return s1;
}

// Hairer, Norsett & Wanner's dense output for Dormand-Prince 5(4)
// (Solving ODEs I, 2nd ed., sec. II.6, the continuous extension of order
// 4 that DOPRI5 uses): from the step's start y0, end y1, the step H and its
// seven stage derivatives K (K[6] the derivative at the end), the state at
// a fraction s of the step, into out.
const D1 = -12715105075 / 11282082432, D3 = 87487479700 / 32700410799, D4 = -10690763975 / 1880347072;
const D5 = 701980252875 / 199316789632, D6 = -1453857185 / 822651844, D7 = 69997945 / 29380423;
export function dp45Dense(y0, y1, k1, K, H, s, out) {
  const s1 = 1 - s;
  for (let i = 0; i < y0.length; i++) {
    const dy = y1[i] - y0[i];
    const b = H * k1[i] - dy;
    const c = dy - H * K[6][i] - b;
    const d = H * (D1 * k1[i] + D3 * K[2][i] + D4 * K[3][i] + D5 * K[4][i] + D6 * K[5][i] + D7 * K[6][i]);
    out[i] = y0[i] + s * (dy + s1 * (b + s * (c + s1 * d)));
  }
  return out;
}

// The cubic Hermite through a step's ends (r0, v0 at its start, r1, v1 at
// its end, H long) at fraction s: position into rOut, its derivative into
// vOut. For Yoshida's and the leapfrog, whose steps are short (1 % of the
// local dynamical time near a surface): the cubic errs by about
// H^4 |r''''| / 384, 1e-10 km on a 14 s step falling onto Ganymede.
export function hermiteAt(r0, v0, r1, v1, H, s, rOut, vOut) {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s) * H, h01 = -2 * s3 + 3 * s2, h11 = (s3 - s2) * H;
  const d00 = (6 * s2 - 6 * s) / H, d10 = 3 * s2 - 4 * s + 1, d01 = (-6 * s2 + 6 * s) / H, d11 = 3 * s2 - 2 * s;
  for (let i = 0; i < 3; i++) {
    rOut[i] = h00 * r0[i] + h10 * v0[i] + h01 * r1[i] + h11 * v1[i];
    vOut[i] = d00 * r0[i] + d10 * v0[i] + d01 * r1[i] + d11 * v1[i];
  }
}

// The impact inside a step from t over H on body key ('sun' for the Sun,
// of radius sunRadius at the origin). stateAt(s, r, v) writes the craft's
// heliocentric place and velocity at fraction s of the step. Returns the
// fraction s of the crossing (1 when the step began below the surface: the
// end, as the kernel always had it) and, there, the time, place and
// velocity, and the speed relative to the body's centre (km/s).
export function locateImpact(key, t, H, tEnd, stateAt, bodiesAt, sunRadius) {
  const r = [0, 0, 0], v = [0, 0, 0];
  const sun = { radius: sunRadius };
  const bodyAt = (tt) => (key === 'sun' ? sun : bodiesAt(tt).find((b) => b.key === key));
  const timeOf = (s) => (s === 1 ? tEnd : t + s * H);
  const s = firstCrossing((x) => { stateAt(x, r, v); return surfaceLevel(r, bodyAt(timeOf(x))); }, H) ?? 1;
  const tc = timeOf(s);
  stateAt(s, r, v);
  const b = bodyAt(tc), vb = b?.eph ? b.eph.velocity(tc) : ORIGIN;
  const speed = Math.hypot(v[0] - vb[0], v[1] - vb[1], v[2] - vb[2]);
  return { s, t: tc, r, v, speed };
}
