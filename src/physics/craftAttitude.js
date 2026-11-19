// src/physics/craftAttitude.js
//
// A craft's attitude as the app carries it (attitude.js), and its burns
// along the body axis. Kept on the main thread, frame by frame with the
// sim clock: the measurements behind that choice are in
// docs/physics/sixdof.md#where-the-attitude-is-carried.
//
// - The translation it turns on is the craft's drawn state, carried over a
//   frame along the two-body orbit about the primary (orbital.js
//   propagate) from where it was drawn the frame before (or from the
//   kernel's state, when nothing was drawn there). That is what the
//   pointing modes aim along and what the gravity gradient and the air act
//   on; a frame's thrust is left out of it (at a day a second a 5 kN burn on
//   1.5 t turns prograde 0.03 deg in a 1/60 s frame).
// - What the thrust axis did is kept as spans, back to the kernel's state:
//   a step's start and end directions, or a stretch locked on a reference.
//   A burn along the body axis goes to the kernel as pieces of those spans:
//   a locked pointing mode as a burn steered in the orbital frame (the
//   kernel's 'vnb' burns, exactly a point-mass craft's steered burn), any
//   other stretch along its mean direction. The kernel asks only up to the
//   clock, which the attitude has always reached.
// - Air for the aerodynamic torque is the Earth's alone (as the
//   environment's drag is), from atmosphere.js below 1,000 km, held for a
//   second at a time.
// - The attitude thrusters draw propellant from the craft's one tank, by
//   their total impulse at their Isp (attitude.js rcsThrust), frame by
//   frame after the engine's own draw (craft.js updateBurns). An empty tank
//   switches control off and cuts the engine.
// - Held locked, the thrusters pay the hold's limit cycle within the
//   deadband, its mean in closed form (attitude.js limitCycle): the
//   attitude shown and burned along is the cycle's centre, the reference.
// - The inertia follows the propellant: the dry craft's tensor plus the
//   propellant's, two equal spherical tanks on the thrust axis either side
//   of the centre of mass (propellantInertia), made again each frame the
//   tank has changed.
// - A manoeuvre node turns the craft to it by itself (autoNode, on by
//   default): early enough, by slewTime, to settle before it fires, and
//   back to the mode it had once the burn is done. The log says when it
//   cannot settle in time.

import { makeAttitude, advanceAttitude, limitCycle, setMode, setInertia, thrustAxis, pointingError, referenceNow, alphaAbout, slewTime, attitudeError, orbitalFrame, vnbToInertial, pointing, referenceAt } from './attitude.js';
import { propagate } from './orbital.js';
import { density } from './atmosphere.js';
import { bodyAxesEqj } from './orientation.js';
import { EARTH_ROTATION } from './environment.js';
import { dot, norm, unit } from './vec.js';

const D2R = Math.PI / 180;
const G0 = 9.80665;                      // m/s^2, standard gravity (as craft.js's)

// The app's own craft: 1.5 t (1,000 kg dry and 500 kg of propellant) in a
// 2 by 2 by 3 m box, long along the thrust axis, so I = m (b^2 + c^2) / 12
// about each axis: 1,000 kg m^2 about the long axis and 1,625 across it,
// full (inertia, at `propellant` kg in the tanks).
// Reaction thrusters: 20 N thrusters fired in pairs as couples, 0.5 m from
// the roll axis and 1 m from the pitch and yaw axes (rcsArm), so 20 N m in
// roll and 40 N m in pitch and yaw; bipropellant from the main tank at an
// Isp of 290 s (the class of ArianeGroup's 10 N thruster, 292 s); a
// 3 deg/s rate limit. Held, they keep it within a 0.5 deg deadband (the
// rotational deadband Jackson et al. assume for Orion) by pulses of at
// least 0.29 N s a thruster: the AJ10-220's minimum impulse bit, 0.898 N s
// at 62.3 N, scaled to 20 N by thrust (the bit is about the thrust times
// the least on-time, 14 ms here), so the hold pays its limit cycle
// (attitude.js limitCycle). The centre of pressure 0.3 m behind the centre of
// mass, so it noses into the airflow.
// Tanks: the propellant in two equal spheres of radius 0.37 m (250 kg of
// MMH and NTO at about 1.2 t/m^3 each), centred 0.6 m fore and aft of the
// centre of mass on the thrust axis.
export const DEFAULT_ATTITUDE = {
  inertia: [[1000, 0, 0], [0, 1625, 0], [0, 0, 1625]],
  propellant: 500,
  torqueMax: [20, 40, 40],
  rcsArm: [0.5, 1, 1],
  rcsIsp: 290,
  deadband: 0.5 * D2R,
  impulseBit: 0.29,
  rateMax: 3 * D2R,
  cp: [-0.3, 0, 0],
  tanks: { offset: 0.6, radius: 0.37 },
};

