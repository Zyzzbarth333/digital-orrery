// src/app/rocket-panel.tsx
//
// The ROCKET tab: build a launch vehicle stage by stage, see what it can
// do, size it for a job (an orbit, the Moon, or the window picked in the
// PLANNER), and fly it from a pad into the simulation
// (docs/frontend/rocket.md). The physics is src/physics/rocket.js, after
// Curtis, Orbital Mechanics for Engineering Students, chapter 13. It also
// flies OpenRocket designs (.ork files) with the same ascent, beside
// OpenRocket's own result (src/physics/ork.js).

import { useMemo, useRef, useState } from 'react';
import type { SimClock } from './clock';
import type { Mission } from './mission';
import {
  stackPerformance, optimalStaging, levelAscent, ascentToState, ascentTrack, launchAzimuth, rotationBonus, realAtmosphere,
  deltaVToOrbit, deltaVDeparture, deltaVToApoapsis, circularSpeed, surfaceSpeed, EARTH, G0,
} from '../physics/rocket.js';
import { bodyAxesEqj } from '../physics/orientation.js';
import { LAUNCHERS } from '../physics/launchers.js';
import { SourceTag } from './source-tag';
import { rvToElements } from '../physics/orbital.js';
import { orkXml, readOrk, vehicleFromOrk, flyOrk } from '../physics/ork.js';

interface StageRow { name: string; dry: number; prop: number; isp: number; ispSl: number; thrust: number; est?: string[] }   // t, t, s, s, kN
interface Flown { flight: string; frame: 'inertial' | 'surface'; events: { name: string; t: number; h: number; v: number }[]; source: string }
interface Preset {
  label: string; payload: number; diameter: number; cd: number; stages: StageRow[];
  // A real launcher's: where its figures come from, the job it flew, and
  // the flight to set the ascent beside.
  source?: { text: string; url: string }; est?: { cd?: boolean; payload?: boolean }; job?: { pad: string; inc: number; alt: number }; flown?: Flown;
}

