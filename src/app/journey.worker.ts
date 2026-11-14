// src/app/journey.worker.ts
//
// The journey flown by the n-body kernel, off the page's thread: the
// planner's patched-conic solution turned into departures, aimed
// corrections and captures (journeyFlight.js), flown through it. Its burns
// come back for "Fly this journey", its path for drawing beside the plan,
// and each waypoint's closest approach for the planner's readout.

import { solveJourney, registerSmallBodies } from '../physics/journey.js';
import { planFlight, flyJourney } from '../physics/journeyFlight.js';
import { solarSystemBodies } from '../physics/bodies.js';
import { KERNEL_EPOCH_MS } from '../physics/kernelHost.js';
import { helioStateEqj } from '../physics/ephemeris.js';
import { loadDeTable } from '../physics/deLoad.js';
import { eqjToEclFast } from '../scene/craftPaths';
import type { Journey } from '../physics/journey.js';

const ready = loadDeTable();
let sys: ReturnType<typeof solarSystemBodies> | null = null;

export interface FlightRequest { journey: Journey; named: unknown[]; forVersion: number }
export interface Arrival { waypoint: number; body: string; closest: number; plannedRp: number; missKm: number; at: number; central: boolean }
export interface PlannedBurn { t0: number; t1: number; dir: number[]; F: number; m0: number; mdot: number; scripted: boolean; frame?: string; about?: string }
export interface FlightReply {
  forVersion: number; error?: string; frame: string; pathEcl: number[][]; arrivals: Arrival[]; burns: PlannedBurn[];
  start: { r: number[]; v: number[]; ms: number } | null; unsupported: string[]; log: string[]; impact: { body: string; t: number } | null; ms: number;
}

self.onmessage = async (e: MessageEvent<FlightRequest>) => {
  await ready;
  const q = e.data, t0 = performance.now();
  try {
    if (q.named?.length) registerSmallBodies(q.named as never);
    sys ??= solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
    const sol = solveJourney(q.journey);
    const plan = planFlight(sol) as { start: FlightReply['start']; unsupported: string[] };
    const f = flyJourney(sys, plan as never) as { burns: PlannedBurn[]; path: { t: number; r: number[] }[]; arrivals: Arrival[]; log: string[]; impact: FlightReply['impact'] };
    // Drawn about the journey's frame: the Sun, or Earth for a journey that
    // never leaves it.
    const centrals = new Set(sol.legs.map((l: { central: string }) => l.central));
    const frame = centrals.size === 1 ? [...centrals][0] as string : 'sun';
    const pathEcl = f.path.map((p) => {
      if (frame === 'sun') return eqjToEclFast(p.r);
      const c = helioStateEqj(frame, new Date(sys!.msAt(p.t))).r;
      return eqjToEclFast([p.r[0] - c[0], p.r[1] - c[1], p.r[2] - c[2]]);
    });
    const reply: FlightReply = { forVersion: q.forVersion, frame, pathEcl, arrivals: f.arrivals, burns: f.burns, start: plan.start, unsupported: plan.unsupported, log: f.log, impact: f.impact, ms: performance.now() - t0 };
    self.postMessage(reply);
  } catch (err) {
    self.postMessage({ forVersion: q.forVersion, error: String((err as Error)?.message ?? err), frame: 'sun', pathEcl: [], arrivals: [], burns: [], start: null, unsupported: [], log: [], impact: null, ms: 0 } satisfies FlightReply);
  }
};