// The auto-turn's lead on a node: the controller's time for the turn, a
// tenth more (the gyroscopic terms, the sampling and the reference's own
// turning), and 5 s to settle.
export const AUTO_MARGIN = 1.1;
export const AUTO_PAD = 5;

// The inertia (kg m^2, body axes) of m kg of propellant in the tanks. Two
// equal spheres (the default): each a solid sphere 2 m R^2 / 5 about its
// centre, moved offset along body x by the parallel-axis theorem
// (m offset^2 about y and z). One cylinder (length given, a stage's): a
// solid cylinder of radius R and length h on the thrust axis, centred on
// the centre of mass, m R^2 / 2 about x and m (R^2 / 4 + h^2 / 12) across
// it. Either way the propellant keeps its tank's shape as it drains (its
// density falls), so the tensor is linear in m, and the liquid is taken to
// turn with its tank.
export function propellantInertia(m, { offset = 0, radius, length = null }) {
  if (length !== null) {
    const ax = 0.5 * m * radius * radius, tr = m * (radius * radius / 4 + length * length / 12);
    return [[ax, 0, 0], [0, tr, 0], [0, 0, tr]];
  }
  const s = 0.4 * m * radius * radius, p = m * offset * offset;
  return [[s, 0, 0], [0, s + p, 0], [0, 0, s + p]];
}

// A craft launched from the ROCKET tab: the stage left burning at cutoff
// with any above it and the payload, as a cylinder of the stack's diameter
// d on the thrust axis (docs/physics/sixdof.md#a-stages-attitude):
// - its propellant capacity (the full load of the stages left, kg) in one
//   cylindrical tank of the stage's diameter, h = capacity / (rho pi R^2)
//   long, at the propellant's bulk density rho: 320 kg/m^3 for liquid
//   oxygen and hydrogen (an engine of vacuum Isp 400 s or more), else
//   1,030 kg/m^3 (oxygen and kerosene; storable propellants are denser
//   still, 1,200);
// - the body one diameter longer than its tank (L = h + d: the engine and
//   thrust structure aft, the payload and its adapter fore), its dry mass
//   (with the payload) a thin-walled cylinder of that length about the same
//   centre: m R^2 about x, m (R^2 / 2 + L^2 / 12) across it;
// - attitude thrusters sized so the full stage turns as the MISSION tab's
//   craft does full: the same angular acceleration about each axis (alpha
//   = 0.02 rad/s^2 in roll, 0.0246 in pitch and yaw) and the same 3 deg/s
//   limit. The roll pairs at the skirt (R from the axis), the pitch and yaw
//   couples at the two ends (L / 2), bipropellant at the default's Isp;
//   their least pulse the default's 14.5 ms of their own thrust
//   (RCS_MIN_ON), axis by axis, in the same 0.5 deg deadband;
// - the centre of pressure a tenth of its length behind the centre of mass,
//   as the box's 0.3 m in 3 m.
export const STAGE_DENSITY = { hydrolox: 320, dense: 1030 };   // kg/m^3
// s: the default thruster's minimum impulse bit over its thrust (0.29 N s
// at 20 N), the least on-time a bit is scaled by.
export const RCS_MIN_ON = DEFAULT_ATTITUDE.impulseBit / 20;
export const HYDROLOX_ISP = 400;                               // s, vacuum
export function stageAttitude({ dryMass, fuel, capacity = fuel, diameter, isp = 320 }) {
  const R = diameter / 2, rho = isp >= HYDROLOX_ISP ? STAGE_DENSITY.hydrolox : STAGE_DENSITY.dense;
  const cap = Math.max(capacity, fuel, 0), h = cap / (rho * Math.PI * R * R), L = h + diameter;
  const tanks = { radius: R, length: h };
  const dryAx = dryMass * R * R, dryTr = dryMass * (R * R / 2 + L * L / 12), P = propellantInertia(cap, tanks);
  const inertia = [[dryAx + P[0][0], 0, 0], [0, dryTr + P[1][1], 0], [0, 0, dryTr + P[2][2]]];
  const D = DEFAULT_ATTITUDE.inertia, T = DEFAULT_ATTITUDE.torqueMax;
  const torqueMax = [0, 1, 2].map((i) => T[i] / D[i][i] * inertia[i][i]), rcsArm = [R, L / 2, L / 2];
  const impulseBit = torqueMax.map((x, i) => x / (2 * rcsArm[i]) * RCS_MIN_ON);
  return { inertia, propellant: cap, tanks, torqueMax, rcsArm, impulseBit, deadband: DEFAULT_ATTITUDE.deadband, rcsIsp: DEFAULT_ATTITUDE.rcsIsp, rateMax: DEFAULT_ATTITUDE.rateMax, cp: [-L / 10, 0, 0], length: L, density: rho };
}

