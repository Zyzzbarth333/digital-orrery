// src/app/plot-go.tsx
//
// The plotting table's GO station: a go/no-go poll, as a flight director
// takes one, of what the other stations found: the trajectory (the kernel's
// flight of it), the windows, the delta-v against the budget, the flybys,
// the vehicle and the launch. When every row reads GO, "Commit to the
// orrery" hands the plan to the sky: the clock jumps to the departure (BACK
// undoes it), a craft flies the kernel's burns, and the camera follows it.

import type { SimClock } from './clock';
import type { Mission } from './mission';
import { useJourney, ledgerLines, type JourneyStore } from './journey';
import type { Remedy, RemedyOption } from './journey.worker';
import { useStack } from './plot-stack';
import { assess } from '@digital-orrery/physics/feasibility.js';
import { assistFrame, bodyInfo, type Journey } from '@digital-orrery/physics/journey.js';
import { flightVerdict } from '@digital-orrery/physics/remedies.js';

const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
type State = 'go' | 'nogo' | 'standby' | 'na';
// fix: what to do, in words, where nothing can be worked out (a row
// that isn't NO GO, or one with no options); why: how the plan meets the
// trouble; remedy: the options, null while they are worked out.
interface Row { key: string; state: State; text: string; fix?: string; remedy?: Remedy | null }

