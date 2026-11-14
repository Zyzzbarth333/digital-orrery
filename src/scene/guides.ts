// src/scene/guides.ts
//
// Drawing aids for how gravity works in the scene, each on its own switch
// in the rail and off by default (docs/physics/gravity-guides.md):
//
//   axes      each body's spin axis, a faint grey line through its poles,
//             north brighter and marked N;
//   field     the real gravity field on the surface (gravityField.ts);
//   spheres   each body's sphere of influence (solid ring) and Hill sphere
//             (dashed), about its parent, from its osculating orbit;
//   lagrange  L1-L5 of Sun-Earth, Earth-Moon and Sun-Jupiter, and of the
//             focused body with its parent;
//   pulls     the four strongest pulls on the focused body, as lines to
//             each puller with its acceleration.
//
// All are drawn at a display level (divided by the exposure, like the
// orbit lines), so they read the same at any distance from the Sun.

import * as THREE from 'three';
import { BODIES, BODY_BY_KEY, type BodyKey } from './catalogue';
import { hillRadius, lagrangePoints, soiRadius, strongestPulls } from '../physics/gravityGuides.js';
import { rvToElements } from '../physics/orbital.js';
import { GravityFieldLayer } from './gravityField';

export type GuideKey = 'axes' | 'field' | 'spheres' | 'lagrange' | 'pulls';
type Vec3 = [number, number, number];
interface State { r: Vec3; v: Vec3 }

const UNIT_KM = 1000;
const AXIS_EXTENT = 1.5;              // the axis reaches 1.5 radii from the centre
const SOI_COLOUR = new THREE.Color(0xffb22e), HILL_COLOUR = new THREE.Color(0x9fc9b8);
const PAIRS: [BodyKey, BodyKey][] = [['sun', 'earth'], ['earth', 'moon'], ['sun', 'jupiter']];

// Lines: a colour and an alpha per vertex, at a display level.
const lineVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float alpha;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const lineFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 colour;
uniform float level;
varying float vAlpha;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(colour * vAlpha * level, vAlpha);
}
`;
const lineMaterial = (colour: number) => new THREE.ShaderMaterial({
  vertexShader: lineVertex, fragmentShader: lineFragment, transparent: true, depthWrite: false, toneMapped: false,
  blending: THREE.AdditiveBlending, uniforms: { colour: { value: new THREE.Color(colour) }, level: { value: 1 } },
});

// A sphere's outline: about 1.5 px wide where the surface turns edge-on,
// solid or dashed around the view axis.
const shellVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;
const shellFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 colour;
uniform vec3 centre;
uniform float dashes;      // 0 for a solid ring
uniform float level;
uniform float opacity;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  #include <logdepthbuf_fragment>
  float d = abs(dot(normalize(vNormal), normalize(-vWorld)));   // 0 where seen edge-on
  float a = 1.0 - smoothstep(0.75, 1.75, d / max(fwidth(d), 1e-6));
  if (dashes > 0.0) {
    vec3 rel = mat3(viewMatrix) * (vWorld - centre);
    a *= step(0.45, fract(atan(rel.y, rel.x) / (2.0 * PI) * dashes));
  }
  a *= opacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(colour * a * level, a);
}
`;

const fmtKm = (km: number) => (km >= 1e6 ? `${(km / 1e6).toPrecision(3)} million km` : `${Math.round(km).toLocaleString('en-AU')} km`);
function fmtAccel(kms2: number): string {
  const ms2 = kms2 * 1000;
  if (ms2 >= 0.1) return `${ms2.toPrecision(3)} m/s²`;
  if (ms2 >= 1e-4) return `${(ms2 * 1e3).toPrecision(3)} mm/s²`;
  if (ms2 >= 1e-7) return `${(ms2 * 1e6).toPrecision(3)} µm/s²`;
  return `${(ms2 * 1e9).toPrecision(3)} nm/s²`;
}

