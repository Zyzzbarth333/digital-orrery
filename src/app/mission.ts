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
// Craft launched here carry an attitude by default (sixdof: craftAttitude.js,
// docs/physics/sixdof.md#attitude-in-the-app): they point, turn under a
// torque limit and burn along their body axis. The MISSION tab's own craft
// is the 1.5 t box (DEFAULT_ATTITUDE); a ROCKET-tab launch's attitude is
// sized to its stage (stageAttitude). Real missions and journeys stay point
// masses, so their validations are untouched.
//
// Real missions (public/missions/*.json, src/physics/realMission.js): the
// craft starts from its flown state, its burns are scripted as flown (all of
// them, or only the first, leaving the corrections to you), the flown path
// is drawn beside it, and its distance from that path is read out. Tracking
// fixes, if chosen, reset it to the flown state every few hours, and a clock
// set within the mission puts it where the real craft was.

import { sunlight } from '../physics/discs.js';
import type { Sunlight } from './sunlight';
import { useSyncExternalStore } from 'react';
import { Craft } from '../physics/craft.js';
import { KernelClient } from '../physics/kernelClient.js';
import { KERNEL_EPOCH_MS, kernelSeconds, kernelMs } from '../physics/kernelHost.js';
import { solarSystemBodies } from '../physics/bodies.js';
import { helioStateEqj } from '../physics/ephemeris.js';
import { departureHyperbola } from '../physics/launch.js';
import { JOURNEY_CRAFT } from '../physics/journeyFlight.js';
import { craftWarns } from './craft-state.js';
import { RealMission } from '../physics/realMission.js';
import { ORION_CRAFT, ORION_ENTRIES, orionFor } from '../physics/orion.js';
import { conicPoints, eqjToEclFast, Trail } from '../scene/craftPaths';
import { quatToMatrix } from '../physics/rigidbody.js';
import { stageAttitude } from '../physics/craftAttitude.js';
import type { CraftView } from '../scene/craftLayer';
import { modelNote, ATTITUDE_NOTE, type CraftModelSpec, type ModelPose, type StackShape } from '../scene/craftModels';
import { missionModelKey, LICIACUBE, PROBE_MODELS } from '../scene/probeModels';
import { bodyAxesEqj } from '../physics/orientation.js';
import { vnbToInertial } from '../physics/attitude.js';
import { propagate } from '../physics/orbital.js';

const MU_EARTH = 398600.4355;
// Heights about the Earth are measured from its equatorial radius (WGS-84),
// the sphere the ROCKET tab flies its ascent over (rocket.js's EARTH.R) and
// the usual reference for orbit altitudes; elsewhere from the mean radius.
export const R_EARTH_EQ = 6378.137;
export function altitudeRadius(key: string, meanRadiusKm: number): number { return key === 'earth' ? R_EARTH_EQ : meanRadiusKm; }
type V3 = [number, number, number];

// A launch's craft (the ROCKET tab's: the stage left at cutoff, any above it
// and the payload): its masses (kg), its engine, its drag and sunlit area
// (m^2), and for its attitude its diameter (m; else from the area, a
// circle's) and the full propellant load of its stages (capacity, kg; else
// the fuel), which size its tank (craftAttitude.js stageAttitude).
// shape: the stack's shape for the scene (stackShape.js) and stage the
// index of its lowest stage still attached at cutoff.
export interface LaunchProps { dryMass: number; fuel: number; area: number; cr?: number; thrust?: number; isp?: number; diameter?: number; capacity?: number; shape?: StackShape; stage?: number }
export type DepartureDirection = 'prograde' | 'retrograde' | 'outward' | 'inward';

