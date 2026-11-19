// src/scene/craftModels.ts
//
// The app's own craft as small models at their true sizes, once they span
// 3 pixels (docs/frontend/mission.md#close-up-models), lit as the
// satellites' models are (satelliteModels.ts, whose materials these share):
//
// - Orion: the crew module on its adapter, the European Service Module and
//   its main engine, and the four solar array wings, each turned about its
//   own length to face the Sun; after separation the crew module alone,
//   heat shield aft.
// - The MISSION tab's craft: the 2 by 2 by 3 m box its attitude is sized
//   for (craftAttitude.js), with an engine bell aft.
// - A spacecraft beyond Earth, or the MISSION tab's Juno, DART, LRO or
//   MESSENGER: NASA's own model (probeModels.ts, craftAssets.ts), drawn
//   only once it has loaded (the marker stands in until then). The app
//   carries none of their attitudes: each is turned here with its arrays,
//   shields or antenna to the Sun (or the Earth), its up as near the
//   ecliptic's north as is square to that; Juno turns its main engine
//   along a burn while one fires, its arrays as near the Sun as that lets.
// - LICIACube, the CubeSat DART releases: a 6U box (probeModels.ts).
// - A ROCKET tab stack (src/physics/stackShape.js): each stage and the
//   payload as cylinders and cones at their lengths and diameters, the
//   engines' bells in each stage's lower end, the interstage closed over
//   them while the stage below is attached. Built from its base, so on the
//   pad it stands on the ground. A spent stage is the same parts from that
//   stage down to the next.
//
// Each is built along its body axes: +x the thrust axis (the nose), the
// engines aft. The plume, lit while the engine burns, is a soft additive
// cone aft of the engines, drawn at a fixed radiance: it shows what is
// firing, not how bright an exhaust is.
//
// Light: Lambertian by the Sun at its distance (E relative to 1 AU), the
// share of its disc left (OrreryScene.sunlightAt, the bodies' penumbral
// cones; near the ground, how much of the Sun stands above the horizon),
// and the Earthshine on faces turned to the Earth, as satelliteModels.ts.

import * as THREE from 'three';
import { material, M_TO_RENDER, SHOW_PX, EARTH_BOND_ALBEDO, R_EARTH_KM, type Finish } from './satelliteModels';
import { partsFrom } from '../physics/stackShape.js';
import { asset, axisVec, type Asset } from './craftAssets';
import { PROBE_MODELS, LICIACUBE, LICIACUBE_NOTE, probeNote, type Axis } from './probeModels';
import { dot } from '../physics/vec.js';

type V3 = [number, number, number];
const AU_KM = 1.495978707e8;
const UNIT_KM = 1000;

export interface StackPart { name: string; length: number; diameter: number; top?: number; finish: Finish; stage?: number; engine?: { length: number; exit: number; count: number; spread?: number }; skirt?: Finish; legs?: boolean; gridFins?: boolean }
export interface StackShape { key: string | null; published: boolean; total: number; span: number; parts: StackPart[]; est: string[] }

export type CraftModelSpec =
  | { kind: 'orion' }
  | { kind: 'capsule' }
  | { kind: 'box' }
  | { kind: 'stack'; shape: StackShape; from: number; to?: number }
  | { kind: 'probe'; key: string }
  | { kind: 'cubesat' };

// A model to draw this frame: its key (one per drawn thing), what it is,
// its heliocentric ecliptic place (km), its body axes (ecliptic unit
// vectors) and whether its engine burns. A probe's axes are its own pointing
// (CraftModels turns it); burn: the direction of the burn firing, if any
// (ecliptic unit vector), for a probe whose engine the model shows.
export interface ModelPose { key: string; spec: CraftModelSpec; rEcl: V3; axes: [V3, V3, V3]; firing: boolean; burn?: V3 }

// Orion's sizes (m), from NASA's Orion by the Numbers [2], its ESM page
// [3] unless said: the crew module 3.35 m high and 5 m across; the service
// module 4.79 m high; the two together 7.9 m, so the crew module's heat
// shield sits 0.24 m into the adapter; the ESM itself about 4 m high with
// its main engine [3], its body about 2 m [4], the engine the rest;
// four wings of three 2 by 2 m panels, each wing nearly 7 m long [3],
// 18.9 m tip to tip [2]. Not published, taken to fit: the ESM body's
// 4.1 m width, the crew module's backshell as a cone to 2 m across and a
// docking tunnel, and the main engine's bell.
const ORION = {
  cmH: 3.35, cmD: 5.03, smH: 4.79, total: 7.9, esmBody: 2.0, esmD: 4.1, cmaD: 5.0,
  wingSpan: 18.9, wingLen: 7.0, panel: 2.0, panels: 3,
  bell: { length: 1.9, exit: 1.1 },
};
const CM_CONE_H = 2.6, CM_TOP_D = 2.0, TUNNEL_D = 1.4;

