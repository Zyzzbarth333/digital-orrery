// src/types/clock.ts
//
// The simulation clock's state, and what the 3D scene needs of the clock.
// The scene reads the state and advances it each frame; the app's SimClock
// (src/app/clock.ts) implements it. Kept here so src/scene depends on no
// file in src/app (ADR-0001).

export interface ClockState {
  timeMs: number;        // sim time, UTC milliseconds since 1970
  rate: number;          // sim seconds per real second
  playing: boolean;
  jumps: number;         // times the clock was set rather than run
  lastJump: { fromMs: number; toMs: number } | null;   // the latest set, for BACK
}

export interface SceneClock {
  readonly snapshot: ClockState;
  tick(realDt: number): void;
}
