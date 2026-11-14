// src/physics/journey.test.mjs
//
// The journey planner's physics against textbook worked examples, then the
// journey itself: legs chained, flybys joined, options compared, and a
// journey flown by the n-body kernel reaching each waypoint.
//
// Reference: Curtis, Orbital Mechanics for Engineering Students, 4th ed.
// (Butterworth-Heinemann, 2020). Its chapter 6 (orbital manoeuvres), 8
// (interplanetary trajectories) and 13 (rocket vehicle dynamics: staging,
// chapter 11 in the 1st and 2nd editions). Examples are cited by that
// edition's numbers; the book rounds to four or five figures, so checks
// allow its last figure.

import './deNode.js';
import fs from 'node:fs';
import * as X from './transfers.js';
import { restrictedStaging, restrictedPayloadRatio, sizeLauncher, launchBudget, STAGE_TECH } from './staging.js';
import * as J from './journey.js';
import { planFlight, flyJourney } from './journeyFlight.js';
import { solarSystemBodies } from './bodies.js';
import { KERNEL_EPOCH_MS } from './kernelHost.js';

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
  const sb = J.solveJourney({ start: { body: 'earth', kind: 'orbit', altKm: 200, dateMs: D('2027-01-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'sb:433', kind: 'orbit', altKm: 20, dateMs: D('2027-09-01T00:00:00Z') }] });
  check('a small body as a waypoint (433 Eros): solved, its capture a rendezvous', sb.ok && rel(sb.legs[0].arrDv, norm(sb.legs[0].vinfArr)) < 1e-3);
}

header('CASE 5: journeys flown by the n-body kernel');
{
  const sys = solarSystemBodies({ epochMs: KERNEL_EPOCH_MS });
  const fly = (name, j) => {
    const f = flyJourney(sys, planFlight(J.solveJourney(j)));
    for (const a of f.arrivals) console.log(`  ${name}: ${J.bodyInfo(a.body).name} ${a.central ? `${a.missKm.toFixed(1)} km from the aimed point` : `closest ${a.closest.toFixed(0)} km from its centre, planned ${a.plannedRp.toFixed(0)}: ${a.missKm.toFixed(1)} km off`}`);
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
}

console.log(failures ? `RESULT: ${failures} check(s) FAILED` : 'RESULT: all checks PASSED');
process.exit(failures ? 1 : 0);
