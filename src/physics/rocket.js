// src/physics/rocket.js
//
// Launch vehicles: a stack of stages, its performance, the lightest stack
// for a job, and a gravity-turn ascent from a pad into the app's kernel
// (docs/physics/rocket.md). After Curtis, Orbital Mechanics for Engineering
// Students (4th ed.), chapter 13. Pure ES module, SI units unless named.
//
// A stage: { name, dry (kg, empty mass: structure, engines, tanks),
//            prop (kg), isp (s, vacuum), ispSl (s, sea level; default isp),
//            thrust (N, vacuum) }
// A stack: stages bottom first (the first burns first), and a payload (kg).

import { density, standardAtmosphere } from './atmosphere.js';

export const G0 = 9.80665;           // m/s^2, standard gravity (defines Isp)

// Each stage's mass at ignition and burnout, its delta-v (vacuum Isp), burn
// time and thrust-to-weight at ignition, bottom stage first; the stack's
// total delta-v and liftoff mass.
export function stackPerformance(stages, payload, { g0 = G0 } = {}) {
  const out = [];
  let above = payload;
  for (let i = stages.length - 1; i >= 0; i--) above += stages[i].dry + stages[i].prop;
  let m0 = above;
  for (const s of stages) {
    const mf = m0 - s.prop, c = s.isp * g0, mdot = s.thrust / c;
    out.push({ name: s.name, m0, mf, dv: c * Math.log(m0 / mf), burn: s.prop / mdot, twr: s.thrust / (m0 * g0), mdot, eps: s.dry / (s.dry + s.prop) });
    m0 = mf - s.dry;                 // the spent stage drops away
  }
  return { stages: out, dv: out.reduce((a, s) => a + s.dv, 0), liftoff: out[0]?.m0 ?? payload, payload };
}

// The lightest N-stage stack that gives a payload the burnout speed dv
// (m/s), for given exhaust speeds c_i = Isp_i g0 and structural ratios
// eps_i = empty / (empty + propellant): Curtis section 13.6. The Lagrange
// multiplier eta solves
//   sum_i c_i ln((c_i eta - 1) / (c_i eps_i eta)) = dv           (13.84)
// and then each stage's mass ratio is n_i = (c_i eta - 1) / (c_i eps_i eta)
// (13.83); stage masses follow from the top down (13.75):
//   m_i = (n_i - 1) / (1 - n_i eps_i) (everything above it).
// stages: [{ isp, eps }] bottom first. Returns null when no stack can do it
// (dv beyond what the exhaust speeds and structure allow).
export function optimalStaging({ dv, payload, stages, g0 = G0 }) {
  const c = stages.map((s) => s.isp * g0), eps = stages.map((s) => s.eps);
  const f = (eta) => c.reduce((a, ci, i) => a + ci * Math.log((ci * eta - 1) / (ci * eps[i] * eta)), 0) - dv;
  // Every log needs eta > 1/c_i. Just above 1/c_min, f is -infinity; as eta
  // grows f rises towards sum c_i ln(1/eps_i) - dv, the most a stack of these
  // stages can give however large, so a root exists only below that.
  let lo = 1 / Math.min(...c) * (1 + 1e-12), hi = lo * 2;
  const limit = c.reduce((a, ci, i) => a + ci * Math.log(1 / eps[i]), 0);
  if (!(dv < limit)) return null;
  while (f(hi) < 0) hi *= 2;
  for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
  const eta = (lo + hi) / 2;
  const n = c.map((ci, i) => (ci * eta - 1) / (ci * eps[i] * eta));
  if (n.some((x, i) => !(x > 1) || !(x * eps[i] < 1))) return null;
  const step = new Array(stages.length);
  let above = payload;
  for (let i = stages.length - 1; i >= 0; i--) { step[i] = (n[i] - 1) / (1 - n[i] * eps[i]) * above; above += step[i]; }
  const empty = step.map((m, i) => eps[i] * m), prop = step.map((m, i) => m - empty[i]);
  // Second-order check that this is a minimum (13.93): every term positive.
  const minimum = c.every((ci, i) => eta * ci * (eps[i] * n[i] - 1) ** 2 + 2 * eps[i] * n[i] - 1 > 0);
  return { eta, n, step, empty, prop, m0: above, payloadFraction: payload / above, minimum, limit };
}

