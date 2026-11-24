// packages/physics/src/dvMap.test.mjs
//
// The delta-v map (dvMap.js): the reference lines against the ideal
// figures worked by hand (Hohmann transfers from a 300 km Earth orbit,
// captures into a circular orbit 10 % of the radius up, the circular speed
// there for a landing), and a journey's burns put on the lines they fly,
// adding up to the planner's total.

import './deNode.js';
import * as J from './journey.js';
import * as X from './transfers.js';
import { referenceMap, journeyMap, fromLeo, MAP_ROUTES } from './dvMap.js';

let failures = 0;
function check(name, ok) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failures++; }
const header = (s) => { console.log('='.repeat(60)); console.log(s); console.log('='.repeat(60)); };
const D = Date.parse;
const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

header('CASE 1: the reference lines');
{
  const m = referenceMap(), dv = (id) => m.lines.find((l) => l.id === id)?.dv ?? NaN;
  const rows = m.lines.map((l) => `${l.id} ${l.dv.toFixed(2)}${l.fromLeo !== undefined ? ` (${l.fromLeo.toFixed(2)} from LEO)` : ''}${l.aerobraking ? ' aerobraking not counted' : ''}`);
  for (const r of rows) console.log(`    ${r}`);
  check('LEO to escape 3.20; surface to LEO 7.73, the circular speed 300 km up', near(dv('earth:leo>earth:escape'), 3.20) && near(dv('earth:surface>earth:leo'), 7.73));
  check('the Moon 3.11 / 0.81 / 1.60', near(dv('earth:leo>moon:transfer'), 3.11) && near(dv('moon:transfer>moon:orbit'), 0.81) && near(dv('moon:orbit>moon:surface'), 1.60));
  // From LEO: escape plus the escape-to-transfer line, which is one burn.
  check('Mars 3.59 from LEO / 2.09 / 3.39', near(fromLeo(m, 'mars:transfer'), 3.59) && near(dv('mars:transfer>mars:orbit'), 2.09) && near(dv('mars:orbit>mars:surface'), 3.39));
  check('Venus 3.48 / 3.26', near(fromLeo(m, 'venus:transfer'), 3.48) && near(dv('venus:transfer>venus:orbit'), 3.26));
  check('Mercury 5.55 / 7.57 / 2.87', near(fromLeo(m, 'mercury:transfer'), 5.55) && near(dv('mercury:transfer>mercury:orbit'), 7.57) && near(dv('mercury:orbit>mercury:surface'), 2.87));
  check('Jupiter 6.30 / 17.09; Saturn 7.28 / 10.51', near(fromLeo(m, 'jupiter:transfer'), 6.30) && near(dv('jupiter:transfer>jupiter:orbit'), 17.09) && near(fromLeo(m, 'saturn:transfer'), 7.28) && near(dv('saturn:transfer>saturn:orbit'), 10.51));
  // By hand: Mars's Hohmann excess speeds from the planets' semi-major axes.
  const E = J.bodyInfo('earth'), M = J.bodyInfo('mars'), h = X.hohmannCircular(J.bodyInfo('sun').mu, E.a, M.a);
  check('a planet\'s transfer line is the departure from LEO less escape', near(dv('earth:escape>mars:transfer'), X.departureDv(h.dv1, E.mu, E.radius + 300) - X.departureDv(0, E.mu, E.radius + 300), 1e-9));
  check('the giants have no surface; Earth, Venus and Mars landings are aerobraking not counted, the Moon\'s and Mercury\'s are not',
    ['jupiter', 'saturn', 'uranus', 'neptune'].every((k) => !m.stations.some((s) => s.id === `${k}:surface`))
    && ['earth:surface>earth:leo', 'venus:orbit>venus:surface', 'mars:orbit>mars:surface'].every((id) => m.lines.find((l) => l.id === id).aerobraking)
    && !m.lines.find((l) => l.id === 'moon:orbit>moon:surface').aerobraking && !m.lines.find((l) => l.id === 'mercury:orbit>mercury:surface').aerobraking);
  check('every route has a transfer and a low orbit, every line joins two stations', MAP_ROUTES.every((k) => m.stations.some((s) => s.id === `${k}:transfer`) && m.stations.some((s) => s.id === `${k}:orbit`))
    && m.lines.every((l) => m.stations.some((s) => s.id === l.from) && m.stations.some((s) => s.id === l.to)));
}