// The craft's inertia with fuel kg on board: the dry tensor (the full one
// less the full tanks') plus the propellant's. Without tanks, fixed.
export function inertiaFor(spec, fuel) {
  if (!spec.tanks) return spec.inertia;
  const full = propellantInertia(spec.propellant, spec.tanks), now = propellantInertia(Math.max(0, fuel), spec.tanks);
  return spec.inertia.map((row, i) => row.map((x, j) => x - full[i][j] + now[i][j]));
}

export class CraftAttitude {
  // craft: the Craft; spec: DEFAULT_ATTITUDE's fields; mode: the start
  // (held there from the start, prograde by default).
  constructor(craft, spec = {}, mode = 'prograde') {
    this.craft = craft;
    const s = { ...DEFAULT_ATTITUDE, ...spec };
    this.full = s;                   // the spec as given, its inertia full
    this.rcsIsp = s.rcsIsp ?? null;  // s, or null: the thrusters draw nothing
    this.A = makeAttitude({ ...s, inertia: inertiaFor(s, craft.fuel), cdA: s.cdA ?? craft.cd * craft.area, mode, t: craft.kState.t });
    this.fuelAt = craft.fuel;        // kg, the fill the inertia is for
    this.rcsCounted = 0;             // N s of A.rcsImpulse drawn from the tank
    this.rcsSpent = 0;               // kg, the thrusters' propellant so far
    this.autoNode = s.autoNode ?? true;
    this.auto = null;                // { from (mode), node (id) } while turned for a node
    this.lastNodeDir = null;         // the last node burn's direction, held after it
    this.spans = [];
    this.anchor = null;
    this.cache = new Map();
    this.anchorAt(craft.kState.t, craft.kState.r, craft.kState.v);
    // Start on the mode's reference, settled.
    const env = this.env();
    const q = referenceNow(this.A, env);
    if (q) { this.A.q = q; this.A.holdQ = [...q]; this.A.locked = true; }
  }

  get mode() { return this.A.mode; }
  get q() { return this.A.q; }
  get omega() { return this.A.omega; }
  get locked() { return this.A.locked; }
  get spec() { return this.A.spec; }

