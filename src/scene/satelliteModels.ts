// src/scene/satelliteModels.ts
//
// The satellite the camera is on, as a small model at its true size once
// it is big enough to see (docs/frontend/satellites.md#close-up-models):
// the ISS and Hubble by NASA/JPL-Caltech's Eyes models (probeModels.ts
// SATELLITE_MODELS, loaded by craftAssets.ts), and until they load, built
// from boxes and cylinders at their published sizes; Tiangong built so
// (no free model is published); any other one as a stand-in bus with two
// wings. Far off, the point and its marker stand for it, as before.
//
// Attitude: the ISS and Tiangong fly the local vertical, local horizontal
// (LVLH) frame of their SGP4 state, as the ISS flies it (+XVV): x along
// the velocity's horizontal part (the ram direction), z down to the
// Earth's centre (nadir), y = z x x (opposite the orbit's angular
// momentum). The simple models' arrays turn about the body's y axis to
// face the Sun as nearly as one axis can; the ISS's real model turns each
// alpha joint, then each beta gimbal, as Eyes does. Hubble points
// wherever its observing schedule says, which the app does not have: it
// is drawn at its nominal roll (hubbleAxes), its arrays turned about V2
// to face the Sun.
//
// Light: the simple models' faces are Lambertian, ρ E μ0 with E the sunlight at the Earth
// relative to 1 AU, as the bodies are lit (bodyMaterial.ts), dimmed by the
// share of the Sun's disc the Earth and the Moon leave it (satellites.js
// sunFraction, as the points are). Earthshine fills the faces turned to
// the Earth: the Earth's Bond albedo (0.30) times the view factor of a face looking straight
// down at it, (R / r)^2, times how high the Sun stands under the
// satellite, max(0, ŝ · r̂). The cells have a small glint (Blinn-Phong).
// The real models keep their own (physically based) materials, lit by the
// same Sun and Earthshine as two directional lights, as craftModels.ts
// lights the probes' (sharing those when a craft model is lit too).
//
// Units: the model is built in metres and scaled to render units (1000
// km); it sits at its camera-relative render position, so float32 holds
// it to well under a millimetre.

import * as THREE from 'three';
import { sunFraction } from '@digital-orrery/physics/satellites.js';
import { dot, cross, unit } from '@digital-orrery/physics/vec.js';
import { asset, axisVec, type Asset } from './craftAssets';
import { SATELLITE_MODELS } from './probeModels';

type V3 = [number, number, number];
const UNIT_KM = 1000;
export const M_TO_RENDER = 1e-3 / UNIT_KM;
// The model shows when its largest size spans this many pixels, and the
// marker's dot gives way to it.
export const SHOW_PX = 3;
export const EARTH_BOND_ALBEDO = 0.30;   // (NASA Earth fact sheet)
export const R_EARTH_KM = 6371.0;

export type ModelKind = 'iss' | 'tiangong' | 'hubble' | 'generic';
const MODEL_OF: Record<number, ModelKind> = { 25544: 'iss', 48274: 'tiangong', 20580: 'hubble' };
export const modelOf = (id: number): ModelKind => MODEL_OF[id] ?? 'generic';
// Each model's largest size, metres: the ISS's array wingspan, Tiangong's
// lab wings tip to tip, Hubble's length, the stand-in's span.
export const MODEL_SPAN_M: Record<ModelKind, number> = { iss: 109, tiangong: 56, hubble: 13.2, generic: 12 };
export const MODEL_NOTE: Record<ModelKind, string> = {
  iss: 'Drawn close up by NASA/JPL-Caltech\'s ISS model from NASA\'s Eyes on the Earth, scaled to the 109 m across its arrays NASA gives (112 m as modelled). It shows the station of about 2020: Pirs where Nauka has been since July 2021, and none of Nauka, Prichal, the Bishop airlock or the roll-out arrays added since; its outside payloads come and go with the date, as Eyes shows them. Flown in its local vertical, local horizontal attitude (+XVV), each pair of wings turned on its alpha joint and each wing on its beta gimbal to face the Sun, as Eyes turns them; the radiators and the Russian segment\'s arrays stay as modelled. Until the model has loaded, a simple model at NASA\'s sizes stands in.',
  tiangong: 'No free model of Tiangong is published, so it is built in code at its designers\' published sizes (CAST): the 16.6 m Tianhe core along the flight direction and the 17.9 m Wentian and Mengtian labs at its two side ports, all 4.2 m across, in a T; each lab\'s two 27 m wings (over 110 m² each) at its far end, turned to the Sun. Tianhe\'s own smaller wings, moved to the labs, are left out. Its flight attitude is not published: it is drawn in the local vertical, local horizontal frame.',
  hubble: 'Drawn close up by NASA/JPL-Caltech\'s Hubble model from NASA\'s Eyes on the Earth, scaled to the 13.2 m length ESA gives. Where it points is set by its observing schedule, which the app does not have: its tube is drawn along or against its flight direction, whichever is farther from the Sun (Hubble keeps more than 62.5° from it), rolled as it flies at its nominal roll, with the Sun in the plane of its tube and the axis square to its arrays\' masts (STScI), and its arrays turned on their masts to face the Sun. Until the model has loaded, a simple model at ESA\'s sizes stands in.',
  generic: 'Drawn close up as a stand-in, not its own shape: a 2 m bus with two wings, 12 m across, pointing down at the Earth with its wings turned to the Sun.',
};

