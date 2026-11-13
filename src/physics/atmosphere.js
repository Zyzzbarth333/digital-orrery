// src/physics/atmosphere.js
//
// The Earth's atmosphere from the ground to 2,500 km, for drag
// (environment.js) and launches (rocket.js). Pure ES module.
//
// - 0 to 86 km: the U.S. Standard Atmosphere 1976 (NOAA-S/T 76-1562): seven
//   layers of constant temperature gradient in geopotential altitude, the
//   hydrostatic pressure through each, and density from the gas law.
// - 90 to 2,500 km: NASA's Marshall Engineering Thermosphere (MET-1999,
//   atmosphereMET.js), which follows the Sun's activity (spaceWeather.js).
// - 86 to 90 km: the logarithm of density blended linearly between the two.
// Above 2,500 km the density is taken as zero (it is under 1e-17 kg/m^3).

import { metAtmosphere } from './atmosphereMET.js';
import { spaceWeatherAt } from './spaceWeather.js';

const G0 = 9.80665, RSTAR = 8314.32, M0 = 28.9644, R_GEO = 6356.766;   // m/s^2, J/(kmol K), kg/kmol, km
// Base geopotential altitude (km), temperature (K) and lapse rate (K/km).
const LAYERS = [[0, 288.15, -6.5], [11, 216.65, 0], [20, 216.65, 1.0], [32, 228.65, 2.8], [47, 270.65, 0], [51, 270.65, -2.8], [71, 214.65, -2.0], [84.852, 186.946, 0]];
const P_BASE = [101325];
for (let i = 1; i < LAYERS.length; i++) {
  const [h0, T0, L] = LAYERS[i - 1], dh = LAYERS[i][0] - h0;
  P_BASE.push(L === 0 ? P_BASE[i - 1] * Math.exp(-G0 * M0 * dh * 1000 / (RSTAR * T0)) : P_BASE[i - 1] * Math.pow(T0 / (T0 + L * dh), G0 * M0 / (RSTAR * L / 1000)));
}

// U.S. Standard Atmosphere 1976 at geometric altitude z (km, 0 to 86):
// { rho (kg/m^3), T (K), p (Pa) }.
export function standardAtmosphere(z) {
  const h = R_GEO * z / (R_GEO + z);            // geopotential altitude
  let i = LAYERS.length - 1;
  while (i > 0 && h < LAYERS[i][0]) i--;
  const [h0, T0, L] = LAYERS[i], dh = h - h0, T = T0 + L * dh;
  const p = L === 0 ? P_BASE[i] * Math.exp(-G0 * M0 * dh * 1000 / (RSTAR * T0)) : P_BASE[i] * Math.pow(T0 / T, G0 * M0 / (RSTAR * L / 1000));
  // Above 80 km the 1976 standard's molecular weight starts to fall; its
  // ratio at 86 km is 0.999579, which this leaves out (a 0.04 % density).
  return { rho: p * M0 / (RSTAR * T), T, p };
}

// Density (kg/m^3) at geodetic latitude, longitude (deg) and altitude (km)
// at time ms. sw: the Sun's activity { f107, f107bar, ap } (default: the
// table's for the date). met: extra options for the MET model.
export function density({ ms, lat, lon, alt, sw = null, met = {} }) {
  if (alt > 2500) return 0;
  if (alt <= 86) return standardAtmosphere(Math.max(0, alt)).rho;
  const s = sw ?? spaceWeatherAt(ms);
  const high = (z) => metAtmosphere({ ms, lat, lon, alt: z, f107: s.f107, f107bar: s.f107bar, ap: s.ap, wholeMinutes: false, ...met }).rho;
  if (alt >= 90) return high(alt);
  const lo = Math.log(standardAtmosphere(86).rho), hi = Math.log(high(90)), u = (alt - 86) / 4;
  return Math.exp(lo + (hi - lo) * u);
}