  // The state the attitude turns on: relative to the primary at time t.
  anchorAt(t, r, v) {
    const c = this.craft, key = c.kState.primary ?? 'sun';
    const P = key !== 'sun' ? c.primaryBody(key) : null;
    const rP = P?.eph ? P.eph.position(t) : [0, 0, 0], vP = P?.eph ? P.eph.velocity(t) : [0, 0, 0];
    this.anchor = { t, key: P ? key : 'sun', mu: P ? P.mu : c.sys.muSun, r: [r[0] - rP[0], r[1] - rP[1], r[2] - rP[2]], v: [v[0] - vP[0], v[1] - vP[1], v[2] - vP[2]] };
    this.cache.clear();
  }

  // at(t) (m, m/s about the primary), the air, the node target.
  env() {
    const a = this.anchor, c = this.craft, cache = this.cache;
    const at = (t) => {
      let s = cache.get(t);
      if (!s) {
        const k = propagate(a.r, a.v, t - a.t, a.mu) ?? { r: a.r, v: a.v };
        s = { r: k.r.map((x) => x * 1e3), v: k.v.map((x) => x * 1e3) };
        if (cache.size > 64) cache.clear();
        cache.set(t, s);
      }
      return s;
    };
    return { key: a.key, mu: a.mu * 1e9, at, air: a.key === 'earth' ? this.air() : null, target: (t) => this.target(t) };
  }

  air() {
    if (this._air) return this._air;
    const c = this.craft;
    let fixT = NaN, M = null, rhoT = NaN, rho = 0;
    this._air = {
      omegaEarth: EARTH_ROTATION,
      earthFixed: (t) => {
        if (!(Math.abs(t - fixT) < 1)) { const [X, Y, Z] = bodyAxesEqj('earth', new Date(c.sys.msAt(t))); M = [X, Y, Z]; fixT = t; }
        return M;
      },
      // Height above the mean sphere, geocentric latitude: the torque needs
      // the density to a few per cent, not the drag's precision.
      density: (t, r, ecef) => {
        if (Math.abs(t - rhoT) < 1) return rho;
        rhoT = t;
        const alt = norm(r) / 1e3 - 6371;
        rho = alt > 1000 ? 0 : density({ ms: c.sys.msAt(t), lat: Math.atan2(ecef[2], Math.hypot(ecef[0], ecef[1])) / D2R, lon: Math.atan2(ecef[1], ecef[0]) / D2R, alt: Math.max(0, alt) });
        return rho;
      },
    };
    return this._air;
  }

  // The node mode's aim at t: a node burn on then holds its own direction
  // (as a point-mass craft's node burn does), and so does one about to
  // start; else the next node's delta-v in the orbital frame of the moment
  // ([prograde, in-plane, normal]; a node's dv is [radial, prograde,
  // normal] with radial = velocity x normal); else the direction the last
  // node burned along; none, the attitude it had.
  target(t = this.A.t) {
    const c = this.craft;
    let on = null, next = null;
    for (const b of c.burns) {
      if (b.kind !== 'node' || !b.nodeDir) continue;
      if (b.t0 <= t + 1e-9 && t < b.t1) on = b;
      else if (b.t0 > t && (!next || b.t0 < next.t0)) next = b;
    }
    if (on) { this.lastNodeDir = on.nodeDir; return { dir: on.nodeDir }; }
    if (next) return { dir: next.nodeDir };
    const n = c.nodes[0];
    if (n && norm(n.dv) > 0) return { vnb: unit([n.dv[1], n.dv[0], n.dv[2]]) };
    const done = c.burns.filter((b) => b.kind === 'node' && b.nodeDir && b.t1 <= t).at(-1);
    if (done) this.lastNodeDir = done.nodeDir;
    return this.lastNodeDir ? { dir: this.lastNodeDir } : null;
  }

  setMode(mode) {
    this.auto = null;
    if (mode !== 'off' && !(this.craft.fuel > 0)) { mode = 'off'; this.craft.note('attitude: the tank is empty, the thrusters cannot fire'); }
    setMode(this.A, mode);
    this.craft.note(`attitude: ${mode === 'off' ? 'control off' : mode === 'inertial' ? 'holding inertial' : `turning to ${mode}`}`);
  }

  setAutoNode(on) {
    this.autoNode = !!on;
    this.craft.note(`attitude: ${on ? 'turns to each node by itself' : 'node turns left to you'}`);
  }