export const ORION_NOTE = 'Drawn close up by NASA/JPL-Caltech\'s Artemis II model from NASA\'s Eyes on the Solar System: the crew module, the European Service Module and its four wings as flown, at the model\'s own size (the crew module 5.08 m across and 3.36 m high; NASA gives 5 m and 3.35 m). Its wings stay as modelled, about 20.9 m tip to tip where NASA gives 18.9 m, and do not turn to the Sun. Until the model has loaded, and if it cannot, a simple model at NASA\'s published sizes stands in.';
export const CAPSULE_NOTE = 'Drawn close up as the crew module alone, from NASA/JPL-Caltech\'s Artemis II model (Eyes on the Solar System), heat shield first.';
export const BOX_NOTE = 'Drawn close up as the box its attitude is sized for: 2 by 2 by 3 m, long along the thrust axis, with an engine bell aft.';
export const ATTITUDE_NOTE = {
  carried: 'Turned by its attitude, the engine aft.',
  orion: 'The app does not carry Orion\'s attitude: it is drawn nose along its velocity, and along the burn while one fires.',
  point: 'A point mass, with no attitude: drawn nose along its velocity.',
};

const SPAN: Record<'orion' | 'capsule' | 'box', number> = { orion: ORION.wingSpan, capsule: ORION.cmD, box: 3 };
export function modelSpan(spec: CraftModelSpec): number {
  return spec.kind === 'stack' ? spec.shape.span : spec.kind === 'probe' ? PROBE_MODELS[spec.key].span : spec.kind === 'cubesat' ? LICIACUBE.size[0] : SPAN[spec.kind];
}
// What the plate says of a stack's model.
export function stackNote(shape: StackShape): string {
  if (shape.key === 'saturn-v') return 'Drawn close up by NASA\'s Saturn V model (NASA 3D Resources), stretched to the published 363 ft long and 33 ft across (it is 7 % longer for its width than the real one) and cut at the stages\' joints, each stage dropped as it separates. Until the model has loaded, a simple model at the published sizes stands in.';
  const est = shape.est.length ? ` Not published, and worked out: ${shape.est.join('; ')}.` : '';
  return `Drawn close up as cylinders and cones at ${shape.published ? 'the published sizes' : 'sizes worked out from its stages'}, ${shape.total.toFixed(1)} m from its base to its nose, each stage dropped as it separates.${est} Fins, fairings' seams and the pad's tower are left out.`;
}
export function modelNote(spec: CraftModelSpec): string {
  return spec.kind === 'orion' ? ORION_NOTE : spec.kind === 'capsule' ? CAPSULE_NOTE : spec.kind === 'box' ? BOX_NOTE
    : spec.kind === 'probe' ? probeNote(spec.key) : spec.kind === 'cubesat' ? LICIACUBE_NOTE : stackNote(spec.shape);
}

const plumeVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying float vAlong;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vAlong = uv.y;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;
const plumeFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 colour;
uniform float radiance;
varying float vAlong;   // 1 at the nozzle, 0 at the far end
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  float edge = abs(dot(normalize(vNormal), normalize(-vWorld)));
  float a = pow(clamp(vAlong, 0.0, 1.0), 2.2) * edge;   // clamped: pow of a hair below 0 is NaN
  gl_FragColor = vec4(colour * radiance * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
function plumeMaterial(radiance: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: plumeVertex, fragmentShader: plumeFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { colour: { value: new THREE.Color().setRGB(1.0, 0.62, 0.3) }, radiance: { value: radiance } },
  });
}

// A model: its group, its wing arms (each turned about its own y, the
// wing's length) and their pivots, its plume and its materials.
interface Built { group: THREE.Group; wings: { arm: THREE.Object3D; pivot: THREE.Object3D }[]; plume: THREE.Object3D | null; mats: THREE.ShaderMaterial[]; plumeMats: THREE.ShaderMaterial[]; sig: string }

