// src/scene/cameraRig.ts
//
// The orbit camera and its flights (docs/frontend/camera.md).
//
// The camera looks at a pivot and sits `dist` km from it at azimuth `az`
// and elevation `el` in the ecliptic frame. The pivot is a target (a body
// or a craft, read live every frame) plus a settling offset.
//
// A flight from one target to another follows van Wijk and Nuij's optimal
// zoom-and-pan path ("Smooth and efficient zooming and panning", 2003):
// in (u, w) space, with u the distance travelled along the line between
// the two targets and w the width of the view, the path zooms out, crosses
// and zooms in, and its length S in that metric measures how far the
// move really is. Both ends are read live, so bodies may move during the
// flight (time warp) and the camera still lands on them. Duration grows
// with S, from 0.8 s (a moon) to 3 s (across the system).
//
// Control stays with the user:
// - a click during a flight starts a new path from where the camera is;
// - a drag, a scroll or Escape ends the flight on the spot, and the aim
//   settles on the new target with a critically damped spring (no
//   overshoot) while the user steers;
// - with reduced motion a flight is a cut.
//
// Panning moves the pivot off the target by an offset (km, ecliptic) that
// rides with it, so a panned view still follows a moving body. Any flight
// clears it; recentre() eases it back onto the target with the same spring
// as the settle.

type Vec3 = [number, number, number];

export interface Anchor {
  id: string;                 // 'body:mars', 'craft:3'
  pos: () => Vec3 | null;     // heliocentric ecliptic km, now; null if gone
  minDist: number;            // closest the camera may be, km (1.2 radii; 0.05 km for a craft)
}

// The view a first visit opens on, and HOME returns to: the inner planets
// from above the ecliptic, about the Sun.
export const HOME = { az: -1.2, el: 0.5, dist: 1.6e9 };

const RHO = 1.42;             // van Wijk & Nuij's users' mean preference
const WIDTH_PER_KM = 2 * Math.tan((45 / 2) * Math.PI / 180);  // view height per km of distance (45 deg)
const SETTLE_OMEGA = 7;       // rad/s: the aim settles in about 0.6 s
const ZOOM_TAU = 0.09;        // s: the wheel's zoom eases in over about a quarter second

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x: number) => 1 - (1 - x) ** 3;

// The optimal path between views (u0 = 0, w0) and (u1, w1): returns S and
// the view (fraction of u1 travelled, w) at arc length s.
export function zoomPath(u1: number, w0: number, w1: number, rho = RHO): { S: number; at: (s: number) => [number, number] } {
  const r2 = rho * rho, r4 = r2 * r2;
  if (u1 < 1e-9 * Math.max(w0, w1)) {
    const S = Math.abs(Math.log(w1 / w0)) / rho;
    const k = Math.sign(w1 - w0);
    return { S, at: (s) => [S > 0 ? s / S : 1, w0 * Math.exp(k * rho * s)] };
  }
  // r_i = ln(sqrt(b_i^2 + 1) - b_i) = -asinh(b_i), which stays exact when
  // b_i is large (a planet seen from across the solar system).
  const b0 = (w1 * w1 - w0 * w0 + r4 * u1 * u1) / (2 * w0 * r2 * u1);
  const b1 = (w1 * w1 - w0 * w0 - r4 * u1 * u1) / (2 * w1 * r2 * u1);
  const rA = -Math.asinh(b0), rB = -Math.asinh(b1);
  const S = (rB - rA) / rho;
  const c0 = Math.cosh(rA), s0 = Math.sinh(rA);
  return {
    S,
    at: (s) => {
      const u = (w0 / r2) * (c0 * Math.tanh(rho * s + rA) - s0);
      return [u / u1, (w0 * c0) / Math.cosh(rho * s + rA)];
    },
  };
}

// Seconds for a path of length S: short hops near a second, the widest
// crossings capped at three.
export const flightSeconds = (S: number) => Math.min(3, Math.max(0.8, 0.5 + 0.17 * S));

