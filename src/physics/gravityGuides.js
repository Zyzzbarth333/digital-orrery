// src/physics/gravityGuides.js
//
// Where each body's gravity matters (docs/physics/gravity-guides.md): the
// sphere of influence, the Hill sphere, the five Lagrange points of a pair,
// the strongest pulls on a body, and maps of a body's real gravity field.
// Pure ES module, no dependencies.

// Sphere of influence (Laplace): inside it a body's pull, as a perturbation
// of the Sun's, outweighs the Sun's as a perturbation of the body's; the
// boundary patched conics switch at. r = a (m / M)^(2/5) (Curtis, Orbital
// Mechanics for Engineering Students, "Sphere of influence").
export function soiRadius(a, m, M) {
  return a * (m / M) ** 0.4;
}

// Hill sphere: the region where a body can hold a satellite against its
// primary's tide, to first order the distance to L1 and L2.
// r = a (1 - e) (m / 3M)^(1/3) (Hamilton and Burns 1992, at pericentre).
export function hillRadius(a, e, m, M) {
  return a * (1 - e) * (m / (3 * M)) ** (1 / 3);
}

// The collinear Lagrange points of the circular restricted three-body
// problem with mass ratio mu = m2 / (m1 + m2): positions along the line
// from the primary to the secondary, in units of their separation, from
// the barycentre (primary at -mu, secondary at 1 - mu). Newton on
//   f(x) = x - (1 - mu)(x + mu)/|x + mu|^3 - mu(x - 1 + mu)/|x - 1 + mu|^3
// from the usual first guesses (Szebehely, Theory of Orbits, 1967, ch. 4).
export function collinearPoints(mu) {
  const f = (x) => {
    const r1 = x + mu, r2 = x - 1 + mu;
    return x - ((1 - mu) * r1) / Math.abs(r1) ** 3 - (mu * r2) / Math.abs(r2) ** 3;
  };
  const df = (x) => 1 + (2 * (1 - mu)) / Math.abs(x + mu) ** 3 + (2 * mu) / Math.abs(x - 1 + mu) ** 3;
  const h = Math.cbrt(mu / 3);
  const solve = (x) => {
    for (let i = 0; i < 50; i++) {
      const dx = f(x) / df(x);
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    return x;
  };
  return { L1: solve(1 - mu - h), L2: solve(1 - mu + h), L3: solve(-1 - (5 * mu) / 12) };
}

// The five points for a pair at its present configuration (the circular
// problem applied to the instantaneous separation and orbital plane), in
// the frame of rP. rP, rS: positions of the primary and secondary; vRel:
// the secondary's velocity relative to the primary; gmP, gmS. L4 leads the
// secondary in its orbit, L5 trails it.
export function lagrangePoints(rP, rS, vRel, gmP, gmS) {
  const mu = gmS / (gmP + gmS);
  const d = [rS[0] - rP[0], rS[1] - rP[1], rS[2] - rP[2]];
  const sep = Math.hypot(d[0], d[1], d[2]);
  const ex = d.map((c) => c / sep);
  const h = cross(d, vRel);
  const hn = Math.hypot(h[0], h[1], h[2]);
  const ez = h.map((c) => c / hn);
  const ey = cross(ez, ex);                       // along the secondary's motion
  const at = (x, y) => [0, 1, 2].map((i) => rP[i] + sep * ((x + mu) * ex[i] + y * ey[i]));
  const c = collinearPoints(mu);
  const s = Math.sqrt(3) / 2;
  return { L1: at(c.L1, 0), L2: at(c.L2, 0), L3: at(c.L3, 0), L4: at(0.5 - mu, s), L5: at(0.5 - mu, -s), mu, separation: sep };
}

// The pull of each body on a target: GM / d^2 (km/s^2), strongest first.
// bodies: [{ key, gm, r }]; target: { key, r }.
export function strongestPulls(target, bodies) {
  const out = [];
  for (const b of bodies) {
    if (b.key === target.key || !b.gm) continue;
    const d = Math.hypot(b.r[0] - target.r[0], b.r[1] - target.r[1], b.r[2] - target.r[2]);
    out.push({ key: b.key, accel: b.gm / (d * d), distance: d });
  }
  return out.sort((a, b) => b.accel - a.accel);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// WGS 84's normal field (the reference ellipsoid's own gravity): its fully
// normalised even zonals, as NIMA TR8350.2 (3rd ed., 2000) gives them.
// Taken from EGM2008's, they leave the anomalies.
export const WGS84_NORMAL_ZONALS = { 2: -0.484166774985e-3, 4: 0.790303733511e-6, 6: -0.168724961151e-8, 8: 0.346052468394e-11, 10: -0.265002225747e-14 };

// A body's gravity on its reference sphere as a map, from fully normalised
// coefficients C[n][m], S[n][m] (degree 2 up to `degree`):
//   kind 'anomaly' (free-air, spherical approximation):
//     dg = GM/R^2 sum_n (n - 1) sum_m Pnm(sin lat)(dC cos m lon + S sin m lon)
//   kind 'disturbance': the same with (n + 1), the radial pull of the
//     harmonics themselves (used to check this against geopotential.js).
// `normal` (zonal degree -> C) is subtracted first. Returns km/s^2 in a
// Float64Array, row 0 at -90 deg latitude, column 0 at -180 deg longitude,
// `width` columns over 360 deg (the last not repeating the first) and
// `height` rows over 180 deg (both poles included).
// The longitude sum is split per latitude row: A_m = sum_n k_n Pnm C, so a
// row costs n^2 + m x width, not n^2 x width.
export function fieldMap({ gm, radius, C, S, degree, normal = {}, kind = 'anomaly', width, height }) {
  const out = new Float64Array(width * height);
  const P = legendreTable(degree);
  // cos m lon and sin m lon, m running fastest so the inner sum reads in order.
  const D = degree + 1;
  const cosM = new Float64Array(D * width), sinM = new Float64Array(D * width);
  for (let j = 0; j < width; j++) {
    const lon = -Math.PI + (2 * Math.PI * j) / width;
    for (let m = 0; m <= degree; m++) { cosM[j * D + m] = Math.cos(m * lon); sinM[j * D + m] = Math.sin(m * lon); }
  }
  const A = new Float64Array(degree + 1), B = new Float64Array(degree + 1);
  const g0 = gm / (radius * radius);
  for (let i = 0; i < height; i++) {
    const lat = -Math.PI / 2 + (Math.PI * i) / (height - 1);
    const p = P(Math.sin(lat), Math.cos(lat));
    A.fill(0); B.fill(0);
    for (let n = 2; n <= degree; n++) {
      const k = kind === 'anomaly' ? n - 1 : n + 1;
      for (let m = 0; m <= n; m++) {
        const c = (C[n]?.[m] ?? 0) - (m === 0 ? normal[n] ?? 0 : 0);
        const s = S[n]?.[m] ?? 0;
        const q = k * p[(n * (n + 1)) / 2 + m];
        A[m] += q * c;
        B[m] += q * s;
      }
    }
    for (let j = 0; j < width; j++) {
      let v = 0;
      const o = j * D;
      for (let m = 0; m <= degree; m++) v += A[m] * cosM[o + m] + B[m] * sinM[o + m];
      out[i * width + j] = g0 * v;
    }
  }
  return out;
}

// Fully normalised associated Legendre functions (geodesy's 4 pi norm, no
// Condon-Shortley phase) Pnm(t) with u = sqrt(1 - t^2), by the standard
// forward recursions (Holmes and Featherstone 2002, eqs. 11-13, unscaled:
// fine to degree 100 or so). Returns a function of (t, u) giving a flat
// array indexed n(n + 1)/2 + m.
export function legendreTable(N) {
  const size = ((N + 1) * (N + 2)) / 2;
  const a = new Float64Array(size), b = new Float64Array(size);
  for (let n = 2; n <= N; n++) {
    for (let m = 0; m <= n - 2; m++) {
      const k = (n * (n + 1)) / 2 + m;
      a[k] = Math.sqrt(((2 * n - 1) * (2 * n + 1)) / ((n - m) * (n + m)));
      b[k] = Math.sqrt(((2 * n + 1) * (n + m - 1) * (n - m - 1)) / ((n - m) * (n + m) * (2 * n - 3)));
    }
  }
  const p = new Float64Array(size);
  return (t, u) => {
    p[0] = 1;
    if (N >= 1) { p[1] = Math.sqrt(3) * t; p[2] = Math.sqrt(3) * u; }
    for (let m = 2; m <= N; m++) {
      p[(m * (m + 1)) / 2 + m] = u * Math.sqrt((2 * m + 1) / (2 * m)) * p[((m - 1) * m) / 2 + m - 1];
    }
    for (let m = 0; m < N; m++) {
      p[((m + 1) * (m + 2)) / 2 + m] = t * Math.sqrt(2 * m + 3) * p[(m * (m + 1)) / 2 + m];
    }
    for (let n = 2; n <= N; n++) {
      const k0 = (n * (n + 1)) / 2, k1 = ((n - 1) * n) / 2, k2 = ((n - 2) * (n - 1)) / 2;
      for (let m = 0; m <= n - 2; m++) p[k0 + m] = a[k0 + m] * t * p[k1 + m] - b[k0 + m] * p[k2 + m];
    }
    return p;
  };
}
