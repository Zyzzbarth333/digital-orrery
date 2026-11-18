// src/scene/layerComposite.js
//
// The Earth's cloud layers laid one over another (clouds.ts, through
// decode.worker.ts): equirectangular RGBA images of one size, newest
// first, row 0 at the south pole (the maps' convention, after the
// decoder's flip), each pixel taken from the first image that has data
// there. No data is a pixel no brighter than NO_DATA in every channel
// (GIBS draws no data black, or transparent). An image may carry a mask,
// as a geostationary frame does: only where the satellite sees the ground
// within reachDeg of its nadir (on the equator at satLon) and the Sun was
// up by more than asin(sunCos) at the frame's time (the subsolar point
// sunLat, sunLon), faded in over the last FEATHER_DEG and as the Sun rises. Returns the image and each layer's share of the
// globe's area (pixels weighted by the cosine of their latitude). Also which geostationary frame to ask for, and where the Sun is
// overhead then. Pure ES module.

export const NO_DATA = 10;

const DAY_MS = 86400e3;
export const GEO_STEP_MS = 600e3;         // a geostationary frame every 10 minutes
export const GEO_LAG_MS = 3600e3;         // GIBS's newest frame is 40-60 minutes old
export const GEO_MAX_RATE = 600;          // sim seconds a second, beyond which the frame is not followed

// The geostationary frame to ask for (ms, on the 10-minute grid), or null:
// the sim time, but never within GEO_LAG_MS of now, where GIBS has no
// frame yet (it answers a time past its newest frame with an empty image,
// and any other with the frame at or before it).
export function geoFrame(simMs, nowMs, rate) {
  if (Math.abs(rate) > GEO_MAX_RATE) return null;
  const t = Math.min(simMs, nowMs - GEO_LAG_MS);
  if (simMs - t > 3 * GEO_LAG_MS) return null;            // a sim time ahead of now
  return Math.floor(t / GEO_STEP_MS) * GEO_STEP_MS;
}

// The point under the Sun (deg) at a time: its declination and the
// equation of time, the NOAA solar calculator's low-precision forms
// (within 0.1 deg; the mask's edge needs no better).
export function subsolar(ms) {
  const g = (2 * Math.PI / 365) * ((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / DAY_MS);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g)
    - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const minutes = (ms % DAY_MS) / 60e3;
  const lon = -((minutes + eqt) / 4 - 180);
  return { lat: (decl * 180) / Math.PI, lon: ((lon + 540) % 360) - 180 };
}


const D = Math.PI / 180;

// Per row and per column, what the mask needs: cos and sin of latitude,
// cos of longitude from the satellite and from the Sun.
function maskTables(mask, W, H) {
  const sinLat = new Float32Array(H), cosLat = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const lat = (-90 + ((y + 0.5) * 180) / H) * D;
    sinLat[y] = Math.sin(lat); cosLat[y] = Math.cos(lat);
  }
  const cosSat = new Float32Array(W), cosSun = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const lon = (-180 + ((x + 0.5) * 360) / W) * D;
    cosSat[x] = Math.cos(lon - mask.satLon * D);
    cosSun[x] = Math.cos(lon - mask.sunLon * D);
  }
  return { sinLat, cosLat, cosSat, cosSun, cosReach: Math.cos(mask.reachDeg * D), sSun: Math.sin(mask.sunLat * D), cSun: Math.cos(mask.sunLat * D) };
}

// A masked layer's weight at a pixel: 1 well inside its mask, fading to 0
// over the last FEATHER_DEG of its reach and as the Sun sinks from
// SUN_FULL to sunCos, so a frame of one minute blends into a pass of
// another hour instead of meeting it at a seam.
export const FEATHER_DEG = 10;
export const SUN_FULL = 0.35;             // the Sun 20 deg up
const ramp = (x, a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));

