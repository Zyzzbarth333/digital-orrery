// src/physics/sgp4.js
//
// The two parts of satellite.js (MIT, pinned at 7.1.0 in package.json) that
// satellites.js uses: the OMM reader and SGP4/SDP4 itself. They are taken
// from the package's own files by path, because its index also exports a
// WebAssembly build whose top-level await the workers' bundle can't hold,
// and which the app has no use for. The paths are those of 7.1.0: check
// them when the version changes.

export { json2satrec } from '../../node_modules/satellite.js/dist/io.js';
export { sgp4 } from '../../node_modules/satellite.js/dist/propagation/sgp4.js';
