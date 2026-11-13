// src/physics/earthRotation.js
//
// The rotation from J2000 (mean equator and equinox of J2000) to the
// Earth-fixed frame of date, the "RNP" matrix of NASA's 6-DOF check cases
// (docs/validation.md#nesc-6-dof-check-cases), from the classical IAU models
// those simulations use:
//   precession  IAU 1976 (Lieske et al. 1977)
//   nutation    IAU 1980 (Wahr), the full 106-term series
//   sidereal    GMST (IAU 1982, Aoki et al.) plus the equation of the
//               equinoxes, so Greenwich apparent sidereal time
//   polar motion  none (the check cases hold it at zero)
// M(t) = R3(GAST) N P, so r_ecef = M r_j2000. Pure ES module.
//
// The nutation series and its fundamental arguments are NAIF's (CSPICE
// zzwahr.c, from the Explanatory Supplement to the Astronomical Almanac,
// 1992, pp. 114-115). Each row: the multiples of l, l', F, D and Omega;
// then d_psi's coefficient and its rate, and d_eps's coefficient and its
// rate, in units of 0.0001" and 0.0001" per Julian millennium.

const AS2R = Math.PI / (180 * 3600);
const D2R = Math.PI / 180;
const DAY_S = 86400;
const JD_J2000 = 2451545.0;
const MJD_UNIX = 2440587.5;    // JD of the Unix epoch

