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
//   earth field  the Earth's gravity beyond J2 (EGM2008 to degree 20 by
//              default), evaluated in the Earth-fixed frame of date (IAU
//              1976/1980) and rotated back; J2 stays with the kernel's
//              zonal model
//   drag       a = -rho |v_r| v_r Cd A / (2 m), v_r relative to an
//              atmosphere turning with the Earth about its pole of date;
//              rho from atmosphere.js (the 1976 standard below 86 km, NASA's
//              MET above 90 km with the Sun's activity for the date)
//   sunlight   solar radiation pressure on a flat-plate "cannonball":
//              a = Cr P (AU/d)^2 (A/m) s_hat * nu
//              P = 1361 W/m^2 / c at 1 AU, s_hat from the Sun to the craft,
//              nu the visible fraction of the Sun's disc (shadow()), with the
//              Earth and the Moon as occulting spheres.

import { geopotential } from './geopotential.js';
import { earthFixedMatrix } from './earthRotation.js';
import { ttMinusUtc } from './timescale.js';
import { EGM2008 } from './egm2008.js';
import { density } from './atmosphere.js';

export const AU = 149597870.7;                 // km
export const EARTH_ROTATION = 7.2921158553e-5;  // rad/s, sidereal (IERS)
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

// The J2000 -> Earth-fixed matrix at kernel time t, cheaply: precession,
// nutation and sidereal time once an hour (earthRotation.js), and the
// Earth's spin about its pole of date analytically in between (the pole
// moves by 3e-8 rad in an hour).
export function earthFixedAt(epochMs, opts = {}) {
  let t0 = NaN, M0 = null;
  return (t) => {
    if (!(Math.abs(t - t0) < 1800)) {
      t0 = Math.round(t / 3600) * 3600;
      const ms = epochMs + t0 * 1000;
      M0 = earthFixedMatrix(ms, { leapSeconds: opts.leapSeconds ?? ttMinusUtc(ms) - 32.184, dut1: opts.dut1 ?? 0 }).M;
    }
    const a = EARTH_ROTATION * (t - t0), c = Math.cos(a), s = Math.sin(a);
    // R3(a) M0: the first two rows turn about the third.
    return [
      [c * M0[0][0] + s * M0[1][0], c * M0[0][1] + s * M0[1][1], c * M0[0][2] + s * M0[1][2]],
      [-s * M0[0][0] + c * M0[1][0], -s * M0[0][1] + c * M0[1][1], -s * M0[0][2] + c * M0[1][2]],
      M0[2],
    ];
  };
}

