// src/physics/atmosphereMET.js
//
// The Marshall Engineering Thermosphere (MET), NASA Marshall's version of
// Jacchia's 1970 static diffusion model with two of Jacchia's 1971 terms:
// neutral density, temperature and composition from 90 to 2500 km. NASA's
// 6-DOF check cases (NASA/TM-2015-218675) ran it in all four simulations;
// this module is checked against their recorded densities
// (docs/validation.md#the-met-atmosphere). Pure ES module.
//
// Built from the published descriptions and the published code listings,
// all public on NASA's Technical Reports Server:
//   M. P. Hickey, "The NASA Marshall Engineering Thermosphere Model",
//     NASA CR-179359, 1988 (Fortran listing of MET-88: TINF, JAC, TEMP,
//     MOL_WT, SLV, SLVH, FAIR5)
//   M. P. Hickey, "An Improvement in the Numerical Integration Procedure
//     Used in the NASA Marshall Engineering Thermosphere Model",
//     NASA CR-179389, 1988 (subroutine GAUSS)
//   J. K. Owens, "NASA Marshall Engineering Thermosphere Model, Version
//     2.0", NASA/TM-2002-211786, 2002 (the 1999 solar position, the
//     smooth fairing, two worked examples)
//   J. K. Owens et al., "Marshall Engineering Thermosphere Model, Version
//     MET-2007", NASA/TM-2017-218238 (what MET-1999 did with time inputs)
//   L. G. Jacchia, SAO Special Reports 313 (1970) and 332 (1971)
//
// The version reproduced is MET-1999 (MET99), which NASA's sims B and C
// ran: the 1988 equations with the J2000 low-precision Sun, Gaussian
// quadrature, the stepped helium fairing between 440 and 500 km, the day of
// the year as an integer in the semiannual and seasonal terms, and a
// 365.2422-day year. { fairing: 'smooth' } gives MET-V 2.0's fairing.
//
// Inputs (one object):
//   ms          time, ms since 1970 UTC (or a Date)
//   lat, lon    geodetic latitude and east longitude, degrees
//   alt         height, km (90 to 2500)
//   f107        daily 10.7 cm solar flux (previous day), 1e-22 W/m^2/Hz
//   f107bar     its 162-day centred mean (defaults to f107)
//   ap          geomagnetic index ap, 6.7 h earlier (or kp with { kp: true })
// Output (SI): { rho kg/m^3, T K, Texo K, n: { N2, O2, O, Ar, He, H } m^-3,
//   M kg/kmol, p Pa, logRho }

const D2R = Math.PI / 180;
const RGAS = 8.31432;                      // J/(mol K)
const AV = 6.02257e23;
const RE_EFF = 6356.766;                   // km, MET's spherical Earth
const gravity = (z) => 9.80665 / (1 + z / RE_EFF) ** 2;   // m/s^2, z in km

// Molecular masses (N2, O2, O, Ar, He, H), sea-level volume fractions,
// thermal diffusion factors.
const EI = [28.0134, 31.9988, 15.9994, 39.948, 4.0026, 1.00797];
const ALPHA = [0, 0, 0, 0, -0.380, 0];
const QN = 0.78110, QO2 = 0.20955, QA = 0.009343, QHE = 1.289e-5;
const T0 = 183;
const MOLWT = [28.15204, -0.085586, 1.284e-4, -1.0056e-5, -1.021e-5, 1.5044e-6, 9.9826e-8];

// ---- exospheric temperature (TINF) ---------------------------------------
export function exosphericTemperature({ f107, f107bar, ap, kp = false, latRad, decl, hourAngle, dy }) {
  const Tc = 383 + 3.32 * f107bar + 1.8 * (f107 - f107bar);
  // Diurnal: maximum at the subsolar latitude, minimum at the opposite.
  const eta = 0.5 * Math.abs(latRad - decl), theta = 0.5 * Math.abs(latRad + decl);
  let tau = hourAngle - 0.6457718 + 0.1047198 * Math.sin(hourAngle + 0.7504916);
  if (tau > Math.PI) tau -= 2 * Math.PI;
  if (tau < -Math.PI) tau += 2 * Math.PI;
  const R = 0.31, A1 = Math.sin(theta) ** 2.5, A2 = Math.cos(eta) ** 2.5, A3 = Math.cos(tau / 2) ** 3;
  const B1 = 1 + R * A1;
  const Tl = Tc * B1 * (1 + R * ((A2 - A1) / B1) * A3);
  // Geomagnetic.
  const Tg = kp ? 28 * ap + 0.03 * Math.exp(ap) : ap + 100 * (1 - Math.exp(-0.08 * ap));
  // Semiannual (dy = day number / tropical year).
  const g3 = (0.5 * (1 + Math.sin(6.2831853 * dy + 5.9742620))) ** 2.16;
  const tau1 = dy + 0.1145 * (g3 - 0.5);
  const Ts = 2.41 + f107bar * (0.349 + 0.206 * Math.sin(6.2831853 * tau1 + 3.9531708)) * Math.sin(12.5663706 * tau1 + 4.3214352);
  return Tl + Tg + Ts;
}

