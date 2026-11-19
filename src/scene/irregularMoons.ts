// src/scene/irregularMoons.ts
//
// The irregular moons of Jupiter, Saturn and Neptune (packages/physics/src/
// irregularMoons.js) as a layer the rail shows or hides, off by default
// (docs/frontend/moons.md#the-irregular-moons). Each is a small point of
// fixed size, a drawing aid like the markers rather than a photometric
// star (the brightest, Himalia, is magnitude 15 from the Earth); the 111
// with an IAU number, and the one flown to, have an orbit line about their
// planet. Near the camera each gets a label; one that
// is flown to is drawn as a lit sphere at its real size (or a nominal one,
// which its plate says), as a named asteroid is (smallBodies.ts).
//
// Positions are worked out on the CPU, a few hundred a frame, only for the
// systems the camera is within POINT_RANGE_KM of. The scene hands update()
// the time, the camera's heliocentric ecliptic position (km) and each
// planet's centre there; render positions are camera-relative, one unit
// 1000 km, render (x, y, z) = ecliptic (x, z, -y).

import * as THREE from 'three';
import { eqjToEcl, ttSeconds } from '@digital-orrery/physics/ephemeris.js';
import { IRREGULAR_DATA as RAW, IRREGULAR_KEYS, IRREGULARS_OF, irregularPositionEqjAtTt, irregularStateEqjAtTt, irregularSource } from '@digital-orrery/physics/irregularMoons.js';
import { moonTablesVersionOf, wantIrregularTables } from '@digital-orrery/physics/moonTables.js';
import { makeBodyMaterial } from './bodyMaterial';

type Vec3 = [number, number, number];
export type IrregularPlanet = 'jupiter' | 'saturn' | 'neptune';
export const IRREGULAR_PLANETS: IrregularPlanet[] = ['jupiter', 'saturn', 'neptune'];
export interface IrregularMoon {
  key: string; name: string; planet: IrregularPlanet; naif: number; kernel: string; a: number; e: number; i: number; P: number;
  retrograde: boolean; radiusKm: number; radiusNote?: string; gm: number | null; geometricAlbedo: number | null;
  discovery: { year: string; by: string; ref: string } | null; fit: { rmsKm: number; maxKm: number };
  // Its diameter and where it is from (irregularMoons.fetch.mjs), and, where
  // a lightcurve or images give it, an ellipsoid a x b x b and its spin.
  size: { diameterKm: number; errKm?: number; source: 'NEOWISE' | 'Denk' | 'MPEC' | 'Sheppard'; note: string };
  axesKm: [number, number, number] | null; shapeNote?: string;
  rotation: { periodH: number; source: string; uncertain: boolean } | null;
}
const IRREGULAR_DATA = RAW as unknown as Record<string, Omit<IrregularMoon, 'key'>>;
export const IRREGULAR_MOONS: IrregularMoon[] = IRREGULAR_KEYS.map((key: string) => ({ key, ...IRREGULAR_DATA[key] }));
export const irregularMoon = (key: string): IrregularMoon | undefined => (IRREGULAR_DATA[key] ? { key, ...IRREGULAR_DATA[key] } : undefined);

const UNIT_KM = 1000, AU_KM = 149597870.7, SUN_RADIUS_KM = 695700;
// Points are drawn for a system within this of the camera, orbit lines
// within LINE_RANGE_KM, labels within LABEL_RANGE_KM of the moon.
const POINT_RANGE_KM = 3 * AU_KM, LINE_RANGE_KM = 1.0 * AU_KM, LABEL_RANGE_KM = 4e7;
const SAMPLES = 256;
// Dark, as the irregular moons are (Himalia's geometric albedo is 0.04).
const DEFAULT_ALBEDO = 0.04, COLOUR = 0x8e877c, LINE_COLOUR = 0x9a8f7e;
const PERIOD_MAX = Object.fromEntries(IRREGULAR_PLANETS.map((p) => [p, Math.max(0, ...((IRREGULARS_OF as Record<string, string[]>)[p] ?? []).map((k) => IRREGULAR_DATA[k].P))])) as Record<IrregularPlanet, number>;

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uSize;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uSize;
    #include <logdepthbuf_vertex>
  }`;
const FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColour;
  uniform float uLevel;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = gl_PointCoord - 0.5;
    float a = smoothstep(0.5, 0.25, length(d));
    gl_FragColor = vec4(uColour * a * uLevel, a);
  }`;

