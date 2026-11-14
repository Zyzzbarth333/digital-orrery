// src/app/journey.ts
//
// The journey being planned in the PLANNER tab, shared with the scene that
// draws it. Edits re-solve it at once by patched conics (journey.js); when
// an edit is let go, the kernel flies it in a worker (journey.worker.ts)
// and its flown path and closest approaches come back. React reads it
// through useJourney(); the scene through view().

import { useSyncExternalStore } from 'react';
import { solveJourney as solveJs, journeyPath, registerSmallBodies, defaultArrival as defaultArrivalJs, bodyInfo, legOptions, applyOption, type Journey, type Waypoint } from '../physics/journey.js';
import type { FlightRequest, FlightReply } from './journey.worker';

type V3 = [number, number, number];
const DAY_MS = 86400e3;

// The parts of journey.js's solution the app reads.
export interface Stop { body: string; kind: string; altKm: number; arrMs: number; depMs: number; stayDays?: number }
export interface Leg {
  index: number; geometry: string; central: string; from: string; to: string; depMs: number; arrMs: number; tofDays: number;
  depDv: number; arrDv: number; midDv: number; ok: boolean; error?: string; revs?: number; vinfDep: number[] | null; vinfArr: number[] | null;
}
export interface Flyby { body: string; dv: number; delta: number; rp: number; gain: number; bT: number; bR: number; aim: number; vinf: number; tooTight?: boolean; unpoweredOnly?: boolean; periapsisDv: number; steerDv: number }
export interface Burn { ms: number; body: string; dv: number; kind: string; label: string; leg: number }
export interface JourneySolution { stops: Stop[]; legs: Leg[]; flybys: (Flyby | undefined)[]; burns: Burn[]; totalDv: number; startMs: number; endMs: number; durationDays: number; ok: boolean; error?: string }
const solveJourney = (j: Journey) => solveJs(j) as unknown as JourneySolution;
const defaultArrival = (p: Stop, body: string, alt: number, kind: string) => defaultArrivalJs(p as never, body, alt, kind) as number;
export type { Journey, Waypoint };

export interface JourneyArcView { central: string; pts: V3[]; leg: number }
export interface JourneyMarkView { central: string; at: V3; label: string; dv: number; kind: string; ms: number }
export interface JourneyView { version: number; arcs: JourneyArcView[]; marks: JourneyMarkView[]; flown: { central: string; pts: V3[] } | null }

export interface KernelCheck { state: 'idle' | 'flying' | 'done' | 'failed'; reply?: FlightReply; forVersion?: number; error?: string }