export function GoStation({ store, clock, mission, onFlown }: { store: JourneyStore; clock: SimClock; mission: Mission; onFlown: (id: number) => void }) {
  useJourney(store);
  const { chosen, real, dv } = useStack(store);
  const sol = store.solution, j = store.journey, k = store.kernel;
  const fresh = store.profilesFor === store.version;
  const lamps = assess(j, sol as never, { budget: store.budget, profiles: fresh ? store.profiles as never : [] }) as { key: string; level: string; text: string }[];
  const lamp = (key: string) => lamps.find((l) => l.key === key);
  const reply = k.state === 'done' && k.forVersion === store.version ? k.reply : null;
  // The options for each NO GO row (null while the worker works them out).
  const rem = store.remediesNow();
  const pick = (key: keyof NonNullable<typeof rem>): Remedy | null => (rem ? rem[key] ?? { why: null, options: [] } : null);
  if (!j.waypoints.length) return <div className="station-empty"><p>Plan a journey in PLOT first.</p></div>;

  const rows: Row[] = [];
  // Trajectory: the kernel flew it to every waypoint.
  if (!sol.ok) rows.push({ key: 'Trajectory', state: 'nogo', text: 'A leg has no solution', fix: 'Slide its date or change the stop in PLOT' });
  else if (!reply) rows.push({ key: 'Trajectory', state: 'standby', text: k.state === 'failed' ? `The kernel's flight failed: ${k.error}` : 'The kernel is flying it…' });
  else {
    const v = flightVerdict(sol, reply) as { state: string; body: string | null; worst: number; corr: number };
    rows.push(v.state === 'hit' ? { key: 'Trajectory', state: 'nogo', text: `The kernel's craft hits ${bodyInfo(v.body!).name}`, remedy: pick('trajectory'), fix: 'Raise the pass or the orbit there' }
      : v.state === 'miss' ? { key: 'Trajectory', state: 'nogo', text: `The kernel misses a waypoint by ${fmt(v.worst, 0)} km`, remedy: pick('trajectory'), fix: 'Shorten the leg or aim its last node' }
      : v.state === 'corrections' ? { key: 'Trajectory', state: 'nogo', text: `The kernel needs ${fmt(v.corr * 1000, 0)} m/s of corrections to fly it`, remedy: pick('trajectory'), fix: 'Leave at the windows, or aim the nodes; the plan and the n-body flight disagree' }
        : { key: 'Trajectory', state: 'go', text: `Every waypoint within ${fmt(v.worst, 1)} km of the plan · corrections ${fmt(reply.correctionsDv * 1000, 0)} m/s · ${reply.model === 'bare' ? `planner's model (fallback: in the full one ${reply.bareWhy})` : 'full model'}` });
  }
  // Windows.
  const win = lamp('window'), nowin = lamp('nowindow');
  rows.push(!fresh ? { key: 'Windows', state: 'standby', text: 'Working out each leg\'s windows…' }
    : nowin ? { key: 'Windows', state: 'nogo', text: nowin.text, remedy: pick('windows'), fix: 'More delta-v, or a later horizon' }
      : win?.level === 'caution' ? { key: 'Windows', state: 'nogo', text: win.text, remedy: pick('windows'), fix: 'Click that date in PLOT\'s timeline' }
        : { key: 'Windows', state: 'go', text: 'Every leg leaves in its window' });
  // Delta-v and shaping.
  const dvl = lamp('dv'), miss = lamp('miss');
  rows.push(dvl?.level === 'warn' ? { key: 'Delta-v', state: 'nogo', text: dvl.text, remedy: pick('dv'), fix: 'Raise the budget, or leave at the windows' } : { key: 'Delta-v', state: 'go', text: `${fmt(sol.totalDv, 2)} of ${fmt(store.budget, 1)} km/s` });
  if (miss) rows.push({ key: 'Shaping', state: 'nogo', text: miss.text, remedy: pick('shaping'), fix: 'Aim the last node, or remove it' });
  // A low lunar orbit the field brings down in the stay.
  const lo = lamp('lowOrbit');
  if (lo) rows.push(lo.level === 'warn' ? { key: 'Orbits', state: 'nogo', text: lo.text, remedy: pick('orbits'), fix: 'Shorten the stay or raise the orbit in PLOT' } : { key: 'Orbits', state: 'go', text: lo.text });
  const fb = lamps.filter((l) => l.key === 'flyby');
  // What each flyby gives (credited, not spent) and what a powered one pays.
  // A row with nothing to report stays dark (N/A): green is never lit for
  // nothing (DESIGN.md, What real panels do).
  // (A planet's change is heliocentric; a moon's, about its planet.)
  const gives = sol.flybys.filter(Boolean).map((f) => `${bodyInfo(f!.body).name} +${fmt(f!.gain, 2)} km/s ${assistFrame(f!.about)} ${f!.dv > 0 ? `for ${fmt(f!.dv * 1000, 0)} m/s (credit ${fmt(Math.max(0, f!.gain - f!.dv), 2)})` : 'free'}`).join(' · ');
  const powered = sol.flybys.some((f) => f && f.dv > 0) ? 'A powered pass pays only for the speed the pull cannot change, at periapsis, and any turn the lowest pass cannot give.' : undefined;
  rows.push(fb.some((l) => l.level === 'warn') ? { key: 'Flybys', state: 'nogo', text: fb.map((l) => l.text).join('; '), remedy: pick('flybys') }
    : sol.flybys.some(Boolean) ? { key: 'Flybys', state: 'go', text: `${fb.length ? fb.map((l) => l.text).join('; ') : 'Every pass above its floor'} · ${gives}`, fix: powered }
      : { key: 'Flybys', state: 'na', text: 'None in this journey' });
  // Landings: how each is paid for (only when there is one).
  const lands = ledgerLines(sol).filter((l) => (l.paid && l.kind === 'land') || (!l.paid && l.kind === 'entry'));
  if (lands.length) rows.push({ key: 'Landings', state: 'go', text: lands.map((l) => l.paid ? `${bodyInfo(l.body).name}: ${fmt(l.dv, 2)} km/s, ${l.note}` : `${bodyInfo(l.body).name}: ${l.note}`).join(' · ') });
  // Vehicle.
  const can = real.filter((r) => r.can).map((r) => r.label);
  // The stack sized in STACK, which the ROCKET tab flies as "Journey's stack".
  rows.push(chosen ? { key: 'Vehicle', state: 'go', text: `STACK's ${chosen.n}-stage stack (the ROCKET tab's "Journey's stack"): ${fmt((chosen.liftoff ?? 0) / 1000, 1)} t at liftoff, ${fmt(store.vehicle.payload / 1000, 1)} t delivered${can.length ? ` · could also fly: ${can.join(', ')}` : ''}` }
    : { key: 'Vehicle', state: 'nogo', text: `No stack of these stages gives ${fmt(dv / 1000, 1)} km/s`, fix: 'Change the stages in STACK' });
  // Launch.
  const s0 = j.start;
  // Launch: checked, not assumed. A parking orbit below 120 km is inside the
  // air's dense part (the MISSION tab's floor for a launch).
  const where = `${s0.kind === 'pad' ? `Pad ${fmt(s0.latDeg ?? 28.5, 1)}°` : s0.kind === 'orbit' ? 'From orbit' : 'From the craft'}, ${iso(sol.startMs)}, ${s0.kind === 'craft' ? 'its own state' : `${s0.altKm} km parking orbit`}`;
  rows.push(s0.kind !== 'craft' && !(s0.altKm >= 120) ? { key: 'Launch', state: 'nogo', text: `${where}: the parking orbit is inside the atmosphere`, remedy: pick('launch'), fix: 'Raise the parking orbit to 120 km or more in PLOT' }
    : { key: 'Launch', state: 'go', text: where });

  const allGo = rows.every((r) => r.state === 'go' || r.state === 'na');
  const commit = () => {
    if (!reply?.start) return;
    clock.setTime(reply.start.ms);
    const c = mission.flyJourney(reply.start, reply.burns, store.title(), reply.landings ?? [], reply.model ?? 'full', reply.bareWhy ?? null);
    store.setPlotOpen(false);
    onFlown(c.id);
  };
  return (
    <div className="go-station">
      <div className="goboard" role="table" aria-label="Go/no-go poll">
        {rows.map((r) => (
          <div key={r.key} className="go-row" role="row">
            <b role="rowheader">{r.key}</b>
            <span role="cell" className={`plot-lamp ${r.state === 'go' ? 'go' : r.state === 'nogo' ? 'warn' : ''}`}>{r.state === 'go' ? 'GO' : r.state === 'nogo' ? 'NO GO' : r.state === 'na' ? 'N/A' : 'STANDBY'}</span>
            <span role="cell">{r.text}<RowFix row={r} store={store} /></span>
          </div>
        ))}
      </div>
      <div className="keys-row">
        <button className="key primary" disabled={!allGo || !reply?.start} onClick={commit}>Commit to the orrery</button>
        <span className="hint">{allGo ? `Jumps the clock to ${iso(sol.startMs)} (BACK undoes it), flies the kernel's burns and follows the craft.` : 'Every row must read GO first.'}</span>
      </div>
    </div>
  );
}

// Under a row: why, then what to change. A NO GO row's options, each with
// the journey's delta-v after it (or, for the budget, what the plan leaves
// spare), and a key that makes the change; its words while the options are
// worked out, or where there are none.
function RowFix({ row, store }: { row: Row; store: JourneyStore }) {
  if (row.state !== 'nogo' || row.remedy === undefined) return row.fix ? <small>{row.fix}</small> : null;
  if (row.remedy === null) return <small>{store.kernel.state === 'flying' || store.profilesFor !== store.version ? row.fix : 'Working out what to change…'}</small>;
  const { why, options } = row.remedy;
  const cost = (o: RemedyOption) => {
    if (o.budget !== undefined) return o.budget >= o.total ? `the plan's ${fmt(o.total, 2)} km/s leaves ${fmt(o.budget - o.total, 2)} spare` : `enough for the best date; the plan as it stands needs ${fmt(o.total, 2)} km/s`;
    const d = o.delta ?? 0, over = o.total > store.budget ? `, over the ${fmt(store.budget, 1)} budget` : '';
    return `${fmt(o.total, 2)} km/s, ${Math.abs(d) < 0.005 ? 'the same' : `${fmt(Math.abs(d), 2)} ${d > 0 ? 'more' : 'less'}`}${over}`;
  };
  const apply = (o: RemedyOption) => {
    if (o.budget !== undefined) { store.setBudget(o.budget); return; }
    store.set(o.journey as Journey);
    store.check();
  };
  return (
    <>
      {why && <small className="go-why">{why}</small>}
      {options.length ? (
        <ul className="go-fixes" aria-label={`${row.key}: what to change`}>
          {options.map((o) => (
            <li key={o.label}>
              <button className="key small" onClick={() => apply(o)} aria-label={`${o.label}: ${cost(o)}`}>{o.budget !== undefined ? 'Set' : 'Re-plan'}</button>
              <span>{o.label}<small>{cost(o)}</small></span>
            </li>
          ))}
        </ul>
      ) : !why && row.fix && <small>{row.fix}</small>}
    </>
  );
}
