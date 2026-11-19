// src/scene/spacecraftLayer.ts
//
// Spacecraft beyond Earth orbit (packages/physics/src/spacecraft.js,
// docs/frontend/spacecraft.md): orbiters of Mercury, the Moon, Mars and
// Jupiter, the observatories about the Sun-Earth L1 and L2 points and the
// probes in cruise, where JPL Horizons places them. Each has a marker, a
// label and its path; the camera can fly to one.
//
// Data: the index once the layer is switched on, then the month the clock
// is in (and the next or last when the clock nears its end), each 0.1 to
// 1 MB. A craft with no data for the clock's day is not drawn.
//
// Drawing:
// - Markers sit in the HTML overlay, a small open square with a cross
//   for a working spacecraft (the user's own craft are diamonds), in its
//   group's colour.
// - An orbiter shows within a few hundred thousand km of its planet (Juno
//   and the L-point observatories from further); a probe in cruise always.
//   Labels that would overlap give way.
// - Paths use the planets' orbit shader: an orbiter's one period about its
//   planet, an L-point observatory's half a year about the Earth, a probe's
//   two months about the Sun, centred on the clock and resampled as it
//   moves.

import * as THREE from 'three';
import { eqjToEcl } from '@digital-orrery/physics/ephemeris.js';
import { parseMonth, segmentAt, stateIn } from '@digital-orrery/physics/spacecraft.js';
import { getBuffer, getJson } from '../browser/fetchData.js';
import { orbitTrailMaterial } from './orbitTrail';
import { BODY_BY_KEY, type BodyKey } from './catalogue';
import { probeModelKey } from './probeModels';
import type { ModelPose } from './craftModels';

type V3 = [number, number, number];
const UNIT_KM = 1000, DAY = 86400e3;
const PATH_SAMPLES = 160;

export type ProbeGroup = 'mercury' | 'moon' | 'mars' | 'jupiter' | 'lagrange' | 'cruise';
export const PROBE_GROUPS: { key: ProbeGroup; label: string; colour: string; showKm: number }[] = [
  { key: 'mercury', label: 'Mercury', colour: '#c9b8a3', showKm: 3e5 },
  { key: 'moon', label: 'The Moon', colour: '#d6d6d6', showKm: 2.5e5 },
  { key: 'mars', label: 'Mars', colour: '#e0805a', showKm: 3e5 },
  { key: 'jupiter', label: 'Jupiter', colour: '#d9b38c', showKm: 2e7 },
  { key: 'lagrange', label: 'Sun-Earth L1 and L2', colour: '#9fc3e6', showKm: 1.2e7 },
  { key: 'cruise', label: 'In cruise', colour: '#ecd9b0', showKm: Infinity },
];
const GROUP = Object.fromEntries(PROBE_GROUPS.map((g) => [g.key, g])) as Record<ProbeGroup, (typeof PROBE_GROUPS)[number]>;

export interface Probe {
  key: string; name: string; short: string; id: number; group: ProbeGroup; centre: string; target: string | null; revised: string | null;
  days: number; spacingMin: [number, number] | null; maxErrKm: number; conicDays: number;
  legs: { name: string; start: string; stop: string }[];
}
interface Index { source: string; fetched: string; span: [string, string]; tolKm: number; centres: { key: string; naif: number; mu: number }[]; craft: Probe[]; months: string[] }
type Month = ReturnType<typeof parseMonth>;
interface Path { line: THREE.Line; tc: number; span: number; at: number }
// A path is resampled at most this often (ms of real time): at a day a
// second a low orbiter's quarter period passes every frame.
const PATH_MIN_MS = 250;

// J2000 equatorial -> render axes (through the ecliptic: render (x, y, z) =
// ecliptic (x, z, -y)).
function eqjToRenderMatrix(): THREE.Matrix3 {
  const c = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((b) => eqjToEcl(b) as V3);
  return new THREE.Matrix3().set(c[0][0], c[1][0], c[2][0], c[0][2], c[1][2], c[2][2], -c[0][1], -c[1][1], -c[2][1]);
}

export class SpacecraftLayer {
  private on = false;
  private index: Index | null = null;
  private loading: Promise<void> | null = null;
  private months = new Map<string, Month | 'loading' | 'missing'>();
  private fetching = new Map<string, Promise<void>>();     // a month's fetch, while it runs
  private markers = new Map<string, HTMLDivElement>();
  private paths = new Map<string, Path>();
  private toRenderM = eqjToRenderMatrix();
  private tmp = new THREE.Vector3();
  private timeMs = 0;
  private cam: V3 = [0, 0, 0];
  private focusKey: string | null = null;
  private disposed = false;
  // A marker clicked: the scene flies there.
  onPick: (key: string) => void = () => {};
  // The craft list, once the index has loaded.
  onIndex: (craft: readonly Probe[], fetched: string) => void = () => {};

