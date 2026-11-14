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
// for an asteroid, M1 + 5 log10 Δ + K1 log10 r (its own K1) for a comet.
// The magnitude is metered as the scene's exposure is, for sunlight at the
// camera, and its range is halved, so the populations read alike from the
// Earth or from the Kuiper belt while a body passing near the camera
// brightens as it would; the faintest are skipped. Each population keeps
// its colour: the main belt grey, near-Earth asteroids orange, Jupiter
// trojans green, centaurs and trans-Neptunian objects violet, comets cyan.
//
// The scene hands update() the camera's heliocentric ecliptic position
// (km), the level 1 / renderer.toneMappingExposure, and optionally the
// eye's adaptation, which dims the points beside bright light as it dims
// the stars. Drawn straight to the screen, the shader undoes the level, so
// the points add up as display values; drawn into an HDR target, the
// output pass exposes, tone-maps and encodes their sum. The same call is
// right either way. Positions are camera-relative: the camera sits at the
// render origin, one render unit is 1000 km, and render (x, y, z) is
// ecliptic (x, z, -y).

import * as THREE from 'three';
import { positionAu, SB_CLASSES, SB_GROUPS, SB_EPOCH_JD, SB_K1 } from '../physics/smallBodies.js';
import { ttMinusUtc } from '../physics/timescale.js';
import { BeltHaze } from './beltHaze';

const AU_KM = 149597870.7;
const UNIT_KM = 1000;
export type SmallBodyGroup = keyof typeof SB_GROUPS;
export const SMALL_BODY_GROUPS: SmallBodyGroup[] = ['belt', 'neo', 'trojans', 'outer', 'comets'];
const COLOUR: Record<SmallBodyGroup, [number, number, number]> = {
  // The belt an exact grey: a tone curve's toe keeps equal channels equal.
  belt: [0.64, 0.64, 0.64], neo: [1.0, 0.58, 0.26], trojans: [0.52, 0.84, 0.48], outer: [0.70, 0.58, 1.0], comets: [0.40, 0.88, 1.0],
};
// Brightness: a body of metered magnitude M_REF (the main belt's median
// seen from the Earth) peaks at PEAK_REF (a display value: about the level
// where a magnitude-7 star shows), and each magnitude beyond it changes the
// peak by 10^(0.4 RANGE). The peak stops at PEAK_MAX, where the brightest
// bodies bloom a little; below 1/512 a point is skipped, as the stars are.
const M_REF = 19.6, PEAK_REF = 0.08, RANGE = 0.5, PEAK_MAX = 3;
// Always labelled: the dwarf planets and the four largest asteroids; the
// rest only once the camera is within LABEL_NEAR_AU of them.
const ALWAYS = new Set(['1', '2', '4', '10', '136199', '136108', '136472']);
const LABEL_NEAR_AU = 1.5;
// TT - UTC (s): the leap-second table's, or 2017's before 1972 (a minute's
// difference moves a body by under an arcsecond).

interface Named { pdes: string; name: string; kind: string; cls: string; a: number; e: number; i: number; node: number; peri: number; M: number; H: number | null }