const NUT80 = [
  [0, 0, 0, 0, 1, -171996, -1742, 92025, 89],
  [0, 0, 0, 0, 2, 2062, 2, -895, 5],
  [-2, 0, 2, 0, 1, 46, 0, -24, 0],
  [2, 0, -2, 0, 0, 11, 0, 0, 0],
  [-2, 0, 2, 0, 2, -3, 0, 1, 0],
  [1, -1, 0, -1, 0, -3, 0, 0, 0],
  [0, -2, 2, -2, 1, -2, 0, 1, 0],
  [2, 0, -2, 0, 1, 1, 0, 0, 0],
  [0, 0, 2, -2, 2, -13187, -16, 5736, -31],
  [0, 1, 0, 0, 0, 1426, -34, 54, -1],
  [0, 1, 2, -2, 2, -517, 12, 224, -6],
  [0, -1, 2, -2, 2, 217, -5, -95, 3],
  [0, 0, 2, -2, 1, 129, 1, -70, 0],
  [2, 0, 0, -2, 0, 48, 0, 1, 0],
  [0, 0, 2, -2, 0, -22, 0, 0, 0],
  [0, 2, 0, 0, 0, 17, -1, 0, 0],
  [0, 1, 0, 0, 1, -15, 0, 9, 0],
  [0, 2, 2, -2, 2, -16, 1, 7, 0],
  [0, -1, 0, 0, 1, -12, 0, 6, 0],
  [-2, 0, 0, 2, 1, -6, 0, 3, 0],
  [0, -1, 2, -2, 1, -5, 0, 3, 0],
  [2, 0, 0, -2, 1, 4, 0, -2, 0],
  [0, 1, 2, -2, 1, 4, 0, -2, 0],
  [1, 0, 0, -1, 0, -4, 0, 0, 0],
  [2, 1, 0, -2, 0, 1, 0, 0, 0],
  [0, 0, -2, 2, 1, 1, 0, 0, 0],
  [0, 1, -2, 2, 0, -1, 0, 0, 0],
  [0, 1, 0, 0, 2, 1, 0, 0, 0],
  [-1, 0, 0, 1, 1, 1, 0, 0, 0],
  [0, 1, 2, -2, 0, -1, 0, 0, 0],
  [0, 0, 2, 0, 2, -2274, -2, 977, -5],
  [1, 0, 0, 0, 0, 712, 1, -7, 0],
  [0, 0, 2, 0, 1, -386, -4, 200, 0],
  [1, 0, 2, 0, 2, -301, 0, 129, -1],
  [1, 0, 0, -2, 0, -158, 0, -1, 0],
  [-1, 0, 2, 0, 2, 123, 0, -53, 0],
  [0, 0, 0, 2, 0, 63, 0, -2, 0],
  [1, 0, 0, 0, 1, 63, 1, -33, 0],
  [-1, 0, 0, 0, 1, -58, -1, 32, 0],
  [-1, 0, 2, 2, 2, -59, 0, 26, 0],
  [1, 0, 2, 0, 1, -51, 0, 27, 0],
  [0, 0, 2, 2, 2, -38, 0, 16, 0],
  [2, 0, 0, 0, 0, 29, 0, -1, 0],
  [1, 0, 2, -2, 2, 29, 0, -12, 0],
  [2, 0, 2, 0, 2, -31, 0, 13, 0],
  [0, 0, 2, 0, 0, 26, 0, -1, 0],
  [-1, 0, 2, 0, 1, 21, 0, -10, 0],
  [-1, 0, 0, 2, 1, 16, 0, -8, 0],
  [1, 0, 0, -2, 1, -13, 0, 7, 0],
  [-1, 0, 2, 2, 1, -10, 0, 5, 0],
  [1, 1, 0, -2, 0, -7, 0, 0, 0],
  [0, 1, 2, 0, 2, 7, 0, -3, 0],
  [0, -1, 2, 0, 2, -7, 0, 3, 0],
  [1, 0, 2, 2, 2, -8, 0, 3, 0],
  [1, 0, 0, 2, 0, 6, 0, 0, 0],
  [2, 0, 2, -2, 2, 6, 0, -3, 0],
  [0, 0, 0, 2, 1, -6, 0, 3, 0],
  [0, 0, 2, 2, 1, -7, 0, 3, 0],
  [1, 0, 2, -2, 1, 6, 0, -3, 0],
  [0, 0, 0, -2, 1, -5, 0, 3, 0],
  [1, -1, 0, 0, 0, 5, 0, 0, 0],
  [2, 0, 2, 0, 1, -5, 0, 3, 0],
  [0, 1, 0, -2, 0, -4, 0, 0, 0],
  [1, 0, -2, 0, 0, 4, 0, 0, 0],
  [0, 0, 0, 1, 0, -4, 0, 0, 0],
  [1, 1, 0, 0, 0, -3, 0, 0, 0],
  [1, 0, 2, 0, 0, 3, 0, 0, 0],
  [1, -1, 2, 0, 2, -3, 0, 1, 0],
  [-1, -1, 2, 2, 2, -3, 0, 1, 0],
  [-2, 0, 0, 0, 1, -2, 0, 1, 0],
  [3, 0, 2, 0, 2, -3, 0, 1, 0],
  [0, -1, 2, 2, 2, -3, 0, 1, 0],
  [1, 1, 2, 0, 2, 2, 0, -1, 0],
  [-1, 0, 2, -2, 1, -2, 0, 1, 0],
  [2, 0, 0, 0, 1, 2, 0, -1, 0],
  [1, 0, 0, 0, 2, -2, 0, 1, 0],
  [3, 0, 0, 0, 0, 2, 0, 0, 0],
  [0, 0, 2, 1, 2, 2, 0, -1, 0],
  [-1, 0, 0, 0, 2, 1, 0, -1, 0],
  [1, 0, 0, -4, 0, -1, 0, 0, 0],
  [-2, 0, 2, 2, 2, 1, 0, -1, 0],
  [-1, 0, 2, 4, 2, -2, 0, 1, 0],
  [2, 0, 0, -4, 0, -1, 0, 0, 0],
  [1, 1, 2, -2, 2, 1, 0, -1, 0],
  [1, 0, 2, 2, 1, -1, 0, 1, 0],
  [-2, 0, 2, 4, 2, -1, 0, 1, 0],
  [-1, 0, 4, 0, 2, 1, 0, 0, 0],
  [1, -1, 0, -2, 0, 1, 0, 0, 0],
  [2, 0, 2, -2, 1, 1, 0, -1, 0],
  [2, 0, 2, 2, 2, -1, 0, 0, 0],
  [1, 0, 0, 2, 1, -1, 0, 0, 0],
  [0, 0, 4, -2, 2, 1, 0, 0, 0],
  [3, 0, 2, -2, 2, 1, 0, 0, 0],
  [1, 0, 2, -2, 0, -1, 0, 0, 0],
  [0, 1, 2, 0, 1, 1, 0, 0, 0],
  [-1, -1, 0, 2, 1, 1, 0, 0, 0],
  [0, 0, -2, 0, 1, -1, 0, 0, 0],
  [0, 0, 2, -1, 2, -1, 0, 0, 0],
  [0, 1, 0, 2, 0, -1, 0, 0, 0],
  [1, 0, -2, -2, 0, -1, 0, 0, 0],
  [0, -1, 2, 0, 1, -1, 0, 0, 0],
  [1, 1, 0, -2, 1, -1, 0, 0, 0],
  [1, 0, -2, 2, 0, -1, 0, 0, 0],
  [2, 0, 0, 2, 0, 1, 0, 0, 0],
  [0, 0, 2, 4, 2, -1, 0, 0, 0],
  [0, 1, 0, 1, 0, 1, 0, 0, 0]
];

