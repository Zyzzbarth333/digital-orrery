// src/app/porkchop.worker.ts
//
// The planner's porkchop grid, off the main thread: zero-revolution Lambert
// arcs (src/physics/porkchop.js) from Earth to a destination for every
// (departure date, time of flight) cell, on astronomy-engine states.

import { porkchopGrid, range } from '../physics/porkchop.js';
import { helioStateEcl } from '../physics/ephemeris.js';
import { GRAVITATIONAL_PARAMETERS as GM, PLANETS } from '../utils/constants.js';

export interface GridRequest { dest: string; depStartMs: number; depSpanDays: number; depStep: number; tofMin: number; tofMax: number; tofStep: number }

self.onmessage = (e: MessageEvent<GridRequest>) => {
  const q = e.data;
  const depDays = range(0, q.depSpanDays, q.depStep);
  const tofDays = range(q.tofMin, q.tofMax, q.tofStep);
  const P = PLANETS as Record<string, { radius: number }>, G = GM as Record<string, number>;
  const t0 = performance.now();
  const g = porkchopGrid({
    stateOf: helioStateEcl,
    departure: { key: 'earth', mu: G.earth / 1e9, rPark: P.earth.radius + 200 },
    arrival: { key: q.dest, mu: G[q.dest] / 1e9, rPark: P[q.dest].radius + 400, capture: true },
    muSun: G.sun / 1e9,
    depStart: new Date(q.depStartMs), depDays, tofDays,
  });
  const strip = (b: { departure: Date; arrival: Date } | null) => b && { ...b, departure: b.departure.getTime(), arrival: b.arrival.getTime() };
  (self as unknown as Worker).postMessage({
    nDep: g.nDep, nTof: g.nTof, depDays, tofDays, c3: g.c3, dvTotal: g.dvTotal, vinfArr: g.vinfArr,
    minC3: strip(g.minC3), minTotal: strip(g.minTotal), ms: performance.now() - t0, req: q,
  });
};
