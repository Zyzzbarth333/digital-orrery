// src/physics/journey.test.mjs
//
// The journey planner's physics against textbook worked examples, then the
// journey itself: legs chained, flybys joined, options compared, and a
// journey flown by the n-body kernel reaching each waypoint.
//
// Reference: Curtis, Orbital Mechanics for Engineering Students, 4th ed.
// (Butterworth-Heinemann, 2020). Its chapter 4 (the node's J2 regression,
// Sec. 4.7), 6 (orbital manoeuvres), 8
// (interplanetary trajectories) and 13 (rocket vehicle dynamics: staging,
// chapter 11 in the 1st and 2nd editions). Examples are cited by that
// edition's numbers; the book rounds to four or five figures, so checks
// allow its last figure.

import './deNode.js';
import fs from 'node:fs';
import * as X from './transfers.js';
import { restrictedStaging, restrictedPayloadRatio, sizeLauncher, launchBudget, launcherFor, STAGE_TECH } from './staging.js';
import { LAUNCHERS } from './launchers.js';
import * as J from './journey.js';
import { propagate } from './orbital.js';
import { planFlight, flyJourney, flightTrouble, JOURNEY_CRAFT } from './journeyFlight.js';
import * as F from './feasibility.js';
import * as PP from './parkingPlane.js';
import { ZONAL } from './bodies.js';
import { bodyAxesEqj } from './orientation.js';
import { stepCraft } from './kernelHost.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS, createKernelHost, kernelSeconds } from './kernelHost.js';
import * as LD from './landing.js';
import { Craft } from './craft.js';

let failures = 0;
function check(name, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; }
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const near = (x, ref, tol) => Math.abs(x - ref) <= tol;
const rel = (x, ref) => Math.abs(x / ref - 1);
const deg = Math.PI / 180, DAY = 86400, DAY_MS = 86400e3;
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const MU_E = 398600;                                   // Curtis Table A.2

header('CASE 1: orbit changes about one body (Curtis chapter 6)');
{
  // Example 6.1: 480 by 800 km orbit, from perigee to a 16,000 km circle.
  const h = X.hohmannApse({ mu: MU_E, from: { rp: 6858, ra: 7178 }, rA: 6858, to: { rp: 22378, ra: 22378 }, rB: 22378 });
  const prop = 2000 * (1 - Math.exp(-h.total / (300 * 9.807e-3)));
  console.log(`  Ex 6.1: dvA ${h.dv1.toFixed(4)} (1.7225), dvB ${h.dv2.toFixed(4)} (1.3297), total ${h.total.toFixed(4)} km/s (3.0522), propellant ${prop.toFixed(1)} kg (1291.3)`);
  check('Ex 6.1: Hohmann from an elliptical orbit\'s perigee, both burns and the propellant', near(h.dv1, 1.7225, 1e-4) && near(h.dv2, 1.3297, 1e-4) && near(prop, 1291.3, 0.1));

  // Example 6.3: bi-elliptic 7,000 to 105,000 km via 210,000 km.
  const b = X.biElliptic(MU_E, 7000, 210000, 105000), hh = X.hohmannCircular(MU_E, 7000, 105000);
  console.log(`  Ex 6.3: bi-elliptic ${b.total.toFixed(4)} km/s in ${(b.tof / DAY).toFixed(2)} d (4.0285, 5.66); Hohmann ${hh.total.toFixed(4)} km/s in ${hh.tof.toFixed(0)} s (4.0463, 65,942)`);
  check('Ex 6.3: bi-elliptic and Hohmann delta-v and times', near(b.total, 4.0285, 1e-4) && near(b.tof / DAY, 5.66, 0.005) && near(hh.total, 4.0463, 1e-4) && near(hh.tof, 65942, 1));
  check('Ex 6.3: bi-elliptic beats Hohmann there', b.total < hh.total);
  // Fig. 6.8: below rC/rA = 11.94 Hohmann always wins; above 15.58 any rB beyond rC wins.
  const be11 = X.biEllipticBreakEven(MU_E, 7000, 7000 * 11.5), be16 = X.biEllipticBreakEven(MU_E, 7000, 7000 * 16), be13 = X.biEllipticBreakEven(MU_E, 7000, 7000 * 13);
  check('Fig. 6.8: no break-even below 11.94, rC itself above 15.58, a finite rB between', be11 === null && be16 === 7000 * 16 && be13 > 7000 * 13 && Number.isFinite(be13));

  // Example 6.4: chaser at perigee of a 6,800 by 13,600 km orbit, target 90 degrees ahead.
  const lead = X.timeSincePeriapsis(MU_E, 10200, 1 / 3, Math.PI / 2), p = X.phasing({ mu: MU_E, rp: 6800, ra: 13600, lead });
  console.log(`  Ex 6.4: t_AB ${lead.toFixed(1)} s (1495.7), T2 ${p.T2.toFixed(1)} s (8756.3), apogee ${p.rOther.toFixed(0)} km (11,564), total ${p.total.toFixed(4)} km/s (0.4970)`);
  check('Ex 6.4: phasing orbit period, apogee and total delta-v', near(lead, 1495.7, 0.1) && near(p.T2, 8756.3, 0.1) && near(p.rOther, 11564, 1) && near(p.total, 0.4970, 1e-4));

  // Example 6.5: GEO satellite 12 degrees west in three revolutions.
  const g = X.phasing({ mu: MU_E, rp: 42164, ra: 42164, lead: -(12 * deg) / 72.922e-6, revs: 3 });
  console.log(`  Ex 6.5: T2 ${g.T2.toFixed(0)} s (87,121), apogee ${g.rOther.toFixed(0)} km (42,788), total ${(g.total * 1000).toFixed(2)} m/s (22.52)`);
  check('Ex 6.5: GEO drift orbit and total delta-v', near(g.T2, 87121, 1) && near(g.rOther, 42788, 1) && near(g.total, 0.02252, 1e-5));

  // Examples 6.11 and 6.12: 300 km LEO at 28 degrees to GEO.
  const pc = X.hohmannPlaneChange(MU_E, 6678, 42164, 28 * deg);
  console.log(`  Ex 6.11: plane change at GEO ${pc.atEnd.total.toFixed(4)} (4.2449), in LEO ${pc.atStart.total.toFixed(4)} (6.3910); Ex 6.12: best split ${(pc.split / deg).toFixed(4)} deg (2.1751), ${pc.total.toFixed(4)} km/s (4.2207)`);
  check('Ex 6.11: the plane change done at either end', near(pc.atEnd.total, 4.2449, 3e-4) && near(pc.atStart.total, 6.3910, 3e-4));
  check('Ex 6.12: the best split of the plane change and its total', near(pc.split / deg, 2.1751, 2e-3) && near(pc.total, 4.2207, 2e-4));
  check('a pure plane change is 2 v sin(di/2), and combined with no turn it is the speed change', near(X.planeChangeDv(7.5, 60 * deg), 7.5, 1e-12) && near(X.combinedDv(3, 4, 0), 1, 1e-12));
}

header('CASE 2: between planets (Curtis chapter 8)');
{
  const muS = 132.71e9, RE = 149.6e6, RM = 227.9e6, nE = 2 * Math.PI / 365.26, nM = 2 * Math.PI / 687.99;
  // Ex 8.1 prints 777.9 d, but its own periods give 778.65 d, the figure
  // Ex 8.2 then uses (its wait time is 778.65 N - 324.85 d).
  console.log(`  Ex 8.1: synodic period of Mars ${X.synodicPeriod(365.26, 687.99).toFixed(2)} d (778.65, as Ex 8.2 uses it)`);
  check('Ex 8.1: synodic period', near(X.synodicPeriod(365.26, 687.99), 778.65, 0.005));
  const w = X.hohmannWindow(muS, RE, RM, { n1: nE / DAY, n2: nM / DAY }), back = X.hohmannWindow(muS, RM, RE, { n1: nM / DAY, n2: nE / DAY });
  const atArrival = nE * w.tof / DAY - Math.PI;                           // Earth ahead of Mars when it arrives
  const wait = X.windowWait(atArrival, back.phase0, back.n1, back.n2) / DAY;
  console.log(`  Ex 8.2: flight ${(w.tof / DAY).toFixed(2)} d (258.8), departure phase ${(w.phase0 / deg).toFixed(2)} deg (44.57), wait at Mars ${wait.toFixed(1)} d (453.8)`);
  check('Ex 8.2: Hohmann flight time, phase angle and the wait for the way home', near(w.tof / DAY, 258.8, 0.05) && near(w.phase0 / deg, 44.57, 0.02) && near(wait, 453.8, 0.2));

  // Example 8.4: Earth to Mars from a 300 km parking orbit.
  const vinf = Math.sqrt(1.327e11 / RE) * (Math.sqrt(2 * RM / (RE + RM)) - 1), dv = X.departureDv(vinf, 398600, 6678);
  console.log(`  Ex 8.4: v_inf ${vinf.toFixed(3)} (2.943), dv ${dv.toFixed(3)} km/s (3.590), beta ${(X.departureBeta(vinf, 398600, 6678) / deg).toFixed(2)} deg (29.16)`);
  check('Ex 8.4: departure excess speed, burn and periapsis angle', near(vinf, 2.943, 5e-4) && near(dv, 3.590, 5e-4) && near(X.departureBeta(vinf, 398600, 6678) / deg, 29.16, 0.01));

  // Example 8.5: the cheapest capture at Mars into a 7-hour orbit.
  const va = Math.sqrt(1.327e11 / RM) * (1 - Math.sqrt(2 * RE / (RE + RM))), a7 = Math.cbrt(42830 * (7 * 3600 / (2 * Math.PI)) ** 2), e7 = 2 * 42830 / (a7 * va * va) - 1;
  const oc = X.optimalCapture(va, 42830, e7), aim = X.aimingRadius(oc.rp, va, 42830);
  console.log(`  Ex 8.5: v_inf ${va.toFixed(3)} (2.648), e ${e7.toFixed(4)} (0.3833), dv ${oc.dv.toFixed(3)} km/s (1.470), rp ${oc.rp.toFixed(0)} km (5447), aiming radius ${aim.toFixed(0)} km (9809)`);
  check('Ex 8.5: optimal capture delta-v, periapsis and aiming radius', near(va, 2.648, 5e-4) && near(e7, 0.3833, 2e-4) && near(oc.dv, 1.470, 5e-4) && near(oc.rp, 5447, 2) && near(aim, 9809, 2));

  // Example 8.6: a Venus flyby, 300 km periapsis; the dark-side and sunlit approaches.
  const vin = [37.51 - 35.02, 2.782, 0], muV = 324900, rp = 6352;
  const dark = X.flyby({ vinfIn: vin, mu: muV, rp, normal: [0, 0, 1] }), lit = X.flyby({ vinfIn: vin, mu: muV, rp, normal: [0, 0, -1] });
  const V2d = norm([35.02 + dark.vinfOut[0], dark.vinfOut[1], 0]), V2l = norm([35.02 + lit.vinfOut[0], lit.vinfOut[1], 0]);
  console.log(`  Ex 8.6: v_inf ${norm(vin).toFixed(3)} (3.733), turn ${(dark.delta / deg).toFixed(1)} deg (103.6), aiming radius ${dark.aim.toFixed(0)} km (18,340), speed after ${V2d.toFixed(2)} km/s dark side (31.78), ${V2l.toFixed(2)} sunlit (37.27)`);
  check('Ex 8.6: turn angle, aiming radius and the speed after, dark side and sunlit', near(dark.delta / deg, 103.6, 0.05) && rel(dark.aim, 18340) < 5e-4 && near(V2d, 31.78, 0.01) && near(V2l, Math.hypot(37.14, 3.074), 0.01));

  // Examples 8.9 and 8.10: departure from 180 km and a 48-hour capture at Mars.
  const a48 = Math.cbrt(42830 * (48 * 3600 / (2 * Math.PI)) ** 2), cap = X.captureDv(2.8852, 42830, 3680, 1 - 3680 / a48);
  console.log(`  Ex 8.9: departure ${X.departureDv(3.1651, 398600, 6558).toFixed(3)} km/s (3.674); Ex 8.10: capture ${cap.toFixed(4)} km/s (0.9382)`);
  check('Ex 8.9 and 8.10: departure and capture burns', near(X.departureDv(3.1651, 398600, 6558), 3.674, 1e-3) && near(cap, 0.9382, 1e-4));

  // Example 8.8: Earth (7 Nov 1996) to Mars (12 Sep 1997). Curtis takes the
  // planets from his Algorithm 8.1 (mean elements); this uses DE442 and
  // astronomy-engine, so the excess speeds agree to his ephemeris's accuracy.
  const L = J.solveLeg({ body: 'earth', kind: 'orbit', altKm: 180 }, { body: 'mars', kind: 'orbit', altKm: 300 }, Date.parse('1996-11-07T00:00:00Z'), Date.parse('1997-09-12T00:00:00Z'));
  console.log(`  Ex 8.8: v_inf departure ${norm(L.vinfDep).toFixed(4)} (3.1656), arrival ${norm(L.vinfArr).toFixed(4)} km/s (2.8852)`);
  check('Ex 8.8: the Lambert leg\'s excess speeds within 0.5 % of the book', rel(norm(L.vinfDep), 3.1656) < 5e-3 && rel(norm(L.vinfArr), 2.8852) < 5e-3);

  // B-plane: the aim point that bPlane gives turns the flyby back into the same hyperbola.
  const vi = [3, -8, 1.1], ax = [0.3, 0.2, 0.93], k = [vi[1] * ax[2] - vi[2] * ax[1], vi[2] * ax[0] - vi[0] * ax[2], vi[0] * ax[1] - vi[1] * ax[0]];
  const vo = X.rotate(vi, k.map((x) => x / norm(k)), 0.6), muE = 398600.4;
  const rpW = (muE / norm(vi) ** 2) * (1 / Math.sin(0.3) - 1);         // the periapsis whose turn is 0.6 rad (Curtis 8.75)
  const bp = X.bPlane(vi, vo, rpW, muE), back2 = X.flybyFromB({ vinfIn: vi, mu: muE, bT: bp.bT, bR: bp.bR });
  const dirErr = Math.acos(Math.min(1, (back2.vinfOut[0] * vo[0] + back2.vinfOut[1] * vo[1] + back2.vinfOut[2] * vo[2]) / (norm(vo) * norm(back2.vinfOut))));
  check('B-plane: the aim point gives back the periapsis and the outgoing direction', rel(back2.rp, rpW) < 1e-9 && dirErr < 1e-9);
  const pf = X.poweredFlyby({ vinfIn: vi, vinfOut: vo, mu: muE, rpMin: 6378 });
  check('a flyby needing no burn: equal speeds and a turn its periapsis gives cost nothing', rel(pf.rp, rpW) < 1e-6 && pf.dv < 1e-9 && !pf.tooTight);
}

