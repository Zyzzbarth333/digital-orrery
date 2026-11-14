// src/physics/environment.js
//
// The forces on a spacecraft beyond the point masses and J2 the kernel
// already has (docs/physics/environment.md). Each is an acceleration on the
// craft alone, so it enters the kernel the same way in Cowell's method and
// in Encke's (as the extraAccel hook, beside the thrust). Pure ES module.
//
//   const env = makeEnvironment(sys, craft)   craft: { mass, area, cr, ... }
//   env(t, r, v, out, mid)   heliocentric J2000 r (km), v (km/s), t kernel
//                        seconds; adds km/s^2 into out. mid: the middle of
//                        the integrator's step, for anything that switches
//                        on and off (thruster puffs), as the kernel judges
//                        burns
//
// Models so far:
//   earth field  the Earth's gravity beyond J2 (EGM2008 to degree 20 by
//              default), evaluated in the Earth-fixed frame of date (IAU
//              1976/1980) and rotated back; J2 stays with the kernel's
//              zonal model
//   moon field the Moon's gravity beyond J2 (GRAIL GL0660B to degree 50 by
//              default) within ten lunar radii, in its principal-axis frame
//   drag       a = -rho |v_r| v_r Cd A / (2 m), v_r relative to an
//              atmosphere turning with the Earth about its pole of date;
//              rho from atmosphere.js (the 1976 standard below 86 km, NASA's
//              MET above 90 km with the Sun's activity for the date)
//   venting    the unmodelled pushes of a real craft (vent.js): a steady
//              sunward push and a wandering one, and thruster puffs; off
//              unless the craft has vent options
//   tides      the solid Earth tide raised by the Moon and the Sun (IERS
//              Conventions 2010, section 6.2, step 1): the Earth's degree 2
//              and 3 coefficients change by the Love numbers k_nm times the
//              tide-raising potential; on with the Earth's field
//   relativity the Schwarzschild terms of the Sun and the Earth and the
//              Earth's Lense-Thirring term (IERS Conventions 2010, eq.
//              10.12, beta = gamma = 1); on unless relativity: false
//   sunlight   solar radiation pressure on a flat-plate "cannonball":
//              a = Cr P (AU/d)^2 (A/m) s_hat * nu
//              P = 1361 W/m^2 / c at 1 AU, s_hat from the Sun to the craft,
//              nu the visible fraction of the Sun's disc (shadow()), with the
//              Earth and the Moon as occulting spheres.

import { geopotential, normFactor } from './geopotential.js';
import { earthFixedMatrix } from './earthRotation.js';
import { ttMinusUtc } from './timescale.js';
import { ttSeconds, utcMsAtTt } from './ephemeris.js';
import { EGM2008 } from './egm2008.js';
import { GRAIL, PA_TO_ME } from './grail.js';
import { bodyAxesEqj, earthFixedAxes } from './orientation.js';
import { makeVent } from './vent.js';
import { density } from './atmosphere.js';
import { makeEntryGuidance, liftDirection, chuteArea, chuteHeights, heightAbove, aeroAt, machAt } from './entry.js';

export const AU = 149597870.7;                 // km
export const EARTH_ROTATION = 7.2921158553e-5;  // rad/s, sidereal (IERS)
export const MOON_ROTATION = 2 * Math.PI / (27.321661 * 86400);   // rad/s, sidereal month
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

