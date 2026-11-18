# digital-orrery

[![CI](https://github.com/Zyzzbarth333/digital-orrery/actions/workflows/ci.yml/badge.svg)](https://github.com/Zyzzbarth333/digital-orrery/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

A true-scale solar system and mission simulator that runs in the browser. The physics is plain JavaScript, checked against NASA's SPICE toolkit, JPL's DE442 and satellite ephemerides, and flown missions. The front end is TypeScript, React and three.js.

<picture>
  <source srcset="docs/clips/overview-to-earth.webp" type="image/webp">
  <img src="docs/clips/overview-to-earth.gif" width="800" alt="The camera flies from the inner solar system, with the planets' orbits and the main belt drawn from real orbits, down to the Earth under that day's clouds, and the console's data plate changes from the Sun to the Earth">
</picture>

| | |
| --- | --- |
| ![Saturn with its rings from Cassini measurements and its moons' orbits](docs/images/saturn.jpg) | ![The Earth from the sunlit side, with its atmosphere, over Australia](docs/images/earth.jpg) |
| **Saturn**, its rings from Cassini's occultations, and its moons' orbits | **The Earth** over Australia, under a scattering atmosphere |
| ![The plotting table: an Earth to Mars journey with its window strip and delta-v ledger](docs/images/plotting-table.jpg) | ![The rail's guides: Jupiter's Lagrange points and the planets' spheres of influence](docs/images/guides.jpg) |
| **The plotting table**: a journey to Mars, its launch windows and its delta-v | **Guides**: spheres of influence and Lagrange points, with Jupiter's trojans at L4 and L5 |
| ![The ROCKET tab with Saturn V's published figures greyed](docs/images/rocket.jpg) | ![Jupiter and its inner moons' orbits](docs/images/jupiter.jpg) |
| **The ROCKET tab**: Saturn V from Apollo 11's actual weights | **Jupiter** and its moons, from JPL's satellite ephemerides |

In motion (each clip is from the app as it runs, rebuilt by `npm run docs:clips`):

| | |
| --- | --- |
| ![Time warp at 30 days a second: Mercury, Venus, Earth and Mars go round the Sun while the clock races through five months](docs/clips/time-warp.webp) | ![Artemis II at a day a second about the Earth: the craft leaves after translunar injection, loops round the Moon and comes back, its flown path drawn beside NASA's](docs/clips/artemis2.webp) |
| **Time warp**: a month a second ([scene](docs/frontend/scene.md#time)) | **Artemis II** flown against its real trajectory ([missions](docs/frontend/mission.md#real-missions)) |
| ![The plotting table: a burn node clicked onto the transfer arc to Mars, its radial tab pulled until the MISS lamp lights, then AIM NODE brings the arc back to Mars](docs/clips/plotting-table.webp) | ![The ROCKET tab flies Saturn V's ascent, then launches it from the pad and follows it climbing away from Florida](docs/clips/rocket-launch.webp) |
| **The plotting table**: a burn node pulled and re-aimed ([journeys](docs/physics/journey.md#the-plotting-table)) | **A launch** from LC-39B ([rockets](docs/physics/rocket.md#in-the-app)) |
| ![The Earth's EGM2008 gravity field and spin axis as the camera turns, then the Earth's sphere of influence and the Earth-Moon Lagrange points as it pulls back](docs/clips/guides.webp) | ![Jupiter's inner and Galilean moons going round at a day a second, then the camera flies to Io](docs/clips/jupiter-moons.webp) |
| **Guides**: the gravity field, then SOI and Lagrange points ([gravity guides](docs/physics/gravity-guides.md)) | **Jupiter's moons** and a flight to Io ([moons](docs/frontend/moons.md)) |

New to the terms? The [glossary](docs/glossary.md) explains them, and [How it fits together](docs/architecture.md) maps the code.

## What it does

- **The sky:**
  - the Sun, planets, 76 moons and 135,353 asteroids and comets, at their real positions for any date, at true scale;
  - 16,892 Earth satellites from CelesTrak's element sets, moved by SGP4, with the ISS, Tiangong, Hubble, GPS, Galileo and the weather satellites' orbits;
  - real surface maps and relief, Saturn's rings from Cassini measurements, Earth's clouds as satellites saw them that day under a physically based atmosphere;
  - the real star field and Milky Way.
- **Bodies to visit:** fly the camera to any planet, moon, barycentre, small body or Earth satellite, with a data plate whose values open their equation and source.
- **Guides:** spin axes, Earth's and the Moon's real gravity fields, spheres of influence, Lagrange points and the strongest pulls; the planets' magnetic fields as traced field lines (IGRF-14, JRM33, Cassini, Voyager), and the auroras: the Earth's ovals for the day's Kp, Jupiter's and Saturn's main ovals and Io's footprint.
- **Missions:**
  - spacecraft fly under an n-body kernel in a Web Worker, with finite burns, the Earth's and Moon's gravity fields, drag and sunlight pressure;
  - the craft you launch carry an attitude: point them prograde, normal, radial, at a node or hold them still, and they turn in the time their thrusters' torque allows, under the gravity gradient and the air's torque, and burn along their body axis ([docs/physics/sixdof.md](docs/physics/sixdof.md#attitude-in-the-app));
  - Artemis I and II fly against NASA's reconstructed trajectories, down to Orion's entry and splashdown.
- **Planning:**
  - a journey of any number of legs, each leg's transfers compared (a broken plane where a leg runs nearly 180° round the Sun), shaped by hand on a plotting table;
  - flown by the kernel, with the rocket it needs.
- **Rockets:** build a launch vehicle stage by stage, or start from Saturn V, Falcon 9 or Electron, or open an OpenRocket design, and fly it from a real pad into orbit.

The name nods to the orrery, a mechanical model of the solar system, and in particular to the Digital Orrery, the special-purpose computer built in the 1980s to integrate the long-term dynamics of the outer planets.

## Physics and accuracy

The physics is checked against references, and each model's page says how and how well. [Physics and accuracy](docs/accuracy.md) gives the whole picture and what is still approximate; [validation](docs/validation.md) lists every check with its result.

- **Where things are:** the planets from JPL's DE442 (2000–2050) to within a metre, 76 moons from JPL's satellite ephemerides to within a kilometre, and SPICE-precision GM values.
- **How craft move:** an n-body kernel in a Web Worker, with error-controlled Dormand–Prince steps and Encke's method near a planet. It includes the major moons with their $J_2$ and $C_{22}$, the heaviest asteroids, the Earth's and Moon's gravity fields, drag and sunlight pressure. It is checked against Artemis I and II, and against Juno's and Cassini's moon flybys, followed to within 0.1 km hours on.
- **The orbital core:** two-body propagation and Lambert's problem, checked against Curtis's worked examples and NAIF CSPICE.
- **Still approximate:** journeys are planned by patched conics (then flown in the full model), and the ROCKET tab's ascent has no closed-loop guidance.

## Documentation

| Read | For |
| --- | --- |
| [docs/](docs/README.md) | every page: the physics with its maths, the front end, performance |
| [Physics and accuracy](docs/accuracy.md) | what is high-fidelity, what is approximate, and the roadmap |
| [Validation](docs/validation.md) | every check, its reference and its result |
| [How it fits together](docs/architecture.md) | the code's layers, a diagram, and the project's folders |
| [Glossary](docs/glossary.md) | the terms |
| [Credits](docs/credits.md) | every data source, map, font and library, with its licence |

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

## Testing

```bash
npm test            # every physics and app check, from fixtures, no network
npm run typecheck   # the TypeScript
npm run build       # the production build
```

`npm test` runs each module's checks against its references, from Curtis's worked examples and NAIF CSPICE to flown missions. [docs/validation.md](docs/validation.md) lists every check with its reference and result. CI runs all three commands on every pull request.

## Credits

The app is built on public data: JPL's DE442, satellite ephemerides and Small-Body Database; NAIF's SPICE kernels; NASA, USGS and ESA maps and star catalogues; Solar System Scope's planet maps ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)); NOAA's relief; CelesTrak's element sets; and NASA's and JPL's mission trajectories. [docs/credits.md](docs/credits.md) credits every source, map, font and library, with a link to each and its licence.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the ground rules (every physics claim checked against a cited reference, and data credited with its licence) and how changes are merged. [CHANGELOG.md](CHANGELOG.md) lists what has changed. Report security problems privately, as [SECURITY.md](SECURITY.md) says.

## Citing

If you use it in your work, please cite it: [CITATION.cff](CITATION.cff) has the details, and GitHub's "Cite this repository" gives them as text.

## Licence

MIT. See [LICENSE](LICENSE). The data and maps keep their own licences, listed in [docs/credits.md](docs/credits.md).
