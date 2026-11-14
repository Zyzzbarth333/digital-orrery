// src/scene/smallBodies.ts
//
// The asteroids and comets (src/physics/smallBodies.js): about 135,000
// points, each moved along its orbit by the GPU. Every frame only the time
// and the camera's position change; the vertex shader solves Kepler's
// equation for each body from its elements (a, e, i, node, peri, M at the
// shared epoch), so the cost on the CPU does not grow with their number.
// The named ones (dwarf planets, spacecraft targets, famous comets) get
// markers and labels in the HTML overlay, placed from the same elements on
// the CPU.
//
// Drawing (docs/frontend/small-bodies.md): each body is a point of light,
// as the point stars are (stars.ts): a Gaussian of fixed width in device
// pixels centred on its true sub-pixel position, so it neither shimmers nor
// vanishes as the view turns. Its brightness follows its magnitude as seen
// from the camera: H + 5 log10(r Δ) with the H-G phase function (G 0.15)
// for an asteroid, M1 + 5 log10 Δ + 10 log10 r for a comet. The magnitude
// is metered as the scene's exposure is, for sunlight at the camera, and
// its range is halved, so the populations read alike from the Earth or
// from the Kuiper belt while a body passing near the camera brightens as it
// would. Each population keeps its colour: the main belt grey, near-Earth
// asteroids orange, Jupiter trojans green, centaurs and trans-Neptunian
// objects violet, comets cyan.
//
// The scene hands update() the camera's heliocentric ecliptic position (km)
// and `level`: what a display value is multiplied by on its way out (1 / the
// exposure where the scene is exposed and tone-mapped once at the end, 1
// where it is not). Positions are camera-relative: the camera sits at the
// render origin, one render unit is 1000 km, and render (x, y, z) is
// ecliptic (x, z, -y).

import * as THREE from 'three';
import { decodeSmallBodies, positionAu, SB_CLASSES, SB_GROUPS, SB_EPOCH_JD } from '../physics/smallBodies.js';

const AU_KM = 149597870.7;
const UNIT_KM = 1000;
export type SmallBodyGroup = keyof typeof SB_GROUPS;
export const SMALL_BODY_GROUPS: SmallBodyGroup[] = ['belt', 'neo', 'trojans', 'outer', 'comets'];
const COLOUR: Record<SmallBodyGroup, [number, number, number]> = {
  belt: [0.62, 0.64, 0.70], neo: [1.0, 0.58, 0.26], trojans: [0.52, 0.84, 0.48], outer: [0.70, 0.58, 1.0], comets: [0.40, 0.88, 1.0],
};
// Brightness: a body of metered magnitude M_REF (a typical main-belt
// asteroid seen from the Earth) peaks at PEAK_REF, and each magnitude
// beyond it changes the peak by 10^(0.4 RANGE). The peak stops at PEAK_MAX,
// where the brightest bodies bloom a little.
const M_REF = 18, PEAK_REF = 0.03, RANGE = 0.5, PEAK_MAX = 3;
// Always labelled: the dwarf planets and the four largest asteroids; the
// rest only once the camera is within LABEL_NEAR_AU of them.
const ALWAYS = new Set(['1', '2', '4', '10', '136199', '136108', '136472']);
const LABEL_NEAR_AU = 1.5;
// TT - UTC (s) since 2017, to put the clock's UTC on the elements' TT epoch.
const TT_MINUS_UTC = 69.184;

interface Named { pdes: string; name: string; kind: string; cls: string; a: number; e: number; i: number; node: number; peri: number; M: number; H: number | null }

const VERTEX = /* glsl */ `
  attribute vec4 elA;          // a (au), e, i, node (rad)
  attribute vec4 elB;          // peri, M at the epoch (rad), H (a comet's M1), population
  uniform float uDays;         // days (TT) since the epoch
  uniform vec3 uCam;           // the camera, heliocentric ecliptic (au)
  uniform float uScale;        // render units per au
  uniform float uLevel;        // display value -> output
  uniform float uSize;         // sprite size, device px
  uniform vec3 uColour[5];
  uniform float uOn[5];
  varying vec3 vColour;
  float lg(float x) { return log2(x) * 0.30102999566; }
  void main() {
    int g = int(elB.w + 0.5);
    float on = g == 0 ? uOn[0] : g == 1 ? uOn[1] : g == 2 ? uOn[2] : g == 3 ? uOn[3] : uOn[4];
    if (on < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColour = vec3(0.0); return; }
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
    // From the camera (au, small near it), then ecliptic -> render (x, z, -y).
    vec3 rel = ecl - uCam;
    gl_Position = projectionMatrix * viewMatrix * vec4(vec3(rel.x, rel.z, -rel.y) * uScale, 1.0);
    gl_PointSize = uSize;
    // Its magnitude from the camera.
    float r = max(length(ecl), 1e-6), d = max(length(rel), 1e-9), mag;
    if (g == 4) {
      mag = elB.z + 5.0 * lg(d) + 10.0 * lg(r);
    } else {
      // Phase angle (Sun-body-camera), and the H-G system with G = 0.15.
      float t = tan(0.5 * acos(clamp(dot(ecl, rel) / (r * d), -1.0, 1.0)));
      float phi = 0.85 * exp(-3.33 * pow(max(t, 1e-6), 0.63)) + 0.15 * exp(-1.87 * pow(max(t, 1e-6), 1.22));
      mag = elB.z + 5.0 * lg(r * d) - 2.5 * lg(max(phi, 1e-9));
    }
    // Metered for sunlight at the camera (as the exposure is: no closer than
    // 0.2 au), then half the magnitude range.
    float dc = max(0.2, length(uCam));
    float peak = min(${PEAK_REF.toFixed(4)} * pow(10.0, -0.4 * ${RANGE.toFixed(2)} * (mag - 5.0 * lg(dc) - ${M_REF.toFixed(1)})), ${PEAK_MAX.toFixed(1)});
    vec3 c = g == 0 ? uColour[0] : g == 1 ? uColour[1] : g == 2 ? uColour[2] : g == 3 ? uColour[3] : uColour[4];
    vColour = c * (peak * uLevel);
  }`;

