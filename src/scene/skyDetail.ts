// src/scene/skyDetail.ts
//
// The Milky Way at 16384 x 8192 where the screen can show it
// (docs/frontend/textures.md#loading-the-sky). The base map (8192 wide,
// stars.ts) is about one texel a pixel on a 1080-line screen at the 45 deg
// field of view; a taller canvas (a 2x display) magnifies it. The full
// 16k map would take 0.7 GB of video memory with mipmaps, so it is cut
// into 1024-px tiles and only those in view are kept, in a texture array
// of SLOTS layers (one level, 101 MB). The shader blends from the base to
// a tile as the tile's texels grow past a pixel: the tile is the base's
// missing finer mipmap level, so the tiles need no mipmaps of their own.
//
// Tiles in view for a quarter second are fetched and decoded in the worker
// (surfaces.ts decodeImage), and uploaded one a frame (4.2 MB, about the
// uploader's budget). Where the GPU takes a Basis target (ktx2.ts), the
// tiles' KTX2 copies are transcoded instead and the array is compressed:
// 25 MB in BC7, not 101; if one fails, the tiles go back to the WebP.

import * as THREE from 'three';
import { decodeImage } from './surfaces';
import { ktx2Ready, loadKtx2, type CompressedLevels } from './ktx2';

export interface SkyDetailEntry {
  tiles: string;     // path with {row} and {col}; row 0 at the north
  width: number;     // full map width, px (height is half)
  tile: number;      // tile side, px
  gutter: number;    // px of each neighbour around a tile
  tilesKtx2?: string;  // the same tiles as KTX2 (python/textures/build_ktx2.py)
}

const SLOTS = 24;
const GRID_X = 24, GRID_Y = 14;     // view directions sampled for the tiles in view
const MAX_LOADS = 3;
const DWELL_MS = 250;               // a tile is fetched once it has stayed in view this long

// Shader parts for stars.ts: the uniforms and a function that refines the
// base colour. uv: the base lookup (u from the left edge, v from the
// south); gx, gy: its continuous derivatives.
export const SKY_DETAIL_GLSL = /* glsl */ `
uniform sampler2DArray detail;
uniform vec4 detailSlots[32];   // per tile (row from the south * cols + col): layer, or -1
uniform vec4 detailGrid;        // cols, rows, tile px, gutter px
uniform float detailOn;
vec3 skyDetail(vec3 base, vec2 uv, vec2 gx, vec2 gy) {
  if (detailOn < 0.5) return base;
  vec2 size = vec2(detailGrid.x, detailGrid.y) * detailGrid.z;
  // The tiles' mip level: the base's level 0 is the detail's level 1.
  float rho = max(length(gx * size), length(gy * size));
  float w = clamp(1.0 - log2(max(rho, 1e-6)), 0.0, 1.0);
  if (w <= 0.0) return base;
  vec2 px = uv * size;
  vec2 t = min(floor(px / detailGrid.z), vec2(detailGrid.x, detailGrid.y) - 1.0);
  int idx = int(t.y * detailGrid.x + t.x);
  vec4 q = detailSlots[idx / 4];
  int k = idx - 4 * (idx / 4);
  float layer = k == 0 ? q.x : k == 1 ? q.y : k == 2 ? q.z : q.w;
  if (layer < 0.0) return base;
  vec2 st = (px - t * detailGrid.z + detailGrid.w) / (detailGrid.z + 2.0 * detailGrid.w);
  return mix(base, textureLod(detail, vec3(st, layer), 0.0).rgb, w);
}
`;

export class SkyDetail {
  readonly uniforms: Record<string, THREE.IUniform>;
  private cols: number;
  private rows: number;
  private side: number;               // stored tile side with gutters
  private tex: THREE.ExternalTexture | null = null;
  private glTex: WebGLTexture | null = null;
  private slotTile = new Array<number>(SLOTS).fill(-1);
  private slotSeen = new Array<number>(SLOTS).fill(0);
  private loading = new Map<number, number>();         // tile -> slot it goes to
  private ready: { tile: number; slot: number; bitmap: ImageBitmap | null; levels: CompressedLevels | null }[] = [];
  private ktx2: boolean;
  private format = 0;                  // the array's internal format, once allocated
  gpuBytes = 0;                        // the array's video memory (window.orrery with ?debug)
  private ctx: WebGL2RenderingContext | null = null;
  private frameNo = 0;
  private generation = 0;              // bumped by reset(): late tiles are dropped
  private v = new THREE.Vector3();
  private score = new Map<number, number>();
  private since = new Map<number, number>();        // tile -> when it came into view

