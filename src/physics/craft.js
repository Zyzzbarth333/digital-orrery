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
import { TOUCHDOWN_SPEED } from './landing.js';
import { accelHeliocentric, primaryOf } from './nbody.js';
import { eqjToEcl } from './ephemeris.js';
import { bodyAxesEqj } from './orientation.js';
import { vnbDirection } from './kernelHost.js';

export const G0 = 9.80665;                 // m/s^2, for Isp
const MAX_CARRY_S = 30 * 86400;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
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
// extra is taken once per step, at its start, and held across the step's
// four stages: it is a small fraction of J2 and its field (degree 20 and
// the upper air) is most of a step's cost, so this keeps the drawn carry
// cheap at high warp (a 24-minute lag in low orbit: 4.2 ms -> about 1.5 ms)
// while J2 itself is still taken at every stage.
function carryWithJ2(r0, v0, dtx, P, ap, extra = null, t0 = 0) {
  const rn = norm(r0), en = 0.5 * (v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2) - P.mu / rn;
  const period = en < 0 ? 2 * Math.PI * Math.sqrt((-P.mu / (2 * en)) ** 3 / P.mu) : 2 * Math.PI * Math.sqrt(rn ** 3 / P.mu);
  const n = Math.min(2048, Math.max(1, Math.ceil(dtx / (period / 256)))), h = dtx / n;
  const held = [0, 0, 0];
  const f = (x, out) => {
    const r2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2], k = -P.mu / (r2 * Math.sqrt(r2));
    out[0] = k * x[0] + ap[0] + held[0]; out[1] = k * x[1] + ap[1] + held[1]; out[2] = k * x[2] + ap[2] + held[2];
    addJ2(x[0], x[1], x[2], r2, P, out);
    return out;
  };
  let r = [...r0], v = [...v0];
  const a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0], a4 = [0, 0, 0];
  for (let s = 0; s < n; s++) {
    if (extra) { held[0] = held[1] = held[2] = 0; extra(t0 + (s + 0.5) * h, r, held); }
    f(r, a1);
    const r2 = r.map((x, i) => x + 0.5 * h * v[i]), v2 = v.map((x, i) => x + 0.5 * h * a1[i]);
    f(r2, a2);
    const r3 = r.map((x, i) => x + 0.5 * h * v2[i]), v3 = v.map((x, i) => x + 0.5 * h * a2[i]);
    f(r3, a3);
    const r4 = r.map((x, i) => x + h * v3[i]), v4 = v.map((x, i) => x + h * a3[i]);
    f(r4, a4);
    r = r.map((x, i) => x + (h / 6) * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]));
    v = v.map((x, i) => x + (h / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i]));
  }
  return { r, v };
}

export class Craft {
  // sys: { bodiesAt, muSun } from bodies.solarSystemBodies (same epoch as t).
  // The craft takes its own view of it (sys.view()), focused on where it
  // is, so a planet's moons are in its list near the planet whatever the
  // other craft are doing.
  // area (m^2) and cr: the sunlit cross-section and its reflectivity
  // (1 absorbs, 2 mirrors) for sunlight pressure (environment.js).
  // earth: the environment's Earth field options (environment.js; e.g.
  // { degree: 0 } for J2 alone), and cd the drag coefficient.
  // vent: the venting model's options (vent.js; {} for Artemis II's
  // calibration), or null for none.
  // entry: a lifting capsule's entry (environment.js, entry.js), or null.
  // scriptIsp: the Isp (s) at which a real mission's scripted burns draw
  // propellant from the dry mass (a spacecraft's own tanks, beyond the
  // player's fuel), or null: they then leave the mass alone.
  constructor({ name, r, v, t, sys, dryMass = 1000, fuel = 500, thrust = 5000, isp = 320, area = 5, cr = 1.3, cd = 2.2, earth = /** @type {object | null} */ (null), vent = /** @type {object | null} */ (null), entry = /** @type {object | null} */ (null), scriptIsp = /** @type {number | null} */ (null), bare = false }) {
    this.id = nextId++;
    this.name = name;
    this.sys = sys.view ? sys.view() : sys;
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
    // bare: flown in the kernel's point masses and zonal terms alone, without
    // the environment (environment.js): a journey's craft whose burns could
    // only be worked out in that model (journeyFlight.js flyPlanned, a
    // fallback), so the app flies the very flight the planner did. bareWhy:
    // what the full model's flight could not do, for the Model row.
    this.bare = bare;
    /** @type {string | null} */
    this.bareWhy = null;
    this.sys.focus?.(r, t);
    const bodies = this.sys.bodiesAt(t);
    this.kState = { r: [...r], v: [...v], t, primary: primaryOf(r, bodies, sys.muSun), accel: accelHeliocentric(r, bodies, sys.muSun) };
    this.version = 0;
    this.clockT = t;                 // the sim clock as last seen
    this.prevClockT = t;
    this.burns = [];
    this.script = [];                // scripted burns (a real mission's, from its data)
    this.scriptIsp = scriptIsp;      // s, or null
    this.scriptMass0 = this.dryMass + this.fuel;   // kg, the mass when the script began
    this.scriptOrder = [];           // the scripted burns in time order, with their masses
    this.holdAt = null;              // kernel seconds the kernel stops at until released (an aimed correction)
    this.nodes = [];                 // { id, t, dv: [radial, prograde, normal] km/s }
    this.executing = null;           // { node, burn }
    this.engineOn = false;           // manual engine
    this.lagSeconds = 0;             // physics behind the clock (budget ran out)
    this.crashed = false;
    this.impactBody = null;
    this.impactSite = null;          // { key, t, local: body-fixed km }
    this.splashed = false;           // came down under its chutes, not crashed
    this.landings = [];              // a journey's planned landings: { key, t, local, until, how, done }
    this.landed = null;              // on the ground: { key, local, t, until } (body-fixed km, kernel s)
    this.error = null;
    this.log = [];                   // { t, text } for the app to show
    this.clockJumped = false;
    if (bare) this.note('flown in the planner\'s model: point masses and zonal terms, no drag, full gravity fields or sunlight', t);
  }

