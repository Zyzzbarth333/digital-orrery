// src/app/chart-view.tsx
//
// The chart view (PNL K1, docs/frontend/chart.md): a flat chart of the
// body in view, in the sky's cell, switched to from the 3D view (K, or the
// view plate's CHART key) and back (3D, K or Escape). In the tradition of
// the USGS planetary charts and the Apollo-era Lunar Astronautical Charts:
// shaded relief and elevation tints from the real elevation models, the
// graticule and the body's standard sheet grid, the IAU's names sized by
// the feature, and the app's landing sites; layers switch as NASA's
// Solar System Treks' do. On the Earth it is a planning map: the plate's
// satellite's ground track, the launch sites, an atlas grid, and a road
// atlas look (land tinted by height, the sea from pale to deep blue by
// ETOPO 2022's depths).
//
// The sky is paused behind it (OrreryScene.setChart) and the chart draws
// with the same renderer, so the 3D view's frame costs nothing more. The
// raster is ChartRenderer's shader; the lettering is a 2D canvas over it
// (overlay.ts), redrawn only when the view, the layers, the data or the
// pointer change, or the clock has moved enough for the night side or the
// track to have moved.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type * as THREE from 'three';
import { bodyState, type OrreryScene } from '../scene/OrreryScene';
import { BODY_BY_KEY, type BodyKey } from '../scene/catalogue';
import { eclToEqj } from '@digital-orrery/physics/ephemeris.js';
import { bodyAxesEqj } from '@digital-orrery/physics/orientation.js';
import { stateTeme } from '@digital-orrery/physics/satellites.js';
import { temeToItrf, subPoint } from '@digital-orrery/physics/passes.js';
import { LANDING_SITES, siteBody } from '@digital-orrery/physics/landingSites.js';
import { ChartRenderer, RAMPS, LAND_TOP_M, SEA_DEEP_M, type Viewport } from '../chart/ChartRenderer';
import { LAYER } from '../chart/chartMaterial';
import { Elevation, type ElevationEntry } from '../chart/elevation';
import { drawOverlay, drawFurniture, type Feature, type Hit, type OverlayInput, type Track } from '../chart/overlay';
import { inverse, wrapPi, type Proj, type View } from '../chart/projection';
import { SHEET_SETS, allSheets, sheetAt } from '../chart/sheets';
import { LAUNCH_SITES } from '../chart/launchSites';
import { SourceTag } from './source-tag';
import type { SimClock } from './clock';

const D = Math.PI / 180;
const DEBUG = new URLSearchParams(window.location.search).has('debug');
const PIXEL = new Uint8Array(4);
const ROOT = `${import.meta.env.BASE_URL}charts/`;
const PAPER_HEX = '#e9e3d6';
const PAPER: [number, number, number] = [0xe9 / 255, 0xe3 / 255, 0xd6 / 255];
const MARGIN = 22;          // the border round the map, for its figures
const POLAR_MAIN = 60 * D;  // a polar view reaches 60° from its pole
const POLAR_INSET = 35 * D; // an inset, 35° (to 55°): USGS's polar sheets reach 65°

interface NamesFile { types: Record<string, string>; features: [string, string, number, number, number, number][] }
interface BodyIndex { elevation?: ElevationEntry; names?: { path: string; count: number }; sheets?: { names: Record<string, string> } }
interface ChartIndex { bodies: Record<string, BodyIndex> }

