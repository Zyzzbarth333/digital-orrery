// src/app/panels.tsx
//
// The instrument panels around the sky: the header band (clock and rate in
// readout windows, the RUN and NOW keys, the FLIGHT field, indicator lamps),
// the body rail and the data plate. Every readout in the plate carries its
// source (the provenance column): a solid tag for data, a dashed one for
// values derived here. Numbers are re-read from the ephemeris at most ten
// times a second, and the header and rail redraw only when what they show
// changes.

import { useEffect, useState, useSyncExternalStore } from 'react';
import { loadManifest, type Manifest } from '../scene/surfaces';
import { useClock, useClockValue, type SimClock } from './clock';
import type { Mission } from './mission';
import { BODIES, BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { bodyState } from '../scene/OrreryScene';
import { MU_SUN } from '../physics/bodies.js';
import { SourceTag, type TagInfoKey } from './source-tag';
import { siderealDays, obliquity, solarDays, density, escapeSpeed, sunRotationDays, galacticYears, sunFromBarycentreKm } from '../physics/bodyfacts.js';

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
// Formatters are built once: toLocaleString builds a new one on every call,
// and the plate formats a dozen numbers ten times a second.
const SIG10 = new Intl.NumberFormat('en-AU', { maximumSignificantDigits: 10 });
const GROUP = new Map<number, Intl.NumberFormat>();
const sig10 = (n: number) => SIG10.format(n);
const fmtGroup = (n: number, digits = 0) => {
  let f = GROUP.get(digits);
  if (!f) { f = new Intl.NumberFormat('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits }); GROUP.set(digits, f); }
  return f.format(n);
};

// A craft by id: one flying in the kernel, or one still climbing from the
// pad (an ascent, not yet in mission.crafts).
export function craftById(mission: Mission, id: number | null): { name: string; climbing: boolean; craft: Mission['crafts'][number] } | null {
  if (id === null) return null;
  const c = mission.crafts.find((x) => x.id === id);
  if (c) return { name: c.name, climbing: false, craft: c };
  const a = mission.ascents.find((x) => x.craft.id === id);
  return a ? { name: a.craft.name, climbing: true, craft: a.craft } : null;
}

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
  // One snapshot string, re-rendered only when it changes: id, state and
  // count first, the name last so a name containing the separator survives.
  const key = useMissionValue(mission, () => {
    const sel = craftById(mission, mission.snapshot.selected);
    const n = mission.crafts.length + mission.ascents.length;
    if (!sel) return `none||${n}|`;
    const c = sel.craft;
    const state = sel.climbing ? 'Climb' : c.crashed ? 'Lost' : c.error ? 'Fault' : c.thrusting() ? 'Burn' : 'Coast';
    return `${c.id}|${state}|${n}|${sel.name}`;
  });
  const [id, state, countStr, ...rest] = key.split('|');
  const name = rest.join('|');
  const craft = id !== 'none', others = Number(countStr) - (craft ? 1 : 0);
  const spoken = craft ? `Flight: ${name}, ${state.toLowerCase()}${others > 0 ? `, and ${others} more in the console` : ''}. Follow it with the camera.` : 'Flight: no craft yet';
  return (
    <div className="field flight">
      <span className="engraved" id="flight-label">Flight</span>
      <button className={`window craft-window${craft ? '' : ' empty'}${following !== null && String(following) === id ? ' followed' : ''}`}
        aria-label={spoken} disabled={!craft} onClick={() => craft && onFollow(Number(id))}
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
  // The clock is silent while held, but the present moves on: re-read LIVE
  // (and NOW's state) every second.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (playing) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [playing]);
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

// The small-body populations the rail can show or hide (src/scene/smallBodies.ts).
const SMALL_BODY_ROWS: { key: 'belt' | 'neo' | 'trojans' | 'outer' | 'comets'; label: string; colour: string; title: string }[] = [
  { key: 'belt', label: 'Main belt', colour: '#a3a3a3', title: 'Main-belt asteroids brighter than H 15 (JPL SBDB)' },
  { key: 'neo', label: 'Near-Earth', colour: '#ff9e4d', title: 'Every near-Earth asteroid in JPL SBDB' },
  { key: 'trojans', label: 'Trojans', colour: '#8fcc85', title: "Jupiter's trojans, ahead of and behind it in its orbit" },
  { key: 'outer', label: 'Kuiper belt', colour: '#b399f2', title: 'Centaurs and trans-Neptunian objects, Eris, Haumea and Makemake among them' },
  { key: 'comets', label: 'Comets', colour: '#73dbf2', title: 'Periodic comets (orbits from their last apparition for most)' },
];

export function BodyRail({ clock, focus, onSelect, smallBodies, onSmallBodies }: { clock: SimClock; focus: BodyKey | null; onSelect: (k: BodyKey) => void; smallBodies?: Record<string, boolean>; onSmallBodies?: (key: 'belt' | 'neo' | 'trojans' | 'outer' | 'comets' | 'colours', on: boolean) => void }) {
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
      {smallBodies && onSmallBodies && (
        <>
          <h2 className="strip split"><span>Small bodies</span><span title="shown">On</span></h2>
          <ul className="body-list small-bodies">
            {SMALL_BODY_ROWS.map((g) => (
              <li key={g.key}>
                <button className="body-row" role="switch" aria-checked={!!smallBodies[g.key]} onClick={() => onSmallBodies(g.key, !smallBodies[g.key])} title={g.title}>
                  <span className="lamp-sq" style={{ background: smallBodies[g.key] ? g.colour : 'transparent', borderColor: g.colour }} />
                  <span>{g.label}</span>
                  <span className="dist">{smallBodies[g.key] ? 'on' : 'off'}</span>
                </button>
              </li>
            ))}
            <li>
              <button className="body-row" role="switch" aria-checked={!!smallBodies.colours} onClick={() => onSmallBodies('colours', !smallBodies.colours)} title="Colour each population as its swatch; off, asteroids are drawn a natural grey and comets pale blue">
                <span className="lamp-sq" style={{ background: smallBodies.colours ? 'var(--phosphor)' : 'transparent', borderColor: 'var(--phosphor)' }} />
                <span>Colour by kind</span>
                <span className="dist">{smallBodies.colours ? 'on' : 'off'}</span>
              </button>
            </li>
          </ul>
        </>
      )}
      <div className="rail-foot">
        <p><kbd>Space</kbd> run/hold · <kbd>←</kbd><kbd>→</kbd> rate</p>
        <p><kbd>↑</kbd><kbd>↓</kbd> body · <kbd>N</kbd> now</p>
        <p><kbd>M</kbd> flight console · <kbd>Esc</kbd> stop</p>
        <p>Choose a body to fly there; drag to turn, scroll to zoom.</p>
        <div className="foot-links">
          <a href="https://github.com/Zyzzbarth333/digital-orrery/blob/main/docs/README.md" target="_blank" rel="noreferrer">How it works</a>
          <Credits />
        </div>
      </div>
    </nav>
  );
}

// Where every image and catalogue comes from, as their providers ask
// (docs/frontend/textures.md#sources-and-credits), read from the texture
// manifest so it always matches what is drawn.
function Credits() {
  const [m, setM] = useState<Manifest | null>(null);
  useEffect(() => { void loadManifest().then(setM); }, []);
  const items: [string, string][] = [];
  if (m) {
    for (const [k, e] of Object.entries(m.bodies)) if (e) items.push([BODY_BY_KEY[k as BodyKey].name, e.credit]);
    if (m.rings?.saturn) items.push(["Saturn's rings", m.rings.saturn.credit]);
    if (m.stars) items.push(['Sky', m.stars.credit]);
  }
  items.push(['Daily Earth', 'NASA GIBS / EOSDIS: Terra MODIS, Suomi NPP and NOAA-20 and -21 VIIRS corrected reflectance']);
  // CC BY 4.0 asks for a link to the licence and, where practical, to the
  // material; the maps' own credit lines name it.
  const ccLink = (
    <>Solar System Scope&apos;s maps (<a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer">solarsystemscope.com</a>) are
      used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.</>
  );
  items.push(['Ephemerides', 'JPL DE442 and satellite kernels via NAIF SPICE; astronomy-engine (MIT)']);
  return (
    <details className="credits">
      <summary>Credits</summary>
      <dl className="credits-list">
        {items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        <div><dt>Licences</dt><dd>{ccLink}</dd></div>
      </dl>
    </details>
  );
}

interface Row { label: string; value: string; unit?: string; alt?: string; src: string; derived?: boolean; info: TagInfoKey; detail?: string; hint?: string }

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
  'Rotation': 'Time for one turn about its axis, against the stars',
  'Solar day': 'Time from one noon to the next: one turn against the Sun, which the orbit moves along the sky',
  'Axial tilt': 'Angle between the spin axis and the orbit\'s axis (obliquity)',
  'Mean density': 'Mass over volume',
  'Escape speed': 'Speed needed at the surface to leave for good, without further push',
  'At the equator': 'The Sun is gas: its equator turns faster than its poles',
  'Near the poles': 'The Sun is gas: its poles turn slower than its equator',
  'From the barycentre': 'How far the solar system\'s centre of mass is from the Sun\'s centre: the Sun wanders round it as the giant planets go round',
  'Galactic orbit': 'Time for the Sun to go once round the centre of the Milky Way',
};

// Each row's source tag opens what the value is, its equation and its
// source (source-tag.tsx).
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
            <td className="src"><SourceTag src={r.src} derived={r.derived} info={r.info} detail={r.detail} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// The right-hand plate: the data of the body in view. Missions, the
// planner and the rocket moved to the flight console (console.tsx).
// covered: the flight console lies over the plate (up to 1680 px wide), so
// it leaves the tab order and stops re-rendering.
export function Plate({ clock, focus, covered = false }: { clock: SimClock; focus: BodyKey; covered?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <aside className="plate screw" aria-label="Target readouts" data-collapsed={collapsed} inert={covered || undefined}>
      <span className="pnl" aria-hidden="true">R1</span>
      <button className="key plate-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show data' : 'Hide data'}</button>
      <div className="tab-panel">
        {!covered && <DataPlate clock={clock} focus={focus} />}
      </div>
    </aside>
  );
}

// A period as hours below two days, else days.
function period(days: number): { value: string; unit: string } {
  return days < 2 ? { value: (days * 24).toFixed(3), unit: 'h' } : { value: fmtGroup(days, 2), unit: 'd' };
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
    ? { label: 'Motion', value: 'Fixed', alt: 'the centre of the frame', src: 'frame', derived: true, info: 'frame' }
    : { label: 'Motion', value: 'Ephemeris', alt: 'on rails, not integrated', src: 'AE', info: 'ephemeris' });
  if (focus !== 'sun') {
    rows.push({ label: 'From the Sun', value: (rSun / AU_KM).toFixed(6), unit: 'AU', alt: `${fmtGroup(rSun)} km`, src: 'AE', info: 'sun-distance' });
    rows.push({ label: 'Speed', value: norm(st.v).toFixed(3), unit: 'km/s', alt: 'heliocentric', src: 'AE', info: 'sun-speed' });
  }
  if (focus !== 'earth') {
    rows.push({ label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', src: 'AE', info: 'earth-distance' });
    const lt = fromEarth / C_KM_S;
    rows.push({
      label: 'Light time', value: lt < 60 ? lt.toFixed(3) : lt < 3600 ? (lt / 60).toFixed(2) : (lt / 3600).toFixed(3),
      unit: lt < 60 ? 's' : lt < 3600 ? 'min' : 'h', src: 'd/c', derived: true, info: 'light-time',
    });
  }
  rows.push({ label: 'Mean radius', value: fmtGroup(b.radiusKm, b.radiusKm < 10000 ? 1 : 0), unit: 'km', src: 'IAU', info: 'mean-radius' });
  if (b.gm) {
    rows.push({
      label: b.planetGm ? 'GM, system' : 'GM', value: sig10(b.gm), unit: 'km³/s²', src: 'DE442', info: 'gm',
      detail: b.gmNote,
    });
  }
  if (b.planetGm) {
    const [naif, kernel] = (b.planetGmNote ?? '').split(', ');
    rows.push({ label: 'GM, planet', value: sig10(b.planetGm), unit: 'km³/s²', src: kernel?.split(' ')[0] ?? 'NAIF', info: 'gm-planet', detail: `${naif}, from the satellite kernel ${kernel}` });
  }
  if (ownGm) {
    rows.push({ label: 'Mean density', value: (density(ownGm, b.radiusKm) / 1000).toFixed(3), unit: 'g/cm³', src: 'M/V', derived: true, info: 'density' });
  }
  if (ownGm && focus !== 'sun') {
    rows.push({ label: 'Surface gravity', value: ((ownGm / (b.radiusKm * b.radiusKm)) * 1000).toFixed(3), unit: 'm/s²', alt: 'sphere, no rotation', src: 'GM/R²', derived: true, info: 'surface-gravity' });
  }
  if (ownGm) {
    rows.push({ label: 'Escape speed', value: escapeSpeed(ownGm, b.radiusKm).toFixed(focus === 'sun' ? 1 : 3), unit: 'km/s', alt: 'from the surface', src: '√2GM/R', derived: true, info: 'escape-speed' });
  }
  if (b.geometricAlbedo) {
    rows.push({ label: 'Geometric albedo', value: b.geometricAlbedo.toFixed(3), src: 'NSSDCA', info: 'albedo' });
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
    rows.push({ label: 'Orbital period', value: fmtGroup(T, 3), unit: 'd', src: '2-body', derived: true, info: 'orbital-period', detail: `of the osculating orbit about ${focus === 'moon' ? 'Earth' : 'the Sun'} at this instant (a = ${fmtGroup(a, 0)} km); the real orbit is perturbed` });
  }
  // How it turns (the IAU rotation model, bodyfacts.js): the sidereal
  // period, the solar day where it differs by more than 0.1 %, and the tilt
  // of the spin axis to the orbit (over 90°: it turns backwards).
  if (focus !== 'sun') {
    const about = focus === 'moon' ? earth : null;
    const rel = about ? { r: st.r.map((x, i) => x - about.r[i]), v: st.v.map((x, i) => x - about.v[i]) } : st;
    const tilt = obliquity(focus, date, rel);
    const P = siderealDays(focus);
    // The Sun's direction turns at the mean motion about the Sun: the
    // Earth's, for the Moon.
    const helio = focus === 'moon' ? earth : st;
    const muH = MU_SUN + (focus === 'moon' ? BODY_BY_KEY.earth.gm! + b.gm! : b.gm ?? 0);
    const rH = norm(helio.r), vH = norm(helio.v);
    const yearDays = 2 * Math.PI * Math.sqrt((1 / (2 / rH - (vH * vH) / muH)) ** 3 / muH) / 86400;
    const solar = solarDays(focus, date, rel, yearDays);
    const back = tilt > 90;
    rows.push({
      label: 'Rotation', ...period(P), alt: `sidereal${back ? ', turning backwards' : ''}`, src: 'IAU', info: 'rotation',
      detail: focus === 'earth' ? 'the Earth Rotation Angle\'s rate (IAU 2000, IERS Conventions 2010): the stellar day'
        : focus === 'neptune' ? 'NASA\'s fact sheet gives 16.11 h, the period of Voyager 2\'s radio bursts; the IAU model turns at 541.14° a day'
          : focus === 'moon' ? 'locked: it turns once each orbit of the Earth' : undefined,
    });
    if (Math.abs(solar - P) / P > 0.001) rows.push({ label: 'Solar day', ...period(solar), alt: 'noon to noon', src: '2-body', derived: true, info: 'solar-day', detail: `with a year of ${fmtGroup(yearDays, 2)} d${focus === 'moon' ? ' (the Earth\'s): the Moon\'s day is the month from new moon to new moon' : ''}` });
    rows.push({
      label: 'Axial tilt', value: tilt.toFixed(2), unit: '°', alt: `to the ${focus === 'moon' ? 'orbit about Earth' : 'orbit'}${back ? ': over 90°, retrograde' : ''}`, src: 'IAU', derived: true, info: 'obliquity',
      detail: focus === 'pluto' ? 'NASA\'s fact sheet gives 122.53°; the IAU 2015 pole puts it at this'
        : focus === 'moon' ? 'its orbit\'s plane rocks, so this varies by about 0.1° (6.68° on average)' : undefined,
    });
  } else {
    rows.push({ label: 'Rotation', ...period(siderealDays('sun')), alt: 'sidereal, the IAU\'s (Carrington) rate', src: 'IAU', info: 'rotation-sun' });
    rows.push({ label: 'At the equator', ...period(sunRotationDays(0)), alt: 'sidereal', src: 'HHF 1990', info: 'sun-differential' });
    rows.push({ label: 'Near the poles', ...period(sunRotationDays(90)), alt: 'sidereal, the fit carried to 90°', src: 'HHF 1990', info: 'sun-differential' });
    rows.push({ label: 'Axial tilt', value: obliquity('sun', date).toFixed(2), unit: '°', alt: 'its equator to the ecliptic', src: 'IAU', derived: true, info: 'sun-tilt' });
    const ssb = sunFromBarycentreKm(date);
    rows.push({ label: 'From the barycentre', value: fmtGroup(ssb), unit: 'km', alt: `${(ssb / b.radiusKm).toFixed(2)} solar radii, from its centre`, src: 'AE', derived: true, info: 'barycentre' });
    rows.push({ label: 'Galactic orbit', value: fmtGroup(galacticYears() / 1e6, 0), unit: 'million yr', alt: 'once round the Galaxy\'s centre', src: 'VLBA', derived: true, info: 'galactic-orbit' });
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
        <p>Each tag names its value&apos;s source; a dashed one is worked out here. Hover, focus or tap a tag for its equation.</p>
      </div>
    </div>
  );
}