// ---- temperature profile (TEMP) -------------------------------------------
function profile(Texo) {
  const Tx = 444.3807 + 0.02385 * Texo - 392.8292 * Math.exp(-0.0021357 * Texo);
  const A2 = 2 * (Texo - Tx) / Math.PI, d = Tx - T0;
  const T1 = 1.9 * d / 35, T3 = -1.7 * d / 35 ** 3, T4 = -0.8 * d / 35 ** 4;
  return (z) => {
    const u = z - 125;
    return u > 0 ? Tx + A2 * Math.atan(T1 * u * (1 + 4.5e-6 * u ** 2.5) / A2) : Tx + T1 * u + T3 * u ** 3 + T4 * u ** 4;
  };
}
const molWt = (z) => {
  if (z > 105) return 1;
  const u = z - 100;
  let m = MOLWT[0];
  for (let i = 1; i < 7; i++) m += MOLWT[i] * u ** i;
  return m;
};

// ---- Gaussian quadrature over MET's fixed sub-regions (GAUSS) ------------
// Abscissas and weights as the listing has them (7 digits), so the
// integral is MET's own, not a better one.
const GX = {
  3: [-0.7745967, 0, 0.7745967], 4: [-0.8611363, -0.3399810, 0.3399810, 0.8611363],
  5: [-0.9061798, -0.5384693, 0, 0.5384693, 0.9061798],
  6: [-0.9324695, -0.6612094, -0.2386192, 0.2386192, 0.6612094, 0.9324695],
};
const GW = {
  3: [0.5555556, 0.8888889, 0.5555556], 4: [0.3478548, 0.6521452, 0.6521452, 0.3478548],
  5: [0.2369269, 0.4786287, 0.5688889, 0.4786287, 0.2369269],
  6: [0.1713245, 0.3607616, 0.4679139, 0.4679139, 0.3607616, 0.1713245],
};
const ALTMIN = [90, 105, 125, 160, 200, 300, 500, 1500, 2500];
const NG = [4, 5, 6, 6, 6, 6, 6, 6];
function gauss(z1, z2, kmin, T) {         // integral of M g / T dz, z in km
  let r = 0;
  for (let k = kmin; k < 8; k++) {
    const a = ALTMIN[k], d = Math.min(z2, ALTMIN[k + 1]), del = 0.5 * (d - a), n = NG[k];
    let rr = 0;
    for (let i = 0; i < n; i++) { const z = del * (GX[n][i] + 1) + a; rr += GW[n][i] * molWt(z) * gravity(z) / T(z); }
    r += del * rr;
    if (d === z2) break;
  }
  return r;
}

// ---- density and composition at height z (JAC) ---------------------------
// Number densities in cm^-3 (log10), density g/cm^3 (log10), as MET has them.
export function jacchia(z, Texo) {
  const T = profile(Texo), Tz = T(z);
  const D = Math.min(z, 105);
  let R = gauss(90, D, 0, T);
  const EM105 = molWt(D), TD = T(D);
  const dens = 2.1926e-8 * EM105 * Math.exp(-R / RGAS) / TD;
  let factor = AV * dens;
  const par = factor / EM105;
  factor /= 28.96;
  const DI = [QN * factor, par * (EM105 * (1 + QO2) / 28.96 - 1), 2 * par * (1 - EM105 / 28.96), QA * factor, QHE * factor];
  if (z <= 105) {
    return { T: Tz, logRho: Math.log10(dens), logN: [...DI, 1].map((x, i) => (i === 5 ? 0 : Math.log10(x))), M: EM105 };
  }
  R = gauss(105, z, 1, T);
  const DIT = DI.map((x, i) => { const v = x * (TD / Tz) ** (1 + ALPHA[i]) * Math.exp(-EI[i] * R / RGAS); return v <= 0 ? 1e-6 : v; });
  if (z > 500) {
    const S = T(500), ls = Math.log10(S);
    const R5 = gauss(500, z, 6, T);
    DIT.push(10 ** (73.13 - 39.4 * ls + 5.5 * ls * ls) * (S / Tz) * Math.exp(-EI[5] * R5 / RGAS));
  } else DIT.push(1);
  let rho = 0, ntot = 0;
  for (let i = 0; i < 6; i++) { rho += EI[i] * DIT[i] / AV; ntot += DIT[i]; }
  return { T: Tz, logRho: Math.log10(rho), logN: DIT.map(Math.log10), M: rho * AV / ntot };
}

