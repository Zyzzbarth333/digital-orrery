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
//   central false to leave out the point mass (C00), for the harmonics alone
// field.accel(r, out)   r planet-fixed km -> out km/s^2 (the whole field,
//                       point mass included)
// field.set(n, m, C, S)  change one coefficient after the field is built

// Fully normalised to unnormalised: C_nm = N_nm Cbar_nm with
// N_nm = sqrt((2 - delta_m0)(2n + 1)(n - m)! / (n + m)!).
export function normFactor(n, m) {
  let f = (2 - (m === 0 ? 1 : 0)) * (2 * n + 1);
  for (let k = n - m + 1; k <= n + m; k++) f /= k;
  return Math.sqrt(f);
}

export function geopotential({ mu, radius, n: N, m: M = N, C, S, normalized = true, central = true }) {
  // Everything lives in flat arrays indexed n * L + m (L = N + 3 columns, so
  // V and W reach degree and order N + 2): nested arrays cost an extra load
  // and bounds check per term, a third of a degree-20 field's time.
  const L = N + 3, at = (n, m) => n * L + m;
  const c = new Float64Array((N + 2) * L), s = new Float64Array((N + 2) * L);
  for (let n = 0; n <= N; n++) {
    for (let m = 0; m <= Math.min(n, M); m++) {
      const f = normalized ? normFactor(n, m) : 1;
      c[at(n, m)] = (C[n]?.[m] ?? 0) * f;
      s[at(n, m)] = (S[n]?.[m] ?? 0) * f;
    }
  }
  // The point mass, unless left out (central: false) when it is counted
  // elsewhere and only the harmonics are wanted.
  c[0] = central ? 1 : 0;
  const V = new Float64Array((N + 2) * L), W = new Float64Array((N + 2) * L);
  const MM = Math.min(M, N);

  function accel(r, out = [0, 0, 0]) {
    const R = radius, r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], rho = R * R / r2;
    const x0 = R * r[0] / r2, y0 = R * r[1] / r2, z0 = R * r[2] / r2;
    // V and W to degree N + 1 (the acceleration of degree n needs n + 1).
    V[0] = R / Math.sqrt(r2); W[0] = 0;
    V[L] = z0 * V[0]; W[L] = 0;
    for (let n = 2; n <= N + 1; n++) {
      V[n * L] = ((2 * n - 1) * z0 * V[(n - 1) * L] - (n - 1) * rho * V[(n - 2) * L]) / n;
      W[n * L] = 0;
    }
    for (let m = 1; m <= MM + 1; m++) {
      const mm = m * L + m, pp = mm - L - 1;
      V[mm] = (2 * m - 1) * (x0 * V[pp] - y0 * W[pp]);
      W[mm] = (2 * m - 1) * (x0 * W[pp] + y0 * V[pp]);
      if (m <= N) {
        V[mm + L] = (2 * m + 1) * z0 * V[mm];
        W[mm + L] = (2 * m + 1) * z0 * W[mm];
      }
      for (let n = m + 2; n <= N + 1; n++) {
        const i = n * L + m;
        V[i] = ((2 * n - 1) * z0 * V[i - L] - (n + m - 1) * rho * V[i - 2 * L]) / (n - m);
        W[i] = ((2 * n - 1) * z0 * W[i - L] - (n + m - 1) * rho * W[i - 2 * L]) / (n - m);
      }
    }
    let ax = 0, ay = 0, az = 0;
    for (let n = 0; n <= N; n++) {
      const C_ = c[n * L], j = (n + 1) * L;
      ax -= C_ * V[j + 1];
      ay -= C_ * W[j + 1];
      az += (n + 1) * (-C_ * V[j]);
    }
    for (let m = 1; m <= M; m++) {
      for (let n = m; n <= N; n++) {
        const i = n * L + m, j = i + L, C_ = c[i], S_ = s[i];
        const f = (n - m + 2) * (n - m + 1) / 2;
        ax += 0.5 * (-C_ * V[j + 1] - S_ * W[j + 1]) + f * (C_ * V[j - 1] + S_ * W[j - 1]);
        ay += 0.5 * (-C_ * W[j + 1] + S_ * V[j + 1]) + f * (-C_ * W[j - 1] + S_ * V[j - 1]);
        az += (n - m + 1) * (-C_ * V[j] - S_ * W[j]);
      }
    }
    const k = mu / (R * R);
    out[0] = k * ax; out[1] = k * ay; out[2] = k * az;
    return out;
  }
  // Change one coefficient (normalised if the field was built normalised):
  // for terms that vary in time, such as the solid Earth tide.
  const norms = new Float64Array((N + 2) * L);
  for (let n = 0; n <= N; n++) for (let m = 0; m <= n; m++) norms[at(n, m)] = normalized ? normFactor(n, m) : 1;
  function set(n, m, Cnm, Snm) {
    const f = norms[at(n, m)];
    c[at(n, m)] = Cnm * f; s[at(n, m)] = Snm * f;
  }
  return { mu, radius, n: N, m: M, accel, set };
}
