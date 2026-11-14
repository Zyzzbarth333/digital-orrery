// src/physics/transfers.js
//
// Closed-form transfers and patched-conic pieces for the journey planner
// (docs/physics/journey.md). Pure ES module: km, km/s, s, rad, and mu in
// km^3/s^2. After Curtis, Orbital Mechanics for Engineering Students (4th
// ed.): chapter 6 (orbital manoeuvres) and chapter 8 (interplanetary
// trajectories). Equation and example numbers are that edition's.
//
//   Orbit changes about one body
//     hohmannApse, hohmannCircular    two tangent burns between coaxial apses (6.2, Ex 6.1)
//     biElliptic, biEllipticBreakEven three burns via a far apoapsis (6.3, Ex 6.3)
//     planeChangeDv, combinedDv       turning the velocity (6.20, 6.21)
//     hohmannPlaneChange              a Hohmann transfer with the plane change split (Ex 6.11, 6.12)
//     phasing                         a phasing orbit to catch a target in the same orbit (Ex 6.4, 6.5)
//   Between planets
//     synodicPeriod, hohmannWindow, windowWait   when to go (8.1, 8.2, Ex 8.1, 8.2)
//     departureDv, captureDv, optimalCapture     the burns at each end (8.4-8.6, Ex 8.4, 8.5, 8.10)
//     aimingRadius, turnAngle, hyperbolaEccentricity
//     flyby, flybyFromB, poweredFlyby, bPlane    gravity assists (8.7, Ex 8.6)

