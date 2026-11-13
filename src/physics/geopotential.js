// src/physics/geopotential.js
//
// A planet's gravitation from spherical harmonics, to any degree and order:
// the acceleration in the planet-fixed frame. Pure ES module, no
// dependencies.
//
// Method: the V/W recursion of Cunningham (1970), as set out by Montenbruck
// and Gill, Satellite Orbits (2000), section 3.2.4, eqs. 3.27-3.33. It needs
// no latitude or longitude, so it has no singularity at the poles. It runs on
// unnormalised coefficients; fully normalised ones (the usual published form)
// are converted once when the field is built.
//
// field = geopotential({ mu, radius, n, C, S, normalized })
//   mu      km^3/s^2;  radius  the reference radius, km
//   C, S    C[n][m], S[n][m], degree n and order m from 0 (C[0][0] = 1)
//   n, m    the degree and order to use (m <= n)
// field.accel(r, out)   r planet-fixed km -> out km/s^2 (the whole field,
//                       point mass included)

// Fully normalised to unnormalised: C_nm = N_nm Cbar_nm with
// N_nm = sqrt((2 - delta_m0)(2n + 1)(n - m)! / (n + m)!).
export function normFactor(n, m) {
  let f = (2 - (m === 0 ? 1 : 0)) * (2 * n + 1);
  for (let k = n - m + 1; k <= n + m; k++) f /= k;
  return Math.sqrt(f);
}

export function geopotential({ mu, radius, n: N, m: M = N, C, S, normalized = true }) {
  const c = [], s = [];
  for (let n = 0; n <= N + 1; n++) {
    c.push(new Float64Array(n + 2)); s.push(new Float64Array(n + 2));
    if (n > N) continue;
    for (let m = 0; m <= Math.min(n, M); m++) {
      const f = normalized ? normFactor(n, m) : 1;
      c[n][m] = (C[n]?.[m] ?? 0) * f;
      s[n][m] = (S[n]?.[m] ?? 0) * f;
    }
  }
  c[0][0] = 1;
  const V = [], W = [];
  for (let n = 0; n <= N + 1; n++) { V.push(new Float64Array(n + 2)); W.push(new Float64Array(n + 2)); }

  function accel(r, out = [0, 0, 0]) {
    const R = radius, r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], rho = R * R / r2;
    const x0 = R * r[0] / r2, y0 = R * r[1] / r2, z0 = R * r[2] / r2;
    // V and W to degree N + 1 (the acceleration of degree n needs n + 1).
    V[0][0] = R / Math.sqrt(r2); W[0][0] = 0;
    V[1][0] = z0 * V[0][0]; W[1][0] = 0;
    for (let n = 2; n <= N + 1; n++) {
      V[n][0] = ((2 * n - 1) * z0 * V[n - 1][0] - (n - 1) * rho * V[n - 2][0]) / n;
      W[n][0] = 0;
    }
    for (let m = 1; m <= Math.min(M, N) + 1; m++) {
      V[m][m] = (2 * m - 1) * (x0 * V[m - 1][m - 1] - y0 * W[m - 1][m - 1]);
      W[m][m] = (2 * m - 1) * (x0 * W[m - 1][m - 1] + y0 * V[m - 1][m - 1]);
      if (m <= N) {
        V[m + 1][m] = (2 * m + 1) * z0 * V[m][m];
        W[m + 1][m] = (2 * m + 1) * z0 * W[m][m];
      }
      for (let n = m + 2; n <= N + 1; n++) {
        V[n][m] = ((2 * n - 1) * z0 * V[n - 1][m] - (n + m - 1) * rho * V[n - 2][m]) / (n - m);
        W[n][m] = ((2 * n - 1) * z0 * W[n - 1][m] - (n + m - 1) * rho * W[n - 2][m]) / (n - m);
      }
    }
    let ax = 0, ay = 0, az = 0;
    for (let m = 0; m <= M; m++) {
      for (let n = m; n <= N; n++) {
        const C_ = c[n][m], S_ = s[n][m];
        if (m === 0) {
          ax -= C_ * V[n + 1][1];
          ay -= C_ * W[n + 1][1];
          az += (n + 1) * (-C_ * V[n + 1][0]);
        } else {
          const f = (n - m + 2) * (n - m + 1) / 2;
          ax += 0.5 * (-C_ * V[n + 1][m + 1] - S_ * W[n + 1][m + 1]) + f * (C_ * V[n + 1][m - 1] + S_ * W[n + 1][m - 1]);
          ay += 0.5 * (-C_ * W[n + 1][m + 1] + S_ * V[n + 1][m + 1]) + f * (-C_ * W[n + 1][m - 1] + S_ * V[n + 1][m - 1]);
          az += (n - m + 1) * (-C_ * V[n + 1][m] - S_ * W[n + 1][m]);
        }
      }
    }
    const k = mu / (R * R);
    out[0] = k * ax; out[1] = k * ay; out[2] = k * az;
    return out;
  }
  return { mu, radius, n: N, m: M, accel };
}
