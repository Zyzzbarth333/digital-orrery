// src/physics/attitude.test.mjs
//
// The app's attitude (attitude.js, craftAttitude.js) against references:
//   1. NASA's 6-DOF check cases (NESC, NASA/TM-2015-218675) for the
//      rotation, run through the app's attitude stepper on the case's own
//      translation: torque-free, torque pulses and the gravity gradient.
//   2. Turns under the torque limit: the time-optimal rest-to-rest bound
//      (bang-coast-bang) and the controller's own closed form, for turns
//      about fixed axes and a slew to prograde in low orbit, by the craft
//      the app flies, frame by frame.
//   3. A burn along the body axis held prograde against the point-mass
//      burn steered prograde (the kernel's 'vnb' burns), and both against
//      sixdof.js flying translation and attitude together with the
//      controller in the loop.
//   4. The aerodynamic torque's weathervane: the small-angle pitch
//      frequency sqrt(q CdA |cp| / I).
//   5. Cost: a held craft at a day a second takes no attitude steps.
//   6. The thrusters' propellant: rest-to-rest turns against the angular
//      impulse they need in closed form, 2 I omega_peak / arm, at the
//      thrusters' Isp; and the tank's account through the craft.
//   7. Inertia that falls with the propellant: the tanks' tensor by the
//      parallel-axis theorem, and a turn on a near-empty craft against the
//      controller's closed-form time for its inertia then.
//   8. The node auto-turn: the turn starts slewTime ahead, settles before
//      the node, burns as the point-mass node burn does (at 1/4 s frames
//      and at 600 s frames), comes back to its mode, and says when it is
//      too late.
//   9. The hold's limit cycle: the closed-form mean against a pulse-by-
//      pulse simulation of the deadband controller on the default craft,
//      without a disturbance and with one (two-sided, two pulses to one,
//      one-sided), and against Jackson et al.'s centred two-sided cycle
//      (AIAA GN&C 2007, NTRS 20080000345, eqs. (1)-(3)).
//
// Fixture: fixtures/nesc_orbital.json (npm run fetch:nesc).

import './deNode.js';
import fs from 'node:fs';
import { runCase, CASES, VEHICLES, MU } from './nesc.lib.mjs';
import { euler321, makeModel, propagate6dof } from './sixdof.js';
import { transpose, quatToMatrix } from './rigidbody.js';
import { makeAttitude, advanceAttitude, setMode, setInertia, rcsThrust, holdThrust, limitCycle, slewTime, minSlewTime, alphaAbout, attitudeError, pointing, orbitalFrame, controlTorque, thrustAxis, CONTROL_PERIOD } from './attitude.js';
import { DEFAULT_ATTITUDE, propellantInertia, inertiaFor, AUTO_MARGIN, AUTO_PAD } from './craftAttitude.js';
import { Craft } from './craft.js';
import { createKernelHost, stepCraft, KERNEL_EPOCH_MS, kernelSeconds, kernelMs } from './kernelHost.js';
import { solarSystemBodies } from './bodies.js';
import { helioStateEqj } from './ephemeris.js';

let failures = 0;
const check = (name, ok) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; };
const header = (s) => { console.log('='.repeat(72)); console.log(s); console.log('='.repeat(72)); };
const R2D = 180 / Math.PI, D2R = Math.PI / 180;
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/nesc_orbital.json', import.meta.url)));

header('1. NESC CASES: the rotation through the app\'s attitude stepper');
// The translation each case flies (sixdof.js, sampled every second) is
// handed to attitude.js as at(t), cubic Hermite between samples (good to
// about 1e-7 m in low orbit); the stepper turns the body on it with its
// own torques: none (8A, 8B), NASA's torque pulse (9A, 9B), the gravity
// gradient (10A to 10D). One RK4 step a second, as the cases ran.
{
  const keys = ['08A', '08B', '09A', '09B', '10A', '10B', '10C', '10D'];
  let worstW = 0, worstA = 0, worstOurs = 0;
  for (const key of keys) {
    const c = CASES[key], veh = VEHICLES[c.vehicle];
    const ref = runCase(key, { outEvery: 1 });
    const at = (t) => {
      const i = Math.min(ref.length - 2, Math.max(0, Math.floor(t))), a = ref[i], b = ref[i + 1], h = b.t - a.t, u = (t - a.t) / h;
      const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
      const d00 = (6 * u ** 2 - 6 * u) / h, d10 = 3 * u ** 2 - 4 * u + 1, d01 = (-6 * u ** 2 + 6 * u) / h, d11 = 3 * u ** 2 - 2 * u;
      return { r: [0, 1, 2].map((k) => h00 * a.r[k] + h10 * h * a.v[k] + h01 * b.r[k] + h11 * h * b.v[k]), v: [0, 1, 2].map((k) => d00 * a.r[k] + d10 * a.v[k] + d01 * b.r[k] + d11 * b.v[k]) };
    };
    const A = makeAttitude({ inertia: veh.inertia, torqueMax: [1, 1, 1], q: ref[0].q, omega: ref[0].omega, mode: 'off', gravityGradient: !!c.gravityGradient, torque: c.torque ?? null, breakpoints: c.breakpoints ?? [], fixedStep: 1 });
    const env = { key: 'earth', mu: MU, at };
    const ours = new Map();
    for (const s of ref) {
      if (s.t > 0) advanceAttitude(A, s.t, env);
      if (Math.round(s.t) % fx.every === 0) ours.set(Math.round(s.t), { q: [...A.q], omega: [...A.omega] });
      worstOurs = Math.max(worstOurs, dist(A.omega, s.omega));
    }
    let dw = Infinity, da = Infinity;
    for (const rows of Object.values(fx.cases[key].tools)) {
      let w = 0, a = 0;
      for (const x of rows) {
        const o = ours.get(Math.round(x.t));
        if (!o) continue;
        if (x.t > 0) w = Math.max(w, dist(o.omega, x.omega));
        const e = euler321(transpose(quatToMatrix(o.q)));
        a = Math.max(a, ...[e.roll, e.pitch, e.yaw].map((y, i) => angDiff(y, x.euler[i])));
      }
      dw = Math.min(dw, w); da = Math.min(da, a);
    }
    console.log(`  ${key.padEnd(4)} closest tool: rates ${dw.toExponential(1)} rad/s, attitude ${(da * R2D).toExponential(1)} deg  ${c.title}`);
    worstW = Math.max(worstW, dw); worstA = Math.max(worstA, da);
  }
  console.log(`  against sixdof.js's own 6-DOF run: rates within ${worstOurs.toExponential(1)} rad/s`);
  check('body rates within 1e-10 rad/s of a NASA tool in every rotation case (8 h)', worstW < 1e-10);
  check('attitude within 1e-6 deg of a NASA tool in every rotation case', worstA * R2D < 1e-6);
  check('the stepper on a given translation matches sixdof.js integrating both (1e-12 rad/s)', worstOurs < 1e-12);
}

