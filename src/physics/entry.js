// src/physics/entry.js
//
// Atmospheric entry of a lifting capsule (Orion, Apollo), for the kernel's
// environment (environment.js): the lift, its bank angle from a guidance
// law, and the parachutes. Pure: no DOM; runs in the kernel's Worker.
//
// The capsule flies at its trim angle of attack, so its lift is a fixed
// fraction L/D of its drag, perpendicular to the air-relative velocity.
// Banking turns the lift about that velocity: at 0 it points up (away from
// the Earth, in the plane of the radius and the velocity), at +90 degrees to
// the left (toward the orbit normal r x v). Its vertical part sets how far
// the capsule flies, its sideways part steers it; the guidance chooses the
// bank's size for range and flips its sign for crossrange, as Apollo and
// Orion do.
//
// Guidance: a numerical predictor-corrector, the scheme of Orion's skip
// entry and of FNPEG (Lu, "Entry guidance: a unified method", JGCD 37(3),
// 2014). Each guidance cycle it flies the capsule ahead with a fast 3-DOF
// model (point-mass and J2 gravity, the standard atmosphere, the Earth's
// rotation) at a constant bank size to parachute height, and solves by the
// secant method for the bank size whose landing lies at the target's
// downrange. A skip comes out of this by itself: from far enough out, only
// a lift-up pass that climbs back out of the air and falls in again reaches.
// Laterally the bank's sign reverses when the target lies more than a
// deadband to the other side of the plane of motion, the deadband
// narrowing as the capsule slows. Below a speed or height the bank is held.
//
// The parachutes add their drag below their deployment heights: the
// drogues, then the mains, to the descent rate of a splashdown.

import { standardAtmosphere } from './atmosphere.js';

const OMEGA = 7.2921158553e-5;               // rad/s
const MU = 398600.4418, J2 = 1.08262668e-3, RE = 6378.137;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };

// The lift's direction for a bank angle sigma (rad), at position r
// (geocentric) and air-relative velocity vAir.
export function liftDirection(r, vAir, sigma) {
  const vh = unit(vAir), up = sub(unit(r), vh.map((x) => x * dot(unit(r), vh)));
  const u = unit(up), left = cross(u, vh);
  const c = Math.cos(sigma), s = Math.sin(sigma);
  return [c * u[0] + s * left[0], c * u[1] + s * left[1], c * u[2] + s * left[2]];
}

// The Mach number: speed (km/s) over the speed of sound at a height (km),
// from the standard atmosphere's temperature (held at 86 km's above).
export function machAt(speedKms, altKm) {
  const T = standardAtmosphere(Math.min(86, Math.max(0, altKm))).T;
  return speedKms * 1000 / Math.sqrt(1.4 * 287.053 * T);
}

// A capsule's drag coefficient and lift-to-drag ratio at a Mach number, from
// a table aero = { mach: [...], cd: [...], ld: [...] } (ascending Mach),
// interpolated linearly and held beyond its ends.
export function aeroAt(aero, mach) {
  const m = aero.mach;
  if (mach <= m[0]) return { cd: aero.cd[0], ld: aero.ld[0] };
  if (mach >= m.at(-1)) return { cd: aero.cd.at(-1), ld: aero.ld.at(-1) };
  let i = 1;
  while (m[i] < mach) i++;
  const u = (mach - m[i - 1]) / (m[i] - m[i - 1]);
  return { cd: aero.cd[i - 1] + u * (aero.cd[i] - aero.cd[i - 1]), ld: aero.ld[i - 1] + u * (aero.ld[i] - aero.ld[i - 1]) };
}

// Air density (kg/m^3) for the guidance's prediction: the standard
// atmosphere to 86 km; above, upper(alt) if given (the kernel's own MET
// densities for the date, environment.js), else an exponential of 6.5 km
// scale height from 86 km.
export function predictDensity(altKm, upper = null) {
  if (altKm < 0) return standardAtmosphere(0).rho;
  if (altKm <= 86) return standardAtmosphere(altKm).rho;
  return upper ? upper(altKm) : 6.958e-6 * Math.exp(-(altKm - 86) / 6.5);
}