let indexP: Promise<ChartIndex | null> | null = null;
const chartIndex = () => (indexP ??= fetch(`${ROOT}index.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null));
interface Names { features: Feature[]; regional: Set<string> }
const namesP = new Map<string, Promise<Names>>();
function namesOf(body: string, path: string): Promise<Names> {
  let p = namesP.get(body);
  if (!p) {
    p = fetch(ROOT + path).then((r) => r.json() as Promise<NamesFile>).then((n) => ({
      features: n.features.map(([name, type, lat, lon, diamKm, id]) => ({ name, type, lat: lat * D, lon: lon * D, diamKm, id })),
      // The regions (planitiae, terrae, maria...) are lettered in wide capitals.
      regional: new Set(Object.entries(n.types).filter(([, t]) => REGIONAL.test(t)).map(([k]) => k)),
    }));
    p.catch(() => namesP.delete(body));
    namesP.set(body, p);
  }
  return p;
}
// Bodies whose map is their clouds (textures.md): the chart's colour is not ground.
const CLOUDS = new Set(['venus', 'jupiter', 'saturn', 'uranus', 'neptune']);
const REGIONAL = /^(Planitia|Terra|Regio|Mare|Oceanus|Vastitas|Planum|Tessera|Albedo|Palus|Sinus|Lacus|Chaos|Labyrinthus)/;

// ---- the layers, kept for this browser (one set for the Earth, one for the rest)
type LayerKey = 'colour' | 'relief' | 'elevation' | 'night' | 'grid' | 'sheets' | 'names' | 'sites' | 'track' | 'pads' | 'atlas';
type Layers = Record<LayerKey, boolean>;
const BODY_DEFAULT: Layers = { colour: true, relief: true, elevation: false, night: false, grid: true, sheets: true, names: true, sites: true, track: false, pads: false, atlas: false };
const EARTH_DEFAULT: Layers = { colour: true, relief: true, elevation: false, night: true, grid: true, sheets: false, names: false, sites: false, track: true, pads: true, atlas: false };
const STORE = 'orrery.chart.v1';
function readLayers(): { body: Layers; earth: Layers } {
  const out = { body: { ...BODY_DEFAULT }, earth: { ...EARTH_DEFAULT } };
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    for (const k of ['body', 'earth'] as const) for (const l of Object.keys(out[k]) as LayerKey[]) if (typeof s?.[k]?.[l] === 'boolean') out[k][l] = s[k][l];
  } catch { /* private window, or nothing kept */ }
  return out;
}
const LAYER_KEYS: { key: LayerKey; label: string; title: string }[] = [
  { key: 'colour', label: 'Colour', title: 'The colour map the 3D view draws' },
  { key: 'relief', label: 'Relief', title: 'Shaded relief from the elevation model, lit from the upper left' },
  { key: 'elevation', label: 'Elevation', title: 'Tints by height (on the Earth, land and sea)' },
  { key: 'night', label: 'Night', title: 'The night side at the clock\'s time' },
  { key: 'grid', label: 'Grid', title: 'Latitude and longitude' },
  { key: 'sheets', label: 'Sheets', title: 'The standard map sheets (quadrangles)' },
  { key: 'names', label: 'Names', title: 'The IAU\'s feature names, sized by the feature' },
  { key: 'sites', label: 'Sites', title: 'Where craft have landed' },
  { key: 'track', label: 'Track', title: 'The ground track of the satellite on the plate' },
  { key: 'pads', label: 'Pads', title: 'Orbital launch sites' },
  { key: 'atlas', label: 'Atlas', title: 'The road atlas look: land tinted by height, the sea by depth, and an atlas grid' },
];

// The Sun's direction in the body's own frame (x to 0° longitude, z north), or null.
function sunFixed(key: BodyKey, ms: number): [number, number, number] | null {
  try {
    const d = new Date(ms), r = bodyState(key, d).r, n = Math.hypot(r[0], r[1], r[2]);
    if (!n) return null;
    const s = eclToEqj([-r[0] / n, -r[1] / n, -r[2] / n]) as number[], A = bodyAxesEqj(key, d) as number[][];
    const dot = (a: number[]) => a[0] * s[0] + a[1] * s[1] + a[2] * s[2];
    return [dot(A[0]), dot(A[1]), dot(A[2])];
  } catch { return null; }
}

type Sat = Parameters<typeof stateTeme>[0] & { omm: { MEAN_MOTION: number; OBJECT_NAME?: string } };
// The point under a satellite (geodetic, rad) from a quarter orbit ago to one and a half ahead.
function trackOf(sat: Sat, tMs: number): { line: [number, number][]; nowIndex: number } {
  const period = 86400e3 / sat.omm.MEAN_MOTION, t0 = tMs - period / 4, t1 = tMs + 1.5 * period, N = 421;
  const line: [number, number][] = [];
  let nowIndex = 0;
  for (let k = 0; k < N; k++) {
    const t = t0 + ((t1 - t0) * k) / (N - 1), s = stateTeme(sat, t);
    if (!s) continue;
    const r = s.r, M = temeToItrf(t);
    const p = subPoint([M[0][0] * r[0] + M[0][1] * r[1] + M[0][2] * r[2], M[1][0] * r[0] + M[1][1] * r[1] + M[1][2] * r[2], M[2][0] * r[0] + M[2][1] * r[1] + M[2][2] * r[2]]);
    if (t <= tMs) nowIndex = line.length;
    line.push([p.latDeg * D, p.lonDeg * D]);
  }
  return { line, nowIndex };
}

function fmtLat(r: number, dp: number): string { const d = r / D; return `${Math.abs(d).toFixed(dp)}° ${d >= 0 ? 'N' : 'S'}`; }
function fmtLon(r: number, dp: number, style: 'ew' | 'east'): string {
  const d = ((r / D) + 540) % 360 - 180;
  if (style === 'east') return `${((d + 360) % 360).toFixed(dp)}° E`;
  return `${Math.abs(d).toFixed(dp)}° ${d >= 0 ? 'E' : 'W'}`;
}
const fmtM = (m: number) => `${m < 0 ? '−' : ''}${Math.abs(Math.round(m)).toLocaleString('en-AU')} m`;

interface Readout { lat: number; lon: number; elev: number | null; fine: boolean; sheet: string | null; hit: Hit | null }

export default function ChartView({ scene, body, clock, phone, insetRight, insetBottom, onClose, onSite }: {
  scene: OrreryScene; body: BodyKey; clock: SimClock; phone: boolean; insetRight: number; insetBottom: number;
  onClose: () => void; onSite: (key: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const mapCell = useRef<HTMLDivElement>(null);
  const ink = useRef<HTMLCanvasElement>(null);
  const titleId = useId();
  const earth = body === 'earth';
  const [stored, setStored] = useState(readLayers);
  const layers = earth ? stored.earth : stored.body;
  const [proj, setProj] = useState<Proj>('eq');
  // The index's entry for this body (undefined until it is in): kept with its
  // body, so a render after a change of body never pairs one body's data with another.
  const [indexOf, setIndexOf] = useState<{ body: string; e: BodyIndex | null } | null>(null);
  const index = indexOf?.body === body ? indexOf.e : undefined;
  const [names, setNames] = useState<Names>({ features: [], regional: new Set() });
  const features = names.features;
  const [colourIn, setColourIn] = useState(false);
  const [readout, setReadout] = useState<Readout | null>(null);
  const [exag, setExag] = useState(1);
  const [trackName, setTrackName] = useState<string | null>(null);
  const name = BODY_BY_KEY[body]?.name ?? body;

  // Everything the frame loop reads, without re-rendering React.
  const S = useRef({
    dirty: true, lastT: NaN, lastWall: 0, cssW: 0, cssH: 0, frame: { x: 0, y: 0, w: 1, h: 1 },
    view: null as View | null, fitScale: 1, hits: [] as Hit[], hover: null as string | null,
    elev: null as Elevation | null, features: [] as Feature[], layers, proj, phone,
    pointers: new Map<number, { x: number; y: number }>(), pinch: 0,
    track: null as { sat: unknown; t: number; line: [number, number][]; nowIndex: number } | null,
  });
  const st = S.current;
  st.layers = layers; st.proj = proj; st.phone = phone; st.features = features;
  useEffect(() => { st.dirty = true; }, [layers, proj, phone, features, colourIn, insetRight, insetBottom]);

  const setLayer = (k: LayerKey, on: boolean) => {
    setStored((s) => {
      const cur = { ...(earth ? s.earth : s.body), [k]: on };
      // The atlas look tints by height instead of the colour map; off, back to colour.
      if (k === 'atlas') { cur.elevation = on; cur.colour = !on; }
      const next = earth ? { ...s, earth: cur } : { ...s, body: cur };
      try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private window */ }
      return next;
    });
  };

  // ---- data: the index, the names, the elevation, the colour map
  useEffect(() => { let on = true; void chartIndex().then((i) => { if (on) setIndexOf({ body, e: i?.bodies[body] ?? null }); }); return () => { on = false; }; }, [body]);
  useEffect(() => {
    setNames({ features: [], regional: new Set() });
    if (!index?.names) return;
    let on = true;
    void namesOf(body, index.names.path).then((n) => { if (on) setNames(n); }).catch(() => {});
    return () => { on = false; };
  }, [index, body]);
  const renderer = useMemo(() => new ChartRenderer(scene.renderer), [scene]);
  useEffect(() => () => renderer.dispose(), [renderer]);
  useEffect(() => {
    const e = index?.elevation;
    if (!e) { renderer.setElevation(null); st.elev = null; return; }
    const el = new Elevation(e, ROOT, name);
    st.elev = el;
    renderer.setStyle(earth, [e.p1M - 0.04 * (e.p99M - e.p1M), e.p99M + 0.04 * (e.p99M - e.p1M)], e.radiusKm);
    renderer.setElevation(el);
    el.onChange = () => { renderer.sync(); st.dirty = true; };
    void el.loadBase().catch(() => {});
    return () => { el.dispose(); if (st.elev === el) st.elev = null; };
  }, [index, body]);
  useEffect(() => {
    setColourIn(false);
    renderer.setColour(null);
    let on = true;
    const p = scene.chartMap(body);
    void p?.then((t: THREE.Texture) => { if (!on) return; renderer.setColour(t); setColourIn(true); }).catch(() => {});
    return () => { on = false; };
  }, [scene, body, renderer]);

  // ---- the view
  const radiusKm = index?.elevation?.radiusKm ?? BODY_BY_KEY[body]?.radiusKm ?? 1000;
  // The whole body in the view: the farthest out the chart zooms.
  const fit = (w: number, h: number, p: Proj): View => p === 'eq'
    ? { proj: 'eq', lon0: 0, lat0: 0, px: 0, py: 0, scale: Math.min(w / (2 * Math.PI), h / Math.PI), w, h }
    : { proj: p, lon0: 0, lat0: 0, px: 0, py: 0, scale: Math.min(w, h) / 2 / (2 * Math.tan(40 * D / 2)), w, h };
  // Where it opens: the whole body, except on a tall, narrow view (a phone
  // held upright), where it fills more of the height, up to four times the
  // width, and pans east and west.
  const opening = (w: number, h: number, p: Proj): View => {
    const v = fit(w, h, p);
    return p === 'eq' && h > 1.2 * w ? { ...v, scale: Math.min(h / Math.PI, (4 * w) / (2 * Math.PI)) } : v;
  };
  const reset = () => { const f = st.frame; st.view = opening(f.w, f.h, st.proj); st.fitScale = fit(f.w, f.h, st.proj).scale; st.dirty = true; };
  useEffect(() => { reset(); }, [proj, body]);

  useLayoutEffect(() => {
    const el = root.current, cell = mapCell.current, c = ink.current;
    if (!el || !cell || !c) return;
    const measure = () => {
      const r = el.getBoundingClientRect(), m = cell.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      st.cssW = r.width; st.cssH = r.height;
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      const x0 = Math.round(m.left - r.left + MARGIN), y0 = Math.round(m.top - r.top + MARGIN);
      const f = { x: x0, y: y0, w: Math.max(40, Math.round(m.right - r.left - MARGIN) - x0), h: Math.max(40, Math.round(m.bottom - r.top - MARGIN) - y0) };
      const v = st.view;
      st.frame = f;
      if (!v) reset();
      else {
        // A view still as it opened follows the new size; one zoomed in keeps its scale.
        const was = opening(v.w, v.h, v.proj).scale;
        st.view = { ...v, w: f.w, h: f.h, scale: Math.abs(v.scale - was) < 1e-6 ? opening(f.w, f.h, v.proj).scale : Math.max(v.scale, fit(f.w, f.h, v.proj).scale * 0.9) };
        st.fitScale = fit(f.w, f.h, v.proj).scale;
      }
      st.dirty = true;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el); ro.observe(cell);
    return () => ro.disconnect();
  }, []);

  const clamp = (v: View): View => {
    const fs = fit(v.w, v.h, v.proj).scale;
    const scale = Math.min(Math.max(v.scale, fs * 0.9), 16 * 4 / D);
    if (v.proj === 'eq') {
      const half = v.h / 2 / scale, lim = Math.max(0, Math.PI / 2 - half);
      return { ...v, scale, lat0: Math.max(-lim, Math.min(lim, v.lat0)), lon0: wrapPi(v.lon0) };
    }
    const R = 2 * Math.tan(POLAR_MAIN / 2) * scale;
    return { ...v, scale, px: Math.max(-R, Math.min(R, v.px)), py: Math.max(-R, Math.min(R, v.py)) };
  };
  const zoomAt = (k: number, x: number, y: number) => {
    const v = st.view;
    if (!v) return;
    const f = st.frame, cx = x - f.x - v.w / 2, cy = y - f.y - v.h / 2;
    const n = clamp({ ...v, scale: v.scale * k });
    const kk = n.scale / v.scale;
    if (v.proj === 'eq') { n.lon0 = v.lon0 + cx / v.scale - cx / n.scale; n.lat0 = v.lat0 - cy / v.scale + cy / n.scale; }
    else { n.px = cx - (cx - v.px) * kk; n.py = cy - (cy - v.py) * kk; }
    st.view = clamp(n); st.dirty = true;
  };
  const pan = (dx: number, dy: number) => {
    const v = st.view;
    if (!v) return;
    st.view = clamp(v.proj === 'eq' ? { ...v, lon0: v.lon0 - dx / v.scale, lat0: v.lat0 + dy / v.scale } : { ...v, px: v.px + dx, py: v.py + dy });
    st.dirty = true;
  };

  // The insets (desktop, simple cylindrical): the poles at the map's lower corners.
  const ports = (): (Viewport & { inset: 'n' | 's' | null })[] => {
    const v = st.view!, f = st.frame;
    const out: (Viewport & { inset: 'n' | 's' | null })[] = [{ view: v, x: f.x, y: f.y, limit: POLAR_MAIN, inset: null }];
    // Insets give the whole body's poles: once zoomed in past twice the
    // whole chart they would only cover the detail, so they go.
    if (v.proj === 'eq' && !st.phone && f.w > 560 && f.h > 360 && v.scale < 2 * st.fitScale) {
      const R = Math.round(Math.max(60, Math.min(104, Math.min(f.w, f.h) * 0.13)));
      const scale = R / (2 * Math.tan(POLAR_INSET / 2));
      const iv = (p: 'n' | 's'): View => ({ proj: p, lon0: 0, lat0: 0, px: 0, py: 0, scale, w: 2 * R, h: 2 * R });
      out.push({ view: iv('n'), x: f.x + 14, y: f.y + f.h - 2 * R - 58, limit: POLAR_INSET, inset: 'n' });
      out.push({ view: iv('s'), x: f.x + f.w - 2 * R - 14, y: f.y + f.h - 2 * R - 58, limit: POLAR_INSET, inset: 's' });
    }
    return out;
  };

  // ---- drawing, from the scene's frame loop
  const sheetSet = SHEET_SETS[body] ?? null;
  const sheets = useMemo(() => (sheetSet ? allSheets(sheetSet) : []), [sheetSet]);
  const siteMarks = useMemo(() => LANDING_SITES.filter((s) => siteBody(s) === body).map((s) => ({ key: s.key, name: s.name, lat: s.lat * D, lon: s.lon * D, kind: s.kind })), [body]);
  const padMarks = useMemo(() => (earth ? LAUNCH_SITES.map((p) => ({ key: p.key, name: p.name, pad: p.pad, lat: p.lat * D, lon: p.lon * D })) : []), [earth]);
  const regionalCodes = names.regional;

  const hasMap = scene.hasDayMap(body);
  const has = {
    colour: hasMap && colourIn, relief: !!index?.elevation, elevation: !!index?.elevation, night: true, grid: true,
    sheets: !!sheetSet, names: !!index?.names, sites: siteMarks.length > 0, track: earth, pads: earth, atlas: earth && !!index?.elevation,
  };
  const available = (k: LayerKey) => (k === 'colour' ? hasMap : has[k]);

  // What the draw reads that React holds, refreshed each render, so the
  // scene's hook is set once and the canvas never blanks between draws.
  const live = useRef({ index, sheets, siteMarks, padMarks, regionalCodes, radiusKm, has, trackName, body, earth });
  live.current = { index, sheets, siteMarks, padMarks, regionalCodes, radiusKm, has, trackName, body, earth };
  useEffect(() => {
    let last = 0;
    const draw = () => {
      const c = ink.current, v = st.view;
      if (!c || !v) return;
      const { index, sheets, siteMarks, padMarks, regionalCodes, radiusKm, has, trackName, body, earth } = live.current;
      const L = st.layers, t = clock.snapshot.timeMs, wall = performance.now();
      // The clock moves the night side and the satellite: a satellite's
      // diamond a few seconds of sim time, the terminator a minute.
      const dt = Math.abs(t - st.lastT), tracked = earth && L.track && !!scene.groundTrack?.shown.sat;
      const moving = ((tracked && dt > 3e3) || (L.night && dt > 60e3)) && wall - st.lastWall > 120;
      if (!st.dirty && !moving) return;
      st.dirty = false; st.lastT = t; st.lastWall = wall;
      const t0 = performance.now();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const P = ports();
      // Exaggeration from the ground per pixel: more on a whole-body view, where relief is a few pixels.
      const kmpp = radiusKm / v.scale, texKm = (radiusKm * D) / 16;
      const ex = Math.max(1.5, Math.min(25, 2.6 * Math.sqrt(Math.max(kmpp, texKm))));
      const lay = (L.colour && has.colour ? LAYER.colour : 0) | (L.relief ? LAYER.relief : 0) | (L.elevation ? LAYER.elevation : 0) | (L.night ? LAYER.night : 0);
      renderer.render(P, { layers: lay, exag: ex, sun: L.night ? sunFixed(body, t) : null, paper: PAPER, dpr, cssW: st.cssW, cssH: st.cssH });
      if (Math.abs(ex - last) > 0.05) { last = ex; setExag(ex); }
      // Tiles of the 16 px/deg grid once a 4 px/deg cell is over 1.5 device px.
      const el = st.elev;
      if (el && (v.scale * D) / 4 * dpr > 1.5) {
        const want: number[] = [];
        for (let i = 0; i <= 8; i++) for (let j = 0; j <= 6; j++) {
          const ll = inverse(v, (v.w * i) / 8, (v.h * j) / 6);
          if (!ll) continue;
          const e = el.entry, x = Math.floor(((ll[1] + Math.PI) / (2 * Math.PI)) * e.tilesX) % e.tilesX, y = Math.min(e.tilesY - 1, Math.floor(((Math.PI / 2 - ll[0]) / Math.PI) * e.tilesY));
          const k = y * e.tilesX + x;
          if (!want.includes(k)) want.push(k);
        }
        el.want(want);
      }
      // The ground track, while the plate has a satellite.
      let track: Track | null = null;
      if (earth && L.track) {
        const g = scene.groundTrack?.shown;
        if (g?.sat) {
          const sat = g.sat as unknown as Sat;
          // SGP4 again only once the clock has moved (a hover redraws with the same track).
          const tc = st.track;
          if (!tc || tc.sat !== g.sat || tc.t !== t) st.track = { sat: g.sat, t, ...trackOf(sat, t) };
          const { line, nowIndex } = st.track!;
          let passLine: [number, number][] | null = null;
          if (g.pass && g.site) {
            const pts: [number, number][] = [];
            for (let k = 0; k <= 64; k++) {
              const tt = g.pass.riseMs + ((g.pass.setMs - g.pass.riseMs) * k) / 64, s = stateTeme(sat, tt);
              if (!s) continue;
              const M = temeToItrf(tt), r = s.r;
              const p = subPoint([M[0][0] * r[0] + M[0][1] * r[1] + M[0][2] * r[2], M[1][0] * r[0] + M[1][1] * r[1] + M[1][2] * r[2], M[2][0] * r[0] + M[2][1] * r[1] + M[2][2] * r[2]]);
              pts.push([p.latDeg * D, p.lonDeg * D]);
            }
            passLine = pts;
          }
          const nm = sat.omm.OBJECT_NAME ?? 'Satellite';
          track = { line, nowIndex, pass: passLine, place: g.site ? [g.site.lat * D, g.site.lon * D] : null, name: nm };
          if (trackName !== nm) { live.current.trackName = nm; setTrackName(nm); }
        } else if (trackName) { live.current.trackName = null; setTrackName(null); }
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, st.cssW, st.cssH);
      // The border's paper round the map, and the console's black beyond it.
      const f = st.frame;
      ctx.fillStyle = PAPER_HEX;
      ctx.fillRect(f.x - MARGIN, f.y - MARGIN, f.w + 2 * MARGIN, MARGIN);
      ctx.fillRect(f.x - MARGIN, f.y + f.h, f.w + 2 * MARGIN, MARGIN);
      ctx.fillRect(f.x - MARGIN, f.y, MARGIN, f.h);
      ctx.fillRect(f.x + f.w, f.y, MARGIN, f.h);
      const input: OverlayInput = {
        ports: P, frame: f, radiusKm, lonStyle: earth || body === 'moon' ? 'ew' : 'east',
        grid: L.grid, names: L.names && has.names, sites: L.sites && has.sites, sheetsOn: L.sheets && has.sheets,
        pads: earth && L.pads, atlas: earth && L.atlas,
        features: st.features, sheets, sheetNames: index?.sheets?.names ?? {}, siteMarks, padMarks, track, hover: st.hover, regional: regionalCodes,
        // The scale bar (bottom left) and, in simple cylindrical, the north arrow (top right).
        reserved: [{ x: f.x, y: f.y + f.h - 40, w: 240, h: 40 }, ...(v.proj === 'eq' ? [{ x: f.x + f.w - 50, y: f.y, w: 50, h: 64 }] : [])],
      };
      st.hits = drawOverlay(ctx, input);
      drawFurniture(ctx, input, v, MARGIN);
      // ?debug: each redraw's time, the GPU's included (a one-pixel read
      // waits for it, as bench:frames does), for docs/performance.md.
      if (DEBUG) {
        const gl = scene.renderer.getContext();
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, PIXEL);
        const w = window as unknown as { chartDraws?: number[] };
        (w.chartDraws ??= []).push(performance.now() - t0);
      }
    };
    scene.setChart(draw);
    st.dirty = true;
    return () => scene.setChart(null);
  }, [scene, renderer]);
  useEffect(() => { st.dirty = true; }, [index, sheets, siteMarks, padMarks, regionalCodes, radiusKm, colourIn]);

  // ---- the pointer
  const portAt = (x: number, y: number) => {
    if (!st.view) return null;
    const P = ports();
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i], v = p.view;
      const lx = x - p.x, ly = y - p.y;
      if (p.inset ? Math.hypot(lx - v.w / 2, ly - v.h / 2) <= v.w / 2 : lx >= 0 && ly >= 0 && lx <= v.w && ly <= v.h) return { p, lx, ly };
    }
    return null;
  };
  const local = (e: { clientX: number; clientY: number }) => { const r = root.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const read = (x: number, y: number) => {
    const hit = [...st.hits].reverse().find((h) => h.kind !== 'sheet' && x >= h.x && y >= h.y && x <= h.x + h.w && y <= h.y + h.h) ?? null;
    const at = portAt(x, y);
    const key = hit?.key ?? null;
    if (key !== st.hover) { st.hover = key; st.dirty = true; }
    if (!at) { setReadout(null); return; }
    const ll = inverse(at.p.view, at.lx, at.ly);
    if (!ll || (at.p.view.proj !== 'eq' && Math.PI / 2 - Math.abs(ll[0]) > at.p.limit)) { setReadout(null); return; }
    const h = st.elev?.heightAt(ll[0], ll[1]);
    const sh = sheetSet ? sheetAt(sheetSet, ll[0] / D, ll[1] / D) : null;
    const nm = sh ? index?.sheets?.names[String(sh.n)] : null;
    setReadout({ lat: ll[0], lon: ll[1], elev: h && !Number.isNaN(h.m) ? h.m : null, fine: !!h?.fine, sheet: sh ? `${sh.code}${nm ? ` ${nm}` : ''}` : null, hit });
  };
  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    st.pointers.set(e.pointerId, local(e));
    if (st.pointers.size === 2) { const [a, b] = [...st.pointers.values()]; st.pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e), prev = st.pointers.get(e.pointerId);
    if (!prev) { read(p.x, p.y); return; }
    if (st.pointers.size === 2) {
      st.pointers.set(e.pointerId, p);
      const [a, b] = [...st.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (st.pinch > 0) zoomAt(d / st.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
      st.pinch = d;
      return;
    }
    const at = portAt(prev.x, prev.y);
    if (at && !at.p.inset) pan(p.x - prev.x, p.y - prev.y);
    st.pointers.set(e.pointerId, p);
  };
  const down = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerUp = (e: React.PointerEvent) => {
    st.pointers.delete(e.pointerId);
    if (st.pointers.size < 2) st.pinch = 0;
    const p = local(e), d0 = down.current;
    if (d0 && Math.hypot(p.x - d0.x, p.y - d0.y) < 5 && performance.now() - d0.t < 400) click(p.x, p.y);
    down.current = null;
  };
  const click = (x: number, y: number) => {
    const at = portAt(x, y);
    if (at?.p.inset) { setProj(at.p.inset); return; }
    const hit = [...st.hits].reverse().find((h) => (h.kind === 'site') && x >= h.x && y >= h.y && x <= h.x + h.w && y <= h.y + h.h);
    if (hit) onSite(hit.key.slice(5));
  };
  useEffect(() => {
    const el = ink.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), p.x, p.y); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = st.view;
    if (!v || e.altKey || e.ctrlKey || e.metaKey) return;
    const step = 80;
    if (e.key === 'Escape') { onClose(); e.preventDefault(); return; }
    if (e.key.startsWith('Arrow')) {
      const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (d) { pan(d[0], d[1]); e.preventDefault(); }
      return;
    }
    if (e.key === ']' || e.key === '[') { const f = st.frame; zoomAt(e.key === ']' ? 1.5 : 1 / 1.5, f.x + f.w / 2, f.y + f.h / 2); e.preventDefault(); return; }
    if (e.key === '0') { reset(); e.preventDefault(); }
  };
  // Escape anywhere in the chart (a key focused) goes back to the sky.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !root.current?.contains(document.activeElement)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT') return;
      e.preventDefault(); onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const e = index?.elevation;
  const dp = st.view ? Math.max(1, Math.min(4, Math.ceil(Math.log10(Math.max(1, st.view.scale * D))) + 1)) : 2;
  const lonStyle = earth || body === 'moon' ? 'ew' : 'east';
  const projName = proj === 'eq' ? 'Simple cylindrical' : proj === 'n' ? 'Polar stereographic · north' : 'Polar stereographic · south';
  const keys = LAYER_KEYS.filter((k) => (earth ? !['sheets', 'names', 'sites'].includes(k.key) : !['track', 'pads', 'atlas'].includes(k.key)));
  const rampCss = (stops: [number, string][]) => `linear-gradient(to right, ${stops.map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`).join(', ')})`;
  const tick = (m: number) => `${m / 1000}`;
  const lo = e ? Math.round((e.p1M - 0.04 * (e.p99M - e.p1M)) / 1000) * 1000 : 0, hi = e ? Math.round((e.p99M + 0.04 * (e.p99M - e.p1M)) / 1000) * 1000 : 0;

  return (
    <section className={`chart${phone ? ' phone' : ''}`} ref={root} aria-labelledby={titleId} style={{ paddingRight: insetRight, paddingBottom: insetBottom }}>
      <header className="chart-head">
        <span className="pnl" aria-hidden="true">K1</span>
        <h2 className="chart-title" id={titleId}>{name}<span className="chart-proj">{projName}</span></h2>
        <div className="chart-projs" role="radiogroup" aria-label="Projection">
          {(['n', 'eq', 's'] as Proj[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={proj === p} className="key small" onClick={() => setProj(p)}
              title={p === 'eq' ? 'Simple cylindrical, the whole body (0 resets the view)' : `Polar stereographic about the ${p === 'n' ? 'north' : 'south'} pole`}>{p === 'eq' ? 'EQ' : p.toUpperCase()}</button>
          ))}
        </div>
        <div className="chart-layers" role="group" aria-label="Layers">
          {keys.map((k) => {
            const ok = available(k.key);
            return (
              <button key={k.key} type="button" className="key small layer-key" aria-pressed={layers[k.key] && ok} disabled={!ok}
                title={ok ? k.title : `${k.title}: none for ${name}`} onClick={() => setLayer(k.key, !layers[k.key])}>{k.label}</button>
            );
          })}
        </div>
        <span className="spacer" />
        <button type="button" className="key small chart-close" onClick={onClose} aria-keyshortcuts="K" title="Back to the 3D sky (K or Esc)">3D</button>
      </header>
      <div className="chart-map" ref={mapCell} />
      <canvas className="chart-ink" ref={ink} tabIndex={0} role="img" onKeyDown={onKeyDown}
        aria-label={`A chart of ${name}, ${projName.toLowerCase()}. Drag to pan, scroll or pinch to zoom; the arrow keys pan and [ and ] zoom; 0 resets. The readout below names the point under the pointer.`}
        onPointerDown={(ev) => { down.current = { ...local(ev), t: performance.now() }; onPointerDown(ev); }} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        onPointerLeave={() => { if (!st.pointers.size) { setReadout(null); if (st.hover) { st.hover = null; st.dirty = true; } } }}
        onDoubleClick={(ev) => { const p = local(ev); zoomAt(2, p.x, p.y); }} />
      <footer className="chart-foot">
        <div className="chart-readout" role="status" aria-live="off">
          {readout ? <>
            <span className="cell"><span className="engraved">Lat</span><b>{fmtLat(readout.lat, dp)}</b></span>
            <span className="cell"><span className="engraved">Lon</span><b>{fmtLon(readout.lon, dp, lonStyle)}</b><SourceTag src="IAU" info="chart-coords" derived /></span>
            {e && <span className="cell"><span className="engraved">Elev</span><b>{readout.elev === null ? 'no data' : fmtM(readout.elev)}</b>
              <SourceTag src={e.tag} info="chart-elevation" detail={`${e.source}, above ${e.datum}; ${readout.fine ? '16' : '4'} px/deg grid here.`} /></span>}
            {readout.sheet && <span className="cell"><span className="engraved">Sheet</span><b>{readout.sheet}</b><SourceTag src="IAU" info="chart-sheet" /></span>}
            {readout.hit && <span className="cell"><b className="hit">{readout.hit.label}</b>
              <SourceTag src={readout.hit.kind === 'pad' ? 'GCAT' : readout.hit.kind === 'name' ? 'IAU' : 'NSSDCA'} info={readout.hit.kind === 'pad' ? 'chart-pads' : readout.hit.kind === 'name' ? 'chart-names' : 'site-coords-body'} /></span>}
          </> : <span className="hint">{phone ? 'Drag to pan · pinch to zoom' : 'Point at the chart to read it · drag to pan · scroll to zoom · double-click to zoom in'}</span>}
        </div>
        <div className="chart-legend">
          {e && layers.elevation && (earth ? <>
            <span className="ramp-group"><span className="engraved">Sea</span><span className="ramp" style={{ background: rampCss([...RAMPS.sea].reverse().map(([t, c]) => [1 - t, c] as [number, string])) }} /><span className="ticks"><span>−{SEA_DEEP_M / 1000}</span><span>0 km</span></span></span>
            <span className="ramp-group"><span className="engraved">Land</span><span className="ramp" style={{ background: rampCss(RAMPS.land) }} /><span className="ticks"><span>0</span><span>{LAND_TOP_M / 1000} km</span></span></span>
          </> : <span className="ramp-group"><span className="engraved">Elevation</span><span className="ramp" style={{ background: rampCss(RAMPS.body) }} /><span className="ticks"><span>{tick(lo)}</span><span>{tick((lo + hi) / 2)}</span><span>{tick(hi)} km</span></span></span>)}
          {e && layers.relief && <span className="note">Relief ×{exag.toFixed(exag < 10 ? 1 : 0)}, lit from the upper left</span>}
          {e && <SourceTag src={e.tag} info="chart-elevation" detail={`${e.source}, heights above ${e.datum}. ${e.credit}`} />}
          {earth && layers.track && <span className="note">{trackName ? <>Track: {trackName}<SourceTag src="SGP4" info="chart-track" derived /></> : 'Track: choose a satellite (rail, Satellites)'}</span>}
          {!e && <span className="note">No global elevation model for {name}: colour, grid and names only</span>}
          {layers.colour && CLOUDS.has(body) && <span className="note">Colour: the cloud tops, not the ground</span>}
        </div>
      </footer>
    </section>
  );
}
