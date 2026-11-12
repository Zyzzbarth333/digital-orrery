// src/app/planner-panel.tsx
//
// The PLANNER tab: a porkchop grid from Earth to a destination (Lambert
// arcs, computed in a Web Worker), shaded by departure C3 (amber where it
// is low), the minimum marked, a cell's numbers on click, and "Fly this":
// set the clock to the departure and launch onto the departure hyperbola
// whose excess velocity is that cell's Lambert v_inf.

import { useEffect, useRef, useState } from 'react';
import type { SimClock } from './clock';
import type { Mission } from './mission';
import type { GridRequest } from './porkchop.worker';
import { transferBetween } from '../physics/porkchop.js';
import { helioStateEcl, eclToEqj } from '../physics/ephemeris.js';
import { GRAVITATIONAL_PARAMETERS as GM, PLANETS } from '../utils/constants.js';

interface Grid {
  nDep: number; nTof: number; depDays: number[]; tofDays: number[];
  c3: Float64Array; dvTotal: Float64Array; vinfArr: Float64Array;
  minC3: { iDep: number; iTof: number } | null; ms: number; req: GridRequest;
}

const DESTS: { key: string; name: string; tof: [number, number] }[] = [
  { key: 'venus', name: 'Venus', tof: [80, 260] },
  { key: 'mars', name: 'Mars', tof: [120, 450] },
  { key: 'jupiter', name: 'Jupiter', tof: [500, 1200] },
  { key: 'saturn', name: 'Saturn', tof: [1000, 2600] },
];
const DAY = 86400;
const G = GM as Record<string, number>, P = PLANETS as Record<string, { radius: number }>;
const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// The console's own ramp: low C3 bright amber, high C3 into window black.
const RAMP = [[0xf5, 0xf0, 0xe4], [0xff, 0xb2, 0x2e], [0xd9, 0x53, 0x1f], [0x9a, 0x32, 0x16], [0x12, 0x11, 0x10]];
function shade(x: number): [number, number, number] {
  const f = Math.min(1, Math.max(0, x)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(f)), u = f - i;
  return [0, 1, 2].map((k) => Math.round(RAMP[i][k] + (RAMP[i + 1][k] - RAMP[i][k]) * u)) as [number, number, number];
}