header('2. TURNS UNDER THE TORQUE LIMIT');
// The app's craft (DEFAULT_ATTITUDE): 40 N m about the 1,625 kg m^2 pitch
// and yaw axes (alpha 1.41 deg/s^2), 20 N m about the 1,000 kg m^2 roll
// axis, 3 deg/s at most. A turn is done when it locks: within 1e-4 rad
// and 2e-4 rad/s of its reference.
const spec = { inertia: DEFAULT_ATTITUDE.inertia, torqueMax: DEFAULT_ATTITUDE.torqueMax, rateMax: DEFAULT_ATTITUDE.rateMax };
{
  const far = () => ({ r: [4.2e7, 0, 0], v: [0, 3075, 0] });
  let worstPred = 0, belowBound = false;
  console.log('  turn, axis        settled   controller   bound (torque and rate limits)');
  for (const [deg, ax] of [[10, 2], [45, 2], [90, 1], [120, 0], [170, 2]]) {
    const th = deg * D2R, e = [0, 0, 0]; e[ax] = 1;
    const target = [Math.cos(th / 2), ...e.map((c) => c * Math.sin(th / 2))];
    const A = makeAttitude({ ...spec, gravityGradient: false, mode: 'inertial' });
    A.holdQ = target;
    let t = 0;
    while (t < 300 && !A.locked) { t += 1 / 60; advanceAttitude(A, t, { key: 'x', mu: MU, at: far }); }
    const p = slewTime(spec, th, e), m = minSlewTime(th, alphaAbout(spec, e), spec.rateMax);
    console.log(`  ${String(deg).padStart(3)} deg about ${'xyz'[ax]}    ${t.toFixed(2).padStart(6)} s   ${p.toFixed(2).padStart(6)} s (${((t / p - 1) * 100).toFixed(1)}%)   ${m.toFixed(2).padStart(6)} s (+${((t / m - 1) * 100).toFixed(1)}%)`);
    worstPred = Math.max(worstPred, Math.abs(t / p - 1));
    if (t < m) belowBound = true;
  }
  check('no turn is faster than the torque and rate limits allow (bang-coast-bang)', !belowBound);
  check('each turn settles within 6 % of the controller\'s closed-form time', worstPred < 0.06);
}
{
  // Slew to prograde by the craft the app flies: in a 400 km orbit,
  // inertially held with its axis 90 deg from prograde (toward the
  // outward radial, about the orbit normal), then told to point prograde.
  // Frames of 1/60 s through Craft, the kernel stepping its orbit.
  const START = new Date('2026-11-04T00:00:00Z'), T0 = kernelSeconds(START);
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), host = createKernelHost();
  const E = helioStateEqj('earth', START), rk = 6778.137, vc = Math.sqrt(398600.4355 / rk);
  const c = new Craft({ name: 'slew', r: [E.r[0] + rk, E.r[1], E.r[2]], v: [E.v[0], E.v[1] + vc, E.v[2]], t: T0, sys, attitude: { mode: 'radial' } });
  const frame = (t) => { c.advanceClock(t); const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); };
  for (let k = 1; k <= 30; k++) frame(T0 + k / 60);
  c.att.setMode('inertial');
  frame(T0 + 31 / 60);
  const env = c.att.env(), s = env.at(c.clockT), { V, N } = orbitalFrame(s.r, s.v);
  const err0 = attitudeError(c.att.q, pointing(V, N, V));
  c.att.setMode('prograde');
  const tStart = c.clockT;
  let t = tStart;
  while (!c.att.locked && t < tStart + 300) { t += 1 / 60; frame(t); }
  const took = t - tStart, p = slewTime(spec, err0.theta, err0.e), m = minSlewTime(err0.theta, alphaAbout(spec, err0.e), spec.rateMax);
  const n = vc / rk;
  console.log(`  90 deg slew to prograde at 400 km: ${(err0.theta * R2D).toFixed(2)} deg about body ${err0.e.map((x) => x.toFixed(3)).join(', ')}; settled in ${took.toFixed(2)} s, controller ${p.toFixed(2)} s, bound ${m.toFixed(2)} s`);
  console.log(`  (prograde turns ${(n * took * R2D).toFixed(2)} deg toward the craft in that time, at the mean motion ${(n * 1e3).toFixed(3)} mrad/s)`);
  check('the slew to prograde settles within 6 % of the time the torque limit gives the controller', Math.abs(took / p - 1) < 0.06);
  check('and within 10 % of the time-optimal bound', Math.abs(took / m - 1) < 0.1);
  const axisErr = Math.acos(Math.min(1, thrustAxis(c.att.q).reduce((a, x, i) => a + x * env.at(c.clockT).v[i] / norm(env.at(c.clockT).v), 0)));
  check('settled with the thrust axis on prograde (within 0.01 deg)', axisErr * R2D < 0.01);
}

