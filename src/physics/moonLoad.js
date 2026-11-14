// src/physics/moonLoad.js
//
// The moon tables (moonTables.js) in a browser thread: fetched a system and
// a year at a time. The main thread asks for the systems in view
// (wantMoonTables, from the scene); the kernel's worker asks for any it
// needs (onMiss), which is only a system a craft is near. Until a year
// arrives, and if it cannot be fetched, the moons there come from the mean
// elements.

import { parseMoonChunk, setMoonChunkLoader } from './moonTables.js';

export function installMoonLoader({ onMiss = false } = {}) {
  setMoonChunkLoader(async (system, year) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}ephemeris/moons/${system}-${year}.bin`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseMoonChunk(await res.arrayBuffer());
    } catch (err) {
      console.warn(`moon table ${system} ${year} not loaded (${err}); its moons use the mean elements`);
      throw err;
    }
  }, { onMiss });
}
