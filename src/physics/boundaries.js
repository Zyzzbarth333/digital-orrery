// src/physics/boundaries.js
//
// Where the solar wind stops a planet's field: the magnetopause, and the
// bow shock standing ahead of it (docs/physics/magnetic-fields.md#magnetopauses-and-bow-shocks).
//
// The Earth
//   Magnetopause: Shue et al. 1998, eqs. 1, 10, 11, in GSM (r in R_E,
//   theta from the Sun line, Dp in nPa, Bz the IMF's in nT):
//     r = r0 (2 / (1 + cos theta))^alpha
//     r0 = (10.22 + 1.29 tanh(0.184 (Bz + 8.14))) Dp^(-1/6.6)
//     alpha = (0.58 - 0.007 Bz) (1 + 0.024 ln Dp)
//   fitted for -18 < Bz < 15 nT and 0.5 < Dp < 8.5 nPa. Dp includes the
//   solar wind's helium, a factor 1.16 at its usual 4 % (Shue et al.).
//   Bow shock: its standoff from Farris and Russell 1994 as Volpes and
//   Bothmer 2015 give it, Delta / Rc = 0.81 ((g - 1) M^2 + 2) / ((g + 1) (M^2 - 1)),
//   Rc = 1.35 r0 the magnetopause's radius of curvature at its nose,
//   g = 5/3 and M the fast magnetosonic Mach number. Its shape is ours: a
//   hyperboloid with that nose, a radius of curvature Rc + Delta there
//   (concentric with the magnetopause's), and the Mach cone's half-angle
//   asin(1/M) as its asymptote.
//
// Jupiter: Rutala et al. 2025's "new" magnetopause and bow shock (eq. 2,
//   Tables 2 and 4) in their spherical-solar coordinates: theta from the
//   Sun line, phi from the spin axis's north through dawn (-y), p the
//   solar wind's dynamic pressure (nPa):
//     r = r0 p^r1 (2 / (1 + cos theta))^(a0 + a1 p) + sin^2(theta/2) r_(2|3) sin^2(phi) p^r1
//   r2 on the dawn side (0 < phi <= pi), r3 at dusk. Fitted for
//   x > -90 R_J (magnetopause) and -600 R_J (bow shock).
//
// Saturn: Pilkington et al. 2015's magnetopause (Table 1, "new model"):
//   r = r0 (2 / (1 + cos theta))^K, r0 = 10.5 Dp^(-1/5.7), K = 0.67 + 0.17 Dp,
//   squeezed 19 % along the north-south axis.
//
// Each boundary is { r(cosTheta, phi) } in planet radii in its sun-aligned
// frame; frames come from sunFrame (the Earth's from t89.js's gsmFrame).

export const PROTON_KG = 1.67262192e-27;
const KB = 1.380649e-23, MU0 = 4e-7 * Math.PI;

// The solar wind: n (cm^-3), v (km/s), T (K), B and Bz (nT) -> Dp (nPa)
// with 4 % helium, and the fast magnetosonic Mach number (electrons as hot
// as the protons).
export function solarWind({ n, v, T, B, bz }) {
  const rho = n * 1e6 * PROTON_KG, dp = 1.16 * rho * (v * 1e3) ** 2 * 1e9;
  const cs = Math.sqrt((5 / 3) * KB * 2 * T / PROTON_KG), va = (B * 1e-9) / Math.sqrt(MU0 * rho * 1.16);
  return { dp, bz, v, mach: (v * 1e3) / Math.hypot(cs, va) };
}

// A quiet solar wind at 1 AU, for dates with no measurement: 5 cm^-3,
// 400 km/s, 10^5 K, 5 nT, Bz 0. Falls off as 1 / r^2 farther out.
export const QUIET_WIND = { n: 5, v: 400, T: 1e5, B: 5, bz: 0 };
export const windAt = (w, au) => ({ ...w, n: w.n / (au * au), B: w.B / au });

