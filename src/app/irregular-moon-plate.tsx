// src/app/irregular-moon-plate.tsx
//
// The data plate for an irregular moon the camera is on (chosen by its
// marker or the rail's list): where it is about its planet now, as its point
// is drawn (src/physics/irregularMoons.js: JPL's satellite ephemeris where
// a table has it, else the mean elements), its mean orbit, which way it
// goes round, its size, GM and discovery. Each value carries its source
// tag, as on the bodies' plate.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { usePeek, byLabel } from './peek';
import { bodyState } from '../scene/OrreryScene';
import type { IrregularMoon } from '../scene/irregularMoons';
import { irregularStateEqjAtTt, irregularSource } from '../physics/irregularMoons.js';
import { eqjToEcl, ttSeconds } from '../physics/ephemeris.js';

const C_KM_S = 299792.458;
const PLANET = { jupiter: 'Jupiter', saturn: 'Saturn', neptune: 'Neptune' } as const;

export function IrregularMoonPlate({ clock, moon: m }: { clock: SimClock; moon: IrregularMoon }) {
  const s = useClock(clock);
  const date = new Date(s.timeMs), tt = ttSeconds(s.timeMs);
  const st = irregularStateEqjAtTt(m.key, tt);
  const source = irregularSource(m.key, tt);
  const planet = bodyState(m.planet, date).r, earth = bodyState('earth', date).r;
  const r = eqjToEcl(st.r);
  const fromEarth = Math.hypot(planet[0] + r[0] - earth[0], planet[1] + r[1] - earth[1], planet[2] + r[2] - earth[2]);
  const lt = fromEarth / C_KM_S;
  const pos = source === 'table'
    ? { src: m.kernel, info: 'irr-position-table' as const }
    : { src: 'elements', info: 'irr-position-elements' as const };
  const els = { src: 'JPL SSD', info: 'irr-elements' as const, detail: `mean elements (${m.kernel.toUpperCase()}), J2000 ecliptic` };
  const years = m.P / 365.25;
  const rows: Row[] = [
    { label: 'Orbits', value: PLANET[m.planet], alt: 'irregular moon', ...els },
    { label: 'Sense', value: m.retrograde ? 'retrograde' : 'prograde', alt: `i ${m.i.toFixed(1)}° to the ecliptic`, src: 'JPL SSD', derived: true, info: 'irr-sense' },
    { label: `From ${PLANET[m.planet]}`, value: fmtGroup(Math.hypot(...st.r)), unit: 'km', ...pos },
    { label: 'Speed', value: Math.hypot(...st.v).toFixed(3), unit: 'km/s', alt: `about ${PLANET[m.planet]}`, ...pos, derived: true },
    { label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', ...pos, derived: true, detail: 'less the Earth\'s position (DE442)' },
    { label: 'Light time', value: (lt / 60).toFixed(2), unit: 'min', src: 'd/c', derived: true, info: 'light-time' },
    { label: 'Semi-major axis', value: fmtGroup(m.a), unit: 'km', ...els },
    { label: 'Eccentricity', value: m.e.toFixed(3), ...els },
    { label: 'Inclination', value: m.i.toFixed(1), unit: '°', alt: 'to the ecliptic', ...els },
    { label: 'Orbital period', value: years < 2 ? fmtGroup(m.P, 1) : years.toFixed(2), unit: years < 2 ? 'd' : 'yr', ...els },
    m.size.source === 'NEOWISE'
      ? { label: 'Diameter', value: fmtGroup(m.size.diameterKm, 1), unit: 'km', alt: `± ${m.size.errKm} km, thermal infrared`, src: 'NEOWISE', info: 'irr-size' }
      : { label: 'Diameter', value: `≈ ${fmtGroup(m.size.diameterKm, m.size.diameterKm < 10 ? 1 : 0)}`, unit: 'km', alt: 'estimated from its brightness', src: m.size.source, derived: true, info: 'irr-size', detail: m.size.note },
    m.axesKm
      ? { label: 'Shape', value: `${fmtGroup(2 * m.axesKm[0], 1)} × ${fmtGroup(2 * m.axesKm[1], 1)}`, unit: 'km', alt: `a/b ${(m.axesKm[0] / m.axesKm[1]).toFixed(2)}${m.name === 'Himalia' ? '' : ' at least'}`, src: m.name === 'Himalia' ? 'Cassini' : 'lightcurve', derived: true, info: 'irr-shape', detail: m.shapeNote }
      : { label: 'Shape', value: 'not known', alt: 'drawn as a sphere', src: 'none', derived: true, info: 'irr-shape' },
    ...(m.rotation ? [{ label: 'Rotation', value: m.rotation.periodH.toFixed(m.rotation.periodH < 10 ? 2 : 1), unit: 'h', alt: m.rotation.uncertain ? 'period not certain' : 'synodic', src: m.name === 'Himalia' ? 'Pilcher' : 'Denk', info: 'irr-rotation', detail: m.rotation.source } as Row] : []),
    m.gm === null
      ? { label: 'GM', value: 'not measured', src: 'Horizons', info: 'irr-gm' }
      : { label: 'GM', value: m.gm.toPrecision(3), unit: 'km³/s²', alt: 'no pull on craft', src: 'Horizons', info: 'irr-gm' },
    ...(m.geometricAlbedo === null ? [] : [m.size.source === 'NEOWISE'
      ? { label: 'Geometric albedo', value: m.geometricAlbedo.toFixed(3), alt: 'visible, from NEOWISE', src: 'NEOWISE', info: 'irr-size' } as Row
      : { label: 'Geometric albedo', value: m.geometricAlbedo.toFixed(2), src: 'Horizons', info: 'moon-albedo' } as Row]),
    m.discovery
      ? { label: 'Discovered', value: m.discovery.year, alt: m.discovery.by, src: 'JPL SSD', info: 'irr-discovery', detail: m.discovery.ref }
      : { label: 'Discovered', value: 'not listed', src: 'JPL SSD', info: 'irr-discovery' },
  ];
  // The phone's peek: how far from its planet, and its period.
  usePeek(byLabel(rows, `From ${PLANET[m.planet]}`, 'Orbital period'));
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{m.name}</h2>
        <p className="engraved">{m.retrograde ? 'Retrograde' : 'Prograde'} irregular moon of {PLANET[m.planet]}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        <p>{source === 'table'
          ? `Placed by JPL's ${m.kernel} satellite ephemeris (within ${m.naif === 65273 ? '1,000' : '1'} km of it). It does not pull on spacecraft. Choose a body in the rail to leave it.`
          : `Placed on JPL's mean ellipse, fitted to Horizons: within ${fmtGroup(m.fit.maxKm)} km of it over 2000–2050 (${fmtGroup(m.fit.rmsKm)} km rms), a rough place (the tables cover 2000–2049). It does not pull on spacecraft. Choose a body in the rail to leave it.`}</p>
      </div>
    </div>
  );
}
