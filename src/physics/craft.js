// src/physics/craft.js
//
// A spacecraft as the physics sees it: its exact state from the kernel,
// its propellant, its burns and manoeuvre nodes, and the drawn state carried
// forward to the sim clock. Pure: no three.js, no DOM; heliocentric J2000
// equatorial (EQJ) km, km/s, kernel seconds (kernelHost.kernelSeconds).
// The app (src/scene, src/app) draws it and drives it.
//
// Ported from the old BaseSpacecraft's kernel logic, with the same rules:
//
// - Burns are segments of absolute kernel time { t0, t1, dir, F, m0, mdot }.
//   The kernel ends its steps on their edges, so a burn starts and stops at
//   its own times whatever the frame rate, and every request that overlaps a
//   burn sends it (a dropped request loses nothing).
// - A clock jump (a date set directly, a reset) is not integrated: the state
//   is re-anchored at the new time, results in flight are dropped through the
//   version number, and the burn schedule is cleared (a burn cut short at the
//   old time would otherwise be flown again when the clock passes it).
// - A manoeuvre node checks the exact propellant first, m0 (1 - exp(-dv/ve)),
//   and burns for exactly that long, so it delivers its delta-v.
// - The drawn state is the kernel state carried forward to the clock along a
//   two-body orbit about the primary, with the rest of the acceleration to
//   second order, in pieces near a body and with the burns between taken one
//   by one (the kernel answers a frame or more late).

import { makeEnvironment } from './environment.js';
import { addJ2 } from './zonal.js';
import { propagate, rvToElements } from './orbital.js';
import { accelHeliocentric, primaryOf } from './nbody.js';
import { eqjToEcl } from './ephemeris.js';
import { bodyAxesEqj } from './orientation.js';
import { vnbDirection } from './kernelHost.js';

export const G0 = 9.80665;                 // m/s^2, for Isp
const MAX_CARRY_S = 30 * 86400;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

let nextId = 1;

// Carry a craft forward about a primary with a J2: the primary's J2 turns
// with the craft around its orbit, so unlike the slower perturbations it
// cannot be held constant across a lag (in low orbit that is 0.24 km off
// after 10 minutes, 115 km after an hour). Two-body plus J2, with the other
// perturbations held at their value at the start (ap), by classical RK4 at
// 1/256 of the orbital period (or longer, at most 2,048 steps). extra(t, x,
// out), if given, adds what changes as fast as J2 does (the environment's
// gravity field and sunlight, at kernel time t and primary-relative x).
function carryWithJ2(r0, v0, dtx, P, ap, extra = null, t0 = 0) {
  const rn = norm(r0), en = 0.5 * (v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2) - P.mu / rn;
  const period = en < 0 ? 2 * Math.PI * Math.sqrt((-P.mu / (2 * en)) ** 3 / P.mu) : 2 * Math.PI * Math.sqrt(rn ** 3 / P.mu);
  const n = Math.min(2048, Math.max(1, Math.ceil(dtx / (period / 256)))), h = dtx / n;
  let tNow = t0;
  const f = (x, out) => {
    const r2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2], k = -P.mu / (r2 * Math.sqrt(r2));
    out[0] = k * x[0] + ap[0]; out[1] = k * x[1] + ap[1]; out[2] = k * x[2] + ap[2];
    addJ2(x[0], x[1], x[2], r2, P, out);
    if (extra) extra(tNow, x, out);
    return out;
  };
  let r = [...r0], v = [...v0];
  const a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0], a4 = [0, 0, 0];
  for (let s = 0; s < n; s++) {
    tNow = t0 + s * h; f(r, a1);
    const r2 = r.map((x, i) => x + 0.5 * h * v[i]), v2 = v.map((x, i) => x + 0.5 * h * a1[i]);
    tNow = t0 + (s + 0.5) * h; f(r2, a2);
    const r3 = r.map((x, i) => x + 0.5 * h * v2[i]), v3 = v.map((x, i) => x + 0.5 * h * a2[i]);
    f(r3, a3);
    const r4 = r.map((x, i) => x + h * v3[i]), v4 = v.map((x, i) => x + h * a3[i]);
    tNow = t0 + (s + 1) * h; f(r4, a4);
    r = r.map((x, i) => x + (h / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]));
    v = v.map((x, i) => x + (h / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]));
  }
  return { r, v };
}

