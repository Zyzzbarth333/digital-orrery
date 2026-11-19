// src/scene/ktx2.ts
//
// GPU-compressed maps (docs/frontend/textures.md#gpu-compressed-maps). The
// maps also ship as KTX2 files with Basis Universal data (ETC1S or UASTC,
// python/textures/build_ktx2.py), which three.js's KTX2Loader transcodes in
// its workers to a format this GPU samples directly: BC7 on desktops, ASTC
// or ETC2 on phones. That takes a quarter of the video memory of the RGBA
// that a WebP decodes to (an 8192 x 4096 map with mipmaps: 45 MB, not 179).
//
// A map wider than 2048 px shows its 2048-wide levels first, cut from the
// front of its file with a byte range (loadKtx2Staged, ktx2Range.js).
//
// Only the transcoding is three's: the levels come back here as arrays of
// blocks, and TextureUploader (surfaces.ts) puts them on the GPU a strip at
// a time, as it does the WebP bitmaps, so no frame stalls. A GPU with none
// of these formats, or a browser without workers, keeps the WebP maps.

import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { HEAD_BYTES, ktx2Layout, prefixBytes, previewFile, previewLevel } from './ktx2Range.js';
import { queued, readCounting, type JobHandle } from '../browser/loadQueue.js';

// A map's levels as the GPU takes them: level 0 first, each a run of 4 x 4
// blocks, rows from the south (the files are stored that way).
export interface CompressedLevels {
  internalFormat: number;     // GL enum, sRGB for colour maps
  blockBytes: number;         // bytes per 4 x 4 block
  levels: { data: Uint8Array; width: number; height: number }[];
}

// Engine formats the transcoder can give, as GL internal formats: linear,
// sRGB, bytes per block. three's constants are the linear GL enums.
const FORMATS = new Map<number, [number, number | null, number]>([
  [THREE.RGBA_BPTC_Format, [0x8e8c, 0x8e8d, 16]],
  [THREE.RGBA_ASTC_4x4_Format, [0x93b0, 0x93d0, 16]],
  [THREE.RGBA_S3TC_DXT1_Format, [0x83f1, 0x8c4d, 8]],
  [THREE.RGBA_S3TC_DXT5_Format, [0x83f3, 0x8c4f, 16]],
  [THREE.RGB_ETC2_Format, [0x9274, 0x9275, 8]],
  [THREE.RGBA_ETC2_EAC_Format, [0x9278, 0x9279, 16]],
  [THREE.RGB_ETC1_Format, [0x8d64, null, 8]],           // no sRGB form: colour maps keep the WebP
]);

let loader: KTX2Loader | null = null;
let s3tcSrgb = false;

// Sets up the transcoder for this renderer. True if the GPU takes one of
// the formats it transcodes to; the transcoder itself (0.8 MB) is fetched
// at once, while the page starts, so the first map does not wait for it.
//
// A WebGL extension works only on the context that asked for it, so each
// renderer's context asks (detectSupport does, through
// renderer.extensions): the scene can be made twice (React's StrictMode in
// development, a remount), and a second renderer that skipped this had
// every compressed upload fail with INVALID_ENUM.
export function initKtx2(renderer: THREE.WebGLRenderer): boolean {
  if (typeof Worker !== 'function' || typeof WebAssembly !== 'object') return false;
  if (new URLSearchParams(location.search).has('webp')) return false;   // ?webp: the old maps, for comparison
  const l = loader ?? new KTX2Loader();
  l.detectSupport(renderer);
  const c = l.workerConfig;
  s3tcSrgb = renderer.extensions.has('WEBGL_compressed_texture_s3tc_srgb');
  if (!c || !(c.bptcSupported || c.astcSupported || c.etc2Supported || (c.dxtSupported && s3tcSrgb))) {
    l.dispose();
    loader = null;
    return false;
  }
  // Fetch the transcoder now, while the page starts, not with the first map.
  if (!loader) void l.init().catch(() => {});
  loader = l;
  return true;
}

export function ktx2Ready(): boolean { return loader !== null; }
// The set-up loader, for glTF models whose textures are KTX2 (craftAssets.ts).
export function ktx2Loader(): KTX2Loader | null { return loader; }