  // Each frame, after the clock: the attitude carried from where it was to
  // the clock, on the orbit from the state drawn where it was (the scene
  // drew it last frame, so that costs no carry), else from the kernel's.
  // On the way, the node auto-turn's switches, each at its own time; then
  // the thrusters' propellant drawn.
  step(jumped) {
    const c = this.craft, t1 = c.clockT;
    if (jumped) { this.A.t = t1; this.A.nextSample = -Infinity; this.spans = []; }
    if (c.crashed || c.landed) { this.A.t = t1; return 0; }
    const drawn = c.shownAt(this.A.t);
    if (drawn) this.anchorAt(this.A.t, drawn.r, drawn.v);
    else this.anchorAt(c.kState.t, c.kState.r, c.kState.v);
    this.syncInertia();
    const recording = c.burns.length > 0, env = this.env(), rec = recording ? (s) => this.record(s) : null;
    let steps = 0;
    for (let k = 0; k < 8; k++) {
      const sw = this.nextSwitch(env, t1);
      if (!sw) break;
      if (sw.t > this.A.t) steps += advanceAttitude(this.A, sw.t, env, rec);
      if (this.A.t < sw.t - 1e-9) break;           // out of steps this frame
      sw.act();
    }
    steps += advanceAttitude(this.A, t1, env, rec);
    if (!recording) this.spans = [];
    const keep = Math.min(c.kState.t, this.A.t) - 1;
    if (this.spans.length && this.spans[0].t1 < keep) this.spans = this.spans.filter((s) => s.t1 >= keep);
    this.drawPropellant();
    return steps;
  }

  // The inertia for the propellant on board, when it has changed.
  syncInertia() {
    const f = this.craft.fuel;
    if (!this.full.tanks || Math.abs(f - this.fuelAt) < 1e-6) return;
    setInertia(this.A, inertiaFor(this.full, f));
    this.fuelAt = f;
  }

  // The thrusters' impulse since the last frame, as propellant from the
  // tank: dm = dJ / (Isp g0).
  drawPropellant() {
    const c = this.craft, dJ = this.A.rcsImpulse - this.rcsCounted;
    this.rcsCounted = this.A.rcsImpulse;
    if (!this.rcsIsp || !(dJ > 0)) return;
    const dm = Math.min(c.fuel, dJ / (this.rcsIsp * G0));
    c.fuel -= dm;
    this.rcsSpent += dm;
    if (c.fuel > 1e-9) return;
    c.fuel = 0;
    if (c.burns.some((b) => b.t1 > this.A.t)) { c.cancelBurns(this.A.t); c.note('tank empty: engine cut', this.A.t); }
    if (this.A.mode !== 'off') { this.auto = null; setMode(this.A, 'off'); c.note('tank empty: attitude thrusters off', this.A.t); }
  }

  // The next node the auto-turn would turn to, after A.t: a node burn
  // about to start, or the next node. { id, t, x (its direction at time
  // tt, from the orbit then) } or null.
  nextNode(env) {
    const c = this.craft, t = this.A.t;
    let n = null;
    for (const b of c.burns) if (b.kind === 'node' && b.nodeDir && b.t0 > t && (!n || b.t0 < n.t)) n = { id: b.nodeId, t: b.t0, dir: unit(b.nodeDir) };
    const m = c.nodes.find((x) => x.t > t && norm(x.dv) > 0);
    if (m && (!n || m.t < n.t)) n = { id: m.id, t: m.t, vnb: unit([m.dv[1], m.dv[0], m.dv[2]]) };
    if (!n) return null;
    return { ...n, q: (tt) => {
      const s = env.at(tt), x = n.dir ?? vnbToInertial(n.vnb, s.r, s.v), { V, N } = orbitalFrame(s.r, s.v);
      return pointing(x, Math.abs(dot(x, N)) < 0.9 ? N : V, V);
    } };
  }