// The speed a circular orbit at altitude h (m) needs (m/s), and the Earth's
// rotation that a launch along azimuth az (deg from north) at latitude lat
// gets for free.
export const EARTH = { mu: 3.986004418e14, R: 6378137, omega: 7.292115e-5 };
export const circularSpeed = (h, mu = EARTH.mu, R = EARTH.R) => Math.sqrt(mu / (R + h));
export const rotationBonus = (latDeg, azDeg) => EARTH.omega * EARTH.R * Math.cos(latDeg * Math.PI / 180) * Math.sin(azDeg * Math.PI / 180);
// The launch azimuth (deg from north) for an orbit of inclination incDeg
// from latitude latDeg, ascending: sin az = cos i / cos lat (inertial; the
// Earth's rotation shifts it by a fraction of a degree). null when the
// inclination is below the latitude.
export function launchAzimuth(incDeg, latDeg) {
  const s = Math.cos(incDeg * Math.PI / 180) / Math.cos(latDeg * Math.PI / 180);
  return Math.abs(s) <= 1 ? Math.asin(s) * 180 / Math.PI : null;
}

// Atmospheres for the ascent: density (kg/m^3) and pressure ratio p/p0 at
// altitude h (m). Curtis's exponential model (rho0 1.225 kg/m^3, scale
// height 7.5 km) is the default; realAtmosphere is the app's (the 1976
// standard to 86 km, NASA's MET above 90 km for the date and the pad's
// place, atmosphere.js), with the 1976 standard's pressure.
export const exponentialAtmosphere = (rho0 = 1.225, H = 7500) => (h) => {
  const e = Math.exp(-Math.max(0, h) / H);
  return { rho: rho0 * e, p: e };
};
export const realAtmosphere = ({ ms, lat, lon }) => (h) => {
  const z = Math.max(0, h) / 1000;
  return { rho: density({ ms, lat, lon, alt: z }), p: z < 86 ? standardAtmosphere(z).p / 101325 : 0 };
};

