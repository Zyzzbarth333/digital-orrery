// src/scene/shadowGlsl.ts
//
// GLSL shared by the shaders that cast shadows (bodies, rings, satellites,
// the atmosphere shell).

// The fraction of the Sun's disc (angular radius a) left in view past a
// disc of angular radius b whose centre is c away (radians): the lens of
// their overlap (docs/frontend/lighting.md#eclipses, discs.js in JS).
export const VISIBLE_FRACTION = /* glsl */ `
float visibleFraction(float a, float b, float c) {
  if (c >= a + b) return 1.0;
  if (c <= abs(a - b)) return b >= a ? 0.0 : 1.0 - (b * b) / (a * a);
  float a2 = a * a, b2 = b * b, c2 = c * c;
  float lens = a2 * acos(clamp((c2 + a2 - b2) / (2.0 * c * a), -1.0, 1.0))
             + b2 * acos(clamp((c2 + b2 - a2) / (2.0 * c * b), -1.0, 1.0))
             - 0.5 * sqrt(max((-c + a + b) * (c + a - b) * (c - a + b) * (c + a + b), 0.0));
  return clamp(1.0 - lens / (PI * a2), 0.0, 1.0);
}
`;
