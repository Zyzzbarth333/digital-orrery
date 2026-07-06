// src/physics/orbital.js
//
// Orbital-mechanics core for digital-orrery. Pure ES module: no imports, no
// three.js, no dependencies. Operates on plain 3-element number arrays [x,y,z]
// and plain numbers.
//
// Units (consistent throughout): distance km, velocity km/s, time s,
// gravitational parameter mu in km^3/s^2. Angles in radians.
//
// Methods follow Curtis, "Orbital Mechanics for Engineering Students":
//   Kepler solve  -> Algorithm 3.1 (Newton-Raphson)
//   rv->elements  -> Algorithm 4.1/4.2
//   elements->rv  -> Algorithm 4.5 (perifocal -> ECI, 3-1-3)
//   Lambert       -> Algorithm 5.2 (universal variables, zero-rev)
// This module is a 1:1 port of a Python reference that was numerically
// verified against textbook cases (see orbital.test.mjs).

const TWO_PI = 2.0 * Math.PI;

// ---------------- small vector helpers (plain arrays) ----------------
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

// ---------- Kepler's equation via Newton-Raphson (Curtis Algorithm 3.1) ----------
// Solve M = E - e*sin(E) for the eccentric anomaly E. Wraps M to [-pi, pi]
// for a good initial guess; stable for e up to ~0.99.
export function solveKepler(M, e) {
  M = M % TWO_PI;
  if (M > Math.PI) M -= TWO_PI;
  else if (M < -Math.PI) M += TWO_PI;
  // Curtis initial guess (M is now in [-pi, pi], so E0 = M + e/2)
  let E = M < Math.PI ? M + e / 2.0 : M - e / 2.0;
  for (let iter = 0; iter < 100; iter++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1.0 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < 1e-13) break;
  }
  return E;
}

// -------- state vectors -> classical orbital elements (Curtis Algorithm 4.1) --------
// Returns { a, e, i, raan, argp, nu, M, h, period }. Angles in radians.
// Robust to equatorial (node undefined) and circular (perigee undefined) orbits
// via the standard fallbacks (argument of latitude / true longitude).
export function rvToElements(rVec, vVec, mu) {
  const r = norm(rVec);
  const v = norm(vVec);
  const vr = dot(rVec, vVec) / r;                 // radial velocity
  const hVec = cross(rVec, vVec);
  const h = norm(hVec);
  // inclination
  const i = Math.acos(clamp(hVec[2] / h, -1.0, 1.0));
  // node line n = k x h
  const nVec = cross([0.0, 0.0, 1.0], hVec);
  const n = norm(nVec);
  // RAAN
  let raan;
  if (n > 1e-12) {
    raan = Math.acos(clamp(nVec[0] / n, -1.0, 1.0));
    if (nVec[1] < 0.0) raan = TWO_PI - raan;
  } else {
    raan = 0.0;                                   // equatorial: node undefined
  }
  // eccentricity vector: ( (v^2 - mu/r) r - (r.v) v ) / mu
  const eVec = scale(
    sub(scale(rVec, v * v - mu / r), scale(vVec, r * vr)),
    1.0 / mu
  );
  const e = norm(eVec);
  // argument of perigee
  let argp;
  if (n > 1e-12 && e > 1e-12) {
    argp = Math.acos(clamp(dot(nVec, eVec) / (n * e), -1.0, 1.0));
    if (eVec[2] < 0.0) argp = TWO_PI - argp;
  } else if (e > 1e-12) {
    // equatorial non-circular: longitude of perigee from x-axis
    argp = Math.atan2(eVec[1], eVec[0]);
    if (hVec[2] < 0.0) argp = TWO_PI - argp;
    argp = ((argp % TWO_PI) + TWO_PI) % TWO_PI;
  } else {
    argp = 0.0;
  }
  // true anomaly
  let nu;
  if (e > 1e-12) {
    nu = Math.acos(clamp(dot(eVec, rVec) / (e * r), -1.0, 1.0));
    if (vr < 0.0) nu = TWO_PI - nu;
  } else if (n > 1e-12) {
    // circular inclined: argument of latitude, measured from node
    nu = Math.acos(clamp(dot(nVec, rVec) / (n * r), -1.0, 1.0));
    if (rVec[2] < 0.0) nu = TWO_PI - nu;
  } else {
    // circular equatorial: true longitude, measured from x-axis
    nu = Math.acos(clamp(rVec[0] / r, -1.0, 1.0));
    if (rVec[1] < 0.0) nu = TWO_PI - nu;
  }
  // semi-major axis from vis-viva / energy
  const a = 1.0 / (2.0 / r - v * v / mu);
  // mean anomaly and period
  let M, period;
  if (e < 1.0) {
    const E = 2.0 * Math.atan2(
      Math.sqrt(1.0 - e) * Math.sin(nu / 2.0),
      Math.sqrt(1.0 + e) * Math.cos(nu / 2.0)
    );
    M = E - e * Math.sin(E);
    M = ((M % TWO_PI) + TWO_PI) % TWO_PI;
    period = (TWO_PI / Math.sqrt(mu)) * Math.pow(a, 1.5);
  } else {
    // hyperbolic
    const F = 2.0 * Math.atanh(Math.sqrt((e - 1.0) / (e + 1.0)) * Math.tan(nu / 2.0));
    M = e * Math.sinh(F) - F;
    period = Infinity;
  }
  return { a, e, i, raan, argp, nu, M, h, period };
}