export function PlannerPanel({ clock, mission, onFlown, autoPlan = null }: { clock: SimClock; mission: Mission; onFlown: (id: number) => void; autoPlan?: string | null }) {
  const [dest, setDest] = useState(DESTS.some((x) => x.key === autoPlan) ? autoPlan! : 'mars');
  const [startIso, setStartIso] = useState(() => iso(clock.snapshot.timeMs));
  const [span, setSpan] = useState(780);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<{ iDep: number; iTof: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  // The worker lives with the panel (created in the effect, so React's
  // development double-mount does not leave a terminated one behind).
  const worker = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = new Worker(new URL('./porkchop.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<Grid>) => { setGrid(e.data); setPick(e.data.minC3); setBusy(false); };
    w.onerror = () => setBusy(false);
    worker.current = w;
    setReady(true);
    return () => { w.terminate(); worker.current = null; setReady(false); };
  }, []);

  const d = DESTS.find((x) => x.key === dest)!;
  const auto = useRef(autoPlan !== null);
  const compute = () => {
    const depStartMs = Date.parse(`${startIso}T00:00:00Z`);
    if (!Number.isFinite(depStartMs)) return;
    const depStep = Math.max(1, Math.round(span / 120)), tofStep = Math.max(1, Math.round((d.tof[1] - d.tof[0]) / 80));
    if (!worker.current) return;
    setBusy(true);
    worker.current.postMessage({ dest, depStartMs, depSpanDays: span, depStep, tofMin: d.tof[0], tofMax: d.tof[1], tofStep } satisfies GridRequest);
  };

  // A link with ?plan= computes the grid once on opening.
  useEffect(() => { if (auto.current && ready) { auto.current = false; compute(); } });

  // Draw: departure across, time of flight up; log C3 from the minimum to 8x it.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv || !grid) return;
    const W = grid.nDep, H = grid.nTof;
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d')!;
    const img = g.createImageData(W, H);
    const c3min = grid.minC3 ? grid.c3[grid.minC3.iTof * W + grid.minC3.iDep] : 1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const v = grid.c3[j * W + i], o = 4 * ((H - 1 - j) * W + i);
      if (!Number.isFinite(v)) { img.data.set([0x34, 0x31, 0x2a, 255], o); continue; }
      const [r, gg, b] = shade(Math.log(v / c3min) / Math.log(8));
      img.data.set([r, gg, b, 255], o);
    }
    g.putImageData(img, 0, 0);
    const mark = (c: { iDep: number; iTof: number } | null, colour: string) => {
      if (!c) return;
      g.strokeStyle = colour; g.lineWidth = 1;
      g.strokeRect(c.iDep - 1.5, H - 1 - c.iTof - 1.5, 4, 4);
    };
    mark(grid.minC3, '#1d1b16');
    mark(pick, '#7fe06a');
  }, [grid, pick]);

  const cell = grid && pick ? (() => {
    const k = pick.iTof * grid.nDep + pick.iDep;
    const depMs = grid.req.depStartMs + grid.depDays[pick.iDep] * DAY * 1000;
    const tof = grid.tofDays[pick.iTof];
    return { depMs, arrMs: depMs + tof * DAY * 1000, tof, c3: grid.c3[k], vinfArr: grid.vinfArr[k], dv: grid.dvTotal[k] };
  })() : null;

  const fly = () => {
    if (!cell || !Number.isFinite(cell.c3)) return;
    const E = helioStateEcl('earth', new Date(cell.depMs)), A = helioStateEcl(dest, new Date(cell.arrMs));
    const t = transferBetween(E, A, cell.tof * DAY, G.sun / 1e9, { mu: G.earth / 1e9, rPark: P.earth.radius + 200 }, { mu: G[dest] / 1e9, rPark: P[dest].radius + 400, capture: true });
    if (!t) return;
    clock.setTime(cell.depMs);
    const vInf = eclToEqj([0, 1, 2].map((i) => t.v1[i] - E.v[i])) as [number, number, number];
    const craft = mission.launchDeparture(cell.depMs, vInf, `${d.name} ${iso(cell.depMs)}`);
    mission.setPlan(craft, dest, d.name, cell.arrMs);
    onFlown(craft.id);
  };

  const onCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!grid) return;
    const r = e.currentTarget.getBoundingClientRect();
    const iDep = Math.min(grid.nDep - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * grid.nDep)));
    const iTof = Math.min(grid.nTof - 1, Math.max(0, grid.nTof - 1 - Math.floor(((e.clientY - r.top) / r.height) * grid.nTof)));
    setPick({ iDep, iTof });
  };

  return (
    <div className="tab-body">
      <h3 className="strip">Transfer from Earth</h3>
      <div className="form-grid">
        <label className="num"><span className="engraved">To</span>
          <select className="input" value={dest} onChange={(e) => { setDest(e.target.value); setGrid(null); }}>
            {DESTS.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </select>
        </label>
        <label className="num"><span className="engraved">Depart from</span>
          <input className="input" type="date" value={startIso} onChange={(e) => setStartIso(e.target.value)} />
        </label>
        <label className="num"><span className="engraved">Over</span>
          <input className="input" type="number" step={30} value={span} onChange={(e) => setSpan(Number(e.target.value))} /><span className="unit">d</span>
        </label>
      </div>
      <div className="keys-row">
        <button className="key" onClick={compute} disabled={busy}>{busy ? 'Computing…' : 'Compute grid'}</button>
        <span className="hint">flight {d.tof[0]}–{d.tof[1]} d</span>
      </div>
      {grid && (
        <figure className="porkchop">
          <canvas ref={canvas} onClick={onCanvas} aria-label={`Porkchop grid to ${d.name}: departure date across, time of flight up, shaded by C3`} />
          <figcaption>
            <span>{iso(grid.req.depStartMs)} → departure → {iso(grid.req.depStartMs + grid.req.depSpanDays * DAY * 1000)}</span>
            <span>{grid.nDep * grid.nTof} Lambert arcs in {fmt(grid.ms / 1000, 1)} s · amber = low C3 · square = minimum</span>
          </figcaption>
        </figure>
      )}
      {cell && (
        <>
          <table className="readout"><tbody>
            <tr><th scope="row">Depart</th><td className="value">{iso(cell.depMs)}</td><td className="src"><span className="src-tag" title="astronomy-engine states, Lambert arc">AE</span></td></tr>
            <tr><th scope="row">Arrive</th><td className="value">{iso(cell.arrMs)} · {cell.tof} d</td><td className="src"><span className="src-tag" title="zero-revolution prograde Lambert arc (src/physics/orbital.js)">Lambert</span></td></tr>
            <tr><th scope="row">C3</th><td className="value">{fmt(cell.c3, 2)} km²/s²</td><td className="src"><span className="src-tag" title="departure v-infinity squared">Lambert</span></td></tr>
            <tr><th scope="row">Arrival v∞</th><td className="value">{fmt(cell.vinfArr, 3)} km/s</td><td className="src"><span className="src-tag" title="excess speed at the destination">Lambert</span></td></tr>
            <tr><th scope="row">Δv total</th><td className="value">{fmt(cell.dv, 3)} km/s</td><td className="src"><span className="src-tag derived" title="from a 200 km parking orbit, into a 400 km capture orbit">2-body</span></td></tr>
          </tbody></table>
          <div className="keys-row">
            <button className="key run" aria-pressed={false} onClick={fly} disabled={!Number.isFinite(cell.c3)}>Fly this</button>
            <span className="hint">sets the clock to the departure</span>
          </div>
        </>
      )}
    </div>
  );
}
