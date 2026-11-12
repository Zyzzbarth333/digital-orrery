// src/scene/clouds.ts
//
// Earth as satellites saw it on the sim date: a whole-globe daily true-colour
// mosaic from NASA GIBS (Global Imagery Browse Services), drawn over the
// Blue Marble. Where that day has no data (gaps between orbit swaths, polar
// night) the image is transparent and the Blue Marble shows. The mosaic is
// one image per UTC day from polar orbiters crossing the equator around
// 10:30 (Terra) or 13:30 (VIIRS satellites) local time, so it is "the weather that
// day", not that minute. It is dropped when the sim moves more than a day
// from it, and not fetched while time runs faster than a day per second.

import * as THREE from 'three';

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
  private loader = new THREE.TextureLoader();
  private day: string | null = null;      // the day loaded or loading
  private loadedDayMs = NaN;
  texture: THREE.Texture | null = null;
  meanLuminance = 0.18;
  credit = '';
  onChange: (tex: THREE.Texture | null) => void = () => {};

  constructor(private enabled = true) {}

  update(simMs: number, rateSimPerReal: number, nowMs = Date.now()): void {
    if (!this.enabled) return;
    // Drop a stale image so the wrong day's weather is never shown.
    if (this.texture && Math.abs(simMs - this.loadedDayMs - DAY_MS / 2) > 1.5 * DAY_MS) {
      this.texture.dispose(); this.texture = null; this.loadedDayMs = NaN; this.onChange(null);
    }
    if (Math.abs(rateSimPerReal) > 86400) return;
    // GIBS publishes a day's mosaic within about a day; ask for yesterday at most.
    const dayMs = Math.floor(simMs / DAY_MS) * DAY_MS;
    if (dayMs > nowMs - DAY_MS) return;
    const day = new Date(dayMs).toISOString().slice(0, 10);
    if (day === this.day) return;
    const layer = GIBS_LAYERS.find((l) => day >= l.firstDay);
    if (!layer) return;
    this.day = day;
    this.loader.loadAsync(gibsUrl(layer.id, day)).then((tex) => {
      if (this.day !== day) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      this.meanLuminance = meanLinearLuminance(tex.image as CanvasImageSource);
      tex.wrapS = THREE.RepeatWrapping;
      this.texture?.dispose();
      this.texture = tex;
      this.loadedDayMs = dayMs;
      this.credit = `${layer.id.replace(/_/g, ' ')}, ${day}: NASA GIBS / EOSDIS`;
      this.onChange(tex);
    }).catch(() => { if (this.day === day) this.day = null; });
  }
}

// Mean linear luminance over the sphere where the image has data (rows
// weighted by cos latitude; pure black is no data), so the image can be
// scaled to Earth's geometric albedo like the other maps.
function meanLinearLuminance(img: CanvasImageSource): number {
  const w = 256, h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return 0.18;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const lin = (v: number) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  let sum = 0, wsum = 0;
  for (let y = 0; y < h; y++) {
    const wt = Math.cos((0.5 - (y + 0.5) / h) * Math.PI);
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const r = lin(d[i]), gg = lin(d[i + 1]), b = lin(d[i + 2]);
      if (Math.max(r, gg, b) < 0.003) continue;
      sum += wt * (0.2126 * r + 0.7152 * gg + 0.0722 * b);
      wsum += wt;
    }
  }
  return wsum > 0 ? sum / wsum : 0.18;
}
