// src/physics/deNode.js
//
// Installs the DE442 table (deTable.js) and the Earth's orientation
// parameters (eop.js) under Node, synchronously, so tests and validation
// scripts see the same bodies as the app.
// Import it first:  import './deNode.js';

import { readFileSync } from 'node:fs';
import { parseDeTable, installDeTable } from './deTable.js';
import { installSpaceWeather } from './spaceWeather.js';
import { parseEop, installEop } from './eop.js';
// The moons' satellite-ephemeris tables, read as they are needed.
import './moonNode.js';

const buf = readFileSync(new URL('../../public/ephemeris/de442-2000-2050.bin', import.meta.url));
installDeTable(parseDeTable(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
const eop = readFileSync(new URL('../../public/ephemeris/earth-orientation-2000-2126.bin', import.meta.url));
installEop(parseEop(eop.buffer.slice(eop.byteOffset, eop.byteOffset + eop.byteLength)));
// The Sun's activity by date, for the upper atmosphere (spaceWeather.js).
installSpaceWeather(JSON.parse(readFileSync(new URL('../../public/data/spaceweather.json', import.meta.url), 'utf8')));
