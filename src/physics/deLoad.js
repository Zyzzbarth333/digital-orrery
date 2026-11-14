// src/physics/deLoad.js
//
// Fetches and installs the DE442 Earth-Moon table (deTable.js) and SB441's
// asteroids (sbTable.js) in a browser thread: the main thread before the app
// starts, and each worker before its first job. If a fetch fails the app
// runs without that table (astronomy-engine for the Earth and the Moon, no
// asteroids in the kernel) and says so in the console.

import { parseDeTable, installDeTable } from './deTable.js';
import { parseSbTable, installSbTable } from './sbTable.js';
import { installSpaceWeather } from './spaceWeather.js';

export const DE_TABLE_URL = `${import.meta.env.BASE_URL}ephemeris/de442-earth-moon-2000-2050.bin`;

export const SB_TABLE_URL = `${import.meta.env.BASE_URL}ephemeris/sb441-asteroids-2000-2050.bin`;

export const SPACE_WEATHER_URL = `${import.meta.env.BASE_URL}data/spaceweather.json`;
export async function loadDeTable(url = DE_TABLE_URL) {
  // The Sun's activity for the upper atmosphere (drag), alongside; without
  // it drag uses a moderate, constant activity.
  fetch(SPACE_WEATHER_URL).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))).then(installSpaceWeather)
    .catch((err) => console.warn(`space weather not loaded (${err}); drag uses moderate solar activity`));
  // SB441's largest asteroids (sbTable.js), alongside: without them the
  // kernel leaves the asteroids out and the labels use two-body ellipses.
  const sb = fetch(SB_TABLE_URL).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((b) => installSbTable(parseSbTable(b)))
    .catch((err) => console.warn(`SB441 asteroid table not loaded (${err}); the kernel leaves out the asteroids`));
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    installDeTable(parseDeTable(await res.arrayBuffer()));
    await sb;
    return true;
  } catch (err) {
    console.warn(`DE442 Earth-Moon table not loaded (${err}); using astronomy-engine for Earth and the Moon`);
    await sb;
    return false;
  }
}
