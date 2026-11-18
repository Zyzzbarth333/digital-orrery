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

import { makeAttitude, advanceAttitude, setMode, thrustAxis, pointingError, referenceNow, alphaAbout, slewTime, attitudeError } from './attitude.js';
import { propagate } from './orbital.js';
import { density } from './atmosphere.js';
import { bodyAxesEqj } from './orientation.js';
import { EARTH_ROTATION } from './environment.js';

const D2R = Math.PI / 180;
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The app's own craft: 1.5 t (1,000 kg dry and 500 kg of propellant) in a
// 2 by 2 by 3 m box, long along the thrust axis, so I = m (b^2 + c^2) / 12
// about each axis: 1,000 kg m^2 about the long axis and 1,625 across it.
// Reaction thrusters: 20 N m in roll and 40 N m in pitch and yaw (four
// 22 N thrusters about a metre out, the class of an Apollo service
// module's quads), a 3 deg/s rate limit, and the centre of pressure 0.3 m
// behind the centre of mass, so it noses into the airflow.
export const DEFAULT_ATTITUDE = {
  inertia: [[1000, 0, 0], [0, 1625, 0], [0, 0, 1625]],
  torqueMax: [20, 40, 40],
  rateMax: 3 * D2R,
  cp: [-0.3, 0, 0],
};

export class CraftAttitude {
  // craft: the Craft; spec: DEFAULT_ATTITUDE's fields; mode: the start
  // (held there from the start, prograde by default).
  constructor(craft, spec = {}, mode = 'prograde') {
    this.craft = craft;
    const s = { ...DEFAULT_ATTITUDE, ...spec };
    this.A = makeAttitude({ ...s, cdA: s.cdA ?? craft.cd * craft.area, mode, t: craft.kState.t });
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
    return { key: a.key, mu: a.mu * 1e9, at, air: a.key === 'earth' ? this.air() : null, target: () => this.target() };
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

  // The node mode's aim: a node burning holds its own direction (as a
  // point-mass craft's node burn does); else the next node's delta-v in the
  // orbital frame of the moment ([prograde, in-plane, normal]; a node's dv
  // is [radial, prograde, normal] with radial = velocity x normal); none,
  // the attitude it had.
  target() {
    const c = this.craft;
    if (c.executing?.burn?.nodeDir) return { dir: c.executing.burn.nodeDir };
    const n = c.nodes[0];
    return n && norm(n.dv) > 0 ? { vnb: unit([n.dv[1], n.dv[0], n.dv[2]]) } : null;
  }

  setMode(mode) {
    setMode(this.A, mode);
    this.craft.note(`attitude: ${mode === 'off' ? 'control off' : mode === 'inertial' ? 'holding inertial' : `turning to ${mode}`}`);
  }

  // Each frame, after the clock: the attitude carried from where it was to
  // the clock, on the orbit from the state drawn where it was (the scene
  // drew it last frame, so that costs no carry), else from the kernel's.
  step(jumped) {
    const c = this.craft, t1 = c.clockT;
    if (jumped) { this.A.t = t1; this.A.nextSample = -Infinity; this.spans = []; }
    if (c.crashed || c.landed) { this.A.t = t1; return 0; }
    const drawn = c.shownAt(this.A.t);
    if (drawn) this.anchorAt(this.A.t, drawn.r, drawn.v);
    else this.anchorAt(c.kState.t, c.kState.r, c.kState.v);
    const recording = c.burns.length > 0;
    const steps = advanceAttitude(this.A, t1, this.env(), recording ? (s) => this.record(s) : null);
    if (!recording) this.spans = [];
    const keep = Math.min(c.kState.t, this.A.t) - 1;
    if (this.spans.length && this.spans[0].t1 < keep) this.spans = this.spans.filter((s) => s.t1 >= keep);
    return steps;
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

  // For the panel: the error from the reference (rad), the rates (rad/s),
  // the disturbance (N m), and the controller's time for the turn left.
  readout() {
    const env = this.env(), err = pointingError(this.A, env), ref = referenceNow(this.A, env);
    const turn = ref && err > 1e-3 ? attitudeError(this.A.q, ref) : null;
    return {
      mode: this.A.mode, locked: this.A.locked, error: err, rate: norm(this.A.omega), disturbance: this.A.disturbance,
      turnLeft: turn ? slewTime(this.A.spec, turn.theta, turn.e) : 0,
      alpha: alphaAbout(this.A.spec, [0, 0, 1]), ref,
    };
  }
}

function sameFrame(a, b) {
  if (a === null || b === null) return a === b;
  if (a.vnb && b.vnb) return a.vnb.every((x, i) => x === b.vnb[i]);
  if (a.dir && b.dir) return a.dir.every((x, i) => x === b.dir[i]);
  return false;
}
