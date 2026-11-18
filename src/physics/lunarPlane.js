// src/physics/lunarPlane.js
//
// The plane of a low circular orbit about the Moon over a long stay
// (docs/physics/journey.md#the-plane-at-the-moon): the orbit's normal
// averaged over each turn, as the Moon's whole field and the Earth's and
// the Sun's tides turn it. Pure ES module: km, s; vectors in J2000
// equatorial (EQJ).
//
//   moonPlaneTrack({ n0, a, fromMs, toMs, degree })
//       the orbit's unit normal from fromMs (n0) to toMs, as a function of
//       the time (ms) in between; degree 2 is the quick one (the field's
//       quadrupole and the tides, a 3 x 3 tensor a step)
//   moonPlaneRate(n, a, scene, { degree })
//       dn/dt (rad/s) in a scene (moonScene: the Moon's axes, the Earth
//       and the Sun at a time)
//   moonEccentricityTrack({ track, a, toMs })
//       the mean eccentricity vector over a plane track, and when the
//       orbit falls (below)
//
// About a planet, J2 alone turns a low orbit's plane (parkingPlane.js). At
// the Moon it does not: the Moon's J2 is a tenth of the Earth's, its C22 is
// a tenth of its J2 and turns with the Moon once a month, its field is
// lumpy, and the Earth's tide is a few per cent of J2's pull at 100 km.
// So the orbit is averaged over a turn instead, with the whole field.
//
// For a circular orbit of radius a and unit normal n, the force function U
// (F = grad U) averaged over a turn is a function of n alone, W(n), and
// the torque on the orbit turns its angular momentum sqrt(mu a) n:
//   dn/dt = (1 / (w a^2)) n x grad_n W,             w = sqrt(mu / a^3)
// (Tremaine, Touma and Namouni 2009, eq. (19), at e = 0: there for J2 and
// a tide, here for any field). For a potential quadratic in position,
// U = (1/2) x.T x, it is dn/dt = -(1 / (2 w)) n x (T n). Three parts:
//
// - The field's degree 2 (J2, C21, S21, C22, S22): such a quadratic, T
//   from the unnormalised coefficients in the Moon's principal axes,
//   (mu R^2 / a^5) [[6 C22, 6 S22, 3 C21], [6 S22, -6 C22, 3 S21],
//   [3 C21, 3 S21, 3 C20]], turned into EQJ. J2 alone gives the node's
//   regression, Curtis eq. (4.52).
// - The tides of the Earth and the Sun, mu_3 at d from the Moon: the
//   quadrupole T = (mu_3 / d^3) (3 d^ d^ - I).
// - The field's higher degrees. The mean of a spherical harmonic Y_nm over
//   a great circle is P_n(0) Y_nm at the circle's pole (the addition
//   theorem, Jackson Sec. 3.6), so
//     W(n) = (mu / a) sum_n P_n(0) (R/a)^n sum_m (C_nm cos m lam + S_nm sin m lam) P_nm(sin phi)
//   at the normal's latitude phi and longitude lam in the Moon's frame:
//   the field itself, its odd degrees gone (P_n(0) = 0) and each even one
//   weighed by P_n(0) (R/a)^n. Its gradient over the sphere is that
//   field's acceleration (geopotential.js) at radius R along n, times
//   R^2 / a, the radial part dropping out of the cross product. Degree 4
//   to 30 here (its degree 2 is the tensor's).
//
// The Moon's frame is the kernel's (environment.js): GRAIL GL0660B in its
// principal axes, PA_TO_ME from the mean-Earth axes of orientation.js.
// What it leaves out: the eccentricity the odd degrees raise (to a few
// hundredths at 100 km over a month; moonEccentricityTrack below flies it,
// for whether the orbit falls), what that couples into the plane, and the
// field's terms in the turn's own period, which come and go.

import { GRAIL, PA_TO_ME } from './grail.js';
import { geopotential, normFactor } from './geopotential.js';
import { bodyAxesEqj } from './orientation.js';
import { helioStateEqj } from './ephemeris.js';
import { bodyConstants, MU_SUN } from './bodies.js';

export const GRAIL_FIELD = GRAIL;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const k = 1 / norm(a); return [a[0] * k, a[1] * k, a[2] * k]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// P_n(0): 0 for odd n, (-1)^(n/2) (n-1)!! / n!! for even n.
function legendreAtZero(n) {
  if (n % 2) return 0;
  let p = 1;
  for (let k = 2; k <= n; k += 2) p *= -(k - 1) / k;
  return p;
}

