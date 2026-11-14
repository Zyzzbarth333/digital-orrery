// src/app/journey-panel.tsx
//
// The journey planner, at the top of the PLANNER tab: a start (the pad, an
// orbit or the selected craft) and waypoints in order, each a flyby, an
// orbit (with a stay) or a landing at a planet, the Moon or a small body.
// Each leg's transfer is solved at once by patched conics as anything
// changes; the kernel flies the whole journey once an edit is let go. Each
// leg's options are compared on request (Hohmann, bi-elliptic, plane
// change, Lambert, the porkchop optimum, phasing, the gravity assist), and
// one can be chosen. Then the totals, the kernel's check, "Fly this
// journey", and the stack of stages it needs (docs/physics/journey.md).

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SimClock } from './clock';
import type { Mission } from './mission';
import { useJourney, type JourneyStore, type Waypoint, type Leg, type Flyby } from './journey';
import { SourceTag } from './source-tag';
import { journeyBodies, legOptions, applyOption, bodyInfo, defaultArrival } from '../physics/journey.js';
import { sizeLauncher, launchBudget, STAGE_TECH } from '../physics/staging.js';
import { eqjToEcl } from '../physics/ephemeris.js';

const DAY_MS = 86400e3;
const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nameOf = (k: string) => { try { return bodyInfo(k).name as string; } catch { return k; } };
const KINDS: [Waypoint['kind'], string][] = [['flyby', 'Flyby'], ['orbit', 'Orbit'], ['land', 'Land']];

interface Option { type: string; name: string; dv: number; tofDays?: number; depMs?: number; arrMs?: number; selectable?: boolean; unreachable?: boolean; beatsHohmann?: boolean; note?: string; windowNote?: string | null; ideal?: boolean; ok?: boolean; flyable?: boolean; gain?: number; delta?: number; rp?: number; bT?: number; bR?: number; tooTight?: boolean; vinf?: number }

