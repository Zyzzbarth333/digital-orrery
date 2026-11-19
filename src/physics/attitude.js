// src/physics/attitude.js
//
// A craft's attitude in the app: a unit quaternion and body rates, turned
// by a controller with finite torque, by the gravity gradient and, low in
// the Earth's air, by drag acting off the centre of mass
// (docs/physics/sixdof.md#attitude-in-the-app). Pure ES module, SI units
// (m, m/s, kg, N m, rad).
//
// It runs the rotational half of sixdof.js's model (makeModel's
// rotationalRates: the same torques and Euler's equations NASA's check
// cases test) on a translation it is given, at(t) -> { r, v } about the
// primary, rather than integrating the translation itself: the kernel
// flies that. The thrust axis is body +x.
//
// Modes:
//   off         no control: the body turns under its torques alone
//   inertial    hold the attitude it had when chosen
//   prograde, retrograde, normal, antinormal, radial, antiradial
//               body +x along that direction of the orbital frame about the
//               primary (vnbDirection's: along the velocity; in the plane,
//               velocity x normal, which is outward; the orbit normal),
//               body +z toward the orbit normal (toward the velocity for
//               the two normal modes)
//   node        along the next manoeuvre node's direction (target())
//
// The controller is sampled, as flight software is: every CONTROL_PERIOD
// it reads the attitude and rates and holds a torque until the next sample.
// It turns about the eigenaxis of the error (the single rotation that takes
// the body onto the reference), at a commanded rate that brakes in time:
//   omega_cmd = e min(rateMax, sqrt(2 alpha_b theta + c^2) - c) + omega_ref,  c = alpha_b T_p
//   tau = omega x I omega + I (omega_cmd - omega) / CONTROL_PERIOD
// clipped to the torque limit per axis (scaled as a whole, so it keeps its
// axis). alpha is the angular acceleration the limit allows about e, and
// alpha_b = BRAKE alpha the braking curve's, a margin so the rate loop
// can always follow it. The curve brakes at alpha_b far out, as the
// time-optimal sqrt(2 alpha theta) law does, and near the target becomes
// theta / T_p, a first-order approach, without ever asking more than
// alpha_b. The rate loop is deadbeat: unsaturated, it reaches the command
// in one period. A rest-to-rest turn then takes slewTime(): no less than
// the torque and rate limits allow (minSlewTime, bang-coast-bang), and a
// few per cent more.
//
// Settled on its reference (within LOCK_ANGLE and LOCK_RATE) and with the
// disturbances well inside the torque limit, the attitude locks: it is the
// reference from then on, without integration, until the mode changes or a
// disturbance grows past half the limit. A craft holding prograde at a day
// a second costs nothing to carry.
//
// Propellant: with spec.rcsArm (m per body axis), the thrusters are pairs
// fired as couples, each thruster rcsArm[i] from axis i, so a torque tau_i
// takes |tau_i| / rcsArm[i] of thrust between them. A.rcsImpulse (N s)
// adds that up: the held torque over each controlled step, and while
// locked the hold's limit cycle (holdThrust). The craft turns it into
// propellant at the thrusters' Isp (craftAttitude.js).
//
// The hold: on-off thrusters keep the attitude within +-deadband (rad) of
// the reference by pulses of at least impulseBit (N s a thruster), each a
// couple's rate change dw = 2 impulseBit L / I about its axis. Per axis,
// with the disturbance tau there and eps = (|tau| / L) / R2, where R2 =
// impulseBit^2 L / (deadband I) is the centred two-sided cycle's mean
// thrust (Jackson et al.'s worst case without a disturbance), the cycle
// the deadband controller settles into costs, on average:
//   eps < 2/9         two-sided, its drift rates walked across by the
//                     disturbance: 2/3 R2 (the centred cycle's 4x(1-x)
//                     averaged over a uniform phase x)
//   2/9 <= eps < 3/4  two pulses downwind to one upwind: 3 |tau| / L
//   eps >= 3/4        one-sided, against the disturbance: |tau| / L
// in closed form, since a locked hold is not integrated
// (docs/physics/sixdof.md#the-holds-limit-cycle). Without a deadband or a
// bit, the hold pays the disturbance alone.
//
// Steps: under control, one RK4 step per control period (cut at frame
// edges and breakpoints, the held torque carried across); without it, RK4
// at a step that turns the body at most 0.05 rad, and resolves the
// gravity-gradient and aerodynamic swings (at most hMax, 30 s).