// The presets: real launchers from their published figures
// (src/physics/launchers.js), shown greyed until changed; then a generic
// two-stage launcher sized for 22 t to low orbit (not any real rocket), and
// the single stage of Curtis's Example 13.3, which the tests check the
// ascent against.
const PRESETS: Preset[] = [
  ...(LAUNCHERS as Preset[]),
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
  const [preset, setPreset] = useSaved('preset', LAUNCHERS.length);
  // A real launcher's figures are shown greyed, as published, until one is
  // changed: then the design is the user's own.
  const [custom, setCustom] = useSaved('custom', false);
  const [stages, setStages] = useSaved<StageRow[]>('stages', PRESETS[LAUNCHERS.length].stages);
  const [payload, setPayload] = useSaved('payload', PRESETS[LAUNCHERS.length].payload);
  const [diameter, setDiameter] = useSaved('diameter', PRESETS[LAUNCHERS.length].diameter);
  const [cd, setCd] = useSaved('cd', PRESETS[LAUNCHERS.length].cd);
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
    setPreset(i); setCustom(false); setStages(p.stages); setPayload(p.payload); setDiameter(p.diameter); setCd(p.cd); setFlight(null); setLosses(null); setNote(null);
    if (p.job) { setPad(p.job.pad); setInc(p.job.inc); setAlt(p.job.alt); setJob('orbit'); }
  };
  const P0 = PRESETS[preset];
  const published = !!P0.source && !custom;
  const own = () => { if (!custom) setCustom(true); };
  const edit = (i: number, k: keyof StageRow, v: string | number) => {
    setStages(stages.map((s, j) => (j === i ? { ...s, [k]: k === 'name' ? v : Number(v) } : s)));
    setFlight(null); own();
  };
  const addStage = () => { setStages([...stages, { name: `Stage ${stages.length + 1}`, dry: 2, prop: 20, isp: 340, ispSl: 340, thrust: 200 }]); own(); };
  const removeStage = (i: number) => { setStages(stages.filter((_, j) => j !== i)); own(); };
  const inputClass = published ? 'input published' : 'input';
  // A figure the maker doesn't publish: dashed, as the app's worked-out tags are.
  const estClass = (e?: boolean) => (published && e ? 'input published est' : inputClass);
  const estTitle = (e?: boolean) => (published && e ? 'Not published by the maker: an estimate (see the source note)' : undefined);

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
    setFlight(null); own();
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
    return { name: `${custom && P0.source ? 'Custom ' : ''}${P0.label.split(' (')[0]} from ${flight!.pad.name.split(',')[0]}`, props: { dryMass, fuel, area: Math.PI * diameter * diameter / 4, thrust: si[k].thrust, isp: si[k].isp } };
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
              {PRESETS.map((p, i) => <option key={p.label} value={i}>{custom && i === preset ? `Custom, from ${p.label}` : p.label}</option>)}
            </select>
          </label>
          {P0.source && (
            <p className="hint wide preset-src">
              {published
                ? <>Published figures, greyed: <a href={P0.source.url} target="_blank" rel="noreferrer">{P0.source.text}</a>. Change any to make the design your own.</>
                : <>Custom: changed from {P0.label}'s published figures. <button className="key small" onClick={() => usePreset(preset)}>Back to published</button></>}
            </p>
          )}
          <label className="num"><span className="engraved">Payload</span>
            <input className="input" type="number" min={0} step={0.1} aria-invalid={!(payload >= 0)} value={payload} onChange={(e) => { setPayload(Number(e.target.value)); setFlight(null); }} /><span className="unit">t</span>
          </label>
          <label className="num"><span className="engraved">Diameter</span>
            <input className={inputClass} type="number" min={0.1} step={0.1} aria-invalid={!(diameter > 0)} value={diameter} onChange={(e) => { setDiameter(Number(e.target.value)); setFlight(null); own(); }} /><span className="unit">m</span>
          </label>
          <label className="num"><span className="engraved" title="drag coefficient, held constant">Drag coeff.</span>
            <input className={estClass(P0.est?.cd)} title={estTitle(P0.est?.cd)} type="number" min={0.05} step={0.05} aria-invalid={!(cd > 0)} value={cd} onChange={(e) => { setCd(Number(e.target.value)); setFlight(null); own(); }} />
          </label>
        </div>
        {stages.map((s, i) => (
          <fieldset className="stage" key={i}>
            <div className="stage-head">
              <input className={inputClass} aria-label={`stage ${i + 1} name`} value={s.name} onChange={(e) => edit(i, 'name', e.target.value)} />
              <button className="key small" aria-label={`remove ${s.name}`} disabled={stages.length < 2} onClick={() => removeStage(i)}>Remove</button>
            </div>
            <div className="form-grid">
              {([['dry', 'Dry mass', 't', 'empty: structure, engines, tanks'], ['prop', 'Propellant', 't', ''], ['isp', 'Isp vacuum', 's', 'specific impulse in vacuum'], ['ispSl', 'Isp sea level', 's', 'specific impulse at sea level'], ['thrust', 'Thrust', 'kN', 'vacuum thrust']] as const).map(([k, label, unit, title]) => (
                <label className="num" key={k}><span className="engraved" title={title || undefined}>{label}</span>
                  <input className={estClass(s.est?.includes(k))} title={estTitle(s.est?.includes(k))} type="number" min={0} step="any" aria-invalid={!(s[k] > 0)} value={Number(s[k].toPrecision(6))} onChange={(e) => edit(i, k, e.target.value)} /><span className="unit">{unit}</span>
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
                <td className="src"><SourceTag src="rocket eq." info="stage-dv" /></td></tr>
            ))}
            <tr><th scope="row">Whole stack</th><td className="value">{fmt(perf.dv / 1000, 3)} km/s<span className="alt">{fmt(perf.liftoff / 1000, 1)} t at liftoff · payload {fmt(payload / (perf.liftoff / 1000) * 100, 2)} %</span></td><td className="src"><SourceTag src="ideal" derived info="stack-dv" /></td></tr>
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
            <tr><th scope="row">To orbit</th><td className="value">{fmt(toOrbit / 1000, 3)} km/s<span className="alt">{fmt(circularSpeed(parkAlt * 1000) / 1000, 3)} circular at {parkAlt} km − {fmt(rotationBonus(P.lat, az!) / 1000, 3)} Earth's rotation + {fmt((losses ?? 1500) / 1000, 3)} losses</span></td><td className="src"><SourceTag src={losses === null ? 'assumed' : 'flown'} derived={losses === null} info="to-orbit" detail={losses === null ? 'losses assumed: 1.5 km/s, typical; fly the ascent for this stack\'s own' : 'losses from the ascent you flew'} /></td></tr>
            {job !== 'orbit' && <tr><th scope="row">Onward</th><td className="value">{fmt(onward / 1000, 3)} km/s<span className="alt">{job === 'gto' ? 'Hohmann burn from 200 km to 35,786 km' : job === 'moon' ? 'from 200 km to the Moon (C3 about −2 km²/s²)' : `to ${win!.name}, C3 ${fmt(win!.c3, 2)} km²/s², departing ${iso(win!.depMs).slice(0, 10)}`}</span></td><td className="src"><SourceTag src="2-body" info={job === 'gto' ? 'hohmann' : 'departure'} detail="from a 200 km circular parking orbit" /></td></tr>}
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
              <tr><th scope="row">{flight.res.remaining ? 'At cutoff' : 'At burnout'}</th><td className="value">{fmt(flight.res.burnout.h / 1000, 1)} km, {fmt(flight.res.burnout.v / 1000, 3)} km/s<span className="alt">{fmt(flight.res.burnout.t, 0)} s after liftoff, {fmt(flight.res.burnout.x / 1000, 0)} km downrange, kick to {fmt(flight.res.gamma0, 3)}°{flight.res.remaining ? ` · ${stages[flight.res.remaining.stage].name} keeps ${fmt(flight.res.remaining.prop / 1000, 1)} t of propellant` : ' · all propellant spent'}</span></td><td className="src"><SourceTag src="ascent" info="ascent" /></td></tr>
              <tr><th scope="row">Orbit</th><td className="value">{Number.isFinite(orbit.apo) ? `${fmt(orbit.peri, 0)} × ${fmt(orbit.apo, 0)} km` : 'escape'}<span className="alt">{fmt(orbit.inc, 2)}° inclined{orbit.peri < 120 ? ' · perigee in the atmosphere: it will come down' : ''}</span></td><td className="src"><SourceTag src="2-body" info="burnout-orbit" /></td></tr>
              <tr><th scope="row">Losses</th><td className="value">{fmt((flight.res.losses.gravity + flight.res.losses.drag) / 1000, 3)} km/s<span className="alt">gravity {fmt(flight.res.losses.gravity / 1000, 3)}, drag {fmt(flight.res.losses.drag / 1000, 3)} · max q {fmt(flight.res.maxQ.q / 1000, 1)} kPa at {fmt(flight.res.maxQ.h / 1000, 1)} km</span></td><td className="src"><SourceTag src="ascent" info="losses" /></td></tr>
              {P0.flown && !custom && P0.flown.events.map((ev) => {
                // Ours at the same moment of the flight, beside the real one.
                const hs = flight.res!.history, k = hs.findIndex((x: { t: number }) => x.t >= ev.t);
                const o = k < 0 ? null : hs[k];
                const v = o ? (P0.flown!.frame === 'surface' ? surfaceSpeed(o, rotationBonus(flight.pad.lat, flight.az)) : o.v) : 0;
                return (
                  <tr key={ev.name}><th scope="row">{ev.name}</th>
                    <td className="value">{fmt(ev.h, 1)} km, {fmt(ev.v, 3)} km/s<span className="alt">{P0.flown!.flight} at T+{fmt(ev.t, 0)} s{P0.flown!.frame === 'surface' ? ' (speed over the ground)' : ''}{o ? ` · here ${fmt(o.h / 1000, 1)} km, ${fmt(v / 1000, 3)} km/s` : ' · here already in orbit'}</span></td>
                    <td className="src"><SourceTag src="flown" detail={P0.flown!.source} /></td></tr>
                );
              })}
            </tbody></table>
            <div className="keys-row">
              <button className="key primary" onClick={launch}>Launch from the pad</button>
              <button className="key" onClick={insert}>Put it in orbit</button>
            </div>
            <p className="hint">Launch from the pad sets the clock to ten seconds before liftoff and runs it at 10 s a second while the craft climbs; Put it in orbit jumps the clock to {flight.res.remaining ? 'cutoff' : 'burnout'} (BACK undoes it). Either way the payload flies on as a craft with {flight.res.remaining ? 'the upper stage\'s engine and its propellant' : 'no propellant'}.</p>
          </>
        )}
      </details>

      <OrkSection />
    </div>
  );
}

