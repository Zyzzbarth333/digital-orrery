// src/scene/magnetic.ts
//
// The planets' magnetic fields and their auroras, two switches in the
// rail's Guides section, off by default (docs/physics/magnetic-fields.md):
//
//   magnetic  field lines of Earth (IGRF-14), Jupiter (JRM33 + con2020),
//             Saturn (Cassini 11), Uranus and Neptune (Voyager's offset
//             tilted dipoles), traced from the surface in the body's own
//             frame and shaded by |B| on the console's ramp, sheen where
//             strong to engraving where weak; the dipole's axis through its
//             centre, and a legend for the focused body.
//   aurora    the Earth's ovals from Starkov's model driven by the day's Kp,
//             green 557.7 nm low and red 630.0 nm higher, on the night side;
//             Jupiter's main emission and Io's footprint spot, and Saturn's
//             main oval, in false colour (they shine in the ultraviolet).
//
// The lines are fixed in each body's frame, so they are traced once (a few
// milliseconds a frame until done, focused body first) and then only
// turned with the body. The physics loads the first time either is on.
//
// Field lines do not move; what moves along them is trapped particles.
// Each closed line carries a faint pulse, a particle bouncing between its
// mirror points at the speed the kept magnetic moment allows (bounceTrack:
// fast over the equator, slowing to a stop where it mirrors). Real bounces
// take a fraction of a second to minutes; here each takes seconds, longer
// on longer lines (as the square root of the real period's path, so the
// outer lines still move). The pulses stop while time is held and are not
// drawn at all with reduced motion.

import * as THREE from 'three';
import { BODY_BY_KEY, type BodyKey } from './catalogue';

export type MagneticKey = 'magnetic' | 'aurora' | 'belts';
type Mag = typeof import('../physics/magnetic.js');
type Aur = typeof import('../physics/aurora.js');
type Belts = typeof import('../physics/belts.js');
type RC = typeof import('../physics/ringCurrent.js');
type SunMod = typeof import('../physics/sunField.js');
type T89 = typeof import('../physics/t89.js');
type Bnd = typeof import('../physics/boundaries.js');
type Ovation = ReturnType<typeof import('../physics/ovation.js')['parseOvation']>;
type Model = NonNullable<ReturnType<Mag['magneticModel']>>;
type V3 = [number, number, number];