export class Craft {
  // sys: { bodiesAt, muSun } from bodies.solarSystemBodies (same epoch as t).
  // area (m^2) and cr: the sunlit cross-section and its reflectivity
  // (1 absorbs, 2 mirrors) for sunlight pressure (environment.js).
  // earth: the environment's Earth field options (environment.js; e.g.
  // { degree: 0 } for J2 alone), and cd the drag coefficient.
  // vent: the venting model's options (vent.js; {} for Artemis II's
  // calibration), or null for none.
  // entry: a lifting capsule's entry (environment.js, entry.js), or null.
  constructor({ name, r, v, t, sys, dryMass = 1000, fuel = 500, thrust = 5000, isp = 320, area = 5, cr = 1.3, cd = 2.2, earth = /** @type {object | null} */ (null), vent = /** @type {object | null} */ (null), entry = /** @type {object | null} */ (null) }) {
    this.id = nextId++;
    this.name = name;
    this.sys = sys;
    this.dryMass = dryMass;          // kg
    this.fuel = fuel;                // kg, one tank
    this.thrust = thrust;            // N
    this.isp = isp;                  // s
    this.area = area;                // m^2, sunlit and facing the air
    this.cr = cr;
    this.cd = cd;
    this.earth = earth;
    this.entry = entry;
    this.entryState = null;          // the entry guidance's, from the kernel
    this.vent = vent;
    const bodies = sys.bodiesAt(t);
    this.kState = { r: [...r], v: [...v], t, primary: primaryOf(r, bodies, sys.muSun), accel: accelHeliocentric(r, bodies, sys.muSun) };
    this.version = 0;
    this.clockT = t;                 // the sim clock as last seen
    this.prevClockT = t;
    this.burns = [];
    this.script = [];                // scripted burns (a real mission's, from its data)
    this.holdAt = null;              // kernel seconds the kernel stops at until released (an aimed correction)
    this.nodes = [];                 // { id, t, dv: [radial, prograde, normal] km/s }
    this.executing = null;           // { node, burn }
    this.engineOn = false;           // manual engine
    this.lagSeconds = 0;             // physics behind the clock (budget ran out)
    this.crashed = false;
    this.impactBody = null;
    this.impactSite = null;          // { key, t, local: body-fixed km }
    this.splashed = false;           // came down under its chutes, not crashed
    this.error = null;
    this.log = [];                   // { t, text } for the app to show
    this.clockJumped = false;
  }

  get mass() { return this.dryMass + this.fuel; }
  get ve() { return this.isp * G0; }       // m/s

  note(text, t = this.clockT) { this.log.push({ t, text }); }

  // ---------------- the clock ----------------

  // Called each frame with the sim clock (kernel seconds). jumped is true
  // when the clock was set rather than run (SimClock counts its setTime
  // calls): the craft is then re-anchored instead of integrated across the
  // gap. Draws fuel for the burns and starts nodes that fall due.
  advanceClock(tNow, jumped = false) {
    this.prevClockT = this.clockT;
    if (jumped || tNow < this.clockT) {
      const moved = tNow - this.clockT;
      this.kState.t = tNow;
      this.lagSeconds = 0;
      this.version++;
      this.cancelBurns(this.clockT);
      this.burns = [];
      this.prevClockT = tNow;                      // no fuel drawn across the jump
      this.clockJumped = true;
      this.note(`clock set ${(moved / 86400).toFixed(2)} d away; state kept, burns cleared`, tNow);
    }
    this.clockT = tNow;
    // Nodes due in this frame start at their own time.
    while (!this.executing && this.nodes.length && this.nodes[0].t <= tNow) {
      const node = this.nodes[0];
      if (node.t < this.prevClockT) { this.nodes.shift(); this.note('node in the past dropped'); continue; }
      this.startNode(node);
    }
    this.updateBurns();
  }