  // centreAt: a centre body's heliocentric ecliptic position (km) this
  // frame ([0, 0, 0] for the Sun), from the scene's states.
  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private centreAt: (key: string) => V3 | null, private baseUrl = '') {}

  get shown(): boolean { return this.on; }
  get craft(): readonly Probe[] { return this.index?.craft ?? []; }
  probe(key: string): Probe | undefined { return this.index?.craft.find((c) => c.key === key); }
  get tolKm(): number { return this.index?.tolKm ?? 0; }

  setOn(on: boolean): void {
    this.on = on;
    if (on) this.loading ??= this.load();
    for (const p of this.paths.values()) p.line.visible = on;
    if (!on) for (const [key, el] of this.markers) if (key !== this.focusKey) el.style.display = 'none';
  }

  // The index (21 kB) without switching the layer on, for the rail's FIND
  // field (find.tsx): the craft, or none if it fails. Markers stay hidden.
  async loadIndex(): Promise<readonly Probe[]> {
    this.loading ??= this.load();
    await this.loading;
    return this.craft;
  }

  private async load(): Promise<void> {
    try {
      const ix = await getJson(`${this.baseUrl}data/spacecraft/index.json`, 'index.json') as Index;
      if (this.disposed) return;
      this.index = ix;
      for (const c of ix.craft) if (c.days > 0) this.makeMarker(c);
      this.onIndex(ix.craft, ix.fetched);
    } catch (err) {
      console.warn(`spacecraft not loaded: ${err}`);
      this.loading = null;
    }
  }

  // The month file holding t, fetched once; null until it has arrived.
  private month(t: number): Month | null {
    if (!this.index) return null;
    const key = new Date(t).toISOString().slice(0, 7);
    const m = this.months.get(key);
    if (m && m !== 'loading' && m !== 'missing') return m;
    if (!m) {
      if (!this.index.months.includes(key)) { this.months.set(key, 'missing'); return null; }
      this.months.set(key, 'loading');
      const base = `${this.baseUrl}data/spacecraft/${key}`;
      this.fetching.set(key, Promise.all([getJson(`${base}.json`, `${key}.json`), getBuffer(`${base}.bin`, `${key}.bin`)])
        .then(([json, bin]) => { this.months.set(key, parseMonth(json, bin)); this.resample(); })
        .catch((err) => { console.warn(`spacecraft ${key} not loaded: ${err}`); this.months.delete(key); })
        .finally(() => this.fetching.delete(key)));
    }
    return null;
  }

  // Resolves once a craft has a place at now() (true), or false once its
  // month has arrived with no state that day, is missing or failed to load,
  // fetching the index and the month if need be. A state whose centre has
  // no place yet (the scene before its first frame) is waited for, 10 s at
  // most.
  async placed(key: string, now: () => number): Promise<boolean> {
    await this.loadIndex();
    for (let i = 0; i < 100 && !this.disposed; i++) {
      const t = now();
      if (this.positionKm(key, t)) return true;
      const wait = this.fetching.get(new Date(t).toISOString().slice(0, 7));
      if (wait) { await wait; continue; }
      if (!this.stateAbout(key, t)) return false;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return false;
  }

  // A craft's state about its own centre at t (UTC ms), J2000 equatorial,
  // with the centre it is held about that day; null where there is no data.
  stateAbout(key: string, t: number): { r: V3; v: V3; centre: string } | null {
    const ix = this.index, ci = ix?.craft.findIndex((c) => c.key === key) ?? -1;
    if (!ix || ci < 0) return null;
    const month = this.month(t);
    const seg = month && segmentAt(month, ci, t);
    if (!seg) return null;
    const c = ix.centres[seg.centre];
    const s = stateIn(seg, t, c.mu);
    return { r: s.r as V3, v: s.v as V3, centre: c.key };
  }

  // Heliocentric ecliptic km of a craft at t, with the centre's position
  // now (the scene's states hold this frame's).
  positionKm(key: string, t = this.timeMs): V3 | null {
    const s = this.stateAbout(key, t);
    const o = s && this.centreAt(s.centre);
    if (!s || !o) return null;
    const r = eqjToEcl(s.r) as V3;
    return [o[0] + r[0], o[1] + r[1], o[2] + r[2]];
  }

  // Whether the focused craft's model was drawn this frame (its marker's
  // square is then hidden, as a satellite's is).
  modelled = false;
  // The focused craft's close-up model this frame, if NASA publishes one
  // (probeModels.ts): drawn only for the craft the camera is on, so a
  // model loads only once the camera is there and close (craftModels.ts).
  // Its axes are its pointing, worked out where it is drawn.
  modelPose(t: number): ModelPose | null {
    const key = this.focusKey, m = key && probeModelKey(key);
    const r = m ? this.positionKm(key, t) : null;
    if (!m || !r) return null;
    return { key: `probe:${key}`, spec: { kind: 'probe', key: m }, rEcl: r, axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], firing: false };
  }

  setFocus(key: string | null): void {
    this.focusKey = key;
    for (const [k, el] of this.markers) el.classList.toggle('focused', k === key);
  }

  private makeMarker(c: Probe): void {
    const el = document.createElement('div');
    el.className = 'body-marker spacecraft';
    el.title = `${c.name}: ${GROUP[c.group].label.toLowerCase()} (JPL Horizons ${c.id})`;
    el.style.setProperty('--probe', GROUP[c.group].colour);
    const dot = document.createElement('span'), name = document.createElement('span');
    dot.className = 'dot'; name.className = 'name'; name.textContent = c.short;
    el.append(dot, name);
    el.style.display = 'none';
    el.addEventListener('click', () => this.onPick(c.key));
    this.overlay.appendChild(el);
    this.markers.set(c.key, el);
  }

  // ----- Paths -----
  // The span a craft's path covers: one period for an orbiter (from its
  // energy now, at most 40 days), half a year for an L-point observatory,
  // two months for a probe.
  private spanOf(c: Probe, s: { r: V3; v: V3; centre: string }): number {
    if (c.group === 'cruise') return 60 * DAY;
    if (c.group === 'lagrange') return 182 * DAY;
    const mu = this.index!.centres.find((x) => x.key === s.centre)!.mu;
    const r = Math.hypot(...s.r), v2 = s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2, a = 1 / (2 / r - v2 / mu);
    return a > 0 ? Math.min(40 * DAY, 2 * Math.PI * Math.sqrt(a ** 3 / mu) * 1000) : 10 * DAY;
  }

  // New data: every path is due again (redrawn a few a frame).
  private resample(): void { for (const p of this.paths.values()) p.tc = -Infinity; }

  // Sample a path about the craft's centre now, centred on the clock.
  private tried = new Map<string, number>();
  private samplePath(c: Probe): void {
    // A craft with no data today is tried again a second later, not every
    // frame (it would take the frame's budget from the rest).
    if (performance.now() - (this.tried.get(c.key) ?? -1e9) < 1000) return;
    this.tried.set(c.key, performance.now());
    const now = this.stateAbout(c.key, this.timeMs);
    if (!now) return;
    this.tried.delete(c.key);
    const span = this.spanOf(c, now), v = new THREE.Vector3();
    const pos = new Float32Array(PATH_SAMPLES * 3), u = new Float32Array(PATH_SAMPLES);
    let n = 0;
    for (let k = 0; k < PATH_SAMPLES; k++) {
      const f = k / (PATH_SAMPLES - 1) - 0.5, t = this.timeMs + f * span;
      const s = this.stateAbout(c.key, t);
      // Only the stretch held about today's centre (a probe passing a
      // planet changes centre), and only what the loaded months hold.
      if (!s || s.centre !== now.centre) continue;
      v.set(...s.r).applyMatrix3(this.toRenderM).multiplyScalar(1 / UNIT_KM);
      pos.set([v.x, v.y, v.z], n * 3); u[n] = f; n++;
    }
    let p = this.paths.get(c.key);
    if (!p) {
      const g = new THREE.BufferGeometry();
      const line = new THREE.Line(g, orbitTrailMaterial(new THREE.Color(GROUP[c.group].colour).getHex(), 0.2, 0.12));
      line.frustumCulled = false;
      line.visible = this.on;
      this.scene.add(line);
      p = { line, tc: 0, span, at: 0 };
      this.paths.set(c.key, p);
    }
    p.line.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    p.line.geometry.setAttribute('u', new THREE.BufferAttribute(u, 1));
    p.line.geometry.setDrawRange(0, n);
    p.line.userData.centre = now.centre;
    p.tc = this.timeMs; p.span = span; p.at = performance.now();
  }

  // Each frame, before the render: the time (UTC ms), the camera's
  // heliocentric ecliptic position (km) and 1 / the exposure.
  update(timeMs: number, cam: readonly number[], level: number): void {
    this.timeMs = timeMs;
    this.cam = [cam[0], cam[1], cam[2]];
    const ix = this.index;
    if (!ix || (!this.on && this.focusKey === null)) return;
    // The next or last month, as the clock nears an end of this one.
    this.month(timeMs); this.month(timeMs + 2 * DAY); this.month(timeMs - 2 * DAY);
    if (!this.on) return;
    let budget = 3;                     // paths resampled a frame, at most
    for (const c of ix.craft) {
      if (!c.days) continue;
      const p = this.paths.get(c.key);
      const due = !p || !(Math.abs(timeMs - p.tc) <= 0.25 * p.span) && (p.tc === -Infinity || performance.now() - p.at >= PATH_MIN_MS);
      if (due && !this.tried.has(c.key) && budget-- > 0) this.samplePath(c);
      else if (this.tried.has(c.key) && performance.now() - this.tried.get(c.key)! >= 1000 && budget-- > 0) this.samplePath(c);
      const q = this.paths.get(c.key);
      if (!q) continue;
      const o = this.centreAt(q.line.userData.centre as string);
      if (!o || !Number.isFinite(q.tc)) { q.line.visible = false; continue; }
      q.line.visible = true;
      q.line.position.set((o[0] - cam[0]) / UNIT_KM, (o[2] - cam[2]) / UNIT_KM, -(o[1] - cam[1]) / UNIT_KM);
      const m = q.line.material as THREE.ShaderMaterial;
      m.uniforms.now.value = (timeMs - q.tc) / q.span;
      m.uniforms.level.value = level * (c.key === this.focusKey ? 1.6 : 1);
    }
  }

  // After the camera is set: markers at their projected positions, shown
  // near their centre (an orbiter) or always (a probe), clear of each other.
  // The Sun's share at a point (OrreryScene.sunlightAt): a craft in a
  // body's umbra or penumbra has its marker marked (app.css).
  shade: ((r: V3) => { nu: number; state: string; by: string | null }) | null = null;

  label(camera: THREE.Camera, w: number, h: number): void {
    const ix = this.index;
    if (!ix) return;
    const px = window.devicePixelRatio || 1, cam = this.cam, placed: [number, number][] = [];
    const order = [...ix.craft].sort((a, b) => (b.key === this.focusKey ? 1 : 0) - (a.key === this.focusKey ? 1 : 0));
    for (const c of order) {
      const el = this.markers.get(c.key);
      if (!el) continue;
      const focused = c.key === this.focusKey;
      const s = (this.on || focused) ? this.stateAbout(c.key, this.timeMs) : null;
      const o = s && this.centreAt(s.centre);
      if (!s || !o) { el.style.display = 'none'; continue; }
      const re = eqjToEcl(s.r) as V3;
      const rel: V3 = [o[0] + re[0] - cam[0], o[1] + re[1] - cam[1], o[2] + re[2] - cam[2]];
      const dCentre = Math.hypot(o[0] - cam[0], o[1] - cam[1], o[2] - cam[2]);
      if (!focused && dCentre > GROUP[c.group].showKm) { el.style.display = 'none'; continue; }
      if (behind(rel, [o[0] - cam[0], o[1] - cam[1], o[2] - cam[2]], s.centre === 'sun' ? 695700 : BODY_BY_KEY[s.centre as BodyKey]?.radiusKm ?? 0)) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM).project(camera);
      if (ndc.z > 1 || ndc.z < -1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * px) / px, y = Math.round(((1 - ndc.y) / 2) * h * px) / px;
      const quiet = !focused && placed.some(([qx, qy]) => Math.abs(qx - x) < 70 && Math.abs(qy - y) < 12);
      el.classList.toggle('quiet', quiet);
      el.classList.toggle('modelled', focused && this.modelled);
      if (!quiet) placed.push([x, y]);
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
      const sl = this.shade?.([o[0] + re[0], o[1] + re[1], o[2] + re[2]]);
      el.classList.toggle('eclipse', sl?.state === 'umbra');
      el.classList.toggle('penumbra', sl?.state === 'penumbra');
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const p of this.paths.values()) { this.scene.remove(p.line); p.line.geometry.dispose(); (p.line.material as THREE.Material).dispose(); }
    for (const el of this.markers.values()) el.remove();
  }
}

// Is a point at rel (km from the camera) behind a sphere of radius R at
// centre (km from the camera), as the camera sees it?
function behind(rel: V3, centre: V3, R: number): boolean {
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  if (!(R > 0) || !(d > 0)) return false;
  const u = [rel[0] / d, rel[1] / d, rel[2] / d];
  const t = centre[0] * u[0] + centre[1] * u[1] + centre[2] * u[2];
  if (t <= 0 || t >= d) return false;
  const c = [centre[0] - t * u[0], centre[1] - t * u[1], centre[2] - t * u[2]];
  return c[0] * c[0] + c[1] * c[1] + c[2] * c[2] < R * R;
}
