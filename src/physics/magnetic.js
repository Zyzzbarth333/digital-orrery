// src/physics/magnetic.js
//
// The planets' internal magnetic fields, in each body's fixed frame
// (orientation.js's bodyAxesEqj: X to 0 deg longitude, Z to the IAU north
// pole), and field lines traced through them (docs/physics/magnetic-fields.md).
//
//   magneticModel(key, date) -> { key, name, source, a, field(x, y, z, out),
//                                 dipole: { m, centre, moment, tilt, lonEast }, rMax }
//   traceLine(model, start, surface, opts) -> { points, strength, closed }
//
// Positions are in units of the model's reference radius a (km), fields in
// nT. Gauss coefficients are Schmidt semi-normalised:
//
//   V(r, theta, phi) = a sum_n (a/r)^(n+1) sum_m (g_nm cos m phi + h_nm sin m phi) P_n^m(cos theta)
//   B = -grad V
//
// with P_n^m by the standard recursions (Langel 1987, as in the IGRF's own
// programs):
//
//   P_n^n = sqrt((2n - 1) / 2n) sin theta P_(n-1)^(n-1)          (n >= 2; P_1^1 = sin theta)
//   P_n^m = [(2n - 1) cos theta P_(n-1)^m - sqrt((n-1)^2 - m^2) P_(n-2)^m] / sqrt(n^2 - m^2)
//
// Models:
//   earth    IGRF-14 at the date (linear between the five-yearly epochs, the
//            2025-30 secular variation after 2025, held at 2030 after that);
//   jupiter  JRM33 to degree 13 plus the Connerney current sheet (con2020:
//            Connerney et al. 2020, with Edwards et al. 2001's analytic forms);
//   saturn   Cassini 11 to degree 11 (axisymmetric);
//   uranus   Ness et al. 1986's offset tilted dipole;
//   neptune  Ness et al. 1989's offset tilted dipole;
//   mercury  MESSENGER's offset dipole (Anderson et al. 2012);
//   ganymede Juno's and Galileo's dipole (Weber et al. 2022).

import { IGRF, JRM33, CASSINI11 } from './magnetic.data.js';

const DEG = Math.PI / 180;
export const MAGNETIC_BODIES = ['mercury', 'earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'ganymede'];

// Index of g_nm (h false) or h_nm (h true) in a flat coefficient array.
export const coeffIndex = (n, m, h = false) => n * n - 1 + (m === 0 ? 0 : 2 * m - 1 + (h ? 1 : 0));

// ---- spherical harmonics ----

// A field evaluator for coefficients to degree N, with its own work arrays.
export function harmonicField(coeffs, N) {
  const W = N + 1, size = W * W;
  const P = new Float64Array(size), dP = new Float64Array(size);
  const cm = new Float64Array(W), sm = new Float64Array(W);
  const k1 = new Float64Array(size), k2 = new Float64Array(size), kn = new Float64Array(W);
  const at = (n, m) => n * W + m;
  for (let n = 1; n <= N; n++) {
    kn[n] = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
    for (let m = 0; m < n; m++) {
      const d = Math.sqrt(n * n - m * m);
      k1[at(n, m)] = (2 * n - 1) / d;
      k2[at(n, m)] = n >= 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) / d : 0;
    }
  }
  return function field(x, y, z, out) {
    const rho2 = x * x + y * y, r = Math.sqrt(rho2 + z * z), rho = Math.sqrt(rho2);
    const ct = z / r, st = Math.max(rho / r, 1e-12);
    const cp = rho > 0 ? x / rho : 1, sp = rho > 0 ? y / rho : 0;
    cm[0] = 1; sm[0] = 0;
    for (let m = 1; m <= N; m++) { cm[m] = cm[m - 1] * cp - sm[m - 1] * sp; sm[m] = sm[m - 1] * cp + cm[m - 1] * sp; }
    P[0] = 1; dP[0] = 0;
    const ar = 1 / r;
    let Br = 0, Bt = 0, Bp = 0, arn = ar * ar;          // (a/r)^(n+2), from n = 0
    for (let n = 1; n <= N; n++) {
      arn *= ar;
      const pnn = at(n - 1, n - 1), inn = at(n, n);
      P[inn] = kn[n] * st * P[pnn];
      dP[inn] = kn[n] * (st * dP[pnn] + ct * P[pnn]);
      for (let m = 0; m < n; m++) {
        const i = at(n, m), i1 = at(n - 1, m), two = n - 2 >= m;
        P[i] = k1[i] * ct * P[i1] - (two ? k2[i] * P[at(n - 2, m)] : 0);
        dP[i] = k1[i] * (ct * dP[i1] - st * P[i1]) - (two ? k2[i] * dP[at(n - 2, m)] : 0);
      }
      let sr = 0, stt = 0, spp = 0;
      for (let m = 0; m <= n; m++) {
        const g = coeffs[coeffIndex(n, m)], h = m ? coeffs[coeffIndex(n, m, true)] : 0;
        const gc = g * cm[m] + h * sm[m], i = at(n, m);
        sr += gc * P[i];
        stt += gc * dP[i];
        if (m) spp += m * (g * sm[m] - h * cm[m]) * P[i];
      }
      Br += (n + 1) * arn * sr;
      Bt -= arn * stt;
      Bp += (arn * spp) / st;
    }
    out[0] = Br * st * cp + Bt * ct * cp - Bp * sp;
    out[1] = Br * st * sp + Bt * ct * sp + Bp * cp;
    out[2] = Br * ct - Bt * st;
    return out;
  };
}

