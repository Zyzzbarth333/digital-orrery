// src/app/landing-site-plate.tsx
//
// The data plate for a landing site (chosen by its marker, the rail's
// list or FIND, src/scene/landingSites.ts): the mission, when it landed,
// struck or went in, its crew or rover, where it is and whose measurement
// that is, and how high the Sun stands there now. Each value carries its
// source tag, as on the bodies' plate.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { usePeek } from './peek';
import { bodyState } from '../scene/OrreryScene';
import { BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { SITE_SOURCES, TIME_SOURCES, MOON_RADIUS_KM, SMALL_BODY_NAMES, landedText, sunElevationDeg, siteBody, siteRadii, onSmallBody, type LandingSite } from '../physics/landingSites.js';
import { bodyAxesEqj } from '../physics/orientation.js';
import { eclToEqj } from '../physics/ephemeris.js';

const KIND: Record<LandingSite['kind'], string> = {
  crewed: 'Crewed landing', lander: 'Robotic landing', rover: 'Where a rover stopped',
  crash: 'Crash site', estimate: 'Estimated site, not found', impact: 'Impact, on purpose',
  entry: 'Atmospheric entry', touch: 'Touchdown',
};
// What the time row is called for each kind.
const WHEN: Record<LandingSite['kind'], string> = {
  crewed: 'Landed', lander: 'Landed', rover: 'Landed', crash: 'Came down', estimate: 'Landed',
  impact: 'Struck', entry: 'Entered', touch: 'Touched down',
};

// '0.67416° N' at the source's own precision.
const angle = (deg: number, pos: string, neg: string) => {
  const digits = Math.min(5, (String(Math.abs(deg)).split('.')[1] ?? '').length);
  return `${Math.abs(deg).toFixed(digits)}° ${deg < 0 ? neg : pos}`;
};

// The body's name: a planet or moon's, or the small body's.
export const siteBodyName = (s: LandingSite): string => {
  const b = siteBody(s);
  return b.startsWith('sb:') ? SMALL_BODY_NAMES[b] ?? b.slice(3) : BODY_BY_KEY[b as BodyKey].name;
};

export function LandingSitePlate({ clock, site: s }: { clock: SimClock; site: LandingSite }) {
  const t = useClock(clock);
  const date = new Date(t.timeMs);
  const src = SITE_SOURCES[s.source];
  const body = siteBody(s), moon = body === 'moon', small = onSmallBody(s);
  const bodyName = siteBodyName(s);
  const ts = s.timeSource;
  const timeSrc = !ts ? { tag: src.tag, detail: src.cite }
    : ts in SITE_SOURCES ? { tag: SITE_SOURCES[ts].tag, detail: SITE_SOURCES[ts].cite }
      : { tag: ts === 'nasaBlueGhost' ? 'NASA' : 'NSSDCA', detail: TIME_SOURCES[ts] };
  // The Sun from the body's centre (the site's offset changes the angle
  // by under 0.01° on the Moon), in J2000. A small body has no frame.
  let sun: number | null = null;
  if (!small) {
    const r = bodyState(body as BodyKey, date).r;
    sun = sunElevationDeg(s, eclToEqj([-r[0], -r[1], -r[2]]), bodyAxesEqj(body, date));
  }
  const estimate = s.kind === 'estimate';
  const info = estimate ? 'site-estimate' as const : moon ? 'site-coords' as const : small ? 'site-small-body' as const : 'site-coords-body' as const;
  const where = { src: src.tag, info, detail: src.cite };
  const radii = siteRadii(s);
  const ref = moon ? `above ${fmtGroup(MOON_RADIUS_KM, 1)} km` : body === 'mars' ? 'above the MOLA areoid' : 'above the reference surface';
  const rows: Row[] = [
    { label: s.kind === 'crash' || s.impact ? 'Came down' : WHEN[s.kind], value: landedText(s.landed), src: timeSrc.tag, info: 'site-landed', detail: timeSrc.detail },
    ...(s.crew ? [{ label: 'Crew', value: s.crew.join(' · '), alt: 'commander · lunar module pilot', src: 'NSSDCA', info: 'site-crew' } as Row] : []),
    ...(s.rover ? [{ label: 'Rover', value: s.rover, ...where } as Row] : []),
    { label: 'Latitude', value: angle(s.lat, 'N', 'S'), ...(s.frame ? { alt: s.frame } : {}), ...where },
    { label: 'Longitude', value: angle(s.lon, 'E', 'W'), ...where },
    ...(s.elevM !== undefined ? [{ label: 'Elevation', value: fmtGroup(s.elevM), unit: 'm', alt: ref, src: src.tag, info: 'site-elevation', detail: src.cite } as Row] : []),
    estimate
      ? { label: 'Uncertainty', value: s.uncKm !== undefined ? `± ${fmtGroup(s.uncKm)}` : 'kilometres', ...(s.uncKm !== undefined ? { unit: 'km' } : {}), alt: 'not found in images', src: src.tag, info: 'site-estimate', detail: src.cite }
      : s.uncM !== undefined
        ? { label: 'Uncertainty', value: `± ${s.uncM < 10 ? s.uncM.toFixed(1) : fmtGroup(s.uncM)}`, unit: 'm', ...where }
        : s.uncKm !== undefined
          ? { label: 'Uncertainty', value: `± ${fmtGroup(s.uncKm)}`, unit: 'km', ...where }
          : { label: 'Uncertainty', value: 'not stated', ...(moon ? { alt: 'tens of metres' } : {}), ...where },
    ...(sun !== null ? [{ label: 'Sun now', value: sun.toFixed(1), unit: '°', alt: sun < 0 ? 'night' : sun < 10 ? 'low: long shadows' : 'day', src: 'DE442', derived: true, info: 'site-sun' } as Row] : []),
  ];
  const drawn = moon
    ? `Drawn on the Moon's ${fmtGroup(MOON_RADIUS_KM, 1)} km sphere, turned with its mean-Earth frame: within 85 m of SPICE.`
    : small
      ? `${bodyName} is drawn as a sphere of its size with no rotation model, so the site is not marked on it; the camera goes to the body.`
      : `Drawn on ${bodyName}'s reference ${radii && radii[0] !== radii[2] ? `ellipsoid (${fmtGroup(radii[0], 0)} × ${fmtGroup(radii[2], 0)} km)` : `sphere (${fmtGroup(radii![0], 1)} km)`}, turned with its IAU rotation model.`;
  // The phone's peek: the body it is on, and when it landed.
  usePeek([{ label: 'On', value: bodyName, ...where }, rows[0]]);
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{s.name}</h2>
        <p className="engraved">{KIND[s.kind]} · {s.agency} · {moon ? s.place : `${bodyName}, ${s.place}`}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        {s.note && <p>{s.note}</p>}
        <p>Coordinates: {src.cite}. <a href={src.url} target="_blank" rel="noreferrer">Source</a>.</p>
        <p>{drawn} Choose a body in the rail to leave it.</p>
      </div>
    </div>
  );
}