  // The mass now: the dry mass, less what the mission's scripted burns have
  // drawn from it by the clock, and the player's fuel.
  get mass() { return this.dryMass + this.fuel - this.scriptSpentAt(this.clockT); }
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
  // Unlike the engine's burns they draw nothing from the player's tank and
  // survive clock jumps: they are tied to the mission's times. With a
  // scriptIsp they draw their propellant from the dry mass instead (the
  // mission's own tanks), by the rocket equation, so the craft gets
  // lighter burn by burn (scriptMasses).
  setScript(burns, about = 'earth') {
    // F = accel on a nominal 1 kg: the data give acceleration, not thrust
    // and mass, so these are flagged and their thrust ignores the mass.
    this.script = burns.map((b) => ({ t0: b.t0, t1: b.t1, dir: b.dir, F: b.accel, m0: 1, mdot: 0, frame: 'vnb', about: b.about ?? about, scripted: true }));
    this.scriptMass0 = this.dryMass + this.fuel;
    this.scriptMasses();
    this.version++;
  }

  // A scripted push added to the script: accel m/s^2 along a fixed EQJ
  // direction from t0 to t1 (an aimed correction; aimed: true marks it for
  // dropAimed).
  addScripted({ t0, t1, dir, accel }) {
    this.script.push({ t0, t1, dir: unit(dir), F: accel, m0: 1, mdot: 0, scripted: true, aimed: true });
    this.scriptMasses();
    this.version++;
  }
  // A journey's planned burns (journeyFlight.js), as the kernel took them
  // when it flew the plan: { t0, t1, dir, F (m/s^2 on a nominal 1 kg), m0,
  // mdot, frame?, about? }. Scripted, so they draw nothing from the tank
  // and keep to their times through clock jumps.
  addPlanned(burns) {
    for (const b of burns) this.script.push({ t0: b.t0, t1: b.t1, dir: [...b.dir], F: b.F, m0: 1, mdot: 0, scripted: true, ...(b.frame ? { frame: b.frame, about: b.about } : {}) });
    this.scriptMasses();
    this.version++;
  }