// The dipole of a set of coefficients: its moment (g11, h11, g10) in nT a^3,
// and the centre that best fits the quadrupole (the eccentric dipole,
// Fraser-Smith 1987), in units of a.
export function eccentricDipole(c) {
  const [g10, g11, h11, g20, g21, h21, g22, h22] = c;
  const s3 = Math.sqrt(3), B02 = g10 * g10 + g11 * g11 + h11 * h11;
  const L0 = 2 * g10 * g20 + s3 * (g11 * g21 + h11 * h21);
  const L1 = -g11 * g20 + s3 * (g10 * g21 + g11 * g22 + h11 * h22);
  const L2 = -h11 * g20 + s3 * (g10 * h21 - h11 * g22 + g11 * h22);
  const E = (L0 * g10 + L1 * g11 + L2 * h11) / (4 * B02);
  return { m: [g11, h11, g10], centre: [(L1 - g11 * E) / (3 * B02), (L2 - h11 * E) / (3 * B02), (L0 - g10 * E) / (3 * B02)] };
}

// A dipole of moment m (nT a^3) at a centre (units of a): B = (3 (m.r) r - m r^2) / r^5.
export function offsetDipole(m, centre) {
  return function field(x, y, z, out) {
    const dx = x - centre[0], dy = y - centre[1], dz = z - centre[2];
    const r2 = dx * dx + dy * dy + dz * dz, r5 = r2 * r2 * Math.sqrt(r2);
    const md = 3 * (m[0] * dx + m[1] * dy + m[2] * dz);
    out[0] = (md * dx - m[0] * r2) / r5;
    out[1] = (md * dy - m[1] * r2) / r5;
    out[2] = (md * dz - m[2] * r2) / r5;
    return out;
  };
}

// ---- Earth: IGRF-14 at a date ----

export function decimalYear(date) {
  const y = date.getUTCFullYear(), t0 = Date.UTC(y, 0, 1), t1 = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - t0) / (t1 - t0);
}

export function igrfCoeffs(year) {
  const ep = IGRF.epochs, last = ep.length - 1;
  if (year >= ep[last]) {
    const dt = Math.min(year, ep[last] + 5) - ep[last];
    return IGRF.coeffs[last].map((g, i) => g + IGRF.sv[i] * dt);
  }
  const t = Math.max(year, ep[0]);
  const i = Math.min(Math.floor((t - ep[0]) / 5), last - 1), f = (t - ep[i]) / 5;
  return IGRF.coeffs[i].map((g, k) => g + f * (IGRF.coeffs[i + 1][k] - g));
}