import { makeModel, gravityGradientTorque, aeroTorque } from './sixdof.js';
import { quatMul, quatConj, quatNormalize, quatToMatrix, matrixToQuat, matVec, matTVec } from './rigidbody.js';
import { dot, cross, norm, unit } from './vec.js';

export const CONTROL_PERIOD = 0.1;     // s, the controller's sample time
export const POSITION_TIME = 0.4;      // s, T_p: the final approach's time constant (critically damped with the 0.1 s sampling)
export const BRAKE = 0.8;              // braking at 80 % of the torque limit's acceleration
export const LOCK_ANGLE = 1e-4;        // rad (0.006 deg)
export const LOCK_RATE = 2e-4;         // rad/s
export const MAX_STEPS = 20000;        // a frame's attitude steps at most

export const MODES = ['off', 'inertial', 'prograde', 'retrograde', 'normal', 'antinormal', 'radial', 'antiradial', 'node'];
// Each pointing mode's direction as [prograde, in-plane, normal]
// (vnbDirection's frame; in-plane is velocity x normal, outward).
export const MODE_VNB = { prograde: [1, 0, 0], retrograde: [-1, 0, 0], radial: [0, 1, 0], antiradial: [0, -1, 0], normal: [0, 0, 1], antinormal: [0, 0, -1] };


// The orbital frame of relative r, v: V along the velocity, N the orbit
// normal, I = V x N (outward in the plane).
export function orbitalFrame(r, v) {
  const V = unit(v), N = unit(cross(r, v));
  return { V, N, I: cross(V, N) };
}

// [prograde, in-plane, normal] components in the frame of r, v, as an
// inertial unit vector.
export function vnbToInertial(d, r, v) {
  const { V, I, N } = orbitalFrame(r, v);
  return unit([0, 1, 2].map((k) => d[0] * V[k] + d[1] * I[k] + d[2] * N[k]));
}

