// src/scene/satellites.ts
//
// Earth satellites (src/physics/satellites.js, docs/frontend/satellites.md):
// every active satellite in CelesTrak's catalogue as a point, the named ones
// (the ISS, Tiangong, Hubble, GPS, Galileo, the geostationary weather
// satellites, and any found by search) with a marker, a label and their
// orbit. Three more sets have switches of their own, each drawn dimmer and
// in its own colour: the debris of the breakups CelesTrak keeps as groups,
// the spent rocket bodies, and the analyst objects (tracked, not
// identified). A debris cloud can be picked: its pieces are drawn brighter
// and everything else dimmer.
//
// Motion: a worker (satellites.worker.ts) runs SGP4 for all of them at a
// time t0 and hands back, for each, the two-body ellipse through its state
// in J2000; the vertex shader carries each point along its ellipse from t0
// (Kepler's equation, as smallBodies.ts does), so between refreshes the CPU
// does nothing per satellite. A new t0 is asked for whenever the worker is
// free and the clock has moved REFRESH_S from the last: the points never
// run more than a few seconds of clock on the ellipse (under a metre off
// SGP4 at normal rates), and at high rates the worker keeps up as it can
// (8 ms for the catalogue). The named ones' markers, the focused one and the
// data plate are placed by SGP4 itself on the main thread.
//
// Drawing: each point is a Gaussian of fixed width in device pixels, as the
// small bodies' are, drawn after the bodies with the depth test (the
// logarithmic depth buffer) so the Earth hides those behind it. Its peak
// falls as 1/d from the camera (a magnitude range halved, as the small
// bodies'), and a satellite in shadow is dimmed to a fifth by the share of
// the Sun's disc the Earth and the Moon leave it (the umbra's and
// penumbra's cones, as satellites.js sunFraction), in the shadow colour. The layer fades out
// as the camera leaves the Earth's neighbourhood (1 to 3 million km).
//
// Positions are camera-relative, one render unit is 1000 km, and render
// (x, y, z) is ecliptic (x, z, -y): the Earth's render position is worked
// out in double precision on the CPU and the shader adds each satellite's
// geocentric position to it.

import * as THREE from 'three';
import { eqjToEcl, eclToEqj } from '../physics/ephemeris.js';
import { parseGpCsv, satrecOf, stateEqj, stateTeme, temeToEqj, apply, inShadow, R_EARTH_KM, R_MOON_KM } from '../physics/satellites.js';
import { VISIBLE_FRACTION } from './bodyMaterial';
import { orbitTrailMaterial } from './orbitTrail';
import { SatelliteModel } from './satelliteModels';
import { getJson, getText } from '../physics/fetchData.js';

type V3 = [number, number, number];
const UNIT_KM = 1000;
const REFRESH_S = 5;
// And no more than ten times a second, whatever the rate: each refresh sends
// 0.7 MB to the GPU, and at a day a second the points are a blur anyway.
const REFRESH_MIN_MS = 100;
const ORBIT_SAMPLES = 129;
// The focused one's orbit close up. Within CLOSE_SHARE of its distance
// from the Earth, the stretch of NEAR_SPAN orbit samples either side of
// it (a fifth of the orbit, 3,700 km in low orbit) is drawn every frame by
// SGP4 relative to the satellite, with the satellite as a vertex and
// NEAR_STEPS steps each way growing as the square of the step count, from
// a far-line sample to the next far-line sample. The orbit line's 128
// chords sag 2 km off a low orbit, which passes beside a satellite seen
// from closer than a tenth of its radius (and float32 about the Earth puts
// another metre on it). Steps growing as the square keep the sag seen from
// the satellite the same all the way out, span / (2 R m^2) = 3e-4 rad,
// under a pixel; outside the stretch the far line's 2 km sag is at least
// 0.5 R from the camera, under a pixel too. An osculating ellipse instead
// strays from SGP4's path by 0.6 km a twentieth of an orbit on (J2), 2 km
// at the stretch's ends, so it would not meet the far line there.
const CLOSE_SHARE = 0.1, NEAR_SPAN = 12, NEAR_STEPS = 32, NEAR_N = 2 * NEAR_STEPS + 1;
// The points' peak (a display value) at D_REF km from the camera, its cap,
// and the shadow's share.
const PEAK_REF = 0.35, D_REF_KM = 40000, PEAK_MAX = 1.2, SHADOW = 0.2;
const FADE_NEAR_KM = 1e6, FADE_FAR_KM = 3e6;
// A picked debris cloud's pieces, and everything else, as a share of their
// own brightness.
const PICK_GAIN = 2.2, PICK_DIM = 0.35;
// The live refresh: CelesTrak's GP data changes once every 2 hours
// (https://celestrak.org/usage-policy.php), so a browser asks no more often.
export const LIVE_URL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=csv';
const LIVE_MIN_MS = 2 * 3600e3;
const LIVE_KEY = 'orrery.satellites.liveAt';

export type SatGroup = 'station' | 'science' | 'gps' | 'galileo' | 'weather' | 'found';
export const SAT_GROUPS: { key: SatGroup; label: string; colour: string }[] = [
  { key: 'station', label: 'Stations', colour: '#e9e3d6' },
  { key: 'science', label: 'Science', colour: '#ecd9b0' },
  { key: 'gps', label: 'GPS', colour: '#7fb0d9' },
  { key: 'galileo', label: 'Galileo', colour: '#a99be0' },
  { key: 'weather', label: 'Weather (GEO)', colour: '#8fcc85' },
  { key: 'found', label: 'Found by search', colour: '#c8c2b4' },
];
const COLOUR_OF = Object.fromEntries(SAT_GROUPS.map((g) => [g.key, g.colour])) as Record<SatGroup, string>;