// A unit vector, Earth-fixed, to geodetic latitude and longitude (deg) on
// the WGS-84 ellipsoid (sea level).
export function earthFixedUnit(latDeg, lonDeg) {
  const f = 1 / 298.257223563, e2 = f * (2 - f), la = latDeg * Math.PI / 180, lo = lonDeg * Math.PI / 180;
  const N = RE / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return unit([N * Math.cos(la) * Math.cos(lo), N * Math.cos(la) * Math.sin(lo), N * (1 - e2) * Math.sin(la)]);
}

// The 3-DOF acceleration (km/s^2) for the prediction: gravity with J2 about
// the pole, drag and lift. cdaPerMass: Cd A / m (m^2/kg).
// Height above the WGS-84 ellipsoid, near enough for the air (km): the
// radius less the ellipsoid's at that geocentric latitude.
const FLAT = 1 / 298.257223563;
export function heightAbove(r, pole) {
  const rr = norm(r), s = dot(r, pole) / rr;
  return rr - RE * (1 - FLAT * s * s);
}

// aero (optional, aeroAt's table) with areaPerMass (m^2/kg) in place of a
// fixed ld and cdaPerMass.
function accel(r, v, pole, sigma, ld, cdaPerMass, upper, chutes, mass, out, aero = null, areaPerMass = 0, level = false) {
  const rr = norm(r), z = dot(r, pole), k = MU / rr ** 3, f = 1.5 * J2 * (RE / rr) ** 2, zz = 5 * (z / rr) ** 2;
  for (let i = 0; i < 3; i++) out[i] = -k * r[i] * (1 + f * (1 - zz)) - k * f * 2 * z * pole[i];
  const w = cross(pole, r).map((x) => x * OMEGA), vAir = sub(v, w), va = norm(vAir);
  const hgt = heightAbove(r, pole), rho = predictDensity(hgt, upper);
  if (!(rho > 0) || !(va > 0)) return out;
  if (aero) { const c = aeroAt(aero, machAt(va, hgt)); ld = c.ld; cdaPerMass = c.cd * areaPerMass; }
  const d = 0.5 * rho * va * va * cdaPerMass * 1e3;               // km/s^2
  const dc = chutes && mass ? 0.5 * rho * va * va * chuteArea(chutes, hgt) / mass * 1e3 : 0;
  // level: the lift's vertical part only (cos sigma up), none sideways.
  const L = level ? liftDirection(r, vAir, 0).map((x) => x * Math.cos(sigma)) : liftDirection(r, vAir, sigma);
  for (let i = 0; i < 3; i++) out[i] += -(d + dc) * vAir[i] / va + ld * d * L[i];
  return out;
}

