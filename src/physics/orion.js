// src/physics/orion.js
//
// Orion's crew module for entry (entry.js): its mass, size, aerodynamics
// and parachutes, and each mission's entry (separation, target, and what was
// flown, for the checks). Every figure has its source; the ones the sources
// give only roughly are marked so.
//
// Sources:
// - Mass: Rea & Putnam 2007 (NTRS 20070023643), the design reference
//   LM606 entry mass, 20,369.2 lbm (9,239 kg). The flown entry masses are
//   not published.
// - Size: the heat shield's 16.5 ft (5.03 m) diameter (NASA Orion fact
//   sheets).
// - Aerodynamics: hypersonic trim L/D about 0.28 (Bibb et al., AIAA
//   2011-3506, NTRS 20110013644); EFT-1's reconstructed L/D 0.25-0.29
//   hypersonic, peaking near 0.35-0.4 around Mach 1.5-2, and CD falling from
//   about 1.3 at Mach 1.6 to about 0.9 at Mach 0.4 (Mazaheri, Bibb & Lessard,
//   IPPW 2026, NTRS 20260004998). The hypersonic CD (1.3) and the subsonic
//   L/D are this table's assumptions, not published values.
// - Parachutes: two 23 ft drogues at 25,000 ft, about 250 ft^2 of drag area
//   each when fully open (Ray 2017, NTRS 20170004357); three 116 ft ringsail
//   mains at 9,500 ft, about 10,900 ft^2 each (back-calculated from the
//   reefing ratios, Ray 2017) slowing Orion to about 17 mph (Artemis II press
//   kit). The mains open in three reefed stages over several seconds,
//   modelled as a 0.3 km ramp.

const FT = 0.3048;

export const ORION_CAPSULE = {
  mass: 9239,                                 // kg
  area: Math.PI * (5.03 / 2) ** 2,            // m^2, 19.87
  cd: 1.3,                                    // hypersonic, for the step limits
  aero: {
    mach: [0.4, 0.8, 1.2, 1.6, 2.0, 3.0, 5.0, 10.0, 30.0],
    cd:   [0.90, 1.05, 1.20, 1.30, 1.30, 1.30, 1.30, 1.30, 1.30],
    ld:   [0.10, 0.20, 0.30, 0.37, 0.37, 0.32, 0.29, 0.28, 0.26],
  },
  chutes: {
    drogue: { height: 25000 * FT / 1000, cda: 2 * 250 * FT * FT },
    main: { height: 9500 * FT / 1000, cda: 3 * 10900 * FT * FT },
    ramp: 0.3,
  },
};

// Each mission's entry: when the crew module leaves the service module (the
// craft becomes the capsule then), the guidance's target, the chutes'
// heights, and what was flown.

// The capsule for a mission: ORION_CAPSULE with that mission's chute
// heights.
export function orionFor(id) {
  const E = ORION_ENTRIES[id], c = ORION_CAPSULE;
  if (!E?.chuteHeights) return c;
  return { ...c, chutes: { ...c.chutes, drogue: { ...c.chutes.drogue, height: E.chuteHeights.drogue }, main: { ...c.chutes.main, height: E.chuteHeights.main } } };
}
export const ORION_ENTRIES = {
  artemis1: {
    separationMs: Date.parse('2022-12-11T17:00:00Z'),
    // AAS 24-174 (Rea, McNamara & Kane, NTRS 20240000024), Table 4, as the
    // search engine's text of the paper gives it: splashdown at 27.35 N,
    // 118.10 W, 2.1 nmi from the target (Spaceflight Now).
    target: { lat: 27.35, lon: -118.10 },
    // NASA's blog: mains at 9,500 ft at 17:37:26 and splashdown at 17:39:41.
    // Together they ask 21 m/s for the whole descent under the mains, where
    // the mains settle at 7.6 m/s; the published heights are kept.
    chuteHeights: { drogue: 25000 * FT / 1000, main: 9500 * FT / 1000 },
    flown: {
      source: 'NASA Artemis I blog (11 Dec 2022); AAS 24-174 (NTRS 20240001314)',
      eiMs: Date.parse('2022-12-11T17:20:14Z'),
      firstDipKm: 61,                         // "just below 200,000 ft"
      skipApogeeKm: 287.4e3 * FT / 1000,      // 87.6 km
      droguesMs: Date.parse('2022-12-11T17:36:06Z'),
      mainsMs: Date.parse('2022-12-11T17:37:26Z'),
      splashdownMs: Date.parse('2022-12-11T17:39:41Z'),
      splashdown: { lat: 27.35, lon: -118.10 },
    },
  },
  artemis2: {
    separationMs: Date.parse('2026-04-10T23:33:00Z'),
    // As flown, by NASA's day-of blog: drogues near 22,000 ft, mains near
    // 6,000 ft (the press kit's nominal 25,000 and 9,500 ft leave too little
    // time for the 8:04-to-8:07 pm descent under the mains).
    chuteHeights: { drogue: 22000 * FT / 1000, main: 6000 * FT / 1000 },
    // No published coordinates: "off the coast of San Diego", 40 to 60
    // miles out by press accounts. Approximate.
    target: { lat: 32.5, lon: -118.2 },
    approximateTarget: true,
    flown: {
      source: 'NASA Artemis II flight day 9-10 blogs; Artemis II press kit; SpacePolicyOnline',
      eiMs: Date.parse('2026-04-10T23:53:00Z'),
      skip: false,                            // a lofted entry, no climb back out
      droguesMs: Date.parse('2026-04-11T00:03:00Z'),
      mainsMs: Date.parse('2026-04-11T00:04:00Z'),
      splashdownMs: Date.parse('2026-04-11T00:07:00Z'),
    },
  },
};
