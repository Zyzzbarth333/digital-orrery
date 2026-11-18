// src/scene/craftPaths.ts
//
// What the scene draws for a spacecraft: its osculating conic about its
// primary (the two-body orbit it would follow if every other force stopped
// now, labelled as such in the app), sampled analytically, and the path it
// has actually flown. Positions are km, relative to the primary, in J2000
// equatorial (EQJ) unless converted.
//
//   ellipse:   r(E) = a (cos E - e) P + a sqrt(1 - e^2) sin E Q,   E in [0, 2 pi)
//   hyperbola: r(F) = |a| (e - cosh F) P + |a| sqrt(e^2 - 1) sinh F Q,
//              |F| up to where r reaches rMax (the sphere of influence, or
//              30 periapsis radii if that is nearer)
// with P toward periapsis (the eccentricity vector) and Q = h x P / |h x P|.

type V3 = [number, number, number];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: number[]) => Math.sqrt(dot(a, a));
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: number[], k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

// The conic's shape: P, Q, the semi-axes a and b (both positive), e, and
// for a hyperbola the largest |F| drawn. null for a radial or parabolic
// path, which has no conic to draw.
interface Conic { P: V3; Q: V3; a: number; b: number; e: number; hyp: boolean; lim: number }

function conicOf(r: number[], v: number[], mu: number, rMax: number): Conic | null {
  const rn = norm(r), v2 = dot(v, v);
  const h = cross(r, v);
  if (norm(h) < 1e-9) return null;                     // radial: no conic to draw
  const eVec = scale([0, 1, 2].map((i) => (v2 - mu / rn) * r[i] - dot(r, v) * v[i]), 1 / mu);
  const e = norm(eVec);
  const P = e > 1e-9 ? scale(eVec, 1 / e) : scale(r, 1 / rn);
  const hq = cross(h, P);
  const Q = scale(hq, 1 / norm(hq));
  const energy = v2 / 2 - mu / rn;
  if (e < 1 && energy < 0) {
    const a = -mu / (2 * energy);
    return { P, Q, a, b: a * Math.sqrt(1 - e * e), e, hyp: false, lim: Math.PI };
  }
  if (e > 1) {
    const a = Math.abs(mu / (2 * energy));
    const rTop = Math.max(Math.min(rMax, 30 * a * (e - 1)), rn);
    return { P, Q, a, b: a * Math.sqrt(e * e - 1), e, hyp: true, lim: Math.acosh((rTop / a + 1) / e) };
  }
  return null;
}

// The point at eccentric anomaly E (or hyperbolic anomaly F).
function pointAt(c: Conic, E: number): V3 {
  const x = c.hyp ? c.a * (c.e - Math.cosh(E)) : c.a * (Math.cos(E) - c.e);
  const y = c.hyp ? c.b * Math.sinh(E) : c.b * Math.sin(E);
  return [x * c.P[0] + y * c.Q[0], x * c.P[1] + y * c.Q[1], x * c.P[2] + y * c.Q[2]];
}

// The anomaly of a point on (or near) the conic.
function anomalyOf(c: Conic, p: number[]): number {
  const x = dot(p, c.P), y = dot(p, c.Q);
  return c.hyp ? Math.asinh(y / c.b) : Math.atan2(y / c.b, x / c.a + c.e);
}

// The osculating conic through (r, v) about a body of parameter mu.
export function conicPoints(r: number[], v: number[], mu: number, rMax: number, n = 256): V3[] {
  const c = conicOf(r, v, mu, rMax);
  if (!c) return [];
  const pts: V3[] = [];
  for (let k = 0; k <= n; k++) pts.push(pointAt(c, c.hyp ? -c.lim + (2 * c.lim * k) / n : (2 * Math.PI * k) / n));
  return pts;
}

// The same conic seen from the craft, for a camera close to it: points
// relative to the craft (r), so they stay small in float32 near it, with
// the craft itself a vertex. The anomaly steps from the craft grow as the
// cube of the step count, from 24 m at the craft (in low orbit) to a
// tenth of a radian on the far side: a chord of length c at distance s
// from the craft sags c^2 / 8R, and with this spacing it stays under
// 6e-4 rad seen from 50 m off the craft for m = 96 (in low orbit, on an
// eccentric ellipse and on a hyperbola), under a pixel. Uniform steps in
// the anomaly (conicPoints) sag up to 7.5e-5 of the radius, 510 m on a
// 400 km orbit, which a camera closer than a tenth of the radius sees.
//
// back: the flown path's last stretch, from its last point (from, a point
// the trail kept) to the craft along this conic, also relative to r. The
// trail keeps a point only every 0.5 % of the distance from the primary,
// so without it the trail would stop up to 34 km short of a craft in low
// orbit. Coasting, the conic is the path flown; burning, it differs from
// it by the burn since that point, a few metres over that stretch.
export function conicAround(r: number[], v: number[], mu: number, rMax: number, from: number[] | null, m = 96): { ahead: V3[]; back: V3[] } | null {
  const c = conicOf(r, v, mu, rMax);
  if (!c) return null;
  const E0 = anomalyOf(c, r), o = pointAt(c, E0);
  const rel = (E: number): V3 => { const p = pointAt(c, E); return [p[0] - o[0], p[1] - o[1], p[2] - o[2]]; };
  // Ellipse: a closed loop from the far side round through the craft.
  // Hyperbola: from one end of the drawn branch to the other.
  const lo = c.hyp ? Math.min(0, -c.lim - E0) : -Math.PI, hi = c.hyp ? Math.max(0, c.lim - E0) : Math.PI;
  const ahead: V3[] = [];
  for (let k = -m; k <= m; k++) { const t = k / m; ahead.push(rel(E0 + (t < 0 ? -lo : hi) * t * t * t)); }
  const back: V3[] = [];
  if (from) {
    let d = anomalyOf(c, from) - E0;
    if (!c.hyp) d = Math.atan2(Math.sin(d), Math.cos(d));   // the nearer way round
    const n = Math.max(2, Math.round(m / 3));
    if (d < 0) for (let k = n; k >= 0; k--) { const t = k / n; back.push(rel(E0 + d * t * t * t)); }
  }
  return { ahead, back };
}

// J2000 equatorial -> ecliptic, by the mean obliquity at J2000 (the same
// rotation astronomy-engine and the rest of the scene use).
const EPS = (23.4392911 * Math.PI) / 180, CE = Math.cos(EPS), SE = Math.sin(EPS);
export function eqjToEclFast(a: number[]): V3 {
  return [a[0], CE * a[1] + SE * a[2], -SE * a[1] + CE * a[2]];
}

// The flown path, relative to the primary, kept while the primary is the
// same: a point whenever the craft has moved 0.5 % of its distance from the
// primary, at most 2,000 points.
export class Trail {
  key: string | null = null;
  points: V3[] = [];
  push(primary: string, rel: number[]): void {
    if (primary !== this.key) { this.key = primary; this.points = []; }
    const last = this.points.at(-1);
    if (!last || norm([rel[0] - last[0], rel[1] - last[1], rel[2] - last[2]]) > 0.005 * norm(rel)) {
      this.points.push([rel[0], rel[1], rel[2]]);
      if (this.points.length > 2000) this.points.shift();
    }
  }
}
