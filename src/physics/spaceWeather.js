// src/physics/spaceWeather.js
//
// The Sun's activity by date, for the upper atmosphere's density
// (atmosphere.js): the daily solar radio flux F10.7 (observed, in solar flux
// units), its 81-day centred mean, and the daily geomagnetic Ap. From
// CelesTrak's SW-All.csv, observed and then predicted
// (public/data/spaceweather.json, environment.fetch.mjs). Installed once per
// thread like the DE442 table: deLoad.js in the browser, deNode.js in Node.

let table = null;
const DAY_MS = 86400e3;

export function installSpaceWeather(json) {
  table = { start: Date.parse(`${json.start}T00:00:00Z`), days: json.days, lastObserved: json.lastObserved };
}
export const spaceWeatherInstalled = () => table !== null;

// Moderate activity, for dates outside the table.
export const MEAN_ACTIVITY = { f107: 150, f107bar: 150, ap: 15 };

// The activity for the upper atmosphere at ms (UTC): the previous day's
// F10.7 (as MET takes it), the 81-day mean centred on the day, and the
// day's Ap. { f107, f107bar, ap, source: 'observed' | 'predicted' | 'mean' }.
export function spaceWeatherAt(ms) {
  if (!table) return { ...MEAN_ACTIVITY, source: 'mean' };
  const i = Math.floor((ms - table.start) / DAY_MS);
  if (i < 1 || i >= table.days.length) return { ...MEAN_ACTIVITY, source: 'mean' };
  const [, fbar, ap] = table.days[i], [fPrev] = table.days[i - 1];
  const observed = table.lastObserved && ms < Date.parse(`${table.lastObserved}T00:00:00Z`) + DAY_MS;
  return { f107: fPrev, f107bar: fbar, ap, source: observed ? 'observed' : 'predicted' };
}
