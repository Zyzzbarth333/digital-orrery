// src/physics/irregularMoons.js
//
// The irregular moons of Jupiter, Saturn and Neptune: the small, distant
// moons on large, inclined and mostly retrograde orbits, thought to be
// captured bodies (docs/frontend/moons.md#the-irregular-moons). They are
// drawn as an optional layer (src/scene/irregularMoons.ts), not as full
// bodies, and none of them pulls on spacecraft.
//
//   irregularStateEqjAtTt(key, tt) -> { r, v }  about the planet's centre,
//                                     J2000 equatorial (ICRF axes), km, km/s
//   irregularPositionEqj(key, date) -> r, the same at a Date (UTC)
//   irregularPositionEqjAtTt(key, tt) -> r alone (for orbit lines)
//   irregularSource(key, tt)        -> 'table' or 'elements'
//
// From 2000 to 2049, every one comes from Chebyshev tables of its JPL
// satellite ephemeris (jup347, jup348, jup349, sat455, sat456, sat457,
// sat459, nep104; moonTables.js, the 'irregular' part, each series within
// 0.5 km of the SPK), less the planet's centre from the system's main
// table, wherever both years are installed. Elsewhere, and until a year
// has loaded, JPL's mean elements, a precessing ellipse in the J2000
// ecliptic, with corrections fitted to Horizons over 2000-2050
// (irregularMoons.fetch.mjs). The Sun pulls these moons about far more than
// a precessing ellipse allows, so the elements are a rough guide only:
// irregularMoons.data.js has each one's residual (fit.maxKm).

import { ttSeconds } from './ephemeris.js';
import { elementState, elementPosition } from './moons.js';
import { IRREGULAR_DATA } from './irregularMoons.data.js';
import { moonChunkAt, irregularChunkAt, chunkState } from './moonTables.js';

export { IRREGULAR_DATA };
export const IRREGULAR_KEYS = Object.keys(IRREGULAR_DATA);
// Each planet's irregular moons, out from it.
export const IRREGULARS_OF = {};
for (const k of IRREGULAR_KEYS) (IRREGULARS_OF[IRREGULAR_DATA[k].planet] ??= []).push(k);
for (const list of Object.values(IRREGULARS_OF)) list.sort((a, b) => IRREGULAR_DATA[a].a - IRREGULAR_DATA[b].a);
export const isIrregularKey = (key) => key in IRREGULAR_DATA;

// The kernels whose moons have tables here (c/moon_cheb.c).
export const TABLE_KERNELS = new Set(['jup347', 'jup348', 'jup349', 'sat455', 'sat456', 'sat457', 'sat459', 'nep104']);
const PLANET_NAIF = { jupiter: 599, saturn: 699, neptune: 899 };

// The J2000 ecliptic's axes in the ICRF (obliquity 84381.448"), as moons.js
// uses for an ecliptic-frame row: N its node on the equator, P its pole.
const EPS = (84381.448 / 3600) * (Math.PI / 180);
const ECLIPTIC_AXES = [[1, 0, 0], [0, Math.cos(EPS), Math.sin(EPS)], [0, -Math.sin(EPS), Math.cos(EPS)]];

const rm = [0, 0, 0], vm = [0, 0, 0], rp = [0, 0, 0], vp = [0, 0, 0];
function tableState(m, tt) {
  if (!TABLE_KERNELS.has(m.kernel)) return null;
  const irr = irregularChunkAt(m.planet, tt);
  if (!irr || !chunkState(irr, m.naif, tt, rm, vm)) return null;
  const main = moonChunkAt(m.planet, tt);
  if (!main || !chunkState(main, PLANET_NAIF[m.planet], tt, rp, vp)) return null;
  return { r: [rm[0] - rp[0], rm[1] - rp[1], rm[2] - rp[2]], v: [vm[0] - vp[0], vm[1] - vp[1], vm[2] - vp[2]] };
}

export function irregularStateEqjAtTt(key, tt) {
  const m = IRREGULAR_DATA[key];
  if (!m) throw new Error(`irregularMoons: unknown moon '${key}'`);
  const s = tableState(m, tt);
  if (s) return s;
  const { r, v } = elementState(m, tt / 86400, ECLIPTIC_AXES);
  return { r, v };
}

// Position only (EQJ km about the planet's centre), for orbit lines: the
// elements' without the velocity's two extra solutions of Kepler's equation.
export function irregularPositionEqjAtTt(key, tt) {
  const m = IRREGULAR_DATA[key], s = tableState(m, tt);
  return s ? s.r : elementPosition(m, tt / 86400, ECLIPTIC_AXES, true).r;
}

export const irregularStateEqj = (key, date) => irregularStateEqjAtTt(key, ttSeconds(date.getTime()));
export const irregularPositionEqj = (key, date) => irregularStateEqj(key, date).r;

export function irregularSource(key, tt) {
  return tableState(IRREGULAR_DATA[key], tt) ? 'table' : 'elements';
}

// Orbital period (days) for the plate and the orbit lines: the elements'.
export const irregularPeriodDays = (key) => IRREGULAR_DATA[key].P;
