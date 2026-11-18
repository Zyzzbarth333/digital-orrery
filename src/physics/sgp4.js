// src/physics/sgp4.js
//
// The two parts of satellite.js (MIT, pinned at 7.1.0 in package.json) that
// satellites.js uses: the OMM reader and SGP4/SDP4 itself.
//
// Imported by the package's name, so it resolves from any checkout (a git
// worktree has no node_modules of its own; Node and Vite find the
// repository's by walking up). The package's index also exports a
// WebAssembly build whose top-level await the workers' bundle can't hold,
// and which the app has no use for: in Node (the tests) that costs nothing,
// and in the app's bundles vite.config.js's satelliteLite plugin serves this
// specifier as just the two files these come from (dist/io.js and
// dist/propagation/sgp4.js, as in 7.1.0: check them when the version
// changes).

export { json2satrec, sgp4 } from 'satellite.js';