header('CASE 2: a journey on the map');
{
  const sum = (jm) => Object.values(jm.lines).reduce((a, l) => a + l.dv, 0) + jm.offMap.reduce((a, p) => a + p.dv, 0);
  // Earth to a Mars orbit on the 2026 window's dates, and home.
  const j = { start: { body: 'earth', kind: 'pad', altKm: 200, dateMs: D('2026-11-20T00:00:00Z'), latDeg: 28.5 }, waypoints: [
    { id: 1, body: 'mars', kind: 'orbit', altKm: 400, stayDays: 450, dateMs: D('2027-09-01T00:00:00Z') },
    { id: 2, body: 'earth', kind: 'orbit', altKm: 300, stayDays: 0, dateMs: D('2029-06-01T00:00:00Z') }] };
  const sol = J.solveJourney(j), jm = journeyMap(j, sol), L = sol.legs[0], E = J.bodyInfo('earth');
  for (const [id, l] of Object.entries(jm.lines)) console.log(`    ${id} ${l.parts.map((p) => p.dv.toFixed(3)).join(' + ')}`);
  check('it solves', sol.ok);
  check('the lines and the burns off the map add up to the planner\'s total', near(sum(jm), sol.totalDv, 1e-9));
  check('leaving: escape from the 200 km parking orbit on the LEO-escape line, the rest on the Mars transfer line', near(jm.lines['earth:leo>earth:escape'].parts[0].dv, X.departureDv(0, E.mu, E.radius + 200), 1e-9)
    && near(jm.lines['earth:leo>earth:escape'].parts[0].dv + jm.lines['earth:escape>mars:transfer'].parts[0].dv, L.depDv, 1e-9));
  check('the capture at Mars on its capture line, and the way home on the same lines', near(jm.lines['mars:transfer>mars:orbit'].parts[0].dv, L.arrDv, 1e-9) && jm.lines['mars:transfer>mars:orbit'].parts.length === 2 && jm.lines['earth:leo>earth:escape'].parts.length === 2);
  check('nothing off the map; the stops: LEO, low Mars orbit', jm.offMap.length === 0 && jm.stations.includes('earth:surface') && jm.stations.includes('mars:orbit') && jm.stations.includes('earth:leo'));

  // A Moon landing (airless: a powered descent of the low orbit's speed),
  // and a Mars landing (through the air: an entry, no burn).
  const moon = { start: { body: 'earth', kind: 'orbit', altKm: 300, dateMs: D('2027-03-01T00:00:00Z') }, waypoints: [{ id: 1, body: 'moon', kind: 'land', altKm: 100, stayDays: 3, dateMs: D('2027-03-05T12:00:00Z') }] };
  const ms = J.solveJourney(moon), mm = journeyMap(moon, ms), Mo = J.bodyInfo('moon');
  check('to the Moon: all of the departure on the LEO-Moon line, none on escape', ms.ok && !mm.lines['earth:leo>earth:escape'] && near(mm.lines['earth:leo>moon:transfer'].dv, ms.legs[0].depDv, 1e-9));
  check('the Moon landing: the descent from 100 km on the surface line, the capture on the capture line', near(mm.lines['moon:orbit>moon:surface'].dv, X.circularSpeed(Mo.mu, Mo.radius + 100), 1e-9) && near(mm.lines['moon:transfer>moon:orbit'].dv + mm.lines['moon:orbit>moon:surface'].dv, ms.legs[0].arrDv, 1e-9) && mm.stations.includes('moon:surface'));
  const mars = { ...j, waypoints: [{ ...j.waypoints[0], kind: 'land' }] };
  const ls = J.solveJourney(mars), lm = journeyMap(mars, ls);
  check('a Mars landing is an entry: its surface line is there at 0, and no capture', ls.ok && lm.lines['mars:orbit>mars:surface']?.dv === 0 && lm.lines['mars:orbit>mars:surface'].parts[0].entry && !lm.lines['mars:transfer>mars:orbit']);

  // Earth, a Venus flyby, Mars: the leg from Venus runs between two other
  // bodies, so its capture is listed off the map; the flyby too.
  const vm = { start: { body: 'earth', kind: 'orbit', altKm: 300, dateMs: D('2028-12-01T00:00:00Z') }, waypoints: [
    { id: 1, body: 'venus', kind: 'flyby', altKm: 1000, stayDays: 0, dateMs: D('2029-05-01T00:00:00Z') },
    { id: 2, body: 'mars', kind: 'orbit', altKm: 400, stayDays: 3, dateMs: D('2029-12-01T00:00:00Z') }] };
  const vs = J.solveJourney(vm), vj = journeyMap(vm, vs);
  check('Earth, Venus flyby, Mars: the departure on the Venus line, the Mars capture off the map, the sum holds', vs.ok && !!vj.lines['earth:escape>venus:transfer'] && vj.offMap.some((p) => p.label.includes('Mars')) && near(sum(vj), vs.totalDv, 1e-9) && vj.stations.includes('venus:transfer'));
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
process.exit(failures ? 1 : 0);
