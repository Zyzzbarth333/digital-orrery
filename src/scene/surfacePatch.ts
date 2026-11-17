// src/scene/surfacePatch.ts
//
// A finely divided patch of a body's surface under a camera close to it.
// Each body is a 96 x 48 sphere scaled to its ellipsoid: every flat face
// sags below the true surface, up to about 7 km on the Earth. From a few
// kilometres up, looking towards the horizon, the eye sees past those
// facets' edges into space, so stars showed below the horizon and the
// ground went missing in some directions. Near a body (within half its
// radius of the surface), this patch is drawn over the sphere: a polar
// grid on the unit sphere centred under the camera, out past the horizon,
// its rings packed close under the camera and opening out geometrically
// towards the edge, so a chord's sag stays under 0.4 % of the height (4 m
// at the horizon from 1.6 km up, against the sphere's 6.8 km). It is a
// child of the body's
// mesh and uses the body's own material, so it takes the same ellipsoid
// scale, rotation, maps and lighting; its own rotation turns its pole to
// the point under the camera. The shape depends only on the height, so it
// is rebuilt when that changes by a tenth, and only turned as the camera
// moves over the ground.

import * as THREE from 'three';

const RINGS = 96, SECTORS = 256;
// The patch reaches this far past the horizon, as a multiple of the
// horizon's angle from the point below.
const REACH = 1.3;

// The polar grid for a cap of angular radius `cap` (rad) whose first ring
// is `first` (rad) from its pole (+Z), on the unit sphere. Normals are the
// positions: the body material maps them through the ellipsoid's scale.
export function capGeometry(cap: number, first: number): THREE.BufferGeometry {
  const n = 1 + RINGS * SECTORS;
  const pos = new Float32Array(n * 3);
  pos[2] = 1;
  const k = Math.pow(cap / first, 1 / (RINGS - 1));
  for (let i = 0; i < RINGS; i++) {
    const rho = first * Math.pow(k, i), sr = Math.sin(rho), cr = Math.cos(rho);
    for (let j = 0; j < SECTORS; j++) {
      const phi = (2 * Math.PI * j) / SECTORS, o = (1 + i * SECTORS + j) * 3;
      pos[o] = sr * Math.cos(phi); pos[o + 1] = sr * Math.sin(phi); pos[o + 2] = cr;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < SECTORS; j++) index.push(0, 1 + j, 1 + ((j + 1) % SECTORS));
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SECTORS; j++) {
      const a = 1 + i * SECTORS + j, b = 1 + i * SECTORS + ((j + 1) % SECTORS);
      const c = a + SECTORS, d = b + SECTORS;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(pos.slice(), 3));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  return g;
}

// The largest sag below the true surface, in units of the sphere's radius,
// of a cap built as capGeometry builds it: the worse of a sector's chord
// and a ring's step, at the edge, where both are widest.
export function capSag(cap: number, first: number): number {
  const k = Math.pow(cap / first, 1 / (RINGS - 1));
  const around = Math.sin(cap) * (2 * Math.PI / SECTORS);
  const across = cap * (1 - 1 / k);
  const chord = Math.max(around, across);
  return chord * chord / 8;
}

// The cap's size for a camera at `r` sphere radii from the centre (> 1).
export function capFor(r: number): { cap: number; first: number } {
  const h = r - 1;
  const horizon = Math.acos(1 / r);
  return { cap: Math.min(Math.PI / 2, REACH * horizon), first: Math.max(1e-7, 0.05 * h) };
}

export class SurfacePatch {
  private mesh: THREE.Mesh | null = null;
  private body: THREE.Mesh | null = null;
  private builtR = 0;
  private pole = new THREE.Vector3(0, 0, 1);
  private local = new THREE.Vector3();
  private inv = new THREE.Matrix4();

  // Each frame, after the bodies are placed: the body whose surface the
  // camera (at the render origin) is nearest, relative to its size, or null
  // when none is within half its radius.
  update(body: THREE.Mesh | null): void {
    if (!body) { this.hide(); return; }
    body.updateMatrixWorld();
    // The camera in the body's unit-sphere frame.
    this.local.set(0, 0, 0).applyMatrix4(this.inv.copy(body.matrixWorld).invert());
    const r = this.local.length();
    if (!(r > 1 && r < 1.5)) { this.hide(); return; }
    if (!this.mesh) {
      this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), body.material);
      this.mesh.frustumCulled = false;
    }
    if (this.body !== body) {
      this.body?.remove(this.mesh);
      body.add(this.mesh);
      this.mesh.material = body.material;
      this.body = body;
      this.builtR = 0;
    }
    if (!(Math.abs(r - this.builtR) <= 0.1 * Math.max(r - 1, 1e-9) && this.builtR)) {
      const { cap, first } = capFor(r);
      this.mesh.geometry.dispose();
      this.mesh.geometry = capGeometry(cap, first);
      this.builtR = r;
    }
    this.mesh.quaternion.setFromUnitVectors(this.pole, this.local.normalize());
    this.mesh.visible = true;
  }

  private hide(): void {
    if (this.mesh) this.mesh.visible = false;
  }

  // The scale's nearest body: a body mesh and its sphere's radius in render
  // units, the smallest of (distance - radius) / radius.
  static nearest(meshes: Iterable<[string, THREE.Mesh]>, skip: (key: string) => boolean): THREE.Mesh | null {
    let best: THREE.Mesh | null = null, bestH = Infinity;
    for (const [key, m] of meshes) {
      if (skip(key) || !m.visible) continue;
      const R = Math.max(m.scale.x, m.scale.y, m.scale.z);
      const h = (m.position.length() - R) / R;
      if (h < bestH) { bestH = h; best = m; }
    }
    return bestH < 0.5 ? best : null;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.body?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}
