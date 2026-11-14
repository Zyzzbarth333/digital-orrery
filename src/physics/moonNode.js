// src/physics/moonNode.js
//
// The moon tables (moonTables.js) under Node: each system's year is read
// from public/ephemeris/moons the first time anything asks for a moon there,
// synchronously, so tests and validation scripts see JPL's satellite
// ephemerides as the app does once a year has loaded. deNode.js imports it.

import { existsSync, readFileSync } from 'node:fs';
import { parseMoonChunk, setMoonChunkLoader } from './moonTables.js';

setMoonChunkLoader((system, year) => {
  const url = new URL(`../../public/ephemeris/moons/${system}-${year}.bin`, import.meta.url);
  if (!existsSync(url)) return null;
  const buf = readFileSync(url);
  return parseMoonChunk(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}, { onMiss: true });
