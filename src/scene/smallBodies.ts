// src/scene/smallBodies.ts
//
// The asteroids and comets (src/physics/smallBodies.js): about 140,000 points,
// each moved along its orbit by the GPU. Every frame only the time and the
// Sun's render position change; the vertex shader solves Kepler's equation
// for each body from its elements (a, e, i, node, peri, M at the shared
// epoch), so the cost on the CPU does not grow with their number. The named
// ones (dwarf planets, spacecraft targets, famous comets) get markers and
// labels like the planets', placed from the same elements on the CPU.
//
// Populations (smallBodies.js SB_GROUPS) are coloured and can be hidden:
// the main belt grey, near-Earth asteroids orange, Jupiter trojans green,
// centaurs and trans-Neptunian objects violet, comets cyan. Brightness and
// size follow the absolute magnitude H. They are drawing aids: points of
// constant size, outside the exposure and tone mapping, like the orbits.

import * as THREE from 'three';
import { decodeSmallBodies, positionAu, SB_CLASSES, SB_GROUPS, SB_EPOCH_JD } from '../physics/smallBodies.js';

const AU_KM = 149597870.7;
export type SmallBodyGroup = keyof typeof SB_GROUPS;
export const SMALL_BODY_GROUPS: SmallBodyGroup[] = ['belt', 'neo', 'trojans', 'outer', 'comets'];
const COLOUR: Record<SmallBodyGroup, [number, number, number]> = {
  belt: [0.55, 0.57, 0.62], neo: [1.0, 0.62, 0.30], trojans: [0.56, 0.80, 0.52], outer: [0.70, 0.60, 0.95], comets: [0.45, 0.86, 0.95],
};
// Always labelled: the dwarf planets and the four largest asteroids; the
// rest only once the camera is within LABEL_NEAR_AU of them.
const ALWAYS = new Set(['1', '2', '4', '10', '136199', '136108', '136472']);
const LABEL_NEAR_AU = 1.5;

interface Named { pdes: string; name: string; kind: string; cls: string; a: number; e: number; i: number; node: number; peri: number; M: number; H: number | null }

