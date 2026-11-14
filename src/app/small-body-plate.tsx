// src/app/small-body-plate.tsx
//
// The data plate for a named asteroid or comet the camera is on (chosen by
// its marker in the sky or from the rail's list): where it is now, as its
// point is drawn (src/physics/smallBodies.js: JPL's SB441 for the largest,
// the 2026 ellipse for the rest), and what JPL's Small-Body Database says
// of it. Each value carries its source tag, as on the bodies' plate.

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
  // From SB441's table (the largest asteroids and a few named others), or
  // the fixed 2026 ellipse.
  const pos = f.exact ? { src: 'SB441', info: 'sb-position-exact' as const } : { src: 'Kepler', info: 'sb-position' as const };
  const els = f.exact
    ? { src: 'SB441', info: 'sb-elements-exact' as const, detail: 'osculating now, from JPL\'s SB441' }
    : { src: 'Horizons', info: 'sb-elements' as const, detail: b.elements };
  const rows: Row[] = [
    { label: 'Class', value: SB_CLASS_NAMES[b.cls as keyof typeof SB_CLASS_NAMES] ?? b.cls, alt: `SBDB ${b.cls}`, src: 'SBDB', info: 'sb-class' },
    f.exact
      ? { label: 'Motion', value: 'JPL integration', alt: 'SB441, on rails', ...pos, derived: true }
      : { label: 'Motion', value: 'Kepler ellipse', alt: 'on rails, about the Sun', ...pos, derived: true },
    { label: 'From the Sun', value: f.dist.toFixed(6), unit: 'AU', alt: `${fmtGroup(f.dist * AU_KM)} km`, ...pos, derived: true },
    { label: 'Speed', value: f.speedKms.toFixed(3), unit: 'km/s', alt: 'heliocentric', src: '2-body', derived: true, info: 'sb-speed' },
    { label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', ...pos, derived: true, detail: 'less the Earth\'s position (DE442)' },
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
    { label: 'Semi-major axis', value: f.a.toFixed(6), unit: 'AU', ...els },
    { label: 'Eccentricity', value: f.e.toFixed(6), ...els },
    { label: 'Inclination', value: (f.i * DEG).toFixed(3), unit: '°', alt: 'to the ecliptic', ...els },
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
        <p>{f.exact
          ? 'Placed by JPL\'s SB441 integration (within 1 km of it, 2000–2050); its gravity is in the spacecraft kernel if it is one of the sixteen heaviest. Choose a body in the rail to leave it.'
          : 'Drawn on a fixed ellipse from its elements at 2026-01-01: a fair place for months, not for navigation. Choose a body in the rail to leave it.'}</p>
      </div>
    </div>
  );
}