header('CASE 3: staging (Curtis chapter 13)');
{
  const c = { isp: 350, eps: 0.15, g0: 9.81 };
  const v1 = restrictedStaging({ n: 1, ...c, payloadRatio: 0.05 }), v2 = restrictedStaging({ n: 2, ...c, payloadRatio: 0.05 }), v3 = restrictedStaging({ n: 3, ...c, payloadRatio: 0.05 });
  console.log(`  Ex 13.4 and 13.5: burnout ${(v1 / 1000).toFixed(3)}, ${(v2 / 1000).toFixed(3)}, ${(v3 / 1000).toFixed(3)} km/s for 1, 2, 3 stages (5.657, 7.407, 7.928)`);
  check('Ex 13.4 and 13.5: restricted staging, burnout speed for 1, 2 and 3 stages', near(v1, 5657, 1) && near(v2, 7407, 1) && near(v3, 7928, 1));
  check('the payload ratio that a burnout speed allows inverts it', rel(restrictedPayloadRatio({ n: 3, ...c, dv: v3 }), 0.05) < 1e-12);
  // The Lagrange multiplier optimum for identical stages is the restricted
  // vehicle: the same 200,000 kg and stage masses as the book's.
  const s2 = sizeLauncher({ dv: v2, payload: 10000, booster: c, maxStages: 2, g0: 9.81 }).options[1];
  const s3 = sizeLauncher({ dv: v3, payload: 10000, booster: c, maxStages: 3, g0: 9.81 }).options[2];
  console.log(`  Ex 13.4(b): liftoff ${s2.liftoff.toFixed(0)} kg (200,000), dry ${s2.stages.map((s) => s.dry.toFixed(0)).join(', ')} (23,292, 5208), propellant ${s2.stages.map((s) => s.prop.toFixed(0)).join(', ')} (131,990, 29,513)`);
  console.log(`  Ex 13.5: dry ${s3.stages.map((s) => s.dry.toFixed(0)).join(', ')} (18,948, 6980, 2572), propellant ${s3.stages.map((s) => s.prop.toFixed(0)).join(', ')} (107,370, 39,556, 14,573)`);
  check('Ex 13.4(b): the optimum two-stage stack is the book\'s restricted one (to its five figures)', rel(s2.liftoff, 200000) < 1e-6 && [23292, 5208].every((x, i) => near(s2.stages[i].dry, x, 1)) && [131990, 29513].every((x, i) => near(s2.stages[i].prop, x, 5)));
  check('Ex 13.5: and the three-stage one', [18948, 6980, 2572].every((x, i) => near(s3.stages[i].dry, x, 1)) && [107370, 39556, 14573].every((x, i) => near(s3.stages[i].prop, x, 5)));
  // Picking a stage count: a job beyond one stage's limit, the lightest
  // within 10 % chosen with the fewest stages.
  const L = sizeLauncher({ dv: 13000, payload: 5000, booster: STAGE_TECH.storable, upper: STAGE_TECH.hydrolox, maxStages: 4 });
  const ok = L.options.filter((o) => o.feasible), light = Math.min(...ok.map((o) => o.liftoff));
  console.log(`  13 km/s, 5 t payload: ${L.options.map((o) => (o.feasible ? `${o.n} stages ${(o.liftoff / 1000).toFixed(0)} t` : `${o.n} stage cannot`)).join('; ')}; pick ${L.pick.n}`);
  check('a single stage cannot do 13 km/s with these; the pick is within 10 % of the lightest with the fewest stages', !L.options[0].feasible && L.pick.liftoff <= light * 1.1 && ok.every((o) => o.n >= L.pick.n || o.liftoff > light * 1.1));
  check('each stage\'s delta-v adds up to the job', ok.every((o) => near(o.stages.reduce((a, s) => a + s.dv, 0), 13000, 1e-6)));
  const B = launchBudget({ journeyDv: 3600, h: 200e3, lat: 28.5, az: 90, losses: 1500 });
  // To a 200 km orbit due east from 28.5 deg: 7,784 m/s circular, less the
  // Earth's 408 m/s, plus 1,500 m/s of losses.
  console.log(`  launch budget: ${B.toOrbit.toFixed(0)} m/s to orbit (8,876) + 3,600 = ${B.total.toFixed(0)} m/s`);
  check('the launch budget is the climb to orbit plus the journey', near(B.total, B.toOrbit + 3600, 1e-9) && near(B.toOrbit, 8876, 2));
}

header('CASE 3b: real launchers against a job (launchers.js)');
{
  // Each launcher's own published job, as a delta-v budget (the climb with
  // 1.5 km/s of losses, then any departure), against its stack by the
  // rocket equation with vacuum Isp.
  const sv = LAUNCHERS.find((l) => l.key === 'saturn-v'), f9 = LAUNCHERS.find((l) => l.key === 'falcon-9'), el = LAUNCHERS.find((l) => l.key === 'electron');
  const apollo = launchBudget({ journeyDv: 3130, h: 185e3, lat: 28.6, az: 72 });
  const a = launcherFor(sv, { payload: sv.payload * 1000, dv: apollo.total });
  console.log(`  Saturn V, Apollo 11's ${sv.payload} t to a 185 km orbit and on to the Moon (TLI 3.13 km/s): needs ${(apollo.total / 1000).toFixed(2)}, gives ${(a.dv / 1000).toFixed(2)} km/s; at most ${(a.maxPayload / 1000).toFixed(1)} t`);
  check('Saturn V can fly Apollo 11\'s job with its payload, and not by a wide margin (under 1.5 km/s spare)', a.can && a.margin < 1500);
  const leo = launchBudget({ journeyDv: 0, h: 200e3, lat: 28.5, az: 90 }), b = launcherFor(f9, { payload: f9.payload * 1000, dv: leo.total });
  console.log(`  Falcon 9 expendable, its ${f9.payload} t to 200 km: needs ${(leo.total / 1000).toFixed(2)}, gives ${(b.dv / 1000).toFixed(2)} km/s`);
  check('Falcon 9 expendable reaches low orbit with its published payload, within 1 km/s', b.can && b.margin < 1000);
  const sso = launchBudget({ journeyDv: 0, h: 500e3, lat: -39.3, az: 190 }), c = launcherFor(el, { payload: el.payload * 1000, dv: sso.total });
  // Electron's 0.3 t in launchers.js includes its Curie kick stage, which
  // in fact burns to finish the orbit; here it rides as payload, so the
  // stack comes out just short (the ROCKET tab's ascent reaches 181 km).
  console.log(`  Electron, 300 kg (kick stage included) to 500 km from Mahia: needs ${(sso.total / 1000).toFixed(2)}, gives ${(c.dv / 1000).toFixed(2)} km/s`);
  check('Electron comes within 0.1 km/s of its job with the kick stage carried as payload', Math.abs(c.margin) < 100);
  check('the most payload for a job is where the delta-v just meets it', Math.abs(launcherFor(sv, { payload: a.maxPayload, dv: apollo.total }).margin) < 1);
  check('no payload at all when even an empty stack falls short (Electron to Mars and back)', launcherFor(el, { payload: 1000, dv: 16556 }).maxPayload === 0);
}

header('CASE 4: a journey of several legs, chained');
J.registerSmallBodies(JSON.parse(fs.readFileSync(new URL('../../public/data/smallbodies.json', import.meta.url))).named);
const D = (s) => Date.parse(s);
// Mariner 10's journey (NASA's mission dates): Earth to Venus to Mercury.
const MARINER10 = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('1973-11-03T17:45:00Z') }, waypoints: [
  { id: 1, body: 'venus', kind: 'flyby', altKm: 5768, dateMs: D('1974-02-05T17:01:00Z') },
  { id: 2, body: 'mercury', kind: 'flyby', altKm: 703, dateMs: D('1974-03-29T20:47:00Z') }] };
