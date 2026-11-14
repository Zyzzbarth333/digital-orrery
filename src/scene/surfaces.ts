// src/scene/surfaces.ts
//
// Loads the surface maps listed in public/textures/manifest.json, which the
// conversion script (python/textures/build_textures.py) writes. Without the
// manifest every body keeps its flat albedo colour. Earth's day map is the
// Blue Marble image for the sim month, swapped as the month changes.
//
// Maps run to 8192 x 4096 (180 MB of video memory with mipmaps). Decoding
// one on the main thread and uploading it inside a frame froze the page for
// up to two seconds when a body was clicked. Now the browser decodes them
// off the main thread (createImageBitmap) and the scene uploads at most one
// per frame (TextureUploader) before any material uses it.

import * as THREE from 'three';
import type { BodyKey } from './catalogue';
import { applySurfaceMaps } from './bodyMaterial';
import type { DecodeReply, DecodeRequest } from './decode.worker';
import type { SkyDetailEntry } from './skyDetail';

export interface SurfaceEntry {
  day?: string;                 // path under textures/
  dayMonthly?: string[];        // 12 paths, January first (Earth)
  dayMeanLuminance?: number;    // mean linear luminance of the day map(s)
  dayWhiteLuminance?: number;   // Earth: luminance of the brightest 0.5 %, set to reflectance 0.9
  normal?: string;
  night?: string;
  credit: string;
}
export interface Manifest {
  bodies: Partial<Record<BodyKey, SurfaceEntry>>;
  rings?: { saturn?: { tau: string; innerKm: number; outerKm: number; credit: string } };
  stars?: { map: string; raAtLeftDeg: number; raIncreasesRight: boolean; gain?: number; detail?: SkyDetailEntry; points?: string; pointCount?: number; credit: string };
}

export const BASE = `${import.meta.env.BASE_URL}textures/`;

export async function loadManifest(): Promise<Manifest | null> {
  try {
    const r = await fetch(`${BASE}manifest.json`);
    return r.ok ? ((await r.json()) as Manifest) : null;
  } catch {
    return null;
  }
}

export async function loadBinary(path: string): Promise<ArrayBuffer> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.arrayBuffer();
}

export async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

// Uploads maps to the GPU a few megabytes per frame, at the top of the
// frame, so an 8192 x 4096 map (128 MB) goes up over about 32 frames
// instead of blocking one frame for half a second (measured: 0.41-0.55 s
// for one texImage2D of an 8k map, 2-3 ms per 128-row strip). The texture
// is allocated once (texStorage2D), filled strip by strip, mipmapped, and
// handed to three.js as an ExternalTexture, so three never re-uploads it.
const BYTES_PER_FRAME = 4 * 1024 * 1024;

interface UploadJob {
  bitmap: ImageBitmap;
  colour: boolean;
  gl: WebGLTexture | null;
  y: number;                            // next row to upload
  resolve: (t: THREE.Texture) => void;
  reject: (e: Error) => void;
}

export class TextureUploader {
  private queue: UploadJob[] = [];
  private gl: WebGL2RenderingContext;
  private aniso: number;
  constructor(private renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.aniso = renderer.capabilities.getMaxAnisotropy();
  }
  get pending(): number { return this.queue.length; }

  // The largest texture this GPU takes; decodeImage scales bigger images
  // down to it (WebGL 2 promises only 2048, so an 8k map can be too big).
  get maxSize(): number { return this.renderer.capabilities.maxTextureSize; }

  upload(bitmap: ImageBitmap, colour: boolean): Promise<THREE.Texture> {
    return new Promise((resolve, reject) => this.queue.push({ bitmap, colour, gl: null, y: 0, resolve, reject }));
  }

  // Forget queued work after a lost context (its textures went with it).
  // A lost context took the textures with it: queued work is dropped and
  // its callers told, so nothing waits forever.
  clear(): void {
    for (const j of this.queue) { j.bitmap.close(); j.reject(new Error('WebGL context lost')); }
    this.queue = [];
  }

  step(): void {
    const job = this.queue[0];
    if (!job || this.gl.isContextLost()) return;
    const gl = this.gl, state = this.renderer.state;
    const { bitmap } = job;
    const W = bitmap.width, H = bitmap.height;
    if (!job.gl) {
      job.gl = gl.createTexture();
      state.bindTexture(gl.TEXTURE_2D, job.gl);
      const levels = Math.floor(Math.log2(Math.max(W, H))) + 1;
      gl.texStorage2D(gl.TEXTURE_2D, levels, job.colour ? gl.SRGB8_ALPHA8 : gl.RGBA8, W, H);
    }
    state.bindTexture(gl.TEXTURE_2D, job.gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    const rows = Math.max(16, Math.floor(BYTES_PER_FRAME / (W * 4)));
    const n = Math.min(rows, H - job.y);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, job.y);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, job.y, W, n, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    job.y += n;
    if (job.y < H) return;
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, this.aniso);
    state.bindTexture(gl.TEXTURE_2D, null as unknown as WebGLTexture);
    this.queue.shift();
    bitmap.close();
    const tex = new THREE.ExternalTexture(job.gl);
    tex.colorSpace = job.colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const glTex = job.gl;
    tex.addEventListener('dispose', () => gl.deleteTexture(glTex));
    job.resolve(tex);
  }
}

