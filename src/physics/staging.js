// src/physics/staging.js
//
// The launcher a job needs: a delta-v (a journey's, plus the climb from the
// pad into a parking orbit) broken into stages by the rocket equation, each
// stage sized by optimal staging (the Lagrange multiplier method, Curtis
// 4th ed. section 13.6, in rocket.js's optimalStaging). Shared stage
// technology lives here too, so the ROCKET tab can set a journey's stack
// beside real launchers. Pure ES module, SI units (m/s, kg, s).
//
//   restrictedStaging      N identical stages, Curtis 13.5 (Examples 13.4, 13.5)
//   sizeLauncher           1 to maxStages stages, each optimally sized
//   launchBudget           a journey's delta-v plus the climb to orbit
//   STAGE_TECH             propellant classes with Curtis's typical Isp

import { optimalStaging, deltaVToOrbit, G0 } from './rocket.js';

// Stage technology: Isp from Curtis Table 6.1 ("Some typical specific
// impulses"); the structural ratio defaults to 0.1, the lower limit that
// Curtis section 13.4 gives for current materials. Both are typical values,
// not any one vehicle's; the planner lets either be edited.
export const STAGE_TECH = {
  solid: { name: 'Solid propellant', isp: 290, eps: 0.1 },
  storable: { name: 'Nitric acid / MMH', isp: 310, eps: 0.1 },
  hydrolox: { name: 'LOX / LH2', isp: 455, eps: 0.1 },
};

// The burnout speed of N identical stages (exhaust speed c = Isp g0,
// structural ratio eps) for an overall payload ratio pi = payload / liftoff
// mass (Curtis 13.56):
//   v_bo = N c ln(1 / (pi^(1/N) (1 - eps) + eps)),
// and, inverted, the payload ratio a burnout speed allows.
export function restrictedStaging({ n, isp, eps, payloadRatio, g0 = G0 }) {
  return n * isp * g0 * Math.log(1 / (payloadRatio ** (1 / n) * (1 - eps) + eps));
}
export function restrictedPayloadRatio({ n, isp, eps, dv, g0 = G0 }) {
  const x = (Math.exp(-dv / (n * isp * g0)) - eps) / (1 - eps);
  return x > 0 ? x ** n : 0;
}

// The lightest stack of 1 to maxStages stages for a payload (kg) and a
// burnout speed dv (m/s): stage 1 uses `booster`, the stages above it
// `upper` (each { isp, eps }). Each count is sized by optimal staging.
// Returns every count tried, bottom stage first in each (reason, where none
// is possible: 'beyond' the stages' limit, or an 'empty-stage' optimum), and
// the pick:
// the fewest stages whose liftoff mass is within `margin` (10 %) of the
// lightest, since each stage beyond that adds engines, separations and
// cost for little saving.
export function sizeLauncher({ dv, payload, booster, upper = booster, maxStages = 4, margin = 0.1, g0 = G0 }) {
  const options = [];
  for (let n = 1; n <= maxStages; n++) {
    const tech = [booster, ...Array(n - 1).fill(upper)];
    const o = optimalStaging({ dv, payload, stages: tech, g0 });
    if (!o) {
      // Beyond what the stages can give at all, or (below that) an optimum
      // that would leave a stage empty: then fewer stages do the job better.
      const limit = tech.reduce((a, s) => a + s.isp * g0 * Math.log(1 / s.eps), 0);
      options.push({ n, feasible: false, limit, reason: dv < limit ? 'empty-stage' : 'beyond' });
      continue;
    }
    const stages = tech.map((s, i) => ({ isp: s.isp, eps: s.eps, prop: o.prop[i], dry: o.empty[i], step: o.step[i], ratio: o.n[i], dv: s.isp * g0 * Math.log(o.n[i]) }));
    options.push({ n, feasible: true, stages, liftoff: o.m0, payload, payloadFraction: o.payloadFraction, eta: o.eta, minimum: o.minimum });
  }
  const ok = options.filter((o) => o.feasible);
  if (!ok.length) return { options, pick: null };
  const lightest = Math.min(...ok.map((o) => o.liftoff));
  return { options, pick: ok.find((o) => o.liftoff <= lightest * (1 + margin)) };
}

// The delta-v a stack must give (m/s): the climb from the pad into a
// circular parking orbit at altitude h (m), less the Earth's turn along the
// azimuth, plus the ascent's losses (rocket.js deltaVToOrbit), and the
// journey's own (m/s) from that orbit on. Every burn of the journey is
// counted as the stack's: the payload is what arrives at the end.
export function launchBudget({ journeyDv, h = 200e3, lat = 28.5, az = 90, losses = 1500 }) {
  const toOrbit = deltaVToOrbit({ h, lat, az, losses });
  return { toOrbit, inSpace: journeyDv, total: toOrbit + journeyDv };
}