// -------- classical elements -> state vectors (Curtis Algorithm 4.5) --------
// Perifocal position/velocity rotated to ECI via 3-1-3 rotation by
// (argp, i, raan). Accepts an elements object; uses h if present, else derives
// it from a and e.
export function elementsToRv(el, mu) {
  const a = el.a, e = el.e, i = el.i;
  const raan = el.raan, argp = el.argp, nu = el.nu;
  let h = el.h;
  if (h === undefined || h === null) {
    const p = a * (1.0 - e * e);          // semi-latus rectum
    h = Math.sqrt(mu * p);
  }
  // perifocal frame
  const cnu = Math.cos(nu), snu = Math.sin(nu);
  const rpScale = ((h * h) / mu) / (1.0 + e * cnu);
  const rp = [rpScale * cnu, rpScale * snu, 0.0];
  const vpScale = mu / h;
  const vp = [-vpScale * snu, vpScale * (e + cnu), 0.0];
  // rotation matrix perifocal -> geocentric equatorial: R3(-raan) R1(-i) R3(-argp)
  const cr = Math.cos(raan), sr = Math.sin(raan);
  const ci = Math.cos(i), si = Math.sin(i);
  const cw = Math.cos(argp), sw = Math.sin(argp);
  const Q = [
    [cr * cw - sr * sw * ci, -cr * sw - sr * cw * ci, sr * si],
    [sr * cw + cr * sw * ci, -sr * sw + cr * cw * ci, -cr * si],
    [sw * si, cw * si, ci],
  ];
  const apply = (Qm, x) => [
    Qm[0][0] * x[0] + Qm[0][1] * x[1] + Qm[0][2] * x[2],
    Qm[1][0] * x[0] + Qm[1][1] * x[1] + Qm[1][2] * x[2],
    Qm[2][0] * x[0] + Qm[2][1] * x[1] + Qm[2][2] * x[2],
  ];
  return { r: apply(Q, rp), v: apply(Q, vp) };
}

// -------- real Kepler propagation --------
// rv -> elements, advance mean anomaly M by n*dt, solve Kepler, elements -> rv.
// This replaces the app's fake propagation. Handles ellipses; hyperbolic orbits
// are propagated via the hyperbolic Kepler equation.
export function propagate(rVec, vVec, dt, mu) {
  const el = rvToElements(rVec, vVec, mu);
  const a = el.a, e = el.e;
  if (e >= 1.0) {
    // hyperbolic mean motion and Kepler solve: M = e*sinh(F) - F
    const n = Math.sqrt(mu / Math.pow(-a, 3));
    const M = el.M + n * dt;
    let F = M;
    for (let iter = 0; iter < 100; iter++) {
      const f = e * Math.sinh(F) - F - M;
      const fp = e * Math.cosh(F) - 1.0;
      const dF = f / fp;
      F -= dF;
      if (Math.abs(dF) < 1e-13) break;
    }
    const nu = 2.0 * Math.atan2(
      Math.sqrt(e + 1.0) * Math.sinh(F / 2.0),
      Math.sqrt(e - 1.0) * Math.cosh(F / 2.0)
    );
    el.nu = nu;
    return elementsToRv(el, mu);
  }
  const n = Math.sqrt(mu / Math.pow(a, 3));   // mean motion
  const M = el.M + n * dt;
  const E = solveKepler(M, e);
  const nu = 2.0 * Math.atan2(
    Math.sqrt(1.0 + e) * Math.sin(E / 2.0),
    Math.sqrt(1.0 - e) * Math.cos(E / 2.0)
  );
  el.nu = nu;
  return elementsToRv(el, mu);
}