// The rail's switches, one point set each: its file, its colour in sunlight
// and in the Earth's shadow (display values), and its brightness against
// the active satellites'. The active ones are a warm white, sunlit metal and
// panels, and the Earth's blue glow in its shadow; the rest are dimmer, and
// none is amber, which is the craft's.
export type SatLayerKey = 'active' | 'debris' | 'rocket-bodies' | 'analyst';
type Rgb = [number, number, number];
export const SAT_LAYERS: { key: SatLayerKey; label: string; file: string; lit: Rgb; dark: Rgb; gain: number; hint: string }[] = [
  { key: 'active', label: 'All active', file: 'satellites.csv', lit: [0.95, 0.93, 0.86], dark: [0.55, 0.62, 0.80], gain: 1,
    hint: 'Every active satellite CelesTrak lists, moved by SGP4; the named ones with their orbits. Dimmer in the Earth\'s shadow' },
  { key: 'debris', label: 'Debris clouds', file: 'satellites-debris.csv', lit: [0.86, 0.50, 0.38], dark: [0.50, 0.44, 0.56], gain: 0.55,
    hint: 'The tracked pieces of the three breakups CelesTrak keeps as groups: Fengyun-1C (2007), and Cosmos 2251 and Iridium 33 (2009)' },
  { key: 'rocket-bodies', label: 'Rocket bodies', file: 'satellites-rocket-bodies.csv', lit: [0.52, 0.80, 0.74], dark: [0.40, 0.52, 0.66], gain: 0.6,
    hint: 'Spent rocket stages left in orbit: every object named R/B in the catalogue' },
  { key: 'analyst', label: 'Analyst objects', file: 'satellites-analyst.csv', lit: [0.70, 0.64, 0.88], dark: [0.46, 0.46, 0.66], gain: 0.5,
    hint: 'Objects the US Space Force tracks but has not identified, with element sets in its analyst range' },
];
export const SAT_LAYER_KEYS = SAT_LAYERS.map((l) => l.key);
const LAYER_OF = Object.fromEntries(SAT_LAYERS.map((l) => [l.key, l])) as Record<SatLayerKey, (typeof SAT_LAYERS)[number]>;
const css = (c: Rgb) => `rgb(${c.map((x) => Math.round(x * 255)).join(' ')})`;
const LAYER_NOUN: Record<SatLayerKey, string> = { active: 'satellite', debris: 'debris', 'rocket-bodies': 'rocket body', analyst: 'analyst object' };
export const layerColour = (k: SatLayerKey): string => css(LAYER_OF[k].lit);

type Omm = ReturnType<typeof parseGpCsv>[number];
export interface NamedSat { id: number; name: string; group: SatGroup; layer?: SatLayerKey }
// A debris cloud CelesTrak keeps as a group (satellites.json): the breakup,
// its parent's international designator, and the pieces in the snapshot.
export interface SatCloud { key: string; name: string; intdes: string; event: string; date: string; query: string; count: number }
// What the cloud's pieces' element sets say of it, for its plate.
export interface SatCloudView extends SatCloud {
  tracked: number; fetched: string;
  perigee: [number, number, number]; apogee: [number, number, number];   // km: 10th, 50th and 90th percentiles
  incl: [number, number, number]; aKm: number;                         // deg; the median semi-major axis
  epochs: { first: string; median: string };
}
export interface SatSource { label: string; fetched: string; live: boolean }
export interface SatHit { j: number; des: string; label: string; kind: string; layer: SatLayerKey }

// The orbit's class, from its mean motion (rev/day) and eccentricity.
export function orbitClass(o: Omm): string {
  const n = o.MEAN_MOTION, e = o.ECCENTRICITY;
  if (e > 0.25) return 'high elliptical orbit';
  if (n > 11.25) return 'low Earth orbit';
  if (Math.abs(n - 1.0027) < 0.01 && o.INCLINATION < 5 && e < 0.01) return 'geostationary orbit';
  if (n > 1.2) return 'medium Earth orbit';
  return n > 0.9 ? 'geosynchronous orbit' : 'high Earth orbit';
}

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  ${VISIBLE_FRACTION}
  attribute vec3 aP;           // perifocal axes, J2000
  attribute vec3 aQ;
  attribute vec4 aK;           // a (km), e, M at t0 (rad), n (rad/s); a = 0: not placed
  attribute float aTag;        // its debris cloud (1, 2, ...), or 0
  uniform float uDt;           // s since t0
  uniform vec3 uEarth;         // the Earth, camera-relative, render units
  uniform mat3 uToRender;      // J2000 equatorial -> render axes
  uniform vec3 uSun;           // unit vector Earth -> Sun, J2000
  uniform vec3 uMoon;          // the Moon from the Earth, J2000 km
  uniform float uLevel, uVis, uSize, uPeakScale, uFade, uHide;
  uniform vec3 uLit, uDark;    // the set's colour, sunlit and in shadow
  uniform float uGain, uPick;  // its brightness; the picked cloud's tag, or 0
  varying vec3 vColour;
  varying float vSize;
  void main() {
    float a = aK.x, e = aK.y;
    if (a <= 0.0 || uFade <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColour = vec3(0.0); return; }
    float M = mod(aK.z + aK.w * uDt, 6.283185307);
    float E = M + 0.85 * e * (sin(M) < 0.0 ? -1.0 : 1.0);
    for (int k = 0; k < 12; k++) {
      float dE = (E - e * sin(E) - M) / (1.0 - e * cos(E));
      E -= dE;
      if (abs(dE) < 1e-6) break;
    }
    vec3 r = aP * (a * (cos(E) - e)) + aQ * (a * sqrt(1.0 - e * e) * sin(E));
    vec3 rel = uEarth + uToRender * (r / ${UNIT_KM.toFixed(1)});
    float d = length(rel);
    if (d < uHide) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColour = vec3(0.0); return; }
    gl_Position = projectionMatrix * viewMatrix * vec4(rel, 1.0);
    #include <logdepthbuf_vertex>
    // The Sun's disc left by the Earth and the Moon (the Sun 1 AU along uSun).
    vec3 sunRel = uSun * 1.495978707e8 - r;
    float ds = length(sunRel);
    vec3 sd = sunRel / ds;
    float aSun = asin(695700.0 / ds), de = length(r);
    float nu = visibleFraction(aSun, asin(min(1.0, ${R_EARTH_KM.toFixed(3)} / de)), acos(clamp(dot(-r / de, sd), -1.0, 1.0)));
    vec3 m = uMoon - r;
    float dm = length(m);
    if (dm > ${R_MOON_KM.toFixed(1)}) nu = min(nu, visibleFraction(aSun, asin(${R_MOON_KM.toFixed(1)} / dm), acos(clamp(dot(m / dm, sd), -1.0, 1.0))));
    float lit = ${SHADOW.toFixed(2)} + ${(1 - SHADOW).toFixed(2)} * nu;
    float gain = uPick > 0.5 ? uGain * (abs(aTag - uPick) < 0.5 ? ${PICK_GAIN.toFixed(2)} : ${PICK_DIM.toFixed(2)}) : uGain;
    float peak = min(${PEAK_REF.toFixed(3)} * ${D_REF_KM.toFixed(1)} / max(d * ${UNIT_KM.toFixed(1)}, 1.0), ${PEAK_MAX.toFixed(2)}) * lit * uFade * uVis * gain;
    if (peak < 1.0 / 512.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColour = vec3(0.0); return; }
    gl_PointSize = peak < 0.3 ? min(uSize, 3.0) : uSize;
    vSize = gl_PointSize;
    vec3 col = mix(uDark, uLit, nu);
    vColour = col * (peak * uLevel * uPeakScale);
  }`;

const FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uSigma;
  varying vec3 vColour;
  varying float vSize;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = (gl_PointCoord - 0.5) * vSize;
    gl_FragColor = vec4(vColour * exp(-dot(d, d) / (2.0 * uSigma * uSigma)), 1.0);
    #ifdef TONE_MAPPING
    gl_FragColor.rgb *= toneMappingExposure;
    #endif
  }`;

