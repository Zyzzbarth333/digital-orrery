// src/scene/catalogue.ts
//
// The bodies the scene draws, with the data the panels show. Radii are IAU
// mean radii (constants.js, SPICE); GM values are DE442 (bodies.js): the
// system GM for Mars to Neptune, whose positions are system barycentres.
// Colours are approximate true mean colours, placeholders until real
// textures arrive.

import { PLANETS } from '../utils/constants.js';
import { bodyConstants, MU_SUN } from '../physics/bodies.js';

export type BodyKey =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';

export interface BodyInfo {
  key: BodyKey;
  name: string;
  radiusKm: number;
  gm: number | null;            // km^3/s^2
  gmNote: string;
  // The planet's own GM where the system GM above includes moons, from the
  // header of the satellite kernel named in planetGmNote (km^3/s^2).
  planetGm?: number;
  planetGmNote?: string;
  geometricAlbedo: number | null;  // NASA NSSDCA fact sheet (V band)
  periodDays: number | null;    // orbital period about its primary
  parent: BodyKey | null;       // what it orbits (for its orbit line)
  colour: number;
}

const COLOUR: Record<BodyKey, number> = {
  sun: 0xfff4e0, mercury: 0x8f8a85, venus: 0xe6d6ae, earth: 0x4a6d9c, moon: 0x9c9a95,
  mars: 0xb4623a, jupiter: 0xc9b48f, saturn: 0xd8c690, uranus: 0xa9d8de, neptune: 0x4b6fd0,
  pluto: 0xc9b49a,
};

// Planet-only GMs from the NAIF satellite kernels' body tables (the
// SATORBINT fits; the kernel's own planetary ephemeris in brackets).
const PLANET_GM: Partial<Record<BodyKey, [number, string]>> = {
  mars: [4.282837485735626e4, 'NAIF 499, mar099s (DE440)'],
  jupiter: [1.266865319003704e8, 'NAIF 599, jup365 (DE440)'],
  saturn: [3.793120623436167e7, 'NAIF 699, sat441 (DE440)'],
  uranus: [5.793950610340896e6, 'NAIF 799, ura184 (DE442)'],
  neptune: [6.835099968446816e6, 'NAIF 899, nep097 (DE441)'],
  pluto: [8.693261226311508e2, 'NAIF 999, plu060 (DE440)'],
};

// Geometric albedo from the NASA NSSDCA planetary fact sheets (read
// 12 Nov 2026; pages updated Jan 2024 to May 2025).
const GEOMETRIC_ALBEDO: Partial<Record<BodyKey, number>> = {
  mercury: 0.142, venus: 0.689, earth: 0.434, moon: 0.12, mars: 0.170,
  jupiter: 0.538, saturn: 0.499, uranus: 0.488, neptune: 0.442, pluto: 0.52,
};

type PlanetRow = { name: string; radius: number; orbitalPeriod?: number };
const P = PLANETS as Record<string, PlanetRow>;

function planet(key: Exclude<BodyKey, 'sun' | 'moon'>): BodyInfo {
  let gm: number | null = null;
  let gmNote = '';
  if (key === 'pluto') {
    gm = 975.5;
    gmNote = 'Pluto system, Pluto and Charon (DE442)';
  } else {
    gm = bodyConstants(key).mu;
    gmNote = key === 'mercury' || key === 'venus' ? 'planet (DE442)'
      : key === 'earth' ? 'Earth itself, NAIF 399 (DE442)'
        : 'whole system, planet and moons (DE442)';
  }
  const own = PLANET_GM[key];
  return {
    key, name: P[key].name, radiusKm: P[key].radius, gm, gmNote,
    geometricAlbedo: GEOMETRIC_ALBEDO[key] ?? null,
    ...(own ? { planetGm: own[0], planetGmNote: own[1] } : {}),
    periodDays: P[key].orbitalPeriod ?? null, parent: 'sun', colour: COLOUR[key],
  };
}

export const BODIES: BodyInfo[] = [
  { key: 'sun', name: 'Sun', radiusKm: 695700, gm: MU_SUN, gmNote: 'DE442', geometricAlbedo: null, periodDays: null, parent: null, colour: COLOUR.sun },
  planet('mercury'),
  planet('venus'),
  planet('earth'),
  { key: 'moon', name: 'Moon', radiusKm: 1737.4, gm: bodyConstants('moon').mu, gmNote: 'NAIF 301 (DE442)',
    geometricAlbedo: GEOMETRIC_ALBEDO.moon!,
    periodDays: 27.321661, parent: 'earth', colour: COLOUR.moon },
  planet('mars'),
  planet('jupiter'),
  planet('saturn'),
  planet('uranus'),
  planet('neptune'),
  planet('pluto'),
];

export const BODY_BY_KEY = Object.fromEntries(BODIES.map((b) => [b.key, b])) as Record<BodyKey, BodyInfo>;