interface Flight {
  from: Anchor; fromOffset: Vec3;     // start pivot = from.pos() + fromOffset
  to: Anchor;
  w0: number; w1: number;              // view widths, km
  t: number; T: number;                // seconds elapsed, duration
  ease: (x: number) => number;
  turn: { az0: number; el0: number; dAz: number; dEl: number } | null;   // az and el eased along with the path (HOME)
}

export class CameraRig {
  az = HOME.az;
  el = HOME.el;
  dist = HOME.dist;             // km from the pivot
  pivot: Vec3 = [0, 0, 0];      // km, this frame
  pan: Vec3 = [0, 0, 0];        // km: how far the user has panned the pivot off the target
  target: Anchor;
  onArrive: (target: Anchor) => void = () => {};

  private goalDist = this.dist; // where the wheel is taking dist
  private settle: Vec3 = [0, 0, 0];
  private settleV: Vec3 = [0, 0, 0];
  private flight: Flight | null = null;
  private reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  constructor(target: Anchor) { this.target = target; }

  get flying(): boolean { return this.flight !== null; }
  get goalDistance(): number { return this.goalDist; }
  // Where the camera is headed, for zoom memory and limits.
  get destination(): Anchor { return this.flight?.to ?? this.target; }
  // How far through its flight the camera is, eased as the path is (0 to
  // 1); 1 with none.
  get progress(): number { const f = this.flight; return f ? f.ease(Math.min(1, f.t / f.T)) : 1; }
  // Whether the pivot is off the target (a pan not yet recentred).
  get panned(): boolean { return this.pan[0] !== 0 || this.pan[1] !== 0 || this.pan[2] !== 0; }

  // Start a flight to `to`, ending `endDist` km from it, and, given `turn`,
  // at that azimuth and elevation (the shorter way round).
  flyTo(to: Anchor, endDist: number, turn?: { az: number; el: number }): void {
    const pNow = this.pivot;
    const from = this.flight ? this.flight.to : this.target;
    const fromPos = from.pos();
    const toPos = to.pos();
    const retarget = this.flight !== null;
    this.pan = [0, 0, 0];             // the flight starts from the panned pivot (pNow)
    // A cut with reduced motion, or when either end has no position yet
    // (a ?focus= link before the first frame).
    if (this.reduced?.matches || !fromPos || !toPos) {
      this.flight = null;
      this.target = to;
      this.settle = [0, 0, 0]; this.settleV = [0, 0, 0];
      this.dist = this.goalDist = endDist;
      if (turn) { this.az = turn.az; this.el = turn.el; }
      this.onArrive(to);
      return;
    }
    const dAz = turn ? Math.atan2(Math.sin(turn.az - this.az), Math.cos(turn.az - this.az)) : 0;
    this.flight = {
      from, fromOffset: sub(pNow, fromPos), to,
      w0: this.dist * WIDTH_PER_KM, w1: endDist * WIDTH_PER_KM,
      t: 0, T: 1, ease: retarget ? easeOut : easeInOut,
      turn: turn ? { az0: this.az, el0: this.el, dAz, dEl: turn.el - this.el } : null,
    };
    const S = zoomPath(norm(sub(toPos, pNow)), this.flight.w0, this.flight.w1).S;
    this.flight.T = flightSeconds(S);
    this.settle = [0, 0, 0]; this.settleV = [0, 0, 0];
  }

  // The user took the controls: stop here, aim settles on the destination.
  interrupt(): void {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    this.target = f.to;
    const p = f.to.pos();
    this.settle = p ? sub(this.pivot, p) : [0, 0, 0];
    this.settleV = [0, 0, 0];
    // Stopped while still closer than the new body's radius (early in a
    // flight toward something bigger): the zoom eases back out to it while
    // the aim settles, rather than leaving the camera inside the body.
    this.goalDist = Math.max(this.dist, f.to.minDist);
    this.onArrive(f.to);
  }

  // Follow a target at once (no flight): the craft a mission starts on.
  jumpTo(to: Anchor, dist: number): void {
    this.flight = null;
    this.target = to;
    this.settle = [0, 0, 0]; this.settleV = [0, 0, 0];
    this.pan = [0, 0, 0];
    this.dist = this.goalDist = dist;
  }

