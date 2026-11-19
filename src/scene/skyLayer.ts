// src/scene/skyLayer.ts
//
// The interactive sky (docs/frontend/interactive-sky.md): pointing at a
// star of the point layer (stars.ts), the ring round the one chosen, the
// tag beside the one under the pointer, and the constellations' lines and
// names, a rail layer.
//
// - Picking is on the CPU, from the point layer's own positions (render
//   axes, unit vectors: the camera sits at the render origin) and
//   magnitudes. Only a star the point layer draws can be picked (its
//   shader's 1/512-of-white test, with the eye's adaptation now), and none
//   behind a body's disc. Of those within PICK_PX of the pointer, the
//   brightest for its distance wins (skyCatalogue.choose). A pick tests
//   every star's direction against the pointer's cone (83,392 dot
//   products, well under a millisecond), then projects only those inside.
// - The lines are ScreenLines segments between the stars' directions, each
//   stopped GAP_PX short of its stars as a printed atlas draws them, so a
//   line never covers the star it joins. They are drawn in the opaque pass
//   just after the stars, with no depth, so bodies drawn later cover them,
//   as they cover the stars; and they fade with the stars when the eye is
//   dazzled (the adaptation, OrreryScene.updateAdaptation).
// - The names, the ring and the tag are HTML in the sky's overlay.

import * as THREE from 'three';
import { ScreenLines } from './screenLines';
import { choose, decodeInfo, drawn, nameOf, searchNames, starTitle, type Candidate, type Constellation, type NameRow, type StarInfo, type StarNames } from './skyCatalogue';

export const PICK_PX = 8;            // CSS px; a touch gets TOUCH_PX
export const TOUCH_PX = 14;
const GAP_PX = 5;                    // where a line stops short of its star
const LINE_HALF_PX = 0.6;
const LINE_ALPHA = 0.55;
const LINE_COLOUR = 0x5f7f99;        // DESIGN.md: data encodings, the sky

export interface SkyCatalogue {
  info: StarInfo;
  names: Map<number, StarNames>;
  constellations: Constellation[];
}

export class SkyLayer {
  // A star chosen (its index), or null for a click on empty sky.
  onPick: (index: number | null) => void = () => {};
  readonly lines: ScreenLines;
  private pos: Float32Array | null = null;
  private mag: Float32Array | null = null;
  private points: THREE.Points | null = null;
  private raw: Int16Array | null = null;
  private cons: Constellation[] = [];
  private segs: [number, number][] = [];
  private linesOn = false;
  private namesOn = false;
  private selected: number | null = null;
  private hoverAt: { x: number; y: number; touch: boolean } | null = null;
  private hovered: number | null = null;
  private hoverMoved = false;
  private hoverFrames = 0;
  private nameEls: HTMLDivElement[] = [];
  private ring: HTMLDivElement;
  private tag: HTMLDivElement;
  private catalogue: Promise<SkyCatalogue> | null = null;
  private loaded: SkyCatalogue | null = null;
  private trimmedFor = -1;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();

  constructor(scene: THREE.Scene, private overlay: HTMLElement, private base: string,
    private occluded: (dir: THREE.Vector3) => boolean) {
    this.lines = new ScreenLines(1024, LINE_COLOUR);
    const m = this.lines.material;
    m.transparent = false;                 // the opaque pass, after the stars (renderOrder)
    m.depthTest = false;
    this.lines.mesh.renderOrder = -998;
    this.lines.mesh.visible = false;
    scene.add(this.lines.mesh);
    this.ring = document.createElement('div');
    this.ring.className = 'sky-ring';
    this.ring.hidden = true;
    this.tag = document.createElement('div');
    this.tag.className = 'sky-tag';
    this.tag.hidden = true;
    overlay.append(this.ring, this.tag);
  }

