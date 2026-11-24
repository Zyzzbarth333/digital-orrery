// packages/physics/src/dvMap.js
//
// The delta-v map (docs/physics/journey.md#the-delta-v-map): the solar
// system as a metro map, each station a state a craft can be in, each line
// the delta-v between two of them. Pure ES module: no three.js, React or
// DOM. km, km/s.
//
// Stations, by id:
//   earth:surface, earth:leo (a circular orbit 300 km up), earth:escape
//   (C3 = 0, just out of the Earth's well);
//   <body>:transfer  on the ideal transfer to the body, at its edge
//   <body>:orbit     a circular orbit 10 % of the body's radius up
//   <body>:surface   on the ground (rocky bodies only)
// for the Moon (whose transfer leaves from low Earth orbit) and the
// planets (whose transfers leave from escape). Lines, by id
// '<from>><to>', run outward; flown the other way, they cost the same
// under these assumptions.
//
//   referenceMap()               every line, ideal: circular coplanar orbits,
//                                Hohmann transfers, burns at periapsis, no
//                                gravity or steering losses, no aerobraking
//   journeyMap(journey, sol)     the same lines priced from the planner's
//                                solution (journey.js solveJourney): what
//                                each of its burns pays for, put on the
//                                line it flies, and the burns no line holds

import * as X from './transfers.js';
import { MU_SUN } from './bodies.js';
import { bodyInfo } from './journey.js';

