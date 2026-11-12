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

## Front end

| Page | Covers |
| --- | --- |
| [The 3D scene](frontend/scene.md) | True scale, the render frame, the floating origin, camera, orbit lines, time |
| [Lighting](frontend/lighting.md) | Inverse-square sunlight and exposure, albedo and scattering laws, eclipses, ring photometry |
| [Surface maps, rings, stars and daily Earth](frontend/textures.md) | Every source and its credit, map layout, relief from elevation, night lights, GIBS daily imagery, the Cassini ring profile, the star map |

## Checks and performance

[Validation](validation.md): every check, its reference and the measured
result. [Performance](performance.md): what each part costs and the plan
for the slow parts.

## Conventions

- Every new model ships with its page, in the same pull request: equations,
  sources, constants and validation.
- Equations here are written out in this project's own notation; textbooks
  are cited by section and example, not quoted.
