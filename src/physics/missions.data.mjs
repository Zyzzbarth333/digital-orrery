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
//   burnFloor  km/s in a 10 s step: every run of steps over it is a burn of
//              its own (MESSENGER's burns in parts), instead of a share of
//              the window's largest step
//   jumpKm     a step this far in position from the kernel's is an event,
//              whatever its velocity (MESSENGER's joins)
//   sunlightPieceDays  sunlight fitted along each coast arc in pieces this
//              long (MESSENGER's solar sailing)
//   fixHours   the app flies the file with a tracking fix this often;
//              fixesOnly: the validation doesn't fly it aimed as well
//   dense      windows fetched more finely: [{ from, to, step, about (the
//              body they are fetched about: the flyby's) }]
//   keep       the mission file's flown samples: { cruise (ms), near:
//              [{ body, km, every (ms) }] }
//   published  the burns as published: { name, utc (ignition, or null),
//              seconds, mps, engine, src (URL), note; eme: the change as a
//              J2000 vector, m/s; part: one part of a burn in parts }
//   flybys     { body, utc, altitudeKm, geodetic?, src, note }
//   craft      the app's craft: dryMass, fuel (kg at the start), area (m^2,
//              sunlit), cr, isp (s, for the mass falling at the burns)

const FT = 0.3048, MILE = 1.609344;

