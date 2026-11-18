// src/app/satellite-plate.tsx
//
// The data plate for the Earth satellite the camera is on (chosen by its
// marker, the rail's Fly-to list or the search): where SGP4 puts it now,
// whether it is in sunlight, and its GP element set, with the epoch's age
// and where the elements came from. Each value carries its source tag.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { bodyState } from '../scene/OrreryScene';
import { eclToEqj } from '../physics/ephemeris.js';
import { stateEqj, meanOrbit, inShadow, type satrecOf } from '../physics/satellites.js';
import { orbitClass, SAT_GROUPS, type NamedSat, type SatSource } from '../scene/satellites';

const WGS84_A = 6378.137, WGS84_B = 6356.752;

export interface PlateSat { omm: ReturnType<typeof satrecOf>['omm']; rec: ReturnType<typeof satrecOf>; named: NamedSat }

// The epoch's age as a few words: "5.2 h", "3.1 d".
function age(ms: number): string {
  const h = Math.abs(ms) / 3600e3;
  const s = h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
  return ms >= 0 ? `${s} after epoch` : `${s} before epoch`;
}

export function SatellitePlate({ clock, sat, source }: { clock: SimClock; sat: PlateSat; source: SatSource | null }) {
  const s = useClock(clock);
  const st = stateEqj(sat.rec, s.timeMs);
  const o = meanOrbit(sat.rec);
  const sinceEpoch = s.timeMs - sat.rec.epochMs;
  const group = SAT_GROUPS.find((g) => g.key === sat.named.group)?.label;
  const kind = orbitClass(sat.omm);
  const rows: Row[] = [
    { label: 'Catalogue', value: `NORAD ${sat.omm.NORAD_CAT_ID}`, alt: `international designator ${sat.omm.OBJECT_ID}`, src: 'CelesTrak', info: 'sat-elements' },
  ];
  if (st) {
    const d = Math.hypot(...st.r), sinLat = st.r[2] / d;
    const h = d - (WGS84_A * WGS84_B) / Math.hypot(WGS84_B * Math.sqrt(1 - sinLat * sinLat), WGS84_A * sinLat);
    const sun = eclToEqj(bodyState('earth', new Date(s.timeMs)).r.map((x: number) => -x)) as number[];
    const sn = Math.hypot(sun[0], sun[1], sun[2]);
    const dark = inShadow(st.r, [sun[0] / sn, sun[1] / sn, sun[2] / sn]);
    rows.push(
      { label: 'Motion', value: 'SGP4', alt: `from its element set, ${sat.rec.rec.method === 'd' ? 'deep-space (SDP4)' : 'near-Earth'}`, src: 'SGP4', derived: true, info: 'sat-position' },
      { label: 'Height', value: fmtGroup(h, 1), unit: 'km', alt: 'above the WGS-84 ellipsoid', src: 'SGP4', derived: true, info: 'sat-height' },
      { label: 'From Earth', value: fmtGroup(d, 1), unit: 'km', alt: 'from its centre', src: 'SGP4', derived: true, info: 'sat-position' },
      { label: 'Speed', value: Math.hypot(...st.v).toFixed(3), unit: 'km/s', alt: 'about the Earth\'s centre', src: 'SGP4', derived: true, info: 'sat-position', hint: 'Speed relative to the centre of the Earth, not to the turning ground' },
      { label: 'Sunlight', value: dark ? 'in the Earth\'s shadow' : 'lit', src: 'shadow', derived: true, info: 'sat-shadow' },
    );
  } else {
    rows.push({ label: 'Motion', value: 'not placed', alt: `SGP4 stopped (error ${sat.rec.rec.error}): decayed, or out of the theory's range`, src: 'SGP4', derived: true, info: 'sat-position' });
  }
  rows.push(
    { label: 'Epoch', value: sat.omm.EPOCH.slice(0, 19).replace('T', ' '), unit: 'UTC', alt: age(sinceEpoch), src: 'CelesTrak', info: 'sat-epoch',
      hint: Math.abs(sinceEpoch) > 7 * 86400e3 ? 'Over a week from its epoch: SGP4 may be tens of kilometres off, more in low orbit' : 'When the element set is for' },
    { label: 'Perigee', value: fmtGroup(o.perigeeKm, 1), unit: 'km', alt: `apogee ${fmtGroup(o.apogeeKm, 1)} km`, src: 'mean', derived: true, info: 'sat-orbit', hint: 'Heights of the orbit\'s lowest and highest points above the Earth\'s equatorial radius' },
    { label: 'Orbital period', value: o.periodMin < 180 ? o.periodMin.toFixed(2) : (o.periodMin / 60).toFixed(3), unit: o.periodMin < 180 ? 'min' : 'h', alt: `${o.revsPerDay.toFixed(8)} rev/day`, src: 'CelesTrak', info: 'sat-elements', hint: 'Time for one orbit of the Earth, from the mean motion' },
    { label: 'Eccentricity', value: o.e.toFixed(7), src: 'CelesTrak', info: 'sat-elements' },
    { label: 'Inclination', value: o.iDeg.toFixed(4), unit: '°', alt: 'to the equator of date', src: 'CelesTrak', info: 'sat-elements' },
    { label: 'Node', value: o.nodeDeg.toFixed(4), unit: '°', alt: 'right ascension of the ascending node', src: 'CelesTrak', info: 'sat-elements' },
    { label: 'Perigee argument', value: o.periDeg.toFixed(4), unit: '°', src: 'CelesTrak', info: 'sat-elements' },
    { label: 'Mean anomaly', value: o.MDeg.toFixed(4), unit: '°', alt: 'at epoch', src: 'CelesTrak', info: 'sat-elements' },
    { label: 'Drag term', value: o.bstar.toExponential(4), unit: '/R⊕', alt: 'B*', src: 'CelesTrak', info: 'sat-elements' },
  );
  if (source) rows.push({ label: 'Element sets', value: source.live ? 'live' : 'snapshot', alt: `fetched ${source.fetched.slice(0, 16).replace('T', ' ')} UTC`, src: 'CelesTrak', info: 'sat-elements', detail: source.label });
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{sat.named.name}</h2>
        <p className="engraved">{group && sat.named.group !== 'found' ? `${group} · ` : ''}{kind.charAt(0).toUpperCase() + kind.slice(1)}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        <p>Moved by SGP4 from its GP element set, as the US Space Force fits them: about a kilometre at the epoch, a few kilometres a day either side. Drawn as a point; the camera can come to within 20 m. Choose a body in the rail to leave it.</p>
      </div>
    </div>
  );
}