// The field's orbit-averaged part for a circular orbit of radius a, from
// degree `from` to `degree`: the even degrees weighed by P_n(0) (R/a)^n,
// without the point mass. GRAIL's kept by (a, from, degree): the planner
// asks again as it edits.
const fields = new Map();
export function averagedField(a, degree, F = GRAIL, from = 2) {
  const key = `${a.toFixed(3)}:${from}:${degree}`;
  let f = F === GRAIL ? fields.get(key) : null;
  if (f) return f;
  const C = [], S = [];
  for (let n = 0; n <= degree; n++) {
    const k = legendreAtZero(n) * (F.radius / a) ** n;
    C.push(F.C[n].slice(0, n + 1).map((c) => (n >= from ? c * k : 0)));
    S.push(F.S[n].slice(0, n + 1).map((s) => (n >= from ? s * k : 0)));
  }
  f = geopotential({ mu: F.gm, radius: F.radius, n: degree, C, S, central: false });
  if (F !== GRAIL) return f;
  if (fields.size > 16) fields.clear();
  fields.set(key, f);
  return f;
}

// The field's degree 2 as the tensor of U = (1/2) x.T x on a circle of
// radius a, times a^5 / (mu R^2): in the principal axes, unnormalised.
function degree2(F) {
  const c = (m) => F.C[2][m] * normFactor(2, m), s = (m) => F.S[2][m] * normFactor(2, m);
  return [[6 * c(2), 6 * s(2), 3 * c(1)], [6 * s(2), -6 * c(2), 3 * s(1)], [3 * c(1), 3 * s(1), 3 * c(0)]];
}
const Q_GRAIL = degree2(GRAIL);

// A scene at ms: the Moon's principal axes (rows, in EQJ), the Earth and
// the Sun from it (EQJ, km), and the quadrupoles in EQJ: the field's
// degree 2 (times a^5, so qf / a^5 is its tensor) and the two tides. Kept
// by the time: the tracks of one stay share their start, and so their grid.
const scenes = new Map();
export function moonScene(ms) {
  let sc = scenes.get(ms);
  if (sc) return sc;
  const A = bodyAxesEqj('moon', new Date(ms));
  const M = [0, 1, 2].map((i) => [0, 1, 2].map((j) => PA_TO_ME[0][i] * A[0][j] + PA_TO_ME[1][i] * A[1][j] + PA_TO_ME[2][i] * A[2][j]));
  const m = helioStateEqj('moon', new Date(ms)).r, e = helioStateEqj('earth', new Date(ms)).r;
  sc = makeScene(M, [e[0] - m[0], e[1] - m[1], e[2] - m[2]], [-m[0], -m[1], -m[2]]);
  if (scenes.size > 8000) scenes.clear();
  scenes.set(ms, sc);
  return sc;
}

// A scene from the Moon's axes M (rows, EQJ), the Earth and the Sun from
// it (EQJ, km), and its field F (GRAIL, or another with gm, radius, C, S).
export function makeScene(M, earth, sun, F = GRAIL) {
  // M^T Q M, times mu R^2: the field's quadrupole in EQJ.
  const Q = F === GRAIL ? Q_GRAIL : degree2(F), k = F.gm * F.radius ** 2, qf = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let x = 0;
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) x += M[p][i] * Q[p][q] * M[q][j];
    qf.push(k * x);
  }
  const qt = new Array(9).fill(0);
  for (const [d, mu3] of [[earth, bodyConstants('earth').mu], [sun, MU_SUN]]) {
    const dn = norm(d), u = [d[0] / dn, d[1] / dn, d[2] / dn], f = mu3 / dn ** 3;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) qt[3 * i + j] += f * (3 * u[i] * u[j] - (i === j ? 1 : 0));
  }
  return { M, earth, sun, qf, qt };
}

