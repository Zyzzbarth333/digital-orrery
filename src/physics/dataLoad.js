// @ts-check
// src/physics/dataLoad.js
//
// The physics' data files, read through a loader it is handed, so the same
// code runs in a browser thread and under Node. A loader answers a path
// under the data root (public/, or the site's base URL) with the file's
// contents, either at once (Node: nodeData.js reads the disk) or as a
// promise (the browser: fetchData.js fetches it). It throws, or its promise
// rejects, when the file is not there.
//
//   loadEphemerides(loader): DE442 (deTable.js), SB441's asteroids
//     (sbTable.js), the Earth's orientation (eop.js) and the space weather
//     (spaceWeather.js), each installed as it arrives. A table that cannot
//     be loaded is left out, and the console says what that costs.
//   installEphemerides(loader): the same four, now, from a loader that
//     answers at once; a missing file throws.
//   installMoonTables(loader, { onMiss, warn }): the moons' tables
//     (moonTables.js), read a system and a year at a time.

import { parseDeTable, installDeTable } from './deTable.js';
import { parseSbTable, installSbTable } from './sbTable.js';
import { installSpaceWeather } from './spaceWeather.js';
import { parseEop, installEop } from './eop.js';
import { parseMoonChunk, setMoonChunkLoader } from './moonTables.js';

/**
 * @typedef {object} DataLoader
 * @property {(path: string, what?: string) => ArrayBuffer | Promise<ArrayBuffer>} buffer
 * @property {(path: string, what?: string) => any} json
 * @property {(path: string, what?: string) => string | Promise<string>} text
 */

// Under the data root.
export const DE_TABLE_PATH = 'ephemeris/de442-2000-2050.bin';
export const SB_TABLE_PATH = 'ephemeris/sb441-asteroids-2000-2050.bin';
export const SPACE_WEATHER_PATH = 'data/spaceweather.json';
export const EOP_PATH = 'ephemeris/earth-orientation-2000-2126.bin';

/** @param {ArrayBuffer} b */ const installDe = (b) => installDeTable(parseDeTable(b));
/** @param {ArrayBuffer} b */ const installSb = (b) => installSbTable(parseSbTable(b));
/** @param {ArrayBuffer} b */ const installEo = (b) => installEop(parseEop(b));

// A loader's answer, as a promise either way; a throw becomes a rejection.
// The read starts now, so the files are asked for in the order below.
/** @param {() => any} read @returns {Promise<any>} */
function attempt(read) {
  try {
    return Promise.resolve(read());
  } catch (err) {
    return Promise.reject(err);
  }
}

/**
 * In a browser thread: the main thread before the app starts, and each
 * worker before its first job. Resolves true once the DE442 table is in,
 * false if it could not be loaded (astronomy-engine for every body).
 * @param {DataLoader} loader
 * @returns {Promise<boolean>}
 */
export async function loadEphemerides(loader) {
  // Before anything places a launch site or an impact point. Without it
  // the Earth turns on UTC with no polar motion (180 m at the surface).
  const eop = attempt(() => loader.buffer(EOP_PATH)).then(installEo)
    .catch((err) => console.warn(`Earth orientation table not loaded (${err}); the Earth turns on UTC, without polar motion`));
  // The Sun's activity for the upper atmosphere (drag), alongside; without
  // it drag uses a moderate, constant activity. Nothing waits for it.
  attempt(() => loader.json(SPACE_WEATHER_PATH)).then(installSpaceWeather)
    .catch((err) => console.warn(`space weather not loaded (${err}); drag uses moderate solar activity`));
  // SB441's largest asteroids, alongside: without them the kernel leaves
  // the asteroids out and the labels use two-body ellipses.
  const sb = attempt(() => loader.buffer(SB_TABLE_PATH)).then(installSb)
    .catch((err) => console.warn(`SB441 asteroid table not loaded (${err}); the kernel leaves out the asteroids`));
  try {
    installDe(await loader.buffer(DE_TABLE_PATH));
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

/**
 * Under Node: every table, synchronously, so tests and validation scripts
 * see the same bodies as the app. The loader must answer at once.
 * @param {DataLoader} loader
 */
export function installEphemerides(loader) {
  installDe(/** @type {ArrayBuffer} */ (loader.buffer(DE_TABLE_PATH)));
  installEo(/** @type {ArrayBuffer} */ (loader.buffer(EOP_PATH)));
  installSb(/** @type {ArrayBuffer} */ (loader.buffer(SB_TABLE_PATH)));
  installSpaceWeather(loader.json(SPACE_WEATHER_PATH));
}

/**
 * The moon tables, a system and a year at a time (moonTables.js). With
 * onMiss, any position asked of a year not yet installed asks for it (Node,
 * and the kernel's worker); without, only wantMoonTables does (the main
 * thread, for the systems in view). Until a year arrives, and if it cannot
 * be read, the moons there come from the mean elements.
 *
 * An inner moon's year outside 2020-2035 is only there if it was built
 * locally (public/ephemeris/moons-extra), so its absence is quiet. With
 * warn (the browser) any other missing year says so in the console;
 * without (Node) a missing file is quiet too.
 * @param {DataLoader} loader
 * @param {{ onMiss?: boolean, warn?: boolean }} [opts]
 */
export function installMoonTables(loader, { onMiss = false, warn = true } = {}) {
  setMoonChunkLoader((/** @type {string} */ path) => {
    const optional = path.includes('moons-extra/');
    /** @param {any} err */
    const failed = (err) => {
      if (optional || (!warn && err?.missing)) return null;
      if (warn) console.warn(`moon table ${path} not loaded (${err}); its moons use the mean elements`);
      throw err;
    };
    // A dev server answers a missing file with the app's index.html; a
    // table starts with its format number (a little-endian 1.0, so 0x00).
    /** @param {ArrayBuffer} buf */
    const parse = (buf) => (optional && new Uint8Array(buf, 0, 1)[0] === 0x3c ? null : parseMoonChunk(buf));
    let got;
    try {
      got = loader.buffer(path);
      // Read at once (Node): parsed and installed now.
      if (got instanceof ArrayBuffer) return parse(got);
    } catch (err) {
      return failed(err);
    }
    return got.then(parse).catch(failed);
  }, { onMiss });
}
