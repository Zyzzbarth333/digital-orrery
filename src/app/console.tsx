// src/app/console.tsx
//
// The flight console: missions, the transfer planner and the rocket, which
// belong to the whole app rather than to the body in view
// (docs/ux/overhaul-plan.md, point 5). The header's FLIGHT field opens it;
// choosing a body never closes it. It hangs over the right of the sky, and
// the 3D view shifts its centre so the body in view stays clear of it.
// The panels inside are the existing ones, unchanged.

import { MissionPanel } from './mission-panel';
import { PlannerPanel } from './planner-panel';
import { RocketPanel } from './rocket-panel';
import type { SimClock } from './clock';
import type { Mission } from './mission';

export type ConsoleTab = 'mission' | 'planner' | 'rocket';

const TABS: [ConsoleTab, string][] = [['mission', 'Mission'], ['planner', 'Planner'], ['rocket', 'Rocket']];

export function FlightConsole({ clock, mission, tab, setTab, onClose, onFocusCraft, autoPlan = null }: {
  clock: SimClock; mission: Mission; tab: ConsoleTab; setTab: (t: ConsoleTab) => void; onClose: () => void;
  onFocusCraft: (id: number) => void; autoPlan?: string | null;
}) {
  const flown = (id: number) => { setTab('mission'); onFocusCraft(id); };
  return (
    <section className="console screw" aria-label="Flight console">
      <span className="pnl" aria-hidden="true">C1</span>
      <div className="console-head">
        <div className="tabs" role="tablist" aria-label="Flight console">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" id={`ctab-${k}`} aria-selected={tab === k} aria-controls={`cpanel-${k}`} className="key tab"
              onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <button className="key tab close" onClick={onClose} title="Close the flight console (M or Esc)" aria-label="Close the flight console">Close</button>
      </div>
      <div role="tabpanel" id={`cpanel-${tab}`} aria-labelledby={`ctab-${tab}`} className="tab-panel">
        {tab === 'mission' && <MissionPanel clock={clock} mission={mission} onFocusCraft={onFocusCraft} />}
        {tab === 'planner' && <PlannerPanel clock={clock} mission={mission} autoPlan={autoPlan} onFlown={flown} />}
        {tab === 'rocket' && <RocketPanel clock={clock} mission={mission} onFlown={flown} />}
      </div>
    </section>
  );
}
