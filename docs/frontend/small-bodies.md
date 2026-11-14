# Asteroids and comets

The orrery draws 1,581,674 small bodies from JPL's Small-Body Database
(SBDB). 135,353 are points of light: the main belt's brightest, every known
near-Earth asteroid, Jupiter trojan, centaur and trans-Neptunian object, and
the periodic comets. The other 1,446,321, the main belt fainter than H 15,
are a haze worked out from their real orbits ([the faint belt](#the-faint-belt)). The
rail's **Small bodies** switches show or hide each population. Thirty-six of
them are named: the dwarf planets, the largest asteroids, spacecraft targets
and famous comets.

| Population | SBDB classes | Count | Colour |
| --- | --- | --- | --- |
| Main belt (brighter than H 15) | MBA, IMB, OMB, MCA | 65,032 | grey |
| Main belt, fainter (the haze) | MBA, IMB, OMB, MCA | 1,446,321 | grey |
| Near-Earth asteroids | IEO, ATE, APO, AMO | 43,083 | orange |
| Jupiter trojans | TJN | 16,472 | green |
| Kuiper belt: centaurs and trans-Neptunian objects | CEN, TNO | 9,419 | violet |
| Periodic comets (e < 0.995) | JFc, JFC, HTC, ETc, CTc, COM | 1,347 | cyan |

(Pluto is left out: the app has it as a planet.) By default asteroids are
drawn a natural warm grey (the mean of the S and C types' colours) and
comets a pale blue; the rail's **Colour by kind** switch colours each
population as its swatch instead.

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
  `public/data/smallbodies.bin` (the points) is 2.17 MB and is loaded
  first; `smallbodies-belt.bin` (the faint main belt) is 23.1 MB and is
  loaded after it. `smallbodies.json` holds the counts and the named bodies
  at full precision.

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

### The point budget

Working the points out costs little; drawing them is what costs, about
0.26 µs a point on an integrated GPU and a hundredth of that on a fast one.
So the layer sets the faintest point it draws from the frame time:
- **Over 22 ms a frame** (smoothed), the cut-off rises.
- **Under 18 ms,** it falls back, which a 60 Hz display's 16.7 ms allows.
  It never falls to within a quarter of where frames last ran slow, and
  that mark fades over about 20 s, so the cut-off settles rather than
  see-saws.

A dim point's glow is nearly all core, so a point under 0.3 of white is
drawn as a 3-pixel sprite. On the laptop's Intel GPU (headless Chromium,
the solar system view) a frame took 88 ms with every point drawn and the
haze on. With the budget it takes 17 ms, against 12 ms with no small
bodies at all. On an RTX 5070 Ti the cut-off stays at nothing and a frame
takes 3.8 ms either way.

## The faint belt

Drawn one by one, the 1.45 million main-belt asteroids fainter than H 15
would be points below the screen's floor, yet together they light the belt.
So they are drawn as a haze (`src/scene/beltHaze.ts`):

1. **Binning** (`beltHaze.worker.ts`, off the main thread). Every body is
   placed on its orbit at the clock's time, by Kepler's equation.
2. **The grid** (`src/physics/beltGrid.js`). Its reflected sunlight, 10^(−0.4 H) / r², is shared
   among the 8 nearest cells of a 3D grid (`beltGrid.ts`): 256 × 256 × 48
   cells over ±5.6 au in x and y and ±1.6 au in z, heliocentric ecliptic.
   That takes about 0.7 s and is redone whenever the clock has moved
   2 days. The belt turns about 0.25° a day at 2.7 au, under a cell
   (0.9° there) in four.
3. **Drawing.** A box around the Sun is drawn from its far faces, and each
   pixel's ray marches 32 jittered steps through the grid as a 3D texture.
   A cloud of emitters with emissivity j has surface brightness
   (1 / 4π) ∫ j ds along the line of sight, whatever its distance.

The haze is metered as the points are (5 log₁₀ of the camera's distance
from the Sun), with its range halved by a square root. It sits a little
below the brightest points, which keep the belt's detail. The phase angle
is left out. On the Intel GPU the haze costs about 5 ms a frame, and its
cost does not grow with the number of bodies. The main-belt switch shows
or hides the haze with the points.

## Flying to one

A named body (the 36 with labels) can be chosen, by its marker in the sky
or from the rail's **Fly to** list, which is also the way there by keyboard.
The camera flies to it as it does to a planet (cameraRig.ts), and the data
plate shows it (`src/app/small-body-plate.tsx`). Choosing a body in the
rail, the arrow keys or following a craft leaves it.

- **Where it is:** the anchor the camera follows is the body's position
  from the same elements and Kepler solve its marker uses
  (`positionAu`), at the clock's time each frame.
- **What is drawn:** a sphere at its diameter, lit by the Sun as the
  planets are (`bodyMaterial.ts`, Lommel-Seeliger for regolith), with an
  albedo of 0.15, or 0.04 for a comet's dark nucleus.
  - **The size:** SBDB's diameter where it has one. The trans-Neptunian
    objects and the comets have none there. A TNO is sized from its H
    for an albedo of 0.15, $D = 1329\ \text{km}\,p^{-1/2}\,10^{-H/5}$. A
    comet's H is its coma's, so it is drawn as a 5 km nucleus. The plate
    says "not in SBDB" and how the drawn size was chosen.
- **Its point is hidden up close:** the shader works in float32 au, which
  puts a point within about 15 km of where it should be. So while the
  camera is within 0.05 au of the focused body, no point closer than twice
  the camera's distance is drawn; its sphere is.
- **The camera:** it arrives at eight radii, at least 50 km out, and can
  close to 1.2 radii.
- **The plate:** class (SBDB), distance from the Sun and the Earth, light
  time, speed (vis-viva), diameter, H (a comet's M1), the elements a, e
  and i, perihelion and aphelion, and the period by Kepler's third law
  (`smallBodyFacts` in `smallBodies.js`), each with its source tag.

`smallbodies.test.mjs` checks the plate's facts:
- Ceres's period, 4.6 years, and its perihelion and aphelion, against
  NASA's;
- Halley's period and perihelion;
- the vis-viva speed against the drawn motion, to 10⁻³ km/s;
- the size formula against Ceres's measured 939.4 km (951 km from H 3.34
  and albedo 0.090).

The other 135,000 bodies carry no designations in the packed file, so
they can't be chosen yet. Searching them by name would need SBDB's
designations shipped alongside.

## How right they are

Each body follows the osculating ellipse of its orbit solution; the planets'
pull moves the real ones off it slowly (`smallbodies.test.mjs`):

| Check | Result |
| --- | --- |
| Ceres, Vesta, Bennu, Eris and Halley against Horizons, 2026-01-01 to 2027-01-01 | 0 km at the epoch; within 101,000 km a year on (Ceres 75,000 km, 0.66′ as seen from the Sun) |
| The 16-byte packing, named bodies | within 73″ as seen from the Sun (a near-parabolic orbit magnifies the rounding of e) |
| The shader's Kepler solve (float32) against the exact one, every body, over 20 years | within 65″; all but 14 within 20″ |
| The faint belt's grid (`beltGrid.js`), binning the points' bodies | holds their light to 1 part in 10⁵; its light-weighted centre 6 km from theirs |

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
- JPL SBDB orbit classes, [ssd-api.jpl.nasa.gov/doc/sbdb_filter.html](https://ssd-api.jpl.nasa.gov/doc/sbdb_filter.html).
- JPL CNEOS, asteroid size estimator,
  [cneos.jpl.nasa.gov/tools/ast_size_est.html](https://cneos.jpl.nasa.gov/tools/ast_size_est.html);
  Fowler and Chillemi, in *The IRAS Minor Planet Survey* (Phillips
  Laboratory, 1992, PL-TR-92-2049): the diameter from H and albedo.
- E. Bowell et al., "Application of photometric models to asteroids", in
  *Asteroids II* (University of Arizona Press, 1989), pp. 524–556: the H-G
  magnitude system.