let nextId = 1;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class JourneyStore {
  journey: Journey;
  solution: JourneySolution;
  version = 0;
  kernel: KernelCheck = { state: 'idle' };
  private views: JourneyView | null = null;
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private smallLoaded = false;
  private snap = { version: 0, tick: 0 };

  constructor(startMs: number) {
    const start = Date.UTC(new Date(startMs).getUTCFullYear(), new Date(startMs).getUTCMonth(), new Date(startMs).getUTCDate());
    this.journey = { start: { body: 'earth', kind: 'pad', altKm: 200, dateMs: start, latDeg: 28.5 }, waypoints: [] };
    this.solution = solveJourney(this.journey);
  }

  // Small bodies as waypoints: the named ones from the catalogue.
  async loadSmallBodies(baseUrl: string): Promise<void> {
    if (this.smallLoaded) return;
    this.smallLoaded = true;
    try {
      const meta = await fetch(`${baseUrl}data/smallbodies.json`).then((r) => r.json());
      registerSmallBodies(meta.named);
      this.named = meta.named;
      this.notify();
    } catch (err) { console.warn(`journey: small bodies not loaded: ${err}`); }
  }
  named: unknown[] = [];

  get snapshot() { return this.snap; }
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private bump(): void {
    this.version++;
    this.notify();
  }
  // Something to show changed (the kernel's answer), the journey did not.
  private notify(): void {
    this.views = null;
    this.snap = { version: this.version, tick: this.snap.tick + 1 };
    for (const fn of this.listeners) fn();
  }

  // Replace the journey and solve it by patched conics.
  set(j: Journey): void {
    this.journey = j;
    try { this.solution = solveJourney(j); } catch (err) { this.solution = { ...this.solution, ok: false, legs: [], burns: [], error: String(err) } as JourneySolution; }
    if (this.kernel.state !== 'flying') this.kernel = { state: 'idle' };
    this.bump();
  }

  // Waypoints: added at the end (or before index), moved, removed, edited.
  add(body: string, kind: Waypoint['kind'], at: number | null = null): void {
    const S = this.solution.stops, i = at ?? this.journey.waypoints.length;
    const prev = S[i] ?? S[S.length - 1];
    const altKm = kind === 'flyby' ? 300 : body === 'moon' ? 100 : 400;
    let dateMs: number;
    try { dateMs = Math.round(defaultArrival(prev, body, altKm, kind) / DAY_MS) * DAY_MS; } catch { dateMs = prev.depMs + 200 * DAY_MS; }
    const w: Waypoint = { id: nextId++, body, kind, altKm, stayDays: kind === 'flyby' ? 0 : 3, dateMs };
    const list = [...this.journey.waypoints];
    list.splice(i, 0, w);
    // Waypoints after an insertion keep their spacing, moved on by the new leg.
    if (at !== null && i < list.length - 1) {
      const shift = w.dateMs + (w.stayDays ?? 0) * DAY_MS - prev.depMs;
      for (let k = i + 1; k < list.length; k++) list[k] = { ...list[k], dateMs: list[k].dateMs + shift };
    }
    // The new leg starts at its porkchop optimum (the cheapest departure
    // and flight time near its window), when there is one.
    let j: Journey = { ...this.journey, waypoints: list };
    try {
      const o = (legOptions(j, i) as { options: { type: string }[] }).options.find((x) => x.type === 'porkchop');
      if (o) j = applyOption(j, i, o as never) as Journey;
    } catch { /* keep the first guess */ }
    this.set(j);
  }
  move(i: number, d: -1 | 1): void {
    const list = [...this.journey.waypoints], j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    // Dates stay in order: the two swap theirs.
    const a = list[i].dateMs, b = list[j].dateMs;
    list[i] = { ...list[i], dateMs: Math.min(a, b) }; list[j] = { ...list[j], dateMs: Math.max(a, b) };
    this.set({ ...this.journey, waypoints: list });
  }
  remove(i: number): void { this.set({ ...this.journey, waypoints: this.journey.waypoints.filter((_, k) => k !== i) }); }
  edit(i: number, patch: Partial<Waypoint>): void {
    this.set({ ...this.journey, waypoints: this.journey.waypoints.map((w, k) => (k === i ? { ...w, ...patch, ...(patch.dateMs !== undefined || patch.body || patch.kind ? { via: patch.via ?? (w.via === 'bielliptic' ? 'bielliptic' : 'lambert'), chosen: patch.chosen } : {}) } : w)) });
  }
  editStart(patch: Partial<Journey['start']>): void { this.set({ ...this.journey, start: { ...this.journey.start, ...patch } }); }

  // The kernel flies the journey (once an edit is let go).
  check(): void {
    if (!this.solution.ok || !this.journey.waypoints.length) return;
    if (!this.worker) {
      this.worker = new Worker(new URL('./journey.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<FlightReply>) => {
        if (e.data.forVersion !== this.kernelFor) return;
        this.kernel = e.data.error ? { state: 'failed', error: e.data.error, forVersion: e.data.forVersion } : { state: 'done', reply: e.data, forVersion: e.data.forVersion };
        this.notify();
      };
      this.worker.onerror = (e) => { this.kernel = { state: 'failed', error: e.message, forVersion: this.kernelFor }; this.notify(); };
    }
    this.kernelFor = this.version;
    this.kernel = { state: 'flying', forVersion: this.version };
    this.worker.postMessage({ journey: this.journey, named: this.named, forVersion: this.version } satisfies FlightRequest);
    this.notify();
  }
  private kernelFor = -1;

  dispose(): void { this.worker?.terminate(); this.worker = null; }

  // The frame the whole journey is drawn and flown about: the Sun, unless
  // every leg stays about one planet (Earth and the Moon).
  frame(): string {
    const c = new Set(this.solution.legs.map((l) => l.central));
    return c.size === 1 ? [...c][0] : 'sun';
  }

  // For the scene: arcs and burn places about their central bodies
  // (ecliptic km), and the kernel's flown path about the journey's frame.
  view(): JourneyView | null {
    if (!this.journey.waypoints.length) return null;
    if (this.views) return this.views;
    const p = journeyPath(this.solution as never) as { arcs: { central: string; pts: V3[]; leg: number }[]; marks: JourneyMarkView[] };
    let flown: JourneyView['flown'] = null;
    const r = this.kernel.state === 'done' && this.kernel.forVersion === this.version ? this.kernel.reply : null;
    if (r) flown = { central: r.frame, pts: r.pathEcl as V3[] };
    this.views = { version: this.version, arcs: p.arcs.map((a) => ({ central: a.central, pts: a.pts, leg: a.leg })), marks: p.marks, flown };
    return this.views;
  }

  // A one-line name for the journey ("Earth – Venus – Jupiter").
  title(): string { return [this.journey.start.body, ...this.journey.waypoints.map((w) => w.body)].map((k) => { try { return bodyInfo(k).name; } catch { return k; } }).join(' – '); }
  dates(): string { return `${iso(this.solution.startMs)} to ${iso(this.solution.endMs)}`; }
}

export function useJourney(s: JourneyStore): { version: number; tick: number } {
  return useSyncExternalStore(s.subscribe, () => s.snapshot);
}
