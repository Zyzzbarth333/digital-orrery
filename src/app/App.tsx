// src/app/App.tsx

import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { PHONE_QUERY, SIDE_QUERY, PhoneContext, useMedia } from './phone';
import { Sheet, type Stop } from './sheet';
import { Peek } from './peek';
import { CraftPeek } from './mission-panel';
import { SimClock } from './clock';
import { SceneView, type ViewStep } from '../scene/SceneView';
import { BodyRail, Plate, RATES, TimeBand, TimeControls, craftById } from './panels';
import { best, PER_GROUP, type FindApi, type FindHit } from './find';
import { KeySheet } from './key-sheet';
import { Stow, panels, usePins } from './stow';
import { OWN_KEYS, shortcuts } from './shortcuts';
import { installArrowGroups } from './arrow-groups';
import { typeStep } from './type-step';
import { FlightConsole, type ConsoleTab } from './console';
import { Mission } from './mission';
import { JourneyStore, useJourney } from './journey';
import { PlotTable } from './plot-table';
import type { Frame, OrreryScene } from '../scene/OrreryScene';
import type { GuideKey } from '../scene/guides';
import type { FlowFrame, FlowPlane } from '../scene/gravityFlow';
import type { MagneticKey } from '../scene/magnetic';
import { BARYS, BODIES, BARY_BY_KEY, BODY_BY_KEY, focusName, isBary, systemOf, type BodyKey, type FocusKey } from '../scene/catalogue';
import { SMALL_BODY_GROUPS, type Named, type SmallBodyGroup } from '../scene/smallBodies';
import { SB_GROUPS } from '@digital-orrery/physics/smallBodies.js';
import { IRREGULAR_MOONS, irregularMoon } from '../scene/irregularMoons';
import { LANDING_SITES, SITE_BY_KEY, siteBody } from '@digital-orrery/physics/landingSites.js';
import { LandingSitePlate, siteBodyName } from './landing-site-plate';
import { GuidePlate, OrbitPlate, type GuidePick } from './guide-plate';
import { StarPlate } from './star-plate';
import { starTitle, bayerLabel } from '../scene/skyCatalogue';
import type { NamedSat, SatSource, SatCloud, SatLayerKey } from '../scene/satellites';
import { SatelliteRail, type SatelliteApi } from './satellite-rail';
import { SatellitePlate, SatCloudPlate } from './satellite-plate';
import { SpacecraftRail, type SpacecraftApi } from './spacecraft-rail';
import { SpacecraftPlate } from './spacecraft-plate';
import { PROBE_GROUPS, type Probe } from '../scene/spacecraftLayer';
// The chart view (chart-view.tsx), loaded the first time it is opened.
const ChartView = lazy(() => import('./chart-view'));
import { LAYERS_KEY, VIEW_KEY, clearStore, parseLayers, parseView, readStore, resumeTime, writeStore } from './remember.js';

// What a refresh comes back to (remember.js, docs/frontend/camera.md#across-a-refresh):
// the view from this tab's sessionStorage, the rail's switches from localStorage.
const session = (() => { try { return window.sessionStorage; } catch { return undefined; } })();
const local = (() => { try { return window.localStorage; } catch { return undefined; } })();
// URL parameters that set the start: any of them, and the kept view is not used.
const VIEW_PARAMS = ['focus', 't', 'view', 'phase', 'craft', 'mission', 'plan'];

// Optional start state from the URL: ?focus=mars&t=2030-01-01T00:00Z&view=sun
// (focus may be a barycentre: ssb, emb, jupiter-bary; &frame=ssb gives
// orbits and distances about the solar system barycentre)
// (or &phase=90: the camera at that angle from the Sun, seen from the body).
// Missions too: &craft=orbit,400,51.6 (altitude km, inclination deg) or
// &craft=departure,2.95,prograde (v_inf km/s, direction), followed by the
// camera, carrying an attitude (6-DOF) unless a fourth field says point
// (&craft=orbit,400,51.6,point); &plan=mars opens the planner and computes the grid.
// Real missions: &mission=artemis2 (or artemis2,first to fly only the first
// burn), &fix=12 for a tracking fix every 12 h; with &t= inside the mission
// the craft starts where the real one was then.
// Without them, a view kept from before a refresh in this tab, if any.
const isFocus = (f: string | null): f is FocusKey => !!f && (f in BODY_BY_KEY || f in BARY_BY_KEY);
function initialState(): { focus: FocusKey; frame: Frame | null; timeMs: number; tGiven: boolean; sunView: boolean; phaseDeg: number; craft: string | null; plan: string | null; real: string | null; fix: number | null; kept: ReturnType<typeof parseView> } {
  const q = new URLSearchParams(window.location.search);
  const f = q.get('focus');
  const t = Date.parse(q.get('t') ?? '');
  const v = VIEW_PARAMS.some((k) => q.has(k)) ? null : parseView(readStore(session, VIEW_KEY));
  const kept = v && isFocus(v.focus) ? v : null;
  return {
    focus: isFocus(f) ? f : kept ? (kept.focus as FocusKey) : 'sun',
    frame: q.get('frame') === 'ssb' ? 'ssb' : q.get('frame') === 'sun' ? 'sun' : null,
    timeMs: Number.isFinite(t) ? t : kept?.clock ? resumeTime(kept.clock, kept.savedAt, Date.now()) : Date.now(),
    kept,
    tGiven: Number.isFinite(t),
    real: q.get('mission'),
    fix: Number(q.get('fix')) || null,
    sunView: q.get('view') === 'sun' || q.has('phase'),
    phaseDeg: Number(q.get('phase') ?? 20),
    craft: q.get('craft'),
    plan: q.get('plan'),
  };
}