header('3. A BURN ALONG THE BODY AXIS HELD PROGRADE');
// The same 400 km orbit, a 120 s burn of 5 kN on 1.5 t (Isp 320 s, about
// 410 m/s), then coasting to 600 s.
//   point mass   the kernel's burn steered prograde ('vnb', [1, 0, 0])
//   6-DOF        the app's craft holding prograde, the burn along its axis
//   coupled      sixdof.js integrating translation and attitude together
//                (RK4, 0.01 s), the app's controller in the loop, sampled
//                every 0.1 s as the app samples it, the thrust along body
//                +x; and its point-mass twin, the thrust along the velocity
// Both kernel craft fly the planner's model (no drag or sunlight), with the
// Sun and the Moon; the coupled runs about a point-mass Earth.
{
  const START = new Date('2026-11-04T00:00:00Z'), T0 = kernelSeconds(START);
  // The kernel stepped directly on this body set (the host's own has the
  // Earth's J2, which the coupled runs leave out).
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS, zonal: false });
  const E = helioStateEqj('earth', START), MU_E = sys.bodyAt('earth', T0).mu, rk = 6778.137, vc = Math.sqrt(MU_E / rk);
  const r0 = [E.r[0] + rk, E.r[1], E.r[2]], v0 = [E.v[0], E.v[1] + vc * Math.cos(0.9), E.v[2] + vc * Math.sin(0.9)];
  const mk = (o) => new Craft({ name: 'b', r: r0, v: v0, t: T0, sys, bare: true, ...o });
  const frame = (c, t) => { c.advanceClock(t); const req = c.buildRequest(); if (req) c.applyResult(stepCraft(sys, req)); };
  const tb0 = 20, tb1 = 140, tEnd = 600;
  const pm = mk({}), sx = mk({ attitude: { mode: 'prograde' } }), sl = mk({ attitude: { mode: 'prograde' } });
  pm.burns.push({ t0: T0 + tb0, t1: T0 + tb1, dir: [1, 0, 0], F: pm.thrust, m0: pm.mass, mdot: pm.thrust / pm.ve, kind: 'manual', frame: 'vnb', about: 'earth' });
  // sl: starts 30 deg off prograde (held inertially) and is told to point
  // prograde as the burn starts, so it burns through the turn.
  const env0 = sl.att.env(), s0 = env0.at(T0), F0 = orbitalFrame(s0.r, s0.v);
  const off = 30 * D2R, x0 = F0.V.map((c, i) => Math.cos(off) * c + Math.sin(off) * F0.I[i]);
  sl.att.A.q = pointing(x0, F0.N, F0.V); sl.att.A.holdQ = [...sl.att.A.q]; sl.att.A.locked = false; sl.att.setMode('inertial');
  let ms = 0;
  for (let k = 1; k <= tEnd * 4; k++) {
    const t = T0 + k / 4;
    frame(pm, t);
    const a = performance.now(); frame(sx, t); frame(sl, t); ms += performance.now() - a;
    // At the frame that reaches the burn's start: the turn and the burn
    // (along the body axis) from there.
    if (k === tb0 * 4) {
      // (The point mass burns from the held craft's mass: the hold's limit
      // cycle has taken 78 mg from its tank by then, which alone would put
      // them 1 cm apart at 600 s.)
      pm.burns[0].m0 = sx.mass;
      for (const c of [sx, sl]) { if (c === sl) c.att.setMode('prograde'); c.burns.push({ t0: t, t1: T0 + tb1, dir: c.bodyAxis, F: c.thrust, m0: c.mass, mdot: c.thrust / c.ve, kind: 'manual', axis: true }); }
    }
  }
  const dSx = dist(pm.kState.r, sx.kState.r) * 1e3, dSl = dist(pm.kState.r, sl.kState.r) * 1e3;
  const dv = pm.ve * Math.log((pm.dryMass + 500) / (pm.dryMass + pm.fuel));
  console.log(`  burn: ${dv.toFixed(1)} m/s; at ${tEnd} s the 6-DOF craft held prograde is ${dSx.toExponential(2)} m from the point-mass one`);
  console.log(`  started 30 deg off and turning as it burns: ${dSl.toFixed(1)} m from it (the turn costs it the thrust's cosine for ~${(30 / 3).toFixed(0)} s)`);
  check('held prograde, the body-axis burn flies the point-mass prograde burn (within 1 mm)', dSx < 1e-3);

  // The coupled reference, about a point-mass Earth (m, m/s, geocentric).
  const geoR = r0.map((x, i) => (x - E.r[i]) * 1e3), geoV = v0.map((x, i) => (x - E.v[i]) * 1e3);
  const F = pm.thrust, mdot = F / pm.ve, m0 = 1500;
  const massAt = (t) => (t <= tb0 ? m0 : m0 - mdot * (Math.min(t, tb1) - tb0));
  const coupled = (startOff, steer) => {
    const A = makeAttitude({ ...spec, mode: 'prograde' });
    // Sampled: worked out from the state at the start of each period (the
    // first stage of the step that starts there) and held through it. The
    // reference turns with the velocity under gravity: omega = V x a / |v|.
    let held = [0, 0, 0], tSample = -Infinity;
    const control = (t, r, v, q, w) => {
      if (t < tb0 && startOff) return [0, 0, 0];                     // held inertially until the burn
      if (t >= tSample + CONTROL_PERIOD - 1e-9) {
        const { V, N } = orbitalFrame(r, v), k = -MU_E * 1e9 / norm(r) ** 3, vn = norm(v);
        const wRef = [V[1] * r[2] - V[2] * r[1], V[2] * r[0] - V[0] * r[2], V[0] * r[1] - V[1] * r[0]].map((x) => x * k / vn);
        held = controlTorque(A, q, w, { q: pointing(V, N, V), w: wRef }).tau;
        tSample = Math.round(t / CONTROL_PERIOD) * CONTROL_PERIOD;
      }
      return held;
    };
    const model = makeModel({ mu: MU_E * 1e9, field: null, inertia: spec.inertia, massAt, force: (t) => (t >= tb0 && t < tb1 ? [F, 0, 0] : null), control: steer ? control : null, breakpoints: [tb0, tb1] });
    const Fr = orbitalFrame(geoR, geoV), x = startOff ? Fr.V.map((c, i) => Math.cos(off) * c + Math.sin(off) * Fr.I[i]) : Fr.V;
    const q0 = pointing(x, Fr.N, Fr.V), n0 = norm(geoV) / norm(geoR) * Math.cos(0);
    const w0 = startOff ? [0, 0, 0] : transpose(quatToMatrix(q0)).map((row) => (row[0] * Fr.N[0] + row[1] * Fr.N[1] + row[2] * Fr.N[2]) * n0);
    return propagate6dof(model, { t: 0, r: geoR, v: geoV, q: q0, omega: w0 }, { tEnd, h: 0.01, outEvery: tEnd });
  };
  // The point-mass twin: RK4 at 0.01 s, the thrust along the velocity.
  const pointMass = () => {
    let r = [...geoR], v = [...geoV];
    const acc = (t, rr, vv) => { const k = -MU_E * 1e9 / norm(rr) ** 3, on = t >= tb0 && t < tb1, a = rr.map((x) => k * x); if (on) { const vn = norm(vv); for (let i = 0; i < 3; i++) a[i] += F / massAt(t) * vv[i] / vn; } return a; };
    for (let t = 0, h = 0.01; t < tEnd - 1e-9; t += h) {
      const k1v = acc(t, r, v), k1r = v;
      const k2v = acc(t + h / 2, r.map((x, i) => x + h / 2 * k1r[i]), v.map((x, i) => x + h / 2 * k1v[i])), k2r = v.map((x, i) => x + h / 2 * k1v[i]);
      const k3v = acc(t + h / 2, r.map((x, i) => x + h / 2 * k2r[i]), v.map((x, i) => x + h / 2 * k2v[i])), k3r = v.map((x, i) => x + h / 2 * k2v[i]);
      const k4v = acc(t + h, r.map((x, i) => x + h * k3r[i]), v.map((x, i) => x + h * k3v[i])), k4r = v.map((x, i) => x + h * k3v[i]);
      r = r.map((x, i) => x + h / 6 * (k1r[i] + 2 * k2r[i] + 2 * k3r[i] + k4r[i]));
      v = v.map((x, i) => x + h / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
    }
    return { r, v };
  };
  const cHeld = coupled(false, true), cTurn = coupled(true, true), cPm = pointMass();
  const dHeld = dist(cHeld.r, cPm.r), dTurn = dist(cTurn.r, cPm.r);
  const Eend = helioStateEqj('earth', new Date(kernelMs(T0 + tEnd)));
  const toGeo = (c) => c.kState.r.map((x, i) => (x - Eend.r[i]) * 1e3);
  const kHeld = dist(toGeo(sx), cHeld.r), kTurn = dist(toGeo(sl), cTurn.r), kPm = dist(toGeo(pm), cPm.r);
  console.log(`  coupled (sixdof.js, controller in the loop): held ${dHeld.toFixed(3)} m, started 30 deg off ${dTurn.toFixed(1)} m from its point-mass twin`);
  console.log(`  kernel against coupled, about the same Earth (the kernel's Sun and Moon included): point mass ${kPm.toFixed(2)} m, held ${kHeld.toFixed(2)} m, turning ${kTurn.toFixed(2)} m`);
  check('coupled, a controller holding prograde flies the point-mass burn to within 1 m', dHeld < 1);
  check('the kernel\'s point-mass burn within 1 m of the coupled point-mass twin (the Sun\'s and Moon\'s tides)', kPm < 1);
  check('the app\'s held burn within 1 m of the coupled controller holding prograde', kHeld < 1);
  check('the app\'s burn through a 30 deg turn (sampled controller, pieces to the kernel) within 5 m of the coupled one', kTurn < 5);
  console.log(`  cost: the two 6-DOF craft's frames ${(ms / (tEnd * 4)).toFixed(3)} ms each on average (attitude and kernel)`);
}

