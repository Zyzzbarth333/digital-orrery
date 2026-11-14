// src/app/panels.tsx
//
// The instrument panels around the sky: the header band (clock and rate in
// readout windows, the RUN and NOW keys, the FLIGHT field, indicator lamps),
// the body rail and the data plate. Every readout in the plate carries its
// source (the provenance column): a solid tag for data, a dashed one for
// values derived here. Numbers are re-read from the ephemeris at most ten
// times a second, and the header and rail redraw only when what they show
// changes.

import { useState, useSyncExternalStore } from 'react';
import { useClock, useClockValue, type SimClock } from './clock';
import type { Mission } from './mission';
import { BODIES, BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { bodyState } from '../scene/OrreryScene';
import { MU_SUN } from '../physics/bodies.js';

const AU_KM = 149597870.7;
const C_KM_S = 299792.458;

export const RATES: { label: string; rate: number }[] = [
  { label: 'Real time', rate: 1 },
  { label: '10 s/s', rate: 10 },
  { label: '1 min/s', rate: 60 },
  { label: '1 h/s', rate: 3600 },
  { label: '1 d/s', rate: 86400 },
  { label: '1 wk/s', rate: 7 * 86400 },
  { label: '30 d/s', rate: 30 * 86400 },
  { label: '1 yr/s', rate: 365.25 * 86400 },
];

const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
const sig10 = (n: number) => n.toLocaleString('en-AU', { maximumSignificantDigits: 10 });
const fmtGroup = (n: number, digits = 0) => n.toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function Lamp({ on, label, title, kind = 'advisory' }: { on: boolean; label: string; title: string; kind?: 'advisory' | 'caution' | 'warning' }) {
  return <span className={`lamp k-${kind}`} data-on={on} title={title} aria-label={`${label}: ${on ? 'on' : 'off'}`}><i aria-hidden="true" />{label}</span>;
}

// How far the clock was set, in words: +2.05 yr, -3.2 d, +45 min.
function span(ms: number): string {
  const a = Math.abs(ms) / 1000, sign = ms < 0 ? '−' : '+';
  if (a >= 365.25 * 86400) return `${sign}${(a / (365.25 * 86400)).toFixed(2)} yr`;
  if (a >= 86400) return `${sign}${(a / 86400).toFixed(1)} d`;
  if (a >= 3600) return `${sign}${(a / 3600).toFixed(1)} h`;
  return `${sign}${Math.round(a / 60)} min`;
}

// The clock's window: the one part of the header that changes every second.
function ClockWindow({ clock }: { clock: SimClock }) {
  const sec = useClockValue(clock, (s) => Math.floor(s.timeMs / 1000));
  const playing = useClockValue(clock, (s) => s.playing);
  const iso = new Date(sec * 1000).toISOString();
  return (
    <time className={`window clock${playing ? '' : ' held'}`} dateTime={iso} aria-labelledby="utc-label">
      {iso.slice(0, 10)} {iso.slice(11, 19)}{!playing && <span className="hold">Hold</span>}
    </time>
  );
}

// A store value that redraws only when its key changes (Object.is).
function useMissionValue<T>(mission: Mission, select: () => T): T {
  return useSyncExternalStore(mission.subscribe, select);
}

// The header's FLIGHT field: missions and craft are the app's, not a
// body's, so they are reached from here whatever is in view. The window
// names the selected craft and its state, and follows it when pressed;
// the key opens the flight console.
function FlightField({ mission, consoleOpen, onToggleConsole, following, onFollow }: {
  mission: Mission; consoleOpen: boolean; onToggleConsole: () => void; following: number | null; onFollow: (id: number) => void;
}) {
  const key = useMissionValue(mission, () => {
    const c = mission.selected, n = mission.crafts.length;
    if (!c) return `none|||${n}`;
    const state = c.crashed ? 'Lost' : c.error ? 'Fault' : c.thrusting() ? 'Burn' : 'Coast';
    return `${c.id}|${c.name}|${state}|${n}`;
  });
  const [id, name, state, countStr] = key.split('|');
  const craft = id !== 'none', others = Number(countStr) - (craft ? 1 : 0);
  return (
    <div className="field flight">
      <span className="engraved" id="flight-label">Flight</span>
      <button className={`window craft-window${craft ? '' : ' empty'}${following !== null && String(following) === id ? ' followed' : ''}`}
        aria-labelledby="flight-label" disabled={!craft} onClick={() => craft && onFollow(Number(id))}
        title={craft ? `Follow ${name} with the camera` : 'No craft yet: open the console to launch one or fly a real mission'}>
        <span className="glyph" aria-hidden="true" />
        {craft ? <><span className="craft-name">{name}</span><span className={`craft-state s-${state.toLowerCase()}`}>{state}</span></>
          : <span className="craft-name">No craft</span>}
        {craft && others > 0 && <span className="craft-count" title={`${others} more in the console`}>+{others}</span>}
      </button>
      <button className="key console-key" aria-expanded={consoleOpen} aria-controls="flight-console" onClick={onToggleConsole}
        title={`${consoleOpen ? 'Close' : 'Open'} the flight console: missions, planner, rocket (M)`}>Console</button>
    </div>
  );
}

export function TimeBand({ clock, mission, consoleOpen, onToggleConsole, following, onFollow }: {
  clock: SimClock; mission: Mission; consoleOpen: boolean; onToggleConsole: () => void; following: number | null; onFollow: (id: number) => void;
}) {
  const playing = useClockValue(clock, (s) => s.playing);
  const rate = useClockValue(clock, (s) => s.rate);
  const jump = useClockValue(clock, (s) => s.lastJump);
  const live = useClockValue(clock, (s) => Math.abs(s.timeMs - Date.now()) < 60e3);
  const lamps = useMissionValue(mission, () => `${+mission.stepping}${+mission.lagging}${+mission.warning}${+mission.alarm}|${mission.warningText}`);
  const [flags, warningText] = [lamps.slice(0, 4), lamps.slice(5)];
  const s = { playing, rate };
  return (
    <header className="band screw">
      <span className="pnl" aria-hidden="true">PNL F1</span>
      <h1 className="wordmark">digital-orrery</h1>
      <div className="field">
        <span className="engraved" id="utc-label">UTC</span>
        <ClockWindow clock={clock} />
        {/* The jump notice hangs just under the clock it is about, so the
            header keeps its width (inline where the header wraps). */}
        {jump && (
          <div className="notice jump" role="status">
            <span>Clock set {span(jump.toMs - jump.fromMs)}</span>
            <button className="key small" onClick={() => clock.undoJump()} title={`Back to ${new Date(jump.fromMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`}>Back</button>
            <button className="key small" onClick={() => clock.dismissJump()} aria-label="Dismiss">OK</button>
          </div>
        )}
      </div>
      <div className="field">
        <label className="engraved" htmlFor="rate">Rate</label>
        <select id="rate" className="rate" value={s.rate} onChange={(e) => clock.setRate(Number(e.target.value))}>
          {RATES.map((r) => <option key={r.rate} value={r.rate}>{r.label}</option>)}
        </select>
      </div>
      {/* RUN and HOLD latch like tape-deck keys: the lit key is the state. */}
      <div className="keys-row" role="radiogroup" aria-label="Time">
        <button className="key run" role="radio" aria-checked={s.playing} onClick={() => clock.setPlaying(true)} title="Run time (Space)">Run</button>
        <button className="key hold" role="radio" aria-checked={!s.playing} onClick={() => clock.setPlaying(false)} title="Hold time (Space)">Hold</button>
        <button className="key" onClick={() => clock.setTime(Date.now())} disabled={live} title={live ? 'Already at the present' : 'Jump to now (N)'}>Now</button>
      </div>
      <FlightField mission={mission} consoleOpen={consoleOpen} onToggleConsole={onToggleConsole} following={following} onFollow={onFollow} />
      {/* Annunciator, after the Shuttle's caution and warning panel: green
          advisories, amber caution, red warning. Every light is labelled
          (never colour alone); a warning sounds the master alarm, which ACK
          clears, but its light stays lit while the condition lasts. */}
      <div className="annunciator" role="group" aria-label="Status">
        <Lamp on={live} label="Live" title="The sim clock is within a minute of now" />
        <Lamp on={flags[0] === '1'} label="Kernel" title="The n-body kernel is stepping a craft" />
        <Lamp on={flags[1] === '1'} label="Lag" kind="caution" title="A craft is more than a minute behind the clock; the kernel catches up rather than take unsafe steps" />
        <Lamp on={flags[2] === '1'} label="Warn" kind="warning" title={warningText || 'A craft has crashed or the kernel refused it'} />
        {flags[3] === '1' && <button className="key small master" onClick={() => mission.acknowledge()} title="Acknowledge the master alarm">Ack</button>}
      </div>
    </header>
  );
}

export function BodyRail({ clock, focus, onSelect }: { clock: SimClock; focus: BodyKey | null; onSelect: (k: BodyKey) => void }) {
  // Redraw when a shown distance (two decimals) changes, not every tick.
  const dists = useClockValue(clock, (s) => {
    const date = new Date(s.timeMs);
    return BODIES.map((b) => (b.key === 'sun' ? '' : (norm(bodyState(b.key, date).r) / AU_KM).toFixed(3))).join(',');
  }).split(',');
  return (
    <nav className="rail screw" aria-labelledby="bodies-label">
      <span className="pnl" aria-hidden="true">L1</span>
      <p className="rail-mark" aria-hidden="true">digital-orrery</p>
      <h2 className="strip split" id="bodies-label"><span>Bodies</span><span title="distance from the Sun">AU</span></h2>
      <ul className="body-list">
        {BODIES.map((b, i) => {
          const r = b.key === 'sun' ? null : Number(dists[i]);
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
        <p><kbd>M</kbd> flight console · <kbd>Esc</kbd> stop</p>
        <p>Choose a body to fly there; drag to turn, scroll to zoom.</p>
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

// A source tag is a button: hover or tap it for the source's detail, shown
// under the table (touch screens have no hover).
function Readout({ rows }: { rows: Row[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const openRow = rows.find((r) => r.label === open);
  return (
    <>
    <table className="readout">
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row" title={r.hint ?? HINTS[r.label]}>{r.label}</th>
            <td className="value">
              {r.value}{r.unit && <span className="unit">{r.unit}</span>}
              {r.alt && <span className="alt">{r.alt}</span>}
            </td>
            <td className="src">
              <button className={`src-tag${r.derived ? ' derived' : ''}${open === r.label ? ' open' : ''}`} title={r.detail}
                aria-expanded={open === r.label} onClick={() => setOpen(open === r.label ? null : r.label)}>{r.src}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <p className="tag-detail" aria-live="polite">
      {openRow ? <><b>{openRow.src}</b> {openRow.detail}</> : <>Each tag names the value&apos;s source; a dashed tag is worked out here. Tap a tag for detail.</>}
    </p>
    </>
  );
}

const AE = 'astronomy-engine; within 1e-4 of the Sun distance of DE442, checked with CSPICE';

// The right-hand plate: the data of the body in view. Missions, the
// planner and the rocket moved to the flight console (console.tsx).
export function Plate({ clock, focus }: { clock: SimClock; focus: BodyKey }) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <aside className="plate screw" aria-label="Target readouts" data-collapsed={collapsed}>
      <span className="pnl" aria-hidden="true">R1</span>
      <button className="key plate-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show data' : 'Hide data'}</button>
      <div className="tab-panel">
        <DataPlate clock={clock} focus={focus} />
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
      label: b.planetGm ? 'GM, system' : 'GM', value: sig10(b.gm), unit: 'km³/s²', src: 'DE442',
      detail: `${b.gmNote}; JPL DE442 via SPICE (gm_de442.tpc)`,
    });
  }
  if (b.planetGm) {
    const [naif, kernel] = (b.planetGmNote ?? '').split(', ');
    rows.push({ label: 'GM, planet', value: sig10(b.planetGm), unit: 'km³/s²', src: kernel?.split(' ')[0] ?? 'NAIF', detail: `${naif}, from the satellite kernel ${kernel}` });
  }
  if (ownGm && focus !== 'sun') {
    rows.push({ label: 'Surface gravity', value: ((ownGm / (b.radiusKm * b.radiusKm)) * 1000).toFixed(3), unit: 'm/s²', alt: 'sphere, no rotation', src: 'GM/R²', derived: true, detail: 'derived from the GM and mean radius above' });
  }
  if (b.geometricAlbedo) {
    rows.push({ label: 'Geometric albedo', value: b.geometricAlbedo.toFixed(3), src: 'NSSDCA', detail: 'NASA NSSDCA planetary fact sheet' });
  }
  if (focus !== 'sun' && b.gm) {
    // The period of the osculating orbit at this instant, from the state:
    // a = 1 / (2/r - v^2/mu), with mu = the Sun's GM plus the body's (the
    // Moon's about Earth: Earth's plus the Moon's).
    const about = focus === 'moon' ? bodyState('earth', date) : { r: [0, 0, 0], v: [0, 0, 0] };
    const rr = norm([st.r[0] - about.r[0], st.r[1] - about.r[1], st.r[2] - about.r[2]]);
    const vv = norm([st.v[0] - about.v[0], st.v[1] - about.v[1], st.v[2] - about.v[2]]);
    const mu = (focus === 'moon' ? BODY_BY_KEY.earth.gm! : MU_SUN) + b.gm;
    const a = 1 / (2 / rr - (vv * vv) / mu);
    const T = 2 * Math.PI * Math.sqrt(a ** 3 / mu) / 86400;
    rows.push({ label: 'Orbital period', value: fmtGroup(T, 3), unit: 'd', src: '2-body', derived: true, detail: `of the osculating orbit about ${focus === 'moon' ? 'Earth' : 'the Sun'} at this instant (a = ${fmtGroup(a, 0)} km); the real orbit is perturbed` });
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
      </div>
    </div>
  );
}