interface Orbit { line: THREE.Line; tc: number; period: number }
const WHITE = new THREE.Color(1, 1, 1);
// The constellations, whose members are many and alike.
const isCrowd = (g: SatGroup) => g === 'gps' || g === 'galileo' || g === 'weather';
// A constellation's outline, as a display level.
const CROWD_OPACITY = 0.08;

// satellites.json: the named ones, the snapshot's date and each set's.
interface SatMeta { named: NamedSat[]; fetched: string; layers: Record<string, { fetched: string; clouds?: SatCloud[] }> }

// One switch's points: its rows, in the worker's order, and the time the
// worker's last ellipses are for.
interface PointSet { rows: Omm[]; material: THREE.ShaderMaterial; points: THREE.Points; buffer: THREE.InterleavedBuffer; t0: number }

export class SatelliteLayer {
  private layerOn: Record<SatLayerKey, boolean> = { active: false, debris: false, 'rocket-bodies': false, analyst: false };
  private loading = new Map<SatLayerKey, Promise<void>>();
  private meta: Promise<SatMeta> | null = null;
  private metaNamed: NamedSat[] = [];
  private sets = new Map<SatLayerKey, PointSet>();
  private worker: Worker | null = null;
  private pending = 0;                               // messages the worker has yet to answer
  private stale = false;                             // a set is new or newly on: step now
  private orbitBusy = false;
  private rows: Omm[] = [];                          // every loaded set's, in SAT_LAYERS' order
  private rowLayer: SatLayerKey[] = [];
  private index = new Map<number, number>();         // NORAD id -> row
  private snapshotAt: Partial<Record<SatLayerKey, string>> = {};
  private cloudList: SatCloud[] = [];
  private pick = 0;                                  // the picked cloud's tag, or 0
  private sats = new Map<number, ReturnType<typeof satrecOf>>();   // the named ones' SGP4 records
  private named: NamedSat[] = [];
  private markers = new Map<number, HTMLDivElement>();
  private orbits = new Map<number, Orbit>();
  private orbitAt = new Map<number, { tc: number; period: number }>();   // every named one's last sampling
  private crowdLines: THREE.LineSegments | null = null;
  private crowdRow = new Map<number, number>();      // NORAD id -> its orbit's row in crowdLines
  // The focused one's close-up stretch (CLOSE_SHARE): one line, made once,
  // with the orbit shader for a line of its own or a plain colour for a
  // constellation member's; and the constellation segments it has hidden.
  private near: THREE.Line | null = null;
  private nearTrail: THREE.ShaderMaterial | null = null;
  private nearPlain: THREE.LineBasicMaterial | null = null;
  private crowdHidden: { row: number; lo: number; hi: number } | null = null;
  private uniforms: Record<string, THREE.IUniform>;   // shared by every set's material, but their own
  private t0 = NaN;
  private timeMs = 0;
  private cam: V3 = [0, 0, 0];
  private earth: V3 = [0, 0, 0];
  private toRenderM = new THREE.Matrix3();
  private sunEqj: V3 = [1, 0, 0];
  private moonEqj: V3 | null = null;
  private fade = 1;
  private focusId: number | null = null;
  // The focused one's model close up (satelliteModels.ts), and the view's
  // pixels per radian it is sized against.
  private model: SatelliteModel;
  private pxPerRad = 1000;
  get modelShown(): boolean { return this.model.shown; }
  private tmp = new THREE.Vector3();
  private disposed = false;
  source: SatSource | null = null;
  count = 0;
  // A marker clicked: the scene flies there.
  onPick: (id: number) => void = () => {};
  // The named list and the data's source, once they are known.
  onNamed: (named: readonly NamedSat[], source: SatSource | null) => void = () => {};
  // The debris clouds, once the debris is loaded.
  onClouds: (clouds: readonly SatCloud[]) => void = () => {};

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private baseUrl = '') {
    this.model = new SatelliteModel(scene);
    // The uniforms every set shares (the same objects in each material);
    // uDt, uFade, uLit, uDark, uGain and uPick are each set's own.
    this.uniforms = {
      uEarth: { value: new THREE.Vector3() }, uToRender: { value: new THREE.Matrix3() }, uSun: { value: new THREE.Vector3(1, 0, 0) }, uMoon: { value: new THREE.Vector3(384400, 0, 0) },
      uLevel: { value: 1 }, uVis: { value: 1 }, uSigma: { value: 1 }, uSize: { value: 7 }, uPeakScale: { value: 1 }, uHide: { value: 0 },
    };
    // J2000 equatorial -> render: through the ecliptic (eqjToEcl), then
    // render (x, y, z) = ecliptic (x, z, -y).
    const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((b) => eqjToEcl(b) as V3);
    this.toRenderM.set(
      cols[0][0], cols[1][0], cols[2][0],
      cols[0][2], cols[1][2], cols[2][2],
      -cols[0][1], -cols[1][1], -cols[2][1],
    );
    (this.uniforms.uToRender.value as THREE.Matrix3).copy(this.toRenderM);
  }

  // Any switch on.
  private get on(): boolean { return SAT_LAYER_KEYS.some((k) => this.layerOn[k]); }
  get shown(): boolean { return this.on; }
  // A named one's marker and orbit show while its set's switch is on.
  private namedOn(n: NamedSat): boolean { return this.layerOn[n.layer ?? 'active']; }

  // The whole layer, as it was before there were sets: the active ones.
  setOn(on: boolean): void { this.setLayer('active', on); }

  setLayer(k: SatLayerKey, on: boolean): void {
    this.layerOn[k] = on;
    if (on && !this.loading.has(k)) this.loading.set(k, this.load(k));
    const set = this.sets.get(k);
    if (set) set.points.visible = on;
    if (on) this.stale = true;
    if (k === 'debris' && !on) this.setCloud(null);
    for (const [id, o] of this.orbits) { const n = this.named.find((x) => x.id === id); o.line.visible = !!n && this.namedOn(n); }
    if (this.crowdLines) this.crowdLines.visible = this.layerOn.active;
    if (this.near && !this.on) this.near.visible = false;
    for (const n of this.named) if (!this.namedOn(n)) this.markers.get(n.id)!.style.display = 'none';
  }

  // satellites.json (10 kB): the named ones and the debris clouds, fetched once.
  private fetchMeta(): Promise<SatMeta> {
    this.meta ??= getJson(`${this.baseUrl}data/satellites.json`, 'satellites.json');
    return this.meta;
  }

  // The named ones and the debris clouds before any set has loaded, for
  // the rail's FIND field (find.tsx); empty if satellites.json fails.
  async catalogue(): Promise<{ named: readonly NamedSat[]; clouds: readonly SatCloud[] }> {
    try {
      const meta = await this.fetchMeta();
      return { named: meta.named.map((n) => ({ ...n, layer: 'active' as const })), clouds: meta.layers.debris?.clouds ?? [] };
    } catch (err) {
      console.warn(`satellites.json not loaded: ${err}`);
      this.meta = null;
      return { named: [], clouds: [] };
    }
  }

  // Whether a set's element sets have loaded; ready() waits for one
  // switched on (true once it has loaded, false if it failed or is off).
  loaded(k: SatLayerKey): boolean { return this.sets.has(k); }
  async ready(k: SatLayerKey): Promise<boolean> { await this.loading.get(k); return this.sets.has(k); }

  private async load(k: SatLayerKey): Promise<void> {
    try {
      const meta$ = this.fetchMeta();
      const [csv, meta] = await Promise.all([
        getText(`${this.baseUrl}data/${LAYER_OF[k].file}`, LAYER_OF[k].file),
        meta$,
      ]);
      if (this.disposed) return;
      if (!this.metaNamed.length) {
        this.metaNamed = meta.named.map((n) => ({ ...n, layer: 'active' as const }));
        this.source ??= { label: 'CelesTrak GP, snapshot', fetched: meta.fetched, live: false };
      }
      this.snapshotAt[k] = k === 'active' ? meta.fetched : meta.layers[k]?.fetched ?? meta.fetched;
      if (k === 'debris') this.cloudList = meta.layers.debris?.clouds ?? [];
      this.setRows(k, csv);
      if (k === 'debris') this.onClouds(this.cloudList);
    } catch (err) {
      console.warn(`satellites (${k}) not loaded: ${err}`);
      this.loading.delete(k);
      this.meta = null;
    }
  }

  // New element sets for one switch (the snapshot, or the live ones for
  // the active satellites): its points, the worker's copy and the named
  // ones' records start again from them.
  private setRows(k: SatLayerKey, csv: string): void {
    const rows = parseGpCsv(csv);
    this.makePoints(k, rows);
    this.rows = []; this.rowLayer = [];
    for (const key of SAT_LAYER_KEYS) {
      const set = this.sets.get(key);
      if (!set) continue;
      for (const r of set.rows) { this.rows.push(r); this.rowLayer.push(key); }
    }
    this.index = new Map(this.rows.map((r, j) => [r.NORAD_CAT_ID, j]));
    this.count = this.rows.length;
    const found = this.named.filter((n) => n.group === 'found');
    this.named = [...this.metaNamed, ...found.filter((f) => !this.metaNamed.some((n) => n.id === f.id))].filter((n) => this.index.has(n.id));
    this.sats.clear();
    for (const n of this.named) this.sats.set(n.id, satrecOf(this.rows[this.index.get(n.id)!]));
    for (const n of this.named) if (!this.markers.has(n.id)) this.makeMarker(n);
    for (const [id, el] of this.markers) if (!this.sats.has(id)) { el.remove(); this.markers.delete(id); }
    for (const o of this.orbits.values()) o.tc = NaN;
    this.orbitAt.clear();
    this.worker ??= this.startWorker();
    this.pending++;
    this.stale = true;
    this.worker.postMessage({ type: 'gp', set: k, csv });
    this.onNamed(this.named, this.source);
  }

  private startWorker(): Worker {
    const w = new Worker(new URL('./satellites.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'ready') { this.pending--; this.ask(); }
      else if (m.type === 'step') { this.pending--; this.takeStep(m.t, m.sets, m.bufs); this.ask(); }
      else if (m.type === 'orbits') { this.orbitBusy = false; this.takeOrbits(m.t, m.ids, m.buf, m.periods); }
    };
    return w;
  }

  // One switch's points: a material of its own (its colour and brightness,
  // and its clock) sharing the rest of the uniforms, and its debris cloud
  // tags.
  private makePoints(k: SatLayerKey, rows: Omm[]): void {
    const n = rows.length, L = LAYER_OF[k];
    const buffer = new THREE.InterleavedBuffer(new Float32Array(n * 10), 10);
    buffer.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(n), 1));
    g.setAttribute('aP', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    g.setAttribute('aQ', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    g.setAttribute('aK', new THREE.InterleavedBufferAttribute(buffer, 4, 6));
    const tag = new Float32Array(n);
    if (k === 'debris') rows.forEach((r, j) => { tag[j] = this.cloudList.findIndex((c) => r.OBJECT_ID.startsWith(c.intdes)) + 1; });
    g.setAttribute('aTag', new THREE.BufferAttribute(tag, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    const old = this.sets.get(k);
    if (old) {
      old.points.geometry.dispose();
      old.points.geometry = g;
      Object.assign(old, { rows, buffer, t0: NaN });
      return;
    }
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        ...this.uniforms,
        uDt: { value: 0 }, uFade: { value: 0 }, uLit: { value: new THREE.Vector3(...L.lit) }, uDark: { value: new THREE.Vector3(...L.dark) },
        uGain: { value: L.gain }, uPick: { value: 0 },
      },
    });
    const points = new THREE.Points(g, material);
    points.frustumCulled = false;
    points.visible = this.layerOn[k];
    // The markers are placed once a frame, before whichever set draws first.
    points.onBeforeRender = (_r, _s, camera) => { if (this.labelDue) { this.labelDue = false; this.label(camera); } };
    this.scene.add(points);
    this.sets.set(k, { rows, material, points, buffer, t0: NaN });
  }
  private labelDue = false;

  // Ask the worker for the next ellipses when it is free and the clock has
  // moved: for the time now plus the time it took last (at the clock's
  // rate), so they arrive centred on the clock.
  private lastAsk = 0;
  private lastAskT = 0;
  private lag = 30;
  private rate = 0;
  // Only the sets whose switches are on are stepped (and sent to the GPU).
  private ask(): void {
    if (!this.worker || this.pending > 0 || !this.on) return;
    if (!this.stale && Math.abs(this.timeMs - this.t0) < REFRESH_S * 1000) return;
    if (!this.stale && Number.isFinite(this.t0) && performance.now() - this.lastAsk < REFRESH_MIN_MS) return;
    const sets = SAT_LAYER_KEYS.filter((k) => this.layerOn[k] && this.sets.has(k));
    if (!sets.length) return;
    this.pending++;
    this.stale = false;
    this.lastAsk = performance.now();
    this.lastAskT = this.timeMs;
    this.worker.postMessage({ type: 'step', t: this.timeMs + this.rate * this.lag, sets });
  }

  private takeStep(t: number, keys: SatLayerKey[], bufs: Float32Array[]): void {
    this.lag = Math.min(500, performance.now() - this.lastAsk);
    keys.forEach((k, j) => {
      const set = this.sets.get(k), buf = bufs[j];
      if (!set || buf.length !== set.buffer.array.length) return;
      set.buffer.array = buf;
      set.buffer.needsUpdate = true;
      set.t0 = t;
    });
    this.t0 = t;
  }

  private lastOrbits = 0;
  private askOrbits(): void {
    if (!this.worker || this.orbitBusy || !this.on || !this.named.length) return;
    const due = this.named.some((n) => { const o = this.orbitAt.get(n.id); return !o || !(Math.abs(this.timeMs - o.tc) < 0.3 * o.period); });
    if (!due || performance.now() - this.lastOrbits < 4 * REFRESH_MIN_MS) return;
    this.lastOrbits = performance.now();
    this.orbitBusy = true;
    this.worker.postMessage({ type: 'orbits', t: this.timeMs + this.rate * this.lag, ids: this.named.map((n) => n.id), samples: ORBIT_SAMPLES });
  }

  // The orbits, sampled by SGP4 in the worker. A station's, Hubble's or a
  // found satellite's is a line of its own with the planets' orbit shader
  // (a faint outline and a glowing trail behind it); the constellations'
  // 82 share one faint line set in their groups' colours, drawn at once
  // (85 lines cost 3.6 ms a frame on an integrated GPU, mostly in draw
  // calls).
  private takeOrbits(t: number, ids: number[], buf: Float32Array, periods: Float64Array): void {
    const v = new THREE.Vector3();
    const toRender = (j: number, k: number, out: Float32Array, o: number) => {
      const b = (j * ORBIT_SAMPLES + k) * 3;
      v.set(buf[b], buf[b + 1], buf[b + 2]).applyMatrix3(this.toRenderM).multiplyScalar(1 / UNIT_KM);
      out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z;
    };
    const crowd: number[] = [];
    ids.forEach((id, j) => {
      const n = this.named.find((x) => x.id === id);
      if (!n || !(periods[j] > 0)) return;
      this.orbitAt.set(id, { tc: t, period: periods[j] });
      if (isCrowd(n.group)) { crowd.push(j); return; }
      let o = this.orbits.get(id);
      if (!o) {
        const g = new THREE.BufferGeometry();
        const u = new Float32Array(ORBIT_SAMPLES);
        for (let k = 0; k < ORBIT_SAMPLES; k++) u[k] = k / (ORBIT_SAMPLES - 1) - 0.5;
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORBIT_SAMPLES * 3), 3));
        g.setAttribute('u', new THREE.BufferAttribute(u, 1));
        const line = new THREE.Line(g, orbitTrailMaterial(new THREE.Color(COLOUR_OF[n.group]).getHex(), 0.22, 0.12));
        line.frustumCulled = false;
        line.visible = this.namedOn(n);
        this.scene.add(line);
        o = { line, tc: t, period: periods[j] };
        this.orbits.set(id, o);
      }
      const pos = o.line.geometry.getAttribute('position') as THREE.BufferAttribute, arr = pos.array as Float32Array;
      for (let k = 0; k < ORBIT_SAMPLES; k++) toRender(j, k, arr, k * 3);
      pos.needsUpdate = true;
      o.tc = t; o.period = periods[j];
    });
    for (const [id, o] of this.orbits) {
      if (this.named.some((n) => n.id === id)) continue;
      this.scene.remove(o.line); o.line.geometry.dispose(); (o.line.material as THREE.Material).dispose();
      this.orbits.delete(id);
    }
    // The constellations: segments k -> k + 1 of each orbit.
    const segs = ORBIT_SAMPLES - 1, pos = new Float32Array(crowd.length * segs * 6), col = new Float32Array(crowd.length * segs * 6);
    const c = new THREE.Color();
    this.crowdRow.clear();
    this.crowdHidden = null;
    crowd.forEach((j, q) => {
      this.crowdRow.set(ids[j], q);
      c.set(COLOUR_OF[this.named.find((x) => x.id === ids[j])!.group]).lerp(WHITE, 0.35);
      for (let k = 0; k < segs; k++) {
        const o = (q * segs + k) * 6;
        toRender(j, k, pos, o); toRender(j, k + 1, pos, o + 3);
        col[o] = col[o + 3] = c.r; col[o + 1] = col[o + 4] = c.g; col[o + 2] = col[o + 5] = c.b;
      }
    });
    if (!this.crowdLines) {
      const m = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
      this.crowdLines = new THREE.LineSegments(new THREE.BufferGeometry(), m);
      this.crowdLines.frustumCulled = false;
      this.crowdLines.visible = this.layerOn.active;
      this.scene.add(this.crowdLines);
    }
    const g = this.crowdLines.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  private makeMarker(n: NamedSat): void {
    const el = document.createElement('div');
    el.className = 'body-marker satellite';
    el.title = `${n.name} (NORAD ${n.id})`;
    el.style.setProperty('--sat', COLOUR_OF[n.group]);
    const dot = document.createElement('span'), name = document.createElement('span');
    dot.className = 'dot'; name.className = 'name'; name.textContent = n.name;
    el.append(dot, name);
    el.style.display = 'none';
    el.addEventListener('click', () => this.onPick(n.id));
    this.overlay.appendChild(el);
    this.markers.set(n.id, el);
  }

  // The width of the points, as the small bodies' (smallBodies.ts setScale).
  setScale(deviceRatio: number, renderRatio: number): void {
    const u = this.uniforms;
    const want = (0.55 + 0.35 * deviceRatio) * (renderRatio / deviceRatio), sigma = Math.max(0.8, want);
    u.uSigma.value = sigma;
    u.uSize.value = Math.ceil(7 * sigma) + 1;
    u.uPeakScale.value = (want / sigma) ** 2;
  }

  // Each frame, before the render: the time (UTC ms), the camera's and the
  // Earth's heliocentric ecliptic positions (km), 1 / the exposure and the
  // eye's adaptation.
  private lastFrame = 0;
  update(timeMs: number, cam: readonly number[], earth: readonly number[], level: number, visibility = 1, moon?: readonly number[]): void {
    const now = performance.now();
    if (this.lastFrame && now > this.lastFrame) this.rate += ((timeMs - this.timeMs) / (now - this.lastFrame) - this.rate) * 0.2;
    this.lastFrame = now;
    this.timeMs = timeMs;
    this.cam = [cam[0], cam[1], cam[2]];
    this.earth = [earth[0], earth[1], earth[2]];
    if (!this.on || !this.sets.size) { this.model.hide(); return; }
    this.labelDue = true;
    this.ask();
    this.askOrbits();
    const u = this.uniforms;
    const rel: V3 = [earth[0] - cam[0], earth[1] - cam[1], earth[2] - cam[2]];
    const er = (u.uEarth.value as THREE.Vector3).set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM);
    const dE = Math.hypot(rel[0], rel[1], rel[2]);
    this.fade = Math.max(0, Math.min(1, (FADE_FAR_KM - dE) / (FADE_FAR_KM - FADE_NEAR_KM)));
    // Each set from its own last ellipses; a picked cloud's pieces brighter
    // (the debris shader picks them out by tag), and the other sets dimmer.
    for (const [k, set] of this.sets) {
      const su = set.material.uniforms;
      su.uDt.value = Number.isFinite(set.t0) ? (timeMs - set.t0) / 1000 : 0;
      su.uFade.value = Number.isFinite(set.t0) ? this.fade : 0;
      su.uPick.value = k === 'debris' ? this.pick : 0;
      su.uGain.value = LAYER_OF[k].gain * (this.pick && k !== 'debris' ? PICK_DIM : 1);
    }
    const s = eclToEqj([-earth[0], -earth[1], -earth[2]]) as V3, sn = Math.hypot(s[0], s[1], s[2]);
    this.sunEqj = [s[0] / sn, s[1] / sn, s[2] / sn];
    (u.uSun.value as THREE.Vector3).set(...this.sunEqj);
    // The Moon from the Earth (J2000), for its shadow on them.
    if (moon) {
      const m = eclToEqj([moon[0] - earth[0], moon[1] - earth[1], moon[2] - earth[2]]) as V3;
      this.moonEqj = m;
      (u.uMoon.value as THREE.Vector3).set(...m);
    }
    u.uLevel.value = level;
    u.uVis.value = visibility;
    for (const [id, o] of this.orbits) {
      o.line.position.copy(er);
      const n = this.named.find((x) => x.id === id);
      o.line.visible = !!n && this.namedOn(n) && this.fade > 0 && Number.isFinite(o.tc);
      const m = o.line.material as THREE.ShaderMaterial;
      m.uniforms.now.value = (timeMs - o.tc) / o.period;
      m.uniforms.level.value = level * (id === this.focusId ? 1.6 : 1);
    }
    if (this.crowdLines) {
      this.crowdLines.position.copy(er);
      this.crowdLines.visible = this.layerOn.active && this.fade > 0;
      const m = this.crowdLines.material as THREE.LineBasicMaterial;
      m.color.setScalar(CROWD_OPACITY * level);
    }
    // The focused one's own point would sit a little off its marker so near
    // the camera (float32): hidden within twice its distance.
    const M = this.focusId !== null ? temeToEqj(timeMs) : null;
    const fs = M ? stateEqj(this.sats.get(this.focusId!)!, timeMs, M) as { r: V3; v: V3 } | null : null;
    const f = fs ? eqjToEcl(fs.r) as V3 : null;
    const fRel: V3 | null = f && [earth[0] + f[0] - cam[0], earth[1] + f[1] - cam[1], earth[2] + f[2] - cam[2]];
    u.uHide.value = fRel ? 2 * Math.hypot(fRel[0], fRel[1], fRel[2]) / UNIT_KM + 0.001 : 0;
    this.placeNear(timeMs, fs, fRel, M, level);
    this.model.update(this.focusId, fs, fRel, this.sunEqj, this.toRenderM, this.pxPerRad, this.moonEqj);
  }

  // The view's scale, for sizing the model: pixels per radian at the centre.
  setView(pxPerRad: number): void { this.pxPerRad = pxPerRad; }

  // Close to the focused satellite: its orbit's stretch about it, from SGP4
  // this frame, placed at its render position (rel, km from the camera);
  // the far line (or its constellation's segments) leaves that stretch to
  // it. Ends on far-line samples, so the two meet at a vertex.
  private placeNear(timeMs: number, s: { r: V3 } | null, rel: V3 | null, M: number[][] | null, level: number): void {
    const id = this.focusId, at = id !== null ? this.orbitAt.get(id) : undefined, o = id !== null ? this.orbits.get(id) : undefined;
    const row = id !== null ? this.crowdRow.get(id) : undefined;
    const drawnFar = o ? o.line.visible : row !== undefined && !!this.crowdLines?.visible;
    const close = !!s && !!rel && !!at && drawnFar && Math.hypot(rel[0], rel[1], rel[2]) < CLOSE_SHARE * Math.hypot(s.r[0], s.r[1], s.r[2]);
    // The sample the satellite is at, along the far line (0 to 128).
    const x = close ? ((timeMs - at!.tc) / at!.period + 0.5) * (ORBIT_SAMPLES - 1) : NaN;
    const lo = Math.max(0, Math.floor(x) - NEAR_SPAN), hi = Math.min(ORBIT_SAMPLES - 1, Math.ceil(x) + NEAR_SPAN);
    const on = close && x >= 0 && x <= ORBIT_SAMPLES - 1;
    for (const [oid, line] of this.orbits) {
      const gap = (line.line.material as THREE.ShaderMaterial).uniforms.gap.value as THREE.Vector2;
      if (on && oid === id) gap.set(((lo + hi) / 2) / (ORBIT_SAMPLES - 1) - 0.5, (hi - lo) / 2 / (ORBIT_SAMPLES - 1));
      else gap.set(0, -1);
    }
    this.hideCrowd(on && !o && row !== undefined ? { row: row!, lo, hi } : null);
    if (!on) { if (this.near) this.near.visible = false; return; }
    const near = this.near ?? this.makeNear();
    const rec = this.sats.get(id!)!, { tc, period } = at!, r0 = s!.r;
    const tLo = tc + (lo / (ORBIT_SAMPLES - 1) - 0.5) * period, tHi = tc + (hi / (ORBIT_SAMPLES - 1) - 0.5) * period;
    const g = near.geometry, pos = g.getAttribute('position') as THREE.BufferAttribute, us = g.getAttribute('u') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array, ua = us.array as Float32Array, v = this.tmp;
    let last: number[] = r0;
    for (let k = -NEAR_STEPS; k <= NEAR_STEPS; k++) {
      const q = k / NEAR_STEPS, t = k === 0 ? timeMs : timeMs + (k < 0 ? timeMs - tLo : tHi - timeMs) * q * Math.abs(q);
      const st = k === 0 ? null : stateTeme(rec, t);
      if (st) last = apply(M!, st.r);
      const p = k === 0 ? r0 : last, i = k + NEAR_STEPS;
      v.set(p[0] - r0[0], p[1] - r0[1], p[2] - r0[2]).applyMatrix3(this.toRenderM).multiplyScalar(1 / UNIT_KM);
      pa[i * 3] = v.x; pa[i * 3 + 1] = v.y; pa[i * 3 + 2] = v.z;
      ua[i] = (t - tc) / period;
    }
    pos.needsUpdate = true; us.needsUpdate = true;
    near.position.set(rel![0] / UNIT_KM, rel![2] / UNIT_KM, -rel![1] / UNIT_KM);
    const group = this.named.find((n) => n.id === id)!.group;
    if (o) {
      // As the far line is drawn: its colour, trail and focused level.
      const m = this.nearTrail!, fm = (o.line.material as THREE.ShaderMaterial).uniforms;
      m.uniforms.colour.value.copy(fm.colour.value);
      m.uniforms.now.value = fm.now.value;
      m.uniforms.level.value = fm.level.value;
      near.material = m;
    } else {
      this.nearPlain!.color.set(COLOUR_OF[group]).lerp(WHITE, 0.35).multiplyScalar(CROWD_OPACITY * level);
      near.material = this.nearPlain!;
    }
    near.visible = true;
  }

  private makeNear(): THREE.Line {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NEAR_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('u', new THREE.BufferAttribute(new Float32Array(NEAR_N), 1).setUsage(THREE.DynamicDrawUsage));
    this.nearTrail = orbitTrailMaterial(0xffffff, 0.22, 0.12);
    this.nearPlain = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    this.near = new THREE.Line(g, this.nearTrail);
    this.near.frustumCulled = false;
    this.scene.add(this.near);
    return this.near;
  }

  // A constellation member's far segments lo to hi, blacked out (the line
  // set adds its colours) while the close-up stretch draws them; the last
  // ones put back.
  private hideCrowd(want: { row: number; lo: number; hi: number } | null): void {
    const h = this.crowdHidden;
    if (h === want || (h && want && h.row === want.row && h.lo === want.lo && h.hi === want.hi) || !this.crowdLines) return;
    const col = this.crowdLines.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!col) return;
    const a = col.array as Float32Array, segs = ORBIT_SAMPLES - 1, c = new THREE.Color();
    const paint = (x: { row: number; lo: number; hi: number }, on: boolean) => {
      const id = [...this.crowdRow].find(([, q]) => q === x.row)?.[0];
      const n = this.named.find((y) => y.id === id);
      if (on && n) c.set(COLOUR_OF[n.group]).lerp(WHITE, 0.35); else c.setRGB(0, 0, 0);
      for (let k = x.lo; k < x.hi; k++) {
        const o = (x.row * segs + k) * 6;
        a[o] = a[o + 3] = c.r; a[o + 1] = a[o + 4] = c.g; a[o + 2] = a[o + 5] = c.b;
      }
    };
    if (h) paint(h, true);
    if (want) paint(want, false);
    col.needsUpdate = true;
    this.crowdHidden = want;
  }

  // ----- The named ones -----
  get namedSats(): readonly NamedSat[] { return this.named; }
  sat(id: number): { omm: Omm; rec: ReturnType<typeof satrecOf>; named: NamedSat } | null {
    const rec = this.sats.get(id), named = this.named.find((n) => n.id === id);
    return rec && named ? { omm: rec.omm, rec, named } : null;
  }

  // Geocentric J2000 state now, by SGP4.
  stateEqj(id: number, timeMs = this.timeMs): { r: V3; v: V3 } | null {
    const s = this.sats.get(id);
    return s ? stateEqj(s, timeMs, temeToEqj(timeMs)) as { r: V3; v: V3 } | null : null;
  }

  // Heliocentric ecliptic km of a named satellite (where its marker is),
  // at a time and with the Earth's position then (the last frame's, if not
  // given).
  positionKm(id: number, timeMs = this.timeMs, earth: readonly number[] = this.earth): V3 | null {
    const s = this.stateEqj(id, timeMs);
    if (!s) return null;
    const r = eqjToEcl(s.r) as V3;
    return [earth[0] + r[0], earth[1] + r[1], earth[2] + r[2]];
  }

  setFocus(id: number | null): void { this.focusId = id; }

  // ----- Search, by name, NORAD id or international designator -----
  search(query: string, limit = 8): SatHit[] {
    const q = query.trim().toUpperCase();
    if (!q) return [];
    const hits: number[] = [];
    const id = /^\d+$/.test(q) ? Number(q) : NaN;
    if (Number.isFinite(id) && this.index.has(id)) hits.push(this.index.get(id)!);
    // The named ones by the names the app gives them ("Hubble" is HST in
    // the catalogue, "Tiangong" CSS (TIANHE)).
    for (const n of this.named) {
      const j = this.index.get(n.id);
      if (j !== undefined && !hits.includes(j) && n.name.toUpperCase().includes(q)) hits.push(j);
    }
    for (let j = 0; j < this.rows.length && hits.length < limit; j++) {
      const r = this.rows[j];
      if (hits.includes(j)) continue;
      if (r.OBJECT_NAME.toUpperCase().includes(q) || r.OBJECT_ID.toUpperCase().startsWith(q) || (Number.isFinite(id) && String(r.NORAD_CAT_ID).startsWith(q))) hits.push(j);
    }
    return hits.map((j) => {
      const r = this.rows[j];
      const n = this.named.find((x) => x.id === r.NORAD_CAT_ID);
      const name = n && n.name.toUpperCase() !== r.OBJECT_NAME.toUpperCase() ? `${n.name} (${r.OBJECT_NAME})` : r.OBJECT_NAME;
      const layer = this.rowLayer[j];
      return { j, des: String(r.NORAD_CAT_ID), label: `${name} · ${r.NORAD_CAT_ID}`, kind: layer === 'active' ? orbitClass(r) : `${LAYER_NOUN[layer]}, ${orbitClass(r)}`, layer };
    });
  }

  // Make row j a named satellite (a marker, an orbit, a plate). Returns its id.
  adopt(j: number): number | null {
    const r = this.rows[j];
    if (!r) return null;
    const id = r.NORAD_CAT_ID;
    if (!this.sats.has(id)) {
      const layer = this.rowLayer[j], name = r.OBJECT_NAME.replace(/\s+/g, ' ').trim();
      const n: NamedSat = { id, name: name && name !== 'UNKNOWN' ? name : `Object ${id}`, group: 'found', layer };
      this.named = [...this.named, n];
      this.sats.set(id, satrecOf(r));
      this.makeMarker(n);
      this.onNamed(this.named, this.source);
    }
    return id;
  }

  // The same by NORAD id: rows move when another set loads.
  adoptId(id: number): number | null {
    const j = this.index.get(id);
    return j === undefined ? null : this.adopt(j);
  }

  // ----- The live refresh -----
  // CelesTrak's current element sets, at the user's request, no more than
  // once in two hours from this browser; any answer but 200 stops it, as
  // CelesTrak's usage policy asks.
  async fetchLatest(): Promise<string> {
    let last = 0;
    try { last = Number(localStorage.getItem(LIVE_KEY)) || 0; } catch { /* storage off: no memory of the last */ }
    const wait = last + LIVE_MIN_MS - Date.now();
    if (wait > 0) return `CelesTrak updates every 2 hours: try again in ${Math.ceil(wait / 60e3)} min`;
    // Marked once CelesTrak has answered, any answer (its usage policy counts
    // requests); a request that never reached it (offline) uses up nothing.
    let res: Response;
    try { res = await fetch(LIVE_URL); } catch (e) { return `CelesTrak could not be reached: ${(e as Error).message ?? e}`; }
    try { localStorage.setItem(LIVE_KEY, String(Date.now())); } catch { /* as above */ }
    if (res.status !== 200) return `CelesTrak answered HTTP ${res.status}: not asked again`;
    const text = await res.text();
    if (parseGpCsv(text).length < 1000) return 'CelesTrak\'s answer held no catalogue';
    this.source = { label: 'CelesTrak GP, live', fetched: new Date().toISOString(), live: true };
    this.setRows('active', text);
    return `${this.sets.get('active')!.rows.length.toLocaleString('en-AU')} element sets from CelesTrak`;
  }

  // Where a named one's elements came from: the live ones are the active
  // satellites'; the debris, rocket bodies and analyst objects are always
  // the snapshot's.
  sourceOf(id: number): SatSource | null {
    const layer = this.named.find((n) => n.id === id)?.layer ?? 'active';
    if (layer === 'active') return this.source;
    const at = this.snapshotAt[layer];
    return at ? { label: 'CelesTrak GP, snapshot', fetched: at, live: false } : null;
  }

  // ----- The debris clouds -----
  get clouds(): readonly SatCloud[] { return this.cloudList; }

  // Pick a cloud (its pieces brighter, the rest dimmer), or none.
  setCloud(key: string | null): void {
    this.pick = key === null ? 0 : this.cloudList.findIndex((c) => c.key === key) + 1;
  }

  // The cloud's pieces' orbits, from their element sets (worked out once
  // for each set of rows).
  private views = new Map<string, { rows: Omm[]; view: SatCloudView }>();
  cloudView(key: string): SatCloudView | null {
    const c = this.cloudList.find((x) => x.key === key), set = this.sets.get('debris');
    if (!c || !set) return null;
    const kept = this.views.get(key);
    if (kept?.rows === set.rows) return kept.view;
    const rows = set.rows.filter((r) => r.OBJECT_ID.startsWith(c.intdes));
    const q = (a: number[]): [number, number, number] => {
      const s = a.slice().sort((x, y) => x - y), at = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
      return [at(0.1), at(0.5), at(0.9)];
    };
    // SGP4's mean semi-major axis from the Kozai mean motion (rev/day),
    // with WGS-72's mu and radius: within a few kilometres of its own.
    const MU = 398600.8, RE = 6378.135;
    const a = rows.map((r) => Math.cbrt(MU / (r.MEAN_MOTION * 2 * Math.PI / 86400) ** 2));
    const epochs = rows.map((r) => r.EPOCH).sort();
    const view: SatCloudView = {
      ...c, tracked: rows.length, fetched: this.snapshotAt.debris ?? '',
      perigee: q(rows.map((r, j) => a[j] * (1 - r.ECCENTRICITY) - RE)), apogee: q(rows.map((r, j) => a[j] * (1 + r.ECCENTRICITY) - RE)),
      incl: q(rows.map((r) => r.INCLINATION)), aKm: q(a)[1],
      epochs: { first: epochs[0] ?? '', median: epochs[epochs.length >> 1] ?? '' },
    };
    this.views.set(key, { rows: set.rows, view });
    return view;
  }

  // The overlay's size in CSS pixels, from the scene's resize(), so the
  // labels need not read clientWidth each frame (which forces a layout after
  // other layers' style writes). 0 until it is set: then the overlay is read.
  private viewW = 0;
  private viewH = 0;
  setViewSize(w: number, h: number): void { this.viewW = w; this.viewH = h; }

  // ----- Labels -----
  // The named ones' markers, placed where SGP4 puts them: hidden behind the
  // Earth, beyond the camera's reach (a station within 60,000 km, the rest
  // while the camera is within 200,000 km of the Earth) or on another label.
  private label(camera: THREE.Camera): void {
    const w = this.viewW || this.overlay.clientWidth, h = this.viewH || this.overlay.clientHeight, px = window.devicePixelRatio || 1;
    const placed: [number, number][] = [];
    const cam = this.cam, e = this.earth;
    const M = temeToEqj(this.timeMs);
    // The focused one first, so it keeps its label.
    const order = [...this.named].sort((a, b) => (b.id === this.focusId ? 1 : 0) - (a.id === this.focusId ? 1 : 0));
    for (const n of order) {
      const el = this.markers.get(n.id)!;
      const focused = n.id === this.focusId;
      el.classList.toggle('focused', focused);
      const s = this.namedOn(n) || focused ? stateEqj(this.sats.get(n.id)!, this.timeMs, M) : null;
      if (!s) { el.style.display = 'none'; continue; }
      const rEcl = eqjToEcl(s.r) as V3;
      const rel: V3 = [e[0] + rEcl[0] - cam[0], e[1] + rEcl[1] - cam[1], e[2] + rEcl[2] - cam[2]];
      const d = Math.hypot(rel[0], rel[1], rel[2]);
      // A constellation's members only close by (dozens of markers moved
      // every frame cost an integrated GPU 4 ms): their points and orbits
      // show them, and the rail's list flies to them.
      const near = isCrowd(n.group) ? d < 2e4 : d < 6e4;
      if (!focused && (!near || this.fade <= 0)) { el.style.display = 'none'; continue; }
      if (behindEarth(rel, [e[0] - cam[0], e[1] - cam[1], e[2] - cam[2]], d)) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM).project(camera);
      if (ndc.z > 1 || ndc.z < -1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * px) / px, y = Math.round(((1 - ndc.y) / 2) * h * px) / px;
      // A constellation's members show their names on hover only: dozens
      // round the Earth would bury it.
      const quiet = !focused && (isCrowd(n.group) || placed.some(([qx, qy]) => Math.abs(qx - x) < 60 && Math.abs(qy - y) < 12));
      el.classList.toggle('quiet', quiet);
      if (!quiet) placed.push([x, y]);
      el.classList.toggle('shadow', inShadow(s.r, this.sunEqj, this.moonEqj));
      el.classList.toggle('modelled', focused && this.model.shown);
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.model.dispose();
    this.worker?.terminate();
    for (const set of this.sets.values()) { this.scene.remove(set.points); set.points.geometry.dispose(); set.material.dispose(); }
    for (const o of this.orbits.values()) { this.scene.remove(o.line); o.line.geometry.dispose(); (o.line.material as THREE.Material).dispose(); }
    if (this.crowdLines) { this.scene.remove(this.crowdLines); this.crowdLines.geometry.dispose(); (this.crowdLines.material as THREE.Material).dispose(); }
    if (this.near) { this.scene.remove(this.near); this.near.geometry.dispose(); this.nearTrail?.dispose(); this.nearPlain?.dispose(); }
    for (const el of this.markers.values()) el.remove();
  }
}

// Is a point d km from the camera (at rel) behind the Earth (centre at
// earthRel) as the camera sees it?
function behindEarth(rel: V3, earthRel: V3, d: number): boolean {
  const ux = rel[0] / d, uy = rel[1] / d, uz = rel[2] / d;
  const t = earthRel[0] * ux + earthRel[1] * uy + earthRel[2] * uz;
  if (t <= 0 || t >= d) return false;
  const cx = earthRel[0] - t * ux, cy = earthRel[1] - t * uy, cz = earthRel[2] - t * uz;
  return cx * cx + cy * cy + cz * cz < R_EARTH_KM * R_EARTH_KM;
}
