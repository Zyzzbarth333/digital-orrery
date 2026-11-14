# digital-orrery

A web-based, real-time 3D solar-system simulator with interactive interplanetary mission planning. The physics is plain JavaScript checked against NASA's SPICE toolkit and the DE442 ephemeris; the front end is TypeScript, React and three.js. It draws the Sun, planets and Moon at true scale and at their real positions for any date, propagates spacecraft under n-body gravity with finite burns in a Web Worker, and plans transfers with a Lambert solver and porkchop grids.

The front end is being rebuilt from scratch. It now draws the solar system with real surface maps and relief, Saturn's rings from Cassini measurements, the real star field, and Earth's clouds as satellites saw them on the sim date, under a physically based atmosphere. Spacecraft fly under the n-body kernel: launch into Earth orbit or onto a departure hyperbola, plan manoeuvre nodes, and fly transfers picked from a porkchop grid. The physics modules and their tests are unchanged.

The name nods to the orrery, a mechanical model of the solar system, and in particular to the Digital Orrery, the special-purpose computer built in the 1980s to integrate the long-term dynamics of the outer planets.

## Physics and accuracy

The simulator is honest about where it sits on the fidelity scale. The goal is to move toward and beyond KSP-grade patched-conic-plus-n-body fidelity, and the codebase is being built out to get there rather than claiming to be there already.

What is high-fidelity today:

- **Gravitational parameters** are SPICE-precision GM constants for the Sun and all planets, held in `src/utils/constants.js`.
- **Planetary positions** come from astronomy-engine, which provides JPL-grade ephemerides, so the Sun and planets sit where they actually are for a given date.
- **Spacecraft propagation** runs in a physics kernel (`src/physics/nbody.js`) with no three.js in it, inside a Web Worker (`src/physics/kernel.worker.js`) so sub-stepping never blocks rendering; it falls back to the main thread if a Worker cannot start. Results arrive a frame or so late, so each craft is drawn at its last exact state carried forward to the sim clock along a two-body orbit about its primary, plus the other accelerations to second order. That is within a kilometre in orbit and in cruise; during a close planetary pass at very high warp the drawn position can be off by thousands of km until the next result, while the physics itself is unaffected. Each craft feels the Sun, the eight planets and the Moon at their ephemeris positions throughout every frame, with the heliocentric frame's indirect term. Yoshida's 4th-order composition of leapfrog steps advances it (symplectic at a fixed step). Inside a planet's sphere of influence, while the motion is nearly Keplerian (low orbits), Encke's method takes over: the two-body orbit is followed exactly and only the small deviation from it is integrated, with error control, which in low Earth orbit takes 30 times fewer steps and is 11 times more accurate. Each step is 1% of the shortest local dynamical time, so it sub-steps finely near a planet and coarsely in cruise; there is no error control yet. If a frame needs more steps than its budget, the craft falls behind the clock and catches up, with an on-screen warning, rather than taking steps long enough to pass through a planet. Launches start on the escape hyperbola, 100 planet radii out or at the edge of the sphere of influence if that is closer, with the preset delta-V as the hyperbolic excess speed.
- **Orbital-mechanics core.** `src/physics/orbital.js` provides universal-variable two-body propagation (one code path for ellipses, parabolas and hyperbolas) and a universal-variable Lambert solver with a bracketed root solve. Both are checked against worked examples from Curtis, *Orbital Mechanics for Engineering Students* (4th ed.). Propagation and the state-to-elements conversion are also checked against NAIF CSPICE (`prop2b_c`, `oscltx_c`). SPICE has no Lambert solver, so the Lambert solver is checked on the real MSL launch and arrival geometry from the DE442 ephemeris and on transfer grids flown by an independent numerical integrator. Run the checks with:

  ```bash
  node src/physics/orbital.test.mjs
  ```

What is still approximate:

- The planner's launch-window (porkchop) grid now runs on the verified Lambert solver with astronomy-engine ephemerides, but its Hohmann, "direct" and gravity-assist estimates are still simplified scalings.
- Gravity assists are modelled coarsely and should not be treated as mission-grade.

In short, the constants, ephemerides, n-body integration and the Kepler/Lambert core are solid; the planning UI on top of them is where the remaining approximations live.

## Documentation

[`docs/`](docs/README.md) explains the physics with the maths: frames and time, ephemerides and GM values, two-body propagation, Lambert's problem, the n-body kernel, burns and launches, and a [validation](docs/validation.md) table of every check and its result.

## Accuracy roadmap

The following changes would push fidelity further, roughly in order of impact:

- [x] Wire the Lambert core in `src/physics/orbital.js` into the porkchop delta-V grid so the planner reads directly from the verified solver.
- [ ] Add patched-conic sphere-of-influence transitions so trajectories hand off correctly between central bodies.
- [x] Replace the fixed-step integrator with a higher-order integrator whose step follows the local dynamical time.
- [ ] Add error-controlled adaptive stepping (an embedded Runge-Kutta-Nystrom pair or DOP853) and a two-body fast path for weakly perturbed orbits at high warp.
- [ ] Validate propagated trajectories against SPICE ephemerides using the reference under `python/`.