  // ---------------- burns ----------------

  // Start a burn at t0 along dir (EQJ, any length) at full thrust. Ends after
  // duration, or when the tank runs dry. Returns the burn or null.
  startBurn({ t0, dir, duration = Infinity, kind = 'manual' }) {
    const mdot = this.thrust / this.ve;
    if (!(this.fuel > 0) || !(mdot > 0) || !(norm(dir) > 0)) return null;
    const burn = { t0, t1: t0 + Math.min(duration, this.fuel / mdot), dir: unit(dir), F: this.thrust, m0: this.mass, mdot, kind };
    this.burns.push(burn);
    return burn;
  }

  cancelBurns(t, kind = null) {
    for (const b of this.burns) if ((kind === null || b.kind === kind) && b.t1 > t) b.t1 = Math.max(b.t0, t);
    if (kind === null || kind === 'manual') this.engineOn = false;
    if ((kind === null || kind === 'node') && this.executing) this.finishNode();
  }

  // The manual engine: on along dir (EQJ) from the clock time until dry or
  // switched off.
  setEngine(dir) {
    this.cancelBurns(this.clockT, 'manual');
    if (dir && this.startBurn({ t0: this.clockT, dir, kind: 'manual' })) this.engineOn = true;
  }

  // Fuel for the time each burn was on since the last frame; finished burns
  // closed off.
  updateBurns() {
    const a = this.prevClockT, b = this.clockT;
    for (const burn of this.burns) {
      const overlap = Math.min(b, burn.t1) - Math.max(a, burn.t0);
      if (overlap > 0) this.fuel = Math.max(0, this.fuel - burn.mdot * overlap);
    }
    if (this.engineOn && !this.burns.some((x) => x.kind === 'manual' && b < x.t1)) this.engineOn = false;
    if (this.executing && b >= this.executing.burn.t1) this.finishNode();
    const done = Math.min(this.kState.t, b);
    this.burns = this.burns.filter((x) => x.t1 > done);
  }

  thrusting(t = this.clockT) { return this.burns.some((b) => b.t0 <= t && t < b.t1) || this.script.some((b) => b.t0 <= t && t < b.t1); }

  // Scripted burns: a real mission's burns as flown, from its data. Each is
  // { t0, t1, dir, accel } with accel in m/s^2, constant over its span, and
  // dir [prograde, in-plane, normal] in the orbital frame about the burn's
  // own body (b.about) or else `about`.
  // Unlike the engine's burns they draw no propellant from this craft's
  // tank and survive clock jumps: they are tied to the mission's times.
  setScript(burns, about = 'earth') {
    // F = accel on a nominal 1 kg: the data give acceleration, not thrust
    // and mass, so these are flagged and the environment ignores the mass.
    this.script = burns.map((b) => ({ t0: b.t0, t1: b.t1, dir: b.dir, F: b.accel, m0: 1, mdot: 0, frame: 'vnb', about: b.about ?? about, scripted: true }));
    this.version++;
  }

  // A scripted push added to the script: accel m/s^2 along a fixed EQJ
  // direction from t0 to t1 (an aimed correction; aimed: true marks it for
  // dropAimed).
  addScripted({ t0, t1, dir, accel }) {
    this.script.push({ t0, t1, dir: unit(dir), F: accel, m0: 1, mdot: 0, scripted: true, aimed: true });
    this.version++;
  }
  // Aimed pushes still to come after t are dropped (the clock was set back
  // past them: they are aimed again when it reaches them).
  dropAimed(t) {
    const n = this.script.length;
    this.script = this.script.filter((b) => !(b.aimed && b.t1 > t));
    if (this.script.length !== n) this.version++;
  }

