// src/app/panels.tsx
//
// The instrument panels around the sky: the header band (clock and rate in
// readout windows, the RUN and NOW keys, the FLIGHT field, indicator lamps),
// the body rail and the data plate. Every readout in the plate carries its
// source (the provenance column): a solid tag for data, a dashed one for
// values derived here. Numbers are re-read from the ephemeris at most ten
// times a second, and the header and rail redraw only when what they show
// changes.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { loadManifest, type Manifest } from '../scene/surfaces';
import { useClock, useClockValue, type SimClock } from './clock';
import type { Mission } from './mission';
import { BARYS, BARY_BY_KEY, BODIES, BODY_BY_KEY, isBary, isPlanetMoon, systemOf, type BaryKey, type BodyKey, type FocusKey } from '../scene/catalogue';
import { baryState, bodyState, type Frame } from '../scene/OrreryScene';
import { baryGm } from '../physics/barycentres.js';
import { MU_SUN } from '../physics/bodies.js';
import { ROTATION } from '../physics/pck.data.js';
import { helioStateEcl, fromDe442 } from '../physics/ephemeris.js';
import { SourceTag, type TagInfoKey } from './source-tag';
import { SmallBodyPlate } from './small-body-plate';
import type { Named } from '../scene/smallBodies';
import { craftStateWord } from './craft-state.js';
import { siderealDays, obliquity, solarDays, density, escapeSpeed, sunRotationDays, galacticYears } from '../physics/bodyfacts.js';
import type { GuideKey } from '../scene/guides';

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
const sub3 = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
// Formatters are built once: toLocaleString builds a new one on every call,
// and the plate formats a dozen numbers ten times a second.
const SIG10 = new Intl.NumberFormat('en-AU', { maximumSignificantDigits: 10 });
const GROUP = new Map<number, Intl.NumberFormat>();
const sig10 = (n: number) => SIG10.format(n);
export const fmtGroup = (n: number, digits = 0) => {
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
    const state = craftStateWord(c, { climbing: sel.climbing, burning: !sel.climbing && !c.crashed && !c.error && c.thrusting() });
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
// The named small bodies' kinds, in the rail's list order.
const SMALL_KINDS: [string, string][] = [
  ['dwarf planet', 'Dwarf planets'], ['asteroid', 'Asteroids'], ['near-Earth asteroid', 'Near-Earth asteroids'],
  ['Jupiter trojan', 'Jupiter trojans'], ['centaur', 'Centaurs'], ['trans-Neptunian object', 'Trans-Neptunian objects'], ['comet', 'Comets'],
];

const SMALL_BODY_ROWS: { key: 'belt' | 'neo' | 'trojans' | 'outer' | 'comets'; label: string; colour: string; title: string }[] = [
  { key: 'belt', label: 'Main belt', colour: '#a3a3a3', title: 'Main-belt asteroids brighter than H 15 (JPL SBDB)' },
  { key: 'neo', label: 'Near-Earth', colour: '#ff9e4d', title: 'Every near-Earth asteroid in JPL SBDB' },
  { key: 'trojans', label: 'Trojans', colour: '#8fcc85', title: "Jupiter's trojans, ahead of and behind it in its orbit" },
  { key: 'outer', label: 'Kuiper belt', colour: '#b399f2', title: 'Centaurs and trans-Neptunian objects, Eris, Haumea and Makemake among them' },
  { key: 'comets', label: 'Comets', colour: '#73dbf2', title: 'Periodic comets (orbits from their last apparition for most)' },
];

// Drawing aids for gravity (src/scene/guides.ts), each off until switched on.
const GUIDE_ROWS: { key: GuideKey; label: string; colour: string; title: string }[] = [
  { key: 'axes', label: 'Spin axes', colour: '#c8c2b4', title: "Each body's spin axis through its poles (IAU rotation models), north marked N" },
  { key: 'field', label: 'Gravity field', colour: '#2f8fb0', title: 'The real gravity field on the surface: EGM2008 for Earth, GRAIL for the Moon, J2 for the planets' },
  { key: 'spheres', label: 'SOI and Hill', colour: '#ffb22e', title: "Each body's sphere of influence (solid) and Hill sphere (dashed) about its parent" },
  { key: 'lagrange', label: 'Lagrange', colour: '#ecd9b0', title: 'L1 to L5 of Sun-Earth, Earth-Moon, Sun-Jupiter and the focused body with its parent' },
  { key: 'pulls', label: 'Pulls', colour: '#ff7a3d', title: 'The four strongest gravitational pulls on the focused body, GM / d²' },
];

// The moons each planet has in the rail (Earth's Moon is always shown).
const MOON_COUNT: Partial<Record<BodyKey, number>> = {};
for (const b of BODIES) if (isPlanetMoon(b.key)) MOON_COUNT[b.parent!] = (MOON_COUNT[b.parent!] ?? 0) + 1;

export function BodyRail({ clock, focus, onSelect, frame = 'sun', onFrame, smallBodies, onSmallBodies, named = [], small = null, onSmall, guides, onGuides }: { clock: SimClock; focus: FocusKey | null; onSelect: (k: FocusKey) => void; frame?: Frame; onFrame?: (f: Frame) => void; smallBodies?: Record<string, boolean>; onSmallBodies?: (key: 'belt' | 'neo' | 'trojans' | 'outer' | 'comets' | 'colours', on: boolean) => void; named?: readonly Named[]; small?: string | null; onSmall?: (pdes: string) => void; guides?: Record<GuideKey, boolean>; onGuides?: (key: GuideKey, on: boolean) => void }) {
  // Redraw when a shown distance (two decimals) changes, not every tick.
  // Moons show none (they sit at their planet's). In the SSB frame the
  // distances are from the solar system barycentre, the Sun's included.
  const dists = useClockValue(clock, (s) => {
    const date = new Date(s.timeMs);
    const o = frame === 'ssb' ? baryState('ssb', date).r : [0, 0, 0];
    return BODIES.map((b) => ((b.key === 'sun' && frame === 'sun') || isPlanetMoon(b.key) ? ''
      : (norm(sub3(bodyState(b.key, date).r, o)) / AU_KM).toFixed(3))).join(',');
  }).split(',');
  // A planet's moons are listed under it, two to a row, while it, one of
  // them or its barycentre is in view; the chosen row is scrolled into view.
  const open = focus ? (focus === 'moon' ? 'earth' : systemOf(focus)) : null;
  // A barycentre's row: under the Sun and Earth, or first in a planet's grid.
  const baryRow = (k: BaryKey, chip: boolean) => (
    <li key={k}>
      <button className={`body-row ${chip ? 'moon-chip' : 'child'}`} aria-current={k === focus} onClick={() => onSelect(k)}
        title={`${BARY_BY_KEY[k].name}: the centre of mass of ${BARY_BY_KEY[k].members}`}>
        <span className="lamp-sq bary" />
        <span>Barycentre</span>
        {!chip && <span className="dist" />}
      </button>
    </li>
  );
  const baryOf = (k: BodyKey) => BARYS.find((b) => b.of === k)?.key;
  const list = useRef<HTMLUListElement>(null);
  // After layout, so a grid that has just opened is measured.
  useEffect(() => {
    const id = requestAnimationFrame(() => list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(id);
  }, [focus]);
  const lamp = (c: number) => <span className="lamp-sq" style={{ background: `#${c.toString(16).padStart(6, '0')}` }} />;
  return (
    <nav className="rail screw" aria-labelledby="bodies-label">
      <span className="pnl" aria-hidden="true">L1</span>
      <p className="rail-mark" aria-hidden="true">digital-orrery</p>
      <h2 className="strip split" id="bodies-label"><span>Bodies</span>
        {onFrame
          ? <button className="frame-key" aria-pressed={frame === 'ssb'} onClick={() => onFrame(frame === 'sun' ? 'ssb' : 'sun')}
            title={frame === 'sun' ? 'Distances and orbits about the Sun\'s centre. Choose to give them about the solar system barycentre' : 'Distances and orbits about the solar system barycentre. Choose to give them about the Sun\'s centre'}>
            AU · {frame === 'sun' ? 'Sun' : 'SSB'}</button>
          : <span title="distance from the Sun">AU</span>}
      </h2>
      <ul className="body-list" ref={list}>
        {BODIES.map((b, i) => {
          if (isPlanetMoon(b.key)) return null;
          const child = b.parent !== null && b.parent !== 'sun';
          const r = (b.key === 'sun' && frame === 'sun') || child ? null : Number(dists[i]);
          const moons = MOON_COUNT[b.key];
          const shut = moons !== undefined && open !== b.key;
          return [
            <li key={b.key}>
              <button className={`body-row${child ? ' child' : ''}`} aria-current={b.key === focus}
                aria-expanded={moons !== undefined ? !shut : undefined}
                onClick={() => onSelect(b.key)}
                title={child ? `${b.name}, moon of ${BODY_BY_KEY[b.parent!].name}` : r === null ? b.name : `${b.name}: ${r.toFixed(3)} AU from the ${frame === 'sun' ? 'Sun' : 'solar system barycentre'}${shut ? `; choose to list its ${moons} moon${moons === 1 ? '' : 's'}` : ''}`}>
                {lamp(b.colour)}
                <span>{b.name}{shut && <span className="moon-count" aria-label={`, ${moons} moons`}>+{moons}</span>}</span>
                <span className="dist">{r === null ? '' : r.toFixed(2)}</span>
              </button>
            </li>,
            // The Sun's and Earth's barycentres (after the Moon) as rows.
            b.key === 'sun' && open === 'sun' && baryRow('ssb', false),
            b.key === 'moon' && open === 'earth' && baryRow('emb', false),
            moons !== undefined && !shut && (
              <li key={`${b.key}-moons`}>
                <ul className="moon-grid" aria-label={`Moons and barycentre of ${b.name}`}>
                  {baryOf(b.key) && baryRow(baryOf(b.key)!, true)}
                  {BODIES.filter((m) => m.parent === b.key).map((m) => (
                    <li key={m.key}>
                      <button className="body-row moon-chip" aria-current={m.key === focus} onClick={() => onSelect(m.key)} title={`${m.name}, moon of ${b.name}`}>
                        {lamp(m.colour)}
                        <span>{m.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ),
          ];
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
          {/* The named ones, to fly to: the same as clicking a marker in the
              sky, and the way there by keyboard. */}
          {named.length > 0 && onSmall && (
            <label className="sb-pick">
              <span className="engraved">Fly to</span>
              <select className="input select" value={small ?? ''} onChange={(e) => { if (e.target.value) onSmall(e.target.value); }}>
                <option value="">a named one…</option>
                {SMALL_KINDS.map(([kind, label]) => {
                  const list = named.filter((b) => b.kind === kind);
                  return list.length ? <optgroup key={kind} label={label}>{list.map((b) => <option key={b.pdes} value={b.pdes}>{b.name}</option>)}</optgroup> : null;
                })}
              </select>
            </label>
          )}
        </>
      )}
      {guides && onGuides && (
        <>
          <h2 className="strip split"><span>Guides</span><span title="shown">On</span></h2>
          <ul className="body-list small-bodies guides">
            {GUIDE_ROWS.map((g) => (
              <li key={g.key}>
                <button className="body-row" role="switch" aria-checked={guides[g.key]} onClick={() => onGuides(g.key, !guides[g.key])} title={g.title}>
                  <span className="lamp-sq" style={{ background: guides[g.key] ? g.colour : 'transparent', borderColor: g.colour }} />
                  <span>{g.label}</span>
                  <span className="dist">{guides[g.key] ? 'on' : 'off'}</span>
                </button>
              </li>
            ))}
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
    // Bodies whose maps share a source (Saturn's moons) share one line.
    const byCredit = new Map<string, string[]>();
    for (const [k, e] of Object.entries(m.bodies)) {
      if (!e) continue;
      const names = byCredit.get(e.credit) ?? [];
      names.push(BODY_BY_KEY[k as BodyKey].name);
      byCredit.set(e.credit, names);
    }
    for (const [credit, names] of byCredit) items.push([names.join(', '), credit]);
    if (m.rings?.saturn) items.push(["Saturn's rings", m.rings.saturn.credit]);
    if (m.stars) items.push(['Sky', m.stars.credit]);
  }
  items.push(['Daily Earth', 'NASA GIBS / EOSDIS: Terra MODIS, Suomi NPP and NOAA-20 and -21 VIIRS corrected reflectance']);
  items.push(['Moon orbits', 'JPL Solar System Dynamics, planetary satellite mean elements, and JPL Horizons; the Galilean moons from astronomy-engine']);
  // CC BY 4.0 asks for a link to the licence and, where practical, to the
  // material; the maps' own credit lines name it.
  const ccLink = (
    <>Solar System Scope&apos;s maps (<a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noreferrer">solarsystemscope.com</a>) are
      used under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.</>
  );
  items.push(['Ephemerides', 'JPL DE442 and satellite kernels via NAIF SPICE; astronomy-engine (MIT)']);
  items.push(['Equation font', 'DejaVu Math TeX Gyre, from the DejaVu fonts: Bitstream Vera licence, its DejaVu and math additions public domain']);
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

// The right-hand plate: the data of the body in view. Missions, the
// planner and the rocket moved to the flight console (console.tsx).
// covered: the flight console lies over the plate (up to 1680 px wide), so
// it leaves the tab order and stops re-rendering.
export function Plate({ clock, focus, frame = 'sun', covered = false, small = null }: { clock: SimClock; focus: FocusKey; frame?: Frame; covered?: boolean; small?: Named | null }) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <aside className="plate screw" aria-label="Target readouts" data-collapsed={collapsed} inert={covered || undefined}>
      <span className="pnl" aria-hidden="true">R1</span>
      <button className="key plate-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>{collapsed ? 'Show data' : 'Hide data'}</button>
      <div className="tab-panel">
        {!covered && (small ? <SmallBodyPlate clock={clock} body={small} />
          : isBary(focus) ? <BaryPlate clock={clock} bary={focus} frame={frame} /> : <DataPlate clock={clock} focus={focus} frame={frame} />)}
      </div>
    </aside>
  );
}

// A period as hours below two days, else days.
function period(days: number): { value: string; unit: string } {
  return days < 2 ? { value: (days * 24).toFixed(3), unit: 'h' } : { value: fmtGroup(days, 2), unit: 'd' };
}

export function DataPlate({ clock, focus, frame = 'sun' }: { clock: SimClock; focus: BodyKey; frame?: Frame }) {
  const s = useClock(clock);
  const b = BODY_BY_KEY[focus];
  const date = new Date(s.timeMs);
  const st = bodyState(focus, date);
  const earth = bodyState('earth', date);
  const rSun = norm(st.r);
  const fromEarth = norm([st.r[0] - earth.r[0], st.r[1] - earth.r[1], st.r[2] - earth.r[2]]);
  const ownGm = b.planetGm ?? b.gm;
  const rows: Row[] = [];
  // Every planet, Pluto and the Moon come from DE442's table where it covers
  // the date (2000-2050), else from astronomy-engine; a planet's moon rides on
  // its planet's. For the Sun, the SSB (DE442's own inside the table).
  const pm = b.moon;
  const eph = fromDe442(pm ? b.parent! : focus, date) ? 'DE442' : 'AE';
  // In the SSB frame, distance and speed are the barycentre's, and the Sun
  // moves.
  const ssb = frame === 'ssb' ? baryState('ssb', date) : null;
  rows.push(focus === 'sun'
    ? ssb
      ? { label: 'Motion', value: 'About the SSB', alt: 'swung by the giant planets', src: eph, info: 'ssb-offset' }
      : { label: 'Motion', value: 'Fixed', alt: 'the centre of the frame', src: 'frame', derived: true, info: 'frame' }
    : pm
      ? { label: 'Motion', value: 'Mean orbit', alt: 'about its planet, on rails', src: pm.elements.startsWith('JPL') ? 'JPL' : 'AE', info: 'moon-orbit', detail: pm.elements }
      : { label: 'Motion', value: 'Ephemeris', alt: 'on rails, not integrated', src: eph, info: 'ephemeris' });
  if (ssb) {
    const r = norm(sub3(st.r, ssb.r)), v = norm(sub3(st.v, ssb.v));
    rows.push({ label: 'From the SSB', value: (r / AU_KM).toFixed(6), unit: 'AU', alt: `${fmtGroup(r)} km`, src: eph, info: 'ssb-distance' });
    rows.push({ label: 'Speed', value: v.toFixed(focus === 'sun' ? 4 : 3), unit: 'km/s', alt: 'barycentric', src: eph, info: 'ssb-speed' });
  } else if (focus !== 'sun') {
    rows.push({ label: 'From the Sun', value: (rSun / AU_KM).toFixed(6), unit: 'AU', alt: `${fmtGroup(rSun)} km`, src: eph, info: 'sun-distance' });
    rows.push({ label: 'Speed', value: norm(st.v).toFixed(3), unit: 'km/s', alt: 'heliocentric', src: eph, info: 'sun-speed' });
  }
  if (focus !== 'earth') {
    rows.push({ label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', src: eph, info: 'earth-distance' });
    const lt = fromEarth / C_KM_S;
    rows.push({
      label: 'Light time', value: lt < 60 ? lt.toFixed(3) : lt < 3600 ? (lt / 60).toFixed(2) : (lt / 3600).toFixed(3),
      unit: lt < 60 ? 's' : lt < 3600 ? 'min' : 'h', src: 'd/c', derived: true, info: 'light-time',
    });
  }
  rows.push(pm
    ? { label: 'Mean radius', value: fmtGroup(b.radiusKm, b.radiusKm < 100 ? 2 : 1), unit: 'km', src: 'JPL', info: 'moon-radius', detail: `NAIF ${pm.naif}${pm.radiusNote ? `: the sphere of equal volume to ${pm.radiusNote.replace('volume-equivalent of ', '')} km` : ''}` }
    : { label: 'Mean radius', value: fmtGroup(b.radiusKm, b.radiusKm < 10000 ? 1 : 0), unit: 'km', src: 'IAU', info: 'mean-radius' });
  // The shape the scene draws, where it is not a sphere.
  const [ra, rb, rc] = b.radiiKm;
  if (ra !== rc || rb !== rc) {
    const dp = ra < 10000 ? 1 : 0;
    const flat = (ra - rc) / ra;
    rows.push({
      label: 'Shape', value: ra === rb ? `${fmtGroup(ra, dp)} × ${fmtGroup(rc, dp)}` : `${fmtGroup(ra, dp)} × ${fmtGroup(rb, dp)} × ${fmtGroup(rc, dp)}`,
      unit: 'km', alt: ra === rb ? 'equator × pole' : 'semi-axes', src: 'IAU', info: 'triaxial',
      detail: `flattening ${(flat * 100).toFixed(flat < 0.01 ? 2 : 1)} %${ra === rb ? ` (1/${(1 / flat).toFixed(flat < 0.01 ? 1 : 2)})` : ''}`,
    });
  }
  if (b.gm) {
    rows.push(pm
      ? { label: 'GM', value: sig10(b.gm), unit: 'km³/s²', src: 'JPL', info: 'moon-gm', detail: b.gmNote }
      : { label: b.planetGm ? 'GM, system' : 'GM', value: sig10(b.gm), unit: 'km³/s²', src: 'DE442', info: 'gm', detail: b.gmNote });
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
    rows.push(pm
      ? { label: 'Geometric albedo', value: b.geometricAlbedo.toFixed(2), src: 'JPL', info: 'moon-albedo', detail: `NAIF ${pm.naif}` }
      : { label: 'Geometric albedo', value: b.geometricAlbedo.toFixed(3), src: 'NSSDCA', info: 'albedo' });
  }
  if (focus !== 'sun' && b.gm) {
    // The period of the osculating orbit at this instant, from the state:
    // a = 1 / (2/r - v^2/mu), with mu = the Sun's GM plus the body's (the
    // Moon's about Earth: Earth's plus the Moon's).
    // A moon's about its planet's centre, with the planet's own GM; a
    // planet's from its system barycentre (where the scene draws the planet
    // at its centre, which its moons swing about), with the system's GM.
    const host = b.parent !== 'sun' && b.parent ? BODY_BY_KEY[b.parent] : null;
    const about = host ? bodyState(host.key, date) : { r: [0, 0, 0], v: [0, 0, 0] };
    const o = !host && b.planetGm ? (helioStateEcl(focus, date) as { r: number[]; v: number[] }) : st;
    const rr = norm([o.r[0] - about.r[0], o.r[1] - about.r[1], o.r[2] - about.r[2]]);
    const vv = norm([o.v[0] - about.v[0], o.v[1] - about.v[1], o.v[2] - about.v[2]]);
    const mu = (host ? (host.planetGm ?? host.gm!) : MU_SUN) + b.gm;
    const a = 1 / (2 / rr - (vv * vv) / mu);
    const T = 2 * Math.PI * Math.sqrt(a ** 3 / mu) / 86400;
    rows.push({ label: 'Orbital period', value: fmtGroup(T, 3), unit: 'd', src: '2-body', derived: true, info: 'orbital-period', detail: `of the osculating orbit about ${host ? host.name : 'the Sun'} at this instant (a = ${fmtGroup(a, 0)} km); the real orbit is perturbed` });
  }
  // How it turns (the IAU rotation model, bodyfacts.js): the sidereal
  // period, the solar day where it differs by more than 0.1 %, and the tilt
  // of the spin axis to the orbit (over 90°: it turns backwards).
  if (pm) {
    // The planets' moons all turn once each orbit; the period is the IAU
    // model's prime meridian rate (pck00011, orientation.js).
    const W1 = ROTATION[focus as keyof typeof ROTATION].pm[1];
    rows.push({
      label: 'Rotation', ...period(360 / Math.abs(W1)), alt: `synchronous: once each orbit of ${BODY_BY_KEY[b.parent!].name}`, src: 'IAU', info: 'moon-rotation',
      detail: `NAIF ${pm.naif}, ${W1.toFixed(7)}° a day${W1 < 0 ? ': backwards about the IAU north pole, which is on the solar system\'s north side' : ''}`,
    });
  } else if (focus !== 'sun') {
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
    // The SSB (barycentres.js): DE442's own inside its table, else from
    // every planet, not astronomy-engine's four giants; in the SSB frame the
    // rows above already give it.
    if (!ssb) {
      const d = norm(baryState('ssb', date).r);
      rows.push({ label: 'From the SSB', value: fmtGroup(d), unit: 'km', alt: `${(d / b.radiusKm).toFixed(2)} solar radii, from its centre`, src: eph, derived: !fromDe442('ssb', date), info: 'ssb-offset' });
    }
    rows.push({ label: 'Galactic orbit', value: fmtGroup(galacticYears() / 1e6, 0), unit: 'million yr', alt: 'once round the Galaxy\'s centre', src: 'VLBA', derived: true, info: 'galactic-orbit' });
  }
  const kind = focus === 'sun' ? (ssb ? 'Star, swinging about the barycentre' : 'Star, at the centre of the frame') : b.parent && b.parent !== 'sun' ? `Moon of ${BODY_BY_KEY[b.parent].name}` : focus === 'pluto' ? 'Dwarf planet' : 'Planet';
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

// The plate for a barycentre: where it is, what it is the centre of, and
// how far its body's centre sits from it.
export function BaryPlate({ clock, bary, frame = 'sun' }: { clock: SimClock; bary: BaryKey; frame?: Frame }) {
  const s = useClock(clock);
  const b = BARY_BY_KEY[bary];
  const date = new Date(s.timeMs);
  const st = baryState(bary, date);
  const earth = bodyState('earth', date);
  const rows: Row[] = [];
  // DE442's table inside 2000-2050 (the SSB its own, each system's
  // barycentre its planet), else astronomy-engine.
  const eph = fromDe442(bary === 'ssb' ? 'ssb' : bary === 'emb' ? 'earth' : b.of, date) ? 'DE442' : 'AE';
  rows.push({ label: 'Motion', value: 'Barycentre', alt: `the centre of mass of ${b.members}`, src: eph, info: 'bary-what' });
  const ssb = frame === 'ssb' && bary !== 'ssb' ? baryState('ssb', date) : null;
  const o = ssb ? ssb : { r: [0, 0, 0], v: [0, 0, 0] };
  const r = norm(sub3(st.r, o.r)), v = norm(sub3(st.v, o.v));
  rows.push({ label: ssb ? 'From the SSB' : 'From the Sun', value: (r / AU_KM).toFixed(6), unit: 'AU', alt: `${fmtGroup(r)} km`, src: eph, info: ssb ? 'ssb-distance' : 'sun-distance' });
  rows.push({ label: 'Speed', value: v.toFixed(bary === 'ssb' ? 4 : 3), unit: 'km/s', alt: ssb ? 'barycentric' : 'heliocentric', src: eph, info: ssb ? 'ssb-speed' : 'sun-speed' });
  const fromEarth = norm(sub3(st.r, earth.r));
  rows.push({ label: 'From Earth', value: fmtGroup(fromEarth), unit: 'km', src: eph, info: 'earth-distance' });
  rows.push({ label: 'GM within', value: sig10(baryGm(bary)), unit: 'km³/s²', alt: b.members, src: 'DE442', info: 'bary-gm' });
  // How far the body it is listed with sits from it.
  const body = BODY_BY_KEY[b.of];
  const off = norm(sub3(bodyState(b.of, date).r, st.r));
  rows.push({
    label: `${body.name}'s centre`, value: fmtGroup(off, off < 100 ? 3 : 0), unit: 'km', alt: `${(off / body.radiusKm).toFixed(3)} ${body.name} radii from it${off > body.radiusKm ? ', outside the body' : ''}`,
    src: bary === 'ssb' ? eph : bary === 'emb' ? 'DE442' : 'JPL', derived: true, info: bary === 'ssb' ? 'ssb-offset' : 'bary-offset',
  });
  const kind = bary === 'ssb' ? 'Centre of mass of the solar system' : bary === 'emb' ? 'Centre of mass of Earth and the Moon' : `Centre of mass of the ${body.name} system`;
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