// dn/dt (rad/s) for the circular orbit of radius a with unit normal n
// (EQJ), in the scene sc (moonScene). degree 2: the quadrupoles alone;
// beyond, the field's degrees 4 to `degree` too (high: averagedField from
// degree 3, or another field's).
export function moonPlaneRate(n, a, sc, { degree = 30, high = degree > 2 ? averagedField(a, degree, GRAIL, 3) : null } = {}) {
  const mu = GRAIL.gm, R = GRAIL.radius, w = Math.sqrt(mu / a ** 3), qf = sc.qf, qt = sc.qt, a5 = a ** 5;
  // The quadrupoles: -(1 / (2 w)) n x (T n).
  const Tn = [0, 1, 2].map((i) => (qf[3 * i] / a5 + qt[3 * i]) * n[0] + (qf[3 * i + 1] / a5 + qt[3 * i + 1]) * n[1] + (qf[3 * i + 2] / a5 + qt[3 * i + 2]) * n[2]);
  const out = cross(n, Tn).map((x) => -x / (2 * w));
  if (!high) return out;
  // The higher degrees: their averaged gradient at the normal, in the
  // Moon's axes.
  const M = sc.M, np = [dot(M[0], n), dot(M[1], n), dot(M[2], n)], g = high.accel([R * np[0], R * np[1], R * np[2]]);
  const gq = [M[0][0] * g[0] + M[1][0] * g[1] + M[2][0] * g[2], M[0][1] * g[0] + M[1][1] * g[1] + M[2][1] * g[2], M[0][2] * g[0] + M[1][2] * g[1] + M[2][2] * g[2]];
  const c = cross(n, gq), k = (R * R) / (w * a ** 3);
  return [out[0] + k * c[0], out[1] + k * c[1], out[2] + k * c[2]];
}

// The orbit's unit normal from fromMs (n0, EQJ) to toMs: RK4 on the
// averaged rate in steps of stepH hours from fromMs, the last past toMs,
// the scenes at the half steps. The fastest of it, the Earth's tide and
// C22 as the Moon turns, has a period of half a month: 12-hour steps give
// the 3-hour steps' normal to 0.001 degrees over 90 days. Returns at(ms),
// the normal at ms (linear between the steps, made unit), with at.normals
// (the steps'), at.dt (ms) and at.toMs.
export function moonPlaneTrack({ n0, a, fromMs, toMs, degree = 30, stepH = 12 }) {
  const high = degree > 2 ? averagedField(a, degree, GRAIL, 3) : null, dt = stepH * 3600e3, steps = Math.max(1, Math.ceil((toMs - fromMs) / dt));
  const f = (n, k) => moonPlaneRate(n, a, moonScene(fromMs + (k * dt) / 2), { degree, high });
  const track = [unit(n0)], s = dt / 1000;
  let n = track[0];
  for (let i = 0; i < steps; i++) {
    const k1 = f(n, 2 * i), k2 = f(n.map((x, j) => x + 0.5 * s * k1[j]), 2 * i + 1);
    const k3 = f(n.map((x, j) => x + 0.5 * s * k2[j]), 2 * i + 1), k4 = f(n.map((x, j) => x + s * k3[j]), 2 * i + 2);
    n = unit(n.map((x, j) => x + (s / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])));
    track.push(n);
  }
  const at = (ms) => {
    const q = Math.max(0, Math.min(steps, (ms - fromMs) / dt)), i = Math.min(steps - 1, Math.floor(q)), u = q - i;
    const p = track[i], r = track[i + 1];
    return unit([p[0] + u * (r[0] - p[0]), p[1] + u * (r[1] - p[1]), p[2] + u * (r[2] - p[2])]);
  };
  at.normals = track; at.dt = dt; at.fromMs = fromMs; at.toMs = fromMs + steps * dt;
  return at;
}