// ---- Jupiter: the con2020 current sheet ----
//
// An annular disc of azimuthal current about the magnetic equator, from r0
// to r1 R_J and +-D thick, of strength mu0 I0 / 2, its normal tilted xt
// toward System III east longitude xp, with a radial current I_rho
// (Connerney et al. 2020: 139.6 nT, 7.8 and 51.4 R_J, 3.6 R_J, 9.3 deg
// toward 155.8 deg, 16.7 MA). The disc's field is a semi-infinite sheet from
// r0 less one from r1, each by Edwards et al. 2001's analytic forms (their
// 9a-b for rho < a, 13a-b beyond, blended by tanh over 1 R_J).

export const CON2020 = { mui2: 139.6, r0: 7.8, r1: 51.4, d: 3.6, xt: 9.3, xp: 155.8, irho: 16.7, dRho: 1 };

export function sheetEdwards(rho, z, D, a, mui2, dRho, out) {
  const zmd = z - D, zpd = z + D, a2 = a * a;
  // Small rho (9a, 9b).
  let f1 = Math.sqrt(zmd * zmd + a2), f2 = Math.sqrt(zpd * zpd + a2);
  const h = rho / 2, h2 = h * h, h3 = (h2 * h) / 2;
  const BrS = mui2 * (h * (1 / f1 - 1 / f2) + h3 * ((a2 - 2 * zmd * zmd) / f1 ** 5 - (a2 - 2 * zpd * zpd) / f2 ** 5));
  const BzS = mui2 * (Math.log((zpd + f2) / (zmd + f1)) + h2 * (zpd / f2 ** 3 - zmd / f1 ** 3));
  // Large rho (13a, 13b).
  const rho2 = rho * rho;
  f1 = Math.sqrt(zmd * zmd + rho2); f2 = Math.sqrt(zpd * zpd + rho2);
  const zc = Math.max(-D, Math.min(D, z));
  const BrL = mui2 * ((f1 - f2) / rho + ((rho * a2) / 4) * (1 / f2 ** 3 - 1 / f1 ** 3) + (2 / rho) * zc);
  const lg = zmd + f1 === 0 ? 0 : Math.log((zpd + f2) / (zmd + f1));
  const BzL = mui2 * (lg + (a2 / 4) * (zpd / f2 ** 3 - zmd / f1 ** 3));
  const w = Math.tanh((rho - a) / dRho);
  out[0] = (BrS * (1 - w)) / 2 + (BrL * (1 + w)) / 2;
  out[1] = (BzS * (1 - w)) / 2 + (BzL * (1 + w)) / 2;
  return out;
}

export function con2020Field(p = CON2020) {
  const sh = (p.xp - 180) * DEG, cxp = Math.cos(sh), sxp = Math.sin(sh);
  const cxt = Math.cos(p.xt * DEG), sxt = Math.sin(p.xt * DEG);
  const inner = [0, 0], outer = [0, 0];
  return function field(x0, y0, z0, out) {
    // System III to the sheet's frame: about Z by xp - 180, then about Y by xt.
    const x = x0 * cxp + y0 * sxp, y1 = y0 * cxp - x0 * sxp;
    const x1 = x * cxt + z0 * sxt, z1 = z0 * cxt - x * sxt;
    const rho = Math.hypot(x1, y1);
    if (rho < 1e-9) { out[0] = out[1] = out[2] = 0; return out; }
    sheetEdwards(rho, z1, p.d, p.r0, p.mui2, p.dRho, inner);
    sheetEdwards(rho, z1, p.d, p.r1, p.mui2, p.dRho, outer);
    const Brho = inner[0] - outer[0], Bz = inner[1] - outer[1];
    // The radial current's azimuthal field, 2.7975 I_rho / rho nT (I in MA,
    // rho in R_J), reversing across the sheet and linear inside it.
    let Bphi = (2.7975 * p.irho) / rho;
    if (Math.abs(z1) < p.d) Bphi *= Math.abs(z1) / p.d;
    if (z1 > 0) Bphi = -Bphi;
    const c = x1 / rho, s = y1 / rho;
    const Bx1 = Brho * c - Bphi * s, By1 = Brho * s + Bphi * c;
    const Bx = Bx1 * cxt - Bz * sxt, Bz0 = Bx1 * sxt + Bz * cxt;
    out[0] = Bx * cxp - By1 * sxp;
    out[1] = By1 * cxp + Bx * sxp;
    out[2] = Bz0;
    return out;
  };
}

