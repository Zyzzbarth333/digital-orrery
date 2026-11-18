// src/physics/missions.data.mjs
//
// The real missions beyond Artemis, as missions.build.mjs fetches and builds
// them and missions.validate.mjs checks them (docs/validation/<id>.md): each
// one's JPL Horizons trajectory, its span, and what was published about its
// burns and flybys, with sources. The machinery is in flown.lib.mjs.
//
// Fields:
//   horizons   the spacecraft's Horizons id
//   centre     'sun' or 'earth': the frame its states are kept in
//   span       [start, stop] UTC ('YYYY-MM-DD HH:MM')
//   step       the coarse step the whole span is fetched at, and the kernel
//              flies step by step to find the events
//   threshold  km/s: a step whose velocity is that far from the kernel's is
//              an event
//   fine       the step each event's window is fetched at, to resolve it
//   minBurn    m/s: events smaller than this are left as joins between the
//              navigation solutions, not burns
//   dense      windows fetched more finely: [{ from, to, step, about (the
//              body they are fetched about: the flyby's) }]
//   keep       the mission file's flown samples: { cruise (ms), near:
//              [{ body, km, every (ms) }] }
//   published  the burns as published: { name, utc (ignition, or null),
//              seconds, mps, engine, src (URL), note }
//   flybys     { body, utc, altitudeKm, geodetic?, src, note }
//   craft      the app's craft: dryMass, fuel (kg at the start), area (m^2,
//              sunlit), cr, isp (s, for the mass falling at the burns)

const FT = 0.3048, MILE = 1.609344;