// ---------------- the eccentricity the field raises ----------------
//
//   moonEccentricityTrack({ track, a, e0, degree })
//       the mean eccentricity vector over a plane track, from e0 (circular
//       by default), as a function of the time; at.fall the first time its
//       mean periapsis reaches the ground
//   moonEccentricityRate(e, n, a, sc, { field })
//       de/dt (1/s) in a scene
//
// The circular orbit's eccentricity vector e (Laplace-Runge-Lenz over mu),
// orbit-averaged, to first order in e (Tremaine, Touma and Namouni 2009,
// eq. (16), Milankovitch's; there with the potential energy, here with W
// = -it, the force function averaged over a turn, and j = sqrt(1 - e^2) n):
//   de/dt = (1 / sqrt(mu a)) (j x grad_e W + e x grad_j W)
// Three parts:
//
// - The forcing, from e = 0: grad_e W there. For an orbit of small e the
//   position is a ((cos E - e) p + sin E q) and dM = (1 - e cos E) dE, so
//     grad_e W = -(1/2 pi) int (a grad U + U r^) dE      (in the plane)
//   round the circle. For the degree-n part U_n = (mu/a)(R/a)^n Y_n of the
//   field, the radial and the along-track parts sum, by parts, to
//   (n - 1)/(2 pi) int U_n r^ dE, and the first Fourier harmonic of a
//   degree-n harmonic round a great circle is P_n'(0) / P_n'(1) times its
//   gradient over the sphere at the circle's pole (the addition theorem
//   again, Jackson Sec. 3.6, now for order 1 about the pole; P_n'(1) =
//   n (n + 1) / 2). So
//     grad_e W = sum_n (n - 1) P_n'(0) / (n (n + 1)) grad_S U_n (n)
//   the gradient over the sphere, at the orbit's normal, of the field with
//   its even degrees gone (P_n'(0) = 0) and each odd one weighed so:
//   geopotential.js's acceleration at radius R along n, times R^2 / a.
//   J3's part is the frozen-orbit theory's; near the equator the
//   tesserals rule.
// - J2 turns e about the normal at w (3/4) J2 (R/a)^2 (3 cos^2 i - 1): the
//   argument of periapsis' rate (Curtis eq. (4.53)) and the node's part
//   about the normal, cos i times eq. (4.52) (Curtis).
// - The Earth's and the Sun's tides, the quadrupole T of moonScene:
//   averaged over a turn W = (a^2 / 2) ((5/2) e.T e - (1/2) j.T j), so
//     de/dt = (a^2 / (2 sqrt(mu a))) (5 n x T e - e x T n)
//   (from the same paper's averages, eqs. (7) and (9); its eq. (19)).
// The vector is kept in the plane the plane track flies. Left out: the rest
// of the field's degree 2 and its higher even degrees, which turn e a
// little faster or slower, and the terms of second order in e, which grow
// as the orbit comes down (its periapsis passes over the lumps at a third
// lower height when e is a twentieth). Against the kernel (full model,
// GRAIL to degree 50), 100 km up the model's e is within 0.002 of the
// flown one's mean to the day it falls.

// P_n'(0): 0 for even n, (-1)^((n-1)/2) n!! / (n-1)!! for odd n.
function legendreSlopeAtZero(n) {
  if (n % 2 === 0) return 0;
  let p = 1;
  for (let k = 3; k <= n; k += 2) p *= -k / (k - 1);
  return p;
}

// The field whose gradient at the orbit's normal forces its eccentricity:
// the odd degrees from 3 weighed by (n - 1) P_n'(0) / (n (n + 1)) (R/a)^n.
const eFields = new Map();
export function eccentricField(a, degree, F = GRAIL) {
  const key = `${a.toFixed(3)}:${degree}`;
  let f = F === GRAIL ? eFields.get(key) : null;
  if (f) return f;
  const C = [], S = [];
  for (let n = 0; n <= degree; n++) {
    const k = n >= 3 ? ((n - 1) * legendreSlopeAtZero(n)) / (n * (n + 1)) * (F.radius / a) ** n : 0;
    C.push(F.C[n].slice(0, n + 1).map((c) => c * k));
    S.push(F.S[n].slice(0, n + 1).map((s) => s * k));
  }
  f = geopotential({ mu: F.gm, radius: F.radius, n: degree, C, S, central: false });
  if (F !== GRAIL) return f;
  if (eFields.size > 16) eFields.clear();
  eFields.set(key, f);
  return f;
}

const J2_MOON = -GRAIL.C[2][0] * Math.sqrt(5);

// The forcing of e (1/s, EQJ) for the circular orbit of radius a and unit
// normal n in the scene sc, from the field `field` (eccentricField).
function eForcing(n, a, sc, field) {
  const mu = GRAIL.gm, R = GRAIL.radius, M = sc.M;
  const np = [dot(M[0], n), dot(M[1], n), dot(M[2], n)], g = field.accel([R * np[0], R * np[1], R * np[2]]);
  const gq = [M[0][0] * g[0] + M[1][0] * g[1] + M[2][0] * g[2], M[0][1] * g[0] + M[1][1] * g[1] + M[2][1] * g[2], M[0][2] * g[0] + M[1][2] * g[1] + M[2][2] * g[2]];
  const k = (R * R) / (a * Math.sqrt(mu * a)), c = cross(n, gq);
  return [k * c[0], k * c[1], k * c[2]];
}