// ---- Uranus and Neptune: Voyager 2's offset tilted dipoles ----
//
// As tabled by Garrett et al. (JPL Publications 15-7, Table 2, and 17-2,
// Table 1) from Ness et al. 1986 and 1989, as Cartesian components in the
// Voyager planetocentric frames (gauss R^3 and R):
//   Uranus   M (0.133, -0.148, 0.115), 0.230 G R_U^3, 60 deg from the pole
//            toward 48 deg W; centre (-0.020, 0.020, -0.310) R_U.
//   Neptune  M (0.0177, -0.0953, 0.0910), 0.133 G R_N^3, 46.8 deg from the
//            pole toward 79.5 deg W; centre (0.17, 0.46, -0.24) R_N.
// Voyager's Uranus frame has Z along the spin's angular momentum, the pole
// that faced the Sun in 1986; the IAU's north is the other one
// (orientation.js), so it is turned 180 deg about X into the IAU frame:
// (x, y, z) -> (x, -y, -z).
const G = 1e5;     // nT per gauss
const URANUS_V = { m: [0.133, -0.148, 0.115], c: [-0.020, 0.020, -0.310] };
const NEPTUNE_V = { m: [0.0177, -0.0953, 0.0910], c: [0.17, 0.46, -0.24] };
export const OTD = {
  uranus: { a: 25559, m: [URANUS_V.m[0] * G, -URANUS_V.m[1] * G, -URANUS_V.m[2] * G], centre: [URANUS_V.c[0], -URANUS_V.c[1], -URANUS_V.c[2]] },
  neptune: { a: 24765, m: NEPTUNE_V.m.map((v) => v * G), centre: NEPTUNE_V.c },
  // Mercury: MESSENGER's axial dipole of 190 nT R_M^3, its moment southward,
  // offset 479 km north (Anderson et al. 2012), R_M 2,440 km.
  mercury: { a: 2440, m: [0, 0, -190], centre: [0, 0, 479 / 2440] },
};

// ---- Ganymede ----
//
// The only moon with a dynamo of its own. Weber et al. 2022 fitted Juno's
// 2021 flyby with Galileo's six: g10 -716.4, g11 56.0, h11 27.0 nT at
// R_G = 2,634.1 km, in Ganymede's body-fixed frame (as libinternalfield
// transcribes them). Kivelson et al. 2002's Galileo-only fit is the check.
export const GANYMEDE = { a: 2634.1, n: 1, coeffs: [-716.4, 56.0, 27.0] };
export const GANYMEDE_KIVELSON2002 = [-711.0, 46.8, 22.3];

// ---- the models ----

export function dipoleAngles(m) {
  const M = Math.hypot(m[0], m[1], m[2]);
  // The tilt of the dipole axis from the spin axis (0-90 deg), and the east
  // longitude of the end the moment points to.
  return { moment: M, tilt: Math.acos(Math.abs(m[2]) / M) / DEG, lonEast: ((Math.atan2(m[1], m[0]) / DEG) + 360) % 360 };
}

