// src/scene/craftAssets.ts
//
// Real models of the app's craft, where a free one is published
// (docs/credits.md, docs/frontend/mission.md#close-up-models):
//
// - Orion: NASA/JPL-Caltech's Artemis II model from NASA's Eyes on the
//   Solar System (public/models/orion, 112,000 triangles, Draco geometry
//   and KTX2 textures, 24 MB), in metres, nose along +y. Its nodes above
//   the heat shield's base are the crew module, drawn alone after
//   separation.
// - Saturn V: NASA 3D Resources' model (public/models/saturn-v.glb, NASA/
//   Michael D. Carbajal, 35,000 triangles, 0.9 MB), scaled to the
//   published 363 ft long and 33 ft across, and cut at the stages' joints
//   (stackShape.js) so each falls away as it separates: a triangle goes
//   with the stage its centre lies in.
// - The ISS and Hubble: NASA/JPL-Caltech's models from NASA's Eyes on the
//   Earth (probeModels.ts SATELLITE_MODELS), turned into the body axes,
//   scaled and centred like a probe's, but with their nodes kept so their
//   arrays can turn (satelliteModels.ts).
//
// Each loads the first time its craft is close enough to draw (craftModels
// asks), never before; until then, and if it fails, the craft is drawn by
// the simple model. Instances share the loaded geometry, textures and
// materials. Their materials are three's physically based ones, lit by the
// Sun and the Earthshine as two directional lights (craftModels.ts), so
// with no surroundings to reflect their metal is turned down to a quarter,
// and transmission (glass) is off: it would render the scene again.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ktx2Loader } from './ktx2';
import { PROBE_MODELS, SATELLITE_MODELS, type Axis, type ProbeModel, type SatModel } from './probeModels';

export type AssetKey = 'orion' | 'saturn-v' | `probe:${string}` | `sat:${'iss' | 'hubble'}`;

// A loaded model, in metres along the body axes (+x the nose, as the
// simple models): its parts, each a group of shared meshes. Orion: 'cm'
// and 'sm'. Saturn V: 'stage0', 'stage1', … from the base, and the
// cuts' heights (m from the base). base: x of the lowest point, aft.
// A probe: 'all', and box, its bounds in the body axes (m). A satellite:
// 'all', its nodes kept (by their names, as three makes them).
export interface Asset { parts: Map<string, THREE.Group>; cuts?: number[]; base: number; span: number; box?: THREE.Box3 }

const URL_OF: Record<string, string> = { orion: 'models/orion/artemis_ii.gltf', 'saturn-v': 'models/saturn-v.glb' };
const urlOf = (key: AssetKey) => (key.startsWith('probe:') ? `models/probes/${PROBE_MODELS[key.slice(6)].file}`
  : key.startsWith('sat:') ? `models/satellites/${SATELLITE_MODELS[key.slice(4) as 'iss' | 'hubble'].file}` : URL_OF[key]);
const state = new Map<AssetKey, Asset | 'loading' | 'failed'>();

// The asset if loaded; else starts loading it (once) and returns null.
// cuts: Saturn V's stage joints (m from the base), from stackShape.js.
export function asset(key: AssetKey, cuts: number[] = []): Asset | null {
  const s = state.get(key);
  if (s && s !== 'loading' && s !== 'failed') return s;
  if (!s) {
    state.set(key, 'loading');
    load(key, cuts).then((a) => state.set(key, a), (e) => { console.warn(`model ${key}:`, e); state.set(key, 'failed'); });
  }
  return null;
}

let gltf: GLTFLoader | null = null;
function loader(): GLTFLoader {
  if (gltf) return gltf;
  gltf = new GLTFLoader();
  const draco = new DRACOLoader();
  gltf.setDRACOLoader(draco);
  const k = ktx2Loader();
  if (k) gltf.setKTX2Loader(k);
  return gltf;
}

// Lit by two directional lights and nothing to reflect: metal turned down,
// no glass.
function tame(m: THREE.Material): void {
  const s = m as THREE.MeshPhysicalMaterial;
  if ('metalness' in s) s.metalness *= 0.25;
  if ('transmission' in s) s.transmission = 0;
}

// Every mesh's geometry with its node's transform baked in (relative to
// the root), then the frame: up -> +x, scaled.
function baked(root: THREE.Object3D, frame: THREE.Matrix4): THREE.Mesh[] {
  root.updateMatrixWorld(true);
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const g = (o.geometry as THREE.BufferGeometry).clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(frame, o.matrixWorld));
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(tame);
    const m = new THREE.Mesh(g, o.material);
    m.userData.shared = true;
    out.push(m);
  });
  return out;
}

