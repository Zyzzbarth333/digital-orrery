// src/scene/marsDust.ts
//
// Mars's dust haze for the sim date (docs/frontend/mars-dust.md): the
// column dust optical depth map of that sol from Montabone et al.'s
// climatology (LMD; the kriged maps, 3 deg x 3 deg, MY 24 to MY 36),
// drawn by the surface shader over the Viking map (bodyMaterial.ts).
//
// The maps are baked by pipelines/marsdust.build.mjs into one file per Mars
// year, one byte per cell (the square root of the optical depth, so clear
// days keep their precision), a map per sol. Only the sol shown is fetched,
// as a byte range of 7.2 kB; a few recent sols are kept. Outside the maps'
// sols nothing is drawn and the plate says there was no observation that
// date. While time runs faster than MAX_SOLS_PER_S nothing is fetched and
// nothing drawn: a stale sol's dust is never shown for another.

import * as THREE from 'three';
import { marsSeason } from '@digital-orrery/physics/marsTime.js';

// A Mars year's maps: map k is for the sol from start + k sols (UTC, ms),
// sol soy + k of the year as the files count it (from 1).
export interface MarsDustYear { my: number; file: string; start: number; soy: number; sols: number; version: string }
export interface MarsDustIndex {
  grid: { nLon: number; nLat: number; lon0: number; lat0: number; step: number };   // lon0, lat0: the first value's place, deg
  maxCdod: number;        // optical depth at byte 255 (bytes are 255 sqrt(cdod / maxCdod))
  visible: number;        // visible column optical depth per 9.3 um absorption optical depth
  variable: string;
  years: MarsDustYear[];
}

// What Mars shows: the sol drawn and its optical depth, or why nothing is.
export type MarsDustInfo =
  | { status: 'drawn'; my: number; sol: number; ls: number; mean: number; max: number; version: string }
  | { status: 'none'; my: number; ls: number }
  | { status: 'fast' };

let info: MarsDustInfo | null = null;
const listeners = new Set<() => void>();
export const marsDustInfo = {
  get: (): MarsDustInfo | null => info,
  subscribe(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; },
};
function publish(next: MarsDustInfo | null): void {
  if (JSON.stringify(next) === JSON.stringify(info)) return;
  info = next; listeners.forEach((f) => f());
}

// The dust's hue (linear RGB at unit luminance), from the Viking day map:
// the mean of its brightest quarter between 60 S and 60 N (the dust-covered
// regions: Tharsis, Arabia, Elysium), by area, measured by
// python/textures/mars_dust_colour.py. Drawn at Mars's mean reflectance,
// not at those regions' (1.68 times it), so the disc keeps its albedo.
export const DUST_COLOUR: [number, number, number] = [1.3975, 0.8961, 0.8587];

export const MAX_SOLS_PER_S = 10;
const SOL_MS = 88775.244147e3;
const KEEP = 32;

// Decoded optical depth of a byte.
export const cdodOf = (byte: number, maxCdod: number): number => maxCdod * (byte / 255) ** 2;

// The map for a sim time: its year's entry, the map's index in its file,
// and its Mars year and sol as the files count them; or, outside the maps,
// null with the date's own Mars year. Ls is the series' at that time.
export function mapFor(index: MarsDustIndex, simMs: number): { year: MarsDustYear; k: number; my: number; sol: number; ls: number } | { year: null; my: number; ls: number } {
  const { my, ls } = marsSeason(simMs);
  for (const year of index.years) {
    const k = Math.floor((simMs - year.start) / SOL_MS);
    if (k >= 0 && k < year.sols) return { year, k, my: year.my, sol: year.soy + k, ls };
  }
  return { year: null, my, ls };
}

// The mean over the globe (cells weighted by area) and the largest cell.
export function mapStats(bytes: Uint8Array, index: MarsDustIndex): { mean: number; max: number } {
  const { nLon, nLat, lat0, step } = index.grid;
  let sum = 0, w = 0, max = 0;
  for (let j = 0; j < nLat; j++) {
    const lat0r = Math.max(-90, lat0 + (j - 0.5) * step) * Math.PI / 180, lat1r = Math.min(90, lat0 + (j + 0.5) * step) * Math.PI / 180;
    const a = Math.sin(lat1r) - Math.sin(lat0r);
    for (let i = 0; i < nLon; i++) {
      const c = cdodOf(bytes[j * nLon + i], index.maxCdod);
      sum += a * c; w += a; if (c > max) max = c;
    }
  }
  return { mean: sum / w, max };
}

