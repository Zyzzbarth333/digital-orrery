// src/scene/catalogue.ts
//
// The bodies the scene draws, with the data the panels show. Radii are IAU
// mean radii (constants.js, SPICE); GM values are DE442 (bodies.js): the
// system GM for Mars to Neptune, whose positions are system barycentres.
// Colours are approximate true mean colours, placeholders until real
// textures arrive. The other planets' moons (src/physics/moons.js) carry
// their radius, GM and geometric albedo from JPL Horizons. Every body's
// shape is its IAU triaxial ellipsoid (pck00011, pck.data.js) where it has
// one.

import { PLANETS } from '../utils/constants.js';
import { bodyConstants, MU_SUN, PLANET_GM as KERNEL_PLANET_GM } from '../physics/bodies.js';
import { MOON_DATA } from '../physics/moons.data.js';
import { RADII } from '../physics/pck.data.js';

export type PlanetKey =
  | 'sun' | 'mercury' | 'venus' | 'earth' | 'moon' | 'mars'
  | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';
// The moons of Mars to Pluto that JPL's satellite ephemerides carry, in
// order out from each planet.
export type MoonKey =
  | 'phobos' | 'deimos'
  | 'metis' | 'adrastea' | 'amalthea' | 'thebe' | 'io' | 'europa' | 'ganymede' | 'callisto'
  | 'mimas' | 'methone' | 'enceladus' | 'tethys' | 'telesto' | 'calypso' | 'dione' | 'helene' | 'polydeuces'
  | 'rhea' | 'titan' | 'hyperion' | 'iapetus' | 'phoebe'
  | 'miranda' | 'ariel' | 'umbriel' | 'titania' | 'oberon'
  | 'francisco' | 'caliban' | 'stephano' | 's2023u1' | 'trinculo' | 'sycorax' | 'margaret' | 'prospero' | 'setebos' | 'ferdinand'
  | 'naiad' | 'triton' | 'nereid'
  | 'charon' | 'styx' | 'nix' | 'kerberos' | 'hydra';
export type BodyKey = PlanetKey | MoonKey;

export interface BodyInfo {
  key: BodyKey;
  name: string;
  radiusKm: number;             // mean (the sphere of equal volume)
  // The IAU triaxial ellipsoid, km along body-fixed X (0 deg longitude), Y
  // and Z (north pole): NAIF's pck00011 BODYnnn_RADII.
  radiiKm: [number, number, number];
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
  // Where a moon's numbers come from, for the data plate.
  moon?: { naif: number; elements: string; radiusNote?: string; gmNote?: string };
}

const COLOUR: Record<BodyKey, number> = {
  sun: 0xfff4e0, mercury: 0x8f8a85, venus: 0xe6d6ae, earth: 0x4a6d9c, moon: 0x9c9a95,
  mars: 0xb4623a, jupiter: 0xc9b48f, saturn: 0xd8c690, uranus: 0xa9d8de, neptune: 0x4b6fd0,
  pluto: 0xc9b49a,
  phobos: 0x6e655c, deimos: 0x8a7f72,
  io: 0xd8c66e, europa: 0xc9bca6, ganymede: 0x9d9286, callisto: 0x6f6556,
  mimas: 0xb5b2ad, enceladus: 0xf0f0ee, tethys: 0xd7d4cf, dione: 0xc9c6c0, rhea: 0xbdb9b2, titan: 0xd29b4a, iapetus: 0x8c8070,
  miranda: 0xa7a6a3, ariel: 0xb4b2ae, umbriel: 0x7a7874, titania: 0xa59f97, oberon: 0x928a82,
  triton: 0xd7c8bd, charon: 0x9e9a95,
  // The small moons: approximate, from their published colours and albedos
  // (Amalthea's red, Phoebe's and the irregular moons' dark grey, the
  // Trojan and co-orbital moons' bright ice).
  metis: 0x6e6660, adrastea: 0x6e6660, amalthea: 0x9a5a45, thebe: 0x7d6a5e,
  methone: 0xd6d3ce, telesto: 0xe2e0dc, calypso: 0xe2e0dc, helene: 0xdcdad5, polydeuces: 0xd6d3ce,
  hyperion: 0xa69a88, phoebe: 0x4f4b47,
  francisco: 0x5f5a55, caliban: 0x6a5a50, stephano: 0x5f5a55, s2023u1: 0x5f5a55, trinculo: 0x5f5a55,
  sycorax: 0x6a5a50, margaret: 0x5f5a55, prospero: 0x5f5a55, setebos: 0x5f5a55, ferdinand: 0x5f5a55,
  naiad: 0x8a8680, nereid: 0x9a9690,
  styx: 0xc8c6c2, nix: 0xc8c6c2, kerberos: 0xc8c6c2, hydra: 0xc8c6c2,
};

