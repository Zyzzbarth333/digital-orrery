// src/scene/journeyLayer.ts
//
// The journey being planned, in the scene: each leg's transfer arc as a
// dashed pale-amber line about its central body (the Sun, or a planet for
// its moons), placed at that body's position each frame like the orbit
// lines; the kernel's flown path of it as a thin solid amber line; and a
// burn node at each burn, an HTML marker: a small open bracket reticle in
// phosphor with its delta-v engraved beside it (docs/physics/journey.md#in-the-scene).
// Lines are drawing aids at a display level (setLevel), as craftLayer's.

import * as THREE from 'three';
import type { JourneyView } from '../app/journey';

type V3 = [number, number, number];

const toRender = (a: number[], unitKm: number, out: THREE.Vector3) => out.set(a[0] / unitKm, a[2] / unitKm, -a[1] / unitKm);

function line(pts: V3[], unitKm: number, colour: number, opacity: number, dashed: boolean): THREE.Line {
  const arr = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => { arr[3 * i] = p[0] / unitKm; arr[3 * i + 1] = p[2] / unitKm; arr[3 * i + 2] = -p[1] / unitKm; });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const m = dashed
    ? new THREE.LineDashedMaterial({ color: colour, transparent: true, opacity, toneMapped: false, depthWrite: false, dashSize: 1, gapSize: 1 })
    : new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity, toneMapped: false, depthWrite: false });
  m.userData.base = new THREE.Color(colour);
  const l = new THREE.Line(g, m);
  if (dashed) l.computeLineDistances();
  l.frustumCulled = false;
  return l;
}

interface Drawn { lines: { line: THREE.Line; central: string; dashed: boolean }[]; marks: { el: HTMLDivElement; central: string; at: V3 }[]; version: number; flownKey: string }

export class JourneyLayer {
  private drawn: Drawn | null = null;
  private tmp = new THREE.Vector3();
  private level = 1;

  constructor(private scene: THREE.Scene, private overlay: HTMLElement) {}

  setLevel(level: number): void {
    this.level = level;
    for (const d of this.drawn?.lines ?? []) {
      const m = d.line.material as THREE.LineBasicMaterial;
      m.color.copy(m.userData.base as THREE.Color).multiplyScalar(level);
    }
  }

  private clear(): void {
    if (!this.drawn) return;
    for (const d of this.drawn.lines) { this.scene.remove(d.line); d.line.geometry.dispose(); (d.line.material as THREE.Material).dispose(); }
    for (const m of this.drawn.marks) m.el.remove();
    this.drawn = null;
  }

  // Before rendering: lines in place. centralAt(key): a body's position
  // (ecliptic km); cam: the camera's.
  place(view: JourneyView | null, centralAt: (key: string) => V3 | null, cam: V3, unitKm: number, camDist: number): void {
    const flownKey = view?.flown ? `${view.version}:${view.flown.pts.length}` : '';
    if (!view) { this.clear(); return; }
    if (!this.drawn || this.drawn.version !== view.version || this.drawn.flownKey !== flownKey) {
      this.clear();
      const lines: Drawn['lines'] = [];
      for (const a of view.arcs) lines.push({ line: line(a.pts, unitKm, 0xecd9b0, 0.7, true), central: a.central, dashed: true });
      if (view.flown && view.flown.pts.length > 1) lines.push({ line: line(view.flown.pts as V3[], unitKm, 0xffb22e, 0.85, false), central: view.flown.central, dashed: false });
      for (const l of lines) this.scene.add(l.line);
      const marks = view.marks.map((m) => {
        const el = document.createElement('div');
        el.className = `burn-node ${m.kind}`;
        el.innerHTML = '<span class="reticle" aria-hidden="true"></span><span class="dv"></span>';
        (el.querySelector('.dv') as HTMLElement).textContent = `${m.label} · Δv ${m.dv.toFixed(2)}`;
        el.title = `${m.label}: ${(m.dv * 1000).toLocaleString('en-AU', { maximumFractionDigits: 0 })} m/s on ${new Date(m.ms).toISOString().slice(0, 10)}`;
        this.overlay.appendChild(el);
        return { el, central: m.central, at: m.at };
      });
      this.drawn = { lines, marks, version: view.version, flownKey };
      this.setLevel(this.level);
    }
    for (const d of this.drawn.lines) {
      const c = centralAt(d.central);
      if (!c) { d.line.visible = false; continue; }
      d.line.visible = true;
      toRender([c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]], unitKm, d.line.position);
      // Dashes a fixed share of the view: their length follows the camera's
      // distance, so the line reads as dashed at every zoom.
      if (d.dashed) {
        const m = d.line.material as THREE.LineDashedMaterial;
        m.dashSize = camDist / unitKm / 60; m.gapSize = m.dashSize * 0.8;
      }
    }
  }

  // After the camera is set: the burn nodes at their projected places.
  label(centralAt: (key: string) => V3 | null, cam: V3, unitKm: number, camera: THREE.Camera, w: number, h: number): void {
    for (const m of this.drawn?.marks ?? []) {
      const c = centralAt(m.central);
      if (!c) { m.el.style.display = 'none'; continue; }
      const ndc = toRender([c[0] + m.at[0] - cam[0], c[1] + m.at[1] - cam[1], c[2] + m.at[2] - cam[2]], unitKm, this.tmp).project(camera);
      if (ndc.z > 1 || ndc.z < -1) { m.el.style.display = 'none'; continue; }
      m.el.style.display = '';
      const dpr = window.devicePixelRatio || 1;
      m.el.style.transform = `translate(${Math.round(((ndc.x + 1) / 2) * w * dpr) / dpr}px, ${Math.round(((1 - ndc.y) / 2) * h * dpr) / dpr}px)`;
    }
  }

  dispose(): void { this.clear(); }
}