class Kit {
  group = new THREE.Group();
  mats = new Map<Finish, THREE.ShaderMaterial>();
  plumeMats: THREE.ShaderMaterial[] = [];
  // An empty model (a probe before its model loads is never built).
  built(): Built { return { group: this.group, wings: [], plume: null, mats: [], plumeMats: [], sig: 'none' }; }
  mat(f: Finish) { if (!this.mats.has(f)) this.mats.set(f, material(f)); return this.mats.get(f)!; }
  // A cylinder or cone along x from x0 to x0 + len, diameters d0 at x0
  // and d1 at the far end.
  along(parent: THREE.Object3D, f: Finish, x0: number, len: number, d0: number, d1 = d0, open = false, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(d1 / 2, d0 / 2, len, 32, 1, open), this.mat(f));
    m.rotation.z = -Math.PI / 2;               // the cylinder's +y to +x
    m.position.set(x0 + len / 2, y, z); parent.add(m); return m;
  }
  box(parent: THREE.Object3D, f: Finish, [sx, sy, sz]: V3, [x, y, z]: V3): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), this.mat(f));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  // Bells under a base at x0: count of them, the outer ones on a ring at
  // spread of the radius R, the centre one when count is 5 or 9.
  bells(x0: number, e: { length: number; exit: number; count: number; spread?: number }, R: number): void {
    const centre = e.count === 1 || e.count === 5 || e.count === 9, ring = e.count - (centre ? 1 : 0);
    const at: [number, number][] = centre ? [[0, 0]] : [];
    for (let i = 0; i < ring; i++) { const a = (2 * Math.PI * i) / ring + Math.PI / 4; at.push([Math.cos(a) * (e.spread ?? 0.6) * R, Math.sin(a) * (e.spread ?? 0.6) * R]); }
    for (const [y, z] of at) this.along(this.group, 'dark', x0, e.length, e.exit, e.exit * 0.35, true, y, z);
  }
  // A plume aft of x0 (along -x), d across at the nozzles, two cones: a
  // bright core and a soft sheath.
  plume(x0: number, d: number): THREE.Object3D {
    const g = new THREE.Group();
    for (const [len, d0, d1, rad] of [[3 * d, 0.9 * d, 1.6 * d, 1.2], [1.6 * d, 0.6 * d, 0.5 * d, 3.0]]) {
      const m = plumeMaterial(rad); this.plumeMats.push(m);
      // uv.y is 1 at the top of a CylinderGeometry: the nozzle end, here at x0.
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(d0 / 2, d1 / 2, len, 24, 1, true), m);
      mesh.rotation.z = -Math.PI / 2; mesh.position.set(x0 - len / 2, 0, 0);
      mesh.renderOrder = 2; g.add(mesh);
    }
    g.visible = false; this.group.add(g); return g;
  }
}

function buildOrion(capsule: boolean): Built {
  const k = new Kit(), O = ORION, wings: Built['wings'] = [];
  // From aft: the bell, the ESM body, the adapter, then the crew module,
  // with x = 0 at the middle of the 7.9 m.
  const aft = -O.total / 2;
  let plume: THREE.Object3D | null = null;
  const cm0 = capsule ? -O.cmH / 2 : aft + O.smH - (O.cmH + O.smH - O.total);
  if (!capsule) {
    const xe = aft + (O.smH - 0.79 - O.esmBody);     // the bell's top, the ESM body's base
    k.along(k.group, 'dark', aft, xe - aft, O.bell.exit, O.bell.exit * 0.4, true);
    k.along(k.group, 'white', xe, O.esmBody, O.esmD);
    k.along(k.group, 'white', xe + O.esmBody, 0.79, O.cmaD);
    // Four wings, from the ESM body's side out to 9.45 m from the axis: a
    // strut, then three panels.
    const root = O.wingSpan / 2 - O.wingLen, xw = xe + O.esmBody / 2;
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Object3D(); arm.position.set(xw, 0, 0); arm.rotation.x = (i * Math.PI) / 2 + Math.PI / 4; k.group.add(arm);
      const pivot = new THREE.Object3D(); arm.add(pivot);
      const strut = O.wingLen - O.panels * O.panel;
      k.box(pivot, 'metal', [0.3, root + strut - O.esmD / 2, 0.15], [0, (O.esmD / 2 + root + strut) / 2, 0]);
      for (let p = 0; p < O.panels; p++) k.box(pivot, 'cells', [O.panel, O.panel * 0.98, 0.04], [0, root + strut + O.panel * (p + 0.5), 0]);
      wings.push({ arm, pivot });
    }
    plume = k.plume(aft, O.bell.exit);
  }
  // The crew module: the heat shield, the backshell cone, the tunnel.
  k.along(k.group, 'avcoat', cm0 - 0.12, 0.12, O.cmD * 0.98, O.cmD);
  k.along(k.group, 'silver', cm0, CM_CONE_H, O.cmD, CM_TOP_D);
  k.along(k.group, 'silver', cm0 + CM_CONE_H, O.cmH - CM_CONE_H, TUNNEL_D);
  return { group: k.group, wings, plume, mats: [...k.mats.values()], plumeMats: k.plumeMats, sig: capsule ? 'capsule' : 'orion' };
}

