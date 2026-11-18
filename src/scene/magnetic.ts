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

import * as THREE from 'three';
import { BODY_BY_KEY, type BodyKey } from './catalogue';

export type MagneticKey = 'magnetic' | 'aurora';
type Mag = typeof import('../physics/magnetic.js');
type Aur = typeof import('../physics/aurora.js');
type Model = NonNullable<ReturnType<Mag['magneticModel']>>;
type V3 = [number, number, number];

const UNIT_KM = 1000;
const BODIES: BodyKey[] = ['earth', 'jupiter', 'saturn', 'uranus', 'neptune'];
const BUDGET_MS = 3;                       // tracing per frame
// Seed latitudes (magnetic, toward the end field lines leave) per body.
const SEEDS: Record<string, number[]> = {
  earth: [20, 35, 45, 55, 62, 68], jupiter: [15, 30, 45, 55, 62, 68, 74], saturn: [20, 35, 45, 55, 62, 68],
  uranus: [15, 30, 45, 55, 62, 68], neptune: [15, 30, 45, 55, 62, 68],
};
const N_LON = 12;
const DECADES = 3;                         // the ramp spans 1000:1 in |B|

// Lines shaded along the console's ramp (planner-panel.tsx's porkchop):
// strong sheen, then phosphor amber, key orange, engraving.
const lineVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float strength;
varying float vS;
void main() {
  vS = strength;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;
const lineFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float level;
uniform float opacity;
varying float vS;
vec3 ramp(float s) {
  vec3 c0 = vec3(0.604, 0.196, 0.086), c1 = vec3(0.851, 0.325, 0.122), c2 = vec3(1.0, 0.698, 0.180), c3 = vec3(0.961, 0.941, 0.894);
  float f = clamp(s, 0.0, 1.0) * 3.0;
  return f < 1.0 ? mix(c0, c1, f) : f < 2.0 ? mix(c1, c2, f - 1.0) : mix(c2, c3, f - 2.0);
}
void main() {
  #include <logdepthbuf_fragment>
  float a = opacity * (0.22 + 0.6 * clamp(vS, 0.0, 1.0));
  gl_FragColor = vec4(ramp(vS) * a * level, a);
}
`;

// Auroral emission: a colour per vertex, faded on the day side for Earth.
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

// Emission colours: 557.7 nm and 630.0 nm as sRGB, and the giants' false colour.
const GREEN = new THREE.Color(0.32, 1.0, 0.45), RED = new THREE.Color(1.0, 0.16, 0.1), UV = new THREE.Color(0.72, 0.62, 1.0);
// Earth's emission layers, km above the surface: green peaks near 110-150
// km, red 630 nm above about 200 km.
const LAYERS = [100, 120, 145, 175, 215, 260, 310];
const GREEN_W = [0.5, 1.0, 0.85, 0.45, 0.12, 0.02, 0];
const RED_W = [0, 0.02, 0.06, 0.18, 0.4, 0.5, 0.35];

interface BodyLines {
  model: Model;
  surface: { eq: number; pol: number };
  seeds: { p: V3; keepOpenOnly: boolean }[];
  next: number;
  pos: number[]; str: number[]; index: number[];
  bRef: number;
  mesh: THREE.LineSegments | null;
  axis: THREE.LineSegments | null;
  range: [number, number];
}

const fmtGauss = (nT: number) => {
  const G = nT / 1e5;
  return G >= 1 ? `${G.toPrecision(3)} G` : G >= 0.01 ? `${G.toFixed(3)} G` : `${(nT).toFixed(0)} nT`;
};

export class MagneticLayer {
  readonly on: Record<MagneticKey, boolean> = { magnetic: false, aurora: false };
  private mag: Mag | null = null;
  private aur: Aur | null = null;
  private loading: Promise<void> | null = null;
  private lines = new Map<BodyKey, BodyLines>();
  private earthYear = NaN;
  private lineMat = new THREE.ShaderMaterial({
    vertexShader: lineVertex, fragmentShader: lineFragment, transparent: true, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, uniforms: { level: { value: 1 }, opacity: { value: 1 } },
  });
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
  private w = new THREE.Vector3();
  // Auroras.
  private kpLoaded = false;
  private cgm: ReturnType<Aur['cgmGrid']> | null = null;
  private earthAurora: THREE.Mesh | null = null;
  private earthKey = '';
  private giant = new Map<BodyKey, { mesh: THREE.Mesh | null; jobs: (() => void)[]; done: boolean }>();
  private io: { table: { north: (V3 | null)[]; south: (V3 | null)[] } | null; next: number; mesh: THREE.Mesh | null } = { table: null, next: 0, mesh: null };
  private kpNow: { kp: number; source: string } = { kp: 2, source: 'assumed' };

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private baseUrl: string) {
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
      this.loading = Promise.all([import('../physics/magnetic.js'), import('../physics/aurora.js')]).then(([m, a]) => { this.mag = m; this.aur = a; });
    }
    if (key === 'aurora' && on && !this.kpLoaded) {
      this.kpLoaded = true;
      void this.loading!.then(() => fetch(`${this.baseUrl}data/kp.json`)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((j) => this.aur!.installKp(j)).catch((e) => console.warn('kp.json:', e));
    }
  }

  update(f: {
    camera: THREE.PerspectiveCamera; meshes: Map<BodyKey, THREE.Mesh>; materials: Map<BodyKey, THREE.ShaderMaterial>;
    focus: BodyKey | null; width: number; height: number; level: number; date: Date;
  }): void {
    this.tagCount = 0;
    const any = this.on.magnetic || this.on.aurora;
    if (!any || !this.mag || !this.aur) {
      for (const g of this.groups.values()) g.visible = false;
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
      let L = this.lines.get(k);
      if (!L) L = this.start(k, f.date);
      // Body-fixed (units of the model's a) to render: the surface
      // material's toBody transposed, scaled, at the body's centre.
      const e = this.m3.copy(mat.uniforms.toBody.value as THREE.Matrix3).transpose().elements, s = L.model.a / UNIT_KM;
      this.m4.set(e[0] * s, e[3] * s, e[6] * s, mesh.position.x, e[1] * s, e[4] * s, e[7] * s, mesh.position.y, e[2] * s, e[5] * s, e[8] * s, mesh.position.z, 0, 0, 0, 1);
      g.matrix.copy(this.m4); g.matrixWorldNeedsUpdate = true;

      // Field lines, traced a few at a time.
      if (this.on.magnetic) {
        while (L.next < L.seeds.length && spare() > 0) this.traceOne(L);
        if (L.next >= L.seeds.length && !L.mesh) this.buildLines(k, L, g);
      }
      if (L.mesh) L.mesh.visible = this.on.magnetic;
      if (L.axis) L.axis.visible = this.on.magnetic;

      // The Sun in the body's frame.
      const sunB = sunPos ? this.sunB.copy(sunPos).sub(mesh.position).applyMatrix3(mat.uniforms.toBody.value as THREE.Matrix3).normalize() : this.sunB.set(1, 0, 0);
      if (this.on.aurora) {
        if (k === 'earth') this.earthOval(L, g, sunB, f.date, spare);
        else if (k === 'jupiter' || k === 'saturn') this.giantOval(k, L, g, spare, f.meshes, mat);
      }
      if (this.earthAurora && k === 'earth') this.earthAurora.visible = this.on.aurora;
      const gi = this.giant.get(k);
      if (gi?.mesh) gi.mesh.visible = this.on.aurora;
      if (this.io.mesh && k === 'jupiter') this.io.mesh.visible = this.on.aurora;

      // A tag at the dipole's end for the focused body.
      if (k === f.focus && px > 10 && this.on.magnetic) this.poleTag(k, L, g, f.camera, f.width, f.height);
      if (k === f.focus && px > 10 && this.on.aurora && k === 'earth' && this.earthAurora) this.kpTag(g, sunB, L, f.camera, f.width, f.height);
    }
    this.lineMat.uniforms.level.value = f.level;
    this.axisMat.uniforms.level.value = f.level;
    for (const k of ['earth', 'jupiter', 'saturn'] as BodyKey[]) {
      const m = k === 'earth' ? this.earthAurora : this.giant.get(k)?.mesh;
      if (m) (m.material as THREE.ShaderMaterial).uniforms.level.value = f.level;
    }
    if (this.io.mesh) (this.io.mesh.material as THREE.ShaderMaterial).uniforms.level.value = f.level;

    // The legend: the focused body's, else none.
    const lk = f.focus && this.lines.has(f.focus) && this.on.magnetic ? f.focus : null;
    const key = lk ? `${lk} ${this.lines.get(lk)!.mesh ? 'done' : 'tracing'} ${this.lines.get(lk)!.model.source}` : null;
    if (key !== this.legendFor) {
      this.legendFor = key;
      this.legend.hidden = !lk;
      if (lk) this.drawLegend(lk, this.lines.get(lk)!);
    }
    this.hideTags();
  }

  // ---- field lines ----

  private start(k: BodyKey, date: Date): BodyLines {
    const mag = this.mag!, model = mag.magneticModel(k, date)!;
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
    const L: BodyLines = { model, surface, seeds, next: 0, pos: [], str: [], index: [], bRef, mesh: null, axis: null, range: [Infinity, 0] };
    this.lines.set(k, L);
    return L;
  }

  private traceOne(L: BodyLines): void {
    const s = L.seeds[L.next++];
    const t = this.mag!.traceLine(L.model, s.p, L.surface);
    if (s.keepOpenOnly && t.closed) return;
    if (t.strength.length < 3) return;
    const base = L.pos.length / 3, n = t.strength.length;
    for (let i = 0; i < n; i++) {
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
    geo.setIndex(L.index);
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
    L.pos = []; L.str = []; L.index = [];
    void k;
  }

  private drop(k: BodyKey): void {
    const L = this.lines.get(k);
    if (!L) return;
    for (const o of [L.mesh, L.axis]) if (o) { o.parent?.remove(o); o.geometry.dispose(); }
    this.lines.delete(k);
    if (k === 'earth' && this.earthAurora) { this.earthAurora.parent?.remove(this.earthAurora); this.earthAurora.geometry.dispose(); (this.earthAurora.material as THREE.Material).dispose(); this.earthAurora = null; }
  }

  // ---- the Earth's auroral ovals ----

  private earthOval(L: BodyLines, g: THREE.Group, sunB: THREE.Vector3, date: Date, spare: () => number): void {
    const aur = this.aur!;
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
      if (k === 'jupiter') {
        const fr = aur.magneticEquatorFrame(L.model);
        aur.JUPITER_MAIN.r.forEach((r, j) => {
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
      jobs.push(() => { gi!.mesh = this.bandMesh(edges, k === 'jupiter' ? 0.9 : 0.75); g.add(gi!.mesh); });
      gi = { mesh: null, jobs, done: false };
      this.giant.set(k, gi);
    }
    while (gi.jobs.length && spare() > 0) gi.jobs.shift()!();
    if (k !== 'jupiter' || !gi.mesh) return;
    // Io's footprint table, every 5 deg of Io's System III longitude.
    if (!this.io.table) this.io.table = { north: [], south: [] };
    const tbl = this.io.table;
    while (this.io.next < 72 && spare() > 0) {
      const f = aur.ioFootprint(L.model, this.io.next * 5, L.surface);
      tbl.north.push(f.north as V3 | null); tbl.south.push(f.south as V3 | null);
      this.io.next++;
    }
    if (this.io.next < 72) return;
    // Io's longitude now, in Jupiter's frame.
    const ioMesh = meshes.get('io' as BodyKey), jm = meshes.get('jupiter')!;
    if (!ioMesh) return;
    const rel = this.w.copy(ioMesh.position).sub(jm.position).applyMatrix3(mat.uniforms.toBody.value as THREE.Matrix3);
    const lon = ((Math.atan2(rel.y, rel.x) * 180) / Math.PI + 360) % 360;
    this.ioSpot(tbl, lon, g);
  }

  private bandMesh(edges: { north: (V3 | null)[]; south: (V3 | null)[] }[], intensity: number): THREE.Mesh {
    const pos: number[] = [], em: number[] = [], idx: number[] = [];
    const lift = [1.003, 1.012];                        // a thin glowing sheet a few hundred km up
    for (const h of ['north', 'south'] as const) {
      const a = edges[0][h], b = edges[1][h], n = a.length;
      for (let li = 0; li < lift.length; li++) {
        const base = pos.length / 3;
        for (let i = 0; i <= n; i++) {
          const pa = a[i % n] ?? b[i % n], pb = b[i % n] ?? a[i % n];
          for (const [p, w] of [[pa, 0.55], [mid(pa, pb), 1], [pb, 0.55]] as [V3 | null, number][]) {
            const q = p ?? [0, 0, 0], r = Math.hypot(...q) || 1;
            pos.push((q[0] / r) * lift[li] * r, (q[1] / r) * lift[li] * r, (q[2] / r) * lift[li] * r);
            const e = intensity * w * (li === 0 ? 0.9 : 0.35) * (p ? 1 : 0);
            em.push(UV.r * e, UV.g * e, UV.b * e);
          }
        }
        for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
          const i0 = base + i * 3 + j, i1 = i0 + 3;
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

  // Io's spot and its tail: the footprints of Io's last 60 deg of System
  // III longitude (Jupiter turns faster than Io orbits, so Io's longitude
  // falls; the plasma it has disturbed lies at the larger longitudes).
  private ioKey = -1;
  private ioSpot(tbl: { north: (V3 | null)[]; south: (V3 | null)[] }, lon: number, g: THREE.Group): void {
    const key = Math.round(lon * 4);
    if (key === this.ioKey && this.io.mesh) return;
    this.ioKey = key;
    const at = (h: 'north' | 'south', L: number): V3 | null => {
      const f = (((L % 360) + 360) % 360) / 5, i = Math.floor(f), u = f - i, a = tbl[h][i % 72], b = tbl[h][(i + 1) % 72];
      if (!a || !b) return a ?? b;
      const p: V3 = [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])], r = Math.hypot(...p);
      return [(p[0] / r) * 1.006, (p[1] / r) * 1.006, (p[2] / r) * 1.006];
    };
    const pos: number[] = [], em: number[] = [], idx: number[] = [];
    const SPOT = 0.006, STEPS = 24;
    for (const h of ['north', 'south'] as const) {
      // The spot: a small diamond facing out.
      const c = at(h, lon);
      if (!c) continue;
      const n = new THREE.Vector3(...c).normalize(), t1 = new THREE.Vector3(0, 0, 1).cross(n).normalize(), t2 = n.clone().cross(t1);
      const base = pos.length / 3;
      pos.push(...c);
      em.push(UV.r * 1.6, UV.g * 1.6, UV.b * 1.6);
      for (let j = 0; j < 8; j++) {
        const a = (j / 8) * 2 * Math.PI;
        pos.push(c[0] + SPOT * (Math.cos(a) * t1.x + Math.sin(a) * t2.x), c[1] + SPOT * (Math.cos(a) * t1.y + Math.sin(a) * t2.y), c[2] + SPOT * (Math.cos(a) * t1.z + Math.sin(a) * t2.z));
        em.push(0, 0, 0);
      }
      for (let j = 0; j < 8; j++) idx.push(base, base + 1 + j, base + 1 + ((j + 1) % 8));
      // The tail, a ribbon fading over 60 deg.
      const tb = pos.length / 3;
      for (let s = 0; s <= STEPS; s++) {
        const p = at(h, lon + (60 * s) / STEPS);
        if (!p) continue;
        const q = new THREE.Vector3(...p), w = 0.8 * (1 - s / STEPS) ** 1.5, side = new THREE.Vector3(0, 0, 1).cross(q).normalize().multiplyScalar(SPOT * 0.35);
        pos.push(q.x - side.x, q.y - side.y, q.z - side.z, q.x + side.x, q.y + side.y, q.z + side.z);
        em.push(UV.r * w, UV.g * w, UV.b * w, UV.r * w, UV.g * w, UV.b * w);
      }
      const nT = (pos.length / 3 - tb) / 2;
      for (let s = 0; s < nT - 1; s++) { const i0 = tb + 2 * s; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
    }
    if (!this.io.mesh) {
      this.io.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial({
        vertexShader: auroraVertex, fragmentShader: auroraFragment, transparent: true, depthWrite: false, toneMapped: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { level: { value: 1 }, sunDir: { value: new THREE.Vector3(1, 0, 0) }, dayFade: { value: 0 } },
      }));
      this.io.mesh.frustumCulled = false;
      this.io.mesh.renderOrder = 4;
      g.add(this.io.mesh);
    }
    const geo = this.io.mesh.geometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('emission', new THREE.Float32BufferAttribute(em, 3));
    geo.setIndex(idx);
  }

  // ---- labels ----

  private poleTag(k: BodyKey, L: BodyLines, g: THREE.Group, camera: THREE.PerspectiveCamera, width: number, height: number): void {
    const { centre, m, tilt } = L.model.dipole, M = Math.hypot(...m);
    const end = this.v.set(centre[0] + (1.6 * m[0]) / M, centre[1] + (1.6 * m[1]) / M, centre[2] + (1.6 * m[2]) / M).applyMatrix4(g.matrix);
    const s = this.screen(end, camera, width, height);
    if (s) this.tag(s, `B ${tilt.toFixed(1)}°`, 'guide-tag mag-pole', `${BODY_BY_KEY[k].name}'s dipole (${L.model.name}): tilted ${tilt.toFixed(2)}° from the spin axis, its centre ${Math.round(Math.hypot(...centre) * L.model.a).toLocaleString('en-AU')} km from the planet's; field lines leave the surface at this end`);
  }

  private kpTag(g: THREE.Group, sunB: THREE.Vector3, L: BodyLines, camera: THREE.PerspectiveCamera, width: number, height: number): void {
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
    src.textContent = `${L.model.source}. Internal field only${k === 'jupiter' ? ', with the current sheet' : ''}: no magnetopause.`;
    this.legend.append(h, bar, ticks, unit, src);
  }

  dispose(): void {
    for (const k of [...this.lines.keys()]) this.drop(k);
    for (const gi of this.giant.values()) if (gi.mesh) { gi.mesh.geometry.dispose(); (gi.mesh.material as THREE.Material).dispose(); }
    if (this.io.mesh) { this.io.mesh.geometry.dispose(); (this.io.mesh.material as THREE.Material).dispose(); }
    for (const g of this.groups.values()) this.scene.remove(g);
    this.lineMat.dispose(); this.axisMat.dispose();
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
function mid(a: V3 | null, b: V3 | null): V3 | null {
  if (!a || !b) return a ?? b;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