const VERTEX = /* glsl */ `
  // The packed file's fields, as they are (16 bytes a body on the GPU):
  attribute float aA;          // a (au)
  attribute vec4 aOrb;         // e, i, node, peri: 0-1 of 1 and of a turn
  attribute float aM;          // M at the epoch: 0-1 of a turn
  attribute vec2 aHC;          // H byte ((H + 2) x 7), class byte (class | K1 code << 5)
  uniform float uGroupOf[20];  // population of each SBDB class
  uniform float uK1[8];        // a comet's K1 by code
  uniform float uByGroup;      // 1: population colours; 0: natural ones
  uniform float uDays;         // days (TT) since the epoch
  uniform vec3 uCam;           // the camera, heliocentric ecliptic (au)
  uniform float uScale;        // render units per au
  uniform float uLevel;        // 1 / the exposure
  uniform float uVis;          // the eye's adaptation
  uniform float uSize;         // sprite size, device px
  uniform float uPeakScale;    // keeps a point's light when its width is floored
  uniform float uPointMin;     // the faintest peak drawn: the budget's cut-off
  uniform vec3 uColour[5];
  uniform float uOn[5];
  varying vec3 vColour;
  varying float vSize;
  float lg(float x) { return log2(x) * 0.30102999566; }
  void main() {
    const float TAU = 6.283185307;
    int cls = int(mod(aHC.y, 32.0) + 0.5);
    int g = int(uGroupOf[cls] + 0.5);
    float on = g == 0 ? uOn[0] : g == 1 ? uOn[1] : g == 2 ? uOn[2] : g == 3 ? uOn[3] : uOn[4];
    if (on < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColour = vec3(0.0); return; }
    float a = aA, e = aOrb.x, H = aHC.x / 7.0 - 2.0;
    float n = 0.01720209895 / (a * sqrt(a));
    float M = mod(aM * TAU + n * uDays, TAU);
    // Danby's starting guess, then Newton until it stops moving: two or
    // three steps for most asteroids, up to 12 for a comet near perihelion.
    float E = M + 0.85 * e * (sin(M) < 0.0 ? -1.0 : 1.0);
    for (int k = 0; k < 12; k++) {
      float dE = (E - e * sin(E) - M) / (1.0 - e * cos(E));
      E -= dE;
      if (abs(dE) < 1e-6) break;
    }
    float x = a * (cos(E) - e), y = a * sqrt(1.0 - e * e) * sin(E);
    float inc = aOrb.y * TAU, node = aOrb.z * TAU, peri = aOrb.w * TAU;
    float cw = cos(peri), sw = sin(peri), cn = cos(node), sn = sin(node), ci = cos(inc), si = sin(inc);
    float xp = cw * x - sw * y, yp = sw * x + cw * y;
    vec3 ecl = vec3(cn * xp - sn * ci * yp, sn * xp + cn * ci * yp, si * yp);
    // From the camera (au), then ecliptic -> render (x, z, -y).
    vec3 rel = ecl - uCam;
    gl_Position = projectionMatrix * viewMatrix * vec4(vec3(rel.x, rel.z, -rel.y) * uScale, 1.0);
    // Its magnitude from the camera.
    float r = max(length(ecl), 1e-6), d = max(length(rel), 1e-9), mag;
    if (g == 4) {
      mag = H + 5.0 * lg(d) + uK1[int(floor(aHC.y / 32.0) + 0.5)] * lg(r);
    } else {
      // Phase angle (Sun-body-camera), and the H-G system with G = 0.15;
      // tan(a/2) from cos a directly, which stays right next to 180 deg.
      float c = clamp(dot(ecl, rel) / (r * d), -1.0, 1.0);
      float t = sqrt(max(1.0 - c, 0.0) / max(1.0 + c, 1e-12));
      float phi = 0.85 * exp(-3.33 * pow(max(t, 1e-6), 0.63)) + 0.15 * exp(-1.87 * pow(max(t, 1e-6), 1.22));
      mag = H + 5.0 * lg(r * d) - 2.5 * lg(max(phi, 1e-9));
    }
    // Metered for sunlight at the camera (as the exposure is: no closer than
    // 0.2 au), then half the magnitude range.
    float dc = max(0.2, length(uCam));
    float peak = min(${PEAK_REF.toFixed(4)} * pow(10.0, -0.4 * ${RANGE.toFixed(2)} * (mag - 5.0 * lg(dc) - ${M_REF.toFixed(1)})), ${PEAK_MAX.toFixed(1)}) * uVis;
    // Too faint to show, or under the budget's cut-off: not drawn at all
    // (drawing points, not working them out, is what costs).
    if (peak < max(uPointMin, 1.0 / 512.0)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vColour = vec3(0.0); return; }
    // A dim point's glow is all core: a 3-pixel sprite carries it.
    gl_PointSize = peak < 0.3 ? min(uSize, 3.0) : uSize;
    vSize = gl_PointSize;
    // Natural colours: asteroids a warm grey (the mean of the S and C
    // types), comets a pale blue-white; or each population's own.
    vec3 col = uByGroup < 0.5 ? (g == 4 ? vec3(0.62, 0.70, 0.80) : vec3(0.68, 0.64, 0.58))
      : g == 0 ? uColour[0] : g == 1 ? uColour[1] : g == 2 ? uColour[2] : g == 3 ? uColour[3] : uColour[4];
    vColour = col * (peak * uLevel * uPeakScale);
  }`;