## Quick start

### Prerequisites

- Node.js 20.19+ (or 22.12+) and npm; Vite 8 needs one of these
- A modern browser with WebGL support

### Install and run

```bash
git clone https://github.com/Zyzzbarth333/digital-orrery.git
cd digital-orrery
npm install
npm run dev
```

`npm run dev` starts the Vite development server. To produce a production build:

```bash
npm run build
```

## Controls

- Drag: rotate the view about the focused body
- Scroll: zoom in and out (the zoom is kept when you move to another body)
- Click a label or a name in the list: fly there (drag, scroll or Esc stops the flight; click the body in view again to reframe it)
- Header: the RUN key runs or holds time; choose a rate (real time to one year per second), or jump back to now with NOW
- Header: FLIGHT shows the selected craft (press it to follow the craft); CONSOLE opens the flight console
- Keys: Space run or pause, ← → step the rate, ↑ ↓ move through the bodies, N jump to now, M flight console, Esc stop a flight or close the console

The data plate gives each value with its source (the provenance column): a solid tag for data, a dashed one for values worked out in the app; hover a tag for detail.

The right-hand plate shows the focused body's data. Missions, the planner and the rocket are the app's, not a body's, so they live in the flight console, opened from the header whatever is in view: MISSION (launch, readout, nodes, engine, log), PLANNER (the porkchop grid and "Fly this") and ROCKET. See [docs/frontend/mission.md](docs/frontend/mission.md).

A link can set the starting view: `?focus=moon&t=2026-03-03T11:33:40Z&view=sun` (`view=sun` puts the camera on the sunlit side).

## Project structure

```
digital-orrery/
├── src/
│   ├── app/                 # React: entry point, sim clock, panels, styles
│   ├── scene/               # three.js scene: body catalogue, renderer, React host
│   ├── physics/             # two-body, Lambert, porkchop, n-body kernel, Worker, ephemeris, GM
│   │   └── fixtures/        # CSPICE reference states (generated by c/)
│   └── utils/constants.js
├── c/                       # CSPICE program that writes the reference fixture
├── python/                  # SPICE metakernel, GM kernel, offline checks
├── docs/                    # the physics and the scene, with the maths, and validation
├── index.html
├── tsconfig.json
└── vite.config.js
```

## Testing

- **Physics core.** Run the Kepler and Lambert verification outside the browser:

  ```bash
  node src/physics/orbital.test.mjs
  ```

  This checks two-body propagation and the elements conversion against Curtis's worked examples and NAIF CSPICE (`src/physics/fixtures/spice_reference.json`, generated by `c/`), and the Lambert solver against the real MSL geometry from DE442 and an independent integrator. After `npm install`, `npm test` also runs `src/physics/porkchop.test.mjs` (astronomy-engine against DE442, and the porkchop grid on the 2011 Mars window) and `src/physics/nbody.test.mjs` (the spacecraft kernel: convergence order, time reversal, energy, the indirect term, events, low Earth orbit with the real Sun, Moon and planets, escape from Earth, and the Worker's message handling).

- **Front end.** `npm run typecheck` checks the TypeScript; `npm run build` builds it.

## Credits

Surface maps, data and imagery: NASA Earth Observatory (Blue Marble, Black Marble); NOAA NCEI (ETOPO 2022); NASA Global Imagery Browse Services (GIBS), part of NASA ESDIS (daily Earth imagery); NASA's Scientific Visualization Studio (CGI Moon Kit, Deep Star Maps 2020; Gaia DR2: ESA/Gaia/DPAC); NASA/JPL, USGS Astrogeology (Viking Mars mosaic); NASA/GSFC MOLA Science Team; NASA/JHUAPL/Carnegie Institution of Washington (MESSENGER); NASA/JHUAPL/SwRI (New Horizons); NASA/JPL/Space Science Institute (Cassini Jupiter map); NASA PDS Ring-Moon Systems Node (Cassini UVIS ring occultation); Solar System Scope, CC BY 4.0 (Venus clouds, Saturn, Uranus and Neptune maps). Ephemerides and frames: NASA JPL / NAIF SPICE (DE442 and the satellite kernels) and astronomy-engine (MIT). Transfer optima for comparison: NASA Ames Research Center, Trajectory Browser (Mission Design Division). Artemis II's reconstructed trajectory: NASA JSC/FOD/NAV, via NAIF. Artemis I's as-flown trajectory: NASA/JSC navigation, via JPL Horizons. 6-DOF check cases: NASA Engineering and Safety Center (NASA/TM-2015-218675). Earth gravity: EGM2008 (NGA), via GFZ ICGEM. Lunar gravity: GRAIL GL0660B (NASA/JPL), via the PDS Geosciences Node. Space weather: CelesTrak (NOAA SWPC, GFZ). Fonts: B612 and B612 Mono (Airbus) and Michroma (Vernon Adams), SIL Open Font License 1.1, via Fontsource. Details in [docs/frontend/textures.md](docs/frontend/textures.md).

## Licence

MIT. See [LICENSE](LICENSE).