  // A tracking fix: the craft's state replaced by a measured one at time t.
  setState(r, v, t) {
    const bodies = this.sys.bodiesAt(t);
    this.kState = { r: [...r], v: [...v], t, primary: primaryOf(r, bodies, this.sys.muSun), accel: accelHeliocentric(r, bodies, this.sys.muSun) };
    this.lagSeconds = 0;
    this.version++;
  }

  // ---------------- manoeuvre nodes ----------------

  // dv in the primary-relative frame at the node: radial (out), prograde
  // (along the relative velocity) and normal (along r x v), km/s.
  addNode(t, dv) {
    const node = { id: nextId++, t, dv: [...dv] };
    this.nodes.push(node);
    this.nodes.sort((x, y) => x.t - y.t);
    return node;
  }

  removeNode(node) { this.nodes = this.nodes.filter((n) => n !== node); }

  // Propellant a delta-v (km/s) needs from the current mass.
  propellantFor(dvKmS) { return this.mass * (1 - Math.exp(-dvKmS * 1000 / this.ve)); }

  startNode(node) {
    const dv = norm(node.dv);
    this.removeNode(node);
    const need = this.propellantFor(dv);
    if (need > this.fuel) {
      this.note(`node refused: needs ${need.toFixed(1)} kg of propellant, ${this.fuel.toFixed(1)} kg on board`, node.t);
      return false;
    }
    // The burn's frame from the state at the node's own time.
    const at = this.carryForward(Math.max(0, node.t - this.kState.t));
    const P = this.primaryBody(this.kState.primary);
    const rel = P ? { r: sub(at.r, P.eph.position(node.t)), v: sub(at.v, P.eph.velocity(node.t)) } : at;
    const T = unit(rel.v), N = unit(cross(rel.r, rel.v)), R = cross(T, N);
    const d = [0, 1, 2].map((i) => R[i] * node.dv[0] + T[i] * node.dv[1] + N[i] * node.dv[2]);
    const duration = need / (this.thrust / this.ve);
    const burn = this.startBurn({ t0: node.t, dir: d, duration, kind: 'node' });
    if (!burn) { this.note('node refused: no propellant', node.t); return false; }
    this.executing = { node, burn };
    this.note(`node burn: ${(dv * 1000).toFixed(1)} m/s over ${duration.toFixed(1)} s`, node.t);
    return true;
  }

  finishNode() {
    if (this.executing) this.note('node burn complete', this.executing.burn.t1);
    this.executing = null;
  }

  // ---------------- the kernel ----------------

  buildRequest() {
    if (this.crashed || this.error) return null;
    const tEnd = this.holdAt !== null && this.holdAt < this.clockT ? this.holdAt : this.clockT, span = tEnd - this.kState.t;
    if (Number.isNaN(span)) { this.error = 'non-finite physics time'; return null; }
    if (!(span > 0)) return null;
    const burns = [...this.burns, ...this.script].filter((b) => b.t1 > this.kState.t && b.t0 < tEnd)
      .map(({ t0, t1, dir, F, m0, mdot, frame, about, scripted }) => ({ t0, t1, dir, F, m0, mdot, frame, about, scripted }));
    return { id: this.id, version: this.version, r: [...this.kState.r], v: [...this.kState.v], t: this.kState.t, tEnd, primary: this.kState.primary, burns, env: this.envParams() };
  }

  // What the kernel's environment model needs of this craft.
  envParams() { return { mass: this.mass, area: this.area, cr: this.cr, cd: this.cd, ...(this.earth ? { earth: this.earth } : {}), ...(this.vent ? { vent: this.vent } : {}), ...(this.entry ? { entry: { ...this.entry, state: this.entryState } } : {}) }; }

