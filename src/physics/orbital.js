// src/physics/orbital.js
//
// Orbital-mechanics core for digital-orrery. Pure ES module: no imports, no
// three.js, no dependencies. Operates on plain 3-element number arrays [x,y,z]
// and plain numbers.
//
// Units (consistent throughout): distance km, velocity km/s, time s,
// gravitational parameter mu in km^3/s^2. Angles in radians.
//
// Methods follow Curtis, "Orbital Mechanics for Engineering Students" (4th ed.):
//   Kepler solve  -> Algorithm 3.1 (Newton-Raphson)
//   propagate     -> Algorithms 3.3/3.4 (universal variables, Lagrange f and g)
//   rv->elements  -> Algorithm 4.1/4.2
//   elements->rv  -> Algorithm 4.5 (perifocal -> ECI, 3-1-3)
//   Lambert       -> Algorithm 5.2 (universal variables, zero-rev)
// Verified in orbital.test.mjs against the book's worked examples, NAIF CSPICE
// with DE440 (fixtures/spice_reference.json) and an independent integrator.

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

// -------- two-body propagation (Curtis Algorithms 3.3 and 3.4) --------
// Universal-variable Kepler propagation with Lagrange f and g. One code path
// covers ellipses, parabolas and hyperbolas, so there is no element or
// mean-anomaly conversion to go singular at e = 1.
//
// Root finding: the universal Kepler equation t(chi) is monotonic in chi
// (dt/dchi = r / sqrt(mu) > 0), so the root is bracketed first and then
// solved by Newton steps that fall back to bisection when a step leaves the
// bracket or an evaluation overflows. The previous element-based version
// returned NaN for e = 1 exactly, gave wrong states when e rounded to just
// below 1, and diverged on hyperbolas for large dt.
//
// For ellipses dt is first reduced modulo the period, so many-revolution
// propagation keeps full precision. Negative dt propagates backwards.
// Returns { r, v }, or null if the solve fails (not seen in testing).
export function propagate(rVec, vVec, dt, mu) {
  const r0 = norm(rVec);
  const v0 = norm(vVec);
  const sqrtMu = Math.sqrt(mu);
  const vr0 = dot(rVec, vVec) / r0;
  const alpha = 2.0 / r0 - (v0 * v0) / mu;          // 1/a (0 for a parabola)

  // Ellipse: remove whole periods.
  if (alpha > 0.0) {
    const T = TWO_PI / (sqrtMu * Math.pow(alpha, 1.5));
    dt = dt - T * Math.round(dt / T);
  }
  if (dt === 0.0) return { r: [...rVec], v: [...vVec] };

  const k1 = r0 * vr0 / sqrtMu;
  const k2 = 1.0 - alpha * r0;
  const target = sqrtMu * dt;
  // sqrt(mu)*t(chi) and its derivative r(chi). Overflow (deep hyperbola) is
  // mapped to +/-Infinity in the direction of chi, keeping t monotonic.
  const T = (x) => {
    const z = alpha * x * x;
    const val = k1 * x * x * stumpffC(z) + k2 * x * x * x * stumpffS(z) + r0 * x;
    return Number.isNaN(val) ? Math.sign(x) * Infinity : val;
  };
  const R = (x) => {
    const z = alpha * x * x;
    return k1 * x * (1.0 - z * stumpffS(z)) + k2 * x * x * stumpffC(z) + r0;
  };

  // Bracket [lo, hi] around the root, starting from Curtis' initial guess.
  const sgn = Math.sign(dt);
  let guess = sqrtMu * Math.abs(alpha) * Math.abs(dt);
  if (!(guess > 0.0) || !Number.isFinite(guess)) guess = Math.abs(target) / r0;
  let near = 0.0;
  let far = sgn * Math.max(guess, 1e-12);
  for (let k = 0; k < 400 && sgn * (T(far) - target) < 0.0; k++) {
    near = far;
    far *= 2.0;
  }
  let lo = Math.min(near, far), hi = Math.max(near, far);
  if (!(T(lo) <= target && T(hi) >= target)) return null;

  // Newton with a bisection step whenever Newton would leave the bracket or
  // is not at least halving it (far from the root on a hyperbola, t(chi)
  // grows exponentially and plain Newton creeps).
  let x = 0.5 * (lo + hi);
  let stepOld = hi - lo;
  let converged = false;
  for (let iter = 0; iter < 300; iter++) {
    const Fx = T(x) - target;
    if (Math.abs(Fx) <= 1e-14 * Math.max(Math.abs(target), r0 * Math.abs(x), 1.0)) { converged = true; break; }
    if (Fx < 0.0) lo = x; else hi = x;
    if (hi - lo <= 1e-15 * Math.max(1.0, Math.abs(x))) { converged = true; break; }
    const d = R(x);
    const newtonOk = Number.isFinite(Fx) && d > 0.0 && Number.isFinite(d);
    const xn = newtonOk ? x - Fx / d : NaN;
    if (!(xn > lo && xn < hi) || Math.abs(xn - x) > 0.5 * stepOld) {
      stepOld = hi - lo;
      x = 0.5 * (lo + hi);
    } else {
      stepOld = Math.abs(xn - x);
      x = xn;
    }
  }
  if (!converged) return null;

  // Lagrange coefficients (Curtis Eqs. 3.69, 3.70)
  const z = alpha * x * x;
  const Cz = stumpffC(z), Sz = stumpffS(z);
  const f = 1.0 - (x * x / r0) * Cz;
  const g = dt - (x * x * x / sqrtMu) * Sz;
  const r = add(scale(rVec, f), scale(vVec, g));
  const rn = norm(r);
  const fdot = (sqrtMu / (rn * r0)) * (alpha * x * x * x * Sz - x);
  const gdot = 1.0 - (x * x / rn) * Cz;
  const v = add(scale(rVec, fdot), scale(vVec, gdot));
  if (!r.every(Number.isFinite) || !v.every(Number.isFinite)) return null;
  return { r, v };
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
// returns { v1, v2, z, iterations }: the departure/arrival velocities, the
// converged universal variable z (z > 0 ellipse, z < 0 hyperbola) and the
// iteration count. `prograde` selects the transfer direction (true =>
// prograde, i.e. positive z angular momentum).
//
// Returns null when no solution can be trusted: degenerate geometry (transfer
// angle ~0 or ~180 deg, where the transfer plane is undefined), non-positive
// time of flight, or no convergence. Callers (e.g. a porkchop grid) should
// treat null as "no transfer" rather than receive NaN or a wrong answer.
//
// Root finding: for zero-rev transfers the time of flight increases
// monotonically with z on (-inf, 4*pi^2), so F(z) = sqrt(mu)*(t(z) - tof) has
// exactly one root there. The root is bracketed first, then solved by Newton
// steps that fall back to bisection whenever a step leaves the bracket. Where
// y(z) < 0 (only possible for transfer angles < 180 deg, at low z) the
// geometry is infeasible and the time of flight is "too short", so it is
// treated as F < 0. The earlier unbracketed Newton from z = 0 diverged or
// converged to the wrong place for most transfers longer than 180 deg.
const LAMBERT_Z_MAX = 4.0 * Math.PI * Math.PI;   // zero-rev upper limit
const LAMBERT_Z_MIN = -1.0e5;                    // keeps sinh(sqrt(-z)) finite
const LAMBERT_ANGLE_EPS = 1e-8;                  // rad, from 0 or 180 deg

export function lambert(r1Vec, r2Vec, tof, mu, prograde = true) {
  if (!(tof > 0.0)) return null;
  const r1 = norm(r1Vec);
  const r2 = norm(r2Vec);
  const cross12 = cross(r1Vec, r2Vec);
  let dtheta = Math.acos(clamp(dot(r1Vec, r2Vec) / (r1 * r2), -1.0, 1.0));
  if (prograde) {
    if (cross12[2] < 0.0) dtheta = TWO_PI - dtheta;
  } else {
    if (cross12[2] >= 0.0) dtheta = TWO_PI - dtheta;
  }
  // Degenerate: at 0/360 deg A blows up, at 180 deg A -> 0 and g -> 0.
  if (dtheta < LAMBERT_ANGLE_EPS || TWO_PI - dtheta < LAMBERT_ANGLE_EPS ||
      Math.abs(dtheta - Math.PI) < LAMBERT_ANGLE_EPS) {
    return null;
  }
  const A = Math.sin(dtheta) * Math.sqrt((r1 * r2) / (1.0 - Math.cos(dtheta)));
  const sqrtMu = Math.sqrt(mu);
  const target = sqrtMu * tof;

  const y = (z) =>
    r1 + r2 + A * (z * stumpffS(z) - 1.0) / Math.sqrt(stumpffC(z));

  // F(z) scaled by 1/target so tolerances are relative. -Infinity flags y<0.
  const F = (z) => {
    const yz = y(z);
    if (!(yz >= 0.0)) return -Infinity;
    const Cz = stumpffC(z), Sz = stumpffS(z);
    return (Math.pow(yz / Cz, 1.5) * Sz + A * Math.sqrt(yz) - target) / target;
  };

  const dFdz = (z) => {
    const yz = y(z);
    if (Math.abs(z) < 1e-6) {
      return ((Math.sqrt(2.0) / 40.0) * Math.pow(yz, 1.5) +
        (A / 8.0) * (Math.sqrt(yz) + A * Math.sqrt(1.0 / (2.0 * yz)))) / target;
    }
    const Cz = stumpffC(z), Sz = stumpffS(z);
    return (Math.pow(yz / Cz, 1.5) *
      ((1.0 / (2.0 * z)) * (Cz - 1.5 * Sz / Cz) + 0.75 * (Sz * Sz) / Cz) +
      (A / 8.0) * (3.0 * (Sz / Cz) * Math.sqrt(yz) + A * Math.sqrt(Cz / yz))) / target;
  };

  // ---- bracket [lo, hi] with F(lo) < 0 < F(hi) ----
  // Start at z = 0 (parabola). If the parabolic tof is too long, the root is
  // elliptic and lies in (0, 4pi^2), where t(z) -> infinity at the top end.
  // Otherwise it is hyperbolic: step down in z. For transfer angles > 180 deg
  // (A < 0) t(z) has a minimum at negative z and rises again below it (a
  // non-physical branch), so stop at that minimum: if F is still positive
  // there, the tof is shorter than any zero-rev long-way transfer allows.
  let lo, hi, Flo, Fhi;
  const F0 = F(0.0);
  if (F0 < 0.0) {
    // Walk the upper bound toward 4pi^2. Evaluating right at the limit is not
    // safe: C(z) cancels to 0 there and F becomes inf - inf = NaN for A < 0.
    lo = 0.0; Flo = F0;
    let gap = 0.5 * LAMBERT_Z_MAX;
    for (let k = 0; k < 15; k++) {
      hi = LAMBERT_Z_MAX - gap; Fhi = F(hi);
      if (Fhi > 0.0) break;
      if (Fhi < 0.0) { lo = hi; Flo = Fhi; }
      gap *= 0.1;
    }
  } else if (F0 === 0.0) {
    lo = hi = 0.0; Flo = Fhi = 0.0;
  } else {
    hi = 0.0; Fhi = F0;
    let step = 1.0;
    for (;;) {
      const cand = -step;
      if (cand < LAMBERT_Z_MIN) return null;
      const Fc = F(cand);
      if (Fc < 0.0) { lo = cand; Flo = Fc; break; }
      if (!(dFdz(cand) > 0.0)) {
        // Passed the minimum of t(z): locate it between cand and hi.
        let a = cand, b = hi;
        for (let k = 0; k < 100; k++) {
          const m = 0.5 * (a + b);
          if (dFdz(m) > 0.0) b = m; else a = m;
        }
        const Fm = F(b);
        if (!(Fm < 0.0)) return null;
        lo = b; Flo = Fm;
        break;
      }
      hi = cand; Fhi = Fc;
      step *= 2.0;
    }
  }
  if (!(Flo <= 0.0) || !(Fhi >= 0.0)) return null;

  // ---- safeguarded Newton (bisection fallback) ----
  let z = (Flo === -Infinity) ? 0.5 * (lo + hi) : (lo * Fhi - hi * Flo) / (Fhi - Flo);
  if (!(z > lo && z < hi)) z = 0.5 * (lo + hi);
  let converged = false;
  let iterations = 0;
  for (; iterations < 200; iterations++) {
    const Fz = F(z);
    if (Fz === 0.0 || Math.abs(Fz) < 1e-13) { converged = true; break; }
    if (Fz < 0.0) lo = z; else hi = z;
    if (hi - lo <= 1e-15 * Math.max(1.0, Math.abs(z))) { converged = true; break; }
    let zNew = NaN;
    if (Fz !== -Infinity) {
      const d = dFdz(z);
      if (d > 0.0 && Number.isFinite(d)) zNew = z - Fz / d;
    }
    if (!(zNew > lo && zNew < hi)) zNew = 0.5 * (lo + hi);   // bisect
    z = zNew;
  }
  if (!converged) return null;

  const yz = y(z);
  if (!(yz > 0.0)) return null;
  const f = 1.0 - yz / r1;               // Lagrange coefficients
  const g = A * Math.sqrt(yz / mu);
  const gdot = 1.0 - yz / r2;
  const v1 = scale(sub(r2Vec, scale(r1Vec, f)), 1.0 / g);
  const v2 = scale(sub(scale(r2Vec, gdot), r1Vec), 1.0 / g);
  if (!v1.every(Number.isFinite) || !v2.every(Number.isFinite)) return null;
  return { v1, v2, z, iterations };
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