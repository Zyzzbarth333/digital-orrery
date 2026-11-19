# digital-orrery documentation

How the simulator works, with the maths, the constants the code uses, where
they come from, and how each part is checked.

- **New here?** [How it fits together](architecture.md) maps the code with a diagram, and the [glossary](glossary.md) explains the terms.
- **How good is it?** [Physics and accuracy](accuracy.md) says what is high-fidelity and what is still approximate; the [roadmap](roadmap.md) says what comes next; [validation](validation.md) has every check.
- **Credits:** [every data source, map, font and library](credits.md), with its licence.
- **Pictures:** the [README](../README.md) has screenshots of each part of the app, and short clips of it running. The clips live in `docs/clips/` as animated WebP; `npm run build && npm run docs:clips` films them again from the app when its interface changes (it needs ffmpeg and Playwright's Chromium).

## Physics

| Page | Covers |
| --- | --- |
| [Frames, units and time](physics/frames-and-time.md) | J2000 equatorial and ecliptic frames, the scene mapping, heliocentric vs barycentric, time scales |
| [Ephemerides, barycentres and GM](physics/ephemerides-and-gm.md) | DE442 and the satellite kernels, load order, DE442 vs DE440, which GM goes with which position |
| [Two-body propagation and elements](physics/two-body.md) | Universal variables, Stumpff functions, the bracketed root solve, Lagrange coefficients, state to elements |
| [Lambert's problem](physics/lambert.md) | Universal-variable Lambert, the zero-revolution branch, bracketing for transfers over 180° |
| [The n-body kernel](physics/nbody-kernel.md) | Force model and indirect term, leapfrog and Yoshida, step size, budget, events, Hermite interpolation, the Web Worker and drawing |
| [Burns, launches and the porkchop](physics/burns-and-launch.md) | Finite burns and the rocket equation, manoeuvre nodes, the departure hyperbola, C3 and porkchop grids |
| [Body orientation](physics/orientation.md) | Body-fixed frames, Earth's rotation, the IAU pole and prime-meridian model, checks against CSPICE |
| [Magnetic fields and auroras](physics/magnetic-fields.md) | The planets' magnetic fields (IGRF-14 with Tsyganenko's T89 magnetosphere, JRM33 with the con2020 current sheet, Cassini 11 with its ring current, Voyager's offset tilted dipoles), MESSENGER's for Mercury, Ganymede's inside Jupiter's field and the Sun's from the Wilcox Solar Observatory, as traced field lines; magnetopauses and bow shocks; the Sun's current sheet and Parker spiral; the Earth's auroras from NOAA's live OVATION Prime map near now, and from Starkov's model and the day's Kp otherwise; Jupiter's and Saturn's main ovals, Io's footprint, Uranus's and Neptune's zones; the radiation belts along their L-shells |
| [Gravity guides](physics/gravity-guides.md) | Spin axes, Earth's and the Moon's real gravity fields (EGM2008, GRAIL) as anomaly maps, spheres of influence and Hill spheres, Lagrange points, the strongest pulls on a body |
| [A 6-DOF vehicle in Earth orbit](physics/sixdof.md) | Rigid-body attitude, the Earth's gravity field to any degree, Earth rotation (IAU 1976/1980), drag and thrust, NASA's 6-DOF check cases; the app's craft attitude, its controller and burns along the body axis |
| [The space environment](physics/environment.md) | Forces beyond gravity's point masses and J2 on the app's craft: the Earth's, the Moon's, Mercury's and Venus's gravity fields; sunlight pressure with the Earth's and Moon's shadows, and the steps across a shadow's edge |
| [Rockets: stages, staging and the ascent](physics/rocket.md) | The ROCKET tab: stage performance, optimal staging (Curtis 13.6), delta-v budgets worked back from a job, a gravity-turn ascent from a pad into orbit; thrust curves and drag against Mach, checked against OpenRocket and RocketPy; OpenRocket design files flown in the app |
| [Journeys: legs, transfers, flybys and the rocket](physics/journey.md) | A journey of any number of legs by patched conics, each leg's transfers compared (Hohmann, bi-elliptic, plane change, Lambert, the porkchop optimum, phasing, gravity assists and the B-plane), flown by the kernel to each waypoint, and the stack of stages it needs |
| [Atmospheric entry](physics/entry.md) | Orion's lifting entry, its guidance to the splashdown point, and the parachutes |

## Front end

| Page | Covers |
| --- | --- |
| [The 3D scene](frontend/scene.md) | True scale, the render frame, the floating origin, camera, orbit lines, time |
| [Camera](frontend/camera.md) | The orbit camera, flights on van Wijk and Nuij's zoom-and-pan path, interrupting and redirecting them, zoom kept between bodies |
| [Lighting](frontend/lighting.md) | Inverse-square sunlight and exposure, HDR and tone mapping, the Sun's disc and glare, bloom, point stars and adaptation, albedo and scattering laws, eclipses, ring photometry |
| [The phone layout](frontend/phone.md) | The sky full-screen under a slim band; one sheet with peek, half and full stops (or a side sheet on a short touch screen), its drag, fling and Back; the peek's two sourced values by kind; the camera's offset above the sheet |
| [Source tags](frontend/source-tags.md) | What each readout's tag opens: the value, its equation and its source; how it behaves, its accessibility, the MathML typesetting, and every reference the tags cite |
| [Missions](frontend/mission.md) | The craft model, launches, manoeuvre nodes, the readout and its tags, the porkchop planner |
| [Moons](frontend/moons.md) | Seventy-six moons of Mars to Pluto: JPL's satellite ephemerides as per-year Chebyshev tables (2000–2049, within 1 km), loaded lazily; astronomy-engine and JPL's mean elements outside; planets drawn at their centres; the errors against Horizons; the 381 irregular moons of Jupiter, Saturn and Neptune as a layer |
| [Landing sites](frontend/landing-sites.md) | Every landing on the Moon from Luna 9 to Blue Ghost, the rovers' last places and the crashes LROC found, from the LROC team's measured coordinates, checked against SPICE's MOON_ME; and 37 more on Mars, Venus, Mercury, Titan, Jupiter, Saturn, Eros, Ryugu and Bennu, from NSSDCA, the PDS and the missions; drawn on each surface, flown to and framed from low over the ground |
| [Barycentres and the SSB frame](frontend/barycentres.md) | The solar system's, Earth-Moon and each planet system's barycentre to fly to, orbits and distances about the SSB, checked against Horizons |
| [Asteroids and comets](frontend/small-bodies.md) | 135,353 small bodies from JPL's SBDB drawn by the GPU, the named ones, how right they are |
| [Spacecraft beyond Earth orbit](frontend/spacecraft.md) | Orbiters of Mercury, the Moon, Mars and Jupiter, L1 and L2 observatories and probes in cruise from JPL Horizons, held within 2 km by blended Kepler arcs; reconstructed or predicted; checked against held-out Horizons states |
| [Earth satellites](frontend/satellites.md) | 16,892 active satellites from CelesTrak's GP elements, SGP4 via satellite.js, TEME to J2000, the GPU's points, the named ones' orbits, search and data plate; checked against Vallado's verification set and Horizons |
| [Atmospheres](frontend/atmospheres.md) | Rayleigh, Mie and ozone single scattering along the view ray, sunlight reddening on the ground, checks |
| [Surface maps, rings, stars and daily Earth](frontend/textures.md) | Every source and its credit, map layout, relief from elevation, night lights, GIBS daily imagery, the Cassini ring profile, the star map |
| [The other planets' rings](frontend/rings.md) | Jupiter's, Uranus's and Neptune's rings from occultations and ring tables: orbits, arcs, dust and forward scattering, and drawing rings narrower than a pixel |

## Usability

[UX review](ux/review.md): personas, scenarios and a heuristic evaluation of the console, with what was fixed.
[Accessibility audit](ux/accessibility.md): the console against WCAG 2.2 AA, each finding with its criterion, fix and status.
[Think-aloud test kit](ux/think-aloud/README.md): scenarios, script, consent and recording sheet for testing with people.
[UX research](ux/research.md) and the [overhaul plan](ux/overhaul-plan.md): what space-sim and planetarium UIs, panel design, camera navigation, sky rendering and WebGL performance research say, and the November 2026 overhaul built on it.

## Checks and performance

[Validation](validation.md): every check, its reference and the measured
result. The flown missions in detail: [Artemis I](validation/artemis1.md),
[Artemis II](validation/artemis2.md),
[Juno 2012–13](validation/juno2013.md), [DART](validation/dart.md),
[LRO](validation/lro.md) and [MESSENGER](validation/messenger.md). [Performance](performance.md): what each part costs and the plan
for the slow parts.

## Background

[ADR-0001: a hosted site, data out of git, and tidier boundaries](adr/0001-data-physics-and-boundaries.md): the decision on how the repository is split.

[ADR-0002 (proposed): a streamed, true-scale Earth near the ground, and an assembly bay for rockets](adr/0002-streamed-terrain-and-assembly-bay.md): tiled elevation and imagery near the surface, and a part-by-part rocket builder, with their sources, licences, phases and gates.

[Simulation techniques and tools review](physics/simulation-review.md):
desk research on Julia and SciML, rocketry tools, astrodynamics simulators
and numerical techniques, atmospheric entry and real-time simulation in
the browser, with every kept claim checked against its source.

## Conventions

- Every new model ships with its page, in the same pull request: equations,
  sources, constants and validation.
- Each page ends with a numbered "References" section in IEEE style, in
  order of first citation, and the text cites them with markers such as [1]
  or [1, Alg. 3.3].
- Equations here are written out in this project's own notation; textbooks
  are cited by section and example, not quoted.