// FIND's planets and major moons (the rail's BODIES list and its moon
// grids), the Sun and the barycentres among them, each with its kind.
const FIND_BODIES: { key: FocusKey; names: string[]; kind: string }[] = [
  ...BODIES.map((b) => ({
    key: b.key as FocusKey, names: [b.name],
    kind: b.key === 'sun' ? 'star' : b.key === 'pluto' ? 'dwarf planet' : b.parent && b.parent !== 'sun' ? `moon of ${BODY_BY_KEY[b.parent].name}` : 'planet',
  })),
  ...BARYS.map((b) => ({ key: b.key as FocusKey, names: [b.name, b.short === 'Barycentre' ? '' : b.short], kind: 'barycentre' })),
];
// What FIND's line says when a found one's layer was off.
const SMALL_SHOWN: Record<SmallBodyGroup, string> = {
  belt: 'Main belt shown', neo: 'Near-Earth asteroids shown', trojans: 'Trojans shown', outer: 'Kuiper belt shown', comets: 'Comets shown',
};
const SAT_SHOWN: Record<SatLayerKey, string> = {
  active: 'Satellites shown', debris: 'Debris clouds shown', 'rocket-bodies': 'Rocket bodies shown', analyst: 'Analyst objects shown',
};
const PROBE_WHERE = Object.fromEntries(PROBE_GROUPS.map((g) => [g.key,
  g.key === 'cruise' ? 'in cruise' : g.key === 'lagrange' ? 'near Sun-Earth L1 or L2' : g.key === 'moon' ? 'at the Moon' : `at ${g.label}`])) as Record<Probe['group'], string>;

// A memoised object with workers, started once React keeps it and disposed
// once nothing holds it: replaced by a hot reload of this file (Fast
// Refresh runs useMemo again, so each reload made a Mission whose kernel
// worker ran on for good) or unmounted. StrictMode's development double
// render builds one it throws away, which is never started (its workers
// start lazily), and its double effect runs the cleanup and then the
// set-up again on the same object at once, so the cleanup only lets go,
// and the object is disposed a task later if no set-up has taken it back.
const held = new Map<object, number>();
function useLifetime(obj: { start?(): void; dispose(): void }): void {
  useEffect(() => {
    held.set(obj, (held.get(obj) ?? 0) + 1);
    obj.start?.();
    return () => {
      held.set(obj, (held.get(obj) ?? 1) - 1);
      setTimeout(() => { if (!held.get(obj)) { held.delete(obj); obj.dispose(); } }, 0);
    };
  }, [obj]);
}

