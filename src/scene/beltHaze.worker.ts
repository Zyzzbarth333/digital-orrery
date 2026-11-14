// src/scene/beltHaze.worker.ts
//
// Runs the belt haze's binning (src/physics/beltGrid.js) off the main
// thread: given the packed bodies once, then a time, it posts the grid.

import { loadBelt, buildBelt } from '../physics/beltGrid.js';

let belt: ReturnType<typeof loadBelt> | null = null;

self.onmessage = (ev: MessageEvent) => {
  const m = ev.data;
  if (m.type === 'bodies') belt = loadBelt(m.buffer);
  else if (m.type === 'build' && belt) {
    const grid = buildBelt(belt, m.days);
    (self as unknown as Worker).postMessage({ type: 'grid', days: m.days, grid }, [grid.buffer]);
  }
};
