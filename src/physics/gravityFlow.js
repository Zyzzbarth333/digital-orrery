// src/physics/gravityFlow.js
//
// The solar system's gravitational field as a whole
// (docs/physics/gravity-guides.md#the-field-of-every-body): the summed pull
// of every body at a point, in three frames, and the effective potential
// of a pair in its rotating frame. The GPU draws the same sums
// (src/scene/gravityFlow.ts); these are the double-precision originals the
// tests and the readouts use. Pure ES module, no dependencies.
//
//   inertial   a(p) = sum_i GM_i (r_i - p) / |r_i - p|^3
//   falling    a(p) - a(r_f): the field seen falling freely with the focus
//              f (its own pull plus the others' tides)
//   rotating   the circular restricted problem of a pair P, S turning at
//              n^2 = (GM_P + GM_S) / d^3 about its barycentre B:
//                Phi = -GM_P/|p - r_P| - GM_S/|p - r_S| - n^2 rho^2 / 2
//              (rho the distance from the axis through B), whose L1-L3 are
//              its saddles and L4, L5 its peaks
//
// Inside a body (|r_i - p| < its radius R_i) its pull is a uniform
// sphere's, GM_i (r_i - p) / R_i^3, so the sums stay finite there.
//
// bodies: [{ gm, r: [x, y, z], radius }], km and km^3/s^2; out in km/s^2.

import { lagrangePoints } from './gravityGuides.js';

export function fieldAccel(p, bodies, out = [0, 0, 0]) {
  out[0] = 0; out[1] = 0; out[2] = 0;
  for (const b of bodies) {
    const dx = b.r[0] - p[0], dy = b.r[1] - p[1], dz = b.r[2] - p[2];
    const d = Math.hypot(dx, dy, dz);
    const k = b.gm / Math.max(d, b.radius ?? 0) ** 3;
    out[0] += k * dx; out[1] += k * dy; out[2] += k * dz;
  }
  return out;
}

// The potential, the same sum of -GM/d (a uniform sphere's inside).
export function fieldPotential(p, bodies) {
  let phi = 0;
  for (const b of bodies) {
    const d = Math.hypot(b.r[0] - p[0], b.r[1] - p[1], b.r[2] - p[2]);
    const R = b.radius ?? 0;
    phi -= d >= R ? b.gm / d : (b.gm * (3 * R * R - d * d)) / (2 * R * R * R);
  }
  return phi;
}

// The acceleration of body `f` (an index into bodies) from all the others:
// what the falling frame takes away.
export function frameAccel(bodies, f) {
  return fieldAccel(bodies[f].r, bodies.filter((_, i) => i !== f));
}

export function fallingAccel(p, bodies, f, out = [0, 0, 0]) {
  const af = frameAccel(bodies, f);
  fieldAccel(p, bodies, out);
  out[0] -= af[0]; out[1] -= af[1]; out[2] -= af[2];
  return out;
}

// The rotating frame of a pair at its present configuration: the same
// separation, plane and barycentre as lagrangePoints() uses, turning at
// the circular mean motion for that separation (so its equilibria are
// exactly those points). P, S: { gm, r, v, radius }.
export function rotatingFrame(P, S) {
  const gm = P.gm + S.gm, mu = S.gm / gm;
  const d = [S.r[0] - P.r[0], S.r[1] - P.r[1], S.r[2] - P.r[2]];
  const sep = Math.hypot(d[0], d[1], d[2]);
  const vRel = [S.v[0] - P.v[0], S.v[1] - P.v[1], S.v[2] - P.v[2]];
  const h = [d[1] * vRel[2] - d[2] * vRel[1], d[2] * vRel[0] - d[0] * vRel[2], d[0] * vRel[1] - d[1] * vRel[0]];
  const hn = Math.hypot(h[0], h[1], h[2]);
  return {
    P, S, gm, mu, sep,
    axis: h.map((c) => c / hn),
    bary: [0, 1, 2].map((i) => P.r[i] + mu * d[i]),
    n2: gm / sep ** 3,
  };
}

// The part of p - B square to the frame's axis.
function radial(p, F) {
  const q = [p[0] - F.bary[0], p[1] - F.bary[1], p[2] - F.bary[2]];
  const z = q[0] * F.axis[0] + q[1] * F.axis[1] + q[2] * F.axis[2];
  return [q[0] - z * F.axis[0], q[1] - z * F.axis[1], q[2] - z * F.axis[2]];
}

// Gravity of the pair plus the centrifugal term n^2 rho (the Coriolis
// term needs a velocity, and a field has none).
export function effectiveAccel(p, F, out = [0, 0, 0]) {
  fieldAccel(p, [F.P, F.S], out);
  const q = radial(p, F);
  out[0] += F.n2 * q[0]; out[1] += F.n2 * q[1]; out[2] += F.n2 * q[2];
  return out;
}

export function effectivePotential(p, F) {
  const q = radial(p, F);
  return fieldPotential(p, [F.P, F.S]) - 0.5 * F.n2 * (q[0] * q[0] + q[1] * q[1] + q[2] * q[2]);
}

// The Jacobi constant of a point at rest in the frame, in the pair's units
// (G(M + m) = d = 1): C = -2 Phi d / G(M + m). Bounded orbits of energy C
// stay where C(p) > C; the curves C(p) = C(L1), C(L2), C(L3) are the
// zero-velocity curves that open the necks at each point.
export const jacobi = (p, F) => (-2 * effectivePotential(p, F) * F.sep) / F.gm;

// The five points of the pair (gravityGuides.js) and the Jacobi constant
// at each: C1 > C2 > C3 > C4 = C5 for a small mass ratio.
export function criticalLevels(F) {
  const L = lagrangePoints(F.P.r, F.S.r, [F.S.v[0] - F.P.v[0], F.S.v[1] - F.P.v[1], F.S.v[2] - F.P.v[2]], F.P.gm, F.S.gm);
  const out = {};
  for (const k of ['L1', 'L2', 'L3', 'L4', 'L5']) out[k] = { r: L[k], C: jacobi(L[k], F) };
  return out;
}