  constructor(private entry: SkyDetailEntry, private base: string, private toEqj: THREE.Matrix3,
    private raAtLeft: number, private raDirection: number) {
    this.cols = entry.width / entry.tile;
    this.rows = entry.width / 2 / entry.tile;
    this.side = entry.tile + 2 * entry.gutter;
    this.ktx2 = !!entry.tilesKtx2;
    this.uniforms = {
      detail: { value: null },
      detailSlots: { value: Array.from({ length: 32 }, () => new THREE.Vector4(-1, -1, -1, -1)) },
      detailGrid: { value: new THREE.Vector4(this.cols, this.rows, entry.tile, entry.gutter) },
      detailOn: { value: 0 },
    };
  }

  // Called before the sky is drawn. Turns the tiles on when a pixel at the
  // canvas's full resolution (not the adaptive render scale's) is smaller
  // than 0.8 of a base texel, and keeps the tiles in view loaded.
  update(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera): void {
    this.frameNo++;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.ctx = gl;
    if (gl.isContextLost()) return;
    const full = renderer.domElement.clientHeight * Math.min(window.devicePixelRatio || 1, 2);
    const degPerPx = camera.fov / Math.max(1, full);
    const texPerDeg = this.entry.width / 360;            // detail texels per degree
    const want = degPerPx * texPerDeg < 2 * 0.8;
    if (!want) { this.release(gl); return; }

    // Tiles in view, each scored by the view directions that need it (where
    // a pixel is under two detail texels across, at its declination).
    this.score.clear();
    for (let j = 0; j <= GRID_Y; j++) {
      for (let i = 0; i <= GRID_X; i++) {
        const d = this.v.set((i / GRID_X) * 2.2 - 1.1, (j / GRID_Y) * 2.2 - 1.1, 0.5).unproject(camera).normalize().applyMatrix3(this.toEqj);
        const dec = Math.asin(Math.max(-1, Math.min(1, d.z)));
        if ((degPerPx * texPerDeg) / Math.max(1e-3, Math.cos(dec)) >= 2) continue;
        const ra = Math.atan2(d.y, d.x);
        const u = ((this.raDirection * (ra - this.raAtLeft)) / (2 * Math.PI)) % 1;
        const col = Math.min(this.cols - 1, Math.floor((u < 0 ? u + 1 : u) * this.cols));
        const rowS = Math.min(this.rows - 1, Math.floor((dec / Math.PI + 0.5) * this.rows));
        const t = rowS * this.cols + col;
        this.score.set(t, (this.score.get(t) ?? 0) + 1);
      }
    }
    for (let s = 0; s < SLOTS; s++) if (this.score.has(this.slotTile[s])) this.slotSeen[s] = this.frameNo;
    // Tiles swept past in a flight or a fast turn are not fetched.
    const now = performance.now();
    for (const t of this.since.keys()) if (!this.score.has(t)) this.since.delete(t);
    for (const t of this.score.keys()) if (!this.since.has(t)) this.since.set(t, now);
    const wanted = [...this.score.entries()].filter(([t]) => now - this.since.get(t)! >= DWELL_MS)
      .sort((a, b) => b[1] - a[1]).map(([t]) => t);
    for (const t of wanted) {
      if (this.loading.size >= MAX_LOADS) break;
      if (this.slotTile.includes(t) || this.loading.has(t)) continue;
      const slot = this.freeSlot();
      if (slot < 0) break;
      this.load(t, slot);
    }
    this.uploadOne(renderer, gl);
  }

  // A slot not in view and not being filled, the longest unseen first.
  private freeSlot(): number {
    let best = -1;
    const busy = new Set(this.loading.values());
    for (let s = 0; s < SLOTS; s++) {
      if (busy.has(s) || this.slotSeen[s] === this.frameNo) continue;
      if (best < 0 || this.slotSeen[s] < this.slotSeen[best]) best = s;
    }
    if (best >= 0) this.setSlot(best, -1);
    return best;
  }