const TWO_PI = 2 * Math.PI;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a) => scale(a, 1 / norm(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Speed at radius r on an orbit of semi-major axis a (vis-viva, Curtis 2.81).
export const visViva = (mu, r, a) => Math.sqrt(mu * (2 / r - 1 / a));
export const circularSpeed = (mu, r) => Math.sqrt(mu / r);
export const orbitPeriod = (mu, a) => TWO_PI * Math.sqrt(a ** 3 / mu);

// ---------------- orbit changes about one body ----------------

// Two tangent burns from orbit `from` ({ rp, ra }) at its apse rA to orbit
// `to` at its apse rB, along the ellipse with apses rA and rB (Curtis 6.2;
// Example 6.1 goes from the perigee of a 480 by 800 km orbit).
export function hohmannApse({ mu, from, rA, to, rB }) {
  const a1 = (from.rp + from.ra) / 2, a2 = (rA + rB) / 2, a3 = (to.rp + to.ra) / 2;
  const vA1 = visViva(mu, rA, a1), vA2 = visViva(mu, rA, a2), vB2 = visViva(mu, rB, a2), vB3 = visViva(mu, rB, a3);
  const dv1 = Math.abs(vA2 - vA1), dv2 = Math.abs(vB3 - vB2);
  return { dv1, dv2, total: dv1 + dv2, tof: Math.PI * Math.sqrt(a2 ** 3 / mu), a: a2, vA1, vA2, vB2, vB3 };
}
export const hohmannCircular = (mu, r1, r2) => hohmannApse({ mu, from: { rp: r1, ra: r1 }, rA: r1, to: { rp: r2, ra: r2 }, rB: r2 });

// Circular rA to circular rC by two half-ellipses through a far apoapsis
// rB (Curtis 6.3, Example 6.3): out to rB, raise the periapsis to rC there,
// then circularise at rC.
export function biElliptic(mu, rA, rB, rC) {
  const a2 = (rA + rB) / 2, a3 = (rB + rC) / 2;
  const dv1 = Math.abs(visViva(mu, rA, a2) - circularSpeed(mu, rA));
  const dv2 = Math.abs(visViva(mu, rB, a3) - visViva(mu, rB, a2));
  const dv3 = Math.abs(circularSpeed(mu, rC) - visViva(mu, rC, a3));
  return { dv1, dv2, dv3, total: dv1 + dv2 + dv3, tof: Math.PI * (Math.sqrt(a2 ** 3 / mu) + Math.sqrt(a3 ** 3 / mu)), rB };
}

// The apoapsis rB beyond which a bi-elliptic transfer from rA to rC costs
// less than the Hohmann transfer (Curtis Fig. 6.8). null if none does: for
// rC / rA below 11.94 the Hohmann transfer always wins. Above 15.58 every
// rB beyond rC wins, so the break-even is rC itself.
export function biEllipticBreakEven(mu, rA, rC) {
  const h = hohmannCircular(mu, rA, rC).total;
  const lo0 = Math.max(rA, rC), f = (rB) => biElliptic(mu, rA, rB, rC).total - h;
  if (f(lo0 * (1 + 1e-9)) < 0) return lo0;
  let lo = lo0, hi = lo0 * 2;
  while (f(hi) > 0) { hi *= 2; if (hi > lo0 * 1e9) return null; }
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// A plane change of di at speed v, the speed kept (Curtis 6.20), and one
// combined with a change of speed from v1 to v2 (6.21).
export const planeChangeDv = (v, di) => 2 * v * Math.sin(Math.abs(di) / 2);
export const combinedDv = (v1, v2, di) => Math.sqrt(Math.max(0, v1 * v1 + v2 * v2 - 2 * v1 * v2 * Math.cos(di)));

// A Hohmann transfer between circular orbits r1 and r2 whose planes differ
// by di, with di1 of it done at the first burn and the rest at the second,
// each combined with its speed change (Curtis Examples 6.11 and 6.12).
// Without split, the split that costs least (golden section: the total is
// unimodal in di1). Also the two simple choices: all at the start, all at
// the end.
export function hohmannPlaneChange(mu, r1, r2, di, split = null) {
  const h = hohmannCircular(mu, r1, r2);
  const cost = (d1) => {
    const dv1 = combinedDv(h.vA1, h.vA2, d1), dv2 = combinedDv(h.vB2, h.vB3, di - d1);
    return { split: d1, dv1, dv2, total: dv1 + dv2 };
  };
  let best;
  if (split !== null) best = cost(split);
  else {
    let a = Math.min(0, di), b = Math.max(0, di);
    const g = (Math.sqrt(5) - 1) / 2;
    for (let k = 0; k < 120; k++) {
      const c = b - g * (b - a), d = a + g * (b - a);
      if (cost(c).total < cost(d).total) b = d; else a = c;
    }
    best = cost((a + b) / 2);
  }
  return { ...best, tof: h.tof, atStart: cost(di), atEnd: cost(0), coplanar: h.total };
}

// Time from periapsis to true anomaly theta on an ellipse (Kepler, Curtis
// 3.10b and 3.14).
export function timeSincePeriapsis(mu, a, e, theta) {
  const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(theta / 2));
  const M = ((E - e * Math.sin(E)) % TWO_PI + TWO_PI) % TWO_PI;
  return M / TWO_PI * orbitPeriod(mu, a);
}

// A phasing manoeuvre (Curtis 6.4): the chaser at apse rA of orbit
// { rp, ra } burns onto a phasing orbit of period T2 = T1 - lead / revs,
// flies it revs times and burns back, meeting a target that was `lead`
// seconds ahead of it along orbit 1 (negative: behind). Example 6.4 catches
// a target 90 degrees ahead in one revolution; Example 6.5 drifts a GEO
// satellite 12 degrees west in three. rMin: the lowest periapsis allowed.
export function phasing({ mu, rp, ra, rA = rp, lead, revs = 1, rMin = 0 }) {
  const a1 = (rp + ra) / 2, T1 = orbitPeriod(mu, a1), T2 = T1 - lead / revs;
  if (!(T2 > 0)) return null;
  const a2 = Math.cbrt(mu * (T2 / TWO_PI) ** 2), rOther = 2 * a2 - rA;
  const dv = Math.abs(visViva(mu, rA, a2) - visViva(mu, rA, a1));
  return { T1, T2, a2, rOther, dv1: dv, dv2: dv, total: 2 * dv, tof: revs * T2, feasible: rOther > 0 && Math.min(rA, rOther) >= rMin };
}

// ---------------- between planets ----------------

// The synodic period of two orbits of periods T1 and T2 (Curtis 8.10, Ex 8.1).
export const synodicPeriod = (T1, T2) => T1 * T2 / Math.abs(T1 - T2);

// A Hohmann transfer between circular orbits R1 and R2 about the Sun (or any
// central body): the flight time, the phase angle of the target ahead of the
// departure body at launch (Curtis 8.13: phi0 = pi - n2 t12), and the mean
// motions (from the radii, or the planets' own mean motions if given, as
// Curtis's examples take them from the periods in his Table A.1).
export function hohmannWindow(muSun, R1, R2, { n1 = Math.sqrt(muSun / R1 ** 3), n2 = Math.sqrt(muSun / R2 ** 3) } = {}) {
  const tof = Math.PI * Math.sqrt(((R1 + R2) / 2) ** 3 / muSun);
  return { tof, n1, n2, phase0: Math.PI - n2 * tof, synodic: TWO_PI / Math.abs(n1 - n2) };
}

// Seconds until the target's phase ahead of the departure body, phaseNow
// now, reaches phaseNeeded, the phase changing at n2 - n1 (Curtis 8.16:
// Example 8.2's return from Mars waits 453.8 days).
export function windowWait(phaseNow, phaseNeeded, n1, n2) {
  const rate = n2 - n1, d = phaseNeeded - phaseNow;
  const m = (x) => ((x % TWO_PI) + TWO_PI) % TWO_PI;
  return rate > 0 ? m(d) / rate : m(-d) / -rate;
}

// The eccentricity of a hyperbola of excess speed vinf and periapsis rp.
export const hyperbolaEccentricity = (rp, vinf, mu) => 1 + rp * vinf * vinf / mu;

// From a circular parking orbit of radius rp onto a hyperbola of excess
// speed vinf (Curtis 8.40, Examples 8.4 and 8.9). beta: the angle at the
// planet's centre from the excess velocity to the periapsis (8.43).
export function departureDv(vinf, mu, rp) {
  return Math.sqrt(vinf * vinf + 2 * mu / rp) - Math.sqrt(mu / rp);
}
export const departureBeta = (vinf, mu, rp) => Math.acos(1 / hyperbolaEccentricity(rp, vinf, mu));

// From a hyperbola of excess speed vinf into an orbit of periapsis rp and
// eccentricity e (0: circular), burning at periapsis (Curtis 8.58, Example
// 8.10). A landing is the capture into a low orbit plus the descent.
export function captureDv(vinf, mu, rp, e = 0) {
  return Math.sqrt(vinf * vinf + 2 * mu / rp) - Math.sqrt(mu * (1 + e) / rp);
}

// The capture into an orbit of eccentricity e that costs least, and the
// periapsis it needs (Curtis 8.67-8.70, Example 8.5).
export function optimalCapture(vinf, mu, e) {
  return { rp: 2 * mu / (vinf * vinf) * (1 - e) / (1 + e), dv: vinf * Math.sqrt((1 - e) / 2) };
}

// The aiming radius: the miss distance of the incoming asymptote, the size
// of the B vector (Curtis 8.71, Examples 8.5 and 8.6).
export const aimingRadius = (rp, vinf, mu) => rp * Math.sqrt(1 + 2 * mu / (rp * vinf * vinf));
// Its inverse: the periapsis for an aiming radius B.
export const periapsisFromAim = (B, vinf, mu) => (mu / (vinf * vinf)) * (Math.sqrt(1 + (B * vinf * vinf / mu) ** 2) - 1);

// The turn of the excess velocity in a flyby (Curtis 8.75, Example 8.6).
export const turnAngle = (rp, vinf, mu) => 2 * Math.asin(1 / hyperbolaEccentricity(rp, vinf, mu));

// Rotate v by angle about the unit axis k (Rodrigues).
export function rotate(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), kv = cross(k, v), d = dot(k, v) * (1 - c);
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * d);
}