// MESSENGER's cruise burns, from APL's Mission Design page (its DSM and TCM
// tables and each burn's details): [name, start (UTC), seconds, engine,
// [x, y, z] m/s in EME2000, note]. TCM-4, 7, 8, 14 and 17 were contingency
// burns "never implemented"; DSM-n is TCM-9, 18, 23, 29A and B, 35.
const MD = 'https://messenger.jhuapl.edu/About/Mission-Design.html';
const FLYBY_SRC = 'https://messenger.jhuapl.edu/Resources/Flyby-Information.html';
const LVA = 'main engine (LVA)', SMALL = 'small thrusters';
const MESSENGER_BURNS = [
  ['TCM-1', '2004-08-24T21:00:07Z', 203.004, SMALL, [-7.82785, -15.06373, -5.67884], '17.9 m/s, "correct most inaccuracies resulting from launch"'],
  ['TCM-2', '2004-09-24T18:00:00Z', 62.86, SMALL, [0.08617, -4.18716, -1.8749], '4.6 m/s'],
  ['TCM-3', '2004-11-18T19:30:00Z', 48.86, SMALL, [2.2448, -2.18609, -0.85246], '3.2 m/s, "target the Earth flyby"'],
  ['TCM-5', '2005-06-23T14:30:00Z', 171.22, SMALL, [-0.5613, -0.94712, 0.0721], '1.1 m/s'],
  ['TCM-6', '2005-07-21T18:00:01Z', 22.46, SMALL, [-0.03712, -0.14553, 0.00918], '0.2 m/s in the table'],
  ['DSM-1', '2005-12-12T11:30:00Z', 553.00, LVA, [-250.24835, -190.46892, -26.86624], '315.6 m/s, "target the first Venus flyby"'],
  ['TCM-10', '2006-02-22T16:00:00Z', 135.00, SMALL, [-1.22761, 0.30129, 0.20595], '1.3 m/s'],
  ['TCM-11A', '2006-09-12T23:00:00Z', 54.88, SMALL, [-0.61577, -0.41682, -0.38011], 'TCM-11, 1.7 m/s, a "component maneuver"'],
  ['TCM-11B', '2006-09-12T23:10:00Z', 236.08, SMALL, [0.8496, -1.15986, -0.13865], ''],
  ['TCM-12', '2006-10-05T22:30:00Z', 64.60, SMALL, [-0.02321, -0.1242, -0.48526], '0.5 m/s'],
  ['TCM-13A', '2006-12-02T21:00:00Z', 1713.00, SMALL, [-2.7416, -6.0599, -3.6594], 'TCM-13, 25.6 m/s, a "component maneuver"; the reconstruction starts it 200 s early', null, 240],
  ['TCM-13B', '2006-12-02T22:00:00Z', 98.00, LVA, [18.276, -8.6036, 1.4328], ''],
  ['TCM-13C', '2006-12-03T03:00:00Z', 1599.00, SMALL, [-2.848, -6.1908, -3.9318], ''],
  ['TCM-15', '2007-04-25T17:30:00Z', 140.00, SMALL, [-0.4207, 0.0307, -0.387], '0.6 m/s'],
  ['TCM-16', '2007-05-25T16:00:00Z', 36.00, SMALL, [-0.0384, 0.2051, 0.0398], '0.2 m/s'],
  ['DSM-2A', '2007-10-17T22:00:00Z', 385.18, LVA, [-82.4506, 190.5891, 89.1642], 'DSM-2, 227.4 m/s, "target the first Mercury flyby", a "component maneuver"'],
  ['DSM-2B', '2007-10-17T22:30:00Z', 132.70, SMALL, [-0.4543, 1.2252, 0.5571], ''],
  ['TCM-19', '2007-12-19T22:00:00Z', 110.52, SMALL, [0.8635, -0.0392, 0.686], '1.1 m/s; the last TCM: after it, sunlight on the sunshade and arrays trimmed the course ("solar sailing")'],
  ['DSM-3', '2008-03-19T19:30:00Z', 151.00, LVA, [56.313, -44.0509, -10.2819], '72.2 m/s, "test spacecraft rotation during a maneuver as required for Mercury orbit insertion"'],
  // The page has 19:30; the trajectory has it at 20:30, an hour on, at
  // DSM-4B's time of day four days later: matched by its day.
  ['DSM-4A', null, 314.86, LVA, [188.21243, -97.0268, -66.90804], 'DSM-4 part 1, 222.1 m/s; the page gives 19:30:00 UTC, the trajectory 20:30', '2008-12-04'],
  ['DSM-4B', '2008-12-08T20:30:00Z', 71.80, LVA, [21.69828, -9.7764, -6.42], 'DSM-4 part 2, 24.7 m/s, a test of the turn during MOI'],
  ['DSM-5', '2009-11-24T21:45:00Z', 276.80, LVA, [172.87912, -11.97811, -39.69162], '177.75 m/s, "target Mercury arrival for orbit insertion"'],
  ['MOI', '2011-03-18T00:45:15Z', 885.04, LVA, [638.153, -198.322, 544.041], '861.7 m/s, "insert spacecraft into orbit around Mercury"; turned as it fired'],
].map(([name, utc, seconds, engine, eme, note, day, startTolS]) => ({
  name, utc, ...(day ? { day } : {}), ...(startTolS ? { startTolS } : {}), seconds, mps: Math.round(Math.hypot(...eme) * 1000) / 1000, eme, engine, src: MD, note,
  ...(/^(TCM-1[13]|DSM-2)[A-C]$/.test(name) ? { part: true } : {}),
}));

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
  messenger: {
    id: 'messenger',
    name: 'MESSENGER · cruise to Mercury',
    label: 'MESSENGER · cruise to Mercury, 2004–11',
    craftName: 'MESSENGER',
    summary: 'MESSENGER\'s six and a half years from the Earth to Mercury orbit: flybys of the Earth, Venus twice and Mercury three times, five deep-space burns on its main engine, and the 15-minute burn that put it into orbit about Mercury on 18 March 2011. Starts two days after launch; every burn is flown as MESSENGER flew it.',
    source: 'JHU/APL MESSENGER reconstruction msgr_20040803_20150501_od423sc_0, via JPL Horizons (-236)',
    horizons: '-236', centre: 'sun',
    span: ['2004-08-05 00:00', '2011-03-18 12:00'],
    step: '1h', threshold: 5e-6, coarseEnv: true, fine: 's10', finePadMs: 3600e3, minBurn: 0.1, burnFloor: 1e-5, jumpKm: 0.5,
    dense: [
      { from: '2005-08-02 07:00', to: '2005-08-03 07:00', step: '1m', about: 'earth' },
      { from: '2006-10-23 20:00', to: '2006-10-24 20:00', step: '1m', about: 'venus' },
      { from: '2007-06-05 11:00', to: '2007-06-06 11:00', step: '1m', about: 'venus' },
      { from: '2008-01-14 07:00', to: '2008-01-15 07:00', step: '1m', about: 'mercury' },
      { from: '2008-10-05 20:00', to: '2008-10-06 20:00', step: '1m', about: 'mercury' },
      { from: '2009-09-29 10:00', to: '2009-09-30 10:00', step: '1m', about: 'mercury' },
      // The approach to Mercury, MOI and the first orbit.
      { from: '2011-03-17 12:00', to: '2011-03-18 12:00', step: '1m', about: 'mercury' },
    ],
    keep: { cruise: 6 * 3600e3, near: [{ body: 'earth', km: 3e6, every: 600e3 }, { body: 'earth', km: 2e5, every: 60e3 }, { body: 'venus', km: 1e6, every: 600e3 }, { body: 'venus', km: 2e5, every: 60e3 }, { body: 'mercury', km: 5e5, every: 600e3 }, { body: 'mercury', km: 1e5, every: 60e3 }] },
    // APL's Mission Design page (MD) gives every burn's start, length,
    // effective thrust and Isp, masses, and its change as a vector in
    // EME2000 (J2000 equatorial, as these states): `eme`, m/s. A vector's
    // length is the change along the path (MOI's 861.716 m/s, which the
    // rocket equation gives from its masses), so a burn is compared by its
    // change along its path, and by direction. Its start times are the
    // commanded ones, on the quarter hour. Components of one burn (DSM-2's
    // main-engine 2A and its 2B on the small thrusters half an hour later)
    // are each their own entry (part: matched within ten minutes).
    published: MESSENGER_BURNS,
    flybys: [
      // APL's Flyby Information page: closest approach and its altitude;
      // its distances from the centre less the altitudes give 2439.4 km for
      // Mercury and 6051.8 for Venus (spheres), and 6366.7 at the Earth,
      // the WGS-84 ellipsoid's radius at the 46 degrees north of the pass
      // ("over central Mongolia", Horizons' notes).
      { body: 'earth', utc: '2005-08-02T19:13:08Z', altitudeKm: 2347.5, src: FLYBY_SRC, note: '"August 2, 2005, 19:13:08 UTC", "Altitude: 2347.5 km"' },
      { body: 'venus', utc: '2006-10-24T08:34:00Z', altitudeKm: 2987.3, src: FLYBY_SRC, note: '"October 24, 2006, 8:34:00 UTC", "Altitude: 2987.3 km"' },
      { body: 'venus', utc: '2007-06-05T23:08:19Z', altitudeKm: 338.3, src: FLYBY_SRC, note: '"June 5, 2007, 23:08:19 UTC", "Altitude: 338.3 km"' },
      { body: 'mercury', utc: '2008-01-14T19:04:39Z', altitudeKm: 201.7, src: FLYBY_SRC, note: '"January 14, 2008, 19:04:39 UTC", "Altitude: 201.7 km" (the MOI press kit: 201.4 km)' },
      { body: 'mercury', utc: '2008-10-06T08:40:22Z', altitudeKm: 199.5, src: FLYBY_SRC, note: '"October 6, 2008, 8:40:22 UTC", "Altitude: 199.5 km" (the press kit: 199.2)' },
      { body: 'mercury', utc: '2009-09-29T21:54:56Z', altitudeKm: 227.8, src: FLYBY_SRC, note: '"September 29, 2009, 21:54:56 UTC", "Altitude: 227.8 km" (the press kit: 227.5)' },
    ],
    // The orbit MOI reached: APL Technical Digest 34(1), Table 10 (the
    // result: a 12.071 h orbit, 206.77 km at its lowest, inclined 82.522
    // degrees; targeted 11.999 h, 200 km, 82.5).
    orbits: [{ after: 'MOI', body: 'mercury', periKm: 206.77, periodH: 12.071, src: 'https://jhuapl.edu/sites/default/files/2024-09/34-01-McAdams.pdf', note: 'Table 10: "Result 12.071 206.77 82.522"' }],
    // The MOI press kit: "Approximately 1,107 kilograms" at launch, "599.4
    // kilograms of propellant" and "507.6 kilograms of 'dry' spacecraft"; a
    // 2.5 m by 2 m sunshade (APL's spacecraft page) and two arrays "each
    // about 1.5 meters by 1.65 meters": 9.95 m^2 facing the Sun. The main
    // engine (LVA, a Leros-1b) as MD has it at MOI: 646 N effective, Isp
    // 314 s (the burns on the small thrusters ran at 95 to 230 s).
    craft: { dryMass: 507.6, fuel: 599.4, area: 2.5 * 2 + 2 * 1.5 * 1.65, cr: 1.3, isp: 314, thrust: 646 },
    craftSrc: 'https://www.nasa.gov/pdf/525164main_MercuryMOI_PK.pdf',
    sunlightPieceDays: 10,
    fixHours: 24, fixesOnly: true,
    checks: { burnPct: 1, burnMms: 10, burnDeg: 2, startS: 60, arcGain: 10, crFitPct: 30, piecesKm: 10, crAPct: 75, tiltDeg: 30, orbitPct: 5, flybyKm: 3, flybyKernelM: 200, flybyEndKm: 5, appEndKm: 15, appWorstKm: 500, appFlybyKm: 5, appAimedMps: 5 },
  },
};
export const FEET = FT, MILES = MILE;
