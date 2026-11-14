// src/app/small-body-plate.tsx
//
// The data plate for a named asteroid or comet the camera is on (chosen by
// its marker in the sky or from the rail's list): where it is now, from the
// same elements and Kepler solve its point is drawn with
// (src/physics/smallBodies.js), and what JPL's Small-Body Database says of
// it. Each value carries its source tag, as on the bodies' plate.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { bodyState } from '../scene/OrreryScene';
import { jdOf, sizeOf, ASSUMED_ALBEDO, ASSUMED_COMET_KM, type Named } from '../scene/smallBodies';
import { smallBodyFacts, SB_CLASS_NAMES, SB_GROUPS } from '../physics/smallBodies.js';

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;
const DEG = 180 / Math.PI;

export function SmallBodyPlate({ clock, body: b }: { clock: SimClock; body: Named }) {
  const s = useClock(clock);
  const date = new Date(s.timeMs);
  const f = smallBodyFacts(b, jdOf(s.timeMs));
  const earth = bodyState('earth', date).r;
  const fromEarth = Math.hypot(f.r[0] * AU_KM - earth[0], f.r[1] * AU_KM - earth[1], f.r[2] * AU_KM - earth[2]);
  const comet = (SB_GROUPS.comets as string[]).includes(b.cls);
  const size = sizeOf(b);
  const lt = fromEarth / C_KM_S;
  const years = f.periodDays / 365.25;
  const rows: Row[] = [
    { label: 'Class', value: SB_CLASS_NAMES[b.cls as keyof typeof SB_CLASS_NAMES] ?? b.cls, alt: `SBDB ${b.cls}`, src: 'SBDB', info: 'sb-class' },
    { label: 'Motion', value: 'Kepler ellipse', alt: 'on rails, about the Sun', src: 'Kepler', derived: true, info: 'sb-position' },
    { label: 'From the Sun', value: f.dist.toFixed(6), unit: 'AU', alt: `${fmtGroup(f.dist * AU_KM)} km`, src: 'Kepler', derived: true, info: 'sb-position' },
    { label: 'Speed', value: f.speedKms.toFixed(3), unit: 'km/s', alt: 'heliocentric', src: '2-body', derived: true, info: 'sb-speed' },
    { label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', src: 'Kepler', derived: true, info: 'sb-position', detail: 'less the Earth\'s position (DE442)' },
    {
      label: 'Light time', value: lt < 60 ? lt.toFixed(3) : lt < 3600 ? (lt / 60).toFixed(2) : (lt / 3600).toFixed(3),
      unit: lt < 60 ? 's' : lt < 3600 ? 'min' : 'h', src: 'd/c', derived: true, info: 'light-time',
    },
    size.measured
      ? { label: 'Diameter', value: fmtGroup(size.diameterKm, size.diameterKm < 10 ? 2 : size.diameterKm < 100 ? 1 : 0), unit: 'km', src: 'SBDB', info: 'sb-diameter' }
      : {
        label: 'Diameter', value: 'not in SBDB', alt: `drawn ${fmtGroup(size.diameterKm, size.diameterKm < 10 ? 1 : 0)} km across, assumed`,
        src: 'assumed', derived: true, info: 'sb-size-assumed',
        detail: comet ? `a ${ASSUMED_COMET_KM} km nucleus` : `from H ${b.H} for an albedo of ${ASSUMED_ALBEDO}`,
      },
    ...(b.H === null ? [] : [comet
      ? { label: 'Total magnitude', value: b.H.toFixed(2), alt: 'M1', src: 'SBDB', info: 'sb-m1' } as Row
      : { label: 'Absolute magnitude', value: b.H.toFixed(2), alt: 'H', src: 'SBDB', info: 'sb-h' } as Row]),
    { label: 'Semi-major axis', value: b.a.toFixed(6), unit: 'AU', src: 'Horizons', info: 'sb-elements', detail: b.elements },
    { label: 'Eccentricity', value: b.e.toFixed(6), src: 'Horizons', info: 'sb-elements', detail: b.elements },
    { label: 'Inclination', value: (b.i * DEG).toFixed(3), unit: '°', alt: 'to the ecliptic', src: 'Horizons', info: 'sb-elements', detail: b.elements },
    { label: 'Perihelion', value: f.perihelion.toFixed(4), unit: 'AU', alt: `aphelion ${f.aphelion.toFixed(4)} AU`, src: '2-body', derived: true, info: 'sb-apsides' },
    { label: 'Orbital period', value: years < 2 ? fmtGroup(f.periodDays, 1) : fmtGroup(years, years < 100 ? 3 : 1), unit: years < 2 ? 'd' : 'yr', src: '2-body', derived: true, info: 'sb-period' },
  ];
  const kind = b.kind.charAt(0).toUpperCase() + b.kind.slice(1);
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{b.name}</h2>
        <p className="engraved">{kind}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        <p>Drawn on a fixed ellipse from its elements at 2026-01-01: a fair place for months, not for navigation. Choose a body in the rail to leave it.</p>
      </div>
    </div>
  );
}