export function App() {
  const init = useMemo(initialState, []);
  const clock = useMemo(() => {
    const c = new SimClock(init.timeMs);
    if (init.kept?.clock) { c.setRate(init.kept.clock.rate); c.setPlaying(init.kept.clock.playing); }
    return c;
  }, [init]);
  // The rail's switches as this browser last left them (the URL's &frame= first).
  const saved = useMemo(() => parseLayers(readStore(local, LAYERS_KEY)), []);
  const [focus, setFocus] = useState<FocusKey>(init.focus);
  const [frame, setFrame] = useState<Frame>(init.frame ?? saved.frame);
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
  // Which side panels are pinned beside the sky; the rest are stowed (stow.tsx).
  const pins = usePins();
  // A phone (docs/frontend/phone.md): the sky under a slim band, and one
  // sheet with three stops; on a short touch screen the sheet is on the right.
  const phone = useMedia(PHONE_QUERY);
  const side = useMedia(SIDE_QUERY) && phone;
  // The sheet always opens at peek, even after a refresh that restores the view.
  const [stop, setStop] = useState<Stop>('peek');
  // Leaving the phone layout lowers it, so coming back starts at peek too.
  useEffect(() => { if (!phone) setStop('peek'); }, [phone]);
  // How much of the sky the sheet covers at rest, for the camera's offset.
  const [cover, setCover] = useState({ bottom: 0, right: 0 });
  // Where the view plate and the touch hint go on a phone (the sheet's top
  // edge, the peek), once they are mounted.
  const [plateHost, setPlateHost] = useState<HTMLDivElement | null>(null);
  const [hintHost, setHintHost] = useState<HTMLDivElement | null>(null);
  // How much of the sky the console covers on the right (none where it
  // docks below the sky on a phone): the 3D view keeps the body clear of it.
  const dockRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!consoleOpen || !dock || phone) { setInset(0); return; }
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
  }, [consoleOpen, phone]);
  const mission = useMemo(() => new Mission(), []);
  // ?debug exposes the mission as window.mission (as the scene's
  // window.orrery), for headless checks of the craft's state.
  if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as { mission: Mission }).mission = mission;
  const journey = useMemo(() => new JourneyStore(init.timeMs), [init]);
  // And the plotting table's journey as window.journey, so a check can set
  // a journey to the second (scripts/check-remedy.mjs).
  if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as { journey: JourneyStore }).journey = journey;
  useLifetime(mission);
  useLifetime(journey);
  const scene = useRef<OrreryScene | null>(null);
  // The plotting table covers the sky, which pauses behind it.
  useJourney(journey);
  useEffect(() => { scene.current?.setPaused(journey.plotOpen); }, [journey.plotOpen]);
  const launched = useRef(false);
  const [following, setFollowing] = useState<number | null>(null);
  // A named asteroid or comet the camera is on (its marker or the rail's
  // list): the plate shows it until a body or a craft is chosen.
  const [small, setSmall] = useState<string | null>(null);
  const [named, setNamed] = useState<readonly Named[]>([]);
  const smallBody = small ? named.find((b) => b.pdes === small) ?? null : null;
  // An irregular moon is a small focus too, as 'irr:<key>' (OrreryScene.focusOnSmall).
  const irregularMoonOn = small?.startsWith('irr:') ? irregularMoon(small.slice(4)) ?? null : null;
  const [irregularOn, setIrregularOn] = useState(saved.irregular);
  // A landing site on the Moon too, as 'site:<key>' (OrreryScene.focusOnSite).
  const siteView = small?.startsWith('site:') ? SITE_BY_KEY[small.slice(5)] ?? null : null;
  const [sitesOn, setSitesOn] = useState(saved.sites);
  // Search any of the 135,353 (the rail's FIND field): a found point joins
  // the named ones and is flown to as they are.
  const smallSearch = useMemo(() => ({
    search: (q: string, limit?: number) => scene.current?.smallBodies.search(q, limit) ?? Promise.resolve([]),
    load: () => scene.current?.smallBodies.loadIndex() ?? Promise.resolve(null),
    pick: (j: number) => { const key = scene.current?.smallBodies.adopt(j); if (key) scene.current?.focusOnSmall(key); },
    get count() { return scene.current?.smallBodies.count ?? 0; },
  }), []);
  // An Earth satellite the camera is on (its marker, the rail's list or its
  // search), by NORAD id: the plate shows it until a body, craft or small
  // body is chosen.
  const [sat, setSat] = useState<number | null>(null);
  const [satLayers, setSatLayers] = useState<Record<SatLayerKey, boolean>>(saved.sats);
  // A debris cloud the camera is framing (the rail's Fly-to list), by key.
  const [satCloud, setSatCloud] = useState<string | null>(null);
  const [satClouds, setSatClouds] = useState<readonly SatCloud[]>([]);
  const [satNamed, setSatNamed] = useState<{ named: readonly NamedSat[]; source: SatSource | null }>({ named: [], source: null });
  // Each layer's switch, as the rail holds it: FIND switches one on through
  // the same state when what it found is hidden.
  const setSatLayer = (k: SatLayerKey, on: boolean) => { setSatLayers((l) => ({ ...l, [k]: on })); scene.current?.satellites.setLayer(k, on); if (k === 'debris' && !on) setSatCloud(null); };
  const satApi: SatelliteApi = {
    layers: satLayers,
    setLayer: setSatLayer,
    named: satNamed.named, source: satNamed.source, current: sat, clouds: satClouds, cloud: satCloud,
    fly: (id) => scene.current?.focusOnSatellite(id), flyCloud: (key) => scene.current?.focusOnSatCloud(key),
    latest: () => scene.current?.satellites.fetchLatest() ?? Promise.resolve('The scene is not ready'),
  };
  const satView = sat !== null ? scene.current?.satellites.sat(sat) ?? null : null;
  // The chart view (chart-view.tsx, K; docs/frontend/chart.md): a flat
  // chart of the body in view (a landing site's body; the Earth for a
  // satellite or a debris cloud; a followed craft's primary), in the sky's
  // cell, the sky paused behind it.
  const [chartOn, setChartOn] = useState(false);
  const followPrimary = useSyncExternalStore(mission.subscribe, () => (craftById(mission, following)?.craft.kState?.primary as string | undefined) ?? null);
  const chartBody: BodyKey | null = (() => {
    if (sat !== null || satCloud !== null) return 'earth';
    if (followPrimary && followPrimary !== 'sun' && followPrimary in BODY_BY_KEY) return followPrimary as BodyKey;
    if (siteView) { const b = siteBody(siteView); return b in BODY_BY_KEY ? (b as BodyKey) : null; }
    const k = systemOf(focus);        // a barycentre's own body
    return k === 'sun' ? null : k;
  })();
  const chartable = !!chartBody && !!scene.current?.hasDayMap(chartBody);
  useEffect(() => { if (chartOn && !chartable) setChartOn(false); }, [chartOn, chartable]);
  const cloudView = satCloud !== null ? scene.current?.satellites.cloudView(satCloud) ?? null : null;
  // A spacecraft beyond Earth orbit the camera is on, by key: it shares the
  // satellite's place on the plate.
  const [probe, setProbe] = useState<string | null>(null);
  const [probeOn, setProbeOn] = useState(saved.probes);
  const [probes, setProbes] = useState<{ craft: readonly Probe[]; fetched: string | null }>({ craft: [], fetched: null });
  const setProbeLayer = (on: boolean) => { setProbeOn(on); scene.current?.spacecraft.setOn(on); };
  const probeApi: SpacecraftApi = {
    on: probeOn, setOn: setProbeLayer,
    craft: probes.craft, fetched: probes.fetched, current: probe, fly: (key) => scene.current?.focusOnProbe(key),
  };
  const probeView = probe !== null ? probes.craft.find((c) => c.key === probe) ?? null : null;
  const [smallOn, setSmallOn] = useState<Record<string, boolean>>(saved.small);
  const [guidesOn, setGuidesOn] = useState<Record<GuideKey | MagneticKey, boolean>>(saved.guides);
  const [flowOpts, setFlowOpts] = useState<{ frame: FlowFrame; plane: FlowPlane }>(saved.flow);
  const [skyOn, setSkyOn] = useState<{ lines: boolean; names: boolean }>(saved.sky);
  // Every switch, kept for this browser as it changes.
  useEffect(() => {
    writeStore(local, LAYERS_KEY, JSON.stringify({ small: smallOn, irregular: irregularOn, sites: sitesOn, sats: satLayers, probes: probeOn, guides: guidesOn, flow: flowOpts, frame, sky: skyOn }));
  }, [smallOn, irregularOn, sitesOn, satLayers, probeOn, guidesOn, flowOpts, frame, skyOn]);
  const setGuide = (k: GuideKey | MagneticKey, on: boolean) => {
    setGuidesOn((g) => ({ ...g, [k]: on }));
    if (k === 'magnetic' || k === 'aurora' || k === 'belts') scene.current?.magnetic.set(k, on); else scene.current?.guides.set(k, on);
  };
  const setSmallLayer = (k: SmallBodyGroup | 'colours', on: boolean) => {
    setSmallOn((s) => ({ ...s, [k]: on }));
    if (k === 'colours') scene.current?.smallBodies.setColourByGroup(on); else scene.current?.smallBodies.setGroup(k, on);
  };
  const setIrregularLayer = (on: boolean) => { setIrregularOn(on); scene.current?.irregulars.setOn(on); };
  const setSitesLayer = (on: boolean) => { setSitesOn(on); scene.current?.sites.setOn(on); };
  const setSkyLayer = (k: 'lines' | 'names', on: boolean) => {
    setSkyOn((s) => ({ ...s, [k]: on }));
    if (k === 'lines') scene.current?.sky.setLines(on); else scene.current?.sky.setNames(on);
  };
  // The ? sheet of keyboard shortcuts (key-sheet.tsx).
  const [keysOpen, setKeysOpen] = useState(false);
  // Whether the camera is panned off what it is on (the view plate offers the way back).
  const [panned, setPanned] = useState(false);
  // The view, kept for this tab every second and as the page goes, for a
  // refresh to come back to (sessionStorage: a new tab starts at home).
  useEffect(() => {
    const keep = () => {
      const sc = scene.current;
      const s = clock.snapshot;
      const v = sc ? sc.viewState() : { focus, on: null, cam: null };
      writeStore(session, VIEW_KEY, JSON.stringify({ ...v, clock: { timeMs: s.timeMs, rate: s.rate, playing: s.playing }, savedAt: Date.now() }));
    };
    const timer = setInterval(keep, 1000);
    window.addEventListener('pagehide', keep);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', keep); };
  }, [clock, focus]);
  // A step of the view: the plate's pad, Shift and the arrows, [ and ].
  const VIEW_TURN = Math.PI / 12, VIEW_ZOOM = 1.25;
  const viewStep = (s: ViewStep) => {
    const sc = scene.current;
    if (!sc) return;
    if (s === 'in' || s === 'out') sc.zoomStep(s === 'in' ? 1 / VIEW_ZOOM : VIEW_ZOOM);
    else sc.turn(s === 'left' ? VIEW_TURN : s === 'right' ? -VIEW_TURN : 0, s === 'up' ? -VIEW_TURN : s === 'down' ? VIEW_TURN : 0);
  };
  // HOME: the view a first visit opens on (the clock and the switches stay as they are).
  const goHome = () => {
    setFollowing(null); setSmall(null); setSat(null); setSatCloud(null); setProbe(null); setFocus('sun');
    clearStore(session, VIEW_KEY);
    scene.current?.home();
  };
  // The followed craft's name, kept current (a rocket's climb included).
  const followName = useSyncExternalStore(mission.subscribe, () => craftById(mission, following)?.name ?? 'Craft');
  const followCraft = (id: number) => { mission.select(id); scene.current?.focusOnCraft(id); setFollowing(id); setSmall(null); setSat(null); setSatCloud(null); setProbe(null); };
  // A body, a moon or a barycentre, from the rail or FIND.
  // A guide's tag or an orbit line clicked (guide-plate.tsx): its plate
  // shows until the view changes (another body, craft or pick) or a body
  // is chosen in the rail.
  const [info, setInfo] = useState<{ guide?: GuidePick; orbit?: BodyKey; star?: number; view: string } | null>(null);
  const chooseBody = (k: FocusKey) => { setInfo(null); setFollowing(null); setSmall(null); setSat(null); setSatCloud(null); setProbe(null); setFocus(k); scene.current?.focusOn(k); };

  // The rail's FIND field (find.tsx): every kind the app flies to, in one
  // search. A pick flies as the rail's own controls do; where the found
  // one's layer is off, it is switched on first through the same state as
  // its switch (live: the switches now, as the picks read them later).
  const live = useRef({ smallOn, satLayers, irregularOn, sitesOn, probeOn, skyOn });
  live.current = { smallOn, satLayers, irregularOn, sitesOn, probeOn, skyOn };
  // A star chosen (in the sky or from FIND): its plate (a stowed plate
  // opens to show it, as for a guide), and its ring in the sky.
  const chooseStar = (i: number) => {
    setInfo({ star: i, view: viewKey.current });
    panels.open('plate');
    // Named once the catalogue is in (the first pick may come before it).
    void scene.current?.sky.load().then(() => setInfo((x) => (x?.star === i ? { ...x } : x)), () => {});
  };
  // The catalogues fetched on FIND's first focus: the spacecraft's index,
  // and the satellites' named ones and debris clouds (before their sets load).
  const findCat = useRef<{ probes: readonly Probe[]; named: readonly NamedSat[]; clouds: readonly SatCloud[] }>({ probes: [], named: [], clouds: [] });
  const find = useMemo<FindApi>(() => {
    const satOn = (k: SatLayerKey) => { if (live.current.satLayers[k]) return null; setSatLayer(k, true); return SAT_SHOWN[k]; };
    // A set switched on now loads first (its 0.1 to 2.5 MB): fly once it has.
    const whenSet = (k: SatLayerKey, fly: () => void) => { void scene.current?.satellites.ready(k).then((ok) => { if (ok) fly(); }); };
    return {
      load: () => [
        smallSearch.load(),
        (scene.current?.spacecraft.loadIndex() ?? Promise.resolve([])).then((probes) => { findCat.current.probes = probes; }),
        (scene.current?.satellites.catalogue() ?? Promise.resolve({ named: [], clouds: [] })).then((c) => { findCat.current.named = c.named; findCat.current.clouds = c.clouds; }),
        scene.current?.sky.load() ?? Promise.resolve(null),
      ],
      now: (q) => {
        const hits: FindHit[] = [];
        for (const b of best(FIND_BODIES, q, (b) => b.names)) {
          hits.push({ id: `body:${b.key}`, group: 'bodies', label: focusName(b.key), kind: b.kind, pick: () => { chooseBody(b.key); return null; } });
        }
        for (const m of best(IRREGULAR_MOONS, q, (m) => [m.name])) {
          hits.push({
            id: `irr:${m.key}`, group: 'irregular', label: m.name, kind: `moon of ${BODY_BY_KEY[m.planet].name}${m.retrograde ? ', retrograde' : ''}`,
            pick: () => { const was = live.current.irregularOn; if (!was) setIrregularLayer(true); scene.current?.focusOnSmall(`irr:${m.key}`); return was ? null : 'Irregular moons shown'; },
          });
        }
        // Satellites: the debris clouds, every one in a set that has loaded
        // (by name, NORAD number or designator), and, before the active set
        // has loaded, its named ones from satellites.json.
        const sats = scene.current?.satellites;
        if (sats) {
          const sat: FindHit[] = [];
          for (const c of best(findCat.current.clouds, q, (c) => [c.name, `${c.name} debris`])) {
            sat.push({
              id: `cloud:${c.key}`, group: 'satellites', label: `${c.name} debris`, kind: `debris cloud, ${c.date.slice(0, 4)}`,
              pick: () => { const said = satOn('debris'); whenSet('debris', () => scene.current?.focusOnSatCloud(c.key)); return said; },
            });
          }
          const found = sats.search(q, PER_GROUP);
          for (const h of found) {
            const id = Number(h.des);
            sat.push({
              id: `sat:${id}`, group: 'satellites', label: h.label, kind: h.kind,
              pick: () => { const said = satOn(h.layer); sats.adoptId(id); scene.current?.focusOnSatellite(id); return said; },
            });
          }
          if (!sats.loaded('active')) {
            const named = findCat.current.named.filter((n) => !found.some((h) => h.des === String(n.id)));
            for (const n of best(named, q, (n) => [n.name, String(n.id)])) {
              sat.push({
                id: `sat:${n.id}`, group: 'satellites', label: `${n.name} · ${n.id}`, kind: 'satellite',
                pick: () => { const said = satOn('active'); whenSet('active', () => { sats.adoptId(n.id); scene.current?.focusOnSatellite(n.id); }); return said; },
              });
            }
          }
          hits.push(...sat.slice(0, PER_GROUP));
        }
        for (const c of best(findCat.current.probes.filter((c) => c.days > 0), q, (c) => [c.name, c.short])) {
          hits.push({
            id: `probe:${c.key}`, group: 'spacecraft', label: c.name, kind: `spacecraft ${PROBE_WHERE[c.group]}`,
            pick: () => { const was = live.current.probeOn; if (!was) setProbeLayer(true); scene.current?.focusOnProbe(c.key); return was ? null : 'Spacecraft shown'; },
          });
        }
        for (const site of best(LANDING_SITES, q, (s) => [s.name, s.place, siteBodyName(s)])) {
          const how = site.kind === 'crash' || site.impact ? 'crashed' : site.kind === 'estimate' ? 'landed, not found' : site.kind === 'crewed' ? 'crewed landing'
            : site.kind === 'entry' ? 'entry' : site.kind === 'touch' ? 'touchdown' : site.kind;
          hits.push({
            id: `site:${site.key}`, group: 'sites', label: site.name, kind: `${how} on ${siteBodyName(site)}, ${site.landed.slice(0, 4)}`,
            pick: () => { const was = live.current.sitesOn; if (!was) setSitesLayer(true); scene.current?.focusOnSite(site.key); return was ? null : 'Landing sites shown'; },
          });
        }
        // The stars: by name or designation (sky.searchIndex), or by HIP or HD number.
        const sky = scene.current?.sky, idx = sky?.searchIndex(), cat = sky?.ready;
        if (sky && idx && cat) {
          const starHit = (i: number): FindHit => {
            const n = cat.names.get(i), con = cat.constellations.find((c) => c.abbr === n?.con);
            const des = n?.iau ? (n && bayerLabel(n)) : null;
            return {
              id: `star:${i}`, group: 'stars', label: starTitle(n, cat.info.hip[i]),
              kind: [des, `V ${sky.magOf(i).toFixed(2)}`, con ? `in ${con.name}` : null].filter(Boolean).join(', '),
              pick: () => { scene.current?.turnToStar(i); chooseStar(i); return null; },
            };
          };
          const num = /^\s*(hip|hd)\s*(\d+)\s*$/i.exec(q);
          const byNum = num ? (num[1].toLowerCase() === 'hip' ? idx.byHip : idx.byHd).get(Number(num[2])) : undefined;
          if (byNum !== undefined) hits.push(starHit(byNum));
          else for (const e of best(idx.entries, q, (e) => e.names)) hits.push(starHit(e.index));
          for (const c of best(cat.constellations, q, (c) => [c.name, c.abbr, c.en, c.gen])) {
            hits.push({
              id: `con:${c.abbr}`, group: 'constellations', label: c.name, kind: c.en === c.name ? c.abbr : `${c.en}, ${c.abbr}`,
              pick: () => {
                const was = live.current.skyOn.lines;
                if (!was) setSkyLayer('lines', true);
                scene.current?.turnTo(sky.labelDir(c));
                return was ? null : 'Constellation lines shown';
              },
            });
          }
        }
        return hits;
      },
      // The asteroids and comets: a found point is adopted (smallBodies.ts),
      // its population switched on if it is off, and flown to.
      later: (q) => smallSearch.search(q, PER_GROUP).then((found) => found.map((h): FindHit => ({
        id: `sb:${h.des}`, group: 'small', label: h.label, kind: h.kind,
        pick: () => {
          const sc = scene.current, key = sc?.smallBodies.adopt(h.j);
          if (!sc || !key) return null;
          const cls = sc.smallBodies.body(key)?.cls ?? '';
          const g = SMALL_BODY_GROUPS.find((x) => (SB_GROUPS[x] as string[]).includes(cls)) ?? 'belt';
          const was = live.current.smallOn[g];
          if (!was) setSmallLayer(g, true);
          sc.focusOnSmall(key);
          return was ? null : SMALL_SHOWN[g];
        },
      }))),
    };
    // The picks use only state setters, the scene's ref and live.
  }, [smallSearch]);
  const onReady = (sc: OrreryScene) => {
    scene.current = sc;
    sc.onFrame = (t, jumps) => mission.frame(t, jumps);
    sc.craftSource = () => mission.views();
    sc.journeySource = () => journey.view();
    sc.journeyHandlers = journey.handlers;
    sc.setPaused(journey.plotOpen);
    sc.onCraftPick = (id) => { followCraft(id); openConsole('mission'); };
    sc.onFlight = setFlying;
    // A pick asks what it is: a stowed plate opens to say (stow.tsx).
    sc.onGuidePick = (guide) => { setInfo({ guide, view: viewKey.current }); panels.open('plate'); };
    sc.onOrbitPick = (orbit) => { setInfo({ orbit, view: viewKey.current }); panels.open('plate'); };
    // A click on empty sky closes a star's plate (and nothing else).
    sc.onStarPick = (i) => { if (i !== null) chooseStar(i); else setInfo((x) => (x?.star !== undefined ? null : x)); };
    sc.onSmallPick = (pdes) => { setFollowing(null); setSmall(pdes); setSat(null); setSatCloud(null); setProbe(null); };
    sc.onSatPick = (id) => { setFollowing(null); setSmall(null); setSat(id); setSatCloud(null); setProbe(null); };
    sc.onSatCloudPick = (key) => { setFollowing(null); setSmall(null); setSat(null); setSatCloud(key); setProbe(null); };
    sc.onProbePick = (key) => { setFollowing(null); setSmall(null); setSat(null); setSatCloud(null); setProbe(key); };
    sc.spacecraft.onIndex = (craft, fetched) => setProbes({ craft, fetched });
    sc.satellites.onNamed = (named, source) => setSatNamed({ named, source });
    sc.satellites.onClouds = setSatClouds;
    sc.smallBodies.onNamed = setNamed;
    if (sc.smallBodies.namedBodies.length) setNamed(sc.smallBodies.namedBodies);
    sc.onPan = setPanned;
    // The switches as they were kept: the scene starts with its defaults
    // (remember.js's DEFAULT_LAYERS), so only what differs is set.
    for (const [k, on] of Object.entries(smallOn)) {
      if (k === 'colours') { if (on) sc.smallBodies.setColourByGroup(true); } else if (!on) sc.smallBodies.setGroup(k as SmallBodyGroup, false);
    }
    if (irregularOn) sc.irregulars.setOn(true);
    if (sitesOn) sc.sites.setOn(true);
    if (skyOn.lines) sc.sky.setLines(true);
    if (skyOn.names) sc.sky.setNames(true);
    for (const [k, on] of Object.entries(satLayers)) if (on) sc.satellites.setLayer(k as SatLayerKey, true);
    if (probeOn) sc.spacecraft.setOn(true);
    sc.guides.setFlow(flowOpts.frame, flowOpts.plane);
    for (const [k, on] of Object.entries(guidesOn)) {
      if (!on) continue;
      if (k === 'magnetic' || k === 'aurora' || k === 'belts') sc.magnetic.set(k, true); else sc.guides.set(k as GuideKey, true);
    }
    // The view kept from before a refresh (none when the URL sets one).
    if (init.kept) sc.restoreView({ focus: init.kept.focus as FocusKey, on: init.kept.on, cam: init.kept.cam });
    if (init.sunView) sc.viewFromSun((init.phaseDeg * Math.PI) / 180);
    const [kind, a, b, flown] = (init.craft ?? '').split(',');
    // React's development double-mount builds the scene twice: a craft
    // launched for the first one is followed by the second too.
    if (launched.current && mission.selected) sc.focusOnCraft(mission.selected.id, true);
    if ((kind === 'orbit' || kind === 'departure') && !launched.current) {
      launched.current = true;                    // once, whatever React's mounts do
      if (flown === 'point') mission.sixdof = false;
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
  // through the bodies, N jumps to now, M opens the console, / finds, + and
  // - step the type and ? lists these (key-sheet.tsx). Ignored while a form
  // control has focus, for a key a focused control handled itself (an arrow
  // in a radio group, arrow-groups.ts), for Space on a focused control (a
  // switch toggles on Space), and, but for Escape, when the ?
  // sheet's switch has turned them off (shortcuts.ts, WCAG 2.1.4).
  useEffect(() => installArrowGroups(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // On a phone, Escape lowers the sheet to peek first (FIND's field
      // included, once its list is closed).
      if (e.key === 'Escape' && phone && stop !== 'peek') {
        setStop('peek'); (document.activeElement as HTMLElement | null)?.blur?.(); e.preventDefault(); return;
      }
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.altKey || e.ctrlKey || e.metaKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === ' ' && (e.target as Element | null)?.closest?.(OWN_KEYS)) return;
      // Escape stops a flight first (the scene handles that), then closes
      // the console.
      if (e.key === 'Escape') { if (consoleOpen) closeConsole(); return; }
      if (!shortcuts.get()) return;
      if (e.key === 'm' || e.key === 'M') { setConsoleOpen(!consoleOpen); e.preventDefault(); return; }
      // L and R pin or stow the rail (L1) and the plate (R1) beside the sky (stow.tsx).
      if (!phone && (e.key === 'l' || e.key === 'L' || e.key === 'r' || e.key === 'R')) {
        const id = e.key.toLowerCase() === 'l' ? 'rail' : 'plate';
        panels.pin(id, !panels.get()[id]); e.preventDefault(); return;
      }
      // / finds (the rail's FIND field); ? lists the keys (the sheet closes itself).
      if (e.key === '/') { if (!journey.plotOpen) { openFind(); e.preventDefault(); } return; }
      if (e.key === '?') { setKeysOpen(true); e.preventDefault(); return; }
      // + and - step the TYPE size (type-step.ts); = and _ are the same keys unshifted.
      if (e.key === '+' || e.key === '=') { typeStep.set(typeStep.get() + 1); e.preventDefault(); return; }
      if (e.key === '-' || e.key === '_') { typeStep.set(typeStep.get() - 1); e.preventDefault(); return; }
      // Shift and the arrows turn the view; [ and ] zoom it out and in.
      if (e.shiftKey && e.key.startsWith('Arrow')) { viewStep(e.key.slice(5).toLowerCase() as ViewStep); e.preventDefault(); return; }
      if (e.key === '[' || e.key === ']') { viewStep(e.key === ']' ? 'in' : 'out'); e.preventDefault(); return; }
      // H goes home; C puts the camera back on what it is on after a pan.
      // T types a date and time into the clock (panels.tsx ClockWindow).
      if (e.key === 't' || e.key === 'T') { document.querySelector<HTMLButtonElement>('.clock-entry')?.click(); e.preventDefault(); return; }
      // K switches to the chart of the body in view and back (chart-view.tsx).
      if (e.key === 'k' || e.key === 'K') { if (chartOn) setChartOn(false); else if (chartable) setChartOn(true); e.preventDefault(); return; }
      if (e.key === 'h' || e.key === 'H') { goHome(); e.preventDefault(); return; }
      if (e.key === 'c' || e.key === 'C') { scene.current?.recentre(); e.preventDefault(); return; }
      const s = clock.snapshot;
      const ri = Math.max(0, RATES.findIndex((r) => r.rate === s.rate));
      // From a barycentre, up and down step from its body.
      const bi = BODIES.findIndex((b) => b.key === (isBary(focus) ? systemOf(focus) : focus));
      if (e.key === ' ') clock.setPlaying(!s.playing);
      else if (e.key === 'ArrowRight') clock.setRate(RATES[Math.min(RATES.length - 1, ri + 1)].rate);
      else if (e.key === 'ArrowLeft') clock.setRate(RATES[Math.max(0, ri - 1)].rate);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const k = BODIES[e.key === 'ArrowDown' ? Math.min(BODIES.length - 1, bi + 1) : Math.max(0, bi - 1)].key;
        // From a small body, the scene's focus may already be this one.
        if (small !== null || sat !== null || satCloud !== null || probe !== null) { setSmall(null); setSat(null); setSatCloud(null); setProbe(null); scene.current?.focusOn(k); }
        setFocus(k);
      }
      else if (e.key === 'n' || e.key === 'N') clock.setTime(Date.now());
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clock, focus, consoleOpen, small, sat, satCloud, probe, journey, phone, stop, chartOn, chartable]);

  const view = [focus, small, sat, satCloud, probe, following].join('|');
  const viewKey = useRef(view);
  viewKey.current = view;
  const infoView = info && info.view === view ? info : null;
  // The ring round the star whose plate is open.
  const starShown = infoView?.star ?? null;
  useEffect(() => { scene.current?.sky.select(starShown); }, [starShown]);
  // The star whose plate is open names the phone's sheet (its peek shows
  // the star's values); the view plate still names what the camera is on.
  const skyCat = starShown !== null ? scene.current?.sky.ready : null;
  const starName = starShown !== null ? starTitle(skyCat?.names.get(starShown), skyCat?.info.hip[starShown]) : null;
  const viewName = following !== null ? followName : probeView?.name ?? siteView?.name ?? irregularMoonOn?.name ?? satView?.named.name ?? (cloudView ? `${cloudView.name} debris` : undefined) ?? smallBody?.name ?? focusName(focus);

  // FIND (the band's key on a phone, or /): the field, focused at once (a
  // phone shows its keyboard only for a focus inside the tap), and on a
  // phone the sheet at full with the field at its top, the console closed.
  function openFind() {
    const field = document.getElementById('find') as HTMLInputElement | null;
    // Beside the sky: a stowed rail opens first (an inert field takes no
    // focus), at once, as a key's action.
    if (!phone) {
      if (panels.get().rail) { field?.focus(); return; }
      panels.open('rail', 'key');
      requestAnimationFrame(() => document.getElementById('find')?.focus());
      return;
    }
    setConsoleOpen(false);
    setStop('full');
    const go = () => {
      const f = document.getElementById('find');
      const bodyEl = f?.closest('.sheet-body');
      if (!f || !bodyEl) return;
      // At peek the body is inert, and an inert field takes no focus: lift
      // it now, inside the tap (React leaves it lifted at full).
      bodyEl.removeAttribute('inert');
      f.focus({ preventScroll: true });
      const box = f.closest('.find') ?? f;
      bodyEl.scrollTop += box.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top;
    };
    go();
    // With the console open the field mounts on the next render.
    requestAnimationFrame(go);
  }
  // On a phone: choosing something from the open sheet (a body row, a FIND
  // match) lowers it to half, its plate at the top over the sky; CONSOLE
  // opens it at half.
  const lastView = useRef(view);
  // When the user last pressed or typed inside the sheet: a view change
  // that soon after was their choice there; one that wasn't (a followed
  // craft ending, a flight finishing) leaves the sheet where it is.
  const sheetUsed = useRef(0);
  useEffect(() => {
    const mark = (e: Event) => { if ((e.target as Element | null)?.closest?.('.sheet')) sheetUsed.current = performance.now(); };
    window.addEventListener('pointerdown', mark, true);
    window.addEventListener('keydown', mark, true);
    return () => { window.removeEventListener('pointerdown', mark, true); window.removeEventListener('keydown', mark, true); };
  }, []);
  useEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    if (phone && stop === 'full' && performance.now() - sheetUsed.current < 2000) {
      if ((document.activeElement as HTMLElement | null)?.closest('.sheet')) (document.activeElement as HTMLElement).blur();
      setStop('half');
    }
  }, [view, phone, stop]);
  const wasOpen = useRef(consoleOpen);
  useEffect(() => {
    if (consoleOpen && !wasOpen.current && phone) setStop('half');
    wasOpen.current = consoleOpen;
  }, [consoleOpen, phone]);

  const plate = (
    <Plate clock={clock} focus={focus} frame={frame} covered={consoleOpen && !wide && !phone && pins.plate} small={smallBody} irregular={infoView ? null : irregularMoonOn}
      sat={infoView?.star !== undefined && scene.current ? <StarPlate index={infoView.star} sky={scene.current.sky} />
        : infoView?.guide ? <GuidePlate clock={clock} pick={infoView.guide} />
        : infoView?.orbit ? <OrbitPlate clock={clock} body={infoView.orbit} />
        : siteView ? <LandingSitePlate clock={clock} site={siteView} />
        : probeView && scene.current ? <SpacecraftPlate clock={clock} probe={probeView} layer={scene.current.spacecraft} />
        : satView ? <SatellitePlate clock={clock} sat={satView} source={scene.current?.satellites.sourceOf(satView.named.id) ?? satNamed.source} track={scene.current?.groundTrack ?? null} />
        : cloudView ? <SatCloudPlate cloud={cloudView} /> : null} />
  );
  const flight = { mission, consoleOpen, onToggleConsole: () => setConsoleOpen(!consoleOpen), following, onFollow: followCraft };
  const rail = (
    <BodyRail clock={clock} focus={following === null && small === null && sat === null && satCloud === null && probe === null ? focus : null} onSelect={chooseBody}
      find={find} onKeys={() => setKeysOpen((o) => !o)} onHover={(k) => scene.current?.setHover(k)}
      named={named} small={small} onSmall={(pdes) => scene.current?.focusOnSmall(pdes)}
      frame={frame} onFrame={setFrame}
      smallBodies={smallOn} onSmallBodies={setSmallLayer}
      satellites={<><SatelliteRail api={satApi} /><SpacecraftRail api={probeApi} /></>}
      guides={guidesOn} onGuides={setGuide}
      flow={flowOpts} onFlow={(o) => { setFlowOpts(o); scene.current?.guides.setFlow(o.frame, o.plane); }}
      irregular={{ on: irregularOn, onToggle: setIrregularLayer }}
      sites={{ on: sitesOn, onToggle: setSitesLayer, current: siteView?.key ?? null, onFly: (key) => scene.current?.focusOnSite(key) }}
      sky={{ lines: skyOn.lines, names: skyOn.names, onToggle: setSkyLayer }}
      time={phone ? <TimeControls clock={clock} {...flight} /> : undefined} />
  );
  const flightConsole = consoleOpen && (
    <div className="console-dock" id="flight-console" ref={dockRef}>
      <FlightConsole clock={clock} mission={mission} journey={journey} tab={tab} setTab={setTab} onClose={closeConsole}
        onFocusCraft={followCraft} autoPlan={init.plan} />
    </div>
  );

  // The scene keeps its place in the tree whichever layout shows, so a
  // window crossing 720 px never rebuilds it.
  return (
    <PhoneContext.Provider value={phone}>
    <div className={`app${phone ? ' phone' : ''}${side ? ' side' : ''}`}
      data-rail={phone ? undefined : pins.rail ? 'pinned' : 'stowed'} data-plate={phone ? undefined : pins.plate ? 'pinned' : 'stowed'}>
      <SceneView clock={clock} focus={focus} onFocusChange={(k) => { setFollowing(null); setSmall(null); setSat(null); setSatCloud(null); setProbe(null); setFocus(k); }} onReady={onReady}
        onFrame={(t, jumps) => mission.frame(t, jumps)} insetRight={phone ? cover.right : inset} insetBottom={phone ? cover.bottom : 0}
        view={following !== null ? { kind: 'follow', name: followName } : { kind: 'focus', name: viewName }}
        flying={flying} frame={frame} panned={panned} onCentre={() => scene.current?.recentre()} onHome={goHome} onView={viewStep}
        plateHost={phone && !side ? plateHost : null} hintHost={phone ? hintHost : null}
        chartOn={chartOn} chartName={chartBody ? BODY_BY_KEY[chartBody].name : null} onChart={chartable ? () => setChartOn(true) : undefined}
        chart={chartOn && chartBody && scene.current ? (
          <Suspense fallback={null}>
            <ChartView scene={scene.current} body={chartBody} clock={clock} phone={phone} insetRight={phone ? cover.right : inset} insetBottom={phone ? cover.bottom : 0}
              onClose={() => { setChartOn(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.chart-key')?.focus()); }}
              craft={() => mission.craftOrbit(following)} onSite={(key) => scene.current?.focusOnSite(key)} />
          </Suspense>
        ) : null} />
      <TimeBand clock={clock} {...flight} onFind={openFind} />
      {phone ? (
        <Sheet stop={stop} onStop={setStop} side={side} label="Readouts and controls" aboveRef={setPlateHost}
          onRest={(c) => setCover((o) => (o.bottom === c.bottom && o.right === c.right ? o : c))}
          peek={<Peek name={starName ?? viewName} hintRef={setHintHost} />}>
          {/* The plate stays mounted under the console: the peek reads its values. */}
          <div className="sheet-main" hidden={consoleOpen || undefined}>
            {plate}
            {rail}
          </div>
          {flightConsole}
          {following !== null && <CraftPeek clock={clock} mission={mission} id={following} />}
        </Sheet>
      ) : (
        <>
          <Stow id="rail" side="left" code="L1" name="bodies rail" keyName="L" wordmark legend="Bodies · Layers">{rail}</Stow>
          <Stow id="plate" side="right" code="R1" name="data plate" keyName="R" legend={<>Data · <span className="spine-view">{viewName}</span></>}>{plate}</Stow>
          {flightConsole}
        </>
      )}
      {journey.plotOpen && <PlotTable store={journey} clock={clock} mission={mission} onFlown={(id) => { setTab('mission'); followCraft(id); }} />}
      {keysOpen && <KeySheet onClose={() => setKeysOpen(false)} />}
    </div>
    </PhoneContext.Provider>
  );
}
