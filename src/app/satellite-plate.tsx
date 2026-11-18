// src/app/satellite-plate.tsx
//
// The data plate for the Earth satellite the camera is on (chosen by its
// marker, the rail's Fly-to list or the search): where SGP4 puts it now,
// whether it is in sunlight, and its GP element set, with the epoch's age
// and where the elements came from, then its passes over a place
// (satellite-passes.tsx). Each value carries its source tag.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { bodyState } from '../scene/OrreryScene';
import { eclToEqj } from '../physics/ephemeris.js';
import { stateTeme, temeToEqj, apply, groundSpeeds, meanOrbit, sunFraction, type satrecOf } from '../physics/satellites.js';
import { sunlightRow } from './sunlight';
import { orbitClass, SAT_GROUPS, type NamedSat, type SatLayerKey, type SatSource, type SatCloudView } from '../scene/satellites';
import type { GroundTrack } from '../scene/groundTrack';
import { SatellitePasses } from './satellite-passes';
import { MODEL_NOTE, modelOf } from '../scene/satelliteModels';

const WGS84_A = 6378.137, WGS84_B = 6356.752;

export interface PlateSat { omm: ReturnType<typeof satrecOf>['omm']; rec: ReturnType<typeof satrecOf>; named: NamedSat }

// The epoch's age as a few words: "5.2 h", "3.1 d".
function age(ms: number): string {
  const h = Math.abs(ms) / 3600e3;
  const s = h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} d`;
  return ms >= 0 ? `${s} after epoch` : `${s} before epoch`;
}

export function SatellitePlate({ clock, sat, source, track = null }: { clock: SimClock; sat: PlateSat; source: SatSource | null; track?: GroundTrack | null }) {
  const s = useClock(clock);
  // SGP4's TEME state, once: J2000 for the place and speed, TEME (which
  // turns with the Earth's pole of date) for the speed over the ground.
  const teme = stateTeme(sat.rec, s.timeMs);
  const M = teme ? temeToEqj(s.timeMs) : null;
  const st = teme && M ? { r: apply(M, teme.r), v: apply(M, teme.v) } : null;
  const o = meanOrbit(sat.rec);
  const sinceEpoch = s.timeMs - sat.rec.epochMs;
  const group = SAT_GROUPS.find((g) => g.key === sat.named.group)?.label;
  const kind = orbitClass(sat.omm);
  const rows: Row[] = [
    { label: 'Catalogue', value: `NORAD ${sat.omm.NORAD_CAT_ID}`, alt: `international designator ${sat.omm.OBJECT_ID}`, src: 'CelesTrak', info: 'sat-elements' },
  ];
  const g = teme ? groundSpeeds(teme) : null;
  if (st) {
    const d = Math.hypot(...st.r), sinLat = st.r[2] / d;
    const h = d - (WGS84_A * WGS84_B) / Math.hypot(WGS84_B * Math.sqrt(1 - sinLat * sinLat), WGS84_A * sinLat);
    const date = new Date(s.timeMs), earthR = bodyState('earth', date).r, moonR = bodyState('moon', date).r;
    const sun = eclToEqj(earthR.map((x: number) => -x)) as number[];
    const sn = Math.hypot(sun[0], sun[1], sun[2]);
    const moon = eclToEqj(moonR.map((x: number, i: number) => x - earthR[i])) as number[];
    const light = sunFraction(st.r, [sun[0] / sn, sun[1] / sn, sun[2] / sn], moon);
    rows.push(
      { label: 'Motion', value: 'SGP4', alt: `from its element set, ${sat.rec.rec.method === 'd' ? 'deep-space (SDP4)' : 'near-Earth'}`, src: 'SGP4', derived: true, info: 'sat-position' },
      { label: 'Height', value: fmtGroup(h, 1), unit: 'km', alt: 'above the WGS-84 ellipsoid', src: 'SGP4', derived: true, info: 'sat-height' },
      { label: 'From Earth', value: fmtGroup(d, 1), unit: 'km', alt: 'from its centre', src: 'SGP4', derived: true, info: 'sat-position' },
      { label: 'Speed', value: Math.hypot(...st.v).toFixed(3), unit: 'km/s', alt: 'inertial, about the Earth\'s centre', src: 'SGP4', derived: true, info: 'sat-position', hint: 'Speed relative to the centre of the Earth, not to the turning ground; live as the clock runs' },
      { label: 'Ground speed', value: g!.relative.toFixed(3), unit: 'km/s', alt: `over the turning Earth; its track ${g!.track.toFixed(3)} km/s`, src: 'SGP4', derived: true, info: 'sat-ground-speed', hint: 'Speed seen from the ground as the Earth turns under it, and how fast the point beneath it moves across the map' },
      sunlightRow(light, 'sat-shadow'),
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
        <p className="engraved">{group && sat.named.group !== 'found' ? `${group} · ` : layerNoun(sat.named)}{kind.charAt(0).toUpperCase() + kind.slice(1)}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <SatellitePasses key={sat.omm.NORAD_CAT_ID} clock={clock} sat={sat} track={track} />
      <div className="plate-notes">
        <p>Moved by SGP4 from its GP element set, as the US Space Force fits them: about a kilometre at the epoch, a few kilometres a day either side. Its speeds update as the clock runs. Far off it is a point; the camera can come to within 20 m.</p>
        <p>{MODEL_NOTE[modelOf(sat.named.id)]} Choose a body in the rail to leave it.</p>
      </div>
    </div>
  );
}

// A found one from the debris, rocket bodies or analyst objects says so.
const NOUN: Record<SatLayerKey, string> = { active: '', debris: 'Debris · ', 'rocket-bodies': 'Rocket body · ', analyst: 'Analyst object · ' };
const layerNoun = (n: NamedSat): string => NOUN[n.layer ?? 'active'];

// The data plate for a debris cloud (the rail's Fly-to list): the breakup,
// how many of its pieces the snapshot holds, and their orbits' spread.
const km3 = (q: [number, number, number]) => `${fmtGroup(q[0], 0)} – ${fmtGroup(q[2], 0)}`;
export function SatCloudPlate({ cloud }: { cloud: SatCloudView }) {
  const rows: Row[] = [
    { label: 'Breakup', value: cloud.date, unit: 'UTC', alt: cloud.event.charAt(0).toLowerCase() + cloud.event.slice(1), src: 'CelesTrak', info: 'sat-cloud' },
    { label: 'Pieces tracked', value: fmtGroup(cloud.tracked, 0), alt: `its parent ${cloud.intdes}`, src: 'CelesTrak', info: 'sat-cloud', hint: 'Pieces with an element set in the snapshot; more were catalogued, and have come down since' },
    { label: 'Perigee', value: fmtGroup(cloud.perigee[1], 0), unit: 'km', alt: `median; ${km3(cloud.perigee)} km for most`, src: 'mean', derived: true, info: 'sat-cloud', hint: 'Height of the lowest point of each piece\'s orbit: the median, and the 10th to 90th percentiles' },
    { label: 'Apogee', value: fmtGroup(cloud.apogee[1], 0), unit: 'km', alt: `median; ${km3(cloud.apogee)} km for most`, src: 'mean', derived: true, info: 'sat-cloud', hint: 'Height of the highest point of each piece\'s orbit: the median, and the 10th to 90th percentiles' },
    { label: 'Inclination', value: cloud.incl[1].toFixed(2), unit: '°', alt: `median; ${cloud.incl[0].toFixed(1)}–${cloud.incl[2].toFixed(1)}° for most`, src: 'CelesTrak', info: 'sat-cloud' },
    { label: 'Epochs', value: cloud.epochs.median.slice(0, 16).replace('T', ' '), unit: 'UTC', alt: `median; the oldest ${cloud.epochs.first.slice(0, 10)}`, src: 'CelesTrak', info: 'sat-epoch' },
    { label: 'Element sets', value: 'snapshot', alt: `fetched ${cloud.fetched.slice(0, 16).replace('T', ' ')} UTC`, src: 'CelesTrak', info: 'sat-elements', detail: cloud.query },
  ];
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{cloud.name} debris</h2>
        <p className="engraved">Debris cloud · {cloud.event}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        <p>Its pieces are drawn brighter and the rest dimmer, each moved by SGP4 from its own element set. Search finds a piece by its name or number. Choose a body in the rail to leave it.</p>
      </div>
    </div>
  );
}