// Planet-only GMs from the NAIF satellite kernels' body tables (the
// SATORBINT fits; the kernel's own planetary ephemeris in brackets).
const PLANET_GM: Partial<Record<BodyKey, [number, string]>> = {
  mars: [KERNEL_PLANET_GM.mars, 'NAIF 499, mar099s (DE440)'],
  jupiter: [KERNEL_PLANET_GM.jupiter, 'NAIF 599, jup365 (DE440)'],
  saturn: [KERNEL_PLANET_GM.saturn, 'NAIF 699, sat441 (DE440)'],
  uranus: [KERNEL_PLANET_GM.uranus, 'NAIF 799, ura184 (DE442)'],
  neptune: [KERNEL_PLANET_GM.neptune, 'NAIF 899, nep097 (DE441)'],
  pluto: [KERNEL_PLANET_GM.pluto, 'NAIF 999, plu060 (DE440)'],
};

// Geometric albedo from the NASA NSSDCA planetary fact sheets (read
// 12 Nov 2026; pages updated Jan 2024 to May 2025).
const GEOMETRIC_ALBEDO: Partial<Record<BodyKey, number>> = {
  mercury: 0.142, venus: 0.689, earth: 0.434, moon: 0.12, mars: 0.170,
  jupiter: 0.538, saturn: 0.499, uranus: 0.488, neptune: 0.442, pluto: 0.52,
};

type PlanetRow = { name: string; radius: number; orbitalPeriod?: number };
const P = PLANETS as Record<string, PlanetRow>;

type MoonRow = { name: string; planet: string; naif: number; ephemeris: string; frame: string; P: number; radiusKm: number; radiusNote?: string; gm: number | null; gmNote?: string; geometricAlbedo: number | null };
const MOON_ROWS = MOON_DATA as unknown as Record<MoonKey, MoonRow>;
const GALILEAN = new Set<BodyKey>(['io', 'europa', 'ganymede', 'callisto']);

type BodyBase = Omit<BodyInfo, 'radiiKm'>;

function moon(key: MoonKey): BodyBase {
  const m = MOON_ROWS[key];
  return {
    key, name: m.name, radiusKm: m.radiusKm, gm: m.gm, gmNote: `NAIF ${m.naif}, JPL Horizons${m.gmNote ? ` (${m.gmNote})` : ''}`,
    geometricAlbedo: m.geometricAlbedo, periodDays: m.P, parent: m.planet as BodyKey, colour: COLOUR[key],
    moon: {
      naif: m.naif, radiusNote: m.radiusNote, gmNote: m.gmNote,
      elements: GALILEAN.has(key) ? "astronomy-engine's JupiterMoons (Lieske's E5 theory, as L1.2)"
        : `JPL mean elements (${m.ephemeris}, ${m.frame} frame), fitted to Horizons`,
    },
  };
}
const moonsOf = (planetKey: BodyKey): BodyBase[] =>
  (Object.keys(MOON_ROWS) as MoonKey[]).filter((k) => MOON_ROWS[k].planet === planetKey).map(moon);

