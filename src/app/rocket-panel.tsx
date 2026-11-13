// src/app/rocket-panel.tsx
//
// The ROCKET tab: build a launch vehicle stage by stage, see what it can
// do, size it for a job (an orbit, the Moon, or the window picked in the
// PLANNER), and fly it from a pad into the simulation
// (docs/frontend/rocket.md). The physics is src/physics/rocket.js, after
// Curtis, Orbital Mechanics for Engineering Students, chapter 13.

import { useMemo, useState } from 'react';
import type { SimClock } from './clock';
import type { Mission } from './mission';
import {
  stackPerformance, optimalStaging, levelAscent, ascentToState, ascentTrack, launchAzimuth, rotationBonus, realAtmosphere,
  deltaVToOrbit, deltaVDeparture, deltaVToApoapsis, circularSpeed, EARTH, G0,
} from '../physics/rocket.js';
import { bodyAxesEqj } from '../physics/orientation.js';
import { rvToElements } from '../physics/orbital.js';

interface StageRow { name: string; dry: number; prop: number; isp: number; ispSl: number; thrust: number }   // t, t, s, s, kN
interface Preset { label: string; payload: number; diameter: number; cd: number; stages: StageRow[] }

// Two presets: a generic two-stage launcher sized for 22 t to low orbit
// (not any real rocket), and the single stage of Curtis's Example 13.3,
// which the tests check the ascent against.
const PRESETS: Preset[] = [
  { label: 'Two-stage example', payload: 22, diameter: 3.7, cd: 0.3, stages: [
    { name: 'First stage', dry: 22, prop: 400, isp: 311, ispSl: 282, thrust: 7600 },
    { name: 'Second stage', dry: 4, prop: 92, isp: 348, ispSl: 348, thrust: 980 },
  ] },
  { label: 'Textbook single stage (Curtis Ex. 13.3)', payload: 0, diameter: 5, cd: 0.5, stages: [
    { name: 'Stage', dry: 68 / 7, prop: 68 * 6 / 7, isp: 390, ispSl: 390, thrust: 933.913 },
  ] },
];

// Launch sites: approximate public coordinates (degrees).
const PADS = [
  { key: 'ksc', name: 'Kennedy LC-39B, Florida', lat: 28.627, lon: -80.621 },
  { key: 'vsfb', name: 'Vandenberg SLC-4E, California', lat: 34.632, lon: -120.611 },
  { key: 'kourou', name: 'Kourou ELA-3, French Guiana', lat: 5.239, lon: -52.768 },
  { key: 'baikonur', name: 'Baikonur Site 1, Kazakhstan', lat: 45.920, lon: 63.342 },
  { key: 'mahia', name: 'Mahia LC-1, New Zealand', lat: -39.262, lon: 177.865 },
];

type Job = 'orbit' | 'gto' | 'moon' | 'planner';
const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');

// The design survives switching tabs (the panel unmounts): kept here for
// the session.
const saved: Record<string, unknown> = {};
function useSaved<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(key in saved ? (saved[key] as T) : initial);
  return [v, (x: T) => { saved[key] = x; setV(x); }];
}