  // The same environment, for drawing the craft while the kernel lags
  // (rebuilt when the mass changes). Without the entry's lift and guidance:
  // a frame's carry is no place for the guidance's predictions.
  environment() {
    const key = `${this.mass}|${this.area}|${this.cr}|${this.cd}`;
    if (this._envKey !== key) { const { entry, ...p } = this.envParams(); this._env = makeEnvironment(this.sys, p); this._envKey = key; }
    return this._env;
  }

  // A new configuration from a time on (a capsule leaving its service
  // module): mass, area, drag coefficient, entry. The kernel's next request
  // flies it.
  configure({ dryMass = this.dryMass, fuel = this.fuel, area = this.area, cd = this.cd, cr = this.cr, entry = this.entry, vent = this.vent }) {
    Object.assign(this, { dryMass, fuel, area, cd, cr, entry, vent });
    this.entryState = null;
    this.version++;
  }

  // A request whose result will never come: nothing to undo (burns are tied
  // to absolute times, so the next request sends them again).
  dropped() {}

  applyResult(res) {
    if (this.crashed) return;
    if (res.error) { this.error = res.error; this.note(`kernel error: ${res.error}`); return; }
    if (res.version !== this.version) return;
    const prev = this.kState.primary;
    this.kState = { r: res.r, v: res.v, t: res.t, primary: res.primary, accel: res.accel, withThrust: true };
    if (res.envState?.entry) this.entryState = res.envState.entry;
    const impact = res.events.find((e) => e.type === 'impact');
    this.lagSeconds = (!res.complete && !impact) ? Math.max(0, res.tEnd - res.t) : 0;
    for (const e of res.events) {
      if (e.type === 'impact') {
        this.crashed = true; this.impactBody = e.body; this.engineOn = false; this.impactSite = this.siteOn(e.body, res.r, res.t);
        // A capsule down on the Earth under its chutes, slower than 25 m/s
        // over the ground, has splashed down; anything else has crashed.
        this.splashed = !!this.entry && e.body === 'earth' && this.groundSpeed(res.r, res.v, res.t) < 0.025;
        this.note(this.splashed ? `splashdown at ${(this.groundSpeed(res.r, res.v, res.t) * 1000).toFixed(1)} m/s` : `impact on ${e.body}`, e.t);
      }
    }
    if (res.primary !== prev) this.note(`now in the sphere of influence of ${res.primary}`, res.t);
  }

  // ---------------- drawing ----------------

  primaryBody(key) {
    if (!key || key === 'sun') return null;
    return this.sys.bodiesAt(this.kState.t).find((b) => b.key === key) ?? null;
  }

  // The state at the sim clock (kState carried forward, at most 30 days).
  // After an impact the craft lies where it came down, turning with the body
  // it hit: left where it was in space, the body would move off at its orbital
  // speed (the Earth goes 7 million km in three days).
  displayState() {
    if (this.crashed) return this.onSite(this.clockT) ?? { r: [...this.kState.r], v: [...this.kState.v] };
    let dtx = this.clockT - this.kState.t;
    if (!(dtx > 0)) dtx = 0;
    // Asked for several times a frame (the scene, the readouts): carried once.
    const key = `${this.clockT}|${this.kState.t}|${this.version}|${this.script.length}|${this.burns.length}`, sh = this._shown;
    if (!sh || sh.key !== key || sh.from !== this.kState || sh.r0 !== this.kState.r) this._shown = { key, from: this.kState, r0: this.kState.r, s: this.carryForward(Math.min(dtx, MAX_CARRY_S)) };
    return { r: [...this._shown.s.r], v: [...this._shown.s.v] };
  }