export const MISSIONS = {
  juno2013: {
    id: 'juno2013',
    name: 'Juno · Earth flyby',
    label: 'Juno · DSMs and Earth flyby, 2012–13',
    craftName: 'Juno',
    summary: 'Juno\'s two deep-space burns in August and September 2012 and its Earth flyby of 9 October 2013, which sent it on to Jupiter. Starts in the deep-space cruise five days before the first burn; every burn is flown as Juno flew it.',
    source: 'JPL Juno navigation reconstruction spk_rec_110805_*_260824, via JPL Horizons (-61)',
    horizons: '-61', centre: 'sun',
    span: ['2012-08-25 01:00', '2013-11-30 00:00'],
    step: '1h', threshold: 5e-6, fine: 's10', finePadMs: 3600e3, minBurn: 0.05,
    dense: [{ from: '2013-10-09 13:00', to: '2013-10-10 01:00', step: '1m', about: 'earth' }],
    keep: { cruise: 6 * 3600e3, near: [{ body: 'earth', km: 3e6, every: 600e3 }, { body: 'earth', km: 2e5, every: 60e3 }] },
    published: [
      { name: 'DSM-1', utc: null, seconds: 29 * 60 + 39, mps: 344, engine: 'Leros-1b main engine',
        src: 'https://www.missionjuno.swri.edu/news/juno-performs-first-deep-space-maneuver',
        note: '29 min 39 s, "about 770 mph (344 meters a second)", 376 kg of propellant; the release gives 6:57 p.m. EDT (22:57 UTC), near the burn\'s end in the trajectory' },
      { name: 'DSM-2', utc: '2012-09-14T22:30:00Z', seconds: 30 * 60, mps: 388, engine: 'Leros-1b main engine',
        src: 'https://www.jpl.nasa.gov/news/junos-two-deep-space-maneuvers-are-back-to-back-home-runs/',
        note: '3:30 p.m. PDT, 30 min, "about 867 mph (388 meters a second)"' },
      { name: 'TCM-7', utc: null, seconds: null, mps: null, engine: 'attitude control thrusters', day: '2013-09-09',
        src: 'https://www.missionjuno.swri.edu/news/juno-refines-flight-path-with-trajectory-correction-maneuver',
        note: 'on 9 September 2013, on the attitude thrusters; no delta-v published' },
    ],
    flybys: [
      { body: 'earth', utc: '2013-10-09T19:21:00Z', altitudeKm: 559, src: 'https://www.planetary.org/articles/20131009-juno-flies-by-earth-today',
        note: '"347 miles (559 kilometers)"; 19:21 UTC from SwRI (https://www.swri.org/newsroom/press-releases/juno-spacecraft-slingshot-past-earth-en-route-jupiter)',
        // SwRI: from 126,000 to 140,000 km/h relative to the Sun; the press
        // kit (https://www.jpl.nasa.gov/news/press_kits/juno/overview/):
        // "boosted Juno's velocity by 16,330 mph (about 7.3 kilometers per
        // second)", the turn of its velocity about the Earth. Its 500 km is
        // the planned height, rounded.
        helioKmh: [126000, 140000], turnKms: 7.3 },
    ],
    // NASA's Juno press kit (Quick Facts): 3,625 kg at launch, "1,593
    // kilograms of spacecraft", 1,280 kg of fuel and 752 kg of oxidizer;
    // three solar arrays each 9 m by 2.65 m. The propellant here is the
    // launch load less TCM-1's 3.1 kg and an allowance for the attitude
    // control since (about 9 kg; not published). The engine's Isp from
    // DSM-1's 376 kg for 344 m/s by the rocket equation: 318 s.
    // The Leros-1b main engine: 645 N (the press kit's spacecraft page).
    // appCr: the app flies Juno with the sunlight the coast arcs fit (91 %
    // of Cr 1.3 on the arrays as built: they are not a plate facing the Sun).
    craft: { dryMass: 1593, fuel: 2020, area: 3 * 9 * 2.65, cr: 1.3, appCr: 1.18, isp: 318, thrust: 645 },
    craftSrc: 'https://www.jpl.nasa.gov/news/press_kits/juno/facts/',
    // Tolerances (docs/validation/juno2013.md says why each is what it is):
    // arcFittedKm, the worst coast arc with sunlight fitted (210 days in
    // the longest); arcGain, how far fitted sunlight must cut the rms from
    // gravity alone; crFitPct, the fitted sunlight against the craft as
    // built; flybyKm, the perigee against the published height (sources
    // differ by 3 km); flybyKernelM and flybyEndKm, the kernel through the
    // pass; anomalyMmS, the kernel's v_inf after the pass; app*, the file
    // flown as the app flies it, aimed.
    checks: { arcFittedKm: 500, arcGain: 10, crFitPct: 15, flybyKm: 3, flybyKernelM: 20, flybyEndKm: 0.1, anomalyMmS: 1, appEndKm: 5, appWorstKm: 500, appFlybyKm: 5, appAimedMps: 5 },
  },
  dart: {
    id: 'dart',
    name: 'DART · Dimorphos',
    label: 'DART · impact on Dimorphos, Sep 2022',
    craftName: 'DART',
    summary: 'DART\'s last five weeks to its impact on Dimorphos, the moonlet of the asteroid Didymos, on 26 September 2022: its final corrections, LICIACube\'s release and the autonomous guidance of its last hours, to the impact at 23:14:24 UTC, 6.14 km/s. Its last 44 s are the final solution, fitted to DART\'s last images; the craft flies to the published impact point.',
    source: 'DART navigation reconstruction (dart_2022_231_2022_269_rec_v03, dart_2022_269_2022_269_rec_v03) and final solution (dart_2022_269_2022_269_spc_v04), with Dimorphos (JPL s547), via JPL Horizons (-135)',
    horizons: '-135', centre: 'sun',
    // To the end of the last reconstructed segment (23:14:45.3 TDB): the
    // next, to the impact, is a separate solution 1.9 km along the track.
    span: ['2022-08-20 00:00', '2022-09-26 23:13:30'],
    // The final solution, from the last images, to the impact: fetched
    // about Dimorphos (Horizons' heliocentric states there are not
    // continuous with the reconstruction's) and placed on its ephemeris.
    final: { from: '2022-09-26 23:13:40', to: '2022-09-26 23:14:24' },
    step: '1h', threshold: 2e-6, fine: 's10', finePadMs: 3600e3, minBurn: 0.002,
    dense: [],
    keep: { cruise: 6 * 3600e3, near: [] },
    published: [
      { name: 'LICIACube release', utc: '2022-09-11T23:14:00Z', seconds: null, mps: null, engine: 'the cubesat\'s spring ejection',
        src: 'https://www.space.com/liciacube-readies-to-observe-dart-hit-asteroid', note: '"7:14 p.m. EDT (2314 GMT)"; no recoil published' },
      // Daly et al. (and arXiv:2303.02248): SMART Nav "took control" at
      // 19:09:24, "at 50 minutes prior to impact ... began maneuvering
      // towards Dimorphos", and its maneuvering "ended at 23:11:52 UTC".
      { name: 'SMART Nav terminal guidance', utc: null, day: '2022-09-26', seconds: null, mps: null, engine: 'hydrazine thrusters',
        towardMs: Date.parse('2022-09-26T23:14:24.183Z') - 50 * 60e3, endUtc: '2022-09-26T23:11:52Z',
        src: 'https://doi.org/10.1038/s41586-023-05810-5', note: 'autonomous from 19:09:24 UTC; toward Dimorphos from 50 minutes before the impact to 23:11:52 UTC (Daly et al.); the corrections\' sizes are not given there' },
    ],
    flybys: [],
    // Daly et al. 2023 (Nature 616, 443), Table 1.
    impact: {
      body: 'Dimorphos', horizons: '120065803', utc: '2022-09-26T23:14:24.183Z', utcErrS: 0.004,
      speedKms: 6.1449, speedErrKms: 0.0003, offsetM: 25, offsetErrM: 1, massKg: 579.4,
      smartNavUtc: '2022-09-26T19:09:24Z',
      src: 'https://doi.org/10.1038/s41586-023-05810-5',
      note: 'Daly et al., "Successful kinetic impact into an asteroid for planetary defence", Nature 616, 443 (2023), Table 1',
    },
    // Daly et al.: 579.4 kg at impact; the five weeks' burns (1.3 m/s on
    // hydrazine thrusters) use about 0.3 kg, under 0.1 % of the mass, so the
    // Isp is a nominal 230 s for a hydrazine thruster. The two ROSA arrays:
    // Daly et al. give 8.5 m long; 2.4 m wide is NASA's (secondary
    // sources), so 40.8 m^2 with the body's few m^2 left out.
    // appCr: as Juno's, the strength the coast arcs fit (72 % of Cr 1.3 on
    // the arrays' 40.8 m^2).
    craft: { dryMass: 579.4, fuel: 0.3, area: 2 * 8.5 * 2.4, cr: 1.3, appCr: 0.93, isp: 230 },
    craftSrc: 'https://doi.org/10.1038/s41586-023-05810-5',
    // Tolerances (docs/validation/dart.md): the arcs as Juno's; the fitted
    // sunlight within 30 % of the arrays as built (their width is from
    // secondary sources, and the body is left out); impactOffsetM, the final
    // solution's miss of the centre against the published 25 m; impactS,
    // how long after the published impact the centre's closest point may
    // come (the surface is struck first: 0.015 s is 90 m); appImpactKm, the
    // app's aimed DART from the centre (Dimorphos is 177 by 174 by 116 m).
    checks: { arcFittedKm: 25, arcGain: 10, crFitPct: 30, appEndKm: 1, appWorstKm: 100, appFlybyKm: 1, appAimedMps: 5, impactS: 0.015, impactOffsetM: 3, appImpactKm: 0.05 },
  },
  lro: {
    id: 'lro',
    name: 'LRO · lunar capture',
    label: 'LRO · capture at the Moon, June 2009',
    craftName: 'LRO',
    summary: 'The Lunar Reconnaissance Orbiter from the day after launch to its commissioning orbit, 18 to 28 June 2009: a four-and-a-half-day cruise, the 40-minute lunar orbit insertion burn, and four more burns down to a 30 by 216 km polar orbit, flown in the Moon\'s GRAIL field.',
    source: 'LRO final reconstructed trajectory (from the PDS), via JPL Horizons (-85)',
    horizons: '-85', centre: 'earth',
    span: ['2009-06-18 23:00', '2009-06-28 00:00'],
    // Every 10 minutes, flown in the full environment: in lunar orbit the
    // Moon's field beyond J2 moves LRO by metres a minute.
    step: '10m', threshold: 5e-6, coarseEnv: true, fine: 's10', finePadMs: 3600e3, minBurn: 0.1,
    dense: [],
    keep: { cruise: 600e3, near: [{ body: 'moon', km: 20000, every: 60e3 }] },
    published: [
      // Its 10 s samples ring (1.8 m/s of steps for 1.31 in sum), so its
      // length can't be resolved; the trajectory puts it at 22:20, four
      // minutes after the release's time.
      { name: 'Mid-course correction', utc: '2009-06-19T22:16:00Z', seconds: 38, mps: 1.3, engine: 'hydrazine thrusters', lengthUnresolved: true, utcTolS: 300, utcNote: 'the trajectory has it four minutes after the release\'s time',
        src: 'https://lroc.im-ldi.com/news/146', note: '"executed yesterday (June 19) at 6:16pm EDT", "fired for 38 seconds", "1.3 m/s"' },
      { name: 'LOI-1', utc: null, day: '2009-06-23', seconds: 40 * 60, mps: null, engine: 'four 80 N insertion thrusters', endUtc: '2009-06-23T10:26:26Z',
        src: 'https://lroc.im-ldi.com/news/147', note: '"completed a 40-minute Lunar Orbit Insertion (LOI) burn" at 6:26:26 a.m. EDT; no delta-v published' },
      // "four more small burns would occur over the next five days" (the
      // same release): named here after LOI-1, by day.
      ...['2009-06-24', '2009-06-25', '2009-06-26', '2009-06-27'].map((day, k) => ({ name: `LOI-${k + 2}`, utc: null, day, seconds: null, mps: null, engine: 'four 80 N insertion thrusters',
        src: 'https://lroc.im-ldi.com/news/147', note: 'one of "four more small burns ... over the next five days"; no time or delta-v published' })),
    ],
    // The orbits reached, about the Moon (heights above its mean radius).
    orbits: [
      { after: 'LOI-1', periKm: 220, apoKm: 3100, src: 'https://lroc.im-ldi.com/news/147', note: '"a 220 km by 3100 km (137 mile by 1926 mile) orbit"' },
      { after: 'last', periKm: 30, apoKm: 216, src: 'https://lroc.im-ldi.com/news/147', note: '"30 km by 216 km ... (Commissioning Phase Orbit)"' },
    ],
    // The Moon's field by degree, on the coast in the commissioning orbit.
    fieldDegrees: { body: 'moon', degrees: [2, 10, 20, 50, 100] },
    flybys: [],
    // The PDS catalog (LRO instrument host, insthost.cat): "less than 949 kg
    // dry and 1846 kg fully fueled", "894 kg of hydrazine (~ 1300 m/sec
    // delta-V capability)", four 80 N insertion thrusters, a 10.7 m^2 array.
    // The Isp from those: 1300 m/s over ln(1846 / 952): 200 s. The launch
    // load is kept; the cruise to the mid-course burn uses a few kg at most.
    craft: { dryMass: 949, fuel: 894, area: 10.7, cr: 1.3, isp: 200, thrust: 320 },
    craftSrc: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/insthost.cat',
    minArcH: 6,
    // Flown with a tracking fix every 6 h: aimed a day ahead across twelve
    // revolutions of a two-hour lunar orbit from tens of kilometres off, the
    // aims find costly phasing answers; its navigators worked each burn
    // from a fresh orbit determination.
    fixHours: 6,
    // Tolerances (docs/validation/lro.md): the arcs, under 6 h to 3 days,
    // within 1 km with sunlight fitted; orbitPct, an osculating orbit at one
    // instant against a published round figure, in the Moon's lumpy field;
    // fieldKm, the day-long coast at 200 km with the field to degree 100;
    // steadyOffMms, the velocity a burn fitted steady leaves at the sample
    // half an hour on; app*, the file flown with a fix every 6 h.
    checks: { arcFittedKm: 1, arcGain: 10, crFitPct: 20, appEndKm: 1, appWorstKm: 50, appFlybyKm: 1, appAimedMps: 1, orbitPct: 15, fieldKm: 0.05, steadyOffMms: 2000 },
  },
};
export const FEET = FT, MILES = MILE;
