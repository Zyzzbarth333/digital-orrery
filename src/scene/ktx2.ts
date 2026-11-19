// src/scene/ktx2.ts
//
// GPU-compressed maps (docs/frontend/textures.md#gpu-compressed-maps). The
// maps also ship as KTX2 files with Basis Universal data (ETC1S or UASTC,
// python/textures/build_ktx2.py), which three.js's KTX2Loader transcodes in
// its workers to a format this GPU samples directly: BC7 on desktops, ASTC
// or ETC2 on phones. That takes a quarter of the video memory of the RGBA
// that a WebP decodes to (an 8192 x 4096 map with mipmaps: 45 MB, not 179).
//
// Only the transcoding is three's: the levels come back here as arrays of
// blocks, and TextureUploader (surfaces.ts) puts them on the GPU a strip at
// a time, as it does the WebP bitmaps, so no frame stalls. A GPU with none
// of these formats, or a browser without workers, keeps the WebP maps.

import * as THREE from 'three';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

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

// Fetch and transcode a KTX2 file. Rejects if the format it came out in has
// no form this GPU takes (the caller then loads the WebP).
export async function loadKtx2(url: string, colour: boolean): Promise<CompressedLevels> {
  if (!loader) throw new Error('KTX2 not available');
  const tex = (await loader.loadAsync(url)) as THREE.CompressedTexture;
  const f = FORMATS.get(tex.format as number);
  const internalFormat = f && (colour ? f[1] : f[0]);
  const s3tc = tex.format === THREE.RGBA_S3TC_DXT1_Format || tex.format === THREE.RGBA_S3TC_DXT5_Format;
  if (!f || !internalFormat || (colour && s3tc && !s3tcSrgb)) {
    throw new Error(`${url}: transcoded to a format this GPU cannot take (${tex.format})`);
  }
  const levels = tex.mipmaps.map((m) => ({ data: m.data as Uint8Array, width: m.width, height: m.height }));
  return { internalFormat, blockBytes: f[2], levels };
}

// Bytes a row of blocks takes at this width.
export function blockRowBytes(width: number, blockBytes: number): number {
  return Math.ceil(width / 4) * blockBytes;
}