const MOON_TRIP = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-12-01T00:00:00Z') }, waypoints: [
  { id: 1, body: 'moon', kind: 'orbit', altKm: 100, stayDays: 3, dateMs: D('2026-12-05T00:00:00Z') },
  { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D('2026-12-12T00:00:00Z') }] };
{
  const s = J.solveJourney(MARINER10), fb = s.flybys[0];
  console.log(`  Mariner 10: leave Earth ${s.legs[0].depDv.toFixed(3)} km/s, at Venus v_inf in ${norm(s.legs[0].vinfArr).toFixed(3)}, out ${norm(s.legs[1].vinfDep).toFixed(3)} km/s, turn ${(fb.delta / deg).toFixed(1)} deg, powered ${(fb.dv * 1000).toFixed(1)} m/s`);
  check('each leg leaves where and when the last arrived (a flyby: at once)', s.legs[1].depMs === s.legs[0].arrMs && s.legs[1].from === s.legs[0].to);
  check('the flyby joins the legs: in and out excess speeds within 1 % (a real assist)', rel(norm(s.legs[1].vinfDep), norm(s.legs[0].vinfArr)) < 0.01);
  check('the assist turns the excess velocity for under 50 m/s of burn', fb.dv < 0.05 && fb.delta > 20 * deg);
  const t = J.solveJourney(MOON_TRIP);
  console.log(`  Earth orbit, Moon orbit 3 days, home: ${t.burns.map((b) => `${b.label} ${b.dv.toFixed(3)}`).join('; ')}; total ${t.totalDv.toFixed(3)} km/s over ${t.durationDays.toFixed(1)} d`);
  check('a stay: the next leg leaves 3 days after the arrival', t.legs[1].depMs === t.legs[0].arrMs + 3 * DAY_MS);
  check('the total is the sum of every burn; home through the air costs nothing', near(t.totalDv, t.burns.reduce((a, b) => a + b.dv, 0), 1e-12) && t.legs[1].arrDv === 0);
  // An orbit change sets its own arrival; later dates keep their spacing.
  const geo = J.solveJourney({ start: { body: 'earth', kind: 'orbit', altKm: 300, dateMs: D('2026-12-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'earth', kind: 'orbit', altKm: 35786, stayDays: 1, dateMs: D('2026-12-01T00:00:00Z') },
    { id: 2, body: 'moon', kind: 'orbit', altKm: 100, dateMs: D('2026-12-08T00:00:00Z') }] });
  const hz = X.hohmannCircular(J.bodyInfo('earth').mu, J.bodyInfo('earth').radius + 300, J.bodyInfo('earth').radius + 35786);
  check('an orbit change is a Hohmann transfer, arriving after its own flight time', near(geo.legs[0].depDv + geo.legs[0].arrDv, hz.total, 1e-12) && near((geo.legs[0].arrMs - geo.legs[0].depMs) / 1000, hz.tof, 1e-3));
  check('and the waypoints after it move with it', near(geo.stops[2].arrMs - D('2026-12-08T00:00:00Z'), geo.legs[0].arrMs - D('2026-12-01T00:00:00Z'), 1));
  // The options for a leg, compared.
  const em = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z') }] };
  const o = J.legOptions(em, 0), by = (t) => o.options.find((x) => x.type === t);
  console.log(`  Earth to Mars: ${o.options.map((x) => `${x.type} ${x.dv.toFixed(3)} km/s ${x.tofDays.toFixed(0)} d`).join('; ')}`);
  check('every option for a Mars leg is there: Lambert, Hohmann, bi-elliptic, plane change, porkchop', ['lambert', 'hohmann', 'bielliptic', 'planechange', 'porkchop'].every((t) => by(t)));
  check('the porkchop optimum costs no more than the leg as scheduled', by('porkchop').dv <= by('lambert').dv + 1e-9);
  check('bi-elliptic is not flagged for Mars (ratio 1.5)', by('bielliptic').beatsHohmann === false);
  check('the plane change costs more than the coplanar Hohmann transfer', by('planechange').dv > by('hohmann').dv);
  const em2 = J.applyOption(em, 0, by('porkchop')), s2 = J.solveJourney(em2);
  check('choosing the porkchop optimum re-times the leg to it', near(s2.legs[0].depMs, by('porkchop').depMs, 1) && near(s2.legs[0].depDv + s2.legs[0].arrDv, by('porkchop').dv, 1e-6));
  const far = J.legOptions({ start: { body: 'earth', kind: 'orbit', altKm: 629, dateMs: D('2026-12-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'earth', kind: 'orbit', altKm: 98629, dateMs: D('2026-12-01T00:00:00Z') }] }, 0);
  check('bi-elliptic flagged where it beats Hohmann (Earth orbits 7,000 to 105,000 km)', far.options.find((x) => x.type === 'bielliptic').beatsHohmann === true);
  // The planets' moons (moons.js): a planet's orbit to its moon, and one
  // moon to another, about Jupiter.
  const jov = J.solveJourney({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2030-01-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'jupiter', kind: 'orbit', altKm: 500000, stayDays: 10, dateMs: D('2032-09-01T00:00:00Z') },
    { id: 2, body: 'europa', kind: 'orbit', altKm: 200, stayDays: 5, dateMs: D('2032-09-14T00:00:00Z') },
    { id: 3, body: 'ganymede', kind: 'orbit', altKm: 200, dateMs: D('2032-09-22T00:00:00Z') }] });
  console.log(`  Jupiter orbit to Europa, then Ganymede: ${jov.legs.slice(1).map((l) => `${l.geometry} about ${l.central}, ${(l.depDv + l.arrDv).toFixed(3)} km/s`).join('; ')}`);
  check('Jupiter\'s moons as waypoints: legs about Jupiter, from its orbit and between its moons', jov.ok && jov.legs[1].geometry === 'fromCentral' && jov.legs[2].geometry === 'between' && jov.legs.slice(1).every((l) => l.central === 'jupiter'));
  const eu = J.relState('europa', 'jupiter', D('2032-09-14T00:00:00Z'));
  check('Europa about Jupiter: at its distance and speed (671,000 km, 13.7 km/s)', Math.abs(norm(eu.r) / 671100 - 1) < 0.01 && Math.abs(norm(eu.v) / 13.74 - 1) < 0.02);
  const sb = J.solveJourney({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2027-01-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'sb:433', kind: 'orbit', altKm: 20, dateMs: D('2027-09-01T00:00:00Z') }] });
  check('a small body as a waypoint (433 Eros): solved, its capture a rendezvous', sb.ok && rel(sb.legs[0].arrDv, norm(sb.legs[0].vinfArr)) < 1e-3);
}

header('CASE 5: journeys flown by the n-body kernel');
{
  // The capture burn (landing.js designCapture, planCapture), two-body: from
  // the periapsis of a 2,026 m/s capture 400 km over Mars at 20 m/s^2.
  // Impulsive, it is vp - sqrt(mu / rp) (Curtis Eq. 8.58); held retrograde
  // from the periapsis for its 101 s it ends eccentric; steered in two
  // halves it ends circular, never below the periapsis (no braking before
  // it lowers the path).
  {
    const mu = J.bodyInfo('mars').mu, R = J.bodyInfo('mars').radius, rp = R + 400, vc = Math.sqrt(mu / rp), vp = vc + 2.026, r = [rp, 0, 0], v = [0, vp, 0];
    const quick = LD.designCapture({ r, v, mu, R, rc: rp, accel: 2, dt: 0.001 });
    console.log(`  at 2 km/s^2 (1 s): ${(quick.dv * 1000).toFixed(2)} m/s against the impulse ${(quick.impulsive * 1000).toFixed(2)}`);
    check('a near-impulsive capture costs Curtis Eq. 8.58\'s vp - sqrt(mu / rp), to 0.01 %', rel(quick.dv, vp - vc) < 1e-4 && near(quick.impulsive, vp - vc, 1e-12));
    const st = LD.designCapture({ r, v, mu, R, rc: rp, accel: 0.02 }), pc = LD.planCapture({ r, v, mu, R, rc: rp, accel: 0.02 });
    let x = { r, v }; for (let t = 0; t < 101.3; t += 0.1) { const h = Math.min(0.1, 101.3 - t), rn = Math.hypot(...x.r), vn = Math.hypot(...x.v), a = x.r.map((q, i) => -mu * q / rn ** 3 - 0.02 * x.v[i] / vn); x = { r: x.r.map((q, i) => q + h * x.v[i] + 0.5 * h * h * a[i]), v: x.v.map((q, i) => q + h * a[i]) }; }
    const rr = Math.hypot(...x.r), v2 = x.v.reduce((q, y) => q + y * y, 0), rv = x.r.reduce((q, y, i) => q + y * x.v[i], 0), eRetro = Math.hypot(...x.r.map((q, i) => ((v2 - mu / rr) * q - rv * x.v[i]) / mu));
    console.log(`  held retrograde from the periapsis: e ${eRetro.toFixed(3)}; steered into ${rp.toFixed(1)} km: ${(st.dv * 1000).toFixed(1)} m/s, pitch ${st.pitch.map((q) => (q / deg).toFixed(1)).join(' then ')} deg, e ${st.e.toExponential(1)}, lowest ${(st.rMin - rp).toFixed(2)} km; the cheapest way in (planCapture): into ${pc.rs.toFixed(1)} km for ${(pc.dv * 1000).toFixed(1)}, Hohmann ${(pc.hohmann.total * 1000).toFixed(2)}, ${(pc.total * 1000).toFixed(1)} m/s`);
    check('held retrograde from the periapsis, the orbit ends eccentric (e over 0.03); steered, circular at the radius (e under 1e-6, a to 10 m), never more than 200 m below the periapsis, for under 1 % over the impulse', eRetro > 0.03 && st.e < 1e-6 && near(st.a, rp, 0.01) && st.rMin > rp - 0.2 && st.dv < 1.01 * (vp - vc));
    check('the cheapest way in: a circular orbit near the periapsis and the Hohmann transfer to it (Curtis 6.2), cheaper than holding the radius in the burn, under 0.6 % over the impulse', near(pc.total, pc.dv + X.hohmannCircular(mu, pc.rs, rp).total, 1e-12) && pc.total < st.dv && pc.total < 1.006 * (vp - vc));
  }
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const fly = (name, j) => {
    const f = flyJourney(sys, planFlight(J.solveJourney(j)));
    for (const a of f.arrivals) console.log(`  ${name}: ${J.bodyInfo(a.body).name} ${a.central ? `${a.missKm.toFixed(1)} km from the aimed point` : `closest ${a.closest.toFixed(0)} km from its centre, planned ${a.plannedRp.toFixed(0)}: ${a.missKm.toFixed(1)} km off`}`);
    for (const c of f.captures) console.log(`  ${name}: captured at ${J.bodyInfo(c.body).name} for ${(c.dv * 1000).toFixed(0)} m/s (impulsive ${(c.impulsive * 1000).toFixed(0)}), mean a ${c.a?.toFixed(1)} km for ${c.rc.toFixed(1)}, e ${c.e?.toFixed(4)}`);
    return f;
  };
  // Tolerances: a planet's periapsis within 20 km of plan; the Moon's, whose
  // approach Earth's pull bends, within 50 km; home to Earth within 10 km of
  // the aimed point. Patched conics are the plan, the kernel the truth: the
  // aimed corrections and the periapsis trims close the gap.
  const m = fly('Mariner 10', MARINER10);
  check('Mariner 10: Venus and Mercury periapses within 20 km of plan, no impact', !m.impact && m.arrivals.length === 2 && m.arrivals.every((a) => a.missKm < 20));
  const em = fly('Earth to Mars', { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z') }] });
  check('Earth to Mars: captured within 20 km of the planned periapsis, and stays up', !em.impact && em.arrivals[0].missKm < 20);
  const fr = fly('Free return', { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-12-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'moon', kind: 'flyby', altKm: 250, dateMs: D('2026-12-05T00:00:00Z') }, { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D('2026-12-09T00:00:00Z') }] });
  check('round the Moon and home: the flyby within 50 km, home within 10 km', fr.arrivals[0].missKm < 50 && fr.arrivals[1].missKm < 10);
  const mt = fly('Moon and back', MOON_TRIP);
  check('Earth orbit, Moon orbit for 3 days, home: the Moon within 50 km, home within 10 km, no impact on the way', mt.arrivals[0].missKm < 50 && mt.arrivals[1].missKm < 10 && (!mt.impact || mt.impact.body === 'earth'));
  // A year in Mars orbit, then home: Mars's J2 turns the parking orbit's
  // plane (about 10 degrees a day at 400 km), so the departure waits for it
  // to hold the way out, re-solving that way for the later date.
  const rt = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'mars', kind: 'orbit', altKm: 400, stayDays: 364, dateMs: D('2027-09-07T00:00:00Z') },
    { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D('2029-08-10T00:00:00Z') }] };
  const rts = J.solveJourney(rt), rtf = fly('Mars and back', rt);
  const dep = rtf.log.find((l) => l.startsWith('depart mars'));
  console.log(`  Mars and back: ${dep}; corrections ${(rtf.correctionsDv * 1000).toFixed(0)} m/s (the plan's leave-Mars burn ${(rts.legs[1].depDv * 1000).toFixed(0)} m/s)`);
  check('a year at Mars, then home: Mars within 20 km, Earth within 50 km, corrections under 250 m/s', rtf.arrivals[0].missKm < 20 && rtf.arrivals[1].missKm < 50 && rtf.correctionsDv < 0.25);
  // The capture ends circular at the planned radius, as the plan prices it
  // (journeyFlight.js: steered, then a Hohmann transfer on the mean radius),
  // within 1.5 % of the impulse; held retrograde it left e 0.046, and the
  // departure a year on cost 3.8 % over the plan.
  const cap = rtf.captures[0];
  check('the capture at Mars: e under 0.005 over the orbit, the mean radius within 1 km of the planned 3,790, for within 1.5 % of the impulse', cap && cap.e < 0.005 && Math.abs(cap.a - cap.rc) < 1 && cap.dv < 1.015 * cap.impulsive);
  check('and the departure from the turned orbit within 2 % of the plan\'s burn in the plane', (() => { const m = /mars: (\d+) m\/s/.exec(dep ?? ''); return m && Number(m[1]) < 1.02 * rts.legs[1].plane.inPlaneDv * 1000; })());
  // The plan prices the plane (journey.js planeAt; docs/physics/journey.md#the-parking-orbits-plane):
  // on the planned day, out of the plane; and what the flight does, waiting
  // for it (planeOption's flight), against what it flew. The capture leaves
  // the orbit circular at the planned mean radius, the plan's trial orbit is
  // at that mean radius too, and the trims at the approach aim the node for
  // the planned day (the plane through the kernel's way in and the way out
  // was 0.5 degrees steeper than the plan's, its node 0.3 % faster, 11
  // degrees over the year, and these were 3.5 % and 4.3 %). Tolerances: the
  // node aimed to 0.01 degree for under 1 m/s; the wait within half a day
  // and its burn within 1 %; the planned day's burn within 1 %.
  const pl = rts.legs[1].plane, po = J.planeOption(rt, 1, { sol: rts });
  const flown = /mars: (\d+) m\/s, ([\d.]+) h after the planned time(?: \((\d+) m\/s on the planned day\))?/.exec(dep ?? '');
  const flownDv = Number(flown?.[1]) / 1000, flownWait = Number(flown?.[2]) / 24, flownOnDay = Number(flown?.[3]) / 1000;
  const trims = rtf.log.filter((l) => l.startsWith('trim at mars')), trimDv = trims.reduce((q, l) => q + Number(/: ([\d.]+) m\/s/.exec(l)[1]), 0) / 1000;
  const nodeOff = Number(/node on the planned day [-\d.]+ to ([-\d.]+) deg/.exec(trims.at(-1) ?? '')?.[1] ?? NaN);
  console.log(`  the trims at Mars: ${(trimDv * 1000).toFixed(2)} m/s, the node on the planned day ${nodeOff.toFixed(3)} deg off the plan's`);
  check('the trims at Mars aim the node for the planned day: within 0.01 deg of the plan\'s, for under 1 m/s', Math.abs(nodeOff) < 0.01 && trimDv < 0.001);
  console.log(`  the plan: on the planned day the plane ${pl.angleDeg.toFixed(1)} deg off the way out (i ${pl.iDeg.toFixed(1)} deg, node ${pl.rateDegDay.toFixed(3)} deg/d, eq. (4.52) ${pl.firstOrderDegDay.toFixed(3)}), ${(pl.dv * 1000).toFixed(0)} m/s for ${(pl.inPlaneDv * 1000).toFixed(0)} in the plane; flown ${(flownOnDay * 1000).toFixed(0)}`);
  console.log(`  the flight's wait: planned ${po.flight.waitDays.toFixed(2)} d, ${(po.flight.dv * 1000).toFixed(0)} m/s; flown ${flownWait.toFixed(2)} d, ${(flownDv * 1000).toFixed(0)} m/s (within half a day and 1 %)`);
  check('the plan prices the year\'s turn of the plane: the planned day dear by more than 500 m/s, its burn within 1 % of the flight\'s on that day', !pl.aimed && pl.extraDv > 0.5 && rel(pl.dv, flownOnDay) < 0.01);
  check('and the flight\'s wait for the plane as the plan has it: the day within half a day, the burn within 1 %', Math.abs(po.flight.waitDays - flownWait) < 0.5 && rel(po.flight.dv, flownDv) < 0.01);
  // The day the plan suggests, flown: it leaves on time, for what the plan
  // prices (within 1 %; before the node was aimed, 4.3 %).
  const rt2 = J.applyOption(rt, 1, po), rts2 = J.solveJourney(rt2), rtf2 = flyJourney(sys, planFlight(rts2));
  const dep2 = rtf2.log.find((l) => l.startsWith('depart mars')), m2 = /mars: (\d+) m\/s, ([\d.]+) h after/.exec(dep2 ?? '');
  console.log(`  re-timed ${po.waitDays} d (a ${rt2.waypoints[0].stayDays.toFixed(1)} d stay): the plan ${(rts2.legs[1].depDv * 1000).toFixed(0)} m/s, the plane ${rts2.legs[1].plane.angleDeg.toFixed(1)} deg off; flown ${dep2}`);
  check('leaving on the plan\'s day for the plane: the flight leaves within a day of it, its burn within 1 % of the plan\'s, and both arrivals reached', m2 && Number(m2[2]) < 24 && rel(Number(m2[1]) / 1000, rts2.legs[1].depDv) < 0.01 && rtf2.arrivals[0].missKm < 20 && rtf2.arrivals[1].missKm < 50);
}