// The attitude (body to inertial) with body +x along the unit vector x and
// body +z as near the unit vector s as is square to it.
export function pointing(x, s, alt) {
  let side = Math.abs(dot(x, s)) < 0.9 ? s : alt;
  const z = unit(side.map((c, i) => c - dot(side, x) * x[i])), y = cross(z, x);
  return matrixToQuat([[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]);
}

// The rotation that takes the body onto the reference, in body axes:
// angle theta (rad, 0 to pi) about the unit axis e.
export function attitudeError(q, qRef) {
  let d = quatMul(quatConj(q), qRef);
  if (d[0] < 0) d = d.map((c) => -c);
  const s = Math.hypot(d[1], d[2], d[3]);
  return { theta: 2 * Math.atan2(s, d[0]), e: s > 0 ? [d[1] / s, d[2] / s, d[3] / s] : [1, 0, 0] };
}

// The angular acceleration (rad/s^2) the torque limit allows about the
// body axis e: the torque I e alpha must fit inside it on every axis.
export function alphaAbout(spec, e) {
  const Ie = matVec(spec.inertia, e);
  let a = Infinity;
  for (let i = 0; i < 3; i++) if (Math.abs(Ie[i]) > 1e-12) a = Math.min(a, spec.torqueMax[i] / Math.abs(Ie[i]));
  return a;
}

// The least time (s) for a rest-to-rest turn of theta (rad) about a fixed
// axis with angular acceleration at most alpha and rate at most rateMax:
// full torque to the rate limit (or halfway), coast, full torque back.
// The double integrator's time-optimal answer (Pontryagin's bang-bang).
export function minSlewTime(theta, alpha, rateMax = Infinity) {
  const tri = 2 * Math.sqrt(theta / alpha);
  return alpha * tri / 2 <= rateMax ? tri : theta / rateMax + rateMax / alpha;
}

// The controller's commanded turning rate (rad/s) at theta (rad) from the
// target, braking at b (rad/s^2).
export const brakeRate = (theta, b, rateMax) => Math.min(rateMax, Math.sqrt(2 * b * theta + (b * POSITION_TIME) ** 2) - b * POSITION_TIME);

// The controller's own time (s) for a rest-to-rest turn of theta (rad)
// about the body axis e, to within thetaEnd (rad) of the target: full
// torque (alpha) up to the braking curve or the rate limit, a coast, then
// down the curve, omega(theta) = sqrt(2 b theta + c^2) - c, whose time
// from omega1 to omega2 is ((omega1 - omega2) + c ln(omega1 / omega2)) / b.
// A fixed reference; the gyroscopic terms and the sampling (a period or
// so) left out.
export function slewTime(spec, theta, e, thetaEnd = LOCK_ANGLE) {
  const a = alphaAbout(spec, e), b = BRAKE * a, c = b * POSITION_TIME, wm = spec.rateMax;
  if (theta <= thetaEnd) return 0;
  // The peak: accelerating over wp^2 / 2a, braking from wp over
  // (wp^2 + 2 c wp) / 2b, together theta.
  const A2 = 1 / (2 * a) + 1 / (2 * b), B1 = c / b;
  let wp = (-B1 + Math.sqrt(B1 * B1 + 4 * A2 * theta)) / (2 * A2), coast = 0;
  if (wp > wm) { wp = wm; coast = (theta - wm * wm / (2 * a) - (wm * wm + 2 * c * wm) / (2 * b)) / wm; }
  const wf = brakeRate(thetaEnd, b, Infinity);
  return wp / a + coast + ((wp - wf) + c * Math.log(wp / wf)) / b;
}

// A craft's attitude. spec: { inertia (3x3 kg m^2, body axes), torqueMax
// ([N m] per body axis), rateMax (rad/s), cp (body m, the centre of
// pressure from the centre of mass), cdA (m^2), rcsArm ([m] per body
// axis, or null: no propellant counted), deadband (rad, the hold's half
// width) and impulseBit (N s a thruster, or [N s] per body axis), or
// null: the hold pays only the disturbance }; q, omega the start;
// mode. For checks: torque(t) (body-axis torque pulses), breakpoints,
// fixedStep (s, every step without control).
export function makeAttitude({ inertia, torqueMax, rateMax = 0.05, cp = [0, 0, 0], cdA = 0, rcsArm = null, deadband = null, impulseBit = null, q = [1, 0, 0, 0], omega = [0, 0, 0], mode = 'off', t = 0, gravityGradient = true, torque = null, breakpoints = [], fixedStep = null, hMax = 30 }) {
  return {
    spec: { inertia, torqueMax, rateMax, cp, cdA, rcsArm, deadband, impulseBit },
    q: quatNormalize(q), omega: [...omega], mode, t,
    holdQ: quatNormalize(q),          // the inertial mode's attitude
    held: [0, 0, 0],                  // the controller's torque, held to nextSample
    nextSample: -Infinity,
    locked: false,
    gravityGradient, torque, breakpoints: [...breakpoints].sort((x, y) => x - y), fixedStep, hMax,
    models: new Map(),                // sixdof models by primary
    steps: 0,
    disturbance: [0, 0, 0],           // the last torque found on it beyond control, N m
    rcsImpulse: 0,                    // N s, the thrusters' total impulse so far
  };
}

// The thrust (N) the thrusters need for the torque tau (body axes, N m):
// sum |tau_i| / rcsArm[i]; 0 with no arms given.
export function rcsThrust(spec, tau) {
  const L = spec.rcsArm;
  return L ? Math.abs(tau[0]) / L[0] + Math.abs(tau[1]) / L[1] + Math.abs(tau[2]) / L[2] : 0;
}

// The limit cycles of a hold within the deadband against the disturbance
// tau (body axes, N m), axis by axis: [{ eps (the disturbance's thrust
// over R2), regime ('drift', 'two-one' or 'one-sided'), thrust (N, the
// cycle's mean), dw (rad/s, a pulse's rate change), period (s, the
// centred two-sided cycle's: 8 deadband / dw) }], or null without a
// deadband, a bit or arms. The inertia's diagonal is taken as principal.
export function limitCycle(spec, tau) {
  const { rcsArm: L, impulseBit: bit, deadband: d, inertia: I } = spec;
  const bits = Array.isArray(bit) ? bit : [bit, bit, bit];
  if (!L || !bits.every((x) => x > 0) || !(d > 0)) return null;
  return [0, 1, 2].map((i) => {
    const b = bits[i], Ii = I[i][i], R2 = b * b * L[i] / (d * Ii), Rd = Math.abs(tau[i]) / L[i], eps = Rd / R2, dw = 2 * b * L[i] / Ii;
    const regime = eps < 2 / 9 ? 'drift' : eps < 3 / 4 ? 'two-one' : 'one-sided';
    const thrust = regime === 'drift' ? 2 / 3 * R2 : regime === 'two-one' ? 3 * Rd : Rd;
    return { eps, regime, thrust, dw, period: 8 * d / dw };
  });
}

// The mean thrust (N) a locked hold costs against the disturbance tau:
// the limit cycles' (limitCycle), or without them the disturbance's,
// sum |tau_i| / rcsArm[i].
export function holdThrust(spec, tau) {
  const c = limitCycle(spec, tau);
  return c ? c[0].thrust + c[1].thrust + c[2].thrust : rcsThrust(spec, tau);
}

// A new inertia tensor (kg m^2, body axes), as propellant is drawn: the
// sixdof models (which hold its inverse) are made again.
export function setInertia(A, inertia) {
  A.spec.inertia = inertia;
  A.models.clear();
}

// Choose a mode. The inertial mode holds the attitude it has now.
export function setMode(A, mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown attitude mode ${mode}`);
  A.mode = mode;
  A.locked = false;
  A.nextSample = -Infinity;
  if (mode === 'inertial' || mode === 'node') A.holdQ = [...A.q];
  if (mode === 'off') A.held = [0, 0, 0];
}

// The thrust axis (body +x) in inertial axes.
export const thrustAxis = (q) => { const M = quatToMatrix(q); return [M[0][0], M[1][0], M[2][0]]; };

// The sixdof.js model for one primary (mu m^3/s^2, its air if any), reused
// while the craft stays about it. The control torque is the held one.
function modelFor(A, env) {
  const key = env.key ?? 'primary';
  let m = A.models.get(key);
  if (!m || m.mu !== env.mu) {
    const air = env.air ?? null;
    m = makeModel({
      mu: env.mu, field: null, inertia: A.spec.inertia, mass: 1,
      gravityGradient: A.gravityGradient,
      torque: A.torque,
      control: () => A.held,
      earthFixed: air ? air.earthFixed : () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      drag: air ? { cdAOverM: 0, density: air.density, omegaEarth: air.omegaEarth } : null,
      aero: air && A.spec.cdA > 0 ? { cp: A.spec.cp, cdA: A.spec.cdA } : null,
    });
    A.models.set(key, m);
  }
  return m;
}

// The reference attitude at t, and its angular velocity (inertial axes),
// from the translation: { q, w } or null with no reference (off).
function reference(A, t, env) {
  if (A.mode === 'off') return null;
  if (A.mode === 'inertial') return { q: A.holdQ, w: [0, 0, 0], frame: null };
  const qAt = (tt) => {
    const s = env.at(tt), { V, N } = orbitalFrame(s.r, s.v);
    const tg = A.mode === 'node' ? env.target?.(tt) ?? null : { vnb: MODE_VNB[A.mode] };
    if (!tg) return null;
    const x = tg.dir ? unit(tg.dir) : vnbToInertial(tg.vnb, s.r, s.v);
    const s2 = Math.abs(dot(x, N)) < 0.9 ? N : V;
    return { q: pointing(x, s2, V), tg };
  };
  const now = qAt(t);
  if (!now) return { q: A.holdQ, w: [0, 0, 0], frame: null };
  // Its rate from a second either side (the orbital frame turns at about
  // the mean motion: 1.1e-3 rad/s in low orbit).
  const h = 1, a = qAt(t - h), b = qAt(t + h);
  let w = [0, 0, 0];
  if (a && b) {
    let d = quatMul(quatConj(a.q), b.q);
    if (d[0] < 0) d = d.map((c) => -c);
    const s = Math.hypot(d[1], d[2], d[3]), ang = 2 * Math.atan2(s, d[0]);
    const wb = s > 0 ? [d[1] / s * ang / (2 * h), d[2] / s * ang / (2 * h), d[3] / s * ang / (2 * h)] : [0, 0, 0];
    w = matVec(quatToMatrix(now.q), wb);
  }
  return { q: now.q, w, frame: now.tg };
}

// The controller's torque for the state now (body axes, N m).
export function controlTorque(A, q, omega, ref) {
  const { inertia, torqueMax, rateMax } = A.spec;
  const { theta, e } = attitudeError(q, ref.q);
  const b = BRAKE * alphaAbout(A.spec, e);
  const speed = brakeRate(theta, b, rateMax);
  const wRef = matTVec(quatToMatrix(q), ref.w);
  const cmd = [0, 1, 2].map((i) => e[i] * speed + wRef[i]);
  const Iw = matVec(inertia, omega), gyro = cross(omega, Iw);
  const dw = [0, 1, 2].map((i) => (cmd[i] - omega[i]) / CONTROL_PERIOD);
  const Idw = matVec(inertia, dw);
  const tau = [0, 1, 2].map((i) => gyro[i] + Idw[i]);
  let k = 1;
  for (let i = 0; i < 3; i++) if (Math.abs(tau[i]) > torqueMax[i]) k = Math.min(k, torqueMax[i] / Math.abs(tau[i]));
  return { tau: tau.map((x) => x * k), theta, wErr: norm([0, 1, 2].map((i) => omega[i] - wRef[i])) };
}

// The torques on the body beyond control (gravity gradient, drag), body
// axes, N m, at the translation's state at t.
export function disturbance(A, t, env) {
  const s = env.at(t), tau = A.gravityGradient ? gravityGradientTorque(env.mu, s.r, A.q, A.spec.inertia) : [0, 0, 0];
  const air = env.air;
  if (air && A.spec.cdA > 0) {
    const M = air.earthFixed(t), rho = air.density(t, s.r, matVec(M, s.r));
    if (rho > 0) {
      const p = M[2], wr = cross([p[0] * air.omegaEarth, p[1] * air.omegaEarth, p[2] * air.omegaEarth], s.r);
      const g = aeroTorque(rho, [s.v[0] - wr[0], s.v[1] - wr[1], s.v[2] - wr[2]], A.q, A.spec.cdA, A.spec.cp);
      for (let i = 0; i < 3; i++) tau[i] += g[i];
    }
  }
  return tau;
}

// One RK4 step of the rotation over h from t, the translation from at().
function rk4(model, A, t, h, at) {
  const mid = t + h / 2, sa = at(t), sm = at(mid), sb = at(t + h);
  const y = [...A.q, ...A.omega];
  const f = (s, tt, yy) => model.rotationalRates(tt, s.r, s.v, yy.slice(0, 4), yy.slice(4, 7), mid);
  const k1 = f(sa, t, y);
  const y2 = y.map((x, i) => x + h / 2 * k1[i]), k2 = f(sm, mid, y2);
  const y3 = y.map((x, i) => x + h / 2 * k2[i]), k3 = f(sm, mid, y3);
  const y4 = y.map((x, i) => x + h * k3[i]), k4 = f(sb, t + h, y4);
  const yn = y.map((x, i) => x + h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
  A.q = quatNormalize(yn.slice(0, 4));
  A.omega = yn.slice(4, 7);
}

// The free body's step: at most 0.05 rad of turning, and a twentieth of
// the gravity-gradient and aerodynamic swings' periods, to hMax.
function freeStep(A, t, env) {
  const s = env.at(t), I = A.spec.inertia, Imin = Math.min(I[0][0], I[1][1], I[2][2]);
  let w = Math.max(norm(A.omega), A.gravityGradient ? Math.sqrt(3 * env.mu / norm(s.r) ** 3) : 0);
  const air = env.air;
  if (air && A.spec.cdA > 0) {
    const M = air.earthFixed(t), rho = air.density(t, s.r, matVec(M, s.r));
    if (rho > 0) w = Math.max(w, Math.sqrt(0.5 * rho * dot(s.v, s.v) * A.spec.cdA * norm(A.spec.cp) / Imin));
  }
  return Math.min(A.hMax, w > 0 ? 0.05 / w : A.hMax);
}

// Carry the attitude from A.t to t1 (s). env: { key, mu (m^3/s^2),
// at(t) -> { r (m), v (m/s) } about the primary, air?: { earthFixed(t),
// density(t, r, rEcef), omegaEarth }, target?(t) -> { vnb } | { dir } |
// null for the node mode }. record(span), if given, is told what the
// thrust axis did: { t0, t1, d0, d1 } over each step, or { t0, t1, lock:
// frame } over a stretch held locked on a reference (frame { vnb } or
// { dir }, or null for an inertial hold, its axis d0). Returns the steps
// taken.
export function advanceAttitude(A, t1, env, record = null) {
  // (The sixdof model only when a step is integrated: a locked hold whose
  // inertia falls with its tank each frame doesn't build it again.)
  let model = null, steps = 0;
  if (!(t1 > A.t)) return 0;
  // Locked: still held if the disturbance is well inside the limit.
  if (A.locked) {
    A.disturbance = disturbance(A, A.t, env);
    if (A.disturbance.some((x, i) => Math.abs(x) > 0.5 * A.spec.torqueMax[i])) A.locked = false;
  }
  while (A.t < t1 - 1e-9) {
    if (A.locked) {
      const ref = reference(A, t1, env), t0 = A.t, d0 = thrustAxis(A.q);
      A.q = ref.q;
      A.omega = matTVec(quatToMatrix(ref.q), ref.w);
      A.t = t1;
      A.rcsImpulse += holdThrust(A.spec, A.disturbance) * (t1 - t0);
      record?.({ t0, t1, d0, d1: thrustAxis(A.q), lock: ref.frame });
      break;
    }
    if (steps >= MAX_STEPS) break;
    const nb = A.breakpoints.find((b) => b > A.t + 1e-9) ?? Infinity;
    let end;
    if (A.mode !== 'off') {
      if (A.t >= A.nextSample - 1e-9) {
        const ref = reference(A, A.t, env);
        const c = controlTorque(A, A.q, A.omega, ref);
        A.disturbance = disturbance(A, A.t, env);
        if (c.theta < LOCK_ANGLE && c.wErr < LOCK_RATE && A.disturbance.every((x, i) => Math.abs(x) < 0.25 * A.spec.torqueMax[i])) {
          A.locked = true;
          A.held = [0, 0, 0];
          continue;
        }
        A.held = c.tau;
        A.nextSample = A.t + CONTROL_PERIOD;
      }
      end = Math.min(A.nextSample, t1, nb);
    } else {
      end = Math.min(A.t + (A.fixedStep ?? freeStep(A, A.t, env)), t1, nb);
    }
    const t0 = A.t, d0 = thrustAxis(A.q);
    rk4(model ??= modelFor(A, env), A, t0, end - t0, env.at);
    A.t = Math.abs(end - t1) < 1e-9 ? t1 : end;
    if (A.mode !== 'off') A.rcsImpulse += rcsThrust(A.spec, A.held) * (A.t - t0);
    steps++;
    record?.({ t0, t1: A.t, d0, d1: thrustAxis(A.q) });
  }
  A.steps += steps;
  return steps;
}

// The attitude's error from its reference now (rad), for readouts: null
// when it has none.
export function pointingError(A, env) {
  const ref = reference(A, A.t, env);
  return ref ? attitudeError(A.q, ref.q).theta : null;
}

// The reference attitude at t (s), from the translation env.at gives:
// where a locked craft will be pointing then. Null with none (off).
export function referenceAt(A, env, t) {
  const ref = reference(A, t, env);
  return ref ? ref.q : null;
}

// The reference attitude now, for drawing where the craft is turning to.
export function referenceNow(A, env) {
  const ref = reference(A, A.t, env);
  return ref ? ref.q : null;
}
