// src/scene/journeyLayer.ts
//
// The journey being planned, in the scene (docs/physics/journey.md#in-the-scene):
// - each leg's transfer arc, a dashed pale-amber line about its central
//   body (the Sun, or a planet for its moons), placed at that body each
//   frame like the orbit lines;
// - the kernel's flown path of it, a thin solid amber line;
// - a burn mark at each burn: an open square reticle with its delta-v in a
//   window tag (orange at a capture or landing, dashed at a flyby).
//
// And the means to shape it by hand (docs/physics/journey.md#shaping-it-by-hand):
// - a click on a leg's arc adds a burn node there; a node's reticle is a
//   phosphor diamond-in-square, and dragging it slides it along the arc;
// - the selected node grows three pairs of handles along its prograde,
//   normal and radial axes, each a short stalk ending in an engraved tab
//   (P+ P-, N+ N-, R+ R-) like a panel's toggle guards; dragging a tab
//   along its stalk adds or takes delta-v (1 m/s a pixel, 0.1 with Shift);
//   a small "x" tab removes it;
// - at each flyby, its aim point: a ring on a stalk out from the planet
//   toward the B vector. Dragging it out or in raises or lowers the pass
//   (|B|), round the planet turns the aim about the approach.
// Every handle is HTML over the sky, so it takes the pointer before the
// camera does. Lines are drawing aids at a display level (setLevel).

import * as THREE from 'three';
import type { JourneyView, JourneyHandlers, JourneyMarkView } from '../app/journey';

type V3 = [number, number, number];
type P2 = [number, number];

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

const NODE_AXES: { axis: 'pro' | 'nor' | 'rad'; key: 'T' | 'N' | 'R'; sign: 1 | -1; label: string; title: string }[] = [
  { axis: 'pro', key: 'T', sign: 1, label: 'P+', title: 'prograde' }, { axis: 'pro', key: 'T', sign: -1, label: 'P−', title: 'retrograde' },
  { axis: 'nor', key: 'N', sign: 1, label: 'N+', title: 'normal' }, { axis: 'nor', key: 'N', sign: -1, label: 'N−', title: 'anti-normal' },
  { axis: 'rad', key: 'R', sign: 1, label: 'R+', title: 'radial out' }, { axis: 'rad', key: 'R', sign: -1, label: 'R−', title: 'radial in' },
];
const STALK = 52;                  // px from a node to its handle tabs
const AIM_STALK = 56;              // px from a planet to its aim ring

interface Mark { m: JourneyMarkView; el: HTMLDivElement; key: string }
interface Handle { el: HTMLDivElement; stalk: HTMLDivElement; dir: P2; kind: 'axis' | 'aim' | 'remove'; axis?: 'pro' | 'nor' | 'rad'; sign?: number }
interface Drawn { lines: { line: THREE.Line; central: string; dashed: boolean }[]; marks: Mark[]; handles: Handle[]; version: number; flownKey: string; selected: string | null }

export class JourneyLayer {
  private drawn: Drawn | null = null;
  private tmp = new THREE.Vector3();
  private level = 1;
  private view: JourneyView | null = null;
  // The last frame's projection, for the pointer.
  private proj: { centralAt: (key: string) => V3 | null; cam: V3; unitKm: number; camera: THREE.Camera; w: number; h: number } | null = null;
  private dragging = false;

