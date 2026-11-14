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
import { useJourney, type JourneyStore } from './journey';
import { useStack } from './plot-stack';
import { assess } from '../physics/feasibility.js';
import { bodyInfo } from '../physics/journey.js';

const fmt = (n: number, d = 2) => n.toLocaleString('en-AU', { minimumFractionDigits: d, maximumFractionDigits: d });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
type State = 'go' | 'nogo' | 'standby';
interface Row { key: string; state: State; text: string; fix?: string }

export function GoStation({ store, clock, mission, onFlown }: { store: JourneyStore; clock: SimClock; mission: Mission; onFlown: (id: number) => void }) {
  useJourney(store);
  const { chosen, real, dv } = useStack(store);
  const sol = store.solution, j = store.journey, k = store.kernel;
  const fresh = store.profilesFor === store.version;
  const lamps = assess(j, sol as never, { budget: store.budget, profiles: fresh ? store.profiles as never : [] }) as { key: string; level: string; text: string }[];
  const lamp = (key: string) => lamps.find((l) => l.key === key);
  const reply = k.state === 'done' && k.forVersion === store.version ? k.reply : null;
  if (!j.waypoints.length) return <div className="station-empty"><p>Plan a journey in PLOT first.</p></div>;

  const rows: Row[] = [];
  // Trajectory: the kernel flew it to every waypoint.
  if (!sol.ok) rows.push({ key: 'Trajectory', state: 'nogo', text: 'A leg has no solution', fix: 'Slide its date or change the stop in PLOT' });
  else if (!reply) rows.push({ key: 'Trajectory', state: 'standby', text: k.state === 'failed' ? `The kernel's flight failed: ${k.error}` : 'The kernel is flying it…' });
  else {
    const worst = Math.max(0, ...reply.arrivals.map((a) => a.missKm));
    const hit = reply.impact && !reply.arrivals.some((a) => a.central && a.body === reply.impact!.body);
    // Corrections past 250 m/s or a tenth of the plan mean the plan and the
    // n-body flight disagree too much to trust the plan's delta-v.
    const corr = reply.correctionsDv, tooMuch = corr > Math.max(0.25, 0.1 * sol.totalDv);
    rows.push(hit ? { key: 'Trajectory', state: 'nogo', text: `The kernel's craft hits ${bodyInfo(reply.impact!.body).name}`, fix: 'Raise the pass or the orbit there' }
      : worst > 50 ? { key: 'Trajectory', state: 'nogo', text: `The kernel misses a waypoint by ${fmt(worst, 0)} km`, fix: 'Shorten the leg or aim its last node' }
      : tooMuch ? { key: 'Trajectory', state: 'nogo', text: `The kernel needs ${fmt(corr * 1000, 0)} m/s of corrections to fly it`, fix: 'Leave at the windows, or aim the nodes; the plan and the n-body flight disagree' }
        : { key: 'Trajectory', state: 'go', text: `Every waypoint within ${fmt(worst, 1)} km of the plan · corrections ${fmt(reply.correctionsDv * 1000, 0)} m/s` });
  }
  // Windows.
  const win = lamp('window'), nowin = lamp('nowindow');
  rows.push(!fresh ? { key: 'Windows', state: 'standby', text: 'Working out each leg\'s windows…' }
    : nowin ? { key: 'Windows', state: 'nogo', text: nowin.text, fix: 'More delta-v, or a later horizon' }
      : win?.level === 'caution' ? { key: 'Windows', state: 'nogo', text: win.text, fix: 'Click that date in PLOT\'s timeline' }
        : { key: 'Windows', state: 'go', text: 'Every leg leaves in its window' });
  // Delta-v and shaping.
  const dvl = lamp('dv'), miss = lamp('miss');
  rows.push(dvl?.level === 'warn' ? { key: 'Delta-v', state: 'nogo', text: dvl.text, fix: 'Raise the budget, or leave at the windows' } : { key: 'Delta-v', state: 'go', text: `${fmt(sol.totalDv, 2)} of ${fmt(store.budget, 1)} km/s` });
  if (miss) rows.push({ key: 'Shaping', state: 'nogo', text: miss.text, fix: 'Aim the last node, or remove it' });
  const fb = lamps.filter((l) => l.key === 'flyby');
  rows.push(fb.some((l) => l.level === 'warn') ? { key: 'Flybys', state: 'nogo', text: fb.map((l) => l.text).join('; ') } : { key: 'Flybys', state: 'go', text: sol.flybys.some(Boolean) ? (fb.length ? fb.map((l) => l.text).join('; ') : 'Every pass above its floor') : 'None' });
  // Vehicle.
  const can = real.filter((r) => r.can).map((r) => r.label);
  rows.push(chosen ? { key: 'Vehicle', state: 'go', text: `${chosen.n} stages, ${fmt((chosen.liftoff ?? 0) / 1000, 1)} t at liftoff, ${fmt(store.vehicle.payload / 1000, 1)} t delivered${can.length ? ` · could also fly: ${can.join(', ')}` : ''}` }
    : { key: 'Vehicle', state: 'nogo', text: `No stack of these stages gives ${fmt(dv / 1000, 1)} km/s`, fix: 'Change the stages in STACK' });
  // Launch.
  const s0 = j.start;
  rows.push({ key: 'Launch', state: 'go', text: `${s0.kind === 'pad' ? `Pad ${fmt(s0.latDeg ?? 28.5, 1)}°` : s0.kind === 'orbit' ? 'From orbit' : 'From the craft'}, ${iso(sol.startMs)}, ${s0.kind === 'craft' ? 'its own state' : `${s0.altKm} km parking orbit`}` });

  const allGo = rows.every((r) => r.state === 'go');
  const commit = () => {
    if (!reply?.start) return;
    clock.setTime(reply.start.ms);
    const c = mission.flyJourney(reply.start, reply.burns, store.title());
    store.setPlotOpen(false);
    onFlown(c.id);
  };
  return (
    <div className="go-station">
      <div className="goboard" role="table" aria-label="Go/no-go poll">
        {rows.map((r) => (
          <div key={r.key} className="go-row" role="row">
            <b role="rowheader">{r.key}</b>
            <span role="cell" className={`plot-lamp ${r.state === 'go' ? 'go' : r.state === 'nogo' ? 'warn' : ''}`}>{r.state === 'go' ? 'GO' : r.state === 'nogo' ? 'NO GO' : 'STANDBY'}</span>
            <span role="cell">{r.text}{r.fix && <small>{r.fix}</small>}</span>
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