function buildBox(): Built {
  const k = new Kit();
  k.box(k.group, 'foil', [3, 2, 2], [0, 0, 0]);
  k.along(k.group, 'dark', -2.1, 0.6, 0.7, 0.3, true);
  const plume = k.plume(-2.1, 0.7);
  return { group: k.group, wings: [], plume, mats: [...k.mats.values()], plumeMats: k.plumeMats, sig: 'box' };
}

function buildCubesat(): Built {
  const k = new Kit();
  k.box(k.group, 'foil', LICIACUBE.size, [0, 0, 0]);
  return { group: k.group, wings: [], plume: null, mats: [...k.mats.values()], plumeMats: k.plumeMats, sig: 'cubesat' };
}

// A stack from stage `from` up (to below stage `to`, for a spent stage),
// its base at x = 0.
function buildStack(shape: StackShape, from: number, to?: number): Built {
  const k = new Kit();
  let parts = partsFrom(shape, from) as StackPart[];
  if (to !== undefined) parts = parts.filter((p) => p.stage !== undefined && p.stage < to);
  let x = 0, plume: THREE.Object3D | null = null;
  parts.forEach((p, i) => {
    const e = p.engine, below = i > 0 ? parts[i - 1] : null;
    const eh = e ? Math.min(e.length, p.length * 0.5) : 0;
    if (e) {
      k.bells(x, { ...e, length: eh }, p.diameter / 2);
      // The interstage over the bells while a stage below is attached.
      if (below) k.along(k.group, p.skirt ?? p.finish, x, eh, below.top ?? below.diameter, p.diameter, true);
      if (!below) plume = k.plume(x, p.diameter * 0.9);
    }
    k.along(k.group, p.finish, x + eh, p.length - eh, p.diameter, p.top ?? p.diameter);
    const R = p.diameter / 2;
    // A booster's four legs folded along its lower body, between them four
    // grid fins stowed flat under the interstage (Falcon 9's, to fit).
    const around = (a: number, f: Finish, [sx, sy, sz]: V3, at: number, out: number) => {
      const arm = new THREE.Object3D(); arm.rotation.x = a; k.group.add(arm);
      k.box(arm, f, [sx, sy, sz], [at, R + out, 0]);
    };
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2;
      if (p.legs) { around(a + Math.PI / 4, 'carbon', [Math.min(9, p.length * 0.25), 0.3, 0.9], x + 0.3 + Math.min(9, p.length * 0.25) / 2, 0.15); around(a + Math.PI / 4, 'carbon', [0.6, 0.5, 1.0], x + 0.3, 0.25); }
      if (p.gridFins) around(a, 'metal', [1.4, 0.15, 1.2], x + p.length - 1.2, 0.08);
    }
    x += p.length;
  });
  return { group: k.group, wings: [], plume, mats: [...k.mats.values()], plumeMats: k.plumeMats, sig: `stack:${shape.key}:${from}:${to ?? ''}` };
}

// The stages' joints (m from the base) of a shape: the tops of all but
// its last stage, which carries the payload.
function joints(shape: StackShape): number[] {
  const out: number[] = [];
  let x = 0;
  shape.parts.forEach((p, i) => {
    x += p.length;
    const next = shape.parts[i + 1];
    if (p.stage !== undefined && next?.stage !== undefined && next.stage !== p.stage) out.push(x);
  });
  return out;
}
// The real model a spec is drawn by, if it has one and it has loaded (the
// first ask starts the load: craftAssets.ts).
function assetOf(spec: CraftModelSpec): Asset | null {
  if (spec.kind === 'orion' || spec.kind === 'capsule') return asset('orion');
  if (spec.kind === 'stack' && spec.shape.key === 'saturn-v') return asset('saturn-v', joints(spec.shape));
  if (spec.kind === 'probe') return asset(`probe:${spec.key}`);
  return null;
}