header('CASE 6: shaping a journey by hand: burn nodes and an aimed flyby');
{
  const em = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z') }] };
  const base = J.solveJourney(em), mid = (em.start.dateMs + em.waypoints[0].dateMs) / 2;
  const withNode = (n) => ({ ...em, waypoints: [{ ...em.waypoints[0], nodes: [{ id: 7, ms: mid, pro: 0, nor: 0, rad: 0, ...n }] }] });
  const zero = J.solveJourney(withNode({}));
  check('a node with no burn leaves the leg as Lambert\'s arc: on target to 1 m, the same delta-v', zero.legs[0].missKm < 1e-3 && Math.abs(zero.totalDv - base.totalDv) < 1e-9 && zero.legs[0].reaches);
  const F = J.nodeFrame([1.2e8, 3e7, 1e5], [-5, 28, 0.4]), d = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  check('a node\'s frame: prograde, normal and radial unit and square to each other, radial outward', [F.T, F.N, F.R].every((x) => Math.abs(norm(x) - 1) < 1e-12) && Math.abs(d(F.T, F.N)) < 1e-12 && Math.abs(d(F.T, F.R)) < 1e-12 && d(F.R, [1.2e8, 3e7, 1e5]) > 0);
  const pushed = J.solveJourney(withNode({ pro: 0.2 }));
  console.log(`  a 200 m/s prograde node halfway: misses Mars by ${(pushed.legs[0].missKm / 1e6).toFixed(2)} million km`);
  check('a prograde push at a node misses the target, and its burn is counted', !pushed.legs[0].reaches && pushed.legs[0].missKm > 1e5 && pushed.burns.some((b) => b.kind === 'node' && Math.abs(b.dv - 0.2) < 1e-12));
  const fixed = J.solveJourney(J.aimNode(withNode({ pro: 0.2 }), 0, 7));
  check('aiming the node (Lambert from its place) brings the leg back to Mars to 1 m', fixed.legs[0].missKm < 1e-3 && Math.abs(fixed.totalDv - base.totalDv) < 1e-6);
  const raised = J.solveJourney(J.aimNode(withNode({ nor: 0.5 }), 0, 7));
  check('aiming a node with a sideways burn keeps the leg on target', raised.legs[0].missKm < 1e-3);
  // The flyby's aim set by hand to the planner's own B-plane point: the same
  // pass, now unpowered, and the next leg flown free from it.
  const s0 = J.solveJourney(MARINER10), f0 = s0.flybys[0];
  const s1 = J.solveJourney({ ...MARINER10, waypoints: [{ ...MARINER10.waypoints[0], aim: { bT: f0.bT, bR: f0.bR } }, MARINER10.waypoints[1]] });
  console.log(`  Mariner 10, Venus aimed by hand at the planner's point: periapsis ${s1.flybys[0].rp.toFixed(1)} km (planned ${f0.rp.toFixed(1)}), Mercury missed by ${(s1.legs[1].missKm / 1000).toFixed(0)} thousand km without the ${(f0.dv * 1000).toFixed(0)} m/s`);
  check('a flyby aimed by hand at the planned B-plane point passes at the planned periapsis, unpowered', s1.flybys[0].byHand && Math.abs(s1.flybys[0].rp - f0.rp) < 1 && s1.flybys[0].dv === 0 && s1.legs[1].shaped);
  check('and the leg after it is flown from it: the planned 29 m/s left out shows as a miss at Mercury', s1.legs[1].missKm > 1e4 && s1.legs[1].missKm < 1e6);
  // A node and an aimed flyby, flown by the kernel: the node as planned,
  // the aims after it still reach the waypoint.
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const fl = flyJourney(sys, planFlight(J.solveJourney(J.aimNode(withNode({ pro: 0.05, rad: 0.03 }), 0, 7))));
  console.log(`  Earth to Mars with an aimed node, flown: ${fl.arrivals[0].missKm.toFixed(1)} km off the planned periapsis, corrections ${(fl.correctionsDv * 1000).toFixed(1)} m/s`);
  check('a leg with a burn node, flown by the kernel: the node flown, Mars within 20 km of plan', !fl.impact && fl.arrivals[0].missKm < 20 && fl.burns.length >= 3);
}

header('CASE 7: can it be flown, and when: window profiles and the lamps');
{
  // Mars and back: arrive 7 Sep 2027, leave 30 days later.
  const rt = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'mars', kind: 'orbit', altKm: 400, stayDays: 30, dateMs: D('2027-09-07T00:00:00Z') },
    { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D('2028-08-10T00:00:00Z') }] };
  const sol = J.solveJourney(rt);
  const p1 = F.legProfile(rt, 1, { sol });
  const waitD = (p1.best.ms - sol.stops[1].arrMs) / DAY_MS;
  console.log(`  leave Mars: from ${new Date(p1.fromMs).toISOString().slice(0, 10)}, best ${new Date(p1.best.ms).toISOString().slice(0, 10)} (${waitD.toFixed(0)} d after arriving) at ${p1.best.dv.toFixed(2)} km/s; ${p1.points.length} dates`);
  check('the return window: about a year after arriving (Curtis Ex 8.2 waits 454 d on circular orbits), near 2 km/s', waitD > 300 && waitD < 460 && p1.best.dv < 2.5);
  check('each date\'s profile point is a real leg: its delta-v matches the leg solved at that date and flight time, with its parking orbit\'s plane', (() => { const q = p1.points[5], L = J.solveLeg(sol.stops[1], sol.stops[2], q.ms, q.ms + q.tofDays * DAY_MS); return Math.abs(L.depDv + L.arrDv + J.planePricer(sol, 1)(L) - q.dv) < 1e-9; })());
  const lamps = F.assess(rt, sol, { budget: 8, profiles: [F.legProfile(rt, 0, { sol }), p1] });
  const lamp = (k) => lamps.find((x) => x.key === k);
  console.log(`  lamps leaving after 30 days: ${lamps.map((x) => `${x.key}=${x.level}`).join(', ')}; ${lamp('window')?.text}`);
  check('leaving Mars after 30 days lights the window lamp, pointing at the return window', lamp('window')?.level === 'caution' && lamp('window').leg === 1 && Math.abs(lamp('window').bestMs - p1.best.ms) < 1);
  check('and the delta-v lamp: over an 8 km/s budget', lamp('dv')?.level === 'warn');
  const tight = F.assess(rt, sol, { budget: 5, profiles: [p1] });
  check('with 5 km/s, no date home fits after the outbound legs: the no-window lamp', tight.some((x) => x.key === 'nowindow' && x.level === 'warn'));
  // At the window: the lamps go out or green.
  const atWin = { ...rt, waypoints: [{ ...rt.waypoints[0], stayDays: (p1.best.ms - sol.stops[1].arrMs) / DAY_MS }, { ...rt.waypoints[1], dateMs: p1.best.ms + p1.best.tofDays * DAY_MS }] };
  const s2 = J.solveJourney(atWin), l2 = F.assess(atWin, s2, { budget: 8, profiles: [F.legProfile(atWin, 1, { sol: s2 })] });
  console.log(`  at the window: total ${s2.totalDv.toFixed(2)} km/s; ${l2.map((x) => `${x.key}=${x.level}`).join(', ')}`);
  check('leaving at the window: window and delta-v lamps green, the year at Mars shown as a wait', l2.find((x) => x.key === 'window')?.level === 'go' && l2.find((x) => x.key === 'dv')?.level === 'go' && l2.find((x) => x.key === 'wait')?.level === 'caution');
  check('a leg after a flyby has no profile (its departure is fixed)', F.legProfile(MARINER10, 1) === null);
}

header('CASE 8: resonant returns to the same body (Galileo, 1989-95)');
{
  // The cone: 2:1 at 8.9 km/s about a circular 1 AU orbit.
  const muS = 1.32712440041e11, r = 1.496e8, vb = Math.sqrt(muS / r), TB = 2 * Math.PI * Math.sqrt(r ** 3 / muS);
  const c = X.resonantCone({ r, vB: [0, vb, 0], mu: muS, vinf: 8.9, N: 2, M: 1, TB });
  console.log(`  2:1 cone at 8.9 km/s: a ${(c.a / r).toFixed(4)} AU (2^(2/3) = 1.5874), half-angle ${(c.theta / deg).toFixed(2)} deg, back in ${(c.tof / DAY).toFixed(1)} d`);
  check('the 2:1 orbit\'s size is 2^(2/3) of the body\'s, its return two of the body\'s years', Math.abs(c.a / r - 2 ** (2 / 3)) < 1e-9 && Math.abs(c.tof - 2 * TB) < 1e-6);
  let onCone = true, back = true;
  for (const phi of [0, 1, 2.5, 4, 5.5]) {
    const v = X.resonantVinf({ rB: [r, 0, 0], vB: [0, vb, 0], vinf: 8.9, theta: c.theta, phi });
    onCone &&= Math.abs(norm(v) - 8.9) < 1e-9 && Math.abs(Math.acos(v[1] / 8.9) - c.theta) < 1e-9;
    const end = propagate([r, 0, 0], [v[0], vb + v[1], v[2]], c.tof, muS);
    back &&= norm([end.r[0] - r, end.r[1], end.r[2]]) < 1e-3;
  }
  check('every clock angle\'s excess velocity lies on the cone, and comes back to the same point in two years (two-body)', onCone && back);

  // Galileo's route, on NASA's dates (PDS mission catalogue; NASA Galileo
  // page): launch 18 Oct 1989; Venus 10 Feb 1990 at 16,123 km; Earth 8 Dec
  // 1990 at 960 km and 8 Dec 1992 at 303 km; Jupiter 7 Dec 1995.
  const G = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('1989-10-18T16:53:00Z') }, waypoints: [
    { id: 1, body: 'venus', kind: 'flyby', altKm: 16123, dateMs: D('1990-02-10T05:58:48Z') },
    { id: 2, body: 'earth', kind: 'flyby', altKm: 960, dateMs: D('1990-12-08T20:34:34Z') },
    { id: 3, body: 'earth', kind: 'flyby', altKm: 303, dateMs: D('1992-12-08T12:00:00Z') },
    { id: 4, body: 'jupiter', kind: 'orbit', altKm: 200000, dateMs: D('1995-12-07T12:00:00Z') }] };
  const g = J.solveJourney(G), R = g.legs[2];
  console.log(`  Galileo: Earth to Earth resonant ${R.resonance.N}:${R.resonance.M}, ${new Date(R.depMs).toISOString().slice(0, 16)} to ${new Date(R.arrMs).toISOString().slice(0, 16)} (${R.tofDays.toFixed(1)} d), v_inf ${norm(R.vinfDep).toFixed(3)} out, ${norm(R.vinfArr).toFixed(3)} back; flybys ${g.flybys.map((f) => f && `${J.bodyInfo(f.body).name} ${(f.dv * 1000).toFixed(0)}`).filter(Boolean).join(', ')} m/s`);
  check('the resonance chosen is 2:1, as Galileo flew, and the return falls within a day of 8 Dec 1992', R.resonance.N === 2 && R.resonance.M === 1 && Math.abs(R.arrMs - D('1992-12-08T12:00:00Z')) < DAY_MS);
  check('it leaves and returns with the same excess speed (1 %), the craft back within 20,000 km of the Earth (two-body)', rel(norm(R.vinfArr), norm(R.vinfDep)) < 0.01 && R.resonance.missKm < 20000);
  check('both Earth flybys nearly free, under 150 m/s each (Lambert between the dates needs kilometres a second)', g.flybys[1].dv < 0.15 && g.flybys[2].dv < 0.15);
  const old = J.solveLeg(g.stops[2], { ...g.stops[3], kind: 'orbit' }, R.depMs, R.arrMs, { maxRevs: 2 });
  console.log(`  (Lambert between the same two dates: v_inf ${norm(old.vinfDep).toFixed(2)} km/s, in the ecliptic, against the 8.9 the flyby brings)`);
  const opts = J.legOptions(G, 2).options.filter((o) => o.type === 'resonance');
  check('the leg\'s options list the resonances, the cheapest being 2:1', opts.length > 3 && opts.reduce((a, b) => (b.dv < a.dv ? b : a)).resonance.join(':') === '2:1');
  // Flown by the kernel: every waypoint reached.
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const f = flyJourney(sys, planFlight(g));
  for (const a of f.arrivals) console.log(`  Galileo flown: ${J.bodyInfo(a.body).name} closest ${a.closest.toFixed(0)} km, planned ${a.plannedRp.toFixed(0)}: ${a.missKm.toFixed(1)} km off`);
  console.log(`  corrections ${(f.correctionsDv * 1000).toFixed(0)} m/s over six years`);
  check('Galileo flown: Venus and both Earth flybys within 20 km of plan, Jupiter within 2 %, no impact', !f.impact && f.arrivals.length === 4 && f.arrivals.slice(0, 3).every((a) => a.missKm < 20) && f.arrivals[3].missKm < 0.02 * f.arrivals[3].plannedRp);
  check('and its corrections under a tenth of the plan\'s delta-v', f.correctionsDv < 0.1 * g.totalDv);
}

