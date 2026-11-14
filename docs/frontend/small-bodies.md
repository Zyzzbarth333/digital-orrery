# Asteroids and comets

The orrery draws 135,353 small bodies from JPL's Small-Body Database
(SBDB): the main belt's brightest, every known near-Earth asteroid, Jupiter
trojan, centaur and trans-Neptunian object, and the periodic comets. The
rail's **Small bodies** switches show or hide each population. Thirty-six of
them are named: the dwarf planets, the largest asteroids, spacecraft targets
and famous comets.

| Population | SBDB classes | Count | Colour |
| --- | --- | --- | --- |
| Main belt (brighter than H 15) | MBA, IMB, OMB, MCA | 65,032 | grey |
| Near-Earth asteroids | IEO, ATE, APO, AMO | 43,083 | orange |
| Jupiter trojans | TJN | 16,472 | green |
| Kuiper belt: centaurs and trans-Neptunian objects | CEN, TNO | 9,419 | violet |
| Periodic comets (e < 0.995) | JFc, JFC, HTC, ETc, CTc, COM | 1,347 | cyan |

(Pluto is left out: the app has it as a planet.)

## The data

- **Fetching** (`npm run fetch:smallbodies`, `src/physics/smallbodies.fetch.mjs`):
  the SBDB query API at full precision, cached in
  `~/.cache/digital-orrery/sbdb-full` (47 MB), pages of 20,000, two seconds
  apart. The API's default output is rounded for display (Ceres's a to
  2.766 au, angles to 0.01°), tens of thousands of kilometres off, so full
  precision is asked for.
- **The named ones** (`src/physics/smallbodies.horizons.mjs`): their
  osculating elements at the shared epoch, 2026-01-01 00:00 TT, from JPL
  Horizons. SBDB's solution for some of them is years old (Bennu's from
  2011, Halley's from 1967), and two-body motion from then is millions of
  kilometres off by 2026.
- **Building** (`npm run build:smallbodies`,
  `src/physics/smallbodies.build.mjs`): every orbit is carried to the
  shared epoch by two-body motion and packed into 16 bytes:
  - a (float32), e (uint16);
  - i, node, peri, M (uint16, in 0.0055° steps);
  - H (a comet's M1, from −2 to 34.4 in 0.14 mag steps);
  - the class and, for a comet, its K1 (the nearest of 5, 7.5, 10, 12.5,
    15, 20, 25 and 35; 10 where SBDB has none).

  A body with no magnitude gets H 18, which is faint. That is 17 asteroids
  and 130 comets, most of the comets fragments (58) or last seen before
  1950 (48).
  `public/data/smallbodies.bin` is 2.17 MB; `smallbodies.json` holds the
  counts and the named bodies at full precision.

## Drawing

`src/scene/smallBodies.ts` is one point cloud. Each frame only the time
and the camera's position change: the vertex shader solves Kepler's
equation for every body from its elements (Danby's starting guess, 12
Newton steps) and subtracts the camera, so the cost on the CPU does not
grow with their number.

Each body is a point of light, drawn as the stars are: a Gaussian of fixed
width in device pixels on its true position, so it neither shimmers nor
vanishes as the view turns. Its brightness follows its magnitude as seen
from the camera:
- **An asteroid:** H + 5 log₁₀(r Δ) − 2.5 log₁₀ Φ(α), the H-G system with
  G = 0.15 (Bowell et al. 1989).
- **A comet:** M1 + 5 log₁₀ Δ + K1 log₁₀ r, with its own K1.

Here r and Δ are its distances from the Sun and from the camera (au), and
α is the Sun-body-camera angle. True magnitudes would leave nearly every
body invisible, so the drawing departs from them in two stated ways:
- **Metered for sunlight at the camera,** as the scene's exposure is: the
  magnitude less 5 log₁₀ of the camera's distance from the Sun (at least
  0.2 au). From far out the belt keeps its brightness, as the planets'
  sunlit discs do.
- **Half the range:** a body of metered magnitude 19.6 (the main belt's
  median seen from the Earth) peaks at a display value of 0.08. Each
  magnitude changes that by a factor of 10^0.2, up to 3, where the
  brightest bloom a little.

So a near-Earth asteroid passing the camera brightens as it would, and the
populations read alike from the Earth or from the Kuiper belt. Where the
scene models the eye's adaptation, the points fade beside bright light, as
the stars do. A point below 1/512 of white is not drawn at all. The points
are drawn just after the stars, without depth, so the planets drawn later
cover them.

The scene passes the layer its camera position and 1 / the exposure:
- **Drawn straight to the screen** (no HDR target), the shader multiplies
  the exposure back and writes the display value, so the points add up as
  display values. Tone-mapping each point before they add up would turn a
  dense belt white.
- **Drawn into an HDR target,** the output pass exposes, tone-maps and
  encodes their sum once.

The same call is right in both cases.

The named bodies get markers in the HTML overlay, placed from the same
elements on the CPU as the points are drawn, and rounded to whole device
pixels. The dwarf planets and the four largest asteroids are always
marked; the others once the camera is within 1.5 au.

## How right they are

Each body follows the osculating ellipse of its orbit solution; the planets'
pull moves the real ones off it slowly (`smallbodies.test.mjs`):

| Check | Result |
| --- | --- |
| Ceres, Vesta, Bennu, Eris and Halley against Horizons, 2026-01-01 to 2027-01-01 | 0 km at the epoch; within 101,000 km a year on (Ceres 75,000 km, 0.66′ as seen from the Sun) |
| The 16-byte packing, named bodies | within 73″ as seen from the Sun (a near-parabolic orbit magnifies the rounding of e) |
| The shader's Kepler solve (float32) against the exact one, every body, over 20 years | within 65″; all but 14 within 20″ |

Most bodies' SBDB solutions are current (2026), but about 10,600 near-Earth
asteroids (mostly faint ones seen at one opposition), most comets (their
orbit from their last apparition), and a few thousand trojans and outer
bodies have older ones; those are drawn where two-body motion from then
puts them, which for some is far from where they are. They show where the
populations lie, not where a given faint body is tonight.

## Sources

- JPL Small-Body Database query API,
  [ssd-api.jpl.nasa.gov/doc/sbdb_query.html](https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html).
- JPL Horizons API, [ssd.jpl.nasa.gov/horizons](https://ssd.jpl.nasa.gov/horizons/).
- J. M. A. Danby, *Fundamentals of Celestial Mechanics* (Willmann-Bell,
  1988): the starting value for Kepler's equation.
- E. Bowell et al., "Application of photometric models to asteroids", in
  *Asteroids II* (University of Arizona Press, 1989), pp. 524–556: the H-G
  magnitude system.
