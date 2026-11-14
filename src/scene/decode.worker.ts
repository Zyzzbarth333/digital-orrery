// src/scene/decode.worker.ts
//
// Fetches and decodes images off the main thread. createImageBitmap on the
// main thread still blocked it after decoding, while the bitmap was flipped
// and converted: 59 ms for an 8192 x 4096 map with no options, 246 ms with
// the flip and no premultiplication (measured, Chromium, November 2026).
// Here that work happens in the worker and the bitmap is transferred.

import { brightLuminance } from './imageStats';

export interface DecodeRequest { id: number; url: string; premultiply: boolean; brightLuminance?: boolean; maxSize?: number }
export type DecodeReply = { id: number; bitmap: ImageBitmap; whiteLuminance?: number } | { id: number; error: string };

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const { id, url, premultiply } = e.data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    let bitmap = await createImageBitmap(await r.blob(), {
      imageOrientation: 'flipY', colorSpaceConversion: 'none', premultiplyAlpha: premultiply ? 'premultiply' : 'none',
    });
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
    (self as unknown as Worker).postMessage({ id, bitmap, whiteLuminance } satisfies DecodeReply, [bitmap]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) } satisfies DecodeReply);
  }
};