// Fundamental arguments (degrees, with days from J2000 TDB, as NAIF), and
// d_psi, d_eps in radians. dj: days of TT (TDB) past J2000.
export function nutation1980(dj) {
  const dd = dj / 1e4, dd2 = dd * dd, t = dj / 365250;
  const arg = [
    134.96298138888886 + dj * 13.064992947243136 + (6.5192872572139397e-4 + dd * 3.6484365631332527e-7) * dd2,
    357.52772333333331 + dj * 0.98560028309377146 + (-1.201414483363923e-5 + dd * -6.8408185558748495e-8) * dd2,
    93.271910277777778 + dj * 13.229350240603848 + (-2.760338267929901e-4 + dd * 6.2707503428852773e-8) * dd2,
    297.85036305555559 + dj * 12.190749116495549 + (-1.4348262053484912e-4 + dd * 1.0831296046801845e-7) * dd2,
    125.04452222222223 + dj * -0.052953764841432813 + (1.5522608272925558e-4 + dd * 4.5605457039165659e-8) * dd2,
  ].map((a) => (((a % 360) + 360) % 360) * D2R);
  let dpsi = 0, deps = 0;
  for (const r of NUT80) {
    const a = r[0] * arg[0] + r[1] * arg[1] + r[2] * arg[2] + r[3] * arg[3] + r[4] * arg[4];
    dpsi += (r[5] + r[6] * t) * Math.sin(a);
    deps += (r[7] + r[8] * t) * Math.cos(a);
  }
  return { dpsi: dpsi * 1e-4 * AS2R, deps: deps * 1e-4 * AS2R, omega: arg[4] };
}

// Mean obliquity of the ecliptic, IAU 1980 (radians). T: Julian centuries TT.
export const meanObliquity1980 = (T) => (84381.448 - 46.8150 * T - 0.00059 * T * T + 0.001813 * T * T * T) * AS2R;

// Passive rotations (they rotate the frame, not the vector).
export const R1 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[1, 0, 0], [0, c, s], [0, -s, c]]; };
export const R2 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; };
export const R3 = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; };
const mul = (a, b) => a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]));

// IAU 1976 precession, J2000 to mean of date. T: Julian centuries TT.
export function precession1976(T) {
  const zeta = (2306.2181 * T + 0.30188 * T * T + 0.017998 * T * T * T) * AS2R;
  const theta = (2004.3109 * T - 0.42665 * T * T - 0.041833 * T * T * T) * AS2R;
  const z = (2306.2181 * T + 1.09468 * T * T + 0.018203 * T * T * T) * AS2R;
  return mul(R3(-z), mul(R2(theta), R3(-zeta)));
}

// GMST, IAU 1982, radians in [0, 2 pi). jdUt1: Julian date UT1.
export function gmst1982(jdUt1) {
  const Tu = (jdUt1 - JD_J2000) / 36525;
  // Seconds of time: the polynomial plus the elapsed fraction of the day.
  const frac = ((jdUt1 - 0.5) % 1 + 1) % 1;
  const s = 24110.54841 + Tu * (8640184.812866 + Tu * (0.093104 - Tu * 6.2e-6)) + frac * DAY_S;
  return ((s % DAY_S + DAY_S) % DAY_S) / DAY_S * 2 * Math.PI;
}

// The J2000 -> Earth-fixed matrix at a UTC instant (Unix ms), with the
// time offsets as given: TAI - UTC (leap seconds) and UT1 - UTC.
// Returns { M, gast, pole } where pole is the Earth's rotation axis of
// date in J2000 (M's third row).
// eqeq1994: add the 1994 terms in Omega to the equation of the equinoxes
// (IERS Conventions 1996). Off by default: NASA's check-case simulations
// leave them out (with them, their Earth-fixed positions are 5 cm away
// instead of 1 cm).
export function earthFixedMatrix(utcMs, { leapSeconds = 37, dut1 = 0, eqeq1994 = false } = {}) {
  const jdUtc = utcMs / 86400e3 + MJD_UNIX;
  const jdTt = jdUtc + (leapSeconds + 32.184) / DAY_S, jdUt1 = jdUtc + dut1 / DAY_S;
  const T = (jdTt - JD_J2000) / 36525;
  const P = precession1976(T);
  const eps = meanObliquity1980(T);
  const { dpsi, deps, omega } = nutation1980(jdTt - JD_J2000);
  const N = mul(R1(-(eps + deps)), mul(R3(-dpsi), R1(eps)));
  // Equation of the equinoxes.
  const eqeq = dpsi * Math.cos(eps + deps) + (eqeq1994 ? (0.00264 * Math.sin(omega) + 0.000063 * Math.sin(2 * omega)) * AS2R : 0);
  const gast = gmst1982(jdUt1) + eqeq;
  const M = mul(R3(gast), mul(N, P));
  return { M, gast, pole: M[2] };
}