  // A journey's landings, as the kernel flew them headless (journeyFlight.js
  // landings: body, t touchdown, local the body-fixed site, until the
  // liftoff or null, how 'descent' | 'entry' | 'setdown'). A descent is
  // flown by the planned burns and its touchdown taken from the kernel's
  // impact (or ten minutes on, settled, if it never quite touches); an
  // entry or set-down is not flown below its perigee, so the craft is put
  // on the site at that time. The craft then waits there until the liftoff.
  addLandings(list) {
    this.landings = list.map((L) => ({ key: L.body, t: L.t, local: [...L.local], until: L.until ?? null, how: L.how, entryKm: L.entryKm, done: false }));
    this.version++;
  }
  nextLanding(after) { return this.landings.find((L) => !L.done && L.t + (L.how === 'descent' ? 600 : 0) > after - 1e-6) ?? null; }
  // Where a step that ended below a surface of radius R crossed it: back
  // along the two-body path about the body, in twentieth-of-a-second steps
  // (fourth-order Runge-Kutta; a craft settling at a few m/s is on a nearly
  // radial path, where the universal-variable propagator is ill-conditioned),
  // up to ten minutes back, the last step's crossing found by its fraction.
  // The kernel checks for the ground at the end of each step, which near
  // the ground in free fall can be a hundred metres down.
  groundCrossing(key, r, v, t, R) {
    const B = this.body(key, t);
    if (!B?.eph) return { r, v, t };
    const p0 = B.eph.position(t), v0 = B.eph.velocity(t);
    let d = sub(r, p0), w = sub(v, v0), tt = 0;
    if (norm(d) >= R) return { r, v, t };
    const f = (x) => { const n = norm(x); return [x[0] * -B.mu / n ** 3, x[1] * -B.mu / n ** 3, x[2] * -B.mu / n ** 3]; };
    const add3 = (a, b, k) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
    const h = -0.05;
    while (tt > -600) {
      const k1v = f(d), k1r = w;
      const k2v = f(add3(d, k1r, h / 2)), k2r = add3(w, k1v, h / 2);
      const k3v = f(add3(d, k2r, h / 2)), k3r = add3(w, k2v, h / 2);
      const k4v = f(add3(d, k3r, h)), k4r = add3(w, k3v, h);
      const dn = [0, 1, 2].map((i) => d[i] + h / 6 * (k1r[i] + 2 * k2r[i] + 2 * k3r[i] + k4r[i]));
      const wn = [0, 1, 2].map((i) => w[i] + h / 6 * (k1v[i] + 2 * k2v[i] + 2 * k3v[i] + k4v[i]));
      if (norm(dn) >= R) {
        const a = (R - norm(d)) / (norm(dn) - norm(d));
        d = add3(d, sub(dn, d), a); w = add3(w, sub(wn, w), a); tt += a * h;
        const at = t + tt, p = B.eph.position(at), pv = B.eph.velocity(at);
        return { r: [p[0] + d[0], p[1] + d[1], p[2] + d[2]], v: [pv[0] + w[0], pv[1] + w[1], pv[2] + w[2]], t: at };
      }
      d = dn; w = wn; tt += h;
    }
    return { r, v, t };
  }
  // Speed over a body's turning surface (km/s) at heliocentric r, v.
  groundSpeedOn(key, r, v, t) {
    const site = this.siteOn(key, r, t), g = site && this.siteState(site, t);
    return g ? norm(sub(v, g.v)) : Infinity;
  }
  setDown(L, local, t) {
    L.done = true;
    this.landed = { key: L.key, local, t, until: L.until };
    this.engineOn = false;
    this.version++;
    this.note(`landed on ${L.key}`, t);
  }
  liftOff() {
    const S = this.landed, x = this.siteState(S, S.until), B = this.body(S.key, S.until);
    const d = B?.eph ? sub(x.r, B.eph.position(S.until)) : [1, 0, 0], up = scale(d, 1e-3 / norm(d));
    const r = [x.r[0] + up[0], x.r[1] + up[1], x.r[2] + up[2]], bodies = this.sys.bodiesAt(S.until);
    this.kState = { r, v: x.v, t: S.until, primary: primaryOf(r, bodies, this.sys.muSun), accel: accelHeliocentric(r, bodies, this.sys.muSun) };
    this.landed = null;
    this.version++;
    this.note(`lift off from ${S.key}`, S.until);
  }

  // Aimed pushes still to come after t are dropped (the clock was set back
  // past them: they are aimed again when it reaches them).
  dropAimed(t) {
    const n = this.script.length;
    this.script = this.script.filter((b) => !(b.aimed && b.t1 > t));
    if (this.script.length !== n) { this.scriptMasses(); this.version++; }
  }

  // Each scripted burn's mass at its start (mass0, kg) and its flow
  // (massFlow, kg/s), in time order from scriptMass0: a constant
  // acceleration a over the burn takes the mass from m to m exp(-a dt / ve),
  // drawn here at a steady rate between the two. Without a scriptIsp, none.
  scriptMasses() {
    this.scriptOrder = [...this.script].sort((p, q) => p.t0 - q.t0);
    const ve = this.scriptIsp ? this.scriptIsp * G0 : 0;
    let m = this.scriptMass0;
    for (const b of this.scriptOrder) {
      if (!ve) { delete b.mass0; delete b.massFlow; continue; }
      const dt = b.t1 - b.t0, m1 = m * Math.exp(-Math.abs(b.F) * dt / ve);
      b.mass0 = m;
      b.massFlow = dt > 0 ? (m - m1) / dt : 0;
      m = m1;
    }
  }

