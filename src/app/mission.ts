// src/app/mission.ts
//
// The mission: the spacecraft in flight, stepped by the n-body kernel in a
// Web Worker (KernelClient) once per rendered frame, and the launches that
// put them there. React reads it through useMission(), at most ten times a
// second.
//
// Launches (all from Earth for now; launch pads and weather come later):
// - into a circular parking orbit at a given altitude and inclination to
//   Earth's J2000 equator;
// - onto a departure hyperbola from a 200 km parking orbit, with the excess
//   velocity v_inf given as a speed along Earth's prograde, retrograde,
//   outward or inward direction, or as a vector from the planner's Lambert
//   arc (src/physics/launch.js: periapsis on the parking orbit, the outgoing
//   asymptote along v_inf, the lowest-inclination plane).

import { useSyncExternalStore } from 'react';
import { Craft } from '../physics/craft.js';
import { KernelClient } from '../physics/kernelClient.js';
import { KERNEL_EPOCH_MS, kernelSeconds } from '../physics/kernelHost.js';
import { solarSystemBodies } from '../physics/bodies.js';
import { helioStateEqj } from '../physics/ephemeris.js';
import { departureHyperbola } from '../physics/launch.js';
import { conicPoints, eqjToEclFast, Trail } from '../scene/craftPaths';
import type { CraftView } from '../scene/craftLayer';

const MU_EARTH = 398600.4355;
const R_EARTH = 6371.0084;
type V3 = [number, number, number];

export type DepartureDirection = 'prograde' | 'retrograde' | 'outward' | 'inward';

export interface MissionSnapshot { version: number; selected: number | null }