// Fetch and decode an image in a worker (decode.worker.ts), flipped as
// three.js's TextureLoader would and with no colour conversion (normal and
// relief maps are data); the bitmap is transferred back.
let decoder: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (r: { bitmap: ImageBitmap; whiteLuminance?: number }) => void; reject: (e: Error) => void }>();

export function decodeImage(url: string, opts: { premultiply: boolean; brightLuminance?: boolean; maxSize?: number }): Promise<{ bitmap: ImageBitmap; whiteLuminance?: number }> {
  if (!decoder) {
    decoder = new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' });
    decoder.onmessage = (e: MessageEvent<DecodeReply>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if ('error' in e.data) w.reject(new Error(e.data.error));
      else w.resolve({ bitmap: e.data.bitmap, whiteLuminance: e.data.whiteLuminance });
    };
  }
  const id = nextId++;
  const abs = new URL(url, location.href).href;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    decoder!.postMessage({ id, url: abs, ...opts } satisfies DecodeRequest);
  });
}

// A map as a texture, decoded in the worker and uploaded through the
// uploader. Body maps are opaque, so they are premultiplied (no value
// changes). Browsers without createImageBitmap use a TextureLoader.
export async function loadTexture(url: string, colour: boolean, uploader: TextureUploader): Promise<THREE.Texture> {
  if (typeof createImageBitmap !== 'function' || typeof Worker !== 'function') {
    const t = await new THREE.TextureLoader().loadAsync(url);
    t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }
  const { bitmap } = await decodeImage(url, { premultiply: true, maxSize: uploader.maxSize });
  return uploader.upload(bitmap, colour);
}

export class SurfaceLoader {
  private cache = new Map<string, Promise<THREE.Texture>>();
  private month = new Map<BodyKey, number>();
  private monthPath = new Map<BodyKey, string>();

  constructor(private uploader: TextureUploader) {}

  load(path: string, colour: boolean): Promise<THREE.Texture> {
    let p = this.cache.get(path);
    if (!p) {
      p = loadTexture(BASE + path, colour, this.uploader);
      this.cache.set(path, p);
    }
    return p;
  }

  // After a lost context: every map has to be loaded again.
  reset(): void { this.cache.clear(); this.month.clear(); this.monthPath.clear(); this.uploader.clear(); }

  // Free a map no longer shown (Earth's previous month: 78 MB each).
  private drop(path: string): void {
    const p = this.cache.get(path);
    if (!p) return;
    this.cache.delete(path);
    void p.then((t) => t.dispose());
  }

  async apply(key: BodyKey, entry: SurfaceEntry, material: THREE.ShaderMaterial, date: Date): Promise<void> {
    const [normal, night] = await Promise.all([
      entry.normal ? this.load(entry.normal, false) : undefined,
      entry.night ? this.load(entry.night, true) : undefined,
    ]);
    applySurfaceMaps(material, { normal, night });
    await this.updateDay(key, entry, material, date);
  }

  // Load the day map (for Earth, the month's) if it is not the one in use.
  async updateDay(key: BodyKey, entry: SurfaceEntry, material: THREE.ShaderMaterial, date: Date): Promise<void> {
    if (entry.dayMonthly) {
      const m = date.getUTCMonth();
      if (this.month.get(key) === m) return;
      this.month.set(key, m);
      const path = entry.dayMonthly[m];
      const day = await this.load(path, true);
      // A month that arrives after the sim has moved on is freed at once
      // (78 MB each), unless it is the one on show.
      if (this.month.get(key) !== m) { if (this.monthPath.get(key) !== path) this.drop(path); return; }
      applySurfaceMaps(material, { day, dayMeanLuminance: entry.dayMeanLuminance, dayWhiteLuminance: entry.dayWhiteLuminance });
      const old = this.monthPath.get(key);
      this.monthPath.set(key, path);
      if (old && old !== path) this.drop(old);
    } else if (entry.day && !this.month.has(key)) {
      this.month.set(key, -1);
      applySurfaceMaps(material, { day: await this.load(entry.day, true), dayMeanLuminance: entry.dayMeanLuminance });
    }
  }
}
