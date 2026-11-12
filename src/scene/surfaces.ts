// src/scene/surfaces.ts
//
// Loads the surface maps listed in public/textures/manifest.json, which the
// conversion script (python/textures/build_textures.py) writes. Without the
// manifest every body keeps its flat albedo colour. Earth's day map is the
// Blue Marble image for the sim month, swapped as the month changes.

import * as THREE from 'three';
import type { BodyKey } from './catalogue';
import { applySurfaceMaps } from './bodyMaterial';

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
  stars?: { map: string; raAtLeftDeg: number; raIncreasesRight: boolean; gain?: number; credit: string };
}

const BASE = `${import.meta.env.BASE_URL}textures/`;

export async function loadManifest(): Promise<Manifest | null> {
  try {
    const r = await fetch(`${BASE}manifest.json`);
    return r.ok ? ((await r.json()) as Manifest) : null;
  } catch {
    return null;
  }
}

export async function loadJson<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return (await r.json()) as T;
}

export class SurfaceLoader {
  private loader = new THREE.TextureLoader();
  private cache = new Map<string, Promise<THREE.Texture>>();
  private month = new Map<BodyKey, number>();

  constructor(private renderer: THREE.WebGLRenderer) {}

  load(path: string, colour: boolean): Promise<THREE.Texture> {
    let p = this.cache.get(path);
    if (!p) {
      p = this.loader.loadAsync(BASE + path).then((t) => {
        t.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
        t.wrapS = THREE.RepeatWrapping;
        return t;
      });
      this.cache.set(path, p);
    }
    return p;
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
      const day = await this.load(entry.dayMonthly[m], true);
      if (this.month.get(key) === m) {
        applySurfaceMaps(material, { day, dayMeanLuminance: entry.dayMeanLuminance, dayWhiteLuminance: entry.dayWhiteLuminance });
      }
    } else if (entry.day && !this.month.has(key)) {
      this.month.set(key, -1);
      applySurfaceMaps(material, { day: await this.load(entry.day, true), dayMeanLuminance: entry.dayMeanLuminance });
    }
  }
}