header('4. THE AERODYNAMIC TORQUE: A WEATHERVANE');
// The craft in still air of density rho at 7.8 km/s, the centre of
// pressure 0.3 m behind the centre of mass: displaced a little in pitch it
// swings about the airflow at omega = sqrt(q CdA |cp| / I_yy), q = rho v^2 / 2
// (the small-angle restoring torque q CdA |cp| theta).
{
  const rho = 2.5e-10, v = 7800, cdA = 11, I = spec.inertia[1][1], cp = DEFAULT_ATTITUDE.cp;
  const at = () => ({ r: [6.6e6, 0, 0], v: [v, 0, 0] });
  const air = { earthFixed: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]], density: () => rho, omegaEarth: 0 };
  const th0 = 2 * D2R;
  const A = makeAttitude({ ...spec, cp, cdA, q: [Math.cos(th0 / 2), 0, Math.sin(th0 / 2), 0], mode: 'off', gravityGradient: false });
  const env = { key: 'earth', mu: MU, at, air };
  // Zero crossings of the pitch angle.
  let last = null, crossings = [];
  for (let t = 0; t < 3000; t += 1) {
    advanceAttitude(A, t + 1, env);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -quatToMatrix(A.q)[2][0])));
    if (last !== null && Math.sign(pitch) !== Math.sign(last)) crossings.push(t + 1 - pitch / (pitch - last));
    last = pitch;
  }
  const period = 2 * (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
  const want = 2 * Math.PI / Math.sqrt(0.5 * rho * v * v * cdA * Math.abs(cp[0]) / I);
  console.log(`  at ${rho.toExponential(1)} kg/m^3 (about 200 km): period ${period.toFixed(1)} s, small-angle ${want.toFixed(1)} s (${crossings.length} crossings)`);
  check('the weathervane swings at the small-angle frequency (within 0.5 %)', Math.abs(period / want - 1) < 0.005);
}

header('5. COST: A HELD CRAFT AT HIGH WARP');
// Two days at a day a second (1/60 day a frame), the kernel stepping: the
// 6-DOF craft held prograde against its point-mass twin.
{
  const START = new Date('2026-11-04T00:00:00Z'), T0 = kernelSeconds(START);
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), host = createKernelHost();
  const E = helioStateEqj('earth', START), rk = 6778.137, vc = Math.sqrt(398600.4355 / rk);
  const mk = (o) => new Craft({ name: 'warp', r: [E.r[0] + rk, E.r[1], E.r[2]], v: [E.v[0], E.v[1] + vc, E.v[2]], t: T0, sys, ...o });
  const frame = (c, t) => { c.advanceClock(t); const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); c.displayState(); };
  const pm = mk({}), sx = mk({ attitude: { mode: 'prograde' } });
  const steps0 = sx.att.A.steps;
  let tp = 0, ts = 0;
  for (let k = 1; k <= 120; k++) {
    const t = T0 + k * 1440;
    let a = performance.now(); frame(pm, t); tp += performance.now() - a;
    a = performance.now(); frame(sx, t); ts += performance.now() - a;
  }
  console.log(`  ${sx.att.A.steps - steps0} attitude steps; a frame ${(ts / 120).toFixed(2)} ms against ${(tp / 120).toFixed(2)} ms for the point mass (kernel and drawn carry in both)`);
  check('a craft locked on its reference takes no attitude steps at high warp', sx.att.A.steps === steps0 && sx.att.locked);
  check('and costs no more than 0.5 ms a frame over a point mass', (ts - tp) / 120 < 0.5);
}

