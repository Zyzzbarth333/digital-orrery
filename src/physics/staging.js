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
//   typicalLauncher        what the real launchers have that sizing leaves
//                          out: thrust-to-weight, sea-level Isp, size, drag
//   stackAsLauncher        a sized stack as the ROCKET tab's vehicle

import { optimalStaging, deltaVToOrbit, stackPerformance, G0 } from './rocket.js';
import { LAUNCHERS } from './launchers.js';

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

// A real launcher (launchers.js: tonnes, kN, s) against a job: the delta-v
// its stack gives a payload (kg), by the rocket equation with each stage's
// vacuum Isp (rocket.js stackPerformance), its margin over the job's dv
// (m/s), and the most payload it could carry for that dv (bisection: the
// delta-v falls as the payload grows). The comparison is on delta-v alone:
// the job's dv already holds the ascent's losses (launchBudget), so thrust,
// drag and a booster's landing reserve are not modelled here beyond what
// the launcher's own stage figures carry.
export function launcherFor(launcher, { payload, dv, g0 = G0 }) {
  const stages = launcher.stages.map((s) => ({ name: s.name, dry: s.dry * 1000, prop: s.prop * 1000, isp: s.isp, ispSl: s.ispSl ?? s.isp, thrust: s.thrust * 1000 }));
  const perf = (m) => stackPerformance(stages, m, { g0 });
  const p = perf(payload);
  let maxPayload = 0;
  if (perf(0).dv >= dv) {
    let lo = 0, hi = Math.max(1000, launcher.payload * 1000 * 4);
    while (perf(hi).dv > dv && hi < 1e8) hi *= 2;
    for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (perf(m).dv >= dv) lo = m; else hi = m; }
    maxPayload = lo;
  }
  return { key: launcher.key, label: launcher.label, dv: p.dv, margin: p.dv - dv, can: p.dv >= dv, maxPayload, liftoff: p.liftoff, stages: p.stages, source: launcher.source };
}

// What sizing by the rocket equation leaves out, and a launcher needs to fly
// an ascent: the medians over the distinct real launchers in launchers.js
// (Saturn V, Falcon 9 expendable, Electron; the Falcon 9 that lands its
// booster is the same vehicle), from their published figures:
//   twr1     stage 1's sea-level thrust-to-weight at liftoff (1.17, 1.38, 1.76)
//   ispSl    stage 1's sea-level Isp over its vacuum Isp (0.865, 0.907, 0.932)
//   twrUp    an upper stage's vacuum thrust-to-weight at ignition (0.80,
//            0.63; 0.74; 1.03)
//   size     diameter over the cube root of the liftoff mass, m per t^(1/3)
//            (0.705, 0.442, 0.511): the same shape scaled
//   cd       the drag coefficient (0.5, 0.3, 0.3)
//   s1dv     stage 1's own delta-v, ideal, by the rocket equation with its
//            vacuum Isp (m/s): how far into the climb the upper stages
//            light (3.4, 3.8 and 4.6 km/s or so)
const median = (xs) => { const a = [...xs].sort((x, y) => x - y), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
export function typicalLauncher(launchers = LAUNCHERS.filter((L) => L.key !== 'falcon-9-landing'), g0 = G0) {
  const rows = launchers.map((L) => {
    const masses = [];
    let above = L.payload;
    for (let i = L.stages.length - 1; i >= 0; i--) { above += L.stages[i].dry + L.stages[i].prop; masses[i] = above; }
    const s1 = L.stages[0];
    return { twr1: s1.thrust * (s1.ispSl / s1.isp) / (masses[0] * g0), ispSl: s1.ispSl / s1.isp, twrUp: L.stages.slice(1).map((s, i) => s.thrust / (masses[i + 1] * g0)), size: L.diameter / Math.cbrt(masses[0]), cd: L.cd,
      s1dv: s1.isp * g0 * Math.log(masses[0] / (masses[0] - s1.prop)) };
  });
  return {
    twr1: median(rows.map((r) => r.twr1)), ispSl: median(rows.map((r) => r.ispSl)), twrUp: median(rows.flatMap((r) => r.twrUp)),
    size: median(rows.map((r) => r.size)), cd: median(rows.map((r) => r.cd)), s1dv: median(rows.map((r) => r.s1dv)), from: launchers.map((L) => L.label),
  };
}

// A stack sized by sizeLauncher (its pick, or any feasible option: stages
// bottom first with prop and dry in kg) as the ROCKET tab's vehicle, in its
// units (t, kN, s, m). Its masses and vacuum Isp are the sizing's; what the
// sizing leaves out comes from typicalLauncher, and each stage lists those
// figures in `est` so the tab shows them as estimates:
//   stage 1's sea-level Isp, ispSl times its Isp; upper stages fire high, so
//   their sea-level Isp is their vacuum one;
//   stage 1's vacuum thrust, from twr1 at sea level at liftoff; each upper
//   stage's from twrUp at its ignition, unless it lights before the stack
//   has given s1dv (the real launchers' first stages' share of the climb):
//   then it is still climbing, as a first stage is, and takes twr1. (A
//   storable booster under hydrolox stages is sized short, 1.5 km/s, and
//   at twrUp the stage above it can't climb at all.);
//   the diameter, size times the cube root of the liftoff mass in t;
//   the drag coefficient, cd.
/** @param {{ feasible: boolean, stages?: { dry: number, prop: number, isp: number }[] } | null} option
 *  @param {{ payload: number, label?: string, names?: string[] | null, typical?: ReturnType<typeof typicalLauncher>, g0?: number }} opts */
export function stackAsLauncher(option, { payload, label = 'Journey\'s stack', names = null, typical = typicalLauncher(), g0 = G0 }) {
  if (!option?.feasible || !option.stages?.length) return null;
  const st = option.stages, masses = [];
  let above = payload;
  for (let i = st.length - 1; i >= 0; i--) { above += st[i].dry + st[i].prop; masses[i] = above; }
  let given = 0;
  const stages = st.map((s, i) => {
    const ispSl = i === 0 ? s.isp * typical.ispSl : s.isp;
    const climbing = i > 0 && given < typical.s1dv;
    const thrust = i === 0 ? typical.twr1 * masses[0] * g0 * (s.isp / ispSl) : (climbing ? typical.twr1 : typical.twrUp) * masses[i] * g0;
    given += s.isp * g0 * Math.log(masses[i] / (masses[i] - s.prop));
    return { name: names?.[i] ?? (i === 0 ? 'First stage' : `Stage ${i + 1}`), dry: s.dry / 1000, prop: s.prop / 1000, isp: s.isp, ispSl, thrust: thrust / 1000, est: i === 0 ? ['ispSl', 'thrust'] : ['thrust'] };
  });
  return { label, payload: payload / 1000, diameter: typical.size * Math.cbrt(masses[0] / 1000), cd: typical.cd, stages, est: { cd: true, diameter: true }, liftoff: masses[0] / 1000 };
}
