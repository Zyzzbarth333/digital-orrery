// src/scene/renderScale.ts
//
// An adaptive render scale for the 3D view (docs/performance.md#rendering):
// when frames run long, the canvas's pixel ratio steps down; when they run
// at the display's rate again for a while, it steps back up. The HTML
// panels are untouched, so text stays sharp. The ratio never goes below
// max(1, 0.6 x the device's), so a 1x screen is never scaled and a 2x
// screen keeps at least 1.2 device pixels per CSS pixel.
//
// Frames are judged in windows of 0.5 s by their median interval: over
// 20 ms (under 50 fps) twice in a row steps down by 0.2; under 17.5 ms for
// a stretch steps back up by 0.2, waiting 4 s at first and twice as long
// after each step up that had to be undone, so it settles rather than
// hunting.

const WINDOW_MS = 500;
const SLOW_MS = 20;
const FAST_MS = 17.5;
const STEP = 0.2;

export class RenderScale {
  ratio: number;
  readonly max: number;
  readonly min: number;
  private intervals: number[] = [];
  private windowStart = 0;
  private slowWindows = 0;
  private calmSince = 0;
  private upWait = 4000;
  private lastUpAt = -1;

  // fixed: keep the device ratio (for measuring the raw cost).
  constructor(deviceRatio: number, fixed = false) {
    this.max = deviceRatio;
    this.min = fixed ? deviceRatio : Math.max(1, Math.min(deviceRatio, 0.6 * deviceRatio));
    this.ratio = deviceRatio;
  }

  // Feed each frame's interval; returns the new ratio when it changes.
  frame(now: number, intervalMs: number): number | null {
    if (this.min >= this.max) return null;
    if (intervalMs > 0 && intervalMs < 250) this.intervals.push(intervalMs);   // ignore hidden-tab gaps
    if (!this.windowStart) { this.windowStart = now; this.calmSince = now; }
    if (now - this.windowStart < WINDOW_MS || this.intervals.length < 5) return null;
    const sorted = this.intervals.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.intervals = [];
    this.windowStart = now;
    if (median > SLOW_MS) {
      this.calmSince = now;
      if (++this.slowWindows < 2 || this.ratio <= this.min) return null;
      this.slowWindows = 0;
      // A step up that had to be undone soon: wait longer next time.
      if (this.lastUpAt >= 0 && now - this.lastUpAt < 3000) this.upWait = Math.min(64000, this.upWait * 2);
      this.ratio = Math.max(this.min, +(this.ratio - STEP).toFixed(2));
      return this.ratio;
    }
    this.slowWindows = 0;
    if (median < FAST_MS && this.ratio < this.max && now - this.calmSince > this.upWait) {
      this.ratio = Math.min(this.max, +(this.ratio + STEP).toFixed(2));
      this.lastUpAt = now;
      this.calmSince = now;
      return this.ratio;
    }
    return null;
  }
}
