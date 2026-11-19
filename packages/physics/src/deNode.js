// packages/physics/src/deNode.js
//
// Installs the DE442 table (deTable.js), SB441's asteroids (sbTable.js),
// the Earth's orientation parameters (eop.js) and the space weather under
// Node, synchronously, so tests and validation scripts see the same bodies
// as the app. The work is dataLoad.js's installEphemerides, handed the
// files in public/ (nodeData.js); a missing file throws.
// Import it first:  import './deNode.js';

// The moons' satellite-ephemeris tables, read as they are needed.
import './moonNode.js';
import { installEphemerides } from './dataLoad.js';
import { nodeLoader } from './nodeData.js';

installEphemerides(nodeLoader);