export function JourneyPanel({ store, clock, mission, onFlown, inTable = false }: { store: JourneyStore; clock: SimClock; mission: Mission; onFlown: (id: number) => void; inTable?: boolean }) {
  useJourney(store);
  const j = store.journey, sol = store.solution;
  useEffect(() => { void store.loadSmallBodies(import.meta.env.BASE_URL); }, [store]);
  const bodies = journeyBodies() as { key: string; name: string; group: string }[];

  // The kernel flies the journey once an edit settles (a slider let go, a
  // field changed): 600 ms after the last change, never mid-drag.
  const dragging = useRef(false);
  useEffect(() => {
    if (dragging.current || !j.waypoints.length || !sol.ok) return;
    if (store.kernel.state === 'flying' || (store.kernel.state === 'done' && store.kernel.forVersion === store.version)) return;
    const t = setTimeout(() => store.check(), 600);
    return () => clearTimeout(t);
  }, [store.version]);
  const letGo = () => { dragging.current = false; store.check(); };

  const [open, setOpen] = useState<number | null>(null);
  const [carry, setCarry] = useState(true);
  const [addBody, setAddBody] = useState('mars');
  const [addKind, setAddKind] = useState<Waypoint['kind']>('orbit');

  // Slide a waypoint's arrival; with carry, the ones after keep their spacing.
  const slide = (i: number, ms: number) => {
    const d = ms - j.waypoints[i].dateMs;
    store.set({ ...j, waypoints: j.waypoints.map((w, k) => (k === i ? { ...w, dateMs: ms, via: w.via === 'bielliptic' ? 'bielliptic' : 'lambert', chosen: undefined } : k > i && carry ? { ...w, dateMs: w.dateMs + d } : w)) });
  };

  const startKind = j.start.kind;
  const selected = mission.selected;
  const useCraft = () => {
    if (!selected) return;
    const s = selected.displayState(), P = selected.kState.primary;
    const date = Math.round(clock.snapshot.timeMs);
    if (P && P !== 'sun') {
      const B = bodyInfo(P), rel = mission.relative(selected);
      store.editStart({ kind: 'orbit', body: P, altKm: Math.max(0, Math.round(rel.r - B.radius)), dateMs: date, craftId: selected.id });
    } else store.editStart({ kind: 'craft', body: 'earth', dateMs: date, state: { r: eqjToEcl(s.r) as number[], v: eqjToEcl(s.v) as number[] }, craftId: selected.id });
  };

  const k = store.kernel, kernelNow = k.forVersion === store.version;
  const fly = () => {
    const r = k.state === 'done' && kernelNow ? k.reply : null;
    if (!r || !r.start) return;
    clock.setTime(r.start.ms);
    const c = mission.flyJourney(r.start, r.burns, store.title());
    onFlown(c.id);
  };

  return (
    <div className="journey">
      <h3 className="strip">Journey</h3>
      {!inTable && (
        <div className="keys-row">
          <button className="key primary" onClick={() => store.setPlotOpen(true)}>Open the plotting table</button>
          <span className="hint">Full screen: the journey from above, its windows, burn nodes and lamps</span>
        </div>
      )}
      <div className="form-grid">
        <label className="num"><span className="engraved">Start</span>
          <select className="input select" value={startKind === 'craft' || j.start.craftId ? 'craft' : startKind} onChange={(e) => {
            const v = e.target.value;
            if (v === 'craft') useCraft();
            else store.editStart({ kind: v as 'pad' | 'orbit', body: 'earth', state: undefined, craftId: undefined, altKm: j.start.altKm || 200 });
          }}>
            <option value="pad">Pad, Earth</option>
            <option value="orbit">Earth orbit</option>
            <option value="craft" disabled={!selected}>{selected ? `Craft: ${selected.name}` : 'Craft (none selected)'}</option>
          </select>
        </label>
        <label className="num"><span className="engraved">Leave on</span>
          <DateField ms={j.start.dateMs} onChange={(ms) => store.editStart({ dateMs: ms })} />
        </label>
        {startKind !== 'craft' && (
          <label className="num"><span className="engraved">{startKind === 'pad' ? 'Parking orbit' : 'Orbit'}</span>
            <input className="input" type="number" min={0} step={50} value={j.start.altKm} onChange={(e) => store.editStart({ altKm: Math.max(0, Number(e.target.value)) })} /><span className="unit">km</span>
          </label>
        )}
        {startKind === 'pad' && (
          <label className="num"><span className="engraved">Pad latitude</span>
            <input className="input" type="number" min={-90} max={90} step={0.5} value={j.start.latDeg ?? 28.5} onChange={(e) => store.editStart({ latDeg: Number(e.target.value) })} /><span className="unit">°</span>
          </label>
        )}
      </div>

      {j.waypoints.length > 0 && (
        <div className="keys-row wrap" role="radiogroup" aria-label="When a date slides">
          <span className="engraved">Later dates</span>
          <button className="key small" role="radio" aria-checked={carry} onClick={() => setCarry(true)}>Move with it</button>
          <button className="key small" role="radio" aria-checked={!carry} onClick={() => setCarry(false)}>Stay put</button>
        </div>
      )}

      <ol className="waypoints">
        {j.waypoints.map((w, i) => {
          const leg = sol.legs[i] as Leg | undefined, fb = sol.flybys[i] as Flyby | undefined, P = sol.stops[i];
          const est = (() => { try { return defaultArrival(P as never, w.body, w.altKm, w.kind) - P.depMs; } catch { return 200 * DAY_MS; } })();
          const minMs = P.depMs + DAY_MS * (leg?.geometry === 'local' ? 0 : 0.5), maxMs = P.depMs + Math.max(30 * DAY_MS, 2.5 * est);
          return (
            <li key={w.id} className={`waypoint${leg && !leg.ok ? ' bad' : ''}`}>
              <div className="wp-head">
                <span className="wp-n" aria-hidden="true">{i + 1}</span>
                <select className="input select" aria-label={`Waypoint ${i + 1}: body`} value={w.body} onChange={(e) => store.edit(i, { body: e.target.value })}>
                  {['Planets', 'Moons', 'Small bodies'].map((g) => (
                    <optgroup key={g} label={g}>{bodies.filter((b) => b.group === g).map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}</optgroup>
                  ))}
                </select>
                <select className="input select" aria-label={`Waypoint ${i + 1}: what happens there`} value={w.kind} onChange={(e) => store.edit(i, { kind: e.target.value as Waypoint['kind'] })}>
                  {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <span className="wp-keys">
                  <button className="key small" onClick={() => store.add(addBody, addKind, i)} title={`Insert a waypoint (${nameOf(addBody)}, ${addKind}) before this one`} aria-label={`Insert before waypoint ${i + 1}`}>+</button>
                  <button className="key small" onClick={() => store.move(i, -1)} disabled={i === 0} aria-label={`Move waypoint ${i + 1} earlier`}>↑</button>
                  <button className="key small" onClick={() => store.move(i, 1)} disabled={i === j.waypoints.length - 1} aria-label={`Move waypoint ${i + 1} later`}>↓</button>
                  <button className="key small" onClick={() => { store.remove(i); if (open === i) setOpen(null); }} aria-label={`Remove waypoint ${i + 1}`}>✕</button>
                </span>
              </div>
              <div className="form-grid">
                <label className="num"><span className="engraved">{w.kind === 'flyby' ? 'Lowest pass' : w.kind === 'land' ? 'Orbit before' : 'Orbit'}</span>
                  <input className="input" type="number" min={0} step={50} value={w.altKm} onChange={(e) => store.edit(i, { altKm: Math.max(0, Number(e.target.value)) })} /><span className="unit">km</span>
                </label>
                {w.kind !== 'flyby' && i < j.waypoints.length - 1 && (
                  <label className="num"><span className="engraved">Stay</span>
                    <input className="input" type="number" min={0} step={1} value={w.stayDays ?? 0} onChange={(e) => store.edit(i, { stayDays: Math.max(0, Number(e.target.value)) })} /><span className="unit">d</span>
                  </label>
                )}
              </div>
              {leg?.geometry !== 'local' && (
                <label className="slide">
                  <span className="engraved">Arrive</span>
                  <input type="range" min={Math.round(minMs / DAY_MS)} max={Math.round(maxMs / DAY_MS)} step={1} value={Math.round(w.dateMs / DAY_MS)}
                    aria-valuetext={iso(w.dateMs)}
                    onPointerDown={() => { dragging.current = true; }} onPointerUp={letGo} onKeyUp={letGo} onBlur={() => { if (dragging.current) letGo(); }}
                    onChange={(e) => slide(i, Number(e.target.value) * DAY_MS)} />
                  <DateField ms={w.dateMs} onChange={(ms) => slide(i, ms)} />
                </label>
              )}
              <LegLine leg={leg} fb={fb} last={i === j.waypoints.length - 1} />
              <div className="keys-row">
                <button className="key small" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} disabled={!leg}>{open === i ? 'Hide options' : 'Compare options'}</button>
                {w.chosen && <span className="hint">chosen: {w.chosen}</span>}
              </div>
              {(w.nodes?.length || w.aim) ? (
                <div className="keys-row wrap">
                  {w.nodes?.length ? <>
                    <button className="key small" onClick={() => { store.handlers.select(`node:${i}:${w.nodes![w.nodes!.length - 1].id}`); store.aimSelected(); }} title="Set the last node's burn so this leg reaches its waypoint on its date">Aim last node</button>
                    <button className="key small" onClick={() => { store.edit(i, { nodes: [] }); store.handlers.select(null); }}>Clear nodes</button>
                  </> : null}
                  {w.aim && <button className="key small" onClick={() => store.handlers.remove(`aim:${i}`)} title="Let the planner aim this flyby, so the next leg is Lambert's arc again">Planner aims the flyby</button>}
                </div>
              ) : null}
              {open === i && <LegOptions store={store} k={i} />}
            </li>
          );
        })}
      </ol>

      <div className="keys-row wrap add-row">
        <select className="input select" aria-label="Body to add" value={addBody} onChange={(e) => setAddBody(e.target.value)}>
          {['Planets', 'Moons', 'Small bodies'].map((g) => (
            <optgroup key={g} label={g}>{bodies.filter((b) => b.group === g).map((b) => <option key={b.key} value={b.key}>{b.name}</option>)}</optgroup>
          ))}
        </select>
        <select className="input select" aria-label="What happens there" value={addKind} onChange={(e) => setAddKind(e.target.value as Waypoint['kind'])}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="key" onClick={() => store.add(addBody, addKind)}>Add waypoint</button>
      </div>

      {j.waypoints.length > 0 && <Summary store={store} />}
      {j.waypoints.length > 0 && (
        <div className="keys-row">
          <button className="key primary" onClick={fly} disabled={!(k.state === 'done' && kernelNow && k.reply?.start)}>Fly this journey</button>
          <span className="hint">{k.state === 'flying' ? 'The kernel is flying it…' : k.state === 'done' && kernelNow ? `Jumps the clock to ${iso(sol.startMs)} (BACK undoes it) and flies the kernel's burns` : sol.ok ? 'Waiting for the kernel' : 'Needs every leg solved'}</span>
        </div>
      )}
      {j.waypoints.length > 0 && <RocketFor store={store} />}
    </div>
  );
}

