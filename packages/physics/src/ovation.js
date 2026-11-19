// packages/physics/src/ovation.js
//
// NOAA SWPC's live aurora map, from the OVATION Prime model driven by the
// solar wind measured upstream at L1 (docs/physics/magnetic-fields.md#live-aurora):
// the probability of visible aurora (%) on a 1 deg geographic grid, for a
// forecast time half an hour to an hour and a half after the solar wind
// was measured. NOAA publishes only the latest map, so the app shows it
// when its clock is near that time and Starkov's oval otherwise.
//
//   OVATION_URL                       the latest map (CORS open, cached 60 s)
//   parseOvation(json) -> { observed, forecast, grid }   ms, ms, Uint8Array [lat + 90][lon]
//   ovationAt(o, lat, lon) -> %       bilinear, east longitude
//   ovationCovers(o, ms) -> boolean   whether the map holds for that time

export const OVATION_URL = 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json';

const NLON = 360, NLAT = 181;

export function parseOvation(json) {
  const grid = new Uint8Array(NLAT * NLON);
  for (const [lon, lat, v] of json.coordinates) {
    const i = Math.round(lat) + 90, j = ((Math.round(lon) % 360) + 360) % 360;
    if (i >= 0 && i < NLAT) grid[i * NLON + j] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return { observed: Date.parse(json['Observation Time']), forecast: Date.parse(json['Forecast Time']), grid };
}

export function ovationAt(o, latDeg, lonDeg) {
  const fi = Math.min(Math.max(latDeg + 90, 0), NLAT - 1.000001), i = Math.floor(fi), u = fi - i;
  const fl = ((lonDeg % 360) + 360) % 360, j = Math.floor(fl), v = fl - j, j1 = (j + 1) % NLON;
  const g = o.grid, a = g[i * NLON + j], b = g[i * NLON + j1], c = g[(i + 1) * NLON + j], d = g[(i + 1) * NLON + j1];
  return (1 - u) * ((1 - v) * a + v * b) + u * ((1 - v) * c + v * d);
}

// The map stands for its forecast time; it is used from half an hour
// before the solar wind it came from was measured to an hour after the
// forecast time, by when NOAA has published several newer ones.
export const ovationCovers = (o, ms) => !!o && ms >= o.observed - 30 * 60e3 && ms <= o.forecast + 60 * 60e3;
