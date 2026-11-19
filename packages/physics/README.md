# @digital-orrery/physics

The orrery's physics, as an npm workspace: the ephemerides (DE442 and
astronomy-engine), the n-body kernel, moons, orientation, the space
environment, rockets, journeys and satellites. It is plain JavaScript with
no three.js and no DOM, so it runs in the browser and under Node.

It is **not published**, and its interface is not frozen: modules are
imported by path, and any of them may change with the app
([ADR-0001](../../docs/adr/0001-data-physics-and-boundaries.md)).

```js
import { helioStateEqj } from '@digital-orrery/physics/ephemeris.js';
```

**Data.** The tables come in through a loader the physics is handed
(`src/dataLoad.js`). Under Node, `import '@digital-orrery/physics/deNode.js'`
first reads them from this repository's `public/` (run `npm run data`).
The browser's loader (through `fetch`), the kernel's Worker and its client
live in the app, in `src/browser/`.

**Tests.** Each `src/*.test.mjs` runs on its own (`node
packages/physics/src/orbital.test.mjs`), and `npm test` at the root runs
them all. The reference data they check against is in `src/fixtures/`.
[Validation](../../docs/validation.md) gives the results, and `npm run
golden` checks that a change meant to alter nothing alters nothing.
