// scripts/plates-worst.tsx: the right-hand plates and FIND fed the worst
// realistic data, beside the demo data, for a look at what breaks.
//
// A dev-only page, never built: `npm run dev`, then
// /scripts/plates-worst.html?plate=sat&data=worst. ?plate picks the plate
// (the segments at the foot), ?data the fixture: demo, the kind the plates
// were drawn against, or worst, the longest names in the snapshots, the
// missing fields and the far and still numbers. Each fixture enters where
// the app's own data does: the plates' props, and FIND's api.
//
// The page lays the plate out in the app's own grid (.app), so it has the
// width it has in the app: 380 px, 330 px under 1,100 px, the full width
// on a phone.

import { StrictMode, useMemo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/michroma/400.css';
import '@fontsource/b612/400.css';
import '@fontsource/b612/700.css';
import '@fontsource/b612-mono/400.css';
import '../src/app/app.css';
import { loadDeTable } from '../src/physics/deLoad.js';
import { installMoonLoader } from '../src/physics/moonLoad.js';
import { SimClock } from '../src/app/clock';
import { Plate } from '../src/app/panels';
import { FindField, type FindApi, type FindHit } from '../src/app/find';
import { SatellitePlate, SatCloudPlate, type PlateSat } from '../src/app/satellite-plate';
import { SpacecraftPlate } from '../src/app/spacecraft-plate';
import { LandingSitePlate } from '../src/app/landing-site-plate';
import { GuidePlate, type GuidePick } from '../src/app/guide-plate';
import { parseGpCsv, satrecOf } from '../src/physics/satellites.js';
import { LANDING_SITES } from '../src/physics/landingSites.js';
import { IRREGULAR_MOONS } from '../src/scene/irregularMoons';
import { BODIES, type FocusKey } from '../src/scene/catalogue';
import type { Named } from '../src/scene/smallBodies';
import type { NamedSat, SatCloudView } from '../src/scene/satellites';
import type { Probe, SpacecraftLayer } from '../src/scene/spacecraftLayer';

type Data = 'demo' | 'worst';
const PLATES = ['sat', 'cloud', 'probe', 'small', 'irregular', 'site', 'guide', 'body', 'bary'] as const;
type PlateKind = typeof PLATES[number];

const q = new URLSearchParams(location.search);
const data: Data = q.get('data') === 'worst' ? 'worst' : 'demo';
const plate: PlateKind = (PLATES as readonly string[]).includes(q.get('plate') ?? '') ? q.get('plate') as PlateKind : 'sat';

// ---- Satellites: rows of the snapshot's own CSV (public/data). ----------
const HEAD = 'OBJECT_NAME,OBJECT_ID,EPOCH,MEAN_MOTION,ECCENTRICITY,INCLINATION,RA_OF_ASC_NODE,ARG_OF_PERICENTER,MEAN_ANOMALY,EPHEMERIS_TYPE,CLASSIFICATION_TYPE,NORAD_CAT_ID,ELEMENT_SET_NO,REV_AT_EPOCH,BSTAR,MEAN_MOTION_DOT,MEAN_MOTION_DDOT';
const CSV = {
  iss: 'ISS (ZARYA),1998-067A,2026-11-17T20:24:46.153152,15.49442652,.00073639,51.6318,259.6690,37.3950,322.7550,0,U,25544,999,59557,.20178513E-3,.10861E-3,0',
  // The longest name in the active set, 37 characters.
  long: 'DB GME UT (DB-GLOBE MISSION EARTH-UT),2026-067AV,2026-11-17T02:27:36.558144,15.18983443,.00038404,97.4754,277.3687,245.5437,114.5397,0,U,68459,999,3513,.29828447E-3,.6172E-4,0',
  // The debris piece with the oldest epoch: over a week old.
  deb: 'COSMOS 2251 DEB,1993-036AUA,2026-10-29T05:42:06.314976,14.50688475,.0077326,73.9775,262.0013,338.5349,21.2573,0,U,35887,999,69169,.12986E-2,.5277E-4,0',
  // Geosynchronous: its ground speed rounds to 0.000 km/s.
  geo: 'TDRS 3,1988-091B,2026-11-16T22:16:39.891936,1.00269591,.00417754,12.4889,339.9868,351.9538,9.4493,0,U,19548,999,12692,0,-.287E-5,0',
};
const sat = (row: string, named: Omit<NamedSat, 'id'>): PlateSat => {
  const omm = parseGpCsv(`${HEAD}\n${row}`)[0];
  return { omm, rec: satrecOf(omm), named: { id: omm.NORAD_CAT_ID, ...named } };
};
const SAT_SOURCE = { label: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=csv', fetched: '2026-11-18T05:22:12.352Z', live: false };

const CLOUD: SatCloudView = {
  key: 'cosmos-2251', name: 'Cosmos 2251', intdes: '1993-036', event: 'Collided with Iridium 33', date: '2009-02-10',
  query: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=cosmos-2251-debris&FORMAT=csv', count: 582,
  tracked: 582, fetched: '2026-11-18T05:22:12.352Z', perigee: [612, 748, 1021], apogee: [802, 905, 1488], incl: [73.9, 74.0, 74.1], aKm: 7208,
  epochs: { first: '2026-10-29T05:42:06.314Z', median: '2026-11-17T12:17:45.004Z', last: '2026-11-18T00:02:29.704Z' },
} as SatCloudView;

// ---- Spacecraft: the index's own entries, and a layer that places them. --
const PROBES: Record<Data, Probe> = {
  demo: { key: 'lro', name: 'Lunar Reconnaissance Orbiter', short: 'LRO', id: -85, group: 'moon', centre: 'moon', target: null, revised: 'Oct 07, 2026', days: 700, spacingMin: [10, 1440], maxErrKm: 1.2, conicDays: 0, legs: [] },
  // Voyager 1: 2.5e10 km out, its last revision four years old.
  worst: { key: 'voyager1', name: 'Voyager 1', short: 'Voyager 1', id: -31, group: 'cruise', centre: 'sun', target: null, revised: null, days: 700, spacingMin: null, maxErrKm: 1.99, conicDays: 424,
    legs: [{ name: 'bc_mpo_fcp_00241_20181020_20270411_v01', start: '2018-Oct-20 02:14', stop: '2027-Apr-10 23:59' }] },
};
const probeLayer = (d: Data) => ({
  tolKm: 2,
  stateAbout: () => (d === 'demo'
    ? { r: [1837.4, 0, 0], v: [0, 1.633, 0], centre: 'moon' }
    : { r: [-3.1e9, -1.02e10, 2.31e10], v: [0, 0, -0.0004], centre: 'sun' }),
  positionKm: () => (d === 'demo' ? [1.3e8, 6.9e7, 0] : [-3.1e9, -1.02e10, 2.31e10]),
}) as unknown as SpacecraftLayer;

// ---- Asteroids and comets: as smallBodies.ts adopts them. ----------------
const SMALL: Record<Data, Named> = {
  demo: { pdes: '433', name: '433 Eros', kind: 'asteroid', cls: 'AMO', a: 1.458, e: 0.2229, i: 0.1887, node: 5.4, peri: 3.11, M: 2.1, H: 10.4, diameter: 16.84, elements: 'SBDB at 2026-01-01, as packed (angles to 0.0055°)' },
  // The longest name in the index; no diameter, no magnitude.
  worst: { pdes: 'C/1955 N1', name: 'Bakharev-Macfarlane-Krienke (C/1955 N1)', kind: 'comet', cls: 'COM', a: 248.1928, e: 0.99425, i: 0.87323, node: 5.29644, peri: 0.23068, M: 0.11323, H: null, diameter: null, elements: 'SBDB at 2026-01-01, as packed (angles to 0.0055°)' },
};
// An asteroid with an H but no diameter, and one with neither (a TNO from
// the index's far end): ?plate=small&data=worst&b=2
const SMALL_MORE: Named[] = [
  { pdes: '2014 FE72', name: '2014 FE72', kind: 'trans-Neptunian object', cls: 'TNO', a: 2686.856, e: 0.98659, i: 0.35953, node: 5.87725, peri: 2.33936, M: 0.00268, H: 6.14, diameter: null, elements: 'SBDB at 2026-01-01, as packed (angles to 0.0055°)' },
  { pdes: '2014 FE72', name: '2014 FE72', kind: 'trans-Neptunian object', cls: 'TNO', a: 2686.856, e: 0.98659, i: 0.35953, node: 5.87725, peri: 2.33936, M: 0.00268, H: null, diameter: null, elements: 'SBDB at 2026-01-01, as packed (angles to 0.0055°)' },
  // The longest unbroken run in a named one's title: "67P/Churyumov-".
  { pdes: '67P', name: '67P/Churyumov-Gerasimenko', kind: 'comet', cls: 'JFc', a: 3.458760542962808, e: 0.6496988103385752, i: 0.06749632295753466, node: 0.6336338481741616, peri: 0.3879110930628191, M: 4.0652866302911495, H: 12.9, diameter: null, elements: 'JPL Horizons at the epoch' },
];

// ---- The rest come from the app's own catalogues. ------------------------
const irregular = (d: Data) => IRREGULAR_MOONS.find((m) => m.name === (d === 'demo' ? 'Himalia' : 'S/2023 S 38'))!;
const site = (d: Data) => LANDING_SITES.find((s) => s.key === (d === 'demo' ? 'apollo11' : q.get('b') === '2' ? 'near' : 'perseverance'))!;
const GUIDE: Record<Data, GuidePick> = {
  demo: { cls: 'guide-tag lpoint', text: 'Earth L1', title: 'Sun–Earth L1', focus: 'earth' },
  worst: { cls: 'guide-tag mag-pole', text: 'MP 63.7 RJ', title: "Jupiter's magnetopause (Joy et al. 2002, compressed solar wind), 63.7 RJ toward the Sun, for a dynamic pressure of 0.039 nPa. Field lines past it are cut there", focus: 'jupiter' },
};
const bodyFocus = (d: Data): FocusKey => (d === 'demo' ? 'mars' : (BODIES.find((b) => b.moon && !b.gm)?.key ?? 'deimos'));

// ---- FIND: hits as App.tsx makes them. -----------------------------------
const hit = (group: FindHit['group'], label: string, kind: string): FindHit => ({ id: `${group}:${label}`, group, label, kind, pick: () => null });
const HITS: Record<Data, FindHit[]> = {
  demo: [hit('bodies', 'Mars', 'planet'), hit('small', '433 Eros', 'asteroid'), hit('satellites', 'ISS (ZARYA) · 25544', 'satellite')],
  worst: [
    hit('bodies', 'Solar system barycentre', 'barycentre'),
    hit('irregular', 'S/2023 S 38', 'moon of Saturn, retrograde'),
    hit('irregular', 'Philophrosyne', 'moon of Jupiter, retrograde'),
    hit('small', 'Bakharev-Macfarlane-Krienke (C/1955 N1)', 'comet'),
    hit('small', 'Tsuchinshan-ATLAS (C/2023 A3)', 'comet'),
    hit('small', '67P/Churyumov-Gerasimenko', 'Jupiter-family comet'),
    hit('satellites', 'DB GME UT (DB-GLOBE MISSION EARTH-UT) · 68459', 'satellite'),
    hit('satellites', 'COSMOS 2251 DEB · 35887', 'debris, Cosmos 2251'),
    hit('satellites', 'INMARSAT 2-F2 R/B(PAM-D) · 21140', 'rocket body'),
    hit('spacecraft', 'Nancy Grace Roman Space Telescope', 'spacecraft near the Sun-Earth line'),
    hit('sites', 'Octavia E. Butler Landing, Jezero crater', 'rover on Mars, 2021'),
  ],
};
const findApi = (d: Data): FindApi => ({ now: () => HITS[d], later: async () => [], load: () => [Promise.resolve(true)] });

// ---- The page. -----------------------------------------------------------
function Segments<T extends string>({ name, values, value }: { name: string; values: readonly T[]; value: T }) {
  const href = (v: T) => { const u = new URLSearchParams(location.search); u.set(name, v); u.delete('b'); return `?${u}`; };
  return (
    <span className="seg">
      {values.map((v) => <a key={v} href={href(v)} aria-current={v === value || undefined}>{v}</a>)}
    </span>
  );
}

function Page({ clock }: { clock: SimClock }) {
  const sats = useMemo(() => ({
    demo: sat(CSV.iss, { name: 'ISS (ZARYA)', group: 'station' }),
    worst: [
      sat(CSV.long, { name: 'DB GME UT (DB-GLOBE MISSION EARTH-UT)', group: 'found', layer: 'active' }),
      sat(CSV.deb, { name: 'COSMOS 2251 DEB', group: 'found', layer: 'debris' }),
      sat(CSV.geo, { name: 'TDRS 3', group: 'found', layer: 'active' }),
    ][Number(q.get('b') ?? 1) - 1] ?? sat(CSV.long, { name: 'DB GME UT (DB-GLOBE MISSION EARTH-UT)', group: 'found', layer: 'active' }),
  }), []);
  let inner: ReactNode = null, small: Named | null = null, irr = null, focus: FocusKey = 'mars';
  if (plate === 'sat') inner = <SatellitePlate clock={clock} sat={sats[data]} source={data === 'worst' ? SAT_SOURCE : null} />;
  else if (plate === 'cloud') inner = <SatCloudPlate cloud={CLOUD} />;
  else if (plate === 'probe') inner = <SpacecraftPlate clock={clock} probe={PROBES[data]} layer={probeLayer(data)} />;
  else if (plate === 'small') small = data === 'demo' ? SMALL.demo : (SMALL_MORE[Number(q.get('b')) - 1] ?? SMALL.worst);
  else if (plate === 'irregular') irr = irregular(data);
  else if (plate === 'site') inner = <LandingSitePlate clock={clock} site={site(data)} />;
  else if (plate === 'guide') inner = <GuidePlate clock={clock} pick={GUIDE[data]} />;
  else if (plate === 'body') focus = bodyFocus(data);
  else if (plate === 'bary') focus = data === 'demo' ? 'mars-bary' : 'ssb';
  return (
    <div className="app">
      <header className="band screw"><span className="hint">Plates, worst case: a dev page, not the app</span></header>
      <div className="scene-host" />
      <nav className="rail screw"><FindField key={data} api={findApi(data)} /></nav>
      <Plate clock={clock} focus={focus} small={small} irregular={irr} sat={inner} />
      <div className="dev-toggle">
        <Segments name="data" values={['demo', 'worst'] as const} value={data} />
        <Segments name="plate" values={PLATES} value={plate} />
      </div>
    </div>
  );
}

// The toggle is chrome, not the design under test: plain and neutral.
const style = document.createElement('style');
style.textContent = `
.dev-toggle { position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 100; display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: calc(100vw - 16px); font: 12px system-ui, sans-serif; }
.seg { display: inline-flex; flex-wrap: wrap; background: #ddd; border-radius: 6px; padding: 2px; }
.seg a { padding: 3px 8px; border-radius: 4px; color: #333; text-decoration: none; }
.seg a[aria-current] { background: #fff; color: #000; }
.scene-host { background: #000; }`;
document.head.append(style);

installMoonLoader();
void loadDeTable().then(() => {
  // A fixed instant, so before and after compare.
  const clock = new SimClock(Date.parse('2026-11-19T03:00:00Z'));
  clock.setPlaying(false);
  createRoot(document.getElementById('root')!).render(<StrictMode><Page clock={clock} /></StrictMode>);
});
