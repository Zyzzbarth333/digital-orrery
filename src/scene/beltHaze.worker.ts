// src/scene/beltHaze.worker.ts
//
// Runs the belt haze's binning (src/physics/beltGrid.js) off the main
// thread: given the packed bodies once, then a time, it posts the grid as
// half floats, scaled so its largest value is 30,000 (half float's
// precision is relative, a part in 2,000, down to 6e-5 of that and below),
// with the scale to undo it.

import { loadBelt, buildBelt } from '../physics/beltGrid.js';

let belt: ReturnType<typeof loadBelt> | null = null;
let first = true;

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'bodies') belt = loadBelt(m.buffer);
  else if (m.type === 'build' && belt) {
    // The first time, every eighth body first (90 ms), so the haze shows
    // while the whole grid (0.7 s) is binned.
    if (first) { first = false; post(buildBelt(belt, m.days, undefined, 8), m.days); }
    post(buildBelt(belt, m.days), m.days);
  }
};

function post(grid: Float32Array, days: number): void {
  let max = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
  const k = max > 0 ? 30000 / max : 1;
  const half = new Uint16Array(grid.length);
  for (let i = 0; i < grid.length; i++) half[i] = toHalf(grid[i] * k);
  (self as unknown as Worker).postMessage({ type: 'grid', days, grid: half, scale: 1 / k }, [half.buffer]);
}

// IEEE 754 binary16 from a non-negative float (round to nearest; values
// under 2^-24 become 0).
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0], e = ((x >> 23) & 0xff) - 127 + 15, m = x & 0x7fffff;
  if (e >= 31) return 0x7bff;
  if (e <= 0) {
    if (e < -10) return 0;
    const mm = (m | 0x800000) >> (1 - e);
    return (mm + 0x1000) >> 13;
  }
  return (e << 10) + ((m + 0x1000) >> 13);
}
