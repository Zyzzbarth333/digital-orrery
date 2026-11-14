// src/physics/moonLoad.js
//
// The moon tables (moonTables.js) in a browser thread: fetched a system and
// a year at a time. The main thread asks for the systems in view
// (wantMoonTables, from the scene); the kernel's worker asks for any it
// needs (onMiss), which is only a system a craft is near. Until a year
// arrives, and if it cannot be fetched, the moons there come from the mean
// elements. An inner moon's year outside 2020-2035 is only there if it was
// built locally (public/ephemeris/moons-extra), so its absence is quiet.

import { parseMoonChunk, setMoonChunkLoader } from './moonTables.js';

export function installMoonLoader({ onMiss = false } = {}) {
  setMoonChunkLoader(async (path) => {
    const optional = path.includes('moons-extra/');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
      if (optional && !res.ok) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // A dev server answers a missing file with the app's index.html.
      const buf = await res.arrayBuffer();
      if (optional && new Uint8Array(buf, 0, 1)[0] === 0x3c) return null;
      return parseMoonChunk(buf);
    } catch (err) {
      if (optional) return null;
      console.warn(`moon table ${path} not loaded (${err}); its moons use the mean elements`);
      throw err;
    }
  }, { onMiss });
}