header('CASE 9: landings, flown: down to the Moon, a stay, up and home; and a moon left for a planet');
{
  // The pieces, against closed forms. A descent orbit from 100 km down to
  // 15 km over the Moon is the first burn of a Hohmann transfer between the
  // two (Curtis Eq. 6.2 by vis-viva).
  const muM = J.bodyInfo('moon').mu, RM = J.bodyInfo('moon').radius, r0 = RM + 100, rp = RM + 15;
  check('the descent orbit burn is a Hohmann transfer\'s first burn, down to 15 km', near(LD.deorbitDv(muM, r0, rp), X.hohmannCircular(muM, r0, rp).dv1, 1e-12));
  // The entry: the drag-free hyperbola with that periapsis crosses the
  // surface at the chosen angle (h = R v_R cos gamma, energy kept).
  const muE = J.bodyInfo('mars').mu, RE = J.bodyInfo('mars').radius, vinf = 3;
  const rpE = LD.entryPeriapsis({ mu: muE, R: RE, vinf, gammaDeg: 12 }), e = 1 + rpE * vinf * vinf / muE;
  const hE = Math.sqrt(muE * rpE * (1 + e)), vR = Math.sqrt(vinf * vinf + 2 * muE / RE);
  check('an entry periapsis: the hyperbola through it meets the ground 12 degrees below the horizontal', near(Math.acos(hE / (RE * vR)) / deg, 12, 1e-9) && rpE < RE);
  // Braking from the descent orbit's periapsis, two-body: it stops where
  // asked, and costs more than the speed it takes off (gravity losses).
  const a = (r0 + rp) / 2, vp = Math.sqrt(muM * (2 / rp - 1 / a));
  const br = LD.designBraking({ r: [rp, 0, 0], v: [0, vp, 0], mu: muM, R: RM, hEnd: 1.5 });
  console.log(`  braking from 15 km at ${(vp * 1000).toFixed(0)} m/s: ${(br.accel * 1000).toFixed(2)} m/s^2 for ${br.dur.toFixed(0)} s, ${(br.dv * 1000).toFixed(0)} m/s, stopped ${((norm(br.end.r) - RM) * 1000).toFixed(0)} m up`);
  check('the braking burn stops 1.5 km up (to 20 m), for more than the periapsis speed it takes off', near(norm(br.end.r) - RM, 1.5, 0.02) && br.dv > vp && br.dv < 1.1 * vp);
  const asc = LD.designAscent({ r: [RM, 0, 0], v: [0, 0, 0], mu: muM, R: RM, rOrbit: r0, normal: [0, 0, 1], accel: 5 * muM / RM / RM });
  console.log(`  ascent to 100 km: tilt ${(asc.kick / deg).toFixed(1)} deg, ${(asc.dv * 1000).toFixed(0)} m/s against the ideal ${(Math.sqrt(muM / r0) * 1000).toFixed(0)} (the orbit's speed)`);
  check('the ascent reaches the 100 km orbit (to 1 km) for under 10 % over its circular speed', asc && near(asc.apo, r0, 1) && asc.dv > Math.sqrt(muM / r0) && asc.dv < 1.1 * Math.sqrt(muM / r0));

  // Flown: Earth orbit, down to the Moon for three days, up, and home
  // through the air.
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const trip = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-12-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'moon', kind: 'land', altKm: 100, stayDays: 3, dateMs: D('2026-12-05T00:00:00Z') },
    { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D('2026-12-12T00:00:00Z') }] };
  const ts = J.solveJourney(trip), plan = planFlight(ts), f = flyJourney(sys, plan);
  const [down, home] = f.landings;
  for (const l of f.log.filter((x) => /^(landed|liftoff|entry|depart)/.test(x))) console.log(`  ${l}`);
  console.log(`  planned: ${ts.burns.map((b) => `${b.label} ${b.dv.toFixed(3)}`).join('; ')} km/s`);
  check('nothing left unflown: no unsupported notes for a Moon landing', plan.unsupported.length === 0);
  check('down on the Moon under 3 m/s across the ground, held there for the stay', down?.body === 'moon' && down.how === 'descent' && down.speed < 0.003 && down.until - down.t > 2.5 * DAY);
  check('the descent flown costs more than the plan\'s ideal (the orbit\'s speed), by under 15 %', (() => { const ideal = Math.sqrt(muM / (RM + 100)); return down.dv > ideal && down.dv < 1.15 * ideal; })());
  const site = f.path.filter((p) => p.t > down.t + DAY && p.t < down.until - DAY);
  check('on the ground the path follows the site: a steady distance from the Moon\'s centre', site.length > 3 && site.every((p) => near(norm(p.r.map((x, i) => x - sys.bodiesAt(p.t).find((b) => b.key === 'moon').r[i])), RM, 0.01)));
  check('up into orbit for under 10 % over its speed, then home: through the air at Earth, no impact', down.ascentDv < 1.1 * Math.sqrt(muM / (RM + 100)) && home?.body === 'earth' && home.how === 'entry' && !f.impact);
  check('the way home within 10 km of the aimed point, the entry perigee within 5 km of the planned 120 km', f.arrivals[1].missKm < 10 && near(home.entryKm, 120, 5));

  check('flown in the full model (the Moon\'s GRAIL field to degree 50, mascons and all; the Earth\'s field, drag and sunlight), with no trouble: no fallback to the bare model', f.model === 'full' && flightTrouble(plan, f).length === 0);

  // The same journey flown live by the app's Craft, in the full model as
  // the app now flies a journey (not bare): the planned burns and landings,
  // ten-minute frames through the kernel host. It comes down on the site
  // the headless flight landed on.
  const host = createKernelHost();
  const live = (burnsFrom, landingsFrom) => {
    const c = new Craft({ name: 'lander', r: plan.start.r, v: plan.start.v, t: kernelSeconds(new Date(plan.start.ms)), sys, ...JOURNEY_CRAFT });
    c.addPlanned(burnsFrom); c.addLandings(landingsFrom);
    const seen = { ground: false, up: false, site: null };
    for (let t = c.clockT + 600; t <= home.t + 3600 && !c.crashed; t += 600) {
      c.advanceClock(t);
      const req = c.buildRequest();
      if (req) c.applyResult(host.handle({ type: 'step', crafts: [req] }).crafts[0]);
      if (c.landed?.key === 'moon' && !seen.site) seen.site = [...c.landed.local];
      if (c.landed?.key === 'moon' && t > down.t + DAY && t < down.until - DAY) seen.ground = norm(c.displayState().r.map((x, i) => x - sys.bodiesAt(t).find((b) => b.key === 'moon').r[i])) < RM + 0.01;
      if (!c.landed && t > down.until + 2 * 3600 && t < down.until + 3 * 3600) seen.up = norm(c.kState.r.map((x, i) => x - sys.bodiesAt(c.kState.t).find((b) => b.key === 'moon').r[i])) > RM + 80;
    }
    return { c, seen };
  };
  const { c, seen } = live(f.burns, f.landings);
  const siteKm = seen.site ? norm(seen.site.map((x, i) => x / norm(seen.site) - down.local[i] / norm(down.local))) * RM : Infinity;
  console.log(`  flown live in the full model: ${c.log.filter((l) => /landed|lift off|impact/.test(l.text)).map((l) => l.text).join('; ')}; down ${(siteKm * 1000).toFixed(0)} m from the headless flight's site`);
  check('flown live by the Craft in the full model: down on the Moon within 100 m of the headless site and held, up into orbit after the stay, down at Earth, never crashed', !c.bare && siteKm < 0.1 && seen.ground && seen.up && c.landed?.key === 'earth' && !c.crashed);
  // As it was: burns worked out in the bare model, flown live with the
  // mascons on. The descent, flown open loop in a field it was not designed
  // in, does not come down on its site.
  const fb = flyJourney(sys, plan, { model: 'bare' }), old = live(fb.burns, fb.landings);
  const oldKm = old.seen.site ? norm(old.seen.site.map((x, i) => x / norm(old.seen.site) - fb.landings[0].local[i] / norm(fb.landings[0].local))) * RM : null;
  console.log(`  the bare model's burns flown live in the full one: ${old.c.log.filter((l) => /landed|lift off|impact|came down/.test(l.text)).map((l) => l.text).join('; ')}${oldKm !== null ? `; ${oldKm.toFixed(1)} km from its site` : ''}`);
  check('the bare model\'s burns, flown live with the mascons on, miss their site (a crash, or kilometres off): why the craft no longer flies bare', old.c.crashed || (oldKm !== null && oldKm > 1));

  // A planned landing is a landing only if the craft meets the ground
  // slowly: one falling onto the Moon at 1 km/s within the hour of a
  // planned touchdown crashes, and one still in orbit when the time comes
  // misses it and flies on.
  const T9 = kernelSeconds(new Date('2026-12-05T00:00:00Z')), M9 = sys.bodiesAt(T9).find((b) => b.key === 'moon'), vM9 = [0, 0, 0];
  M9.eph.velocity(T9, vM9);
  const up9 = [0.6, 0.8, 0], site9 = up9.map((x) => x * RM);
  const crafty = (r, v) => { const k = new Craft({ name: 'test', r, v, t: T9, sys, bare: true }); k.addLandings([{ body: 'moon', t: T9 + 60, local: site9, until: null, how: 'descent' }]); return k; };
  const runFrames = (k) => { for (let t = T9 + 60; t <= T9 + 1800; t += 60) { k.advanceClock(t); const q = k.buildRequest(); if (q) k.applyResult(host.handle({ type: 'step', crafts: [q] }).crafts[0]); } };
  const fast = crafty(M9.r.map((x, i) => x + up9[i] * (RM + 50)), vM9.map((x, i) => x - up9[i] * 1.0));
  runFrames(fast);
  console.log(`  falling on the Moon at 1 km/s: ${fast.log.filter((l) => /landing|landed|impact|came down/.test(l.text)).map((l) => l.text).join('; ')}`);
  check('a craft meeting the ground at 1 km/s near a planned touchdown is a crash, not a landing', fast.crashed && !fast.landed && !fast.splashed);
  const vc9 = Math.sqrt(muM / (RM + 100)), orbiter = crafty(M9.r.map((x, i) => x + up9[i] * (RM + 100)), vM9.map((x, i) => x + [-0.8, 0.6, 0][i] * vc9));
  runFrames(orbiter);
  check('one still in orbit when its landing comes misses it and flies on, neither landed nor crashed', !orbiter.landed && !orbiter.crashed && orbiter.log.some((l) => /missed/.test(l.text)));

  // A moon left for another planet: Earth orbit, a week in lunar orbit,
  // then Mars, its excess speed about the Earth turned into the Moon's.
  const mm = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-10-20T00:00:00Z') }, waypoints: [
    { id: 1, body: 'moon', kind: 'orbit', altKm: 100, stayDays: 7, dateMs: D('2026-10-24T00:00:00Z') },
    { id: 2, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z') }] };
  const ms = J.solveJourney(mm), mp = planFlight(ms), mf = flyJourney(sys, mp);
  const dep = mf.log.find((l) => l.startsWith('depart moon'));
  console.log(`  Moon orbit to Mars: ${dep}, the plan's ${(ms.legs[1].depDv * 1000).toFixed(0)}; Mars ${mf.arrivals[1].missKm.toFixed(1)} km off the planned periapsis, corrections ${(mf.correctionsDv * 1000).toFixed(0)} m/s`);
  check('leaving the Moon for Mars is flown (no unsupported note), Mars captured within 20 km of plan, no impact', mp.unsupported.length === 0 && mf.arrivals[1].missKm < 20 && !mf.impact);
  const flownDep = Number(/moon: (\d+) m\/s/.exec(dep ?? '')?.[1] ?? NaN) / 1000, best = ms.legs[1].moonDep;
  console.log(`  priced by where the Moon is: ${(ms.legs[1].depDv * 1000).toFixed(0)} m/s for ${best.speed.toFixed(3)} km/s about the Moon, its velocity ${best.angleDeg.toFixed(0)} deg off the way out (as if it moved the way out: ${(X.departureDv(best.bestSpeed, muM, RM + 100) * 1000).toFixed(0)} m/s); flown ${(flownDep * 1000).toFixed(0)}, ${(100 * (flownDep / ms.legs[1].depDv - 1)).toFixed(1)} % more`);
  check('leaving the Moon for Mars: the plan\'s price, by the Moon\'s real place and velocity, within 3 % of what the kernel flies in the full model', Math.abs(flownDep / ms.legs[1].depDv - 1) < 0.03);
  check('and the corrections under 250 m/s', mf.correctionsDv < 0.25);
}

