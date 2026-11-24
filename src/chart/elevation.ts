// src/chart/elevation.ts
//
// A body's elevation for the chart (docs/frontend/chart.md#elevation): the
// 4 px/deg grid at once, and the 16 px/deg grid's 720 x 720 tiles where the
// chart is zoomed in far enough to show them. Heights are whole metres above
// the source's datum (public/charts/index.json says which), -32768 no data.
//
// The files are python/charts/build_charts.py's: each height's difference
// from left + up - upper-left (zero off the grid), int16 wrapping,
// zigzag-coded, low bytes then high bytes, gzipped. Pages serves a .gz as
// it is, so the browser's own DecompressionStream undoes the gzip.

import { queued, readCounting, Rank, type JobHandle } from '../browser/loadQueue.js';

export interface ElevationEntry {
  source: string; datum: string; radiusKm: number; tag: string; credit: string;
  base: string; tiles: string; baseWidth: number; width: number; tilesX: number; tilesY: number; nodata: number;
  minM: number; maxM: number; p1M: number; p50M: number; p99M: number; noDataShare: number;
}

export const NODATA = -32768;

// Undo the predictor and the zigzag: bytes (w*h low, then w*h high) -> heights.
export function unpredict(bytes: Uint8Array, w: number, h: number): Int16Array {
  const n = w * h;
  if (bytes.length !== 2 * n) throw new Error(`elevation grid: ${bytes.length} bytes for ${w} x ${h}`);
  const t = new Int16Array(n);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const z = bytes[i] | (bytes[n + i] << 8);
      const r = (z >>> 1) ^ -(z & 1);
      const L = x ? t[i - 1] : 0, U = y ? t[i - w] : 0, UL = x && y ? t[i - w - 1] : 0;
      t[i] = L + U - UL + r;     // an Int16Array store wraps, as the encoder's int16 did
    }
  }
  return t;
}

// A server that sends the .gz with Content-Encoding: gzip has the browser
// undo it already: then the bytes no longer start with gzip's magic number.
export async function gunzip(buf: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const s = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function decodeGrid(buf: ArrayBuffer | Uint8Array, w: number, h: number): Promise<Int16Array> {
  return unpredict(await gunzip(buf), w, h);
}

// One height from a grid of width w (whole turn of longitude) and w/2 rows,
// top row at +90: bilinear between the four cell centres round lat, lon
// (rad), or NaN where any is no data.
export function sampleGrid(g: (x: number, y: number) => number, w: number, lat: number, lon: number): number {
  const h = w / 2;
  const fx = ((lon + Math.PI) / (2 * Math.PI)) * w - 0.5, fy = ((Math.PI / 2 - lat) / Math.PI) * h - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  const X = (x: number) => ((x % w) + w) % w, Y = (y: number) => Math.min(h - 1, Math.max(0, y));
  const a = g(X(x0), Y(y0)), b = g(X(x0 + 1), Y(y0)), c = g(X(x0), Y(y0 + 1)), d = g(X(x0 + 1), Y(y0 + 1));
  if (a === NODATA || b === NODATA || c === NODATA || d === NODATA) return NaN;
  return (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + d * ax) * ay;
}

export class Elevation {
  base: Int16Array | null = null;
  readonly tiles: (Int16Array | null)[];
  private asked = new Set<number>();
  readonly tileW: number;
  onChange: (() => void) | null = null;
  private dead = false;

  constructor(readonly entry: ElevationEntry, private root: string, private name: string) {
    this.tiles = new Array(entry.tilesX * entry.tilesY).fill(null);
    this.tileW = entry.width / entry.tilesX;
  }

  async loadBase(): Promise<void> {
    const e = this.entry;
    const bytes = await queued({ label: `${this.name} elevation`, lane: 'first', rank: Rank.focus }, (h) => fetchOk(this.root + e.base, h));
    const g = await decodeGrid(bytes, e.baseWidth, e.baseWidth / 2);
    if (this.dead) return;
    this.base = g;
    this.onChange?.();
  }

  // The 16 px/deg tiles to fetch (indices, row-major from the north-west),
  // nearest the chart's centre first: one at a time through the load queue.
  want(indices: number[]): void {
    const e = this.entry;
    for (const i of indices) {
      if (this.asked.has(i)) continue;
      this.asked.add(i);
      const r = Math.floor(i / e.tilesX), c = i % e.tilesX;
      const url = this.root + e.tiles.replace('{r}', String(r)).replace('{c}', String(c));
      void queued({ label: `${this.name} elevation detail`, lane: 'bulk', rank: Rank.focus }, (h) => fetchOk(url, h))
        .then((bytes) => decodeGrid(bytes, this.tileW, this.tileW))
        .then((g) => { if (this.dead) return; this.tiles[i] = g; this.onChange?.(); })
        .catch(() => this.asked.delete(i));     // try again when next wanted
    }
  }

  // The finest height in hand at lat, lon (rad), metres; NaN where no data
  // or not loaded. `fine` says which grid gave it.
  heightAt(lat: number, lon: number): { m: number; fine: boolean } {
    const e = this.entry, tw = this.tileW;
    const fine = sampleGrid((x, y) => {
      const t = this.tiles[Math.floor(y / tw) * e.tilesX + Math.floor(x / tw)];
      return t ? t[(y % tw) * tw + (x % tw)] : NaN;
    }, e.width, lat, lon);
    if (!Number.isNaN(fine)) return { m: fine, fine: true };
    const b = this.base;
    if (!b) return { m: NaN, fine: false };
    return { m: sampleGrid((x, y) => b[y * e.baseWidth + x], e.baseWidth, lat, lon), fine: false };
  }

  dispose(): void { this.dead = true; this.onChange = null; }
}

async function fetchOk(url: string, h: JobHandle): Promise<Uint8Array> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return readCounting(r, h);
}
