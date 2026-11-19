// src/app/passes.worker.ts
//
// A satellite's passes over a place (packages/physics/src/passes.js), off the main
// thread: three days of the ISS take about 50 ms. The DE442 table brings
// the Earth orientation parameters (UT1 and polar motion) and the Sun.
//
// In:  { id, omm, lat, lon, heightKm, fromMs, days }
// Out: { id, passes, ms }

import { satrecOf } from '@digital-orrery/physics/satellites.js';
import { siteOf, findPasses } from '@digital-orrery/physics/passes.js';
import { loadDeTable } from '../browser/deLoad.js';

const ready = loadDeTable();

export interface PassRequest { id: number; omm: Parameters<typeof satrecOf>[0]; lat: number; lon: number; heightKm: number; fromMs: number; days: number }

self.onmessage = async (e: MessageEvent<PassRequest>) => {
  await ready;
  const q = e.data, t0 = performance.now();
  const passes = findPasses(satrecOf(q.omm), siteOf(q.lat, q.lon, q.heightKm), q.fromMs, { days: q.days });
  (self as unknown as Worker).postMessage({ id: q.id, passes, ms: performance.now() - t0 });
};
