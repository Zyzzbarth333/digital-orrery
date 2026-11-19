// src/scene/craftLayer.ts
//
// Spacecraft in the scene: an HTML marker (a small square turned 45 degrees,
// orange while the engine burns, struck through after an impact) at the
// craft's drawn position, its osculating conic about its primary (amber) and
// the path it has flown (pale). Lines are drawn relative to the primary and
// placed at the primary's render position, like the bodies' orbit lines.
// Closer than a tenth of the craft's distance from its primary, where the
// conic's uniform samples (and float32 about the primary) would miss the
// craft, the conic and the trail's last stretch are drawn every frame
// relative to the craft instead (craftPaths.ts, conicAround), so they run
// through it from any distance.
// They are drawing aids at a display level: multiplied by 1/exposure
// (setLevel), so after the HDR pipeline's exposure and tone curve they show
// at the colours given here.
//
// A craft carrying an attitude (craftAttitude.js) gets an attitude
// indicator within ATTITUDE_RANGE_KM of the camera: its body drawn as a
// small wireframe box and its axes from the marker, projected from 3D at a
// fixed screen size (so they foreshorten as the craft turns): the thrust
// axis (+x) long in amber, +y and +z short in pale phosphor, an axis
// pointing away from the camera fainter, the reference it is turning to
// as a dashed amber stalk, and a short orange plume aft while it burns.
// An SVG overlay rather than lines in the scene, at a fixed size.

import * as THREE from 'three';
import { orbitTrailMaterial, reachOf } from './orbitTrail';
import { conicAround } from './craftPaths';

type V3 = [number, number, number];

export interface CraftView {
  id: number;
  name: string;
  rEcl: V3;               // heliocentric ecliptic km, at the sim clock
  primaryEcl: V3;         // the primary's position, same frame
  conicEcl: V3[];         // the osculating conic, relative to the primary
  trailEcl: V3[];         // the flown path, relative to the primary
  pathVersion: number;    // changes when conic or trail change
  thrusting: boolean;
  crashed: boolean;
  selected: boolean;
  // A real mission's flown path, relative to Earth (drawn once, placed at
  // Earth's position each frame).
  flown?: { pointsEcl: V3[]; originEcl: V3 };
  // The attitude: body axes x, y, z and the reference's x (ecliptic unit
  // vectors), and whether it is burning.
  attitude?: { axes: [V3, V3, V3]; target: V3 | null; firing: boolean };
  // The craft's state relative to its primary (ecliptic km, km/s), the
  // primary's GM and how far a hyperbola is drawn: for the close-up conic.
  orbit?: { r: V3; v: V3; mu: number; rMax: number };
}

// near and nearTrail: the close-up conic and trail end, sharing the
// conic's and trail's materials.
interface Drawn { conic: THREE.Line; trail: THREE.Line; near: THREE.Line; nearTrail: THREE.Line; flown: THREE.Line | null; marker: HTMLDivElement; att: SVGSVGElement | null; version: number }

// Within this distance of the camera a craft's attitude is drawn.
export const ATTITUDE_RANGE_KM = 50000;
// The close-up lines are drawn within this share of the craft's distance
// from its primary. There the uniform conic's chords (sag up to 7.5e-5 of
// that distance) would be about a pixel off the craft.
const CLOSE_SHARE = 0.1;
const SVG_NS = 'http://www.w3.org/2000/svg';
// Screen lengths (px): the thrust axis, the other two, the box's long side.
const AXIS_PX = 40, SIDE_PX = 24, BOX_PX = 18;
// The app's craft: a 2 by 2 by 3 m box, long along +x (craftAttitude.js).
const BOX = [1.5, 1, 1];
const BOX_EDGES: [number, number][] = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];

function attitudeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'craft-att');
  svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
  svg.setAttribute('aria-hidden', 'true');
  for (const cls of ['box', 'target', 'plume', 'ax ax-y', 'ax ax-z', 'ax ax-x']) {
    const el = document.createElementNS(SVG_NS, 'path');
    el.setAttribute('class', cls);
    svg.appendChild(el);
  }
  return svg;
}

// Ecliptic km -> render units (x, z, -y) / unit.
const toRender = (a: number[], unitKm: number, out: THREE.Vector3) => out.set(a[0] / unitKm, a[2] / unitKm, -a[1] / unitKm);

