// packages/physics/src/marsCrustal.js
//
// Mars's crustal magnetic field (docs/physics/magnetic-fields.md#mars).
// Mars has no global dynamo now, but its ancient crust stayed magnetised,
// most strongly in the southern highlands (Terra Cimmeria, Terra
// Sirenum). Langlais et al. 2019 fitted MGS and MAVEN to spherical-harmonic
// degree 134 (about 160 km) on a sphere of 3,393.5 km; there the radial field
// runs from -8,520 to 11,260 nT.
//
//   radialFieldGrid(coeffs, N, rOverA, nLon, nLat) -> Float32Array   Br (nT),
//       rows from the north pole down, columns from 0 deg east, cell centres
//   encodeBr(nT) / decodeBr(byte)    the map's 8-bit asinh scale
//
// The sum is split by latitude row (as gravityField does): for each row
// A_m = sum_n (n + 1) (a/r)^(n+2) P_n^m g_nm and B_m likewise with h_nm,
// then Br = sum_m A_m cos m phi + B_m sin m phi along the row.

export const MARS_A = 3393.5;
// The map's scale: asinh(Br / B0) / asinh(BMAX / B0) in 127 steps each way.
export const BR_B0 = 50, BR_MAX = 12000;
const SCALE = 127 / Math.asinh(BR_MAX / BR_B0);
export const encodeBr = (nT) => Math.max(-127, Math.min(127, Math.round(Math.asinh(nT / BR_B0) * SCALE)));
export const decodeBr = (v) => BR_B0 * Math.sinh(v / SCALE);

// Index of g_nm / h_nm in a flat array (magnetic.js's order).
const at = (n, m, h) => n * n - 1 + (m === 0 ? 0 : 2 * m - 1 + (h ? 1 : 0));

export function radialFieldGrid(coeffs, N, rOverA, nLon, nLat) {
  const out = new Float32Array(nLon * nLat);
  const W = N + 1, P = new Float64Array(W * W);
  const k1 = new Float64Array(W * W), k2 = new Float64Array(W * W), kn = new Float64Array(W);
  for (let n = 1; n <= N; n++) {
    kn[n] = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
    for (let m = 0; m < n; m++) {
      const d = Math.sqrt(n * n - m * m);
      k1[n * W + m] = (2 * n - 1) / d;
      k2[n * W + m] = n >= 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) / d : 0;
    }
  }
  const ar = 1 / rOverA, A = new Float64Array(W), B = new Float64Array(W);
  const cosm = new Float64Array(nLon * W), sinm = new Float64Array(nLon * W);
  for (let j = 0; j < nLon; j++) {
    const ph = (2 * Math.PI * (j + 0.5)) / nLon;
    for (let m = 0; m <= N; m++) { cosm[j * W + m] = Math.cos(m * ph); sinm[j * W + m] = Math.sin(m * ph); }
  }
  for (let i = 0; i < nLat; i++) {
    const th = (Math.PI * (i + 0.5)) / nLat, ct = Math.cos(th), st = Math.sin(th);
    P[0] = 1;
    A.fill(0); B.fill(0);
    let arn = ar * ar;
    for (let n = 1; n <= N; n++) {
      arn *= ar;
      P[n * W + n] = kn[n] * st * P[(n - 1) * W + n - 1];
      for (let m = 0; m < n; m++) {
        const idx = n * W + m;
        P[idx] = k1[idx] * ct * P[(n - 1) * W + m] - (n - 2 >= m ? k2[idx] * P[(n - 2) * W + m] : 0);
      }
      const f = (n + 1) * arn;
      for (let m = 0; m <= n; m++) {
        const p = f * P[n * W + m];
        A[m] += p * coeffs[at(n, m, false)];
        if (m) B[m] += p * coeffs[at(n, m, true)];
      }
    }
    for (let j = 0; j < nLon; j++) {
      let s = 0;
      for (let m = 0; m <= N; m++) s += A[m] * cosm[j * W + m] + B[m] * sinm[j * W + m];
      out[i * nLon + j] = s;
    }
  }
  return out;
}
