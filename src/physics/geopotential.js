// src/physics/geopotential.js
//
// A planet's gravitation from spherical harmonics, to any degree and order:
// the acceleration in the planet-fixed frame. Pure ES module, no
// dependencies.
//
// Method: the V/W recursion of Cunningham (1970), as set out by Montenbruck
// and Gill, Satellite Orbits (2000), section 3.2.4, eqs. 3.27-3.33, carried
// out on fully normalised V and W throughout. It needs no latitude or
// longitude, so it has no singularity at the poles. Normalised, its terms
// stay near 1 at any degree: unnormalised, (n + m)! overflows a double past
// about degree 85. The column and sectoral ratios below are those of the
// standard forward column recursion for fully normalised Legendre
// functions (Holmes and Featherstone 2002, J. Geodesy 76, 279,
// doi:10.1007/s00190-002-0216-2), here applied to the solid harmonics
// rather than to Pbar(sin lat), whose derivatives are singular at the poles.
//
//   Vbar_nm + i Wbar_nm = N_nm (R/r)^(n+1) P_nm(sin lat) e^(i m lon),
//   N_nm = sqrt((2 - delta_m0)(2n + 1)(n - m)! / (n + m)!),
//
// so that C_nm V_nm = Cbar_nm Vbar_nm. Each of M&G's recursions and
// acceleration sums, rewritten in the barred terms, gains a ratio of N's,
// which is a square root of small integers. Those ratios are tabulated once
// when the field is built, so a call is multiplications and additions alone.
//
// field = geopotential({ mu, radius, n, C, S, normalized })
//   mu      km^3/s^2;  radius  the reference radius, km
//   C, S    C[n][m], S[n][m], degree n and order m from 0 (C[0][0] = 1),
//           fully normalised (or unnormalised, normalized: false)
//   n, m    the degree and order to use (m <= n)
//   central false to leave out the point mass (C00), for the harmonics alone
// field.accel(r, out)   r planet-fixed km -> out km/s^2 (the whole field,
//                       point mass included)
// field.set(n, m, C, S)  change one coefficient after the field is built

// Fully normalised to unnormalised: C_nm = N_nm Cbar_nm with
// N_nm = sqrt((2 - delta_m0)(2n + 1)(n - m)! / (n + m)!). It underflows to 0
// past about degree 85, so the field itself doesn't use it; environment.js's
// tides do, at degree 2 and 3.
export function normFactor(n, m) {
  let f = (2 - (m === 0 ? 1 : 0)) * (2 * n + 1);
  for (let k = n - m + 1; k <= n + m; k++) f /= k;
  return Math.sqrt(f);
}