// The map's routes, in the order they hang off the trunk.
export const MAP_ROUTES = ['moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
// The bodies with a surface to land on (the giants have none).
const SURFACE = new Set(['earth', 'moon', 'mercury', 'venus', 'mars']);
export const LEO_ALT_KM = 300;
export const LOW_ORBIT_FRAC = 0.1;

const station = (id, body, kind, name, extra = {}) => ({ id, body, kind, name, ...extra });
const line = (from, to, body, kind, dv, extra = {}) => ({ id: `${from}>${to}`, from, to, body, kind, dv, aerobraking: false, ...extra });

// From a circular orbit of radius r about the body with gravity mu, the
// share of a departure (or the arrival's capture) that only climbs out of
// the well: escape speed less circular speed.
const escapeShare = (mu, r) => X.departureDv(0, mu, r);

// Every station and line, ideal. leoAltKm: the Earth parking orbit's
// height; lowFrac: each other body's low orbit, as a fraction of its
// radius above the ground.
export function referenceMap({ leoAltKm = LEO_ALT_KM, lowFrac = LOW_ORBIT_FRAC } = {}) {
  const E = bodyInfo('earth'), rLeo = E.radius + leoAltKm;
  const stations = [
    station('earth:surface', 'earth', 'surface', 'Earth'),
    station('earth:leo', 'earth', 'orbit', 'Low Earth orbit', { altKm: leoAltKm }),
    station('earth:escape', 'earth', 'escape', 'Earth escape'),
  ];
  const escape = escapeShare(E.mu, rLeo);
  const lines = [
    // Up from the ground: the circular speed of the orbit (ideal: no
    // gravity, drag or steering losses); down, the same if the engine took
    // it all off, which the air does instead.
    line('earth:surface', 'earth:leo', 'earth', 'surface', X.circularSpeed(E.mu, rLeo), { aerobraking: true }),
    line('earth:leo', 'earth:escape', 'earth', 'escape', escape, { fromLeo: escape }),
  ];
  for (const key of MAP_ROUTES) {
    const B = bodyInfo(key), rLow = B.radius * (1 + lowFrac);
    let depart, vinf, from;
    if (key === 'moon') {
      // About the Earth: the Hohmann transfer from low Earth orbit to the
      // Moon's distance, then the Moon's speed against the craft's at
      // apogee is the excess speed it arrives with.
      const h = X.hohmannCircular(E.mu, rLeo, B.a);
      depart = h.dv1; vinf = Math.abs(X.circularSpeed(E.mu, B.a) - h.vB2); from = 'earth:leo';
    } else {
      // About the Sun: the Hohmann transfer between the two orbits; its
      // burns are the excess speeds at either end (Curtis 8.2-8.3). The
      // departure is one burn in low Earth orbit (with the Oberth effect),
      // of which escape is the first share: the line from escape is the rest.
      const h = X.hohmannCircular(MU_SUN, E.a, B.a);
      depart = X.departureDv(h.dv1, E.mu, rLeo); vinf = h.dv2; from = 'earth:escape';
      stations.push(station(`${key}:transfer`, key, 'transfer', `${B.name} transfer`, { vinfDep: h.dv1, vinfArr: h.dv2, tofDays: h.tof / 86400 }));
    }
    if (key === 'moon') stations.push(station('moon:transfer', 'moon', 'transfer', 'Moon transfer', { vinfArr: vinf, tofDays: X.hohmannCircular(E.mu, rLeo, B.a).tof / 86400 }));
    stations.push(station(`${key}:orbit`, key, 'orbit', `Low ${B.name} orbit`, { altKm: rLow - B.radius }));
    lines.push(line(from, `${key}:transfer`, key, 'transfer', from === 'earth:escape' ? depart - escape : depart, { fromLeo: depart }));
    lines.push(line(`${key}:transfer`, `${key}:orbit`, key, 'capture', X.captureDv(vinf, B.mu, rLow)));
    if (SURFACE.has(key)) {
      stations.push(station(`${key}:surface`, key, 'surface', `${B.name} surface`));
      lines.push(line(`${key}:orbit`, `${key}:surface`, key, 'surface', X.circularSpeed(B.mu, rLow), { aerobraking: !!B.atmosphere }));
    }
  }
  return { leoAltKm, lowFrac, stations, lines };
}

// The total from low Earth orbit along a route to a station: the sum of the
// lines from LEO out to it.
export function fromLeo(map, stationId) {
  const into = new Map(map.lines.map((l) => [l.to, l]));
  let dv = 0, at = stationId;
  while (at !== 'earth:leo') {
    const l = into.get(at);
    if (!l) return null;
    dv += l.dv; at = l.from;
  }
  return dv;
}

// The journey on the map: each of the solution's burns (journey.js
// solveJourney, sol.burns) put on the line it flies, where its leg runs
// between the Earth and a body on the map (the Moon, a planet):
//   leaving the Earth, the escape share of the departure on the LEO-escape
//   line (from the parking orbit's own height), the rest on the route's
//   transfer line (all of it, to the Moon);
//   a mid-course, deep-space or node burn, on the transfer line;
//   at the body, the capture on its capture line and a powered descent
//   (an airless landing: the low orbit's circular speed) on its surface
//   line; leaving it, the same lines the other way, ascent first;
//   back at the Earth, the capture split as the departure was.
// Any other burn (a leg between two other bodies, a flyby's, an orbit
// change, a body off the map) is listed, not drawn: the map's lines all
// run through the Earth. A landing through air costs no burn in the
// planner, so its line reads 0 (an entry).
// Returns { lines: { [id]: { dv, parts: [{ dv, ms, label, leg }] } },
// stations: [ids the journey stops at or passes], offMap: [{ dv, ms,
// label, leg }], total } with total the solution's delta-v.
export function journeyMap(journey, sol) {
  const lines = {}, offMap = [], visited = new Set();
  const put = (id, part) => { if (part.dv <= 0 && !part.entry) return; (lines[id] ??= { dv: 0, parts: [] }).dv += part.dv; lines[id].parts.push(part); };
  const S = sol.stops ?? [];
  const routeOf = (P, Q) => {
    if (P.body === 'earth' && MAP_ROUTES.includes(Q.body)) return { route: Q.body, out: true };
    if (Q.body === 'earth' && MAP_ROUTES.includes(P.body)) return { route: P.body, out: false };
    return null;
  };
  // The transfer line of a route (from LEO for the Moon, from escape for a planet).
  const transferLine = (route) => (route === 'moon' ? 'earth:leo>moon:transfer' : `earth:escape>${route}:transfer`);
  // Where the journey's stops sit on the map.
  if (journey.start?.body === 'earth') visited.add(journey.start.kind === 'pad' ? 'earth:surface' : 'earth:leo');
  for (const st of S.slice(1)) {
    if (!MAP_ROUTES.includes(st.body) && st.body !== 'earth') continue;
    if (st.body === 'earth') visited.add(st.kind === 'land' ? 'earth:surface' : 'earth:leo');
    else visited.add(`${st.body}:${st.kind === 'flyby' ? 'transfer' : st.kind === 'land' && SURFACE.has(st.body) ? 'surface' : 'orbit'}`);
  }
  for (const b of sol.burns ?? []) {
    const P = S[b.leg], Q = S[b.leg + 1], r = P && Q && sol.legs?.[b.leg]?.geometry !== 'local' ? routeOf(P, Q) : null;
    const part = { dv: b.dv, ms: b.ms, label: b.label, leg: b.leg };
    if (!r || b.kind === 'flyby') { offMap.push(part); continue; }
    const B = bodyInfo(r.route), E = bodyInfo('earth');
    const atEarth = b.body === 'earth' && (b.kind === 'depart' || b.kind === 'ascend' || b.kind === 'capture' || b.kind === 'land');
    const atBody = b.body === r.route && (b.kind === 'depart' || b.kind === 'ascend' || b.kind === 'capture' || b.kind === 'land');
    if (atEarth) {
      const stop = b.kind === 'depart' || b.kind === 'ascend' ? P : Q, rp = E.radius + (stop.altKm ?? LEO_ALT_KM);
      let dv = b.dv;
      // Off (or down to) the ground: the orbit's circular speed.
      if (b.kind === 'ascend' || b.kind === 'land') { const s = Math.min(dv, X.circularSpeed(E.mu, rp)); put('earth:surface>earth:leo', { ...part, dv: s }); dv -= s; }
      if (r.route !== 'moon') { const s = Math.min(dv, escapeShare(E.mu, rp)); put('earth:leo>earth:escape', { ...part, dv: s }); dv -= s; }
      put(transferLine(r.route), { ...part, dv });
    } else if (atBody) {
      const stop = b.kind === 'depart' || b.kind === 'ascend' ? P : Q, rp = B.radius + (stop.altKm ?? 0);
      let dv = b.dv;
      if ((b.kind === 'ascend' || b.kind === 'land') && SURFACE.has(r.route)) { const s = Math.min(dv, X.circularSpeed(B.mu, rp)); put(`${r.route}:orbit>${r.route}:surface`, { ...part, dv: s }); dv -= s; }
      put(`${r.route}:transfer>${r.route}:orbit`, { ...part, dv });
    } else if (b.kind === 'mid' || b.kind === 'node') put(transferLine(r.route), part);
    else offMap.push(part);
  }
  // A landing through air: the planner's entry, no burn.
  for (const c of sol.credits ?? []) {
    if (c.kind !== 'entry') continue;
    const P = S[c.leg], Q = S[c.leg + 1], r = P && Q ? routeOf(P, Q) : null;
    if (!r) continue;
    put(c.body === 'earth' ? 'earth:surface>earth:leo' : `${c.body}:orbit>${c.body}:surface`, { dv: 0, ms: c.ms, label: c.label, leg: c.leg, entry: true });
  }
  return { lines, stations: [...visited], offMap, total: sol.totalDv ?? 0 };
}