// A geometry's triangles split by where their centres lie along x: one
// geometry per span between cuts (some may be empty).
function splitAlongX(g: THREE.BufferGeometry, cuts: number[]): (THREE.BufferGeometry | null)[] {
  const pos = g.getAttribute('position'), idx = g.getIndex();
  const n = idx ? idx.count : pos.count, tri = (k: number) => (idx ? idx.getX(k) : k);
  const lists: number[][] = Array.from({ length: cuts.length + 1 }, () => []);
  for (let k = 0; k < n; k += 3) {
    const a = tri(k), b = tri(k + 1), c = tri(k + 2);
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    let i = 0;
    while (i < cuts.length && x >= cuts[i]) i++;
    lists[i].push(a, b, c);
  }
  return lists.map((l) => {
    if (!l.length) return null;
    const s = g.clone();
    s.setIndex(l);
    return s;
  });
}

async function load(key: AssetKey, cuts: number[]): Promise<Asset> {
  const url = `${import.meta.env.BASE_URL}${urlOf(key)}`;
  const { scene } = await loader().loadAsync(url);
  const upToX = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);     // +y to +x
  if (key.startsWith('probe:')) return probe(key.slice(6), scene);
  if (key.startsWith('sat:')) return satellite(SATELLITE_MODELS[key.slice(4) as 'iss' | 'hubble'], scene);
  if (key === 'orion') {
    // In metres as published, its origin at the adapter's joint; the crew
    // module is every child node above 0.3 m (its heat shield's base, 0.4).
    const root = scene.getObjectByName('outter bus.001') ?? scene;
    const cm = new THREE.Group(), sm = new THREE.Group(), all = new THREE.Box3();
    for (const m of baked(root, upToX)) {
      m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox!;
      all.union(b);
      (b.min.x > 0.3 ? cm : sm).add(m);
    }
    return { parts: new Map([['cm', cm], ['sm', sm]]), base: all.min.x, span: all.max.x - all.min.x };
  }
  // Saturn V: its axis and base found from the model (Y up, 13 units
  // tall), scaled to 363 ft by 33 ft (the S-IC's body measures 1.26 units
  // across, so the model is 7 % longer for its width than the real one,
  // and is stretched to both), its base at x = 0.
  const raw = new THREE.Box3().setFromObject(scene);
  const L = 363 * 0.3048, D = 33 * 0.3048, BODY = 1.26;
  const cx = (raw.min.x + raw.max.x) / 2, cz = (raw.min.z + raw.max.z) / 2;
  const frame = new THREE.Matrix4().multiplyMatrices(upToX,
    new THREE.Matrix4().makeScale(D / BODY, L / (raw.max.y - raw.min.y), D / BODY).multiply(new THREE.Matrix4().makeTranslation(-cx, -raw.min.y, -cz)));
  const parts = new Map<string, THREE.Group>();
  for (let i = 0; i <= cuts.length; i++) parts.set(`stage${i}`, new THREE.Group());
  for (const m of baked(scene, frame)) {
    splitAlongX(m.geometry, cuts).forEach((g, i) => {
      if (!g) return;
      const s = new THREE.Mesh(g, m.material);
      s.userData.shared = true;
      parts.get(`stage${i}`)!.add(s);
    });
    m.geometry.dispose();
  }
  return { parts, cuts, base: 0, span: L };
}

// A unit vector along a model axis.
export function axisVec(a: Axis): THREE.Vector3 {
  const v = new THREE.Vector3();
  v.setComponent('xyz'.indexOf(a[1]), a[0] === '-' ? -1 : 1);
  return v;
}

// The rotation model -> body: the model axes fx, fz as body x and z (rows
// are the model's axes as body x, y, z).
function frame(fx: THREE.Vector3, fz: THREE.Vector3): THREE.Matrix4 {
  const fy = new THREE.Vector3().crossVectors(fz, fx);
  return new THREE.Matrix4().set(fx.x, fx.y, fx.z, 0, fy.x, fy.y, fy.z, 0, fz.x, fz.y, fz.z, 0, 0, 0, 0, 1);
}