// Fly the 3-DOF model from r, v (geocentric inertial km, km/s) at a constant
// bank sigma until the height hStop (km; default sea level, under the
// chutes if given), or tMax seconds. Returns { r, t, top } (top: the highest
// it went, km). Returns the
// geocentric position there and the time taken, or null if it never gets
// down (a skip out to space).
// upper: the air above 86 km, either alt -> density, or with upperAt (t,
// lat, lon) -> (alt -> density) and M0 (the J2000 -> Earth-fixed matrix at
// the start) and t0 (kernel seconds) looked up where the capsule is each
// step: a long skip spends twenty minutes in that air thousands of
// kilometres from where it started.
export function predict(r0, v0, sigma, { ld, cdaPerMass, pole, upper = null, upperAt = null, M0 = null, t0 = 0, chutes = null, mass = 0, aero = null, areaPerMass = 0, level = false, hStop = 0, tMax = 5400 }) {
  let r = [...r0], v = [...v0], t = 0, air = upper, top = 0;
  const a = [0, 0, 0];
  const f = (x, y, o) => accel(x, y, pole, sigma, ld, cdaPerMass, air, chutes, mass, o, aero, areaPerMass, level);
  while (t < tMax) {
    const alt = heightAbove(r, pole);
    top = Math.max(top, alt);
    if (upperAt && M0 && alt > 86) {
      const e = [dot(M0[0], r), dot(M0[1], r), dot(M0[2], r)], turn = OMEGA * t;
      air = upperAt(t0 + t, Math.asin(e[2] / norm(e)) * 180 / Math.PI, (Math.atan2(e[1], e[0]) - turn) * 180 / Math.PI);
    }
    if (alt < hStop) return { r, t, top };
    // Under the chutes the descent is slow and stiff: shorter steps.
    const h = alt > 130 ? 20 : alt > 95 ? 4 : chutes && alt < (chutes.drogue?.height ?? 0) + 1 ? 0.5 : 2;
    // Classical RK4.
    const s1r = v, s1v = f(r, v, [0, 0, 0]);
    const r2 = r.map((x, i) => x + 0.5 * h * s1r[i]), v2 = v.map((x, i) => x + 0.5 * h * s1v[i]);
    const s2r = v2, s2v = f(r2, v2, [0, 0, 0]);
    const r3 = r.map((x, i) => x + 0.5 * h * s2r[i]), v3 = v.map((x, i) => x + 0.5 * h * s2v[i]);
    const s3r = v3, s3v = f(r3, v3, [0, 0, 0]);
    const r4 = r.map((x, i) => x + h * s3r[i]), v4 = v.map((x, i) => x + h * s3v[i]);
    const s4r = v4, s4v = f(r4, v4, a);
    r = r.map((x, i) => x + h / 6 * (s1r[i] + 2 * s2r[i] + 2 * s3r[i] + s4r[i]));
    v = v.map((x, i) => x + h / 6 * (s1v[i] + 2 * s2v[i] + 2 * s3v[i] + s4v[i]));
    t += h;
    if (norm(r) - RE > 2000) return null;
  }
  return null;
}

