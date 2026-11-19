// packages/physics/src/remedies.test.mjs
//
// What the GO board offers where a row reads NO GO (remedies.js): the
// Trajectory row's verdict, why the kernel's craft hits a body it was
// never sent to, and the options, each a journey that solves, priced by
// solving it.

import './deNode.js';
import * as J from './journey.js';
import * as F from './feasibility.js';
import { remedies, impactWhy, flightVerdict, withStop } from './remedies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';

let failures = 0;
function check(name, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; }
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const D = Date.parse, DAY_MS = 86400e3;
const t = (ms) => (ms - KERNEL_EPOCH_MS) / 1000;
const fmt = (o) => `${o.label}: ${o.total.toFixed(2)} km/s${o.budget !== undefined ? ` (budget ${o.budget})` : `, ${o.delta >= 0 ? '+' : ''}${o.delta.toFixed(2)}`}`;

// Earth to Io orbit on the plotting table's dates for it, from the pad on
// 19 Nov 2026 (journey.test.mjs CASE 24's leg, as an orbit).
const io = (kind = 'orbit', arr = '2031-04-12T08:07:36.666Z') => ({ start: { body: 'earth', kind: 'pad', altKm: 200, dateMs: D('2027-11-30T16:38:29.937Z'), latDeg: 28.5 }, waypoints: [{ id: 1, body: 'io', kind, altKm: 400, stayDays: kind === 'flyby' ? 0 : 3, dateMs: D(arr) }] });
const j = io(), sol = J.solveJourney(j), L = sol.legs[0], R = J.bodyInfo('jupiter').radius;
const profiles = j.waypoints.map((_, k) => F.legProfile(j, k, { sol }));
const lamps = F.assess(j, sol, { budget: 8, profiles });

header('CASE 1: the Trajectory row\'s verdict');
{
  const a = (missKm, extra = {}) => ({ waypoint: 0, body: 'io', missKm, central: false, ...extra });
  const v = (f) => flightVerdict(sol, f).state;
  check('go; a waypoint 51 km off is a miss; 1.4 km/s of corrections on a 13.7 km/s plan is too many, 1.3 not', v({ arrivals: [a(0.2)], correctionsDv: 0.27 }) === 'go' && v({ arrivals: [a(51)], correctionsDv: 0 }) === 'miss' && v({ arrivals: [a(1)], correctionsDv: 1.4 }) === 'corrections' && v({ arrivals: [a(1)], correctionsDv: 1.3 }) === 'go');
  check('an impact is a hit, unless it is the touchdown on a body the journey lands on (an arrival at a central body)', v({ arrivals: [a(1)], impact: { body: 'jupiter', t: 0 } }) === 'hit' && v({ arrivals: [a(1, { body: 'jupiter', central: true })], impact: { body: 'jupiter', t: 0 } }) === 'go');
}