// Every moon's orbit line in one draw (one each cost 2.6 ms on Intel's GPU
// for Jupiter's 107): each moon has a slot of SAMPLES + 1 vertices about its
// planet's centre, and the shader adds the planet's render position and
// works out the glowing trail behind the moon, as orbitTrail.ts does for one.
const LINE_VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float u;           // time from the line's centre, in periods
  attribute vec3 aLine;        // planet (0-2; -1: no line), the line's centre (days from BASE), period (days)
  uniform vec3 uPlanet[3];     // render positions
  uniform float uDays;         // now, days from BASE
  varying float vU;
  varying float vNow;
  void main() {
    if (aLine.x < -0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vU = 0.0; vNow = 0.0; return; }
    int p = int(aLine.x + 0.5);
    vec3 c = p == 0 ? uPlanet[0] : p == 1 ? uPlanet[1] : uPlanet[2];
    vU = u;
    vNow = (uDays - aLine.y) / aLine.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position + c, 1.0);
    #include <logdepthbuf_vertex>
  }`;
const LINE_FRAGMENT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 colour;
  uniform float outline;
  uniform float tail;
  uniform float level;
  varying float vU;
  varying float vNow;
  void main() {
    #include <logdepthbuf_fragment>
    float behind = vNow - vU;
    float glow = behind >= 0.0 ? exp(-behind / tail) : 0.0;
    float a = outline + (1.0 - outline) * glow;
    vec3 c = mix(colour, vec3(1.0), 0.35 + 0.35 * glow);
    gl_FragColor = vec4(c * a * level, a);
  }`;
const BASE_MS = Date.UTC(2026, 0, 1), SLOT = SAMPLES + 1;
// The moons with an IAU number (NAIF ids under 1000: 111 of them) get orbit lines.
const NUMBERED = new Set(IRREGULAR_KEYS.filter((k: string) => (RAW as Record<string, { naif: number }>)[k].naif < 1000));
const SLOT_OF = new Map(IRREGULAR_KEYS.map((k: string, j: number) => [k, j]));

export class IrregularMoonLayer {
  private on = false;
  private points: THREE.Points;
  private positions = new Float32Array(IRREGULAR_KEYS.length * 3);
  private rel = new Map<string, Vec3>();          // camera-relative ecliptic km, this frame
  private cam: Vec3 = [0, 0, 0];
  private planetAt: ((p: IrregularPlanet) => Vec3) | null = null;
  private lastMs = NaN;
  private lines: THREE.LineSegments;
  private lineEpoch = new Map<string, number>();   // moons with a line: its centre (UTC ms)
  private markers = new Map<string, HTMLDivElement>();
  private labelled = new Set<string>();
  // Each system's table installs when its lines were last drawn: a year that
  // arrives redraws that system's lines (from the tables, not the elements).
  private tablesSeen: Record<string, number> = {};
  private tmp = new THREE.Vector3();
  private focusKey: string | null = null;
  private focusMesh: THREE.Mesh;
  // The focused one's sphere while drawn (OrreryScene casts shadows on it).
  get focusSphere(): THREE.Mesh | null { return this.focusMesh.visible ? this.focusMesh : null; }
  private sunRender = new THREE.Vector3();
  onPick: (key: string) => void = () => {};

