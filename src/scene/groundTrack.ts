// src/scene/groundTrack.ts
//
// The ground track of the satellite on the plate, drawn on the Earth: the
// point under it (along the ellipsoid's normal) over the last quarter of
// an orbit and the one ahead, the stretch of its next pass over the
// chosen place brighter, and that place as a small square
// (docs/frontend/satellites.md, "Passes over a place").
//
// It is drawn in the Earth's own frame (ITRF), as a child of the Earth's
// mesh, which turns with the Earth (OrreryScene.updateLighting) and is
// scaled to its radii: a point r (km, ITRF) sits at r / radii there. The
// lines are lifted 19 km (0.3 %) so that the surface and the clouds don't
// cut them, and the Earth hides the far side.
//
// The track is resampled by SGP4 on the main thread (241 points, about
// 2 ms) once the clock has moved a two-hundredth of a period, at most
// every 50 ms of wall clock.

import * as THREE from 'three';
import { satrecOf, stateTeme } from '@digital-orrery/physics/satellites.js';
import { siteOf, temeToItrf, subPoint } from '@digital-orrery/physics/passes.js';

type Sat = ReturnType<typeof satrecOf>;
export interface TrackSite { lat: number; lon: number; heightKm: number }
export interface TrackPass { riseMs: number; setMs: number }

const N = 241, NP = 65, LIFT = 1.003;
const TRACK = new THREE.Color('#ecd9b0'), PASS = new THREE.Color('#ffb22e');

export class GroundTrack {
  private group = new THREE.Group();
  private track: THREE.Line;
  private pass: THREE.Line;
  private site: THREE.Points;
  private sat: Sat | null = null;
  private passSpan: TrackPass | null = null;
  private siteShown: TrackSite | null = null;
  // What it shows, for the chart's TRACK layer (src/app/chart-view.tsx).
  get shown(): { sat: Sat | null; site: TrackSite | null; pass: TrackPass | null } { return { sat: this.sat, site: this.siteShown, pass: this.passSpan }; }
  private lastT = NaN;
  private lastWall = 0;
  private parent: THREE.Object3D | null = null;

  constructor(private radiiKm: readonly [number, number, number]) {
    const line = (n: number, colour: THREE.Color, opacity: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const m = new THREE.LineBasicMaterial({ color: colour.clone(), transparent: true, opacity, depthWrite: false, toneMapped: false });
      const l = new THREE.Line(g, m);
      l.frustumCulled = false;
      return l;
    };
    this.track = line(N, TRACK, 0.8);
    this.pass = line(NP, PASS, 1);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.site = new THREE.Points(sg, new THREE.PointsMaterial({ color: PASS.clone(), size: 7, sizeAttenuation: false, depthWrite: false, toneMapped: false }));
    this.site.frustumCulled = false;
    this.group.add(this.track, this.pass, this.site);
    this.group.visible = false;
  }

  // What to draw: the satellite, the place and the next pass over it; a
  // null satellite hides it.
  set(sat: Sat | null, site: TrackSite | null, pass: TrackPass | null): void {
    const changed = sat !== this.sat || pass?.riseMs !== this.passSpan?.riseMs;
    this.sat = sat;
    this.passSpan = pass;
    this.siteShown = site;
    if (site) {
      const r = siteOf(site.lat, site.lon, site.heightKm).r;
      this.toLocal(r, this.site.geometry.attributes.position.array as Float32Array, 0);
      this.site.geometry.attributes.position.needsUpdate = true;
    }
    this.site.visible = !!site;
    if (changed) this.lastT = NaN;
    if (sat && pass) this.fill(this.pass, pass.riseMs, pass.setMs, NP);
    this.pass.visible = !!(sat && pass);
    this.group.visible = !!sat;
  }

  // Each frame: the clock (UTC ms), the Earth's mesh, and 1 / the exposure.
  update(timeMs: number, earth: THREE.Object3D | undefined, level: number): void {
    if (!earth || !this.sat) { this.group.visible = false; return; }
    if (this.parent !== earth) { earth.add(this.group); this.parent = earth; }
    this.group.visible = true;
    const period = 86400e3 / this.sat.omm.MEAN_MOTION, now = performance.now();
    if (!(Math.abs(timeMs - this.lastT) < period / 200) && now - this.lastWall > 50) {
      this.lastT = timeMs;
      this.lastWall = now;
      this.fill(this.track, timeMs - period / 4, timeMs + period, N);
    }
    (this.track.material as THREE.LineBasicMaterial).color.copy(TRACK).multiplyScalar(level);
    (this.pass.material as THREE.LineBasicMaterial).color.copy(PASS).multiplyScalar(level);
    (this.site.material as THREE.PointsMaterial).color.copy(PASS).multiplyScalar(level);
  }

  // The point under the satellite from t0 to t1, n samples, into a line.
  private fill(line: THREE.Line, t0: number, t1: number, n: number): void {
    const a = line.geometry.attributes.position.array as Float32Array;
    let last: number[] | null = null;
    for (let k = 0; k < n; k++) {
      const t = t0 + ((t1 - t0) * k) / (n - 1), s = this.sat && stateTeme(this.sat, t);
      if (s) {
        const r = s.r, M = temeToItrf(t);
        const x = [M[0][0] * r[0] + M[0][1] * r[1] + M[0][2] * r[2], M[1][0] * r[0] + M[1][1] * r[1] + M[1][2] * r[2], M[2][0] * r[0] + M[2][1] * r[1] + M[2][2] * r[2]];
        // Down the ellipsoid's normal to its surface.
        const p = subPoint(x), c = Math.cos(p.latDeg * Math.PI / 180), l = p.lonDeg * Math.PI / 180;
        const nrm = [c * Math.cos(l), c * Math.sin(l), Math.sin(p.latDeg * Math.PI / 180)];
        last = [x[0] - p.heightKm * nrm[0], x[1] - p.heightKm * nrm[1], x[2] - p.heightKm * nrm[2]];
      }
      if (last) this.toLocal(last, a, k * 3);
    }
    line.geometry.attributes.position.needsUpdate = true;
  }

  private toLocal(r: number[], out: Float32Array, o: number): void {
    out[o] = (r[0] / this.radiiKm[0]) * LIFT;
    out[o + 1] = (r[1] / this.radiiKm[1]) * LIFT;
    out[o + 2] = (r[2] / this.radiiKm[2]) * LIFT;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const o of [this.track, this.pass, this.site]) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
  }
}
