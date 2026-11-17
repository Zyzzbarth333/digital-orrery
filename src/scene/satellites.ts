// src/scene/satellites.ts
//
// Earth satellites (src/physics/satellites.js, docs/frontend/satellites.md):
// every active satellite in CelesTrak's catalogue as a point, the named ones
// (the ISS, Tiangong, Hubble, GPS, Galileo, the geostationary weather
// satellites, and any found by search) with a marker, a label and their
// orbit.
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
// bodies'), and a satellite in the Earth's shadow (a cylinder of the Earth's
// radius, satellites.js inShadow) is drawn at a fifth. The layer fades out
// as the camera leaves the Earth's neighbourhood (1 to 3 million km).
//
// Positions are camera-relative, one render unit is 1000 km, and render
// (x, y, z) is ecliptic (x, z, -y): the Earth's render position is worked
// out in double precision on the CPU and the shader adds each satellite's
// geocentric position to it.

import * as THREE from 'three';
import { eqjToEcl, eclToEqj } from '../physics/ephemeris.js';
import { parseGpCsv, satrecOf, stateEqj, temeToEqj, inShadow, R_EARTH_KM } from '../physics/satellites.js';
import { orbitTrailMaterial } from './orbitTrail';

type V3 = [number, number, number];
const UNIT_KM = 1000;
const REFRESH_S = 5;
// And no more than ten times a second, whatever the rate: each refresh sends
// 0.7 MB to the GPU, and at a day a second the points are a blur anyway.
const REFRESH_MIN_MS = 100;
const ORBIT_SAMPLES = 129;
// The points' peak (a display value) at D_REF km from the camera, its cap,
// and the shadow's share.
const PEAK_REF = 0.35, D_REF_KM = 40000, PEAK_MAX = 1.2, SHADOW = 0.2;
const FADE_NEAR_KM = 1e6, FADE_FAR_KM = 3e6;
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

type Omm = ReturnType<typeof parseGpCsv>[number];
export interface NamedSat { id: number; name: string; group: SatGroup }
export interface SatSource { label: string; fetched: string; live: boolean }
export interface SatHit { j: number; des: string; label: string; kind: string }

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
  attribute vec3 aP;           // perifocal axes, J2000
  attribute vec3 aQ;
  attribute vec4 aK;           // a (km), e, M at t0 (rad), n (rad/s); a = 0: not placed
  uniform float uDt;           // s since t0
  uniform vec3 uEarth;         // the Earth, camera-relative, render units
  uniform mat3 uToRender;      // J2000 equatorial -> render axes
  uniform vec3 uSun;           // unit vector Earth -> Sun, J2000
  uniform float uLevel, uVis, uSize, uPeakScale, uFade, uHide;
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
    // In the Earth's shadow: behind it, within its radius of the axis.
    float along = dot(r, uSun);
    vec3 off = r - along * uSun;
    float lit = along < 0.0 && dot(off, off) < ${(R_EARTH_KM * R_EARTH_KM).toFixed(1)} ? ${SHADOW.toFixed(2)} : 1.0;
    float peak = min(${PEAK_REF.toFixed(3)} * ${D_REF_KM.toFixed(1)} / max(d * ${UNIT_KM.toFixed(1)}, 1.0), ${PEAK_MAX.toFixed(2)}) * lit * uFade * uVis;
    if (peak < 1.0 / 512.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColour = vec3(0.0); return; }
    gl_PointSize = peak < 0.3 ? min(uSize, 3.0) : uSize;
    vSize = gl_PointSize;
    // Sunlit metal and panels: a warm white; in shadow, the Earth's blue glow.
    vec3 col = lit < 1.0 ? vec3(0.55, 0.62, 0.80) : vec3(0.95, 0.93, 0.86);
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

