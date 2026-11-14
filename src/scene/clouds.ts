// src/scene/clouds.ts
//
// Earth as satellites saw it on the sim date: a whole-globe daily true-colour
// mosaic from NASA GIBS (Global Imagery Browse Services), drawn over the
// Blue Marble. Where that day has no data (gaps between orbit swaths, polar
// night) the image is transparent and the Blue Marble shows. The mosaic is
// one image per UTC day from polar orbiters crossing the equator around
// 10:30 (Terra) or 13:30 (VIIRS satellites) local time, so it is "the weather that
// day", not that minute. At "now" it is yesterday's, the latest complete
// day. It is dropped when the sim moves well away from its day, and not
// fetched while time runs faster than a day per second.

import * as THREE from 'three';
import { decodeImage, type TextureUploader } from './surfaces';
import { brightLuminance } from './imageStats';

export interface GibsLayer { id: string; firstDay: string }    // firstDay: YYYY-MM-DD

// Newest first: the first layer whose record covers the day is used.
// (Suomi NPP's VIIRS runs about ten days behind, so the NOAA satellites lead.)
export const GIBS_LAYERS: GibsLayer[] = [
  { id: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor', firstDay: '2023-02-10' },
  { id: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor', firstDay: '2018-01-05' },
  { id: 'VIIRS_SNPP_CorrectedReflectance_TrueColor', firstDay: '2015-11-24' },
  { id: 'MODIS_Terra_CorrectedReflectance_TrueColor', firstDay: '2000-02-24' },
];

const ENDPOINT = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const DAY_MS = 86400e3;

export function gibsUrl(layer: string, day: string, width = 4096): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, STYLES: '',
    CRS: 'EPSG:4326', BBOX: '-90,-180,90,180', WIDTH: String(width), HEIGHT: String(width / 2),
    FORMAT: 'image/png', TRANSPARENT: 'TRUE', TIME: day,
  });
  return `${ENDPOINT}?${q}`;
}

export class DailyEarth {
  uploader: TextureUploader | null = null;
  private day: string | null = null;      // the day loaded or loading
  private loadedDayMs = NaN;
  texture: THREE.Texture | null = null;
  whiteLuminance = 1;
  credit = '';
  onChange: (tex: THREE.Texture | null) => void = () => {};

  constructor(private enabled = true) {}

  // After a lost WebGL context: forget the day so the next update fetches it
  // again (its texture died with the context).
  reset(): void {
    const old = this.texture;
    this.day = null; this.texture = null; this.loadedDayMs = NaN;
    this.onChange(null);
    old?.dispose();
  }

  update(simMs: number, rateSimPerReal: number, nowMs = Date.now()): void {
    if (!this.enabled) return;
    // Drop a stale image so the wrong day's weather is never shown.
    if (this.texture && Math.abs(simMs - this.loadedDayMs - DAY_MS / 2) > 2 * DAY_MS) {
      const old = this.texture;
      this.texture = null; this.loadedDayMs = NaN; this.onChange(null);
      old.dispose();
    }
    if (Math.abs(rateSimPerReal) > 86400) return;
    // Today's mosaic is still filling in, so a sim time in the last day uses
    // yesterday's, the latest complete one; a future date gets none.
    const latest = Math.floor(nowMs / DAY_MS) * DAY_MS - DAY_MS;
    let dayMs = Math.floor(simMs / DAY_MS) * DAY_MS;
    if (dayMs > latest + DAY_MS) return;
    dayMs = Math.min(dayMs, latest);
    const day = new Date(dayMs).toISOString().slice(0, 10);
    if (day === this.day) return;
    const layer = GIBS_LAYERS.find((l) => day >= l.firstDay);
    if (!layer) return;
    this.day = day;
    const url = gibsUrl(layer.id, day);
    // The mosaic has alpha (no data is transparent), so it is not
    // premultiplied; its bright-cloud level is measured in the worker.
    // A day superseded while it decoded is dropped before its upload, and
    // its bright-cloud level never replaces the shown day's.
    const uploader = this.uploader;
    const loaded: Promise<{ tex: THREE.Texture; white: number } | null> = uploader && typeof createImageBitmap === 'function'
      ? decodeImage(url, { premultiply: false, brightLuminance: true, maxSize: uploader.maxSize })
        .then(({ bitmap, whiteLuminance }) => {
          if (this.day !== day) { bitmap.close(); return null; }
          return uploader.upload(bitmap, true).then((tex) => ({ tex, white: whiteLuminance ?? 1 }));
        })
      : new THREE.TextureLoader().loadAsync(url).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
        return { tex: t, white: brightLuminance(t.image as CanvasImageSource) };
      });
    loaded.then((got) => {
      if (!got) return;
      const { tex, white } = got;
      if (this.day !== day) { tex.dispose(); return; }
      this.whiteLuminance = white;
      const old = this.texture;
      this.texture = tex;
      this.loadedDayMs = dayMs;
      this.credit = `${layer.id.replace(/_/g, ' ')}, ${day}: NASA GIBS / EOSDIS`;
      this.onChange(tex);
      old?.dispose();
    }).catch((err) => {
      // Try that day again only after a minute: the mosaic is 15 MB.
      console.warn(`daily Earth ${day} not loaded: ${err}`);
      if (this.day === day) setTimeout(() => { if (this.day === day) this.day = null; }, 60e3);
    });
  }
}

