// src/app/panels.tsx
//
// The instrument panels around the sky: the header band (clock and rate in
// readout windows, the RUN and NOW keys, indicator lamps), the body rail and
// the data plate. Every readout in the plate carries its source (the
// provenance column): a solid tag for data, a dashed one for values derived
// here. Numbers are re-read from the ephemeris at most ten times a second.

import { useState } from 'react';
import { useClock, type SimClock } from './clock';
import { useMission, type Mission } from './mission';
import { MissionPanel } from './mission-panel';
import { PlannerPanel } from './planner-panel';
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

function Lamp({ on, label, title }: { on: boolean; label: string; title: string }) {
  return <span className="lamp" data-on={on} title={title}><i aria-hidden="true" />{label}</span>;
}

// How far the clock was set, in words: +2.05 yr, -3.2 d, +45 min.
function span(ms: number): string {
  const a = Math.abs(ms) / 1000, sign = ms < 0 ? '−' : '+';
  if (a >= 365.25 * 86400) return `${sign}${(a / (365.25 * 86400)).toFixed(2)} yr`;
  if (a >= 86400) return `${sign}${(a / 86400).toFixed(1)} d`;
  if (a >= 3600) return `${sign}${(a / 3600).toFixed(1)} h`;
  return `${sign}${Math.round(a / 60)} min`;
}

export function TimeBand({ clock, mission }: { clock: SimClock; mission: Mission }) {
  const s = useClock(clock);
  useMission(mission);
  const iso = new Date(s.timeMs).toISOString();
  const live = Math.abs(s.timeMs - Date.now()) < 60e3;
  const jump = s.lastJump;
  return (
    <header className="band screw">
      <span className="pnl" aria-hidden="true">PNL F1</span>
      <h1 className="wordmark">digital-orrery</h1>
      <div className="field">
        <span className="engraved" id="utc-label">UTC</span>
        <time className={`window clock${s.playing ? '' : ' held'}`} dateTime={iso} aria-labelledby="utc-label">
          {iso.slice(0, 10)} {iso.slice(11, 19)}{!s.playing && <span className="hold">Hold</span>}
        </time>
      </div>
      <div className="field">
        <label className="engraved" htmlFor="rate">Rate</label>
        <select id="rate" className="rate" value={s.rate} onChange={(e) => clock.setRate(Number(e.target.value))}>
          {RATES.map((r) => <option key={r.rate} value={r.rate}>{r.label}</option>)}
        </select>
      </div>
      <div className="keys-row">
        <button className="key run" onClick={() => clock.setPlaying(!s.playing)} aria-pressed={s.playing}
          title={s.playing ? 'Hold time (Space)' : 'Run time (Space)'}>Run</button>
        <button className="key" onClick={() => clock.setTime(Date.now())} title="Jump to now (N)">Now</button>
      </div>
      {jump && (
        <div className="notice" role="status">
          <span>Clock set {span(jump.toMs - jump.fromMs)}</span>
          <button className="key small" onClick={() => clock.undoJump()} title={`Back to ${new Date(jump.fromMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`}>Back</button>
          <button className="key small" onClick={() => clock.dismissJump()} aria-label="Dismiss">OK</button>
        </div>
      )}
      <div className="lamps">
        <Lamp on={s.playing} label="Run" title="Time is running" />
        <Lamp on={live} label="Live" title="The sim clock is within a minute of now" />
        <Lamp on={mission.stepping} label="Kernel" title="The n-body kernel is stepping a craft" />
        <span className="lamp caution-lamp" data-on={mission.lagging} title="A craft is more than a minute behind the clock (the kernel catches up rather than take unsafe steps)"><i aria-hidden="true" />Lag</span>
      </div>
    </header>
  );
}

