// src/scene/clouds.ts
//
// Earth as satellites saw it on the sim date, drawn over the Blue Marble
// (docs/frontend/textures.md#daily-earth), from NASA GIBS (Global Imagery
// Browse Services), newest first:
//
//   geostationary  GOES-East and GOES-West GeoColor, a full-disc frame
//                  every 10 minutes, about 40 minutes behind: the weather
//                  at that minute over the Americas and the Pacific. Used
//                  where the Sun was up (GeoColor's night side is infrared
//                  cloud over a picture of city lights) and within 70 deg
//                  of the satellite (the limb is smeared); the frame at or
//                  before the sim time, never newer than an hour before now.
//   daily          the true-colour mosaic of polar orbiters crossing the
//                  equator around 10:30 (Terra) or 13:30 (VIIRS) local
//                  time: one look a day at each place.
//
// GIBS adds each pass some hours after it is taken, so the last days are
// not whole: on 18 Nov 2026 at 10 UTC the day before covered only the
// Americas and the Pacific (41 % of the globe, against 84 % for a whole
// day). Within two days of now the sim's day is drawn over the two days
// before it. Each pixel comes from the first layer that has data there
// (decode.worker.ts); where none has (polar night, swath gaps) the image
// is black, which the surface shader reads as none, and the Blue Marble
// shows. What was drawn, and the share of the globe each layer gave, is
// published (dailyEarthInfo) for the Earth's readout.
//
// The image is dropped when the sim moves well away from its day, and not
// fetched while time runs faster than a day per second; the geostationary
// frame only while it runs at most 10 minutes a second, and fetched again
// at most once a minute as the frame moves on.

import * as THREE from 'three';
import { decodeImage, type TextureUploader } from './surfaces';
import type { GeoMask } from './decode.worker';
import { geoFrame, subsolar } from './layerComposite.js';
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

// The geostationary layers: GIBS's id, the satellite's longitude (deg
// east; GOES-16 then GOES-19 at 75.2 W, GOES-17 then GOES-18 at 137.2 W).
export interface GeoLayer { id: string; name: string; lon: number }
export const GEO_LAYERS: GeoLayer[] = [
  { id: 'GOES-East_ABI_GeoColor', name: 'GOES-East', lon: -75.2 },
  { id: 'GOES-West_ABI_GeoColor', name: 'GOES-West', lon: -137.2 },
];
const GEO_MIN_FETCH_MS = 60e3;            // at most one new frame a minute
const GEO_REACH_DEG = 70;                 // from the satellite's nadir
const GEO_SUN_COS = 0.1;                  // the Sun at least 5.7 deg up

// What the Earth shows, newest first: the geostationary frame (its time,
// and each satellite's share of the globe) and the days drawn under it
// with theirs; null with no image.
export interface DailyEarthInfo {
  layer: string;
  geo: { time: string; parts: { name: string; share: number }[] } | null;
  days: { day: string; share: number }[];
}
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

// What a load drew, for the readout, from the share of the globe each
// layer gave (geostationary frames first, then the days, as decodeImage
// was given them). Without shares (no worker) only the newest day is drawn.
// Null when no layer gave any (GIBS can answer with images that have no
// data), so that nothing is said to be drawn.
export function drawnInfo(layer: string, geo: GeoLayer[], frameIso: string | null, days: string[], shares?: number[]): DailyEarthInfo | null {
  const geoParts = shares ? geo.map((g, i) => ({ name: g.name, share: shares[i] })).filter((g) => g.share > 0) : [];
  const dayShares = shares?.slice(geo.length);
  const drawn = dayShares ? days.map((d, i) => ({ day: d, share: dayShares[i] })).filter((d) => d.share > 0) : [{ day: days[0], share: NaN }];
  const geoInfo = geoParts.length ? { time: frameIso!, parts: geoParts } : null;
  return geoInfo || drawn.length ? { layer, geo: geoInfo, days: drawn } : null;
}

// The credit line for what was drawn.
export function gibsCredit(info: DailyEarthInfo): string {
  const geo = info.geo;
  const parts = [
    ...(geo ? [`${geo.parts.map((g) => g.name).join(' and ')} GeoColor ${geo.time.slice(0, 16).replace('T', ' ')} UTC`] : []),
    ...(info.days.length ? [`${info.layer.replace(/_/g, ' ')}, ${info.days.map((d) => d.day).join(' over ')}`] : []),
  ];
  return `${parts.join(' over ')}: NASA GIBS / EOSDIS`;
}

