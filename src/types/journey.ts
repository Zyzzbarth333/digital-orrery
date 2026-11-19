// src/types/journey.ts
//
// What the 3D scene draws of a journey, and what its handles do to it
// (journeyLayer.ts). The app's JourneyStore (src/app/journey.ts) makes the
// views and implements the handlers. Kept here so src/scene depends on no
// file in src/app (ADR-0001).

type V3 = [number, number, number];

export interface JourneyArcView { central: string; pts: V3[]; leg: number; t1: number; t2: number }
export interface JourneyMarkView { central: string; at: V3; label: string; dv: number; kind: string; ms: number; id?: string; frame?: { T: V3; N: V3; R: V3 }; b?: [number, number] }
export interface JourneyView { version: number; arcs: JourneyArcView[]; marks: JourneyMarkView[]; flown: { central: string; pts: V3[] } | null; selected: string | null }

// What the scene's handles do to the journey.
export interface JourneyHandlers {
  select(id: string | null): void;
  nudge(id: string, axis: 'pro' | 'nor' | 'rad', dKmS: number): void;
  move(id: string, ms: number): void;
  add(leg: number, ms: number): void;
  remove(id: string): void;
  aim(id: string, bT: number, bR: number): void;
  release(): void;
}