// A probe model's axis a (in the model's own axes) in its body axes: the
// Sun (or Earth) axis is +x, its up +z (craftAssets.ts).
function bodyAxis(key: string, a: Axis): THREE.Vector3 {
  const P = PROBE_MODELS[key], fx = axisVec((P.sun ?? P.earth)!), fz = axisVec(P.up), fy = new THREE.Vector3().crossVectors(fz, fx), v = axisVec(a);
  return new THREE.Vector3(v.dot(fx), v.dot(fy), v.dot(fz));
}
// Body axes (ecliptic) turning body vector u to world U, and body v as
// near world V as is square to that (TRIAD).
function triad(u: number[], v: number[], U: number[], V: number[]): [V3, V3, V3] {
  const unitv = (a: number[]) => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };
  const cr = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const b1 = unitv(u), b2 = unitv(cr(u, v)), b3 = cr(b1, b2);
  const w1 = unitv(U), w2 = unitv(cr(U, V)), w3 = cr(w1, w2);
  const col = (i: number): V3 => [0, 1, 2].map((k) => w1[k] * b1[i] + w2[k] * b2[i] + w3[k] * b3[i]) as V3;
  return [col(0), col(1), col(2)];
}
const parallel = (a: number[], b: number[]) => Math.abs(dot(a, b)) / (Math.hypot(a[0], a[1], a[2]) * Math.hypot(b[0], b[1], b[2])) > 0.99;
// A probe's axes: its Sun (or Earth) axis to the Sun (or Earth), its up
// toward the ecliptic's north; while a burn fires on a model whose engine
// is known, its thrust along the burn and its Sun axis as near the Sun.
export function probeAxes(key: string, rEcl: V3, sunEcl: V3, earthEcl: V3, burn?: V3): [V3, V3, V3] {
  const P = PROBE_MODELS[key], at = P.earth ? earthEcl : sunEcl;
  const T = [at[0] - rEcl[0], at[1] - rEcl[1], at[2] - rEcl[2]], N = [0, 0, 1];
  if (burn && P.thrust) {
    const tb = bodyAxis(key, P.thrust).toArray();
    return parallel(tb, [1, 0, 0]) ? triad(tb, [0, 0, 1], burn, parallel(burn, N) ? [1, 0, 0] : N) : triad(tb, [1, 0, 0], burn, parallel(burn, T) ? N : T);
  }
  return triad([1, 0, 0], [0, 0, 1], T, parallel(T, N) ? [1, 0, 0] : N);
}

// A model from a loaded asset: its parts' shared meshes placed in the body
// axes, base or centre as the simple models have it, and the same plume.
function buildAsset(spec: CraftModelSpec, A: Asset): Built {
  const k = new Kit(), inner = new THREE.Group();
  k.group.add(inner);
  let plume: THREE.Object3D | null = null;
  if (spec.kind === 'probe') {
    inner.add(A.parts.get('all')!.clone());
    const t = PROBE_MODELS[spec.key].thrust;
    if (t) {
      // The engine aft, along -thrust (in body axes), at the bounds' face.
      const tb = bodyAxis(spec.key, t), box = A.box!;
      let aft = Infinity;                       // the nearest the bounds reach along thrust
      for (let c = 0; c < 8; c++) aft = Math.min(aft, (c & 1 ? box.max.x : box.min.x) * tb.x + (c & 2 ? box.max.y : box.min.y) * tb.y + (c & 4 ? box.max.z : box.min.z) * tb.z);
      const holder = new THREE.Group();
      holder.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), tb);
      k.group.add(holder);
      plume = k.plume(aft, 0.4);
      holder.add(plume);
    }
    return { group: k.group, wings: [], plume, mats: [], plumeMats: k.plumeMats, sig: `${sigOf(spec)}:asset` };
  }
  if (spec.kind === 'stack') {
    const cuts = A.cuts ?? [], to = spec.to ?? cuts.length + 1;
    for (let i = spec.from; i < to; i++) { const p = A.parts.get(`stage${i}`); if (p) inner.add(p.clone()); }
    inner.position.x = -(spec.from > 0 ? cuts[spec.from - 1] : 0);
    const lowest = (partsFrom(spec.shape, spec.from) as StackPart[])[0];
    if (spec.to === undefined) plume = k.plume(0, lowest.diameter * 0.9);
  } else {
    inner.add(A.parts.get('cm')!.clone());
    if (spec.kind === 'orion') { inner.add(A.parts.get('sm')!.clone()); plume = k.plume(A.base, ORION.bell.exit); }
    else inner.position.x = -(0.4 + ORION.cmH / 2);              // the crew module about its middle
  }
  return { group: k.group, wings: [], plume, mats: [], plumeMats: k.plumeMats, sig: `${sigOf(spec)}:asset` };
}

