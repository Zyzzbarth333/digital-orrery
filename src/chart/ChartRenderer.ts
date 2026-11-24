// src/chart/ChartRenderer.ts
//
// Draws the chart's raster with the 3D view's own WebGL renderer, while the
// 3D sky is paused behind it (OrreryScene.setChart): the colour maps the 3D
// view has uploaded are used as they are, and nothing is added to the 3D
// frame. The main view and its polar insets are one quad each, scissored.

import * as THREE from 'three';
import { makeChartMaterial, LAYER } from './chartMaterial';
import type { Elevation } from './elevation';
import type { View } from './projection';

export interface Viewport { view: View; x: number; y: number; limit: number; inset?: 'n' | 's' | null }   // x, y: CSS px from the canvas's top left

// Ramps, sRGB, low to high (docs/frontend/chart.md#tints). A body's: lightness
// rises with height, hue from indigo through teal and green to sand, so
// higher always reads lighter (no rainbow). The Earth's land: the
// atlas greens to browns to snow; its sea: pale shallows to deep blue.
const BODY_RAMP: [number, string][] = [[0, '#24204a'], [0.16, '#2c4a7c'], [0.32, '#2f7a86'], [0.48, '#5e9c6c'], [0.64, '#a8b25e'], [0.8, '#d8b878'], [0.92, '#ead2a8'], [1, '#f8f1e4']];
// Land by sqrt(h / top): 0, 200, 500, 1000, 2000, 3000, 4500 and 6000 m.
const LAND_RAMP: [number, string][] = [[0, '#6a9e5b'], [0.18, '#94b86a'], [0.29, '#c4c67f'], [0.41, '#dcc083'], [0.58, '#bf9260'], [0.71, '#9c7658'], [0.87, '#c8bcb2'], [1, '#f6f3ef']];
// Sea by sqrt(depth / 11,000 m): 0, 200, 1000, 3000, 5000, 8000 and 11,000 m.
const SEA_RAMP: [number, string][] = [[0, '#d6eef4'], [0.135, '#acd8e8'], [0.3, '#74b3d4'], [0.52, '#4183b8'], [0.67, '#255693'], [0.85, '#15305f'], [1, '#0c1d3d']];
export const RAMPS = { body: BODY_RAMP, land: LAND_RAMP, sea: SEA_RAMP };
export const LAND_TOP_M = 6000;
export const SEA_DEEP_M = 11000;