// The part of de/dt linear in e: J2's turn about the normal, and the tides.
function eLinear(e, n, a, sc, j2 = J2_MOON) {
  const mu = GRAIL.gm, R = GRAIL.radius, w = Math.sqrt(mu / a ** 3), ci = dot(n, sc.M[2]);
  const kj = 0.75 * w * j2 * (R / a) ** 2 * (3 * ci * ci - 1), ne = cross(n, e);
  const T = sc.qt, Te = [0, 1, 2].map((i) => T[3 * i] * e[0] + T[3 * i + 1] * e[1] + T[3 * i + 2] * e[2]);
  const Tn = [0, 1, 2].map((i) => T[3 * i] * n[0] + T[3 * i + 1] * n[1] + T[3 * i + 2] * n[2]);
  const kt = (a * a) / (2 * Math.sqrt(mu * a)), x = cross(n, Te), y = cross(e, Tn);
  return [0, 1, 2].map((i) => kj * ne[i] + kt * (5 * x[i] - y[i]));
}

export function moonEccentricityRate(e, n, a, sc, { degree = 50, field = eccentricField(a, degree), j2 = J2_MOON } = {}) {
  const b = eForcing(n, a, sc, field), l = eLinear(e, n, a, sc, j2);
  return [b[0] + l[0], b[1] + l[1], b[2] + l[2]];
}

// The mean eccentricity vector (EQJ) over a plane track (moonPlaneTrack),
// from e0: RK4 on the track's grid (the forcing at its steps and half
// steps, the normal there from the track), the vector kept in the plane.
// To toMs (the track's end by default). Returns at(ms) with at.es (|e| at
// each step), at.fall (the first time the mean periapsis a (1 - e) is
// under the ground, a sphere of radius `ground` as the kernel's impacts
// have it, ms, or null) and at.low ({ km, ms }: the lowest mean periapsis'
// height over the ground, and when, to the fall).
export function moonEccentricityTrack({ track, a, e0 = [0, 0, 0], degree = 50, toMs = track.toMs, ground = bodyConstants('moon').radius }) {
  const field = eccentricField(a, degree), dt = track.dt, s = dt / 1000, from = track.fromMs;
  const N = Math.max(1, Math.min(track.normals.length - 1, Math.ceil((toMs - from) / dt - 1e-9)));
  const at2 = [];
  for (let k = 0; k <= 2 * N; k++) {
    const ms = from + (k * dt) / 2, n = track(ms), sc = moonScene(ms);
    at2.push({ n, sc, b: eForcing(n, a, sc, field) });
  }
  const f = (e, k) => { const q = at2[k], l = eLinear(e, q.n, a, q.sc); return [q.b[0] + l[0], q.b[1] + l[1], q.b[2] + l[2]]; };
  const flat = (e, n) => { const d = dot(e, n); return [e[0] - d * n[0], e[1] - d * n[1], e[2] - d * n[2]]; };
  let e = flat(e0, track.normals[0]);
  const list = [e];
  for (let i = 0; i < N; i++) {
    const k1 = f(e, 2 * i), k2 = f(e.map((x, j) => x + 0.5 * s * k1[j]), 2 * i + 1);
    const k3 = f(e.map((x, j) => x + 0.5 * s * k2[j]), 2 * i + 1), k4 = f(e.map((x, j) => x + s * k3[j]), 2 * i + 2);
    e = flat(e.map((x, j) => x + (s / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])), track.normals[i + 1]);
    list.push(e);
  }
  const at = (ms) => {
    const q = Math.max(0, Math.min(N, (ms - from) / dt)), i = Math.min(N - 1, Math.floor(q)), u = q - i;
    return list[i].map((x, j) => x + u * (list[i + 1][j] - x));
  };
  const es = list.map(norm), R = ground;
  // The first step whose mean periapsis is under the ground, the time in
  // the step where it crosses (linear in |e|).
  let fall = null, low = { km: a - R, ms: from };
  for (let i = 0; i <= N; i++) {
    const km = a * (1 - es[i]) - R;
    if (km < low.km) low = { km, ms: from + i * dt };
    if (km <= 0 && fall === null) {
      const k0 = a * (1 - es[i - 1]) - R;
      fall = from + (i - 1 + k0 / (k0 - km)) * dt;
      break;
    }
  }
  at.es = es; at.list = list; at.dt = dt; at.fromMs = from; at.toMs = from + N * dt; at.fall = fall; at.low = low;
  return at;
}