// A gravity-turn ascent in the plane of the launch (Curtis 13.2): the
// vehicle rises vertically to pitchAlt, is kicked to flight-path angle
// gamma0, and from then on thrusts along its velocity relative to the air.
// Integrated as planar motion about the Earth's centre (RK4, step dt), so it
// holds the curvature terms of Curtis's (13.6)-(13.8) exactly.
//
// opts:
//   stages, payload             the stack (bottom first)
//   pitchAlt (m), gamma0 (deg)  pitchover
//   cd, diameter (m)            drag: D = rho v^2 cd (pi d^2 / 4) / 2
//   atmosphere(h) -> { rho, p } (default exponential)
//   rotation (m/s)              the atmosphere's (and pad's) speed along the
//                               launch plane at the surface: 0 for Curtis's
//                               non-rotating Earth; rotationBonus() for a pad
//   g0, R, mu                   gravity: g = g0 / (1 + h/R)^2 when mu is not
//                               given (Curtis 1.36), else mu / r^2
//   coast (s)                   seconds to fly on after the last burnout
//   toOrbit                     cut the engine once the speed reaches the
//                               circular speed for the height (after the
//                               pitchover): the upper stage keeps what
//                               propellant is left (returned as remaining)
//   dt (s), sample (s)          step, and the interval of the time history
//   cdAt(mach, t, burning)      drag coefficient instead of cd: as a
//                               function of Mach (and time, and whether an
//                               engine burns: base drag differs then)
//   area (m^2)                  reference area for drag, in place of the
//                               diameter's
//   sound(h) -> m/s             speed of sound for cdAt's Mach number
//                               (default the 1976 standard's)
//   vertical                    no pitchover: straight up, as a sounding or
//                               model rocket flies
//   wind (m/s)                  a steady wind blowing back along the plane
//   weathercock                 at pitchAlt (the top of a launch rod) no
//                               kick: from there it flies along its velocity
//                               through the air, turning into the wind
//   turnLag (s)                 after pitchAlt the thrust follows the
//                               velocity through the air with this lag
//                               (default 0: at once)
//   stopAtApogee                end at the top of the climb
// A stage may give thrustCurve: [[t (s from ignition), F (N)], ...] in place
// of a constant thrust; its propellant then burns in proportion to the
// impulse delivered (as motor makers' curves assume), and it burns out at
// the curve's end. The rocket sits on the pad until the thrust outweighs it.
// Returns { history: [{ t, h, v, gamma, x, q, m, stage }], burnout (the end
// state: t, h, v (inertial), gamma, x, r, theta, vr, vt), losses: { gravity,
// drag } (m/s), maxQ: { q, t, h, v }, events: [...] }.
export function ascent(opts) {
  const { stages, payload, gamma0 = 89.85, cd = 0.5, diameter = 5, rotation = 0, coast = 0, dt = 0.05, sample = 1, toOrbit = false, cdAt = null, stopAtApogee = false, wind = 0, weathercock = false, turnLag = 0 } = opts;
  const pitchAlt = opts.vertical ? Infinity : (opts.pitchAlt ?? 130);
  const atm = opts.atmosphere ?? exponentialAtmosphere();
  const g0 = opts.g0 ?? G0, R = opts.R ?? EARTH.R;
  const grav = opts.mu ? (r) => opts.mu / (r * r) : (r) => g0 / ((r / R) ** 2);
  const area = opts.area ?? Math.PI * diameter * diameter / 4;
  // Thrust curves: the time, force and impulse delivered at each point.
  const curves = stages.map((S) => {
    if (!S.thrustCurve) return null;
    const ts = S.thrustCurve.map((p) => p[0]), fs = S.thrustCurve.map((p) => p[1]), imp = [0];
    for (let i = 1; i < ts.length; i++) imp.push(imp[i - 1] + 0.5 * (fs[i] + fs[i - 1]) * (ts[i] - ts[i - 1]));
    return { ts, fs, imp, total: imp.at(-1), end: ts.at(-1) };   // total may be 0: then it burns nothing
  });
  const at = (c, tau) => {
    if (!(tau >= c.ts[0]) || tau >= c.end) return { F: 0, I: tau >= c.end ? c.total : 0 };
    let i = 1;
    while (c.ts[i] < tau) i++;
    const u = (tau - c.ts[i - 1]) / (c.ts[i] - c.ts[i - 1]), F = c.fs[i - 1] + u * (c.fs[i] - c.fs[i - 1]);
    return { F, I: c.imp[i - 1] + 0.5 * (c.fs[i - 1] + F) * (tau - c.ts[i - 1]) };
  };
  // The speed of sound (m/s) at a height (m), for cdAt's Mach number: the
  // 1976 standard's unless given.
  const sound = opts.sound ?? ((h) => Math.sqrt(1.4 * 287.053 * standardAtmosphere(Math.min(86, Math.max(0, h / 1000))).T));
  const ispG0 = opts.ispG0 ?? g0;           // g0 that turns Isp into exhaust speed
  // State: x (horizontal, along the plane at the pad), y (up from the
  // Earth's centre), vx, vy: inertial, in the launch plane.
  let x = 0, y = R, vx = rotation, vy = 0, t = 0;
  const masses = []; { let m = payload; for (let i = stages.length - 1; i >= 0; i--) { m += stages[i].dry + stages[i].prop; masses[i] = m; } }
  let stage = 0, m = masses[0], burnt = 0, pitched = false, lossG = 0, lossD = 0, tIgn = 0, lifted = false;
  // With a turnLag (s), the thrust's direction follows the velocity through
  // the air with that first-order lag, as a stable rocket's axis does,
  // rather than at once.
  let axX = 0, axY = 1;
  const history = [], events = [];
  let maxQ = { q: 0, t: 0, h: 0, v: 0 };
  let cutoff = null;
  const sky = (px, py) => { const r = Math.hypot(px, py); return { r, ux: px / r, uy: py / r }; };
  // Air velocity at (px, py): the surface's rotation along the plane,
  // growing with radius as rigid rotation does, and the wind, blowing back
  // along the plane (a rocket that turns into it flies downrange).
  const air = (px, py) => { const { r, ux, uy } = sky(px, py); const s = rotation * r / R - wind; return [s * uy, -s * ux]; };
  const deriv = (px, py, pvx, pvy, mm, st, steer, tt = t) => {
    const { r, ux, uy } = sky(px, py);
    const h = r - R, a = atm(h), [ax, ay] = air(px, py);
    const rx = pvx - ax, ry = pvy - ay, vrel = Math.hypot(rx, ry);
    const g = grav(r);
    let fx = -g * ux, fy = -g * uy, T = 0;
    const S = stages[st];
    if (S && st === stage) {
      // Isp, and so thrust at a fixed flow, falls with the outside
      // pressure: Isp_vac + (Isp_sl - Isp_vac) p/p0. A thrust curve is the
      // thrust as measured.
      if (curves[st]) T = at(curves[st], tt - tIgn).F;
      else {
        const isp = S.isp + ((S.ispSl ?? S.isp) - S.isp) * a.p;
        const mdot = S.thrust / (S.isp * ispG0);
        T = mdot * isp * ispG0;
      }
      // Direction: vertical before pitchover (or at rest), else along the
      // air-relative velocity.
      let dx = ux, dy = uy;
      if (steer && turnLag > 0) { dx = axX; dy = axY; } else if (steer && vrel > 1e-6) { dx = rx / vrel; dy = ry / vrel; }
      fx += T / mm * dx; fy += T / mm * dy;
    }
    const cdNow = cdAt ? cdAt(vrel / sound(h), tt, T > 0) : cd;
    const D = 0.5 * a.rho * vrel * vrel * cdNow * area;
    if (vrel > 0 && mm > 0) { fx -= D / mm * rx / vrel; fy -= D / mm * ry / vrel; }
    return { fx, fy, D, g, ux, uy, h, q: 0.5 * a.rho * vrel * vrel, vrel };
  };
  const record = (d) => {
    const { r, ux, uy } = sky(x, y);
    const vr = vx * ux + vy * uy, vt = vx * uy - vy * ux, v = Math.hypot(vx, vy);
    history.push({ t, h: r - R, v, gamma: Math.atan2(vr, vt) * 180 / Math.PI, x: R * Math.atan2(x, y), q: d.q, m, stage });
  };
  let nextSample = 0, end = Infinity;
  for (let k = 0; k < 2e7; k++) {
    const S = stages[stage], C = S ? curves[stage] : null;
    const mdot = S && !C ? S.thrust / (S.isp * ispG0) : 0;
    // Propellant burnt by time tau from ignition (a curve: in proportion to
    // the impulse delivered).
    const used = (tau) => (C ? (C.total > 0 ? S.prop * at(C, tau).I / C.total : 0) : burnt + mdot * (tau - (t - tIgn)));
    let h_ = dt;
    if (S) h_ = Math.min(h_, C ? Math.max(1e-6, C.end - (t - tIgn)) : (S.prop - burnt) / mdot);
    if (!S && Number.isFinite(end)) h_ = Math.min(h_, end - t);
    // Land the pitchover on its height exactly: the result is very
    // sensitive to it (a fixed 0.01 s step overshoots 130 m by up to 0.4 m
    // and moves the burnout flight-path angle by 0.1 deg).
    if (!pitched && t > 0) {
      const r0 = Math.hypot(x, y), climb = (vx * x + vy * y) / r0;
      if (climb > 0) h_ = Math.min(h_, Math.max(1e-6, (R + pitchAlt - r0) / climb));
    }
    const steer = pitched;
    const st = S ? stage : -1;
    const f = (px, py, pvx, pvy, mm, tt) => deriv(px, py, pvx, pvy, mm, st, steer, tt);
    const d1 = f(x, y, vx, vy, m, t);
    if (t >= nextSample) { record(d1); nextSample += sample; }
    if (d1.q > maxQ.q) maxQ = { q: d1.q, t, h: d1.h, v: d1.vrel };
    const mStart = S ? m + used(t - tIgn) : m;           // the stage's mass at ignition, plus what is above
    const m2 = S ? mStart - used(t - tIgn + h_ / 2) : m, m3 = S ? mStart - used(t - tIgn + h_) : m;
    const d2 = f(x + vx * h_ / 2, y + vy * h_ / 2, vx + d1.fx * h_ / 2, vy + d1.fy * h_ / 2, m2, t + h_ / 2);
    const d3 = f(x + (vx + d1.fx * h_ / 2) * h_ / 2, y + (vy + d1.fy * h_ / 2) * h_ / 2, vx + d2.fx * h_ / 2, vy + d2.fy * h_ / 2, m2, t + h_ / 2);
    const d4 = f(x + (vx + d2.fx * h_ / 2) * h_, y + (vy + d2.fy * h_ / 2) * h_, vx + d3.fx * h_, vy + d3.fy * h_, m3, t + h_);
    // Losses (Curtis 13.27): gravity along the path, and drag.
    const sinG = (vx * d1.ux + vy * d1.uy) / Math.max(1e-9, Math.hypot(vx, vy));
    if (S) { lossG += h_ * (d1.g * sinG); lossD += h_ * d1.D / m; }
    // It sits on the pad until the thrust outweighs it (a motor's thrust
    // builds from nothing over the first moments), as OpenRocket and
    // RocketPy hold it.
    if (!lifted) lifted = d1.fx * d1.ux + d1.fy * d1.uy > 0;
    if (lifted) {
      // RK4 for (position, velocity): x + h v + h^2 (a1 + a2 + a3) / 6.
      x += h_ * (vx + (h_ / 6) * (d1.fx + d2.fx + d3.fx));
      y += h_ * (vy + (h_ / 6) * (d1.fy + d2.fy + d3.fy));
      vx += (h_ / 6) * (d1.fx + 2 * d2.fx + 2 * d3.fx + d4.fx);
      vy += (h_ / 6) * (d1.fy + 2 * d2.fy + 2 * d3.fy + d4.fy);
    }
    m = m3; t += h_;
    if (pitched && turnLag > 0) {
      // The axis turns toward the velocity through the air.
      const [ax, ay] = air(x, y), rx = vx - ax, ry = vy - ay, s = Math.hypot(rx, ry);
      if (s > 1e-6) {
        const k = 1 - Math.exp(-h_ / turnLag);
        axX += (rx / s - axX) * k; axY += (ry / s - axY) * k;
        const n = Math.hypot(axX, axY); axX /= n; axY /= n;
      }
    }
    if (S) {
      burnt = C ? used(t - tIgn) : burnt + mdot * h_;
      if (C ? t - tIgn >= C.end - 1e-9 : S.prop - burnt <= 1e-9) {
        events.push({ type: 'burnout', stage, t, h: Math.hypot(x, y) - R });
        stage++; burnt = 0; tIgn = t;
        if (stage < stages.length) { m = masses[stage]; events.push({ type: 'separation', stage: stage - 1, t }); }
        else { m = payload; end = t + coast; if (!(coast > 0)) break; }
      }
    }
    const r = Math.hypot(x, y);
    if (!pitched && r - R >= pitchAlt) {
      if (weathercock) {
        // Off the launch rod: from here it flies along its velocity through
        // the air, turning into any wind as a stable rocket does (at once:
        // a point mass has no attitude to lag).
        events.push({ type: 'rod', t, h: r - R });
      } else {
        // Pitchover: the air-relative velocity turned to gamma0 from the
        // local horizontal, its speed kept.
        const ux = x / r, uy = y / r, [ax, ay] = air(x, y);
        const rx = vx - ax, ry = vy - ay, s = Math.hypot(rx, ry), g = gamma0 * Math.PI / 180;
        vx = ax + s * (Math.cos(g) * uy + Math.sin(g) * ux);
        vy = ay + s * (-Math.cos(g) * ux + Math.sin(g) * uy);
        events.push({ type: 'pitchover', t, h: r - R });
      }
      pitched = true;
      // The axis starts along the rod: up, or tilted by the kick.
      { const rr = Math.hypot(x, y), ux = x / rr, uy = y / rr, [ax, ay] = air(x, y), rx = vx - ax, ry = vy - ay, s = Math.hypot(rx, ry);
        if (weathercock || !(s > 1e-6)) { axX = ux; axY = uy; } else { axX = rx / s; axY = ry / s; } }
    }
    if (r < R - 1 && t > 1) { events.push({ type: 'impact', t }); break; }
    // The top of the climb.
    if (stopAtApogee && lifted && r - R > 0.01 && (vx * x + vy * y) / r <= 0) { events.push({ type: 'apogee', t, h: r - R }); break; }
    // Engine cutoff in orbit: speed at the circular speed for this height.
    if (toOrbit && pitched && stage < stages.length && Math.hypot(vx, vy) >= Math.sqrt((opts.mu ?? g0 * R * R) / r)) {
      events.push({ type: 'cutoff', stage, t, h: r - R, left: stages[stage].prop - burnt });
      cutoff = { stage, prop: stages[stage].prop - burnt };
      break;
    }
    if (!S && t >= end - 1e-9) break;
  }
  const d = deriv(x, y, vx, vy, m, -1, true);
  record(d);
  const { r, ux, uy } = sky(x, y);
  const vr = vx * ux + vy * uy, vt = vx * uy - vy * ux;
  return {
    history, events, maxQ, losses: { gravity: lossG, drag: lossD }, remaining: cutoff,
    burnout: { t, h: r - R, v: Math.hypot(vx, vy), gamma: Math.atan2(vr, vt) * 180 / Math.PI, x: R * Math.atan2(x, y), r, theta: Math.atan2(x, y), vr, vt },
  };
}