  // Speed over the Earth's turning surface (km/s) at heliocentric r, v.
  groundSpeed(r, v, t) {
    const E = this.sys.bodiesAt(t).find((b) => b.key === 'earth');
    if (!E?.eph) return Infinity;
    const d = sub(r, E.eph.position(t)), w = E.pole ?? [0, 0, 1], om = 7.2921158553e-5, ve = E.eph.velocity(t);
    const spin = [om * (w[1] * d[2] - w[2] * d[1]), om * (w[2] * d[0] - w[0] * d[2]), om * (w[0] * d[1] - w[1] * d[0])];
    return norm([v[0] - ve[0] - spin[0], v[1] - ve[1] - spin[1], v[2] - ve[2] - spin[2]]);
  }

  // The impact point in the body's own frame (orientation.js), so it can be
  // carried with the body's motion and spin.
  siteOn(key, r, t) {
    const B = this.sys.bodiesAt(t).find((b) => b.key === key);
    if (!B?.eph || !this.sys.msAt) return null;
    const d = sub(r, B.eph.position(t));
    const [X, Y, Z] = bodyAxesEqj(key, new Date(this.sys.msAt(t)));
    return { key, t, local: [dot(X, d), dot(Y, d), dot(Z, d)] };
  }

  // Where the impact point is at time t, and its velocity (the body's plus
  // the spin's, from the turn of the axes over a second).
  onSite(t) {
    const S = this.impactSite;
    if (!S) return null;
    const B = this.sys.bodiesAt(t).find((b) => b.key === S.key);
    if (!B?.eph) return null;
    const at = (tt) => {
      const [X, Y, Z] = bodyAxesEqj(S.key, new Date(this.sys.msAt(tt)));
      return [0, 1, 2].map((i) => X[i] * S.local[0] + Y[i] * S.local[1] + Z[i] * S.local[2]);
    };
    const d0 = at(t), d1 = at(t + 1), rB = B.eph.position(t), vB = B.eph.velocity(t);
    return { r: [0, 1, 2].map((i) => rB[i] + d0[i]), v: [0, 1, 2].map((i) => vB[i] + d1[i] - d0[i]) };
  }

  // The kernel state carried dtx seconds on, for drawing. The burns are
  // taken separately: the kernel's acceleration holds the thrust of a burn
  // burning at that instant, which would otherwise be carried past the
  // burn's end, and none of a burn that starts within the carry (after a
  // 290 m/s powered flyby, carried a frame of hours, the craft was drawn
  // thousands of kilometres off). So the craft coasts, without thrust, to
  // each burn, takes the burn's velocity change there at once, and coasts
  // on. A burn's 5 s pieces are taken 20 s at a time (through a powered
  // flyby 130 km above the Moon the orbital frame turns a degree in that),
  // each along its own direction in the orbital frame of the moment.
  carryForward(dtx) {
    const { r: r0, v: v0, accel: a } = this.kState;
    if (!(dtx > 0)) return { r: [...r0], v: [...v0] };
    const t0 = this.kState.t, t1 = t0 + dtx;
    const push = (b, t) => b.F / (b.m0 - b.mdot * (t - b.t0)) / 1000;    // km/s^2
    const along = (b, t, x) => {
      if (b.frame !== 'vnb') return b.dir;
      const B = this.sys.bodiesAt(t).find((y) => y.key === b.about);
      if (!B?.eph) return [0, 0, 0];
      return vnbDirection(b.dir, sub(x.r, B.eph.position(t)), sub(x.v, B.eph.velocity(t)));
    };
    const parts = [...this.burns, ...this.script]
      .map((b) => ({ b, p: Math.max(b.t0, t0), q: Math.min(b.t1, t1) })).filter((x) => x.q > x.p)
      .sort((x, y) => x.p - y.p);
    // The kernel's acceleration holds the thrust at its instant; one set
    // here (a new craft, a fix) holds gravity alone.
    const coastAccel = [...a];
    for (const { b } of this.kState.withThrust ? parts : []) {
      if (t0 >= b.t0 && t0 < b.t1) { const d = along(b, t0, { r: r0, v: v0 }), k = push(b, t0); for (let i = 0; i < 3; i++) coastAccel[i] -= k * d[i]; }
    }
    if (!parts.length) return this.carryCoast(dtx, coastAccel);
    const groups = [];
    for (const x of parts) {
      const g = groups.at(-1);
      if (g && x.p - g.q < 60 && x.q - g.p <= 20) { g.items.push(x); g.q = Math.max(g.q, x.q); } else groups.push({ p: x.p, q: x.q, items: [x] });
    }
    let at = { r: [...r0], v: [...v0], t: t0, accel: coastAccel, primary: this.kState.primary };
    for (const g of groups) {
      const tm = (g.p + g.q) / 2;
      if (tm > at.t) {
        const x = this.carryCoast(tm - at.t, at.accel, at);
        at = { ...x, t: tm, accel: accelHeliocentric(x.r, this.sys.bodiesAt(tm), this.sys.muSun), primary: at.primary };
      }
      const dv = [0, 0, 0];
      for (const { b, p, q } of g.items) {
        const d = along(b, tm, at), k = push(b, (p + q) / 2) * (q - p);
        for (let i = 0; i < 3; i++) dv[i] += d[i] * k;
      }
      at.v = at.v.map((x, i) => x + dv[i]);
    }
    return t1 > at.t ? this.carryCoast(t1 - at.t, at.accel, at) : { r: at.r, v: at.v };
  }