const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: number[]): V3 => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export class Mission {
  readonly sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  readonly client = new KernelClient();
  crafts: Craft[] = [];
  private snap: MissionSnapshot = { version: 0, selected: null };
  private listeners = new Set<() => void>();
  private lastNotify = 0;
  private lastJumps = 0;
  private count = 0;
  private paths = new Map<number, { trail: Trail; conic: V3[]; at: number; version: number }>();
  private plans = new Map<number, { target: string; name: string; arrivalMs: number; closest: number }>();

  get snapshot(): MissionSnapshot { return this.snap; }
  get selected(): Craft | null { return this.crafts.find((c) => c.id === this.snap.selected) ?? null; }

  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private emit(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastNotify < 100) return;
    this.lastNotify = now;
    this.snap = { ...this.snap, version: this.snap.version + 1 };
    for (const fn of this.listeners) fn();
  }

  select(id: number | null): void { this.snap = { ...this.snap, selected: id }; this.emit(true); }

  // Each rendered frame: the clock (and whether it was set), then the kernel.
  frame(timeMs: number, jumps: number): void {
    if (!this.crafts.length) { this.lastJumps = jumps; return; }
    const t = kernelSeconds(new Date(timeMs));
    const jumped = jumps !== this.lastJumps;
    this.lastJumps = jumps;
    for (const c of this.crafts) c.advanceClock(t, jumped);
    this.client.tick(this.crafts);
    this.checkAlarm();
    // Closest approach so far to a planned destination (its system barycentre).
    for (const c of this.crafts) {
      const p = this.plans.get(c.id);
      if (!p) continue;
      const B = this.sys.bodiesAt(c.kState.t).find((b: { key: string }) => b.key === p.target);
      if (B) p.closest = Math.min(p.closest, Math.hypot(c.kState.r[0] - B.r[0], c.kState.r[1] - B.r[1], c.kState.r[2] - B.r[2]));
    }
    this.emit();
  }

  // A craft's position and speed relative to its primary, at the clock.
  relative(c: Craft): { r: number; v: number } {
    const s = c.displayState();
    const P = this.primary(c);
    const rP = P ? P.eph.position(c.clockT) : [0, 0, 0], vP = this.primaryVelocity(c);
    return { r: Math.hypot(s.r[0] - rP[0], s.r[1] - rP[1], s.r[2] - rP[2]), v: Math.hypot(s.v[0] - vP[0], s.v[1] - vP[1], s.v[2] - vP[2]) };
  }
  private primary(c: Craft) {
    const key = c.kState.primary;
    return key && key !== 'sun' ? this.sys.bodiesAt(c.clockT).find((b: { key: string }) => b.key === key) : null;
  }
  primaryVelocity(c: Craft): number[] { const P = this.primary(c); return P ? P.eph.velocity(c.clockT) : [0, 0, 0]; }

  // A launch from the planner: remember where it is going and when.
  setPlan(c: Craft, target: string, name: string, arrivalMs: number): void {
    this.plans.set(c.id, { target, name, arrivalMs, closest: Infinity });
  }
  plan(c: Craft) { return this.plans.get(c.id) ?? null; }

  private add(name: string, r: V3, v: V3, timeMs: number): Craft {
    const c = new Craft({ name, r, v, t: kernelSeconds(new Date(timeMs)), sys: this.sys });
    this.crafts.push(c);
    this.select(c.id);
    return c;
  }

  // A circular orbit about Earth at altitude altKm, inclined incDeg to the
  // J2000 equator, ascending node on the +x axis, starting at the node.
  launchOrbit(timeMs: number, altKm: number, incDeg: number): Craft {
    const E = helioStateEqj('earth', new Date(timeMs));
    const R = R_EARTH + altKm, vc = Math.sqrt(MU_EARTH / R), i = (incDeg * Math.PI) / 180;
    const r: V3 = [E.r[0] + R, E.r[1], E.r[2]];
    const v: V3 = [E.v[0], E.v[1] + vc * Math.cos(i), E.v[2] + vc * Math.sin(i)];
    return this.add(`Orbiter ${++this.count}`, r, v, timeMs);
  }

  // A departure hyperbola from a 200 km parking orbit with excess velocity
  // vInf (EQJ km/s), or a speed along one of Earth's orbital directions.
  launchDeparture(timeMs: number, vInf: V3 | { speed: number; dir: DepartureDirection }, name?: string): Craft {
    const E = helioStateEqj('earth', new Date(timeMs));
    let vi: V3;
    if (Array.isArray(vInf)) vi = vInf;
    else {
      const pro = unit(E.v), out = unit(cross(cross(E.r, E.v), E.v)).map((x) => -x) as V3;
      const d = { prograde: pro, retrograde: pro.map((x) => -x), outward: out, inward: out.map((x) => -x) }[vInf.dir];
      vi = d.map((x) => x * vInf.speed) as V3;
    }
    const st = departureHyperbola({ planetR: E.r, planetV: E.v, vInf: vi, mu: MU_EARTH, rp: R_EARTH + 200 });
    return this.add(name ?? `Probe ${++this.count}`, st.r as V3, st.v as V3, timeMs);
  }

  // Removal can be undone: the last craft removed is kept until the next.
  lastRemoved: Craft | null = null;
  restore(): void {
    const c = this.lastRemoved;
    if (!c) return;
    this.lastRemoved = null;
    this.crafts.push(c);
    this.select(c.id);
  }

  remove(c: Craft): void {
    this.lastRemoved = c;
    this.crafts = this.crafts.filter((x) => x !== c);
    if (this.snap.selected === c.id) this.select(this.crafts.at(-1)?.id ?? null);
    else this.emit(true);
  }

  // What the scene draws, at the sim clock: each craft's position, its
  // primary's, its osculating conic (resampled at most five times a second)
  // and its flown path, all heliocentric ecliptic km.
  views(): CraftView[] {
    const now = performance.now();
    return this.crafts.map((c) => {
      const s = c.displayState();
      const key = c.kState.primary as string;
      const P = key && key !== 'sun' ? this.sys.bodiesAt(c.clockT).find((b: { key: string }) => b.key === key) : null;
      const rP: number[] = P ? P.eph.position(c.clockT) : [0, 0, 0];
      const vP: number[] = P ? P.eph.velocity(c.clockT) : [0, 0, 0];
      const rel = [s.r[0] - rP[0], s.r[1] - rP[1], s.r[2] - rP[2]];
      let path = this.paths.get(c.id);
      if (!path) { path = { trail: new Trail(), conic: [], at: 0, version: 0 }; this.paths.set(c.id, path); }
      const before = path.trail.points.length + (path.trail.key === key ? 0 : -1);
      path.trail.push(key, eqjToEclFast(rel));
      let changed = path.trail.points.length !== before;
      if (now - path.at > 200) {
        const mu = P ? P.mu : this.sys.muSun;
        const rMax = P ? Math.hypot(rP[0], rP[1], rP[2]) * Math.pow(mu / this.sys.muSun, 0.4) : 50 * 1.496e8;
        const relV = [s.v[0] - vP[0], s.v[1] - vP[1], s.v[2] - vP[2]];
        path.conic = c.crashed ? [] : conicPoints(rel, relV, mu, rMax).map(eqjToEclFast);
        path.at = now;
        changed = true;
      }
      if (changed) path.version++;
      return {
        id: c.id, name: c.name, rEcl: eqjToEclFast(s.r), primaryEcl: eqjToEclFast(rP),
        conicEcl: path.conic, trailEcl: path.trail.points, pathVersion: path.version,
        thrusting: c.thrusting(), crashed: c.crashed, selected: c.id === this.snap.selected,
      };
    });
  }

  // Warnings: a craft that crashed or that the kernel refused. The light
  // stays while such a craft exists; the master alarm sounds when a new one
  // appears and stays until acknowledged.
  private warned = new Set<number>();
  alarm = false;
  get warning(): boolean { return this.crafts.some((c) => c.crashed || !!c.error); }
  get warningText(): string {
    const c = this.crafts.find((x) => x.crashed || x.error);
    return c ? (c.crashed ? `${c.name}: impact on ${c.impactBody}` : `${c.name}: ${c.error}`) : '';
  }
  acknowledge(): void { this.alarm = false; this.emit(true); }
  private checkAlarm(): void {
    for (const c of this.crafts) {
      if ((c.crashed || c.error) && !this.warned.has(c.id)) { this.warned.add(c.id); this.alarm = true; }
    }
  }

  // Any craft behind the clock by more than a minute (the kernel's step
  // budget ran out; it catches up rather than taking unsafe steps).
  get lagging(): boolean { return this.crafts.some((c) => c.lagSeconds > 60); }
  get stepping(): boolean { return this.crafts.some((c) => !c.crashed && !c.error); }
}

export function useMission(m: Mission): MissionSnapshot {
  return useSyncExternalStore(m.subscribe, () => m.snapshot);
}