// The ascent's end state in three dimensions: geocentric J2000 r (km) and
// v (km/s). lat, lon (deg): the pad; az: the azimuth (deg from north) of
// the ascent's plane, fixed in inertial space through the pad at liftoff
// (launchAzimuth gives it for an inclination); earthFixedAtLiftoff: the
// J2000 -> Earth-fixed matrix at liftoff (rows: the Earth-fixed axes in
// J2000), from earthRotation.js, which places the pad.
// The Earth's rotation carries the pad partly along the plane (the ascent's
// `rotation`, rotationBonus(lat, az)) and partly across it. A real launch
// steers that cross-plane speed away during the ascent, so it is left out
// here and returned as crossSpeed (m/s): an upper bound on what the
// steering costs.
export function ascentToState(result, opts) {
  const F = launchFrame(opts);
  const { r, theta, vr, vt } = result.burnout;
  return { ...F.state(r, theta, vr, vt), crossSpeed: F.crossSpeed };
}

// The launch plane in J2000 at liftoff: up, downrange and the plane's
// normal at the pad, from its latitude, longitude, azimuth and the Earth's
// orientation then. state(r, theta, vr, vt) turns a point of the planar
// ascent (radius and angle downrange in m and rad, speeds in m/s) into a
// geocentric J2000 state in km and km/s.
function launchFrame({ lat, lon, az, earthFixedAtLiftoff, omega = EARTH.omega, R = EARTH.R }) {
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180, A = az * Math.PI / 180;
  const M = earthFixedAtLiftoff;
  const toJ2000 = (e) => [0, 1, 2].map((i) => M[0][i] * e[0] + M[1][i] * e[1] + M[2][i] * e[2]);
  // Up, east and north at the pad (geocentric latitude for the plane).
  const up = toJ2000([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]);
  const east = toJ2000([-Math.sin(lo), Math.cos(lo), 0]);
  const north = toJ2000([-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)]);
  const dir = [0, 1, 2].map((i) => Math.sin(A) * east[i] + Math.cos(A) * north[i]);
  const normal = [up[1] * dir[2] - up[2] * dir[1], up[2] * dir[0] - up[0] * dir[2], up[0] * dir[1] - up[1] * dir[0]];
  // The pad's speed across the plane: omega R cos(lat) times east . normal.
  const crossSpeed = Math.abs(omega * R * Math.cos(la) * (east[0] * normal[0] + east[1] * normal[1] + east[2] * normal[2]));
  const state = (r, theta, vr, vt) => {
    const radial = [0, 1, 2].map((i) => Math.cos(theta) * up[i] + Math.sin(theta) * dir[i]);
    const along = [0, 1, 2].map((i) => -Math.sin(theta) * up[i] + Math.cos(theta) * dir[i]);
    return { r: radial.map((u) => u * r / 1000), v: [0, 1, 2].map((i) => (vr * radial[i] + vt * along[i]) / 1000) };
  };
  return { state, crossSpeed, R };
}