  // When to start turning for node n: AUTO_MARGIN slewTime + AUTO_PAD
  // before it, the turn measured where the craft and the node's direction
  // will be then (a locked craft on its reference, else as it is now; at
  // high warp the orbital frame turns tens of degrees in a frame). A few
  // passes from now: { t (s, not before A.t), theta, need }.
  turnPlan(env, n) {
    const A = this.A;
    let tt = A.t, theta = 0, need = 0;
    for (let k = 0; k < 4; k++) {
      const qc = A.locked ? referenceAt(A, env, tt) ?? A.q : A.q, err = attitudeError(qc, n.q(tt));
      theta = err.theta; need = slewTime(A.spec, theta, err.e);
      const next = Math.min(n.t, Math.max(A.t, n.t - (AUTO_MARGIN * need + AUTO_PAD)));
      if (Math.abs(next - tt) < 1e-3) { tt = next; break; }
      tt = next;
    }
    return { t: tt, theta, need };
  }

  // The next switch in (A.t, t1]: { t, act } or null, the earliest of:
  // - turned for a node, back to the mode it had once that node's burn is
  //   over (or the node gone);
  // - with autoNode on and propellant, the turn to the next node (turnPlan);
  // - a node burn starting: the log says how far the axis is off its
  //   direction, if more than a degree.
  nextSwitch(env, t1) {
    const c = this.craft, A = this.A, out = [];
    for (const b of c.burns) {
      if (b.kind === 'node' && b.nodeDir && !b.offNoted && b.t0 >= A.t - 1e-9 && b.t0 <= t1) out.push({ t: b.t0, act: () => this.noteOff(b) });
    }
    if (this.auto) {
      const id = this.auto.node, b = c.burns.find((x) => x.nodeId === id);
      if (b) { if (b.t1 <= t1) out.push({ t: Math.max(A.t, b.t1), act: () => this.endAuto() }); }
      else if (!c.nodes.some((n) => n.id === id)) out.push({ t: A.t, act: () => this.endAuto() });
    } else if (this.autoNode && A.mode !== 'node' && c.fuel > 0) {
      const n = this.nextNode(env);
      // (No turn takes longer than a half turn about the slowest axis.)
      const most = Math.max(...[[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => slewTime(A.spec, Math.PI, e)));
      if (n && n.t - (AUTO_MARGIN * most + AUTO_PAD) <= t1) {
        const p = this.turnPlan(env, n);
        if (p.t <= t1) out.push({ t: p.t, act: () => this.beginAuto(n, p.theta, p.need, p.t) });
      }
    }
    return out.length ? out.reduce((a, b) => (b.t < a.t ? b : a)) : null;
  }

  noteOff(b) {
    b.offNoted = true;
    const off = Math.acos(Math.max(-1, Math.min(1, dot(unit(b.nodeDir), thrustAxis(this.A.q))))) / D2R;
    if (off > 1) this.craft.note(`node burning along the body axis, ${off.toFixed(1)}° off the node's direction`, b.t0);
  }

  beginAuto(n, theta, need, t) {
    const c = this.craft;
    this.auto = { from: this.A.mode, node: n.id };
    setMode(this.A, 'node');
    const left = n.t - t;
    c.note(`attitude: turning ${(theta / D2R).toFixed(1)}° to the node, ${need.toFixed(0)} s to settle, ${left.toFixed(0)} s before it`, t);
    if (left < need) c.note(`attitude: too late to settle before the node: the turn needs ${need.toFixed(0)} s, it fires in ${left.toFixed(0)} s, still turning`, t);
  }

  endAuto() {
    const from = this.auto?.from;
    this.auto = null;
    if (!from || this.A.mode !== 'node') return;
    setMode(this.A, from);
    this.craft.note(`attitude: node done, back to ${from === 'off' ? 'free' : from === 'inertial' ? 'the hold' : from}`, this.A.t);
  }

  // The auto-turn's plan, for the panel: { node, start (s from the clock),
  // need (s) } while waiting, or null.
  autoPlan() {
    if (!this.autoNode || this.auto || this.A.mode === 'node') return null;
    const env = this.env(), n = this.nextNode(env);
    if (!n) return null;
    const p = this.turnPlan(env, n);
    return { start: p.t - this.A.t, need: p.need, theta: p.theta };
  }

  record(s) {
    const L = this.spans.at(-1), key = this.anchor.key;
    const span = { ...s, about: key };
    if (L && Math.abs(L.t1 - s.t0) < 1e-9 && L.about === key) {
      const same = s.lock !== undefined
        ? L.lock !== undefined && sameFrame(L.lock, s.lock) && (s.lock || dot(L.d0, s.d1) > 1 - 1e-12)
        : L.lock === undefined && dot(L.d0, s.d1) > Math.cos(1e-4);
      if (same) { L.t1 = s.t1; L.d1 = s.d1; return; }
    }
    this.spans.push(span);
  }

  // A burn along the body axis as the kernel's pieces between from and to:
  // { t0, t1, dir, F, m0, mdot, frame?, about? }.
  pieces(b, from, to) {
    const p = Math.max(b.t0, from), q = Math.min(b.t1, to), out = [];
    if (!(q > p)) return out;
    const piece = (a, z, x) => {
      const L = out.at(-1);
      if (L && Math.abs(L.t1 - a) < 1e-9 && L.frame === x.frame && L.about === x.about && dot(L.dir, x.dir) > 1 - 1e-14) { L.t1 = z; return; }
      out.push({ t0: a, t1: z, F: b.F, m0: b.m0 - b.mdot * (a - b.t0), mdot: b.mdot, ...x });
    };
    const now = { dir: thrustAxis(this.A.q) };
    let at = p;
    for (const s of this.spans) {
      if (s.t1 <= at || s.t0 >= q) continue;
      const a = Math.max(s.t0, at), z = Math.min(s.t1, q);
      if (a > at + 1e-9) piece(at, a, now);
      const L = s.lock;
      piece(a, z, L?.vnb && s.about !== 'sun' ? { frame: 'vnb', about: s.about, dir: [...L.vnb] }
        : L?.dir ? { dir: unit(L.dir) }
          : L === null ? { dir: s.d0 }
            : { dir: unit([s.d0[0] + s.d1[0], s.d0[1] + s.d1[1], s.d0[2] + s.d1[2]]) });
      at = z;
    }
    if (q > at + 1e-9) piece(at, q, now);
    return out;
  }

  // The hold's limit cycle while locked: { rate (kg/s of propellant),
  // axes (limitCycle's) }, or null.
  hold() {
    const A = this.A;
    if (!A.locked || A.mode === 'off' || !this.rcsIsp) return null;
    const axes = limitCycle(A.spec, A.disturbance);
    if (!axes) return null;
    return { rate: (axes[0].thrust + axes[1].thrust + axes[2].thrust) / (this.rcsIsp * G0), axes };
  }

  // For the panel: the error from the reference (rad), the rates (rad/s),
  // the disturbance (N m), the controller's time for the turn left, and the
  // hold's limit cycle.
  readout() {
    const env = this.env(), err = pointingError(this.A, env), ref = referenceNow(this.A, env);
    const turn = ref && err > 1e-3 ? attitudeError(this.A.q, ref) : null;
    return {
      mode: this.A.mode, locked: this.A.locked, error: err, rate: norm(this.A.omega), disturbance: this.A.disturbance,
      turnLeft: turn ? slewTime(this.A.spec, turn.theta, turn.e) : 0,
      alpha: alphaAbout(this.A.spec, [0, 0, 1]), ref,
      rcsSpent: this.rcsSpent, inertia: this.A.spec.inertia, hold: this.hold(),
      autoNode: this.autoNode, auto: !!this.auto, autoPlan: this.autoPlan(),
    };
  }
}

function sameFrame(a, b) {
  if (a === null || b === null) return a === b;
  if (a.vnb && b.vnb) return a.vnb.every((x, i) => x === b.vnb[i]);
  if (a.dir && b.dir) return a.dir.every((x, i) => x === b.dir[i]);
  return false;
}