export function geopotential({ mu, radius, n: N, m: M = N, C, S, normalized = true, central = true }) {
  // Everything lives in flat arrays indexed n * L + m (L = N + 3 columns, so
  // V and W reach degree and order N + 2): nested arrays cost an extra load
  // and bounds check per term, a third of a degree-20 field's time.
  const L = N + 3, at = (n, m) => n * L + m, size = (N + 2) * L;
  const MM = Math.min(M, N);
  const c = new Float64Array(size), s = new Float64Array(size);
  function set(n, m, Cnm, Snm) {
    const f = normalized ? 1 : 1 / normFactor(n, m);
    c[at(n, m)] = Cnm * f; s[at(n, m)] = Snm * f;
  }
  for (let n = 0; n <= N; n++) for (let m = 0; m <= Math.min(n, MM); m++) set(n, m, C[n]?.[m] ?? 0, S[n]?.[m] ?? 0);
  // The point mass, unless left out (central: false) when it is counted
  // elsewhere and only the harmonics are wanted.
  c[0] = central ? 1 : 0;

  // The recursions' ratios. Off the diagonal (M&G eq. 3.30), for n > m:
  //   Vbar_nm = a_nm z0 Vbar_n-1,m - b_nm rho Vbar_n-2,m,
  //   a_nm = sqrt((2n + 1)(2n - 1) / ((n - m)(n + m))),
  //   b_nm = sqrt((2n + 1)(n + m - 1)(n - m - 1) / ((2n - 3)(n + m)(n - m)))
  // (b = 0 for n = m + 1). On it (eq. 3.29), Vbar_mm = d_m (x0 Vbar_m-1,m-1
  // - y0 Wbar_m-1,m-1) and the same for W, with d_1 = sqrt(3) and
  // d_m = sqrt((2m + 1) / 2m) for m > 1.
  const A = new Float64Array(size), B = new Float64Array(size), D = new Float64Array(N + 3);
  for (let m = 0; m <= MM + 1; m++) {
    D[m] = m === 0 ? 1 : m === 1 ? Math.sqrt(3) : Math.sqrt((2 * m + 1) / (2 * m));
    for (let n = m + 1; n <= N + 1; n++) {
      A[at(n, m)] = Math.sqrt((2 * n + 1) * (2 * n - 1) / ((n - m) * (n + m)));
      B[at(n, m)] = n === m + 1 ? 0 : Math.sqrt((2 * n + 1) * (n + m - 1) * (n - m - 1) / ((2 * n - 3) * (n + m) * (n - m)));
    }
  }
  // The acceleration's ratios (eq. 3.33), each N_nm over the N of the term
  // it multiplies, with M&G's own factors folded in:
  //   e1 = N_nm / N_n+1,m+1             (times 1/2 for m > 0)
  //   e2 = (n - m + 2)! / (n - m)! N_nm / N_n+1,m-1 / 2      (m > 0)
  //   e3 = (n - m + 1) N_nm / N_n+1,m
  const E1 = new Float64Array(size), E2 = new Float64Array(size), E3 = new Float64Array(size);
  for (let n = 0; n <= N; n++) {
    const q = (2 * n + 1) / (2 * n + 3);
    for (let m = 0; m <= Math.min(n, MM); m++) {
      const i = at(n, m);
      E1[i] = m === 0 ? Math.sqrt(q * (n + 1) * (n + 2) / 2) : 0.5 * Math.sqrt(q * (n + m + 1) * (n + m + 2));
      E2[i] = m === 0 ? 0 : 0.5 * Math.sqrt((m === 1 ? 2 : 1) * q * (n - m + 1) * (n - m + 2));
      E3[i] = Math.sqrt(q * (n + m + 1) * (n - m + 1));
    }
  }

  const V = new Float64Array(size), W = new Float64Array(size);
  function accel(r, out = [0, 0, 0]) {
    const R = radius, r2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], rho = R * R / r2;
    const x0 = R * r[0] / r2, y0 = R * r[1] / r2, z0 = R * r[2] / r2;
    // Vbar and Wbar to degree N + 1 (the acceleration of degree n needs
    // n + 1), and order MM + 1.
    V[0] = R / Math.sqrt(r2); W[0] = 0;
    for (let m = 0; m <= MM + 1; m++) {
      const mm = m * L + m;
      if (m > 0) {
        const pp = mm - L - 1, d = D[m];
        V[mm] = d * (x0 * V[pp] - y0 * W[pp]);
        W[mm] = d * (x0 * W[pp] + y0 * V[pp]);
      }
      if (m <= N) {
        const a = A[mm + L] * z0;
        V[mm + L] = a * V[mm]; W[mm + L] = a * W[mm];
      }
      for (let i = mm + 2 * L, end = (N + 1) * L + m; i <= end; i += L) {
        const a = A[i] * z0, b = B[i] * rho;
        V[i] = a * V[i - L] - b * V[i - 2 * L];
        W[i] = a * W[i - L] - b * W[i - 2 * L];
      }
    }
    let ax = 0, ay = 0, az = 0;
    for (let n = 0; n <= N; n++) {
      const i = n * L, j = i + L, C_ = c[i];
      ax -= C_ * E1[i] * V[j + 1];
      ay -= C_ * E1[i] * W[j + 1];
      az -= C_ * E3[i] * V[j];
    }
    for (let m = 1; m <= MM; m++) {
      for (let n = m; n <= N; n++) {
        const i = n * L + m, j = i + L, C_ = c[i], S_ = s[i], e1 = E1[i], e2 = E2[i];
        ax += e1 * (-C_ * V[j + 1] - S_ * W[j + 1]) + e2 * (C_ * V[j - 1] + S_ * W[j - 1]);
        ay += e1 * (-C_ * W[j + 1] + S_ * V[j + 1]) + e2 * (-C_ * W[j - 1] + S_ * V[j - 1]);
        az -= E3[i] * (C_ * V[j] + S_ * W[j]);
      }
    }
    const k = mu / (R * R);
    out[0] = k * ax; out[1] = k * ay; out[2] = k * az;
    return out;
  }
  // Change one coefficient (normalised if the field was built normalised):
  // for terms that vary in time, such as the solid Earth tide.
  return { mu, radius, n: N, m: M, accel, set };
}