// ---- seasonal-latitudinal terms (SLV, SLVH, FAIR5) ------------------------
function slv(z, latRad, day) {           // delta log10 rho below 170 km
  if (z > 170) return 0;
  const u = z - 90;
  const d = 0.014 * u * Math.exp(-0.0013 * u * u) * Math.sin(0.0172 * day + 1.72) * Math.sin(latRad) ** 2;
  return latRad < 0 ? -d : d;
}
function slvh(logRho, logHe, latRad, decl) {    // helium above the winter pole
  const A = Math.abs(0.65 * (decl / 0.40909079));
  const B = decl < 0 ? -0.5 * latRad : 0.5 * latRad;
  const he = logHe + A * (Math.sin(0.7854 - B) ** 3 - 0.35356);
  const rho = 10 ** logRho + 6.646e-24 * (10 ** he - 10 ** logHe);
  return { logRho: Math.log10(rho), logHe: he };
}
const CZ = [1.0, 0.9045085, 0.6545085, 0.3454915, 0.0954915, 0.0];

// ---- the Sun (MET-1999: Astronomical Almanac low-precision formulae) -----
// Declination and hour angle at the place (rad), from the Julian day
// number of the date plus the time of day.
export function metSun(ms, lonDeg) {
  const n = ms / 86400000 + 2440587.5 - 2451545.0;
  const L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * D2R;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 0.0000004 * n) * D2R;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lam));
  const alpha = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
  let E = ((L * D2R - alpha) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;   // equation of time
  const dayMin = ((ms % 86400000) + 86400000) % 86400000 / 60000;
  let H = (dayMin / 4 - 180 + lonDeg) * D2R + E;
  H = ((H % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  return { decl, hourAngle: H };
}

// ---- the model -----------------------------------------------------------
export function metAtmosphere({ ms, lat, lon, alt, f107, f107bar = f107, ap, kp = false, fairing = 'steps', wholeMinutes = true }) {
  if (ms instanceof Date) ms = ms.getTime();
  if (!(alt >= 90)) throw new RangeError(`MET covers 90 to 2500 km (got ${alt} km)`);
  // MET-1999 reads the time as whole minutes (wholeMinutes: false lets
  // the Sun move between them) and the date as an integer day of the year
  // (1 on 1 January).
  if (wholeMinutes) ms = Math.floor(ms / 60000) * 60000;
  const d = new Date(ms), y = d.getUTCFullYear();
  const day = Math.floor((ms - Date.UTC(y, 0, 1)) / 86400000) + 1;
  const latRad = lat * D2R;
  const { decl, hourAngle } = metSun(ms, lon);
  const Texo = exosphericTemperature({ f107, f107bar, ap, kp, latRad, decl, hourAngle, dy: day / 365.2422 });
  const j = jacchia(alt, Texo);
  let logRho = j.logRho + slv(alt, latRad, day), logHe = j.logN[4];
  if (alt > 500) ({ logRho, logHe } = slvh(logRho, logHe, latRad, decl));
  else if (alt > 440) {
    const s = slvh(logRho, logHe, latRad, decl);
    const c = fairing === 'smooth' ? Math.cos(1.5 * (alt - 440) * D2R) ** 2 : CZ[Math.floor((Math.trunc(alt) - 440) / 10)];
    logRho = logRho * c + s.logRho * (1 - c);
    logHe = logHe * c + s.logHe * (1 - c);
  }
  const rho = 10 ** logRho * 1000;
  const N = j.logN.map((x, i) => 1e6 * 10 ** (i === 4 ? logHe : x));
  return {
    rho, logRho: Math.log10(rho), T: j.T, Texo, M: j.M,
    n: { N2: N[0], O2: N[1], O: N[2], Ar: N[3], He: N[4], H: N[5] },
    p: RGAS * 1000 * j.T * rho / j.M,
  };
}
