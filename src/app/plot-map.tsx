// src/app/plot-map.tsx
//
// The plotting table's MAP station: the solar system as a metro map of
// delta-v (dvMap.js, docs/physics/journey.md#the-delta-v-map). Each station
// is a state a craft can be in (on the ground, in low orbit, just out of
// the Earth's well, on the transfer to a body), each line the delta-v
// between two, in km/s. The Earth's trunk runs down the left: ground, low
// Earth orbit (the Moon's line leaves here), escape, from which each
// planet's line leaves. Two modes:
// - Reference: ideal circular coplanar Hohmann transfers from a 300 km
//   orbit, from the planner's own body data;
// - For your dates: the lines the current journey flies, priced from the
//   planner's solution for its dates; the rest dim, the burns no line
//   holds listed.
// A line or a station is picked with a click (or Enter); the readout beside
// says what it costs and why, and its key sets the station as the next
// stop in PLOT. Its look is the console's (DESIGN.md): a recessed window,
// each body's line in its own swatch colour, the numbers in phosphor.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useJourney, type JourneyStore } from './journey';
import { SourceTag } from './source-tag';
import { referenceMap, journeyMap, fromLeo, MAP_ROUTES } from '@digital-orrery/physics/dvMap.js';
import { bodyInfo } from '@digital-orrery/physics/journey.js';

const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const km = (n: number) => `${Math.round(n).toLocaleString('en-AU')} km`;

interface Station { id: string; body: string; kind: 'surface' | 'orbit' | 'escape' | 'transfer'; name: string; altKm?: number; vinfDep?: number; vinfArr?: number; tofDays?: number }
interface Line { id: string; from: string; to: string; body: string; kind: 'surface' | 'escape' | 'transfer' | 'capture'; dv: number; fromLeo?: number; aerobraking: boolean }
interface Part { dv: number; ms: number; label: string; leg: number; entry?: boolean }
interface OnJourney { lines: Record<string, { dv: number; parts: Part[] }>; stations: string[]; offMap: Part[]; total: number }

// Each body's line in its swatch colour (src/scene/catalogue.ts); the
// Earth's trunk in the panel's pale label colour, its own blue being too
// dark on the window to read.
const LINE_COLOUR: Record<string, string> = {
  earth: '#b9ad92', moon: '#9c9a95', mercury: '#8f8a85', venus: '#e6d6ae', mars: '#b4623a',
  jupiter: '#c9b48f', saturn: '#d8c690', uranus: '#a9d8de', neptune: '#6f8fe0',
};
// The stop a station makes in PLOT.
const STOP_KIND: Record<string, 'flyby' | 'orbit' | 'land'> = { transfer: 'flyby', orbit: 'orbit', surface: 'land' };