// The guidance. cfg: { ld, cdaPerMass (m^2/kg, the capsule's), or aero
// (aeroAt's table) with areaPerMass (m^2/kg), upper ((t,
// lat, lon) -> alt -> density above 86 km, optional), target
// ({ lat, lon } deg geodetic), chutes and mass (kg; for the descent under
// the parachutes, chuteArea), cycle (s, default 2), hold ({ speed km/s,
// height km }: below either, the bank is held; default 0.3 and 10),
// deadband ([at 11 km/s, at 3 km/s] km, default [25, 2]), dwell (s, the
// least time between reversals, default 10), final (km/s, default 3: below,
// the sign by comparing solved landings), limits ([least, most] bank,
// rad, default 15 and 165 degrees) }.
// state: { sign, sigma, cycle, held, reversed (the last reversal's time) }
// carried between kernel requests.
// bank(t, r, v, M) with r, v geocentric inertial and M the J2000 -> Earth-
// fixed matrix at t (rows: Earth-fixed axes) returns the bank (rad, signed).
export function makeEntryGuidance(cfg, state = {}) {
  const st = { sign: state.sign ?? 1, sigma: state.sigma ?? 0.6, cycle: state.cycle ?? null, held: state.held ?? false, reversed: state.reversed ?? null };
  const T_ef = earthFixedUnit(cfg.target.lat, cfg.target.lon);
  const cyc = cfg.cycle ?? 2, hold = cfg.hold ?? { speed: 0.3, height: 10 };
  const toFixed = (M, x) => [dot(M[0], x), dot(M[1], x), dot(M[2], x)];
  const toInertial = (M, x) => [0, 1, 2].map((j) => M[0][j] * x[0] + M[1][j] * x[1] + M[2][j] * x[2]);
  return {
    state: () => ({ ...st }),
    bank(t, r, v, M) {
      const k = Math.floor(t / cyc);
      if (k === st.cycle) return st.sign * st.sigma;
      st.cycle = k;
      const pole = M[2], alt = heightAbove(r, pole), w = cross(pole, r).map((x) => x * OMEGA), va = norm(sub(v, w));
      if (st.held || va < hold.speed || alt < hold.height) { st.held = true; return st.sign * st.sigma; }
      // Range: the target's and a prediction's angle from here, the target
      // carried to inertial axes at the predicted landing time by the
      // Earth's turn meanwhile.
      const ef = toFixed(M, r), here = { lat: Math.atan2(ef[2], Math.hypot(ef[0], ef[1])) * 180 / Math.PI, lon: Math.atan2(ef[1], ef[0]) * 180 / Math.PI };
      const p0 = unit(r), opts = { ld: cfg.ld, cdaPerMass: cfg.cdaPerMass, pole, upper: cfg.upper ? cfg.upper(t, here.lat, here.lon) : null, upperAt: cfg.upper ?? null, M0: M, t0: t, chutes: cfg.chutes ?? null, mass: cfg.mass ?? 0, aero: cfg.aero ?? null, areaPerMass: cfg.areaPerMass ?? 0 };
      const turn = (x, dt) => { const a = OMEGA * dt, c = Math.cos(a), s = Math.sin(a), px = cross(pole, x), pd = dot(pole, x); return x.map((xi, i) => xi * c + px[i] * s + pole[i] * pd * (1 - c)); };
      const T0 = toInertial(M, T_ef);
      // Downrange along the great circle from here toward the target (the
      // target where the Earth will have turned it by the landing): the
      // straight angle to a landing counts its sideways distance too, which
      // a steep bank swings, so two banks could reach the same angle.
      const along = (T, L) => {
        const tan = unit(sub(T, p0.map((x) => x * dot(T, p0))));
        return Math.atan2(dot(L, tan), dot(L, p0)) - Math.atan2(dot(T, tan), dot(T, p0));
      };
      // Bank size for a sign: miss(sigma) falls as the bank grows (less lift
      // up, less range), a skip out counting as too far. Bracketed from the
      // last bank outward, then Illinois steps (regula falsi that halves a
      // stale end's value), bisecting while an end skips out; to 1e-4 rad of
      // downrange (0.6 km) or eight steps. Returns the size and how far from
      // the target it lands.
      const solve = (sign) => {
        const f = (sigma) => {
          const p = predict(r, v, sign * sigma, opts);
          if (!p || p.top > Math.max(200, alt + 20) || p.t > 2500) return Infinity;
          return along(turn(T0, p.t), unit(p.r));
        };
        let lo = Math.min(Math.max(st.sigma, 0), Math.PI), flo = f(lo), hi = lo, fhi = flo;
        if (flo > 0) { do { lo = hi; flo = fhi; hi = Math.min(Math.PI, hi + 0.15); fhi = f(hi); } while (fhi > 0 && hi < Math.PI); }
        else { do { hi = lo; fhi = flo; lo = Math.max(0, lo - 0.15); flo = f(lo); } while (flo < 0 && lo > 0); }
        let x = hi;
        if (fhi > 0) x = Math.PI;                    // overshoots even lift down
        else if (flo < 0) x = 0;                     // falls short even lift up
        else {
          let side = 0;
          for (let i = 0; i < 8; i++) {
            x = Number.isFinite(flo) ? (lo * fhi - hi * flo) / (fhi - flo) : (lo + hi) / 2;
            const fx = f(x);
            if (Math.abs(fx) < 1e-4) break;
            if (fx > 0) { lo = x; flo = fx; if (side === 1) fhi /= 2; side = 1; }
            else { hi = x; fhi = fx; if (side === -1 && Number.isFinite(flo)) flo /= 2; side = -1; }
          }
        }
        const [bmin, bmax] = cfg.limits ?? [15 * Math.PI / 180, 165 * Math.PI / 180];
        x = Math.min(bmax, Math.max(bmin, x));
        const p = predict(r, v, sign * x, opts);
        return { size: x, t: p ? p.t : 0, off: p ? Math.acos(Math.min(1, dot(unit(p.r), turn(T0, p.t)))) * RE : Infinity };
      };
      // The sign. The landing the capsule is heading for with no turn either
      // way is predicted (the lift's vertical part only), and the target's
      // distance to the side of it (positive to the left, the way a positive
      // bank turns) is the crossrange still to make up. The bank turns
      // toward the target once that exceeds a deadband narrowing with speed,
      // from 25 km at 11 km/s to 2 km at 3 km/s and below (cfg.deadband, km),
      // at most one reversal every 10 s (cfg.dwell). Comparing the landings
      // at either fixed sign instead let the sideways error build early,
      // when each such landing is far off anyway, and Artemis I ended 20 km
      // out with no lift left to fix it.
      // The sign, in two ways.
      // Fast (above cfg.final km/s, default 3): the landing the capsule is
      // heading for with no turn either way is predicted (the lift's
      // vertical part only), and the target's distance to the side of it
      // (positive to the left, the way a positive bank turns) is the
      // crossrange still to make up. The bank turns toward the target once
      // that exceeds a deadband narrowing with speed, from 25 km at 11 km/s
      // to 2 km at 3 km/s (cfg.deadband, km).
      // Slow: the landing is near and its prediction exact, so the bank's
      // size is solved for both signs and the sign whose landing comes
      // nearer the target is kept, by 0.5 km or a tenth.
      // Either way at most one reversal every 10 s (cfg.dwell). Each alone
      // left Artemis I or II 15 to 30 km out: comparing landings at a fixed
      // sign from far out let the sideways error build while each was far
      // off anyway, and the neutral landing, once near, swung from side to
      // side with every small change.
      const canReverse = !(t - (st.reversed ?? -Infinity) < (cfg.dwell ?? 10));
      let pick;
      if (va > (cfg.final ?? 3)) {
        pick = solve(st.sign);
        const level = predict(r, v, st.sigma, { ...opts, level: true });
        if (level && canReverse) {
          const T = turn(T0, level.t), L = unit(level.r), n = unit(cross(p0, L));
          const xr = Math.asin(Math.max(-1, Math.min(1, dot(n, T)))) * RE;
          const [dbHi, dbLo] = cfg.deadband ?? [25, 2], band = dbLo + (dbHi - dbLo) * Math.min(1, Math.max(0, (va - 3) / 8));
          const want = xr > 0 ? 1 : -1;
          if (Math.abs(xr) > band && want !== st.sign) { st.sign = want; st.reversed = t; pick = solve(st.sign); }
        }
      } else {
        const same = solve(st.sign), other = canReverse ? solve(-st.sign) : null;
        pick = same;
        if (other && other.off < same.off - Math.max(0.5, 0.1 * same.off)) { st.sign = -st.sign; st.reversed = t; pick = other; }
      }
      const b = pick.size;
      // (Sizes are kept within [15, 165] degrees, cfg.limits: at 0 or 180
      // the lift has no sideways part left to steer with.)
      st.sigma = b;
      return st.sign * st.sigma;
    },
  };
}

// The parachutes' drag area (Cd A, m^2) at a height (km): the drogues below
// their deployment height, then the mains below theirs (which cut the
// drogues away). Each opens over `ramp` km (default 0.3) below its height,
// as reefed chutes open in stages over a few seconds, rather than at once.
// chutes: { drogue: { height, cda }, main: { height, cda }, ramp }.
export function chuteArea(chutes, altKm) {
  if (!chutes) return 0;
  const ramp = chutes.ramp ?? 0.3;
  const open = (c, below) => Math.min(1, Math.max(0, (c.height - altKm) / ramp)) * (c.cda - below) + below;
  const d = chutes.drogue && altKm < chutes.drogue.height ? open(chutes.drogue, 0) : 0;
  if (chutes.main && altKm < chutes.main.height) return open(chutes.main, d);
  return d;
}

// The heights (km) where the chutes start to open, for the kernel's steps
// to stop at.
export function chuteHeights(chutes) {
  return chutes ? [chutes.drogue?.height, chutes.main?.height].filter(Number.isFinite) : [];
}
