// src/app/plot-table.tsx
//
// The plotting table: the journey planner's own full-screen room
// (docs/physics/journey.md#the-plotting-table). The sky pauses behind it;
// the clock and the mission run on. Its PLOT station has:
// - the journey's editor (journey-panel.tsx) on the left;
// - the scope: the journey from above the ecliptic (or above its planet,
//   for a journey that never leaves one), its arcs, burns and bodies on the
//   time cursor's date, and its burn nodes, whose tabs are pulled to add
//   delta-v at a rate that grows with the pull;
// - the lamps: can it be flown, and if not, when (feasibility.js);
// - the delta-v ledger against the ship's budget;
// - the timeline: each leg's cheapest delta-v by departure date against
//   what the budget leaves it (a click there leaves on that date), the
//   plan's legs and stays, and the time cursor.
// Its look is the console's (DESIGN.md): the scope is a recessed readout
// window grown large, amber on window black.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SimClock } from './clock';
import type { Mission } from './mission';
import { useJourney, type JourneyStore, type JourneyMarkView } from './journey';
import { JourneyPanel } from './journey-panel';
import { PorkchopPanel } from './planner-panel';
import { StackStation } from './plot-stack';
import { GoStation } from './plot-go';
import { SourceTag } from './source-tag';
import { stateOf, bodyInfo, applyOption } from '../physics/journey.js';
import { assess } from '../physics/feasibility.js';

type V3 = [number, number, number];
type P2 = [number, number];
const DAY_MS = 86400e3, AU = 149597870.7;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const nameOf = (k: string) => { try { return bodyInfo(k).name as string; } catch { return k; } };
interface Lamp { key: string; level: 'off' | 'go' | 'caution' | 'warn'; text: string; leg?: number }
const LAMP_NAME: Record<string, string> = { window: 'Window', wait: 'Wait', dv: 'Delta-v', nowindow: 'No window', miss: 'Miss', flyby: 'Flyby', kernel: 'Kernel' };

// Delta-v a pulled tab adds each second: its square, so a small pull is
// fine work (up to 240 m/s a second at the stalk's full length).
const PULL_MAX = 90;
const pullRate = (px: number) => 0.24 * Math.min(1, px / PULL_MAX) ** 2;     // km/s per s