  private load(tile: number, slot: number): void {
    this.loading.set(tile, slot);
    const gen = this.generation;
    const rowS = Math.floor(tile / this.cols), col = tile % this.cols;
    const ktx2 = this.ktx2 && ktx2Ready();
    const url = this.base + (ktx2 ? this.entry.tilesKtx2! : this.entry.tiles)
      .replace('{row}', String(this.rows - 1 - rowS)).replace('{col}', String(col));
    if (ktx2) {
      loadKtx2(url, true).then((levels) => {
        if (gen === this.generation) this.ready.push({ tile, slot, bitmap: null, levels });
      }).catch((e: Error) => {
        if (gen !== this.generation) return;
        // Back to the WebP tiles, in an array of their own format.
        console.warn(`KTX2 sky tile failed, using the WebP tiles: ${e.message}`);
        this.ktx2 = false;
        this.dropArray();
      });
      return;
    }
    decodeImage(url, { premultiply: true }).then(({ bitmap }) => {
      if (gen !== this.generation) { bitmap.close(); return; }
      this.ready.push({ tile, slot, bitmap, levels: null });
    }).catch(() => {
      if (gen === this.generation) this.loading.delete(tile);
    });
  }

  private uploadOne(renderer: THREE.WebGLRenderer, gl: WebGL2RenderingContext): void {
    const job = this.ready.shift();
    if (!job) return;
    this.loading.delete(job.tile);
    const { bitmap, levels } = job;
    // The array takes the first tile's format: sRGB RGBA for a bitmap, or
    // the compressed format the transcoder chose.
    const format = levels ? levels.internalFormat : gl.SRGB8_ALPHA8;
    if (!this.glTex) this.allocate(renderer, gl, format, levels ? levels.levels[0].data.byteLength : this.side * this.side * 4);
    const L = levels?.levels[0];
    const w = L ? L.width : bitmap!.width, h = L ? L.height : bitmap!.height;
    if (w === this.side && h === this.side && this.glTex && format === this.format) {
      renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, this.glTex);
      if (L) {
        gl.compressedTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, job.slot, this.side, this.side, 1, format, L.data);
      } else {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, job.slot, this.side, this.side, 1, gl.RGBA, gl.UNSIGNED_BYTE, bitmap!);
      }
      renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, null as unknown as WebGLTexture);
      this.setSlot(job.slot, job.tile);
      this.slotSeen[job.slot] = this.frameNo;
    }
    bitmap?.close();
  }

  private setSlot(slot: number, tile: number): void {
    const old = this.slotTile[slot];
    const q = this.uniforms.detailSlots.value as THREE.Vector4[];
    if (old >= 0) q[old >> 2].setComponent(old & 3, -1);
    this.slotTile[slot] = tile;
    if (tile >= 0) q[tile >> 2].setComponent(tile & 3, slot);
  }

  private allocate(renderer: THREE.WebGLRenderer, gl: WebGL2RenderingContext, format: number, layerBytes: number): void {
    this.glTex = gl.createTexture();
    this.format = format;
    this.gpuBytes = layerBytes * SLOTS;
    renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, this.glTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, format, this.side, this.side, SLOTS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, null as unknown as WebGLTexture);
    this.tex = new THREE.ExternalTexture(this.glTex);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.uniforms.detail.value = this.tex;
    this.uniforms.detailOn.value = 1;
  }

  // Frees the tiles (the screen no longer needs them).
  private release(gl: WebGL2RenderingContext): void {
    if (!this.glTex && !this.loading.size) return;
    if (this.glTex && !gl.isContextLost()) gl.deleteTexture(this.glTex);
    this.forget();
  }

  // The array and every tile in it, freed (the tiles change format).
  private dropArray(): void {
    const g = this.glTex, ctx = this.ctx;
    this.forget();
    if (g && ctx && !ctx.isContextLost()) ctx.deleteTexture(g);
  }

  // After a lost context: the texture went with it; tiles load again.
  reset(): void { this.forget(); }

  private forget(): void {
    this.generation++;
    this.glTex = null;
    this.tex = null;
    this.format = 0;
    this.gpuBytes = 0;
    this.uniforms.detail.value = null;
    this.uniforms.detailOn.value = 0;
    for (const r of this.ready) r.bitmap?.close();
    this.ready = [];
    this.loading.clear();
    this.since.clear();
    for (let s = 0; s < SLOTS; s++) this.setSlot(s, -1);
    this.slotSeen.fill(0);
  }
}
