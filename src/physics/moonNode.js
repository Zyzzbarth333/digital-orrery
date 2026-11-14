// src/physics/moonNode.js
//
// The moon tables (moonTables.js) under Node: each system's year is read
// from public/ephemeris/ the first time anything asks for a moon there,
// synchronously, so tests and validation scripts see JPL's satellite
// ephemerides as the app does once a year has loaded. A file that is not
// there (an inner moon's year outside 2020-2035 that has not been built)
// leaves those moons to the mean elements. deNode.js imports it.

import { existsSync, readFileSync } from 'node:fs';
import { parseMoonChunk, setMoonChunkLoader } from './moonTables.js';

setMoonChunkLoader((path) => {
  const url = new URL(`../../public/${path}`, import.meta.url);
  if (!existsSync(url)) return null;
  const buf = readFileSync(url);
  return parseMoonChunk(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}, { onMiss: true });