function DateField({ ms, onChange }: { ms: number; onChange: (ms: number) => void }) {
  const [text, setText] = useState(iso(ms));
  useEffect(() => setText(iso(ms)), [ms]);
  const t = Date.parse(`${text}T00:00:00Z`), ok = Number.isFinite(t) && t >= Date.UTC(1900, 0, 1) && t <= Date.UTC(2150, 0, 1);
  return <input className="input" type="text" inputMode="numeric" placeholder="YYYY-MM-DD" pattern="\d{4}-\d{2}-\d{2}" aria-invalid={!ok} value={text}
    onChange={(e) => { setText(e.target.value); const v = Date.parse(`${e.target.value}T00:00:00Z`); if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && Number.isFinite(v)) onChange(v + (ms % DAY_MS)); }} />;
}

// The leg into a waypoint, in a line: when, how long, the burns.
function LegLine({ leg, fb, last }: { leg?: Leg; fb?: Flyby; last: boolean }) {
  if (!leg) return null;
  if (!leg.ok) return <p className="status bad">No transfer: {leg.error ?? 'no solution for these dates'}. Slide the date or change the stop.</p>;
  return (
    <table className="readout compact"><tbody>
      <tr><th scope="row">Leg</th><td className="value">{iso(leg.depMs)} → {iso(leg.arrMs)} · {fmt(leg.tofDays, leg.tofDays < 10 ? 2 : 0)} d<span className="alt">{leg.geometry === 'local' ? `orbit change about ${nameOf(leg.central)}` : `about ${nameOf(leg.central)}${leg.revs ? `, ${leg.revs} revolution${leg.revs > 1 ? 's' : ''}` : ''}`}</span></td><td className="src"><SourceTag src="Lambert" derived info="journey-leg" /></td></tr>
      <tr><th scope="row">Δv</th><td className="value">{fmt(leg.depDv + leg.midDv + leg.arrDv, 3)} km/s<span className="alt">{[leg.depDv && `leave ${fmt(leg.depDv, 3)}`, leg.midDv && `on the way ${fmt(leg.midDv, 3)}`, leg.arrDv && `arrive ${fmt(leg.arrDv, 3)}`].filter(Boolean).join(' · ') || 'no burn'}{leg.vinfArr ? ` · v∞ ${fmt(Math.hypot(...leg.vinfArr), 2)} km/s on arrival` : ''}</span></td><td className="src"><SourceTag src="2-body" derived info="journey-leg" /></td></tr>
      {leg.shaped && (
        <tr><th scope="row">Shaped</th><td className={`value${leg.reaches ? '' : ' bad'}`}>{leg.reaches ? 'reaches' : 'misses'} {nameOf(leg.to)} by {fmt(leg.missKm ?? 0, 0)} km<span className="alt">{(leg.nodes ?? []).length} node{(leg.nodes ?? []).length === 1 ? '' : 's'}, {fmt((leg.nodes ?? []).reduce((a, n) => a + n.dv, 0) * 1000, 1)} m/s · flown free from {leg.nodes?.length ? 'the departure through each node' : 'the flyby aimed by hand'}{leg.reaches ? '' : ' · drag a node\'s tabs, or aim the last node'}</span></td><td className="src"><SourceTag src="2-body" derived info="journey-shaped" /></td></tr>
      )}
      {fb && (
        <tr><th scope="row">Flyby</th><td className="value">{fb.unpoweredOnly ? 'unpowered' : `${fmt(fb.dv * 1000, 0)} m/s`} · turn {fmt(fb.delta * 180 / Math.PI, 1)}°<span className="alt">{fb.byHand ? 'aimed by hand · ' : ''}periapsis {fmt(fb.rp - bodyInfo(fb.body).radius, 0)} km up{fb.byHand && fb.rp < bodyInfo(fb.body).radius ? ' (below the surface!)' : ''} · B·T {fmt(fb.bT, 0)}, B·R {fmt(fb.bR, 0)} km{fb.tooTight ? ' · the turn needs a lower pass: steered at the edge of its sphere' : ''}{last ? '' : ''}</span></td><td className="src"><SourceTag src="B-plane" derived info="flyby" /></td></tr>
      )}
    </tbody></table>
  );
}

