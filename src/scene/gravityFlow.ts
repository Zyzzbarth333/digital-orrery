// src/scene/gravityFlow.ts
//
// The gravitational field of every body at once
// (docs/physics/gravity-guides.md#the-field-of-every-body), drawn as field
// lines flowing toward the masses in a plane through the focus, brighter
// where the pull is stronger on a log scale. Three GPU passes a frame:
//
//   field    at half the screen's resolution, where each pixel's ray meets
//            the plane: the summed acceleration of all 54 bodies with a GM
//            (gravityFlow.js's sums in single precision), its direction in
//            the plane as a direction on screen, log10 |a|, and in the
//            rotating frame the Jacobi constant;
//   flow     line-integral convolution (Cabral and Leedom 1993): noise
//            averaged along each pixel's field line, with a ripple in the
//            kernel whose phase runs on, so the grain flows down the lines
//            (as Forssell and Cohen 1995 animate it);
//   plane    a disc in the scene through the focus, depth-tested against
//            the bodies, that shows the two, and in the rotating frame
//            the contours of the Jacobi constant, bright through L1-L3.
//
// Frames: inertial (the plain sum), falling with the focus (its own
// acceleration taken away: its pull and the others' tides), the same less
// the focus's own pull (what pulls things off their orbits about it: its
// moons' wells stand out), or rotating with the focus and its parent
// (their circular restricted problem).

import * as THREE from 'three';
import { BODIES, BODY_BY_KEY, type BodyKey } from './catalogue';
import { frameAccel, rotatingFrame, criticalLevels } from '@digital-orrery/physics/gravityFlow.js';

export type FlowFrame = 'inertial' | 'falling' | 'others' | 'rotating';
export type FlowPlane = 'orbit' | 'view';
type Vec3 = [number, number, number];
interface State { r: Vec3; v: Vec3 }

const MAX_BODIES = 64;
const UNIT_KM = 1000;
const LIC_STEPS = 20;               // each way along the line, a field pixel apart
const DECADES = 4.5;                // the brightness scale's span
const COLOUR = new THREE.Color(0x8fc8d8);
const CONTOUR = new THREE.Color(0xecd9b0), CRITICAL = new THREE.Color(0xffb22e);

// Ecliptic km -> the render frame's axes, km (not render units).
const axesOf = (a: number[]): Vec3 => [a[0], a[2], -a[1]];

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fieldFragment = /* glsl */ `
precision highp float;
uniform mat3 camRot;         // camera -> render frame
uniform mat3 viewRot;        // render frame -> camera
uniform vec2 proj;           // the projection's x and y scale (a symmetric frustum)
uniform vec2 res;
uniform vec3 origin;         // the plane's centre from the camera, km
uniform vec3 normal;
uniform vec4 bodies[${MAX_BODIES}];   // from the origin, km; GM km^3/s^2
uniform float radii[${MAX_BODIES}];
uniform int count;
uniform int mode;            // 0 inertial, 1 falling, 2 rotating
uniform vec3 frameAcc;       // falling: the focus's own acceleration
uniform vec3 bary;           // rotating: the pair's barycentre, its axis, n^2,
uniform vec3 axis;
uniform float n2;
uniform float jacobiScale;   // -2 d / G(M + m)
uniform float jacobiMin;     // C at L4
varying vec2 vUv;
void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 dir = normalize(camRot * vec3(ndc / proj, -1.0));
  float dn = dot(dir, normal);
  float t = dot(origin, normal) / dn;
  if (abs(dn) < 1e-5 || !(t > 0.0)) { gl_FragColor = vec4(0.0, 0.0, -99.0, 0.0); return; }
  vec3 h = dir * t;
  vec3 p = h - origin;
  vec3 a = vec3(0.0);
  float phi = 0.0;
  for (int i = 0; i < ${MAX_BODIES}; i++) {
    if (i >= count) break;
    vec3 d = bodies[i].xyz - p;
    float r = length(d), R = radii[i], gm = bodies[i].w;
    float rr = max(r, R);
    a += gm * d / (rr * rr * rr);
    phi -= r >= R ? gm / r : gm * (3.0 * R * R - r * r) / (2.0 * R * R * R);
  }
  float s = 0.0;
  if (mode == 1 || mode == 3) a -= frameAcc;
  if (mode == 2) {
    vec3 q = p - bary;
    q -= dot(q, axis) * axis;
    a += n2 * q;
    phi -= 0.5 * n2 * dot(q, q);
    s = log(max(jacobiScale * phi - jacobiMin, 1e-9)) * 0.4342945;
  }
  // The pull's part in the plane, as a direction on screen: the
  // projection's derivative at h along it.
  vec3 ap = a - dot(a, normal) * normal;
  vec2 screen = vec2(0.0);
  float m = length(ap);
  if (m > 0.0) {
    vec3 hc = viewRot * h, dc = viewRot * (ap / m);
    float iz = -1.0 / hc.z;
    screen = vec2(proj.x * (dc.x * iz + hc.x * dc.z * iz * iz), proj.y * (dc.y * iz + hc.y * dc.z * iz * iz)) * res;
    float l = length(screen);
    screen = l > 0.0 ? screen / l : vec2(0.0);
  }
  gl_FragColor = vec4(screen, log(max(length(a), 1e-30)) * 0.4342945, s);
}
`;

