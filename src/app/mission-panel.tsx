// src/app/mission-panel.tsx
//
// The MISSION tab: launch a craft, read out its state, plan manoeuvre nodes,
// fire the engine, and read its log. States come from the n-body kernel
// (tag "kernel"); orbital elements are the osculating two-body elements
// about the craft's primary (dashed tag "2-body": worked out here).

import { useState } from 'react';
import type { SimClock } from './clock';
import { useClock } from './clock';
import { useMission, type Mission, type DepartureDirection } from './mission';
import { BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { kernelSeconds, KERNEL_EPOCH_MS } from '../physics/kernelHost.js';

const DEG = 180 / Math.PI;
const fmt = (n: number, d = 1) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const utc = (tKernel: number) => new Date(KERNEL_EPOCH_MS + tKernel * 1000).toISOString().slice(0, 19).replace('T', ' ');

function Num({ label, value, onChange, step = 1, unit, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; unit?: string; min?: number; max?: number }) {
  const bad = !Number.isFinite(value) || (min !== undefined && value < min) || (max !== undefined && value > max);
  return (
    <label className="num">
      <span className="engraved">{label}</span>
      <input className="input" type="number" step={step} min={min} max={max} value={Number.isFinite(value) ? value : ''} aria-invalid={bad}
        onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
      {unit && <span className="unit">{unit}</span>}
    </label>
  );
}

function Tag({ src, derived = false, detail }: { src: string; derived?: boolean; detail: string }) {
  return <span className={`src-tag${derived ? ' derived' : ''}`} title={detail}>{src}</span>;
}

export function MissionPanel({ clock, mission, onFocusCraft }: { clock: SimClock; mission: Mission; onFocusCraft: (id: number) => void }) {
  const s = useClock(clock);
  useMission(mission);
  const [kind, setKind] = useState<'orbit' | 'departure'>('orbit');
  const [alt, setAlt] = useState(400), [inc, setInc] = useState(51.6);
  const [vinf, setVinf] = useState(2.95), [dir, setDir] = useState<DepartureDirection>('prograde');
  const [nodeMin, setNodeMin] = useState(30), [dvR, setDvR] = useState(0), [dvP, setDvP] = useState(100), [dvN, setDvN] = useState(0);
  const c = mission.selected;
  // Bounds that keep a launch physical: above the atmosphere's dense part,
  // a real inclination, an excess speed the model craft could be given.
  const launchProblem = kind === 'orbit'
    ? (!(alt >= 120 && alt <= 400000) ? 'altitude from 120 to 400,000 km' : !(inc >= 0 && inc <= 180) ? 'inclination from 0 to 180°' : null)
    : (!(vinf >= 0 && vinf <= 30) ? 'excess speed from 0 to 30 km/s' : null);
  const nodeProblem = !(nodeMin >= 1) ? 'a node at least 1 min ahead'
    : ![dvR, dvP, dvN].every(Number.isFinite) ? 'a number for each component'
      : Math.hypot(dvR, dvP, dvN) === 0 ? 'a non-zero delta-v' : null;

  const launch = () => {
    if (launchProblem) return;
    const craft = kind === 'orbit' ? mission.launchOrbit(s.timeMs, alt, inc) : mission.launchDeparture(s.timeMs, { speed: vinf, dir });
    onFocusCraft(craft.id);
  };

  let readout: React.ReactNode = null;
  if (c) {
    const el = c.elements();
    const P = el.about === 'sun' ? null : BODY_BY_KEY[el.about as BodyKey];
    const R = P ? P.radiusKm : 0;
    const st = c.displayState();
    const rel = mission.relative(c);
    const dvLeft = c.ve * Math.log(c.mass / c.dryMass);
    const rows: [string, React.ReactNode, React.ReactNode][] = [
      ['Motion', 'Integrated', <Tag src="kernel" detail="stepped under the gravity of the Sun, planets and Moon (n-body), not on a fixed track like the planets" />],
      ['About', P ? P.name : 'Sun', <Tag src="kernel" detail="the body whose sphere of influence holds the craft" />],
      [P ? 'Altitude' : 'From the Sun', `${fmt((rel.r - R), 1)} km`, <Tag src="kernel" detail="n-body state (Encke near a planet, Cowell elsewhere) carried to the clock" />],
      ['Speed', `${fmt(rel.v, 4)} km/s`, <Tag src="kernel" detail={`relative to ${P ? P.name : 'the Sun'}`} />],
    ];
    if (el.e < 1) {
      rows.push(['Periapsis', `${fmt(el.a * (1 - el.e) - R, 1)} km`, <Tag src="2-body" derived detail={`osculating, about ${P ? P.name : 'the Sun'}${P ? ', altitude' : ''}`} />]);
      rows.push(['Apoapsis', `${fmt(el.a * (1 + el.e) - R, 1)} km`, <Tag src="2-body" derived detail="osculating" />]);
      rows.push(['Period', `${fmt((2 * Math.PI * Math.sqrt(el.a ** 3 / (P ? P.gm ?? 1 : mission.sys.muSun))) / 60, 2)} min`, <Tag src="2-body" derived detail="osculating" />]);
    } else {
      rows.push(['Excess speed', `${fmt(Math.sqrt(-(P ? P.gm ?? 1 : mission.sys.muSun) / el.a), 4)} km/s`, <Tag src="2-body" derived detail="v-infinity of the osculating hyperbola" />]);
    }
    rows.push(['Eccentricity', fmt(el.e, 6), <Tag src="2-body" derived detail="osculating" />]);
    rows.push(['Inclination', `${fmt(el.i * DEG, 3)}°`, <Tag src="2-body" derived detail={`to the ${el.frame}`} />]);
    rows.push(['Propellant', `${fmt(c.fuel, 2)} kg`, <Tag src="model" derived detail={`one tank; dry mass ${c.dryMass} kg, ${c.thrust} N at Isp ${c.isp} s`} />]);
    rows.push(['Δv left', `${fmt(dvLeft, 1)} m/s`, <Tag src="rocket eq." derived detail="ve ln(m / m_dry)" />]);
    const plan = mission.plan(c);
    if (plan) rows.push([`Closest to ${plan.name}`, `${fmt(plan.closest / 1000, 0)} thousand km`, <Tag src="kernel" derived detail={`so far; planned arrival ${new Date(plan.arrivalMs).toISOString().slice(0, 10)}`} />]);
    const state = c.crashed ? `Impact: ${c.impactBody}` : c.error ? `Error: ${c.error}` : c.lagSeconds > 60 ? `Behind the clock by ${fmt(c.lagSeconds / 60, 1)} min` : 'Stepping';
    readout = (
      <>
        <table className="readout"><tbody>
          {rows.map(([k, v, t]) => <tr key={k}><th scope="row">{k}</th><td className="value">{v}</td><td className="src">{t}</td></tr>)}
        </tbody></table>
        <p className={`status${c.crashed || c.error ? ' bad' : c.lagSeconds > 60 ? ' lag' : ''}`}>{state}</p>
        <ul className="legend">
          <li><i className="sw conic" />Osculating orbit: where it would go if only {P ? P.name : 'the Sun'} pulled on it</li>
          <li><i className="sw trail" />Path flown</li>
        </ul>

        <h3 className="strip">Engine</h3>
        <div className="keys-row wrap">
          <button className="key" onClick={() => c.setEngine(st.v.map((x: number, i: number) => x - mission.primaryVelocity(c)[i]))}>Prograde</button>
          <button className="key" onClick={() => c.setEngine(st.v.map((x: number, i: number) => -(x - mission.primaryVelocity(c)[i])))}>Retrograde</button>
          <button className="key" onClick={() => c.setEngine(null)} disabled={!c.engineOn}>Cut</button>
        </div>

        <h3 className="strip">Manoeuvre node</h3>
        <div className="form-grid">
          <Num label="In" value={nodeMin} onChange={setNodeMin} unit="min" min={1} />
          <Num label="Radial" value={dvR} onChange={setDvR} unit="m/s" />
          <Num label="Prograde" value={dvP} onChange={setDvP} unit="m/s" />
          <Num label="Normal" value={dvN} onChange={setDvN} unit="m/s" />
        </div>
        <div className="keys-row wrap">
          <button className="key" disabled={!!nodeProblem} onClick={() => c.addNode(kernelSeconds(new Date(s.timeMs)) + nodeMin * 60, [dvR / 1000, dvP / 1000, dvN / 1000])}>Add node</button>
          <span className="hint">{nodeProblem ? `Needs ${nodeProblem}` : (() => {
            const need = c.propellantFor(Math.hypot(dvR, dvP, dvN) / 1000);
            return need > c.fuel ? `Needs ${fmt(need, 1)} kg; ${fmt(c.fuel, 1)} kg on board` : `Uses ${fmt(need, 1)} kg at ${utc(kernelSeconds(new Date(s.timeMs)) + nodeMin * 60).slice(11, 16)} UTC`;
          })()}</span>
        </div>
        {c.nodes.length > 0 && (
          <ul className="node-list">
            {c.nodes.map((n: { id: number; t: number; dv: number[] }) => (
              <li key={n.id}>
                <span>{utc(n.t).slice(11)} · {fmt(Math.hypot(...n.dv) * 1000, 1)} m/s</span>
                <button className="key small" onClick={() => c.removeNode(n)}>Delete</button>
              </li>
            ))}
          </ul>
        )}

        <h3 className="strip">Log</h3>
        <ol className="log">
          {c.log.slice(-6).reverse().map((e: { t: number; text: string }, i: number) => <li key={i}><time>{utc(e.t).slice(5)}</time> {e.text}</li>)}
          {c.log.length === 0 && <li className="hint">Nothing yet.</li>}
        </ol>
        <div className="keys-row wrap">
          <button className="key" onClick={() => onFocusCraft(c.id)}>Follow</button>
          <button className="key" onClick={() => mission.remove(c)}>Remove craft</button>
        </div>
      </>
    );
  }

  return (
    <div className="tab-body">
      {mission.lastRemoved && (
        <div className="notice inline" role="status">
          <span>Removed {mission.lastRemoved.name}</span>
          <button className="key small" onClick={() => mission.restore()}>Restore</button>
        </div>
      )}
      {mission.crafts.length > 0 && (
        <div className="craft-pick">
          <label className="engraved" htmlFor="craft">Craft</label>
          <select id="craft" className="rate" value={c?.id ?? ''} onChange={(e) => { const id = Number(e.target.value); mission.select(id); onFocusCraft(id); }}>
            {mission.crafts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      )}
      {readout}
      <h3 className="strip">Launch from Earth</h3>
      <div className="keys-row" role="radiogroup" aria-label="Launch kind">
        <button className="key" role="radio" aria-checked={kind === 'orbit'} onClick={() => setKind('orbit')}>Orbit</button>
        <button className="key" role="radio" aria-checked={kind === 'departure'} onClick={() => setKind('departure')}>Departure</button>
      </div>
      {kind === 'orbit' ? (
        <div className="form-grid">
          <Num label="Altitude" value={alt} onChange={setAlt} step={10} unit="km" min={120} max={400000} />
          <Num label="Inclination" value={inc} onChange={setInc} step={0.1} unit="°" min={0} max={180} />
        </div>
      ) : (
        <div className="form-grid">
          <Num label="Excess speed" value={vinf} onChange={setVinf} step={0.05} unit="km/s" min={0} max={30} />
          <label className="num">
            <span className="engraved">Direction</span>
            <select className="input" value={dir} onChange={(e) => setDir(e.target.value as DepartureDirection)}>
              <option value="prograde">Prograde</option><option value="retrograde">Retrograde</option>
              <option value="outward">Outward</option><option value="inward">Inward</option>
            </select>
          </label>
        </div>
      )}
      <div className="keys-row">
        <button className="key run" aria-pressed={false} onClick={launch} disabled={!!launchProblem}>Launch</button>
        <span className="hint">{launchProblem ? `Needs ${launchProblem}` : kind === 'orbit' ? 'circular, from the ascending node' : 'from a 200 km parking orbit'}</span>
      </div>
    </div>
  );
}
