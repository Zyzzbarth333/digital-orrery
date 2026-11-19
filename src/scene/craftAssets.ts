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

export type AssetKey = 'orion' | 'saturn-v';

// A loaded model, in metres along the body axes (+x the nose, as the
// simple models): its parts, each a group of shared meshes. Orion: 'cm'
// and 'sm'. Saturn V: 'stage0', 'stage1', … from the base, and the
// cuts' heights (m from the base). base: x of the lowest point, aft.
export interface Asset { parts: Map<string, THREE.Group>; cuts?: number[]; base: number; span: number }

const URL_OF: Record<AssetKey, string> = { orion: 'models/orion/artemis_ii.gltf', 'saturn-v': 'models/saturn-v.glb' };
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
  const url = `${import.meta.env.BASE_URL}${URL_OF[key]}`;
  const { scene } = await loader().loadAsync(url);
  const upToX = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);     // +y to +x
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