header('6. THE THRUSTERS\' PROPELLANT');
// Rest to rest about a principal axis, the torque about it is all the
// angular momentum it gains and loses: the integral of |tau| is
// 2 I omega_peak (omega_peak the rate limit when the turn reaches it, else
// the controller's peak), whatever the profile. The thrusters are couples
// rcsArm from the axis, so their total impulse is that over the arm, and
// the propellant J / (Isp g0) (Isp's definition: Curtis, 4th ed., §13.3).
const G0 = 9.80665;
{
  const sp = { ...spec, rcsArm: DEFAULT_ATTITUDE.rcsArm };
  const far = () => ({ r: [4.2e7, 0, 0], v: [0, 3075, 0] });
  let worst = 0;
  console.log('  turn, axis        impulse    closed form      propellant');
  for (const [deg, ax] of [[10, 2], [90, 1], [120, 0], [170, 2]]) {
    const th = deg * D2R, e = [0, 0, 0]; e[ax] = 1;
    const A = makeAttitude({ ...sp, gravityGradient: false, mode: 'inertial' });
    A.holdQ = [Math.cos(th / 2), ...e.map((c) => c * Math.sin(th / 2))];
    let t = 0;
    while (t < 300 && !A.locked) { t += 1 / 60; advanceAttitude(A, t, { key: 'x', mu: MU, at: far }); }
    // The peak: the rate limit, or slewTime's triangle short of it.
    const a = alphaAbout(sp, e), b = 0.8 * a, c = b * 0.4, A2 = 1 / (2 * a) + 1 / (2 * b), B1 = c / b;
    const wp = Math.min(sp.rateMax, (-B1 + Math.sqrt(B1 * B1 + 4 * A2 * th)) / (2 * A2));
    const want = 2 * sp.inertia[ax][ax] * wp / sp.rcsArm[ax];
    worst = Math.max(worst, Math.abs(A.rcsImpulse / want - 1));
    console.log(`  ${String(deg).padStart(3)} deg about ${'xyz'[ax]}    ${A.rcsImpulse.toFixed(2).padStart(7)} N s  ${want.toFixed(2).padStart(7)} N s (${((A.rcsImpulse / want - 1) * 100).toFixed(2)}%)   ${(A.rcsImpulse / (DEFAULT_ATTITUDE.rcsIsp * G0) * 1e3).toFixed(1)} g`);
  }
  check('each turn\'s thruster impulse within 1 % of 2 I omega_peak / arm', worst < 0.01);
  // By hand, 90 deg in pitch: 2 x 1,625 kg m^2 x 3 deg/s / 1 m = 170.2 N s,
  // 170.2 / (290 x 9.80665) = 59.8 g.
  check('rcsThrust: a pitch torque of 40 N m on 1 m arms takes 40 N, and 20 N m of roll on 0.5 m arms 40 N', rcsThrust(sp, [0, 40, 0]) === 40 && rcsThrust(sp, [20, 0, 0]) === 40 && rcsThrust(sp, [20, -40, 40]) === 120);

  // Through the craft: the slew of section 2, frame by frame, the tank
  // drawn by the thrusters' impulse and nothing else.
  const START = new Date('2026-11-04T00:00:00Z'), T0 = kernelSeconds(START);
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), host = createKernelHost();
  const E = helioStateEqj('earth', START), rk = 6778.137, vc = Math.sqrt(398600.4355 / rk);
  const c = new Craft({ name: 'rcs', r: [E.r[0] + rk, E.r[1], E.r[2]], v: [E.v[0], E.v[1] + vc, E.v[2]], t: T0, sys, attitude: { mode: 'radial' } });
  const frame = (t) => { c.advanceClock(t); const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); };
  for (let k = 1; k <= 30; k++) frame(T0 + k / 60);
  const fuel0 = c.fuel, J0 = c.att.A.rcsImpulse;
  c.att.setMode('prograde');
  let t = c.clockT;
  while (!c.att.locked && t < T0 + 300) { t += 1 / 60; frame(t); }
  const J = c.att.A.rcsImpulse - J0, want = 2 * 1625 * spec.rateMax / 1, used = fuel0 - c.fuel;
  console.log(`  90 deg slew to prograde in low orbit: ${J.toFixed(2)} N s (closed form ${want.toFixed(2)} N s), ${(used * 1e3).toFixed(2)} g from the tank, ${(c.att.rcsSpent * 1e3).toFixed(2)} g counted`);
  check('the craft\'s slew to prograde within 1 % of 2 I omega_max / arm (the orbital frame turning under it)', Math.abs(J / want - 1) < 0.01);
  check('the tank loses J / (Isp g0), to 1e-12 kg', Math.abs(used - J / (DEFAULT_ATTITUDE.rcsIsp * G0)) < 1e-12);
  // Held there, against the gravity gradient: the impulse is the hold's
  // limit cycle (section 9), each frame's (its disturbance found at the
  // frame's start) for its second.
  const Jl = c.att.A.rcsImpulse, tl = c.clockT;
  let wantHeld = 0, wantDist = 0;
  for (let k = 1; k <= 60; k++) { frame(tl + k); wantHeld += holdThrust(c.att.A.spec, c.att.A.disturbance); wantDist += rcsThrust(c.att.A.spec, c.att.A.disturbance); }
  const held = c.att.A.rcsImpulse - Jl, hold = c.att.hold();
  console.log(`  held prograde for 60 s: ${held.toExponential(3)} N s (the limit cycle's mean: ${wantHeld.toExponential(3)} N s; the ${norm(c.att.A.disturbance).toExponential(1)} N m of gravity gradient alone: ${wantDist.toExponential(3)} N s); ${(hold.rate * 86400).toFixed(3)} kg a day, regimes ${hold.axes.map((a) => a.regime).join(', ')}`);
  // (to 1e-6: a frame's second is the difference of clock times near 1e9 s)
  check('held, it pays the limit cycle\'s mean (to 1e-6 relative), far more than the disturbance alone', c.att.locked && wantHeld > 0 && Math.abs(held / wantHeld - 1) < 1e-6 && held > 100 * wantDist);
  check('the readout\'s hold rate is the same impulse at the thrusters\' Isp', Math.abs(hold.rate * 60 / (wantHeld / (DEFAULT_ATTITUDE.rcsIsp * G0)) - 1) < 1e-6);
  // An empty tank: the thrusters stop and the engine is cut.
  c.fuel = 1e-6; c.att.setMode('radial');
  frame(c.clockT + 1);
  check('with the tank emptied by the thrusters, control goes off and the tank stays at 0', c.att.mode === 'off' && c.fuel === 0 && c.log.some((x) => /tank empty: attitude thrusters off/.test(x.text)));
}