function lineOf(colour: number, opacity: number): THREE.Line {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const m = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, toneMapped: false, depthWrite: false });
  m.userData.base = new THREE.Color(colour);
  const line = new THREE.Line(g, m);
  line.frustumCulled = false;
  return line;
}

function setPoints(line: THREE.Line, pts: V3[], unitKm: number): void {
  const n = Math.max(1, pts.length);
  const arr = new Float32Array(n * 3), u = new Float32Array(n);
  pts.forEach((p, i) => {
    arr[3 * i] = p[0] / unitKm; arr[3 * i + 1] = p[2] / unitKm; arr[3 * i + 2] = -p[1] / unitKm;
    u[i] = n > 1 ? i / (n - 1) - 1 : 0;           // age along the trail: newest 0, oldest -1
  });
  line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  line.geometry.setAttribute('u', new THREE.BufferAttribute(u, 1));
  line.geometry.setDrawRange(0, pts.length);
  // A trail fades close in, against its size about the primary (orbitTrail.ts).
  const m = line.material as THREE.ShaderMaterial;
  if (m.uniforms?.reach) m.uniforms.reach.value = reachOf(arr);
}

// Points relative to the craft, written into a line's own buffer (grown
// when short), with the trail's age attribute at its newest.
function setLocal(line: THREE.Line, pts: V3[], unitKm: number): void {
  const g = line.geometry, n = pts.length;
  let pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (pos.count < n) {
    pos = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', pos);
    if (g.getAttribute('u')) g.setAttribute('u', new THREE.BufferAttribute(new Float32Array(n), 1));
  }
  const a = pos.array as Float32Array;
  for (let i = 0; i < n; i++) { const p = pts[i]; a[3 * i] = p[0] / unitKm; a[3 * i + 1] = p[2] / unitKm; a[3 * i + 2] = -p[1] / unitKm; }
  pos.needsUpdate = true;
  g.setDrawRange(0, n);
}

// The flown path glows at the craft and fades with age (orbitTrail.ts).
function trailOf(colour: number): THREE.Line {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  g.setAttribute('u', new THREE.BufferAttribute(new Float32Array(1), 1));
  const line = new THREE.Line(g, orbitTrailMaterial(colour, 0.12, 0.25));
  line.frustumCulled = false;
  return line;
}

export class CraftLayer {
  private drawn = new Map<number, Drawn>();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private level = 1;

