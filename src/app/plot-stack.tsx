// src/app/plot-stack.tsx
//
// The plotting table's STACK station: the rocket the journey needs
// (staging.js: the journey's delta-v plus the climb to orbit, split by
// optimal staging), drawn as a stack; a delta-v waterfall that sets the
// journey's burns beside the stages that pay for them; and the published
// launchers (launchers.js, read-only) against the same job: what each gives
// the payload, and the most it could carry (docs/physics/journey.md#the-rocket-it-needs).

import { useMemo } from 'react';
import { useJourney, type JourneyStore, type Vehicle } from './journey';
import { SourceTag } from './source-tag';
import { sizeLauncher, launchBudget, launcherFor, STAGE_TECH } from '../physics/staging.js';
import { LAUNCHERS } from '../physics/launchers.js';

const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
type Tech = keyof typeof STAGE_TECH;
interface Stage { isp: number; eps: number; prop: number; dry: number; step: number; dv: number }
interface Option { n: number; feasible: boolean; reason?: string; liftoff?: number; payloadFraction?: number; stages?: Stage[] }

// The job and the sized stack, for STACK and GO alike.
export function useStack(store: JourneyStore) {
  useJourney(store);
  const j = store.journey, sol = store.solution, v = store.vehicle;
  const climb = j.start.kind === 'pad';
  const budget = launchBudget({ journeyDv: sol.totalDv * 1000, h: j.start.altKm * 1000, lat: j.start.latDeg ?? 28.5, az: 90 });
  const dv = climb ? budget.total : sol.totalDv * 1000;
  const B = { isp: v.isp1 ?? STAGE_TECH[v.booster].isp, eps: v.eps1 }, U = { isp: v.isp2 ?? STAGE_TECH[v.upper].isp, eps: v.eps2 };
  const sized = useMemo(() => sizeLauncher({ dv, payload: v.payload, booster: B, upper: U, maxStages: 4 }) as { options: Option[]; pick: Option | null }, [dv, v.payload, B.isp, B.eps, U.isp, U.eps]);
  const n = v.n ?? sized.pick?.n ?? null;
  const chosen = sized.options.find((o) => o.n === n && o.feasible) ?? null;
  const real = useMemo(() => LAUNCHERS.map((L) => launcherFor(L, { payload: v.payload, dv }) as { key: string; label: string; dv: number; margin: number; can: boolean; maxPayload: number; liftoff: number; source: { text: string; url: string } }), [dv, v.payload]);
  return { climb, budget, dv, sized, chosen, real, B, U };
}