header('7. INERTIA THAT FALLS WITH THE PROPELLANT');
// Two equal spherical tanks of radius R on the thrust axis, d fore and aft
// of the centre of mass: about x, 2/5 m R^2; about y and z, m d^2 more
// (the parallel-axis theorem: Curtis, 4th ed., ch. 9). R 0.37 m, d 0.6 m.
{
  const T = DEFAULT_ATTITUDE.tanks, P = propellantInertia(500, T);
  const sx = 0.4 * 500 * 0.37 ** 2, syz = sx + 500 * 0.36;
  check(`500 kg in the tanks: ${P[0][0].toFixed(2)} kg m^2 about x (2/5 m R^2 = ${sx.toFixed(2)}), ${P[1][1].toFixed(2)} about y and z (+ m d^2 = ${syz.toFixed(2)})`, Math.abs(P[0][0] - sx) < 1e-9 && Math.abs(P[1][1] - syz) < 1e-9 && P[2][2] === P[1][1] && P[0][1] === 0);
  const full = inertiaFor(DEFAULT_ATTITUDE, 500), dry = inertiaFor(DEFAULT_ATTITUDE, 0), half = inertiaFor(DEFAULT_ATTITUDE, 250);
  console.log(`  full: diag(${full.map((r, i) => r[i].toFixed(1)).join(', ')}); half: diag(${half.map((r, i) => r[i].toFixed(1)).join(', ')}); dry: diag(${dry.map((r, i) => r[i].toFixed(1)).join(', ')}) kg m^2`);
  check('full, the tensor is the 2 x 2 x 3 m box\'s diag(1000, 1625, 1625)', full.every((r, i) => r.every((x, j) => Math.abs(x - DEFAULT_ATTITUDE.inertia[i][j]) < 1e-9)));
  check('dry, the box less the full tanks: diag(972.62, 1417.62, 1417.62); linear in the propellant between', Math.abs(dry[0][0] - (1000 - sx)) < 1e-9 && Math.abs(dry[1][1] - (1625 - syz)) < 1e-9 && Math.abs(half[1][1] - (dry[1][1] + full[1][1]) / 2) < 1e-9);

  // A craft burned down to 50 kg: its tensor follows the tank, and its 90
  // deg slew settles in the controller's closed-form time for that inertia
  // (faster than full: alpha = 40 N m / I_yy).
  const START = new Date('2026-11-04T00:00:00Z'), T0 = kernelSeconds(START);
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), host = createKernelHost();
  const E = helioStateEqj('earth', START), rk = 6778.137, vc = Math.sqrt(398600.4355 / rk);
  const c = new Craft({ name: 'light', r: [E.r[0] + rk, E.r[1], E.r[2]], v: [E.v[0], E.v[1] + vc, E.v[2]], t: T0, sys, attitude: { mode: 'radial' } });
  const frame = (t) => { c.advanceClock(t); const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); };
  c.fuel = 50;
  for (let k = 1; k <= 30; k++) frame(T0 + k / 60);
  const I = c.att.spec.inertia, want = inertiaFor(DEFAULT_ATTITUDE, c.fuel);
  check(`the craft's tensor follows its tank: I_yy ${I[1][1].toFixed(2)} kg m^2 at ${c.fuel.toFixed(3)} kg`, I.every((r, i) => r.every((x, j) => Math.abs(x - want[i][j]) < 1e-6)));
  const env = c.att.env(), s = env.at(c.clockT), { V, N } = orbitalFrame(s.r, s.v);
  const err0 = attitudeError(c.att.q, pointing(V, N, V));
  c.att.setMode('prograde');
  const tStart = c.clockT, specNow = { ...spec, inertia: c.att.spec.inertia };
  let t = tStart;
  while (!c.att.locked && t < tStart + 300) { t += 1 / 60; frame(t); }
  const took = t - tStart, p = slewTime(specNow, err0.theta, err0.e), pFull = slewTime(spec, err0.theta, err0.e);
  console.log(`  90 deg slew at ${c.fuel.toFixed(1)} kg of propellant: ${took.toFixed(2)} s, controller ${p.toFixed(2)} s for I_yy ${specNow.inertia[1][1].toFixed(1)} (full: ${pFull.toFixed(2)} s)`);
  check('the near-empty craft settles within 6 % of slewTime for its inertia then, and sooner than full', Math.abs(took / p - 1) < 0.06 && took < pFull);
  // setInertia: the torque-free body under a pulse turns at tau t / I.
  const B = makeAttitude({ inertia: full, torqueMax: [1, 1, 1], mode: 'off', gravityGradient: false, torque: (tt) => (tt < 10 ? [0, 5, 0] : null), breakpoints: [10], fixedStep: 0.5 });
  setInertia(B, dry);
  advanceAttitude(B, 10, { key: 'x', mu: MU, at: () => ({ r: [4.2e7, 0, 0], v: [0, 3075, 0] }) });
  check(`with setInertia, a 5 N m pulse for 10 s turns the dry body at tau t / I_yy = ${(50 / dry[1][1]).toExponential(4)} rad/s`, Math.abs(B.omega[1] - 50 / dry[1][1]) < 1e-12);
}