// The J2000 -> Earth-fixed (ITRF93) matrix at kernel time t, cheaply:
// precession, nutation, sidereal time and the day's Earth orientation
// parameters once an hour (orientation.js's earthFixedAxes, the same Earth
// the scene and the launch sites use), and the Earth's spin about its pole
// of date analytically in between (the pole moves by 3e-8 rad in an hour),
// before polar motion turns the result to the crust. opts.dut1 or
// opts.leapSeconds instead give the time offsets by hand, with no polar
// motion (NASA's check cases).
export function earthFixedAt(epochMs, opts = {}) {
  let t0 = NaN, P0 = null, W = null;
  const tt0 = ttSeconds(epochMs);
  const byHand = opts.dut1 !== undefined || opts.leapSeconds !== undefined;
  return (t) => {
    if (!(Math.abs(t - t0) < 1800)) {
      t0 = Math.round(t / 3600) * 3600;
      const ms = utcMsAtTt(tt0 + t0);
      const m = byHand
        ? earthFixedMatrix(ms, { leapSeconds: opts.leapSeconds ?? ttMinusUtc(ms) - 32.184, dut1: opts.dut1 ?? 0 })
        : earthFixedAxes(ms);
      P0 = m.pef; W = m.W;
    }
    const a = EARTH_ROTATION * (t - t0), c = Math.cos(a), s = Math.sin(a);
    // R3(a) P0: the first two rows turn about the third.
    const R = [
      [c * P0[0][0] + s * P0[1][0], c * P0[0][1] + s * P0[1][1], c * P0[0][2] + s * P0[1][2]],
      [-s * P0[0][0] + c * P0[1][0], -s * P0[0][1] + c * P0[1][1], -s * P0[0][2] + c * P0[1][2]],
      P0[2],
    ];
    if (!W) return R;
    return W.map((w) => [0, 1, 2].map((j) => w[0] * R[0][j] + w[1] * R[1][j] + w[2] * R[2][j]));
  };
}

// The solid Earth tide (IERS Conventions 2010, eq. 6.6, step 1): the changes
// in the Earth's fully normalised C_nm and S_nm, n = 2 and 3, raised by
// bodies at Earth-fixed positions ps (km) with GM ratios to the Earth's
// ratios, for a field of reference radius R:
//   dC_nm - i dS_nm = k_nm / (2n + 1) sum_j (GM_j/GM_E) (R/r_j)^(n+1)
//                     Pbar_nm(sin lat_j) exp(-i m lon_j)
// k_nm: the anelastic nominal values of IERS Table 6.3 (complex for n = 2,
// m > 0) and its elastic values for n = 3 (0.093, and 0.094 for m = 3). Returns { C, S } as [n][m] arrays.
export const LOVE = { 2: [[0.30190, 0], [0.29830, -0.00144], [0.30102, -0.00130]], 3: [[0.093, 0], [0.093, 0], [0.093, 0], [0.094, 0]] };
export function solidTide(ps, ratios, R) {
  const C = [[], [], [0, 0, 0], [0, 0, 0, 0]], S = [[], [], [0, 0, 0], [0, 0, 0, 0]];
  for (let n = 2; n <= 3; n++) {
    for (let m = 0; m <= n; m++) {
      let ar = 0, ai = 0;
      for (let j = 0; j < ps.length; j++) {
        const p = ps[j], d = Math.hypot(p[0], p[1], p[2]), x = p[2] / d, q = Math.sqrt(1 - x * x), lon = Math.atan2(p[1], p[0]);
        const P = n === 2 ? [(3 * x * x - 1) / 2, 3 * x * q, 3 * q * q][m] : [(5 * x * x * x - 3 * x) / 2, 1.5 * (5 * x * x - 1) * q, 15 * x * q * q, 15 * q * q * q][m];
        const f = ratios[j] * (R / d) ** (n + 1) * P * normFactor(n, m);
        ar += f * Math.cos(m * lon); ai -= f * Math.sin(m * lon);
      }
      const [kr, ki] = LOVE[n][m];
      C[n][m] = (kr * ar - ki * ai) / (2 * n + 1);
      S[n][m] = -(kr * ai + ki * ar) / (2 * n + 1);
    }
  }
  return { C, S };
}

// The Earth's spin angular momentum per unit mass, for the Lense-Thirring
// term: 9.8e8 m^2/s (IERS Conventions 2010, section 10.3), in km^2/s.
export const EARTH_SPIN_J = 980;

// Schwarzschild: a = mu / (c^2 r^3) [ (4 mu / r - v^2) r + 4 (r.v) v ] for r
// and v relative to the body (IERS 2010 eq. 10.12, beta = gamma = 1). Adds
// into out.
export function schwarzschild(mu, x, y, z, vx, vy, vz, out) {
  const r2 = x * x + y * y + z * z, r = Math.sqrt(r2), c2 = LIGHT * LIGHT;
  const k = mu / (c2 * r2 * r), a = 4 * mu / r - (vx * vx + vy * vy + vz * vz), b = 4 * (x * vx + y * vy + z * vz);
  out[0] += k * (a * x + b * vx); out[1] += k * (a * y + b * vy); out[2] += k * (a * z + b * vz);
}

