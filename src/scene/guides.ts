// src/scene/guides.ts
//
// Drawing aids for how gravity works in the scene, each on its own switch
// in the rail and off by default (docs/physics/gravity-guides.md):
//
//   axes      each body's spin axis, a faint grey line through its poles,
//             north brighter and marked N, and a curved arrow about the
//             north pole turning the way the body does (spin.js), amber
//             and marked retrograde for Venus, Uranus and Pluto;
//   field     the real gravity field on the surface (gravityField.ts);
//   spheres   each body's sphere of influence (solid ring) and Hill sphere
//             (dashed), about its parent, from its osculating orbit;
//   lagrange  L1-L5 of Sun-Earth, Earth-Moon and Sun-Jupiter, and of the
//             focused body with its parent;
//   pulls     the four strongest pulls on the focused body, as lines to
//             each puller with its acceleration;
//   flow      the field of every body summed, as flowing field lines in a
//             plane through the focus (gravityFlow.ts).
//
// All are drawn at a display level (divided by the exposure, like the
// orbit lines), so they read the same at any distance from the Sun.

import * as THREE from 'three';
import { BODIES, BODY_BY_KEY, type BodyKey } from './catalogue';
import { hillRadius, lagrangePoints, soiRadius, strongestPulls } from '../physics/gravityGuides.js';
import { rvToElements } from '../physics/orbital.js';
import { GravityFieldLayer } from './gravityField';
import { GravityFlowLayer, type FlowFrame, type FlowPlane } from './gravityFlow';
import { spinRate } from '../physics/spin.js';

export type GuideKey = 'axes' | 'field' | 'spheres' | 'lagrange' | 'pulls' | 'flow';
type Vec3 = [number, number, number];
interface State { r: Vec3; v: Vec3 }

