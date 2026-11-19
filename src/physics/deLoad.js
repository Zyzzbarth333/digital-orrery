// src/physics/deLoad.js
//
// Fetches and installs the DE442 table (deTable.js), SB441's asteroids
// (sbTable.js), the Earth's orientation parameters (eop.js) and the space
// weather in a browser thread: the main thread before the app starts, and
// each worker before its first job. The work is dataLoad.js's
// loadEphemerides, handed the site's files through fetch; a table that
// cannot be fetched is left out, and the console says so.

import { loadEphemerides } from './dataLoad.js';
import { fetchLoader } from './fetchData.js';

export const loadDeTable = () => loadEphemerides(fetchLoader(import.meta.env.BASE_URL));
