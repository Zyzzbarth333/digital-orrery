# Spacecraft beyond Earth orbit

The working spacecraft of 2026 and 2027 at Mercury, the Moon, Mars and
Jupiter, about the Sun-Earth L1 and L2 points, and in cruise, where JPL
Horizons places them [1]. The rail's **Beyond Earth** section switches them
on; each has a marker, a label and its path, and can be flown to, with a
data plate. The app flies none of them: they are on rails, as the planets
are. (The [Earth satellites](satellites.md) come from CelesTrak instead;
these have no element sets.)

Code: [`src/physics/spacecraft.js`](../../src/physics/spacecraft.js) (the
packing and the filling-in),
[`spacecraft.fetch.mjs`](../../src/physics/spacecraft.fetch.mjs) (the
fetch), [`src/scene/spacecraftLayer.ts`](../../src/scene/spacecraftLayer.ts)
(drawing), [`spacecraft-rail.tsx`](../../src/app/spacecraft-rail.tsx) and
[`spacecraft-plate.tsx`](../../src/app/spacecraft-plate.tsx).

## The craft

CRAFT_TABLE

Horizons serves each craft's trajectory as its mission's navigation team
delivers it: reconstructed from tracking up to a date, then predicted. Its
notes give the table of the trajectories it joins, which the fetch keeps
and the plate shows: on the clock's day, the plate says whether the
position is reconstructed or a prediction, and a prediction leaves out the
manoeuvres planned since it was made. Some predictions are simplified
forecasts that follow a plain conic: on such a day a single two-body orbit
fits a low orbiter's whole day within 2 km, which no real gravity field
allows. The fetch counts those days (the table's last column), and the
plate says so.

## Holding the trajectories

`npm run fetch:spacecraft` asks Horizons for each craft's states about its
centre body (J2000 equatorial, UT) every 4 minutes for a Mercury or Mars
orbiter, 10 for a lunar orbiter and Juno, 30 for a probe and 60 for an
L-point observatory or the Voyagers and New Horizons, for 2026 and 2027.
That is about 2.5 million states. It keeps the fewest that still give
every one of them back within 2 km:

**Filling in.** Between two kept states *s<sub>a</sub>* at *t<sub>a</sub>*
and *s<sub>b</sub>* at *t<sub>b</sub>*, either

$$\mathbf r(t) = (1 - w)\,K(\mathbf s_a, t - t_a) + w\,K(\mathbf s_b, t - t_b),\qquad w = 3u^2 - 2u^3,\quad u = \frac{t - t_a}{t_b - t_a}$$

where *K* carries a state along its own two-body orbit about the centre
(universal variables, [`orbital.js`](../../src/physics/orbital.js)
`propagate` [2, Algs. 3.3, 3.4]), or the cubic Hermite curve through both
positions with both velocities. The blend is exact at both ends, and in
between it is off by what the centre's oblateness and the other bodies'
pull do in half an interval, far less than either arc alone. On a day of
MRO's (a 112-minute orbit 300 km over Mars), kept states every 20 minutes
give it within 1.8 km, where the cubic alone would be 15 km off; LRO's
hourly, 0.8 km against 440 km.

**Choosing.** For each craft and each day the fetch tries the Kepler blend
and the cubic, at every spacing that divides the day, from one state a day
down, and keeps the longest spacing that passes. For a probe it also tries
the blend about any planet it passes within 2 million km of that day
(Europa Clipper at the Earth in December 2026, JUICE at the Earth in
September 2026, Psyche at Mars in May 2026), shifted with DE442's
positions. A day nothing passes would keep every state, and say so.

**Packing.** A month's days for every craft go in one file:
`public/data/spacecraft/YYYY-MM.bin`, with an index of its segments in
`YYYY-MM.json`. A state is six float32 numbers for a craft within a
million km of its centre (4 m at 10⁵ km) and six float64 beyond. The app
loads the clock's month (and the next or last near its ends), 0.1 to
1 MB. TOTALS

## Drawing

- **Markers:** a small open square with a cross through it, in its group's
  colour (the user's own craft are diamonds). An orbiter's shows within a
  few hundred thousand km of its planet (Juno's and the L-point
  observatories' within 12 to 20 million km); a probe's always. Labels that
  would overlap give way.
- **Paths:** the planets' orbit shader, an outline with a glowing trail
  behind the craft: an orbiter's one period about its planet, an L-point
  observatory's half a year about the Earth, a probe's two months about the
  Sun, centred on the clock and resampled once it has moved a quarter of
  the span. A probe passing a planet draws only the stretch held about the
  day's centre.
- **Flying to one:** from its marker or the rail's list. The camera flies
  500 km out (or the distance last zoomed to), follows it and can come to
  within 20 m. A day without data hands the camera back to the body in view.
- **The plate:** distance from its centre (and height over its mean
  radius), speed about it, distance from the Sun and the Earth, light time,
  which trajectory the clock is in, Horizons' revision date, and how the
  app holds it, each with its source tag.

## How right they are

The positions are Horizons', within the 2 km of the packing: as right as
the trajectory the mission delivered. A reconstruction is good to metres or
better; a prediction drifts from the real path as the craft manoeuvres.

**Checks** (`npm test`,
[`spacecraft.test.mjs`](../../src/physics/spacecraft.test.mjs)):

- **Held-out Horizons states:** one a month a craft, from the middle of an
  interval (the furthest from both kept states), not used in the packing.
  HELDOUT
- **Joins:** each day's last state and the next day's first agree (worst
  JOINS).
- **The files:** every craft packed within the tolerance on every day, and
  every craft carries Horizons' trajectory table.

## References

[1] NASA JPL Solar System Dynamics, "Horizons system," spacecraft trajectories (each craft's notes credit its navigation team). [Online]. Available: https://ssd.jpl.nasa.gov/horizons/

[2] H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. Oxford, U.K.: Butterworth-Heinemann, 2020.
