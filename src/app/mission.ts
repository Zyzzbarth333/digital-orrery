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
//
// Real missions (public/missions/*.json, src/physics/realMission.js): the
// craft starts from its flown state, its burns are scripted as flown (all of
// them, or only the first, leaving the corrections to you), the flown path
// is drawn beside it, and its distance from that path is read out. Tracking
// fixes, if chosen, reset it to the flown state every few hours, and a clock
// set within the mission puts it where the real craft was.

import { useSyncExternalStore } from 'react';
import { Craft } from '../physics/craft.js';
import { KernelClient } from '../physics/kernelClient.js';
import { KERNEL_EPOCH_MS, kernelSeconds, kernelMs } from '../physics/kernelHost.js';
import { solarSystemBodies } from '../physics/bodies.js';
import { helioStateEqj } from '../physics/ephemeris.js';
import { departureHyperbola } from '../physics/launch.js';
import { RealMission } from '../physics/realMission.js';
import { ORION_ENTRIES, orionFor } from '../physics/orion.js';
import { conicPoints, eqjToEclFast, Trail } from '../scene/craftPaths';
import type { CraftView } from '../scene/craftLayer';

const MU_EARTH = 398600.4355;
// Heights about the Earth are measured from its equatorial radius (WGS-84),
// the sphere the ROCKET tab flies its ascent over (rocket.js's EARTH.R) and
// the usual reference for orbit altitudes; elsewhere from the mean radius.
export const R_EARTH_EQ = 6378.137;
export function altitudeRadius(key: string, meanRadiusKm: number): number { return key === 'earth' ? R_EARTH_EQ : meanRadiusKm; }
type V3 = [number, number, number];

export interface LaunchProps { dryMass: number; fuel: number; area: number; cr?: number; thrust?: number; isp?: number }
export type DepartureDirection = 'prograde' | 'retrograde' | 'outward' | 'inward';

export interface MissionSnapshot { version: number; selected: number | null }
export type RealBurns = 'all' | 'first';
// plan: the simulator's own design flown beside the real path (its file
// takes the flown path from another, flownFrom), not the real craft.
// A launch from the pad, flown from its precomputed ascent (rocket.js
// ascentTrack): geocentric J2000 states from liftoff to engine cutoff. The
// craft that reaches orbit is built at the start, so the camera following
// the climb follows it on; it joins the kernel at cutoff.
interface Ascent { craft: Craft; liftoffMs: number; cutoffMs: number; track: { ms: number; r: V3; v: V3 }[]; pathEcl: V3[]; flownEcl: V3[]; shown: number; version: number }
// aimed: the corrections are aimed from the craft (RealMission.aimCorrection)
// rather than replayed as flown; aimNext: the next of m.aims() to aim.
// entryId: the mission's Orion entry (orion.js), if it has one; separated:
// whether the craft is the crew module yet.
interface RealRun { m: RealMission; fixHours: number | null; lastMs: number; fixes: number; burns: RealBurns; refEcl: V3[]; plan: boolean; aimed: boolean; aimNext: number; aimedDv: number; asking?: string | null; answer?: unknown; entryId: string | null; separated: boolean }

