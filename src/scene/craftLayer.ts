// src/scene/craftLayer.ts
//
// Spacecraft in the scene: an HTML marker (a small square turned 45 degrees,
// orange while the engine burns, struck through after an impact) at the
// craft's drawn position, its osculating conic about its primary (amber) and
// the path it has flown (pale). Lines are drawn relative to the primary and
// placed at the primary's render position, like the bodies' orbit lines.
// They are drawing aids, kept out of the exposure and tone mapping.

import * as THREE from 'three';
import { orbitTrailMaterial } from './orbitTrail';

type V3 = [number, number, number];

export interface CraftView {
  id: number;
  name: string;
  rEcl: V3;               // heliocentric ecliptic km, at the sim clock
  primaryEcl: V3;         // the primary's position, same frame
  conicEcl: V3[];         // the osculating conic, relative to the primary
  trailEcl: V3[];         // the flown path, relative to the primary
  pathVersion: number;    // changes when conic or trail change
  thrusting: boolean;
  crashed: boolean;
  selected: boolean;
  // A real mission's flown path, relative to Earth (drawn once, placed at
  // Earth's position each frame).
  flown?: { pointsEcl: V3[]; originEcl: V3 };
}

interface Drawn { conic: THREE.Line; trail: THREE.Line; flown: THREE.Line | null; marker: HTMLDivElement; version: number }

// Ecliptic km -> render units (x, z, -y) / unit.
const toRender = (a: number[], unitKm: number, out: THREE.Vector3) => out.set(a[0] / unitKm, a[2] / unitKm, -a[1] / unitKm);

function lineOf(colour: number, opacity: number): THREE.Line {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const m = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, toneMapped: false, depthWrite: false });
  m.userData.base = new THREE.Color(colour);
  const line = new THREE.Line(g, m);
  line.frustumCulled = false;
  return line;
}

function setPoints(line: THREE.Line, pts: V3[], unitKm: number): void {
  const n = Math.max(1, pts.length);
  const arr = new Float32Array(n * 3), u = new Float32Array(n);
  pts.forEach((p, i) => {
    arr[3 * i] = p[0] / unitKm; arr[3 * i + 1] = p[2] / unitKm; arr[3 * i + 2] = -p[1] / unitKm;
    u[i] = n > 1 ? i / (n - 1) - 1 : 0;           // age along the trail: newest 0, oldest -1
  });
  line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  line.geometry.setAttribute('u', new THREE.BufferAttribute(u, 1));
  line.geometry.setDrawRange(0, pts.length);
}

// The flown path glows at the craft and fades with age (orbitTrail.ts).
function trailOf(colour: number): THREE.Line {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  g.setAttribute('u', new THREE.BufferAttribute(new Float32Array(1), 1));
  const line = new THREE.Line(g, orbitTrailMaterial(colour, 0.12, 0.25));
  line.frustumCulled = false;
  return line;
}

export class CraftLayer {
  private drawn = new Map<number, Drawn>();
  private tmp = new THREE.Vector3();
  private level = 1;

  // Lines are drawn at a display level: 1 / the exposure the HDR output
  // applies.
  setLevel(level: number): void {
    this.level = level;
    for (const d of this.drawn.values()) {
      for (const line of [d.conic, d.flown]) {
        if (!line) continue;
        const m = line.material as THREE.LineBasicMaterial;
        m.color.copy(m.userData.base as THREE.Color).multiplyScalar(level);
      }
      (d.trail.material as THREE.ShaderMaterial).uniforms.level.value = level;
    }
  }

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private onPick: (id: number) => void) {}

  // Before rendering: lines in place. cam: the camera's ecliptic km.
  place(views: CraftView[], cam: V3, unitKm: number): void {
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let d = this.drawn.get(v.id);
      if (!d) {
        const marker = document.createElement('div');
        marker.className = 'craft-marker';
        marker.innerHTML = '<span class="glyph"></span><span class="name"></span>';
        marker.addEventListener('click', () => this.onPick(v.id));
        this.overlay.appendChild(marker);
        d = { conic: lineOf(0xffb22e, 0.55), trail: trailOf(0xffcf7a), flown: null, marker, version: -1 };
        this.scene.add(d.conic, d.trail);
        this.drawn.set(v.id, d);
      }
      if (d.version !== v.pathVersion) {
        setPoints(d.conic, v.conicEcl, unitKm);
        setPoints(d.trail, v.trailEcl, unitKm);
        d.version = v.pathVersion;
      }
      if (v.flown && !d.flown) {
        d.flown = lineOf(0x8fd6c4, 0.5);    // the flown path: pale green, apart from the amber of ours
        setPoints(d.flown, v.flown.pointsEcl, unitKm);
        this.scene.add(d.flown);
      }
      if (v.flown && d.flown) toRender([v.flown.originEcl[0] - cam[0], v.flown.originEcl[1] - cam[1], v.flown.originEcl[2] - cam[2]], unitKm, d.flown.position);
      const p = [v.primaryEcl[0] - cam[0], v.primaryEcl[1] - cam[1], v.primaryEcl[2] - cam[2]];
      toRender(p, unitKm, d.conic.position);
      d.trail.position.copy(d.conic.position);
      (d.marker.querySelector('.name') as HTMLElement).textContent = v.name;
      d.marker.classList.toggle('burn', v.thrusting);
      d.marker.classList.toggle('lost', v.crashed);
      d.marker.classList.toggle('selected', v.selected);
    }
    this.setLevel(this.level);
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.scene.remove(d.conic, d.trail);
      d.conic.geometry.dispose(); d.trail.geometry.dispose();
      if (d.flown) { this.scene.remove(d.flown); d.flown.geometry.dispose(); }
      d.marker.remove();
      this.drawn.delete(id);
    }
  }

  // After the camera is set: markers at their projected positions.
  label(views: CraftView[], cam: V3, unitKm: number, camera: THREE.Camera, w: number, h: number): void {
    for (const v of views) {
      const d = this.drawn.get(v.id);
      if (!d) continue;
      const ndc = toRender([v.rEcl[0] - cam[0], v.rEcl[1] - cam[1], v.rEcl[2] - cam[2]], unitKm, this.tmp).project(camera);
      if (ndc.z > 1 || ndc.z < -1) { d.marker.style.display = 'none'; continue; }
      d.marker.style.display = '';
      const dpr = window.devicePixelRatio || 1;
      d.marker.style.transform = `translate(${Math.round(((ndc.x + 1) / 2) * w * dpr) / dpr}px, ${Math.round(((1 - ndc.y) / 2) * h * dpr) / dpr}px)`;
    }
  }

  dispose(): void {
    for (const d of this.drawn.values()) { this.scene.remove(d.conic, d.trail); if (d.flown) this.scene.remove(d.flown); d.marker.remove(); }
    this.drawn.clear();
  }
}
