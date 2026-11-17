// src/physics/discs.js
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
