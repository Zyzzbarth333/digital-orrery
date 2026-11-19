// packages/physics/src/surfaceClamp.js
//
// Keeps a camera out of a body. The camera turns about its pivot at a set
// distance, so following a craft a kilometre or two up it could swing
// below the ground. Inside the body the surface is not drawn (its inside
// faces are culled), and the stars showed through. This moves such a point
// out along the line from the body's centre to `margin` km above the
// body's ellipsoid; the camera still looks at its pivot.

// cam, centre: km (any frame); axes: the body's X, Y, Z unit axes in that
// frame; radii: [a, b, c] km along them; margin: km above the surface.
// Returns the moved point, or null when it is already outside by `margin`.
export function clampAboveSurface(cam, centre, axes, radii, margin) {
  const rel = [cam[0] - centre[0], cam[1] - centre[1], cam[2] - centre[2]];
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  if (!(d > 0) || d > Math.max(...radii) + margin) return null;
  // The ellipsoid's radius along this direction: 1 / sqrt(sum (u_i / r_i)^2).
  let q = 0;
  for (let i = 0; i < 3; i++) {
    const u = (rel[0] * axes[i][0] + rel[1] * axes[i][1] + rel[2] * axes[i][2]) / d;
    q += (u / radii[i]) ** 2;
  }
  const surface = 1 / Math.sqrt(q);
  if (d >= surface + margin) return null;
  const k = (surface + margin) / d;
  return [centre[0] + rel[0] * k, centre[1] + rel[1] * k, centre[2] + rel[2] * k];
}
