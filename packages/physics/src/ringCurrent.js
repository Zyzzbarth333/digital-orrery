// packages/physics/src/ringCurrent.js
//
// Saturn's ring current (docs/physics/magnetic-fields.md#saturns-ring-current):
// the Connerney et al. 1983 model fitted to Voyager, as Bunce and Cowley
// 2003 give it. An axisymmetric disc of azimuthal current j = I0 / rho
// between rho = a and b, |z| < D in the magnetic equator, with
// a = 8 R_S, b = 15.5 R_S, D = 3 R_S and mu0 I0 = 60.4 nT (about 11.5 MA in
// all). Bunce and Cowley show that Edwards et al.'s analytic forms, which
// serve Jupiter's thin, wide sheet (magnetic.js), fail near Saturn's
// "squarer" disc, so the field here is summed exactly: the disc as a stack
// of circular loops, each loop's field from complete elliptic integrals
// (Smythe 1968; Jackson, Classical Electrodynamics, sec. 5.5),
//
//   k^2 = 4 a rho / ((a + rho)^2 + z^2),   c = mu0 I / (2 pi sqrt((a + rho)^2 + z^2))
//   B_z   = c [K(k) + (a^2 - rho^2 - z^2) / ((a - rho)^2 + z^2) E(k)]
//   B_rho = c z / rho [-K(k) + (a^2 + rho^2 + z^2) / ((a - rho)^2 + z^2) E(k)]
//
// tabulated once on a (rho, z) grid and interpolated; beyond the table the
// disc is a dipole of its own moment.
//
//   SATURN_RC                       the parameters (R_S, nT)
//   ringCurrentTable(p, opts)       { done, step(ms), field(x, y, z, out) }
//   loopSumField(p, rho, z, n)      the direct sum (for the checks)
//   totalCurrentMA(p, radiusKm)     mu0 I0 ln(b / a) 2D / mu0

export const SATURN_RC = { a: 8, b: 15.5, D: 3, mu0I0: 60.4 };
const MU0 = 4e-7 * Math.PI;

// Complete elliptic integrals K(m), E(m) of parameter m = k^2, by the
// arithmetic-geometric mean.
export function ellipticKE(m) {
  let a = 1, b = Math.sqrt(1 - m), c = Math.sqrt(m), sum = 0.5 * c * c, pow = 0.5;
  for (let i = 0; i < 30 && Math.abs(c) > 1e-15; i++) {
    const an = (a + b) / 2;
    c = (a - b) / 2; b = Math.sqrt(a * b); a = an;
    pow *= 2; sum += pow * c * c;
  }
  const K = Math.PI / (2 * a);
  return [K, K * (1 - sum)];
}

// One loop of radius r0 carrying mu0 I (nT R): [B_rho, B_z] at (rho, z).
export function loopField(r0, mu0I, rho, z, out) {
  const s = (r0 + rho) ** 2 + z * z, d = (r0 - rho) ** 2 + z * z;
  if (d < 1e-12) { out[0] = out[1] = 0; return out; }
  const [K, E] = ellipticKE(Math.min(4 * r0 * rho / s, 1 - 1e-15)), c = mu0I / (2 * Math.PI * Math.sqrt(s));
  out[1] = c * (K + ((r0 * r0 - rho * rho - z * z) / d) * E);
  out[0] = rho > 1e-9 ? c * (z / rho) * (-K + ((r0 * r0 + rho * rho + z * z) / d) * E) : 0;
  return out;
}

// The disc as nr x nz loops at cell centres: [{ r, z, mu0dI }].
function loops(p, dr = 0.25, dz = 0.25) {
  const out = [], nr = Math.round((p.b - p.a) / dr), nz = Math.round((2 * p.D) / dz);
  for (let i = 0; i < nr; i++) {
    const r = p.a + (i + 0.5) * ((p.b - p.a) / nr);
    for (let j = 0; j < nz; j++) out.push({ r, z: -p.D + (j + 0.5) * ((2 * p.D) / nz), mu0dI: (p.mu0I0 / r) * ((p.b - p.a) / nr) * ((2 * p.D) / nz) });
  }
  return out;
}

export function loopSumField(p, rho, z, dr = 0.25, dz = 0.25) {
  const t = [0, 0];
  let br = 0, bz = 0;
  for (const L of loops(p, dr, dz)) { loopField(L.r, L.mu0dI, rho, z - L.z, t); br += t[0]; bz += t[1]; }
  return [br, bz];
}

// The disc's dipole moment, as mu0 m / 4 pi (nT R^3): sum of mu0 dI r^2 / 4.
export function discMoment(p) {
  // Exact: mu0 I0 (2D) (b^2 - a^2) / 8.
  return (p.mu0I0 * 2 * p.D * (p.b * p.b - p.a * p.a)) / 8;
}

export const totalCurrentMA = (p, radiusKm) => ((p.mu0I0 * 1e-9) / MU0) * Math.log(p.b / p.a) * 2 * p.D * radiusKm * 1e3 / 1e6;

// The table: rho 0..rhoMax, z 0..zMax (mirrored), step h, filled a few
// rows a frame; field() is the body-fixed Cartesian field (the disc's axis
// along z), zero until done.
export function ringCurrentTable(p = SATURN_RC, { rhoMax = 24, zMax = 20, h = 0.2, dr = 0.25, dz = 0.25 } = {}) {
  const nr = Math.round(rhoMax / h) + 1, nz = Math.round(zMax / h) + 1;
  const Br = new Float32Array(nr * nz), Bz = new Float32Array(nr * nz), L = loops(p, dr, dz), t = [0, 0];
  const md = discMoment(p);
  let row = 0;
  const T = {
    done: false,
    step(ms = Infinity) {
      const t0 = performance.now();
      while (row < nr && performance.now() - t0 < ms) {
        const rho = row * h;
        for (let j = 0; j < nz; j++) {
          const z = j * h;
          let br = 0, bz = 0;
          for (const l of L) { loopField(l.r, l.mu0dI, rho, z - l.z, t); br += t[0]; bz += t[1]; }
          Br[row * nz + j] = br; Bz[row * nz + j] = bz;
        }
        row++;
      }
      T.done = row >= nr;
      return T.done;
    },
    field(x, y, z, out) {
      const rho = Math.hypot(x, y), az = Math.abs(z);
      let br, bz;
      if (rho < rhoMax - h && az < zMax - h) {
        const fr = rho / h, fz = az / h, i = Math.floor(fr), j = Math.floor(fz), u = fr - i, v = fz - j;
        const k00 = i * nz + j, k10 = k00 + nz;
        br = (1 - u) * ((1 - v) * Br[k00] + v * Br[k00 + 1]) + u * ((1 - v) * Br[k10] + v * Br[k10 + 1]);
        bz = (1 - u) * ((1 - v) * Bz[k00] + v * Bz[k00 + 1]) + u * ((1 - v) * Bz[k10] + v * Bz[k10 + 1]);
        if (z < 0) br = -br;             // B_rho is odd in z, B_z even
      } else {
        // A dipole of the disc's moment along +z.
        const r2 = rho * rho + z * z, r5 = r2 * r2 * Math.sqrt(r2);
        br = (3 * md * z * rho) / r5; bz = (md * (3 * z * z - r2)) / r5;
      }
      const c = rho > 1e-9 ? x / rho : 1, s = rho > 1e-9 ? y / rho : 0;
      out[0] = br * c; out[1] = br * s; out[2] = bz;
      return out;
    },
  };
  return T;
}