// The real missions the app can fly: file id and label.
export const REAL_MISSIONS = [
  { id: 'artemis1', label: 'Artemis I · Nov 2022' },
  { id: 'artemis2', label: 'Artemis II · April 2026' },
  { id: 'artemis2-plan', label: 'Artemis II · our own plan' },
];
// Orion as sunlight sees it: 25,536 kg at the injection burn (from NASA's
// plan and the engine, artemis2.design.mjs), and a sunlit area of 92 m^2
// at Cr 1.3, the cannonball that fits Artemis I's coast arcs
// (docs/validation/artemis1.md). 500 kg of it is the propellant the app
// leaves for the corrections a player flies. It vents as the real Orion
// did (vent.js, calibrated on Artemis II's coast arcs): a push of a few
// um/s^2 that the tracking fixes correct, as JSC's did.
const ORION = { dryMass: 25036, fuel: 500, area: 92, cr: 1.3, vent: {} };

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
  private real = new Map<number, RealRun>();
  ascents: Ascent[] = [];

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
  private lastTimeMs = 0;
  frame(timeMs: number, jumps: number): void {
    this.lastTimeMs = timeMs;
    // Ascents reaching cutoff hand their craft to the kernel.
    for (const a of this.ascents.filter((x) => timeMs >= x.cutoffMs)) {
      this.ascents = this.ascents.filter((x) => x !== a);
      this.crafts.push(a.craft);
      if (this.snap.selected === null || this.snap.selected === a.craft.id) this.select(a.craft.id);
    }
    if (this.ascents.length) this.emit();
    if (!this.crafts.length) { this.lastJumps = jumps; return; }
    const t = kernelSeconds(new Date(timeMs));
    const jumped = jumps !== this.lastJumps;
    this.lastJumps = jumps;
    for (const c of this.crafts) c.advanceClock(t, jumped);
    for (const c of this.crafts) this.track(c, timeMs, jumped);
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

  // A craft from a geocentric J2000 state (km, km/s) at timeMs: the end of
  // a launch from the ROCKET tab, with the upper stage's mass and size.
  launchState(timeMs: number, rGeo: number[], vGeo: number[], name: string, props: LaunchProps): Craft {
    const c = this.stateCraft(timeMs, rGeo, vGeo, name, props);
    this.crafts.push(c);
    this.select(c.id);
    return c;
  }
  private stateCraft(timeMs: number, rGeo: number[], vGeo: number[], name: string, props: LaunchProps): Craft {
    const E = helioStateEqj('earth', new Date(timeMs));
    const r = [0, 1, 2].map((i) => rGeo[i] + E.r[i]) as V3, v = [0, 1, 2].map((i) => vGeo[i] + E.v[i]) as V3;
    return new Craft({ name, r, v, t: kernelSeconds(new Date(timeMs)), sys: this.sys, ...props });
  }

  // The same launch flown from the pad: the craft climbs along track
  // (seconds after liftoff, geocentric J2000 km and km/s, its last state the
  // cutoff) from liftoffMs, and becomes the orbiting craft at cutoff.
  launchAscent(liftoffMs: number, track: { t: number; r: number[]; v: number[] }[], name: string, props: LaunchProps): Craft {
    const end = track[track.length - 1];
    const cutoffMs = liftoffMs + end.t * 1000;
    const craft = this.stateCraft(cutoffMs, end.r, end.v, name, props);
    const pts = track.map((p) => ({ ms: liftoffMs + p.t * 1000, r: p.r as V3, v: p.v as V3 }));
    this.ascents.push({ craft, liftoffMs, cutoffMs, track: pts, pathEcl: pts.map((p) => eqjToEclFast(p.r)), flownEcl: [], shown: -1, version: 0 });
    this.snap = { ...this.snap, selected: craft.id };
    this.emit(true);
    return craft;
  }

  // An ascent's geocentric J2000 state at timeMs (on the pad before
  // liftoff), interpolated in its track.
  private ascentAt(a: Ascent, timeMs: number): { r: V3; v: V3; i: number } {
    const T = a.track;
    if (timeMs <= T[0].ms) return { r: T[0].r, v: T[0].v, i: 0 };
    let i = 1;
    while (i < T.length - 1 && T[i].ms < timeMs) i++;
    const p = T[i - 1], q = T[i], f = Math.min(1, (timeMs - p.ms) / (q.ms - p.ms || 1));
    const lerp = (x: V3, y: V3): V3 => [x[0] + f * (y[0] - x[0]), x[1] + f * (y[1] - x[1]), x[2] + f * (y[2] - x[2])];
    return { r: lerp(p.r, q.r), v: lerp(p.v, q.v), i: i - 1 };
  }

  // A climbing craft's height (km above the pad's radius), speed (km/s, in
  // J2000 axes) and seconds since liftoff, for the panels.
  ascentReadout(timeMs: number): { name: string; h: number; v: number; t: number } | null {
    const a = this.ascents[0];
    if (!a) return null;
    const s = this.ascentAt(a, timeMs);
    // Height above the sphere the ascent was flown over (rocket.js's EARTH.R,
    // the equatorial radius), as the ROCKET and MISSION tabs give it.
    return { name: a.craft.name, h: norm(s.r) - norm(a.track[0].r), v: norm(s.v), t: (timeMs - a.liftoffMs) / 1000 };
  }

  // The last window picked in the PLANNER (for the ROCKET tab to size a
  // rocket for): destination, departure date and launch energy.
  lastWindow: { dest: string; name: string; depMs: number; c3: number } | null = null;

  // A circular orbit about Earth at altitude altKm, inclined incDeg to the
  // J2000 equator, ascending node on the +x axis, starting at the node.
  launchOrbit(timeMs: number, altKm: number, incDeg: number): Craft {
    const E = helioStateEqj('earth', new Date(timeMs));
    const R = R_EARTH_EQ + altKm, vc = Math.sqrt(MU_EARTH / R), i = (incDeg * Math.PI) / 180;
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
    const st = departureHyperbola({ planetR: E.r, planetV: E.v, vInf: vi, mu: MU_EARTH, rp: R_EARTH_EQ + 200 });
    return this.add(name ?? `Probe ${++this.count}`, st.r as V3, st.v as V3, timeMs);
  }

  // ---------------- real missions ----------------

  async fetchReal(id: string): Promise<RealMission> {
    const get = async (name: string) => {
      const res = await fetch(`${import.meta.env.BASE_URL}missions/${name}.json`);
      if (!res.ok) throw new Error(`mission ${name}: HTTP ${res.status}`);
      return res.json();
    };
    const data = await get(id);
    // A plan flown beside a real mission takes that mission's flown path.
    if (data.flownFrom) data.flown = (await get(data.flownFrom)).flown;
    return new RealMission({ ...data, id });
  }

  // Fly a real mission from its start (the clock should already be there).
  flyReal(m: RealMission, burns: RealBurns = 'all'): Craft {
    const s = m.startState();
    const c = new Craft({ name: m.name, r: s.r as V3, v: s.v as V3, t: s.t, sys: this.sys, ...ORION });
    const keep = burns === 'all' ? m.burns : m.burns.slice(0, 1);
    c.setScript(new RealMission({ ...m.data, burns: keep }).script());
    c.note(burns === 'all' ? `${m.burns.length} burns scripted as flown` : `${keep[0].name} scripted as flown; the corrections are yours`, s.t);
    const refEcl = m.flown.map((p: number[]) => eqjToEclFast([p[1], p[2], p[3]]));
    const entryId = m.id && (ORION_ENTRIES as Record<string, unknown>)[m.id] ? m.id : null;
    this.real.set(c.id, { m, fixHours: null, lastMs: m.startMs, fixes: 0, burns, refEcl, plan: !!m.data.flownFrom, aimed: burns === 'all' && !m.data.flownFrom, aimNext: 0, aimedDv: 0, entryId, separated: false });
    this.crafts.push(c);
    this.select(c.id);
    return c;
  }

  realRun(c: Craft): RealRun | null { return this.real.get(c.id) ?? null; }
  setAimed(c: Craft, aimed: boolean): void {
    const R = this.real.get(c.id);
    if (!R || R.plan || R.burns !== 'all') return;
    R.aimed = aimed;
    if (!aimed) { c.holdAt = null; c.dropAimed(c.kState.t); }
    this.emit(true);
  }
  setFixHours(c: Craft, h: number | null): void {
    const R = this.real.get(c.id);
    if (R) { R.fixHours = h; R.lastMs = kernelMs(c.clockT); this.emit(true); }
  }

  // How far the craft is from where the real one was at the clock (km).
  distanceFromFlown(c: Craft): number | null {
    const R = this.real.get(c.id);
    return R ? R.m.distanceFromFlown(c.displayState().r, kernelMs(c.clockT)) : null;
  }

  // Tracking fixes due since the last frame (the latest one wins), and a
  // clock set within the mission: the craft goes where the real one was.
  private track(c: Craft, nowMs: number, jumped: boolean): void {
    const R = this.real.get(c.id);
    if (!R) return;
    if (jumped && R.plan) {
      // A plan has no flown state of its own: fly it again from its start,
      // which the kernel catches up to the clock.
      if (nowMs > R.m.startMs) { const s0 = R.m.startState(); c.setState(s0.r, s0.v, s0.t); c.note('clock set: flying the plan again from its start', s0.t); }
    } else if (jumped) {
      const x = R.m.fixAt(nowMs);
      if (x) { c.setState(x.r, x.v, x.t); c.note('clock set: placed on the flown path', x.t); }
    } else {
      const due = R.m.fixesBetween(R.lastMs, nowMs, R.fixHours);
      const x = due.length ? R.m.fixAt(due[due.length - 1]) : null;
      if (x) { c.setState(x.r, x.v, x.t); R.fixes += due.length; c.note('tracking fix: reset to the flown state', x.t); }
    }
    R.lastMs = nowMs;
    // Aimed corrections: the kernel holds at each one's start, where it is
    // worked out from the craft's own state (RealMission.aimStep).
    if (R.aimed) R.m.aimStep(c, this.sys, R, jumped, (req: object) => this.client.aim(req));
    else if (jumped) c.holdAt = null;
    this.entry(c, R, jumped);
  }

  // Orion's entry (orion.js, entry.js): at the separation time the craft
  // becomes the crew module, with its mass, size, Mach tables, parachutes and
  // the guidance's target; the kernel holds there so no request flies past
  // it as the whole spacecraft. A clock set back before it makes the craft
  // the whole spacecraft again.
  private entry(c: Craft, R: RealRun, jumped: boolean): void {
    const EN = R.entryId ? (ORION_ENTRIES as Record<string, { separationMs: number; target: { lat: number; lon: number } }>)[R.entryId] : null;
    if (!EN) return;
    const sepT = kernelSeconds(new Date(EN.separationMs));
    const become = (capsule: boolean) => {
      if (capsule) {
        const C = orionFor(R.entryId as string);
        c.configure({ dryMass: C.mass, fuel: 0, area: C.area, cd: C.cd, cr: 1.3, vent: null, entry: { aero: C.aero, chutes: C.chutes, target: EN.target } });
        c.note(`crew module separated from the service module: ${C.mass.toLocaleString()} kg, guided to ${EN.target.lat.toFixed(2)}, ${EN.target.lon.toFixed(2)}`, c.kState.t);
      } else c.configure({ ...ORION, entry: null });
      R.separated = capsule;
    };
    if (jumped && (c.kState.t >= sepT) !== R.separated) become(c.kState.t >= sepT);
    if (R.separated) return;
    if (c.kState.t >= sepT - 1e-6) become(true);
    else c.holdAt = Math.min(c.holdAt ?? Infinity, sepT);
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
    return [...this.ascentViews(), ...this.craftViews()];
  }

  // A climbing craft: its marker on the track, the climb flown so far as its
  // trail and the rest of the planned ascent as its path, about the Earth.
  private ascentViews(): CraftView[] {
    if (!this.ascents.length) return [];
    return this.ascents.map((a) => {
      const timeMs = this.lastTimeMs;
      const s = this.ascentAt(a, timeMs);
      if (s.i !== a.shown) { a.flownEcl = [...a.pathEcl.slice(0, s.i + 1)]; a.shown = s.i; a.version++; }
      const rel = eqjToEclFast(s.r);
      const t = kernelSeconds(new Date(timeMs));
      const earth = this.sys.bodiesAt(t).find((b: { key: string }) => b.key === 'earth');
      const rE: number[] = earth ? earth.eph.position(t) : [0, 0, 0];
      const rEcl = eqjToEclFast([s.r[0] + rE[0], s.r[1] + rE[1], s.r[2] + rE[2]]);
      return {
        id: a.craft.id, name: a.craft.name, rEcl, primaryEcl: eqjToEclFast(rE),
        conicEcl: a.pathEcl, trailEcl: [...a.flownEcl, rel], pathVersion: a.version * 2 + 1,
        thrusting: timeMs >= a.liftoffMs, crashed: false, selected: a.craft.id === this.snap.selected,
      };
    });
  }

  private craftViews(): CraftView[] {
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
      if (!c.crashed) path.trail.push(key, eqjToEclFast(rel));
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
      const R = this.real.get(c.id);
      const E = R ? this.sys.bodiesAt(c.clockT).find((b: { key: string }) => b.key === 'earth') : null;
      return {
        id: c.id, name: c.name, rEcl: eqjToEclFast(s.r), primaryEcl: eqjToEclFast(rP),
        conicEcl: path.conic, trailEcl: path.trail.points, pathVersion: path.version,
        thrusting: c.thrusting(), crashed: c.crashed, selected: c.id === this.snap.selected,
        flown: R && E ? { pointsEcl: R.refEcl, originEcl: eqjToEclFast(E.eph.position(c.clockT)) } : undefined,
      };
    });
  }

  // Warnings: a craft that crashed or that the kernel refused. The light
  // stays while such a craft exists; the master alarm sounds when a new one
  // appears and stays until acknowledged.
  private warned = new Set<number>();
  alarm = false;
  // A splashdown is how a flight ends, not a warning.
  get warning(): boolean { return this.crafts.some((c) => (c.crashed && !c.splashed) || !!c.error); }
  get warningText(): string {
    const c = this.crafts.find((x) => (x.crashed && !x.splashed) || x.error);
    return c ? (c.crashed ? `${c.name}: impact on ${c.impactBody}` : `${c.name}: ${c.error}`) : '';
  }
  acknowledge(): void { this.alarm = false; this.emit(true); }
  private checkAlarm(): void {
    for (const c of this.crafts) {
      if (((c.crashed && !c.splashed) || c.error) && !this.warned.has(c.id)) { this.warned.add(c.id); this.alarm = true; }
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
