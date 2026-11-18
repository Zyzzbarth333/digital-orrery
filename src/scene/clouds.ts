// src/scene/clouds.ts
//
// Earth as satellites saw it on the sim date: a whole-globe daily true-colour
// mosaic from NASA GIBS (Global Imagery Browse Services), drawn over the
// Blue Marble. Where that day has no data (gaps between orbit swaths, polar
// night) the image is black, which the surface shader reads as none, and
// the Blue Marble shows. The mosaic is one image per UTC day from polar
// orbiters crossing the equator around 10:30 (Terra) or 13:30 (VIIRS
// satellites) local time, so it is "the weather that day", not that minute.
//
// The last few days are not whole: GIBS adds each pass some hours after it
// is taken, and on 18 Nov 2026 at 10 UTC the day before covered only the
// Americas and the Pacific (41 % of the globe, against 84 % for a complete
// day). So within two days of now the sim's day is drawn over the two days
// before it, each place from the newest pass that has it (decode.worker.ts):
// at "now", the latest look the satellites have had at each place. Older
// days are whole and drawn alone. The days and their shares are published
// (dailyEarthInfo) for the Earth's readout. The image is dropped when the
// sim moves well away from its day, and not fetched while time runs faster
// than a day per second.

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
// Within this many days of now a day is drawn over the two before it.
const RECENT_DAYS = 2;
// The older days under a recent one, at half the width (a quarter of the
// 15 MB): they fill what the newest has not reached yet.
const UNDER_WIDTH = 2048;
// How often a composite that includes today is fetched again.
const REFRESH_MS = 3600e3;

// What the Earth shows: the days drawn (newest first) with the share of
// the globe each gave, and the layer; null with no daily image.
export interface DailyEarthInfo { layer: string; days: { day: string; share: number }[] }
let info: DailyEarthInfo | null = null;
const listeners = new Set<() => void>();
export const dailyEarthInfo = {
  get: (): DailyEarthInfo | null => info,
  subscribe(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; },
};
function publish(next: DailyEarthInfo | null): void { info = next; listeners.forEach((f) => f()); }

// The GIBS layer for a day: the newest satellite whose record covers it.
export const gibsLayer = (day: string): GibsLayer | undefined => GIBS_LAYERS.find((l) => day >= l.firstDay);

// The days to draw for a sim time (ms), newest first, or none for a day
// after today's.
export function daysFor(simMs: number, nowMs: number): string[] {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const dayMs = Math.floor(simMs / DAY_MS) * DAY_MS;
  if (dayMs > today) return [];
  const n = dayMs >= today - RECENT_DAYS * DAY_MS ? 3 : 1;
  return Array.from({ length: n }, (_, i) => new Date(dayMs - i * DAY_MS).toISOString().slice(0, 10)).filter((d) => gibsLayer(d));
}

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
  private loadedAt = NaN;                 // wall clock (ms) of the last fetch that included today
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
    publish(null);
    old?.dispose();
  }

  update(simMs: number, rateSimPerReal: number, nowMs = Date.now()): void {
    if (!this.enabled) return;
    // Drop a stale image so the wrong day's weather is never shown.
    if (this.texture && Math.abs(simMs - this.loadedDayMs - DAY_MS / 2) > 2 * DAY_MS) {
      const old = this.texture;
      this.texture = null; this.loadedDayMs = NaN; this.onChange(null);
      publish(null);
      old.dispose();
    }
    if (Math.abs(rateSimPerReal) > 86400) return;
    // A future date gets none.
    const days = daysFor(simMs, nowMs);
    if (!days.length) return;
    const key = days.join(' ');
    // Today's mosaic fills in as the satellites pass: fetched again hourly.
    const today = new Date(nowMs).toISOString().slice(0, 10);
    if (key === this.day && !(days[0] === today && nowMs - this.loadedAt > REFRESH_MS)) return;
    const day = key, dayMs = Date.parse(`${days[0]}T00:00:00Z`);
    const layer = gibsLayer(days[0])!;
    this.day = day;
    this.loadedAt = days[0] === today ? nowMs : NaN;
    const url = gibsUrl(layer.id, days[0]);
    const under = days.slice(1).map((d) => gibsUrl(gibsLayer(d)!.id, d, UNDER_WIDTH));
    // The mosaic has alpha (no data is transparent), so it is not
    // premultiplied; its bright-cloud level is measured in the worker.
    // A day superseded while it decoded is dropped before its upload, and
    // its bright-cloud level never replaces the shown day's.
    const uploader = this.uploader;
    const loaded: Promise<{ tex: THREE.Texture; white: number; shares?: number[] } | null> = uploader && typeof createImageBitmap === 'function'
      ? decodeImage(url, { premultiply: false, brightLuminance: true, maxSize: uploader.maxSize, under })
        .then(({ bitmap, whiteLuminance, shares }) => {
          if (this.day !== day) { bitmap.close(); return null; }
          return uploader.upload(bitmap, true).then((tex) => ({ tex, white: whiteLuminance ?? 1, shares }));
        })
      : new THREE.TextureLoader().loadAsync(url).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
        return { tex: t, white: brightLuminance(t.image as CanvasImageSource) };
      });
    loaded.then((got) => {
      if (!got) return;
      const { tex, white, shares } = got;
      if (this.day !== day) { tex.dispose(); return; }
      this.whiteLuminance = white;
      const old = this.texture;
      this.texture = tex;
      this.loadedDayMs = dayMs;
      // Without the worker (no createImageBitmap) only the newest day is drawn.
      const drawn = shares ? days.map((d, i) => ({ day: d, share: shares[i] })).filter((d) => d.share > 0) : [{ day: days[0], share: NaN }];
      this.credit = `${layer.id.replace(/_/g, ' ')}, ${drawn.map((d) => d.day).join(' over ')}: NASA GIBS / EOSDIS`;
      publish({ layer: layer.id, days: drawn });
      this.onChange(tex);
      old?.dispose();
    }).catch((err) => {
      // Try that day again only after a minute: the mosaic is 15 MB.
      console.warn(`daily Earth ${day} not loaded: ${err}`);
      if (this.day === day) setTimeout(() => { if (this.day === day) this.day = null; }, 60e3);
    });
  }
}

