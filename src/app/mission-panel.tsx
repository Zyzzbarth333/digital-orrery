// src/app/mission-panel.tsx
//
// The MISSION tab: launch a craft, read out its state, plan manoeuvre nodes,
// fire the engine, and read its log. States come from the n-body kernel
// (tag "kernel"); orbital elements are the osculating two-body elements
// about the craft's primary (dashed tag "2-body": worked out here).

import { useState } from 'react';
import type { SimClock } from './clock';
import { useClock } from './clock';
import { useMission, REAL_MISSIONS, altitudeRadius, type Mission, type DepartureDirection, type RealBurns } from './mission';
import { BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { kernelSeconds, kernelMs } from '../physics/kernelHost.js';
import { heightAbove } from '../physics/entry.js';

const DEG = 180 / Math.PI;
const fmt = (n: number, d = 1) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDuration = (ms: number) => {
  const m = Math.round(ms / 60e3);
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${(m / 1440).toFixed(1)} d`;
};
const utc = (tKernel: number) => new Date(kernelMs(tKernel)).toISOString().slice(0, 19).replace('T', ' ');

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
  const [realId, setRealId] = useState(REAL_MISSIONS[0].id), [realBurns, setRealBurns] = useState<RealBurns>('all');
  const [realState, setRealState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const c = mission.selected;
  const ascent = mission.ascentReadout(s.timeMs);
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

  // A real mission: the clock goes to its start (BACK undoes that), then
  // the craft starts from its flown state with its burns scripted.
  const flyReal = async () => {
    setRealState({ busy: true, error: null });
    try {
      const m = await mission.fetchReal(realId);
      clock.setTime(m.startMs);
      const craft = mission.flyReal(m, realBurns);
      onFocusCraft(craft.id);
      setRealState({ busy: false, error: null });
    } catch (err) {
      setRealState({ busy: false, error: String(err) });
    }
  };

  let readout: React.ReactNode = null;
  if (c) {
    const el = c.elements();
    const P = el.about === 'sun' ? null : BODY_BY_KEY[el.about as BodyKey];
    const R = P ? altitudeRadius(P.key, P.radiusKm) : 0;
    const altNote = P?.key === 'earth' ? ', above the equatorial radius (6,378.137 km, WGS-84), as in the ROCKET tab' : P ? ', above the mean radius' : '';
    const st = c.displayState();
    const rel = mission.relative(c);
    // The player's fuel against the mass now (a real mission's own burns
    // have drawn the dry mass down).
    const dvLeft = c.ve * Math.log(c.mass / (c.mass - c.fuel));
    const rows: [string, React.ReactNode, React.ReactNode][] = [
      ['Motion', 'Integrated', <Tag src="kernel" detail="stepped under the gravity of the Sun, planets and Moon (n-body), not on a fixed track like the planets" />],
      ['About', P ? P.name : 'Sun', <Tag src="kernel" detail="the body whose sphere of influence holds the craft" />],
      [P ? 'Altitude' : 'From the Sun', `${fmt((rel.r - R), 1)} km`, <Tag src="kernel" detail={`n-body state (Encke near a planet, Cowell elsewhere) carried to the clock${altNote}`} />],
      ['Speed', `${fmt(rel.v, 4)} km/s`, <Tag src="kernel" detail={`relative to ${P ? P.name : 'the Sun'}`} />],
    ];
    const site = c.crashed ? c.impactSite : null;
    // Entry (a crew module with its guidance): the bank the guidance flies
    // and the chutes, by height above the ellipsoid.
    if (c.entry && !c.crashed && P?.key === 'earth') {
      const E = mission.sys.bodiesAt(c.clockT).find((b: { key: string }) => b.key === 'earth') as unknown as { eph: { position: (t: number) => number[] }; pole?: number[] };
      const h = heightAbove(st.r.map((x: number, i: number) => x - E.eph.position(c.clockT)[i]), E.pole ?? [0, 0, 1]);
      const g = c.entryState as { sign: number; sigma: number; held: boolean } | null;
      const ch = (c.entry as { chutes?: { drogue: { height: number }; main: { height: number } } }).chutes;
      const chutes = !ch || h > ch.drogue.height ? 'stowed' : h > ch.main.height ? 'drogues open' : 'mains open';
      rows.splice(4, 0,
        ['Bank', g ? `${fmt(g.sign * g.sigma * DEG, 1)}°${g.held ? ', held' : ''}` : '—', <Tag src="guidance" detail="the lift's roll about the air-relative velocity, positive to the left; the size sets the range, the sign steers (entry.js, a predictor-corrector)" />],
        ['Parachutes', `${chutes} (${fmt(h, 1)} km)`, <Tag src="model" detail={ch ? `drogues below ${fmt(ch.drogue.height, 1)} km, mains below ${fmt(ch.main.height, 1)} km, above the WGS-84 ellipsoid` : ''} />]);
    }
    if (site) {
      // Down: where and when, not an orbit (it lies on the ground, turning
      // with the body).
      const [x, y, z] = site.local, lat = Math.atan2(z, Math.hypot(x, y)) * DEG, lon = Math.atan2(y, x) * DEG;
      rows.splice(2, 2,
        ['Came down', utc(site.t), <Tag src="kernel" detail={`below the surface of ${BODY_BY_KEY[site.key as BodyKey]?.name ?? site.key}${site.key === 'earth' ? ' (sea level, the WGS-84 ellipsoid)' : ''} at the end of a kernel step`} />],
        ['Where', `${fmt(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'W'}`, <Tag src="kernel" derived detail="geocentric latitude and longitude in the body's own frame; it stays there, turning with the body" />]);
    } else if (el.e < 1) {
      rows.push(['Periapsis', `${fmt(el.a * (1 - el.e) - R, 1)} km`, <Tag src="2-body" derived detail={`osculating, about ${P ? P.name : 'the Sun'}${altNote}`} />]);
      rows.push(['Apoapsis', `${fmt(el.a * (1 + el.e) - R, 1)} km`, <Tag src="2-body" derived detail={`osculating${altNote}`} />]);
      rows.push(['Period', `${fmt((2 * Math.PI * Math.sqrt(el.a ** 3 / (P ? P.gm ?? 1 : mission.sys.muSun))) / 60, 2)} min`, <Tag src="2-body" derived detail="osculating" />]);
    } else if (!site) {
      rows.push(['Excess speed', `${fmt(Math.sqrt(-(P ? P.gm ?? 1 : mission.sys.muSun) / el.a), 4)} km/s`, <Tag src="2-body" derived detail="v-infinity of the osculating hyperbola" />]);
    }
    if (!site) {
      rows.push(['Eccentricity', fmt(el.e, 6), <Tag src="2-body" derived detail="osculating" />]);
      rows.push(['Inclination', `${fmt(el.i * DEG, 3)}°`, <Tag src="2-body" derived detail={`to the ${el.frame}`} />]);
    }
    const run = mission.realRun(c);
    // The model engine's tank means nothing when every burn is the real
    // craft's, scripted from its data.
    if (run?.burns !== 'all') {
      rows.push(['Propellant', `${fmt(c.fuel, 2)} kg`, <Tag src="model" derived detail={`one tank; dry mass ${c.dryMass} kg, ${c.thrust} N at Isp ${c.isp} s`} />]);
      rows.push(['Δv left', `${fmt(dvLeft, 1)} m/s`, <Tag src="rocket eq." derived detail="ve ln(m / (m − fuel)): the fuel left, against the mass now" />]);
    }
    if (run) {
      const d = mission.distanceFromFlown(c);
      rows.push(['From the flown path', d === null ? 'outside the data' : `${fmt(d, 1)} km`, <Tag src="BET" detail="distance from where the real craft was at this time: JSC's reconstructed trajectory (BET revF), interpolated" />]);
      const nb = run.m.burnAt(s.timeMs);
      const inBurns = run.burns === 'all' || nb?.burn === run.m.burns[0];
      rows.push(['Next burn', !nb ? 'none left' : nb.on ? `${nb.burn.name}, burning` : `${nb.burn.name} in ${fmtDuration(nb.inMs ?? 0)}${inBurns ? '' : ' (yours to fly)'}`, <Tag src="BET" detail={nb ? `${fmt(nb.burn.mps * 1000 / 304.8, 1)} ft/s (${fmt(nb.burn.mps, 3)} m/s) as flown${nb.burn.nasa ? `; NASA: ${nb.burn.nasa}` : ''}` : 'every burn of the mission is done'} />]);
    }
    const plan = mission.plan(c);
    if (plan) rows.push([`Closest to ${plan.name}`, `${fmt(plan.closest / 1000, 0)} thousand km`, <Tag src="kernel" derived detail={`so far; planned arrival ${new Date(plan.arrivalMs).toISOString().slice(0, 10)}`} />]);
    const state = c.splashed ? 'Splashdown' : c.crashed ? `Impact: ${c.impactBody}` : c.error ? `Error: ${c.error}` : c.lagSeconds > 60 ? `Behind the clock by ${fmt(c.lagSeconds / 60, 1)} min` : 'Stepping';
    readout = (
      <>
        <table className="readout"><tbody>
          {rows.map(([k, v, t]) => <tr key={k}><th scope="row">{k}</th><td className="value">{v}</td><td className="src">{t}</td></tr>)}
        </tbody></table>
        <p className={`status${c.crashed || c.error ? ' bad' : c.lagSeconds > 60 ? ' lag' : ''}`}>{state}</p>
        <ul className="legend">
          <li><i className="sw conic" />Amber: the orbit it would follow if only {P ? P.name : 'the Sun'} pulled on it (the osculating orbit)</li>
          <li><i className="sw trail" />Glowing: the path it has flown, brightest at the craft</li>
          {run && <li><i className="sw flown" />Green: the path the real {run.m.name.replace(/ plan$/, '')} flew{run.plan ? '; amber and the glow are our own plan' : ''}</li>}
        </ul>

        {run && !run.plan && (
          <details className="section" open>
          <summary className="strip">Tracking</summary>
          <label className="num">
            <span className="engraved">Fix</span>
            <select className="input select" value={run.fixHours ?? 0} onChange={(e) => mission.setFixHours(c, Number(e.target.value) || null)}>
              <option value={0}>None: free flight</option>
              {[24, 12, 6, 3].map((h) => <option key={h} value={h}>Every {h} h</option>)}
            </select>
          </label>
          <p className="hint">A fix puts the craft back where tracking says the real one was, as a navigation team would. {run.fixes > 0 ? `${run.fixes} so far.` : ''}</p>
          {run.burns === 'all' && (
            <>
              <label className="num">
                <span className="engraved">Corrections</span>
                <select className="input select" value={run.aimed ? 'aimed' : 'flown'} onChange={(e) => mission.setAimed(c, e.target.value === 'aimed')}>
                  <option value="aimed">Aimed from the craft</option>
                  <option value="flown">As flown, blind</option>
                </select>
              </label>
              <p className="hint">{run.aimed
                ? `Each correction after the injection burn is worked out from where this craft is, as NASA's were from where Orion was, and added to the burn as flown${run.aimedDv > 0 ? `: ${fmt(run.aimedDv, 2)} m/s so far` : ''}.`
                : 'The corrections are flown exactly as Orion flew them, without regard to where this craft is. The lunar flyby magnifies small differences, so it ends thousands of kilometres off without fixes.'}</p>
            </>
          )}
          </details>
        )}

        <details className="section" open>
        <summary className="strip">Engine</summary>
        <p className="status">{c.engineOn || c.executing ? `Burning: ${fmt(c.thrust, 0)} N, ${fmt(c.fuel, 1)} kg left` : run && c.thrusting() ? (() => { const b = run.m.burnAt(s.timeMs); return b?.on ? `Scripted burn as flown: ${b.burn.name}` : `Small thrust as flown${b ? `, before ${b.burn.name}` : ''}`; })() : c.fuel > 0 ? `Off · ${fmt(c.thrust, 0)} N available` : 'Off · tank empty'}</p>
        <div className="keys-row wrap">
          <button className="key" onClick={() => c.setEngine(st.v.map((x: number, i: number) => x - mission.primaryVelocity(c)[i]))}>Prograde</button>
          <button className="key" onClick={() => c.setEngine(st.v.map((x: number, i: number) => -(x - mission.primaryVelocity(c)[i])))}>Retrograde</button>
          <button className="key" onClick={() => c.setEngine(null)} disabled={!c.engineOn} title={c.engineOn ? 'Cut the engine' : 'The engine is not burning'}>Cut</button>
        </div>
        </details>

        <details className="section" open>
        <summary className="strip">Manoeuvre node</summary>
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

        </details>
        <details className="section">
        <summary className="strip">Log ({c.log.length})</summary>
        <ol className="log">
          {c.log.slice(-6).reverse().map((e: { t: number; text: string }, i: number) => <li key={i}><time>{utc(e.t).slice(5)}</time> {e.text}</li>)}
          {c.log.length === 0 && <li className="hint">Nothing yet.</li>}
        </ol>
        </details>
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
      {ascent && (
        <table className="readout" aria-live="off"><tbody>
          <tr><th scope="row">Climbing</th><td className="value">{ascent.name}<span className="alt">{ascent.t < 0 ? `liftoff in ${Math.ceil(-ascent.t)} s` : `T+${Math.floor(ascent.t / 60)}:${String(Math.floor(ascent.t % 60)).padStart(2, '0')} · ${ascent.h.toFixed(1)} km up · ${ascent.v.toFixed(3)} km/s`}; in orbit at engine cutoff</span></td><td className="src"><span className="src-tag" title="the ascent flown in the ROCKET tab, a gravity turn in the launch plane">ascent</span></td></tr>
        </tbody></table>
      )}
      {readout}
      <details className="section" open={!c && !ascent}>
      <summary className="strip">Real missions</summary>
      <div className="form-grid">
        <label className="num">
          <span className="engraved">Mission</span>
          <select className="input select" value={realId} onChange={(e) => setRealId(e.target.value)}>
            {REAL_MISSIONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <label className="num">
          <span className="engraved">Burns</span>
          <select className="input select" value={realBurns} onChange={(e) => setRealBurns(e.target.value as RealBurns)}>
            <option value="all">All, as flown</option>
            <option value="first">The first; correct it yourself</option>
          </select>
        </label>
      </div>
      <div className="keys-row">
        <button className="key primary" onClick={flyReal} disabled={realState.busy}>Fly it</button>
        <span className="hint">{realState.error ? `Could not load: ${realState.error}` : realState.busy ? 'Loading…' : 'Sets the clock to the mission start (BACK undoes it)'}</span>
      </div>
      </details>

      <details className="section" open={!c}>
      <summary className="strip">Launch from Earth</summary>
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
            <select className="input select" value={dir} onChange={(e) => setDir(e.target.value as DepartureDirection)}>
              <option value="prograde">Prograde</option><option value="retrograde">Retrograde</option>
              <option value="outward">Outward</option><option value="inward">Inward</option>
            </select>
          </label>
        </div>
      )}
      <div className="keys-row">
        <button className="key primary" onClick={launch} disabled={!!launchProblem}>Launch</button>
        <span className="hint">{launchProblem ? `Needs ${launchProblem}` : kind === 'orbit' ? 'circular, from the ascending node' : 'from a 200 km parking orbit'}</span>
      </div>
      </details>
    </div>
  );
}