const FRAGMENT = /* glsl */ `
  uniform float uSigma;        // device px
  varying vec3 vColour;
  varying float vSize;
  void main() {
    vec2 d = (gl_PointCoord - 0.5) * vSize;
    gl_FragColor = vec4(vColour * exp(-dot(d, d) / (2.0 * uSigma * uSigma)), 1.0);
    // Drawn straight to the screen, no output pass applies the exposure the
    // level divided by: apply it here and write the display value as it is.
    // (Tone-mapping and encoding each point before they add up would turn
    // a dense belt white.) Into an HDR target TONE_MAPPING is not defined:
    // the output pass exposes, tone-maps and encodes the sum once.
    #ifdef TONE_MAPPING
    gl_FragColor.rgb *= toneMappingExposure;
    #endif
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
  private tmp = new THREE.Vector3();
  // The faint main belt, drawn as a haze from its real orbits.
  private haze: BeltHaze;
  private sunRender = new THREE.Vector3();

  // Adds itself to the scene once the data has loaded.
  constructor(private scene: THREE.Scene, private overlay: HTMLElement, baseUrl = '') {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      // Opaque pass, just after the stars: bodies drawn later cover them
      // (a transparent material would be drawn over the bodies).
      transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uDays: { value: 0 }, uCam: { value: new THREE.Vector3() }, uScale: { value: AU_KM / UNIT_KM }, uLevel: { value: 1 }, uVis: { value: 1 },
        uSigma: { value: 1 }, uSize: { value: 7 }, uPeakScale: { value: 1 }, uPointMin: { value: 0 },
        uColour: { value: SMALL_BODY_GROUPS.map((g) => new THREE.Vector3(...COLOUR[g])) }, uOn: { value: SMALL_BODY_GROUPS.map(() => 1) },
        uGroupOf: { value: SB_CLASSES.map((c) => Math.max(0, SMALL_BODY_GROUPS.findIndex((g) => (SB_GROUPS[g] as string[]).includes(c)))) },
        uK1: { value: [...SB_K1] }, uByGroup: { value: 0 },
      },
    });
    this.haze = new BeltHaze(scene);
    void this.load(baseUrl);
  }

  private async load(baseUrl: string): Promise<void> {
    try {
      const get = (f: string) => fetch(`${baseUrl}data/${f}`).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.arrayBuffer(); });
      const [bin, meta] = await Promise.all([get('smallbodies.bin'), fetch(`${baseUrl}data/smallbodies.json`).then((r) => r.json())]);
      this.show(bin);
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
      // Then the faint main belt, about 1.45 million more: too faint to see
      // one by one, so they are drawn as a haze from their real orbits.
      try {
        this.haze.setBodies(await get('smallbodies-belt.bin'));
      } catch (err) { console.warn(`faint main belt not loaded: ${err}`); }
    } catch (err) {
      console.warn(`small bodies not loaded: ${err}`);
    }
  }

  // The packed bodies (16 bytes each, smallbodies.build.mjs) as the points'
  // attributes, straight from their bytes.
  private show(buffer: ArrayBuffer): void {
    const n = buffer.byteLength / 16, dv = new DataView(buffer), u8 = new Uint8Array(buffer), u16 = new Uint16Array(buffer);
    const aA = new Float32Array(n), aOrb = new Uint16Array(n * 4), aM = new Uint16Array(n), aHC = new Uint8Array(n * 2);
    for (let j = 0; j < n; j++) {
      const o = j * 16, w = j * 8;
      aA[j] = dv.getFloat32(o, true);
      aOrb[j * 4] = u16[w + 2]; aOrb[j * 4 + 1] = u16[w + 3]; aOrb[j * 4 + 2] = u16[w + 4]; aOrb[j * 4 + 3] = u16[w + 5];
      aM[j] = u16[w + 6];
      aHC[j * 2] = u8[o + 14]; aHC[j * 2 + 1] = u8[o + 15];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Uint8Array(n), 1));
    g.setAttribute('aA', new THREE.BufferAttribute(aA, 1));
    g.setAttribute('aOrb', new THREE.BufferAttribute(aOrb, 4, true));
    g.setAttribute('aM', new THREE.BufferAttribute(aM, 1, true));
    g.setAttribute('aHC', new THREE.BufferAttribute(aHC, 2, false));
    // The positions come from the shader; the one-byte placeholder has none.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e12);
    if (this.points) { this.points.geometry.dispose(); this.points.geometry = g; }
    else {
      this.points = new THREE.Points(g, this.material);
      this.points.frustumCulled = false;
      this.points.renderOrder = -998;          // after the stars (-1000, -999)
      // The labels are placed as the points are drawn, when the camera's
      // matrices are those of this frame.
      this.points.onBeforeRender = (renderer, _scene, camera) => this.label(renderer, camera);
      this.scene.add(this.points);
    }
    this.count = n;
  }

  // The point budget: points cost to draw (about 0.26 us each on an
  // integrated GPU, a hundredth of that on a fast one), so the faintest
  // drawn is set from the frame time. Over 22 ms a frame (smoothed) the
  // cut-off rises; under 18 ms (a 60 Hz display's 16.7 ms passes) it falls
  // back, but not to within a quarter of where frames last ran slow, a mark
  // that fades over about 20 s, so the cut-off settles rather than see-saws.
  // The belt keeps its shape: the haze is drawn whatever the cut-off.
  private lastNow = 0;
  private frameMs = 16;
  private slowAt = 0;
  private budget(): void {
    const now = performance.now(), dt = now - this.lastNow;
    this.lastNow = now;
    if (!(dt > 0 && dt < 500)) return;
    this.frameMs += (dt - this.frameMs) * 0.1;
    this.slowAt *= 0.999;
    const u = this.material.uniforms, pm: number = u.uPointMin.value;
    if (this.frameMs > 22) {
      this.slowAt = Math.max(this.slowAt, pm);
      u.uPointMin.value = Math.min(1, Math.max(0.004, pm * 1.12));
    } else if (this.frameMs < 18 && pm > 0 && pm * 0.99 > this.slowAt * 1.25) {
      u.uPointMin.value = pm * 0.99 < 0.004 ? 0 : pm * 0.99;
    }
  }

  // Population colours (the rail's swatches) instead of natural ones.
  setColourByGroup(on: boolean): void { this.material.uniforms.uByGroup.value = on ? 1 : 0; }

  // The points' width as the stars' (stars.ts setStarScale): the same
  // width in CSS pixels whatever the render scale, never under 0.8 render
  // pixels, with the peak scaled to keep the light a point gives.
  setScale(deviceRatio: number, renderRatio: number): void {
    const u = this.material.uniforms;
    const want = (0.55 + 0.35 * deviceRatio) * (renderRatio / deviceRatio), sigma = Math.max(0.8, want);
    u.uSigma.value = sigma;
    u.uSize.value = Math.ceil(7 * sigma) + 1;
    u.uPeakScale.value = (want / sigma) ** 2;
  }

  setGroup(group: SmallBodyGroup, on: boolean): void {
    this.on[group] = on;
    if (group === 'belt') this.haze.setOn(on);
    (this.material.uniforms.uOn.value as number[])[SMALL_BODY_GROUPS.indexOf(group)] = on ? 1 : 0;
  }
  group(group: SmallBodyGroup): boolean { return this.on[group]; }

  // Each frame: the time (ms, UTC), the camera's heliocentric ecliptic
  // position (km), 1 / renderer.toneMappingExposure, and the eye's
  // adaptation where the scene models one (1 dark-adapted, less beside
  // bright light: the points fade with the stars).
  update(timeMs: number, cam: readonly number[], level: number, visibility = 1): void {
    this.jd = timeMs / 86400e3 + 2440587.5 + (ttMinusUtc(timeMs) ?? 69.184) / 86400;
    this.camAu = [cam[0] / AU_KM, cam[1] / AU_KM, cam[2] / AU_KM];
    const u = this.material.uniforms;
    u.uDays.value = this.jd - SB_EPOCH_JD;
    (u.uCam.value as THREE.Vector3).set(...this.camAu);
    u.uLevel.value = level;
    u.uVis.value = visibility;
    this.budget();
    // The Sun's render position: the camera is at the origin, and render
    // (x, y, z) is ecliptic (x, z, -y) in thousands of km.
    this.sunRender.set(-cam[0] / UNIT_KM, -cam[2] / UNIT_KM, cam[1] / UNIT_KM);
    this.haze.update(timeMs, this.sunRender, Math.hypot(...this.camAu), level, visibility);
  }

  // The named bodies' markers at their projected positions, rounded to
  // whole device pixels; hidden when their population is, behind the
  // camera, or within a few pixels of another label.
  private label(_renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
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
    this.haze.dispose();
    if (this.points) { this.scene.remove(this.points); this.points.geometry.dispose(); }
    this.material.dispose();
    for (const el of this.markers.values()) el.remove();
  }
}
