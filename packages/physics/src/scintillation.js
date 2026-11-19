// packages/physics/src/scintillation.js
//
// Why stars twinkle, and how much (docs/frontend/lighting.md#twinkling):
// turbulence in the lower atmosphere bends starlight a little, and the
// bending varies across the ground on a scale of centimetres, so a small
// aperture such as the eye's pupil sees the star brighten and fade. Above
// the turbulence (from about 20 km, and in space) stars are steady.
// Pure ES module, no dependencies. SI units unless named.
//
// Turbulence: the Hufnagel-Valley 5/7 profile of the refractive-index
// structure constant, Cn^2 (m^-2/3) against height above the ground h (m),
//   Cn^2 = 0.00594 (v/27)^2 (1e-5 h)^10 exp(-h/1000)
//        + 2.7e-16 exp(-h/1500) + A exp(-h/100),
// with v = 21 m/s and A = 1.7e-14: a standard model whose name says it
// gives a coherence length r0 of 5 cm and an isoplanatic angle of 7 urad
// looking straight up at 0.5 um (checked in scintillation.test.mjs).
//
// Strength: for a plane wave from a star seen from height h0 at zenith
// angle z, the Rytov variance
//   sigma_R^2 = 2.25 k^(7/6) sec(z)^(11/6) integral Cn^2(h) (h - h0)^(5/6) dh,
// k = 2 pi / lambda, and the scintillation index of a point aperture (the
// pupil is far smaller than the Fresnel zone, several centimetres) from
// Andrews and Phillips's expressions for weak to strong turbulence:
//   sigma_I^2 = exp(0.49 sR2 / (1 + 1.11 sR^(12/5))^(7/6)
//                 + 0.51 sR2 / (1 + 0.69 sR^(12/5))^(5/6)) - 1,
// which is sigma_R^2 when it is small and saturates near 1 low in the sky.

const LAMBDA = 550e-9;                  // m, the middle of the visible
const HV_V = 21, HV_A = 1.7e-14;        // HV 5/7
const TOP = 30000;                      // m: no turbulence to speak of above

// Cn^2 (m^-2/3) at h metres above the ground.
export function hv57(h) {
  return 0.00594 * (HV_V / 27) ** 2 * (1e-5 * h) ** 10 * Math.exp(-h / 1000)
    + 2.7e-16 * Math.exp(-h / 1500) + HV_A * Math.exp(-h / 100);
}

// The integral of Cn^2(h) (h - h0)^p dh from the observer at h0 up, by
// Simpson's rule: 1 m steps over the first 2 km (where the ground layer
// lives), then 10 m steps to 30 km.
export function turbulenceMoment(h0, p) { return simpson(h0, p); }

function simpson(h0, p) {
  const spans = [[h0, Math.min(TOP, h0 + 2000), 2000], [Math.min(TOP, h0 + 2000), TOP, 2800]];
  let total = 0;
  for (const [a, b, n] of spans) {
    if (b <= a) continue;
    const dh = (b - a) / n;
    let s = 0;
    for (let i = 0; i <= n; i++) {
      const h = a + i * dh, w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
      s += w * hv57(h) * (h - h0) ** p;
    }
    total += (s * dh) / 3;
  }
  return total;
}

const k = (lambda) => (2 * Math.PI) / lambda;

// Rytov variance looking straight up from h0 metres.
export function rytovZenith(h0, lambda = LAMBDA) {
  return 2.25 * k(lambda) ** (7 / 6) * simpson(h0, 5 / 6);
}

// Coherence length r0 (m) and isoplanatic angle theta0 (rad) straight up
// (Fried; Andrews and Phillips): r0 = (0.423 k^2 integral Cn^2)^(-3/5),
// theta0 = (2.91 k^2 integral Cn^2 h^(5/3))^(-3/5).
export function friedR0(h0 = 0, lambda = 0.5e-6) {
  return (0.423 * k(lambda) ** 2 * simpson(h0, 0)) ** (-3 / 5);
}
export function isoplanaticAngle(h0 = 0, lambda = 0.5e-6) {
  return (2.91 * k(lambda) ** 2 * simpson(h0, 5 / 3)) ** (-3 / 5);
}

// Scintillation index of a point aperture from the Rytov variance.
export function scintillationIndex(sR2) {
  const s = Math.sqrt(Math.max(sR2, 0)) ** (12 / 5);
  return Math.exp((0.49 * sR2) / (1 + 1.11 * s) ** (7 / 6) + (0.51 * sR2) / (1 + 0.69 * s) ** (5 / 6)) - 1;
}

// The effective distance (m) to the turbulence that makes the twinkling:
// the mean of (h - h0) weighted as the Rytov integral weights it.
export function turbulenceDistance(h0) {
  const m = simpson(h0, 5 / 6);
  return m > 0 ? simpson(h0, 11 / 6) / m : 0;
}

// Refractivity n - 1 of standard air (15 C, 101.325 kPa, dry) at a vacuum
// wavelength in micrometres (Edlen 1966, Metrologia 2, 71).
export function edlenRefractivity(lambdaUm) {
  const s2 = 1 / (lambdaUm * lambdaUm);
  return (8342.13 + 2406030 / (130 - s2) + 15997 / (38.9 - s2)) * 1e-8;
}

// What the app needs per frame for a camera h0 metres above the ground,
// all at zenith; the star shader scales each with its zenith angle:
//   R0     the Rytov variance (x sec^(11/6));
//   tau    2 tau_c / T: the share of the scintillation's variance left after
//          the eye averages over T = 0.1 s, tau_c = r_F / v the time the
//          pattern takes to blow across a Fresnel zone r_F = sqrt(lambda L)
//          (x sqrt(sec), capped at 1);
//   disp   the blue (450 nm) and red (650 nm) paths' separation at the
//          turbulence over a Fresnel zone, (n_b - n_r) L / r_F (x sqrt(sec)
//          tan): past 1 their twinkling no longer matches, and bright stars
//          low in the sky flicker in colour (Dravins et al. 1997, part II).
export const EYE_T = 0.1;
export function twinkleAt(h0) {
  if (h0 >= TOP) return { R0: 0, tau: 0, disp: 0 };
  const L = turbulenceDistance(h0), rF = Math.sqrt(LAMBDA * L);
  return {
    R0: rytovZenith(h0),
    tau: (2 * (rF / HV_V)) / EYE_T,
    disp: ((edlenRefractivity(0.45) - edlenRefractivity(0.65)) * L) / rF,
  };
}