header('8. THE NODE AUTO-TURN');
// A craft in a 400 km orbit holding prograde; a node an hour ahead (or
// 600 s frames) of 20 m/s radial out: a 90 deg turn. Its twin is a point
// mass with the same node, its burn along the node's direction.
{
  const START = new Date('2026-11-04T00:00:00Z'), T0 = kernelSeconds(START);
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), host = createKernelHost();
  const E = helioStateEqj('earth', START), rk = 6778.137, vc = Math.sqrt(398600.4355 / rk);
  const mk = (o) => new Craft({ name: 'auto', r: [E.r[0] + rk, E.r[1], E.r[2]], v: [E.v[0], E.v[1] + vc * Math.cos(0.9), E.v[2] + vc * Math.sin(0.9)], t: T0, sys, ...o });
  const frame = (c, t) => { c.advanceClock(t); const req = c.buildRequest(); if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]); c.displayState(); };
  const run = (dt, lead, tEnd) => {
    const pm = mk({}), sx = mk({ attitude: { mode: 'prograde' } });
    for (const c of [pm, sx]) c.addNode(T0 + lead, [0.02, 0, 0]);
    const predicted = AUTO_MARGIN * slewTime(spec, Math.PI / 2, [0, 0, 1]) + AUTO_PAD;
    let settledBy = null, axisErr = null;
    for (let t = T0 + dt; t <= T0 + tEnd + 1e-9; t += dt) {
      frame(pm, t); frame(sx, t);
      if (settledBy === null && sx.att.locked && sx.att.mode === 'node') settledBy = t - T0;
      if (axisErr === null && sx.executing) axisErr = Math.acos(Math.min(1, dot3(sx.bodyAxis, sx.executing.burn.nodeDir))) * R2D;
    }
    const turnNote = sx.log.find((x) => /° to the node, /.test(x.text));
    return { pm, sx, predicted, settledBy, axisErr, turnAt: turnNote ? turnNote.t - T0 : null, d: dist(pm.kState.r, sx.kState.r) * 1e3 };
  };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = run(0.25, 3600, 3700);
  console.log(`  1/4 s frames: turn began ${(3600 - a.turnAt).toFixed(2)} s before the node (AUTO_MARGIN slewTime + AUTO_PAD = ${a.predicted.toFixed(2)} s), locked ${(3600 - a.settledBy).toFixed(2)} s before it`);
  console.log(`  burning ${a.axisErr?.toExponential(1)} deg off the node's direction; ${a.d.toFixed(3)} m from the point-mass twin after; mode now ${a.sx.att.mode}; thrusters ${(a.sx.att.rcsSpent * 1e3).toFixed(1)} g`);
  check('the turn starts AUTO_MARGIN slewTime + AUTO_PAD before the node (to a frame)', Math.abs(3600 - a.turnAt - a.predicted) < 0.25);
  check('and settles before the node fires', a.settledBy !== null && a.settledBy < 3600);
  check('the node burns along its direction (within 0.01 deg) and flies the point-mass node burn to within 0.1 m', a.axisErr < 0.01 && a.d < 0.1);
  check('after the burn, back to prograde', a.sx.att.mode === 'prograde' && !a.sx.log.some((x) => /too late/.test(x.text)));
  // At 600 s frames the turn, the burn and the return fall inside one frame.
  const b = run(600, 3600, 4200);
  console.log(`  600 s frames: turn began ${(3600 - b.turnAt).toFixed(2)} s before the node; ${b.d.toFixed(3)} m from the twin; mode now ${b.sx.att.mode}`);
  // (The node's direction is fixed once its burn is set up, at the start of
  // the frame it falls in, while prograde turns at the mean motion: the
  // turn is measured where both will be.)
  const bNote = b.sx.log.find((x) => /to the node/.test(x.text))?.text;
  console.log(`  "${bNote}"`);
  check('at 600 s frames the turn starts within 3 % of the same lead, settles in time and flies the twin\'s burn to within 0.1 m, back to prograde', Math.abs((3600 - b.turnAt) / a.predicted - 1) < 0.03 && b.d < 0.1 && b.sx.att.mode === 'prograde' && !b.sx.log.some((x) => /too late/.test(x.text)));
  // A node 10 s ahead: too late to settle, and the log says so.
  const c = mk({ attitude: { mode: 'prograde' } });
  c.addNode(T0 + 10, [0.02, 0, 0]);
  for (let t = T0 + 0.25; t <= T0 + 20; t += 0.25) frame(c, t);
  const late = c.log.find((x) => /too late to settle/.test(x.text));
  console.log(`  node 10 s ahead: "${late?.text}"`);
  check('a node too close to turn for: the log says it cannot settle in time', !!late);
  // Off: no turn by itself.
  const d = mk({ attitude: { mode: 'prograde', autoNode: false } });
  d.addNode(T0 + 120, [0.02, 0, 0]);
  for (let t = T0 + 1; t <= T0 + 100; t += 1) frame(d, t);
  check('with autoNode off, it stays on prograde', d.att.mode === 'prograde' && d.att.locked);
}

