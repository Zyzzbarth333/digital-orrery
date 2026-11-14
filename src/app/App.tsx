// src/app/App.tsx

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SimClock } from './clock';
import { SceneView } from '../scene/SceneView';
import { BodyRail, Plate, RATES, TimeBand, craftById } from './panels';
import { FlightConsole, type ConsoleTab } from './console';
import { Mission } from './mission';
import { JourneyStore } from './journey';
import type { Frame, OrreryScene } from '../scene/OrreryScene';
import { BODIES, BARY_BY_KEY, BODY_BY_KEY, focusName, isBary, systemOf, type FocusKey } from '../scene/catalogue';

// Optional start state from the URL: ?focus=mars&t=2030-01-01T00:00Z&view=sun
// (focus may be a barycentre: ssb, emb, jupiter-bary; &frame=ssb gives
// orbits and distances about the solar system barycentre)
// (or &phase=90: the camera at that angle from the Sun, seen from the body).
// Missions too: &craft=orbit,400,51.6 (altitude km, inclination deg) or
// &craft=departure,2.95,prograde (v_inf km/s, direction), followed by the
// camera; &plan=mars opens the planner and computes the grid.
// Real missions: &mission=artemis2 (or artemis2,first to fly only the first
// burn), &fix=12 for a tracking fix every 12 h; with &t= inside the mission
// the craft starts where the real one was then.
function initialState(): { focus: FocusKey; frame: Frame; timeMs: number; tGiven: boolean; sunView: boolean; phaseDeg: number; craft: string | null; plan: string | null; real: string | null; fix: number | null } {
  const q = new URLSearchParams(window.location.search);
  const f = q.get('focus');
  const t = Date.parse(q.get('t') ?? '');
  return {
    focus: f && (f in BODY_BY_KEY || f in BARY_BY_KEY) ? (f as FocusKey) : 'sun',
    frame: q.get('frame') === 'ssb' ? 'ssb' : 'sun',
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

// Whether a media query matches, kept current.
function useMedia(query: string): boolean {
  const mql = useMemo(() => matchMedia(query), [query]);
  return useSyncExternalStore((fn) => { mql.addEventListener('change', fn); return () => mql.removeEventListener('change', fn); }, () => mql.matches);
}

export function App() {
  const init = useMemo(initialState, []);
  const clock = useMemo(() => new SimClock(init.timeMs), [init]);
  const [focus, setFocus] = useState<FocusKey>(init.focus);
  const [frame, setFrame] = useState<Frame>(init.frame);
  // The flight console is the app's, not a body's: choosing a body never
  // closes it (docs/ux/overhaul-plan.md, point 5).
  const [consoleOpen, setConsoleOpen] = useState(Boolean(init.plan || init.craft || init.real));
  const [tab, setTab] = useState<ConsoleTab>(init.plan ? 'planner' : 'mission');
  const [flying, setFlying] = useState(false);
  const openConsole = (t: ConsoleTab) => { setTab(t); setConsoleOpen(true); };
  // Closing from inside the console hands focus back to its key, rather
  // than dropping it to the page.
  const closeConsole = () => {
    const inside = document.activeElement?.closest('.console');
    setConsoleOpen(false);
    if (inside) requestAnimationFrame(() => document.querySelector<HTMLElement>('.console-key')?.focus());
  };
  const wide = useMedia('(min-width: 1680px)');
  // How much of the sky the console covers on the right (none where it
  // docks below the sky on a phone): the 3D view keeps the body clear of it.
  const dockRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!consoleOpen || !dock) { setInset(0); return; }
    const measure = () => {
      const host = document.querySelector('.scene-host');
      if (!host) return;
      const d = dock.getBoundingClientRect(), sky = host.getBoundingClientRect();
      const overlapY = Math.min(d.bottom, sky.bottom) - Math.max(d.top, sky.top);
      setInset(overlapY > sky.height / 2 ? Math.max(0, Math.round(sky.right - d.left)) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(dock); ro.observe(document.body);
    return () => ro.disconnect();
  }, [consoleOpen]);
  const mission = useMemo(() => new Mission(), []);
  const journey = useMemo(() => new JourneyStore(init.timeMs), [init]);
  const scene = useRef<OrreryScene | null>(null);
  const launched = useRef(false);
  const [following, setFollowing] = useState<number | null>(null);
  const [smallOn, setSmallOn] = useState<Record<string, boolean>>({ belt: true, neo: true, trojans: true, outer: true, comets: true, colours: false });
  // The followed craft's name, kept current (a rocket's climb included).
  const followName = useSyncExternalStore(mission.subscribe, () => craftById(mission, following)?.name ?? 'Craft');
  const followCraft = (id: number) => { mission.select(id); scene.current?.focusOnCraft(id); setFollowing(id); };
  const onReady = (sc: OrreryScene) => {
    scene.current = sc;
    sc.onFrame = (t, jumps) => mission.frame(t, jumps);
    sc.craftSource = () => mission.views();
    sc.journeySource = () => journey.view();
    sc.journeyHandlers = journey.handlers;
    sc.onCraftPick = (id) => { followCraft(id); openConsole('mission'); };
    sc.onFlight = setFlying;
    if (init.sunView) sc.viewFromSun((init.phaseDeg * Math.PI) / 180);
    const [kind, a, b] = (init.craft ?? '').split(',');
    // React's development double-mount builds the scene twice: a craft
    // launched for the first one is followed by the second too.
    if (launched.current && mission.selected) sc.focusOnCraft(mission.selected.id, true);
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
      // Escape stops a flight first (the scene handles that), then closes
      // the console.
      if (e.key === 'Escape') { if (!e.defaultPrevented && consoleOpen) closeConsole(); return; }
      if (e.key === 'm' || e.key === 'M') { setConsoleOpen(!consoleOpen); e.preventDefault(); return; }
      const s = clock.snapshot;
      const ri = Math.max(0, RATES.findIndex((r) => r.rate === s.rate));
      // From a barycentre, up and down step from its body.
      const bi = BODIES.findIndex((b) => b.key === (isBary(focus) ? systemOf(focus) : focus));
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
  }, [clock, focus, consoleOpen]);

  return (
    <div className="app">
      <SceneView clock={clock} focus={focus} onFocusChange={(k) => { setFollowing(null); setFocus(k); }} onReady={onReady}
        onFrame={(t, jumps) => mission.frame(t, jumps)} insetRight={inset}
        view={following === null ? { kind: 'focus', name: focusName(focus) } : { kind: 'follow', name: followName }}
        flying={flying} frame={frame} />
      <TimeBand clock={clock} mission={mission} consoleOpen={consoleOpen} onToggleConsole={() => setConsoleOpen(!consoleOpen)}
        following={following} onFollow={followCraft} />
      <BodyRail clock={clock} focus={following === null ? focus : null} onSelect={(k) => { setFollowing(null); setFocus(k); scene.current?.focusOn(k); }}
        frame={frame} onFrame={setFrame}
        smallBodies={smallOn} onSmallBodies={(k, on) => { setSmallOn((s) => ({ ...s, [k]: on })); if (k === 'colours') scene.current?.smallBodies.setColourByGroup(on); else scene.current?.smallBodies.setGroup(k, on); }} />
      <Plate clock={clock} focus={focus} frame={frame} covered={consoleOpen && !wide} />
      {consoleOpen && (
        <div className="console-dock" id="flight-console" ref={dockRef}>
          <FlightConsole clock={clock} mission={mission} journey={journey} tab={tab} setTab={setTab} onClose={closeConsole}
            onFocusCraft={followCraft} autoPlan={init.plan} />
        </div>
      )}
    </div>
  );
}
