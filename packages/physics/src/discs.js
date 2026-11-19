// packages/physics/src/discs.js
//
// How much of the Sun a body leaves in view (docs/frontend/lighting.md#glare-and-bloom):
// the fraction of a disc of angular radius a still visible past a disc of
// angular radius b whose centre is c away (all radians), from the area of
// the two discs' overlap (the lens). The glare and the sky's adaptation
// scale with it; the eclipse shaders (bodyMaterial.ts, rings.ts) work the
// same in GLSL. Pure ES module.

export function visibleFraction(a, b, c) {
  if (c >= a + b) return 1;
  if (c <= Math.abs(a - b)) return b >= a ? 0 : 1 - (b * b) / (a * a);
  const a2 = a * a, b2 = b * b, c2 = c * c;
  const lens = a2 * Math.acos(Math.max(-1, Math.min(1, (c2 + a2 - b2) / (2 * c * a))))
    + b2 * Math.acos(Math.max(-1, Math.min(1, (c2 + b2 - a2) / (2 * c * b))))
    - 0.5 * Math.sqrt(Math.max((-c + a + b) * (c + a - b) * (c - a + b) * (c + a + b), 0));
  return Math.max(0, Math.min(1, 1 - lens / (Math.PI * a2)));
}

// The fraction of the Sun's disc seen from a point, with one occulting
// sphere: 1 in full sunlight, 0 in the umbra, between in the penumbra or an
// annular eclipse. sunRel: Sun minus point; bodyRel: body centre minus
// point; R: body radius (km); sunRadius: the Sun's (km). The overlap of two discs on the sky
// (Montenbruck and Gill, Satellite Orbits, 3.4.2).
export function sunVisible(sunRel, bodyRel, R, sunRadius = 695700) {
  const ds = Math.hypot(sunRel[0], sunRel[1], sunRel[2]), db = Math.hypot(bodyRel[0], bodyRel[1], bodyRel[2]);
  if (db <= R) return 0;                                // inside the body
  const a = Math.asin(Math.min(1, sunRadius / ds));     // apparent radius of the Sun
  const b = Math.asin(R / db);                          // apparent radius of the body
  const cosc = (sunRel[0] * bodyRel[0] + sunRel[1] * bodyRel[1] + sunRel[2] * bodyRel[2]) / (ds * db);
  const c = Math.acos(Math.max(-1, Math.min(1, cosc)));  // their separation
  if (c >= a + b) return 1;                             // no overlap
  if (c <= b - a) return 0;                             // the body covers the Sun
  if (c <= a - b) return 1 - (b * b) / (a * a);         // annular: the body inside the Sun's disc
  // Partial overlap of two discs (radii a, b, centres c apart).
  const x = (c * c + a * a - b * b) / (2 * c), y = Math.sqrt(Math.max(0, a * a - x * x));
  const A = a * a * Math.acos(Math.max(-1, Math.min(1, x / a))) + b * b * Math.acos(Math.max(-1, Math.min(1, (c - x) / b))) - c * y;
  return 1 - A / (Math.PI * a * a);
}

// The Sun seen from a point past several spheres: the fraction of its disc
// left (the deepest single overlap, as environment.js's shadow does) and
// which body casts it. sunRel: Sun minus point (km); bodies: [{ key, rel,
// radius }] with rel the body's centre minus the point (km). For the
// readouts: 'umbra' under 0.1 % of the disc, 'penumbra' (or annular) under
// all of it, else 'lit'.
/**
 * @param {number[]} sunRel
 * @param {{ key: string, rel: number[], radius: number }[]} bodies
 * @param {number} [sunRadius]
 * @returns {{ nu: number, by: string | null, state: 'lit' | 'penumbra' | 'umbra' }}
 */
export function sunlight(sunRel, bodies, sunRadius = 695700) {
  let nu = 1;
  /** @type {string | null} */
  let by = null;
  for (const b of bodies) {
    const f = sunVisible(sunRel, b.rel, b.radius, sunRadius);
    if (f < nu) { nu = f; by = b.key; }
  }
  return { nu, by, state: nu < 1e-3 ? 'umbra' : nu < 1 ? 'penumbra' : 'lit' };
}
