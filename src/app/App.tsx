// src/app/App.tsx

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SimClock } from './clock';
import { SceneView } from '../scene/SceneView';
import { BodyRail, Plate, RATES, TimeBand, craftById } from './panels';
import { best, PER_GROUP, type FindApi, type FindHit } from './find';
import { KeySheet } from './key-sheet';
import { FlightConsole, type ConsoleTab } from './console';
import { Mission } from './mission';
import { JourneyStore, useJourney } from './journey';
import { PlotTable } from './plot-table';
import type { Frame, OrreryScene } from '../scene/OrreryScene';
import type { GuideKey } from '../scene/guides';
import type { FlowFrame, FlowPlane } from '../scene/gravityFlow';
import type { MagneticKey } from '../scene/magnetic';
import { BARYS, BODIES, BARY_BY_KEY, BODY_BY_KEY, focusName, isBary, systemOf, type FocusKey } from '../scene/catalogue';
import { SMALL_BODY_GROUPS, type Named, type SmallBodyGroup } from '../scene/smallBodies';
import { SB_GROUPS } from '../physics/smallBodies.js';
import { IRREGULAR_MOONS, irregularMoon } from '../scene/irregularMoons';
import { LANDING_SITES, SITE_BY_KEY } from '../physics/landingSites.js';
import { LandingSitePlate } from './landing-site-plate';
import type { NamedSat, SatSource, SatCloud, SatLayerKey } from '../scene/satellites';
import { SatelliteRail, type SatelliteApi } from './satellite-rail';
import { SatellitePlate, SatCloudPlate } from './satellite-plate';
import { SpacecraftRail, type SpacecraftApi } from './spacecraft-rail';
import { SpacecraftPlate } from './spacecraft-plate';
import { PROBE_GROUPS, type Probe } from '../scene/spacecraftLayer';

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
  // ?debug exposes the mission as window.mission (as the scene's
  // window.orrery), for headless checks of the craft's state.
  if (new URLSearchParams(window.location.search).has('debug')) (window as unknown as { mission: Mission }).mission = mission;
  const journey = useMemo(() => new JourneyStore(init.timeMs), [init]);
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
  const [irregularOn, setIrregularOn] = useState(false);
  // A landing site on the Moon too, as 'site:<key>' (OrreryScene.focusOnSite).
  const siteView = small?.startsWith('site:') ? SITE_BY_KEY[small.slice(5)] ?? null : null;
  const [sitesOn, setSitesOn] = useState(false);
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
  const [satLayers, setSatLayers] = useState<Record<SatLayerKey, boolean>>({ active: false, debris: false, 'rocket-bodies': false, analyst: false });
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
  const cloudView = satCloud !== null ? scene.current?.satellites.cloudView(satCloud) ?? null : null;
  // A spacecraft beyond Earth orbit the camera is on, by key: it shares the
  // satellite's place on the plate.
  const [probe, setProbe] = useState<string | null>(null);
  const [probeOn, setProbeOn] = useState(false);
  const [probes, setProbes] = useState<{ craft: readonly Probe[]; fetched: string | null }>({ craft: [], fetched: null });
  const setProbeLayer = (on: boolean) => { setProbeOn(on); scene.current?.spacecraft.setOn(on); };
  const probeApi: SpacecraftApi = {
    on: probeOn, setOn: setProbeLayer,
    craft: probes.craft, fetched: probes.fetched, current: probe, fly: (key) => scene.current?.focusOnProbe(key),
  };
  const probeView = probe !== null ? probes.craft.find((c) => c.key === probe) ?? null : null;
  const [smallOn, setSmallOn] = useState<Record<string, boolean>>({ belt: true, neo: true, trojans: true, outer: true, comets: true, colours: false });
  const [guidesOn, setGuidesOn] = useState<Record<GuideKey | MagneticKey, boolean>>({ axes: false, field: false, spheres: false, lagrange: false, pulls: false, flow: false, magnetic: false, aurora: false, belts: false });
  const [flowOpts, setFlowOpts] = useState<{ frame: FlowFrame; plane: FlowPlane }>({ frame: 'falling', plane: 'orbit' });
  const setSmallLayer = (k: SmallBodyGroup | 'colours', on: boolean) => {
    setSmallOn((s) => ({ ...s, [k]: on }));
    if (k === 'colours') scene.current?.smallBodies.setColourByGroup(on); else scene.current?.smallBodies.setGroup(k, on);
  };
  const setIrregularLayer = (on: boolean) => { setIrregularOn(on); scene.current?.irregulars.setOn(on); };
  const setSitesLayer = (on: boolean) => { setSitesOn(on); scene.current?.sites.setOn(on); };
  // The ? sheet of keyboard shortcuts (key-sheet.tsx).
  const [keysOpen, setKeysOpen] = useState(false);
  // The followed craft's name, kept current (a rocket's climb included).
  const followName = useSyncExternalStore(mission.subscribe, () => craftById(mission, following)?.name ?? 'Craft');
  const followCraft = (id: number) => { mission.select(id); scene.current?.focusOnCraft(id); setFollowing(id); setSmall(null); setSat(null); setSatCloud(null); setProbe(null); };
  // A body, a moon or a barycentre, from the rail or FIND.
  const chooseBody = (k: FocusKey) => { setFollowing(null); setSmall(null); setSat(null); setSatCloud(null); setProbe(null); setFocus(k); scene.current?.focusOn(k); };

  // The rail's FIND field (find.tsx): every kind the app flies to, in one
  // search. A pick flies as the rail's own controls do; where the found
  // one's layer is off, it is switched on first through the same state as
  // its switch (live: the switches now, as the picks read them later).
  const live = useRef({ smallOn, satLayers, irregularOn, sitesOn, probeOn });
  live.current = { smallOn, satLayers, irregularOn, sitesOn, probeOn };
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
        for (const site of best(LANDING_SITES, q, (s) => [s.name])) {
          const how = site.kind === 'crash' || site.impact ? 'crashed' : site.kind === 'estimate' ? 'landed, not found' : site.kind === 'crewed' ? 'crewed landing' : site.kind;
          hits.push({
            id: `site:${site.key}`, group: 'sites', label: site.name, kind: `${how}, ${site.landed.slice(0, 4)}`,
            pick: () => { const was = live.current.sitesOn; if (!was) setSitesLayer(true); scene.current?.focusOnSite(site.key); return was ? null : 'Landing sites shown'; },
          });
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
    sc.onSmallPick = (pdes) => { setFollowing(null); setSmall(pdes); setSat(null); setSatCloud(null); setProbe(null); };
    sc.onSatPick = (id) => { setFollowing(null); setSmall(null); setSat(id); setSatCloud(null); setProbe(null); };
    sc.onSatCloudPick = (key) => { setFollowing(null); setSmall(null); setSat(null); setSatCloud(key); setProbe(null); };
    sc.onProbePick = (key) => { setFollowing(null); setSmall(null); setSat(null); setSatCloud(null); setProbe(key); };
    sc.spacecraft.onIndex = (craft, fetched) => setProbes({ craft, fetched });
    sc.satellites.onNamed = (named, source) => setSatNamed({ named, source });
    sc.satellites.onClouds = setSatClouds;
    sc.smallBodies.onNamed = setNamed;
    if (sc.smallBodies.namedBodies.length) setNamed(sc.smallBodies.namedBodies);
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
  // through the bodies, N jumps to now, M opens the console, / finds and ?
  // lists these (key-sheet.tsx). Ignored while a form control has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.altKey || e.ctrlKey || e.metaKey || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // Escape stops a flight first (the scene handles that), then closes
      // the console.
      if (e.key === 'Escape') { if (!e.defaultPrevented && consoleOpen) closeConsole(); return; }
      if (e.key === 'm' || e.key === 'M') { setConsoleOpen(!consoleOpen); e.preventDefault(); return; }
      // / finds (the rail's FIND field); ? lists the keys (the sheet closes itself).
      if (e.key === '/') { if (!journey.plotOpen) { document.getElementById('find')?.focus(); e.preventDefault(); } return; }
      if (e.key === '?') { setKeysOpen(true); e.preventDefault(); return; }
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
  }, [clock, focus, consoleOpen, small, sat, satCloud, probe, journey]);

  return (
    <div className="app">
      <SceneView clock={clock} focus={focus} onFocusChange={(k) => { setFollowing(null); setSmall(null); setSat(null); setSatCloud(null); setProbe(null); setFocus(k); }} onReady={onReady}
        onFrame={(t, jumps) => mission.frame(t, jumps)} insetRight={inset}
        view={following !== null ? { kind: 'follow', name: followName } : { kind: 'focus', name: probeView?.name ?? siteView?.name ?? irregularMoonOn?.name ?? satView?.named.name ?? (cloudView ? `${cloudView.name} debris` : undefined) ?? smallBody?.name ?? focusName(focus) }}
        flying={flying} frame={frame} />
      <TimeBand clock={clock} mission={mission} consoleOpen={consoleOpen} onToggleConsole={() => setConsoleOpen(!consoleOpen)}
        following={following} onFollow={followCraft} />
      <BodyRail clock={clock} focus={following === null && small === null && sat === null && satCloud === null && probe === null ? focus : null} onSelect={chooseBody}
        find={find} onKeys={() => setKeysOpen((o) => !o)}
        named={named} small={small} onSmall={(pdes) => scene.current?.focusOnSmall(pdes)}
        frame={frame} onFrame={setFrame}
        smallBodies={smallOn} onSmallBodies={setSmallLayer}
        satellites={<><SatelliteRail api={satApi} /><SpacecraftRail api={probeApi} /></>}
        guides={guidesOn} onGuides={(k, on) => { setGuidesOn((g) => ({ ...g, [k]: on })); if (k === 'magnetic' || k === 'aurora' || k === 'belts') scene.current?.magnetic.set(k, on); else scene.current?.guides.set(k, on); }}
        flow={flowOpts} onFlow={(o) => { setFlowOpts(o); scene.current?.guides.setFlow(o.frame, o.plane); }}
        irregular={{ on: irregularOn, onToggle: setIrregularLayer }}
        sites={{ on: sitesOn, onToggle: setSitesLayer, current: siteView?.key ?? null, onFly: (key) => scene.current?.focusOnSite(key) }} />
      <Plate clock={clock} focus={focus} frame={frame} covered={consoleOpen && !wide} small={smallBody} irregular={irregularMoonOn}
        sat={siteView ? <LandingSitePlate clock={clock} site={siteView} />
          : probeView && scene.current ? <SpacecraftPlate clock={clock} probe={probeView} layer={scene.current.spacecraft} />
          : satView ? <SatellitePlate clock={clock} sat={satView} source={scene.current?.satellites.sourceOf(satView.named.id) ?? satNamed.source} track={scene.current?.groundTrack ?? null} />
          : cloudView ? <SatCloudPlate cloud={cloudView} /> : null} />
      {consoleOpen && (
        <div className="console-dock" id="flight-console" ref={dockRef}>
          <FlightConsole clock={clock} mission={mission} journey={journey} tab={tab} setTab={setTab} onClose={closeConsole}
            onFocusCraft={followCraft} autoPlan={init.plan} />
        </div>
      )}
      {journey.plotOpen && <PlotTable store={journey} clock={clock} mission={mission} onFlown={(id) => { setTab('mission'); followCraft(id); }} />}
      {keysOpen && <KeySheet onClose={() => setKeysOpen(false)} />}
    </div>
  );
}
