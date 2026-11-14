// src/scene/imageStats.ts
//
// Statistics of a decoded image, usable on the main thread or in a worker.

// Linear luminance of the brightest 0.5 % of the image over the sphere
// (rows weighted by cos latitude; pure black is no data), the cloud tops,
// which the shader calibrates to reflectance 0.9.
export function brightLuminance(img: CanvasImageSource | ImageBitmap): number {
  const w = 256, h = 128;
  const c = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!g) return 1;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lums: number[] = [], wts: number[] = [];
  let wsum = 0;
  for (let y = 0; y < h; y++) {
    const wt = Math.cos((0.5 - (y + 0.5) / h) * Math.PI);
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const r = lin(d[i]), gg = lin(d[i + 1]), b = lin(d[i + 2]);
      if (Math.max(r, gg, b) < 0.003) continue;
      lums.push(0.2126 * r + 0.7152 * gg + 0.0722 * b);
      wts.push(wt);
      wsum += wt;
    }
  }
  if (!lums.length) return 1;
  const order = lums.map((_, i) => i).sort((a, b) => lums[a] - lums[b]);
  let acc = 0;
  for (const i of order) { acc += wts[i]; if (acc >= 0.995 * wsum) return lums[i]; }
  return lums[order[order.length - 1]];
}