  // The kernel state carried dtx seconds on under gravity and the rest of
  // acceleration a (the kernel's, less any thrust).
  // from: the state to carry (default the kernel's), with t and primary.
  // Near a body a long carry goes in pieces of a quarter of the dynamical
  // time at the closest the conic comes within it, the acceleration found
  // afresh at each: held for 25 minutes through Artemis I's pass 130 km
  // above the Moon, one second-order carry was 163 km out.
  carryCoast(dtx, a, from = this.kState) {
    const key = from.primary;
    const P = key && key !== 'sun' ? this.sys.bodiesAt(from.t).find((b) => b.key === key) : null;
    let n = 1;
    if (P?.eph) {
      const d = sub(from.r, P.eph.position(from.t)), w = sub(from.v, P.eph.velocity(from.t));
      const r = norm(d), h = norm([d[1] * w[2] - d[2] * w[1], d[2] * w[0] - d[0] * w[2], d[0] * w[1] - d[1] * w[0]]);
      const e = Math.sqrt(Math.max(0, 1 + (dot(w, w) - 2 * P.mu / r) * h * h / (P.mu * P.mu)));
      const closest = dot(d, w) < 0 ? Math.min(r, h * h / P.mu / (1 + e)) : r;
      const piece = 0.25 * Math.sqrt(closest ** 3 / P.mu);
      n = Math.min(32, Math.max(1, Math.ceil(dtx / piece)));
    }
    if (n === 1) return this.carryPiece(dtx, a, from);
    const env = this.environment();
    let at = { r: from.r, v: from.v, t: from.t, primary: from.primary }, acc = a, x = null;
    for (let i = 0; i < n; i++) {
      x = this.carryPiece(dtx / n, acc, at);
      at = { r: x.r, v: x.v, t: at.t + dtx / n, primary: from.primary };
      if (i + 1 < n) {
        acc = accelHeliocentric(at.r, this.sys.bodiesAt(at.t), this.sys.muSun);
        if (env) env(at.t, at.r, at.v, acc);
      }
    }
    return x;
  }