const cache = new Map();
export function magneticModel(key, date = new Date()) {
  if (key === 'earth') {
    const year = Math.floor(decimalYear(date) * 4) / 4;          // the quarter-year
    const k = `earth ${year}`;
    if (!cache.has(k)) {
      const c = igrfCoeffs(year), ed = eccentricDipole(c);
      cache.set(k, { key, name: 'IGRF-14', source: `IGRF-14 (IAGA), ${year.toFixed(2)}`, a: IGRF.a, n: IGRF.n, coeffs: c,
        field: harmonicField(c, IGRF.n), dipole: { ...ed, ...dipoleAngles(ed.m) }, rMax: 12 });
    }
    return cache.get(k);
  }
  if (cache.has(key)) return cache.get(key);
  let model;
  if (key === 'jupiter') {
    const internal = harmonicField(JRM33.coeffs, JRM33.n), sheet = con2020Field(), t = [0, 0, 0];
    const ed = eccentricDipole(JRM33.coeffs);
    model = { key, name: 'JRM33 + con2020', source: 'JRM33 to degree 13 (Connerney et al. 2022) and the con2020 current sheet (Connerney et al. 2020)',
      a: JRM33.a, n: JRM33.n, coeffs: JRM33.coeffs,
      field(x, y, z, out) { internal(x, y, z, out); sheet(x, y, z, t); out[0] += t[0]; out[1] += t[1]; out[2] += t[2]; return out; },
      internal, dipole: { ...ed, ...dipoleAngles(ed.m) }, rMax: 40 };
  } else if (key === 'saturn') {
    const ed = eccentricDipole(CASSINI11.coeffs);
    model = { key, name: 'Cassini 11', source: 'Cassini 11 to degree 11 (Dougherty et al. 2018; Cao et al. 2020)', a: CASSINI11.a, n: CASSINI11.n,
      coeffs: CASSINI11.coeffs, field: harmonicField(CASSINI11.coeffs, CASSINI11.n), dipole: { ...ed, ...dipoleAngles(ed.m) }, rMax: 20 };
  } else if (key === 'uranus' || key === 'neptune') {
    const o = OTD[key];
    model = { key, name: 'Voyager OTD', source: `Voyager 2's offset tilted dipole (Ness et al. ${key === 'uranus' ? 1986 : 1989})`, a: o.a,
      field: offsetDipole(o.m, o.centre), dipole: { m: o.m, centre: o.centre, ...dipoleAngles(o.m) }, rMax: 16 };
  } else if (key === 'ganymede') {
    const ed = eccentricDipole([...GANYMEDE.coeffs, 0, 0, 0, 0, 0]);
    model = { key, name: 'Juno and Galileo dipole', source: "Ganymede's dipole from Juno's and Galileo's flybys (Weber et al. 2022)", a: GANYMEDE.a, n: 1,
      coeffs: GANYMEDE.coeffs, field: harmonicField(GANYMEDE.coeffs, 1), dipole: { ...ed, ...dipoleAngles(ed.m) }, rMax: 6 };
  } else if (key === 'mercury') {
    const o = OTD.mercury;
    model = { key, name: 'MESSENGER offset dipole', source: "MESSENGER's offset dipole (Anderson et al. 2012)", a: o.a,
      field: offsetDipole(o.m, o.centre), dipole: { m: o.m, centre: o.centre, ...dipoleAngles(o.m) }, rMax: 6 };
  } else return null;
  cache.set(key, model);
  return model;
}

// ---- field lines ----
//
// RK4 along the unit field direction, dx/ds = +-B / |B|, with a step of 3%
// of the distance from the centre (0.002 to 0.5 a), stopping at the surface
// (an ellipsoid of equatorial radius eq and polar radius pol, units of a),
// beyond rMax, or after maxSteps.

const inside = (p, eq, pol) => (p[0] * p[0] + p[1] * p[1]) / (eq * eq) + (p[2] * p[2]) / (pol * pol) < 1;