// An unpowered flyby: the excess velocity vinfIn turned by the hyperbola of
// periapsis rp about the axis `normal` (the hyperbola's angular momentum
// direction). Returns the outgoing excess velocity, the turn, the aiming
// radius, and the heliocentric velocity change it gives, 2 vinf sin(delta/2).
export function flyby({ vinfIn, mu, rp, normal }) {
  const v = norm(vinfIn), delta = turnAngle(rp, v, mu);
  const vinfOut = rotate(vinfIn, unit(normal), delta);
  return { vinfOut, delta, aim: aimingRadius(rp, v, mu), gain: 2 * v * Math.sin(delta / 2), e: hyperbolaEccentricity(rp, v, mu) };
}

// The B-plane of an approach with excess velocity vinfIn (Kizner's frame:
// S along the approach, T in the ecliptic, R = S x T; pole is the frame's
// north, ecliptic +z by default).
export function bPlaneAxes(vinfIn, pole = [0, 0, 1]) {
  const S = unit(vinfIn);
  let T = cross(S, pole);
  if (norm(T) < 1e-9) T = cross(S, [1, 0, 0]);
  T = unit(T);
  return { S, T, R: cross(S, T) };
}

// The B vector of a flyby that turns vinfIn into the direction of vinfOut
// with periapsis rp: it points from the planet to where the incoming
// asymptote crosses the B-plane, on the side away from the turn.
export function bPlane(vinfIn, vinfOut, rp, mu, pole = [0, 0, 1]) {
  const { S, T, R } = bPlaneAxes(vinfIn, pole);
  const o = unit(vinfOut), perp = sub(o, scale(S, dot(o, S)));
  const B = norm(perp) < 1e-12 ? [0, 0, 0] : scale(unit(perp), -aimingRadius(rp, norm(vinfIn), mu));
  return { B, bT: dot(B, T), bR: dot(B, R), axes: { S, T, R } };
}

