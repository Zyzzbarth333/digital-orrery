// src/scene/decode.worker.ts
//
// Fetches and decodes images off the main thread. createImageBitmap on the
// main thread still blocked it after decoding, while the bitmap was flipped
// and converted: 59 ms for an 8192 x 4096 map with no options, 246 ms with
// the flip and no premultiplication (measured, Chromium, November 2026).
// Here that work happens in the worker and the bitmap is transferred.
//
// A composite (the Earth's recent daily mosaics, clouds.ts): several
// images, newest first, each pixel taken from the newest that has data
// there (not pure black, GIBS's no-data), with the share each gave.

import { brightLuminance } from './imageStats';

export interface DecodeRequest { id: number; url: string; premultiply: boolean; brightLuminance?: boolean; maxSize?: number; under?: string[] }
export type DecodeReply = { id: number; bitmap: ImageBitmap; whiteLuminance?: number; shares?: number[] } | { id: number; error: string };

// A pixel no brighter than this in every channel (sRGB, 0-255) is no data.
const NO_DATA = 10;

async function fetchBitmap(url: string, premultiply: boolean): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return createImageBitmap(await r.blob(), {
    imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: premultiply ? 'premultiply' : 'none',
  });
}

// The images layered newest first at the first one's size (the older ones
// scaled to it): the bitmap and each image's share of the pixels.
async function composite(urls: string[]): Promise<{ bitmap: ImageBitmap; shares: number[] }> {
  const got = await Promise.all(urls.map((u) => fetchBitmap(u, false).catch(() => null)));
  const first = got.find((b) => b);
  if (!first) throw new Error(`${urls[0]}: none of the days loaded`);
  const W = first.width, H = first.height, n = W * H;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let out: ImageData | null = null;
  const shares = urls.map(() => 0);
  for (let i = 0; i < got.length; i++) {
    const bm = got[i];
    if (!bm) continue;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bm, 0, 0, W, H);
    bm.close();
    const d = ctx.getImageData(0, 0, W, H).data;
    if (!out) {
      out = new ImageData(new Uint8ClampedArray(d), W, H);
      let c = 0;
      for (let p = 0; p < 4 * n; p += 4) if (d[p] > NO_DATA || d[p + 1] > NO_DATA || d[p + 2] > NO_DATA) c++;
      shares[i] = c / n;
      continue;
    }
    const o = out.data;
    let c = 0;
    for (let p = 0; p < 4 * n; p += 4) {
      if (o[p] > NO_DATA || o[p + 1] > NO_DATA || o[p + 2] > NO_DATA) continue;
      if (d[p] > NO_DATA || d[p + 1] > NO_DATA || d[p + 2] > NO_DATA) { o[p] = d[p]; o[p + 1] = d[p + 1]; o[p + 2] = d[p + 2]; o[p + 3] = d[p + 3]; c++; }
    }
    shares[i] = c / n;
  }
  ctx.putImageData(out!, 0, 0);
  return { bitmap: canvas.transferToImageBitmap(), shares };
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, url, premultiply, under } = e.data;
  try {
    let shares: number[] | undefined;
    let bitmap: ImageBitmap;
    if (under?.length) ({ bitmap, shares } = await composite([url, ...under]));
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