const FRAGMENT = /* glsl */ `
  uniform float uSigma;        // device px
  uniform float uSize;
  varying vec3 vColour;
  void main() {
    vec2 d = (gl_PointCoord - 0.5) * uSize;
    gl_FragColor = vec4(vColour * exp(-dot(d, d) / (2.0 * uSigma * uSigma)), 1.0);
  }`;

export class SmallBodyLayer {
  private points: THREE.Points | null = null;
  private material: THREE.ShaderMaterial;
  private named: Named[] = [];
  private markers = new Map<string, HTMLDivElement>();
  private on: Record<SmallBodyGroup, boolean> = { belt: true, neo: true, trojans: true, outer: true, comets: true };
  count = 0;
  private camAu: [number, number, number] = [0, 0, 0];
  private jd = SB_EPOCH_JD;
  private dpr = 0;
  private tmp = new THREE.Vector3();

  // Adds itself to the scene once the data has loaded.
  constructor(private scene: THREE.Scene, private overlay: HTMLElement, baseUrl = '') {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      // Opaque pass, just after the stars: bodies drawn later cover them
      // (a transparent material would be drawn over the bodies).
      transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uDays: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: AU_KM / UNIT_KM }, uLevel: { value: 1 },
        uSigma: { value: 1 }, uSize: { value: 7 },
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
      this.points = new THREE.Points(g, this.material);
      this.points.frustumCulled = false;
      this.points.renderOrder = -998;          // after the stars (-1000, -999)
      // The labels are placed as the points are drawn, when the camera's
      // matrices are those of this frame.
      this.points.onBeforeRender = (renderer, _scene, camera) => this.label(renderer, camera);
      this.scene.add(this.points);
      this.count = d.count;
      this.named = meta.named;
      for (const b of this.named) {
        const el = document.createElement('div');
        el.className = 'body-marker small-body';
        el.title = `${b.name}: ${b.kind}`;
        el.innerHTML = `<span class="dot"></span><span class="name">${b.name}</span>`;
        el.style.display = 'none';
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

  // Each frame: the time (ms, UTC), the camera's heliocentric ecliptic
  // position (km) and the display level.
  update(timeMs: number, cam: readonly number[], level: number): void {
    this.jd = timeMs / 86400e3 + 2440587.5 + TT_MINUS_UTC / 86400;
    this.camAu = [cam[0] / AU_KM, cam[1] / AU_KM, cam[2] / AU_KM];
    const u = this.material.uniforms;
    u.uDays.value = this.jd - SB_EPOCH_JD;
    (u.uCam.value as THREE.Vector3).set(...this.camAu);
    u.uLevel.value = level;
  }

  // The named bodies' markers at their projected positions, rounded to
  // whole device pixels; hidden when their population is, behind the
  // camera, or within a few pixels of another label. Also keeps the points'
  // width in device pixels as the pixel ratio changes.
  private label(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    const dpr = renderer.getPixelRatio();
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      const sigma = 0.55 + 0.35 * dpr;
      this.material.uniforms.uSigma.value = sigma;
      this.material.uniforms.uSize.value = Math.ceil(6 * sigma) + 1;
    }
    // The overlay's size and the screen's pixel ratio, as craftLayer.ts
    // places its markers.
    const w = this.overlay.clientWidth, h = this.overlay.clientHeight, px = window.devicePixelRatio || 1;
    const scale = AU_KM / UNIT_KM, [cx, cy, cz] = this.camAu;
    const placed: [number, number][] = [];
    for (const b of this.named) {
      const el = this.markers.get(b.pdes)!;
      const group = SMALL_BODY_GROUPS.find((g) => (SB_GROUPS[g] as string[]).includes(b.cls)) ?? 'belt';
      if (!this.on[group]) { el.style.display = 'none'; continue; }
      const p = positionAu(b, this.jd);
      const rx = p[0] - cx, ry = p[1] - cy, rz = p[2] - cz;
      if (!ALWAYS.has(b.pdes) && Math.hypot(rx, ry, rz) > LABEL_NEAR_AU) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.set(rx * scale, rz * scale, -ry * scale).project(camera);
      if (ndc.z > 1 || ndc.z < -1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * px) / px, y = Math.round(((1 - ndc.y) / 2) * h * px) / px;
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
