# digital-orrery

[![CI](https://github.com/Zyzzbarth333/digital-orrery/actions/workflows/ci.yml/badge.svg)](https://github.com/Zyzzbarth333/digital-orrery/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

A true-scale solar system and mission simulator that runs in the browser. The physics is plain JavaScript, checked against NASA's SPICE toolkit, JPL's DE442 and satellite ephemerides, and flown missions. The front end is TypeScript, React and three.js.

## What it does

- **The sky:**
  - the Sun, planets, 76 moons and 135,353 asteroids and comets, at their real positions for any date, at true scale;
  - real surface maps and relief, Saturn's rings from Cassini measurements, Earth's clouds as satellites saw them that day under a physically based atmosphere;
  - the real star field and Milky Way.
- **Bodies to visit:** fly the camera to any planet, moon, barycentre or small body, with a data plate whose values open their equation and source.
- **Guides:** spin axes, Earth's and the Moon's real gravity fields, spheres of influence, Lagrange points and the strongest pulls.
- **Missions:**
  - spacecraft fly under an n-body kernel in a Web Worker, with finite burns, the Earth's and Moon's gravity fields, drag and sunlight pressure;
  - Artemis I and II fly against NASA's reconstructed trajectories, down to Orion's entry and splashdown.
- **Planning:**
  - a journey of any number of legs, each leg's transfers compared, shaped by hand on a plotting table;
  - flown by the kernel, with the rocket it needs.
- **Rockets:** build a launch vehicle stage by stage, or start from Saturn V, Falcon 9 or Electron, or open an OpenRocket design, and fly it from a real pad into orbit.

The name nods to the orrery, a mechanical model of the solar system, and in particular to the Digital Orrery, the special-purpose computer built in the 1980s to integrate the long-term dynamics of the outer planets.

## Physics and accuracy

The simulator is honest about where it sits on the fidelity scale. The goal is to move toward and beyond KSP-grade patched-conic-plus-n-body fidelity, and the codebase is being built out to get there rather than claiming to be there already.

What is high-fidelity today:

- **Gravitational parameters** are SPICE-precision GM constants for the Sun and all planets, held in `src/utils/constants.js`.
- **Planetary positions** come from JPL's DE442 for 2000–2050, through a Chebyshev table within a metre of it ([docs/physics/ephemerides-and-gm.md](docs/physics/ephemerides-and-gm.md#de442-in-the-app)), and from astronomy-engine outside those years, so the Sun and planets sit where they actually are for a given date.
- **Moons.** Seventy-six moons of Mars to Pluto (the twenty major moons; Jupiter's four inner moons; Saturn's ring, co-orbital and small moons, Hyperion and Phoebe; Uranus's fourteen inner and ten irregular moons; Neptune's seven inner moons and Nereid; Pluto's four small ones), are drawn at their real sizes about their planets, fourteen of them with USGS global mosaics. From 2000 to 2049 they come from those ephemerides as compact Chebyshev tables, within 1 km, loaded a system and a year at a time (the 29 inner moons for 2020–2035 from the repo, their other years with `npm run build:moon-tables`); outside, from astronomy-engine and JPL's mean elements. Near its planet each major moon pulls on spacecraft ([docs/frontend/moons.md](docs/frontend/moons.md)).
- **Spacecraft propagation** runs in a physics kernel (`src/physics/nbody.js`) with no three.js in it, inside a Web Worker (`src/physics/kernel.worker.js`) so sub-stepping never blocks rendering; it falls back to the main thread if a Worker cannot start. Results arrive a frame or so late, so each craft is drawn at its last exact state carried forward to the sim clock along a two-body orbit about its primary, plus the other accelerations to second order. That is within a kilometre in orbit and in cruise; during a close planetary pass at very high warp the drawn position can be off by thousands of km until the next result, while the physics itself is unaffected. Each craft feels the Sun, the eight planets and the Moon at their ephemeris positions throughout every frame, with the heliocentric frame's indirect term. Yoshida's 4th-order composition of leapfrog steps advances it (symplectic at a fixed step). Inside a planet's sphere of influence, while the motion is nearly Keplerian (low orbits), Encke's method takes over: the two-body orbit is followed exactly and only the small deviation from it is integrated, with error control, which in low Earth orbit takes 30 times fewer steps and is 11 times more accurate. Each step is 1% of the shortest local dynamical time, so it sub-steps finely near a planet and coarsely in cruise; there is no error control yet. If a frame needs more steps than its budget, the craft falls behind the clock and catches up, with an on-screen warning, rather than taking steps long enough to pass through a planet. Launches start on the escape hyperbola, 100 planet radii out or at the edge of the sphere of influence if that is closer, with the preset delta-V as the hyperbolic excess speed.
- **Orbital-mechanics core.** `src/physics/orbital.js` provides universal-variable two-body propagation (one code path for ellipses, parabolas and hyperbolas) and a universal-variable Lambert solver with a bracketed root solve. Both are checked against worked examples from Curtis, *Orbital Mechanics for Engineering Students* (4th ed.). Propagation and the state-to-elements conversion are also checked against NAIF CSPICE (`prop2b_c`, `oscltx_c`). SPICE has no Lambert solver, so the Lambert solver is checked on the real MSL launch and arrival geometry from the DE442 ephemeris and on transfer grids flown by an independent numerical integrator. Run the checks with:

  ```bash
  node src/physics/orbital.test.mjs
  ```

What is still approximate:

- **Journeys are planned by patched conics.** Each leg uses the verified Lambert solver, and flybys a B-plane aim. The kernel then flies the plan and reports how close it comes to each waypoint. Landings and moon-to-planet legs are planned but not yet flown.
- **The ascent has no closed-loop guidance.** The ROCKET tab's gravity turn ends its orbits higher than real launches, which are steered ([docs/physics/rocket.md](docs/physics/rocket.md#real-launchers)).

In short, the constants, ephemerides, n-body integration and the Kepler/Lambert core are checked against references. The planning layers on top of them are where the remaining approximations live, and each says so in its docs.

## Documentation

[`docs/`](docs/README.md) explains the physics with the maths: frames and time, ephemerides and GM values, two-body propagation, Lambert's problem, the n-body kernel, burns and launches, and a [validation](docs/validation.md) table of every check and its result.

## Accuracy roadmap

The following changes would push fidelity further, roughly in order of impact:

- [x] Wire the Lambert core in `src/physics/orbital.js` into the porkchop delta-V grid so the planner reads directly from the verified solver.
- [ ] Add patched-conic sphere-of-influence transitions so trajectories hand off correctly between central bodies.
- [x] Replace the fixed-step integrator with a higher-order integrator whose step follows the local dynamical time.
- [ ] Add error-controlled adaptive stepping (an embedded Runge-Kutta-Nystrom pair or DOP853) and a two-body fast path for weakly perturbed orbits at high warp.
- [x] Validate propagated trajectories against flown missions: Artemis I and II against NASA's reconstructed trajectories ([validation](docs/validation.md)).

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

The right-hand plate shows the focused body's data. Missions, the planner and the rocket are the app's, not a body's, so they live in the flight console, opened from the header whatever is in view: MISSION (launch, readout, nodes, engine, log), PLANNER (a journey's summary, and the full-screen plotting table for planning it) and ROCKET. See [docs/frontend/mission.md](docs/frontend/mission.md).

A link can set the starting view: `?focus=moon&t=2026-03-03T11:33:40Z&view=sun` (`view=sun` puts the camera on the sunlit side).

## Project structure

```
digital-orrery/
├── src/
│   ├── app/                 # React: the console, panels, planner, rocket, clock, styles
│   ├── scene/               # three.js: bodies, sky, orbits, small bodies, guides, camera
│   ├── physics/             # orbital core, n-body kernel and Worker, ephemerides, moons,
│   │   │                    #   orientation, environment, rocket, journeys, and their tests
│   │   └── fixtures/        # reference data the tests check against (CSPICE, Horizons, NASA)
│   └── utils/constants.js
├── public/                  # surface maps, star map, ephemeris and small-body tables
├── c/                       # CSPICE programs that write fixtures and the moon tables
├── python/                  # SPICE metakernel, kernels (downloaded, not in git), offline checks
├── tools/                   # outside oracles (OpenRocket, RocketPy)
├── docs/                    # the physics and the front end, with the maths, and validation
└── .github/                 # CI, issue and pull request templates
```

## Testing

```bash
npm test            # every physics and app check, from fixtures, no network
npm run typecheck   # the TypeScript
npm run build       # the production build
```

`npm test` runs each module's checks against its references:
- the orbital core against Curtis's worked examples and NAIF CSPICE;
- the ephemerides against DE442 and JPL Horizons;
- the n-body kernel's convergence, energy and events;
- NASA's 6-DOF check cases;
- the ROCKET tab against OpenRocket and RocketPy;
- Artemis I and II against their flown trajectories;
- the moons, asteroids, orientation and more.

[docs/validation.md](docs/validation.md) lists every check with its reference and result. CI runs all three commands on every pull request.

## Credits

Surface maps, data and imagery: NASA Earth Observatory (Blue Marble, Black Marble); NOAA NCEI (ETOPO 2022); NASA Global Imagery Browse Services (GIBS), part of NASA ESDIS (daily Earth imagery); NASA's Scientific Visualization Studio (CGI Moon Kit; Deep Star Maps 2020, the Milky Way layer; Gaia DR2: ESA/Gaia/DPAC); the Hipparcos Catalogue, ESA 1997 (ESA SP-1200), via NASA HEASARC (the stars); NASA/JPL, USGS Astrogeology (Viking Mars mosaic; the moons' Viking, Galileo, Voyager and Cassini mosaics, Cassini's with the Space Science Institute, Deimos's by Philip Stooke); NASA/GSFC MOLA Science Team; NASA/JHUAPL/Carnegie Institution of Washington (MESSENGER); NASA/JHUAPL/SwRI (New Horizons, Pluto and Charon); NASA/JPL/Space Science Institute (Cassini Jupiter map); NASA PDS Ring-Moon Systems Node (Cassini UVIS ring occultation); [Solar System Scope](https://www.solarsystemscope.com/textures/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (Venus clouds, Saturn, Uranus and Neptune maps). Ephemerides and frames: NASA JPL / NAIF SPICE (DE442 and the satellite kernels) and astronomy-engine (MIT). Moons: JPL Solar System Dynamics planetary satellite mean elements and JPL Horizons (orbits, radii, GMs, albedos); astronomy-engine for the Galilean moons. Transfer optima for comparison: NASA Ames Research Center, Trajectory Browser (Mission Design Division). Artemis II's reconstructed trajectory: NASA JSC/FOD/NAV, via NAIF. Artemis I's as-flown trajectory: NASA/JSC navigation, via JPL Horizons. 6-DOF check cases: NASA Engineering and Safety Center (NASA/TM-2015-218675). Earth gravity: EGM2008 (NGA), via GFZ ICGEM. Lunar gravity: GRAIL GL0660B (NASA/JPL), via the PDS Geosciences Node. Space weather: CelesTrak (NOAA SWPC, GFZ). Fonts: B612 and B612 Mono (Airbus) and Michroma (Vernon Adams), SIL Open Font License 1.1, via Fontsource. Equation font: DejaVu Math TeX Gyre (DejaVu fonts), Bitstream Vera licence, its DejaVu and math additions public domain ([src/app/fonts](src/app/fonts/LICENSE-DejaVuMath.txt)). Details in [docs/frontend/textures.md](docs/frontend/textures.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the ground rules (every physics claim checked against a cited reference, and data credited with its licence) and how changes are merged. [CHANGELOG.md](CHANGELOG.md) lists what has changed. Report security problems privately, as [SECURITY.md](SECURITY.md) says.

## Citing

If you use it in your work, please cite it: [CITATION.cff](CITATION.cff) has the details, and GitHub's "Cite this repository" gives them as text.

## Licence

MIT. See [LICENSE](LICENSE). The data and maps keep their own licences, listed under Credits.