function build(spec: CraftModelSpec): Built {
  const A = assetOf(spec);
  const b = A ? buildAsset(spec, A) : spec.kind === 'cubesat' ? buildCubesat() : spec.kind === 'orion' ? buildOrion(false) : spec.kind === 'capsule' ? buildOrion(true) : spec.kind === 'box' ? buildBox() : spec.kind === 'stack' ? buildStack(spec.shape, spec.from, spec.to) : new Kit().built();
  b.group.scale.setScalar(M_TO_RENDER);
  return b;
}
const sigOf = (s: CraftModelSpec) => (s.kind === 'stack' ? `stack:${s.shape.key}:${s.from}:${s.to ?? ''}` : s.kind === 'probe' ? `probe:${s.key}` : s.kind);
const fullSig = (s: CraftModelSpec) => `${sigOf(s)}${assetOf(s) ? ':asset' : ''}`;

const toRender = (a: number[], out: THREE.Vector3) => out.set(a[0], a[2], -a[1]);

export interface ModelLight {
  sunEcl: V3;                                     // the Sun's place, heliocentric ecliptic km
  earthEcl: V3;                                   // the Earth's
  shade: ((r: V3) => { nu: number }) | null;      // the share of the Sun at a point
}

export class CraftModels {
  private built = new Map<string, Built>();
  private m = new THREE.Matrix4();
  private vx = new THREE.Vector3(); private vy = new THREE.Vector3(); private vz = new THREE.Vector3();
  private sun = new THREE.Vector3(); private dn = new THREE.Vector3();
  private pxPerRad = 1000;
  // The real models' light (their materials are three's): the Sun and the
  // Earthshine as two directional lights, set from the first model drawn.
  // Three's Lambertian term is albedo / pi times the light, so each is pi
  // times the simple models' irradiance. Only the satellites' real models
  // (satelliteModels.ts) are lit by three's lights besides.
  private sunLight = new THREE.DirectionalLight(0xffffff, 0);
  private earthLight = new THREE.DirectionalLight(0xffffff, 0);
  private lightSet = false;

  constructor(private scene: THREE.Scene) {
    for (const l of [this.sunLight, this.earthLight]) { scene.add(l, l.target); }
  }

  // Whether a model was drawn and lit this frame (the satellites' real
  // models then share these lights: satelliteModels.ts).
  get lit(): boolean { return this.lightSet; }

  // The view's scale: pixels per radian at the centre.
  setView(pxPerRad: number): void { this.pxPerRad = pxPerRad; }

  // Each frame, before rendering: every pose that spans SHOW_PX drawn at
  // its camera-relative place. Returns the keys drawn.
  update(poses: ModelPose[], cam: V3, light: ModelLight): Set<string> {
    const shown = new Set<string>();
    this.lightSet = false;
    for (const p of poses) {
      const rel: V3 = [p.rEcl[0] - cam[0], p.rEcl[1] - cam[1], p.rEcl[2] - cam[2]];
      const d = Math.hypot(rel[0], rel[1], rel[2]);
      if ((modelSpan(p.spec) / 1000 / d) * this.pxPerRad < SHOW_PX) continue;
      // A probe is drawn only by its model (the first ask starts the load).
      if (p.spec.kind === 'probe' && !assetOf(p.spec)) continue;
      let b = this.built.get(p.key);
      if (b && b.sig !== fullSig(p.spec)) { this.drop(p.key); b = undefined; }
      if (!b) { b = build(p.spec); this.built.set(p.key, b); this.scene.add(b.group); }
      this.place(b, p, rel, light);
      shown.add(p.key);
    }
    if (!this.lightSet) this.sunLight.intensity = this.earthLight.intensity = 0;
    for (const [key, b] of this.built) if (!shown.has(key)) { if (poses.some((p) => p.key === key)) b.group.visible = false; else this.drop(key); }
    return shown;
  }

