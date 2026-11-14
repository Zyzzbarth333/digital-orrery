# digital-orrery documentation

How the simulator works, with the maths, the constants the code uses, where
they come from, and how each part is checked.

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
| [A 6-DOF vehicle in Earth orbit](physics/sixdof.md) | Rigid-body attitude, the Earth's gravity field to any degree, Earth rotation (IAU 1976/1980), drag and thrust, NASA's 6-DOF check cases |
| [The space environment](physics/environment.md) | Forces beyond gravity's point masses and J2 on the app's craft: sunlight pressure with the Earth's and Moon's shadows, and the steps across a shadow's edge |
| [Rockets: stages, staging and the ascent](physics/rocket.md) | The ROCKET tab: stage performance, optimal staging (Curtis 13.6), delta-v budgets worked back from a job, a gravity-turn ascent from a pad into orbit; thrust curves and drag against Mach, checked against OpenRocket and RocketPy; OpenRocket design files flown in the app |

## Front end

| Page | Covers |
| --- | --- |
| [The 3D scene](frontend/scene.md) | True scale, the render frame, the floating origin, camera, orbit lines, time |
| [Camera](frontend/camera.md) | The orbit camera, flights on van Wijk and Nuij's zoom-and-pan path, interrupting and redirecting them, zoom kept between bodies |
| [Lighting](frontend/lighting.md) | Inverse-square sunlight and exposure, HDR and tone mapping, the Sun's disc and glare, bloom, point stars and adaptation, albedo and scattering laws, eclipses, ring photometry |
| [Source tags](frontend/source-tags.md) | What each readout's tag opens: the value, its equation and its source; how it behaves, its accessibility, the MathML typesetting, and every reference the tags cite |
| [Missions](frontend/mission.md) | The craft model, launches, manoeuvre nodes, the readout and its tags, the porkchop planner |
| [Moons](frontend/moons.md) | Twenty major moons of Mars to Pluto: astronomy-engine's Galilean moons, JPL's mean elements with corrections fitted to Horizons, planets drawn at their centres, the errors against Horizons |
| [Asteroids and comets](frontend/small-bodies.md) | 135,353 small bodies from JPL's SBDB drawn by the GPU, the named ones, how right they are |
| [Atmospheres](frontend/atmospheres.md) | Rayleigh, Mie and ozone single scattering along the view ray, sunlight reddening on the ground, checks |
| [Surface maps, rings, stars and daily Earth](frontend/textures.md) | Every source and its credit, map layout, relief from elevation, night lights, GIBS daily imagery, the Cassini ring profile, the star map |

## Usability

[UX review](ux/review.md): personas, scenarios and a heuristic evaluation of the console, with what was fixed.
[UX research](ux/research.md) and the [overhaul plan](ux/overhaul-plan.md): what space-sim and planetarium UIs, panel design, camera navigation, sky rendering and WebGL performance research say, and the November 2026 overhaul built on it.

## Checks and performance

[Validation](validation.md): every check, its reference and the measured
result. [Performance](performance.md): what each part costs and the plan
for the slow parts.

## Conventions

- Every new model ships with its page, in the same pull request: equations,
  sources, constants and validation.
- Equations here are written out in this project's own notation; textbooks
  are cited by section and example, not quoted.