export class MarsDust {
  texture: THREE.DataTexture | null = null;
  index: MarsDustIndex | null = null;
  onChange: (tex: THREE.DataTexture | null) => void = () => {};
  private indexLoad: Promise<void> | null = null;
  private shown: string | null = null;       // key of the map in the texture
  private shownAt = NaN;                     // its sol, counted from MY 0
  private wanted: string | null = null;      // key of the map being fetched
  private cache = new Map<string, Uint8Array>();
  private failed = false;

  constructor(private base: string) {}

  // After a lost WebGL context: upload the texture again.
  reset(): void { if (this.texture) this.texture.needsUpdate = true; }

  private clear(next: MarsDustInfo | null): void {
    if (this.shown !== null) { this.shown = null; this.onChange(null); }
    this.wanted = null;
    publish(next);
  }

  update(simMs: number, rateSimPerReal: number): void {
    if (this.failed) return;
    if (!this.index) {
      this.indexLoad ??= fetch(`${this.base}marsdust/index.json`)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((j: MarsDustIndex) => { this.index = j; })
        .catch((err) => { this.failed = true; console.warn(`Mars dust index not loaded: ${err}`); });
      return;
    }
    if (Math.abs(rateSimPerReal) * 1000 > MAX_SOLS_PER_S * SOL_MS) { this.clear({ status: 'fast' }); return; }
    const at = mapFor(this.index, simMs);
    if (!at.year) { this.clear({ status: 'none', my: at.my, ls: Math.round(at.ls * 10) / 10 }); return; }
    const key = `${at.my} ${at.sol}`;
    if (key === this.shown) return;
    const solAt = at.my * 669 + at.sol;
    const show = (bytes: Uint8Array) => {
      this.draw(bytes);
      this.shown = key; this.shownAt = solAt;
      publish({ status: 'drawn', my: at.my, sol: at.sol, ls: at.ls, ...mapStats(bytes, this.index!), version: at.year!.version });
    };
    const held = this.cache.get(key);
    if (held) { show(held); this.prefetch(at, rateSimPerReal); return; }
    if (key === this.wanted) return;
    this.wanted = key;
    // While it comes, the sol before or after it may stay (the plate names
    // the sol drawn); any other is taken off.
    if (this.shown !== null && Math.abs(this.shownAt - solAt) > 1) { this.shown = null; this.onChange(null); }
    void this.get(at.year, at.k, key).then((bytes) => {
      if (this.wanted === key) { this.wanted = null; show(bytes); }
    }).catch((err) => {
      console.warn(`Mars dust ${key} not loaded: ${err}`);
      if (this.wanted === key) setTimeout(() => { if (this.wanted === key) this.wanted = null; }, 10e3);
    });
  }

  private get(year: MarsDustYear, k: number, key: string): Promise<Uint8Array> {
    const n = this.index!.grid.nLon * this.index!.grid.nLat;
    return fetchRange(`${this.base}marsdust/${year.file}`, k * n, n).then((bytes) => {
      this.cache.set(key, bytes);
      if (this.cache.size > KEEP) this.cache.delete(this.cache.keys().next().value!);
      return bytes;
    });
  }

  // While time runs, the next sol's map ahead of it.
  private prefetching = new Set<string>();
  private prefetch(at: { year: MarsDustYear; k: number; my: number; sol: number }, rate: number): void {
    if (rate === 0) return;
    const k = at.k + Math.sign(rate);
    if (k < 0 || k >= at.year.sols) return;
    const key = `${at.my} ${at.year.soy + k}`;
    if (this.cache.has(key) || this.prefetching.has(key)) return;
    this.prefetching.add(key);
    void this.get(at.year, k, key).catch(() => {}).finally(() => this.prefetching.delete(key));
  }

  private draw(bytes: Uint8Array): void {
    const { nLon, nLat } = this.index!.grid;
    if (!this.texture) {
      const t = new THREE.DataTexture(new Uint8Array(nLon * nLat), nLon, nLat, THREE.RedFormat, THREE.UnsignedByteType);
      // Values at texel centres (the shader shifts by the grid's lon0);
      // longitude wraps, latitude stops at the poles.
      t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      this.texture = t;
    }
    (this.texture.image.data as Uint8Array).set(bytes);
    this.texture.needsUpdate = true;
    this.onChange(this.texture);
  }
}

// Bytes [from, from + n) of a file; the whole file sliced where the server
// ignores ranges.
async function fetchRange(url: string, from: number, n: number): Promise<Uint8Array> {
  const r = await fetch(url, { headers: { Range: `bytes=${from}-${from + n - 1}` } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (r.status === 206) {
    const m = r.headers.get('content-range')?.match(/^bytes (\d+)-/);
    if (!m || Number(m[1]) !== from || buf.length !== n) throw new Error('unexpected range');
    return buf;
  }
  if (buf.length < from + n) throw new Error('file too short');
  return buf.slice(from, from + n);
}