const VERTEX = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec4 elA;          // a (au), e, i, node
  attribute vec4 elB;          // peri, M at the epoch, H, group
  uniform float uDays;         // days since the epoch
  uniform float uScale;        // render units per au
  uniform float uPixel;        // device pixels per CSS pixel
  uniform vec3 uColour[5];
  uniform float uOn[5];
  varying vec3 vColour;
  varying float vAlpha;
  void main() {
    int g = int(elB.w + 0.5);
    float on = g == 0 ? uOn[0] : g == 1 ? uOn[1] : g == 2 ? uOn[2] : g == 3 ? uOn[3] : uOn[4];
    if (on < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
    float a = elA.x, e = elA.y;
    float n = 0.01720209895 / (a * sqrt(a));
    float M = mod(elB.y + n * uDays, 6.283185307);
    // Danby's starting guess, then Newton: converges in a few steps even
    // for a comet near perihelion (from pi, 12 steps left them 1.5' off).
    float E = M + 0.85 * e * (sin(M) < 0.0 ? -1.0 : 1.0);
    for (int k = 0; k < 12; k++) E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    float x = a * (cos(E) - e), y = a * sqrt(1.0 - e * e) * sin(E);
    float cw = cos(elB.x), sw = sin(elB.x), cn = cos(elA.w), sn = sin(elA.w), ci = cos(elA.z), si = sin(elA.z);
    float xp = cw * x - sw * y, yp = sw * x + cw * y;
    vec3 ecl = vec3(cn * xp - sn * ci * yp, sn * xp + cn * ci * yp, si * yp);
    // Ecliptic (x, y, z) -> render (x, z, -y).
    vec4 mv = modelViewMatrix * vec4(vec3(ecl.x, ecl.z, -ecl.y) * uScale, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
    // Brighter (lower H) bodies a little larger and less faint.
    float H = elB.z;
    float b = clamp((19.0 - H) / 12.0, 0.0, 1.0);
    gl_PointSize = (1.0 + 1.0 * b) * uPixel;
    vColour = g == 0 ? uColour[0] : g == 1 ? uColour[1] : g == 2 ? uColour[2] : g == 3 ? uColour[3] : uColour[4];
    // Faint: 135,000 points add up; the belt should read as a haze with
    // its brightest members picked out, not a wall.
    vAlpha = 0.05 + 0.3 * b * b;
  }`;

const FRAGMENT = /* glsl */ `
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColour;
  varying float vAlpha;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    gl_FragColor = vec4(vColour, vAlpha * smoothstep(0.5, 0.25, r));
  }`;

export class SmallBodyLayer {
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial;
  private named: Named[] = [];
  private markers = new Map<string, HTMLDivElement>();
  private on: Record<SmallBodyGroup, boolean> = { belt: true, neo: true, trojans: true, outer: true, comets: true };
  count = 0;
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, unitKm: number, baseUrl = '') {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      uniforms: {
        uDays: { value: 0 }, uScale: { value: AU_KM / unitKm }, uPixel: { value: Math.min(2, globalThis.devicePixelRatio || 1) },
        uColour: { value: SMALL_BODY_GROUPS.map((g) => new THREE.Vector3(...COLOUR[g])) }, uOn: { value: SMALL_BODY_GROUPS.map(() => 1) },
      },
    });
    void this.load(baseUrl);
  }

  private async load(baseUrl: string): Promise<void> {
    try {
      const [bin, meta] = await Promise.all([
        fetch(`${baseUrl}data/smallbodies.bin`).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
        fetch(`${baseUrl}data/smallbodies.json`).then((r) => r.json()),
      ]);
      const d = decodeSmallBodies(bin);
      const groupOf = SB_CLASSES.map((c) => Math.max(0, SMALL_BODY_GROUPS.findIndex((g) => (SB_GROUPS[g] as string[]).includes(c))));
      const elA = new Float32Array(d.count * 4), elB = new Float32Array(d.count * 4);
      for (let j = 0; j < d.count; j++) {
        elA.set([d.a[j], d.e[j], d.i[j], d.node[j]], j * 4);
        elB.set([d.peri[j], d.M[j], d.H[j], groupOf[d.cls[j]]], j * 4);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(d.count * 3), 3));
      g.setAttribute('elA', new THREE.BufferAttribute(elA, 4));
      g.setAttribute('elB', new THREE.BufferAttribute(elB, 4));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);   // never culled
      this.points = new THREE.Points(g, this.material);
      this.points.frustumCulled = false;
      this.points.renderOrder = -1;
      this.scene.add(this.points);
      this.count = d.count;
      this.named = meta.named;
      for (const b of this.named) {
        const el = document.createElement('div');
        el.className = 'body-marker small-body';
        el.title = `${b.name}: ${b.kind}`;
        el.innerHTML = `<span class="dot"></span><span class="name">${b.name}</span>`;
        this.overlay.appendChild(el);
        this.markers.set(b.pdes, el);
      }
    } catch (err) {
      console.warn(`small bodies not loaded: ${err}`);
    }
  }

  setGroup(group: SmallBodyGroup, on: boolean): void {
    this.on[group] = on;
    (this.material.uniforms.uOn.value as number[])[SMALL_BODY_GROUPS.indexOf(group)] = on ? 1 : 0;
  }
  group(group: SmallBodyGroup): boolean { return this.on[group]; }

  // Each frame: the time, and the Sun's position in render units (the
  // points are heliocentric).
  update(timeMs: number, sunRender: THREE.Vector3): void {
    if (!this.points) return;
    this.points.position.copy(sunRender);
    this.material.uniforms.uDays.value = timeMs / 86400e3 + 2440587.5 + 69.184 / 86400 - SB_EPOCH_JD;
  }

  // The named bodies' markers at their projected positions; hidden when
  // their population is, behind the camera, or within a few pixels of
  // another label.
  label(timeMs: number, sunRender: THREE.Vector3, camera: THREE.Camera, w: number, h: number): void {
    if (!this.points) return;
    const jd = timeMs / 86400e3 + 2440587.5 + 69.184 / 86400, scale = (this.material.uniforms.uScale.value as number);
    const placed: [number, number][] = [];
    for (const b of this.named) {
      const el = this.markers.get(b.pdes)!;
      const group = SMALL_BODY_GROUPS.find((g) => (SB_GROUPS[g] as string[]).includes(b.cls)) ?? 'belt';
      if (!this.on[group]) { el.style.display = 'none'; continue; }
      const p = positionAu(b, jd);
      this.tmp.set(p[0] * scale, p[2] * scale, -p[1] * scale).add(sunRender);
      // The camera is at the render origin: the vector's length is its distance.
      if (!ALWAYS.has(b.pdes) && this.tmp.length() > LABEL_NEAR_AU * scale) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.project(camera);
      if (ndc.z > 1 || ndc.z < -1) { el.style.display = 'none'; continue; }
      const x = ((ndc.x + 1) / 2) * w, y = ((1 - ndc.y) / 2) * h;
      if (placed.some(([px, py]) => Math.abs(px - x) < 40 && Math.abs(py - y) < 12)) { el.style.display = 'none'; continue; }
      placed.push([x, y]);
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  dispose(): void {
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    this.material.dispose();
    for (const el of this.markers.values()) el.remove();
  }
}