const licFragment = /* glsl */ `
precision highp float;
uniform sampler2D field;
uniform sampler2D noise;
uniform vec2 res;
uniform float phase;
uniform float lo;
uniform float hi;
varying vec2 vUv;
const float L = ${LIC_STEPS}.0;
// A Hann window along the line with a ripple 10 pixels long in it; s runs
// downstream, and as the phase grows the ripple's crests move downstream.
float kernel(float s) { return (0.5 + 0.5 * cos(3.14159265 * s / L)) * (1.0 + 0.85 * sin(0.6283185 * s + phase)); }
float grain(vec2 x) { return texture2D(noise, x * res / 256.0).r; }
void main() {
  vec4 f0 = texture2D(field, vUv);
  if (f0.z < -50.0) { gl_FragColor = vec4(0.0); return; }
  float sum = kernel(0.0) * grain(vUv), wsum = kernel(0.0);
  vec2 x = vUv;
  vec2 d = f0.xy;
  for (int i = 1; i <= ${LIC_STEPS}; i++) {
    x += d / res;
    vec4 f = texture2D(field, x);
    if (f.z < -50.0 || dot(f.xy, d) < 0.0) break;
    d = f.xy;
    float w = kernel(float(i));
    sum += w * grain(x); wsum += w;
  }
  x = vUv;
  d = f0.xy;
  for (int i = 1; i <= ${LIC_STEPS}; i++) {
    x -= d / res;
    vec4 f = texture2D(field, x);
    if (f.z < -50.0 || dot(f.xy, d) < 0.0) break;
    d = f.xy;
    float w = kernel(-float(i));
    sum += w * grain(x); wsum += w;
  }
  float lic = clamp((sum / max(wsum, 1e-4) - 0.5) * 3.0 + 0.5, 0.0, 1.0);
  float b = clamp((f0.z - lo) / (hi - lo), 0.0, 1.0);
  gl_FragColor = vec4(lic, b, f0.w, 1.0);
}
`;

const planeVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec4 vClip;
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  vClip = gl_Position;
  #include <logdepthbuf_vertex>
}
`;

const planeFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D flow;
uniform vec3 colour;
uniform vec3 contour;
uniform vec3 critical;
uniform vec3 levels;      // log10(C - C4) at L1, L2, L3
uniform float contours;   // 1 in the rotating frame
uniform float level;
uniform vec3 centre;
uniform float reach;      // the disc's radius, render units
varying vec4 vClip;
varying vec3 vWorld;
float line(float s, float w) { return 1.0 - smoothstep(0.5, 1.5, abs(s) / max(fwidth(s), 1e-6) / w); }
void main() {
  #include <logdepthbuf_fragment>
  vec4 f = texture2D(flow, vClip.xy / vClip.w * 0.5 + 0.5);
  if (f.w < 0.5) discard;
  float b = f.y;
  vec3 c = (colour * b * b * (0.12 + 0.88 * f.x) + vec3(1.0, 0.97, 0.9) * pow(b, 5.0) * f.x * 0.25) * (contours > 0.5 ? 0.5 : 0.85);
  if (contours > 0.5) {
    // Minor contours every 0.2 in log10(C - C4), only from half a decade
    // below L3's to half a decade above L1's (beyond, they crowd about the
    // bodies and the peaks at L4 and L5 and say nothing new).
    float u = f.z / 0.2;
    c += contour * 0.3 * line(fract(u + 0.5) - 0.5, 1.0)
      * (1.0 - smoothstep(levels.x + 0.3, levels.x + 0.5, f.z)) * smoothstep(levels.z - 0.5, levels.z - 0.3, f.z);
    float k = max(max(line(f.z - levels.x, 1.3), line(f.z - levels.y, 1.3)), line(f.z - levels.z, 1.3));
    c += critical * 0.85 * k;
  }
  c *= 1.0 - smoothstep(0.5 * reach, reach, length(vWorld - centre));
  gl_FragColor = vec4(c * level, 1.0);
}
`;

function fmtAccel(kms2: number): string {
  const ms2 = kms2 * 1000;
  if (ms2 >= 0.1) return `${ms2.toPrecision(2)} m/s²`;
  if (ms2 >= 1e-4) return `${(ms2 * 1e3).toPrecision(2)} mm/s²`;
  if (ms2 >= 1e-7) return `${(ms2 * 1e6).toPrecision(2)} µm/s²`;
  return `${(ms2 * 1e9).toPrecision(2)} nm/s²`;
}

const FRAME_NAME: Record<FlowFrame, string> = { inertial: 'inertial frame', falling: 'falling with', others: 'less', rotating: 'rotating with' };

export class GravityFlowLayer {
  on = false;
  frame: FlowFrame = 'falling';
  plane: FlowPlane = 'orbit';
  readonly legend: HTMLDivElement;
  private fieldRT: THREE.WebGLRenderTarget;
  private flowRT: THREE.WebGLRenderTarget;
  private quad = new THREE.Scene();
  private quadCamera = new THREE.Camera();
  private fieldMaterial: THREE.ShaderMaterial;
  private flowMaterial: THREE.ShaderMaterial;
  private quadMesh: THREE.Mesh;
  private disc: THREE.Mesh;
  private noise: THREE.DataTexture;
  private ready = false;
  private legendKey = '';
  private phase = 0;
  private last = performance.now();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private t = new THREE.Vector3();

