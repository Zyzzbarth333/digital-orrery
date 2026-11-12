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
//   second order (the kernel answers a frame or more late).

import { addJ2 } from './zonal.js';
import { propagate, rvToElements } from './orbital.js';
import { accelHeliocentric, primaryOf } from './nbody.js';
import { eqjToEcl } from './ephemeris.js';

export const G0 = 9.80665;                 // m/s^2, for Isp
const MAX_CARRY_S = 30 * 86400;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

let nextId = 1;

// Carry a craft forward about a primary with a J2: the primary's J2 turns
// with the craft around its orbit, so unlike the slower perturbations it
// cannot be held constant across a lag (in low orbit that is 0.24 km off
// after 10 minutes, 115 km after an hour). Two-body plus J2, with the other
// perturbations held at their value at the start (ap), by classical RK4 at
// 1/256 of the orbital period (or longer, at most 2,048 steps).
function carryWithJ2(r0, v0, dtx, P, ap) {
  const rn = norm(r0), en = 0.5 * (v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2) - P.mu / rn;
  const period = en < 0 ? 2 * Math.PI * Math.sqrt((-P.mu / (2 * en)) ** 3 / P.mu) : 2 * Math.PI * Math.sqrt(rn ** 3 / P.mu);
  const n = Math.min(2048, Math.max(1, Math.ceil(dtx / (period / 256)))), h = dtx / n;
  const f = (x, out) => {
    const r2 = x[0] * x[0] + x[1] * x[1] + x[2] * x[2], k = -P.mu / (r2 * Math.sqrt(r2));
    out[0] = k * x[0] + ap[0]; out[1] = k * x[1] + ap[1]; out[2] = k * x[2] + ap[2];
    addJ2(x[0], x[1], x[2], r2, P, out);
    return out;
  };
  let r = [...r0], v = [...v0];
  const a1 = [0, 0, 0], a2 = [0, 0, 0], a3 = [0, 0, 0], a4 = [0, 0, 0];
  for (let s = 0; s < n; s++) {
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
  constructor({ name, r, v, t, sys, dryMass = 1000, fuel = 500, thrust = 5000, isp = 320 }) {
    this.id = nextId++;
    this.name = name;
    this.sys = sys;
    this.dryMass = dryMass;          // kg
    this.fuel = fuel;                // kg, one tank
    this.thrust = thrust;            // N
    this.isp = isp;                  // s
    const bodies = sys.bodiesAt(t);
    this.kState = { r: [...r], v: [...v], t, primary: primaryOf(r, bodies, sys.muSun), accel: accelHeliocentric(r, bodies, sys.muSun) };
    this.version = 0;
    this.clockT = t;                 // the sim clock as last seen
    this.prevClockT = t;
    this.burns = [];
    this.nodes = [];                 // { id, t, dv: [radial, prograde, normal] km/s }
    this.executing = null;           // { node, burn }
    this.engineOn = false;           // manual engine
    this.lagSeconds = 0;             // physics behind the clock (budget ran out)
    this.crashed = false;
    this.impactBody = null;
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
      this.kState.t = tNow;
      this.lagSeconds = 0;
      this.version++;
      this.cancelBurns(this.clockT);
      this.burns = [];
      this.prevClockT = tNow;                      // no fuel drawn across the jump
      this.clockJumped = true;
      this.note(`clock set ${((tNow - this.prevClockT) / 86400).toFixed(2)} d away; state kept, burns cleared`, tNow);
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

  thrusting(t = this.clockT) { return this.burns.some((b) => b.t0 <= t && t < b.t1); }

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
    const tEnd = this.clockT, span = tEnd - this.kState.t;
    if (Number.isNaN(span)) { this.error = 'non-finite physics time'; return null; }
    if (!(span > 0)) return null;
    const burns = this.burns.filter((b) => b.t1 > this.kState.t && b.t0 < tEnd)
      .map(({ t0, t1, dir, F, m0, mdot }) => ({ t0, t1, dir, F, m0, mdot }));
    return { id: this.id, version: this.version, r: [...this.kState.r], v: [...this.kState.v], t: this.kState.t, tEnd, primary: this.kState.primary, burns };
  }

  // A request whose result will never come: nothing to undo (burns are tied
  // to absolute times, so the next request sends them again).
  dropped() {}

  applyResult(res) {
    if (this.crashed) return;
    if (res.error) { this.error = res.error; this.note(`kernel error: ${res.error}`); return; }
    if (res.version !== this.version) return;
    const prev = this.kState.primary;
    this.kState = { r: res.r, v: res.v, t: res.t, primary: res.primary, accel: res.accel };
    const impact = res.events.find((e) => e.type === 'impact');
    this.lagSeconds = (!res.complete && !impact) ? Math.max(0, res.tEnd - res.t) : 0;
    for (const e of res.events) {
      if (e.type === 'impact') { this.crashed = true; this.impactBody = e.body; this.engineOn = false; this.note(`impact on ${e.body}`, e.t); }
    }
    if (res.primary !== prev) this.note(`now in the sphere of influence of ${res.primary}`, res.t);
  }

  // ---------------- drawing ----------------

  primaryBody(key) {
    if (!key || key === 'sun') return null;
    return this.sys.bodiesAt(this.kState.t).find((b) => b.key === key) ?? null;
  }

  // The state at the sim clock (kState carried forward; not after an impact,
  // and at most 30 days).
  displayState() {
    let dtx = this.clockT - this.kState.t;
    if (!(dtx > 0) || this.crashed) dtx = 0;
    return this.carryForward(Math.min(dtx, MAX_CARRY_S));
  }

  carryForward(dtx) {
    const { r: r0, v: v0, accel: a } = this.kState;
    if (!(dtx > 0)) return { r: [...r0], v: [...v0] };
    const t0 = this.kState.t, t1 = t0 + dtx;
    const bodies = this.sys.bodiesAt(t0);
    // Within three spheres of influence of a planet its pull changes too fast
    // across a frame to be a correction to a solar orbit: carry the craft
    // around that planet instead.
    let key = this.kState.primary;
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
      const s = carryWithJ2(d, sub(v0, vP0), dtx, P, ap);
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
