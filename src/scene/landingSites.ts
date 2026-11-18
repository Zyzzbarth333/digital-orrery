// src/scene/landingSites.ts
//
// The Moon's landing sites (src/physics/landingSites.js) as a layer the
// rail shows or hides, off by default (docs/frontend/landing-sites.md).
// Each site is a marker in the HTML overlay, pinned to its point on the
// Moon's surface: turned with the Moon every frame (bodyAxesEqj, as the
// Moon's mesh is), and hidden when the point is past the limb or below the
// camera's horizon. The markers show while the camera is within
// SHOW_RANGE_KM of the Moon's centre, or for the site flown to. Names
// give way to one another: the site flown to first, then the crewed
// landings, then the rest in the order they landed; a site whose name
// would overlap one already placed shows its mark only (its name on hover).
//
// Positions are worked out on the CPU, 38 a frame. Render positions are
// camera-relative, one unit 1000 km, render (x, y, z) = ecliptic (x, z, -y).

import * as THREE from 'three';
import { eqjToEcl } from '../physics/ephemeris.js';
import { LANDING_SITES, SITE_BY_KEY, MOON_RADIUS_KM, siteUnit, type LandingSite } from '../physics/landingSites.js';

type Vec3 = [number, number, number];
const UNIT_KM = 1000;
// Within this of the Moon's centre (25 of its radii, past where the camera
// frames it, 20,000 km out) the markers show.
const SHOW_RANGE_KM = 25 * MOON_RADIUS_KM;
// A marker's box, px: from 4 px left of its point to the end of its name
// (Michroma's wide capitals, 10 px tracked 0.12em: about 9.8 px a letter,
// with the mark, the gap and the name's padding 24 px), 13 px tall. A
// name whose box would overlap one placed gives way.
const NAME_H = 13;
const boxWidth = (name: string) => 24 + 9.8 * name.length;
const PRIORITY = LANDING_SITES.map((s, i) => ({ s, rank: (s.kind === 'crewed' ? 0 : 1) * 1000 + i })).sort((a, b) => a.rank - b.rank).map((x) => x.s);

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): Vec3 => { const n = Math.hypot(a[0], a[1], a[2]); return [a[0] / n, a[1] / n, a[2] / n]; };
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface SiteFrame { P: Vec3; E: Vec3; N: Vec3; U: Vec3 }

// The site's place and its local east, north and up, heliocentric ecliptic
// km and unit vectors, from the Moon's centre and its body axes (ecliptic).
export function siteFrame(site: LandingSite, moonR: Vec3, axesEcl: Vec3[]): SiteFrame {
  const u = siteUnit(site) as Vec3;
  const [X, Y, Z] = axesEcl;
  const U = norm([0, 1, 2].map((i) => u[0] * X[i] + u[1] * Y[i] + u[2] * Z[i]) as Vec3);
  // East: the pole crossed with up (at a pole itself, the body's +Y).
  const e = cross(Z, U);
  const E = Math.hypot(e[0], e[1], e[2]) > 1e-9 ? norm(e) : Y;
  const N = cross(U, E);
  const R = MOON_RADIUS_KM;
  return { P: [moonR[0] + R * U[0], moonR[1] + R * U[1], moonR[2] + R * U[2]], E, N, U };
}

// The Moon's body axes in the ecliptic, from bodyAxesEqj's J2000 ones.
export const axesToEcl = (axesEqj: number[][]): Vec3[] => axesEqj.map((a) => eqjToEcl(a) as Vec3);

export class LandingSiteLayer {
  private on = false;
  private focusKey: string | null = null;
  private markers = new Map<string, HTMLDivElement>();
  private shownLast = false;
  private tmp = new THREE.Vector3();
  onPick: (key: string) => void = () => {};

  constructor(private overlay: HTMLElement) {
    for (const s of LANDING_SITES) {
      const el = document.createElement('div');
      el.className = `body-marker site ${s.kind}`;
      el.title = `${s.name}: ${s.kind === 'crewed' ? 'crewed landing' : s.kind === 'rover' ? 'where its rover stopped' : s.kind === 'crash' ? 'where it crashed' : s.kind === 'estimate' ? 'estimated place (not found)' : 'lander'}, ${s.place}`;
      const mark = document.createElement('span'), name = document.createElement('span');
      mark.className = 'dot'; name.className = 'name'; name.textContent = s.name;
      el.append(mark, name);
      el.style.display = 'none';
      el.addEventListener('click', () => this.onPick(s.key));
      overlay.appendChild(el);
      this.markers.set(s.key, el);
    }
  }

  get shown(): boolean { return this.on; }
  has(key: string): boolean { return key in SITE_BY_KEY; }
  setOn(on: boolean): void { this.on = on; }
  setFocus(key: string | null): void { this.focusKey = key; }

  // Heliocentric ecliptic km of a site now.
  positionKm(key: string, moonR: Vec3, axesEcl: Vec3[]): Vec3 | null {
    const s = SITE_BY_KEY[key];
    return s ? siteFrame(s, moonR, axesEcl).P : null;
  }

  // Place the markers: after the camera's matrices are set this frame.
  update(cam: Vec3, moonR: Vec3, axesEcl: Vec3[], camera: THREE.Camera, w: number, h: number): void {
    const near = Math.hypot(cam[0] - moonR[0], cam[1] - moonR[1], cam[2] - moonR[2]) < SHOW_RANGE_KM;
    if (!(near && (this.on || this.focusKey !== null))) {
      if (this.shownLast) for (const el of this.markers.values()) el.style.display = 'none';
      this.shownLast = false;
      return;
    }
    this.shownLast = true;
    const px = window.devicePixelRatio || 1;
    const placed: [number, number, number][] = [];       // left, right, y
    const order = this.focusKey ? [SITE_BY_KEY[this.focusKey], ...PRIORITY.filter((s) => s.key !== this.focusKey)] : PRIORITY;
    for (const s of order) {
      const el = this.markers.get(s.key)!;
      const focused = s.key === this.focusKey;
      if (!this.on && !focused) { el.style.display = 'none'; continue; }
      const { P, U } = siteFrame(s, moonR, axesEcl);
      const rel: Vec3 = [P[0] - cam[0], P[1] - cam[1], P[2] - cam[2]];
      // On a sphere a point is in sight when the camera is above its
      // horizon plane: past the limb, or over the horizon from low down,
      // it is not.
      if (dot(U, rel) >= 0) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM).project(camera);
      if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * px) / px, y = Math.round(((1 - ndc.y) / 2) * h * px) / px;
      const x0 = x - 4, x1 = x - 4 + boxWidth(s.name);
      const crowded = !focused && placed.some(([a, b, qy]) => x0 < b && a < x1 && Math.abs(qy - y) < NAME_H);
      if (!crowded) placed.push([x0, x1, y]);
      el.classList.toggle('quiet', crowded);
      el.classList.toggle('focused', focused);
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  dispose(): void {
    for (const el of this.markers.values()) el.remove();
  }
}