export function MapStation({ store, onPlot }: { store: JourneyStore; onPlot: () => void }) {
  useJourney(store);
  const ref = useMemo(() => referenceMap() as { leoAltKm: number; stations: Station[]; lines: Line[] }, []);
  const sol = store.solution, j = store.journey;
  const hasJourney = j.waypoints.length > 0 && sol.ok;
  const [mode, setMode] = useState<'reference' | 'dates'>('reference');
  const dates = mode === 'dates' && hasJourney;
  const on = useMemo(() => (hasJourney ? journeyMap(j, sol as never) as OnJourney : null), [store.version, hasJourney]);
  const [sel, setSel] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // The window's width inside its padding.
    const o = new ResizeObserver(() => { const cs = getComputedStyle(el); setW(Math.max(300, Math.min(980, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)))); });
    o.observe(el);
    return () => o.disconnect();
  }, []);

  const station = (id: string) => ref.stations.find((s) => s.id === id)!;
  const lineDv = (l: Line) => (dates ? on!.lines[l.id]?.dv ?? null : l.dv);
  const priced = (l: Line) => !dates || !!on!.lines[l.id];

  // ---------------- layout ----------------
  // The trunk at x0 (its delta-v to its left); each route a row to its
  // right, its stations evenly spaced, the last one's label kept inside.
  const narrow = W < 560;
  const x0 = narrow ? 48 : 60, R = narrow ? 70 : 66, BEND = 12, top = 22;
  const seg = (W - x0 - (narrow ? 44 : 64)) / 3;
  const xs = [x0, x0 + seg, x0 + 2 * seg, x0 + 3 * seg];
  const yOf: Record<string, number> = { 'earth:surface': top, 'earth:leo': top + R, 'earth:escape': top + 2 * R };
  const rowY: Record<string, number> = { moon: top + R };
  MAP_ROUTES.filter((k) => k !== 'moon').forEach((k, i) => { rowY[k] = top + (3 + i) * R; });
  const H = top + (3 + MAP_ROUTES.length - 1) * R - R + 52;
  const pos = (id: string): [number, number] => {
    if (yOf[id] !== undefined) return [x0, yOf[id]];
    const [body, kind] = id.split(':');
    return [xs[{ transfer: 1, orbit: 2, surface: 3 }[kind] ?? 1], rowY[body]];
  };
  const lastPlanetY = Math.max(...MAP_ROUTES.filter((k) => k !== 'moon').map((k) => rowY[k]));

  // ---------------- what a line or station says ----------------
  const words = (l: Line) => {
    const A = station(l.from), B = station(l.to), body = bodyInfo(l.body);
    const out: string[] = [];
    if (l.kind === 'surface') out.push(l.body === 'earth' ? `Up from the ground: the circular speed of a ${km(ref.leoAltKm)} orbit, ideal (no gravity, drag or steering losses).` : `Down from the low orbit: its circular speed, which the engine takes off for an ideal powered descent; lifting off costs it again.`);
    if (l.kind === 'escape') out.push(`The share of a departure from a ${km(ref.leoAltKm)} orbit that climbs out of the Earth's well: escape speed less circular speed. Every planet's line leaves from here.`);
    if (l.kind === 'transfer' && l.body === 'moon') out.push(`The Hohmann transfer about the Earth from a ${km(ref.leoAltKm)} orbit out to the Moon's mean distance, ${fmt(B.tofDays ?? 0, 1)} d.`);
    else if (l.kind === 'transfer') out.push(`The rest of the departure burn from low Earth orbit onto the Hohmann transfer to ${body.name} (v∞ ${fmt(B.vinfDep ?? 0)} km/s, ${fmt(B.tofDays ?? 0, 0)} d): ${fmt(l.fromLeo ?? 0)} km/s from low orbit in one burn, of which escape is the first ${fmt(fromLeo(ref as never, 'earth:escape') ?? 0)}. Burnt from escape itself it would cost the whole v∞; burnt deep in the well, the Oberth effect makes it this.`);
    if (l.kind === 'capture') out.push(`Arriving at ${body.name} with v∞ ${fmt(A.vinfArr ?? 0)} km/s, a burn at periapsis into a circular orbit ${km(B.altKm ?? 0)} up (10 % of its radius).`);
    if (l.aerobraking) out.push(`Aerobraking not counted: ${body.name}'s air can take most of it on the way down, at no propulsive cost (the planner counts a landing through air as free).`);
    return out;
  };
  const lineName = (l: Line) => `${station(l.from).name} › ${station(l.to).name}`;
  const selLine = sel ? ref.lines.find((l) => l.id === sel) : null;
  const selStation = selLine ? station(selLine.to) : sel ? ref.stations.find((s) => s.id === sel) ?? null : null;
  const stopFor = (s: Station | null) => (s && s.body !== 'earth' && STOP_KIND[s.kind] ? { body: s.body, kind: STOP_KIND[s.kind] } : null);
  const stop = stopFor(selStation);
  const stopWords = (s: { body: string; kind: string }) => `${bodyInfo(s.body).name} ${{ flyby: 'flyby', orbit: 'orbit', land: 'landing' }[s.kind]}`;
  const plot = () => { if (!stop) return; store.add(stop.body, stop.kind); store.check(); onPlot(); };
  const pick = (id: string) => setSel(sel === id ? null : id);
  const keyPick = (id: string) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); } };

  // ---------------- drawing ----------------
  const pathOf = (l: Line) => {
    const [ax, ay] = pos(l.from), [bx, by] = pos(l.to);
    // A planet's line leaves the trunk below escape with a bend.
    if (l.from === 'earth:escape') return `M${x0} ${by - BEND} Q${x0} ${by} ${x0 + BEND} ${by} L${bx} ${by}`;
    return `M${ax} ${ay} L${bx} ${by}`;
  };
  const labelAt = (l: Line): [number, number, 'start' | 'middle' | 'end'] => {
    const [ax, ay] = pos(l.from), [bx, by] = pos(l.to);
    if (ax === bx) return [x0 - 10, (ay + by) / 2 + 4, 'end'];                       // on the trunk: to its left
    const a = l.from === 'earth:escape' ? x0 + BEND : ax;
    return [(a + bx) / 2, by - 9, 'middle'];
  };
  const shown = (l: Line) => { const v = lineDv(l); return v === null ? fmt(l.dv) : fmt(v); };

  return (
    <div className="map-station">
      <div className="map-window" ref={wrap}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="dv-map" role="group" aria-label={`Delta-v map${dates ? ', for your dates' : ', reference'}: each line the delta-v between two states, in km/s`}>
          {/* The trunk below escape, which every planet's line runs down. */}
          <path d={`M${x0} ${yOf['earth:escape']} L${x0} ${lastPlanetY - BEND}`} className="dvm-trunk" />
          {ref.lines.map((l) => {
            const on1 = priced(l), isSel = sel === l.id, [lx, ly, anchor] = labelAt(l);
            const label = `${lineName(l)}: ${shown(l)} km/s${dates && !on1 ? ' (reference; not on this journey)' : ''}${l.aerobraking ? ', aerobraking not counted' : ''}`;
            return (
              <g key={l.id} className={`dvm-line${isSel ? ' sel' : ''}${on1 ? '' : ' off'}`} role="button" tabIndex={0} aria-pressed={isSel} aria-label={label}
                onClick={() => pick(l.id)} onKeyDown={keyPick(l.id)}>
                <title>{label}</title>
                <path d={pathOf(l)} className="dvm-hit" />
                {isSel && <path d={pathOf(l)} className="dvm-halo" />}
                <path d={pathOf(l)} className="dvm-track" style={{ stroke: LINE_COLOUR[l.body] }} />
                <text x={lx} y={ly} textAnchor={anchor} className="dvm-dv">{shown(l)}{l.aerobraking ? '†' : ''}</text>
              </g>
            );
          })}
          {ref.stations.map((s) => {
            const [x, y] = pos(s.id), isSel = sel === s.id, visited = !!on && on.stations.includes(s.id);
            const trunk = s.body === 'earth';
            const title = s.kind === 'transfer' && s.body !== 'moon' ? bodyInfo(s.body).name : s.kind === 'transfer' ? 'Moon' : trunk ? { surface: 'Earth', orbit: 'LEO', escape: 'Escape' }[s.kind as 'surface' | 'orbit' | 'escape'] : { orbit: 'Orbit', surface: 'Surface' }[s.kind as 'orbit' | 'surface'];
            const sub = s.kind === 'orbit' ? km(s.altKm ?? 0) : s.kind === 'transfer' ? 'transfer' : s.kind === 'escape' ? 'C3 = 0' : trunk ? 'surface' : '';
            return (
              <g key={s.id} className={`dvm-stop${isSel ? ' sel' : ''}${visited ? ' visited' : ''}`} role="button" tabIndex={0} aria-pressed={isSel}
                aria-label={`${s.name}${visited ? ', on this journey' : ''}`} onClick={() => pick(s.id)} onKeyDown={keyPick(s.id)}>
                <title>{s.name}</title>
                <circle cx={x} cy={y} r={16} className="dvm-hit" />
                <circle cx={x} cy={y} r={trunk ? 7 : 6} className="dvm-dot" />
                <text x={trunk ? x + 12 : x} y={y + 20} textAnchor={trunk ? 'start' : 'middle'} className="dvm-name">{title.toUpperCase()}</text>
                {sub && <text x={trunk ? x + 12 : x} y={y + 34} textAnchor={trunk ? 'start' : 'middle'} className="dvm-sub">{sub}</text>}
              </g>
            );
          })}
        </svg>
        <p className="dvm-foot">km/s, ideal: circular coplanar orbits, Hohmann transfers from a {km(ref.leoAltKm)} orbit, burns at periapsis, no gravity or steering losses. Capture into a circular orbit 10 % of the radius up; a landing is that orbit's circular speed. † aerobraking not counted (Earth, Venus, Mars). A planet's line from escape is the rest of one burn in low orbit. Amber stations: where the journey stops.{dates ? ' For your dates: the lines this journey flies, from the planner\'s solution; dim lines are the reference.' : ''}</p>
      </div>

      <aside className={`map-side${sel ? ' picked' : ''}`}>
        <h3 className="strip">Delta-v map</h3>
        <div className="keys-row" role="group" aria-label="Map mode">
          <button className="key small mode" aria-pressed={mode === 'reference'} onClick={() => setMode('reference')} title="Ideal Hohmann transfers from a 300 km Earth orbit, from the planner's body data">Reference</button>
          <button className="key small mode" aria-pressed={mode === 'dates'} disabled={!hasJourney} onClick={() => setMode('dates')}
            title={hasJourney ? 'The lines this journey flies, priced from the planner\'s solution for its dates' : 'Plan a journey in PLOT first'}>For your dates</button>
          <SourceTag src="Hohmann" derived info="dv-map" />
        </div>
        {!hasJourney && <p className="hint">For your dates needs a journey that solves: plan one in PLOT, or pick a station here.</p>}
        {dates && on && <p className="hint">{store.title()} · {store.dates()}: {fmt(on.total)} km/s in all{on.offMap.length ? `, ${fmt(on.offMap.reduce((a, p) => a + p.dv, 0))} of it off the map` : ''}.</p>}

        {!sel && <p className="hint">Pick a line or a station for its delta-v and why; its key adds it as the next stop in PLOT.</p>}
        {selLine && (
          <div className="dvm-read">
            <b>{lineName(selLine)}</b>
            <span className="dvm-big">{dates && on!.lines[selLine.id] ? fmt(on!.lines[selLine.id].dv, 3) : fmt(selLine.dv)} km/s{selLine.fromLeo !== undefined && selLine.kind === 'transfer' && selLine.body !== 'moon' && !dates ? <small> · {fmt(selLine.fromLeo)} from LEO</small> : null}</span>
            {dates && (on!.lines[selLine.id]
              ? <ul className="dvm-parts">{on!.lines[selLine.id].parts.map((p, i) => <li key={i}><span>{iso(p.ms)}</span> {p.label}{p.entry ? ': through the air, no burn' : `: ${fmt(p.dv, 3)}`}</li>)}<li className="ref">Reference {fmt(selLine.dv)} km/s</li></ul>
              : <p className="hint">Not on this journey: the reference, {fmt(selLine.dv)} km/s.</p>)}
            {words(selLine).map((w, i) => <p key={i}>{w}</p>)}
          </div>
        )}
        {!selLine && selStation && (
          <div className="dvm-read">
            <b>{selStation.name}</b>
            {fromLeo(ref as never, selStation.id) !== null && selStation.id !== 'earth:leo' && <span className="dvm-big">{fmt(fromLeo(ref as never, selStation.id)!)} km/s <small>from low Earth orbit, reference</small></span>}
            {selStation.id === 'earth:surface' && <p>Where every journey starts. The launch to low orbit is STACK's: its rocket pays the losses this map leaves out.</p>}
          </div>
        )}
        {stop && <div className="keys-row"><button className="key" onClick={plot} title={`Add ${stopWords(stop)} as the journey's next stop and open PLOT`}>Plot {stopWords(stop)}</button></div>}

        {dates && on && on.offMap.length > 0 && <>
          <h3 className="strip">Not on the map</h3>
          <p className="hint">Burns on legs that don't run through the Earth (or to a body off the map), and flybys' burns:</p>
          <ul className="dvm-parts">{on.offMap.map((p, i) => <li key={i}><span>{iso(p.ms)}</span> {p.label}: {fmt(p.dv, 3)}</li>)}</ul>
        </>}
      </aside>
    </div>
  );
}