export interface MissionSnapshot { version: number; selected: number | null }
export type RealBurns = 'all' | 'first';
// plan: the simulator's own design flown beside the real path (its file
// takes the flown path from another, flownFrom), not the real craft.
// A launch from the pad, flown from its precomputed ascent (rocket.js
// ascentTrack): geocentric J2000 states from liftoff to engine cutoff. The
// craft that reaches orbit is built at the start, so the camera following
// the climb follows it on; it joins the kernel at cutoff.
// For the scene's model: the stack's shape, its separations (s after
// liftoff), the Earth's axes at liftoff (rows: the Earth-fixed axes in
// J2000), and lift: how far below the ascent's sphere (rocket.js's
// equatorial radius) the ground at the pad lies (km).
interface Ascent { craft: Craft; liftoffMs: number; cutoffMs: number; track: { ms: number; r: V3; v: V3 }[]; pathEcl: V3[]; flownEcl: V3[]; shown: number; version: number; shape: StackShape | null; seps: number[]; axes0: number[][]; lift: number }
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
  { id: 'juno2013', label: 'Juno · Earth flyby, 2012–13' },
  { id: 'dart', label: 'DART · impact on Dimorphos, Sep 2022' },
  { id: 'lro', label: 'LRO · capture at the Moon, June 2009' },
  { id: 'messenger', label: 'MESSENGER · cruise to Mercury, 2004–11' },
];
// Orion as the app flies a real mission: its mass falling burn by burn,
// its sunlit area and its venting (ORION_CRAFT in src/physics/orion.js).
const ORION = ORION_CRAFT;

