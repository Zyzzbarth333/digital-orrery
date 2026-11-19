// src/physics/moonLoad.js
//
// The moon tables (moonTables.js) in a browser thread: fetched a system and
// a year at a time. The main thread asks for the systems in view
// (wantMoonTables, from the scene); the kernel's worker asks for any it
// needs (onMiss), which is only a system a craft is near. The work is
// dataLoad.js's installMoonTables, handed the site's files through fetch.

import { installMoonTables } from './dataLoad.js';
import { fetchLoader } from './fetchData.js';

/** @param {{ onMiss?: boolean }} [opts] */
export function installMoonLoader({ onMiss = false } = {}) {
  installMoonTables(fetchLoader(import.meta.env.BASE_URL), { onMiss });
}