// The flyby an aim point (bT, bR) in the B-plane gives: the periapsis, the
// turn and the outgoing excess velocity (unpowered). The hyperbola's angular
// momentum is along B x S.
export function flybyFromB({ vinfIn, mu, bT, bR, pole = [0, 0, 1] }) {
  const { S, T, R } = bPlaneAxes(vinfIn, pole);
  const B = [0, 1, 2].map((i) => bT * T[i] + bR * R[i]), b = norm(B), v = norm(vinfIn);
  if (!(b > 0)) return { rp: 0, delta: Math.PI, vinfOut: scale(vinfIn, -1), B };
  const rp = periapsisFromAim(b, v, mu), delta = turnAngle(rp, v, mu);
  return { rp, delta, vinfOut: rotate(vinfIn, unit(cross(B, S)), delta), B };
}

// A powered flyby joining two given excess velocities (the Lambert arcs
// either side of it): the periapsis whose hyperbolas turn vinfIn into the
// direction of vinfOut, with one burn at periapsis to change the speed.
// Turn of two half-hyperbolas: asin(1/e_in) + asin(1/e_out) (Curtis 8.75,
// split at periapsis). If that periapsis is below rpMin, the flyby passes
// at rpMin and the rest of the turn is a burn at the edge of the sphere of
// influence: 2 v sin(missing / 2). Returns the turn, periapsis, burns and
// the B-plane aim point.
export function poweredFlyby({ vinfIn, vinfOut, mu, rpMin, pole = [0, 0, 1] }) {
  const vi = norm(vinfIn), vo = norm(vinfOut);
  const delta = Math.acos(clamp(dot(vinfIn, vinfOut) / (vi * vo), -1, 1));
  const turn = (rp) => Math.asin(1 / hyperbolaEccentricity(rp, vi, mu)) + Math.asin(1 / hyperbolaEccentricity(rp, vo, mu));
  let rp;
  if (turn(rpMin) < delta) rp = rpMin;
  else {
    let lo = rpMin, hi = rpMin * 2;
    while (turn(hi) > delta && hi < 1e12) hi *= 2;
    for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (turn(m) > delta) lo = m; else hi = m; }
    rp = (lo + hi) / 2;
  }
  const missing = Math.max(0, delta - turn(rp));
  const periapsisDv = Math.abs(Math.sqrt(vo * vo + 2 * mu / rp) - Math.sqrt(vi * vi + 2 * mu / rp));
  const steerDv = 2 * vo * Math.sin(missing / 2);
  const b = bPlane(vinfIn, vinfOut, rp, mu, pole);
  return { delta, rp, periapsisDv, steerDv, dv: periapsisDv + steerDv, tooTight: missing > 1e-9, gain: norm(sub(vinfOut, vinfIn)), bT: b.bT, bR: b.bR, aim: aimingRadius(rp, vi, mu) };
}
