// src/app/panels.tsx
//
// The console around the sky: the time band, the body rail and the data
// plate. Every readout in the plate carries its source (the provenance
// column): a solid tag for data, a dashed one for values derived here.
// Numbers are re-read from the ephemeris at most ten times a second.

import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useClock, type SimClock } from './clock';
import { BODIES, BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { bodyState } from '../scene/OrreryScene';

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;

export const RATES: { label: string; rate: number }[] = [
  { label: 'Real time', rate: 1 },
  { label: '1 min/s', rate: 60 },
  { label: '1 h/s', rate: 3600 },
  { label: '1 d/s', rate: 86400 },
  { label: '1 wk/s', rate: 7 * 86400 },
  { label: '30 d/s', rate: 30 * 86400 },
  { label: '1 yr/s', rate: 365.25 * 86400 },
];

const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const fmtGroup = (n: number, digits = 0) => n.toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function TimeBand({ clock }: { clock: SimClock }) {
  const s = useClock(clock);
  const iso = new Date(s.timeMs).toISOString();
  return (
    <header className="band">
      <span className="wordmark">digital-orrery</span>
      <div className="clock">
        <time dateTime={iso}>{iso.slice(0, 10)} {iso.slice(11, 19)}</time>
        <span className="scale">UTC</span>
      </div>
      <div className="controls">
        <button className="btn icon" onClick={() => clock.setPlaying(!s.playing)} aria-pressed={s.playing}
          aria-label={s.playing ? 'Pause time' : 'Run time'} title={s.playing ? 'Pause (Space)' : 'Run (Space)'}>
          {s.playing ? <Pause size={14} strokeWidth={1.75} /> : <Play size={14} strokeWidth={1.75} />}
        </button>
        <select className="rate" value={s.rate} onChange={(e) => clock.setRate(Number(e.target.value))} aria-label="Time rate">
          {RATES.map((r) => <option key={r.rate} value={r.rate}>{r.label}</option>)}
        </select>
        <button className="btn" onClick={() => clock.setTime(Date.now())} title="Jump to now (N)">Now</button>
      </div>
      <div className="keys" aria-label="Keyboard shortcuts">
        <span><kbd>Space</kbd> run</span>
        <span><kbd>←</kbd><kbd>→</kbd> rate</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> body</span>
        <span><kbd>N</kbd> now</span>
      </div>
    </header>
  );
}

export function BodyRail({ clock, focus, onSelect }: { clock: SimClock; focus: BodyKey; onSelect: (k: BodyKey) => void }) {
  const s = useClock(clock);
  const date = new Date(s.timeMs);
  return (
    <nav className="rail" aria-label="Bodies">
      <h2 className="panel-title">Bodies</h2>
      <ul className="body-list">
        {BODIES.map((b) => {
          const r = b.key === 'sun' ? null : norm(bodyState(b.key, date).r) / AU_KM;
          return (
            <li key={b.key}>
              <button className={`body-row${b.parent === 'earth' ? ' child' : ''}`} aria-current={b.key === focus}
                onClick={() => onSelect(b.key)} title={r === null ? b.name : `${b.name}: ${r.toFixed(3)} AU from the Sun`}>
                <span className="swatch" style={{ background: `#${b.colour.toString(16).padStart(6, '0')}` }} />
                <span>{b.name}</span>
                <span className="dist">{r === null || b.parent === 'earth' ? '' : r.toFixed(2)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

interface Row { label: string; value: string; unit?: string; alt?: string; src: string; derived?: boolean; detail: string }

function Readout({ rows }: { rows: Row[] }) {
  return (
    <table className="readout">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            <td className="value">
              {r.value}{r.unit && <span className="unit">{r.unit}</span>}
              {r.alt && <span className="alt">{r.alt}</span>}
            </td>
            <td className="src"><span className={`src-tag${r.derived ? ' derived' : ''}`} title={r.detail}>{r.src}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const AE = 'astronomy-engine; within 1e-4 of the Sun distance of DE442, checked with CSPICE';

export function DataPlate({ clock, focus }: { clock: SimClock; focus: BodyKey }) {
  const s = useClock(clock);
  const [collapsed, setCollapsed] = useState(true);
  const b = BODY_BY_KEY[focus];
  const date = new Date(s.timeMs);
  const st = bodyState(focus, date);
  const earth = bodyState('earth', date);
  const rSun = norm(st.r);
  const fromEarth = norm([st.r[0] - earth.r[0], st.r[1] - earth.r[1], st.r[2] - earth.r[2]]);
  const ownGm = b.planetGm ?? b.gm;
  const rows: Row[] = [];
  if (focus !== 'sun') {
    rows.push({ label: 'From the Sun', value: (rSun / AU_KM).toFixed(6), unit: 'AU', alt: `${fmtGroup(rSun)} km`, src: 'AE', detail: AE });
    rows.push({ label: 'Speed', value: norm(st.v).toFixed(3), unit: 'km/s', alt: 'heliocentric', src: 'AE', detail: AE });
  }
  if (focus !== 'earth') {
    rows.push({ label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', src: 'AE', detail: AE });
    const lt = fromEarth / C_KM_S;
    rows.push({
      label: 'Light time', value: lt < 60 ? lt.toFixed(3) : lt < 3600 ? (lt / 60).toFixed(2) : (lt / 3600).toFixed(3),
      unit: lt < 60 ? 's' : lt < 3600 ? 'min' : 'h', src: 'd/c', derived: true, detail: 'distance from Earth / c, with c = 299,792.458 km/s',
    });
  }
  rows.push({ label: 'Mean radius', value: fmtGroup(b.radiusKm, b.radiusKm < 10000 ? 1 : 0), unit: 'km', src: 'IAU', detail: 'IAU/NAIF mean radius (pck00011)' });
  if (b.gm) {
    rows.push({
      label: b.planetGm ? 'GM, system' : 'GM', value: b.gm.toPrecision(10), unit: 'km³/s²', src: 'DE442',
      detail: `${b.gmNote}; JPL DE442 via SPICE (gm_de442.tpc)`,
    });
  }
  if (b.planetGm) {
    const [naif, kernel] = (b.planetGmNote ?? '').split(', ');
    rows.push({ label: 'GM, planet', value: b.planetGm.toPrecision(10), unit: 'km³/s²', src: kernel?.split(' ')[0] ?? 'NAIF', detail: `${naif}, from the satellite kernel ${kernel}` });
  }
  if (ownGm && focus !== 'sun') {
    rows.push({ label: 'Surface gravity', value: ((ownGm / (b.radiusKm * b.radiusKm)) * 1000).toFixed(3), unit: 'm/s²', alt: 'sphere, no rotation', src: 'GM/R²', derived: true, detail: 'derived from the GM and mean radius above' });
  }
  if (b.geometricAlbedo) {
    rows.push({ label: 'Geometric albedo', value: b.geometricAlbedo.toFixed(3), src: 'NSSDCA', detail: 'NASA NSSDCA planetary fact sheet' });
  }
  if (b.periodDays) {
    rows.push({ label: 'Orbital period', value: fmtGroup(b.periodDays, 2), unit: 'd', src: 'rounded', derived: true, detail: 'a rounded mean value; Earth is shown as 365.25 d, the Julian year' });
  }
  const kind = focus === 'sun' ? 'Star, at the centre of the frame' : focus === 'moon' ? 'Moon of Earth' : focus === 'pluto' ? 'Dwarf planet' : 'Planet';
  return (
    <aside className="plate" aria-label={`${b.name} data`} data-collapsed={collapsed}>
      <div className="plate-head">
        <h1>{b.name}</h1>
        <p>{kind}</p>
        <button className="btn plate-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
          {collapsed ? 'Show data' : 'Hide data'}
        </button>
      </div>
      <Readout rows={rows} />
      <div className="plate-notes">
        <p>Tags give each value&apos;s source; dashed tags are worked out here. Hover a tag for detail.</p>
        <p>Drag to turn the view, scroll to zoom, click a name to focus.</p>
      </div>
    </aside>
  );
}