export function BodyRail({ clock, focus, onSelect }: { clock: SimClock; focus: BodyKey | null; onSelect: (k: BodyKey) => void }) {
  const s = useClock(clock);
  const date = new Date(s.timeMs);
  return (
    <nav className="rail screw" aria-labelledby="bodies-label">
      <span className="pnl" aria-hidden="true">L1</span>
      <h2 className="strip" id="bodies-label">Bodies</h2>
      <ul className="body-list">
        {BODIES.map((b) => {
          const r = b.key === 'sun' ? null : norm(bodyState(b.key, date).r) / AU_KM;
          return (
            <li key={b.key}>
              <button className={`body-row${b.parent === 'earth' ? ' child' : ''}`} aria-current={b.key === focus}
                onClick={() => onSelect(b.key)} title={r === null ? b.name : `${b.name}: ${r.toFixed(3)} AU from the Sun`}>
                <span className="lamp-sq" style={{ background: `#${b.colour.toString(16).padStart(6, '0')}` }} />
                <span>{b.name}</span>
                <span className="dist">{r === null || b.parent === 'earth' ? '' : r.toFixed(2)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="rail-foot">
        <p><kbd>Space</kbd> run/hold · <kbd>←</kbd><kbd>→</kbd> rate</p>
        <p><kbd>↑</kbd><kbd>↓</kbd> body · <kbd>N</kbd> now</p>
        <p>Drag to turn, scroll to zoom.</p>
        <a href="https://github.com/Zyzzbarth333/digital-orrery/blob/main/docs/README.md" target="_blank" rel="noreferrer">How it works</a>
      </div>
    </nav>
  );
}

interface Row { label: string; value: string; unit?: string; alt?: string; src: string; derived?: boolean; detail: string; hint?: string }

// Plain-language meanings of the readout labels, shown on hover.
export const HINTS: Record<string, string> = {
  'Motion': 'How this body moves in the app: planets follow NASA ephemerides exactly ("on rails"); spacecraft are integrated under gravity step by step',
  'From the Sun': 'Distance from the centre of the Sun',
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
};

function Readout({ rows }: { rows: Row[] }) {
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
            <td className="src"><span className={`src-tag${r.derived ? ' derived' : ''}`} title={r.detail}>{r.src}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const AE = 'astronomy-engine; within 1e-4 of the Sun distance of DE442, checked with CSPICE';

export type PlateTab = 'target' | 'mission' | 'planner';

// The right-hand plate: three tabs on the same panel.
export function Plate({ clock, focus, mission, tab, setTab, onFocusCraft, autoPlan = null }: {
  clock: SimClock; focus: BodyKey; mission: Mission; tab: PlateTab; setTab: (t: PlateTab) => void; onFocusCraft: (id: number) => void; autoPlan?: string | null;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const tabs: [PlateTab, string][] = [['target', 'Target'], ['mission', 'Mission'], ['planner', 'Planner']];
  return (
    <aside className="plate screw" aria-label="Readouts" data-collapsed={collapsed}>
      <span className="pnl" aria-hidden="true">R1</span>
      <div className="tabs" role="tablist" aria-label="Plate">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" id={`tab-${k}`} aria-selected={tab === k} aria-controls={`panel-${k}`} className="key tab" onClick={() => setTab(k)}>{label}</button>
        ))}
        <button className="key plate-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show' : 'Hide'}</button>
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tab-panel">
        {tab === 'target' && <DataPlate clock={clock} focus={focus} />}
        {tab === 'mission' && <MissionPanel clock={clock} mission={mission} onFocusCraft={onFocusCraft} />}
        {tab === 'planner' && <PlannerPanel clock={clock} mission={mission} autoPlan={autoPlan} onFlown={(id) => { setTab('mission'); onFocusCraft(id); }} />}
      </div>
    </aside>
  );
}

export function DataPlate({ clock, focus }: { clock: SimClock; focus: BodyKey }) {
  const s = useClock(clock);
  const b = BODY_BY_KEY[focus];
  const date = new Date(s.timeMs);
  const st = bodyState(focus, date);
  const earth = bodyState('earth', date);
  const rSun = norm(st.r);
  const fromEarth = norm([st.r[0] - earth.r[0], st.r[1] - earth.r[1], st.r[2] - earth.r[2]]);
  const ownGm = b.planetGm ?? b.gm;
  const rows: Row[] = [];
  rows.push(focus === 'sun'
    ? { label: 'Motion', value: 'Fixed', alt: 'the centre of the frame', src: 'frame', derived: true, detail: 'positions are heliocentric: the Sun is the origin' }
    : { label: 'Motion', value: 'Ephemeris', alt: 'on rails, not integrated', src: 'AE', detail: 'planets and the Moon follow their ephemeris exactly; only spacecraft are integrated' });
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
    <div className="tab-body">
      <div className="plate-head">
        <h2>{b.name}</h2>
        <p className="engraved">{kind}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      <Readout rows={rows} />
      <div className="plate-notes">
        <p>Each value&apos;s tag names its source; a dashed tag is worked out here. Hover a tag for detail.</p>
      </div>
    </div>
  );
}