const UNIT_KM = 1000;
const DEG_R = Math.PI / 180;
const SUN_KM = 695700;
const BODIES: BodyKey[] = ['mercury', 'earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'ganymede'];
const BUDGET_MS = 3;                       // tracing per frame
// Seed latitudes (magnetic, toward the end field lines leave) per body.
const SEEDS: Record<string, number[]> = {
  mercury: [20, 35, 45, 55, 62, 68], ganymede: [15, 30, 40, 50, 60, 68], earth: [20, 35, 45, 55, 62, 68], jupiter: [15, 30, 45, 55, 62, 68, 74], saturn: [20, 35, 45, 55, 62, 68],
  uranus: [15, 30, 45, 55, 62, 68], neptune: [15, 30, 45, 55, 62, 68],
};
const N_LON = 12;
const DECADES = 3;                         // the ramp spans 1000:1 in |B|
const PULSE_S = 1.6;                       // a bounce's display period per square root of its path in radii

// Lines shaded along the console's ramp (planner-panel.tsx's porkchop):
// strong sheen, then phosphor amber, key orange, engraving.
const lineVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float strength;
attribute vec3 bounce;      // the bounce coordinate x, the display period (s, 0: none), a phase offset
varying float vS;
varying vec3 vB;
void main() {
  vS = strength;
  vB = bounce;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const lineFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float level;
uniform float opacity;
uniform float time;         // seconds of pulse motion (held while time is held)
uniform float pulse;        // the pulses' strength: 0 with reduced motion
varying float vS;
varying vec3 vB;
vec3 ramp(float s) {
  vec3 c0 = vec3(0.604, 0.196, 0.086), c1 = vec3(0.851, 0.325, 0.122), c2 = vec3(1.0, 0.698, 0.180), c3 = vec3(0.961, 0.941, 0.894);
  float f = clamp(s, 0.0, 1.0) * 3.0;
  return f < 1.0 ? mix(c0, c1, f) : f < 2.0 ? mix(c1, c2, f - 1.0) : mix(c2, c3, f - 2.0);
}
void main() {
  #include <logdepthbuf_fragment>
  float a = opacity * (0.22 + 0.6 * clamp(vS, 0.0, 1.0));
  // The particle's place on the line: there and back between the mirror
  // points (x = 0 and 1) once a period.
  float glow = 0.0;
  if (vB.y > 0.0 && pulse > 0.0) {
    float x = 1.0 - abs(1.0 - 2.0 * fract(time / vB.y + vB.z));
    float d = (vB.x - x) / 0.035;
    glow = pulse * exp(-d * d);
  }
  vec3 c = mix(ramp(vS), ramp(1.0), 0.6 * glow);
  a *= 1.0 + 1.8 * glow;
  gl_FragColor = vec4(c * a * level, a);
}
`;

// Auroral emission: a colour per vertex, faded on the day side for Earth.
// The Sun's current sheet and spiral lines: a colour per vertex, scaled
// by the display level like the field lines.
const tintVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 tint;
varying vec3 vT;
void main() {
  vT = tint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const tintFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float level;
uniform float opacity;
varying vec3 vT;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(vT * opacity * level, opacity);
}
`;

const auroraVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 emission;
uniform vec3 sunDir;        // body-fixed
uniform float dayFade;      // 1: fade where the Sun is up
varying vec3 vE;
void main() {
  float sunUp = dot(normalize(position), sunDir);
  vE = emission * mix(1.0, smoothstep(0.12, -0.18, sunUp), dayFade);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const auroraFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float level;
varying vec3 vE;
void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vec4(vE * level, 1.0);
}
`;

// Radiation belts: shells along L-shells, glowing where seen edge-on, so
// they read as a volume (a weight per vertex for the band's profile and
// the fall-off away from the magnetic equator).
const beltVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float weight;
varying float vW;
varying vec3 vN;
varying vec3 vV;
void main() {
  vW = weight;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;
const beltFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 colour;
uniform float level;
uniform float fade;         // 0 as the camera comes inside this shell
varying float vW;
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <logdepthbuf_fragment>
  float edge = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = fade * vW * (0.05 + 0.3 * edge * edge);
  if (a < 0.004) discard;   // no blending for what cannot be seen
  gl_FragColor = vec4(colour * a * level, a);
}
`;
const BELT_COLOUR = new THREE.Color(0x7fb8c9);
const BELT_SHELLS = 3, BELT_LON = 36, BELT_SAMPLES = 40;
const BELT_LAT = 50;        // shells stop this far (deg) from the magnetic equator, where they have faded

// Mars's crust: the radial field from a byte map (marsCrustal.js's asinh
// scale), blue inward, amber outward, on a shell just above the surface;
// and, with the auroras on, a violet glow on the night side over the
// strongest fields, where Mars's discrete aurora is seen.
const marsVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vP;
void main() {
  vP = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const marsFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;
uniform vec3 sunDir;
uniform float showField;
uniform float showAurora;
uniform float level;
varying vec3 vP;
void main() {
  #include <logdepthbuf_fragment>
  float lat = asin(clamp(vP.z, -1.0, 1.0)), lon = atan(vP.y, vP.x);
  vec2 uv = vec2(fract(lon / (2.0 * PI)), (0.5 * PI - lat) / PI);
  float t = (texture2D(map, uv).r * 255.0 - 128.0) / 127.0;   // -1..1 on the asinh scale
  float a = 0.0;
  vec3 c = vec3(0.0);
  if (showField > 0.5) {
    float m = pow(abs(t), 0.8);
    c = mix(vec3(0.0), t < 0.0 ? vec3(0.184, 0.561, 0.69) : vec3(1.0, 0.698, 0.18), m);
    a = 0.85 * m;
  }
  if (showAurora > 0.5) {
    float night = smoothstep(0.05, -0.15, dot(vP, sunDir));
    float e = night * smoothstep(0.45, 0.8, abs(t));
    c += vec3(0.42, 0.34, 1.0) * e * 0.8;
    a = max(a, e * 0.8);
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * level, a);
}
`;

// Emission colours: 557.7 nm and 630.0 nm as sRGB, and the giants' false colour.
const GREEN = new THREE.Color(0.32, 1.0, 0.45), RED = new THREE.Color(1.0, 0.16, 0.1), UV = new THREE.Color(0.42, 0.34, 1.0);
// Earth's emission layers, km above the surface: green peaks near 110-150
// km, red 630 nm above about 200 km.
const LAYERS = [100, 120, 145, 175, 215, 260, 310];
const GREEN_W = [0.5, 1.0, 0.85, 0.45, 0.12, 0.02, 0];
const RED_W = [0, 0.02, 0.06, 0.18, 0.4, 0.5, 0.35];

interface BodyLines {
  model: Model;
  // The model the lines are traced in: model itself, or for the Earth IGRF
  // with T89 for the Sun direction lineSun; built once its lines are drawn
  // (the last set stays up while the next is traced).
  lineModel: Model; lineSun: V3 | null; built: boolean;
  surface: { eq: number; pol: number };
  seeds: { p: V3; keepOpenOnly: boolean }[];
  next: number;
  pos: number[]; str: number[]; index: number[];
  bnc: number[];              // per point: bounce coordinate, display period, phase
  bRef: number;
  mesh: THREE.LineSegments | null;
  axis: THREE.LineSegments | null;
  range: [number, number];
}

// Past a planet's own field, what each body's lines include.
const EXTERNAL: Partial<Record<BodyKey, string>> = {
  earth: 'T89 bends the lines with the magnetopause, tail and ring currents; they end at the magnetopause of the date’s solar wind (Shue et al. 1998), drawn with the bow shock ahead of it.',
  jupiter: 'Internal field and the current sheet; the magnetopause and bow shock drawn for a quiet solar wind (Rutala et al. 2025).',
  saturn: 'Internal field and the ring current; the magnetopause drawn for a quiet solar wind (Pilkington et al. 2015).',
  ganymede: 'Its own dipole in a uniform field, Jupiter’s at its place.',
};
// The Earth's T89 lines are retraced after it has turned 7.5 deg under the Sun.
const COS_RETRACE = Math.cos((7.5 * Math.PI) / 180);
// Sun-fixed boundaries are redrawn after the body turns a quarter degree.
const COS_BND = Math.cos((0.25 * Math.PI) / 180);

const t2 = (deg: number) => `${deg.toFixed(0)}°`;

const fmtGauss = (nT: number) => {
  const G = nT / 1e5;
  return G >= 1 ? `${G.toPrecision(3)} G` : G >= 0.01 ? `${G.toFixed(3)} G` : `${(nT).toFixed(0)} nT`;
};

export class MagneticLayer {
  readonly on: Record<MagneticKey, boolean> = { magnetic: false, aurora: false, belts: false };
  private belts: Belts | null = null;
  private beltMeshes = new Map<BodyKey, { jobs: (() => void)[]; shells: { mesh: THREE.Mesh; L: number }[] }>();
  private mag: Mag | null = null;
  private aur: Aur | null = null;
  private loading: Promise<void> | null = null;
  private lines = new Map<BodyKey, BodyLines>();
  private earthYear = NaN;
  private lineMat = new THREE.ShaderMaterial({
    vertexShader: lineVertex, fragmentShader: lineFragment, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, uniforms: { level: { value: 1 }, opacity: { value: 1 }, time: { value: 0 }, pulse: { value: 1 } },
  });
  private pulseTime = 0;
  private lastFrame = NaN;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private axisMat = new THREE.ShaderMaterial({
    vertexShader: lineVertex, fragmentShader: lineFragment, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, uniforms: { level: { value: 1 }, opacity: { value: 0.9 } },
  });
  private groups = new Map<BodyKey, THREE.Group>();
  private legend: HTMLDivElement;
  private legendFor: string | null = null;
  private tags: HTMLDivElement[] = [];
  private tagCount = 0;
  private m3 = new THREE.Matrix3();
  private m4 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private sunB = new THREE.Vector3();
  // Mars's crust: the map, loaded the first time it is wanted, and its shell.
  private mars: { asked: boolean; tex: THREE.DataTexture | null; mesh: THREE.Mesh | null; group: THREE.Group } | null = null;
  private w = new THREE.Vector3();
  // Auroras.
  private kpLoaded = false;
  // NOAA's live aurora map, fetched while the auroras are on and the clock
  // is near now, at most every five minutes.
  private ov: typeof import('../physics/ovation.js') | null = null;
  private ovation: Ovation | null = null;
  private ovationAsked = 0;
  private ovationMesh: THREE.Mesh | null = null;
  private ovationBuilt: Ovation | null = null;
  private ovationPeak: V3 = [0, 0, 1];      // the map's brightest point in the north, for its tag
  private cgm: ReturnType<Aur['cgmGrid']> | null = null;
  private earthAurora: THREE.Mesh | null = null;
  private earthKey = '';
  private giant = new Map<BodyKey, { mesh: THREE.Mesh | null; jobs: (() => void)[]; done: boolean }>();
  // The moons' footprint spots: a table of footprints every 5 deg of the moon's longitude, and the mesh.
  private spots = new Map<string, { table: { north: (V3 | null)[]; south: (V3 | null)[] }; next: number; mesh: THREE.Mesh | null; key: number }>();
  private kpNow: { kp: number; source: string } = { kp: 2, source: 'assumed' };

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private baseUrl: string, private sunAxes: (date: Date) => THREE.Matrix3) {
    this.legend = document.createElement('div');
    this.legend.className = 'field-legend mag-legend';
    this.legend.hidden = true;
    overlay.appendChild(this.legend);
    for (const k of BODIES) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      g.visible = false;
      g.renderOrder = 3;
      scene.add(g);
      this.groups.set(k, g);
    }
  }

  set(key: MagneticKey, on: boolean): void {
    this.on[key] = on;
    if (on && !this.loading) {
      this.loading = Promise.all([import('../physics/magnetic.js'), import('../physics/aurora.js'), import('../physics/belts.js'), import('../physics/ovation.js'), import('../physics/ringCurrent.js'), import('../physics/sunField.js'), import('../physics/t89.js'), import('../physics/boundaries.js')])
        .then(([m, a, b, o, r, sf, t, bd]) => { this.mag = m; this.aur = a; this.belts = b; this.ov = o; this.rc = r; this.sf = sf; this.t89 = t; this.bnd = bd; });
    }
    // Kp drives the Earth's ovals and its T89 magnetosphere.
    if ((key === 'aurora' || key === 'magnetic') && on && !this.kpLoaded) {
      this.kpLoaded = true;
      void this.loading!.then(() => fetch(`${this.baseUrl}data/kp.json`)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => this.aur!.installKp(j)).catch((e) => console.warn('kp.json:', e));
    }
  }

  update(f: {
    camera: THREE.PerspectiveCamera; meshes: Map<BodyKey, THREE.Mesh>; materials: Map<BodyKey, THREE.ShaderMaterial>;
    focus: BodyKey | null; width: number; height: number; level: number; date: Date; running: boolean;
  }): void {
    this.tagCount = 0;
    const any = this.on.magnetic || this.on.aurora || this.on.belts;
    if (!any || !this.mag || !this.aur || !this.belts || !this.ov || !this.rc || !this.sf || !this.t89 || !this.bnd) {
      for (const g of this.groups.values()) g.visible = false;
      if (this.sun) this.sun.group.visible = false;
      if (this.mars) this.mars.group.visible = false;
      this.legend.hidden = true; this.legendFor = null;
      this.hideTags();
      return;
    }
    const mag = this.mag, aur = this.aur;
    const pxPerRad = f.height / (2 * Math.tan((f.camera.fov * Math.PI) / 360));
    const sunPos = f.meshes.get('sun')?.position;
    const order = [...BODIES].sort((a, b) => (a === f.focus ? -1 : b === f.focus ? 1 : 0));
    const t0 = performance.now();
    const spare = () => BUDGET_MS - (performance.now() - t0);

    // The Earth's field follows IGRF's secular change: retrace a year on.
    const year = Math.floor(mag.decimalYear(f.date));
    if (year !== this.earthYear) { this.drop('earth'); this.earthYear = year; this.cgm = null; this.earthKey = ''; }

    for (const k of order) {
      const g = this.groups.get(k)!, mesh = f.meshes.get(k), mat = f.materials.get(k);
      if (!mesh || !mat) { g.visible = false; continue; }
      const body = BODY_BY_KEY[k];
      const d = mesh.position.length(), px = (body.radiusKm / UNIT_KM / d) * pxPerRad;
      g.visible = px > 1.5;
      if (!g.visible) continue;
      // Ganymede's lines in Jupiter's field at its place: retraced when that
      // field has changed by 8 %.
      if (k === 'ganymede') {
        const amb = this.jupiterFieldAt(mesh, f.meshes, f.materials, mat);
        const cur = this.lines.get(k)?.model.ambient as number[] | undefined;
        if (amb && (!cur || Math.hypot(amb[0] - cur[0], amb[1] - cur[1], amb[2] - cur[2]) > 0.08 * Math.hypot(cur[0], cur[1], cur[2]))) {
          this.drop(k);
          this.ambient = amb;
        }
      }
      // Saturn's ring current is tabulated first (a third of a second, a few
      // milliseconds a frame); its lines are traced through it.
      if (k === 'saturn' && !this.lines.has(k)) {
        this.rcTable ??= this.rc!.ringCurrentTable();
        if (!this.rcTable.done && !this.rcTable.step(Math.max(0.5, spare()))) continue;
      }
      let L = this.lines.get(k);
      if (!L) L = this.start(k, f.date);
      // Body-fixed (units of the model's a) to render: the surface
      // material's toBody transposed, scaled, at the body's centre.
      const e = this.m3.copy(mat.uniforms.toBody.value as THREE.Matrix3).transpose().elements, s = L.model.a / UNIT_KM;
      this.m4.set(e[0] * s, e[3] * s, e[6] * s, mesh.position.x, e[1] * s, e[4] * s, e[7] * s, mesh.position.y, e[2] * s, e[5] * s, e[8] * s, mesh.position.z, 0, 0, 0, 1);
      g.matrix.copy(this.m4); g.matrixWorldNeedsUpdate = true;

      // The Sun in the body's frame.
      const sunB = sunPos ? this.sunB.copy(sunPos).sub(mesh.position).applyMatrix3(mat.uniforms.toBody.value as THREE.Matrix3).normalize() : this.sunB.set(1, 0, 0);

      // The Earth's lines in Tsyganenko's T89 for the day's Kp, which is
      // fixed to the Sun: a new set is traced once the Earth has turned
      // 7.5 degrees under it (half an hour) or Kp has changed level, and
      // the last set stays up meanwhile.
      // The lines end at the magnetopause (Shue et al. 1998 for the
      // solar wind of the date), retraced when it moves by 2 %.
      if (k === 'earth' && this.on.magnetic) {
        const kp = aur.kpAt(f.date.getTime()).kp, u = L.lineSun, mp = this.earthWind(f.date).mp;
        const turned = !u || u[0] * sunB.x + u[1] * sunB.y + u[2] * sunB.z < COS_RETRACE;
        const moved = !L.lineModel.mp || Math.abs(mp.r0 / L.lineModel.mp.r0 - 1) > 0.02 || Math.abs(mp.alpha - L.lineModel.mp.alpha) > 0.01;
        if ((turned || moved || this.t89.kpToIopt(kp) !== L.lineModel.iopt) && (L.built || L.lineModel === L.model)) {
          L.lineSun = [sunB.x, sunB.y, sunB.z];
          const T = this.t89.withT89(L.model, L.lineSun, kp);
          L.lineModel = { ...T, mp, within: this.bnd.insideBoundary(T.gsm, mp.r) };
          L.next = 0; L.pos = []; L.str = []; L.index = []; L.bnc = []; L.built = false;
        }
      }
      if (k === 'earth' || k === 'jupiter' || k === 'saturn') this.boundary(k, L, g, sunB, sunPos ? (mesh.position.distanceTo(sunPos) * UNIT_KM) / 149597870.7 : 1, (mesh.position.length() * UNIT_KM) / L.model.a, f);

      // Field lines, traced a few at a time.
      if (this.on.magnetic) {
        while (L.next < L.seeds.length && spare() > 0) this.traceOne(L);
        if (L.next >= L.seeds.length && !L.built) this.buildLines(k, L, g);
      }
      if (L.mesh) L.mesh.visible = this.on.magnetic;
      if (L.axis) L.axis.visible = this.on.magnetic;
      if (this.on.aurora) {
        if (k === 'earth') this.earthOval(L, g, sunB, f.date, spare);
        else if (k !== 'mercury') this.giantOval(k, L, g, spare, f.meshes, mat);
      }
      if (this.on.belts && k in this.belts!.BELTS) this.beltShells(k, L, g, spare);
      const bm = this.beltMeshes.get(k);
      if (bm?.shells.length) {
        const camL = this.on.belts ? this.cameraL(L, mesh, mat) : 0;
        for (const sh of bm.shells) {
          // Fades out as the camera's L comes down to the shell's.
          const t = Math.min(Math.max((camL / sh.L - 0.9) / 0.3, 0), 1), f = t * t * (3 - 2 * t);
          sh.mesh.visible = this.on.belts && f > 0;
          (sh.mesh.material as THREE.ShaderMaterial).uniforms.fade.value = f;
        }
      }
      if (k === 'earth' && !this.on.aurora) { if (this.earthAurora) this.earthAurora.visible = false; if (this.ovationMesh) this.ovationMesh.visible = false; }
      const gi = this.giant.get(k);
      if (gi?.mesh) gi.mesh.visible = this.on.aurora;
      for (const [m, sp] of this.spots) if (sp.mesh && this.aur!.FOOTPRINT_MOONS[m as keyof typeof this.aur.FOOTPRINT_MOONS].planet === k) sp.mesh.visible = this.on.aurora;

      // A tag at the dipole's end for the focused body.
      if (k === f.focus && px > 10 && this.on.magnetic) this.poleTag(k, L, g, f.camera, f.width, f.height);
      if (k === f.focus && this.on.magnetic) this.boundaryTags(k, g, f.camera, f.width, f.height);
      if (k === f.focus && px > 10 && this.on.aurora && k === 'earth' && (this.earthAurora || this.ovationMesh)) this.kpTag(g, sunB, L, f.camera, f.width, f.height);
    }
    this.lineMat.uniforms.level.value = f.level;
    this.axisMat.uniforms.level.value = f.level;
    // The pulses run on the wall clock while the sim clock runs.
    const now = performance.now() / 1000, dt = Number.isFinite(this.lastFrame) ? Math.min(now - this.lastFrame, 0.1) : 0;
    this.lastFrame = now;
    if (f.running && !this.reduced.matches) this.pulseTime += dt;
    this.lineMat.uniforms.time.value = this.pulseTime;
    this.lineMat.uniforms.pulse.value = this.reduced.matches ? 0 : 1;
    for (const b of this.bnds.values()) (b.mesh.material as THREE.ShaderMaterial).uniforms.level.value = f.level;
    this.sun?.hcs?.children.forEach((o) => { ((o as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.level.value = f.level; });
    // Auroras give their own light: the display level may dim them near the
    // Sun but never brightens them past their emission far from it.
    const glow = Math.min(f.level, 1);
    for (const k of ['earth', 'jupiter', 'saturn', 'uranus', 'neptune'] as BodyKey[]) {
      const m = k === 'earth' ? this.earthAurora : this.giant.get(k)?.mesh;
      if (m) (m.material as THREE.ShaderMaterial).uniforms.level.value = glow;
    }
    for (const sp of this.spots.values()) if (sp.mesh) (sp.mesh.material as THREE.ShaderMaterial).uniforms.level.value = glow;
    if (this.ovationMesh) (this.ovationMesh.material as THREE.ShaderMaterial).uniforms.level.value = glow;
    for (const b of this.beltMeshes.values()) for (const sh of b.shells) (sh.mesh.material as THREE.ShaderMaterial).uniforms.level.value = f.level;

    this.marsCrust(f);
    this.sunLines(f, spare);

    // The legend: the focused body's, else none.
    if (f.focus === 'sun' && this.on.magnetic && this.sun?.mesh) {
      const key = `sun ${this.sun.cr} ${this.sun.tilt ? 'hcs' : ''}`;
      if (this.legendFor !== key) { this.legendFor = key; this.legend.hidden = false; this.drawSunLegend(); }
      this.hideTags();
      return;
    }
    if (f.focus === 'mars' && this.on.magnetic && this.mars?.mesh) {
      if (this.legendFor !== 'mars') { this.legendFor = 'mars'; this.legend.hidden = false; this.drawMarsLegend(); }
      this.hideTags();
      return;
    }
    const lk = f.focus && this.lines.has(f.focus) && this.on.magnetic ? f.focus : null;
    const key = lk ? `${lk} ${this.lines.get(lk)!.mesh ? 'done' : 'tracing'} ${this.lines.get(lk)!.lineModel.source}` : null;
    if (key !== this.legendFor) {
      this.legendFor = key;
      this.legend.hidden = !lk;
      if (lk) this.drawLegend(lk, this.lines.get(lk)!);
    }
    this.hideTags();
  }

  // ---- field lines ----

  private ambient: V3 | null = null;
  private rc: RC | null = null;
  private sf: SunMod | null = null;
  private t89: T89 | null = null;
  private bnd: Bnd | null = null;

  // ---- magnetopauses and bow shocks ----
  //
  // The Earth's from the solar wind NOAA propagated to it (the last week),
  // else a quiet wind; Jupiter's and Saturn's from a quiet wind thinned as
  // 1/r^2. Drawn as rings round the Sun line and meridians, sun-fixed, so
  // their points are recomputed in the turning body's frame as it turns.
  private windRows: ReturnType<Bnd['parsePropagated']> | null = null;
  private windAsked = 0;
  private windLive: { at: number; w: ReturnType<Bnd['windNear']> } = { at: NaN, w: null };
  private bnds = new Map<BodyKey, { mesh: THREE.LineSegments; key: string; sun: V3; noseMp: V3; noseBs: V3 | null; r0: number; bs: number | null; text: string }>();
  private bndMat = new THREE.ShaderMaterial({
    vertexShader: lineVertex, fragmentShader: lineFragment, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, uniforms: { level: { value: 1 }, opacity: { value: 0.45 } },
  });

  private earthWind(date: Date): { wind: { dp: number; bz: number; v: number; mach: number }; mp: ReturnType<Bnd['shue98']>; live: boolean; n: number; when: string } {
    const B = this.bnd!, ms = date.getTime(), now = Date.now();
    // NOAA's file covers the last 7 days; ask for it when the clock is in
    // them, again every 10 minutes while it is.
    if (ms > now - 7 * 864e5 && ms < now + 2 * 3600e3 && now - this.windAsked > 10 * 60e3) {
      this.windAsked = now;
      void fetch(B.PROPAGATED_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => { this.windRows = B.parsePropagated(j); this.windLive.at = NaN; }).catch((e) => console.warn('solar wind:', e));
    }
    if (!(Math.abs(this.windLive.at - ms) < 60e3)) this.windLive = { at: ms, w: B.windNear(this.windRows, ms) };
    const w = this.windLive.w, wind = B.solarWind(w ?? B.QUIET_WIND);
    // Kept to the ranges Shue et al. fitted.
    const mp = B.shue98(Math.min(Math.max(wind.dp, 0.5), 8.5), Math.min(Math.max(wind.bz, -18), 15));
    return { wind, mp, live: !!w, n: w?.n ?? B.QUIET_WIND.n, when: w ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '' };
  }

  private boundary(k: BodyKey, L: BodyLines, g: THREE.Group, sunB: THREE.Vector3, au: number, camR: number, f: { date: Date }): void {
    const B = this.bnd!, old = this.bnds.get(k);
    if (!this.on.magnetic) { if (old) old.mesh.visible = false; return; }
    const sun: V3 = [sunB.x, sunB.y, sunB.z];
    type R = (c: number, phi: number) => number;
    let F: { X: number[]; Y: number[]; Z: number[] }, mp: R, bs: R | null = null, r0: number, rbs: number | null = null, flatten = 0, xMp: number, xBs = 0, key: string, text: string;
    if (k === 'earth') {
      const e = this.earthWind(f.date), m = L.model.dipole.m as number[];
      F = this.t89!.gsmFrame([-m[0], -m[1], -m[2]], sun);
      const shock = B.bowShock(e.mp.r0, e.wind.mach);
      mp = e.mp.r; bs = shock.r; r0 = e.mp.r0; rbs = shock.nose; xMp = -30; xBs = -25;
      key = `${r0.toFixed(2)} ${e.mp.alpha.toFixed(3)} ${shock.nose.toFixed(2)}`;
      text = `${e.live ? `NOAA's solar wind at the Earth, ${e.when} UTC` : 'a quiet solar wind (no measurement for the date)'}: ${e.n.toFixed(1)} cm⁻³ at ${e.wind.v.toFixed(0)} km/s, ${e.wind.dp.toFixed(2)} nPa, Bz ${e.wind.bz.toFixed(1)} nT, Mach ${e.wind.mach.toFixed(1)}`;
    } else {
      const wind = B.solarWind(B.windAt(B.QUIET_WIND, au));
      F = B.sunFrame(sun);
      if (k === 'jupiter') {
        const m = B.rutala(B.RUTALA.magnetopause, wind.dp), s = B.rutala(B.RUTALA.bowShock, wind.dp);
        mp = m.r; bs = s.r; r0 = m.r0; rbs = s.r0; xMp = -90; xBs = -120;
      } else {
        const m = B.pilkington(wind.dp);
        mp = m.r; r0 = m.r0; flatten = m.flatten; xMp = -50;
      }
      key = `${r0.toFixed(2)}`;
      text = `a quiet solar wind thinned to ${au.toFixed(2)} AU: ${wind.dp.toFixed(3)} nPa`;
    }
    // Faded out as the camera comes inside the magnetopause's nose.
    const t = Math.min(Math.max((camR / r0 - 0.8) / 0.7, 0), 1), fade = t * t * (3 - 2 * t);
    if (old) (old.mesh.material as THREE.ShaderMaterial).uniforms.opacity.value = 0.45 * fade;
    const turned = !old || old.sun[0] * sun[0] + old.sun[1] * sun[1] + old.sun[2] * sun[2] < COS_BND;
    if (old && !turned && old.key === key) { old.mesh.visible = fade > 0; return; }
    const pos: number[] = [], str: number[] = [], idx: number[] = [];
    const add = (rows: (number[] | null)[][], s: number, closed: boolean) => {
      for (const row of rows) {
        let prev = -1;
        for (let j = 0; j < row.length; j++) {
          const q = row[j];
          if (!q) { prev = -1; continue; }
          const i = pos.length / 3; pos.push(q[0], q[1], q[2]); str.push(s);
          if (prev >= 0) idx.push(prev, i);
          prev = i;
        }
        void closed;
      }
    };
    const sweep = (r: R, x: number, s: number) => {
      // Rings 30 deg apart round the Sun line, meridians every 45 deg.
      const rings = B.boundaryMesh(F, r, { thetas: [10, 30, 60, 90, 120, 150], nPhi: 72, xMin: x, flatten });
      const ths: number[] = []; for (let t = 0; t <= 172; t += 2) ths.push(t);
      const mer = B.boundaryMesh(F, r, { thetas: ths, nPhi: 8, xMin: x, flatten });
      add(rings, s, true);
      // Transpose: one polyline per meridian.
      add(Array.from({ length: 8 }, (_, j) => mer.map((row) => row[j])), s, false);
    };
    sweep(mp, xMp, 0.55);
    if (bs) sweep(bs, xBs, 0.2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('strength', new THREE.Float32BufferAttribute(str, 1));
    geo.setIndex(idx);
    const nose = (r: number): V3 => [F.X[0] * r, F.X[1] * r, F.X[2] * r];
    // The bow shock's tag on its dawn flank, 60 deg from the Sun line.
    const flank = (r: R | null): V3 | null => {
      if (!r) return null;
      const R0 = r(0.5, Math.PI / 2), gx = R0 * 0.5, gy = -R0 * Math.sin(Math.PI / 3);
      return [F.X[0] * gx + F.Y[0] * gy, F.X[1] * gx + F.Y[1] * gy, F.X[2] * gx + F.Y[2] * gy];
    };
    if (old) { old.mesh.geometry.dispose(); old.mesh.geometry = geo; old.mesh.visible = fade > 0; Object.assign(old, { key, sun, noseMp: nose(r0), noseBs: flank(bs), r0, bs: rbs, text }); return; }
    const mat = this.bndMat.clone();
    mat.uniforms.opacity.value = 0.45 * fade;
    const m = new THREE.LineSegments(geo, mat);
    m.frustumCulled = false; m.renderOrder = 3;
    g.add(m);
    this.bnds.set(k, { mesh: m, key, sun, noseMp: nose(r0), noseBs: flank(bs), r0, bs: rbs, text });
  }

  private boundaryTags(k: BodyKey, g: THREE.Group, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const b = this.bnds.get(k);
    if (!b?.mesh.visible) return;
    const unit = k === 'earth' ? 'R⊕' : k === 'jupiter' ? 'R♃' : 'R♄', name = BODY_BY_KEY[k].name;
    const src = k === 'earth' ? 'Shue et al. 1998' : k === 'jupiter' ? 'Rutala et al. 2025' : 'Pilkington et al. 2015';
    const s = this.screen(this.v.set(...b.noseMp).applyMatrix4(g.matrix), camera, width, height);
    if (s) this.tag(s, `MP ${b.r0.toFixed(1)} ${unit}`, 'guide-tag mag-pole', `${name}'s magnetopause (${src}), ${b.r0.toFixed(1)} ${unit} toward the Sun, for ${b.text}. Field lines past it are cut there`);
    if (b.noseBs && b.bs) {
      const s2 = this.screen(this.v.set(...b.noseBs).applyMatrix4(g.matrix), camera, width, height);
      const bsrc = k === 'earth' ? "its standoff from Farris and Russell 1994, its shape a hyperboloid flaring to the Mach cone" : 'Rutala et al. 2025';
      if (s2) this.tag(s2, `BS ${b.bs.toFixed(1)} ${unit}`, 'guide-tag mag-pole', `${name}'s bow shock (${bsrc}), ${b.bs.toFixed(1)} ${unit} toward the Sun at its nose (tagged on its dawn flank), where the solar wind slows to below its magnetosonic speed`);
    }
  }
  // The Sun's field lines: WSO's coefficients (loaded once), the rotation
  // they are for, the seeds still to trace and the lines' mesh.
  private sun: { data: { first: number; rows: (number[] | null)[] } | null; asked: boolean; cr: number; jobs: (() => void)[]; pos: number[]; str: number[]; idx: number[];
    bRef: number; mesh: THREE.LineSegments | null; group: THREE.Group; axesAt: number; m: THREE.Matrix3;
    hcs: THREE.Group | null; tilt: { north: number; south: number } | null } | null = null;
  private rcTable: ReturnType<RC['ringCurrentTable']> | null = null;
  // Jupiter's field (JRM33 + con2020) at a moon's place, in the moon's frame (nT).
  private jupiterFieldAt(moon: THREE.Mesh, meshes: Map<BodyKey, THREE.Mesh>, mats: Map<BodyKey, THREE.ShaderMaterial>, moonMat: THREE.ShaderMaterial): V3 | null {
    const jm = meshes.get('jupiter'), jmat = mats.get('jupiter');
    if (!jm || !jmat || !this.mag) return null;
    const J = this.mag.magneticModel('jupiter')!, toJ = jmat.uniforms.toBody.value as THREE.Matrix3;
    const p = this.w.copy(moon.position).sub(jm.position).applyMatrix3(toJ).multiplyScalar(UNIT_KM / J.a);
    const b = J.field(p.x, p.y, p.z, [0, 0, 0]);
    const v = this.w.set(b[0], b[1], b[2]).applyMatrix3(this.m3.copy(toJ).transpose()).applyMatrix3(moonMat.uniforms.toBody.value as THREE.Matrix3);
    return [v.x, v.y, v.z];
  }

  private start(k: BodyKey, date: Date): BodyLines {
    const mag = this.mag!;
    let model = mag.magneticModel(k, date)!;
    if (k === 'ganymede' && this.ambient) model = mag.withAmbient(model, this.ambient);
    if (k === 'saturn' && this.rcTable?.done) model = mag.withField(model, this.rcTable.field, 'with the Connerney et al. 1983 ring current');
    const [ra, , rc] = BODY_BY_KEY[k].radiiKm;
    const surface = { eq: ra / model.a, pol: rc / model.a };
    const lats = SEEDS[k];
    const seeds = mag.seedPoints(model, surface, lats, N_LON).map((s) => ({ p: s.p as V3, keepOpenOnly: false }));
    // The other hemisphere's highest latitudes, for the open lines only.
    for (const s of mag.seedPoints(model, surface, lats.slice(-2).map((l) => -l), N_LON)) seeds.push({ p: s.p as V3, keepOpenOnly: true });
    // The field's top at the surface, for the shading's scale.
    const b: V3 = [0, 0, 0];
    let bRef = 0;
    for (const s of seeds) bRef = Math.max(bRef, Math.hypot(...model.field(s.p[0], s.p[1], s.p[2], b)));
    const L: BodyLines = { model, lineModel: model, lineSun: null, built: false, surface, seeds, next: 0, pos: [], str: [], index: [], bnc: [], bRef, mesh: null, axis: null, range: [Infinity, 0] };
    this.lines.set(k, L);
    return L;
  }

  private traceOne(L: BodyLines): void {
    const s = L.seeds[L.next++];
    const t = this.mag!.traceLine(L.lineModel, s.p, L.surface);
    if (s.keepOpenOnly && t.closed) return;
    if (t.strength.length < 3) return;
    const base = L.pos.length / 3, n = t.strength.length;
    // A trapped particle's bounce on a closed line: its period on screen
    // grows as the square root of the real one's path (in units of the
    // model's radius a, as the points are).
    const b = this.mag!.bounceTrack(t);
    const period = b ? PULSE_S * Math.sqrt(b.total) : 0;
    const phase = (L.next * 0.618034) % 1;
    for (let i = 0; i < n; i++) {
      L.bnc.push(b ? b.x[i] : 0, period, phase);
      L.pos.push(t.points[3 * i], t.points[3 * i + 1], t.points[3 * i + 2]);
      const B = t.strength[i];
      L.str.push(Math.log10(B / L.bRef) / DECADES + 1);
      if (Math.hypot(t.points[3 * i], t.points[3 * i + 1], t.points[3 * i + 2]) < 1.02) { L.range[0] = Math.min(L.range[0], B); L.range[1] = Math.max(L.range[1], B); }
      if (i) L.index.push(base + i - 1, base + i);
    }
  }

  private buildLines(k: BodyKey, L: BodyLines, g: THREE.Group): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(L.pos, 3));
    geo.setAttribute('strength', new THREE.Float32BufferAttribute(L.str, 1));
    geo.setAttribute('bounce', new THREE.Float32BufferAttribute(L.bnc, 3));
    geo.setIndex(L.index);
    L.built = true;
    L.pos = []; L.str = []; L.index = []; L.bnc = [];
    if (L.mesh) { L.mesh.geometry.dispose(); L.mesh.geometry = geo; return; }
    L.mesh = new THREE.LineSegments(geo, this.lineMat);
    L.mesh.frustumCulled = false;
    L.mesh.renderOrder = 3;
    g.add(L.mesh);
    // The dipole axis through its centre, 1.6 a each way.
    const centre = L.model.dipole.centre as number[], m = L.model.dipole.m as number[], M = Math.hypot(...m), u = m.map((x: number) => x / M);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute([...centre.map((c: number, i: number) => c - 1.6 * u[i]), ...centre, ...centre, ...centre.map((c: number, i: number) => c + 1.6 * u[i])], 3));
    ag.setAttribute('strength', new THREE.Float32BufferAttribute([0.35, 0.35, 0.95, 0.95], 1));
    L.axis = new THREE.LineSegments(ag, this.axisMat);
    L.axis.frustumCulled = false;
    L.axis.renderOrder = 3;
    g.add(L.axis);
    void k;
  }

  private drop(k: BodyKey): void {
    const L = this.lines.get(k);
    if (!L) return;
    for (const o of [L.mesh, L.axis]) if (o) { o.parent?.remove(o); o.geometry.dispose(); }
    this.lines.delete(k);
    const bm = this.beltMeshes.get(k);
    if (bm) { for (const sh of bm.shells) { sh.mesh.parent?.remove(sh.mesh); sh.mesh.geometry.dispose(); (sh.mesh.material as THREE.Material).dispose(); } this.beltMeshes.delete(k); }
    if (k === 'earth' && this.earthAurora) { this.earthAurora.parent?.remove(this.earthAurora); this.earthAurora.geometry.dispose(); (this.earthAurora.material as THREE.Material).dispose(); this.earthAurora = null; }
  }

  // ---- the Earth's auroral ovals ----

  // Fetch NOAA's latest map when the clock is within three hours of now.
  private askOvation(date: Date): void {
    const now = Date.now();
    if (!this.ov || Math.abs(date.getTime() - now) > 3 * 3600e3 || now - this.ovationAsked < 5 * 60e3) return;
    this.ovationAsked = now;
    void fetch(this.ov.OVATION_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => { this.ovation = this.ov!.parseOvation(j); }).catch((e) => console.warn('OVATION:', e));
  }

  // NOAA's map as stacked sheets 100-300 km up, in geographic coordinates
  // (the Earth's frame), built once per map: green low, red higher, by the
  // map's probability of visible aurora.
  private ovationSheets(L: BodyLines, g: THREE.Group, o: Ovation): void {
    if (this.ovationBuilt === o && this.ovationMesh) return;
    this.ovationBuilt = o;
    const pos: number[] = [], em: number[] = [], idx: number[] = [];
    const layers = [105, 130, 175, 250], gw = [0.6, 1, 0.5, 0.05], rw = [0, 0.03, 0.2, 0.5];
    const D = Math.PI / 180, a = L.model.a, dLon = 2;
    let best = -1;
    for (let lat = 50; lat <= 85; lat++) for (let lon = 0; lon < 360; lon += 2) {
      const v = this.ov!.ovationAt(o, lat, lon);
      if (v > best) { best = v; const c = Math.cos(lat * D), r = 1 + 300 / a; this.ovationPeak = [r * c * Math.cos(lon * D), r * c * Math.sin(lon * D), r * Math.sin(lat * D)]; }
    }
    for (const h of [1, -1]) {
      for (let li = 0; li < layers.length; li++) {
        const r = 1 + layers[li] / a, base = pos.length / 3, rows = 46, cols = 360 / dLon;
        for (let i = 0; i < rows; i++) {
          const lat = h * (44 + i);
          for (let j = 0; j <= cols; j++) {
            const lon = j * dLon, cl = Math.cos(lat * D);
            pos.push(r * cl * Math.cos(lon * D), r * cl * Math.sin(lon * D), r * Math.sin(lat * D));
            const e = Math.min(1, this.ov!.ovationAt(o, lat, lon) / 40) ** 0.8;
            const gg = gw[li] * e * 0.55, rr = rw[li] * e * 0.45;
            em.push(GREEN.r * gg + RED.r * rr, GREEN.g * gg + RED.g * rr, GREEN.b * gg + RED.b * rr);
          }
        }
        for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols; j++) {
          const i0 = base + i * (cols + 1) + j, i1 = i0 + cols + 1;
          if (em[3 * i0 + 1] + em[3 * (i0 + 1) + 1] + em[3 * i1 + 1] + em[3 * (i1 + 1) + 1] + em[3 * i0] + em[3 * i1] < 0.02) continue;
          idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
        }
      }
    }
    if (!this.ovationMesh) {
      this.ovationMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
        vertexShader: auroraVertex, fragmentShader: auroraFragment, transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { level: { value: 1 }, sunDir: { value: new THREE.Vector3() }, dayFade: { value: 1 } },
      }));
      this.ovationMesh.frustumCulled = false;
      this.ovationMesh.renderOrder = 4;
      g.add(this.ovationMesh);
    }
    const geo = this.ovationMesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('emission', new THREE.Float32BufferAttribute(em, 3));
    geo.setIndex(idx);
  }

  private earthOval(L: BodyLines, g: THREE.Group, sunB: THREE.Vector3, date: Date, spare: () => number): void {
    const aur = this.aur!;
    this.askOvation(date);
    const live = this.ov!.ovationCovers(this.ovation, date.getTime());
    if (live) this.ovationSheets(L, g, this.ovation!);
    if (this.ovationMesh) {
      this.ovationMesh.visible = live && this.on.aurora;
      ((this.ovationMesh.material as THREE.ShaderMaterial).uniforms.sunDir.value as THREE.Vector3).copy(sunB);
    }
    if (this.earthAurora) this.earthAurora.visible = !live && this.on.aurora;
    if (live) return;
    // The CGM grid places Starkov's oval (the live map is already geographic).
    if (!this.cgm) this.cgm = aur.cgmGrid(L.model);
    if (!this.cgm.done) { this.cgm.step(Math.max(0.5, spare())); if (!this.cgm.done) return; }
    const kp = aur.kpAt(date.getTime());
    this.kpNow = kp;
    const sunLon = aur.dipoleLongitude(this.cgm.frame, [sunB.x, sunB.y, sunB.z]);
    // Rebuild when the Sun has moved half a degree in magnetic longitude or Kp changed.
    const key = `${Math.round(sunLon * 2)} ${kp.kp.toFixed(2)}`;
    if (!this.earthAurora) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: auroraVertex, fragmentShader: auroraFragment, transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { level: { value: 1 }, sunDir: { value: new THREE.Vector3() }, dayFade: { value: 1 } },
      });
      this.earthAurora = new THREE.Mesh(new THREE.BufferGeometry(), mat);
      this.earthAurora.frustumCulled = false;
      this.earthAurora.renderOrder = 4;
      g.add(this.earthAurora);
    }
    ((this.earthAurora.material as THREE.ShaderMaterial).uniforms.sunDir.value as THREE.Vector3).copy(sunB);
    if (key === this.earthKey) return;
    this.earthKey = key;
    const cols = 90, rows = 7;               // around the oval; across it, diffuse edge to poleward edge
    const pos: number[] = [], em: number[] = [], idx: number[] = [];
    const a = L.model.a;
    const bright = 0.35 + 0.65 * Math.min(kp.kp, 7) / 7;
    const co = { poleward: aur.starkovCoefficients('poleward', kp.kp), equatorward: aur.starkovCoefficients('equatorward', kp.kp), diffuse: aur.starkovCoefficients('diffuse', kp.kp) };
    for (const h of [1, -1] as const) {
      for (let li = 0; li < LAYERS.length; li++) {
        const r = 1 + LAYERS[li] / a, base = pos.length / 3;
        for (let c = 0; c <= cols; c++) {
          const lon = (360 * c) / cols, t = aur.mlt(lon, sunLon);
          const latP = aur.ovalLatitude('poleward', kp.kp, t, co.poleward), latE = aur.ovalLatitude('equatorward', kp.kp, t, co.equatorward), latD = aur.ovalLatitude('diffuse', kp.kp, t, co.diffuse);
          // Brightest before midnight, where substorms break up.
          const night = 0.4 + 0.6 * (1 + Math.cos(((t - 23) * 15 * Math.PI) / 180)) / 2;
          for (let rr = 0; rr < rows; rr++) {
            // rows 0-1 the diffuse aurora, 2-6 the oval.
            let lat, w;
            if (rr < 2) { lat = latD + ((latE - latD) * rr) / 2; w = 0.12 * rr; } else { const q = (rr - 2) / (rows - 3); lat = latE + (latP - latE) * q; w = Math.sin(Math.PI * (0.15 + 0.7 * q)) ** 0.8; }
            const p = this.cgm!.at(h, lat, lon);
            pos.push(p[0] * r, p[1] * r, p[2] * r);
            const e = bright * night * w;
            const gw = GREEN_W[li] * e * 0.55, rw = RED_W[li] * e * 0.45;
            em.push(GREEN.r * gw + RED.r * rw, GREEN.g * gw + RED.g * rw, GREEN.b * gw + RED.b * rw);
          }
        }
        for (let c = 0; c < cols; c++) for (let rr = 0; rr < rows - 1; rr++) {
          const i0 = base + c * rows + rr, i1 = i0 + rows;
          idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
        }
      }
    }
    const geo = this.earthAurora.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('emission', new THREE.Float32BufferAttribute(em, 3));
    geo.setIndex(idx);
  }

  // ---- Jupiter's and Saturn's main ovals, and Io's footprint ----

  private giantOval(k: BodyKey, L: BodyLines, g: THREE.Group, spare: () => number, meshes: Map<BodyKey, THREE.Mesh>, mat: THREE.ShaderMaterial): void {
    const aur = this.aur!;
    let gi = this.giant.get(k);
    const dLon = 5;
    if (!gi) {
      // The band's two edges, as footprints worked out a longitude at a time.
      const edges: { north: (V3 | null)[]; south: (V3 | null)[] }[] = [{ north: [], south: [] }, { north: [], south: [] }];
      const jobs: (() => void)[] = [];
      if (k === 'ganymede') {
        // Rings at the ovals' edges, both hemispheres, on Ganymede's sphere.
        aur.GANYMEDE_OVAL.lat.forEach((lat, j) => jobs.push(() => {
          for (let lon = 0; lon < 360; lon += dLon) {
            const c = Math.cos(lat * DEG_R), sn = Math.sin(lat * DEG_R), x = c * Math.cos(lon * DEG_R), y = c * Math.sin(lon * DEG_R);
            edges[j].north.push([x, y, sn]); edges[j].south.push([x, y, -sn]);
          }
        }));
      } else if (k !== 'saturn') {
        // Jupiter's main emission from 20-30 R_J; the ice giants' zones from L 3-20.
        const fr = aur.magneticEquatorFrame(L.model);
        (k === 'jupiter' ? aur.JUPITER_MAIN.r : aur.ICE_GIANT_AURORA.L).forEach((r, j) => {
          for (let lon = 0; lon < 360; lon += dLon) jobs.push(() => {
            const one = aur.equatorFootprints(L.model, r, 360, L.surface, { ...fr, e1: rot(fr, lon, 0), e2: rot(fr, lon, 90) });
            edges[j].north.push(one.north[0] as V3 | null); edges[j].south.push(one.south[0] as V3 | null);
          });
        });
      } else {
        aur.SATURN_MAIN.colat.forEach((c, j) => {
          for (let lon = 0; lon < 360; lon += dLon) jobs.push(() => {
            const one = aur.saturnOval(L.model, c, 360, L.surface);
            const turn = (q: ArrayLike<number> | null) => q && rotZ([q[0], q[1], q[2]], lon);
            edges[j].south.push(turn(one.south[0]) as V3 | null); edges[j].north.push(turn(one.north[0]) as V3 | null);
          });
        });
      }
      jobs.push(() => { gi!.mesh = this.bandMesh(edges, k === 'jupiter' ? 1 : k === 'saturn' ? 0.9 : k === 'ganymede' ? 0.25 : 0.16); g.add(gi!.mesh); });
      gi = { mesh: null, jobs, done: false };
      this.giant.set(k, gi);
    }
    while (gi.jobs.length && spare() > 0) gi.jobs.shift()!();
    if (!gi.mesh) return;
    // The moons' footprint spots, each from a table of its footprints every
    // 5 deg of its System III longitude, filled a few traces a frame.
    for (const [moon, info] of Object.entries(aur.FOOTPRINT_MOONS)) {
      if (info.planet !== k) continue;
      let sp = this.spots.get(moon);
      if (!sp) { sp = { table: { north: [], south: [] }, next: 0, mesh: null, key: NaN }; this.spots.set(moon, sp); }
      while (sp.next < 72 && spare() > 0) {
        const f = aur.moonFootprint(L.model, sp.next * 5, L.surface, info.r);
        sp.table.north.push(f.north as V3 | null); sp.table.south.push(f.south as V3 | null);
        sp.next++;
      }
      if (sp.next < 72) continue;
      // The moon's longitude now, in the planet's frame.
      const mm = meshes.get(moon as BodyKey), pm = meshes.get(k)!;
      if (!mm) continue;
      const rel = this.w.copy(mm.position).sub(pm.position).applyMatrix3(mat.uniforms.toBody.value as THREE.Matrix3);
      this.moonSpot(moon, sp, ((Math.atan2(rel.y, rel.x) * 180) / Math.PI + 360) % 360, g);
    }
  }

  private bandMesh(edges: { north: (V3 | null)[]; south: (V3 | null)[] }[], intensity: number): THREE.Mesh {
    const pos: number[] = [], em: number[] = [], idx: number[] = [];
    // A glowing sheet a few hundred km up, fading upward like a curtain.
    const lift = [1.004, 1.012], lw = [1, 0.3];
    for (const h of ['north', 'south'] as const) {
      const a = edges[0][h], b = edges[1][h], n = a.length;
      for (let li = 0; li < lift.length; li++) {
        const base = pos.length / 3;
        for (let i = 0; i <= n; i++) {
          const pa = a[i % n] ?? b[i % n], pb = b[i % n] ?? a[i % n];
          // Rows across the band, each back on the surface, brightest mid-band.
          for (let r = 0; r < ROWS; r++) {
            const t = r / (ROWS - 1), p = between(pa, pb, t), w = Math.sin(Math.PI * t) ** 2;
            const q = p ?? [0, 0, 0];
            pos.push(q[0] * lift[li], q[1] * lift[li], q[2] * lift[li]);
            const e = intensity * w * lw[li] * (p ? 1 : 0);
            em.push(UV.r * e, UV.g * e, UV.b * e);
          }
        }
        for (let i = 0; i < n; i++) for (let j = 0; j < ROWS - 1; j++) {
          const i0 = base + i * ROWS + j, i1 = i0 + ROWS;
          idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('emission', new THREE.Float32BufferAttribute(em, 3));
    geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: auroraVertex, fragmentShader: auroraFragment, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { level: { value: 1 }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, dayFade: { value: 0 } },
    }));
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    return mesh;
  }

  // A moon's spot and its tail. The spot sits downstream of the moon's
  // instantaneous footprint by Hue et al.'s lead angle; the tail runs on
  // from it over the footprints of the moon's earlier longitudes (the planet
  // turns faster than the moon orbits, so the moon's east longitude falls and
  // the plasma it disturbed lies at larger ones): 60 deg for Io's long tail,
  // 20 for the others'.
  private moonSpot(moon: string, sp: { table: { north: (V3 | null)[]; south: (V3 | null)[] }; mesh: THREE.Mesh | null; key: number }, lon: number, g: THREE.Group): void {
    const key = Math.round(lon * 4);
    if (key === sp.key && sp.mesh) return;
    sp.key = key;
    const tbl = sp.table, aur = this.aur!;
    const at = (h: 'north' | 'south', L: number): V3 | null => {
      const f = (((L % 360) + 360) % 360) / 5, i = Math.floor(f), u = f - i, a = tbl[h][i % 72], b = tbl[h][(i + 1) % 72];
      if (!a || !b) return a ?? b;
      const p: V3 = [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])], r = Math.hypot(...p);
      return [(p[0] / r) * 1.006, (p[1] / r) * 1.006, (p[2] / r) * 1.006];
    };
    const bright = moon === 'io' ? 1.6 : moon === 'enceladus' ? 0.6 : 1, tail = moon === 'io' ? 60 : 20;
    const SPOT = moon === 'io' ? 0.006 : 0.004, STEPS = 24;
    const pos: number[] = [], em: number[] = [], idx: number[] = [];
    for (const h of ['north', 'south'] as const) {
      const lead = aur.leadAngle(moon, h, (360 - lon) % 360), lon0 = lon + lead;
      // The spot: a small disc facing out.
      const c = at(h, lon0);
      if (!c) continue;
      const n = new THREE.Vector3(...c).normalize(), t1 = new THREE.Vector3(0, 0, 1).cross(n).normalize(), t2 = n.clone().cross(t1);
      const base = pos.length / 3;
      pos.push(...c);
      em.push(UV.r * bright, UV.g * bright, UV.b * bright);
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * 2 * Math.PI;
        pos.push(c[0] + SPOT * (Math.cos(a) * t1.x + Math.sin(a) * t2.x), c[1] + SPOT * (Math.cos(a) * t1.y + Math.sin(a) * t2.y), c[2] + SPOT * (Math.cos(a) * t1.z + Math.sin(a) * t2.z));
        em.push(0, 0, 0);
      }
      for (let j = 0; j < 8; j++) idx.push(base, base + 1 + j, base + 1 + ((j + 1) % 8));
      // The tail, a ribbon fading downstream.
      const tb = pos.length / 3;
      for (let st = 0; st <= STEPS; st++) {
        const p = at(h, lon0 + (tail * st) / STEPS);
        if (!p) continue;
        const q = new THREE.Vector3(...p), w = 0.5 * bright * (1 - st / STEPS) ** 1.5, side = new THREE.Vector3(0, 0, 1).cross(q).normalize().multiplyScalar(SPOT * 0.35);
        pos.push(q.x - side.x, q.y - side.y, q.z - side.z, q.x + side.x, q.y + side.y, q.z + side.z);
        em.push(UV.r * w, UV.g * w, UV.b * w, UV.r * w, UV.g * w, UV.b * w);
      }
      const nT = (pos.length / 3 - tb) / 2;
      for (let st = 0; st < nT - 1; st++) { const i0 = tb + 2 * st; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
    }
    if (!sp.mesh) {
      sp.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
        vertexShader: auroraVertex, fragmentShader: auroraFragment, transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { level: { value: 1 }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, dayFade: { value: 0 } },
      }));
      sp.mesh.frustumCulled = false;
      sp.mesh.renderOrder = 4;
      g.add(sp.mesh);
    }
    const geo = sp.mesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('emission', new THREE.Float32BufferAttribute(em, 3));
    geo.setIndex(idx);
  }

  // ---- radiation belts ----

  // Each belt as BELT_SHELLS L-shells across its band, BELT_LON field lines
  // round each, traced a shell at a time and joined into one mesh.
  private beltShells(k: BodyKey, L: BodyLines, g: THREE.Group, spare: () => number): void {
    const B = this.belts!;
    let st = this.beltMeshes.get(k);
    if (!st) {
      const jobs: (() => void)[] = [], shells: { mesh: THREE.Mesh; L: number }[] = [];
      for (const belt of B.BELTS[k as keyof typeof B.BELTS]) {
        for (let i = 0; i < BELT_SHELLS; i++) {
          const Ls = belt.L[0] + ((belt.L[1] - belt.L[0]) * (i + 0.5)) / BELT_SHELLS, w = B.beltWeight(belt, Ls);
          // One mesh a shell, so a shell around the camera can be left out.
          jobs.push(() => {
            const pos: number[] = [], wt: number[] = [], idx: number[] = [];
            const lines = B.traceShell(L.model, Ls, BELT_LON, L.surface);
            for (let j = 0; j <= BELT_LON; j++) {
              const r = B.resample(lines[j % BELT_LON].points, BELT_SAMPLES, L.model);
              for (let sIdx = 0; sIdx < BELT_SAMPLES; sIdx++) {
                pos.push(r.points[3 * sIdx], r.points[3 * sIdx + 1], r.points[3 * sIdx + 2]);
                // Trapped particles crowd toward the magnetic equator.
                wt.push(Math.abs(r.lat[sIdx]) > BELT_LAT ? 0 : w * Math.exp(-((r.lat[sIdx] / 28) ** 2)));
              }
            }
            for (let j = 0; j < BELT_LON; j++) for (let sIdx = 0; sIdx < BELT_SAMPLES - 1; sIdx++) {
              const i0 = j * BELT_SAMPLES + sIdx, i1 = i0 + BELT_SAMPLES;
              // No triangles where the shell has faded out (fill is the cost on an integrated GPU).
              if (wt[i0] < 0.03 && wt[i0 + 1] < 0.03 && wt[i1] < 0.03 && wt[i1 + 1] < 0.03) continue;
              idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            geo.setAttribute('weight', new THREE.Float32BufferAttribute(wt, 1));
            geo.setIndex(idx);
            geo.computeVertexNormals();
            const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
              vertexShader: beltVertex, fragmentShader: beltFragment, transparent: true, depthWrite: false, toneMapped: false,
              blending: THREE.AdditiveBlending, side: THREE.FrontSide,
              uniforms: { colour: { value: BELT_COLOUR }, level: { value: 1 }, fade: { value: 1 } },
            }));
            mesh.frustumCulled = false;
            mesh.renderOrder = 3;
            mesh.visible = this.on.belts;
            g.add(mesh);
            shells.push({ mesh, L: Ls });
          });
        }
      }
      st = { jobs, shells };
      this.beltMeshes.set(k, st);
    }
    while (st.jobs.length && spare() > 0) st.jobs.shift()!();
  }

  // The camera's own L (r / cos^2 of its magnetic latitude, from the
  // dipole's centre, in the body's radii): a shell of larger L encloses it,
  // and from inside a belt is only a haze over the whole view.
  private cameraL(L: BodyLines, mesh: THREE.Mesh, mat: THREE.ShaderMaterial): number {
    const p = this.w.copy(mesh.position).negate().applyMatrix3(mat.uniforms.toBody.value as THREE.Matrix3).multiplyScalar(UNIT_KM / L.model.a);
    const c = L.model.dipole.centre, m = L.model.dipole.m, M = Math.hypot(m[0], m[1], m[2]);
    const d = [p.x - c[0], p.y - c[1], p.z - c[2]], r = Math.hypot(d[0], d[1], d[2]);
    const sinLat = (d[0] * m[0] + d[1] * m[1] + d[2] * m[2]) / (M * r);
    return r / Math.max(1 - sinLat * sinLat, 1e-6);
  }

  // ---- labels ----

  private poleTag(k: BodyKey, L: BodyLines, g: THREE.Group, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const { centre, m, tilt } = L.model.dipole, M = Math.hypot(...m);
    const end = this.v.set(centre[0] + (1.6 * m[0]) / M, centre[1] + (1.6 * m[1]) / M, centre[2] + (1.6 * m[2]) / M).applyMatrix4(g.matrix);
    const s = this.screen(end, camera, width, height);
    if (s) this.tag(s, `B ${tilt.toFixed(1)}°`, 'guide-tag mag-pole', `${BODY_BY_KEY[k].name}'s dipole (${L.model.name}): tilted ${tilt.toFixed(2)}° from the spin axis, its centre ${Math.round(Math.hypot(...centre) * L.model.a).toLocaleString('en-AU')} km from the planet's; field lines leave the surface at this end`);
  }

  private kpTag(g: THREE.Group, sunB: THREE.Vector3, L: BodyLines, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    if (this.ovationMesh?.visible && this.ovation) {
      const hhmm = new Date(this.ovation.forecast).toISOString().slice(11, 16), q = this.ovationPeak;
      const s0 = this.screen(this.v.set(q[0], q[1], q[2]).applyMatrix4(g.matrix), camera, width, height);
      if (s0) this.tag(s0, `OVATION ${hhmm}`, 'guide-tag mag-kp', `NOAA SWPC's live aurora map (OVATION Prime, from the solar wind measured at L1) for ${hhmm} UTC: the probability of visible aurora, green 557.7 nm low, red 630.0 nm above. Tagged at its brightest point in the north. Away from now, Starkov's oval for the day's Kp`);
      return;
    }
    if (!this.cgm?.done) return;
    // On the northern oval at magnetic midnight.
    const sunLon = this.aur!.dipoleLongitude(this.cgm.frame, [sunB.x, sunB.y, sunB.z]);
    const lat = this.aur!.ovalLatitude('equatorward', this.kpNow.kp, 0);
    const p = this.cgm.at(1, lat, sunLon + 180), r = 1 + 300 / L.model.a;
    const s = this.screen(this.v.set(p[0] * r, p[1] * r, p[2] * r).applyMatrix4(g.matrix), camera, width, height);
    const src = this.kpNow.source === 'assumed' ? 'no Kp for the date: 2o assumed' : `${this.kpNow.source}, GFZ Potsdam via CelesTrak`;
    if (s) this.tag(s, `Kp ${this.aur!.kpLabel(this.kpNow.kp)}`, 'guide-tag mag-kp', `The auroral oval for Kp ${this.aur!.kpLabel(this.kpNow.kp)} (${src}): Starkov's boundaries in corrected geomagnetic latitude, green 557.7 nm below about 200 km, red 630.0 nm above`);
  }

  private screen(p: THREE.Vector3, camera: THREE.PerspectiveCamera, width: number, height: number): [number, number] | null {
    const n = this.w.copy(p).project(camera);
    if (n.z > 1 || n.z < -1) return null;
    const s: [number, number] = [((n.x + 1) / 2) * width, ((1 - n.y) / 2) * height];
    return s[0] > -20 && s[0] < width + 20 && s[1] > -20 && s[1] < height + 20 ? s : null;
  }

  private tag(at: [number, number], text: string, cls: string, title: string): void {
    let el = this.tags[this.tagCount];
    if (!el) { el = document.createElement('div'); this.overlay.appendChild(el); this.tags.push(el); }
    this.tagCount++;
    if (el.textContent !== text) el.textContent = text;
    if (el.className !== cls) el.className = cls;
    if (el.title !== title) el.title = title;
    el.style.display = '';
    el.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`;
  }
  private hideTags(): void { for (let i = this.tagCount; i < this.tags.length; i++) this.tags[i].style.display = 'none'; }

  private drawLegend(k: BodyKey, L: BodyLines): void {
    const d = L.model.dipole;
    this.legend.innerHTML = '';
    const h = document.createElement('p'); h.className = 'field-title'; h.textContent = `${BODY_BY_KEY[k].name} magnetic field`;
    const bar = document.createElement('div'); bar.className = 'field-bar mag-bar';
    const ticks = document.createElement('p'); ticks.className = 'field-ticks';
    const lo = document.createElement('span'), hi = document.createElement('span');
    lo.textContent = fmtGauss(L.bRef / 10 ** DECADES); hi.textContent = fmtGauss(L.bRef);
    ticks.append(lo, hi);
    const unit = document.createElement('p'); unit.className = 'field-unit';
    unit.textContent = L.mesh
      ? `|B| on the surface ${fmtGauss(L.range[0])} to ${fmtGauss(L.range[1])}; dipole ${(d.moment / 1e5).toPrecision(4)} G R³, tilt ${d.tilt.toFixed(2)}°, centre ${Math.round(Math.hypot(...d.centre) * L.model.a).toLocaleString('en-AU')} km off`
      : 'tracing field lines…';
    const src = document.createElement('p'); src.className = 'field-source';
    src.textContent = `${L.lineModel.source}. ${EXTERNAL[k] ?? 'Internal field only: no magnetopause.'}`;
    this.legend.append(h, bar, ticks, unit, src);
  }

  // ---- the Sun's field ----
  //
  // Field lines from about 300 footpoints spread evenly over the photosphere,
  // traced through WSO's PFSS model for the Carrington rotation of the date
  // out to 3.5 solar radii (the field is radial past the source surface at
  // 2.5): closed loops over active regions and the streamer belt, open
  // lines from the polar holes. Retraced when the rotation changes.
  private sunLines(f: { camera: THREE.PerspectiveCamera; meshes: Map<BodyKey, THREE.Mesh>; focus: BodyKey | null; height: number; date: Date }, spare: () => number): void {
    const mesh = f.meshes.get('sun');
    if (!this.sun) { if (!this.on.magnetic || !mesh) return; const group = new THREE.Group(); group.matrixAutoUpdate = false; this.scene.add(group); this.sun = { data: null, asked: false, cr: NaN, jobs: [], pos: [], str: [], idx: [], bRef: 1, mesh: null, group, axesAt: NaN, m: new THREE.Matrix3(), hcs: null, tilt: null }; }
    const S = this.sun, sf = this.sf!;
    const px = mesh ? ((BODY_BY_KEY.sun.radiusKm / UNIT_KM / mesh.position.length()) * f.height) / (2 * Math.tan((f.camera.fov * Math.PI) / 360)) : 0;
    // The lines once the Sun is more than a dot; the current sheet and the
    // spiral out to 6 AU whenever the Sun is focused.
    S.group.visible = this.on.magnetic && !!mesh && (px > 1.5 || f.focus === 'sun');
    if (!S.group.visible || !mesh) return;
    if (S.mesh) S.mesh.visible = px > 1.5;
    if (S.hcs) S.hcs.visible = f.focus === 'sun';
    if (!S.asked) {
      S.asked = true;
      void fetch(`${this.baseUrl}data/sun-pfss.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((j) => { S.data = j; }).catch((e) => console.warn('sun-pfss.json:', e));
    }
    if (!S.data) return;
    // The nearest rotation the table holds.
    let cr = Math.floor(sf.carringtonRotation(f.date.getTime()));
    cr = Math.min(Math.max(cr, S.data.first), S.data.first + S.data.rows.length - 1);
    while (!S.data.rows[cr - S.data.first] && cr > S.data.first) cr--;
    const row = S.data.rows[cr - S.data.first];
    if (row && cr !== S.cr) {
      S.cr = cr;
      if (S.mesh) { S.group.remove(S.mesh); S.mesh.geometry.dispose(); S.mesh = null; }
      if (S.hcs) { S.group.remove(S.hcs); S.hcs.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); S.hcs = null; S.tilt = null; }
      const field = sf.pfssField(row), model = { field, rMax: 3.5, dipole: { m: [0, 0, 1], centre: [0, 0, 0] } } as unknown as Model;
      S.pos = []; S.str = []; S.idx = [];
      const N = 300, golden = Math.PI * (3 - Math.sqrt(5)), b: V3 = [0, 0, 0];
      const seeds: V3[] = [];
      for (let i = 0; i < N; i++) { const z = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - z * z), ph = golden * i; seeds.push([r * Math.cos(ph) * 1.0005, r * Math.sin(ph) * 1.0005, z * 1.0005]); }
      S.bRef = Math.max(...seeds.map((p) => Math.hypot(...field(p[0], p[1], p[2], b))));
      S.jobs = seeds.map((p) => () => {
        const t = this.mag!.traceLine(model, p, { eq: 1, pol: 1 }, { rMax: 3.5, maxSteps: 2000 });
        if (t.strength.length < 3) return;
        const base = S.pos.length / 3;
        for (let i = 0; i < t.strength.length; i++) {
          S.pos.push(t.points[3 * i], t.points[3 * i + 1], t.points[3 * i + 2]);
          S.str.push(Math.log10(Math.max(t.strength[i], 1e-3) / S.bRef) / DECADES + 1);
          if (i) S.idx.push(base + i - 1, base + i);
        }
      });
      S.jobs.push(() => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(S.pos, 3));
        geo.setAttribute('strength', new THREE.Float32BufferAttribute(S.str, 1));
        geo.setIndex(S.idx);
        S.mesh = new THREE.LineSegments(geo, this.lineMat);
        S.mesh.frustumCulled = false;
        S.mesh.renderOrder = 3;
        S.group.add(S.mesh);
      });
      // The current sheet: Br on the source surface a few rows a frame,
      // then its neutral line swept out along the Parker spiral.
      const grid = sf.sourceSurfaceGrid(field, sf.SOURCE_SURFACE, { dLat: 1, dLon: 2 });
      const gridJob = (): void => { if (!grid.step(Math.max(0.5, spare()))) S.jobs.unshift(gridJob); };
      S.jobs.push(gridJob, () => { const h = this.currentSheet(grid); S.hcs = h.group; S.tilt = h.tilt; S.group.add(h.group); this.legendFor = null; });
    }
    while (S.jobs.length && spare() > 0) S.jobs.shift()!();
    // The Sun's axes, refreshed every simulated minute.
    if (!(Math.abs(f.date.getTime() - S.axesAt) < 60e3)) { S.m.copy(this.sunAxes(f.date)).transpose(); S.axesAt = f.date.getTime(); }
    const e = S.m.elements, sc = SUN_KM / UNIT_KM;
    S.group.matrix.set(e[0] * sc, e[3] * sc, e[6] * sc, mesh.position.x, e[1] * sc, e[4] * sc, e[7] * sc, mesh.position.y, e[2] * sc, e[5] * sc, e[8] * sc, mesh.position.z, 0, 0, 0, 1);
    S.group.matrixWorldNeedsUpdate = true;
  }

  // The sheet as its neutral line swept out along 400 km/s spirals and
  // drawn where it crosses spheres every half AU out to 6 AU (a filled
  // sheet, folded over itself many times, cost the integrated GPU 28 ms a
  // frame), and 12 spiral field lines in the Sun's equator coloured by
  // their polarity (amber outward, blue inward).
  private currentSheet(grid: ReturnType<SunMod['sourceSurfaceGrid']>): { group: THREE.Group; tilt: { north: number; south: number } } {
    const sf = this.sf!, D = Math.PI / 180, Rs = sf.SOURCE_SURFACE, rOut = (6 * sf.AU_KM) / sf.SUN_RADIUS_KM;
    const segs = sf.neutralSegments(grid), tilt = sf.sheetTilt(segs);
    const rs: number[] = [Rs * 2]; for (let au = 0.5; au <= 6 + 1e-9; au += 0.5) rs.push((au * sf.AU_KM) / sf.SUN_RADIUS_KM);
    const P = (lat: number, lon: number, r: number): V3 => { const ph = sf.spiralLongitude(lon * D, r), c = Math.cos(lat * D); return [r * c * Math.cos(ph), r * c * Math.sin(ph), r * Math.sin(lat * D)]; };
    const pos: number[] = [], idx: number[] = [];
    for (const [a, b] of segs) for (const r of rs) { const k = pos.length / 3; pos.push(...P(a[0], a[1], r), ...P(b[0], b[1], r)); idx.push(k, k + 1); }
    const group = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('tint', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => [0.925, 0.851, 0.69][i % 3]), 3));
    geo.setIndex(idx);
    const tint = (opacity: number, side: THREE.Side) => new THREE.ShaderMaterial({ vertexShader: tintVertex, fragmentShader: tintFragment, transparent: true, depthWrite: false, toneMapped: false, side, blending: THREE.AdditiveBlending, uniforms: { level: { value: 1 }, opacity: { value: opacity } } });
    const sheet = new THREE.LineSegments(geo, tint(0.35, THREE.FrontSide));
    sheet.frustumCulled = false; sheet.renderOrder = 2;
    group.add(sheet);
    // Spirals: the sign of Br at the source surface in the Sun's equator.
    const row = grid.lats.indexOf(0), W = grid.lons.length, lp: number[] = [], lc: number[] = [];
    for (let lon = 0; lon < 360; lon += 30) {
      const j = Math.round(lon / (grid.lons[1] - grid.lons[0])), out = grid.br[row * W + j] > 0;
      const c = out ? [1.0, 0.698, 0.18] : [0.184, 0.561, 0.69];
      let prev: V3 | null = null;
      for (let i = 0; i <= 400; i++) {
        const r = Rs * (rOut / Rs) ** (i / 400), q = P(0, lon, r);
        if (prev) { lp.push(...prev, ...q); lc.push(...c, ...c); }
        prev = q;
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('tint', new THREE.Float32BufferAttribute(lc, 3));
    const spirals = new THREE.LineSegments(lg, tint(0.5, THREE.FrontSide));
    spirals.frustumCulled = false; spirals.renderOrder = 3;
    group.add(spirals);
    return { group, tilt };
  }

  private drawSunLegend(): void {
    const S = this.sun!;
    this.legend.innerHTML = '';
    const h = document.createElement('p'); h.className = 'field-title'; h.textContent = "The Sun's magnetic field";
    const bar = document.createElement('div'); bar.className = 'field-bar mag-bar';
    const ticks = document.createElement('p'); ticks.className = 'field-ticks';
    const lo = document.createElement('span'), hi = document.createElement('span');
    lo.textContent = fmtGauss(S.bRef / 10 ** DECADES); hi.textContent = fmtGauss(S.bRef);
    ticks.append(lo, hi);
    const unit = document.createElement('p'); unit.className = 'field-unit';
    const t = S.tilt ? `; the current sheet reaches ${t2(S.tilt.north)} N and ${t2(-S.tilt.south)} S, swept out along a 400 km/s Parker spiral (amber outward, blue inward)` : '';
    unit.textContent = `Carrington rotation ${S.cr}: closed loops and the open field of the polar holes, radial past the source surface at 2.5 solar radii${t}`;
    const src = document.createElement('p'); src.className = 'field-source';
    src.textContent = "Wilcox Solar Observatory's PFSS model from its magnetograms, degree 9. Large scale only: no active-region detail.";
    this.legend.append(h, bar, ticks, unit, src);
  }

  // ---- Mars's crust ----

  private marsCrust(f: { meshes: Map<BodyKey, THREE.Mesh>; materials: Map<BodyKey, THREE.ShaderMaterial>; level: number }): void {
    const want = this.on.magnetic || this.on.aurora, mesh = f.meshes.get('mars'), mat = f.materials.get('mars');
    if (!this.mars) { if (!want) return; const group = new THREE.Group(); group.matrixAutoUpdate = false; this.scene.add(group); this.mars = { asked: false, tex: null, mesh: null, group }; }
    const M = this.mars;
    M.group.visible = want && !!mesh && !!mat;
    if (!M.group.visible || !mesh || !mat) return;
    if (!M.asked) {
      M.asked = true;
      void fetch(`${this.baseUrl}data/mars-crustal-br.bin`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))).then((buf) => {
        const s8 = new Int8Array(buf), u8 = new Uint8Array(s8.length);
        for (let i = 0; i < s8.length; i++) u8[i] = s8[i] + 128;
        const tex = new THREE.DataTexture(u8, 720, 360, THREE.RedFormat, THREE.UnsignedByteType);
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.wrapS = THREE.RepeatWrapping;
        tex.needsUpdate = true;
        M.tex = tex;
        const r = (BODY_BY_KEY.mars.radiiKm[0] / UNIT_KM) * 1.003;
        M.mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 192, 96), new THREE.ShaderMaterial({
          vertexShader: marsVertex, fragmentShader: marsFragment, transparent: true, depthWrite: false, toneMapped: false,
          uniforms: { map: { value: tex }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, showField: { value: 0 }, showAurora: { value: 0 }, level: { value: 1 } },
        }));
        M.mesh.frustumCulled = false;
        M.mesh.renderOrder = 4;
        M.group.add(M.mesh);
      }).catch((e) => console.warn('mars-crustal-br.bin:', e));
    }
    if (!M.mesh) return;
    // Body-fixed to render, as for the planets' field lines (here in km / 1000).
    const e = this.m3.copy(mat.uniforms.toBody.value as THREE.Matrix3).transpose().elements;
    M.group.matrix.set(e[0], e[3], e[6], mesh.position.x, e[1], e[4], e[7], mesh.position.y, e[2], e[5], e[8], mesh.position.z, 0, 0, 0, 1);
    M.group.matrixWorldNeedsUpdate = true;
    const u = (M.mesh.material as THREE.ShaderMaterial).uniforms, sun = f.meshes.get('sun')?.position;
    u.showField.value = this.on.magnetic ? 1 : 0;
    u.showAurora.value = this.on.aurora ? 1 : 0;
    u.level.value = Math.min(f.level, 1);
    if (sun) (u.sunDir.value as THREE.Vector3).copy(sun).sub(mesh.position).applyMatrix3(mat.uniforms.toBody.value as THREE.Matrix3).normalize();
  }

  private drawMarsLegend(): void {
    this.legend.innerHTML = '';
    const h = document.createElement('p'); h.className = 'field-title'; h.textContent = "Mars's crustal field";
    const bar = document.createElement('div'); bar.className = 'field-bar';
    const ticks = document.createElement('p'); ticks.className = 'field-ticks';
    const lo = document.createElement('span'), mid = document.createElement('span'), hi = document.createElement('span');
    lo.textContent = '−12,000 nT'; mid.textContent = '0'; hi.textContent = '+12,000 nT';
    ticks.append(lo, mid, hi);
    const unit = document.createElement('p'); unit.className = 'field-unit';
    unit.textContent = 'Br at the surface, inward blue, outward amber (asinh scale): −8,520 to 11,260 nT, strongest over Terra Cimmeria';
    const src = document.createElement('p'); src.className = 'field-source';
    src.textContent = 'Langlais et al. 2019 (MGS and MAVEN), degree 134. Mars has no global field now; this is its magnetised ancient crust.';
    this.legend.append(h, bar, ticks, unit, src);
  }

  dispose(): void {
    if (this.sun) { this.scene.remove(this.sun.group); this.sun.mesh?.geometry.dispose(); }
    if (this.mars) { this.scene.remove(this.mars.group); this.mars.tex?.dispose(); if (this.mars.mesh) { this.mars.mesh.geometry.dispose(); (this.mars.mesh.material as THREE.Material).dispose(); } }
    for (const k of [...this.lines.keys()]) this.drop(k);
    for (const gi of this.giant.values()) if (gi.mesh) { gi.mesh.geometry.dispose(); (gi.mesh.material as THREE.Material).dispose(); }
    for (const sp of this.spots.values()) if (sp.mesh) { sp.mesh.geometry.dispose(); (sp.mesh.material as THREE.Material).dispose(); }
    for (const b of this.beltMeshes.values()) for (const sh of b.shells) { sh.mesh.geometry.dispose(); (sh.mesh.material as THREE.Material).dispose(); }
    if (this.ovationMesh) { this.ovationMesh.geometry.dispose(); (this.ovationMesh.material as THREE.Material).dispose(); }
    for (const g of this.groups.values()) this.scene.remove(g);
    for (const b of this.bnds.values()) { b.mesh.geometry.dispose(); (b.mesh.material as THREE.Material).dispose(); }
    this.lineMat.dispose(); this.axisMat.dispose(); this.bndMat.dispose();
    this.legend.remove();
    for (const t of this.tags) t.remove();
  }
}

// e1 and e2 of a magnetic equator frame turned lon (+ off) deg about its axis.
function rot(fr: { e1: number[]; e2: number[] }, lon: number, off: number): number[] {
  const a = ((lon + off) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [0, 1, 2].map((i) => c * fr.e1[i] + s * fr.e2[i]);
}
function rotZ(q: V3, lon: number): V3 {
  const a = (lon * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c * q[0] - s * q[1], s * q[0] + c * q[1], q[2]];
}
// A fraction t of the way between two surface points, back on the surface
// (their radii blended, along the blended direction), not on the chord
// through the planet.
const ROWS = 7;
function between(a: V3 | null, b: V3 | null, t: number): V3 | null {
  if (!a || !b) return a ?? b;
  const m: V3 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])], n = Math.hypot(...m) || 1;
  const r = Math.hypot(...a) * (1 - t) + Math.hypot(...b) * t;
  return [(m[0] / n) * r, (m[1] / n) * r, (m[2] / n) * r];
}