  // Propellant (kg) the scripted burns have drawn by kernel time t.
  scriptSpentAt(t) {
    if (!this.scriptIsp || !this.scriptOrder.length) return 0;
    let m = this.scriptMass0;
    for (const b of this.scriptOrder) {
      if (b.mass0 === undefined) break;
      if (t < b.t0) { m = b.mass0; break; }
      if (t < b.t1) { m = b.mass0 - b.massFlow * (t - b.t0); break; }
      m = b.mass0 - b.massFlow * (b.t1 - b.t0);
    }
    return this.scriptMass0 - m;
  }

  // A tracking fix: the craft's state replaced by a measured one at time t.
  setState(r, v, t) {
    this.sys.focus?.(r, t);
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
    if (this.landed) {
      if (this.landed.until === null || this.clockT < this.landed.until) return null;
      this.liftOff();
    }
    let tEnd = this.holdAt !== null && this.holdAt < this.clockT ? this.holdAt : this.clockT;
    // Up to a landing's time at most, to be put down there.
    const L = this.nextLanding(this.kState.t);
    if (L) tEnd = Math.min(tEnd, L.t + (L.how === 'descent' ? 600 : 0));
    const span = tEnd - this.kState.t;
    if (Number.isNaN(span)) { this.error = 'non-finite physics time'; return null; }
    if (!(span > 0)) return null;
    const burns = [...this.burns, ...this.script].filter((b) => b.t1 > this.kState.t && b.t0 < tEnd)
      .map(({ t0, t1, dir, F, m0, mdot, frame, about, scripted, mass0, massFlow }) => ({ t0, t1, dir, F, m0, mdot, frame, about, scripted, ...(mass0 !== undefined ? { mass0, massFlow } : {}) }));
    return { id: this.id, version: this.version, r: [...this.kState.r], v: [...this.kState.v], t: this.kState.t, tEnd, primary: this.kState.primary, burns, env: this.bare ? null : this.envParams() };
  }

  // What the kernel's environment model needs of this craft (its mass as at
  // the kernel's time: between scripted burns the kernel has no burn to
  // read it from).
  envParams() { return { mass: this.dryMass + this.fuel - this.scriptSpentAt(this.kState.t), area: this.area, cr: this.cr, cd: this.cd, ...(this.earth ? { earth: this.earth } : {}), ...(this.vent ? { vent: this.vent } : {}), ...(this.entry ? { entry: { ...this.entry, state: this.entryState } } : {}) }; }

  // The same environment, for drawing the craft while the kernel lags
  // (rebuilt when the mass changes). Without the entry's lift and guidance:
  // a frame's carry is no place for the guidance's predictions.
  environment() {
    if (this.bare) return null;
    const key = `${this.mass}|${this.area}|${this.cr}|${this.cd}`;
    if (this._envKey !== key) { const { entry, ...p } = this.envParams(); this._env = makeEnvironment(this.sys, p); this._envKey = key; }
    return this._env;
  }