  // Move the pivot by d km (ecliptic), off the target: a drag that pans.
  // A flight under way stops where it is, and the aim stays there (its
  // settle becomes part of the pan) rather than drifting on to the target.
  panBy(d: Vec3): void {
    if (this.flight) {
      this.interrupt();
      this.pan = add(this.pan, this.settle);
      this.settle = [0, 0, 0]; this.settleV = [0, 0, 0];
    }
    this.pan = add(this.pan, d);
  }

  // Back onto the target: the pan becomes a settle offset, which the spring
  // takes to zero (about 0.6 s, no overshoot).
  recentre(): void {
    if (!this.panned) return;
    this.settle = add(this.settle, this.pan);
    this.pan = [0, 0, 0];
  }

  // A view put back as it was (a refresh): no flight, no settle.
  restore(to: Anchor, v: { az: number; el: number; dist: number; pan: Vec3 }): void {
    this.flight = null;
    this.target = to;
    this.settle = [0, 0, 0]; this.settleV = [0, 0, 0];
    this.az = v.az; this.el = Math.max(-1.5, Math.min(1.5, v.el));
    this.dist = this.goalDist = Math.max(to.minDist, v.dist);
    this.pan = [...v.pan];
  }

  zoom(factor: number, minDist: number, maxDist: number): void {
    this.interrupt();
    this.goalDist = Math.max(minDist, Math.min(maxDist, this.goalDist * factor));
  }

  rotate(dAz: number, dEl: number): void {
    this.interrupt();
    this.az += dAz;
    this.el = Math.max(-1.5, Math.min(1.5, this.el + dEl));
  }

  // Advance by dt seconds; sets pivot and dist. Returns false if the
  // target has no position (a removed craft).
  update(dt: number): boolean {
    const f = this.flight;
    if (f) {
      f.t += dt;
      const p0 = f.from.pos(), p1 = f.to.pos();
      if (!p0 || !p1) { this.interrupt(); return this.update(0); }
      const start = add(p0, f.fromOffset);
      const d = sub(p1, start);
      const x = Math.min(1, f.t / f.T);
      const path = zoomPath(norm(d), f.w0, f.w1);
      const [frac, w] = path.at(path.S * f.ease(x));
      this.pivot = add(start, scale(d, frac));
      this.dist = this.goalDist = w / WIDTH_PER_KM;
      if (f.turn) {
        const e = f.ease(x);
        this.az = f.turn.az0 + f.turn.dAz * e;
        this.el = f.turn.el0 + f.turn.dEl * e;
      }
      if (x >= 1) {
        this.flight = null;
        this.target = f.to;
        this.pivot = p1;
        this.dist = this.goalDist = f.w1 / WIDTH_PER_KM;
        this.onArrive(f.to);
      }
      return true;
    }
    const p = this.target.pos();
    if (!p) return false;
    // Critically damped settle of the aim onto the target.
    if (this.settle[0] !== 0 || this.settle[1] !== 0 || this.settle[2] !== 0) {
      const h = Math.min(dt, 0.05), w = SETTLE_OMEGA;
      for (let i = 0; i < 3; i++) {
        const a = -w * w * this.settle[i] - 2 * w * this.settleV[i];
        this.settleV[i] += a * h;
        this.settle[i] += this.settleV[i] * h;
      }
      if (norm(this.settle) < 1e-6 * this.dist) { this.settle = [0, 0, 0]; this.settleV = [0, 0, 0]; }
    }
    this.pivot = add(add(p, this.settle), this.pan);
    // The wheel's zoom eases in, in log distance.
    if (this.dist !== this.goalDist) {
      const k = 1 - Math.exp(-dt / ZOOM_TAU);
      this.dist = Math.exp(Math.log(this.dist) + (Math.log(this.goalDist) - Math.log(this.dist)) * k);
      if (Math.abs(this.dist / this.goalDist - 1) < 1e-4) this.dist = this.goalDist;
    }
    return true;
  }
}