header('CASE 10: leaving a moon by where it is: the phase, the strips and the best day');
{
  // The hyperbola about the planet from the moon's place: both velocities
  // that leave on a given excess velocity, against the asymptote of the
  // orbit they start (from its eccentricity vector), over random states.
  const asym = (r, v, mu) => {
    const rn = norm(r), v2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2, en = v2 / 2 - mu / rn, rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
    const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
    const ev = r.map((x, i) => ((v2 - mu / rn) * x - rv * v[i]) / mu), e = norm(ev), P = ev.map((x) => x / e);
    const Q0 = [h[1] * P[2] - h[2] * P[1], h[2] * P[0] - h[0] * P[2], h[0] * P[1] - h[1] * P[0]], Q = Q0.map((x) => x / norm(Q0)), th = Math.acos(-1 / e);
    return P.map((x, i) => (x * Math.cos(th) + Q[i] * Math.sin(th)) * Math.sqrt(2 * en));
  };
  let worst = 0, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < 500; i++) {
    const r = [rnd(), rnd(), rnd()].map((x) => x * 800000), w = [rnd(), rnd(), rnd()].map((x) => x * 8);
    for (const v of X.asymptoteVelocities(r, w, MU_E)) worst = Math.max(worst, norm(asym(r, v, MU_E).map((x, k) => x - w[k])) / norm(w));
  }
  console.log(`  asymptoteVelocities over 500 random states: worst ${worst.toExponential(1)} of the excess velocity`);
  check('the two hyperbolas from a point onto a given excess velocity leave along it (to 1e-9)', worst < 1e-9);

  // Earth orbit, a week in lunar orbit, then Mars: the price of leaving the
  // Moon by the day, over a month of stays (the leg's arrival held).
  const mm = (stay) => ({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-10-20T00:00:00Z') }, waypoints: [
    { id: 1, body: 'moon', kind: 'orbit', altKm: 100, stayDays: stay, dateMs: D('2026-10-24T00:00:00Z') },
    { id: 2, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z') }] });
  const j7 = mm(7), s7 = J.solveJourney(j7);
  const p = F.legProfile(j7, 1, { sol: s7 }), month = p.points.slice(0, 35).map((q) => q.dv);
  const lowest = (a, b) => { let k = a; for (let i = a; i < b; i++) if (month[i] < month[k]) k = i; return k; };
  const mins = [lowest(0, 15), lowest(15, 35)];
  console.log(`  the strip leaving the Moon, a day a step: ${month.slice(0, 32).map((x) => x.toFixed(2)).join(' ')} km/s; lowest on days ${mins.join(' and ')}`);
  check('the window strip shows the Moon\'s phase: a point a day, the price swinging by more than 1 km/s over a month, its lows a month apart', p.stepDays === 1 && Math.max(...month) - Math.min(...month) > 1 && mins[1] - mins[0] >= 25 && mins[1] - mins[0] <= 32);
  const o = J.phaseOption(j7, 1, { sol: s7 }), asIs = s7.legs[1].depDv + s7.legs[1].arrDv;
  console.log(`  best day in the stay: ${new Date(o.depMs).toISOString().slice(0, 16)}, ${o.dv.toFixed(3)} km/s for the leg against ${asIs.toFixed(3)} as scheduled (${o.note})`);
  check('the planner suggests the best day in the stay: within it, cheaper than leaving as scheduled by over 0.5 km/s, listed with the leg\'s options', o.depMs >= s7.stops[1].arrMs && o.depMs <= s7.stops[1].depMs && asIs - o.dv > 0.5 && J.legOptions(j7, 1).options.some((x) => x.type === 'phase'));
  const lamps = F.assess(j7, s7, { profiles: [null, p] });
  check('and the phase lamp says so', lamps.some((l) => l.key === 'phase' && l.level === 'caution' && Math.abs(l.bestMs - o.depMs) < 1));
  // Taking it: the journey re-timed to that day, priced, and flown.
  const jb = J.applyOption(j7, 1, o), sb = J.solveJourney(jb), pb = planFlight(sb);
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), fb = flyJourney(sys, pb);
  const depB = Number(/moon: (\d+) m\/s/.exec(fb.log.find((l) => l.startsWith('depart moon')) ?? '')?.[1] ?? NaN) / 1000;
  console.log(`  leaving on that day: planned ${(sb.legs[1].depDv * 1000).toFixed(0)} m/s, flown ${(depB * 1000).toFixed(0)}; Mars ${fb.arrivals[1].missKm.toFixed(1)} km off, corrections ${(fb.correctionsDv * 1000).toFixed(0)} m/s`);
  check('flown on the suggested day: the departure within 3 % of its price, Mars within 20 km of plan', Math.abs(depB / sb.legs[1].depDv - 1) < 0.03 && fb.arrivals[1].missKm < 20 && !fb.impact);
  // A hyperbola that would swing in close past the Earth is not taken: the
  // flight does not aim that pass.
  // Ten days in: the hyperbola nearer the Moon's velocity dives to a
  // perigee inside the Earth on its way out; the other is taken.
  const L10 = J.solveJourney(mm(10)).legs[1], m10 = J.relState('moon', 'earth', L10.depMs), muE = J.bodyInfo('earth').mu;
  const any = X.moonExcess({ rm: m10.r, vm: m10.v, vinf: L10.vinfDep, mu: muE }), kept = X.moonExcess({ rm: m10.r, vm: m10.v, vinf: L10.vinfDep, mu: muE, rMin: 0.5 * norm(m10.r) });
  console.log(`  ten days in: the nearer hyperbola ${any.speed.toFixed(3)} km/s about the Moon, perigee ${any.rp.toFixed(0)} km; taken instead ${kept.speed.toFixed(3)} km/s, perigee behind it at ${kept.rp.toFixed(0)} km`);
  check('a way out that swings in past the planet (falling inward, periapsis under half the moon\'s distance) is not taken while another is', any.rp < J.bodyInfo('earth').radius && !kept.swingby && kept.speed > any.speed && Math.abs(L10.moonDep.speed - kept.speed) < 1e-12);
}

header('CASE 12: reaching a moon via its planet: Mars orbit to the Moon, flown');
{
  // Mars orbit to lunar orbit, and to a landing, on the leg's porkchop
  // optimum. The leg is solved about the Sun to the Earth; the flight aims
  // at the Moon itself, with the B-plane point from the excess velocity
  // about the Moon where it is on the day (journey.js moonArr). Aimed at the
  // Earth's centre plus the Moon's periapsis offset, as it was, the craft
  // hit the Earth.
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const toMoon = (kind) => {
    let j = { start: { body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2028-06-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'moon', kind, altKm: 100, stayDays: 3, dateMs: D('2029-02-06T00:00:00Z') }] };
    j = J.applyOption(j, 0, J.legOptions(j, 0).options.find((x) => x.type === 'porkchop'));
    const s = J.solveJourney(j), p = planFlight(s), f = flyJourney(sys, p);
    return { s, p, f };
  };
  const o = toMoon('orbit'), L = o.s.legs[0];
  const cap = Number(/capture at moon: (\d+) m\/s/.exec(o.f.log.join('\n'))?.[1] ?? NaN) / 1000;
  console.log(`  Mars ${new Date(L.depMs).toISOString().slice(0, 10)} to the Moon ${new Date(L.arrMs).toISOString().slice(0, 10)}: ${L.moonArr.speed.toFixed(3)} km/s about the Moon; Moon ${o.f.arrivals[0].missKm.toFixed(1)} km off the planned periapsis; capture ${(cap * 1000).toFixed(0)} m/s against the plan's ${(L.arrDv * 1000).toFixed(0)}; corrections ${(o.f.correctionsDv * 1000).toFixed(0)} m/s`);
  check('Mars orbit to lunar orbit, flown in the full model: aimed at the Moon, its periapsis within 20 km of plan, the capture within 5 % of its price, no trouble', o.p.events.filter((e) => e.kind === 'aim').every((e) => e.body === 'moon') && o.f.arrivals[0].missKm < 20 && Math.abs(cap / L.arrDv - 1) < 0.05 && flightTrouble(o.p, o.f).length === 0);
  // Landing: the long capture (2 km/s, against 0.8 from the Earth) leaves
  // the parking orbit eccentric, so the descent orbit burn is worked out
  // from the orbit the craft is in.
  const l = toMoon('land'), down = l.f.landings[0];
  console.log(`  and down on the Moon: ${l.f.log.find((x) => x.startsWith('landed')) ?? l.f.log.find((x) => x.startsWith('descent'))}`);
  check('Mars orbit to a Moon landing, flown: down under 3 m/s, no trouble', down?.body === 'moon' && down.speed < 0.003 && flightTrouble(l.p, l.f).length === 0);
}

header('CASE 11: the full model, or the bare one as a fallback');
{
  // flightTrouble: what keeps a flight from being taken in the full model.
  const plan = { events: [{ kind: 'land', body: 'moon', waypoint: 0 }] };
  const ok = flightTrouble(plan, { trouble: [], impact: null, landings: [{ waypoint: 0 }], arrivals: [{ body: 'moon', missKm: 3, plannedRp: 1838 }] });
  const bad = flightTrouble(plan, { trouble: ['the aim at Mars found no burn'], impact: { body: 'moon' }, landings: [], arrivals: [{ body: 'mars', missKm: 400, plannedRp: 3790 }] });
  console.log(`  trouble: ${bad.join('; ')}`);
  check('a flight with no trouble is taken in the full model; an aim with no burn, a crash, a landing not made and a 400 km miss are each reasons to fall back', ok.length === 0 && bad.length === 4);
}