// The whole ascent as geocentric J2000 states, for drawing it: one per
// sample of the time history and the burnout state last, each
// { t (s after liftoff), r (km), v (km/s) }, in the same launch plane as
// ascentToState (so the last is its state).
export function ascentTrack(result, opts) {
  const F = launchFrame(opts), R = opts.R ?? EARTH.R;
  const out = result.history.map((p) => {
    const g = p.gamma * Math.PI / 180;
    return { t: p.t, ...F.state(R + p.h, p.x / R, p.v * Math.sin(g), p.v * Math.cos(g)) };
  });
  const b = result.burnout;
  if (!out.length || out.at(-1).t < b.t) out.push({ t: b.t, ...F.state(b.r, b.theta, b.vr, b.vt) });
  return out;
}

// ---------------- working backwards: what a job needs ----------------

// Delta-v (m/s) to put a payload in a circular orbit at altitude h (m) from
// a pad: the orbit's speed, less the Earth's rotation along the launch
// azimuth, plus the ascent's losses (gravity, drag, steering). losses
// default to 1.5 km/s, typical of a large launcher (Curtis's Example 13.3,
// a single stage, loses 1.7 km/s); an ascent() of the actual stack gives
// its own.
export function deltaVToOrbit({ h, lat, az, losses = 1500 }) {
  return circularSpeed(h) - rotationBonus(lat, az) + losses;
}