// -------- Stumpff functions C(z), S(z) (series near z=0 for stability) --------
function stumpffC(z) {
  if (z > 1e-6) return (1.0 - Math.cos(Math.sqrt(z))) / z;
  if (z < -1e-6) return (Math.cosh(Math.sqrt(-z)) - 1.0) / (-z);
  return 1.0 / 2.0 - z / 24.0 + (z * z) / 720.0;
}
function stumpffS(z) {
  if (z > 1e-6) {
    const sz = Math.sqrt(z);
    return (sz - Math.sin(sz)) / Math.pow(sz, 3);
  }
  if (z < -1e-6) {
    const sz = Math.sqrt(-z);
    return (Math.sinh(sz) - sz) / Math.pow(sz, 3);
  }
  return 1.0 / 6.0 - z / 120.0 + (z * z) / 5040.0;
}

// -------- Lambert solver (Curtis Algorithm 5.2, universal variables) --------
// Zero-revolution solution. Given two position vectors and a time of flight,
// returns the departure/arrival velocities { v1, v2 }. `prograde` selects the
// transfer direction (true => prograde, i.e. positive z angular momentum).
export function lambert(r1Vec, r2Vec, tof, mu, prograde = true) {
  const r1 = norm(r1Vec);
  const r2 = norm(r2Vec);
  const cross12 = cross(r1Vec, r2Vec);
  let dtheta = Math.acos(clamp(dot(r1Vec, r2Vec) / (r1 * r2), -1.0, 1.0));
  if (prograde) {
    if (cross12[2] < 0.0) dtheta = TWO_PI - dtheta;
  } else {
    if (cross12[2] >= 0.0) dtheta = TWO_PI - dtheta;
  }
  const A = Math.sin(dtheta) * Math.sqrt((r1 * r2) / (1.0 - Math.cos(dtheta)));

  const y = (z) =>
    r1 + r2 + A * (z * stumpffS(z) - 1.0) / Math.sqrt(stumpffC(z));

  const F = (z) => {
    const Cz = stumpffC(z), Sz = stumpffS(z), yz = y(z);
    return Math.pow(yz / Cz, 1.5) * Sz + A * Math.sqrt(yz) - Math.sqrt(mu) * tof;
  };

  const dFdz = (z) => {
    if (Math.abs(z) < 1e-6) {
      const y0 = y(0.0);
      return (Math.sqrt(2.0) / 40.0) * Math.pow(y0, 1.5) +
        (A / 8.0) * (Math.sqrt(y0) + A * Math.sqrt(1.0 / (2.0 * y0)));
    }
    const Cz = stumpffC(z), Sz = stumpffS(z), yz = y(z);
    return Math.pow(yz / Cz, 1.5) *
      ((1.0 / (2.0 * z)) * (Cz - 1.5 * Sz / Cz) + 0.75 * (Sz * Sz) / Cz) +
      (A / 8.0) * (3.0 * (Sz / Cz) * Math.sqrt(yz) + A * Math.sqrt(Cz / yz));
  };

  // bracket: increase z until y(z) >= 0, then Newton-Raphson on F(z)=0
  let z = 0.0;
  while (y(z) < 0.0) z += 0.1;
  for (let iter = 0; iter < 1000; iter++) {
    const Fz = F(z);
    const dz = Fz / dFdz(z);
    z -= dz;
    if (Math.abs(dz) < 1e-10) break;
  }

  const yz = y(z);
  const f = 1.0 - yz / r1;               // Lagrange coefficients
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1.0 - yz / r2;
  const v1 = scale(sub(r2Vec, scale(r1Vec, f)), 1.0 / g);
  const v2 = scale(sub(scale(r2Vec, gdot), r1Vec), 1.0 / g);
  return { v1, v2 };
}

// -------- Hohmann transfer between coplanar circular orbits --------
// r1, r2 are circular-orbit radii (km). Returns the two burn magnitudes,
// their sum, and the half-ellipse time of flight.
export function hohmann(r1, r2, mu) {
  const v1 = Math.sqrt(mu / r1);
  const v2 = Math.sqrt(mu / r2);
  const at = 0.5 * (r1 + r2);                     // transfer semi-major axis
  const vp = Math.sqrt(mu * (2.0 / r1 - 1.0 / at)); // speed at transfer perigee
  const va = Math.sqrt(mu * (2.0 / r2 - 1.0 / at)); // speed at transfer apogee
  const dv1 = Math.abs(vp - v1);
  const dv2 = Math.abs(v2 - va);
  const tof = Math.PI * Math.sqrt(Math.pow(at, 3) / mu);
  return { dv1, dv2, total: dv1 + dv2, tof };
}