  // Lines are drawn at a display level: 1 / the exposure the HDR output
  // applies.
  setLevel(level: number): void {
    this.level = level;
    for (const d of this.drawn.values()) {
      for (const line of [d.conic, d.flown]) {
        if (!line) continue;
        const m = line.material as THREE.LineBasicMaterial;
        m.color.copy(m.userData.base as THREE.Color).multiplyScalar(level);
      }
      (d.trail.material as THREE.ShaderMaterial).uniforms.level.value = level;
    }
  }

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private onPick: (id: number) => void) {}

  // Before rendering: lines in place. cam: the camera's ecliptic km.
  place(views: CraftView[], cam: V3, unitKm: number): void {
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let d = this.drawn.get(v.id);
      if (!d) {
        const marker = document.createElement('div');
        marker.className = 'craft-marker';
        marker.innerHTML = '<span class="glyph"></span><span class="name"></span>';
        marker.addEventListener('click', () => this.onPick(v.id));
        this.overlay.appendChild(marker);
        const conic = lineOf(0xffb22e, 0.55), trail = trailOf(0xffcf7a);
        const near = new THREE.Line(new THREE.BufferGeometry(), conic.material);
        near.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
        const nearTrail = new THREE.Line(new THREE.BufferGeometry(), trail.material);
        nearTrail.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
        nearTrail.geometry.setAttribute('u', new THREE.BufferAttribute(new Float32Array(1), 1));
        near.frustumCulled = nearTrail.frustumCulled = false;
        near.visible = nearTrail.visible = false;
        d = { conic, trail, near, nearTrail, flown: null, marker, att: null, version: -1 };
        this.scene.add(d.conic, d.trail, near, nearTrail);
        this.drawn.set(v.id, d);
      }
      if (d.version !== v.pathVersion) {
        setPoints(d.conic, v.conicEcl, unitKm);
        setPoints(d.trail, v.trailEcl, unitKm);
        d.version = v.pathVersion;
      }
      if (v.flown && !d.flown) {
        d.flown = lineOf(0x8fd6c4, 0.5);    // the flown path: pale green, apart from the amber of ours
        setPoints(d.flown, v.flown.pointsEcl, unitKm);
        this.scene.add(d.flown);
      }
      if (v.flown && d.flown) toRender([v.flown.originEcl[0] - cam[0], v.flown.originEcl[1] - cam[1], v.flown.originEcl[2] - cam[2]], unitKm, d.flown.position);
      const p = [v.primaryEcl[0] - cam[0], v.primaryEcl[1] - cam[1], v.primaryEcl[2] - cam[2]];
      toRender(p, unitKm, d.conic.position);
      d.trail.position.copy(d.conic.position);
      this.placeClose(v, d, cam, unitKm);
      (d.marker.querySelector('.name') as HTMLElement).textContent = v.name;
      d.marker.classList.toggle('burn', v.thrusting);
      d.marker.classList.toggle('lost', v.crashed);
      d.marker.classList.toggle('selected', v.selected);
    }
    this.setLevel(this.level);
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.scene.remove(d.conic, d.trail, d.near, d.nearTrail);
      d.conic.geometry.dispose(); d.trail.geometry.dispose(); d.near.geometry.dispose(); d.nearTrail.geometry.dispose();
      if (d.flown) { this.scene.remove(d.flown); d.flown.geometry.dispose(); }
      d.marker.remove();
      d.att?.remove();
      this.drawn.delete(id);
    }
  }

  // Close to the craft: the conic and the trail's last stretch from its
  // state this frame, placed at the craft's render position; the uniform
  // conic is hidden.
  private placeClose(v: CraftView, d: Drawn, cam: V3, unitKm: number): void {
    const o = v.orbit;
    const rel = [v.rEcl[0] - cam[0], v.rEcl[1] - cam[1], v.rEcl[2] - cam[2]];
    const close = !!o && Math.hypot(rel[0], rel[1], rel[2]) < CLOSE_SHARE * Math.hypot(o.r[0], o.r[1], o.r[2]);
    const c = close ? conicAround(o!.r, o!.v, o!.mu, o!.rMax, v.trailEcl.at(-1) ?? null) : null;
    d.conic.visible = !c;
    d.near.visible = !!c;
    d.nearTrail.visible = !!c && c.back.length > 1;
    if (!c) return;
    toRender(rel, unitKm, d.near.position);
    d.nearTrail.position.copy(d.near.position);
    setLocal(d.near, c.ahead, unitKm);
    if (c.back.length > 1) setLocal(d.nearTrail, c.back, unitKm);
  }

  // After the camera is set: markers at their projected positions.
  // The Sun's share at a point (OrreryScene.sunlightAt): a craft in a
  // body's umbra or penumbra has its marker marked (app.css).
  shade: ((r: V3) => { nu: number; state: string; by: string | null }) | null = null;

  label(views: CraftView[], cam: V3, unitKm: number, camera: THREE.Camera, w: number, h: number): void {
    for (const v of views) {
      const d = this.drawn.get(v.id);
      if (!d) continue;
      const sl = this.shade?.(v.rEcl);
      d.marker.classList.toggle('eclipse', sl?.state === 'umbra');
      d.marker.classList.toggle('penumbra', sl?.state === 'penumbra');
      // Shown when in front of the camera, by its view-space depth: a craft
      // followed from under a kilometre is nearer than the scene's near
      // plane, where the projected depth alone would hide it.
      const p = toRender([v.rEcl[0] - cam[0], v.rEcl[1] - cam[1], v.rEcl[2] - cam[2]], unitKm, this.tmp);
      const ahead = this.tmp2.copy(p).applyMatrix4(camera.matrixWorldInverse).z < 0;
      const ndc = p.project(camera);
      if (!ahead || ndc.z > 1) { d.marker.style.display = 'none'; if (d.att) d.att.style.display = 'none'; continue; }
      d.marker.style.display = '';
      const dpr = window.devicePixelRatio || 1;
      const sx = Math.round(((ndc.x + 1) / 2) * w * dpr) / dpr, sy = Math.round(((1 - ndc.y) / 2) * h * dpr) / dpr;
      d.marker.style.transform = `translate(${sx}px, ${sy}px)`;
      this.attitude(v, d, cam, unitKm, camera, w, h, sx, sy);
    }
  }

  // The attitude indicator at screen point (sx, sy). Each body axis a is
  // projected as the screen offset of a point a short way along it, scaled
  // so an axis square to the line of sight is its full length: the
  // projection's own foreshortening, at a fixed size.
  private attitude(v: CraftView, d: Drawn, cam: V3, unitKm: number, camera: THREE.Camera, w: number, h: number, sx: number, sy: number): void {
    const rel = [v.rEcl[0] - cam[0], v.rEcl[1] - cam[1], v.rEcl[2] - cam[2]], dist = Math.hypot(rel[0], rel[1], rel[2]);
    const show = !!v.attitude && !v.crashed && dist < ATTITUDE_RANGE_KM;
    if (!show) { if (d.att) d.att.style.display = 'none'; return; }
    if (!d.att) { d.att = attitudeSvg(); this.overlay.insertBefore(d.att, d.marker); }
    const A = v.attitude!, fov = (camera as THREE.PerspectiveCamera).fov ?? 45;
    const f = h / (2 * Math.tan((fov * Math.PI) / 360)), eps = dist * 1e-3, k = 1 / (1e-3 * f);
    const p0 = toRender(rel, unitKm, this.tmp).project(camera).clone();
    const look = [rel[0] / dist, rel[1] / dist, rel[2] / dist];
    // Screen offset (px per unit length on screen) and depth of a direction.
    const screen = (a: V3): { x: number; y: number; away: boolean } => {
      const q = toRender([rel[0] + a[0] * eps, rel[1] + a[1] * eps, rel[2] + a[2] * eps], unitKm, this.tmp).project(camera);
      return { x: ((q.x - p0.x) / 2) * w * k, y: (-(q.y - p0.y) / 2) * h * k, away: a[0] * look[0] + a[1] * look[1] + a[2] * look[2] > 0 };
    };
    const [X, Y, Z] = A.axes.map(screen);
    const seg = (s: { x: number; y: number }, L: number, from = 0) => `M${(s.x * from).toFixed(1)} ${(s.y * from).toFixed(1)}L${(s.x * L).toFixed(1)} ${(s.y * L).toFixed(1)}`;
    const paths = d.att.children;
    // The body: its corners (+-1.5, +-1, +-1 m) on the axes' screen vectors.
    const c = (i: number) => [(i & 4 ? 1 : -1) * BOX[0], (i & 2 ? 1 : -1) * BOX[1], (i & 1 ? 1 : -1) * BOX[2]];
    const u = BOX_PX / (2 * BOX[0]);
    const corner = (i: number) => { const [a, b, e] = c(i); return [(a * X.x + b * Y.x + e * Z.x) * u, (a * X.y + b * Y.y + e * Z.y) * u]; };
    const pts = Array.from({ length: 8 }, (_, i) => corner(i));
    paths[0].setAttribute('d', BOX_EDGES.map(([i, j]) => `M${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)}L${pts[j][0].toFixed(1)} ${pts[j][1].toFixed(1)}`).join(''));
    paths[1].setAttribute('d', A.target ? seg(screen(A.target), AXIS_PX) : '');
    paths[2].setAttribute('d', A.firing ? seg(X, -(BOX_PX / 2 + 10), -BOX_PX / 2) : '');
    const axis = (el: Element, s: { x: number; y: number; away: boolean }, L: number) => { el.setAttribute('d', seg(s, L)); el.classList.toggle('away', s.away); };
    axis(paths[3], Y, SIDE_PX); axis(paths[4], Z, SIDE_PX); axis(paths[5], X, AXIS_PX);
    d.att.style.display = '';
    d.att.style.transform = `translate(${sx}px, ${sy}px)`;
  }

  dispose(): void {
    for (const d of this.drawn.values()) { this.scene.remove(d.conic, d.trail, d.near, d.nearTrail); if (d.flown) this.scene.remove(d.flown); d.marker.remove(); d.att?.remove(); }
    this.drawn.clear();
  }
}