function rampRow(stops: [number, string][], out: Uint8Array, row: number): void {
  const rgb = stops.map(([t, h]) => [t, parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < rgb.length - 2 && rgb[k + 1][0] < t) k++;
    const [t0, ...a] = rgb[k], [t1, ...b] = rgb[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
    for (let j = 0; j < 3; j++) out[(row * 256 + i) * 4 + j] = Math.round(a[j] + (b[j] - a[j]) * f);
    out[(row * 256 + i) * 4 + 3] = 255;
  }
}

function rampTexture(top: [number, string][], bottom: [number, string][]): THREE.DataTexture {
  const d = new Uint8Array(256 * 2 * 4);
  rampRow(top, d, 0); rampRow(bottom, d, 1);
  const t = new THREE.DataTexture(d, 256, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

export class ChartRenderer {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat = makeChartMaterial();
  private quad: THREE.Mesh;
  private base: THREE.DataTexture | null = null;
  private tiles: THREE.DataArrayTexture | null = null;
  private mask = 0;
  private elev: Elevation | null = null;
  private ramps = { body: rampTexture(BODY_RAMP, SEA_RAMP), earth: rampTexture(LAND_RAMP, SEA_RAMP) };
  private clear = new THREE.Color();

  constructor(private renderer: THREE.WebGLRenderer) {
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.mat.uniforms.uRamp.value = this.ramps.body;
  }

  setColour(tex: THREE.Texture | null): void {
    const u = this.mat.uniforms;
    u.uColour.value = tex;
    u.uHasColour.value = !!tex;
  }

  setStyle(earth: boolean, rangeM: [number, number], radiusKm: number): void {
    const u = this.mat.uniforms;
    u.uStyle.value = earth ? 1 : 0;
    u.uRamp.value = earth ? this.ramps.earth : this.ramps.body;
    (u.uRange.value as THREE.Vector2).set(earth ? 0 : rangeM[0], earth ? LAND_TOP_M : rangeM[1]);
    u.uSeaDepth.value = SEA_DEEP_M;
    u.uRadius.value = radiusKm * 1000;
  }

  // The body's elevation (null: none). Its 16 px/deg tiles go into the
  // texture array as they arrive (tileIn).
  setElevation(e: Elevation | null): void {
    this.base?.dispose(); this.base = null;
    this.tiles?.dispose(); this.tiles = null;
    this.mask = 0;
    this.elev = e;
    const u = this.mat.uniforms;
    u.uHasElev.value = false;
    u.uMask.value = 0;
    if (!e) return;
    const en = e.entry;
    u.uBaseW.value = en.baseWidth; u.uFineW.value = en.width; u.uTileW.value = e.tileW; u.uTilesX.value = en.tilesX;
    this.sync();
  }

  // Take what the elevation now holds (its base, any new tiles).
  sync(): void {
    const e = this.elev;
    if (!e) return;
    const u = this.mat.uniforms;
    if (e.base && !this.base) {
      const t = new THREE.DataTexture(e.base, e.entry.baseWidth, e.entry.baseWidth / 2, THREE.RedIntegerFormat, THREE.ShortType);
      t.internalFormat = 'R16I';
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false; t.flipY = false; t.unpackAlignment = 2;
      t.needsUpdate = true;
      this.base = t;
      u.uBase.value = t;
      u.uHasElev.value = true;
    }
    const tw = e.tileW, n = e.tiles.length;
    for (let i = 0; i < n; i++) {
      const g = e.tiles[i];
      if (!g || (this.mask >>> i) & 1) continue;
      if (!this.tiles) {
        const a = new THREE.DataArrayTexture(new Int16Array(tw * tw * n), tw, tw, n);
        a.format = THREE.RedIntegerFormat; a.type = THREE.ShortType; a.internalFormat = 'R16I';
        a.minFilter = a.magFilter = THREE.NearestFilter;
        a.generateMipmaps = false; a.flipY = false; a.unpackAlignment = 2;
        this.tiles = a;
        u.uTiles.value = a;
      }
      (this.tiles.image.data as Int16Array).set(g, i * tw * tw);
      this.tiles.addLayerUpdate(i);
      this.tiles.needsUpdate = true;
      this.mask = (this.mask | (1 << i)) >>> 0;
    }
    u.uMask.value = this.mask;
  }

  render(ports: Viewport[], o: { layers: number; exag: number; sun: [number, number, number] | null; paper: [number, number, number]; dpr: number; cssW: number; cssH: number }): void {
    const r = this.renderer, u = this.mat.uniforms;
    let layers = o.layers;
    if (!o.sun) layers &= ~LAYER.night;
    else (u.uSun.value as THREE.Vector3).set(...o.sun);
    u.uLayers.value = layers;
    u.uExag.value = o.exag;
    (u.uPaper.value as THREE.Vector3).set(...o.paper);
    r.getClearColor(this.clear);
    const alpha = r.getClearAlpha();
    r.setRenderTarget(null);
    r.setClearColor(new THREE.Color().setRGB(o.paper[0], o.paper[1], o.paper[2], THREE.SRGBColorSpace), 1);
    r.setScissorTest(false);
    r.setViewport(0, 0, o.cssW, o.cssH);
    r.clear(true, false, false);
    r.autoClear = false;
    for (const p of ports) {
      const v = p.view;
      const gx = p.x, gy = o.cssH - p.y - v.h;       // GL viewports start at the bottom
      r.setViewport(gx, gy, v.w, v.h);
      r.setScissor(gx, gy, v.w, v.h);
      r.setScissorTest(true);
      u.uProj.value = v.proj === 'eq' ? 0 : v.proj === 'n' ? 1 : 2;
      u.uInset.value = !!p.inset;
      (u.uView.value as THREE.Vector4).set(v.lon0, v.lat0, v.scale * o.dpr, p.limit);
      (u.uPole.value as THREE.Vector2).set(v.px * o.dpr, v.py * o.dpr);
      (u.uRect.value as THREE.Vector4).set(Math.round(gx * o.dpr), Math.round(gy * o.dpr), Math.round(v.w * o.dpr), Math.round(v.h * o.dpr));
      r.render(this.scene, this.camera);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, o.cssW, o.cssH);
    r.autoClear = true;
    r.setClearColor(this.clear, alpha);
  }

  dispose(): void {
    this.base?.dispose(); this.tiles?.dispose();
    this.ramps.body.dispose(); this.ramps.earth.dispose();
    this.quad.geometry.dispose(); this.mat.dispose();
  }
}