// A transcoded texture's levels in a form this GPU takes. Throws if the
// format it came out in has none (the caller then loads the WebP).
function levelsOf(tex: THREE.CompressedTexture, url: string, colour: boolean): CompressedLevels {
  const f = FORMATS.get(tex.format as number);
  const internalFormat = f && (colour ? f[1] : f[0]);
  const s3tc = tex.format === THREE.RGBA_S3TC_DXT1_Format || tex.format === THREE.RGBA_S3TC_DXT5_Format;
  if (!f || !internalFormat || (colour && s3tc && !s3tcSrgb)) {
    throw new Error(`${url}: transcoded to a format this GPU cannot take (${tex.format})`);
  }
  const levels = tex.mipmaps.map((m) => ({ data: m.data as Uint8Array, width: m.width, height: m.height }));
  return { internalFormat, blockBytes: f[2], levels };
}

function transcode(bytes: ArrayBuffer, url: string, colour: boolean): Promise<CompressedLevels> {
  return new Promise<THREE.CompressedTexture>((ok, fail) => loader!.parse(bytes, ok as (t: THREE.Texture) => void, fail))
    .then((tex) => levelsOf(tex, url, colour));
}

// Fetch and transcode a KTX2 file, whole.
export async function loadKtx2(url: string, colour: boolean): Promise<CompressedLevels> {
  if (!loader) throw new Error('KTX2 not available');
  const tex = (await loader.loadAsync(url)) as THREE.CompressedTexture;
  return levelsOf(tex, url, colour);
}

// Where a map's downloads go in the load queue (src/browser/loadQueue.ts).
export interface MapLoad { label: string; tag?: string; rank?: number; order?: number }

// Bytes [from, to) of a file, or from `from` to its end; null if the
// server sent something other than that range (it may ignore ranges).
async function range(url: string, from: number, to: number | null, h: JobHandle): Promise<{ bytes: Uint8Array; total: number } | null> {
  const r = await fetch(url, { headers: { Range: `bytes=${from}-${to === null ? '' : to - 1}` } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const m = r.status === 206 && r.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  if (!m || Number(m[1]) !== from) return null;
  const bytes = await readCounting(r, h, Number(m[2]) - from + 1);
  h.done();
  return { bytes, total: Number(m[3]) };
}

const join = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// A KTX2 map in two steps where it is wider than its preview (2048 px,
// ktx2Range.js): its header (4 KB), then the bytes up to the end of the
// preview's level, as 'first' jobs; onPreview is given those levels
// transcoded. Then the rest of the file as a 'bulk' job, and the promise
// gives every level. The preview is not fetched twice: the full file is
// the bytes already held and the rest. Without byte ranges (a server that
// ignores them) the whole file comes in one 'first' job, with no preview.
export async function loadKtx2Staged(url: string, colour: boolean, load: MapLoad, onPreview?: (l: CompressedLevels) => void): Promise<CompressedLevels> {
  if (!loader) throw new Error('KTX2 not available');
  const whole = async (h: JobHandle) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return readCounting(r, h);
  };
  const parts: Uint8Array[] = [];
  let total = 0;
  const head = await queued({ ...load, lane: 'first' }, (h) => range(url, 0, HEAD_BYTES, h));
  if (!head) return transcode((await queued({ ...load, lane: 'first' }, whole)).buffer as ArrayBuffer, url, colour);
  parts.push(head.bytes);
  total = head.total;
  let have = head.bytes.length;
  const L = ktx2Layout(head.bytes);
  const k = onPreview ? previewLevel(L) : 0;
  if (k > 0 && have < total) {
    const end = prefixBytes(L, k);
    if (end > have) {
      const mid = await queued({ ...load, lane: 'first' }, (h) => range(url, have, end, h));
      if (!mid) return transcode((await queued({ ...load, lane: 'first' }, whole)).buffer as ArrayBuffer, url, colour);
      parts.push(mid.bytes);
      have += mid.bytes.length;
    }
    // Transcoded while the rest downloads; a preview that fails is skipped.
    const pre = previewFile(join(parts), L, k);
    void transcode(pre, url, colour).then(onPreview, (e: Error) => console.warn(`KTX2 preview skipped: ${e.message}`));
  }
  if (have < total) {
    const rest = await queued({ ...load, lane: 'bulk' }, (h) => range(url, have, null, h));
    if (!rest) return transcode((await queued({ ...load, lane: 'bulk' }, whole)).buffer as ArrayBuffer, url, colour);
    parts.push(rest.bytes);
  }
  return transcode(join(parts).buffer as ArrayBuffer, url, colour);
}

// Bytes a row of blocks takes at this width.
export function blockRowBytes(width: number, blockBytes: number): number {
  return Math.ceil(width / 4) * blockBytes;
}