  constructor(private scene: THREE.Scene, private overlay: HTMLElement, private handlers: () => JourneyHandlers | null) {
    window.addEventListener('keydown', this.onKey);
  }

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
    for (const h of this.drawn.handles) { h.el.remove(); h.stalk.remove(); }
    this.drawn = null;
  }

  // Before rendering: lines in place.
  place(view: JourneyView | null, centralAt: (key: string) => V3 | null, cam: V3, unitKm: number, camDist: number): void {
    this.view = view;
    const flownKey = view?.flown ? `${view.version}:${view.flown.pts.length}` : '';
    if (!view) { this.clear(); return; }
    if (!this.drawn || this.drawn.version !== view.version || this.drawn.flownKey !== flownKey || this.drawn.selected !== view.selected || this.drawn.marks.length !== view.marks.length) this.build(view, unitKm, flownKey);
    const d = this.drawn!;
    for (const l of d.lines) {
      const c = centralAt(l.central);
      if (!c) { l.line.visible = false; continue; }
      l.line.visible = true;
      toRender([c[0] - cam[0], c[1] - cam[1], c[2] - cam[2]], unitKm, l.line.position);
      // Dashes a fixed share of the view, so the line reads as dashed at
      // every zoom.
      if (l.dashed) {
        const m = l.line.material as THREE.LineDashedMaterial;
        m.dashSize = camDist / unitKm / 60; m.gapSize = m.dashSize * 0.8;
      }
    }
  }

  // Lines are rebuilt when the journey changes. Marks and handles are
  // kept, by key, while their ids last: a drag re-solves the journey at
  // every step, and its handle must not be taken from under the pointer.
  private build(view: JourneyView, unitKm: number, flownKey: string): void {
    const old = this.drawn;
    let lines: Drawn['lines'];
    if (old && old.version === view.version && old.flownKey === flownKey) lines = old.lines;
    else {
      for (const d of old?.lines ?? []) { this.scene.remove(d.line); d.line.geometry.dispose(); (d.line.material as THREE.Material).dispose(); }
      lines = [];
      for (const a of view.arcs) lines.push({ line: line(a.pts, unitKm, 0xecd9b0, 0.7, true), central: a.central, dashed: true });
      if (view.flown && view.flown.pts.length > 1) lines.push({ line: line(view.flown.pts, unitKm, 0xffb22e, 0.85, false), central: view.flown.central, dashed: false });
      for (const l of lines) this.scene.add(l.line);
    }
    const key = (m: JourneyMarkView, i: number) => m.id ?? `${m.kind}:${i}`;
    const was = new Map((old?.marks ?? []).map((x) => [x.key, x]));
    const marks: Mark[] = view.marks.map((m, i) => {
      const k = key(m, i);
      let el = was.get(k)?.el;
      was.delete(k);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<span class="reticle" aria-hidden="true"></span><span class="dv"></span>';
        if (m.id) this.grip(el, m.id);
        this.overlay.appendChild(el);
      }
      const selected = m.id !== undefined && m.id === view.selected;
      el.className = `burn-node ${m.kind}${selected ? ' selected' : ''}${m.id ? ' grip' : ''}`;
      (el.querySelector('.dv') as HTMLElement).textContent = m.kind === 'aim' ? `${m.label}${m.b ? ` · B ${Math.round(Math.hypot(m.b[0], m.b[1])).toLocaleString('en-AU')} km` : ''}` : `${m.label} · Δv ${m.dv.toFixed(m.kind === 'node' ? 3 : 2)}`;
      el.title = m.kind === 'node' ? 'A burn node: drag to slide it along the arc; select it for its handles'
        : m.kind === 'aim' ? 'The flyby\'s aim: select it, then drag the ring'
          : `${m.label}: ${(m.dv * 1000).toLocaleString('en-AU', { maximumFractionDigits: 0 })} m/s on ${new Date(m.ms).toISOString().slice(0, 10)}`;
      return { m, el, key: k };
    });
    for (const x of was.values()) x.el.remove();
    let handles = old?.handles ?? [];
    if (!old || old.selected !== view.selected || !view.marks.some((m) => m.id === view.selected)) {
      for (const h of handles) { h.el.remove(); h.stalk.remove(); }
      handles = [];
      const sel = view.marks.find((m) => m.id && m.id === view.selected);
      if (sel?.kind === 'node') {
        for (const a of NODE_AXES) handles.push(this.handle(`tab ${a.axis}`, a.label, `${a.title}: drag along the stalk (Shift: finer)`, { kind: 'axis', axis: a.axis, sign: a.sign }, sel.id!));
        handles.push(this.handle('tab remove', '×', 'Remove this node (Delete)', { kind: 'remove' }, sel.id!));
      } else if (sel?.kind === 'aim') {
        handles.push(this.handle('aim-ring', '', 'Drag out or in to raise or lower the pass, round to turn the aim', { kind: 'aim' }, sel.id!));
        handles.push(this.handle('tab remove', '×', 'Let the planner aim this flyby again', { kind: 'remove' }, sel.id!));
      }
    }
    this.drawn = { lines, marks, handles, version: view.version, flownKey, selected: view.selected };
    this.setLevel(this.level);
  }
  private markById(id: string): JourneyMarkView | null { return this.view?.marks.find((m) => m.id === id) ?? null; }

  // A handle: a stalk from the mark and a tab at its end.
  private handle(cls: string, text: string, title: string, h: Omit<Handle, 'el' | 'stalk' | 'dir'>, id: string): Handle {
    const el = document.createElement('div'), stalk = document.createElement('div');
    el.className = `journey-handle ${cls}`; el.textContent = text; el.title = title;
    el.setAttribute('role', 'button'); el.setAttribute('aria-label', title);
    stalk.className = 'journey-stalk';
    const out: Handle = { el, stalk, dir: [1, 0], ...h };
    this.overlay.append(stalk, el);
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const H = this.handlers(), m0 = this.markById(id);
      if (!H || !m0) return;
      if (out.kind === 'remove') { H.remove(id); H.release(); return; }
      el.setPointerCapture(e.pointerId);
      this.dragging = true;
      const x0 = e.clientX, y0 = e.clientY;
      let lx = x0, ly = y0;
      const b0 = m0.b ? [...m0.b] as [number, number] : null;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - lx, dy = ev.clientY - ly;
        lx = ev.clientX; ly = ev.clientY;
        if (out.kind === 'axis') {
          const px = dx * out.dir[0] + dy * out.dir[1];
          H.nudge(id, out.axis!, px * (ev.shiftKey ? 1e-4 : 1e-3));
        } else if (out.kind === 'aim' && b0) this.dragAim(m0, b0, ev.clientX - x0, ev.clientY - y0, H);
      };
      const up = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        this.dragging = false;
        H.release();
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
    return out;
  }

  // A node's or aim's own mark: a press selects it; dragging a node slides
  // it along its leg's arc to the nearest point under the pointer.
  private grip(el: HTMLDivElement, id: string): void {
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const H = this.handlers();
      if (!H) return;
      H.select(id);
      if (!id.startsWith('node:')) return;
      el.setPointerCapture(e.pointerId);
      this.dragging = true;
      const leg = Number(id.split(':')[1]);
      let moved = false;
      const move = (ev: PointerEvent) => {
        const hit = this.nearest(ev.clientX, ev.clientY, leg);
        if (hit) { moved = true; H.move(id, hit.ms); }
      };
      const up = (ev: PointerEvent) => {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        this.dragging = false;
        if (moved) H.release();
      };
      el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  }

  // The aim ring: out along the stalk scales |B| (doubling over a stalk's
  // length), across it turns B about the approach, the way the pointer
  // goes round the planet on the screen.
  // dx, dy: the pointer's move since the drag began, from aim b0.
  private dragAim(m: JourneyMarkView, b0: [number, number], dx: number, dy: number, H: JourneyHandlers): void {
    const h = this.drawn?.handles.find((x) => x.kind === 'aim');
    if (!h || !m.frame || !this.proj) return;
    const along = dx * h.dir[0] + dy * h.dir[1], across = -dx * h.dir[1] + dy * h.dir[0];
    const B = Math.hypot(b0[0], b0[1]) || 1;
    let th = Math.atan2(b0[1], b0[0]);
    // Which way round T to R runs on the screen.
    const t = this.screenDir(m, m.frame.T), r = this.screenDir(m, m.frame.R);
    const chir = t && r ? Math.sign(t[0] * r[1] - t[1] * r[0]) || 1 : 1;
    th += chir * across / AIM_STALK;
    const B2 = Math.max(1, B * Math.exp(along / AIM_STALK));
    H.aim(m.id!, B2 * Math.cos(th), B2 * Math.sin(th));
  }

  // The screen direction (unit, px) of a direction in space at a mark.
  private screenDir(m: JourneyMarkView, d: V3): P2 | null {
    const p = this.proj;
    if (!p) return null;
    const c = p.centralAt(m.central);
    if (!c) return null;
    const a = this.screen([c[0] + m.at[0], c[1] + m.at[1], c[2] + m.at[2]]);
    const L = Math.max(1, Math.hypot(m.at[0], m.at[1], m.at[2])) * 1e-3 + 1;
    const b = this.screen([c[0] + m.at[0] + d[0] * L, c[1] + m.at[1] + d[1] * L, c[2] + m.at[2] + d[2] * L]);
    if (!a || !b) return null;
    const v: P2 = [b[0] - a[0], b[1] - a[1]], n = Math.hypot(v[0], v[1]);
    return n > 1e-9 ? [v[0] / n, v[1] / n] : null;
  }
  // A heliocentric (ecliptic km) point on the screen (px from the sky's corner).
  private screen(x: number[]): P2 | null {
    const p = this.proj!;
    const ndc = toRender([x[0] - p.cam[0], x[1] - p.cam[1], x[2] - p.cam[2]], p.unitKm, this.tmp).project(p.camera);
    if (ndc.z > 1 || ndc.z < -1) return null;
    return [((ndc.x + 1) / 2) * p.w, ((1 - ndc.y) / 2) * p.h];
  }

  // The point of leg's arc (or any leg's) nearest the pointer, within 12 px.
  private nearest(clientX: number, clientY: number, leg: number | null = null): { leg: number; ms: number } | null {
    if (!this.view || !this.proj) return null;
    const box = this.overlay.getBoundingClientRect(), x = clientX - box.left, y = clientY - box.top;
    let best: { leg: number; ms: number; d: number } | null = null;
    for (const a of this.view.arcs) {
      if (leg !== null && a.leg !== leg) continue;
      const c = this.proj.centralAt(a.central);
      if (!c) continue;
      const n = a.pts.length;
      for (let i = 0; i < n; i++) {
        const s = this.screen([c[0] + a.pts[i][0], c[1] + a.pts[i][1], c[2] + a.pts[i][2]]);
        if (!s) continue;
        const d = Math.hypot(s[0] - x, s[1] - y);
        if (!best || d < best.d) best = { leg: a.leg, ms: a.t1 + ((a.t2 - a.t1) * i) / Math.max(1, n - 1), d };
      }
    }
    return best && (leg !== null || best.d < 12) ? { leg: best.leg, ms: best.ms } : null;
  }

  // A click on the sky (not a drag): a node on the arc under it, or else
  // nothing selected. True if the journey took the click.
  click(clientX: number, clientY: number): boolean {
    const H = this.handlers();
    if (!H || !this.view) return false;
    const hit = this.nearest(clientX, clientY);
    if (hit) { H.add(hit.leg, Math.round(hit.ms)); H.release(); return true; }
    if (this.view.selected) { H.select(null); return true; }
    return false;
  }

  private onKey = (e: KeyboardEvent): void => {
    const sel = this.view?.selected, tag = (e.target as HTMLElement | null)?.tagName;
    if (!sel || (e.key !== 'Delete' && e.key !== 'Backspace') || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const H = this.handlers();
    if (!H) return;
    e.preventDefault();
    H.remove(sel); H.release();
  };

  // After the camera is set: the marks and handles at their places.
  label(centralAt: (key: string) => V3 | null, cam: V3, unitKm: number, camera: THREE.Camera, w: number, h: number): void {
    this.proj = { centralAt, cam, unitKm, camera, w, h };
    const dpr = window.devicePixelRatio || 1, at = (el: HTMLElement, x: number, y: number) => { el.style.transform = `translate(${Math.round(x * dpr) / dpr}px, ${Math.round(y * dpr) / dpr}px)`; };
    let selAt: P2 | null = null, selMark: JourneyMarkView | null = null;
    for (const m of this.drawn?.marks ?? []) {
      const c = centralAt(m.m.central);
      const s = c && this.screen([c[0] + m.m.at[0], c[1] + m.m.at[1], c[2] + m.m.at[2]]);
      if (!s) { m.el.style.display = 'none'; continue; }
      m.el.style.display = '';
      at(m.el, s[0], s[1]);
      if (m.m.id && m.m.id === this.view?.selected) { selAt = s; selMark = m.m; }
    }
    for (const hd of this.drawn?.handles ?? []) {
      if (!selAt || !selMark) { hd.el.style.display = hd.stalk.style.display = 'none'; continue; }
      let dir: P2 | null = null, len = STALK;
      if (hd.kind === 'axis' && selMark.frame) {
        const d = this.screenDir(selMark, selMark.frame[NODE_AXES.find((a) => a.axis === hd.axis)!.key]);
        dir = d && [d[0] * hd.sign!, d[1] * hd.sign!];
      } else if (hd.kind === 'aim' && selMark.frame && selMark.b) {
        const B = selMark.b, n = Math.hypot(B[0], B[1]) || 1;
        dir = this.screenDir(selMark, [0, 1, 2].map((i) => (selMark!.frame!.T[i] * B[0] + selMark!.frame!.R[i] * B[1]) / n) as V3);
        len = AIM_STALK;
      } else if (hd.kind === 'remove') { dir = [0.7071, -0.7071]; len = 26; }
      if (!dir) { hd.el.style.display = hd.stalk.style.display = 'none'; continue; }
      if (!this.dragging) hd.dir = dir;
      hd.el.style.display = hd.stalk.style.display = '';
      at(hd.el, selAt[0] + hd.dir[0] * len, selAt[1] + hd.dir[1] * len);
      hd.stalk.style.width = `${len}px`;
      hd.stalk.style.transform = `translate(${selAt[0]}px, ${selAt[1]}px) rotate(${Math.atan2(hd.dir[1], hd.dir[0])}rad)`;
    }
  }

  dispose(): void { this.clear(); window.removeEventListener('keydown', this.onKey); }
}