const vertex = /* glsl */ `
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
const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 albedo;       // linear reflectance
uniform float glint;       // the cells' specular share
uniform vec3 sunDir;       // render frame, unit
uniform vec3 down;         // to the Earth's centre, unit
uniform float sunlit;      // 0 in the Earth's shadow
uniform float earthFill;   // Earthshine on a face turned straight down
uniform float irradiance;  // sunlight relative to 1 AU
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  #include <logdepthbuf_fragment>
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;               // the arrays are thin: both faces lit
  vec3 v = normalize(-vWorld);
  float mu0 = max(dot(n, sunDir), 0.0) * sunlit;
  float fill = max(dot(n, down), 0.0) * earthFill;
  vec3 h = normalize(sunDir + v);
  float spec = glint * pow(max(dot(n, h), 0.0), 80.0) * sunlit * step(0.0, dot(n, sunDir));
  vec3 colour = (albedo * (mu0 + fill) + vec3(spec)) * irradiance;
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// The parts' finishes: linear reflectance and glint.
const FINISH = {
  white: { albedo: [0.72, 0.71, 0.68], glint: 0 },        // white paint and beta cloth
  metal: { albedo: [0.45, 0.45, 0.46], glint: 0.05 },     // truss, bare aluminium
  foil: { albedo: [0.62, 0.48, 0.24], glint: 0.1 },       // gold multi-layer insulation
  silver: { albedo: [0.62, 0.63, 0.65], glint: 0.15 },    // Hubble's aluminised blankets
  cells: { albedo: [0.06, 0.08, 0.16], glint: 0.35 },     // solar cells under cover glass, blue-black
  dark: { albedo: [0.08, 0.08, 0.08], glint: 0 },          // the aperture, a shadowed bay
  carbon: { albedo: [0.05, 0.05, 0.055], glint: 0.08 },   // bare carbon composite, black
  avcoat: { albedo: [0.12, 0.09, 0.07], glint: 0 },       // a charred ablative heat shield
} as const;
export type Finish = keyof typeof FINISH;

// One finish's material: the Lambertian faces, Sun and Earthshine
// uniforms as update() sets them (craftModels.ts shares it).
export function material(f: Finish): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide,
    uniforms: {
      albedo: { value: new THREE.Color().setRGB(FINISH[f].albedo[0], FINISH[f].albedo[1], FINISH[f].albedo[2]) }, glint: { value: FINISH[f].glint },
      sunDir: { value: new THREE.Vector3(1, 0, 0) }, down: { value: new THREE.Vector3(0, -1, 0) },
      sunlit: { value: 1 }, earthFill: { value: 0 }, irradiance: { value: 1 },
    },
  });
}

// A model: its group, the array pivots (turned about the body's y), and
// its materials.
interface Built { group: THREE.Group; pivots: THREE.Object3D[]; mats: THREE.ShaderMaterial[] }

function build(kind: ModelKind): Built {
  const group = new THREE.Group(), pivots: THREE.Object3D[] = [];
  const mats = new Map<Finish, THREE.ShaderMaterial>();
  const mat = (f: Finish) => { if (!mats.has(f)) mats.set(f, material(f)); return mats.get(f)!; };
  const box = (parent: THREE.Object3D, f: Finish, [sx, sy, sz]: V3, [x, y, z]: V3) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(f));
    m.position.set(x, y, z); parent.add(m); return m;
  };
  // A cylinder along the body's x.
  const tube = (parent: THREE.Object3D, f: Finish, r: number, len: number, [x, y, z]: V3, along: 'x' | 'y' = 'x') => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 24), mat(f));
    if (along === 'x') m.rotation.z = Math.PI / 2;
    m.position.set(x, y, z); parent.add(m); return m;
  };
  const pivot = (at: V3) => { const p = new THREE.Object3D(); p.position.set(...at); group.add(p); pivots.push(p); return p; };
  if (kind === 'iss') {
    // The integrated truss (94 m along y), above the modules (zenith is -z).
    box(group, 'metal', [4, 94, 3.5], [3, 0, -6]);
    // The pressurised modules, 67 m end to end along x, 4.2 m across (a
    // typical module's width); Kibo and Columbus out to the sides at the front.
    tube(group, 'white', 2.1, 67, [0, 0, 0]);
    tube(group, 'white', 2.1, 11, [27, -7.5, 0], 'y');
    tube(group, 'white', 2.1, 7, [27, 5.5, 0], 'y');
    // Eight array wings: four assemblies, two near each end of the truss,
    // each two wings 35.5 m long either side of its mast (73 m tip to
    // tip), about 12 m wide (the outer edges 109 m apart), turned on its
    // alpha joint about the truss.
    for (const y of [-48.5, -34.5, 34.5, 48.5]) {
      const p = pivot([3, y, -6]);
      for (const sgn of [-1, 1]) box(p, 'cells', [35.5, 12, 0.05], [sgn * (1 + 35.5 / 2), 0, 0]);
      box(p, 'metal', [2, 1, 1], [0, 0, 0]);
    }
  } else if (kind === 'tiangong') {
    // Tianhe along x, 16.6 m by 4.2 m; its node at the front, with the two
    // side ports the labs berth at.
    tube(group, 'white', 2.1, 16.6, [0, 0, 0]);
    // Wentian (right, +y) and Mengtian (left), 17.9 m by 4.2 m, out from
    // the node; their wings, 27 m long and about 4.1 m wide (110 m² over
    // 27 m), either side of a short truss at each lab's far end, turned
    // about the lab's axis.
    const xn = 7.2;
    for (const sgn of [-1, 1]) {
      tube(group, 'white', 2.1, 17.9, [xn, sgn * (2.1 + 17.9 / 2), 0], 'y');
      const p = pivot([xn, sgn * (2.1 + 17.9 - 1.5), 0]);
      box(p, 'metal', [2.4, 1, 1], [0, 0, 0]);
      for (const w of [-1, 1]) box(p, 'cells', [27, 4.1, 0.05], [w * (1.2 + 27 / 2), 0, 0]);
    }
  } else if (kind === 'hubble') {
    // The tube along x, its aperture door forward; 13.2 m by 4.2 m.
    tube(group, 'silver', 2.1, 13.2, [0, 0, 0]);
    const ap = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), mat('dark'));
    ap.rotation.y = Math.PI / 2; ap.position.set(6.61, 0, 0); group.add(ap);
    // Two arrays, 2.45 m by 7.56 m, out to the sides, turned on their masts.
    for (const sgn of [-1, 1]) {
      const p = pivot([0.5, sgn * 2.2, 0]);
      box(p, 'cells', [2.45, 7.56, 0.04], [0, sgn * (0.3 + 7.56 / 2), 0]);
    }
  } else {
    box(group, 'foil', [2, 2, 2], [0, 0, 0]);
    box(group, 'white', [0.6, 0.6, 0.6], [0, 0, 1.3]);   // its Earth-facing antenna
    for (const sgn of [-1, 1]) {
      const p = pivot([0, sgn * 1, 0]);
      box(p, 'cells', [2, 4.8, 0.04], [0, sgn * (0.2 + 2.4), 0]);
    }
  }
  group.scale.setScalar(M_TO_RENDER);
  return { group, pivots, mats: [...mats.values()] };
}


// The LVLH axes of a state (J2000 km, km/s): x ram, y = z x x, z nadir.
export function lvlhAxes(r: V3, v: V3): [V3, V3, V3] {
  const z = unit([-r[0], -r[1], -r[2]]);
  const h = unit(cross(r, v));                 // the orbit's pole
  const y: V3 = [-h[0], -h[1], -h[2]];
  return [cross(y, z), y, z];
}

// Hubble's axes V1 (the optical axis), V2 (the arrays' axis), V3 at its
// nominal roll, the Sun in the half-plane of +V1 and +V3 (STScI's HST
// Primer): V1 along or against its flight direction, whichever is farther
// from the Sun (so it never points within 90 deg of it; Hubble keeps over
// 62.5 deg), V2 square to V1 and the Sun.
export function hubbleAxes(r: V3, v: V3, sun: V3): [V3, V3, V3] {
  let x = unit(v);
  if (dot(x, sun) > 0) x = [-x[0], -x[1], -x[2]];
  let y = cross(sun, x);
  if (Math.hypot(y[0], y[1], y[2]) < 1e-6) y = cross(x, unit(cross(r, v)));   // the Sun straight behind: any roll
  y = unit(y);
  return [x, y, cross(x, y)];
}

// A real model as drawn: its joints (turned about axis from their rest
// rotation q0 to bring face as near the Sun as they can) and its dated
// nodes.
interface Real { group: THREE.Group; joints: { o: THREE.Object3D; q0: THREE.Quaternion; axis: THREE.Vector3; face: THREE.Vector3 }[]; dated: { o: THREE.Object3D; from: number; to: number }[] }

function buildReal(kind: 'iss' | 'hubble', A: Asset): Real {
  const P = SATELLITE_MODELS[kind], all = A.parts.get('all')!.clone();
  const group = new THREE.Group();
  group.add(all);
  group.scale.setScalar(M_TO_RENDER);
  const joints: Real['joints'] = [];
  for (const j of P.joints) {
    const o = all.getObjectByName(j.node);
    if (o) joints.push({ o, q0: o.quaternion.clone(), axis: axisVec(j.axis), face: axisVec(j.face) });
  }
  const dated: Real['dated'] = [];
  for (const d of P.dated ?? []) {
    const o = all.getObjectByName(d.node);
    if (o) dated.push({ o, from: Date.parse(d.from), to: d.to ? Date.parse(d.to) : Infinity });
  }
  return { group, joints, dated };
}

export class SatelliteModel {
  private built: Built | null = null;
  private real: Real | null = null;
  private sig: string | null = null;
  private m = new THREE.Matrix4();
  private vx = new THREE.Vector3(); private vy = new THREE.Vector3(); private vz = new THREE.Vector3();
  private sun = new THREE.Vector3(); private dn = new THREE.Vector3();
  private q = new THREE.Quaternion(); private qa = new THREE.Quaternion(); private sl = new THREE.Vector3(); private fx = new THREE.Vector3();
  // The real models' light, as CraftModels': the Sun and the Earthshine as
  // two directional lights (pi times the simple models' irradiance), off
  // unless a real model shows and the craft models have not lit theirs this
  // frame (then theirs, set near the Earth too, light this one).
  private sunLight = new THREE.DirectionalLight(0xffffff, 0);
  private earthLight = new THREE.DirectionalLight(0xffffff, 0);
  shown = false;

  constructor(private scene: THREE.Scene) {
    for (const l of [this.sunLight, this.earthLight]) scene.add(l, l.target);
  }

  // Each frame, for the focused satellite: its NORAD id, SGP4 state (J2000
  // km, km/s), its camera-relative ecliptic place (km), the Sun's
  // direction (J2000 unit), J2000 -> render, the pixels per radian, the
  // Moon (J2000 km from the Earth), the time (UTC ms) and whether the
  // lights are free (the craft models have not lit theirs).
  update(id: number | null, s: { r: V3; v: V3 } | null, rel: V3 | null, sunEqj: V3, toRender: THREE.Matrix3, pxPerRad: number, moonEqj: V3 | null = null, timeMs = 0, lightFree = true): boolean {
    const kind = id !== null ? modelOf(id) : null;
    const d = rel ? Math.hypot(rel[0], rel[1], rel[2]) : Infinity;
    const px = kind ? (MODEL_SPAN_M[kind] / 1000 / d) * pxPerRad : 0;
    if (!kind || !s || !rel || px < SHOW_PX) { this.hide(); return false; }
    // The real model once it has loaded (the first ask starts the load).
    const A = kind === 'iss' || kind === 'hubble' ? asset(`sat:${kind}`) : null;
    const sig = `${kind}${A ? ':real' : ''}`;
    if (sig !== this.sig) {
      this.drop();
      if (A) { this.real = buildReal(kind as 'iss' | 'hubble', A); this.scene.add(this.real.group); }
      else { this.built = build(kind); this.scene.add(this.built.group); }
      this.sig = sig;
    }
    const group = (this.real ?? this.built)!.group;
    const [X, Y, Z] = kind === 'hubble' ? hubbleAxes(s.r, s.v, sunEqj) : lvlhAxes(s.r, s.v);
    const toR = (a: V3, out: THREE.Vector3) => out.set(a[0], a[1], a[2]).applyMatrix3(toRender);
    this.m.makeBasis(toR(X, this.vx), toR(Y, this.vy), toR(Z, this.vz));
    group.quaternion.setFromRotationMatrix(this.m);
    group.position.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM);
    // The share of the Sun the Earth and the Moon leave (a penumbra dims it).
    const lit = sunFraction(s.r, sunEqj, moonEqj).nu;
    const rr = Math.hypot(...s.r), nadir = unit([-s.r[0], -s.r[1], -s.r[2]]);
    const fill = EARTH_BOND_ALBEDO * (R_EARTH_KM / rr) ** 2 * Math.max(0, -dot(sunEqj, nadir));
    toR(sunEqj, this.sun).normalize();
    toR(nadir, this.dn).normalize();
    if (this.real) this.pose(this.real, timeMs);
    else {
      // The arrays: turned about y so their faces' normal is the Sun's
      // direction in the body's x-z plane.
      const alpha = Math.atan2(dot(sunEqj, X), dot(sunEqj, Z));
      for (const p of this.built!.pivots) p.rotation.set(0, alpha, 0);
      for (const mat of this.built!.mats) {
        const u = mat.uniforms;
        (u.sunDir.value as THREE.Vector3).copy(this.sun);
        (u.down.value as THREE.Vector3).copy(this.dn);
        u.sunlit.value = lit; u.earthFill.value = fill;
      }
    }
    const lights = !!this.real && lightFree;
    if (lights) {
      const at = group.position;
      this.sunLight.position.copy(at).add(this.sun); this.sunLight.target.position.copy(at);
      this.earthLight.position.copy(at).add(this.dn); this.earthLight.target.position.copy(at);
      this.sunLight.target.updateMatrixWorld(); this.earthLight.target.updateMatrixWorld();
    }
    this.sunLight.intensity = lights ? Math.PI * lit : 0;
    this.earthLight.intensity = lights ? Math.PI * fill : 0;
    group.visible = true;
    this.shown = true;
    return true;
  }

  // A real model's dated nodes for the time, and each joint, parents
  // first, turned about its axis from its rest rotation so its face points
  // as near the Sun (this.sun, render frame) as that axis lets.
  private pose(R: Real, timeMs: number): void {
    for (const d of R.dated) d.o.visible = timeMs >= d.from && timeMs < d.to;
    R.group.updateMatrixWorld(true);
    for (const j of R.joints) {
      // The Sun in the joint's frame at rest: its parent's world rotation,
      // then its rest rotation, undone.
      j.o.parent!.getWorldQuaternion(this.q);
      this.sl.copy(this.sun).applyQuaternion(this.q.invert()).applyQuaternion(this.qa.copy(j.q0).invert());
      // The angle about the axis from the face to the Sun, both projected
      // square to it.
      const a = j.axis, f = this.fx.copy(j.face).addScaledVector(a, -a.dot(j.face));
      this.sl.addScaledVector(a, -a.dot(this.sl));
      const th = Math.atan2(a.dot(this.vx.crossVectors(f, this.sl)), f.dot(this.sl));
      j.o.quaternion.copy(j.q0).multiply(this.qa.setFromAxisAngle(a, th));
      j.o.updateMatrixWorld(true);
    }
  }

  hide(): void { const g = (this.real ?? this.built)?.group; if (g) g.visible = false; this.shown = false; this.sunLight.intensity = this.earthLight.intensity = 0; }

  private drop(): void {
    if (this.built) {
      this.scene.remove(this.built.group);
      this.built.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      for (const m of this.built.mats) m.dispose();
      this.built = null;
    }
    // A real model's meshes are shared with the loaded asset.
    if (this.real) { this.scene.remove(this.real.group); this.real = null; }
    this.sig = null;
  }

  dispose(): void {
    this.drop();
    for (const l of [this.sunLight, this.earthLight]) { this.scene.remove(l, l.target); l.dispose(); }
  }
}