export class SatelliteLayer {
  private on = false;
  private loading: Promise<void> | null = null;
  private worker: Worker | null = null;
  private busy = false;
  private orbitBusy = false;
  private rows: Omm[] = [];
  private index = new Map<number, number>();         // NORAD id -> row
  private sats = new Map<number, ReturnType<typeof satrecOf>>();   // the named ones' SGP4 records
  private named: NamedSat[] = [];
  private markers = new Map<number, HTMLDivElement>();
  private orbits = new Map<number, Orbit>();
  private material: THREE.ShaderMaterial;
  private points: THREE.Points | null = null;
  private buffer: THREE.InterleavedBuffer | null = null;
  private t0 = NaN;
  private timeMs = 0;
  private cam: V3 = [0, 0, 0];
  private earth: V3 = [0, 0, 0];
  private toRenderM = new THREE.Matrix3();
  private sunEqj: V3 = [1, 0, 0];
  private fade = 1;
  private focusId: number | null = null;
  private tmp = new THREE.Vector3();
  private disposed = false;
  source: SatSource | null = null;
  count = 0;
  // A marker clicked: the scene flies there.
  onPick: (id: number) => void = () => {};
  // The named list and the data's source, once they are known.
  onNamed: (named: readonly NamedSat[], source: SatSource | null) => void = () => {};

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private baseUrl = '') {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      transparent: true, depthTest: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uDt: { value: 0 }, uEarth: { value: new THREE.Vector3() }, uToRender: { value: new THREE.Matrix3() }, uSun: { value: new THREE.Vector3(1, 0, 0) },
        uLevel: { value: 1 }, uVis: { value: 1 }, uSigma: { value: 1 }, uSize: { value: 7 }, uPeakScale: { value: 1 }, uFade: { value: 1 }, uHide: { value: 0 },
      },
    });
    // J2000 equatorial -> render: through the ecliptic (eqjToEcl), then
    // render (x, y, z) = ecliptic (x, z, -y).
    const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((b) => eqjToEcl(b) as V3);
    this.toRenderM.set(
      cols[0][0], cols[1][0], cols[2][0],
      cols[0][2], cols[1][2], cols[2][2],
      -cols[0][1], -cols[1][1], -cols[2][1],
    );
    (this.material.uniforms.uToRender.value as THREE.Matrix3).copy(this.toRenderM);
  }

  get shown(): boolean { return this.on; }

  setOn(on: boolean): void {
    this.on = on;
    if (on) this.loading ??= this.load();
    if (this.points) this.points.visible = on;
    for (const o of this.orbits.values()) o.line.visible = on;
    if (!on) for (const el of this.markers.values()) el.style.display = 'none';
  }

  private async load(): Promise<void> {
    try {
      const [csv, meta] = await Promise.all([
        fetch(`${this.baseUrl}data/satellites.csv`).then((r) => { if (!r.ok) throw new Error(`satellites.csv: HTTP ${r.status}`); return r.text(); }),
        fetch(`${this.baseUrl}data/satellites.json`).then((r) => r.json()),
      ]);
      if (this.disposed) return;
      this.named = (meta.named as NamedSat[]).map((n) => ({ ...n }));
      this.setGp(csv, { label: 'CelesTrak GP, snapshot', fetched: meta.fetched, live: false });
    } catch (err) {
      console.warn(`satellites not loaded: ${err}`);
      this.loading = null;
    }
  }

  // New element sets (the snapshot, or the live ones): the worker and the
  // named ones' records start again from them.
  private setGp(csv: string, source: SatSource): void {
    this.rows = parseGpCsv(csv);
    this.index = new Map(this.rows.map((r, j) => [r.NORAD_CAT_ID, j]));
    this.count = this.rows.length;
    this.source = source;
    this.named = this.named.filter((n) => this.index.has(n.id));
    this.sats.clear();
    for (const n of this.named) this.sats.set(n.id, satrecOf(this.rows[this.index.get(n.id)!]));
    for (const n of this.named) if (!this.markers.has(n.id)) this.makeMarker(n);
    for (const [id, el] of this.markers) if (!this.sats.has(id)) { el.remove(); this.markers.delete(id); }
    this.makePoints();
    this.t0 = NaN;
    for (const o of this.orbits.values()) o.tc = NaN;
    this.worker ??= this.startWorker();
    this.busy = true;
    this.worker.postMessage({ type: 'gp', csv });
    this.onNamed(this.named, this.source);
  }

  private startWorker(): Worker {
    const w = new Worker(new URL('./satellites.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'ready') { this.busy = false; this.ask(); }
      else if (m.type === 'step') { this.busy = false; this.takeStep(m.t, m.buf); this.ask(); }
      else if (m.type === 'orbits') { this.orbitBusy = false; this.takeOrbits(m.t, m.ids, m.buf, m.periods); }
    };
    return w;
  }

  private makePoints(): void {
    const n = this.rows.length;
    this.buffer = new THREE.InterleavedBuffer(new Float32Array(n * 10), 10);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(n), 1));
    g.setAttribute('aP', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    g.setAttribute('aQ', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    g.setAttribute('aK', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    if (this.points) { this.points.geometry.dispose(); this.points.geometry = g; return; }
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.visible = this.on;
    this.points.onBeforeRender = (_r, _s, camera) => this.label(camera);
    this.scene.add(this.points);
  }

  // Ask the worker for the next ellipses when it is free and the clock has
  // moved: for the time now plus the time it took last (at the clock's
  // rate), so they arrive centred on the clock.
  private lastAsk = 0;
  private lastAskT = 0;
  private lag = 30;
  private rate = 0;
  private ask(): void {
    if (!this.worker || this.busy || !this.on) return;
    if (Math.abs(this.timeMs - this.t0) < REFRESH_S * 1000) return;
    if (Number.isFinite(this.t0) && performance.now() - this.lastAsk < REFRESH_MIN_MS) return;
    this.busy = true;
    this.lastAsk = performance.now();
    this.lastAskT = this.timeMs;
    this.worker.postMessage({ type: 'step', t: this.timeMs + this.rate * this.lag });
  }

  private takeStep(t: number, buf: Float32Array): void {
    this.lag = Math.min(500, performance.now() - this.lastAsk);
    if (!this.buffer || buf.length !== this.buffer.array.length) return;
    this.buffer.array = buf;
    this.buffer.needsUpdate = true;
    this.t0 = t;
  }

  private lastOrbits = 0;
  private askOrbits(): void {
    if (!this.worker || this.orbitBusy || !this.on || !this.named.length) return;
    const due = this.named.some((n) => { const o = this.orbits.get(n.id); return !o || !(Math.abs(this.timeMs - o.tc) < 0.3 * o.period); });
    if (!due || performance.now() - this.lastOrbits < 4 * REFRESH_MIN_MS) return;
    this.lastOrbits = performance.now();
    this.orbitBusy = true;
    this.worker.postMessage({ type: 'orbits', t: this.timeMs + this.rate * this.lag, ids: this.named.map((n) => n.id), samples: ORBIT_SAMPLES });
  }

  private takeOrbits(t: number, ids: number[], buf: Float32Array, periods: Float64Array): void {
    const v = new THREE.Vector3();
    ids.forEach((id, j) => {
      const n = this.named.find((x) => x.id === id);
      if (!n || !(periods[j] > 0)) return;
      let o = this.orbits.get(id);
      if (!o) {
        const g = new THREE.BufferGeometry();
        const u = new Float32Array(ORBIT_SAMPLES);
        for (let k = 0; k < ORBIT_SAMPLES; k++) u[k] = k / (ORBIT_SAMPLES - 1) - 0.5;
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ORBIT_SAMPLES * 3), 3));
        g.setAttribute('u', new THREE.BufferAttribute(u, 1));
        // The stations' and other single satellites' orbits plainer than a
        // constellation's, whose dozens of lines would fill the view.
        const crowd = n.group === 'gps' || n.group === 'galileo' || n.group === 'weather';
        const line = new THREE.Line(g, orbitTrailMaterial(new THREE.Color(COLOUR_OF[n.group]).getHex(), crowd ? 0.08 : 0.22, 0.12));
        line.frustumCulled = false;
        line.visible = this.on;
        this.scene.add(line);
        o = { line, tc: t, period: periods[j] };
        this.orbits.set(id, o);
      }
      const pos = o.line.geometry.getAttribute('position') as THREE.BufferAttribute, arr = pos.array as Float32Array;
      for (let k = 0; k < ORBIT_SAMPLES; k++) {
        const b = (j * ORBIT_SAMPLES + k) * 3;
        v.set(buf[b], buf[b + 1], buf[b + 2]).applyMatrix3(this.toRenderM).multiplyScalar(1 / UNIT_KM);
        arr[k * 3] = v.x; arr[k * 3 + 1] = v.y; arr[k * 3 + 2] = v.z;
      }
      pos.needsUpdate = true;
      o.tc = t; o.period = periods[j];
    });
    for (const [id, o] of this.orbits) {
      if (this.named.some((n) => n.id === id)) continue;
      this.scene.remove(o.line); o.line.geometry.dispose(); (o.line.material as THREE.Material).dispose();
      this.orbits.delete(id);
    }
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
    const u = this.material.uniforms;
    const want = (0.55 + 0.35 * deviceRatio) * (renderRatio / deviceRatio), sigma = Math.max(0.8, want);
    u.uSigma.value = sigma;
    u.uSize.value = Math.ceil(7 * sigma) + 1;
    u.uPeakScale.value = (want / sigma) ** 2;
  }

  // Each frame, before the render: the time (UTC ms), the camera's and the
  // Earth's heliocentric ecliptic positions (km), 1 / the exposure and the
  // eye's adaptation.
  private lastFrame = 0;
  update(timeMs: number, cam: readonly number[], earth: readonly number[], level: number, visibility = 1): void {
    const now = performance.now();
    if (this.lastFrame && now > this.lastFrame) this.rate += ((timeMs - this.timeMs) / (now - this.lastFrame) - this.rate) * 0.2;
    this.lastFrame = now;
    this.timeMs = timeMs;
    this.cam = [cam[0], cam[1], cam[2]];
    this.earth = [earth[0], earth[1], earth[2]];
    if (!this.on || !this.points) return;
    this.ask();
    this.askOrbits();
    const u = this.material.uniforms;
    u.uDt.value = Number.isFinite(this.t0) ? (timeMs - this.t0) / 1000 : 0;
    const rel: V3 = [earth[0] - cam[0], earth[1] - cam[1], earth[2] - cam[2]];
    const er = (u.uEarth.value as THREE.Vector3).set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM);
    const dE = Math.hypot(rel[0], rel[1], rel[2]);
    this.fade = Math.max(0, Math.min(1, (FADE_FAR_KM - dE) / (FADE_FAR_KM - FADE_NEAR_KM)));
    u.uFade.value = Number.isFinite(this.t0) ? this.fade : 0;
    const s = eclToEqj([-earth[0], -earth[1], -earth[2]]) as V3, sn = Math.hypot(s[0], s[1], s[2]);
    this.sunEqj = [s[0] / sn, s[1] / sn, s[2] / sn];
    (u.uSun.value as THREE.Vector3).set(...this.sunEqj);
    u.uLevel.value = level;
    u.uVis.value = visibility;
    for (const [id, o] of this.orbits) {
      o.line.position.copy(er);
      o.line.visible = this.fade > 0 && Number.isFinite(o.tc);
      const m = o.line.material as THREE.ShaderMaterial;
      m.uniforms.now.value = (timeMs - o.tc) / o.period;
      m.uniforms.level.value = level * (id === this.focusId ? 1.6 : 1);
    }
    // The focused one's own point would sit a little off its marker so near
    // the camera (float32): hidden within twice its distance.
    const f = this.focusId !== null ? this.positionKm(this.focusId, timeMs, earth) : null;
    u.uHide.value = f ? 2 * Math.hypot(f[0] - cam[0], f[1] - cam[1], f[2] - cam[2]) / UNIT_KM + 0.001 : 0;
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
      return { j, des: String(r.NORAD_CAT_ID), label: `${name} · ${r.NORAD_CAT_ID}`, kind: orbitClass(r) };
    });
  }

  // Make row j a named satellite (a marker, an orbit, a plate). Returns its id.
  adopt(j: number): number | null {
    const r = this.rows[j];
    if (!r) return null;
    const id = r.NORAD_CAT_ID;
    if (!this.sats.has(id)) {
      const n: NamedSat = { id, name: r.OBJECT_NAME.replace(/\s+/g, ' ').trim(), group: 'found' };
      this.named = [...this.named, n];
      this.sats.set(id, satrecOf(r));
      this.makeMarker(n);
      this.onNamed(this.named, this.source);
    }
    return id;
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
    try { localStorage.setItem(LIVE_KEY, String(Date.now())); } catch { /* as above */ }
    const res = await fetch(LIVE_URL);
    if (res.status !== 200) return `CelesTrak answered HTTP ${res.status}: not asked again`;
    const text = await res.text();
    if (parseGpCsv(text).length < 1000) return 'CelesTrak\'s answer held no catalogue';
    this.setGp(text, { label: 'CelesTrak GP, live', fetched: new Date().toISOString(), live: true });
    return `${this.count.toLocaleString('en-AU')} element sets from CelesTrak`;
  }

  // ----- Labels -----
  // The named ones' markers, placed where SGP4 puts them: hidden behind the
  // Earth, beyond the camera's reach (a station within 60,000 km, the rest
  // while the camera is within 200,000 km of the Earth) or on another label.
  private label(camera: THREE.Camera): void {
    const w = this.overlay.clientWidth, h = this.overlay.clientHeight, px = window.devicePixelRatio || 1;
    const placed: [number, number][] = [];
    const cam = this.cam, e = this.earth;
    const dEarth = Math.hypot(e[0] - cam[0], e[1] - cam[1], e[2] - cam[2]);
    const M = temeToEqj(this.timeMs);
    // The focused one first, so it keeps its label.
    const order = [...this.named].sort((a, b) => (b.id === this.focusId ? 1 : 0) - (a.id === this.focusId ? 1 : 0));
    for (const n of order) {
      const el = this.markers.get(n.id)!;
      const focused = n.id === this.focusId;
      el.classList.toggle('focused', focused);
      const s = this.on || focused ? stateEqj(this.sats.get(n.id)!, this.timeMs, M) : null;
      if (!s) { el.style.display = 'none'; continue; }
      const rEcl = eqjToEcl(s.r) as V3;
      const rel: V3 = [e[0] + rEcl[0] - cam[0], e[1] + rEcl[1] - cam[1], e[2] + rEcl[2] - cam[2]];
      const d = Math.hypot(rel[0], rel[1], rel[2]);
      const near = n.group === 'station' || n.group === 'science' || n.group === 'found' ? d < 6e4 : dEarth < 2e5;
      if (!focused && (!near || this.fade <= 0)) { el.style.display = 'none'; continue; }
      if (behindEarth(rel, [e[0] - cam[0], e[1] - cam[1], e[2] - cam[2]], d)) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM).project(camera);
      if (ndc.z > 1 || ndc.z < -1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * px) / px, y = Math.round(((1 - ndc.y) / 2) * h * px) / px;
      // A constellation's members show their names on hover only: dozens
      // round the Earth would bury it.
      const crowd = n.group === 'gps' || n.group === 'galileo' || n.group === 'weather';
      const quiet = !focused && (crowd || placed.some(([qx, qy]) => Math.abs(qx - x) < 60 && Math.abs(qy - y) < 12));
      el.classList.toggle('quiet', quiet);
      if (!quiet) placed.push([x, y]);
      el.classList.toggle('shadow', inShadow(s.r, this.sunEqj));
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    this.material.dispose();
    for (const o of this.orbits.values()) { this.scene.remove(o.line); o.line.geometry.dispose(); (o.line.material as THREE.Material).dispose(); }
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