header('CASE 12: near 180 degrees round the Sun, the broken plane (Abilleira 2007)');
{
  // Earth orbit, lunar orbit, then Mars arriving 20 Aug 2027: as the stay
  // at the Moon lengthens, the leg to Mars sweeps through 180 degrees round
  // the Sun. There a direct arc must tilt steeply to reach Mars out of the
  // ecliptic; a burn near halfway that breaks the plane keeps the transfer
  // low (Abilleira, ISSFD 2007, Sec. I and Figs. 1-2). The plane's turn is
  // a rotation of the horizontal velocity about the radius, 2 v_h sin(d/2)
  // (Curtis eq. (6.20), on the horizontal speed: transfers.js
  // planeChangeDv), and the turn that reaches a target an
  // angle phi on from the break at a height beta above the plane is
  // sin d = sin beta / sin phi (Napier's rules for the right spherical
  // triangle).
  const D = Date.parse, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], unit = (a) => a.map((x) => x / norm(a));
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const scale3 = (a, k) => a.map((x) => x * k);
  const mm = (stay, via) => ({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-10-20T00:00:00Z') }, waypoints: [
    { id: 1, body: 'moon', kind: 'orbit', altKm: 100, stayDays: stay, dateMs: D('2026-10-24T00:00:00Z') },
    { id: 2, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z'), ...(via ? { via } : {}) }] });
  const j23 = mm(23), s23 = J.solveJourney(j23), L = s23.legs[1], bp = L.brokenPlane;
  const dir = J.solveJourney(mm(23, 'direct')).legs[1];
  console.log(`  23 d at the Moon: ${bp.angleDeg.toFixed(2)} deg round the Sun; direct ${(dir.depDv + dir.arrDv).toFixed(2)} km/s on a plane tilted ${bp.directIncDeg.toFixed(1)} deg; broken plane ${(L.depDv + L.midDv + L.arrDv).toFixed(3)} km/s with ${(L.midDv * 1000).toFixed(1)} m/s at the break`);
  check('at 180.4 deg the direct arc tilts over 10 deg and costs over three times the broken plane, which the planner takes', Math.abs(bp.angleDeg - 180) < 1 && bp.directIncDeg > 10 && dir.depDv + dir.arrDv > 3 * (L.depDv + L.midDv + L.arrDv) && L.arcs.length === 2);
  const [a1, a2] = L.arcs, e = J.relState('earth', 'sun', L.depMs), m = J.relState('mars', 'sun', L.arrMs), nE = unit(cross(e.r, e.v));
  const tilt1 = Math.acos(Math.min(1, dot(nE, unit(cross(a1.r1, a1.v1))))) / deg;
  const B = propagate(a1.r1, a1.v1, (a1.t2 - a1.t1) / 1000, a1.mu), end = propagate(a2.r1, a2.v1, (a2.t2 - a2.t1) / 1000, a2.mu);
  const gapB = norm(sub(B.r, a2.r1)), gapM = norm(sub(end.r, m.r)), tau = (a1.t2 - a1.t1) / (a2.t2 - a1.t1);
  console.log(`  first arc ${tilt1.toExponential(1)} deg off the Earth's plane; the break at ${(100 * tau).toFixed(1)} % of the flight (${new Date(bp.ms).toISOString().slice(0, 10)}); two-body gaps at the break ${gapB.toExponential(1)} km and at Mars ${gapM.toExponential(1)} km`);
  check('the first arc lies in the Earth\'s orbit plane (to 1e-6 deg), the arcs join at the break and reach Mars (to 1 m, two-body), the break near halfway as Abilleira has it (40 to 60 %)', tilt1 < 1e-6 && gapB < 1e-3 && gapM < 1e-3 && tau > 0.4 && tau < 0.6);
  const vh = norm(sub(B.v, scale3(a2.r1, dot(B.v, a2.r1) / dot(a2.r1, a2.r1)))), turn = bp.turnDeg * deg, pure = X.planeChangeDv(vh, turn);
  const beta = Math.asin(dot(m.r, nE) / norm(m.r)), phi = Math.acos(dot(unit(a2.r1), unit(m.r))), napier = Math.asin(Math.sin(Math.abs(beta)) / Math.sin(phi));
  console.log(`  the break: ${(L.midDv * 1000).toFixed(3)} m/s against 2 v_h sin(d/2) = ${(pure * 1000).toFixed(3)} (v_h ${vh.toFixed(2)} km/s); the turn ${bp.turnDeg.toFixed(4)} deg, Mars ${(beta / deg).toFixed(4)} deg off the plane and ${(phi / deg).toFixed(2)} deg on: Napier ${(napier / deg).toFixed(4)} deg`);
  check('the burn at the break is the pure plane change (to 1e-3 of it), and its turn the one Napier\'s rule gives for Mars\'s height off the plane (to 1 %)', Math.abs(L.midDv / pure - 1) < 1e-3 && Math.abs(turn / napier - 1) < 0.01);

  // The price by the stay: the excess speed leaving the Earth's sphere
  // (the heliocentric part, before the Moon's phase is added) runs smoothly
  // through 180 degrees; the direct arc's leaps.
  const vd = [], vdDirect = [];
  for (let stay = 18; stay <= 30; stay++) { vd.push(norm(J.solveJourney(mm(stay)).legs[1].vinfDep)); vdDirect.push(norm(J.solveJourney(mm(stay, 'direct')).legs[1].vinfDep)); }
  // (Smooth: the change from one day's step to the next, the second
  // difference.)
  const bend = (a) => Math.max(...a.slice(2).map((x, i) => Math.abs(x - 2 * a[i + 1] + a[i])));
  console.log(`  excess speed from the Earth, stays of 18 to 30 d: ${vd.map((x) => x.toFixed(2)).join(' ')} km/s (largest second difference ${(bend(vd) * 1000).toFixed(1)} m/s); direct ${vdDirect.map((x) => x.toFixed(2)).join(' ')} (${(bend(vdDirect) * 1000).toFixed(0)} m/s)`);
  check('through 180 degrees the plan\'s excess speed runs smoothly (second difference under 20 m/s a day), where the direct arc\'s leaps by kilometres a second', bend(vd) < 0.02 && bend(vdDirect) > 1);

  // The lamp, the options, and the strip.
  const lamp = F.assess(j23, s23, {}).find((l) => l.key === 'plane'), lamp7 = F.assess(mm(7), J.solveJourney(mm(7)), {}).find((l) => l.key === 'plane');
  const opts = J.legOptions(j23, 1, { search: false }).options;
  console.log(`  the plane lamp: ${lamp?.text}; options ${opts.map((o) => `${o.name} ${o.dv.toFixed(2)}`).join(', ')}`);
  check('the plane lamp says the plane breaks, and when; none at 196 deg; the direct arc is listed for comparison and dearer', lamp?.level === 'caution' && Math.abs(lamp.bestMs - bp.ms) < 1 && !lamp7 && opts.find((o) => o.type === 'direct')?.dv > opts.find((o) => o.type === 'lambert').dv);

  // Flown in the full model, 20 days at the Moon (183.4 deg, where the
  // direct arc is 12 m/s cheaper on paper): the broken plane's corrections
  // are its planned break and the usual trims, the direct arc's the cost of
  // following a plane that will not hold.
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const s20 = J.solveJourney(mm(20)), f20 = flyJourney(sys, planFlight(s20)), d20 = flyJourney(sys, planFlight(J.solveJourney(mm(20, 'direct'))));
  console.log(`  20 d at the Moon, flown: broken plane ${(f20.correctionsDv * 1000).toFixed(0)} m/s of corrections (${(s20.legs[1].midDv * 1000).toFixed(0)} of them the planned break), Mars ${f20.arrivals[1].missKm.toFixed(1)} km off; direct ${(d20.correctionsDv * 1000).toFixed(0)} m/s, Mars ${d20.arrivals[1].missKm.toFixed(1)} km off`);
  check('inside 6 deg of 180 the planner takes the broken plane; flown, it corrects under 250 m/s and reaches Mars within 20 km, against over 500 m/s for the direct arc', !!s20.legs[1].brokenPlane && f20.correctionsDv < 0.25 && f20.arrivals[1].missKm < 20 && !f20.impact && d20.correctionsDv > 0.5);
}

header("CASE 13: the parking orbit's plane over a stay (Curtis Sec. 4.7)");
{
  // Curtis Ex. 4.8: a 280 by 400 km orbit at 51.43 deg: eq. (4.52) gives
  // -1.0465e-6 rad/s, 5.181 deg a day westward (J2 = 0.0010826, R = 6378 km).
  const w48 = PP.nodeRate(398600, 0.0010826, 6378, 6718, 0.008931, 51.43 * deg);
  console.log(`  Ex 4.8: node ${(w48 * 1e6).toFixed(4)}e-6 rad/s (-1.0465), ${(w48 * DAY / deg).toFixed(3)} deg/d (-5.181)`);
  check('Ex 4.8: the node regresses at -1.0465e-6 rad/s, 5.181 deg a day (to the book\'s last figure)', near(w48 * 1e6, -1.0465, 1e-4) && near(w48 * DAY / deg, -5.181, 5e-4));
  check('eq. (4.52): a retrograde orbit\'s node advances as fast, a polar orbit\'s stands', near(PP.nodeRate(398600, 0.0010826, 6378, 6718, 0, 128.57 * deg), -PP.nodeRate(398600, 0.0010826, 6378, 6718, 0, 51.43 * deg), 1e-18) && Math.abs(PP.nodeRate(398600, 0.0010826, 6378, 6718, 0, 90 * deg)) < 1e-20);

  // The burn from a circular orbit onto an asymptote: in the plane, the
  // tangential burn at the hyperbola's periapsis (Curtis eq. (8.42)); out of
  // it, more, no more than burning at the line of the planes' nodes with
  // the periapsis there (the dihedral angle t from sin d = sin t sin
  // theta_inf), and the same as a scan of 7,200 points round the orbit.
  const mu = J.bodyInfo('mars').mu, rp = J.bodyInfo('mars').radius + 400, vinf = 2.48, n = [0, 0, 1];
  const vc = Math.sqrt(mu / rp), vp = Math.sqrt(vinf ** 2 + 2 * mu / rp), thInf = Math.acos(-1 / X.hyperbolaEccentricity(rp, vinf, mu));
  const brute = (w) => { let b = Infinity; for (let i = 0; i < 7200; i++) { const f = (2 * Math.PI * i) / 7200, r = [rp * Math.cos(f), rp * Math.sin(f), 0], v = [-vc * Math.sin(f), vc * Math.cos(f), 0]; for (const v1 of X.asymptoteVelocities(r, w, mu)) b = Math.min(b, norm([v1[0] - v[0], v1[1] - v[1], v1[2] - v[2]])); } return b; };
  const rows = [0, 5, 15, 25, 45].map((d) => { const w = [vinf * Math.cos(d * deg), 0, vinf * Math.sin(d * deg)], x = PP.leaveCircularDv(n, rp, mu, w).dv, t = Math.asin(Math.sin(d * deg) / Math.sin(thInf)); return { d, x, bound: Math.sqrt(vp * vp + vc * vc - 2 * vp * vc * Math.cos(t)), brute: brute(w) }; });
  console.log(`  leaving 400 km over Mars at 2.48 km/s: ${rows.map((q) => `${q.d} deg ${(q.x * 1000).toFixed(1)} m/s (node bound ${(q.bound * 1000).toFixed(1)}, scan ${(q.brute * 1000).toFixed(1)})`).join('; ')}`);
  check('in the plane, the cheapest burn is Curtis eq. (8.42) to 1 mm/s', near(rows[0].x, X.departureDv(vinf, mu, rp), 1e-6));
  check('out of it: dearer with the angle, never over the node bound, and the 7,200-point scan to 0.1 m/s', rows.every((q, i) => (i === 0 || q.x > rows[i - 1].x) && q.x <= q.bound + 1e-9 && near(q.x, q.brute, 1e-4)));

  // The node's rate in the J2 field (flownNodeRate) against the kernel: a
  // circular orbit 400 km over Mars at 150.6 deg to its equator, flown ten
  // days. Eq. (4.52) is the mean orbit's rate, and the circular orbit at
  // 3,790 km is not quite it: the kernel's node turns 0.15 to 0.6 % faster,
  // as where the orbit starts. The rate flown in the field, within 0.25 %
  // of the kernel's (its start and end points carry the J2 terms within a
  // turn, about 0.1 %).
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS, keys: ['mars'] }), ms = D('2027-09-08T00:00:00Z'), t0 = kernelSeconds(new Date(ms));
  const Mars = (t) => { const b = sys.bodiesAt(t).find((x) => x.key === 'mars'), v = [0, 0, 0]; b.eph.velocity(t, v); return { r: b.r.slice(), v }; };
  const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], un = (a) => a.map((x) => x / norm(a)), dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pole = bodyAxesEqj('mars', new Date(ms))[2], e1 = un(cr(pole, [0, 0, 1])), e2 = cr(pole, e1), inc = 150.6 * deg, z = ZONAL.mars;
  const nodeOf = (r, v) => { const q = cr(pole, cr(r, v)); return Math.atan2(dt(q, e2), dt(q, e1)); };
  const res = [0, 90].map((u0) => {
    const q = e2.map((x, i) => Math.cos(inc) * x + Math.sin(inc) * pole[i]), c = Math.cos(u0 * deg), s = Math.sin(u0 * deg);
    const r = e1.map((x, i) => rp * (c * x + s * q[i])), v = e1.map((x, i) => vc * (-s * x + c * q[i])), M0 = Mars(t0);
    const st = stepCraft(sys, { id: 0, version: 0, r: r.map((x, i) => x + M0.r[i]), v: v.map((x, i) => x + M0.v[i]), t: t0, tEnd: t0 + 10 * DAY, primary: null, burns: [], maxSteps: 5e6 }), M1 = Mars(st.t);
    let d = nodeOf(st.r.map((x, i) => x - M1.r[i]), st.v.map((x, i) => x - M1.v[i])) - nodeOf(r, v);
    const first = PP.nodeRate(mu, z.j2, z.rJ2, rp, 0, inc), turns = Math.round((first * 10 * DAY - d) / (2 * Math.PI));
    d += 2 * Math.PI * turns;
    return { u0, kernel: d / (10 * DAY), first, flown: PP.flownNodeRate({ mu, j2: z.j2, R: z.rJ2, pole, r, v }).rate };
  });
  for (const q of res) console.log(`  from ${q.u0} deg past the node: kernel ${(q.kernel * DAY / deg).toFixed(4)} deg/d, eq. (4.52) ${(q.first * DAY / deg).toFixed(4)} (${((q.kernel / q.first - 1) * 100).toFixed(2)} % off), flown in the J2 field ${(q.flown * DAY / deg).toFixed(4)} (${((q.flown / q.kernel - 1) * 100).toFixed(2)} % off)`);
  check('eq. (4.52) within 1 % of the kernel\'s node 400 km over Mars; the rate flown in the J2 field within 0.25 %', res.every((q) => rel(q.first, q.kernel) < 0.01 && rel(q.flown, q.kernel) < 0.0025));
  // Started circular, the orbit's mean semi-major axis (the osculating one
  // averaged over its turns) is off the starting radius by J2's terms
  // within a turn, as where it starts, and so is its node's rate. Started
  // at the radius moved by that (journey.js planeContext, as the flight's
  // capture ends at the mean radius), the mean semi-major axis is the
  // planned one, and the rate depends far less on where the orbit starts.
  // What is left is the inclination's own term within a turn, as cos 2u
  // like the radius's: the starts at the node and 90 degrees past it,
  // tilted 0.03 degrees each way, give the rate from 45 degrees.
  const startAt = (u0, di = 0) => {
    const ii = inc + di * deg, q = e2.map((x, i) => Math.cos(ii) * x + Math.sin(ii) * pole[i]), c = Math.cos(u0 * deg), s = Math.sin(u0 * deg);
    const go = (r0) => PP.flownNodeRate({ mu, j2: z.j2, R: z.rJ2, pole, r: e1.map((x, i) => r0 * (c * x + s * q[i])), v: e1.map((x, i) => Math.sqrt(mu / r0) * (-s * x + c * q[i])) });
    const a = go(rp);
    let r0 = rp, b = a;
    for (let it = 0; it < 2; it++) { r0 -= b.aMean - rp; b = go(r0); }
    return { u0, osc: a, mean: b };
  };
  const atMean = [0, 45, 90, 135].map((u0) => startAt(u0));
  const spread = (k) => (Math.max(...atMean.map((x) => x[k].rate)) - Math.min(...atMean.map((x) => x[k].rate))) / Math.abs(atMean[0][k].rate);
  const tilted = [startAt(0, -0.03).mean.rate, startAt(90, 0.03).mean.rate], at45 = atMean[1].mean.rate;
  console.log(`  started circular at ${rp.toFixed(0)} km, 0 to 135 deg past the node: mean a ${atMean.map((x) => x.osc.aMean.toFixed(2)).join(', ')} km, node rates ${(spread('osc') * 100).toFixed(3)} % apart; at the mean radius, ${(spread('mean') * 100).toFixed(3)} % apart; tilted 0.03 deg, the starts at 0 and 90 deg ${tilted.map((x) => ((x / at45 - 1) * 100).toFixed(4)).join(' and ')} % off the one at 45`);
  check('started at the mean radius, the orbit\'s mean semi-major axis is the planned one to 1 m, and its node\'s rates within 0.1 % wherever it starts (from a circular start, 0.3 % or more apart); the rest the inclination\'s term within a turn (tilted 0.03 deg, within 0.005 %)', atMean.every((x) => Math.abs(x.mean.aMean - rp) < 1e-3) && spread('mean') < 1e-3 && spread('osc') > 3e-3 && tilted.every((x) => rel(x, at45) < 5e-5));
  // At Jupiter the kernel's field goes on to J12 (bodies.js ZONAL jn), and
  // J4 and J6 turn the node too: 1.5 Jupiter radii out, 30 deg to its
  // equator, with its moons, flown three days. The kernel's node is
  // averaged over a whole turn at each end, so the terms within a turn
  // cancel. The plan's rate, flown in the same zonal field, within 0.25 %;
  // flown in J2 alone it is 2.5 % slow.
  {
    const jsys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS, keys: ['jupiter'] }), jms = D('2030-01-01T00:00:00Z'), jt0 = kernelSeconds(new Date(jms));
    const Jc = (t) => { const b = jsys.bodyAt('jupiter', t), v = [0, 0, 0]; b.eph.velocity(t, v); return { r: b.r.slice(), v, mu: b.mu }; };
    const zj = ZONAL.jupiter, J0 = Jc(jt0), jmu = J0.mu, ja = 1.5 * zj.rJ2, ji = 30 * deg, jvc = Math.sqrt(jmu / ja);
    const jp = bodyAxesEqj('jupiter', new Date(jms))[2], f1 = un(cr(jp, [0, 0, 1])), f2 = cr(jp, f1), fq = f2.map((x, i) => Math.cos(ji) * x + Math.sin(ji) * jp[i]);
    const jr = f1.map((x) => ja * x), jv = fq.map((x) => jvc * x);
    const jnode = (r, v) => { const q = cr(jp, cr(r, v)); return Math.atan2(dt(q, f2), dt(q, f1)); };
    const T = 2 * Math.PI * Math.sqrt(ja ** 3 / jmu), N = 24;
    let st = { r: jr.map((x, i) => x + J0.r[i]), v: jv.map((x, i) => x + J0.v[i]), t: jt0 };
    const go = (tEnd) => { const q = stepCraft(jsys, { id: 0, version: 0, r: st.r, v: st.v, t: st.t, tEnd, primary: null, burns: [], maxSteps: 5e6 }); st = { r: q.r, v: q.v, t: q.t }; };
    const turn = () => { const xs = []; for (let k = 0; k < N; k++) { const B = Jc(st.t); xs.push(jnode(st.r.map((x, i) => x - B.r[i]), st.v.map((x, i) => x - B.v[i]))); go(st.t + T / N); } for (let k = 1; k < N; k++) xs[k] -= 2 * Math.PI * Math.round((xs[k] - xs[k - 1]) / (2 * Math.PI)); return xs.reduce((a, b) => a + b, 0) / N; };
    const mA = turn(), tA = jt0 + (T * (N - 1)) / N / 2;
    go(jt0 + 3 * DAY);
    const tB = st.t + (T * (N - 1)) / N / 2;
    let mB = turn();
    const first = PP.nodeRate(jmu, zj.j2, zj.rJ2, ja, 0, ji);
    mB += 2 * Math.PI * Math.round((first * (tB - tA) - (mB - mA)) / (2 * Math.PI));
    const kernel = (mB - mA) / (tB - tA);
    const full = PP.flownNodeRate({ mu: jmu, j2: zj.j2, jn: zj.jn, R: zj.rJ2, pole: jp, r: jr, v: jv }).rate, j2only = PP.flownNodeRate({ mu: jmu, j2: zj.j2, R: zj.rJ2, pole: jp, r: jr, v: jv }).rate;
    console.log(`  Jupiter, 1.5 radii out at 30 deg: kernel ${(kernel * DAY / deg).toFixed(4)} deg/d; flown in its zonal field ${(full * DAY / deg).toFixed(4)} (${((full / kernel - 1) * 100).toFixed(2)} % off); in J2 alone ${(j2only * DAY / deg).toFixed(4)} (${((j2only / kernel - 1) * 100).toFixed(2)} %)`);
    check('at Jupiter the node\'s rate is flown in the kernel\'s zonal field (to J12): within 0.25 % of the kernel\'s, where J2 alone is more than 1.5 % off', rel(full, kernel) < 0.0025 && rel(j2only, kernel) > 0.015);
    // And the planner flies it in that field: a stay in a low Jupiter orbit
    // (36,000 km up) priced with ZONAL's terms beyond J2, and without them.
    const jt = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2030-01-01T00:00:00Z') }, waypoints: [
      { id: 1, body: 'jupiter', kind: 'orbit', altKm: 36000, stayDays: 100, dateMs: D('2032-09-01T00:00:00Z') }, { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D('2035-09-01T00:00:00Z') }] };
    const withJn = J.solveJourney(jt).legs[1].plane, jn = zj.jn;
    let noJn;
    try { delete zj.jn; noJn = J.solveJourney(jt).legs[1].plane; } finally { zj.jn = jn; }
    const fr = (q) => q.rateDegDay / q.firstOrderDegDay;
    console.log(`  a stay 36,000 km over Jupiter, the plan's node against eq. (4.52): x${fr(withJn).toFixed(4)} in its zonal field, x${fr(noJn).toFixed(4)} in J2 alone`);
    check('the planner\'s node at Jupiter takes the field beyond J2 (more than 2 % faster than in J2 alone)', withJn.priced && fr(withJn) > fr(noJn) + 0.02);
  }

  // Where it is priced. A stay of up to 30 days: the capture is aimed for
  // it (journeyFlight.js stayTurned), no extra; at the Moon beyond that, not
  // priced (the Earth's pull and the Moon's field turn the plane, not J2:
  // PR #81); high over Mars, where the Sun's tide is more than 5 % of J2's
  // pull, not priced.
  const mk = (body, altKm, stayDays, home) => ({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D(body === 'moon' ? '2026-12-01T00:00:00Z' : '2026-11-01T00:00:00Z') }, waypoints: [
    { id: 1, body, kind: 'orbit', altKm, stayDays, dateMs: D(body === 'moon' ? '2026-12-05T00:00:00Z' : '2027-09-07T00:00:00Z') }, { id: 2, body: 'earth', kind: 'land', altKm: 120, dateMs: D(home) }] });
  const short = J.solveJourney(mk('mars', 400, 30, '2028-08-10T00:00:00Z')).legs[1].plane, moonS = J.solveJourney(mk('moon', 100, 3, '2026-12-12T00:00:00Z')).legs[1].plane;
  const moonL = J.solveJourney(mk('moon', 100, 40, '2027-01-20T00:00:00Z')).legs[1].plane, high = J.solveJourney(mk('mars', 30000, 364, '2029-08-10T00:00:00Z')).legs[1].plane;
  console.log(`  a month at Mars: ${short.aimed ? 'aimed' : 'priced'}; 3 d at the Moon: ${moonS.aimed ? 'aimed' : '?'}; 40 d at the Moon: ${moonL.why}; 30,000 km over Mars: ${high.why}`);
  check('up to 30 days the capture is aimed for the plane (no extra); beyond, at the Moon and high over Mars, not priced, and why', short.aimed && short.extraDv === 0 && moonS.aimed && !moonL.priced && /Moon/.test(moonL.why) && !high.priced && /Sun/.test(high.why));

  // The window strip prices each date with the plane as a stay to that
  // date would turn it, and the lamp points at the day near the planned
  // one the plane holds the way out.
  const rt = mk('mars', 400, 364, '2029-08-10T00:00:00Z'), sol = J.solveJourney(rt), prof = F.legProfile(rt, 1, { sol }), price = J.planePricer(sol, 1);
  const q = prof.points.find((x) => x.ms - sol.stops[1].arrMs > 60 * DAY_MS), Lq = J.solveLeg(sol.stops[1], sol.stops[2], q.ms, q.ms + q.tofDays * DAY_MS);
  check('the strip leaving Mars: every 2 days (the plane comes round in 40), each point the leg solved then with its plane\'s extra', prof.stepDays === 2 && near(Lq.depDv + Lq.arrDv + price(Lq), q.dv, 1e-9) && price(Lq) > 0);
  const lamp = F.assess(rt, sol, { profiles: [null, prof] }).find((l) => l.key === 'parking');
  console.log(`  parking orbit lamp: ${lamp?.text}`);
  check('the parking orbit lamp: the day near the planned one, at under half the planned day\'s extra', lamp?.level === 'caution' && lamp.bestMs === prof.plane.ms && prof.plane.dv < sol.legs[1].depDv + sol.legs[1].arrDv - sol.legs[1].plane.extraDv / 2);
}