  // The point layer, once its file has loaded, and that file (hipparcos.bin:
  // int16 x, y, z, V x 1000, B-V x 1000 per star).
  setStars(points: THREE.Points, data: Int16Array): void {
    this.points = points;
    this.raw = data;
    this.pos = (points.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    this.mag = (points.geometry.getAttribute('mag') as THREE.BufferAttribute).array as Float32Array;
    if (this.cons.length) this.buildLines();
  }

  // The catalogue files, fetched once, the first time anything needs them.
  load(): Promise<SkyCatalogue> {
    if (!this.catalogue) {
      const get = (p: string) => fetch(`${this.base}sky/${p}`).then((r) => { if (!r.ok) throw new Error(`sky/${p}: ${r.status}`); return r; });
      this.catalogue = Promise.all([
        get('stars-info.bin').then((r) => r.arrayBuffer()),
        get('names.json').then((r) => r.json() as Promise<{ stars: NameRow[] }>),
        get('constellations.json').then((r) => r.json() as Promise<{ constellations: Constellation[] }>),
      ]).then(([info, names, cons]) => {
        const c: SkyCatalogue = { info: decodeInfo(info), names: new Map(names.stars.map((r) => [r[0], nameOf(r)])), constellations: cons.constellations };
        this.loaded = c;
        this.cons = c.constellations;
        this.buildLines();
        return c;
      });
      this.catalogue.catch(() => { this.catalogue = null; });
    }
    return this.catalogue;
  }

  get ready(): SkyCatalogue | null { return this.loaded; }

  // FIND's index, built once the catalogue has loaded: every star with a
  // name or designation, brightest first (so among equal matches the
  // brighter comes first), and the HIP and HD numbers of every star.
  private index: { entries: { index: number; names: string[] }[]; byHip: Map<number, number>; byHd: Map<number, number> } | null = null;
  searchIndex() {
    const c = this.loaded, mag = this.mag;
    if (!c || !mag) return null;
    if (!this.index) {
      const gen = new Map(c.constellations.map((k) => [k.abbr, k.gen]));
      const entries = [...c.names.values()].map((s) => ({ index: s.index, names: searchNames(s, c.info.hip[s.index], c.info.hd[s.index], (a) => gen.get(a)) }));
      entries.sort((a, b) => mag[a.index] - mag[b.index]);
      const byHip = new Map<number, number>(), byHd = new Map<number, number>();
      for (let i = 0; i < c.info.n; i++) {
        byHip.set(c.info.hip[i], i);
        const hd = c.info.hd[i];
        if (hd && (!byHd.has(hd) || mag[i] < mag[byHd.get(hd)!])) byHd.set(hd, i);
      }
      this.index = { entries, byHip, byHd };
    }
    return this.index;
  }
  magOf(index: number): number { return this.mag?.[index] ?? NaN; }

  setLines(on: boolean): void {
    this.linesOn = on;
    this.lines.mesh.visible = on && this.segs.length > 0;
    if (on) void this.load().catch(() => {});
  }
  setNames(on: boolean): void {
    this.namesOn = on;
    if (on) void this.load().catch(() => {});
    else for (const el of this.nameEls) el.hidden = true;
  }

  private buildLines(): void {
    if (!this.pos || !this.cons.length) return;
    this.segs = this.cons.flatMap((c) => c.lines);
    this.trimmedFor = -1;
    this.lines.mesh.visible = this.linesOn;
    this.nameEls = this.cons.map((c) => {
      const el = document.createElement('div');
      el.className = 'sky-name';
      el.textContent = c.name;
      el.title = `${c.name} (${c.abbr}), genitive ${c.gen}: ${c.en}`;
      el.hidden = true;
      this.overlay.appendChild(el);
      return el;
    });
  }

  dir(index: number, out: THREE.Vector3): THREE.Vector3 {
    const p = this.pos!;
    return out.set(p[3 * index], p[3 * index + 1], p[3 * index + 2]);
  }

  // A constellation's label point, in render axes.
  labelDir(c: Constellation, out = new THREE.Vector3()): THREE.Vector3 {
    const ra = (c.label[0] * Math.PI) / 180, dec = (c.label[1] * Math.PI) / 180;
    return this.eqjToRender(out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)));
  }

  // The ring round a star, or none.
  select(index: number | null): void {
    this.selected = index;
    if (index === null) this.ring.hidden = true;
  }
  get selection(): number | null { return this.selected; }

  // The pointer over the sky (null: it left, or a drag began).
  hover(at: { x: number; y: number; touch: boolean } | null): void {
    this.hoverAt = at && !at.touch ? at : null;
    this.hoverMoved = true;
    if (!this.hoverAt) { this.hovered = null; this.tag.hidden = true; }
  }

  // The star under a point of the sky's canvas (CSS px from its top left).
  pickAt(x: number, y: number, camera: THREE.PerspectiveCamera, width: number, height: number, touch = false): number | null {
    const pos = this.pos, mag = this.mag, pts = this.points;
    if (!pos || !mag || !pts) return null;
    const u = (pts.material as THREE.ShaderMaterial).uniforms;
    const radius = touch ? TOUCH_PX : PICK_PX;
    // The pointer's direction, and the cone a pick circle spans about it.
    const ray = this.v.set((x / width) * 2 - 1, 1 - (y / height) * 2, 0.5).unproject(camera).normalize();
    const radPerPx = ((camera.fov * Math.PI) / 180) / height;
    const cosCone = Math.cos(Math.min(0.5, (radius + 2) * radPerPx * 1.5));
    const cands: Candidate[] = [];
    const s = this.w;
    for (let i = 0, n = mag.length; i < n; i++) {
      const d = pos[3 * i] * ray.x + pos[3 * i + 1] * ray.y + pos[3 * i + 2] * ray.z;
      if (d < cosCone) continue;
      if (!drawn(mag[i], u.peak0.value, u.peakScale.value, u.visibility.value)) continue;
      s.set(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]).project(camera);
      const sx = ((s.x + 1) / 2) * width, sy = ((1 - s.y) / 2) * height;
      cands.push({ index: i, mag: mag[i], dPx: Math.hypot(sx - x, sy - y) });
    }
    cands.sort((a, b) => a.mag - b.mag);
    for (;;) {
      const best = choose(cands, radius);
      if (best === null) return null;
      if (!this.occluded(this.dir(best, s))) return best;
      cands.splice(cands.findIndex((c) => c.index === best), 1);   // behind a disc: the next one
    }
  }

  // Each frame, after the camera is placed.
  update(camera: THREE.PerspectiveCamera, width: number, height: number, level: number, adapt: number): void {
    const visible = adapt > 0.02;
    // The lines: trimmed by the angle GAP_PX spans (the field of view is fixed,
    // so this is redone only when the sky's height changes).
    if (this.linesOn && this.segs.length && this.pos) {
      if (this.trimmedFor !== height) this.trimLines(((camera.fov * Math.PI) / 180) / height, height);
      this.lines.setViewWidth(width);
      this.lines.material.uniforms.level.value = level * adapt;
      this.lines.mesh.visible = visible;
    }
    const toScreen = (d: THREE.Vector3): [number, number] | null => {
      const p = this.w.copy(d).applyMatrix4(camera.matrixWorldInverse);
      if (p.z >= 0) return null;
      p.copy(d).project(camera);
      const sx = ((p.x + 1) / 2) * width, sy = ((1 - p.y) / 2) * height;
      return sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50 ? null : [sx, sy];
    };
    // The names, at their label points.
    if (this.namesOn && this.nameEls.length) {
      this.cons.forEach((c, k) => {
        const el = this.nameEls[k];
        const d = this.labelDir(c, this.v);
        const at = visible ? toScreen(d) : null;
        el.hidden = !at || this.occluded(d);
        if (at) el.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`;
        el.style.opacity = String(Math.min(1, adapt * 1.2));
      });
    }
    // The ring round the chosen star.
    if (this.selected !== null && this.pos) {
      const d = this.dir(this.selected, this.v);
      const at = toScreen(d);
      this.ring.hidden = !at || this.occluded(d);
      if (at) this.ring.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`;
    }
    // The tag beside the star under the pointer: looked for when the pointer
    // moves, and every sixth frame while it rests (the view may be turning).
    if (this.hoverAt) {
      const again = this.hoverMoved || ++this.hoverFrames >= 6;
      if (again) { this.hovered = this.pickAt(this.hoverAt.x, this.hoverAt.y, camera, width, height); this.hoverMoved = false; this.hoverFrames = 0; }
      const i = this.hovered;
      const at = i === null ? null : toScreen(this.dir(i, this.v));
      this.tag.hidden = !at;
      if (at && i !== null) {
        const names = this.loaded?.names.get(i), hip = this.loaded?.info.hip[i];
        this.tag.textContent = `${starTitle(names, hip)} · V ${this.mag![i].toFixed(2)}`;
        this.tag.style.transform = `translate(${Math.round(at[0])}px, ${Math.round(at[1])}px)`;
      }
      if (i !== null && !this.loaded) void this.load().catch(() => {});
    }
  }

  get hoveredStar(): number | null { return this.hovered; }

  // A star's V and B-V as the point layer has them (B-V null where the
  // catalogue gives none).
  photometry(index: number): { v: number; bv: number | null } | null {
    const r = this.raw;
    if (!r || index < 0 || 5 * index + 4 >= r.length) return null;
    const bv = r[5 * index + 4];
    return { v: r[5 * index + 3] / 1000, bv: bv === -32768 ? null : bv / 1000 };
  }

  // J2000 equatorial to render axes: the point layer's own rotation, read
  // back from a star (set by OrreryScene).
  eqjToRender: (v: THREE.Vector3) => THREE.Vector3 = (v) => v;

  private trimLines(radPerPx: number, height: number): void {
    const gap = GAP_PX * radPerPx;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Vector3();
    this.segs.forEach(([i, j], k) => {
      if (k >= this.lines.capacity) return;
      this.dir(i, a); this.dir(j, b);
      const ang = a.angleTo(b);
      if (ang <= 2.5 * gap) { this.lines.clear(k); return; }
      // Along the great circle from a to b, gap in from each end.
      const slerp = (t: number, out: THREE.Vector3) => {
        const s = Math.sin(ang);
        return out.copy(a).multiplyScalar(Math.sin((1 - t) * ang) / s).addScaledVector(b, Math.sin(t * ang) / s);
      };
      // A straight chord: from the camera at the centre, a great circle and
      // its chord both project to the same straight line.
      this.lines.set(k, slerp(gap / ang, p), slerp(1 - gap / ang, q), LINE_HALF_PX, LINE_HALF_PX, LINE_ALPHA, LINE_ALPHA);
    });
    for (let k = this.segs.length; k < this.lines.capacity; k++) this.lines.clear(k);
    this.lines.commit();
    this.trimmedFor = height;
  }
}
