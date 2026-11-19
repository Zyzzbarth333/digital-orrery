// packages/physics/src/parkingPlane.js
//
// A parking orbit's plane over a stay, and what leaving it costs when the
// plane no longer holds the way out (docs/physics/journey.md#the-parking-orbits-plane).
// Pure ES module: km, km/s, s, rad; vectors in any one inertial frame.
//
//   nodeRate(mu, j2, R, a, e, i)        the J2 secular rate of the node
//                                       (Curtis eq. (4.52)), rad/s
//   flownNodeRate({ mu, j2, jn, R, pole, r, v })
//                                       the node's rate of an orbit flown in
//                                       the body's zonal field (the kernel's:
//                                       J2, and for the giant planets the
//                                       terms beyond it, bodies.js ZONAL jn)
//                                       for ten turns, rad/s, and its mean
//                                       semi-major axis
//   leaveCircularDv(n, r, mu, vinf)     the cheapest single burn from a
//                                       circular orbit onto an asymptote
//   turnPlane(n, pole, angle)           a plane's normal after its node turns

import { asymptoteVelocities, rotate } from './transfers.js';
import { addJ2, zonalTerms } from './zonal.js';
import { dot, cross, norm, unit } from './vec.js';

const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// The node's mean rate from the body's oblateness, for an orbit of
// semi-major axis a, eccentricity e and inclination i to the body's equator
// (Curtis, Sec. 4.7, eq. (4.52)):
//   dOmega/dt = -(3/2) sqrt(mu) J2 R^2 cos i / ((1 - e^2)^2 a^(7/2))
// Negative (westward) for a prograde orbit, positive for a retrograde one.
export function nodeRate(mu, j2, R, a, e, i) {
  return -1.5 * Math.sqrt(mu) * j2 * R * R * Math.cos(i) / ((1 - e * e) ** 2 * a ** 3.5);
}

// The node's rate as the orbit from (r, v) (about the body) has it in the
// body's zonal field alone, as the kernel has it (zonal.js addJ2: J2, and
// the giant planets' terms beyond it, jn = { n: Jn } at radius R as
// bodies.js ZONAL holds them, J4 adding its own share and Jupiter's J6
// more): flown for ten turns (RK4, 240 steps a turn) and the
// node read where the orbit crosses the equator northward, so the J2 terms
// that come and go within a turn cancel. Eq. (4.52) is the mean rate of the
// mean orbit; a circular orbit started at radius r is not quite that one
// (its mean semi-major axis differs from r by about J2 (R/r)^2 r, as where
// it starts), and J2's second-order terms add their share: together about
// 0.15 to 0.6 % at 400 km over Mars, which over a year's stay is 5 to 20
// degrees of node. Returns { rate (rad/s), first (eq. (4.52) for the
// starting orbit), ratio, aMean (the osculating semi-major axis averaged
// over the turns, km) }, or null for an orbit too near the equator to
// have a node.
export function flownNodeRate({ mu, j2, jn = null, R, pole, r, v, turns = 10, steps = 240 }) {
  const p = unit(pole);
  const h0 = cross(r, v), i0 = Math.acos(Math.max(-1, Math.min(1, dot(unit(h0), p))));
  const a0 = 1 / (2 / norm(r) - dot(v, v) / mu), e0 = norm(sub(scale(r, dot(v, v) / mu - 1 / norm(r)), scale(v, dot(r, v) / mu)));
  const first = nodeRate(mu, j2, R, a0, e0, i0);
  if (Math.sin(i0) < 1e-3 || !(a0 > 0)) return null;
  const body = { mu, j2, rJ2: R, pole: p, ...(jn ? { zn: zonalTerms(jn, R) } : {}) };
  const acc = (x) => {
    // Point mass plus the zonal terms (J2: Curtis eq. (10.30), about the
    // pole p), as the kernel adds them.
    const d2 = dot(x, x), f = -mu / (d2 * Math.sqrt(d2)), out = [f * x[0], f * x[1], f * x[2]];
    addJ2(x[0], x[1], x[2], d2, body, out);
    return out;
  };
  const T = 2 * Math.PI * Math.sqrt(a0 ** 3 / mu), dt = T / steps;
  const e1 = unit(Math.abs(p[2]) < 0.9 ? cross(p, [0, 0, 1]) : cross(p, [1, 0, 0])), e2 = cross(p, e1);
  const nodeOf = (x, u) => { const n = cross(p, cross(x, u)); return Math.atan2(dot(n, e2), dot(n, e1)); };
  let x = r.slice(), u = v.slice(), t = 0, aSum = 0, aN = 0;
  const crossings = [];
  for (let s = 0; s < (turns + 1) * steps; s++) {
    const k1v = acc(x), k1x = u;
    const k2v = acc(x.map((q, m) => q + 0.5 * dt * k1x[m])), k2x = u.map((q, m) => q + 0.5 * dt * k1v[m]);
    const k3v = acc(x.map((q, m) => q + 0.5 * dt * k2x[m])), k3x = u.map((q, m) => q + 0.5 * dt * k2v[m]);
    const k4v = acc(x.map((q, m) => q + dt * k3x[m])), k4x = u.map((q, m) => q + dt * k3v[m]);
    const xn = x.map((q, m) => q + (dt / 6) * (k1x[m] + 2 * k2x[m] + 2 * k3x[m] + k4x[m]));
    const un = u.map((q, m) => q + (dt / 6) * (k1v[m] + 2 * k2v[m] + 2 * k3v[m] + k4v[m]));
    const z0 = dot(x, p), z1 = dot(xn, p);
    // Northward through the equator: the node there, between the steps.
    if (z0 < 0 && z1 >= 0) {
      const f = z0 / (z0 - z1), N0 = nodeOf(x, u), N1 = nodeOf(xn, un);
      let d = N1 - N0;
      d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
      crossings.push({ t: t + f * dt, node: N0 + f * d });
    }
    x = xn; u = un; t += dt;
    // The osculating semi-major axis, averaged over the turns flown from
    // the first crossing (the mean orbit's, as journeyFlight.js meanOrbit).
    if (crossings.length) { aSum += 1 / (2 / norm(x) - dot(u, u) / mu); aN++; }
    if (crossings.length > turns) break;
  }
  if (crossings.length < 2) return null;
  let total = 0;
  for (let c = 1; c < crossings.length; c++) {
    let d = crossings[c].node - crossings[c - 1].node;
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    total += d;
  }
  const rate = total / (crossings.at(-1).t - crossings[0].t);
  return { rate, first, ratio: rate / first, aMean: aN ? aSum / aN : a0 };
}