  carryPiece(dtx, a, from) {
    const { r: r0, v: v0 } = from;
    const t0 = from.t, t1 = t0 + dtx;
    const bodies = this.sys.bodiesAt(t0);
    // Within three spheres of influence of a planet its pull changes too fast
    // across a frame to be a correction to a solar orbit: carry the craft
    // around that planet instead.
    let key = from.primary;
    if (!key || key === 'sun') {
      for (const b of bodies) {
        if (b.parent) continue;
        const soi = norm(b.r) * Math.pow(b.mu / this.sys.muSun, 0.4);
        if (norm(sub(r0, b.r)) < 3 * soi) { key = b.key; break; }
      }
    }
    const P = key && key !== 'sun' ? bodies.find((b) => b.key === key) : null;
    if (!P || !P.eph) {
      const st = propagate(r0, v0, dtx, this.sys.muSun);
      if (!st) return { r: [...r0], v: [...v0] };
      // Everything but the Sun's pull, to second order.
      const k = -this.sys.muSun / norm(r0) ** 3;
      const ap = [0, 1, 2].map((i) => a[i] - k * r0[i]);
      return { r: st.r.map((x, i) => x + 0.5 * ap[i] * dtx * dtx), v: st.v.map((x, i) => x + ap[i] * dtx) };
    }
    const rP0 = P.eph.position(t0), vP0 = P.eph.velocity(t0), aP0 = P.eph.acceleration(t0);
    const rP1 = P.eph.position(t1), vP1 = P.eph.velocity(t1);
    const d = sub(r0, rP0);
    const rel = propagate(d, sub(v0, vP0), dtx, P.mu);
    if (!rel) return { r: [...r0], v: [...v0] };
    // Everything but the primary's two-body pull, relative to the primary,
    // to second order: the craft's acceleration less the primary's own (from
    // its ephemeris) less the primary's pull on the craft.
    const k2 = -P.mu / norm(d) ** 3;
    const ap = [0, 1, 2].map((i) => a[i] - aP0[i] - k2 * d[i]);
    if (P.j2 && norm(d) ** 2 < P.j2Cut2) {
      const j = [0, 0, 0];
      addJ2(d[0], d[1], d[2], d[0] * d[0] + d[1] * d[1] + d[2] * d[2], P, j);
      for (let i = 0; i < 3; i++) ap[i] -= j[i];
      // The environment (the Earth's field beyond J2, sunlight) changes as
      // fast as J2 does: taken out of ap and evaluated along the carry.
      const env = this.environment();
      let extra = null;
      if (env) {
        const e0 = env(t0, r0, v0, [0, 0, 0]);
        for (let i = 0; i < 3; i++) ap[i] -= e0[i];
        const h = [0, 0, 0];
        extra = (t, x, out) => { const rp = P.eph.position(t); h[0] = x[0] + rp[0]; h[1] = x[1] + rp[1]; h[2] = x[2] + rp[2]; env(t, h, v0, out); };
      }
      const s = carryWithJ2(d, sub(v0, vP0), dtx, P, ap, extra, t0);
      return { r: [0, 1, 2].map((i) => s.r[i] + rP1[i]), v: [0, 1, 2].map((i) => s.v[i] + vP1[i]) };
    }
    return {
      r: [0, 1, 2].map((i) => rel.r[i] + rP1[i] + 0.5 * ap[i] * dtx * dtx),
      v: [0, 1, 2].map((i) => rel.v[i] + vP1[i] + ap[i] * dtx),
    };
  }

  // Osculating elements about the primary at the clock. About the Sun they
  // are referred to the ecliptic (the usual convention); about a planet to
  // the J2000 equator, which for Earth is its mean equator (for the other
  // planets it is not their own equator).
  elements() {
    const s = this.displayState();
    const P = this.primaryBody(this.kState.primary);
    if (!P) return { about: 'sun', frame: 'ecliptic J2000', ...rvToElements(eqjToEcl(s.r), eqjToEcl(s.v), this.sys.muSun) };
    const t = this.clockT;
    return { about: P.key, frame: 'J2000 equator', ...rvToElements(sub(s.r, P.eph.position(t)), sub(s.v, P.eph.velocity(t)), P.mu) };
  }
}