export function PlotTable({ store, clock, mission, onFlown }: { store: JourneyStore; clock: SimClock; mission: Mission; onFlown: (id: number) => void }) {
  useJourney(store);
  const sol = store.solution, j = store.journey;
  const profilesFresh = store.profilesFor === store.version;
  const lamps = useMemo(() => {
    const out = (assess(j, sol as never, { budget: store.budget, profiles: profilesFresh ? store.profiles as never : [] }) as Lamp[]);
    const k = store.kernel;
    if (k.state === 'done' && k.forVersion === store.version && k.reply) {
      const worst = Math.max(0, ...k.reply.arrivals.map((a) => a.missKm));
      out.push({ key: 'kernel', level: k.reply.impact && !k.reply.arrivals.every((a) => a.central) ? 'warn' : worst > 50 ? 'caution' : 'go', text: `${fmt(worst, 1)} km worst · corrections ${fmt(k.reply.correctionsDv * 1000, 0)} m/s` });
    } else if (k.state === 'flying' || (k.state !== 'idle' && k.forVersion !== store.version)) out.push({ key: 'kernel', level: 'off', text: 'flying it…' });
    return out;
  }, [store.version, store.kernel, store.budget, profilesFresh, store.profiles]);
  const [cursor, setCursor] = useState(() => sol.startMs);
  const [station, setStation] = useState<'plot' | 'stack' | 'go'>('plot');
  const STATIONS: ['plot' | 'stack' | 'go', string, string][] = [['plot', 'Plot', 'The journey, its windows and burn nodes'], ['stack', 'Stack', 'The rocket it needs, and real launchers beside it'], ['go', 'Go', 'The go/no-go poll, and committing to the orrery']];
  useEffect(() => { if (!(cursor >= sol.startMs && cursor <= sol.endMs)) setCursor(sol.startMs); }, [sol.startMs, sol.endMs]);

  // Escape closes the table (back to the sky).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === 'Escape' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') { e.stopPropagation(); store.setPlotOpen(false); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [store]);
  useEffect(() => { if (j.waypoints.length && sol.ok && store.profilesFor !== store.version && store.kernel.state !== 'flying') { const t = setTimeout(() => store.check(), 400); return () => clearTimeout(t); } }, [store.version]);

  return (
    <div className="plot-table" role="dialog" aria-modal="true" aria-label="Plotting table">
      <header className="plot-head">
        <span className="pnl" aria-hidden="true">P1</span>
        <h2 className="plot-title">Plotting table</h2>
        <div className="plot-stations" role="tablist" aria-label="Stations">
          {STATIONS.map(([k, label, title]) => <button key={k} role="tab" aria-selected={station === k} aria-controls={`station-${k}`} className="key tab" title={title} onClick={() => setStation(k)}>{label}</button>)}
        </div>
        <span className="plot-route">{j.waypoints.length ? `${store.title()} · ${store.dates()}` : 'Add a waypoint to begin'}</span>
        <span className="spacer" />
        <div className="plot-lamps" aria-live="polite">
          {lamps.map((l) => <div key={l.key} className={`plot-lamp ${l.level}`} title={l.text}><span>{LAMP_NAME[l.key] ?? l.key}</span><b>{l.text}</b></div>)}
        </div>
        <button className="key" onClick={() => store.setPlotOpen(false)} title="Back to the sky (Esc)">Close</button>
      </header>
      {station === 'plot' && <>
        <div className="plot-body" id="station-plot" role="tabpanel">
          <aside className="plot-left">
            <JourneyPanel store={store} clock={clock} mission={mission} onFlown={(id) => { store.setPlotOpen(false); onFlown(id); }} inTable />
            <details className="porkchop-details" open={!!store.autoPlan}>
              <summary>One leg from Earth: the porkchop and NASA's list</summary>
              <PorkchopPanel clock={clock} mission={mission} onFlown={(id) => { store.setPlotOpen(false); onFlown(id); }} autoPlan={store.autoPlan} />
            </details>
          </aside>
          <Scope store={store} cursor={cursor} />
          <aside className="plot-right"><Ledger store={store} lamps={lamps} /></aside>
        </div>
        <Timeline store={store} cursor={cursor} setCursor={setCursor} />
      </>}
      {station === 'stack' && <div className="plot-station" id="station-stack" role="tabpanel"><StackStation store={store} /></div>}
      {station === 'go' && <div className="plot-station" id="station-go" role="tabpanel"><GoStation store={store} clock={clock} mission={mission} onFlown={onFlown} /></div>}
    </div>
  );
}

// ---------------- the scope ----------------