  private place(b: Built, p: ModelPose, rel: V3, L: ModelLight): void {
    const [X, Y, Z] = p.spec.kind === 'probe' ? probeAxes(p.spec.key, p.rEcl, L.sunEcl, L.earthEcl, p.firing ? p.burn : undefined) : p.axes;
    this.m.makeBasis(toRender(X, this.vx), toRender(Y, this.vy), toRender(Z, this.vz));
    b.group.quaternion.setFromRotationMatrix(this.m);
    b.group.position.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM);
    b.group.visible = true;
    // The Sun from here, in body axes for the wings.
    const s = [L.sunEcl[0] - p.rEcl[0], L.sunEcl[1] - p.rEcl[1], L.sunEcl[2] - p.rEcl[2]], ds = Math.hypot(s[0], s[1], s[2]);
    const su = [s[0] / ds, s[1] / ds, s[2] / ds], sb = [dot(su, X), dot(su, Y), dot(su, Z)];
    for (const w of b.wings) {
      // The Sun in the arm's frame (turned by a about x), then the wing
      // turned about its length (y) to face it.
      const a = w.arm.rotation.x, c = Math.cos(a), sn = Math.sin(a);
      const sx = sb[0], sz = -sn * sb[1] + c * sb[2];
      w.pivot.rotation.set(0, Math.atan2(sx, sz), 0);
    }
    // Earth: its direction, the Earthshine, and near the ground the Sun's
    // height above the horizon.
    const e = [L.earthEcl[0] - p.rEcl[0], L.earthEcl[1] - p.rEcl[1], L.earthEcl[2] - p.rEcl[2]], re = Math.hypot(e[0], e[1], e[2]);
    const down = [e[0] / re, e[1] / re, e[2] / re], sunUp = -dot(su, down);
    let lit: number;
    if (re < R_EARTH_KM + 100) {
      // Near the ground the Earth hides the Sun below the horizon (and the
      // bodies' cones, inside the equatorial radius, do not hold): the share
      // of its disc (0.27 deg in radius) above the local horizon.
      const h = Math.asin(Math.max(-1, Math.min(1, sunUp))) - Math.acos(Math.min(1, R_EARTH_KM / re));
      lit = Math.max(0, Math.min(1, 0.5 + h / (2 * 0.00466)));
    } else lit = L.shade?.(p.rEcl).nu ?? 1;
    const fill = EARTH_BOND_ALBEDO * Math.min(1, (R_EARTH_KM / re) ** 2) * Math.max(0, sunUp);
    const irr = (AU_KM / ds) ** 2;
    toRender(su, this.sun);
    toRender(down, this.dn);
    for (const mat of b.mats) {
      const u = mat.uniforms;
      (u.sunDir.value as THREE.Vector3).copy(this.sun);
      (u.down.value as THREE.Vector3).copy(this.dn);
      u.sunlit.value = lit; u.earthFill.value = fill; u.irradiance.value = irr;
    }
    if (b.plume) b.plume.visible = p.firing;
    if (!this.lightSet) {
      this.lightSet = true;
      const at = b.group.position;
      this.sunLight.position.copy(at).add(this.sun); this.sunLight.target.position.copy(at);
      this.earthLight.position.copy(at).add(this.dn); this.earthLight.target.position.copy(at);
      this.sunLight.intensity = Math.PI * irr * lit;
      this.earthLight.intensity = Math.PI * irr * fill;
      this.sunLight.target.updateMatrixWorld(); this.earthLight.target.updateMatrixWorld();
    }
  }

  private drop(key: string): void {
    const b = this.built.get(key);
    if (!b) return;
    this.scene.remove(b.group);
    b.group.traverse((o) => { if (o instanceof THREE.Mesh && !o.userData.shared) o.geometry.dispose(); });   // an asset's meshes are shared
    for (const m of [...b.mats, ...b.plumeMats]) m.dispose();
    this.built.delete(key);
  }

  dispose(): void {
    for (const key of [...this.built.keys()]) this.drop(key);
    for (const l of [this.sunLight, this.earthLight]) { this.scene.remove(l, l.target); l.dispose(); }
  }
}