// The scale that makes the part a published figure measures span it.
function scaleOf(sc: ProbeModel['scale'], scene: THREE.Object3D): number {
  if (!sc) return 1;
  scene.updateMatrixWorld(true);
  const b = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (sc.part === null || m.name === sc.part || mats.some((x) => x.name === sc.part)) b.expandByObject(m);
  });
  const ext = b.max[sc.axis] - b.min[sc.axis];
  return ext > 0 ? sc.m / ext : 1;
}

// A probe: the model turned so its Sun (or Earth) axis is +x and its up
// +z, scaled so the part its published figure measures spans that figure,
// and centred on its bounds.
function probe(key: string, scene: THREE.Object3D): Asset {
  const P = PROBE_MODELS[key];
  const rot = frame(axisVec((P.sun ?? P.earth)!), axisVec(P.up)), s = scaleOf(P.scale, scene);
  const scaled = new THREE.Matrix4().multiplyMatrices(rot, new THREE.Matrix4().makeScale(s, s, s));
  const meshes = baked(scene, scaled), box = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox!); }
  const c = box.getCenter(new THREE.Vector3());
  const all = new THREE.Group();
  for (const m of meshes) { m.geometry.translate(-c.x, -c.y, -c.z); all.add(m); }
  box.translate(c.negate());
  return { parts: new Map([['all', all]]), base: box.min.x, span: box.max.x - box.min.x, box };
}

// The triangles of a mesh whose centres (in the scene's frame) pass a test,
// as a geometry in the scene's frame, and the rest left in the mesh.
function splitOff(m: THREE.Mesh, test: (c: THREE.Vector3) => boolean): THREE.BufferGeometry | null {
  const g = m.geometry as THREE.BufferGeometry, pos = g.getAttribute('position'), idx = g.getIndex();
  const n = idx ? idx.count : pos.count, at = (k: number) => (idx ? idx.getX(k) : k);
  const W = m.matrixWorld, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const out: number[] = [], keep: number[] = [];
  for (let k = 0; k < n; k += 3) {
    const i = at(k), j = at(k + 1), l = at(k + 2);
    a.fromBufferAttribute(pos, i).applyMatrix4(W); b.fromBufferAttribute(pos, j).applyMatrix4(W); c.fromBufferAttribute(pos, l).applyMatrix4(W);
    (test(a.add(b).add(c).divideScalar(3)) ? out : keep).push(i, j, l);
  }
  if (!out.length) return null;
  const split = g.clone(); split.setIndex(out); split.applyMatrix4(W);
  const rest = g.clone(); rest.setIndex(keep); m.geometry = rest;
  return split;
}

// A satellite: its nodes kept, Hubble's arrays split off into a node of
// their own, turned into the body axes, scaled and centred on its bounds.
function satellite(P: SatModel, scene: THREE.Object3D): Asset {
  const s = scaleOf(P.scale, scene);
  scene.updateMatrixWorld(true);
  if (P.arrays) {
    const A = P.arrays, k = 'xyz'.indexOf(A.axis), cells = new THREE.Box3();
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === A.cells) cells.expandByObject(o); });
    const pivot = new THREE.Group();
    pivot.name = A.node;
    pivot.position.copy(cells.getCenter(new THREE.Vector3())).setComponent(k, 0);
    const meshes: THREE.Mesh[] = [];
    scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    for (const m of meshes) {
      const g = splitOff(m, (c) => Math.abs(c.getComponent(k)) > A.beyond);
      if (!g) continue;
      g.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
      const part = new THREE.Mesh(g, m.material);
      part.name = `${m.name}_${A.node}`;
      pivot.add(part);
    }
    scene.add(pivot);
  }
  for (const name of P.hide ?? []) { const o = scene.getObjectByName(name); if (o) o.visible = false; }
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    (Array.isArray(m.material) ? m.material : [m.material]).forEach(tame);
    m.userData.shared = true;
  });
  // The model in the body axes, scaled, then moved to centre its bounds.
  const inner = new THREE.Group();
  inner.add(scene);
  inner.quaternion.setFromRotationMatrix(frame(axisVec(P.x), axisVec(P.z)));
  inner.scale.setScalar(s);
  const all = new THREE.Group();
  all.add(inner);
  all.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(all), c = box.getCenter(new THREE.Vector3());
  inner.position.copy(c).negate();
  box.translate(c.negate());
  return { parts: new Map([['all', all]]), base: box.min.x, span: box.max.x - box.min.x, box };
}