function Scope({ store, cursor }: { store: JourneyStore; cursor: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [compressed, setCompressed] = useState(false);
  const view = useRef({ pan: [0, 0] as P2, zoom: 1, fitFor: '', fit: 1 });
  const pull = useRef<{ id: string; axis: 'pro' | 'nor' | 'rad'; sign: number; dir: P2; x0: number; y0: number; off: number } | null>(null);
  const drag = useRef<{ kind: 'pan' | 'node'; id?: string; x0: number; y0: number; moved: number; pan0: P2 } | null>(null);
  const tabs = useRef<{ id: string; axis: 'pro' | 'nor' | 'rad'; sign: number; at: P2; dir: P2; label: string }[]>([]);
  const frame = store.frame();
  const v = store.view();

  // A body's or point's position about the journey's frame (ecliptic km).
  const frameAt = useCallback((central: string, rel: number[], ms: number): V3 => {
    if (central === frame) return [rel[0], rel[1], rel[2]];
    const C = central === 'sun' ? [0, 0, 0] : stateOf(central, ms).r, F = frame === 'sun' ? [0, 0, 0] : stateOf(frame, ms).r;
    return [C[0] + rel[0] - F[0], C[1] + rel[1] - F[1], C[2] + rel[2] - F[2]];
  }, [frame]);
  const bodyAt = useCallback((key: string, ms: number): V3 => frameAt('sun', stateOf(key, ms).r, ms), [frameAt]);

  // Every arc in the frame, with its points' times.
  const arcs = useMemo(() => (v?.arcs ?? []).map((a) => ({ ...a, pts: a.pts.map((p, i) => frameAt(a.central, p, a.t1 + ((a.t2 - a.t1) * i) / Math.max(1, a.pts.length - 1))) })), [v, frameAt]);
  const R0 = frame === 'sun' ? AU : 384400;
  const squash = useCallback((p: number[]): P2 => {
    const r = Math.hypot(p[0], p[1]);
    if (!compressed || r === 0) return [p[0], p[1]];
    const k = (R0 * Math.sqrt(r / R0)) / r;
    return [p[0] * k, p[1] * k];
  }, [compressed, R0]);

  const draw = useCallback(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const st = getComputedStyle(c);
    const col = (n: string) => st.getPropertyValue(n).trim();
    const PH = col('--phosphor'), DIM = col('--phosphor-dim'), KEY = col('--key-lit'), GRID = '#3a3328';
    // Fit the journey once per version (and when the radius mapping changes).
    const vv = view.current;
    const visited = [store.journey.start.body, ...store.journey.waypoints.map((w) => w.body)];
    // Fitted again when the route, the radius mapping or the scope's size changes.
    // Not on every edit: a pull or a drag must not reset your zoom.
    const fitKey = `${[store.journey.start.body, ...store.journey.waypoints.map((w) => w.body)].join('>')}:${compressed}:${Math.round(W)}x${Math.round(H)}`;
    if (vv.fitFor !== fitKey) {
      let m = 1;
      for (const a of arcs) for (const p of a.pts) { const q = squash(p); m = Math.max(m, Math.hypot(q[0], q[1])); }
      vv.fit = (0.45 * Math.min(W, H)) / (m || 1); vv.fitFor = fitKey; vv.pan = [0, 0]; vv.zoom = 1;
    }
    const s = vv.fit * vv.zoom;
    const P = (p: number[]): P2 => { const q = squash(p); return [W / 2 + (q[0] - vv.pan[0]) * s, H / 2 - (q[1] - vv.pan[1]) * s]; };
    // Range rings (AU about the Sun, thousands of km about a planet).
    g.lineWidth = 1; g.strokeStyle = GRID; g.fillStyle = '#6d685c'; g.font = '10px "B612 Mono", monospace';
    const ringStep = frame === 'sun' ? (compressed ? 1 : 0.5) * AU : 100000;
    for (let r = ringStep, n = 0; n < 40; r += ringStep, n++) {
      const q = P([r, 0, 0]), o = P([0, 0, 0]), rad = Math.hypot(q[0] - o[0], q[1] - o[1]);
      if (rad > Math.hypot(W, H)) break;
      g.beginPath(); g.arc(o[0], o[1], rad, 0, 2 * Math.PI); g.stroke();
      g.fillText(frame === 'sun' ? `${fmt(r / AU, 1)} AU` : `${fmt(r / 1000, 0)}k km`, o[0] + rad + 3, o[1] - 3);
    }
    // The central body.
    const o = P([0, 0, 0]);
    g.fillStyle = PH; g.beginPath(); g.arc(o[0], o[1], 4, 0, 2 * Math.PI); g.fill();
    // The visited bodies' orbits, dim, and their places on the cursor's date.
    const seen = new Set<string>();
    for (const key of visited) {
      if (seen.has(key) || key === frame) continue;
      seen.add(key);
      const B = bodyInfo(key);
      const T = 2 * Math.PI * Math.sqrt((B.a ?? AU) ** 3 / bodyInfo(B.parent ?? 'sun').mu) * 1000;
      g.strokeStyle = 'rgba(236,217,176,0.22)'; g.beginPath();
      for (let i = 0; i <= 120; i++) { const p = P(bodyAt(key, cursor + (T * i) / 120)); i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }
      g.stroke();
      const p = P(bodyAt(key, cursor));
      g.fillStyle = DIM; g.beginPath(); g.arc(p[0], p[1], 4, 0, 2 * Math.PI); g.fill();
      g.font = '10px Michroma, sans-serif'; g.fillText(nameOf(key).toUpperCase(), p[0] + 7, p[1] - 7);
    }
    // Arcs: bright, with a little glow.
    for (const a of arcs) {
      const shaped = store.solution.legs[a.leg]?.shaped;
      g.save(); g.strokeStyle = shaped && !store.solution.legs[a.leg]?.reaches ? KEY : PH; g.lineWidth = 2; g.shadowColor = g.strokeStyle as string; g.shadowBlur = 8;
      g.beginPath(); a.pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); g.restore();
    }
    // The kernel's flown path, thin.
    if (v?.flown && v.flown.central === frame) { g.strokeStyle = 'rgba(255,178,46,0.45)'; g.lineWidth = 1; g.beginPath(); v.flown.pts.forEach((p, i) => { const q = P(p); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); }
    // The craft on the cursor's date: a diamond.
    for (const a of arcs) {
      if (cursor < a.t1 || cursor > a.t2) continue;
      const f = (cursor - a.t1) / (a.t2 - a.t1), i = Math.round(f * (a.pts.length - 1)), q = P(a.pts[i]);
      g.save(); g.translate(q[0], q[1]); g.rotate(Math.PI / 4); g.strokeStyle = PH; g.lineWidth = 2; g.strokeRect(-5, -5, 10, 10); g.restore();
    }
    // Burns: open squares; nodes: a square with a diamond; the selected one's tabs.
    tabs.current = [];
    for (const m of v?.marks ?? []) {
      const q = P(frameAt(m.central, m.at, m.ms));
      if (m.kind === 'aim') continue;
      const sel = m.id && m.id === store.selected;
      g.strokeStyle = m.kind === 'capture' || m.kind === 'land' ? KEY : PH; g.lineWidth = sel ? 2.5 : 1.5;
      g.strokeRect(q[0] - 7, q[1] - 7, 14, 14);
      if (m.kind === 'node') { g.save(); g.translate(q[0], q[1]); g.rotate(Math.PI / 4); g.strokeRect(-3.5, -3.5, 7, 7); g.restore(); }
      if (sel && m.frame) drawTabs(g, m, q, P, frameAt, DIM, KEY);
    }
    // Where the tabs are, for tests and tools that drive the scope.
    c.dataset.tabs = JSON.stringify(tabs.current.map((t) => ({ label: t.label, x: Math.round(t.at[0]), y: Math.round(t.at[1]) })));
  }, [arcs, v, store, cursor, compressed, squash, frameAt, bodyAt, frame]);

  // The tabs on the selected node: P and R along their directions on the
  // scope, N to the side (the scope looks down on the plane).
  function drawTabs(g: CanvasRenderingContext2D, m: JourneyMarkView, q: P2, P: (p: number[]) => P2, at: typeof frameAt, DIM: string, KEY: string) {
    const base = at(m.central, m.at, m.ms), F = m.frame!;
    const dirOf = (d: number[]): P2 => { const e = 1e-3 * Math.max(1e5, Math.hypot(base[0], base[1])); const b = P([base[0] + d[0] * e, base[1] + d[1] * e, base[2]]); const n = Math.hypot(b[0] - q[0], b[1] - q[1]) || 1; return [(b[0] - q[0]) / n, (b[1] - q[1]) / n]; };
    const T = dirOf(F.T), R = dirOf(F.R), side: P2 = [-T[1], T[0]];
    const list: [string, 'pro' | 'nor' | 'rad', number, P2][] = [['P+', 'pro', 1, T], ['P−', 'pro', -1, [-T[0], -T[1]]], ['R+', 'rad', 1, R], ['R−', 'rad', -1, [-R[0], -R[1]]],
      ['N+', 'nor', 1, [0.55 * side[0] - 0.55 * T[0], 0.55 * side[1] - 0.55 * T[1]]], ['N−', 'nor', -1, [-0.55 * side[0] - 0.55 * T[0], -0.55 * side[1] - 0.55 * T[1]]]];
    for (const [label, axis, sign, d0] of list) {
      const n = Math.hypot(d0[0], d0[1]) || 1, d: P2 = [d0[0] / n, d0[1] / n];
      const pulled = pull.current && pull.current.id === m.id && pull.current.axis === axis && pull.current.sign === sign ? pull.current.off : 0;
      const L = 58 + pulled, at2: P2 = [q[0] + d[0] * L, q[1] + d[1] * L];
      g.strokeStyle = pulled ? KEY : 'rgba(236,217,176,0.7)'; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(q[0] + d[0] * 10, q[1] + d[1] * 10); g.lineTo(at2[0], at2[1]); g.stroke();
      g.fillStyle = pulled ? KEY : '#e9e3d6'; g.strokeStyle = '#7d7564'; g.lineWidth = 1;
      g.fillRect(at2[0] - 15, at2[1] - 10, 30, 20); g.strokeRect(at2[0] - 15, at2[1] - 10, 30, 20);
      g.fillStyle = pulled ? '#fff7ea' : '#9a3216'; g.font = '10px Michroma, sans-serif'; g.textAlign = 'center'; g.fillText(label, at2[0], at2[1] + 4); g.textAlign = 'start';
      if (pulled) { g.fillStyle = KEY; g.font = '11px "B612 Mono", monospace'; g.fillText(`${fmt(pullRate(pulled) * 1000, 0)} m/s/s`, at2[0] + 19, at2[1] + 4); }
      tabs.current.push({ id: m.id!, axis, sign, at: at2, dir: d, label });
    }
  }

  // Redraw when anything it shows changes.
  useEffect(() => { const r = requestAnimationFrame(draw); return () => cancelAnimationFrame(r); }, [draw]);
  useEffect(() => { const o = new ResizeObserver(() => draw()); if (cv.current) o.observe(cv.current); return () => o.disconnect(); }, [draw]);

  // A pulled tab adds delta-v each frame until let go.
  const loop = useRef(0);
  const run = useCallback(() => {
    let last = performance.now();
    const tick = (t: number) => {
      const p = pull.current;
      if (!p) return;
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (p.off > 0) store.handlers.nudge(p.id, p.axis, p.sign * pullRate(p.off) * dt);
      loop.current = requestAnimationFrame(tick);
    };
    loop.current = requestAnimationFrame(tick);
  }, [store]);

  const local = (e: React.PointerEvent | React.WheelEvent): P2 => { const b = cv.current!.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const hitTab = (x: number, y: number) => tabs.current.find((t) => Math.abs(x - t.at[0]) < 16 && Math.abs(y - t.at[1]) < 11);
  // The nearest point on an arc (of one leg, or any), with its time.
  const nearest = (x: number, y: number, leg: number | null = null) => {
    const c = cv.current!, vv = view.current, s = vv.fit * vv.zoom;
    const P = (p: number[]): P2 => { const q = squash(p); return [c.clientWidth / 2 + (q[0] - vv.pan[0]) * s, c.clientHeight / 2 - (q[1] - vv.pan[1]) * s]; };
    let best: { leg: number; ms: number; d: number } | null = null;
    for (const a of arcs) {
      if (leg !== null && a.leg !== leg) continue;
      a.pts.forEach((p, i) => { const q = P(p), d = Math.hypot(q[0] - x, q[1] - y); if (!best || d < best.d) best = { leg: a.leg, ms: a.t1 + ((a.t2 - a.t1) * i) / Math.max(1, a.pts.length - 1), d }; });
    }
    return best as { leg: number; ms: number; d: number } | null;
  };
  const markAt = (x: number, y: number) => {
    const c = cv.current!, vv = view.current, s = vv.fit * vv.zoom;
    for (const m of v?.marks ?? []) {
      if (m.kind !== 'node' || !m.id) continue;
      const q = squash(frameAt(m.central, m.at, m.ms)), sx = c.clientWidth / 2 + (q[0] - vv.pan[0]) * s, sy = c.clientHeight / 2 - (q[1] - vv.pan[1]) * s;
      if (Math.hypot(sx - x, sy - y) < 11) return m;
    }
    return null;
  };

  const onDown = (e: React.PointerEvent) => {
    const [x, y] = local(e);
    try { cv.current!.setPointerCapture(e.pointerId); } catch { /* a pointer the page did not see go down */ }
    const t = hitTab(x, y);
    if (t) { pull.current = { id: t.id, axis: t.axis, sign: t.sign, dir: t.dir, x0: x, y0: y, off: 0 }; run(); return; }
    const m = markAt(x, y);
    if (m) { store.handlers.select(m.id!); drag.current = { kind: 'node', id: m.id, x0: x, y0: y, moved: 0, pan0: view.current.pan }; return; }
    drag.current = { kind: 'pan', x0: x, y0: y, moved: 0, pan0: [...view.current.pan] as P2 };
  };
  const onMove = (e: React.PointerEvent) => {
    const [x, y] = local(e);
    const p = pull.current;
    if (p) { p.off = Math.max(0, Math.min(PULL_MAX, (x - p.x0) * p.dir[0] + (y - p.y0) * p.dir[1])); draw(); return; }
    const d = drag.current;
    if (!d) return;
    d.moved = Math.max(d.moved, Math.hypot(x - d.x0, y - d.y0));
    if (d.kind === 'pan' && d.moved > 3) { const s = view.current.fit * view.current.zoom; view.current.pan = [d.pan0[0] - (x - d.x0) / s, d.pan0[1] + (y - d.y0) / s]; draw(); }
    else if (d.kind === 'node' && d.moved > 3) { const hit = nearest(x, y, Number(d.id!.split(':')[1])); if (hit) store.handlers.move(d.id!, Math.round(hit.ms)); }
  };
  const onUp = (e: React.PointerEvent) => {
    const [x, y] = local(e);
    if (pull.current) { pull.current = null; cancelAnimationFrame(loop.current); store.handlers.release(); draw(); return; }
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === 'node' && d.moved > 3) { store.handlers.release(); return; }
    if (d.kind === 'pan' && d.moved <= 3) {
      // A click: a node on the arc under it, or nothing selected.
      const hit = nearest(x, y);
      if (hit && hit.d < 10 && store.solution.legs[hit.leg]?.geometry !== 'local') { store.handlers.add(hit.leg, Math.round(hit.ms)); store.handlers.release(); }
      else if (store.selected) store.handlers.select(null);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const [x, y] = local(e);
    const t = hitTab(x, y);
    if (t) { store.handlers.nudge(t.id, t.axis, t.sign * (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 1e-4 : 1e-3)); store.handlers.release(); return; }
    const vv = view.current, s0 = vv.fit * vv.zoom, c = cv.current!;
    const wx = vv.pan[0] + (x - c.clientWidth / 2) / s0, wy = vv.pan[1] - (y - c.clientHeight / 2) / s0;
    vv.zoom = Math.min(400, Math.max(0.2, vv.zoom * Math.exp(-e.deltaY * 0.0015)));
    const s1 = vv.fit * vv.zoom;
    vv.pan = [wx - (x - c.clientWidth / 2) / s1, wy + (y - c.clientHeight / 2) / s1];
    draw();
  };

  return (
    <div className="plot-scope">
      <canvas ref={cv} className="scope-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        aria-label={`Plotting scope: the journey from above the ecliptic about ${nameOf(frame)}, on ${iso(cursor)}. A click on an arc adds a burn node; its numbers can be typed in the panel on the right.`} />
      <div className="scope-date" aria-hidden="true">{iso(cursor)}</div>
      <div className="scope-keys">
        <button className="key small" aria-pressed={compressed} onClick={() => setCompressed(!compressed)} title="Squeeze the radius (square root) so inner and outer planets both fit">Compressed</button>
        <button className="key small" onClick={() => { view.current.fitFor = ''; draw(); }}>Fit</button>
      </div>
      <div className="scope-legend" aria-hidden="true">{frame === 'sun' ? 'ecliptic from the north' : `about ${nameOf(frame)}`} · click an arc to add a node · drag to pan, wheel to zoom</div>
    </div>
  );
}

// ---------------- the ledger and the selected node ----------------

function Ledger({ store, lamps }: { store: JourneyStore; lamps: Lamp[] }) {
  const sol = store.solution, b = store.budget;
  const max = Math.max(b, sol.totalDv) * 1.08 || 1;
  const sel = store.selected?.startsWith('node:') ? store.node(store.selected) : null;
  let acc = 0;
  return (
    <>
      <h3 className="strip">Delta-v ledger</h3>
      <label className="num"><span className="engraved">Ship's budget</span>
        <input className="input" type="number" min={0} max={50} step={0.1} value={b} onChange={(e) => store.setBudget(Math.max(0, Number(e.target.value)))} /><span className="unit">km/s</span>
      </label>
      <p className="hint">From the parking orbit on: what the upper stage and the ship carry.</p>
      <table className="readout compact"><tbody>
        {sol.burns.map((x, i) => <tr key={i}><th scope="row">{iso(x.ms)}</th><td className="value">{fmt(x.dv, 3)}<span className="alt">{x.label}</span></td><td /></tr>)}
        <tr><th scope="row">Total</th><td className="value">{fmt(sol.totalDv, 3)} km/s<span className="alt">{sol.totalDv > b ? `over by ${fmt(sol.totalDv - b, 2)}` : `${fmt(b - sol.totalDv, 2)} to spare`}</span></td><td className="src"><SourceTag src="Σ burns" derived info="journey-total" /></td></tr>
      </tbody></table>
      <div className="ledger-bar" aria-hidden="true">
        {sol.burns.map((x, i) => { const l = acc; acc += x.dv; return <i key={i} style={{ left: `${(100 * l) / max}%`, width: `${(100 * x.dv) / max}%` }} className={`k${i % 3}`} />; })}
        <span className="budget-line" style={{ left: `${(100 * b) / max}%` }} />
      </div>
      {sel && store.selected && (
        <>
          <h3 className="strip">Burn node</h3>
          <div className="form-grid">
            {(['pro', 'nor', 'rad'] as const).map((ax) => (
              <label key={ax} className="num"><span className="engraved">{{ pro: 'Prograde', nor: 'Normal', rad: 'Radial' }[ax]}</span>
                <input className="input" type="number" step={1} value={Math.round(sel[ax] * 10000) / 10} onChange={(e) => { const d = Number(e.target.value) / 1000 - sel[ax]; store.handlers.nudge(store.selected!, ax, d); }} onBlur={() => store.handlers.release()} /><span className="unit">m/s</span>
              </label>
            ))}
            <label className="num"><span className="engraved">On</span><span className="readout-line">{iso(sel.ms)}</span></label>
          </div>
          <div className="keys-row wrap">
            <button className="key small" onClick={() => store.aimSelected()} title="The burn that brings this leg to its waypoint on its date (Lambert from the node)">Aim node</button>
            <button className="key small" onClick={() => { store.handlers.remove(store.selected!); store.handlers.release(); }}>Remove</button>
          </div>
          <p className="hint">Or pull its tabs on the scope: the further you pull, the faster it adds; Shift and the wheel for fine steps.</p>
        </>
      )}
      <h3 className="strip">Lamps</h3>
      <ul className="lamp-list">{lamps.map((l) => <li key={l.key} className={l.level}><b>{LAMP_NAME[l.key] ?? l.key}</b> {l.text}</li>)}</ul>
    </>
  );
}

// ---------------- the timeline ----------------

function Timeline({ store, cursor, setCursor }: { store: JourneyStore; cursor: number; setCursor: (ms: number) => void }) {
  const sol = store.solution, profiles = store.profilesFor === store.version ? store.profiles : [];
  const svg = useRef<SVGSVGElement>(null);
  const t0 = Math.min(sol.startMs, ...profiles.filter(Boolean).map((p) => p!.fromMs)) - 20 * DAY_MS;
  const t1 = Math.max(sol.endMs, ...profiles.filter(Boolean).map((p) => p!.points.at(-1)?.ms ?? 0)) + 40 * DAY_MS;
  const W = 1200, X0 = 96, X1 = 1188;
  const x = (ms: number) => X0 + ((X1 - X0) * (ms - t0)) / (t1 - t0);
  const rows = profiles.map((p, k) => (p ? { p, k } : null)).filter(Boolean) as { p: NonNullable<typeof profiles[number]>; k: number }[];
  const H = 44 + rows.length * 34 + 30;
  const yPlan = 30 + rows.length * 34;
  const legDv = (k: number) => { const L = sol.legs[k]; return L?.ok ? L.depDv + L.arrDv + L.midDv : 0; };
  const years: number[] = [];
  for (let y = new Date(t0).getUTCFullYear() + 1; Date.UTC(y, 0, 1) < t1; y++) years.push(Date.UTC(y, 0, 1));
  const scrub = (e: React.PointerEvent) => { const b = svg.current!.getBoundingClientRect(), px = ((e.clientX - b.left) * W) / b.width; setCursor(Math.max(sol.startMs, Math.min(sol.endMs, t0 + ((px - X0) / (X1 - X0)) * (t1 - t0)))); };
  // Leave on the date clicked in a leg's strip, at that date's best flight time.
  const leaveOn = (k: number, q: { ms: number; tofDays: number; dv: number }) => {
    store.set(applyOption(store.journey, k, { type: 'porkchop', depMs: q.ms, arrMs: q.ms + q.tofDays * DAY_MS, dv: q.dv } as never));
    store.check();
  };
  return (
    <div className="plot-timeline">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Timeline: each leg's cheapest delta-v by departure date against the budget, the plan, and the time cursor"
        onPointerDown={(e) => { if ((e.target as Element).tagName === 'rect' && (e.target as Element).getAttribute('data-k')) return; (e.currentTarget as Element).setPointerCapture(e.pointerId); scrub(e); }}
        onPointerMove={(e) => { if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) scrub(e); }}>
        {years.map((ms) => <g key={ms}><line x1={x(ms)} x2={x(ms)} y1={12} y2={H - 8} className="tl-year" /><text x={x(ms) + 4} y={22} className="tl-label">{new Date(ms).getUTCFullYear()}</text></g>)}
        {rows.map(({ p, k }, i) => {
          const y = 30 + i * 34, room = store.budget - (sol.totalDv - legDv(k));
          const w = Math.max(1, x(p.fromMs + p.stepDays * DAY_MS) - x(p.fromMs));
          return (
            <g key={k}>
              <text x={4} y={y + 13} className="tl-name">{`${nameOf(sol.legs[k]?.from ?? '')} › ${nameOf(sol.legs[k]?.to ?? '')}`.toUpperCase()}</text>
              {p.points.map((q) => {
                const ok = q.dv <= room, a = Math.max(0.15, Math.min(1, 1.5 - q.dv / Math.max(2 * (p.best?.dv ?? 1), 1)));
                return <rect key={q.ms} data-k={k} x={x(q.ms)} y={y} width={w + 0.5} height={18} className={ok ? 'tl-ok' : 'tl-no'} style={{ opacity: ok ? a : a * 0.4 }}
                  onClick={() => leaveOn(k, q)}><title>{`Leave ${iso(q.ms)}: ${fmt(q.dv, 2)} km/s, ${fmt(q.tofDays, 0)} d flight${ok ? '' : ' (over what the budget leaves this leg)'}. Click to leave then.`}</title></rect>;
              })}
              {p.best && <text x={x(p.best.ms)} y={y - 3} className="tl-best" textAnchor="middle">{`${fmt(p.best.dv, 2)} km/s`}</text>}
            </g>
          );
        })}
        <text x={4} y={yPlan + 12} className="tl-name">PLAN</text>
        {sol.legs.map((L, k) => L.ok && <rect key={`l${k}`} x={x(L.depMs)} y={yPlan} width={Math.max(2, x(L.arrMs) - x(L.depMs))} height={14} className={L.shaped && !L.reaches ? 'tl-leg bad' : 'tl-leg'} />)}
        {sol.stops.slice(1).map((s, k) => s.depMs - s.arrMs > DAY_MS && <g key={`s${k}`}><rect x={x(s.arrMs)} y={yPlan} width={x(s.depMs) - x(s.arrMs)} height={14} className="tl-stay" />{x(s.depMs) - x(s.arrMs) > 70 && <text x={(x(s.arrMs) + x(s.depMs)) / 2} y={yPlan + 11} textAnchor="middle" className="tl-best">{`${Math.round((s.depMs - s.arrMs) / DAY_MS)} d at ${nameOf(s.body)}`}</text>}</g>)}
        {sol.burns.map((b, i) => <line key={`b${i}`} x1={x(b.ms)} x2={x(b.ms)} y1={yPlan - 3} y2={yPlan + 17} className="tl-burn" />)}
        <line x1={x(cursor)} x2={x(cursor)} y1={26} y2={H - 6} className="tl-cursor" />
        <rect x={x(cursor) - 6} y={H - 18} width={12} height={12} className="tl-cursor-grip" />
      </svg>
      {!profiles.length && store.journey.waypoints.length > 0 && <p className="hint">Working out each leg's windows…</p>}
    </div>
  );
}