export function RocketPanel({ clock, mission, onFlown }: { clock: SimClock; mission: Mission; onFlown: (id: number) => void }) {
  const [preset, setPreset] = useSaved('preset', 0);
  const [stages, setStages] = useSaved<StageRow[]>('stages', PRESETS[0].stages);
  const [payload, setPayload] = useSaved('payload', PRESETS[0].payload);
  const [diameter, setDiameter] = useSaved('diameter', PRESETS[0].diameter);
  const [cd, setCd] = useSaved('cd', PRESETS[0].cd);
  const [job, setJob] = useSaved<Job>('job', 'orbit');
  const [alt, setAlt] = useSaved('alt', 200);
  const [inc, setInc] = useSaved('inc', 51.6);
  const [pad, setPad] = useSaved('pad', PADS[0].key);
  const [pitchAlt, setPitchAlt] = useSaved('pitchAlt', 500);
  const [losses, setLosses] = useSaved<number | null>('losses', null);    // m/s, from the last ascent flown
  const [flight, setFlight] = useState<ReturnType<typeof flyAscent> | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const usePreset = (i: number) => {
    const p = PRESETS[i];
    setPreset(i); setStages(p.stages); setPayload(p.payload); setDiameter(p.diameter); setCd(p.cd); setFlight(null); setLosses(null); setNote(null);
  };
  const edit = (i: number, k: keyof StageRow, v: string | number) => {
    setStages(stages.map((s, j) => (j === i ? { ...s, [k]: k === 'name' ? v : Number(v) } : s)));
    setFlight(null);
  };
  const addStage = () => setStages([...stages, { name: `Stage ${stages.length + 1}`, dry: 2, prop: 20, isp: 340, ispSl: 340, thrust: 200 }]);
  const removeStage = (i: number) => setStages(stages.filter((_, j) => j !== i));

  // The stack in SI units, and whether every number makes sense.
  const si = useMemo(() => stages.map((s) => ({ name: s.name, dry: s.dry * 1000, prop: s.prop * 1000, isp: s.isp, ispSl: s.ispSl, thrust: s.thrust * 1000 })), [stages]);
  const bad = stages.some((s) => !(s.dry > 0 && s.prop > 0 && s.isp > 0 && s.ispSl > 0 && s.thrust > 0)) || !(payload >= 0) || !(diameter > 0) || !(cd > 0) || !stages.length;
  const perf = useMemo(() => (bad ? null : stackPerformance(si, payload * 1000)), [si, payload, bad]);

  // The job: delta-v to a parking orbit (or the orbit itself) from the pad,
  // and on from there.
  const P = PADS.find((p) => p.key === pad)!;
  const az = launchAzimuth(inc, P.lat);
  const win = mission.lastWindow;
  const parkAlt = job === 'orbit' ? alt : 200;
  const toOrbit = az === null ? null : deltaVToOrbit({ h: parkAlt * 1000, lat: P.lat, az, losses: losses ?? 1500 });
  const onward = job === 'orbit' ? 0 : job === 'gto' ? deltaVToApoapsis({ h: 200e3, apo: 35786e3 })
    : job === 'moon' ? deltaVDeparture({ h: 200e3, c3: -2 }) : win ? deltaVDeparture({ h: 200e3, c3: win.c3 }) : null;
  const needed = toOrbit !== null && onward !== null ? toOrbit + onward : null;
  const margin = perf && needed !== null ? perf.dv - needed : null;

  // The lightest stack of these stages for the job: Curtis 13.6, keeping
  // each stage's Isp, its structural ratio and its thrust-to-weight.
  const size = () => {
    if (needed === null || !perf) return;
    const o = optimalStaging({ dv: needed, payload: payload * 1000, stages: si.map((s) => ({ isp: s.isp, eps: s.dry / (s.dry + s.prop) })) });
    if (!o) { setNote(`No stack of these stages reaches ${fmt(needed / 1000, 2)} km/s: raise the Isp, lighten the structure, or add a stage.`); return; }
    setStages(stages.map((s, i) => {
      const twr = perf.stages[i].twr;
      return { ...s, dry: o.empty[i] / 1000, prop: o.prop[i] / 1000, thrust: twr * G0 * (o.step.slice(i).reduce((a, b) => a + b, 0) + payload * 1000) / 1000 };
    }));
    setFlight(null);
    setNote(`Sized for ${fmt(needed / 1000, 3)} km/s: ${fmt(o.m0 / 1000, 1)} t at liftoff, payload fraction ${fmt(o.payloadFraction * 100, 2)} %. Thrust scaled to keep each stage's thrust-to-weight.`);
  };

  function flyAscent() {
    if (bad || az === null) return null;
    const liftoff = clock.snapshot.timeMs;
    const res = levelAscent({ stages: si, payload: payload * 1000, pitchAlt, cd, diameter, rotation: rotationBonus(P.lat, az), mu: EARTH.mu, R: EARTH.R, dt: 0.1, sample: 2, toOrbit: true, atmosphere: realAtmosphere({ ms: liftoff, lat: P.lat, lon: P.lon }) });
    return res ? { res, az, pad: P, liftoffMs: clock.snapshot.timeMs } : { res: null, az, pad: P, liftoffMs: clock.snapshot.timeMs };
  }
  const fly = () => {
    const f = flyAscent();
    setFlight(f);
    if (f?.res) setLosses(f.res.losses.gravity + f.res.losses.drag);
    setNote(f && !f.res ? 'No pitch kick ends the climb level: the stack is too weak to reach orbit on a gravity turn, or so strong it overshoots. Resize it or change the payload.' : null);
  };
  // The end of the ascent as an orbit, and putting it in the simulation.
  const orbit = useMemo(() => {
    if (!flight?.res) return null;
    const axes = bodyAxesEqj('earth', new Date(flight.liftoffMs));
    const s = ascentToState(flight.res, { lat: flight.pad.lat, lon: flight.pad.lon, az: flight.az, earthFixedAtLiftoff: axes });
    const el = rvToElements(s.r, s.v, EARTH.mu / 1e9);
    const a = el.a, e = el.e;
    return { s, peri: a * (1 - e) - EARTH.R / 1000, apo: e < 1 ? a * (1 + e) - EARTH.R / 1000 : Infinity, inc: el.i * 180 / Math.PI };
  }, [flight]);
  // The craft that reaches orbit: the payload, the stage that was burning at
  // cutoff (with what propellant it kept) and any stages above it. Its
  // engine is that stage's, so the next burns (a departure, say) are flown
  // with it from the MISSION tab.
  const reached = () => {
    const res = flight!.res!;
    const k = res.remaining ? res.remaining.stage : si.length - 1;
    const left = res.remaining ? res.remaining.prop : 0;
    const fuel = left + si.slice(k + 1).reduce((a, x) => a + x.prop, 0);
    const dryMass = payload * 1000 + si.slice(k).reduce((a, x) => a + x.dry, 0);
    return { name: `${PRESETS[preset].label.split(' (')[0]} from ${flight!.pad.name.split(',')[0]}`, props: { dryMass, fuel, area: Math.PI * diameter * diameter / 4, thrust: si[k].thrust, isp: si[k].isp } };
  };
  const insert = () => {
    if (!flight?.res || !orbit) return;
    const t = flight.liftoffMs + flight.res.burnout.t * 1000;
    clock.setTime(t);
    const { name, props } = reached();
    const c = mission.launchState(t, orbit.s.r, orbit.s.v, name, props);
    c.note(`launched ${iso(flight.liftoffMs)} UTC from ${flight.pad.name}, azimuth ${fmt(flight.az, 1)} deg; in orbit ${fmt(flight.res.burnout.t, 0)} s later`, c.kState.t);
    onFlown(c.id);
  };
  // The same launch watched from the pad: the clock goes back to liftoff
  // and runs at 10 s a second, the craft climbs along the ascent in the
  // scene, and at cutoff it flies on as above.
  const launch = () => {
    if (!flight?.res || !orbit) return;
    const axes = bodyAxesEqj('earth', new Date(flight.liftoffMs));
    const track = ascentTrack(flight.res, { lat: flight.pad.lat, lon: flight.pad.lon, az: flight.az, earthFixedAtLiftoff: axes });
    const { name, props } = reached();
    clock.setTime(flight.liftoffMs - 10e3);
    clock.setRate(10);
    clock.setPlaying(true);
    const c = mission.launchAscent(flight.liftoffMs, track, name, props);
    c.note(`launched ${iso(flight.liftoffMs)} UTC from ${flight.pad.name}, azimuth ${fmt(flight.az, 1)} deg; in orbit ${fmt(flight.res.burnout.t, 0)} s later`, c.kState.t);
    onFlown(c.id);
  };

  return (
    <div className="tab-body rocket">
      <details className="section" open>
        <summary className="strip">Vehicle</summary>
        <div className="form-grid">
          <label className="num wide"><span className="engraved">Start from</span>
            <select className="input" value={preset} onChange={(e) => usePreset(Number(e.target.value))}>
              {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
          </label>
          <label className="num"><span className="engraved">Payload</span>
            <input className="input" type="number" min={0} step={0.1} aria-invalid={!(payload >= 0)} value={payload} onChange={(e) => { setPayload(Number(e.target.value)); setFlight(null); }} /><span className="unit">t</span>
          </label>
          <label className="num"><span className="engraved">Diameter</span>
            <input className="input" type="number" min={0.1} step={0.1} aria-invalid={!(diameter > 0)} value={diameter} onChange={(e) => { setDiameter(Number(e.target.value)); setFlight(null); }} /><span className="unit">m</span>
          </label>
          <label className="num"><span className="engraved" title="drag coefficient, held constant">Drag coeff.</span>
            <input className="input" type="number" min={0.05} step={0.05} aria-invalid={!(cd > 0)} value={cd} onChange={(e) => { setCd(Number(e.target.value)); setFlight(null); }} />
          </label>
        </div>
        {stages.map((s, i) => (
          <fieldset className="stage" key={i}>
            <div className="stage-head">
              <input className="input" aria-label={`stage ${i + 1} name`} value={s.name} onChange={(e) => edit(i, 'name', e.target.value)} />
              <button className="key small" aria-label={`remove ${s.name}`} disabled={stages.length < 2} onClick={() => removeStage(i)}>Remove</button>
            </div>
            <div className="form-grid">
              {([['dry', 'Dry mass', 't', 'empty: structure, engines, tanks'], ['prop', 'Propellant', 't', ''], ['isp', 'Isp vacuum', 's', 'specific impulse in vacuum'], ['ispSl', 'Isp sea level', 's', 'specific impulse at sea level'], ['thrust', 'Thrust', 'kN', 'vacuum thrust']] as const).map(([k, label, unit, title]) => (
                <label className="num" key={k}><span className="engraved" title={title || undefined}>{label}</span>
                  <input className="input" type="number" min={0} step="any" aria-invalid={!(s[k] > 0)} value={Number(s[k].toPrecision(6))} onChange={(e) => edit(i, k, e.target.value)} /><span className="unit">{unit}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <div className="keys-row">
          <button className="key small" onClick={addStage}>Add stage on top</button>
          <span className="hint">Bottom stage first: it burns first, and each carries everything above it.</span>
        </div>
        {bad && <p className="status bad">Every stage needs a positive dry mass, propellant, both Isps and thrust; the payload can be zero.</p>}
        {perf && (
          <table className="readout"><tbody>
            {perf.stages.map((s: { name: string; dv: number; burn: number; twr: number; m0: number }, i: number) => (
              <tr key={i}><th scope="row">{s.name}</th>
                <td className="value">{fmt(s.dv / 1000, 3)} km/s<span className="alt">{fmt(s.burn, 0)} s burn · T/W {fmt(s.twr, 2)} at {fmt(s.m0 / 1000, 1)} t</span></td>
                <td className="src"><span className="src-tag" title="Tsiolkovsky's rocket equation, vacuum Isp">rocket eq.</span></td></tr>
            ))}
            <tr><th scope="row">Whole stack</th><td className="value">{fmt(perf.dv / 1000, 3)} km/s<span className="alt">{fmt(perf.liftoff / 1000, 1)} t at liftoff · payload {fmt(payload / (perf.liftoff / 1000) * 100, 2)} %</span></td><td className="src"><span className="src-tag derived" title="sum of the stages, before gravity and drag losses">ideal</span></td></tr>
          </tbody></table>
        )}
        {perf && perf.stages[0].twr < 1.15 && <p className="status bad">Thrust-to-weight at liftoff is {fmt(perf.stages[0].twr, 2)}: below about 1.2 the rocket barely leaves the pad and gravity eats the propellant.</p>}
      </details>

      <details className="section" open>
        <summary className="strip">The job</summary>
        <div className="keys-row wrap" role="radiogroup" aria-label="Job">
          {([['orbit', 'Orbit'], ['gto', 'Geostationary transfer'], ['moon', 'The Moon'], ['planner', 'Planner window']] as const).map(([k, label]) => (
            <button key={k} className="key small" role="radio" aria-checked={job === k} onClick={() => setJob(k)}>{label}</button>
          ))}
        </div>
        <div className="form-grid">
          <label className="num wide"><span className="engraved">Pad</span>
            <select className="input" value={pad} onChange={(e) => { setPad(e.target.value); setFlight(null); }}>
              {PADS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          {job === 'orbit' && (
            <label className="num"><span className="engraved">Altitude</span>
              <input className="input" type="number" min={150} step={10} aria-invalid={!(alt >= 150)} value={alt} onChange={(e) => setAlt(Number(e.target.value))} /><span className="unit">km</span>
            </label>
          )}
          <label className="num"><span className="engraved">Inclination</span>
            <input className="input" type="number" min={0} max={180} step={0.1} aria-invalid={az === null} value={inc} onChange={(e) => { setInc(Number(e.target.value)); setFlight(null); }} /><span className="unit">°</span>
          </label>
        </div>
        {az === null && <p className="status bad">An orbit inclined {fmt(inc, 1)}° can't be reached directly from {fmt(Math.abs(P.lat), 1)}° latitude: the inclination must be at least the pad's latitude.</p>}
        {job === 'planner' && !win && <p className="status">Pick a cell in the PLANNER's porkchop first: its launch energy (C3) sets the departure burn.</p>}
        {needed !== null && toOrbit !== null && onward !== null && (
          <table className="readout"><tbody>
            <tr><th scope="row">To orbit</th><td className="value">{fmt(toOrbit / 1000, 3)} km/s<span className="alt">{fmt(circularSpeed(parkAlt * 1000) / 1000, 3)} circular at {parkAlt} km − {fmt(rotationBonus(P.lat, az!) / 1000, 3)} Earth's rotation + {fmt((losses ?? 1500) / 1000, 3)} losses</span></td><td className="src"><span className={`src-tag${losses === null ? ' derived' : ''}`} title={losses === null ? 'losses assumed: 1.5 km/s, typical; fly the ascent for this stack\'s own' : 'losses from the ascent you flew'}>{losses === null ? 'assumed' : 'flown'}</span></td></tr>
            {job !== 'orbit' && <tr><th scope="row">Onward</th><td className="value">{fmt(onward / 1000, 3)} km/s<span className="alt">{job === 'gto' ? 'Hohmann burn from 200 km to 35,786 km' : job === 'moon' ? 'from 200 km to the Moon (C3 about −2 km²/s²)' : `to ${win!.name}, C3 ${fmt(win!.c3, 2)} km²/s², departing ${iso(win!.depMs).slice(0, 10)}`}</span></td><td className="src"><span className="src-tag" title="from a 200 km circular parking orbit">2-body</span></td></tr>}
            <tr><th scope="row">Needed</th><td className="value">{fmt(needed / 1000, 3)} km/s{margin !== null && <span className={`alt ${margin < 0 ? 'short' : ''}`}>{margin >= 0 ? `the stack has ${fmt(margin / 1000, 3)} km/s to spare` : `the stack is ${fmt(-margin / 1000, 3)} km/s short`}</span>}</td><td className="src" /></tr>
          </tbody></table>
        )}
        <div className="keys-row">
          <button className="key" onClick={size} disabled={needed === null || !perf}>Size the stack for this job</button>
          <span className="hint">The lightest stack of these stages (Curtis 13.6)</span>
        </div>
        {note && <p className="status">{note}</p>}
      </details>

      <details className="section" open>
        <summary className="strip">Launch</summary>
        <div className="form-grid">
          <label className="num"><span className="engraved" title="height of the pitchover, after a vertical climb">Pitchover at</span>
            <input className="input" type="number" min={50} step={50} aria-invalid={!(pitchAlt >= 50)} value={pitchAlt} onChange={(e) => { setPitchAlt(Number(e.target.value)); setFlight(null); }} /><span className="unit">m</span>
          </label>
          <p className="hint">Lifts off at the clock, {iso(clock.snapshot.timeMs)} UTC, azimuth {az === null ? '—' : `${fmt(az, 1)}°`}</p>
        </div>
        <div className="keys-row">
          <button className="key" onClick={fly} disabled={bad || az === null}>Fly the ascent</button>
          <span className="hint">A gravity turn, kicked to end level, cutting off at orbital speed</span>
        </div>
        {flight?.res && orbit && (
          <>
            <AscentPlot history={flight.res.history} />
            <table className="readout"><tbody>
              <tr><th scope="row">{flight.res.remaining ? 'At cutoff' : 'At burnout'}</th><td className="value">{fmt(flight.res.burnout.h / 1000, 1)} km, {fmt(flight.res.burnout.v / 1000, 3)} km/s<span className="alt">{fmt(flight.res.burnout.t, 0)} s after liftoff, {fmt(flight.res.burnout.x / 1000, 0)} km downrange, kick to {fmt(flight.res.gamma0, 3)}°{flight.res.remaining ? ` · ${stages[flight.res.remaining.stage].name} keeps ${fmt(flight.res.remaining.prop / 1000, 1)} t of propellant` : ' · all propellant spent'}</span></td><td className="src"><span className="src-tag" title="gravity turn integrated in the launch plane (Curtis 13.2), rotating atmosphere">ascent</span></td></tr>
              <tr><th scope="row">Orbit</th><td className="value">{Number.isFinite(orbit.apo) ? `${fmt(orbit.peri, 0)} × ${fmt(orbit.apo, 0)} km` : 'escape'}<span className="alt">{fmt(orbit.inc, 2)}° inclined{orbit.peri < 120 ? ' · perigee in the atmosphere: it will come down' : ''}</span></td><td className="src"><span className="src-tag" title="two-body elements of the burnout state">2-body</span></td></tr>
              <tr><th scope="row">Losses</th><td className="value">{fmt((flight.res.losses.gravity + flight.res.losses.drag) / 1000, 3)} km/s<span className="alt">gravity {fmt(flight.res.losses.gravity / 1000, 3)}, drag {fmt(flight.res.losses.drag / 1000, 3)} · max q {fmt(flight.res.maxQ.q / 1000, 1)} kPa at {fmt(flight.res.maxQ.h / 1000, 1)} km</span></td><td className="src"><span className="src-tag" title="Curtis 13.27, integrated along the ascent">ascent</span></td></tr>
            </tbody></table>
            <div className="keys-row">
              <button className="key primary" onClick={launch}>Launch from the pad</button>
              <button className="key" onClick={insert}>Put it in orbit</button>
            </div>
            <p className="hint">Launch from the pad sets the clock to ten seconds before liftoff and runs it at 10 s a second while the craft climbs; Put it in orbit jumps the clock to {flight.res.remaining ? 'cutoff' : 'burnout'} (BACK undoes it). Either way the payload flies on as a craft with {flight.res.remaining ? 'the upper stage\'s engine and its propellant' : 'no propellant'}.</p>
          </>
        )}
      </details>
    </div>
  );
}

// Altitude against downrange distance, to scale on both axes would be a
// flat line, so altitude is stretched; the axes say by how much.
function AscentPlot({ history }: { history: { h: number; x: number }[] }) {
  const W = 300, H = 120;
  const xMax = Math.max(...history.map((p) => p.x)) || 1, hMax = Math.max(...history.map((p) => p.h)) || 1;
  const pts = history.map((p) => `${(p.x / xMax * W).toFixed(1)},${(H - p.h / hMax * H).toFixed(1)}`).join(' ');
  return (
    <figure className="porkchop ascent-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Ascent: altitude up to ${fmt(hMax / 1000, 0)} km over ${fmt(xMax / 1000, 0)} km downrange`}>
        <polyline points={pts} fill="none" />
      </svg>
      <figcaption><span>{fmt(hMax / 1000, 0)} km up</span><span>{fmt(xMax / 1000, 0)} km downrange (altitude stretched ×{fmt(xMax / hMax, 1)})</span></figcaption>
    </figure>
  );
}