export function maskWeight(mask, latDeg, lonDeg) {
  const lat = latDeg * D, lon = lonDeg * D;
  const toSat = Math.cos(lat) * Math.cos(lon - mask.satLon * D);
  const sun = Math.sin(lat) * Math.sin(mask.sunLat * D) + Math.cos(lat) * Math.cos(mask.sunLat * D) * Math.cos(lon - mask.sunLon * D);
  return ramp(toSat, Math.cos(mask.reachDeg * D), Math.cos((mask.reachDeg - FEATHER_DEG) * D)) * ramp(sun, mask.sunCos, SUN_FULL);
}

// layers: [{ data: Uint8ClampedArray (W * H * 4) | null, mask?: {...} | null }]
// Beneath, the unmasked layers, each pixel from the first with data. Over
// it, the masked ones in order, each taking its weight w of what is left:
// weights f = w1, (1 - w1) w2, ... and the rest (1 - w1)(1 - w2)... for
// what lies beneath, normalised to what has data there, so a masked layer
// is drawn in full where nothing lies beneath it. Shares follow the same
// weights.
export function compositeLayers(layers, W, H) {
  const n = W * H;
  const out = new Uint8ClampedArray(4 * n);
  // Each row's area weight, and the whole map's.
  const area = new Float64Array(H);
  let total = 0;
  for (let y = 0; y < H; y++) { area[y] = Math.cos((-90 + ((y + 0.5) * 180) / H) * D); total += area[y] * W; }
  const shares = layers.map(() => 0);
  const has = (d, p) => d[p] > NO_DATA || d[p + 1] > NO_DATA || d[p + 2] > NO_DATA;
  // The base, and which layer gave each of its pixels.
  const owner = new Int16Array(n).fill(-1);
  layers.forEach((layer, i) => {
    const d = layer.data;
    if (!d || layer.mask) return;
    for (let k = 0; k < n; k++) {
      const p = 4 * k;
      if (owner[k] >= 0 || !has(d, p)) continue;
      out[p] = d[p]; out[p + 1] = d[p + 1]; out[p + 2] = d[p + 2]; out[p + 3] = 255;
      owner[k] = i;
    }
  });
  const masked = layers.map((l, i) => ({ ...l, i })).filter((l) => l.data && l.mask)
    .map((l) => ({ ...l, t: maskTables(l.mask, W, H), c0: Math.cos(l.mask.reachDeg * D), c1: Math.cos((l.mask.reachDeg - FEATHER_DEG) * D) }));
  const f = new Float64Array(masked.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = y * W + x, p = 4 * k;
      let rest = 1, sum = 0, r = 0, g = 0, b = 0;
      for (let j = 0; j < masked.length; j++) {
        const { data: d, mask, t, c0, c1 } = masked[j];
        f[j] = 0;
        if (!has(d, p)) continue;
        const sun = t.sinLat[y] * t.sSun + t.cosLat[y] * t.cSun * t.cosSun[x];
        const w = ramp(t.cosLat[y] * t.cosSat[x], c0, c1) * ramp(sun, mask.sunCos, SUN_FULL);
        if (w <= 0) continue;
        f[j] = rest * w; rest *= 1 - w; sum += f[j];
        r += f[j] * d[p]; g += f[j] * d[p + 1]; b += f[j] * d[p + 2];
      }
      const base = owner[k] >= 0 ? rest : 0;
      if (owner[k] >= 0) shares[owner[k]] += (sum + base > 0 ? base / (sum + base) : 1) * area[y];
      if (sum <= 0) continue;
      const all = sum + base;
      out[p] = (r + base * out[p]) / all; out[p + 1] = (g + base * out[p + 1]) / all; out[p + 2] = (b + base * out[p + 2]) / all; out[p + 3] = 255;
      for (let j = 0; j < masked.length; j++) if (f[j] > 0) shares[masked[j].i] += (f[j] / all) * area[y];
    }
  }
  return { out, shares: shares.map((s) => s / total) };
}
