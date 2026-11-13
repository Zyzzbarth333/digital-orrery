// src/physics/environment.js
//
// The forces on a spacecraft beyond the point masses and J2 the kernel
// already has (docs/physics/environment.md). Each is an acceleration on the
// craft alone, so it enters the kernel the same way in Cowell's method and
// in Encke's (as the extraAccel hook, beside the thrust). Pure ES module.
//
//   const env = makeEnvironment(sys, craft)   craft: { mass, area, cr, ... }
//   env(t, r, v, out)    heliocentric J2000 r (km), v (km/s), t kernel seconds;
//                        adds km/s^2 into out
//
// Models so far:
//   sunlight   solar radiation pressure on a flat-plate "cannonball":
//              a = Cr P (AU/d)^2 (A/m) s_hat * nu
//              P = 1361 W/m^2 / c at 1 AU, s_hat from the Sun to the craft,
//              nu the visible fraction of the Sun's disc (shadow()), with the
//              Earth and the Moon as occulting spheres.

export const AU = 149597870.7;                 // km
export const SOLAR_PRESSURE = 1361 / 299792458; // N/m^2 at 1 AU (IAU 2015 B3 nominal irradiance)
export const SUN_RADIUS = 695700;              // km (IAU 2015 B3)

// The fraction of the Sun's disc seen from a point, with one occulting
// sphere: 1 in full sunlight, 0 in the umbra, between in the penumbra or an
// annular eclipse. sunRel: Sun minus point; bodyRel: body centre minus
// point; R: body radius (km); sunRadius: the Sun's (km). The overlap of two discs on the sky
// (Montenbruck and Gill, Satellite Orbits, 3.4.2).
export function sunVisible(sunRel, bodyRel, R, sunRadius = SUN_RADIUS) {
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

export const LIGHT = 299792.458;               // km/s

// The visible fraction with several occulting bodies, taking the deepest
// (two at once is an overlap the app never meets; the deeper is the
// conservative choice). Each body stands where it was when the light it
// blocks passed it: d/c earlier, d its distance from the point. In the
// Sun's frame the Moon moves about 30 km/s, so for a point on the Earth
// that is 38 km, the size of a solar eclipse's path shift. bodies:
// [{ r, v, radius }] heliocentric km, km/s (v optional).
export function shadow(r, bodies, sunRadius = SUN_RADIUS) {
  let nu = 1;
  const sunRel = [-r[0], -r[1], -r[2]];
  for (const b of bodies) {
    let x = b.r[0] - r[0], y = b.r[1] - r[1], z = b.r[2] - r[2];
    if (b.v) { const tau = Math.hypot(x, y, z) / LIGHT; x -= b.v[0] * tau; y -= b.v[1] * tau; z -= b.v[2] * tau; }
    const f = sunVisible(sunRel, [x, y, z], b.radius, sunRadius);
    if (f < nu) nu = f;
  }
  return nu;
}

// craft: { mass (kg), area (m^2, facing the Sun), cr (1 absorbing to 2
// mirror; 1.3 typical), shadowBodies (keys; default Earth and Moon),
// massAt(t) (optional: the mass at time t, as a burn sheds propellant) }
export function makeEnvironment(sys, craft = {}) {
  const terms = [], caps = [];
  if (craft.area > 0 && craft.mass > 0 && (craft.cr ?? 1.3) > 0) {
    const k1 = (craft.cr ?? 1.3) * SOLAR_PRESSURE * craft.area / 1000;   // km/s^2 at 1 AU for 1 kg
    const massAt = craft.massAt ?? (() => craft.mass);
    const keys = craft.shadowBodies ?? ['earth', 'moon'];
    const occ = keys.map(() => ({ r: [0, 0, 0], v: [0, 0, 0], radius: 0 }));
    terms.push((t, r, v, out) => {
      const d2 = r[0] * r[0] + r[1] * r[1] + r[2] * r[2], d = Math.sqrt(d2);
      const bodies = sys.bodiesAt(t);
      let n = 0;
      for (const b of bodies) {
        if (!keys.includes(b.key)) continue;
        const o = occ[n++];
        o.r[0] = b.r[0]; o.r[1] = b.r[1]; o.r[2] = b.r[2]; o.radius = b.radius;
        b.eph.velocity(t, o.v);
      }
      occ.length = n;
      const nu = shadow(r, occ);
      if (nu === 0) return;
      const k = nu * k1 / massAt(t) * AU * AU / d2 / d;
      out[0] += k * r[0]; out[1] += k * r[1]; out[2] += k * r[2];
    });
    // Steps near a shadow's edge: the push switches off and on there, and a
    // step straight across it lands the switch wherever the step happens to
    // end. Away from a shadow, half the time to the nearest contact of the
    // two discs; inside the penumbra, a tenth of the time to cross it; never
    // below 0.5 s.
    const vb = [0, 0, 0];
    caps.push((t, r, v) => {
      let cap = Infinity;
      for (const b of sys.bodiesAt(t)) {
        if (!keys.includes(b.key)) continue;
        const bx = b.r[0] - r[0], by = b.r[1] - r[1], bz = b.r[2] - r[2], db = Math.hypot(bx, by, bz);
        if (db <= b.radius) continue;
        const ds = Math.hypot(r[0], r[1], r[2]);
        const a = Math.asin(Math.min(1, SUN_RADIUS / ds)), bb = Math.asin(b.radius / db);
        const c = Math.acos(Math.max(-1, Math.min(1, -(r[0] * bx + r[1] * by + r[2] * bz) / (ds * db))));
        b.eph.velocity(t, vb);
        const w = Math.hypot(v[0] - vb[0], v[1] - vb[1], v[2] - vb[2]) / db + 1e-12;   // rad/s, roughly
        const inner = Math.abs(bb - a), outer = a + bb;
        const inside = c > inner && c < outer;
        const span = inside ? 0.1 * (outer - inner) / w : 0.5 * Math.min(Math.abs(c - outer), Math.abs(c - inner)) / w;
        cap = Math.min(cap, Math.max(0.5, span));
      }
      return cap;
    });
  }
  if (!terms.length) return null;
  const env = (t, r, v, out) => { for (const f of terms) f(t, r, v, out); return out; };
  env.stepCap = caps.length ? (t, r, v) => { let c = Infinity; for (const f of caps) c = Math.min(c, f(t, r, v)); return c; } : null;
  return env;
}
