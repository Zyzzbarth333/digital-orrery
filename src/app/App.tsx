// src/app/App.tsx

import { useEffect, useMemo, useRef, useState } from 'react';
import { SimClock } from './clock';
import { SceneView } from '../scene/SceneView';
import { BodyRail, Plate, RATES, TimeBand, type PlateTab } from './panels';
import { Mission } from './mission';
import type { OrreryScene } from '../scene/OrreryScene';
import { BODIES, BODY_BY_KEY, type BodyKey } from '../scene/catalogue';

// Optional start state from the URL: ?focus=mars&t=2030-01-01T00:00Z&view=sun
// (or &phase=90: the camera at that angle from the Sun, seen from the body).
// Missions too: &craft=orbit,400,51.6 (altitude km, inclination deg) or
// &craft=departure,2.95,prograde (v_inf km/s, direction), followed by the
// camera; &plan=mars opens the planner and computes the grid.
// Real missions: &mission=artemis2 (or artemis2,first to fly only the first
// burn), &fix=12 for a tracking fix every 12 h; with &t= inside the mission
// the craft starts where the real one was then.
function initialState(): { focus: BodyKey; timeMs: number; tGiven: boolean; sunView: boolean; phaseDeg: number; craft: string | null; plan: string | null; real: string | null; fix: number | null } {
  const q = new URLSearchParams(window.location.search);
  const f = q.get('focus');
  const t = Date.parse(q.get('t') ?? '');
  return {
    focus: f && f in BODY_BY_KEY ? (f as BodyKey) : 'sun',
    timeMs: Number.isFinite(t) ? t : Date.now(),
    tGiven: Number.isFinite(t),
    real: q.get('mission'),
    fix: Number(q.get('fix')) || null,
    sunView: q.get('view') === 'sun' || q.has('phase'),
    phaseDeg: Number(q.get('phase') ?? 20),
    craft: q.get('craft'),
    plan: q.get('plan'),
  };
}

export function App() {
  const init = useMemo(initialState, []);
  const clock = useMemo(() => new SimClock(init.timeMs), [init]);
  const [focus, setFocus] = useState<BodyKey>(init.focus);
  const [tab, setTab] = useState<PlateTab>(init.plan ? 'planner' : init.craft || init.real ? 'mission' : 'target');
  const mission = useMemo(() => new Mission(), []);
  const scene = useRef<OrreryScene | null>(null);
  const launched = useRef(false);
  const [following, setFollowing] = useState<number | null>(null);
  const followCraft = (id: number) => { mission.select(id); scene.current?.focusOnCraft(id); setFollowing(id); };
  const onReady = (sc: OrreryScene) => {
    scene.current = sc;
    sc.onFrame = (t, jumps) => mission.frame(t, jumps);
    sc.craftSource = () => mission.views();
    sc.onCraftPick = (id) => { followCraft(id); setTab('mission'); };
    if (init.sunView) sc.viewFromSun((init.phaseDeg * Math.PI) / 180);
    const [kind, a, b] = (init.craft ?? '').split(',');
    // React's development double-mount builds the scene twice: a craft
    // launched for the first one is followed by the second too.
    if (launched.current && mission.selected) sc.focusOnCraft(mission.selected.id);
    if ((kind === 'orbit' || kind === 'departure') && !launched.current) {
      launched.current = true;                    // once, whatever React's mounts do
      const c = kind === 'orbit'
        ? mission.launchOrbit(clock.snapshot.timeMs, Number(a) || 400, Number(b) || 0)
        : mission.launchDeparture(clock.snapshot.timeMs, { speed: Number(a) || 3, dir: (['prograde', 'retrograde', 'outward', 'inward'].includes(b) ? b : 'prograde') as 'prograde' });
      followCraft(c.id);
    }
    if (init.real && !launched.current) {
      launched.current = true;
      const [id, burns] = init.real.split(',');
      void mission.fetchReal(id).then((m) => {
        clock.setTime(m.startMs);
        const c = mission.flyReal(m, burns === 'first' ? 'first' : 'all');
        if (init.fix) mission.setFixHours(c, init.fix);
        // A time inside the mission: jump there, onto the flown path.
        if (init.tGiven && init.timeMs > m.startMs && init.timeMs < m.endMs) clock.setTime(init.timeMs);
        followCraft(c.id);
      }).catch((err) => console.warn(`mission ${id} not loaded: ${err}`));
    }
  };

  // Keyboard: Space runs or pauses, left/right step the rate, up/down move
  // through the bodies, N jumps to now. Ignored while a form control has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.altKey || e.ctrlKey || e.metaKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const s = clock.snapshot;
      const ri = Math.max(0, RATES.findIndex((r) => r.rate === s.rate));
      const bi = BODIES.findIndex((b) => b.key === focus);
      if (e.key === ' ') clock.setPlaying(!s.playing);
      else if (e.key === 'ArrowRight') clock.setRate(RATES[Math.min(RATES.length - 1, ri + 1)].rate);
      else if (e.key === 'ArrowLeft') clock.setRate(RATES[Math.max(0, ri - 1)].rate);
      else if (e.key === 'ArrowDown') setFocus(BODIES[Math.min(BODIES.length - 1, bi + 1)].key);
      else if (e.key === 'ArrowUp') setFocus(BODIES[Math.max(0, bi - 1)].key);
      else if (e.key === 'n' || e.key === 'N') clock.setTime(Date.now());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, focus]);

  return (
    <div className="app">
      <SceneView clock={clock} focus={focus} onFocusChange={(k) => { setFollowing(null); setFocus(k); }} onReady={onReady}
        onFrame={(t, jumps) => mission.frame(t, jumps)} />
      <TimeBand clock={clock} mission={mission} />
      <BodyRail clock={clock} focus={following === null ? focus : null} onSelect={(k) => { setFollowing(null); setFocus(k); scene.current?.focusOn(k); setTab('target'); }} />
      <Plate clock={clock} focus={focus} mission={mission} tab={tab} setTab={setTab} onFocusCraft={followCraft} autoPlan={init.plan} />
    </div>
  );
}