header('CASE 14: burn nodes on a leg of two arcs (a broken plane, a bi-elliptic leg)');
{
  // A node with no burn leaves a two-arc leg as planned (its arcs are
  // Lambert's, so on target to 1 m and the same delta-v, as CASE 6 for one
  // arc); the burn at the break is still flown, putting the craft on the
  // planned second arc's velocity.
  const mm = (nodes) => ({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-10-20T00:00:00Z') }, waypoints: [
    { id: 1, body: 'moon', kind: 'orbit', altKm: 100, stayDays: 23, dateMs: D('2026-10-24T00:00:00Z') },
    { id: 2, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z'), ...(nodes ? { nodes } : {}) }] });
  const s0 = J.solveJourney(mm()), L0 = s0.legs[1], at = (f) => L0.depMs + f * (L0.arrMs - L0.depMs);
  const node = (f, n = {}) => [{ id: 7, ms: at(f), pro: 0, nor: 0, rad: 0, ...n }];
  const before = J.solveJourney(mm(node(0.25))), after = J.solveJourney(mm(node(0.75)));
  console.log(`  broken plane, a node with no burn before the break: misses Mars by ${(before.legs[1].missKm * 1000).toFixed(3)} m, break ${(before.legs[1].midDv * 1000).toFixed(3)} m/s (planned ${(L0.midDv * 1000).toFixed(3)}); after it: ${(after.legs[1].missKm * 1000).toFixed(3)} m`);
  check('a node with no burn before or after the break leaves the broken plane as planned: on target to 1 m, the same delta-v to 1e-9 km/s', [before, after].every((s) => s.legs[1].shaped && s.legs[1].missKm < 1e-3 && Math.abs(s.totalDv - s0.totalDv) < 1e-9 && Math.abs(s.legs[1].midDv - L0.midDv) < 1e-9));
  const pushed = J.solveJourney(mm(node(0.25, { pro: 0.05 }))), aimed = J.solveJourney(J.aimNode(mm(node(0.25, { pro: 0.05 })), 1, 7));
  console.log(`  a 50 m/s prograde node before the break: misses by ${(pushed.legs[1].missKm / 1e3).toFixed(0)} thousand km, the break ${(pushed.legs[1].midDv * 1000).toFixed(1)} m/s; aimed (at the break point): ${(aimed.legs[1].missKm * 1000).toFixed(3)} m off, total ${aimed.totalDv.toFixed(6)} km/s against ${s0.totalDv.toFixed(6)}`);
  check('a push before the break misses and the break burn pays for it; aiming the node at the break point brings it back on target to 1 m and to the plan\'s delta-v (1e-6 km/s)', pushed.legs[1].missKm > 1e5 && pushed.legs[1].midDv > L0.midDv && aimed.legs[1].missKm < 1e-3 && Math.abs(aimed.totalDv - s0.totalDv) < 1e-6);
  // Bi-elliptic, Earth to Mars: its apoapsis burn kept under a node.
  const em = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'mars', kind: 'orbit', altKm: 400, dateMs: D('2027-08-20T00:00:00Z') }] };
  const jb = J.applyOption(em, 0, J.legOptions(em, 0, { search: false }).options.find((o) => o.type === 'bielliptic')), sb = J.solveJourney(jb), Lb = sb.legs[0];
  const zb = J.solveJourney({ ...jb, waypoints: [{ ...jb.waypoints[0], nodes: [{ id: 3, ms: Lb.depMs + 0.3 * (Lb.mid.ms - Lb.depMs), pro: 0, nor: 0, rad: 0 }] }] });
  console.log(`  bi-elliptic to Mars, a node with no burn on the way out: misses by ${(zb.legs[0].missKm * 1000).toFixed(0)} m over ${Lb.tofDays.toFixed(0)} d, the apoapsis burn ${(zb.legs[0].midDv * 1000).toFixed(3)} m/s (planned ${(Lb.midDv * 1000).toFixed(3)})`);
  check('and on a bi-elliptic leg: on target to 1 km (its second arc is Lambert\'s with up to a revolution), the apoapsis burn the same to 1e-6 km/s', zb.legs[0].missKm < 1 && Math.abs(zb.legs[0].midDv - Lb.midDv) < 1e-6);

  // The flight: no aim at the break before nodes that shape the way to it;
  // a two-arc leg's departure, if it waits, re-aimed at its break point.
  const pb = planFlight(pushed), aimSun = pb.events.filter((e) => e.kind === 'aim' && e.body === 'sun');
  const rt = { start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2026-11-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'mars', kind: 'orbit', altKm: 400, stayDays: 30, dateMs: D('2027-09-07T00:00:00Z') },
    { id: 2, body: 'earth', kind: 'orbit', altKm: 300, dateMs: D('2028-08-01T00:00:00Z') }] };
  const rb = J.solveJourney(J.applyOption(rt, 1, J.legOptions(rt, 1, { search: false }).options.find((o) => o.type === 'bielliptic')));
  const dep = planFlight(rb).events.find((e) => e.kind === 'depart' && e.body === 'mars');
  check('the flight: no aim at the break point ahead of a node before it; a bi-elliptic departure from Mars re-aimed, if it waits, at its apoapsis point', aimSun.length === 0 && dep?.reaim?.arrMs === rb.legs[1].mid.ms && !!dep.reaim.toEqj);
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS }), fl = flyJourney(sys, planFlight(J.solveJourney(mm(node(0.25, { pro: 0.02 })))));
  console.log(`  broken plane with a 20 m/s node before the break, flown: Mars ${fl.arrivals[1].missKm.toFixed(1)} km off the planned periapsis, corrections ${(fl.correctionsDv * 1000).toFixed(0)} m/s`);
  check('flown in the full model: the node as planned, Mars within 20 km of plan', !fl.impact && fl.arrivals[1].missKm < 20 && fl.burns.length >= 3);
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exit(failures ? 1 : 0);
