// src/scene/gravityField.ts
//
// A body's real gravity field drawn on its surface
// (docs/physics/gravity-guides.md#gravity-fields): the free-air gravity
// anomaly from the coefficients the kernel flies with, as a diverging
// colour map with contour lines, on a thin shell just above the surface in
// the body's own frame (the toBody rotation its surface material keeps).
//
//   Earth  EGM2008 to degree 70, less the WGS 84 ellipsoid's normal field;
//   Moon   GRAIL GL0660B to degree 100, about a sphere;
//   Mercury, Venus, Mars and the giants: J2 only, the oblateness, about a
//          sphere (the app holds no fuller field for them).
//
// The maps are worked out the first time they are wanted, in a worker
// (gravityField.worker.ts; a quarter of a second for the Moon's), which
// loads the coefficient files only then.

import * as THREE from 'three';
import type { BodyKey } from './catalogue';
import { BODY_BY_KEY } from './catalogue';
import { ZONAL } from '../physics/bodies.js';
import type { FieldQuery, FieldReply, FieldRequest } from './gravityField.worker';

// One worker for every map, started the first time one is wanted.
let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, (r: FieldReply) => void>();
function requestMap(q: FieldQuery): Promise<FieldReply> {
  if (!worker) {
    worker = new Worker(new URL('./gravityField.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<FieldReply>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id); };
  }
  const id = nextId++;
  return new Promise((resolve) => { waiting.set(id, resolve); worker!.postMessage({ ...q, id } satisfies FieldRequest); });
}

export interface FieldInfo {
  title: string;            // what is shown
  source: string;           // where it comes from
  unit: 'mGal' | 'Gal';
  max: number;              // colour scale's end, in unit
  step: number;             // contour interval, in unit
  lo: number; hi: number;   // the map's range, in unit
}

const J2_SOURCE: Partial<Record<BodyKey, string>> = {
  mercury: 'MESSENGER JGMESS160A', venus: 'Magellan MGNP180U', mars: 'MRO120D',
  jupiter: 'Juno (Durante et al. 2020)', saturn: 'Cassini Grand Finale (Iess et al. 2019)',
  uranus: 'Jacobson 2014', neptune: 'Jacobson 2009',
};
export const FIELD_BODIES: BodyKey[] = ['earth', 'moon', ...(Object.keys(J2_SOURCE) as BodyKey[])];

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D map;      // anomaly in the legend's unit, row 0 at -90 deg, column 0 at -180 deg
uniform vec2 size;          // map columns, rows
uniform mat3 toBody;        // render -> body-fixed (shared with the surface material)
uniform vec3 bodyCentre;
uniform float vmax;         // colour scale's end
uniform float interval;     // contour interval
uniform float level;        // 1 / exposure
varying vec3 vWorld;
vec3 ramp(float x) {
  // Linear sRGB of #2f8fb0 (low), the window black (zero), #ffb22e (high).
  vec3 lo = vec3(0.028, 0.275, 0.431), mid = vec3(0.012, 0.011, 0.008), hi = vec3(1.0, 0.445, 0.027);
  return x < 0.0 ? mix(mid, lo, -x) : mix(mid, hi, x);
}
void main() {
  #include <logdepthbuf_fragment>
  vec3 p = normalize(toBody * (vWorld - bodyCentre));
  float lon = atan(p.y, p.x), lat = asin(clamp(p.z, -1.0, 1.0));
  // Texel centres sit on the grid's longitudes and latitudes.
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5 + 0.5 / size.x, (lat / PI + 0.5) * (size.y - 1.0) / size.y + 0.5 / size.y);
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  bool useB = abs(dxB.x) + abs(dyB.x) < abs(dxA.x) + abs(dyA.x);
  float v = textureGrad(map, uv, useB ? dxB : dxA, useB ? dyB : dyA).r;
  vec3 c = ramp(clamp(v / vmax, -1.0, 1.0));
  // Contours about a pixel wide, away from zero (the colour's middle
  // already marks it, and its line wanders through every flat region).
  float f = v / interval;
  float w = fwidth(f);
  float line = (1.0 - smoothstep(0.5, 1.5, abs(fract(f + 0.5) - 0.5) / max(w, 1e-6))) * step(0.5, abs(f));
  vec3 ink = vec3(0.84, 0.70, 0.43);
  c = mix(c, ink, line * 0.4);
  // Mostly opaque, so the lit side's own light does not drown the colours.
  float a = max(0.8, line * 0.9);
  gl_FragColor = vec4(c * level, a);
}
`;

const niceStep = (x: number): number => {
  const p = 10 ** Math.floor(Math.log10(x)), f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * p;
};

export class GravityFieldLayer {
  private shells = new Map<BodyKey, THREE.Mesh>();
  private info = new Map<BodyKey, FieldInfo>();
  private pending = new Set<BodyKey>();
  private geometry = new THREE.SphereGeometry(1, 128, 64);
  readonly legend: HTMLDivElement;
  private shown: BodyKey | null = null;
  private disposed = false;
  on = false;

  constructor(private scene: THREE.Scene, overlay: HTMLElement) {
    this.legend = document.createElement('div');
    this.legend.className = 'field-legend';
    this.legend.hidden = true;
    overlay.appendChild(this.legend);
  }

  // Each frame: shells on the bodies big enough to see (worked out the
  // first time), and the legend for the focus (or the biggest shown).
  update(meshes: Map<BodyKey, THREE.Mesh>, materials: Map<BodyKey, THREE.ShaderMaterial>, radiusPx: (k: BodyKey) => number,
    focus: BodyKey | null, level: number): void {
    let legendFor: BodyKey | null = null, best = 0;
    for (const k of FIELD_BODIES) {
      const px = radiusPx(k);
      const shell = this.shells.get(k);
      const show = this.on && px > 6;
      if (show && !shell && !this.pending.has(k)) void this.build(k, materials.get(k)!);
      if (shell) {
        shell.visible = show;
        if (show) {
          // Just outside the body's own ellipsoid, turned with it.
          const m = meshes.get(k)!;
          shell.position.copy(m.position);
          shell.quaternion.copy(m.quaternion);
          shell.scale.copy(m.scale).multiplyScalar(1.0015);
          (shell.material as THREE.ShaderMaterial).uniforms.level.value = level;
        }
      }
      if (show && this.info.has(k) && (k === focus ? Infinity : px) > best) { best = k === focus ? Infinity : px; legendFor = k; }
    }
    if (legendFor !== this.shown) {
      this.shown = legendFor;
      this.legend.hidden = legendFor === null;
      if (legendFor) this.drawLegend(legendFor, this.info.get(legendFor)!);
    }
  }

  private async build(key: BodyKey, material: THREE.ShaderMaterial): Promise<void> {
    this.pending.add(key);
    const body = BODY_BY_KEY[key];
    let reply: FieldReply, title: string, source: string;
    if (key === 'earth') {
      reply = await requestMap({ kind: 'earth' });
      title = 'Free-air gravity anomaly';
      source = 'EGM2008 to degree 70 (about 290 km), less the WGS 84 ellipsoid';
    } else if (key === 'moon') {
      reply = await requestMap({ kind: 'moon' });
      title = 'Free-air gravity anomaly';
      source = 'GRAIL GL0660B to degree 100 (about 55 km), about a sphere';
    } else {
      const z = (ZONAL as Record<string, { j2: number; rJ2: number }>)[key];
      reply = await requestMap({ kind: 'j2', gm: body.gm!, j2: z.j2, radius: z.rJ2 });
      title = 'Gravity from J2 only: the oblateness';
      source = `J2 from ${J2_SOURCE[key]}, about a sphere; no fuller field in the app`;
    }
    const { values, width, height } = reply;
    if (this.disposed) return;
    // km/s^2 -> mGal (1e-5 m/s^2), or Gal (cm/s^2) for the giants.
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const big = Math.max(-lo, hi) * 1e8 > 5000;
    const k = big ? 1e5 : 1e8;
    const unit = big ? 'Gal' : 'mGal';
    const half = new Uint16Array(values.length);
    for (let i = 0; i < values.length; i++) half[i] = THREE.DataUtils.toHalfFloat(values[i] * k);
    const tex = new THREE.DataTexture(half, width, height, THREE.RedFormat, THREE.HalfFloatType);
    tex.wrapS = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    const max = niceStep(Math.max(-lo, hi) * k);
    const info: FieldInfo = { title, source, unit, max, step: niceStep(max / 2), lo: lo * k, hi: hi * k };
    const u = material.uniforms;
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, toneMapped: false,
      // Shares the surface material's rotation and centre, kept current there.
      uniforms: {
        map: { value: tex }, size: { value: new THREE.Vector2(width, height) },
        toBody: u.toBody, bodyCentre: u.bodyCentre,
        vmax: { value: max }, interval: { value: info.step }, level: { value: 1 },
      },
    });
    const shell = new THREE.Mesh(this.geometry, mat);
    shell.renderOrder = 10;             // over the atmosphere shell, which writes no depth
    shell.visible = false;
    this.scene.add(shell);
    this.shells.set(key, shell);
    this.info.set(key, info);
    this.pending.delete(key);
    this.shown = null;              // redraw the legend
  }

  private drawLegend(key: BodyKey, f: FieldInfo): void {
    const fmt = (v: number) => (Number.isInteger(v) || Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toPrecision(2));
    this.legend.innerHTML = '';
    const h = document.createElement('p');
    h.className = 'field-title';
    h.textContent = `${BODY_BY_KEY[key].name} · ${f.title}`;
    const bar = document.createElement('div');
    bar.className = 'field-bar';
    const ticks = document.createElement('p');
    ticks.className = 'field-ticks';
    for (const v of [-f.max, -f.max / 2, 0, f.max / 2, f.max]) {
      const s = document.createElement('span');
      s.textContent = v === 0 ? '0' : `${v > 0 ? '+' : '−'}${fmt(Math.abs(v))}`;
      ticks.appendChild(s);
    }
    const unit = document.createElement('p');
    unit.className = 'field-unit';
    unit.textContent = `${f.unit}, contours every ${fmt(f.step)}; this map ${fmt(f.lo)} to +${fmt(f.hi)}`;
    const src = document.createElement('p');
    src.className = 'field-source';
    src.textContent = f.source;
    this.legend.append(h, bar, ticks, unit, src);
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.shells.values()) {
      this.scene.remove(s);
      const m = s.material as THREE.ShaderMaterial;
      (m.uniforms.map.value as THREE.Texture).dispose();
      m.dispose();
    }
    this.geometry.dispose();
    this.legend.remove();
  }
}
