// src/chart/craftTrack.ts
//
// The ground track of the console's craft on the chart
// (docs/frontend/chart.md#the-craft), for any body it orbits.

import { bodyAxesEqj } from '@digital-orrery/physics/orientation.js';
import { subPoint } from '@digital-orrery/physics/passes.js';
import { propagate } from '@digital-orrery/physics/orbital.js';
import type { CraftOrbit } from '../app/mission';

const D = Math.PI / 180;

// The point under a craft along its two-body orbit about the body (the
// osculating conic the 3D view draws, craftPaths.ts: the path it would
// follow if every other force stopped now), from now to one and a half
// orbits ahead, at most two days, ending where that orbit meets the ground
// (the impact) or leaves the body's sphere of influence. Steps of a degree
// of the craft's motion about the body (the angle swept, h / r^2 per
// second), at most ten minutes, so a perigee pass is as smooth as an
// apogee. The body turns under it at its rate now (its axes an hour
// apart); over two days the pole's drift and any change in the spin are
// under a hundredth of a degree, the Moon's libration the most. The
// Earth's latitudes are geodetic (WGS 84), as its maps and the satellites'
// tracks are; the rest are planetocentric.
export function craftTrackOf(o: CraftOrbit, key: string, radiusKm: number): { line: [number, number][]; impact: [number, number] | null } {
  const [r, v] = [o.r, o.v];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const h = Math.hypot(r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]);
  const energy = dot(v, v) / 2 - o.mu / Math.hypot(r[0], r[1], r[2]);
  const period = energy < 0 ? 2 * Math.PI * Math.sqrt((-o.mu / (2 * energy)) ** 3 / o.mu) : Infinity;
  const span = Math.min(1.5 * period, 2 * 86400);
  const A = bodyAxesEqj(key, new Date(o.timeMs)) as number[][], B = bodyAxesEqj(key, new Date(o.timeMs + 3600e3)) as number[][];
  const w = Math.atan2(dot(B[0], A[1]), dot(B[0], A[0])) / 3600;
  const ground = (p: number[], dt: number): [number, number] => {
    const x0 = dot(A[0], p), y0 = dot(A[1], p), z = dot(A[2], p), c = Math.cos(w * dt), sn = Math.sin(w * dt);
    const x = x0 * c + y0 * sn, y = -x0 * sn + y0 * c;
    if (key === 'earth') { const g = subPoint([x, y, z]); return [g.latDeg * D, g.lonDeg * D]; }
    return [Math.atan2(z, Math.hypot(x, y)), Math.atan2(y, x)];
  };
  const line: [number, number][] = [ground(r, 0)];
  let dt = 0, p = r;
  if (!(h > 1e-6)) return { line, impact: null };
  while (dt < span && line.length < 2000) {
    const rn = Math.hypot(p[0], p[1], p[2]);
    dt = Math.min(span, dt + Math.min(600, Math.max(1, (D * rn * rn) / h)));
    const s = propagate(r, v, dt, o.mu) as { r: number[] } | null;
    if (!s) break;
    p = s.r;
    const n = Math.hypot(p[0], p[1], p[2]);
    if (n > o.rMax) break;
    const g = ground(p, dt);
    line.push(g);
    if (n < radiusKm) return { line, impact: g };
  }
  return { line, impact: null };
}