header('CASE 2: why the craft hits Jupiter on the way to Io');
{
  // The plan's approach about Jupiter has its periapsis at Io (6 Jupiter
  // radii), so a hit there is the kernel's flight drifting in.
  const w = impactWhy(sol, { impact: { body: 'jupiter', t: t(L.arrMs - 3600e3) }, arrivals: [] });
  console.log(`  ${w.text}`);
  check('named through its moon: "Io is reached through Jupiter\'s gravity", the approach\'s height over the cloud tops (the periapsis less the radius, to the km), and the kernel\'s flight drifted in', w.leg === 0 && w.relation === 'well' && w.text.startsWith('Io is reached through Jupiter\'s gravity: the approach stays ') && Math.abs(w.clearKm - (L.moonArr.rp - R)) < 1e-6 && w.text.includes(Math.round(L.moonArr.rp - R).toLocaleString('en-AU')) && w.text.endsWith('drifted into it'));
  // Half a day early, Io is on the far side: the cheaper hyperbola is on
  // course into Jupiter, cut off at Io (journey.test.mjs, Leaving a moon).
  const s2 = J.solveJourney(io('orbit', '2031-04-11T12:07:36.666Z')), L2 = s2.legs[0];
  const w2 = impactWhy(s2, { impact: { body: 'jupiter', t: t(L2.arrMs + 3600e3) }, arrivals: [] });
  console.log(`  ${w2.text}`);
  check('half a day early, the approach is on course below the cloud tops past Io, and it says by how much', L2.moonArr.rp < R && !L2.moonArr.ahead && w2.clearKm < 0 && w2.text.includes(`${Math.round(R - L2.moonArr.rp).toLocaleString('en-AU')} km below its cloud tops`));
  // A body not in the plan: the planned path's closest approach.
  const m = J.solveJourney({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-20T00:00:00Z') }, waypoints: [{ id: 1, body: 'mars', kind: 'orbit', altKm: 400, stayDays: 3, dateMs: D('2027-08-20T00:00:00Z') }] });
  const w3 = impactWhy(m, { impact: { body: 'venus', t: t(D('2027-03-01T00:00:00Z')) }, arrivals: [] });
  console.log(`  ${w3.text}`);
  check('a body not in the plan is named, with the date and height of the plan\'s closest pass', w3.relation === 'passing' && w3.text.startsWith('Venus is not in the plan, but the leg to Mars passes it on ') && w3.clearKm > 1e6);
}

header('CASE 3: what to change: Earth to Io orbit, 13.7 km/s against a budget of 8');
{
  const flight = { impact: { body: 'jupiter', t: t(L.arrMs - 3600e3) }, arrivals: [{ waypoint: 0, body: 'io', missKm: 0.3, central: false }], correctionsDv: 0.27 };
  const t0 = Date.now(), r = remedies(j, sol, { budget: 8, profiles, lamps, flight }), ms = Date.now() - t0;
  for (const [k, v] of Object.entries(r)) if (v) console.log(`  ${k}: ${v.why ?? ''}\n    ${v.options.map(fmt).join('\n    ')}`);
  console.log(`  worked out in ${ms} ms`);
  const all = Object.values(r).filter(Boolean).flatMap((x) => x.options);
  check('every option that changes the journey solves, at the total it states', all.filter((o) => o.journey).every((o) => { const s = J.solveJourney(o.journey); return s.ok && Math.abs(s.totalDv - o.total) < 1e-9 && Math.abs(o.delta - (o.total - sol.totalDv)) < 1e-9; }));
  const stop = r.trajectory.options.find((o) => o.label.startsWith('Stop in Jupiter orbit first'));
  check('the hit: a stop in Jupiter orbit before Io is offered, Jupiter then Io', stop && stop.journey.waypoints.map((w) => `${w.body} ${w.kind}`).join(', ') === 'jupiter orbit, io orbit');
  const date = r.trajectory.options.find((o) => o.label.startsWith('Leave Earth '));
  const sd = date && J.solveJourney(date.journey), clear = sd && sd.legs[0].moonArr && (sd.legs[0].moonArr.rp - R);
  check('the hit: another departure date whose approach keeps a tenth of a radius clear of the cloud tops', date && clear > 0.1 * R);
  const b = r.dv.options.at(-1);
  check('delta-v: the budget raised to the total, up a tenth of a km/s (13.7), and a cheaper departure first', b.budget === Math.ceil(sol.totalDv * 10) / 10 && r.dv.options[0].total < sol.totalDv);
  check('rows that are not NO GO have nothing: shaping, orbits, flybys, launch', !r.shaping && !r.orbits && !r.flybys && !r.launch);
  check('without a flight (the kernel still flying), no Trajectory options', remedies(j, sol, { budget: 8, profiles, lamps }).trajectory === null);
}

header('CASE 4: inserting a stop, and the launch row');
{
  const w = withStop(j, 0, { body: 'jupiter', kind: 'orbit', altKm: 70000 }), s = J.solveJourney(w);
  console.log(`  Jupiter orbit ${new Date(s.stops[1].arrMs).toISOString().slice(0, 10)}, Io ${new Date(s.stops[2].arrMs).toISOString().slice(0, 10)}: ${s.totalDv.toFixed(2)} km/s against ${sol.totalDv.toFixed(2)}`);
  check('a stop inserted before Io: Jupiter orbit at 70,000 km, then Io after it, both legs solved, in date order', s.ok && w.waypoints[0].body === 'jupiter' && w.waypoints[0].altKm === 70000 && s.stops[2].arrMs > s.stops[1].depMs && s.stops[2].arrMs - s.stops[1].depMs < 30 * DAY_MS);
  const low = { ...j, start: { ...j.start, altKm: 100 } }, sl = J.solveJourney(low);
  const r = remedies(low, sl, { budget: 20, profiles: [], lamps: F.assess(low, sl, { budget: 20 }) });
  check('a parking orbit inside the air: raised to 120 km, priced', r.launch?.options[0]?.journey.start.altKm === 120 && J.solveJourney(r.launch.options[0].journey).ok);
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exit(failures ? 1 : 0);
