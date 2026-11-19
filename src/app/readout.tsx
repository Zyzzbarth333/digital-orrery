// src/app/readout.tsx
//
// The readout table every plate draws (label, value, unit, source tag), its
// row type, the plain-language hints on its labels, and the number
// formatters the plates share. panels.tsx and each plate import it, so no
// plate imports panels.tsx back.

import { SourceTag, type TagInfoKey } from './source-tag';

// Formatters are built once: toLocaleString builds a new one on every call,
// and the plate formats a dozen numbers ten times a second.
const SIG10 = new Intl.NumberFormat('en-AU', { maximumSignificantDigits: 10 });
const GROUP = new Map<number, Intl.NumberFormat>();
export const sig10 = (n: number) => SIG10.format(n);
export const fmtGroup = (n: number, digits = 0) => {
  let f = GROUP.get(digits);
  if (!f) { f = new Intl.NumberFormat('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits }); GROUP.set(digits, f); }
  return f.format(n);
};

export interface Row { label: string; value: string; unit?: string; alt?: string; src: string; derived?: boolean; info: TagInfoKey; detail?: string; hint?: string }

// Plain-language meanings of the readout labels, shown on hover.
export const HINTS: Record<string, string> = {
  'Motion': 'How this body moves in the app: planets follow NASA ephemerides exactly ("on rails"); spacecraft are integrated under gravity step by step',
  'From the Sun': 'Distance from the centre of the Sun',
  'From the SSB': 'Distance from the solar system barycentre, the centre of mass of everything in the solar system',
  'GM within': 'G times the total mass of everything this barycentre is the centre of',
  'Speed': 'Speed relative to the Sun',
  'From Earth': 'Distance from the centre of Earth',
  'Light time': 'How long light (or a radio signal) takes to cross that distance',
  'Mean radius': 'The radius of a sphere of the same volume',
  'GM': 'Gravitational parameter: G times the mass, which is what orbits actually depend on',
  'GM, system': 'GM of the planet and all its moons together, as used at the system barycentre',
  'GM, planet': 'GM of the planet alone',
  'Surface gravity': 'GM divided by the radius squared: the pull at the surface of a non-spinning sphere',
  'Geometric albedo': 'How bright the full disc is compared with a white disc of the same size',
  'Orbital period': 'Time for one orbit of the Sun (or of Earth, for the Moon)',
  'Rotation': 'Time for one turn about its axis, against the stars',
  'Solar day': 'Time from one noon to the next: one turn against the Sun, which the orbit moves along the sky',
  'Axial tilt': 'Angle between the spin axis and the orbit\'s axis (obliquity)',
  'Mean density': 'Mass over volume',
  'Escape speed': 'Speed needed at the surface to leave for good, without further push',
  'Clouds': 'The weather drawn on the Earth: GOES\'s view of the Americas and the Pacific every 10 minutes, about an hour behind, and NASA\'s daily true-colour image everywhere else',
  'At the equator': 'The Sun is gas: its equator turns faster than its poles',
  'Near the poles': 'The Sun is gas: its poles turn slower than its equator',
  'From the barycentre': 'How far the solar system\'s centre of mass is from the Sun\'s centre: the Sun wanders round it as the giant planets go round',
  'Galactic orbit': 'Time for the Sun to go once round the centre of the Milky Way',
};

// Each row's source tag opens what the value is, its equation and its
// source (source-tag.tsx).
export function Readout({ rows }: { rows: Row[] }) {
  return (
    <table className="readout">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row" title={r.hint ?? HINTS[r.label]}>{r.label}</th>
            <td className="value">
              {r.value}{r.unit && <span className="unit">{r.unit}</span>}
              {r.alt && <span className="alt">{r.alt}</span>}
            </td>
            <td className="src"><SourceTag src={r.src} derived={r.derived} info={r.info} detail={r.detail} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
