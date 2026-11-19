// src/scene/decode.worker.ts
//
// Fetches and decodes images off the main thread. createImageBitmap on the
// main thread still blocked it after decoding, while the bitmap was flipped
// and converted: 59 ms for an 8192 x 4096 map with no options, 246 ms with
// the flip and no premultiplication (measured, Chromium, November 2026).
// Here that work happens in the worker and the bitmap is transferred.
//
// A composite (the Earth's cloud layers, clouds.ts): several images,
// newest first, laid one over another by layerComposite.js, each pixel
// from the first that has data there, a geostationary frame only where
// its mask allows; with the share each gave.

import { brightLuminance } from './imageStats';
import { compositeLayers } from './layerComposite.js';
import { fetchOk } from '../browser/fetchData.js';

// Where a geostationary frame is used: within reachDeg of the satellite's
// nadir (on the equator at satLon) and where the Sun's elevation's sine
// is over sunCos (the subsolar point sunLat, sunLon at the frame's time).
export interface GeoMask { satLon: number; reachDeg: number; sunLat: number; sunLon: number; sunCos: number }
export interface DecodeRequest { id: number; url: string; premultiply: boolean; brightLuminance?: boolean; maxSize?: number; under?: string[]; masks?: (GeoMask | null)[] }
export type DecodeReply = { id: number; bitmap: ImageBitmap; whiteLuminance?: number; shares?: number[] } | { id: number; error: string };

async function fetchBitmap(url: string, premultiply: boolean): Promise<ImageBitmap> {
  const r = await fetchOk(url, url);
  return createImageBitmap(await r.blob(), {
    imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: premultiply ? 'premultiply' : 'none',
  });
}

// The images layered at the size of the first that loaded (the others
// scaled to it): the bitmap and each image's share of the pixels.
async function composite(urls: string[], masks: (GeoMask | null)[] = []): Promise<{ bitmap: ImageBitmap; shares: number[] }> {
  const got = await Promise.all(urls.map((u) => fetchBitmap(u, false).catch(() => null)));
  const first = got.find((b) => b);
  if (!first) throw new Error(`${urls[0]}: none of the layers loaded`);
  const W = first.width, H = first.height;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const layers = got.map((bm, i) => {
    if (!bm) return { data: null, mask: null };
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bm, 0, 0, W, H);
    bm.close();
    return { data: ctx.getImageData(0, 0, W, H).data, mask: masks[i] ?? null };
  });
  const { out, shares } = compositeLayers(layers, W, H);
  ctx.putImageData(new ImageData(out, W, H), 0, 0);
  return { bitmap: canvas.transferToImageBitmap(), shares };
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, url, premultiply, under, masks } = e.data;
  try {
    let shares: number[] | undefined;
    let bitmap: ImageBitmap;
    if (under?.length) ({ bitmap, shares } = await composite([url, ...under], masks));
    else bitmap = await fetchBitmap(url, premultiply);
    // Larger than the GPU takes: scaled down here, as three.js's own loader
    // would have done.
    const max = e.data.maxSize ?? Infinity;
    if (bitmap.width > max || bitmap.height > max) {
      const k = max / Math.max(bitmap.width, bitmap.height);
      const big = bitmap;
      bitmap = await createImageBitmap(big, { resizeWidth: Math.floor(big.width * k), resizeHeight: Math.floor(big.height * k), resizeQuality: 'high' });
      big.close();
    }
    const whiteLuminance = e.data.brightLuminance ? brightLuminance(bitmap) : undefined;
    (self as unknown as Worker).postMessage({ id, bitmap, whiteLuminance, shares } satisfies DecodeReply, [bitmap]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies DecodeReply);
  }
};