const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: number[]): V3 => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// The Earth's spin (rad/s, WGS-84) about its pole (the third Earth-fixed
// axis, a row of bodyAxesEqj's matrix), as a J2000 vector.
const OMEGA_EARTH = 7.292115e-5;
const omegaOf = (A: number[][]): V3 => [A[2][0] * OMEGA_EARTH, A[2][1] * OMEGA_EARTH, A[2][2] * OMEGA_EARTH];
// The ground's radius under r (J2000 km) on the WGS-84 ellipsoid, A the
// Earth's axes then.
function groundRadius(r: number[], A: number[][]): number {
  const a = R_EARTH_EQ, b = 6356.752, sinc = dot3(r, A[2]) / norm(r), cosc = Math.sqrt(Math.max(0, 1 - sinc * sinc));
  return (a * b) / Math.hypot(b * cosc, a * sinc);
}
// Body axes with +x along x and +z as near s as is square to it (or any
// square direction when s is along x).
function axesAlong(x: number[], s: number[]): [V3, V3, V3] {
  const X = unit(x);
  let side = s;
  if (!(norm(side) > 0) || Math.abs(dot3(unit(side), X)) > 0.99) side = Math.abs(X[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const d = dot3(side, X), Z = unit([side[0] - d * X[0], side[1] - d * X[1], side[2] - d * X[2]]);
  return [X, cross(Z, X), Z];
}
// A climbing stack's axes (ecliptic): nose along its velocity through the
// air, the Earth's turning taken off (straight up on the pad); +z along
// the launch plane's normal.
function ascentAxes(r: number[], v: number[], timeMs: number): [V3, V3, V3] {
  const A = bodyAxesEqj('earth', new Date(timeMs)) as number[][];
  const w = cross(omegaOf(A), r), va = [v[0] - w[0], v[1] - w[1], v[2] - w[2]];
  const x = norm(va) > 1e-3 ? va : r;
  return axesAlong(x, cross(r, v)).map(eqjToEclFast) as [V3, V3, V3];
}
// A spent stage is drawn for this long after it separates (s).
const SPENT_S = 60;

export class Mission {
  readonly sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  readonly client = new KernelClient();
  crafts: Craft[] = [];
  private snap: MissionSnapshot = { version: 0, selected: null };
  private listeners = new Set<() => void>();
  private lastNotify = 0;
  private lastJumps = 0;
  private count = 0;
  private paths = new Map<number, { trail: Trail; conic: V3[]; at: number; version: number; rMax: number }>();
  private plans = new Map<number, { target: string; name: string; arrivalMs: number; closest: number }>();
  private real = new Map<number, RealRun>();
  ascents: Ascent[] = [];
  // New launches carry an attitude (6-DOF), or fly as point masses.
  sixdof = true;
  private attitude(): object | null { return this.sixdof ? {} : null; }

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
    // Closest approach so far to a planned destination (the planet's centre).
    for (const c of this.crafts) {
      const p = this.plans.get(c.id);
      if (!p) continue;
      const B = this.sys.bodyAt(p.target, c.kState.t);
      if (B) p.closest = Math.min(p.closest, Math.hypot(c.kState.r[0] - B.r[0], c.kState.r[1] - B.r[1], c.kState.r[2] - B.r[2]));
    }
    this.emit();
  }

  // The Sun seen from a craft at the clock: the share of its disc the
  // kernel's bodies leave (discs.js sunlight, the deepest one), as its
  // solar pressure takes it (environment.js shadow).
  sunlight(c: Craft): Sunlight {
    const s = c.displayState();
    const bodies = (this.sys.bodiesAt(c.clockT) as { key: string; r: number[]; radius: number }[])
      .filter((b) => b.key !== 'sun' && b.radius > 0)
      .map((b) => ({ key: b.key, rel: [b.r[0] - s.r[0], b.r[1] - s.r[1], b.r[2] - s.r[2]], radius: b.radius }));
    return sunlight([-s.r[0], -s.r[1], -s.r[2]], bodies);
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
    return key && key !== 'sun' ? this.sys.bodyAt(key, c.clockT) : null;
  }
  primaryVelocity(c: Craft): number[] { const P = this.primary(c); return P ? P.eph.velocity(c.clockT) : [0, 0, 0]; }

  // A launch from the planner: remember where it is going and when.
  setPlan(c: Craft, target: string, name: string, arrivalMs: number): void {
    this.plans.set(c.id, { target, name, arrivalMs, closest: Infinity });
  }
  plan(c: Craft) { return this.plans.get(c.id) ?? null; }

  private add(name: string, r: V3, v: V3, timeMs: number): Craft {
    const c = new Craft({ name, r, v, t: kernelSeconds(new Date(timeMs)), sys: this.sys, attitude: this.attitude() });
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
    const { diameter, capacity, shape, stage, ...craft } = props;
    const d = diameter ?? Math.sqrt(4 * props.area / Math.PI);
    const attitude = this.sixdof ? stageAttitude({ dryMass: props.dryMass, fuel: props.fuel, capacity, diameter: d, isp: props.isp }) : null;
    const c = new Craft({ name, r, v, t: kernelSeconds(new Date(timeMs)), sys: this.sys, attitude, ...craft });
    if (shape) this.shapes.set(c.id, { shape, from: stage ?? 0 });
    return c;
  }
  // A ROCKET-tab craft's stack, for its model: the shape and its lowest
  // stage still attached.
  private shapes = new Map<number, { shape: StackShape; from: number }>();

  // The same launch flown from the pad: the craft climbs along track
  // (seconds after liftoff, geocentric J2000 km and km/s, its last state the
  // cutoff) from liftoffMs, and becomes the orbiting craft at cutoff.
  // seps: the ascent's stage separations (s after liftoff), for the model.
  launchAscent(liftoffMs: number, track: { t: number; r: number[]; v: number[] }[], name: string, props: LaunchProps, seps: number[] = []): Craft {
    const end = track[track.length - 1];
    const cutoffMs = liftoffMs + end.t * 1000;
    const craft = this.stateCraft(cutoffMs, end.r, end.v, name, props);
    const pts = track.map((p) => ({ ms: liftoffMs + p.t * 1000, r: p.r as V3, v: p.v as V3 }));
    const axes0 = bodyAxesEqj('earth', new Date(liftoffMs)) as number[][];
    this.ascents.push({ craft, liftoffMs, cutoffMs, track: pts, pathEcl: pts.map((p) => eqjToEclFast(p.r)), flownEcl: [], shown: -1, version: 0,
      shape: props.shape ?? null, seps, axes0, lift: norm(pts[0].r) - groundRadius(pts[0].r, axes0) });
    this.snap = { ...this.snap, selected: craft.id };
    this.emit(true);
    return craft;
  }

  // An ascent's geocentric J2000 state at timeMs (on the pad before
  // liftoff), interpolated in its track.
  private ascentAt(a: Ascent, timeMs: number): { r: V3; v: V3; i: number } {
    const T = a.track;
    if (timeMs <= T[0].ms) {
      // On the pad it turns with the Earth: Earth-fixed at liftoff's place.
      const A = bodyAxesEqj('earth', new Date(timeMs)) as number[][], A0 = a.axes0, r0 = T[0].r;
      const e = [0, 1, 2].map((k) => A0[k][0] * r0[0] + A0[k][1] * r0[1] + A0[k][2] * r0[2]);
      const r = [0, 1, 2].map((i) => A[0][i] * e[0] + A[1][i] * e[1] + A[2][i] * e[2]) as V3;
      return { r, v: cross(omegaOf(A), r), i: 0 };
    }
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

  // A journey from the planner, as the kernel flew it there (journey.worker.ts):
  // its start state and the burns it made, scheduled on a new craft, with
  // its landings (the stays on the ground, Craft.addLandings). The craft is
  // the one the flight was worked out for (journeyFlight.js JOURNEY_CRAFT),
  // in the full model, or bare where the flight fell back to that (bareWhy:
  // why, for its Model row).
  flyJourney(start: { r: number[]; v: number[]; ms: number }, burns: object[], name: string, landings: object[] = [], model: 'full' | 'bare' = 'full', bareWhy: string | null = null): Craft {
    const c = new Craft({ name, r: start.r as V3, v: start.v as V3, t: kernelSeconds(new Date(start.ms)), sys: this.sys, bare: model === 'bare', ...JOURNEY_CRAFT });
    c.bareWhy = model === 'bare' ? bareWhy : null;
    c.addPlanned(burns);
    if (landings.length) c.addLandings(landings);
    c.note(`${burns.length} planned burns scheduled`, c.kState.t);
    this.crafts.push(c);
    this.select(c.id);
    return c;
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
    // The file's own craft (its mass, sunlit area and engine), or Orion.
    const model = m.data.craftModel ? { ...m.data.craftModel, vent: null } : ORION;
    const c = new Craft({ name: m.name, r: s.r as V3, v: s.v as V3, t: s.t, sys: this.sys, ...model });
    const keep = burns === 'all' ? m.burns : m.burns.slice(0, 1);
    c.setScript(new RealMission({ ...m.data, burns: keep }).script());
    c.note(burns === 'all' ? `${m.burns.length} burns scripted as flown` : `${keep[0].name} scripted as flown; the corrections are yours`, s.t);
    const refEcl = m.flown.map((p: number[]) => eqjToEclFast([p[1], p[2], p[3]]));
    const entryId = m.id && (ORION_ENTRIES as Record<string, unknown>)[m.id] ? m.id : null;
    // A file may fly with tracking fixes by default instead of aimed burns
    // (LRO's every 6 h, as its navigators worked each burn from a fresh
    // orbit determination: aimed a day across twelve lunar orbits, the aims
    // find costly phasing answers).
    this.real.set(c.id, { m, fixHours: m.data.fixHours ?? null, lastMs: m.startMs, fixes: 0, burns, refEcl, plan: !!m.data.flownFrom, aimed: burns === 'all' && !m.data.flownFrom && !m.data.fixHours, aimNext: 0, aimedDv: 0, entryId, separated: false });
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
        c.configure({ dryMass: C.mass, fuel: 0, area: C.area, cd: C.cd, cr: 1.3, vent: null, scriptIsp: null, entry: { aero: C.aero, chutes: C.chutes, target: EN.target } });
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
      // The ascent is flown over a sphere of the equatorial radius: the
      // vehicle is drawn lowered to the ground at the pad, the offset going
      // to nothing by cutoff, where the kernel takes the state as flown.
      const sec = (timeMs - a.liftoffMs) / 1000, T = (a.cutoffMs - a.liftoffMs) / 1000;
      const drop = a.lift * Math.max(0, 1 - Math.max(0, sec) / T);
      const lower = (r: number[]): V3 => { const k = 1 - drop / norm(r); return [r[0] * k, r[1] * k, r[2] * k]; };
      const rG = lower(s.r);
      const rel = eqjToEclFast(rG);
      const t = kernelSeconds(new Date(timeMs));
      const earth = this.sys.bodyAt('earth', t);
      const rE: number[] = earth ? earth.eph.position(t) : [0, 0, 0];
      const rEcl = eqjToEclFast([rG[0] + rE[0], rG[1] + rE[1], rG[2] + rE[2]]);
      const firing = timeMs >= a.liftoffMs;
      let model: CraftView['model'], pieces: ModelPose[] | undefined;
      if (a.shape) {
        const from = a.seps.filter((x) => x <= sec).length;
        model = { spec: { kind: 'stack', shape: a.shape, from }, axes: ascentAxes(rG, s.v, timeMs), firing };
        pieces = this.spentStages(a, sec, rE, lower);
      }
      return {
        id: a.craft.id, name: a.craft.name, rEcl, primaryEcl: eqjToEclFast(rE),
        conicEcl: a.pathEcl, trailEcl: [...a.flownEcl, rel], pathVersion: a.version * 2 + 1,
        thrusting: firing, crashed: false, selected: a.craft.id === this.snap.selected, model, pieces,
      };
    });
  }

  // The stages dropped in the last minute, falling away: each coasts on
  // from where it separated (two-body about the Earth, air left out),
  // turned as it was then, its engines out.
  // lower: the ground offset the stack is drawn with now, so they fall
  // from where it is drawn.
  private spentStages(a: Ascent, sec: number, rE: number[], lower: (r: number[]) => V3): ModelPose[] {
    const out: ModelPose[] = [];
    a.seps.forEach((ts, i) => {
      const dt = sec - ts;
      if (!(dt >= 0 && dt < SPENT_S) || !a.shape) return;
      const s = this.ascentAt(a, a.liftoffMs + ts * 1000);
      const p = propagate(s.r, s.v, dt, MU_EARTH) as { r: number[]; v: number[] };
      const r = lower(p.r);
      out.push({ key: `c${a.craft.id}-s${i}`, spec: { kind: 'stack', shape: a.shape, from: i, to: i + 1 }, rEcl: eqjToEclFast([r[0] + rE[0], r[1] + rE[1], r[2] + rE[2]]), axes: ascentAxes(s.r, s.v, a.liftoffMs + ts * 1000), firing: false });
    });
    return out;
  }

  // What a craft is drawn as close up, its axes, and whether it burns.
  private modelOf(c: Craft, s: { r: number[]; v: number[] }, vP: number[], attitude: CraftView['attitude']): CraftView['model'] {
    const R = this.real.get(c.id), firing = c.thrusting();
    const spec = this.specOf(c);
    if (!spec) return undefined;                                     // a real craft the app has no model of
    if (attitude) return { spec, axes: attitude.axes, firing };
    // No attitude carried: nose along the burn while one fires, else along
    // the velocity about the primary; +z as near the orbit's pole as is
    // square to it. (A probe's model turns itself: craftModels.ts.)
    const vr = [s.v[0] - vP[0], s.v[1] - vP[1], s.v[2] - vP[2]];
    const burn = firing ? this.burnAxis(c) : null;
    const x = burn || unit(vr);
    const P = this.primary(c), rP = P ? P.eph.position(c.clockT) : [0, 0, 0];
    const h = cross([s.r[0] - rP[0], s.r[1] - rP[1], s.r[2] - rP[2]], vr);
    return { spec, axes: axesAlong(x, h).map(eqjToEclFast) as [V3, V3, V3], firing, burn: R && burn ? eqjToEclFast(burn) : undefined };
  }
  // What a craft is drawn as close up: a real craft by NASA's model of it
  // (probeModels.ts) or Orion; ours by its stack or the box; null for a
  // real craft the app has no model of.
  private specOf(c: Craft): CraftModelSpec | null {
    const R = this.real.get(c.id);
    if (R) {
      const key = missionModelKey(R.m.data.craft);
      if (key) return { kind: 'probe', key };
      if (!R.entryId && R.m.data.craftModel) return null;
      return { kind: R.separated ? 'capsule' : 'orion' };
    }
    const sh = this.shapes.get(c.id);
    return sh ? { kind: 'stack', shape: sh.shape, from: sh.from } : { kind: 'box' };
  }
  // LICIACube, the CubeSat DART releases (its file's 'LICIACube release'):
  // for an hour after, moving off DART at the speed that balances DART's
  // recoil for its 14 kg (probeModels.ts), the other way, turned as DART
  // is. Nothing on any other craft.
  private releasedOf(c: Craft, rEcl: V3, axes: [V3, V3, V3] | undefined): ModelPose[] | undefined {
    const R = this.real.get(c.id);
    const rel = R?.m.data.craft === 'DART' ? (R.m.burns as { key: string; mps: number; intervals: number[][] }[]).find((b) => b.key === 'LICIACube release') : undefined;
    if (!rel || !R) return undefined;
    const iv = rel.intervals[0], dt = c.clockT - kernelSeconds(new Date(iv[0]));
    if (!(dt >= 0 && dt < 3600)) return undefined;
    const cm = R.m.data.craftModel as { dryMass: number; fuel: number };
    const vRel = (rel.mps * (cm.dryMass + cm.fuel) / LICIACUBE.massKg + rel.mps) / 1000;   // km/s, apart
    const d = eqjToEclFast(unit([iv[2], iv[3], iv[4]]));
    return [{ key: `c${c.id}-licia`, spec: { kind: 'cubesat' }, rEcl: [rEcl[0] - d[0] * vRel * dt, rEcl[1] - d[1] * vRel * dt, rEcl[2] - d[2] * vRel * dt], axes: axes ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]], firing: false }];
  }

  // The direction (EQJ unit) of the burn firing at the clock, if any.
  private burnAxis(c: Craft): V3 | null {
    const t = c.clockT;
    const b = (c.burns as { t0: number; t1: number; dir: number[] }[]).find((x) => x.t0 <= t && t < x.t1)
      ?? (c.script as { t0: number; t1: number; dir: number[]; frame?: string; about?: string }[]).find((x) => x.t0 <= t && t < x.t1);
    if (!b) return null;
    const sc = b as { frame?: string; about?: string; dir: number[] };
    if (sc.frame !== 'vnb') return unit(b.dir);
    const B = sc.about ? this.sys.bodyAt(sc.about, t) : null, s = c.displayState();
    const rB = B ? B.eph.position(t) : [0, 0, 0], vB = B ? B.eph.velocity(t) : [0, 0, 0];
    return vnbToInertial(b.dir, [s.r[0] - rB[0], s.r[1] - rB[1], s.r[2] - rB[2]], [s.v[0] - vB[0], s.v[1] - vB[1], s.v[2] - vB[2]]) as V3;
  }

  // What the plate says of a craft's model, or null when it has none.
  modelNote(c: Craft): string | null {
    const R = this.real.get(c.id), spec = this.specOf(c);
    if (!spec) return 'Not modelled: drawn as its marker only. Its shape is not in the app.';
    if (spec.kind === 'probe') {
      const engine = PROBE_MODELS[spec.key].thrust ? ' While a burn fires its main engine turns along it, its arrays as near the Sun as that lets them.' : ' Its burns are not drawn on the model.';
      const licia = R?.m.data.craft === 'DART' ? ` ${modelNote({ kind: 'cubesat' })}` : '';
      return `${modelNote(spec)}${engine}${licia}`;
    }
    return `${modelNote(spec)} ${c.att ? ATTITUDE_NOTE.carried : R ? ATTITUDE_NOTE.orion : ATTITUDE_NOTE.point}`;
  }
  // The same for a climbing craft (the ROCKET tab's launch from the pad).
  ascentNote(): string | null {
    const a = this.ascents[0];
    return a?.shape ? `${modelNote({ kind: 'stack', shape: a.shape, from: 0 })} Flown nose along its velocity through the air, as the ascent flies it.` : null;
  }

  private craftViews(): CraftView[] {
    const now = performance.now();
    return this.crafts.map((c) => {
      const s = c.displayState();
      const key = c.kState.primary as string;
      const P = key && key !== 'sun' ? this.sys.bodyAt(key, c.clockT) : null;
      const rP: number[] = P ? P.eph.position(c.clockT) : [0, 0, 0];
      const vP: number[] = P ? P.eph.velocity(c.clockT) : [0, 0, 0];
      const rel = [s.r[0] - rP[0], s.r[1] - rP[1], s.r[2] - rP[2]];
      let path = this.paths.get(c.id);
      if (!path) { path = { trail: new Trail(), conic: [], at: 0, version: 0, rMax: 0 }; this.paths.set(c.id, path); }
      const before = path.trail.points.length + (path.trail.key === key ? 0 : -1);
      if (!c.crashed) path.trail.push(key, eqjToEclFast(rel));
      let changed = path.trail.points.length !== before;
      if (now - path.at > 200) {
        const mu = P ? P.mu : this.sys.muSun;
        const rMax = P ? Math.hypot(rP[0], rP[1], rP[2]) * Math.pow(mu / this.sys.muSun, 0.4) : 50 * 1.496e8;
        path.rMax = rMax;
        const relV = [s.v[0] - vP[0], s.v[1] - vP[1], s.v[2] - vP[2]];
        path.conic = c.crashed ? [] : conicPoints(rel, relV, mu, rMax).map(eqjToEclFast);
        path.at = now;
        changed = true;
      }
      if (changed) path.version++;
      const R = this.real.get(c.id);
      // The flown path is drawn about the file's centre: the Earth, or the
      // Sun at the origin.
      const centre = R?.m.centre ?? 'earth';
      const E = R && centre !== 'sun' ? this.sys.bodyAt(centre, c.clockT) : null;
      // A craft's attitude: its body axes and the reference it turns to, in
      // ecliptic axes, for the scene's triad.
      let attitude: CraftView['attitude'];
      if (c.att) {
        const M = quatToMatrix(c.att.q), col = (j: number): V3 => eqjToEclFast([M[0][j], M[1][j], M[2][j]]);
        const ro = c.att.locked ? null : c.att.readout();
        const T = ro?.ref ? quatToMatrix(ro.ref) : null;
        attitude = { axes: [col(0), col(1), col(2)], target: T ? eqjToEclFast([T[0][0], T[1][0], T[2][0]]) : null, firing: c.thrusting() };
      }
      const model = c.crashed ? undefined : this.modelOf(c, s, vP, attitude);
      return {
        id: c.id, name: c.name, rEcl: eqjToEclFast(s.r), primaryEcl: eqjToEclFast(rP),
        conicEcl: path.conic, trailEcl: path.trail.points, pathVersion: path.version,
        orbit: c.crashed ? undefined : { r: eqjToEclFast(rel), v: eqjToEclFast([s.v[0] - vP[0], s.v[1] - vP[1], s.v[2] - vP[2]]), mu: P ? P.mu : this.sys.muSun, rMax: path.rMax },
        thrusting: c.thrusting(), crashed: c.crashed, selected: c.id === this.snap.selected,
        flown: R && (E || centre === 'sun') ? { pointsEcl: R.refEcl, originEcl: E ? eqjToEclFast(E.eph.position(c.clockT)) : [0, 0, 0] } : undefined,
        attitude,
        model,
        pieces: c.crashed ? undefined : this.releasedOf(c, eqjToEclFast(s.r), model?.axes),
      };
    });
  }

  // Warnings: a craft that crashed or that the kernel refused. The light
  // stays while such a craft exists; the master alarm sounds when a new one
  // appears and stays until acknowledged.
  private warned = new Set<number>();
  alarm = false;
  // A splashdown is how a flight ends, not a warning.
  get warning(): boolean { return this.crafts.some(craftWarns); }
  get warningText(): string {
    const c = this.crafts.find(craftWarns);
    return c ? (c.crashed ? `${c.name}: impact on ${c.impactBody}` : `${c.name}: ${c.error}`) : '';
  }
  acknowledge(): void { this.alarm = false; this.emit(true); }
  private checkAlarm(): void {
    for (const c of this.crafts) {
      if (craftWarns(c) && !this.warned.has(c.id)) { this.warned.add(c.id); this.alarm = true; }
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
