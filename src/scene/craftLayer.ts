// src/scene/craftLayer.ts
//
// Spacecraft in the scene: an HTML marker (a small square turned 45 degrees,
// orange while the engine burns, struck through after an impact) at the
// craft's drawn position, its osculating conic about its primary (amber) and
// the path it has flown (pale). Lines are drawn relative to the primary and
// placed at the primary's render position, like the bodies' orbit lines.
// They are drawing aids, kept out of the exposure and tone mapping.

import * as THREE from 'three';

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
}

interface Drawn { conic: THREE.Line; trail: THREE.Line; marker: HTMLDivElement; version: number }

// Ecliptic km -> render units (x, z, -y) / unit.
const toRender = (a: number[], unitKm: number, out: THREE.Vector3) => out.set(a[0] / unitKm, a[2] / unitKm, -a[1] / unitKm);

function lineOf(colour: number, opacity: number): THREE.Line {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const m = new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, toneMapped: false, depthWrite: false });
  const line = new THREE.Line(g, m);
  line.frustumCulled = false;
  return line;
}

function setPoints(line: THREE.Line, pts: V3[], unitKm: number): void {
  const arr = new Float32Array(Math.max(1, pts.length) * 3);
  pts.forEach((p, i) => { arr[3 * i] = p[0] / unitKm; arr[3 * i + 1] = p[2] / unitKm; arr[3 * i + 2] = -p[1] / unitKm; });
  line.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  line.geometry.setDrawRange(0, pts.length);
}

export class CraftLayer {
  private drawn = new Map<number, Drawn>();
  private tmp = new THREE.Vector3();

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
        d = { conic: lineOf(0xffb22e, 0.75), trail: lineOf(0xecd9b0, 0.45), marker, version: -1 };
        this.scene.add(d.conic, d.trail);
        this.drawn.set(v.id, d);
      }
      if (d.version !== v.pathVersion) {
        setPoints(d.conic, v.conicEcl, unitKm);
        setPoints(d.trail, v.trailEcl, unitKm);
        d.version = v.pathVersion;
      }
      const p = [v.primaryEcl[0] - cam[0], v.primaryEcl[1] - cam[1], v.primaryEcl[2] - cam[2]];
      toRender(p, unitKm, d.conic.position);
      d.trail.position.copy(d.conic.position);
      (d.marker.querySelector('.name') as HTMLElement).textContent = v.name;
      d.marker.classList.toggle('burn', v.thrusting);
      d.marker.classList.toggle('lost', v.crashed);
      d.marker.classList.toggle('selected', v.selected);
    }
    for (const [id, d] of this.drawn) {
      if (seen.has(id)) continue;
      this.scene.remove(d.conic, d.trail);
      d.conic.geometry.dispose(); d.trail.geometry.dispose();
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
      d.marker.style.transform = `translate(${((ndc.x + 1) / 2) * w}px, ${((1 - ndc.y) / 2) * h}px)`;
    }
  }

  dispose(): void {
    for (const d of this.drawn.values()) { this.scene.remove(d.conic, d.trail); d.marker.remove(); }
    this.drawn.clear();
  }
}
