// src/app/panels.tsx
//
// The panels around the 3D view: time controls, the body list and the data
// for the focused body. Numbers come straight from the ephemeris at the sim
// time (re-read at most ten times a second).

import { Pause, Play, LocateFixed } from 'lucide-react';
import { useClock, type SimClock } from './clock';
import { BODIES, BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { bodyState } from '../scene/OrreryScene';

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;

const RATES: { label: string; rate: number }[] = [
  { label: 'Real time', rate: 1 },
  { label: '1 min/s', rate: 60 },
  { label: '1 h/s', rate: 3600 },
  { label: '1 d/s', rate: 86400 },
  { label: '1 wk/s', rate: 7 * 86400 },
  { label: '30 d/s', rate: 30 * 86400 },
  { label: '1 yr/s', rate: 365.25 * 86400 },
];

function fmtUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`;
}

export function TimeBar({ clock }: { clock: SimClock }) {
  const s = useClock(clock);
  return (
    <div className="panel time-bar">
      <span className="clock-readout">{fmtUtc(s.timeMs)}</span>
      <button className="icon-btn" onClick={() => clock.setPlaying(!s.playing)} aria-label={s.playing ? 'Pause' : 'Play'}>
        {s.playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <select value={s.rate} onChange={(e) => clock.setRate(Number(e.target.value))} aria-label="Time rate">
        {RATES.map((r) => <option key={r.rate} value={r.rate}>{r.label}</option>)}
      </select>
      <button className="text-btn" onClick={() => clock.setTime(Date.now())}>Now</button>
    </div>
  );
}

export function BodyList({ focus, onSelect }: { focus: BodyKey; onSelect: (k: BodyKey) => void }) {
  return (
    <div className="panel body-list">
      {BODIES.map((b) => (
        <button key={b.key} className={`body-row${b.key === focus ? ' active' : ''}${b.parent === 'earth' ? ' child' : ''}`}
          onClick={() => onSelect(b.key)}>
          <span className="swatch" style={{ background: `#${b.colour.toString(16).padStart(6, '0')}` }} />
          {b.name}
        </button>
      ))}
    </div>
  );
}

function fmtKm(km: number): string {
  if (km >= 1e6) return `${(km / 1e6).toFixed(3)} million km`;
  return `${km.toFixed(0)} km`;
}

function fmtLight(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(2)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(2)} min`;
  return `${(seconds / 3600).toFixed(2)} h`;
}

const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);

export function BodyPanel({ clock, focus }: { clock: SimClock; focus: BodyKey }) {
  const s = useClock(clock);
  const b = BODY_BY_KEY[focus];
  const date = new Date(s.timeMs);
  const st = bodyState(focus, date);
  const earth = bodyState('earth', date);
  const rSun = norm(st.r);
  const fromEarth = norm([st.r[0] - earth.r[0], st.r[1] - earth.r[1], st.r[2] - earth.r[2]]);
  const ownGm = b.planetGm ?? b.gm;
  const surfaceG = ownGm ? (ownGm / (b.radiusKm * b.radiusKm)) * 1000 : null;   // m/s^2
  const rows: [string, string][] = [];
  if (focus !== 'sun') {
    rows.push(['From the Sun', `${(rSun / AU_KM).toFixed(6)} AU (${fmtKm(rSun)})`]);
    rows.push(['Speed (heliocentric)', `${norm(st.v).toFixed(3)} km/s`]);
  }
  if (focus !== 'earth') {
    rows.push(['From Earth', fmtKm(fromEarth)]);
    rows.push(['Light time from Earth', fmtLight(fromEarth / C_KM_S)]);
  }
  rows.push(['Mean radius', `${b.radiusKm.toLocaleString('en-AU')} km`]);
  if (b.gm) rows.push([b.planetGm ? 'GM (system)' : 'GM', `${b.gm.toPrecision(10)} km³/s² (${b.gmNote})`]);
  if (b.planetGm) rows.push(['GM (planet)', `${b.planetGm.toPrecision(10)} km³/s² (${b.planetGmNote})`]);
  if (surfaceG && focus !== 'sun') {
    rows.push(['Surface gravity (GM/R², no rotation)', `${surfaceG.toFixed(3)} m/s²`]);
  }
  if (b.periodDays) rows.push(['Orbital period', `${b.periodDays.toLocaleString('en-AU')} days`]);
  return (
    <div className="panel body-panel">
      <h2>{b.name}</h2>
      <dl>
        {rows.map(([k, v]) => (<div key={k} className="row"><dt>{k}</dt><dd>{v}</dd></div>))}
      </dl>
      <p className="note">
        Positions: astronomy-engine, within 1×10⁻⁴ of the Sun distance of DE442 (checked with CSPICE; up to about 420,000 km at Neptune).
        {focus === 'sun' ? '' : ' Surface gravity here is GM/R² for a sphere; real values vary with latitude and rotation.'}
      </p>
      <p className="hint"><LocateFixed size={12} /> Drag to rotate, scroll to zoom, click a label to focus.</p>
    </div>
  );
}