export class GuideLayer {
  readonly on: Record<GuideKey, boolean> = { axes: false, field: false, spheres: false, lagrange: false, pulls: false };
  private field: GravityFieldLayer;
  private axes: THREE.LineSegments;
  private axisKeys = BODIES.map((b) => b.key);
  private shells = new Map<BodyKey, [THREE.Mesh, THREE.Mesh]>();
  private shellGeometry = new THREE.SphereGeometry(1, 96, 48);
  private pulls: THREE.LineSegments;
  private tags: HTMLDivElement[] = [];
  private tagCount = 0;
  private sunAxis = new THREE.Vector3(0, 1, 0);
  private sunAxisT = NaN;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private overlay: HTMLElement,
    private toRender: (km: Vec3, out: THREE.Vector3) => THREE.Vector3,
    private sunAxisRender: (date: Date) => THREE.Vector3) {
    this.field = new GravityFieldLayer(scene, overlay);
    // Spin axes: two segments a body (south half, north half).
    const n = this.axisKeys.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
    const alpha = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) alpha.set([0.22, 0.22, 0.6, 0.6], 4 * i);
    g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    this.axes = new THREE.LineSegments(g, lineMaterial(0xc8c2b4));
    this.axes.frustumCulled = false;
    this.axes.visible = false;
    this.axes.renderOrder = 3;
    scene.add(this.axes);
    // Pulls: up to four lines from the focused body.
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 6), 3));
    pg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array([0.55, 0.55, 0.4, 0.4, 0.3, 0.3, 0.22, 0.22]), 1));
    this.pulls = new THREE.LineSegments(pg, lineMaterial(0xffb22e));
    this.pulls.frustumCulled = false;
    this.pulls.visible = false;
    scene.add(this.pulls);
  }

  set(key: GuideKey, on: boolean): void {
    this.on[key] = on;
    this.field.on = this.on.field;
  }

  update(f: {
    camera: THREE.PerspectiveCamera; states: Record<BodyKey, State>; cam: Vec3; meshes: Map<BodyKey, THREE.Mesh>;
    materials: Map<BodyKey, THREE.ShaderMaterial>; focus: BodyKey | null; width: number; height: number; level: number; date: Date;
  }): void {
    const { camera, meshes, width, height } = f;
    this.tagCount = 0;
    const pxPerRad = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const radiusPx = (k: BodyKey) => {
      const d = meshes.get(k)!.position.length();
      return (BODY_BY_KEY[k].radiusKm / UNIT_KM / d) * pxPerRad;
    };
    const screen = (p: THREE.Vector3): [number, number] | null => {
      const n = this.w.copy(p).project(camera);
      if (n.z > 1 || n.z < -1) return null;
      return [((n.x + 1) / 2) * width, ((1 - n.y) / 2) * height];
    };
    const onScreen = (s: [number, number] | null) => s !== null && s[0] > -20 && s[0] < width + 20 && s[1] > -20 && s[1] < height + 20;

    this.field.update(meshes, f.materials, radiusPx, f.focus, f.level);

    // Spin axes, from the surface materials' body-fixed Z (render frame).
    this.axes.visible = this.on.axes;
    if (this.on.axes) {
      (this.axes.material as THREE.ShaderMaterial).uniforms.level.value = f.level;
      const pos = this.axes.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (!(Math.abs(f.date.getTime() - this.sunAxisT) < 864e5)) { this.sunAxis.copy(this.sunAxisRender(f.date)); this.sunAxisT = f.date.getTime(); }
      this.axisKeys.forEach((k, i) => {
        const c = meshes.get(k)!.position;
        const m = f.materials.get(k);
        const px = radiusPx(k);
        if (px < 4) { for (let j = 0; j < 4; j++) pos.setXYZ(4 * i + j, c.x, c.y, c.z); return; }
        const e = m ? this.v.set(0, 0, 1).applyMatrix3(this.w3(m)) : this.v.copy(this.sunAxis);
        const L = (BODY_BY_KEY[k].radiusKm / UNIT_KM) * AXIS_EXTENT;
        pos.setXYZ(4 * i, c.x - e.x * L, c.y - e.y * L, c.z - e.z * L);
        pos.setXYZ(4 * i + 1, c.x, c.y, c.z);
        pos.setXYZ(4 * i + 2, c.x, c.y, c.z);
        pos.setXYZ(4 * i + 3, c.x + e.x * L, c.y + e.y * L, c.z + e.z * L);
        if (px > 12) {
          const s = screen(this.w.set(c.x + e.x * L, c.y + e.y * L, c.z + e.z * L));
          if (onScreen(s)) this.tag(s!, 'N', 'guide-tag axis-n', `${BODY_BY_KEY[k].name}'s north pole (IAU)`);
        }
      });
      pos.needsUpdate = true;
    }

    // Spheres of influence and Hill spheres, about each body's parent.
    for (const b of BODIES) {
      if (!b.parent || !b.gm) continue;
      const parent = BODY_BY_KEY[b.parent];
      let pair = this.shells.get(b.key);
      if (!this.on.spheres) { if (pair) pair[0].visible = pair[1].visible = false; continue; }
      if (!pair) pair = this.makeShells(b.key);
      const s = f.states[b.key], p = f.states[b.parent];
      const rel: Vec3 = [s.r[0] - p.r[0], s.r[1] - p.r[1], s.r[2] - p.r[2]];
      const vrel: Vec3 = [s.v[0] - p.v[0], s.v[1] - p.v[1], s.v[2] - p.v[2]];
      const el = rvToElements(rel, vrel, parent.gm! + b.gm);
      const a = el.a > 0 ? el.a : Math.hypot(...rel);
      const e = Math.min(Math.max(el.e, 0), 0.99);
      const radii = [soiRadius(a, b.gm, parent.gm!), hillRadius(a, e, b.gm, parent.gm!)];
      const c = meshes.get(b.key)!.position;
      const d = c.length();
      radii.forEach((rKm, j) => {
        const mesh = pair![j];
        const R = rKm / UNIT_KM;
        const rPx = (R / Math.max(d, R)) * pxPerRad;
        // Rings a few pixels across, or ones the camera is inside, say nothing.
        mesh.visible = rPx > 8 && d > R * 1.02;
        if (!mesh.visible) return;
        mesh.position.copy(c);
        mesh.scale.setScalar(R);
        const u = (mesh.material as THREE.ShaderMaterial).uniforms;
        u.level.value = f.level;
        (u.centre.value as THREE.Vector3).copy(c);
        u.opacity.value = b.key === f.focus || b.parent === f.focus ? 0.75 : 0.4;
        if (b.key === f.focus) {
          const up = this.v.set(0, 1, 0).applyQuaternion(camera.quaternion).multiplyScalar(R).add(c);
          const sp = screen(up);
          if (onScreen(sp)) this.tag(sp!, `${j === 0 ? 'SOI' : 'Hill'} ${fmtKm(rKm)}`, `guide-tag ${j === 0 ? 'soi' : 'hill'}`,
            j === 0 ? `Sphere of influence about ${parent.name}: a (m/M)^(2/5)` : `Hill sphere about ${parent.name}: a (1 − e) (m/3M)^(1/3)`, j === 0 ? -16 : 0);
        }
      });
    }

    // Lagrange points.
    if (this.on.lagrange) {
      const pairs = [...PAIRS];
      const fb = f.focus ? BODY_BY_KEY[f.focus] : null;
      if (fb?.parent && fb.gm && !pairs.some(([, s]) => s === fb.key)) pairs.push([fb.parent, fb.key]);
      for (const [pk, sk] of pairs) {
        const P = f.states[pk], S = f.states[sk];
        const gp = BODY_BY_KEY[pk].gm!, gs = BODY_BY_KEY[sk].gm!;
        const L = lagrangePoints(P.r, S.r, [S.v[0] - P.v[0], S.v[1] - P.v[1], S.v[2] - P.v[2]], gp, gs);
        const sScreen = screen(meshes.get(sk)!.position);
        for (const name of ['L1', 'L2', 'L3', 'L4', 'L5'] as const) {
          const km = L[name] as Vec3;
          const p = this.toRender([km[0] - f.cam[0], km[1] - f.cam[1], km[2] - f.cam[2]], this.v);
          const s = screen(p);
          if (!onScreen(s)) continue;
          if (sScreen && Math.hypot(s![0] - sScreen[0], s![1] - sScreen[1]) < 14) continue;
          const dist = Math.hypot(km[0] - S.r[0], km[1] - S.r[1], km[2] - S.r[2]);
          this.tag(s!, `${BODY_BY_KEY[sk].name} ${name}`, 'guide-tag lpoint',
            `${BODY_BY_KEY[pk].name}–${BODY_BY_KEY[sk].name} ${name}: ${fmtKm(dist)} from ${BODY_BY_KEY[sk].name}`);
        }
      }
    }

    // The strongest pulls on the focused body.
    this.pulls.visible = this.on.pulls && f.focus !== null;
    if (this.pulls.visible) {
      const target = f.focus!;
      const list = strongestPulls({ key: target, r: f.states[target].r },
        BODIES.filter((b) => b.gm).map((b) => ({ key: b.key, gm: b.gm!, r: f.states[b.key].r }))).slice(0, 4);
      (this.pulls.material as THREE.ShaderMaterial).uniforms.level.value = f.level;
      const pos = this.pulls.geometry.getAttribute('position') as THREE.BufferAttribute;
      const c = meshes.get(target)!.position;
      const cs = screen(c);
      const rPx = Math.max(radiusPx(target), 6);
      const placed: [number, number][] = [];
      list.forEach((p, i) => {
        const q = meshes.get(p.key as BodyKey)!.position;
        pos.setXYZ(2 * i, c.x, c.y, c.z);
        pos.setXYZ(2 * i + 1, q.x, q.y, q.z);
        // The tag sits along the line's start on screen.
        const dir = this.w.copy(q).sub(c).normalize().multiplyScalar(Math.max(c.length(), 1) * 0.01).add(c);
        const ds = screen(dir.clone());
        if (cs && ds) {
          let dx = ds[0] - cs[0], dy = ds[1] - cs[1];
          const n = Math.hypot(dx, dy) || 1;
          dx /= n; dy /= n;
          const at: [number, number] = [cs[0] + dx * (rPx + 46 + 14 * i), cs[1] + dy * (rPx + 46 + 14 * i)];
          // Tags for pullers in nearly the same direction step down a line.
          while (placed.some(([x, y]) => Math.abs(x - at[0]) < 110 && Math.abs(y - at[1]) < 13)) at[1] += 13;
          placed.push(at);
          if (onScreen(at)) this.tag(at, `${BODY_BY_KEY[p.key as BodyKey].name} ${fmtAccel(p.accel)}`, 'guide-tag pull',
            `${BODY_BY_KEY[p.key as BodyKey].name}'s pull on ${BODY_BY_KEY[target].name}: GM / d² at ${fmtKm(p.distance)}`);
        }
      });
      for (let i = list.length; i < 4; i++) { pos.setXYZ(2 * i, c.x, c.y, c.z); pos.setXYZ(2 * i + 1, c.x, c.y, c.z); }
      pos.needsUpdate = true;
    }

    for (let i = this.tagCount; i < this.tags.length; i++) this.tags[i].style.display = 'none';
  }

  // The rotation of a surface material (render -> body-fixed) transposed:
  // its third row is the pole in render coordinates.
  private m3 = new THREE.Matrix3();
  private w3(m: THREE.ShaderMaterial): THREE.Matrix3 {
    return this.m3.copy(m.uniforms.toBody.value as THREE.Matrix3).transpose();
  }

  private makeShells(key: BodyKey): [THREE.Mesh, THREE.Mesh] {
    const make = (colour: THREE.Color, dashes: number) => {
      const m = new THREE.Mesh(this.shellGeometry, new THREE.ShaderMaterial({
        vertexShader: shellVertex, fragmentShader: shellFragment, transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending,
        uniforms: { colour: { value: colour }, centre: { value: new THREE.Vector3() }, dashes: { value: dashes }, level: { value: 1 }, opacity: { value: 0.4 } },
      }));
      m.frustumCulled = false;
      m.renderOrder = 3;
      this.scene.add(m);
      return m;
    };
    const pair: [THREE.Mesh, THREE.Mesh] = [make(SOI_COLOUR, 0), make(HILL_COLOUR, 72)];
    this.shells.set(key, pair);
    return pair;
  }

  // A small label at a screen point, reusing the pool.
  private tag(at: [number, number], text: string, cls: string, title: string, dy = 0): void {
    let el = this.tags[this.tagCount];
    if (!el) { el = document.createElement('div'); this.overlay.appendChild(el); this.tags.push(el); }
    this.tagCount++;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
    if (el.title !== title) el.title = title;
    el.style.display = '';
    el.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1] + dy)}px)`;
  }

  dispose(): void {
    this.field.dispose();
    for (const [a, b] of this.shells.values()) { this.scene.remove(a, b); (a.material as THREE.Material).dispose(); (b.material as THREE.Material).dispose(); }
    this.shellGeometry.dispose();
    for (const o of [this.axes, this.pulls]) { this.scene.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    for (const t of this.tags) t.remove();
  }
}