  // A new configuration from a time on (a capsule leaving its service
  // module): mass, area, drag coefficient, entry. The kernel's next request
  // flies it.
  // scriptIsp: null for a craft whose mass the scripted burns no longer
  // touch (the capsule has its own mass).
  configure({ dryMass = this.dryMass, fuel = this.fuel, area = this.area, cd = this.cd, cr = this.cr, entry = this.entry, vent = this.vent, scriptIsp = this.scriptIsp }) {
    Object.assign(this, { dryMass, fuel, area, cd, cr, entry, vent, scriptIsp });
    this.scriptMasses();
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
    this.sys.focus?.(res.r, res.t);
    if (res.envState?.entry) this.entryState = res.envState.entry;
    const impact = res.events.find((e) => e.type === 'impact');
    this.lagSeconds = (!res.complete && !impact) ? Math.max(0, res.tEnd - res.t) : 0;
    // A planned landing. An impact on its body within the hour of its time
    // is the touchdown if it is slower than TOUCHDOWN_SPEED over the ground
    // (taken where the craft crossed the ground, not at the end of the
    // kernel's step below it); faster, it falls through to the crash below.
    // Reaching the landing's time without an impact, the craft is put on
    // the planned site only if it is where the plan has it: a descent
    // within 100 m of the ground and as slow, an entry no higher than its
    // planned perigee and 50 km; otherwise the landing is missed and the
    // craft flies on.
    const L = this.nextLanding(this.kState.t - 3600);
    if (L) {
      if (impact && impact.body === L.key && Math.abs(impact.t - L.t) < 3600) {
        const x = this.groundCrossing(L.key, res.r, res.v, res.t, norm(L.local));
        const speed = this.groundSpeedOn(L.key, x.r, x.v, x.t);
        if (speed < TOUCHDOWN_SPEED) {
          const site = this.siteOn(L.key, x.r, x.t);
          this.setDown(L, site ? scale(site.local, norm(L.local) / norm(site.local)) : L.local, x.t);
          return;
        }
        L.done = true;
        this.note(`came down on ${L.key} at ${(speed * 1000).toFixed(0)} m/s: not a landing`, x.t);
      } else if (!impact && res.t >= L.t + (L.how === 'descent' ? 600 : 0) - 1e-6) {
        const B = this.body(L.key, res.t), h = B?.eph ? norm(sub(res.r, B.eph.position(res.t))) - norm(L.local) : Infinity;
        const near = L.how === 'descent' ? h < 0.1 && this.groundSpeedOn(L.key, res.r, res.v, res.t) < TOUCHDOWN_SPEED : L.how === 'entry' ? h <= (L.entryKm ?? 0) + 50 : true;
        if (near) { this.setDown(L, L.local, res.t); return; }
        L.done = true;
        this.note(`landing on ${L.key} missed: ${Number.isFinite(h) ? `${h.toFixed(1)} km up` : 'body not found'}`, res.t);
      }
    }
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

  // A body by key at t (any planet, its centre, or moon, split or not).
  body(key, t) {
    return this.sys.bodyAt ? this.sys.bodyAt(key, t) : this.sys.bodiesAt(t).find((b) => b.key === key);
  }

  primaryBody(key) {
    if (!key || key === 'sun') return null;
    return this.body(key, this.kState.t) ?? null;
  }

  // The state at the sim clock (kState carried forward, at most 30 days).
  // After an impact the craft lies where it came down, turning with the body
  // it hit: left where it was in space, the body would move off at its orbital
  // speed (the Earth goes 7 million km in three days).
  displayState() {
    if (this.crashed) return this.onSite(this.clockT) ?? { r: [...this.kState.r], v: [...this.kState.v] };
    if (this.landed) return this.siteState(this.landed, this.clockT) ?? { r: [...this.kState.r], v: [...this.kState.v] };
    let dtx = this.clockT - this.kState.t;
    if (!(dtx > 0)) dtx = 0;
    // Asked for several times a frame (the scene, the readouts): carried once.
    const key = `${this.clockT}|${this.kState.t}|${this.version}|${this.script.length}|${this.burns.length}`, sh = this._shown;
    if (!sh || sh.key !== key || sh.from !== this.kState || sh.r0 !== this.kState.r) this._shown = { key, from: this.kState, r0: this.kState.r, s: this.carryForward(Math.min(dtx, MAX_CARRY_S)) };
    return { r: [...this._shown.s.r], v: [...this._shown.s.v] };
  }

  // Speed over the Earth's turning surface (km/s) at heliocentric r, v.
  groundSpeed(r, v, t) {
    const E = this.body('earth', t);
    if (!E?.eph) return Infinity;
    const d = sub(r, E.eph.position(t)), w = E.pole ?? [0, 0, 1], om = 7.2921158553e-5, ve = E.eph.velocity(t);
    const spin = [om * (w[1] * d[2] - w[2] * d[1]), om * (w[2] * d[0] - w[0] * d[2]), om * (w[0] * d[1] - w[1] * d[0])];
    return norm([v[0] - ve[0] - spin[0], v[1] - ve[1] - spin[1], v[2] - ve[2] - spin[2]]);
  }

  // The impact point in the body's own frame (orientation.js), so it can be
  // carried with the body's motion and spin.
  siteOn(key, r, t) {
    const B = this.body(key, t);
    if (!B?.eph || !this.sys.msAt) return null;
    const d = sub(r, B.eph.position(t));
    const [X, Y, Z] = bodyAxesEqj(key, new Date(this.sys.msAt(t)));
    return { key, t, local: [dot(X, d), dot(Y, d), dot(Z, d)] };
  }

  // Where the impact point is at time t, and its velocity (the body's plus
  // the spin's, from the turn of the axes over a second).
  onSite(t) { return this.siteState(this.impactSite, t); }
  // A body-fixed site { key, local } at time t: position and velocity.
  siteState(S, t) {
    if (!S) return null;
    const B = this.body(S.key, t);
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
      const B = this.body(b.about, t);
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
    const P = key && key !== 'sun' ? this.body(key, from.t) : null;
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