function traceHalf(model, start, sign, surface, rMax, maxSteps) {
  const pts = [], str = [];
  const b = [0, 0, 0], p = start.slice(), k = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], q = [0, 0, 0], next = [0, 0, 0];
  const dir = (x, out) => {
    model.field(x[0], x[1], x[2], b);
    const n = Math.hypot(b[0], b[1], b[2]) || 1;
    out[0] = (sign * b[0]) / n; out[1] = (sign * b[1]) / n; out[2] = (sign * b[2]) / n;
    return n;
  };
  let end = 'steps';
  for (let s = 0; s < maxSteps; s++) {
    const r = Math.hypot(p[0], p[1], p[2]), h = Math.min(0.5, Math.max(0.002, 0.03 * r));
    pts.push(p[0], p[1], p[2]); str.push(dir(p, k[0]));
    for (let j = 0; j < 3; j++) q[j] = p[j] + 0.5 * h * k[0][j];
    dir(q, k[1]);
    for (let j = 0; j < 3; j++) q[j] = p[j] + 0.5 * h * k[1][j];
    dir(q, k[2]);
    for (let j = 0; j < 3; j++) q[j] = p[j] + h * k[2][j];
    dir(q, k[3]);
    for (let j = 0; j < 3; j++) next[j] = p[j] + (h / 6) * (k[0][j] + 2 * k[1][j] + 2 * k[2][j] + k[3][j]);
    if (inside(next, surface.eq, surface.pol)) {
      // Bisect to the surface.
      let lo = 0, hi = 1;
      for (let it = 0; it < 24; it++) {
        const mid = (lo + hi) / 2;
        for (let j = 0; j < 3; j++) q[j] = p[j] + mid * (next[j] - p[j]);
        if (inside(q, surface.eq, surface.pol)) hi = mid; else lo = mid;
      }
      for (let j = 0; j < 3; j++) q[j] = p[j] + hi * (next[j] - p[j]);
      pts.push(q[0], q[1], q[2]); str.push(dir(q, k[0]));
      end = 'surface';
      break;
    }
    p[0] = next[0]; p[1] = next[1]; p[2] = next[2];
    if (Math.hypot(p[0], p[1], p[2]) > rMax) { pts.push(p[0], p[1], p[2]); str.push(dir(p, k[0])); end = 'out'; break; }
  }
  return { pts, str, end };
}

// The whole line through a point: back along -B, then forward along +B.
export function traceLine(model, start, surface = { eq: 1, pol: 1 }, { rMax = model.rMax, maxSteps = 3000 } = {}) {
  const back = traceHalf(model, start, -1, surface, rMax, maxSteps);
  const fwd = traceHalf(model, start, 1, surface, rMax, maxSteps);
  const n = back.str.length, len = n - 1 + fwd.str.length;
  const points = new Float64Array(3 * len), strength = new Float64Array(len);
  for (let i = n - 1, j = 0; i >= 1; i--, j++) {
    points[3 * j] = back.pts[3 * i]; points[3 * j + 1] = back.pts[3 * i + 1]; points[3 * j + 2] = back.pts[3 * i + 2];
    strength[j] = back.str[i];
  }
  points.set(fwd.pts, 3 * (n - 1)); strength.set(fwd.str, n - 1);
  return { points, strength, ends: [back.end, fwd.end], closed: back.end === 'surface' && fwd.end === 'surface' };
}

// Where the field line through a point meets the surface, following B in
// the given sense (+1 along B, -1 against it): a footprint, or null.
export function footprint(model, start, sign, surface = { eq: 1, pol: 1 }, opts = {}) {
  const h = traceHalf(model, start, sign, surface, opts.rMax ?? model.rMax, opts.maxSteps ?? 4000);
  return h.end === 'surface' ? h.pts.slice(-3) : null;
}

// The dipole frame: u along the moment, e1 and e2 across it.
export function dipoleFrame(model) {
  const { m } = model.dipole;
  const M = Math.hypot(m[0], m[1], m[2]), u = [m[0] / M, m[1] / M, m[2] / M];
  const ref = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = norm(cross(ref, u));
  return { u, e1, e2: cross(u, e1) };
}