// ---- the Earth ----
export function shue98(dp, bz) {
  const r0 = (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * dp ** (-1 / 6.6);
  const alpha = (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(dp));
  return { r0, alpha, r: (c) => r0 * (2 / (1 + c)) ** alpha };
}

export function farrisRussell(r0, mach, g = 5 / 3) {
  const m2 = Math.max(mach * mach, 1.0001), rc = 1.35 * r0;
  const delta = 0.81 * rc * (((g - 1) * m2 + 2) / ((g + 1) * (m2 - 1)));
  return { nose: r0 + delta, delta, rc };
}

// The bow shock's hyperboloid: x(rho) = xn + a - a sqrt(1 + rho^2 / b^2),
// as r(cos theta) for theta from the Sun line.
export function bowShock(r0, mach) {
  const { nose, delta, rc } = farrisRussell(r0, mach), R = rc + delta;
  const t = Math.tan(Math.asin(1 / Math.max(mach, 1.0001))), a = R / (t * t), b = R / t;
  // r along a ray at theta: solve x = r c, rho = r s on the hyperbola.
  const r = (c) => {
    const s2 = Math.max(0, 1 - c * c), A = c * c / (a * a) - s2 / (b * b), B = -2 * c * (nose + a) / (a * a), C = ((nose + a) / a) ** 2 - 1;
    if (Math.abs(A) < 1e-15) return -C / B;
    const d = B * B - 4 * A * C;
    if (d < 0) return Infinity;
    const r1 = (-B - Math.sqrt(d)) / (2 * A), r2 = (-B + Math.sqrt(d)) / (2 * A);
    const ok = [r1, r2].filter((x) => x > 0 && x * c <= nose + 1e-9).sort((u, v) => u - v);
    return ok.length ? ok[0] : Infinity;
  };
  return { nose, delta, rc, a, b, r };
}

// ---- Jupiter (Rutala et al. 2025) and Saturn (Pilkington et al. 2015) ----
export const RUTALA = {
  magnetopause: { r0: 33.5, r1: -0.25, r2: 12.9, r3: 25.8, a0: 0.19, a1: 1.27, xMin: -90 },
  bowShock: { r0: 36.4, r1: -0.25, r2: 0.0, r3: 9.9, a0: 0.89, a1: 0.88, xMin: -600 },
};
export function rutala(c, p) {
  const rss = c.r0 * p ** c.r1, af = c.a0 + c.a1 * p;
  return {
    r0: rss,
    r(ct, phi) {
      const half = (1 - ct) / 2, s = Math.sin(phi), side = s >= 0 ? c.r2 : c.r3;
      return rss * (2 / (1 + ct)) ** af + half * side * s * s * p ** c.r1;
    },
  };
}

export const PILKINGTON = { a1: 10.5, alpha: 5.7, a3: 0.67, a4: 0.17, flatten: 0.19 };
export function pilkington(dp, c = PILKINGTON) {
  const r0 = c.a1 * dp ** (-1 / c.alpha), K = c.a3 + c.a4 * dp;
  return { r0, K, r: (ct) => r0 * (2 / (1 + ct)) ** K, flatten: c.flatten };
}

// A sun-aligned frame in a body's own: X toward the Sun, Z the spin axis
// (body z) made square to X, Y = Z x X. (Rutala's JSS and Saturn's KSM,
// whose dipole lies along its spin axis.)
export function sunFrame(sun) {
  const n = Math.hypot(...sun), X = sun.map((v) => v / n);
  let Z = [-X[2] * X[0], -X[2] * X[1], 1 - X[2] * X[2]];
  const zn = Math.hypot(...Z) || 1; Z = Z.map((v) => v / zn);
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  return { X, Y, Z };
}

// Whether a body-frame point lies inside a boundary r(cosTheta, phi) in
// frame F, its Z squeezed by (1 - flatten).
export function insideBoundary(F, r, flatten = 0) {
  const { X, Y, Z } = F, k = 1 / (1 - flatten);
  return (x, y, z) => {
    const gx = X[0] * x + X[1] * y + X[2] * z, gy = Y[0] * x + Y[1] * y + Y[2] * z, gz = (Z[0] * x + Z[1] * y + Z[2] * z) * k;
    const R = Math.hypot(gx, gy, gz);
    if (R < 1e-9) return true;
    return R < r(gx / R, Math.atan2(-gy, gz));
  };
}

// Points on a boundary for drawing: rings at angles theta from the Sun line
// (deg) and meridians at phi, in the body frame, cut at x >= xMin.
export function boundaryMesh(F, r, { thetas, nPhi = 48, xMin = -Infinity, flatten = 0 }) {
  const { X, Y, Z } = F, rows = [];
  for (const th of thetas) {
    const ct = Math.cos((th * Math.PI) / 180), st = Math.sin((th * Math.PI) / 180), row = [];
    for (let j = 0; j <= nPhi; j++) {
      const phi = (2 * Math.PI * j) / nPhi, R = r(ct, phi);
      if (!Number.isFinite(R) || R * ct < xMin) { row.push(null); continue; }
      // phi from +Z through dawn (-Y).
      const gx = R * ct, gz = R * st * Math.cos(phi) * (1 - flatten), gy = -R * st * Math.sin(phi);
      row.push([X[0] * gx + Y[0] * gy + Z[0] * gz, X[1] * gx + Y[1] * gy + Z[1] * gz, X[2] * gx + Y[2] * gy + Z[2] * gz]);
    }
    rows.push(row);
  }
  return rows;
}

// ---- the measured solar wind ----
//
// NOAA SWPC's solar wind propagated from L1 to the Earth (geospace
// product, the last 7 days, a row a minute): [time_tag, speed, density,
// temperature, bx, by, bz, bt, vx, vy, vz, propagated_time_tag], B in GSM.
export const PROPAGATED_URL = 'https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind.json';
export function parsePropagated(rows) {
  const head = rows[0], col = (k) => head.indexOf(k);
  const iT = col('propagated_time_tag'), iv = col('speed'), inn = col('density'), iTp = col('temperature'), ib = col('bt'), iz = col('bz');
  const out = [];
  for (const r of rows.slice(1)) {
    const t = Date.parse(r[iT].endsWith('Z') ? r[iT] : `${r[iT]}Z`), v = +r[iv], n = +r[inn], T = +r[iTp], B = +r[ib], bz = +r[iz];
    if ([t, v, n, T, B, bz].every(Number.isFinite) && r[iv] !== null && r[inn] !== null && r[iz] !== null) out.push({ t, v, n, T, B, bz });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
// The mean of the rows arriving within +-5 minutes of ms, or null.
export function windNear(table, ms, halfMs = 5 * 60e3) {
  if (!table?.length) return null;
  const s = { n: 0, v: 0, T: 0, B: 0, bz: 0 };
  let c = 0;
  for (const r of table) if (Math.abs(r.t - ms) <= halfMs) { s.n += r.n; s.v += r.v; s.T += r.T; s.B += r.B; s.bz += r.bz; c++; }
  return c ? { n: s.n / c, v: s.v / c, T: s.T / c, B: s.B / c, bz: s.bz / c, count: c } : null;
}