header('9. THE HOLD\'S LIMIT CYCLE');
// A locked hold is not integrated, so its thrusters are charged the limit
// cycle's mean in closed form (attitude.js limitCycle). Here the deadband
// controller is flown pulse by pulse instead, an axis at a time: sampled
// every CONTROL_PERIOD, it fires one minimum bit (a couple, both
// thrusters: the rate changes by dw = 2 b L / I) whenever the error is
// past the deadband and still growing, under a constant disturbance
// torque. Its mean thrust over the last 60 % of the run (the rest left to
// settle) is compared with the closed form, for the default craft's pitch
// and roll axes, from random starts within the deadband. With
// 1/4 < eps < 3/4 some starts ride a one-sided cycle for hundreds of
// cycles before the sampling tips them into two pulses to one, so those
// run 3,000 cycles (a week of holding).
//
// The reference: Jackson, Gonzalez and Sims [AIAA GN&C 2007, NTRS
// 20080000345], the centred two-sided cycle with no disturbance, a firing
// every 4 theta_DB / (theta'' t_min) (their eq. (1)) and the propellant
// rate n f theta'' t_min^2 / (4 Isp theta_DB) (eq. (2)), with n = 2
// thrusters a firing, f t_min = b and theta'' t_min = dw.
{
  const sp = { ...DEFAULT_ATTITUDE, inertia: DEFAULT_ATTITUDE.inertia };
  const b = sp.impulseBit, d = sp.deadband;
  // Pulse by pulse: { thrust (N, the mean), gap (s, the mean time between
  // firings) } over T s, the first 40 % left out.
  const fly = (ax, tau, th0, w0, T) => {
    const I = sp.inertia[ax][ax], L = sp.rcsArm[ax], dw = 2 * b * L / I, a = tau / I, h = CONTROL_PERIOD;
    let th = th0, w = w0, n = 0, n0 = 0, t = 0, t0 = 0;
    const N = Math.round(T / h), N0 = Math.round(0.4 * N);
    for (let k = 0; k < N; k++) {
      if (k === N0) { n0 = n; t0 = t; }
      if (th > d && w > 0) { w -= dw; n++; } else if (th < -d && w < 0) { w += dw; n++; }
      th += w * h + a * h * h / 2; w += a * h; t += h;
    }
    return { thrust: (n - n0) * 2 * b / (t - t0), gap: (t - t0) / (n - n0) };
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const G0s = DEFAULT_ATTITUDE.rcsIsp * G0;
  // No disturbance, centred: the textbook's worst case.
  for (const ax of [1, 0]) {
    const I = sp.inertia[ax][ax], L = sp.rcsArm[ax], dw = 2 * b * L / I, cyc = limitCycle(sp, [0, 0, 0])[ax];
    const R2 = 1.5 * cyc.thrust;
    const sim = fly(ax, 0, 0, dw / 2, 20 * cyc.period);
    // (eq. (2) in SI: n f theta'' t_min^2 / (4 Isp g0 theta_DB) kg/s, so
    // n b dw / (4 theta_DB) of thrust)
    const gapJ = 4 * d / dw, mdotJ = 2 * b * dw / (4 * G0s * d);
    console.log(`  ${'xyz'[ax]}: centred, no disturbance: a firing every ${sim.gap.toFixed(2)} s (Jackson eq. (1): ${gapJ.toFixed(2)} s), ${(sim.thrust / G0s * 86400).toFixed(4)} kg a day (eq. (2): ${(mdotJ * 86400).toFixed(4)} kg a day)`);
    check(`${'xyz'[ax]}: the centred cycle flown pulse by pulse is Jackson et al.'s, eqs. (1) and (2), to 0.5 %`, Math.abs(sim.gap / gapJ - 1) < 5e-3 && Math.abs(sim.thrust / G0s / mdotJ - 1) < 5e-3);
    check(`${'xyz'[ax]}: the closed form without a disturbance is 2/3 of eq. (2), whose thrust is b^2 L / (deadband I)`, Math.abs(cyc.thrust / G0s / (2 / 3 * mdotJ) - 1) < 1e-12 && Math.abs(R2 / (b * b * L / (d * I)) - 1) < 1e-12);
  }
  // A disturbance eps R2 / L: the mean of six starts against the closed
  // form. Two-sided drifting (eps < 2/9) and one-sided (eps >= 3/4):
  // within 6 %. In the band 9/64 < eps < 1/4, where the drifting cycle
  // gives way to two pulses to one and their mixtures, within 50 %. Two
  // pulses to one (2/9 <= eps < 3/4): flown from that cycle (leaving the
  // upwind edge at dw / 2), within 1 %; from random starts, between the
  // one-sided cycle's third of it and all of it.
  console.log('  axis  eps     regime     closed form   flown (mean of 6, min-max)  kg a day');
  let worstOut = 0, worstIn = 0, worstTwo = 0, twoOk = true;
  for (const ax of [1, 0]) {
    const I = sp.inertia[ax][ax], L = sp.rcsArm[ax], dw = 2 * b * L / I, R2 = b * b * L / (d * I);
    for (const eps of [0.003, 0.03, 0.1, 0.15, 0.2, 0.4, 0.6, 0.9, 2, 5]) {
      const tau = [0, 0, 0]; tau[ax] = eps * R2 * L;
      const cyc = limitCycle(sp, tau)[ax];
      const T = (cyc.regime === 'drift' ? Math.max(300, 20 / eps) : cyc.regime === 'two-one' ? 1000 : 100) * cyc.period;
      const runs = Array.from({ length: 6 }, () => fly(ax, tau[ax], (2 * rnd() - 1) * d, (2 * rnd() - 1) * dw, T).thrust);
      const mean = runs.reduce((x, y) => x + y) / runs.length, err = Math.abs(mean / cyc.thrust - 1);
      const band = eps > 9 / 64 && eps < 1 / 4;
      let own = '';
      if (cyc.regime === 'two-one') {
        const f = fly(ax, tau[ax], -d, dw / 2, 200 * cyc.period).thrust;
        worstTwo = Math.max(worstTwo, Math.abs(f / cyc.thrust - 1));
        twoOk &&= runs.every((x) => x > cyc.thrust / 3 * 0.97 && x < cyc.thrust * 1.03);
        own = `; from its own cycle ${(f / cyc.thrust).toFixed(3)}`;
      } else if (band) worstIn = Math.max(worstIn, err); else worstOut = Math.max(worstOut, err);
      console.log(`  ${'xyz'[ax]}     ${String(eps).padEnd(6)}  ${cyc.regime.padEnd(9)}  ${cyc.thrust.toExponential(3)} N   ${mean.toExponential(3)} N (${(Math.min(...runs) / cyc.thrust).toFixed(2)}-${(Math.max(...runs) / cyc.thrust).toFixed(2)})${band ? ' band' : ''}${own}   ${(cyc.thrust / G0s * 86400).toFixed(3)}`);
    }
  }
  check(`two-sided drifting and one-sided: the closed form is the flown cycles' mean within 6 % (worst ${(worstOut * 100).toFixed(1)} %)`, worstOut < 0.06);
  check(`two pulses to one, 3 |tau| / L: its own cycle flown within 1 % (worst ${(worstTwo * 100).toFixed(2)} %), and every random start between a third of it and all of it`, worstTwo < 0.01 && twoOk);
  check(`in the band 9/64 < eps < 1/4, within 50 % (worst ${(worstIn * 100).toFixed(1)} %)`, worstIn < 0.50);
  // Disturbance-dominated: exactly the disturbance's thrust.
  const big = limitCycle(sp, [0, 0.05, 0])[1];
  check('a disturbance past 3/4 of R2 is paid alone: one-sided, |tau| / L', big.regime === 'one-sided' && Math.abs(big.thrust - 0.05) < 1e-15);
  // The default craft's hold, no disturbance, by hand: pitch and yaw
  // R2 = 0.29^2 x 1 / (0.008727 x 1,625) = 5.93e-3 N, roll 0.29^2 x 0.5 /
  // (0.008727 x 1,000) = 4.82e-3 N; 2/3 of the sum 1.112e-2 N, 0.338 kg a
  // day at 290 s.
  const all = holdThrust(sp, [0, 0, 0]);
  console.log(`  the default craft held without a disturbance: ${all.toExponential(4)} N, ${(all / G0s * 86400).toFixed(3)} kg a day`);
  check('held without a disturbance, the default craft pays 1.112e-2 N (0.338 kg a day)', Math.abs(all - 1.112e-2) < 1e-5);
  check('without a deadband or a bit, a hold pays the disturbance alone', holdThrust({ ...sp, deadband: null }, [0, 1e-3, 0]) === rcsThrust(sp, [0, 1e-3, 0]));
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exitCode = failures ? 1 : 0;