// A plane's normal n after its node has turned by `angle` about the pole
// (the J2 secular motion keeps the inclination: the plane turns rigidly).
export const turnPlane = (n, pole, angle) => rotate(n, unit(pole), angle);

// The cheapest single burn from the circular orbit of radius r and normal
// n (the way the craft goes round) onto a hyperbola that leaves along vinf
// (a vector): at 72 points round the orbit, the two hyperbolas through that
// point whose asymptote is vinf (transfers.js asymptoteVelocities, exact),
// the cheaper; then by golden section about the best point. With vinf in
// the plane it is the tangential burn at the departure hyperbola's
// periapsis, departureDv (Curtis eq. (8.42)); out of the plane it costs
// more. Returns { dv, phi }.
export function leaveCircularDv(n, r, mu, vinf) {
  const nn = unit(n), u1 = unit(Math.abs(nn[2]) < 0.9 ? cross(nn, [0, 0, 1]) : cross(nn, [1, 0, 0])), u2 = cross(nn, u1), vc = Math.sqrt(mu / r);
  const at = (phi) => {
    const c = Math.cos(phi), s = Math.sin(phi);
    const x = [0, 1, 2].map((m) => r * (c * u1[m] + s * u2[m])), v = [0, 1, 2].map((m) => vc * (-s * u1[m] + c * u2[m]));
    let best = Infinity;
    for (const v1 of asymptoteVelocities(x, vinf, mu)) { const d = norm(sub(v1, v)); if (d < best) best = d; }
    return best;
  };
  let bi = 0, bv = Infinity;
  for (let i = 0; i < 72; i++) { const m = at((2 * Math.PI * i) / 72); if (m < bv) { bv = m; bi = i; } }
  let lo = (2 * Math.PI * (bi - 1)) / 72, hi = (2 * Math.PI * (bi + 1)) / 72;
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 40; k++) { const c = hi - gr * (hi - lo), d = lo + gr * (hi - lo); if (at(c) < at(d)) hi = d; else lo = c; }
  const phi = (lo + hi) / 2, m = at(phi);
  return m < bv ? { dv: m, phi } : { dv: bv, phi: (2 * Math.PI * bi) / 72 };
}

// The angle between a plane (normal n) and a direction w, rad.
export const planeAngle = (n, w) => Math.asin(Math.min(1, Math.abs(dot(unit(n), unit(w)))));