const UNIT_KM = 1000;
const AXIS_EXTENT = 1.5;              // the axis reaches 1.5 radii from the centre
const SOI_COLOUR = new THREE.Color(0xffb22e), HILL_COLOUR = new THREE.Color(0x9fc9b8);
const PAIRS: [BodyKey, BodyKey][] = [['sun', 'earth'], ['earth', 'moon'], ['sun', 'jupiter']];
// The spin arrow: an arc of 270 degrees about the axis, 0.45 radii across,
// 1.2 radii above the centre, fading from its tail to an arrowhead.
const ARC_SEGMENTS = 32, ARC_SPAN = 1.5 * Math.PI, ARC_RADIUS = 0.45, ARC_HEIGHT = 1.2;
const ARROW_VERTS = 2 * ARC_SEGMENTS + 4;
const RETRO_COLOUR = 0xff7a3d;
// How fast the arrows turn on screen, rad/s: not the real rate (Jupiter's
// would be a blur, Venus's still), but faster for faster spinners, on a
// log scale of the IAU rate in degrees a day.
const shownRate = (degPerDay: number) => Math.min(1.6, Math.max(0.3, 0.35 + 0.35 * Math.log10(Math.max(degPerDay, 1))));
const fmtDays = (d: number) => (d < 2 ? `${(d * 24).toPrecision(4)} hours` : `${d.toPrecision(4)} days`);

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
  readonly on: Record<GuideKey, boolean> = { axes: false, field: false, spheres: false, lagrange: false, pulls: false, flow: false };
  private field: GravityFieldLayer;
  private axes: THREE.LineSegments;
  private axisKeys = BODIES.map((b) => b.key);
  private shells = new Map<BodyKey, [THREE.Mesh, THREE.Mesh]>();
  private shellGeometry = new THREE.SphereGeometry(1, 96, 48);
  private pulls: THREE.LineSegments;
  private arrows: [THREE.LineSegments, THREE.LineSegments];      // prograde, retrograde
  readonly flow: GravityFlowLayer;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
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
    this.flow = new GravityFlowLayer(scene, overlay);
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
    // Spin arrows: per body an arc of segments and a two-stroke head, one
    // set grey (prograde), one amber (retrograde).
    const arrowAlpha = new Float32Array(n * ARROW_VERTS);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < ARC_SEGMENTS; j++) arrowAlpha.set([0.04 + 0.7 * (j / ARC_SEGMENTS) ** 1.5, 0.04 + 0.7 * ((j + 1) / ARC_SEGMENTS) ** 1.5], i * ARROW_VERTS + 2 * j);
      arrowAlpha.fill(0.74, i * ARROW_VERTS + 2 * ARC_SEGMENTS, (i + 1) * ARROW_VERTS);
    }
    this.arrows = [0xc8c2b4, RETRO_COLOUR].map((colour) => {
      const ag = new THREE.BufferGeometry();
      ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * ARROW_VERTS * 3), 3));
      ag.setAttribute('alpha', new THREE.BufferAttribute(arrowAlpha, 1));
      const a = new THREE.LineSegments(ag, lineMaterial(colour));
      a.frustumCulled = false;
      a.visible = false;
      a.renderOrder = 3;
      scene.add(a);
      return a;
    }) as unknown as [THREE.LineSegments, THREE.LineSegments];
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
    this.flow.on = this.on.flow;
  }

  setFlow(frame: FlowFrame, plane: FlowPlane): void {
    this.flow.frame = frame;
    this.flow.plane = plane;
  }

  // The field's two passes, before the scene is drawn.
  render(renderer: THREE.WebGLRenderer): void {
    this.flow.render(renderer);
  }

  update(f: {
    camera: THREE.PerspectiveCamera; states: Record<BodyKey, State>; cam: Vec3; meshes: Map<BodyKey, THREE.Mesh>;
    materials: Map<BodyKey, THREE.ShaderMaterial>; focus: BodyKey | null; width: number; height: number; level: number; date: Date;
    pivot: Vec3;
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
    this.flow.update({ camera, states: f.states, cam: f.cam, focus: f.focus, pivot: f.pivot, level: f.level, width, height });

    // Spin axes, from the surface materials' body-fixed Z (render frame).
    this.axes.visible = this.arrows[0].visible = this.arrows[1].visible = this.on.axes;
    if (this.on.axes) {
      (this.axes.material as THREE.ShaderMaterial).uniforms.level.value = f.level;
      for (const a of this.arrows) (a.material as THREE.ShaderMaterial).uniforms.level.value = f.level;
      const pos = this.axes.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arrowPos = this.arrows.map((a) => a.geometry.getAttribute('position') as THREE.BufferAttribute);
      const t = this.reduced.matches ? 0 : performance.now() / 1000;
      if (!(Math.abs(f.date.getTime() - this.sunAxisT) < 864e5)) { this.sunAxis.copy(this.sunAxisRender(f.date)); this.sunAxisT = f.date.getTime(); }
      this.axisKeys.forEach((k, i) => {
        const c = meshes.get(k)!.position;
        const m = f.materials.get(k);
        const px = radiusPx(k);
        for (const ap of arrowPos) for (let j = 0; j < ARROW_VERTS; j++) ap.setXYZ(i * ARROW_VERTS + j, c.x, c.y, c.z);
        if (px < 4) { for (let j = 0; j < 4; j++) pos.setXYZ(4 * i + j, c.x, c.y, c.z); return; }
        const e = m ? this.v.set(0, 0, 1).applyMatrix3(this.w3(m)) : this.v.copy(this.sunAxis);
        const spin = this.spinOf(k, e, f.states);
        const L = (BODY_BY_KEY[k].radiusKm / UNIT_KM) * AXIS_EXTENT;
        pos.setXYZ(4 * i, c.x - e.x * L, c.y - e.y * L, c.z - e.z * L);
        pos.setXYZ(4 * i + 1, c.x, c.y, c.z);
        pos.setXYZ(4 * i + 2, c.x, c.y, c.z);
        pos.setXYZ(4 * i + 3, c.x + e.x * L, c.y + e.y * L, c.z + e.z * L);
        if (px > 10) this.drawArrow(arrowPos[spin.retro ? 1 : 0], i, c, e, BODY_BY_KEY[k].radiusKm / UNIT_KM, spin.sense * spin.shown * t, spin.sense);
        if (px > 12) {
          const s = screen(this.w.set(c.x + e.x * L, c.y + e.y * L, c.z + e.z * L));
          if (onScreen(s)) this.tag(s!, spin.retro ? `${spin.pole} · retrograde` : spin.pole, `guide-tag axis-n${spin.retro ? ' retro' : ''}`, spin.title);
        }
      });
      pos.needsUpdate = true;
      for (const ap of arrowPos) ap.needsUpdate = true;
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

  // Which way a body turns about its drawn pole e (render frame): +1
  // counterclockwise seen from above it. From the sign of the IAU rate
  // (spin.js), or for a moon with none, which turns with its orbit, from
  // the orbit's sense about the pole. Retrograde: the spin against the
  // body's own orbit about its parent (for the Sun, the ecliptic's north).
  private spinOf(k: BodyKey, e: THREE.Vector3, states: Record<BodyKey, State>): { sense: number; shown: number; retro: boolean; pole: string; title: string } {
    const b = BODY_BY_KEY[k];
    const rate = spinRate(k) as { w1: number; periodDays: number; source: string } | null;
    const h = this.w.set(0, 1, 0);
    if (b.parent) {
      const s = states[k], p = states[b.parent];
      const r: Vec3 = [s.r[0] - p.r[0], s.r[1] - p.r[1], s.r[2] - p.r[2]], v: Vec3 = [s.v[0] - p.v[0], s.v[1] - p.v[1], s.v[2] - p.v[2]];
      this.toRender([r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], h);
    }
    const sense = rate ? Math.sign(rate.w1) : Math.sign(h.dot(e)) || 1;
    const retro = sense * h.dot(e) < 0;
    // Pluto's IAU pole is its positive one (the right-hand rule), south of
    // the ecliptic: marked + rather than N.
    const pole = e.y < 0 ? '+' : 'N';
    const poleName = pole === '+' ? 'positive pole (IAU, right-hand rule)' : 'north pole (IAU)';
    const period = rate ? rate.periodDays : b.periodDays ?? 0;
    const turns = `turns ${retro ? 'retrograde' : 'prograde'}, once in ${fmtDays(period)}`;
    const title = rate
      ? `${b.name}'s ${poleName}; it ${turns} (W1 ${rate.w1 > 0 ? '+' : '−'}${Math.abs(rate.w1).toPrecision(6)}°/day, ${rate.source})`
      : `${b.name}'s orbit pole; with no IAU model it ${turns}, keeping one face to ${b.parent ? BODY_BY_KEY[b.parent].name : 'its parent'}`;
    return { sense, retro, pole, title, shown: shownRate(rate ? Math.abs(rate.w1) : 360 / Math.max(period, 1e-3)) };
  }

  // An arrow about the pole e, centred on c (render units, radius R),
  // starting at angle phase and running `sense` ways round.
  private drawArrow(ap: THREE.BufferAttribute, i: number, c: THREE.Vector3, e: THREE.Vector3, R: number, phase: number, sense: number): void {
    const u = this.au.set(1, 0, 0);
    if (Math.abs(e.x) > 0.9) u.set(0, 1, 0);
    u.sub(this.aw.copy(e).multiplyScalar(u.dot(e))).normalize();
    const w = this.aw.crossVectors(e, u);
    const centre = this.ac.copy(c).addScaledVector(e, ARC_HEIGHT * R);
    const r = ARC_RADIUS * R;
    const at = (phi: number, out: THREE.Vector3) => out.copy(centre).addScaledVector(u, r * Math.cos(phi)).addScaledVector(w, r * Math.sin(phi));
    const o = i * ARROW_VERTS;
    const p = this.ap;
    for (let j = 0; j < ARC_SEGMENTS; j++) {
      at(phase + (sense * ARC_SPAN * j) / ARC_SEGMENTS, p); ap.setXYZ(o + 2 * j, p.x, p.y, p.z);
      at(phase + (sense * ARC_SPAN * (j + 1)) / ARC_SEGMENTS, p); ap.setXYZ(o + 2 * j + 1, p.x, p.y, p.z);
    }
    // The head: two strokes back from the tip, either side of the arc.
    const phi = phase + sense * ARC_SPAN;
    const tip = at(phi, this.ah);
    const back = this.ab.copy(u).multiplyScalar(Math.sin(phi)).addScaledVector(w, -Math.cos(phi)).multiplyScalar(sense * 0.16 * R);   // minus the tangent
    const out = this.ao.copy(u).multiplyScalar(Math.cos(phi)).addScaledVector(w, Math.sin(phi)).multiplyScalar(0.09 * R);
    ap.setXYZ(o + 2 * ARC_SEGMENTS, tip.x, tip.y, tip.z);
    ap.setXYZ(o + 2 * ARC_SEGMENTS + 1, tip.x + back.x + out.x, tip.y + back.y + out.y, tip.z + back.z + out.z);
    ap.setXYZ(o + 2 * ARC_SEGMENTS + 2, tip.x, tip.y, tip.z);
    ap.setXYZ(o + 2 * ARC_SEGMENTS + 3, tip.x + back.x - out.x, tip.y + back.y - out.y, tip.z + back.z - out.z);
  }
  private au = new THREE.Vector3(); private aw = new THREE.Vector3(); private ac = new THREE.Vector3(); private ap = new THREE.Vector3();
  private ah = new THREE.Vector3(); private ab = new THREE.Vector3(); private ao = new THREE.Vector3();

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
    this.flow.dispose();
    for (const [a, b] of this.shells.values()) { this.scene.remove(a, b); (a.material as THREE.Material).dispose(); (b.material as THREE.Material).dispose(); }
    this.shellGeometry.dispose();
    for (const o of [this.axes, this.pulls, ...this.arrows]) { this.scene.remove(o); o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    for (const t of this.tags) t.remove();
  }
}