// craft: { mass (kg), area (m^2, facing the Sun), cr (1 absorbing to 2
// mirror; 1.3 typical), shadowBodies (keys; default Earth and Moon),
// massAt(t) (optional: the mass at time t, as a burn sheds propellant),
// earth: { degree (default 20; 0 for none), field (default EGM2008: { gm,
// radius, C, S }), withJ2 (default false: the kernel's zonal model has it),
// maxRadius (km; beyond, the harmonics are left out: default 20 Earth
// radii), dut1, leapSeconds (the Earth rotation's time offsets), tides
// (default true when degree >= 2) },
// relativity (default true; it needs the Sun's GM, sys.muSun, and the
// Earth among the bodies),
// moon: { degree (default 50; 0 for none), field (default GRAIL), withJ2,
// maxRadius (km, default 10 lunar radii) },
// vent: vent.js options ({} for Artemis II's calibration; absent for none),
// epochMs (kernel time zero, default the kernel's),
// cd (drag coefficient, default 2.2; 0 for no drag), drag: { sw (the Sun's
// activity, default the date's), flattening (for geodetic height, default
// WGS-84's), met (MET options) },
// entry: a lifting capsule (entry.js): { ld (lift-to-drag ratio), or aero
// (Mach tables { mach, cd, ld }, overriding cd and ld), target
// ({ lat, lon } deg, for the guidance's bank angle), bank (rad: held, not
// guided, for checks), chutes ({ drogue,
// main }: { height km, cda m^2 }), cycle, hold, deadband, state (the
// guidance's, carried between requests) } }
export function makeEnvironment(sys, craft = {}) {
  const terms = [], caps = [], edges = [];
  let entryState = null, upperAirFn = null;
  const epochMs = craft.epochMs ?? Date.UTC(2000, 0, 1, 12);
  // Kernel time is TT seconds from epochMs (kernelHost.kernelSeconds).
  const tt0 = ttSeconds(epochMs), msAt = (t) => utcMsAtTt(tt0 + t);
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
  // The solid Earth tide raised by the Moon and the Sun, within the field's
  // reach: a degree 3 field whose coefficients follow the two bodies.
  if (E.tides ?? degree >= 2) {
    const F = E.field ?? EGM2008, R = F.radius;
    const zero = [[0], [0, 0], [0, 0, 0], [0, 0, 0, 0]];
    const tide = geopotential({ mu: F.gm, radius: R, n: 3, C: zero, S: zero, central: false });
    const rMax2 = (E.maxRadius ?? 20 * R) ** 2;
    const g = [0, 0, 0], ef = [0, 0, 0], pm = [0, 0, 0], ps = [0, 0, 0];
    let tSet = NaN;
    terms.push((t, r, v, out) => {
      const bodies = sys.bodiesAt(t);
      const earth = bodies.find((b) => b.key === 'earth'), moon = bodies.find((b) => b.key === 'moon');
      if (!earth || !moon) return;
      const x = r[0] - earth.r[0], y = r[1] - earth.r[1], z = r[2] - earth.r[2];
      if (x * x + y * y + z * z > rMax2) return;
      const M = fixed(t);
      if (t !== tSet) {
        // The Moon and the Sun (at the origin) in Earth-fixed axes.
        for (let i = 0; i < 3; i++) {
          pm[i] = M[i][0] * (moon.r[0] - earth.r[0]) + M[i][1] * (moon.r[1] - earth.r[1]) + M[i][2] * (moon.r[2] - earth.r[2]);
          ps[i] = -(M[i][0] * earth.r[0] + M[i][1] * earth.r[1] + M[i][2] * earth.r[2]);
        }
        const d = solidTide([pm, ps], [moon.mu / earth.mu, sys.muSun / earth.mu], R);
        for (let n = 2; n <= 3; n++) for (let m = 0; m <= n; m++) tide.set(n, m, d.C[n][m], d.S[n][m]);
        tSet = t;
      }
      ef[0] = M[0][0] * x + M[0][1] * y + M[0][2] * z;
      ef[1] = M[1][0] * x + M[1][1] * y + M[1][2] * z;
      ef[2] = M[2][0] * x + M[2][1] * y + M[2][2] * z;
      tide.accel(ef, g);
      out[0] += M[0][0] * g[0] + M[1][0] * g[1] + M[2][0] * g[2];
      out[1] += M[0][1] * g[0] + M[1][1] * g[1] + M[2][1] * g[2];
      out[2] += M[0][2] * g[0] + M[1][2] * g[1] + M[2][2] * g[2];
    });
  }

  // Relativity: the Sun's Schwarzschild term (heliocentric r and v), and the
  // Earth's Schwarzschild and Lense-Thirring terms within 1.5 million km
  // (geocentric r and v; J along the Earth's pole of date).
  if (craft.relativity ?? true) {
    const vE = [0, 0, 0], c2 = LIGHT * LIGHT;
    terms.push((t, r, v, out) => {
      if (!v) return;
      if (sys.muSun > 0) schwarzschild(sys.muSun, r[0], r[1], r[2], v[0], v[1], v[2], out);
      const earth = sys.bodiesAt(t).find((b) => b.key === 'earth');
      if (!earth) return;
      const x = r[0] - earth.r[0], y = r[1] - earth.r[1], z = r[2] - earth.r[2], r2 = x * x + y * y + z * z;
      if (r2 > 1.5e6 * 1.5e6) return;
      earth.eph.velocity(t, vE);
      const vx = v[0] - vE[0], vy = v[1] - vE[1], vz = v[2] - vE[2];
      schwarzschild(earth.mu, x, y, z, vx, vy, vz, out);
      // Lense-Thirring: 2 mu / (c^2 r^3) [ 3/r^2 (r x v)(r . J) + v x J ].
      const w = fixed(t)[2], Jx = EARTH_SPIN_J * w[0], Jy = EARTH_SPIN_J * w[1], Jz = EARTH_SPIN_J * w[2];
      const rr = Math.sqrt(r2), k = 2 * earth.mu / (c2 * r2 * rr), rJ = 3 * (x * Jx + y * Jy + z * Jz) / r2;
      out[0] += k * (rJ * (y * vz - z * vy) + (vy * Jz - vz * Jy));
      out[1] += k * (rJ * (z * vx - x * vz) + (vz * Jx - vx * Jz));
      out[2] += k * (rJ * (x * vy - y * vx) + (vx * Jy - vy * Jx));
    });
  }

  // The Moon's field beyond J2, near the Moon: GRAIL GL0660B in the Moon's
  // principal-axis frame. The app orients the Moon in its mean-Earth frame
  // (orientation.js); PA_TO_ME (grail.js) turns one into the other.
  const Mo = craft.moon ?? {};
  const mDegree = Mo.degree ?? 50;
  if (mDegree >= 2) {
    const F = Mo.field ?? GRAIL;
    const C = [], S = [];
    for (let n = 0; n <= mDegree; n++) { C.push(F.C[n].slice(0, n + 1)); S.push(F.S[n].slice(0, n + 1)); }
    if (!Mo.withJ2) C[2][0] = 0;
    const field = geopotential({ mu: F.gm, radius: F.radius, n: mDegree, C, S, central: false });
    const rMax2 = (Mo.maxRadius ?? 10 * F.radius) ** 2;
    // J2000 -> principal axes: the mean-Earth axes every ten minutes, the
    // Moon's slow spin about its pole in between.
    let t0 = NaN, M0 = null;
    const paAt = (t) => {
      if (!(Math.abs(t - t0) < 300)) {
        t0 = Math.round(t / 600) * 600;
        const A = bodyAxesEqj('moon', new Date(msAt(t0)));   // rows: the ME axes in J2000
        M0 = [0, 1, 2].map((i) => [0, 1, 2].map((j) => PA_TO_ME[0][i] * A[0][j] + PA_TO_ME[1][i] * A[1][j] + PA_TO_ME[2][i] * A[2][j]));
      }
      const a = MOON_ROTATION * (t - t0), c = Math.cos(a), s = Math.sin(a);
      return [
        [c * M0[0][0] + s * M0[1][0], c * M0[0][1] + s * M0[1][1], c * M0[0][2] + s * M0[1][2]],
        [-s * M0[0][0] + c * M0[1][0], -s * M0[0][1] + c * M0[1][1], -s * M0[0][2] + c * M0[1][2]],
        M0[2],
      ];
    };
    const g = [0, 0, 0], pf = [0, 0, 0];
    terms.push((t, r, v, out) => {
      const moon = sys.bodiesAt(t).find((b) => b.key === 'moon');
      if (!moon) return;
      const x = r[0] - moon.r[0], y = r[1] - moon.r[1], z = r[2] - moon.r[2];
      if (x * x + y * y + z * z > rMax2) return;
      const M = paAt(t);
      pf[0] = M[0][0] * x + M[0][1] * y + M[0][2] * z;
      pf[1] = M[1][0] * x + M[1][1] * y + M[1][2] * z;
      pf[2] = M[2][0] * x + M[2][1] * y + M[2][2] * z;
      field.accel(pf, g);
      out[0] += M[0][0] * g[0] + M[1][0] * g[1] + M[2][0] * g[2];
      out[1] += M[0][1] * g[0] + M[1][1] * g[1] + M[2][1] * g[2];
      out[2] += M[0][2] * g[0] + M[1][2] * g[1] + M[2][2] * g[2];
    });
  }

  // Venting and thruster puffs (m/s^2 -> km/s^2).
  if (craft.vent) {
    const vent = makeVent(craft.vent), a = [0, 0, 0], sd = [0, 0, 0];
    terms.push((t, r, v, out, mid) => {
      const d = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
      sd[0] = -r[0] / d; sd[1] = -r[1] / d; sd[2] = -r[2] / d;
      a[0] = a[1] = a[2] = 0;
      vent(t, sd, a, mid ?? t);
      out[0] += a[0] / 1000; out[1] += a[1] / 1000; out[2] += a[2] / 1000;
    });
    if (vent.stepCap) caps.push((t) => vent.stepCap(t));
    // A puff's edges are breakpoints: the integrator carries a step's end
    // acceleration into the next step, and recomputes it only on landing
    // on one, as for a burn.
    edges.push((a, b) => vent.puffsIn(a - 2, b + 2).flatMap((p) => [p.t0, p.t1]).filter((x) => x > a && x < b));
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
    // The guidance's upper air (entry.js): this model's density above 86 km
    // where the capsule is, every ten minutes and five degrees, interpolated
    // log-linearly, so its predictions see the air the kernel flies through
    // (MET's air at 100-120 km doubles between night and day; taken at noon
    // on the equator, a 28-minute skip landed 12 km off).
    const upperDays = new Map();
    const upperAir = (t, latDeg = 0, lonDeg = 0) => {
      const slot = Math.floor(msAt(t) / 600e3), la = Math.round(latDeg / 5) * 5, lo = Math.round(lonDeg / 5) * 5, key = `${slot}|${la}|${lo}`;
      let f = upperDays.get(key);
      if (!f) {
        const ms = slot * 600e3 + 300e3, nodes = [];
        for (let h = 86; h <= 400; h += h < 150 ? 4 : 25) nodes.push([h, Math.log(density({ ms, lat: la, lon: lo, alt: h, sw: D.sw ?? null }))]);
        f = (h) => {
          let i = 1;
          while (i < nodes.length - 1 && nodes[i][0] < h) i++;
          const [h0, l0] = nodes[i - 1], [h1, l1] = nodes[i];
          return Math.exp(l0 + (l1 - l0) * (h - h0) / (h1 - h0));
        };
        if (upperDays.size > 64) upperDays.clear();
        upperDays.set(key, f);
      }
      return f;
    };
    upperAirFn = upperAir;
    // A lifting capsule: its lift, banked by the guidance, and its chutes.
    const EN = craft.entry ?? null;
    // bank (rad): held at that instead of guided (for checks).
    // aero: Mach tables of Cd and L/D (entry.js aeroAt) in place of cd and ld.
    const lifts = EN && (EN.ld > 0 || EN.aero);
    const guide = lifts && Number.isFinite(EN.bank) ? { bank: () => EN.bank, state: () => null }
      : lifts && EN.target ? makeEntryGuidance({ ...EN, cdaPerMass: cd * craft.area / craft.mass, areaPerMass: craft.area / craft.mass, mass: craft.mass, upper: upperAir }, EN.state ?? {}) : null;
    if (guide && EN.target && !Number.isFinite(EN.bank)) entryState = () => guide.state();
    terms.push((t, r, v, out, mid = t) => {
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
      const ms = msAt(t);
      const rho = density({ ms, lat: lat * 180 / Math.PI, lon: Math.atan2(ey, ex) * 180 / Math.PI, alt: h, sw: D.sw ?? null, met: D.met ?? {} });
      if (!(rho > 0)) return;
      // The air turns with the Earth about its pole of date (M's third row).
      const w = M[2], om = EARTH_ROTATION;
      const vx = v[0] - vE[0] - om * (w[1] * z - w[2] * y), vy = v[1] - vE[1] - om * (w[2] * x - w[0] * z), vz = v[2] - vE[2] - om * (w[0] * y - w[1] * x);
      const vr = Math.sqrt(vx * vx + vy * vy + vz * vz);
      const m = massAt(t);
      // A capsule with Mach tables: its drag coefficient and L/D here.
      const c = EN?.aero ? aeroAt(EN.aero, machAt(vr, h)) : null;
      const k = -(c ? 0.5 * c.cd * craft.area * 1e3 : k0) * rho * vr / m;
      out[0] += k * vx; out[1] += k * vy; out[2] += k * vz;
      if (!EN) return;
      const kc = -0.5 * chuteArea(EN.chutes, h) * 1e3 * rho * vr / m;
      if (kc) { out[0] += kc * vx; out[1] += kc * vy; out[2] += kc * vz; }
      if (!guide || !(vr > 0)) return;
      // Lift: L/D times the capsule's drag, across the air-relative velocity.
      const rel = [x, y, z], vAir = [vx, vy, vz];
      const L = liftDirection(rel, vAir, guide.bank(mid, rel, [v[0] - vE[0], v[1] - vE[1], v[2] - vE[2]], M));
      const lift = -k * vr * (c ? c.ld : EN.ld);
      out[0] += lift * L[0]; out[1] += lift * L[1]; out[2] += lift * L[2];
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
      const vx = v[0] - vE[0], vy = v[1] - vE[1], vz = v[2] - vE[2];
      let cap = Infinity;
      const descent = -(vx * x + vy * y + vz * z) / rr;
      // The drag's time constant is the air speed's over its deceleration:
      // relative to the turning air, not to the Earth's centre (a capsule
      // falling under its chutes moves at the ground's 0.4 km/s).
      const pole = fixed(t)[2], om = EARTH_ROTATION;
      const ax = vx - om * (pole[1] * z - pole[2] * y), ay = vy - om * (pole[2] * x - pole[0] * z), az = vz - om * (pole[0] * y - pole[1] * x);
      const speed = Math.sqrt(ax * ax + ay * ay + az * az);
      if (alt < 200 && descent > 0) cap = 0.25 * 7 / descent;
      const ms = msAt(t), rho = alt <= 86 ? density({ ms, lat: 0, lon: 0, alt: Math.max(0, alt) }) : density({ ms, lat: 0, lon: 0, alt, sw: D.sw ?? null });
      // The chutes open by height above the ellipsoid (the mean radius is up
      // to 7 km off it): left out here, the steps under the mains were
      // twenty times their drag's time constant, and the descent blew up.
      // Taken as they will be a ramp's height lower, so a step that starts
      // as a chute begins to open is already short.
      const CH = craft.entry?.chutes;
      const chutes = CH ? chuteArea(CH, heightAbove([x, y, z], pole) - (CH.ramp ?? 0.3)) : 0;
      const decel = (k0 + 0.5 * chutes * 1e3) * rho * speed * speed / massAt(t);   // km/s^2
      if (decel > 0) cap = Math.min(cap, 0.2 * speed / decel);
      // No step falls far past a chute's opening height: past it the drag
      // grows a hundredfold in seconds.
      if (CH && descent > 0) {
        const hh = heightAbove([x, y, z], pole);
        for (const hd of chuteHeights(CH)) if (hh > hd) cap = Math.min(cap, (hh - hd) / descent + 0.05);
      }
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
  const env = (t, r, v, out, mid = t) => { for (const f of terms) f(t, r, v, out, mid); return out; };
  env.stepCap = caps.length ? (t, r, v) => { let c = Infinity; for (const f of caps) c = Math.min(c, f(t, r, v)); return c; } : null;
  // Times between a and b (kernel seconds) a step must end on: where a
  // force switches (thruster puffs).
  env.breakpoints = (a, b) => edges.flatMap((f) => f(a, b)).sort((x, y) => x - y);
  // What a term keeps between kernel requests (the entry guidance's bank).
  env.state = () => (entryState ? { entry: entryState() } : null);
  env.upperAir = upperAirFn;
  return env;
}