// The options for leg k, worked out when asked for (a porkchop search
// takes a moment), and chosen by "Use".
function LegOptions({ store, k }: { store: JourneyStore; k: number }) {
  const [res, setRes] = useState<{ v: number; options: Option[] } | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    const t = setTimeout(() => {
      try { const o = legOptions(store.journey, k) as { options: Option[] }; if (live) setRes({ v: store.version, options: o.options }); } catch { if (live) setRes({ v: store.version, options: [] }); }
    }, 30);
    return () => { live = false; clearTimeout(t); };
  }, [store.version, k]);
  if (!res) return <p className="status">Comparing transfers…</p>;
  const best = Math.min(...res.options.filter((o) => o.selectable !== false && !o.unreachable).map((o) => o.dv));
  return (
    <table className="readout options"><thead><tr><th scope="col">Transfer</th><th scope="col" className="value">Δv</th><th scope="col" className="value">Flight</th><th scope="col"><span className="sr-only">Choose</span></th></tr></thead>
      <tbody>
        {res.options.map((o) => (
          <tr key={o.type} className={o.dv === best ? 'best' : ''}>
            <th scope="row">{o.name}
              <span className="alt">
                {o.type === 'assist'
                  ? `turns v∞ ${fmt(o.vinf ?? 0, 2)} km/s by ${fmt((o.delta ?? 0) * 180 / Math.PI, 1)}°: ${fmt(o.gain ?? 0, 2)} km/s of heliocentric change for ${fmt(o.dv * 1000, 0)} m/s of burn`
                  : [o.depMs && `leaves ${iso(o.depMs)}`, o.windowNote, o.ideal && 'circular coplanar orbits', o.beatsHohmann === true && 'beats Hohmann', o.beatsHohmann === false && 'costs more than Hohmann', o.unreachable && 'its window is not this date: the flyby fixes the departure', o.note].filter(Boolean).join(' · ')}
              </span>
            </th>
            <td className="value">{fmt(o.dv, 3)}</td>
            <td className="value">{o.tofDays !== undefined ? `${fmt(o.tofDays, o.tofDays < 10 ? 2 : 0)} d` : '–'}</td>
            <td>{o.selectable === false ? null : <button className="key small" disabled={o.unreachable || o.ok === false || (o.type === 'bielliptic' && o.flyable === false)} onClick={() => store.set(applyOption(store.journey, k, o as never))}>Use</button>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Totals, the burns in order, and the kernel's check.
function Summary({ store }: { store: JourneyStore }) {
  const sol = store.solution, k = store.kernel, now = k.forVersion === store.version;
  const r = k.state === 'done' && now ? k.reply : null;
  return (
    <>
      <h3 className="strip">{store.title()}</h3>
      <table className="readout"><tbody>
        <tr><th scope="row">Δv total</th><td className="value">{sol.ok ? `${fmt(sol.totalDv, 3)} km/s` : '–'}<span className="alt">{sol.burns.length} burns, from the parking orbit on</span></td><td className="src"><SourceTag src="Σ burns" derived info="journey-total" /></td></tr>
        <tr><th scope="row">Duration</th><td className="value">{fmt(sol.durationDays, 0)} d<span className="alt">{store.dates()}</span></td><td className="src"><SourceTag src="dates" derived info="journey-total" /></td></tr>
        {sol.burns.map((b, i) => (
          <tr key={i} className="burn-row"><th scope="row">{iso(b.ms)}</th><td className="value">{fmt(b.dv * 1000, 0)} m/s<span className="alt">{b.label}</span></td><td /></tr>
        ))}
        <tr><th scope="row">Kernel</th>
          <td className="value">{k.state === 'flying' || (k.state !== 'idle' && !now) ? 'flying it…' : k.state === 'failed' ? <span className="bad">failed: {k.error}</span> : r ? `flown in ${fmt(r.ms / 1000, 1)} s · corrections ${fmt(r.correctionsDv * 1000, 1)} m/s` : 'waits for an edit to settle'}
            {r && <span className="alt">{r.arrivals.map((a) => `${nameOf(a.body)} ${a.central ? `${fmt(a.missKm, 0)} km from the aim point` : `${fmt(a.missKm, 0)} km off the planned periapsis`}`).join(' · ')}{r.impact ? ` · hits ${nameOf(r.impact.body)}` : ''}</span>}
            {r && r.unsupported.length > 0 && <span className="alt">{r.unsupported.join(' · ')}</span>}
          </td>
          <td className="src"><SourceTag src="n-body" info="kernel-check" /></td></tr>
      </tbody></table>
    </>
  );
}

// The stack the journey needs, from the pad (or its orbit) to the end.
function RocketFor({ store }: { store: JourneyStore }) {
  const j = store.journey, sol = store.solution;
  const [payload, setPayload] = useState(1000);
  const [booster, setBooster] = useState<keyof typeof STAGE_TECH>('storable');
  const [upper, setUpper] = useState<keyof typeof STAGE_TECH>('hydrolox');
  const [isp1, setIsp1] = useState<number | null>(null), [isp2, setIsp2] = useState<number | null>(null);
  const [eps1, setEps1] = useState(0.1), [eps2, setEps2] = useState(0.1);
  const [show, setShow] = useState<number | null>(null);
  const climb = j.start.kind === 'pad';
  const budget = launchBudget({ journeyDv: sol.totalDv * 1000, h: j.start.altKm * 1000, lat: j.start.latDeg ?? 28.5, az: 90 });
  const dv = climb ? budget.total : sol.totalDv * 1000;
  const B = { isp: isp1 ?? STAGE_TECH[booster].isp, eps: eps1 }, U = { isp: isp2 ?? STAGE_TECH[upper].isp, eps: eps2 };
  const sized = useMemo(() => sizeLauncher({ dv, payload, booster: B, upper: U, maxStages: 4 }) as { options: { n: number; feasible: boolean; reason?: string; liftoff?: number; payloadFraction?: number; stages?: { isp: number; eps: number; prop: number; dry: number; step: number; dv: number }[] }[]; pick: { n: number } | null }, [dv, payload, B.isp, B.eps, U.isp, U.eps]);
  if (!sol.ok) return null;
  const pickN = show ?? sized.pick?.n ?? null, o = sized.options.find((x) => x.n === pickN && x.feasible);
  const top = o?.stages ? Math.max(...o.stages.map((s) => s.step)) : 1;
  return (
    <>
      <h3 className="strip">The rocket it needs</h3>
      <table className="readout"><tbody>
        <tr><th scope="row">Δv to give</th><td className="value">{fmt(dv / 1000, 2)} km/s<span className="alt">{climb ? `to orbit ${fmt(budget.toOrbit / 1000, 2)} (losses 1.5) + journey ${fmt(sol.totalDv, 2)}` : 'from the orbit: no climb'}</span></td><td className="src"><SourceTag src="budget" derived info="to-orbit" /></td></tr>
      </tbody></table>
      <div className="form-grid">
        <label className="num"><span className="engraved">Payload</span><input className="input" type="number" min={1} step={100} value={payload} onChange={(e) => setPayload(Math.max(1, Number(e.target.value)))} /><span className="unit">kg</span></label>
        <span />
        <label className="num"><span className="engraved">Stage 1</span>
          <select className="input select" value={booster} onChange={(e) => { setBooster(e.target.value as keyof typeof STAGE_TECH); setIsp1(null); }}>{Object.entries(STAGE_TECH).map(([key, t]) => <option key={key} value={key}>{t.name}</option>)}</select>
        </label>
        <label className="num"><span className="engraved">Upper stages</span>
          <select className="input select" value={upper} onChange={(e) => { setUpper(e.target.value as keyof typeof STAGE_TECH); setIsp2(null); }}>{Object.entries(STAGE_TECH).map(([key, t]) => <option key={key} value={key}>{t.name}</option>)}</select>
        </label>
        <label className="num"><span className="engraved">Isp, ε</span><input className="input" type="number" min={100} max={1000} step={5} value={B.isp} onChange={(e) => setIsp1(Number(e.target.value))} /><input className="input" type="number" min={0.02} max={0.5} step={0.01} value={eps1} onChange={(e) => setEps1(Number(e.target.value))} /></label>
        <label className="num"><span className="engraved">Isp, ε</span><input className="input" type="number" min={100} max={1000} step={5} value={U.isp} onChange={(e) => setIsp2(Number(e.target.value))} /><input className="input" type="number" min={0.02} max={0.5} step={0.01} value={eps2} onChange={(e) => setEps2(Number(e.target.value))} /></label>
      </div>
      <p className="hint">Isp from Curtis Table 6.1, structural ratio 0.1 (Curtis §13.4); typical values, not any one vehicle's.</p>
      <div className="keys-row wrap" role="radiogroup" aria-label="Number of stages">
        {sized.options.map((x) => <button key={x.n} className="key small" role="radio" aria-checked={x.n === pickN} disabled={!x.feasible} onClick={() => setShow(x.n)} title={x.feasible ? `${x.n} stages: ${fmt((x.liftoff ?? 0) / 1000, 1)} t at liftoff` : x.reason === 'empty-stage' ? `${x.n} stages: the lightest would leave a stage empty, so fewer do it better` : `${x.n} stage${x.n > 1 ? 's' : ''} cannot give ${fmt(dv / 1000, 1)} km/s`}>{x.n} {x.feasible ? `· ${fmt((x.liftoff ?? 0) / 1000, 0)} t` : x.reason === 'empty-stage' ? '· no gain' : '· cannot'}</button>)}
      </div>
      {!o && <p className="status bad">No stack of up to four of these stages can give {fmt(dv / 1000, 1)} km/s. Try a higher Isp or a lighter structure.</p>}
      {o && o.stages && (
        <div className="stage-stack">
          <figure className="stack" aria-label={`A ${o.n}-stage stack, payload on top`}>
            <div className="stack-payload"><span>Payload {fmt(payload, 0)} kg</span></div>
            {[...o.stages].map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
              <div key={i} className="stack-stage" style={{ height: `${Math.round(28 + 120 * Math.sqrt(s.step / top))}px` }}>
                <i style={{ height: `${(100 * s.dry) / s.step}%` }} aria-hidden="true" />
                <span>S{i + 1}</span>
              </div>
            ))}
            <figcaption>heights by the square root of each stage's mass; the dark band its dry mass</figcaption>
          </figure>
          <table className="readout compact"><tbody>
            <tr><th scope="row">Liftoff</th><td className="value">{fmt((o.liftoff ?? 0) / 1000, 1)} t<span className="alt">payload fraction {fmt((o.payloadFraction ?? 0) * 100, 2)} %</span></td><td className="src"><SourceTag src="Lagrange" derived info="journey-stack" /></td></tr>
            {o.stages.map((s, i) => (
              <tr key={i}><th scope="row">Stage {i + 1}</th><td className="value">{fmt(s.prop / 1000, 1)} t propellant<span className="alt">{fmt(s.dry / 1000, 2)} t dry · Isp {s.isp} s · Δv {fmt(s.dv / 1000, 2)} km/s</span></td><td /></tr>
            ))}
          </tbody></table>
        </div>
      )}
    </>
  );
}