export function gibsUrl(layer: string, time: string, width = 4096, format: 'png' | 'jpeg' = 'png'): string {
  const q = new URLSearchParams({
    SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: layer, STYLES: '',
    CRS: 'EPSG:4326', BBOX: '-90,-180,90,180', WIDTH: String(width), HEIGHT: String(width / 2),
    FORMAT: `image/${format}`, TRANSPARENT: 'TRUE', TIME: time,
  });
  return `${ENDPOINT}?${q}`;
}

export class DailyEarth {
  uploader: TextureUploader | null = null;
  private day: string | null = null;      // the day loaded or loading
  private loadedDayMs = NaN;
  private loadedAt = NaN;                 // wall clock (ms) of the last fetch that included today
  private fetchedAt = -Infinity;          // wall clock (ms) of the last fetch
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
    const frame = geoFrame(simMs, nowMs, rateSimPerReal);
    const frameIso = frame === null ? null : new Date(frame).toISOString().slice(0, 19) + 'Z';
    const daysKey = days.join(' ');
    const key = `${frameIso ?? ''} ${daysKey}`;
    // Today's mosaic fills in as the satellites pass: fetched again hourly.
    const today = new Date(nowMs).toISOString().slice(0, 10);
    if (key === this.day && !(days[0] === today && nowMs - this.loadedAt > REFRESH_MS)) return;
    // Only the frame moved on: at most once a minute.
    if (this.day?.endsWith(` ${daysKey}`) && frameIso && nowMs - this.fetchedAt < GEO_MIN_FETCH_MS) return;
    const day = key, dayMs = Date.parse(`${days[0]}T00:00:00Z`);
    const layer = gibsLayer(days[0])!;
    this.day = day;
    this.fetchedAt = nowMs;
    this.loadedAt = days[0] === today ? nowMs : NaN;
    // Newest first: the geostationary frames, then the days.
    const sun = frame === null ? null : subsolar(frame);
    const geo = frameIso ? GEO_LAYERS : [];
    const urls = [
      ...geo.map((g) => gibsUrl(g.id, frameIso!, 4096, 'jpeg')),
      gibsUrl(layer.id, days[0]),
      ...days.slice(1).map((d) => gibsUrl(gibsLayer(d)!.id, d, UNDER_WIDTH)),
    ];
    const masks: (GeoMask | null)[] = [
      ...geo.map((g) => ({ satLon: g.lon, reachDeg: GEO_REACH_DEG, sunLat: sun!.lat, sunLon: sun!.lon, sunCos: GEO_SUN_COS })),
      ...days.map(() => null),
    ];
    const [url, ...under] = urls;
    // The mosaic has alpha (no data is transparent), so it is not
    // premultiplied; its bright-cloud level is measured in the worker.
    // A day superseded while it decoded is dropped before its upload, and
    // its bright-cloud level never replaces the shown day's.
    const uploader = this.uploader;
    const loaded: Promise<{ tex: THREE.Texture; white: number; shares?: number[] } | null> = uploader && typeof createImageBitmap === 'function'
      ? decodeImage(url, { premultiply: false, brightLuminance: true, maxSize: uploader.maxSize, under, masks })
        .then(({ bitmap, whiteLuminance, shares }) => {
          if (this.day !== day) { bitmap.close(); return null; }
          return uploader.upload(bitmap, true).then((tex) => ({ tex, white: whiteLuminance ?? 1, shares }));
        })
      : new THREE.TextureLoader().loadAsync(gibsUrl(layer.id, days[0])).then((t) => {
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
      const drawn = drawnInfo(layer.id, geo, frameIso, days, shares);
      this.credit = drawn ? gibsCredit(drawn) : '';
      publish(drawn);
      this.onChange(tex);
      old?.dispose();
    }).catch((err) => {
      // Try that day again only after a minute: the mosaic is 15 MB.
      console.warn(`daily Earth ${day} not loaded: ${err}`);
      if (this.day === day) setTimeout(() => { if (this.day === day) this.day = null; }, 60e3);
    });
  }
}