  constructor(private scene: THREE.Scene, overlay: HTMLElement) {
    const target = () => new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false,
    });
    this.fieldRT = target();
    this.flowRT = target();
    // White noise, 256 x 256, repeated across the screen.
    const n = new Uint8Array(256 * 256);
    let seed = 0x2545f491;
    for (let i = 0; i < n.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; n[i] = seed & 0xff; }
    this.noise = new THREE.DataTexture(n, 256, 256, THREE.RedFormat, THREE.UnsignedByteType);
    this.noise.wrapS = this.noise.wrapT = THREE.RepeatWrapping;
    this.noise.minFilter = this.noise.magFilter = THREE.LinearFilter;
    this.noise.needsUpdate = true;

    this.fieldMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex, fragmentShader: fieldFragment, depthTest: false, depthWrite: false,
      uniforms: {
        camRot: { value: new THREE.Matrix3() }, viewRot: { value: new THREE.Matrix3() },
        proj: { value: new THREE.Vector2() }, res: { value: new THREE.Vector2() },
        origin: { value: new THREE.Vector3() }, normal: { value: new THREE.Vector3(0, 1, 0) },
        bodies: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Vector4()) }, radii: { value: new Float32Array(MAX_BODIES) },
        count: { value: 0 }, mode: { value: 0 }, frameAcc: { value: new THREE.Vector3() },
        bary: { value: new THREE.Vector3() }, axis: { value: new THREE.Vector3() }, n2: { value: 0 },
        jacobiScale: { value: 0 }, jacobiMin: { value: 0 },
      },
    });
    this.flowMaterial = new THREE.ShaderMaterial({
      vertexShader: quadVertex, fragmentShader: licFragment, depthTest: false, depthWrite: false,
      uniforms: { field: { value: this.fieldRT.texture }, noise: { value: this.noise }, res: { value: new THREE.Vector2() }, phase: { value: 0 }, lo: { value: -8 }, hi: { value: -3 } },
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quadMesh = new THREE.Mesh(tri, this.fieldMaterial);
    this.quadMesh.frustumCulled = false;
    this.quad.add(this.quadMesh);

    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 128), new THREE.ShaderMaterial({
      vertexShader: planeVertex, fragmentShader: planeFragment, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        flow: { value: this.flowRT.texture }, colour: { value: COLOUR }, contour: { value: CONTOUR }, critical: { value: CRITICAL },
        levels: { value: new THREE.Vector3(9, 9, 9) }, contours: { value: 0 }, level: { value: 1 },
        centre: { value: new THREE.Vector3() }, reach: { value: 1 },
      },
    }));
    this.disc.frustumCulled = false;
    this.disc.visible = false;
    this.disc.renderOrder = 1;
    scene.add(this.disc);

    this.legend = document.createElement('div');
    this.legend.className = 'field-legend flow-legend';
    this.legend.hidden = true;
    overlay.appendChild(this.legend);
  }

  // Everything the GPU needs this frame, worked out in double precision.
  update(f: { camera: THREE.PerspectiveCamera; states: Record<BodyKey, State>; cam: Vec3; focus: BodyKey | null; pivot: Vec3;
    level: number; width: number; height: number }): void {
    this.ready = false;
    this.disc.visible = false;
    this.legend.hidden = true;
    if (!this.on) return;
    const { states, camera } = f;
    const focus = f.focus;
    const originKm = focus ? states[focus].r : f.pivot;
    const R0 = Math.hypot(originKm[0] - f.cam[0], originKm[1] - f.cam[1], originKm[2] - f.cam[2]);
    const u = this.fieldMaterial.uniforms;

    // The bodies: planets at their centres with their own GMs (their moons
    // are summed separately), each moon with a GM.
    type B = { key: BodyKey; gm: number; r: Vec3; v: Vec3; radius: number };
    const all: B[] = BODIES.filter((b) => b.gm).map((b) => ({ key: b.key, gm: b.planetGm ?? b.gm!, r: states[b.key].r, v: states[b.key].v, radius: b.radiusKm }));
    let list = all;
    let mode = 0, pair: [BodyKey, BodyKey] | null = null;
    if ((this.frame === 'falling' || this.frame === 'others') && focus) {
      const fi = all.findIndex((b) => b.key === focus);
      const a = axesOf(frameAccel(all, fi));
      (u.frameAcc.value as THREE.Vector3).set(a[0], a[1], a[2]);
      mode = 1;
      if (this.frame === 'others') { list = all.filter((_, i) => i !== fi); mode = 3; }
    } else if (this.frame === 'rotating') {
      // The focus and its parent, with the GMs the Lagrange guide uses, so
      // the saddles fall on its markers; the Sun with Jupiter.
      const fb = focus ? BODY_BY_KEY[focus] : null;
      pair = !fb || !fb.parent || !fb.gm ? ['sun', 'jupiter'] : [fb.parent, fb.key];
      const [P, S] = pair.map((k) => ({ key: k, gm: BODY_BY_KEY[k].gm!, r: states[k].r, v: states[k].v, radius: BODY_BY_KEY[k].radiusKm }));
      const F = rotatingFrame(P, S);
      list = [P, S];
      mode = 2;
      const toO = (r: number[]) => axesOf([r[0] - originKm[0], r[1] - originKm[1], r[2] - originKm[2]]);
      (u.bary.value as THREE.Vector3).set(...toO(F.bary));
      (u.axis.value as THREE.Vector3).set(...axesOf(F.axis));
      u.n2.value = F.n2;
      const L = criticalLevels(F) as Record<'L1' | 'L2' | 'L3' | 'L4' | 'L5', { r: Vec3; C: number }>;
      u.jacobiScale.value = (-2 * F.sep) / F.gm;
      u.jacobiMin.value = L.L4.C;
      const lg = (c: number) => Math.log10(Math.max(c - L.L4.C, 1e-9));
      ((this.disc.material as THREE.ShaderMaterial).uniforms.levels.value as THREE.Vector3).set(lg(L.L1.C), lg(L.L2.C), lg(L.L3.C));
    }
    u.mode.value = mode;
    const shown = mode === 3 ? 'others' : mode === 1 ? 'falling' : mode === 2 ? 'rotating' : 'inertial';
    u.count.value = Math.min(list.length, MAX_BODIES);
    list.slice(0, MAX_BODIES).forEach((b, i) => {
      const r = axesOf([b.r[0] - originKm[0], b.r[1] - originKm[1], b.r[2] - originKm[2]]);
      (u.bodies.value as THREE.Vector4[])[i].set(r[0], r[1], r[2], b.gm);
      (u.radii.value as Float32Array)[i] = b.radius;
    });

    // The plane: in the rotating frame the pair's orbit; otherwise the
    // focus's system (the orbit of its biggest moon, or its own about its
    // parent, the ecliptic for the Sun), or square to the view.
    const normal = u.normal.value as THREE.Vector3;
    const orbitNormal = (s: BodyKey, p: BodyKey) => {
      const a = states[s], b = states[p];
      const r = [a.r[0] - b.r[0], a.r[1] - b.r[1], a.r[2] - b.r[2]], v = [a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2]];
      return normal.set(...axesOf([r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]])).normalize();
    };
    let planeName = 'the ecliptic';
    if (pair) { orbitNormal(pair[1], pair[0]); planeName = `${BODY_BY_KEY[pair[1]].name}'s orbit`; }
    else if (this.plane === 'view') { camera.getWorldDirection(normal); planeName = 'the plane square to the view'; }
    else {
      const moon = focus && focus !== 'sun' ? BODIES.filter((b) => b.parent === focus && b.gm).sort((a, b) => b.gm! - a.gm!)[0] : undefined;
      if (moon) { orbitNormal(moon.key, focus!); planeName = `${moon.name}'s orbit`; }
      else if (focus && focus !== 'sun' && BODY_BY_KEY[focus].parent) { orbitNormal(focus, BODY_BY_KEY[focus].parent!); planeName = `${BODY_BY_KEY[focus].name}'s orbit`; }
      else normal.set(0, 1, 0);
    }

    // The camera: the field pass casts each pixel's ray from it.
    const origin = u.origin.value as THREE.Vector3;
    origin.set(...axesOf([originKm[0] - f.cam[0], originKm[1] - f.cam[1], originKm[2] - f.cam[2]]));
    (u.camRot.value as THREE.Matrix3).setFromMatrix4(camera.matrixWorld);
    (u.viewRot.value as THREE.Matrix3).setFromMatrix4(camera.matrixWorldInverse);
    (u.proj.value as THREE.Vector2).set(camera.projectionMatrix.elements[0], camera.projectionMatrix.elements[5]);
    const w = Math.max(2, Math.round(f.width / 2)), h = Math.max(2, Math.round(f.height / 2));
    if (this.fieldRT.width !== w || this.fieldRT.height !== h) { this.fieldRT.setSize(w, h); this.flowRT.setSize(w, h); }
    (u.res.value as THREE.Vector2).set(w, h);
    const lu = this.flowMaterial.uniforms;
    (lu.res.value as THREE.Vector2).set(w, h);

    // Brightness: four and a half decades, topped by the focus's pull at
    // 3 % of the camera's distance (or at its surface, if that is farther).
    // Less the focus, the strongest of the rest within the view, at 3 % of
    // the camera's distance or its own distance, whichever is farther.
    const pullAt = (b: B, near: number) => b.gm / Math.max(b.radius, near, Math.hypot(b.r[0] - originKm[0], b.r[1] - originKm[1], b.r[2] - originKm[2])) ** 2;
    const hi = Math.log10(focus && mode !== 3 ? pullAt(all.find((b) => b.key === focus)!, 0.03 * R0)
      : Math.max(...(mode === 3 ? list : all).map((b) => pullAt(b, 0.03 * R0))));
    lu.hi.value = hi;
    lu.lo.value = hi - DECADES;
    const now = performance.now();
    if (!this.reduced.matches) this.phase = (this.phase + ((now - this.last) / 1000) * 3.0) % (2 * Math.PI * 1000);
    this.last = now;
    lu.phase.value = this.phase;

    // The disc through the origin, 40 times the camera's distance across.
    const du = (this.disc.material as THREE.ShaderMaterial).uniforms;
    const centre = this.t.set(origin.x / UNIT_KM, origin.y / UNIT_KM, origin.z / UNIT_KM);
    this.disc.position.copy(centre);
    this.disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    const reach = (40 * R0) / UNIT_KM;
    this.disc.scale.setScalar(reach);
    (du.centre.value as THREE.Vector3).copy(centre);
    du.reach.value = reach;
    du.level.value = f.level;
    du.contours.value = mode === 2 ? 1 : 0;
    this.disc.visible = true;
    this.ready = true;

    // The legend, redrawn when what it says changes.
    const frameText = shown === 'rotating' ? `${FRAME_NAME.rotating} ${BODY_BY_KEY[pair![0]].name}–${BODY_BY_KEY[pair![1]].name}`
      : shown === 'falling' ? `${FRAME_NAME.falling} ${BODY_BY_KEY[focus!].name}`
        : shown === 'others' ? `less ${BODY_BY_KEY[focus!].name}'s own` : FRAME_NAME.inertial;
    const key = `${frameText}|${planeName}|${hi.toFixed(1)}|${u.count.value}`;
    this.legend.hidden = false;
    if (key !== this.legendKey) { this.legendKey = key; this.drawLegend(frameText, planeName, 10 ** (hi - DECADES), 10 ** hi, list.length, mode); }
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.on || !this.ready) return;
    const prev = renderer.getRenderTarget();
    this.quadMesh.material = this.fieldMaterial;
    renderer.setRenderTarget(this.fieldRT);
    renderer.render(this.quad, this.quadCamera);
    this.quadMesh.material = this.flowMaterial;
    renderer.setRenderTarget(this.flowRT);
    renderer.render(this.quad, this.quadCamera);
    renderer.setRenderTarget(prev);
  }

  private drawLegend(frame: string, plane: string, lo: number, hi: number, n: number, mode: number): void {
    this.legend.innerHTML = '';
    const p = (cls: string, text: string) => { const e = document.createElement('p'); e.className = cls; e.textContent = text; return e; };
    const bar = document.createElement('div');
    bar.className = 'field-bar';
    const ticks = document.createElement('p');
    ticks.className = 'field-ticks';
    for (const v of [lo, Math.sqrt(lo * hi), hi]) { const s = document.createElement('span'); s.textContent = fmtAccel(v); ticks.appendChild(s); }
    this.legend.append(
      p('field-title', `Gravity field · ${frame}`), bar, ticks,
      p('field-unit', mode === 2
        ? `gravity and the centrifugal pull of the pair, log scale; contours of the Jacobi constant, amber through L1, L2, L3; in ${plane}`
        : mode === 3 ? `the pull of the other ${n} bodies, falling with the focus, log scale; lines run with the pull; in ${plane}`
          : `the pull of ${n} bodies summed, log scale; lines run with the pull; in ${plane}`),
      p('field-source', 'GMs: DE442, NAIF satellite kernels, JPL Horizons; positions this frame'));
  }

  dispose(): void {
    this.scene.remove(this.disc);
    this.disc.geometry.dispose();
    (this.disc.material as THREE.Material).dispose();
    this.quadMesh.geometry.dispose();
    this.fieldMaterial.dispose();
    this.flowMaterial.dispose();
    this.fieldRT.dispose();
    this.flowRT.dispose();
    this.noise.dispose();
    this.legend.remove();
  }
}