// An OpenRocket design (.ork): one of the simulations OpenRocket saved in
// it, flown by this app's ascent and set beside OpenRocket's own result
// (src/physics/ork.js; docs/physics/rocket.md#openrocket-designs-in-the-rocket-tab).
// The file is read in the browser and never leaves it.
type OrkDesign = ReturnType<typeof readOrk>;
interface OrkSim { index: number; name: string; status: string; branches: { length: number }[] }
interface OrkResult { apogee: number; apogeeTime: number; maxSpeed: number | null; history: number[][] }
const grams = (kg: number) => (kg < 1 ? `${fmt(kg * 1000, 1)} g` : `${fmt(kg, kg < 10 ? 3 : 2)} kg`);
// This app's value against OpenRocket's, as a signed percentage that does
// not break before its unit.
const diff = (a: number, b: number) => { const p = Number(((a / b - 1) * 100).toFixed(2)); return `this app ${p === 0 ? '±' : p > 0 ? '+' : '−'}${fmt(Math.abs(p), 2)}\u00a0%`; };

function OrkSection() {
  const [design, setDesign] = useSaved<{ file: string; d: OrkDesign } | null>('ork', null);
  const [simIndex, setSimIndex] = useSaved('orkSim', 0);
  const [drag, setDrag] = useSaved<'mach' | 'replay'>('orkDrag', 'mach');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hasFlight = (s: OrkSim) => s.branches.length > 0 && s.branches[0].length > 2;

  const open = async (f: File | undefined) => {
    if (!f || busy) return;
    setBusy(true);
    setError(null);
    try {
      const d = readOrk(await orkXml(await f.arrayBuffer()));
      setDesign({ file: f.name, d });
      const first = d.simulations.find(hasFlight);
      setSimIndex(first ? first.index : 0);
    } catch (e) {
      // The design already open, if any, stays.
      setError(`${f.name} isn't an OpenRocket design this can read (${(e as Error).message.slice(0, 80)}).${design ? ` Still showing ${design.file}.` : ''}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const sim = design?.d.simulations[simIndex] ?? null;
  const flown = useMemo(() => {
    if (!design || !sim || !hasFlight(sim)) return null;
    try {
      const v = vehicleFromOrk(sim, design.d.motors);
      return { v, r: flyOrk(v, { drag }), error: null as string | null };
    } catch (e) {
      return { v: null, r: null, error: (e as Error).message };
    }
  }, [design, sim, drag]);
  const c = flown?.v?.conditions;
  const atm = c?.atmosphere;
  const or = flown?.v?.openrocket as OrkResult | undefined;
  const noFlights = design && !design.d.simulations.some(hasFlight);

  return (
    <details className="section" open>
      <summary className="strip">OpenRocket design</summary>
      <div className="keys-row">
        <button className="key" aria-disabled={busy} onClick={() => { if (!busy) input.current?.click(); }}>{busy ? 'Reading…' : design ? 'Open another' : 'Open .ork file'}</button>
        <input ref={input} type="file" accept=".ork" hidden onChange={(e) => void open(e.target.files?.[0])} />
        <span className="hint">Flies a simulation saved in an OpenRocket file with this app's own ascent, beside OpenRocket's result. Separate from the vehicle above. Read in this browser; nothing is uploaded.</span>
      </div>
      {error && <p className="status bad" role="alert">{error}</p>}
      {noFlights && <p className="status bad" role="alert">{design!.file} holds OpenRocket's results but not its flights. In OpenRocket, save it again with the simulated data stored (the save dialog's simulation data option), then open it here.</p>}
      <p className="sr-only" role="status">{design ? `${design.file} open: ${design.d.simulations.length} simulations${sim ? `, showing ${sim.name}` : ''}` : ''}</p>
      {design && (
        <>
          <p className="hint">{design.d.name} · {design.file} · {design.d.creator || 'OpenRocket'}</p>
          <div className="form-grid">
            <label className="num wide"><span className="engraved">Simulation</span>
              <select className="input" value={simIndex} onChange={(e) => setSimIndex(Number(e.target.value))}>
                {design.d.simulations.map((s: OrkSim) => (
                  <option key={s.index} value={s.index} disabled={!hasFlight(s)}>{s.name}{!hasFlight(s) ? ' (no saved flight)' : s.status === 'outdated' || s.status === 'cantrun' ? ' (saved before the design last changed)' : ''}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {flown?.error && <p className="status bad" role="alert">{flown.error}</p>}
      {flown?.v && flown.r && c && or && (
        <>
          <div className="keys-row wrap" role="radiogroup" aria-labelledby="ork-drag">
            <span className="engraved" id="ork-drag">Drag coefficient</span>
            {([['mach', 'By Mach (from the record)'], ['replay', 'By time (as recorded)']] as const).map(([k, label]) => (
              <button key={k} className="key small" role="radio" aria-checked={drag === k} onClick={() => setDrag(k)}>{label}</button>
            ))}
          </div>
          <table className="readout"><tbody>
            {flown.v.stages.map((s: { name: string; impulse: number; burn: number; prop: number; dry: number }, i: number) => (
              <tr key={i}><th scope="row">{s.name}</th>
                <td className="value">{fmt(s.impulse, 1)} N·s<span className="alt">{fmt(s.burn, 2)} s burn · uses {grams(s.prop)}{s.dry > 0 ? ` · drops ${grams(s.dry)}` : ''}</span></td>
                <td className="src"><SourceTag src="saved" derived info="ork-stage" /></td></tr>
            ))}
            <tr><th scope="row">Rocket</th><td className="value">{grams(flown.v.liftoff)}<span className="alt">at liftoff · {grams(flown.v.payload)} at apogee · {fmt(flown.v.diameter * 1000, 0)} mm reference diameter</span></td><td className="src"><SourceTag src="saved" derived info="ork-rocket" /></td></tr>
            <tr><th scope="row">Launch</th><td className="value">{fmt(c.rodLength ?? 0, 2)} m rod{c.rodAngle ? ` at ${fmt(c.rodAngle, 1)}°` : ''}<span className="alt">{fmt(c.windAverage ?? 0, 1)} m/s wind{c.windTurbulence ? ` (its gusts left out)` : ''}{c.latitude !== null ? ` · ${fmt(Math.abs(c.latitude), 2)}° ${c.latitude < 0 ? 'S' : 'N'}` : ''}{c.altitude !== null ? ` · pad ${fmt(c.altitude, 0)} m above sea level` : ''} · {atm?.model === 'extendedisa' && atm.baseTemperature && atm.basePressure ? `${fmt(atm.baseTemperature - 273.15, 1)} °C, ${fmt(atm.basePressure / 100, 1)} hPa at the pad` : 'standard atmosphere'}</span></td><td className="src"><SourceTag src=".ork" info="ork-launch" /></td></tr>
          </tbody></table>
          <FlightPlot ours={flown.r.history} theirs={or.history} />
          <table className="readout"><tbody>
            <tr><th scope="row">Apogee</th><td className="value">{fmt(flown.r.apogee, 1)} m<span className="alt">OpenRocket {fmt(or.apogee, 1)} m · {diff(flown.r.apogee, or.apogee)}</span></td><td className="src"><SourceTag src="ascent" info="ork-ascent" detail="this app's ascent (rocket.js), a point mass" /></td></tr>
            <tr><th scope="row">Time to apogee</th><td className="value">{fmt(flown.r.timeToApogee, 2)} s<span className="alt">OpenRocket {fmt(or.apogeeTime, 2)} s · {diff(flown.r.timeToApogee, or.apogeeTime)}</span></td><td className="src"><SourceTag src="ascent" info="ork-ascent" detail="this app's ascent; OpenRocket's time is where its climb rate crosses zero, between its samples" /></td></tr>
            <tr><th scope="row">Top speed</th><td className="value">{fmt(flown.r.maxSpeed, 1)} m/s<span className="alt">Mach {fmt(flown.r.maxMach, 3)}{or.maxSpeed !== null ? ` · OpenRocket ${fmt(or.maxSpeed, 1)} m/s · ${diff(flown.r.maxSpeed, or.maxSpeed)}` : ''}</span></td><td className="src"><SourceTag src="ascent" info="ork-ascent" detail="this app's ascent (rocket.js), a point mass" /></td></tr>
          </tbody></table>
          {flown.v.deployedAt !== null && <p className="hint">OpenRocket opened a parachute {fmt(flown.v.deployedAt, 2)} s after launch, before apogee. From then on this app's flight uses OpenRocket's recorded drag, whichever drag is picked.</p>}
          {flown.v.flagged.length > 0 && <p className="status bad">OpenRocket flagged this flight ({flown.v.flagged.join(', ')}) before apogee: its result may not be one to compare with.</p>}
          <p className="hint">This app flies the rocket as a point mass: up the launch rod, then along its velocity through the air, its axis turning into the average wind with a 0.1 s lag, in the air OpenRocket recorded. Thrust is OpenRocket's saved samples joined by straight lines (the file names its motors but holds no thrust curves); masses are as its flight carried them, saved to three or four figures. Not launched into the scene.</p>
        </>
      )}
    </details>
  );
}

// Height against time: OpenRocket's flight in the flown-path green, wider,
// under this app's in amber, so where they agree it shows as an amber line
// edged in green.
function FlightPlot({ ours, theirs }: { ours: number[][]; theirs: number[][] }) {
  const W = 300, H = 120;
  const tMax = Math.max(ours.at(-1)?.[0] ?? 0, theirs.at(-1)?.[0] ?? 0) || 1;
  const hMax = Math.max(1, ...ours.map((p) => p[1]), ...theirs.map((p) => p[1]));
  const line = (pts: number[][]) => pts.map(([t, h]) => `${(t / tMax * W).toFixed(1)},${(H - h / hMax * H).toFixed(1)}`).join(' ');
  return (
    <figure className="porkchop ascent-plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Height against time, this app's flight and OpenRocket's, up to ${fmt(hMax, 0)} m in ${fmt(tMax, 1)} s`}>
        <polyline points={line(theirs)} fill="none" style={{ stroke: 'var(--flown-line)', strokeWidth: 3.5 }} />
        <polyline points={line(ours)} fill="none" />
      </svg>
      <figcaption><span>{fmt(hMax, 0)} m up</span><span>{fmt(tMax, 1)} s after launch</span></figcaption>
      <ul className="legend"><li><i className="sw conic" />This app's flight</li><li><i className="sw flown" />OpenRocket's saved flight</li></ul>
    </figure>
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
