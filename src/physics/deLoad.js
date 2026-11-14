// src/physics/deLoad.js
//
// Fetches and installs the DE442 table (deTable.js) and SB441's asteroids
// (sbTable.js) in a browser thread: the main thread before the app starts,
// and each worker before its first job. If a fetch fails the app runs
// without that table (astronomy-engine for every body, or no asteroids in
// the kernel) and says so in the console. The Earth's orientation
// parameters (eop.js) come alongside; without them the Earth turns on UTC
// with no polar motion (180 m at the surface).

import { parseDeTable, installDeTable } from './deTable.js';
import { parseSbTable, installSbTable } from './sbTable.js';
import { installSpaceWeather } from './spaceWeather.js';
import { parseEop, installEop } from './eop.js';

export const DE_TABLE_URL = `${import.meta.env.BASE_URL}ephemeris/de442-2000-2050.bin`;

export const SB_TABLE_URL = `${import.meta.env.BASE_URL}ephemeris/sb441-asteroids-2000-2050.bin`;

export const SPACE_WEATHER_URL = `${import.meta.env.BASE_URL}data/spaceweather.json`;
export const EOP_URL = `${import.meta.env.BASE_URL}ephemeris/earth-orientation-2000-2126.bin`;

async function loadEop() {
  try {
    const res = await fetch(EOP_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    installEop(parseEop(await res.arrayBuffer()));
  } catch (err) {
    console.warn(`Earth orientation table not loaded (${err}); the Earth turns on UTC, without polar motion`);
  }
}

export async function loadDeTable(url = DE_TABLE_URL) {
  // Before anything places a launch site or an impact point.
  const eop = loadEop();
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
    await eop;
    await sb;
    return true;
  } catch (err) {
    console.warn(`DE442 table not loaded (${err}); using astronomy-engine for every body`);
    await eop;
    await sb;
    return false;
  }
}
