// packages/physics/src/corona.js
//
// The white-light corona's brightness (docs/frontend/lighting.md#the-corona):
// Baumbach's (1937, Astron. Nachr. 263, 121) mean of ten eclipses (1905-1929), the K corona
// (sunlight scattered by coronal electrons) and the F corona (by dust)
// together, against the distance from the Sun's centre rho in solar radii:
//   I(rho) / I_centre = 1e-6 (0.0532 rho^-2.5 + 1.425 rho^-7 + 2.565 rho^-17),
// I_centre the brightness at the centre of the Sun's disc. A smoothed
// average: the real corona has streamers and plumes and changes with the
// solar cycle. Pure ES module.

export function baumbach(rho) {
  return 1e-6 * (0.0532 * rho ** -2.5 + 1.425 * rho ** -7 + 2.565 * rho ** -17);
}
