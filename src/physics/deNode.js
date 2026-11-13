// src/physics/deNode.js
//
// Installs the DE442 Earth-Moon table (deTable.js) under Node, synchronously,
// so tests and validation scripts see the same Earth and Moon as the app.
// Import it first:  import './deNode.js';

import { readFileSync } from 'node:fs';
import { parseDeTable, installDeTable } from './deTable.js';
import { installSpaceWeather } from './spaceWeather.js';

const buf = readFileSync(new URL('../../public/ephemeris/de442-earth-moon-2000-2050.bin', import.meta.url));
installDeTable(parseDeTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
// The Sun's activity by date, for the upper atmosphere (spaceWeather.js).
installSpaceWeather(JSON.parse(readFileSync(new URL('../../public/data/spaceweather.json', import.meta.url), 'utf8')));