  constructor(private scene: THREE.Scene, private overlay: HTMLElement) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 4 }, uColour: { value: new THREE.Color(0xd8ccb4) }, uLevel: { value: 1 } },
    }));
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.points.onBeforeRender = (_r, _s, camera) => this.label(camera);
    scene.add(this.points);
    const n = IRREGULAR_KEYS.length, lg = new THREE.BufferGeometry();
    const us = new Float32Array(n * SLOT), meta = new Float32Array(n * SLOT * 3).fill(-1), index = new Uint32Array(n * SAMPLES * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < SLOT; i++) {
      us[j * SLOT + i] = i / SAMPLES - 0.5;
      if (i < SAMPLES) { index[(j * SAMPLES + i) * 2] = j * SLOT + i; index[(j * SAMPLES + i) * 2 + 1] = j * SLOT + i + 1; }
    }
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * SLOT * 3), 3));
    lg.setAttribute('u', new THREE.BufferAttribute(us, 1));
    lg.setAttribute('aLine', new THREE.BufferAttribute(meta, 3));
    lg.setIndex(new THREE.BufferAttribute(index, 1));
    this.lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
      vertexShader: LINE_VERTEX, fragmentShader: LINE_FRAGMENT, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending,
      uniforms: { colour: { value: new THREE.Color(LINE_COLOUR) }, outline: { value: 0.12 }, tail: { value: 0.08 }, level: { value: 1 },
        uPlanet: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] }, uDays: { value: 0 } },
    }));
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);
    this.focusMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), makeBodyMaterial(COLOUR, DEFAULT_ALBEDO, true));
    this.focusMesh.visible = false;
    scene.add(this.focusMesh);
    for (const m of IRREGULAR_MOONS) {
      const el = document.createElement('div');
      el.className = 'body-marker small-body irregular';
      el.title = `${m.name}: ${m.retrograde ? 'retrograde' : 'prograde'} irregular moon of ${m.planet[0].toUpperCase()}${m.planet.slice(1)}`;
      const dot = document.createElement('span'), name = document.createElement('span');
      dot.className = 'dot'; name.className = 'name'; name.textContent = m.name;
      el.append(dot, name);
      el.style.display = 'none';
      el.addEventListener('click', () => this.onPick(m.key));
      overlay.appendChild(el);
      this.markers.set(m.key, el);
    }
  }

  get shown(): boolean { return this.on; }
  has(key: string): boolean { return key in IRREGULAR_DATA; }
  setOn(on: boolean): void {
    this.on = on;
    if (!on) for (const key of [...this.lineEpoch.keys()]) this.dropLine(key);
  }

  // The points' size in device pixels (the scene's pixel ratio).
  setScale(deviceRatio: number): void { (this.points.material as THREE.ShaderMaterial).uniforms.uSize.value = Math.round(3 * deviceRatio + 1); }

  // Heliocentric ecliptic km of a moon this frame (its planet's centre from
  // the scene), or null when it has not been placed.
  // A moon not placed this frame (its layer off, or its planet out of
  // range: the first frame of a flight to it) is worked out here, from its
  // planet's centre as the scene last gave it.
  positionKm(key: string): Vec3 | null {
    const r = this.rel.get(key), c = this.cam;
    if (r) return [r[0] + c[0], r[1] + c[1], r[2] + c[2]];
    const m = IRREGULAR_DATA[key];
    if (!m || !this.planetAt || !Number.isFinite(this.lastMs)) return null;
    const p = this.planetAt(m.planet), q = eqjToEcl(irregularPositionEqjAtTt(key, ttSeconds(this.lastMs)));
    return [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
  }
  // Its largest radius (the long semi-axis where it has a shape): what the
  // camera keeps clear of and frames.
  radiusKm(key: string): number { const m = IRREGULAR_DATA[key]; return m ? (m.axesKm ? m.axesKm[0] : m.radiusKm) : 1; }
  source(key: string, timeMs: number): 'table' | 'elements' { return irregularSource(key, ttSeconds(timeMs)); }

  setFocus(key: string | null): void {
    this.focusKey = key;
    const m = key ? IRREGULAR_DATA[key] : null;
    this.focusMesh.visible = !!m;
    if (m) {
      (this.focusMesh.material as THREE.Material).dispose();
      this.focusMesh.material = makeBodyMaterial(COLOUR, m.geometricAlbedo ?? DEFAULT_ALBEDO, true);
    }
  }

  // Each frame: the time (UTC ms), the camera (heliocentric ecliptic km),
  // each planet's centre (km), 1 / the exposure, and the system the camera
  // is focused on (its moons are placed whatever the range).
  update(timeMs: number, cam: readonly number[], planet: (p: IrregularPlanet) => Vec3, level: number, focusSystem: string | null): void {
    this.rel.clear();
    this.cam = [cam[0], cam[1], cam[2]];
    this.planetAt = planet;
    this.lastMs = timeMs;
    const tt = ttSeconds(timeMs);
    const want = this.on || this.focusKey !== null;
    let n = 0;
    if (want) {
      const start = performance.now();
      const lu = (this.lines.material as THREE.ShaderMaterial).uniforms;
      lu.uDays.value = (timeMs - BASE_MS) / 864e5;
      for (const p of IRREGULAR_PLANETS) {
        const c = planet(p), d = Math.hypot(c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]);
        const focusHere = this.focusKey !== null && IRREGULAR_DATA[this.focusKey].planet === p;
        if (!(focusHere || (this.on && (d < POINT_RANGE_KM || focusSystem === p)))) continue;
        const lines = this.on && (d < LINE_RANGE_KM || focusSystem === p);
        (lu.uPlanet.value as THREE.Vector3[])[IRREGULAR_PLANETS.indexOf(p)].set((c[0] - cam[0]) / UNIT_KM, (c[2] - cam[2]) / UNIT_KM, -(c[1] - cam[1]) / UNIT_KM);
        wantIrregularTables(p, tt, lines ? PERIOD_MAX[p] / 2 : 2);
        if (moonTablesVersionOf(p) !== this.tablesSeen[p]) {
          this.tablesSeen[p] = moonTablesVersionOf(p);
          for (const k of this.lineEpoch.keys()) if (IRREGULAR_DATA[k].planet === p) this.lineEpoch.set(k, NaN);
        }
        for (const key of (IRREGULARS_OF as Record<string, string[]>)[p] ?? []) {
          if (!this.on && key !== this.focusKey) continue;
          const r = eqjToEcl(irregularPositionEqjAtTt(key, tt)) as Vec3;
          const rel: Vec3 = [c[0] + r[0] - cam[0], c[1] + r[1] - cam[1], c[2] + r[2] - cam[2]];
          this.rel.set(key, rel);
          this.positions.set([rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM], 3 * n++);
          // Orbit lines for the numbered moons and the one flown to: on
          // Intel's GPU each line across the view costs about 0.05 ms (all
          // 267 of Saturn's, 15 ms), and Saturn's swarm of lines is a blur.
          if ((lines && NUMBERED.has(key)) || key === this.focusKey) this.updateLine(key, timeMs, start);
          else this.dropLine(key);
        }
      }
    }
    for (const key of [...this.lineEpoch.keys()]) if (!this.rel.has(key)) this.dropLine(key);
    this.lines.visible = this.lineEpoch.size > 0;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = n > 0;
    this.points.visible = n > 0;
    // The labels are placed as the points are drawn (onBeforeRender), which
    // a hidden Points never is: with none placed (the layer switched off, or
    // the camera gone out of range) the names shown last frame are hidden
    // here, or they would stay on the screen.
    if (n === 0 && this.labelled.size) {
      for (const key of this.labelled) this.markers.get(key)!.style.display = 'none';
      this.labelled.clear();
    }
    const pm = (this.points.material as THREE.ShaderMaterial).uniforms;
    pm.uLevel.value = level;
    (this.lines.material as THREE.ShaderMaterial).uniforms.level.value = level;
    this.sunRender.set(-cam[0] / UNIT_KM, -cam[2] / UNIT_KM, cam[1] / UNIT_KM);
    this.placeFocus(cam, level, timeMs);
  }

  // A moon's orbit line: one period about its planet's centre, sampled from
  // the model into its slot, resampled when the clock has moved 5 % of a
  // period or a year of the tables arrives, within 2 ms a frame for all.
  private updateLine(key: string, timeMs: number, start: number): void {
    const m = IRREGULAR_DATA[key], period = m.P * 86400e3, epoch = this.lineEpoch.get(key);
    if (epoch !== undefined && Math.abs(timeMs - epoch) < 0.05 * period) return;
    if (performance.now() - start > 2) return;
    const j = SLOT_OF.get(key)!, g = this.lines.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute, meta = g.getAttribute('aLine') as THREE.BufferAttribute;
    const pa = pos.array as Float32Array, ma = meta.array as Float32Array, planet = IRREGULAR_PLANETS.indexOf(m.planet);
    for (let i = 0; i < SLOT; i++) {
      const t = timeMs - period / 2 + (period * i) / SAMPLES;
      const r = eqjToEcl(irregularPositionEqjAtTt(key, ttSeconds(t)));
      const o = (j * SLOT + i) * 3;
      pa[o] = r[0] / UNIT_KM; pa[o + 1] = r[2] / UNIT_KM; pa[o + 2] = -r[1] / UNIT_KM;
      ma[o] = planet; ma[o + 1] = (timeMs - BASE_MS) / 864e5; ma[o + 2] = m.P;
    }
    pos.addUpdateRange(j * SLOT * 3, SLOT * 3); pos.needsUpdate = true;
    meta.addUpdateRange(j * SLOT * 3, SLOT * 3); meta.needsUpdate = true;
    this.lineEpoch.set(key, timeMs);
  }

  private dropLine(key: string): void {
    if (!this.lineEpoch.has(key)) return;
    const j = SLOT_OF.get(key)!, meta = this.lines.geometry.getAttribute('aLine') as THREE.BufferAttribute, ma = meta.array as Float32Array;
    for (let i = 0; i < SLOT; i++) ma[(j * SLOT + i) * 3] = -1;
    meta.addUpdateRange(j * SLOT * 3, SLOT * 3); meta.needsUpdate = true;
    this.lineEpoch.delete(key);
  }

  // The focused moon's body: its radius, or its ellipsoid a x b x b with the
  // long axis turning in its orbit's plane at its rotation period. Neither
  // pole nor phase is known for any of them, so it spins about the pole of
  // its orbit about the planet, from 0 at J2000.
  private turn = new THREE.Matrix4();
  private placeFocus(cam: readonly number[], level: number, timeMs: number): void {
    const key = this.focusKey, rel = key ? this.rel.get(key) : undefined;
    if (!key || !rel) { this.focusMesh.visible = false; return; }
    const m = IRREGULAR_DATA[key];
    this.focusMesh.visible = true;
    this.focusMesh.position.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM);
    if (!m.axesKm) {
      this.focusMesh.quaternion.identity();
      this.focusMesh.scale.setScalar(m.radiusKm / UNIT_KM);
    } else {
      const s = irregularStateEqjAtTt(key, ttSeconds(timeMs));
      const h = eqjToEcl([s.r[1] * s.v[2] - s.r[2] * s.v[1], s.r[2] * s.v[0] - s.r[0] * s.v[2], s.r[0] * s.v[1] - s.r[1] * s.v[0]]);
      const pole = this.tmp.set(h[0], h[2], -h[1]).normalize();
      const x0 = new THREE.Vector3(1, 0, 0).cross(pole);
      if (x0.lengthSq() < 1e-6) x0.set(0, 1, 0).cross(pole);
      x0.normalize();
      const turns = m.rotation ? ((timeMs - Date.UTC(2000, 0, 1, 12)) / 3.6e6) / m.rotation.periodH : 0;
      const x = x0.applyAxisAngle(pole, 2 * Math.PI * (turns % 1));
      const y = new THREE.Vector3().crossVectors(pole, x);
      this.turn.makeBasis(x, y, pole);
      this.focusMesh.quaternion.setFromRotationMatrix(this.turn);
      this.focusMesh.scale.set(m.axesKm[0] / UNIT_KM, m.axesKm[1] / UNIT_KM, m.axesKm[2] / UNIT_KM);
    }
    const u = (this.focusMesh.material as THREE.ShaderMaterial).uniforms;
    const rAu = Math.hypot(rel[0] + cam[0], rel[1] + cam[1], rel[2] + cam[2]) / AU_KM;
    u.irradiance.value = 1 / (rAu * rAu);
    (u.sunPos.value as THREE.Vector3).copy(this.sunRender);
    u.sunRadius.value = SUN_RADIUS_KM / UNIT_KM;
    (u.bodyCentre.value as THREE.Vector3).copy(this.focusMesh.position);
    u.invExposure.value = level;
  }

  // The overlay's size in CSS pixels, from the scene's resize(), so the
  // labels need not read clientWidth each frame (which forces a layout after
  // other layers' style writes). 0 until it is set: then the overlay is read.
  private viewW = 0;
  private viewH = 0;
  setViewSize(w: number, h: number): void { this.viewW = w; this.viewH = h; }

  // Labels for the moons near the camera (and the focused one), in whole
  // device pixels, hidden behind the camera or over another label.
  private label(camera: THREE.Camera): void {
    const w = this.viewW || this.overlay.clientWidth, h = this.viewH || this.overlay.clientHeight, px = window.devicePixelRatio || 1;
    const placed: [number, number][] = [];
    const pxPerRad = h / (2 * Math.tan(((camera as THREE.PerspectiveCamera).fov * Math.PI) / 360));
    // Only the moons placed this frame, and those shown last frame (to hide).
    const keys = new Set([...this.labelled, ...this.rel.keys()]);
    this.labelled.clear();
    for (const key of keys) {
      const el = this.markers.get(key)!;
      const rel = this.rel.get(key), focused = key === this.focusKey;
      el.classList.toggle('focused', focused);
      const d = rel ? Math.hypot(rel[0], rel[1], rel[2]) : Infinity;
      if (!rel || (!focused && d > LABEL_RANGE_KM)) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM).project(camera);
      if (ndc.z > 1 || ndc.z < -1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * px) / px, y = Math.round(((1 - ndc.y) / 2) * h * px) / px;
      if (!focused && placed.some(([qx, qy]) => Math.abs(qx - x) < 40 && Math.abs(qy - y) < 12)) { el.style.display = 'none'; continue; }
      placed.push([x, y]);
      el.classList.toggle('resolved', focused && (this.radiusKm(key) / d) * pxPerRad > 2);
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
      this.labelled.add(key);
    }
  }

  dispose(): void {
    this.scene.remove(this.points, this.focusMesh, this.lines);
    this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose();
    this.points.geometry.dispose(); (this.points.material as THREE.Material).dispose();
    this.focusMesh.geometry.dispose(); (this.focusMesh.material as THREE.Material).dispose();
    for (const el of this.markers.values()) el.remove();
  }
}