export function StackStation({ store }: { store: JourneyStore }) {
  const { climb, budget, dv, sized, chosen, real, B, U } = useStack(store);
  const v = store.vehicle, sol = store.solution;
  const set = (p: Partial<Vehicle>) => store.setVehicle(p);
  if (!store.journey.waypoints.length) return <div className="station-empty"><p>Plan a journey in PLOT first: the rocket is sized for its delta-v.</p></div>;
  if (!sol.ok) return <div className="station-empty"><p className="status bad">A leg has no solution: fix it in PLOT, then the rocket can be sized.</p></div>;
  // The waterfall: the job's parts in order, against the stages.
  const parts: { label: string; dv: number; kind: string }[] = [
    ...(climb ? [{ label: 'Climb to orbit', dv: budget.toOrbit / 1000, kind: 'climb' }] : []),
    ...sol.burns.map((b) => ({ label: b.label, dv: b.dv, kind: b.kind })),
  ];
  const total = dv / 1000, top = chosen?.stages ? Math.max(...chosen.stages.map((s) => s.step)) : 1;
  return (
    <div className="stack-station">
      <section className="stack-left">
        <h3 className="strip">The job</h3>
        <table className="readout"><tbody>
          <tr><th scope="row">Delta-v</th><td className="value">{fmt(total, 2)} km/s<span className="alt">{climb ? `climb ${fmt(budget.toOrbit / 1000, 2)} (with 1.5 of losses) + journey ${fmt(sol.totalDv, 2)}` : 'from the orbit: no climb'}</span></td><td className="src"><SourceTag src="budget" derived info="to-orbit" /></td></tr>
        </tbody></table>
        <div className="form-grid">
          <label className="num"><span className="engraved">Payload</span><input className="input" type="number" min={1} step={100} value={v.payload} onChange={(e) => set({ payload: Math.max(1, Number(e.target.value)) })} /><span className="unit">kg</span></label>
          <span />
          <label className="num"><span className="engraved">Stage 1</span>
            <select className="input select" value={v.booster} onChange={(e) => set({ booster: e.target.value as Tech, isp1: null })}>{Object.entries(STAGE_TECH).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</select></label>
          <label className="num"><span className="engraved">Upper stages</span>
            <select className="input select" value={v.upper} onChange={(e) => set({ upper: e.target.value as Tech, isp2: null })}>{Object.entries(STAGE_TECH).map(([k, t]) => <option key={k} value={k}>{t.name}</option>)}</select></label>
          <label className="num"><span className="engraved">Isp, ε</span><input className="input" type="number" min={100} max={1000} step={5} value={B.isp} onChange={(e) => set({ isp1: Number(e.target.value) })} /><input className="input" type="number" min={0.02} max={0.5} step={0.01} value={v.eps1} onChange={(e) => set({ eps1: Number(e.target.value) })} /></label>
          <label className="num"><span className="engraved">Isp, ε</span><input className="input" type="number" min={100} max={1000} step={5} value={U.isp} onChange={(e) => set({ isp2: Number(e.target.value) })} /><input className="input" type="number" min={0.02} max={0.5} step={0.01} value={v.eps2} onChange={(e) => set({ eps2: Number(e.target.value) })} /></label>
        </div>
        <p className="hint">Isp from Curtis Table 6.1, structural ratio 0.1 (Curtis §13.4): typical values, not any one vehicle's.</p>
        <div className="keys-row wrap" role="radiogroup" aria-label="Number of stages">
          {sized.options.map((x) => <button key={x.n} className="key small" role="radio" aria-checked={x.n === (chosen?.n ?? -1)} disabled={!x.feasible} onClick={() => set({ n: x.n })}
            title={x.feasible ? `${x.n} stages: ${fmt((x.liftoff ?? 0) / 1000, 1)} t at liftoff` : x.reason === 'empty-stage' ? 'The lightest would leave a stage empty: fewer do it better' : `Cannot give ${fmt(total, 1)} km/s`}>{x.n} {x.feasible ? `· ${fmt((x.liftoff ?? 0) / 1000, 0)} t` : x.reason === 'empty-stage' ? '· no gain' : '· cannot'}</button>)}
        </div>
        {!chosen && <p className="status bad">No stack of up to four of these stages gives {fmt(total, 1)} km/s. Try a higher Isp or a lighter structure.</p>}
        {chosen?.stages && (
          <table className="readout compact"><tbody>
            <tr><th scope="row">Liftoff</th><td className="value">{fmt((chosen.liftoff ?? 0) / 1000, 1)} t<span className="alt">payload fraction {fmt((chosen.payloadFraction ?? 0) * 100, 2)} %</span></td><td className="src"><SourceTag src="Lagrange" derived info="journey-stack" /></td></tr>
            {chosen.stages.map((s, i) => <tr key={i}><th scope="row">Stage {i + 1}</th><td className="value">{fmt(s.prop / 1000, 1)} t propellant<span className="alt">{fmt(s.dry / 1000, 2)} t dry · Isp {s.isp} s · Δv {fmt(s.dv / 1000, 2)} km/s</span></td><td /></tr>)}
          </tbody></table>
        )}
      </section>

      <section className="stack-scope" aria-label="The stack and its delta-v">
        {chosen?.stages && (
          <figure className="stack-draw" aria-label={`A ${chosen.n}-stage stack, payload on top`}>
            <div className="sd-payload">{fmt(v.payload / 1000, v.payload < 10000 ? 1 : 0)} t</div>
            {[...chosen.stages].map((s, i) => ({ s, i })).reverse().map(({ s, i }) => (
              <div key={i} className="sd-stage" style={{ height: `${Math.round(30 + 150 * Math.sqrt(s.step / top))}px`, width: `${Math.round(44 + 30 * Math.sqrt(s.step / top))}px` }}>
                <i style={{ height: `${(100 * s.dry) / s.step}%` }} aria-hidden="true" /><span>S{i + 1}</span>
              </div>
            ))}
            <figcaption>{fmt((chosen.liftoff ?? 0) / 1000, 1)} t at liftoff · heights by the square root of mass, the band its dry mass</figcaption>
          </figure>
        )}
        <div className="waterfall">
          <h3>Who pays for each part of the journey</h3>
          <div className="wf-row"><span>Journey</span><div className="wf-track">{(() => { let x = 0; return parts.map((p, i) => { const s = <span key={i} className={`wf-${p.kind}`} style={{ left: `${(100 * x) / total}%`, width: `${(100 * p.dv) / total}%` }} title={`${p.label}: ${fmt(p.dv, 2)} km/s`}>{p.label} {fmt(p.dv, 2)}</span>; x += p.dv; return s; }); })()}</div></div>
          {chosen?.stages && <div className="wf-row"><span>Stages</span><div className="wf-track">{(() => { let x = 0; return chosen.stages!.map((s, i) => { const d = s.dv / 1000; const el = <span key={i} className={`wf-s${i}`} style={{ left: `${(100 * x) / total}%`, width: `${(100 * d) / total}%` }} title={`Stage ${i + 1}: ${fmt(d, 2)} km/s`}>S{i + 1} {fmt(d, 2)}</span>; x += d; return el; }); })()}</div></div>}
          <p className="hint">Each stage's delta-v set under the parts of the journey it flies: where a stage ends mid-burn, the next one finishes that burn.</p>
        </div>
      </section>

      <section className="stack-right">
        <h3 className="strip">Real launchers, same job</h3>
        <p className="hint">The rocket equation with each stage's vacuum Isp against the job's {fmt(total, 2)} km/s (its 1.5 km/s of ascent losses included): published stages, as the ROCKET tab's presets have them.</p>
        <table className="readout compact launchers"><tbody>
          {real.map((r) => (
            <tr key={r.key}>
              <th scope="row">{r.label}</th>
              <td className={`value ${r.can ? '' : 'bad'}`}>{r.can ? `can, ${fmt(r.margin / 1000, 2)} km/s spare` : `short by ${fmt(-r.margin / 1000, 2)} km/s`}
                <span className="alt">{fmt(r.dv / 1000, 2)} km/s with {fmt(v.payload / 1000, 1)} t · {r.maxPayload > 0 ? `at most ${fmt(r.maxPayload / 1000, r.maxPayload < 10000 ? 2 : 1)} t for this job` : 'no payload at all for this job'}</span></td>
              <td className="src"><SourceTag src="published" info="stack-dv" detail={r.source.text} /></td>
            </tr>
          ))}
        </tbody></table>
      </section>
    </div>
  );
}