// craft: { mass (kg), area (m^2, facing the Sun), cr (1 absorbing to 2
// mirror; 1.3 typical), shadowBodies (keys; default Earth and Moon),
// massAt(t) (optional: the mass at time t, as a burn sheds propellant),
// earth: { degree (default 20; 0 for none), field (default EGM2008: { gm,
// radius, C, S }), withJ2 (default false: the kernel's zonal model has it),
// maxRadius (km; beyond, the harmonics are left out: default 20 Earth
// radii), dut1, leapSeconds (the Earth rotation's time offsets) },
// epochMs (kernel time zero, default the kernel's),
// cd (drag coefficient, default 2.2; 0 for no drag), drag: { sw (the Sun's
// activity, default the date's), flattening (for geodetic height, default
// WGS-84's), met (MET options) } }
export function makeEnvironment(sys, craft = {}) {
  const terms = [], caps = [];
  const epochMs = craft.epochMs ?? Date.UTC(2000, 0, 1, 12);
  const E = craft.earth ?? {};
  const massAt = craft.massAt ?? (() => craft.mass);
  const fixed = earthFixedAt(epochMs, E);
  const earthState = (t, vOut) => {
    const e = sys.bodiesAt(t).find((b) => b.key === 'earth');
    if (!e) { vOut[0] = vOut[1] = vOut[2] = 0; return [0, 0, 0]; }
    e.eph.velocity(t, vOut);
    return e.r;
  };
  const degree = E.degree ?? 20;
  if (degree >= 2) {
    const F = E.field ?? EGM2008;
    const C = [], S = [];
    for (let n = 0; n <= degree; n++) { C.push(F.C[n].slice(0, n + 1)); S.push(F.S[n].slice(0, n + 1)); }
    if (!E.withJ2) C[2][0] = 0;
    const field = geopotential({ mu: F.gm, radius: F.radius, n: degree, C, S, central: false });
    const rMax2 = (E.maxRadius ?? 20 * F.radius) ** 2;
    const g = [0, 0, 0], ef = [0, 0, 0];
    terms.push((t, r, v, out) => {
      const earth = sys.bodiesAt(t).find((b) => b.key === 'earth');
      const x = r[0] - (earth ? earth.r[0] : 0), y = r[1] - (earth ? earth.r[1] : 0), z = r[2] - (earth ? earth.r[2] : 0);
      if (x * x + y * y + z * z > rMax2) return;
      const M = fixed(t);
      ef[0] = M[0][0] * x + M[0][1] * y + M[0][2] * z;
      ef[1] = M[1][0] * x + M[1][1] * y + M[1][2] * z;
      ef[2] = M[2][0] * x + M[2][1] * y + M[2][2] * z;
      field.accel(ef, g);
      out[0] += M[0][0] * g[0] + M[1][0] * g[1] + M[2][0] * g[2];
      out[1] += M[0][1] * g[0] + M[1][1] * g[1] + M[2][1] * g[2];
      out[2] += M[0][2] * g[0] + M[1][2] * g[1] + M[2][2] * g[2];
    });
  }
  // Drag, below 2,500 km.
  const cd = craft.cd ?? 2.2;
  if (craft.area > 0 && craft.mass > 0 && cd > 0) {
    const D = craft.drag ?? {};
    const a = 6378.137, f = D.flattening ?? 1 / 298.257223563, e2 = f * (2 - f);
    // a = -rho |v| v Cd A / (2 m): with v in km/s and A in m^2, a in km/s^2
    // is that times 1e3.
    const k0 = 0.5 * cd * craft.area * 1e3;
    const vE = [0, 0, 0];
    terms.push((t, r, v, out) => {
      const rE = earthState(t, vE);
      const x = r[0] - rE[0], y = r[1] - rE[1], z = r[2] - rE[2];
      const rr = Math.sqrt(x * x + y * y + z * z);
      if (rr > 6378.137 + 2500 || !v) return;
      const M = fixed(t);
      // Geodetic latitude, longitude and height (Bowring, a few iterations).
      const ex = M[0][0] * x + M[0][1] * y + M[0][2] * z, ey = M[1][0] * x + M[1][1] * y + M[1][2] * z, ez = M[2][0] * x + M[2][1] * y + M[2][2] * z;
      const p = Math.hypot(ex, ey);
      let lat = Math.atan2(ez, p * (1 - e2)), h = 0;
      for (let k = 0; k < 4; k++) { const s = Math.sin(lat), N = a / Math.sqrt(1 - e2 * s * s); h = p / Math.cos(lat) - N; lat = Math.atan2(ez, p * (1 - e2 * N / (N + h))); }
      const ms = epochMs + t * 1000;
      const rho = density({ ms, lat: lat * 180 / Math.PI, lon: Math.atan2(ey, ex) * 180 / Math.PI, alt: h, sw: D.sw ?? null, met: D.met ?? {} });
      if (!(rho > 0)) return;
      // The air turns with the Earth about its pole of date (M's third row).
      const w = M[2], om = EARTH_ROTATION;
      const vx = v[0] - vE[0] - om * (w[1] * z - w[2] * y), vy = v[1] - vE[1] - om * (w[2] * x - w[0] * z), vz = v[2] - vE[2] - om * (w[0] * y - w[1] * x);
      const vr = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const k = -k0 * rho * vr / massAt(t);
      out[0] += k * vx; out[1] += k * vy; out[2] += k * vz;
    });
    // Low in the atmosphere drag is stiff: its time constant |v| / |a| is
    // seconds at sea level, and a longer explicit step makes the speed swing
    // instead of settle. So steps are held to a fifth of it, found at the
    // state the step starts from, and while descending below 200 km to a
    // quarter of a 7 km scale height of descent, so no step plunges from
    // thin air into thick (at 7 km/s an 8 s step falls 56 km). Never below
    // 0.01 s; in orbit neither binds.
    caps.push((t, r, v) => {
      const rE = earthState(t, vE);
      const x = r[0] - rE[0], y = r[1] - rE[1], z = r[2] - rE[2], rr = Math.sqrt(x * x + y * y + z * z);
      const alt = rr - 6371;
      if (alt > 1000 || !v) return Infinity;
      const vx = v[0] - vE[0], vy = v[1] - vE[1], vz = v[2] - vE[2], speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      let cap = Infinity;
      const descent = -(vx * x + vy * y + vz * z) / rr;
      if (alt < 200 && descent > 0) cap = 0.25 * 7 / descent;
      const rho = alt <= 86 ? density({ ms: epochMs + t * 1000, lat: 0, lon: 0, alt: Math.max(0, alt) }) : density({ ms: epochMs + t * 1000, lat: 0, lon: 0, alt, sw: D.sw ?? null });
      const decel = k0 * rho * speed * speed / massAt(t);   // km/s^2
      if (decel > 0) cap = Math.min(cap, 0.2 * speed / decel);
      return Math.max(0.01, cap);
    });
  }
  if (craft.area > 0 && craft.mass > 0 && (craft.cr ?? 1.3) > 0) {
    const k1 = (craft.cr ?? 1.3) * SOLAR_PRESSURE * craft.area / 1000;   // km/s^2 at 1 AU for 1 kg
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
