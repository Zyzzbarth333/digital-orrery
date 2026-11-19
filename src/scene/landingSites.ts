// src/scene/landingSites.ts
//
// The landing sites (packages/physics/src/landingSites.js) as a layer the rail
// shows or hides, off by default (docs/frontend/landing-sites.md): the
// Moon's, and those on Mars, Venus, Mercury, Titan, Jupiter and Saturn.
// Each site is a marker in the HTML overlay, pinned to its point on its
// body's reference ellipsoid: turned with the body every frame
// (bodyAxesEqj, as the body's mesh is), and hidden when the point is past
// the limb or below the camera's horizon. A body's markers show while the
// camera is within SHOW_RADII of its radius of its centre, or for the
// site flown to. Names give way to one another: the site flown to first,
// then the crewed landings, then the rest in the order they are listed; a
// site whose name would overlap one already placed shows its mark only
// (its name on hover). The sites on small bodies (Eros, Bennu, 67P...)
// have no marker: those bodies are drawn as spheres with no rotation
// model, so a site is flown to as its body and given on the plate.
//
// Positions are worked out on the CPU, for the near body's sites only.
// Render positions are camera-relative, one unit 1000 km, render
// (x, y, z) = ecliptic (x, z, -y).

import * as THREE from 'three';
import { eqjToEcl } from '@digital-orrery/physics/ephemeris.js';
import { LANDING_SITES, SITE_BY_KEY, siteBody, onSmallBody, siteFixedKm, siteNormal, siteRadii, type LandingSite } from '@digital-orrery/physics/landingSites.js';
import { dot, cross, norm, unit } from '@digital-orrery/physics/vec.js';

type Vec3 = [number, number, number];
const UNIT_KM = 1000;
// Within this many of a body's radii of its centre (for the Moon 43,000
// km, past where the camera frames it) its markers show.
const SHOW_RADII = 25;
// A marker's box, px: from 4 px left of its point to the end of its name
// (Michroma's wide capitals, 10 px tracked 0.12em: about 9.8 px a letter,
// with the mark, the gap and the name's padding 24 px), 13 px tall. A
// name whose box would overlap one placed gives way.
const NAME_H = 13;
const boxWidth = (name: string) => 24 + 9.8 * name.length;
const DRAWN = LANDING_SITES.filter((s) => !onSmallBody(s));
const PRIORITY = DRAWN.map((s, i) => ({ s, rank: (s.kind === 'crewed' ? 0 : 1) * 1000 + i })).sort((a, b) => a.rank - b.rank).map((x) => x.s);
// The bodies with drawn sites, and the largest radius of each.
const SITE_BODIES = [...new Set(DRAWN.map(siteBody))];
const REACH_KM = Object.fromEntries(SITE_BODIES.map((b) => [b, SHOW_RADII * Math.max(...siteRadii(DRAWN.find((s) => siteBody(s) === b)!)!)]));

const turn = (p: Vec3, [X, Y, Z]: Vec3[]): Vec3 => [0, 1, 2].map((i) => p[0] * X[i] + p[1] * Y[i] + p[2] * Z[i]) as Vec3;

export interface SiteFrame { P: Vec3; E: Vec3; N: Vec3; U: Vec3 }
// Where a site's body is now and how it is turned (heliocentric ecliptic
// km, body axes in the ecliptic): the scene hands the layer this.
export type SitePlace = (body: string) => { r: Vec3; axes: Vec3[] } | null;

// The site's place and its local east, north and up, heliocentric ecliptic
// km and unit vectors, from its body's centre and body axes (ecliptic).
// Up is the ellipsoid's normal; east the pole crossed with up.
export function siteFrame(site: LandingSite, centre: Vec3, axesEcl: Vec3[]): SiteFrame {
  const p = turn(siteFixedKm(site) as Vec3, axesEcl);
  const U = unit(turn(siteNormal(site) as Vec3, axesEcl));
  const e = cross(axesEcl[2], U);
  const E = norm(e) > 1e-9 ? unit(e) : axesEcl[1];   // at a pole, the body's +Y
  const N = cross(U, E);
  return { P: [centre[0] + p[0], centre[1] + p[1], centre[2] + p[2]], E, N, U };
}