// Delta-v (m/s) from a circular parking orbit at altitude h (m) onto a
// departure hyperbola of energy c3 (km^2/s^2): the Trajectory Browser's
// convention, sqrt(v_inf^2 + 2 mu / r) - sqrt(mu / r). c3 < 0 is an ellipse
// (about -2 for the Moon).
export function deltaVDeparture({ h, c3 }) {
  const r = EARTH.R + h, mu = EARTH.mu;
  return Math.sqrt(c3 * 1e6 + 2 * mu / r) - Math.sqrt(mu / r);
}

// Delta-v (m/s) from a circular parking orbit at altitude h (m) into an
// elliptical orbit reaching altitude apo (m): the first burn of a Hohmann
// transfer (a geostationary transfer orbit has apo 35,786 km).
export function deltaVToApoapsis({ h, apo }) {
  const r1 = EARTH.R + h, r2 = EARTH.R + apo, mu = EARTH.mu;
  return Math.sqrt(mu / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1);
}

// A gravity turn that ends flying level: the pitch kick gamma0 found by
// bisection so the last burnout's flight-path angle is zero. A kick nearer
// vertical lofts the ascent, a larger one flattens it, so the burnout angle
// rises with gamma0. Returns the ascent with gamma0 set, or null when no
// kick in [lo, hi] deg ends level (the stack is too weak or too strong for
// a pure gravity turn).
export function levelAscent(opts, { lo = 80, hi = 89.995, tol = 1e-6 } = {}) {
  const run = (g) => ascent({ ...opts, gamma0: g });
  let a = run(lo), b = run(hi);
  if (!(a.burnout.gamma < 0 && b.burnout.gamma > 0)) return null;
  for (let k = 0; k < 60 && hi - lo > tol; k++) {
    const m = (lo + hi) / 2, r = run(m);
    if (r.burnout.gamma < 0) { lo = m; a = r; } else { hi = m; b = r; }
  }
  const best = Math.abs(a.burnout.gamma) < Math.abs(b.burnout.gamma) ? a : b;
  return { ...best, gamma0: Math.abs(a.burnout.gamma) < Math.abs(b.burnout.gamma) ? lo : hi };
}
