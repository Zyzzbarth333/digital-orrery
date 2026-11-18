// src/app/spacecraft-plate.tsx
//
// The data plate for a spacecraft beyond Earth orbit the camera is on
// (src/scene/spacecraftLayer.ts): where JPL Horizons places it now, about
// its centre body, the Sun and the Earth; which of Horizons' trajectories
// the clock is in (reconstructed from tracking, or predicted); and how the
// app holds it. Each value carries its source tag.

import { useClock, type SimClock } from './clock';
import { Readout, fmtGroup, type Row } from './panels';
import { bodyState } from '../scene/OrreryScene';
import { BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { PROBE_GROUPS, type Probe, type SpacecraftLayer } from '../scene/spacecraftLayer';

const AU_KM = 149597870.7, C_KM_S = 299792.458;
const CENTRE_NAME: Record<string, string> = { sun: 'the Sun', mercury: 'Mercury', venus: 'Venus', earth: 'the Earth', moon: 'the Moon', mars: 'Mars', jupiter: 'Jupiter' };
const KIND: Record<string, string> = { mercury: 'Mercury orbiter', moon: 'Lunar orbiter', mars: 'Mars orbiter', jupiter: 'Jupiter orbiter', lagrange: 'Observatory near the Sun-Earth line', cruise: 'Probe in interplanetary space' };
const MONTH: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// "2026-Jun-15 00:01" (TDB, a minute off UTC is nothing here) -> ms
const legTime = (s: string) => { const m = /(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(s); return m ? Date.UTC(+m[1], MONTH[m[2]], +m[3], +m[4], +m[5]) : NaN; };

export function SpacecraftPlate({ clock, probe: c, layer }: { clock: SimClock; probe: Probe; layer: SpacecraftLayer }) {
  const s = useClock(clock);
  const st = layer.stateAbout(c.key, s.timeMs);
  const helio = layer.positionKm(c.key, s.timeMs);
  const leg = c.legs.find((l) => s.timeMs >= legTime(l.start) && s.timeMs < legTime(l.stop));
  // After Horizons' last update of the craft its trajectory is a
  // prediction; before, a solution fitted to tracking.
  const revisedMs = c.revised ? Date.parse(`${c.revised} UTC`) : NaN;
  const predicted = !(s.timeMs < revisedMs);
  const rows: Row[] = [];
  if (st && helio) {
    const d = Math.hypot(...st.r), centre = st.centre;
    const radius = centre !== 'sun' ? BODY_BY_KEY[centre as BodyKey]?.radiusKm : undefined;
    const earth = bodyState('earth', new Date(s.timeMs)).r;
    const fromEarth = Math.hypot(helio[0] - earth[0], helio[1] - earth[1], helio[2] - earth[2]);
    const lt = fromEarth / C_KM_S;
    rows.push(
      { label: 'Motion', value: 'JPL Horizons', alt: predicted ? 'predicted' : 'fitted to tracking', src: 'Horizons', info: 'probe-legs', detail: leg ? `Horizons' trajectory here: ${leg.name}, ${leg.start} to ${leg.stop} TDB` : undefined },
      { label: `From ${CENTRE_NAME[centre] ?? centre}`, value: fmtGroup(d, d < 1e5 ? 1 : 0), unit: 'km', alt: radius && c.group !== 'lagrange' && c.group !== 'cruise' ? `${fmtGroup(d - radius, 1)} km above its mean radius` : undefined, src: 'Horizons', derived: true, info: 'probe-position', hint: 'Distance from the centre of the body this craft is held about' },
      { label: 'Speed', value: Math.hypot(...st.v).toFixed(3), unit: 'km/s', alt: `about ${CENTRE_NAME[centre] ?? centre}`, src: 'Horizons', derived: true, info: 'probe-position', hint: 'Speed relative to the body it is held about' },
      { label: 'From the Sun', value: (Math.hypot(...helio) / AU_KM).toFixed(4), unit: 'AU', src: 'Horizons', derived: true, info: 'probe-position' },
      { label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', src: 'Horizons', derived: true, info: 'probe-position', detail: 'less the Earth\'s position (DE442)' },
      { label: 'Light time', value: lt < 60 ? lt.toFixed(3) : lt < 3600 ? (lt / 60).toFixed(2) : (lt / 3600).toFixed(3), unit: lt < 60 ? 's' : lt < 3600 ? 'min' : 'h', src: 'd/c', derived: true, info: 'light-time' },
    );
  } else {
    rows.push({ label: 'Motion', value: 'no data today', alt: 'outside the 2026–2027 span, or Horizons\' coverage', src: 'Horizons', info: 'probe-legs' });
  }
  rows.push(
    { label: 'Horizons ID', value: String(c.id), src: 'Horizons', info: 'probe-legs' },
    { label: 'Revised', value: c.revised ?? 'not given', alt: 'Horizons\' last update of this craft', src: 'Horizons', info: 'probe-legs' },
    { label: 'Held as', value: c.spacingMin ? `every ${c.spacingMin[0]}–${c.spacingMin[1]} min` : '—', alt: `within ${layer.tolKm} km of Horizons (worst ${c.maxErrKm.toFixed(2)} km)`, src: 'packed', derived: true, info: 'probe-packing' },
  );
  const group = PROBE_GROUPS.find((g) => g.key === c.group);
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2>{c.short}</h2>
        <p className="engraved">{c.short !== c.name ? `${c.name} · ` : ''}{KIND[c.group] ?? group?.label}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        <p>{predicted
          ? `The clock is past Horizons' last update of this craft (${c.revised ?? 'no date given'}): its trajectory here is a prediction, and manoeuvres planned since are not in it.`
          : `The clock is before Horizons' last update of this craft (${c.revised}): its trajectory here is fitted to tracking.`} The app places it where Horizons does, and flies none of it. Choose a body in the rail to leave it.</p>
        {c.conicDays > 0 && <p>On {c.conicDays} of its days Horizons' prediction follows a plain conic, a simplified forecast: its place there is a guide, not a fix.</p>}
      </div>
    </div>
  );
}