function planet(key: Exclude<PlanetKey, 'sun' | 'moon'>): BodyBase {
  let gm: number | null = null;
  let gmNote = '';
  if (key === 'pluto') {
    gm = bodyConstants(key).mu;
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

const LIST: BodyBase[] = [
  { key: 'sun', name: 'Sun', radiusKm: 695700, gm: MU_SUN, gmNote: 'DE442', geometricAlbedo: null, periodDays: null, parent: null, colour: COLOUR.sun },
  planet('mercury'),
  planet('venus'),
  planet('earth'),
  { key: 'moon', name: 'Moon', radiusKm: 1737.4, gm: bodyConstants('moon').mu, gmNote: 'NAIF 301 (DE442)',
    geometricAlbedo: GEOMETRIC_ALBEDO.moon!,
    periodDays: 27.321661, parent: 'earth', colour: COLOUR.moon },
  planet('mars'), ...moonsOf('mars'),
  planet('jupiter'), ...moonsOf('jupiter'),
  planet('saturn'), ...moonsOf('saturn'),
  planet('uranus'), ...moonsOf('uranus'),
  planet('neptune'), ...moonsOf('neptune'),
  planet('pluto'), ...moonsOf('pluto'),
];
// pck00011 has no shape for Uranus's irregular moons and Pluto's small
// ones: they are spheres of their Horizons radius.
const RADII_KM = Object.fromEntries(LIST.map((b) => [b.key, (RADII as unknown as Record<string, [number, number, number]>)[b.key]
  ?? [b.radiusKm, b.radiusKm, b.radiusKm]])) as Record<BodyKey, [number, number, number]>;
export const BODIES: BodyInfo[] = LIST.map((b) => ({ ...b, radiiKm: RADII_KM[b.key] }));
// The largest semi-axis: nothing of the body lies farther from its centre.
export const maxRadiusKm = (key: BodyKey): number => Math.max(...RADII_KM[key]);

export const BODY_BY_KEY = Object.fromEntries(BODIES.map((b) => [b.key, b])) as Record<BodyKey, BodyInfo>;

// A moon of a planet other than Earth (src/physics/moons.js draws these).
export const isPlanetMoon = (key: BodyKey): key is MoonKey => !!BODY_BY_KEY[key].moon;

// The barycentres the camera can centre on (src/physics/barycentres.js):
// the solar system's, the Earth-Moon pair's, and each planet system's with
// moons drawn. `of` is the body it is listed and hidden behind; `viewKm`
// how far away the camera arrives, to frame the system about it.
export type BaryKey = 'ssb' | 'emb' | 'mars-bary' | 'jupiter-bary' | 'saturn-bary' | 'uranus-bary' | 'neptune-bary' | 'pluto-bary';
export type FocusKey = BodyKey | BaryKey;
export interface BaryInfo { key: BaryKey; name: string; short: string; of: BodyKey; viewKm: number; members: string }
export const BARYS: BaryInfo[] = [
  { key: 'ssb', name: 'Solar system barycentre', short: 'SSB', of: 'sun', viewKm: 6e6, members: 'the Sun, the planets, the Moon and Pluto' },
  { key: 'emb', name: 'Earth-Moon barycentre', short: 'EMB', of: 'earth', viewKm: 1.2e6, members: 'Earth and the Moon' },
  { key: 'mars-bary', name: 'Mars barycentre', short: 'Barycentre', of: 'mars', viewKm: 9e4, members: 'Mars, Phobos and Deimos' },
  { key: 'jupiter-bary', name: 'Jupiter barycentre', short: 'Barycentre', of: 'jupiter', viewKm: 5e6, members: 'Jupiter and its moons' },
  { key: 'saturn-bary', name: 'Saturn barycentre', short: 'Barycentre', of: 'saturn', viewKm: 3.5e6, members: 'Saturn and its moons' },
  { key: 'uranus-bary', name: 'Uranus barycentre', short: 'Barycentre', of: 'uranus', viewKm: 1.6e6, members: 'Uranus and its moons' },
  { key: 'neptune-bary', name: 'Neptune barycentre', short: 'Barycentre', of: 'neptune', viewKm: 1e6, members: 'Neptune and its moons' },
  { key: 'pluto-bary', name: 'Pluto barycentre', short: 'Barycentre', of: 'pluto', viewKm: 6e4, members: 'Pluto and its moons' },
];
export const BARY_BY_KEY = Object.fromEntries(BARYS.map((b) => [b.key, b])) as Record<BaryKey, BaryInfo>;
export const isBary = (key: FocusKey): key is BaryKey => key in BARY_BY_KEY;
export const focusName = (key: FocusKey): string => (isBary(key) ? BARY_BY_KEY[key].name : BODY_BY_KEY[key].name);
// The body whose system a focus belongs to (a moon's planet, a
// barycentre's body), for the rail's grouping.
export const systemOf = (key: FocusKey): BodyKey => (isBary(key) ? BARY_BY_KEY[key].of : isPlanetMoon(key) ? BODY_BY_KEY[key].parent! : key);