// A body's axes in the ecliptic, from bodyAxesEqj's J2000 ones.
export const axesToEcl = (axesEqj: number[][]): Vec3[] => axesEqj.map((a) => eqjToEcl(a) as Vec3);

export class LandingSiteLayer {
  private on = false;
  private focusKey: string | null = null;
  private markers = new Map<string, HTMLDivElement>();
  private shownLast = new Set<string>();
  private tmp = new THREE.Vector3();
  onPick: (key: string) => void = () => {};

  constructor(private overlay: HTMLElement) {
    for (const s of DRAWN) {
      const el = document.createElement('div');
      el.className = `body-marker site ${s.kind}`;
      el.title = `${s.name}: ${KIND_TITLE[s.kind]}, ${s.place}`;
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

  // Heliocentric ecliptic km of a site now (a small body's: null, the
  // scene places those as their body).
  positionKm(key: string, place: SitePlace): Vec3 | null {
    const s = SITE_BY_KEY[key];
    if (!s || onSmallBody(s)) return null;
    const at = place(siteBody(s));
    return at ? siteFrame(s, at.r, at.axes).P : null;
  }

  // Place the markers: after the camera's matrices are set this frame.
  // centre: where each body with sites is (the scene's states), checked
  // before its axes are asked for.
  update(cam: Vec3, centre: (body: string) => Vec3 | null, place: SitePlace, camera: THREE.Camera, w: number, h: number): void {
    const focused = this.focusKey ? SITE_BY_KEY[this.focusKey] : null;
    const near = new Set<string>();
    if (this.on || focused) {
      for (const b of SITE_BODIES) {
        const c = centre(b);
        if (c && Math.hypot(cam[0] - c[0], cam[1] - c[1], cam[2] - c[2]) < REACH_KM[b]) near.add(b);
      }
    }
    for (const b of this.shownLast) if (!near.has(b)) for (const s of DRAWN) if (siteBody(s) === b) this.markers.get(s.key)!.style.display = 'none';
    this.shownLast = near;
    if (!near.size) return;
    const px = window.devicePixelRatio || 1;
    const placed: [number, number, number][] = [];       // left, right, y
    const order = focused && !onSmallBody(focused) ? [focused, ...PRIORITY.filter((s) => s.key !== focused.key)] : PRIORITY;
    const at = new Map<string, ReturnType<SitePlace>>();
    for (const s of order) {
      const b = siteBody(s);
      if (!near.has(b)) continue;
      const el = this.markers.get(s.key)!;
      const isFocus = s.key === this.focusKey;
      if (!this.on && !isFocus) { el.style.display = 'none'; continue; }
      if (!at.has(b)) at.set(b, place(b));
      const where = at.get(b);
      if (!where) { el.style.display = 'none'; continue; }
      const { P, U } = siteFrame(s, where.r, where.axes);
      const rel: Vec3 = [P[0] - cam[0], P[1] - cam[1], P[2] - cam[2]];
      // A point is in sight when the camera is above its horizon plane:
      // past the limb, or over the horizon from low down, it is not.
      if (dot(U, rel) >= 0) { el.style.display = 'none'; continue; }
      const ndc = this.tmp.set(rel[0] / UNIT_KM, rel[2] / UNIT_KM, -rel[1] / UNIT_KM).project(camera);
      if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1.1 || Math.abs(ndc.y) > 1.1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * px) / px, y = Math.round(((1 - ndc.y) / 2) * h * px) / px;
      const x0 = x - 4, x1 = x - 4 + boxWidth(s.name);
      const crowded = !isFocus && placed.some(([a, c, qy]) => x0 < c && a < x1 && Math.abs(qy - y) < NAME_H);
      if (!crowded) placed.push([x0, x1, y]);
      el.classList.toggle('quiet', crowded);
      el.classList.toggle('focused', isFocus);
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  dispose(): void {
    for (const el of this.markers.values()) el.remove();
  }
}

// What a marker's title calls each kind.
export const KIND_TITLE: Record<LandingSite['kind'], string> = {
  crewed: 'crewed landing', lander: 'lander', rover: 'where its rover stopped', crash: 'where it crashed',
  estimate: 'estimated place (not found)', impact: 'where it struck, on purpose', entry: 'where it entered the atmosphere',
  touch: 'where it touched the surface',
};
