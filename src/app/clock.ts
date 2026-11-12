// src/app/clock.ts
//
// The simulation clock: sim time (UTC ms), how fast it runs (sim seconds per
// real second) and whether it is running. The 3D scene advances it every
// animation frame; React reads it through useClock(), which re-renders at most
// ten times a second so the panels never cost a frame.

import { useSyncExternalStore } from 'react';

export interface ClockState {
  timeMs: number;        // sim time, UTC milliseconds since 1970
  rate: number;          // sim seconds per real second
  playing: boolean;
}

export class SimClock {
  private state: ClockState;
  private listeners = new Set<() => void>();
  private lastNotify = 0;

  constructor(start = Date.now()) {
    this.state = { timeMs: start, rate: 1, playing: true };
  }

  get snapshot(): ClockState {
    return this.state;
  }

  // Called by the render loop with the real time elapsed (seconds).
  tick(realDt: number): void {
    if (!this.state.playing || realDt <= 0) return;
    // Clamp a long pause (background tab) to one second of real time.
    const dt = Math.min(realDt, 1);
    this.state = { ...this.state, timeMs: this.state.timeMs + dt * this.state.rate * 1000 };
    const now = performance.now();
    if (now - this.lastNotify > 100) {
      this.lastNotify = now;
      this.emit();
    }
  }

  setPlaying(playing: boolean): void {
    this.state = { ...this.state, playing };
    this.emit();
  }

  setRate(rate: number): void {
    this.state = { ...this.state, rate };
    this.emit();
  }

  setTime(timeMs: number): void {
    this.state = { ...this.state, timeMs };
    this.emit();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

export function useClock(clock: SimClock): ClockState {
  return useSyncExternalStore(clock.subscribe, () => clock.snapshot);
}
