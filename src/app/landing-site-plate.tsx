// src/app/landing-site-plate.tsx
//
// The data plate for a landing site on the Moon the camera is on (chosen
// by its marker or the rail's list, src/scene/landingSites.ts): the
// mission, when it landed, its crew or rover, where it is and whose
// measurement that is, and how high the Sun stands there now. Each value
// carries its source tag, as on the bodies' plate.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { bodyState } from '../scene/OrreryScene';
import { SITE_SOURCES, TIME_SOURCES, MOON_RADIUS_KM, landedText, sunElevationDeg, type LandingSite } from '../physics/landingSites.js';
import { bodyAxesEqj } from '../physics/orientation.js';
import { eclToEqj } from '../physics/ephemeris.js';

const KIND = {
  crewed: 'Crewed landing', lander: 'Robotic landing', rover: 'Where a rover stopped',
  crash: 'Crash site', estimate: 'Estimated site, not found',
} as const;

// '0.67416° N' at the source's own precision.
const angle = (deg: number, pos: string, neg: string) => {
  const digits = Math.min(5, (String(Math.abs(deg)).split('.')[1] ?? '').length);
  return `${Math.abs(deg).toFixed(digits)}° ${deg < 0 ? neg : pos}`;
};

export function LandingSitePlate({ clock, site: s }: { clock: SimClock; site: LandingSite }) {
  const t = useClock(clock);
  const date = new Date(t.timeMs);
  const src = SITE_SOURCES[s.source];
  const timeSrc = s.timeSource ? { tag: s.timeSource === 'nasaBlueGhost' ? 'NASA' : 'NSSDCA', detail: TIME_SOURCES[s.timeSource] } : { tag: src.tag, detail: src.cite };
  // The Sun from the Moon's centre (its 1,737 km off the site changes the
  // angle by under 0.001°), in J2000.
  const moon = bodyState('moon', date).r;
  const sunDir = eclToEqj([-moon[0], -moon[1], -moon[2]]);
  const sun = sunElevationDeg(s, sunDir, bodyAxesEqj('moon', date));
  const estimate = s.kind === 'estimate';
  const where = estimate ? { src: src.tag, info: 'site-estimate' as const, detail: src.cite } : { src: src.tag, info: 'site-coords' as const, detail: src.cite };
  const rows: Row[] = [
    { label: s.kind === 'crash' || s.impact ? 'Came down' : 'Landed', value: landedText(s.landed), src: timeSrc.tag, info: 'site-landed', detail: timeSrc.detail },
    ...(s.crew ? [{ label: 'Crew', value: s.crew.join(' · '), alt: 'commander · lunar module pilot', src: 'NSSDCA', info: 'site-crew' } as Row] : []),
    ...(s.rover ? [{ label: 'Rover', value: s.rover, src: src.tag, info: 'site-coords', detail: src.cite } as Row] : []),
    { label: 'Latitude', value: angle(s.lat, 'N', 'S'), ...where },
    { label: 'Longitude', value: angle(s.lon, 'E', 'W'), ...where },
    ...(s.elevM !== undefined ? [{ label: 'Elevation', value: fmtGroup(s.elevM), unit: 'm', alt: `above ${fmtGroup(MOON_RADIUS_KM, 1)} km`, src: src.tag, info: 'site-elevation', detail: src.cite } as Row] : []),
    estimate
      ? { label: 'Uncertainty', value: 'kilometres', alt: 'not found in images', src: src.tag, info: 'site-estimate', detail: src.cite }
      : s.uncM !== undefined
        ? { label: 'Uncertainty', value: `± ${s.uncM < 10 ? s.uncM.toFixed(1) : fmtGroup(s.uncM)}`, unit: 'm', src: src.tag, info: 'site-coords', detail: src.cite }
        : { label: 'Uncertainty', value: 'not stated', alt: 'tens of metres', src: src.tag, info: 'site-coords', detail: src.cite },
    { label: 'Sun now', value: sun.toFixed(1), unit: '°', alt: sun < 0 ? 'night' : sun < 10 ? 'low: long shadows' : 'day', src: 'DE442', derived: true, info: 'site-sun' },
  ];
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{s.name}</h2>
        <p className="engraved">{KIND[s.kind]} · {s.agency} · {s.place}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        {s.note && <p>{s.note}</p>}
        <p>Coordinates: {src.cite}. <a href={src.url} target="_blank" rel="noreferrer">Source</a>.</p>
        <p>Drawn on the Moon's {fmtGroup(MOON_RADIUS_KM, 1)} km sphere, turned with its mean-Earth frame: within 85 m of SPICE. Choose a body in the rail to leave it.</p>
      </div>
    </div>
  );
}
