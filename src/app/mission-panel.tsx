// src/app/mission-panel.tsx
//
// The MISSION tab: launch a craft, read out its state, plan manoeuvre nodes,
// fire the engine, and read its log. States come from the n-body kernel
// (tag "kernel"); orbital elements are the osculating two-body elements
// about the craft's primary (dashed tag "2-body": worked out here).

import { sunlightText } from './sunlight';
import { useEffect, useState } from 'react';
import type { SimClock } from './clock';
import { useClock } from './clock';
import { useMission, REAL_MISSIONS, altitudeRadius, type Mission, type DepartureDirection, type RealBurns } from './mission';
import { BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { kernelSeconds, kernelMs } from '../physics/kernelHost.js';
import { heightAbove } from '../physics/entry.js';
import { SourceTag } from './source-tag';
import { usePeek } from './peek';

const DEG = 180 / Math.PI;
const fmt = (n: number, d = 1) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtDuration = (ms: number) => {
  const m = Math.round(ms / 60e3);
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${(m / 1440).toFixed(1)} d`;
};
// The attitude modes (attitude.js), as the keys name them, in the order
// they sit: the orbital directions in pairs, then the node, a hold and off.
const ATT_MODES: [string, string, string][] = [
  ['prograde', 'Prograde', 'Body axis along the velocity'], ['retrograde', 'Retrograde', 'Body axis against the velocity'],
  ['normal', 'Normal', 'Along the orbit normal (r × v)'], ['antinormal', 'Anti-normal', 'Against the orbit normal'],
  ['radial', 'Radial out', 'Outward, square to the velocity in the orbit plane'], ['antiradial', 'Radial in', 'Inward, square to the velocity in the orbit plane'],
  ['node', 'Node', 'Along the next manoeuvre node\'s burn'], ['inertial', 'Hold', 'Hold the attitude it has now, fixed among the stars'], ['off', 'Free', 'Thrusters off: it turns under the gravity gradient and the air alone'],
];
// The hold's limit cycle on each axis (attitude.js limitCycle).
const HOLD_REGIME: Record<string, string> = { drift: 'two-sided', 'two-one': 'two pulses to one', 'one-sided': 'one-sided' };
const ATT_LABEL: Record<string, string> = Object.fromEntries(ATT_MODES.map(([k, l]) => [k, l.toLowerCase()]));

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


// A followed craft's two values for the phone sheet's peek (peek.tsx),
// over the plate's: its altitude (or distance from the Sun) and speed, as
// the readout below gives them.
export function CraftPeek({ clock, mission, id }: { clock: SimClock; mission: Mission; id: number }) {
  useClock(clock);
  const c = mission.crafts.find((x) => x.id === id);
  let rows: Parameters<typeof usePeek>[0] = [];
  if (c) {
    const el = c.elements();
    const P = el.about === 'sun' ? null : BODY_BY_KEY[el.about as BodyKey];
    const R = P ? altitudeRadius(P.key, P.radiusKm) : 0;
    const rel = mission.relative(c);
    rows = [
      { label: P ? 'Altitude' : 'From the Sun', value: fmt(rel.r - R, 1), unit: 'km', src: 'kernel', info: 'altitude' },
      { label: 'Speed', value: fmt(rel.v, 4), unit: 'km/s', src: 'kernel', info: 'craft-speed', detail: `relative to ${P ? P.name : 'the Sun'}` },
    ];
  }
  usePeek(rows, 1);
  return null;
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
  const [sixdof, setSixdof] = useState(mission.sixdof);
  const chooseSixdof = (on: boolean) => { mission.sixdof = on; setSixdof(on); };
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

  // A launch is armed first, then fired, as real panels guard a command that
  // can't be taken back (DESIGN.md, What real panels do): ARM shows what
  // will fly, LAUNCH fires it, DISARM (or Esc, or any change to the form)
  // stands it down. It adds one press and no waiting.
  const [armed, setArmed] = useState(false);
  useEffect(() => { setArmed(false); }, [kind, alt, inc, vinf, dir, sixdof]);
  useEffect(() => {
    if (!armed) return;
    // First Escape disarms; the console stays open (App skips a prevented Escape).
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setArmed(false); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [armed]);
  const nowUtc = new Date(s.timeMs).toISOString().slice(0, 16).replace('T', ' ');
  const flying = `${kind === 'orbit' ? `a circular orbit ${alt.toLocaleString('en-AU')} km up at ${inc}°, from the ascending node` : `a departure at ${vinf} km/s ${dir}, from a 200 km parking orbit`}, ${sixdof ? '6-DOF' : 'as a point mass'}, at ${nowUtc} UTC`;
  const launch = () => {
    if (launchProblem || !armed) return;
    setArmed(false);
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
      ['Motion', 'Integrated', <SourceTag src="kernel" info="kernel-motion" detail="not on a fixed track like the planets" />],
      ['About', P ? P.name : 'Sun', <SourceTag src="kernel" info="soi" />],
      [P ? 'Altitude' : 'From the Sun', `${fmt((rel.r - R), 1)} km`, <SourceTag src="kernel" info="altitude" detail={`n-body state (Encke near a planet, Cowell elsewhere) carried to the clock${altNote}`} />],
      ['Speed', `${fmt(rel.v, 4)} km/s`, <SourceTag src="kernel" info="craft-speed" detail={`relative to ${P ? P.name : 'the Sun'}`} />],
      ['Sunlight', sunlightText(mission.sunlight(c)), <SourceTag src="shadow" derived info="craft-shadow" detail="the kernel's bodies, as its solar pressure takes them" />],
    ];
    // A journey's craft flies the full model; where its aims could not
    // converge there, the planner's model instead, and the row says why.
    if (c.bare) rows.push(['Model', 'Planner\'s (fallback)', <SourceTag src="kernel" info="kernel-motion" detail={`point masses and zonal terms only: no drag, full gravity fields or sunlight, so a low orbit never decays. Its burns were worked out in that model because in the full one ${c.bareWhy ?? 'the aims did not converge'}`} />]);
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
        ['Bank', g ? `${fmt(g.sign * g.sigma * DEG, 1)}°${g.held ? ', held' : ''}` : '—', <SourceTag src="guidance" info="bank" detail="entry.js, a numerical predictor-corrector, every 2 s" />],
        ['Parachutes', `${chutes} (${fmt(h, 1)} km)`, <SourceTag src="model" info="chutes" detail={ch ? `drogues below ${fmt(ch.drogue.height, 1)} km, mains below ${fmt(ch.main.height, 1)} km, above the WGS-84 ellipsoid` : undefined} />]);
    }
    if (site) {
      // Down: where and when, not an orbit (it lies on the ground, turning
      // with the body).
      const [x, y, z] = site.local, lat = Math.atan2(z, Math.hypot(x, y)) * DEG, lon = Math.atan2(y, x) * DEG;
      rows.splice(2, 2,
        ['Came down', utc(site.t), <SourceTag src="kernel" info="impact" detail={`below the surface of ${BODY_BY_KEY[site.key as BodyKey]?.name ?? site.key}${site.key === 'earth' ? ' (sea level, the WGS-84 ellipsoid)' : ''} at the end of a kernel step`} />],
        ['Where', `${fmt(Math.abs(lat), 2)}° ${lat >= 0 ? 'N' : 'S'}, ${fmt(Math.abs(lon), 2)}° ${lon >= 0 ? 'E' : 'W'}`, <SourceTag src="kernel" derived info="lat-lon" detail="it stays there, turning with the body" />]);
    } else if (el.e < 1) {
      rows.push(['Periapsis', `${fmt(el.a * (1 - el.e) - R, 1)} km`, <SourceTag src="2-body" derived info="periapsis" detail={`osculating, about ${P ? P.name : 'the Sun'}${altNote}`} />]);
      rows.push(['Apoapsis', `${fmt(el.a * (1 + el.e) - R, 1)} km`, <SourceTag src="2-body" derived info="apoapsis" detail={`osculating${altNote}`} />]);
      rows.push(['Period', `${fmt((2 * Math.PI * Math.sqrt(el.a ** 3 / (P ? P.gm ?? 1 : mission.sys.muSun))) / 60, 2)} min`, <SourceTag src="2-body" derived info="period" />]);
    } else if (!site) {
      rows.push(['Excess speed', `${fmt(Math.sqrt(-(P ? P.gm ?? 1 : mission.sys.muSun) / el.a), 4)} km/s`, <SourceTag src="2-body" derived info="excess-speed" />]);
    }
    if (!site) {
      rows.push(['Eccentricity', fmt(el.e, 6), <SourceTag src="2-body" derived info="eccentricity" />]);
      rows.push(['Inclination', `${fmt(el.i * DEG, 3)}°`, <SourceTag src="2-body" derived info="inclination" detail={`to the ${el.frame}`} />]);
    }
    const run = mission.realRun(c);
    // The model engine's tank means nothing when every burn is the real
    // craft's, scripted from its data.
    if (run?.burns !== 'all') {
      rows.push(['Propellant', `${fmt(c.fuel, 2)} kg`, <SourceTag src="model" derived info="propellant" detail={`one tank; dry mass ${c.dryMass} kg, ${c.thrust} N at Isp ${c.isp} s`} />]);
      rows.push(['Δv left', `${fmt(dvLeft, 1)} m/s`, <SourceTag src="rocket eq." derived info="dv-left" />]);
    }
    if (run) {
      const d = mission.distanceFromFlown(c);
      rows.push(['From the flown path', d === null ? 'outside the data' : `${fmt(d, 1)} km`, <SourceTag src={run.m.data.sourceTag ?? 'BET'} info="flown-path" detail={run.m.data.source} />]);
      const nb = run.m.burnAt(s.timeMs);
      const inBurns = run.burns === 'all' || nb?.burn === run.m.burns[0];
      rows.push(['Next burn', !nb ? 'none left' : nb.on ? `${nb.burn.name}, burning` : `${nb.burn.name} in ${fmtDuration(nb.inMs ?? 0)}${inBurns ? '' : ' (yours to fly)'}`, <SourceTag src={run.m.data.sourceTag ?? 'BET'} info="next-burn" detail={nb ? `${fmt(nb.burn.mps * 1000 / 304.8, 1)} ft/s (${fmt(nb.burn.mps, 3)} m/s) as flown${nb.burn.nasa ? `; NASA: ${nb.burn.nasa}` : ''}` : 'every burn of the mission is done'} />]);
    }
    const plan = mission.plan(c);
    if (plan) rows.push([`Closest to ${plan.name}`, `${fmt(plan.closest / 1000, 0)} thousand km`, <SourceTag src="kernel" derived info="closest" detail={`planned arrival ${new Date(plan.arrivalMs).toISOString().slice(0, 10)}`} />]);
    const state = c.splashed ? 'Splashdown' : c.crashed ? `Impact: ${c.impactBody}` : c.landed ? `Landed: ${c.landed.key}${c.landed.until !== null ? `, lift off ${utc(c.landed.until)} UTC` : ''}` : c.error ? `Error: ${c.error}` : c.lagSeconds > 60 ? `Behind the clock by ${fmt(c.lagSeconds / 60, 1)} min` : 'Stepping';
    readout = (
      <>
        <table className="readout"><tbody>
          {rows.map(([k, v, t]) => <tr key={k}><th scope="row">{k}</th><td className="value">{v}</td><td className="src">{t}</td></tr>)}
        </tbody></table>
        <p className={`status${c.crashed || c.error ? ' bad' : c.lagSeconds > 60 ? ' lag' : ''}`}>{state}</p>
        <ul className="legend">
          <li><i className="sw conic" />Amber: the orbit it would follow if only {P ? P.name : 'the Sun'} pulled on it (the osculating orbit)</li>
          <li><i className="sw trail" />Glowing: the path it has flown, brightest at the craft</li>
          {run && <li><i className="sw flown" />Green: the path the real {run.m.data.craftModel ? run.m.data.craft : run.m.name.replace(/ plan$/, '')} flew{run.plan ? '; amber and the glow are our own plan' : ''}</li>}
        </ul>

        {run && !run.plan && (
          <details className="section">
          <summary className="strip"><span>Tracking</span><span className="sum-note">{run.fixHours ? `fix every ${run.fixHours} h` : 'free flight'}{run.burns === 'all' ? ` · ${run.aimed ? 'aimed' : 'as flown, blind'}` : ''}</span></summary>
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
                ? `Each burn after the first is worked out from where this craft is, as the navigation team's were from where ${run.m.data.craft?.replace(/ \(.*\)$/, '') ?? 'the craft'} was, and added to the burn as flown${run.aimedDv > 0 ? `: ${fmt(run.aimedDv, 2)} m/s so far` : ''}.`
                : `The burns are flown exactly as ${run.m.data.craft?.replace(/ \(.*\)$/, '') ?? 'the craft'} flew them, without regard to where this craft is. A flyby magnifies small differences, so it ends thousands of kilometres off without fixes.`}</p>
            </>
          )}
          </details>
        )}

        {c.att ? (() => {
          const ro = c.att.readout(), spec = c.att.spec, mode = ro.mode;
          const pointing = mode === 'off' ? 'Free: thrusters off'
            : ro.locked ? `Holding ${ATT_LABEL[mode]}`
              : `Turning to ${ATT_LABEL[mode]}: ${fmt((ro.error ?? 0) * DEG, 1)}° to go`;
          const dist = Math.hypot(...ro.disturbance);
          return (
            <details className="section">
            <summary className="strip"><span>Attitude</span><span className="sum-note">{pointing} · {fmt(ro.rate * DEG, 2)}°/s</span></summary>
            {/* Three opposed pairs, then the modes that aren't a direction. */}
            <div className="att-grid" role="radiogroup" aria-label="Attitude mode">
              {[ATT_MODES.slice(0, 2), ATT_MODES.slice(2, 4), ATT_MODES.slice(4, 6), ATT_MODES.slice(6)].map((group, g) => (
                <div key={g} className={`keys-row att-${g < 3 ? 'pair' : 'modes'}`}>
                  {group.map(([k, label, title]) => (
                    <button key={k} className="key" role="radio" aria-checked={mode === k} title={title} onClick={() => c.att?.setMode(k)}>{label}</button>
                  ))}
                </div>
              ))}
            </div>
            <table className="readout"><tbody>
              <tr><th scope="row">Pointing</th><td className="value">{pointing}</td><td className="src"><SourceTag src="6-DOF" info="attitude" detail={`a sampled controller, ${fmt(spec.torqueMax[1], 0)} N m in pitch and yaw, ${fmt(spec.torqueMax[0], 0)} N m in roll, at most ${fmt(spec.rateMax * DEG, 1)}°/s`} /></td></tr>
              {!ro.locked && mode !== 'off' && ro.turnLeft > 0 && <tr><th scope="row">Turn left</th><td className="value">{fmt(ro.turnLeft, 0)} s</td><td className="src"><SourceTag src="6-DOF" derived info="attitude-turn" detail={`from rest, about the body's pitch axis: ${fmt(ro.alpha * DEG, 2)}°/s² at most`} /></td></tr>}
              <tr><th scope="row">Turning</th><td className="value">{fmt(ro.rate * DEG, 2)}°/s</td><td className="src"><SourceTag src="6-DOF" info="attitude-rate" /></td></tr>
              <tr><th scope="row">Disturbance</th><td className="value">{dist > 0 ? `${dist.toExponential(1)} N m` : 'none'}</td><td className="src"><SourceTag src="6-DOF" info="attitude-torque" detail={ro.locked ? 'held against it: well inside the thrusters\' torque' : undefined} /></td></tr>
              <tr><th scope="row">Thruster fuel</th><td className="value">{ro.rcsSpent < 1 ? `${fmt(ro.rcsSpent * 1000, 1)} g used` : `${fmt(ro.rcsSpent, 2)} kg used`}</td><td className="src"><SourceTag src="6-DOF" derived info="attitude-rcs" detail={`from the engine's tank, ${fmt(c.fuel, 1)} kg left; ${fmt(spec.rcsArm?.[1] ?? 0, 1)} m arms in pitch and yaw, ${fmt(spec.rcsArm?.[0] ?? 0, 1)} m in roll`} /></td></tr>
              {ro.hold && <tr><th scope="row">Holding costs</th><td className="value">{(() => { const d = ro.hold.rate * 86400; return d < 1 ? `${fmt(d * 1000, 0)} g a day` : `${fmt(d, 2)} kg a day`; })()}</td><td className="src"><SourceTag src="6-DOF" derived info="attitude-hold" detail={`a limit cycle within ±${fmt((spec.deadband ?? 0) * DEG, 1)}°, pulses of ${fmt((Array.isArray(spec.impulseBit) ? spec.impulseBit[1] : spec.impulseBit) ?? 0, 2)} N s: ${['pitch', 'yaw', 'roll'].map((n, k) => `${n} ${HOLD_REGIME[ro.hold!.axes[[1, 2, 0][k]].regime]}`).join(', ')}`} /></td></tr>}
              <tr><th scope="row">Inertia</th><td className="value">{fmt(ro.inertia[1][1], 0)} kg m² pitch · {fmt(ro.inertia[0][0], 0)} roll</td><td className="src"><SourceTag src="6-DOF" derived info="attitude-inertia" detail={`with ${fmt(c.fuel, 1)} kg of propellant in the tanks`} /></td></tr>
              {(ro.auto || ro.autoPlan) && <tr><th scope="row">Node turn</th><td className="value">{(() => { const p = ro.autoPlan; return ro.auto || !p ? 'Turned for the node' : p.start > 0 ? `Starts in ${p.start < 120 ? `${fmt(p.start, 0)} s` : fmtDuration(p.start * 1000)}, ${fmt(p.theta * DEG, 0)}° in ${fmt(p.need, 0)} s` : 'Starting'; })()}</td><td className="src"><SourceTag src="6-DOF" derived info="attitude-auto" /></td></tr>}
            </tbody></table>
            <div className="keys-row"><button className="key small att-toggle" aria-pressed={ro.autoNode} onClick={() => c.att?.setAutoNode(!ro.autoNode)} title="Turn to each manoeuvre node by itself, early enough to settle before it fires, then back">Auto node turn</button></div>
            <p className="hint">The engine fires along the craft's body axis, so point it first, or let it turn to each node by itself. A turn takes time: the thrusters' torque is finite, and they burn propellant from the engine's tank.</p>
            </details>
          );
        })() : !c.bare && !run && (
          <details className="section">
          <summary className="strip"><span>Attitude</span><span className="sum-note">a point mass: no turning</span></summary>
          <p className="hint">A point mass: its burns go along the direction you choose, with no turning.</p>
          <div className="keys-row"><button className="key" onClick={() => c.carryAttitude({ mode: 'prograde' })}>Carry attitude</button></div>
          </details>
        )}

        <details className="section" open>
        <summary className="strip"><span>Engine</span><span className="sum-note">{c.engineOn || c.executing ? 'burning' : 'off'} · {fmt(c.fuel, 1)} kg left</span></summary>
        <p className="status">{c.engineOn || c.executing ? `Burning: ${fmt(c.thrust, 0)} N, ${fmt(c.fuel, 1)} kg left` : run && c.thrusting() ? (() => { const b = run.m.burnAt(s.timeMs); return b?.on ? `Scripted burn as flown: ${b.burn.name}` : `Small thrust as flown${b ? `, before ${b.burn.name}` : ''}`; })() : c.fuel > 0 ? `Off · ${fmt(c.thrust, 0)} N available` : 'Off · tank empty'}</p>
        <div className="keys-row wrap">
          {c.att ? (
            <button className="key" onClick={() => c.setEngine(c.bodyAxis)} disabled={c.engineOn || !(c.fuel > 0)} title="Fire along the body axis, wherever it points">Fire</button>
          ) : (<>
          <button className="key" onClick={() => c.setEngine(st.v.map((x: number, i: number) => x - mission.primaryVelocity(c)[i]))}>Prograde</button>
          <button className="key" onClick={() => c.setEngine(st.v.map((x: number, i: number) => -(x - mission.primaryVelocity(c)[i])))}>Retrograde</button>
          </>)}
          <button className="key" onClick={() => c.setEngine(null)} disabled={!c.engineOn} title={c.engineOn ? 'Cut the engine' : 'The engine is not burning'}>Cut</button>
        </div>
        </details>

        <details className="section" open>
        <summary className="strip"><span>Manoeuvre node</span><span className="sum-note">{c.nodes.length ? `${c.nodes.length} planned, next ${utc(c.nodes[0].t).slice(11, 16)} UTC` : 'none planned'}</span></summary>
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
        {(() => {
          // What the scene draws it as close up (craftModels.ts).
          const note = mission.modelNote(c);
          return note && (
            <details className="section">
            <summary className="strip"><span>Close up</span><span className="sum-note">{note.startsWith('Not modelled') ? 'its marker only' : 'a model at its true size'}</span></summary>
            <p className="hint">{note}</p>
            </details>
          );
        })()}
        <details className="section">
        <summary className="strip"><span>Log</span><span className="sum-note">{c.log.length ? `${c.log.length} · ${c.log[c.log.length - 1].text}` : 'nothing yet'}</span></summary>
        <ol className="log">
          {c.log.slice(-6).reverse().map((e: { t: number; text: string }, i: number) => <li key={i}><time>{utc(e.t).slice(5)}</time> {e.text}</li>)}
          {c.log.length === 0 && <li className="hint">Nothing yet.</li>}
        </ol>
        </details>
        <div className="keys-row wrap">
          <button className="key" onClick={() => onFocusCraft(c.id)}>Follow</button>
          <button className="key" onClick={() => mission.remove(c)} title="Removes it at once; the notice at the top restores it">Remove craft</button>
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
          <tr><th scope="row">Climbing</th><td className="value">{ascent.name}<span className="alt">{ascent.t < 0 ? `liftoff in ${Math.ceil(-ascent.t)} s` : `T+${Math.floor(ascent.t / 60)}:${String(Math.floor(ascent.t % 60)).padStart(2, '0')} · ${ascent.h.toFixed(1)} km up · ${ascent.v.toFixed(3)} km/s`}; in orbit at engine cutoff</span></td><td className="src"><SourceTag src="ascent" info="ascent-climb" /></td></tr>
        </tbody></table>
      )}
      {ascent && mission.ascentNote() && <p className="hint">{mission.ascentNote()}</p>}
      {readout}
      <details className="section" open={!c && !ascent}>
      <summary className="strip"><span>Real missions</span><span className="sum-note">{REAL_MISSIONS.find((m) => m.id === realId)?.label ?? ''}</span></summary>
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
      <summary className="strip"><span>Launch from Earth</span><span className="sum-note">{kind === 'orbit' ? `orbit ${alt.toLocaleString('en-AU')} km, ${inc}°` : `departure ${vinf} km/s ${dir}`} · {sixdof ? '6-DOF' : 'point mass'}</span></summary>
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
      <div className="keys-row" role="radiogroup" aria-label="Flown as">
        <button className="key" role="radio" aria-checked={sixdof} onClick={() => chooseSixdof(true)} title="It points and turns, and burns along its body axis">6-DOF</button>
        <button className="key" role="radio" aria-checked={!sixdof} onClick={() => chooseSixdof(false)} title="Burns go along the direction chosen, with no turning">Point mass</button>
      </div>
      <div className="keys-row wrap launch-row">
        <button className="key arm" aria-pressed={armed} onClick={() => setArmed(true)} disabled={!!launchProblem || armed}>{armed ? 'Armed' : 'Arm'}</button>
        <button className="key primary" onClick={launch} disabled={!armed || !!launchProblem}>Launch</button>
        {armed && <button className="key" onClick={() => setArmed(false)}>Disarm</button>}
        <span className="hint" aria-live="polite">{launchProblem ? `Needs ${launchProblem}` : armed ? `Launches ${flying}. Disarm or Esc to stand down.` : `Arm, then launch: ${kind === 'orbit' ? 'a circular orbit, from the ascending node' : 'from a 200 km parking orbit'}.`}</span>
      </div>
      </details>
    </div>
  );
}