// Seed points for drawing: on the surface, along rays from the dipole's
// centre at the given magnetic latitudes (deg; positive toward the end the
// moment points to, where field lines leave) and nLon magnetic longitudes,
// alternate rows staggered by half a step.
export function seedPoints(model, surface, lats, nLon) {
  const { centre } = model.dipole, { u, e1, e2 } = dipoleFrame(model);
  const seeds = [];
  lats.forEach((lat, row) => {
    for (let j = 0; j < nLon; j++) {
      const ph = (2 * Math.PI * (j + (row % 2) * 0.5)) / nLon, cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG);
      const d = [0, 1, 2].map((i) => cl * (Math.cos(ph) * e1[i] + Math.sin(ph) * e2[i]) + sl * u[i]);
      seeds.push({ lat, lon: ph / DEG, p: rayToSurface(centre, d, surface) });
    }
  });
  return seeds;
}

export function rayToSurface(c, d, { eq, pol }) {
  // c + t d on the ellipsoid: the positive root of a quadratic in t.
  const A = (d[0] * d[0] + d[1] * d[1]) / (eq * eq) + (d[2] * d[2]) / (pol * pol);
  const B = 2 * ((c[0] * d[0] + c[1] * d[1]) / (eq * eq) + (c[2] * d[2]) / (pol * pol));
  const C = (c[0] * c[0] + c[1] * c[1]) / (eq * eq) + (c[2] * c[2]) / (pol * pol) - 1;
  const t = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
  return [c[0] + t * d[0], c[1] + t * d[1], c[2] + t * d[2]];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n]; };

// ---- Earth: geodetic coordinates, and north-east-down components ----
//
// For the check against NOAA's Geomag program: a point given as WGS 84
// geodetic latitude, longitude (deg) and height (km), or as geocentric
// latitude and radius (km), and the field there as X north, Y east, Z down
// (nT). For a geodetic point the geocentric spherical components are turned
// by the difference of the two latitudes, as the IGRF's own programs do.
export function northEastDown(field, a, latDeg, lonDeg, h, { geocentric = false } = {}) {
  const A = 6378.137, F = 1 / 298.257223563, B = A * (1 - F);
  const lat = latDeg * DEG, lon = lonDeg * DEG, s = Math.sin(lat), c = Math.cos(lat);
  let rho, z;
  if (geocentric) { rho = h * c; z = h * s; } else {
    const N = (A * A) / Math.sqrt(A * A * c * c + B * B * s * s);
    rho = (N + h) * c; z = ((N * B * B) / (A * A) + h) * s;
  }
  const b = field((rho * Math.cos(lon)) / a, (rho * Math.sin(lon)) / a, z / a, [0, 0, 0]);
  const r = Math.hypot(rho, z), ct = z / r, st = rho / r, cp = Math.cos(lon), sp = Math.sin(lon);
  const Br = b[0] * st * cp + b[1] * st * sp + b[2] * ct;
  const Bt = b[0] * ct * cp + b[1] * ct * sp - b[2] * st;
  const Bp = -b[0] * sp + b[1] * cp;
  const psi = geocentric ? 0 : lat - Math.atan2(z, rho);      // geodetic less geocentric latitude
  const X = -Bt * Math.cos(psi) - Br * Math.sin(psi), Z = Bt * Math.sin(psi) - Br * Math.cos(psi), Y = Bp;
  const H = Math.hypot(X, Y);
  return { X, Y, Z, H, F: Math.hypot(H, Z), D: Math.atan2(Y, X) / DEG, I: Math.atan2(Z, H) / DEG };
}

export const igrfGeodetic = (latDeg, lonDeg, hKm, year) => northEastDown(harmonicField(igrfCoeffs(year), IGRF.n), IGRF.a, latDeg, lonDeg, hKm);
