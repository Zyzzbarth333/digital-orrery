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

// The osculating conic through (r, v) about a body of parameter mu.
export function conicPoints(r: number[], v: number[], mu: number, rMax: number, n = 256): V3[] {
  const rn = norm(r), v2 = dot(v, v);
  const h = cross(r, v);
  if (norm(h) < 1e-9) return [];                       // radial: no conic to draw
  const eVec = scale([0, 1, 2].map((i) => (v2 - mu / rn) * r[i] - dot(r, v) * v[i]), 1 / mu);
  const e = norm(eVec);
  const P = e > 1e-9 ? scale(eVec, 1 / e) : scale(r, 1 / rn);
  const hq = cross(h, P);
  const Q = scale(hq, 1 / norm(hq));
  const energy = v2 / 2 - mu / rn;
  const pts: V3[] = [];
  if (e < 1 && energy < 0) {
    const a = -mu / (2 * energy), b = a * Math.sqrt(1 - e * e);
    for (let k = 0; k <= n; k++) {
      const E = (2 * Math.PI * k) / n;
      const x = a * (Math.cos(E) - e), y = b * Math.sin(E);
      pts.push([x * P[0] + y * Q[0], x * P[1] + y * Q[1], x * P[2] + y * Q[2]]);
    }
  } else if (e > 1) {
    const a = Math.abs(mu / (2 * energy)), b = a * Math.sqrt(e * e - 1);
    const rp = a * (e - 1);
    const rTop = Math.max(Math.min(rMax, 30 * rp), rn);
    const Fmax = Math.acosh((rTop / a + 1) / e);
    for (let k = 0; k <= n; k++) {
      const F = -Fmax + (2 * Fmax * k) / n;
      const x = a * (e - Math.cosh(F)), y = b * Math.sinh(F);
      pts.push([x * P[0] + y * Q[0], x * P[1] + y * Q[1], x * P[2] + y * Q[2]]);
    }
  }
  return pts;
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
