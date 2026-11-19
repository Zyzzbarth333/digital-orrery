# Spacecraft beyond Earth orbit

The working spacecraft of 2026 and 2027 at Mercury, the Moon, Mars and
Jupiter, about the Sun-Earth L1 and L2 points, and in cruise, where JPL
Horizons places them [1]. The rail's **Beyond Earth** section switches them
on; each has a marker, a label and its path, and can be flown to, with a
data plate. The app flies none of them: they are on rails, as the planets
are. (The [Earth satellites](satellites.md) come from CelesTrak instead;
these have no element sets.)

![Mars on 17 November 2026 with the spacecraft on: MRO low over the planet with its orbit, Mars Express further out on its elliptical orbit, and Odyssey and TGO hidden behind Mars](spacecraft-mars.jpg)

Code: [`packages/physics/src/spacecraft.js`](../../packages/physics/src/spacecraft.js) (the
packing and the filling-in),
[`spacecraft.fetch.mjs`](../../pipelines/spacecraft.fetch.mjs) (the
fetch), [`src/scene/spacecraftLayer.ts`](../../src/scene/spacecraftLayer.ts)
(drawing), [`spacecraft-rail.tsx`](../../src/app/spacecraft-rail.tsx) and
[`spacecraft-plate.tsx`](../../src/app/spacecraft-plate.tsx).

## The craft

Twenty-eight craft, each held about the body it orbits (or the Earth for the L1 and L2 observatories, the Sun for a probe):

| Where | Craft (Horizons ID) | Days in 2026–2027 | Kept every | Worst, all checked samples | Horizons revised | Days a conic fits |
| --- | --- | ---: | --- | ---: | --- | ---: |
| Mercury | BepiColombo (MPO) (-121) | 464 | 4 min – 1 day | 1.99 km | Nov 11, 2026 | 33 |
| The Moon | Lunar Reconnaissance Orbiter (-85) | 730 | 10 min – 1 day | 2.00 km | Oct 07, 2026 | 386 |
| The Moon | Chandrayaan-2 orbiter (-152) | 344 | 10 min – 1 day | 2.00 km | Nov 03, 2026 | 1 |
| The Moon | Danuri (KPLO) (-155) | 518 | 10 min – 12 h | 2.00 km | Nov 10, 2026 |  |
| The Moon | CAPSTONE (-1176) | 225 | 10 min – 12 h | 1.98 km | Jul 20, 2026 |  |
| Mars | Mars Reconnaissance Orbiter (-74) | 333 | 20 min | 1.75 km | Nov 03, 2026 |  |
| Mars | 2001 Mars Odyssey (-53) | 389 | 20–24 min | 2.00 km | Nov 03, 2026 |  |
| Mars | MAVEN (-202) | 59 | 24 min | 1.90 km | Feb 13, 2026 |  |
| Mars | Mars Express (-41) | 730 | 4 min – 1 h | 2.00 km | Nov 03, 2026 |  |
| Mars | ExoMars Trace Gas Orbiter (-143) | 730 | 20–24 min | 2.00 km | Jan 13, 2026 |  |
| Mars | Hope (Emirates Mars Mission) (-62) | 469 | 10 min – 1 day | 1.98 km | Nov 03, 2026 | 424 |
| Jupiter | Juno (-61) | 730 | 10 min – 12 h | 1.99 km | Nov 03, 2026 |  |
| Sun-Earth L1 and L2 | James Webb Space Telescope (-170) | 730 | 1 day | 1.87 km | Nov 10, 2026 |  |
| Sun-Earth L1 and L2 | Nancy Grace Roman Space Telescope (-211) | 488 | 60 min – 1 day | 1.82 km | Nov 10, 2026 |  |
| Sun-Earth L1 and L2 | Euclid (-680) | 730 | 1 day | 0.90 km | Nov 03, 2026 |  |
| Sun-Earth L1 and L2 | Gaia (-139479) | 730 | 1 day | 0.08 km | May 16, 2025 |  |
| Sun-Earth L1 and L2 | SOHO (-21) | 347 | 60 min – 1 day | 1.99 km | Nov 03, 2026 |  |
| Sun-Earth L1 and L2 | DSCOVR (-78) | 332 | 60 min – 1 day | 1.98 km | Nov 10, 2026 |  |
| In cruise | Parker Solar Probe (-96) | 730 | 30 min – 1 day | 1.97 km | Nov 03, 2026 |  |
| In cruise | Solar Orbiter (-144) | 730 | 30 min – 1 day | 1.90 km | Nov 03, 2026 |  |
| In cruise | JUICE (-28) | 730 | 30 min – 1 day | 1.94 km | Nov 03, 2026 |  |
| In cruise | Europa Clipper (-159) | 730 | 30 min – 1 day | 1.96 km | Nov 02, 2026 |  |
| In cruise | Psyche (-255) | 730 | 30 min – 1 day | 1.99 km | Nov 03, 2026 |  |
| In cruise | Lucy (-49) | 730 | 30 min – 1 day | 0.65 km | Nov 03, 2026 |  |
| In cruise | Hera (-91) | 376 | 30 min – 1 day | 1.99 km | Nov 03, 2026 |  |
| In cruise | New Horizons (-98) | 730 | 1 day | 0.00 km | Sep 01, 2026 |  |
| In cruise | Voyager 1 (-31) | 730 | 1 day | 0.00 km | Aug 19, 2022 |  |
| In cruise | Voyager 2 (-32) | 730 | 1 day | 0.00 km | Aug 19, 2022 |  |

Where a craft has fewer days, Horizons' data end. MAVEN's reconstruction ends on 6 December 2025 and its trajectory in February 2026. DSCOVR's ends three weeks after its last tracking (30 November 2026), MRO's prediction on 30 November 2026, Chandrayaan-2's on 11 December 2026. Others end with the prediction their team delivered.

Horizons serves each craft's trajectory as its mission's navigation team
delivers it: fitted to tracking up to its latest update, then predicted.
The plate says which, by Horizons' revision date for the craft: before it,
fitted to tracking; after it, a prediction, which leaves out the manoeuvres
planned since it was made. Where Horizons' notes list the trajectories it
joins (17 of the 28), the plate's source tag names the one the clock is in. Some predictions are simplified
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
(universal variables, [`orbital.js`](../../packages/physics/src/orbital.js)
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
(Psyche at Mars in May 2026, JUICE at the Earth in September, Europa
Clipper at the Earth in December, Solar Orbiter at Venus in December;
Parker passes within 2 million km of Venus in February), shifted with DE442's
positions. A day nothing passes would keep every state, and say so.

**Packing.** A month's days for every craft go in one file:
`public/data/spacecraft/YYYY-MM.bin`, with an index of its segments in
`YYYY-MM.json`. A state is six float32 numbers for a craft within a
million km of its centre (4 m at 10⁵ km) and six float64 beyond. The app
loads the clock's month (and the next or last near its ends), 0.1 to
1 MB. All 28 for both years come to 194,654 states in 5.4 MB, most of it the Mars orbiters (TGO alone, 47,206).

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
  the span (at most every 250 ms of real time, which at high rates keeps a
  low orbiter's path from being resampled every frame). A probe passing a planet draws only the stretch held about the
  day's centre.
- **Flying to one:** from its marker, the rail's list, or the rail's
  FIND field ([`find.tsx`](../../src/app/find.tsx)), which fetches the
  index (21 kB) when it first takes focus, lists the craft under **Beyond
  Earth**, and switches the layer on if it is off ("Spacecraft shown"). The camera flies
  500 km out (or the distance last zoomed to), follows it and can come to
  within 20 m. If the craft's month of data has not arrived, the flight
  waits for it, and choosing anything else meanwhile calls it off. Coming
  from elsewhere to a sunlit craft, the camera arrives on its Sun side, a
  little off the line, so its arrays face the camera lit; in a body's
  shadow, and when the camera is on the craft already, the angle is kept.
  A day without data hands the camera back to the body in view.
- **The plate:** distance from its centre (and height over its mean
  radius; a craft held about the Sun has the one Sun row, in AU and km), speed about it, distance from the Sun and the Earth, light time,
  its sunlight (lit, a partial eclipse, or in eclipse and whose,
  [lighting](lighting.md#objects-in-shadow)), which trajectory the clock is
  in, Horizons' revision date, and how the app holds it, each with its
  source tag. In a body's penumbra its marker dims a little, in its umbra
  more.
- **Close up:** see [close-up models](#close-up-models) below.

## Close-up models

Twenty of the 28 craft, and the MISSION tab's real Juno, DART, LRO and
MESSENGER, are drawn close up by NASA's own models once they span 3
pixels, as the app's own craft are ([missions](mission.md#close-up-models)).
Each model loads the first time the camera is on its craft and close
enough, never before, and until then the marker stands in. The plate says
whose model it is, what size it is drawn at and how it is turned
([`probeModels.ts`](../../src/scene/probeModels.ts),
[`craftAssets.ts`](../../src/scene/craftAssets.ts),
[`craftModels.ts`](../../src/scene/craftModels.ts)).

![Webb close up: NASA 3D Resources' model, its sunshield to the Sun](probe-model-jwst.jpg)
![MRO over Mars' polar cap: its panels to the Sun](probe-model-mro.jpg)

- **The models:** eleven from NASA 3D Resources [3], free to use, and
  eleven from NASA's Eyes on the Solar System [4] (NASA/JPL-Caltech,
  under the JPL Image Use Policy), 4.7 and 28 MB, 0.1 to 9.9 MB each, in
  `public/models/probes`. NASA 3D Resources' files carry each texture
  twice, as WebP and as a PNG fallback; the PNGs are dropped (35 MB to
  4.7 MB). The Eyes models are packed into one GLB each with their
  textures as WebP at quality 90 (52 MB to 28 MB). The geometry is as
  published.
- **Their sizes:** each is scaled so that a part whose size is published
  measures what its source gives. Where nothing published matches a part
  of the model, the model is drawn at its own size, in metres:

| Craft | Model | Drawn at |
| --- | --- | --- |
| JWST | NASA 3D, "James Webb Space Telescope (B)" | its sunshield 21.197 m long [5] |
| MRO | NASA 3D, "Mars Reconnaissance Orbiter (MRO) (C)" | 13.6 m across its two solar panels [6] |
| MAVEN | NASA 3D, "MAVEN (B)" | 11.4 m long across its panels [7] |
| Juno | NASA 3D, "Juno (A)" | its own: its arms reach 10.7 m from its axis, about 21 m across, where NASA gives a span of more than 20 m [8] |
| LRO | NASA 3D, "Lunar Reconnaissance Orbiter (B)" | its own (NASA gives no size) |
| MESSENGER (MISSION tab) | NASA 3D, "MESSENGER" | its sunshade 2.5 m tall [9] |
| Mars Odyssey | NASA 3D, "Mars Odyssey" | its array 5.7 m tip to tip [10] |
| DSCOVR | NASA 3D, "DSCOVR (Triana)" | its body 1.83 m across [11] |
| Roman | NASA 3D, "Nancy Grace Roman Space Telescope (B)" | 12.7 m long [12] |
| Parker Solar Probe | NASA 3D, "Parker Solar Probe" | 3.05 m high [13] |
| Voyager 1 and 2 | NASA 3D, "Voyager Probe (A)" | its high-gain antenna 3.7 m across [14] |
| DART (MISSION tab) | Eyes, DART | each array 8.5 m long [15] |
| Psyche | Eyes | 24.76 m across its arrays [16] |
| Lucy | Eyes | 16 m tip to tip [17] |
| Europa Clipper | Eyes | 30.5 m tip to tip [18] |
| New Horizons | Eyes | its high-gain antenna 2.1 m across [19] |
| JUICE | Eyes | 27 m tip to tip [20] |
| SOHO | Eyes | 9.5 m across its array [21] |
| Danuri | Eyes | 6.3 m across [22] |
| Euclid, Mars Express, CAPSTONE | Eyes | their own (no published size matches a part of the model) |

- **Not modelled:** BepiColombo, Chandrayaan-2, Hope, ExoMars TGO, Gaia,
  Solar Orbiter and Hera. NASA publishes no model of them that the app
  found; they stay markers, and their plates say so.
- **How each is turned:** the app carries none of these craft's attitudes.
  Each is drawn with its solar arrays (Webb's and Euclid's sunshield,
  Parker's heat shield, MESSENGER's sunshade) turned to the Sun, and the
  Voyagers and New Horizons with their high-gain antenna to the Earth. A
  second axis of the model is turned as near the ecliptic's north as is
  square to that. The axis each model's arrays face was read from the
  model. Its arrays and antennas stay as modelled, and do not track. An
  orbiter's instruments do not point at its planet.
- **Burns:** on the MISSION tab, Juno turns its main engine along each
  burn while it fires (the engine is on the deck opposite its antenna),
  with its arrays as near the Sun as that lets them, and shows the plume
  aft. DART's, LRO's and MESSENGER's burns are not drawn on the model.
- **Staging:** DART releases LICIACube on 11 September 2022, 15 days before
  the impact. LICIACube is drawn as a plain 6U CubeSat, 10 by 22.6 by
  36.6 cm [23], its solar panels left out. It moves off for an hour at the
  speed that balances DART's recoil in its reconstruction (0.033 m/s) for
  its 14 kg [24], 1.4 m/s apart. Juno, LRO and MESSENGER start after
  leaving their launchers, so nothing else separates.

  ![DART a second after LICIACube's release, the CubeSat beside its bus](probe-model-dart-liciacube.jpg)
- **Light:** as the app's own craft's models: the Sun and the Earthshine
  as two directional lights, the metal turned down to a quarter, glass
  off ([missions](mission.md#close-up-models)).

## Performance

About 1.6 ms a frame on an integrated GPU at real time, nothing measurable
on a discrete one, and up to 2 ms at a day a second; off until switched on,
and nothing then ([performance.md](../performance.md#spacecraft-beyond-earth-orbit)).

## How right they are

The positions are Horizons', within the 2 km of the packing: as right as
the trajectory the mission delivered. A reconstruction is good to metres or
better; a prediction drifts from the real path as the craft manoeuvres.

**Checks** (`npm test`,
[`spacecraft.test.mjs`](../../packages/physics/src/spacecraft.test.mjs)):

- **Held-out Horizons states:** one a month a craft, from the middle of an
  interval (the furthest from both kept states), not used in the packing.
  522 of them, every craft within 2 km: worst 1.95 km (odyssey); the L-point observatories and probes within 1.3 km, the Voyagers and New Horizons exact.
- **Joins:** each day's last state and the next day's first agree (worst
  3.5 m over 8,081 joins: float32 at up to 100,000 km).
- **The files:** every craft packed within the tolerance on every day, and
  every craft carries Horizons' trajectory table.

## References

[1] NASA JPL Solar System Dynamics, "Horizons system," spacecraft trajectories (each craft's notes credit its navigation team). [Online]. Available: https://ssd.jpl.nasa.gov/horizons/

[2] H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. Oxford, U.K.: Butterworth-Heinemann, 2020.

[3] NASA, "NASA 3D Resources," 3D Models. [Online]. Available: https://github.com/nasa/NASA-3D-Resources

[4] NASA/JPL-Caltech, "NASA's Eyes on the Solar System," spacecraft models. [Online]. Available: https://eyes.nasa.gov/apps/solar-system/

[5] NASA, "Webb's sunshield." [Online]. Available: https://science.nasa.gov/mission/webb/webbs-sunshield

[6] NASA/JPL, "Mars Reconnaissance Orbiter arrival," press kit, Mar. 2006. [Online]. Available: https://www.jpl.nasa.gov/news/press_kits/mro-arrival.pdf

[7] NASA, "MAVEN." [Online]. Available: https://science.nasa.gov/mission/maven/

[8] NASA/JPL, "Juno launch press kit: spacecraft." [Online]. Available: http://www.jpl.nasa.gov/news/press_kits/juno/spacecraft/

[9] JHU/APL, "MESSENGER: spacecraft and instruments." [Online]. Available: https://messenger.jhuapl.edu/About/Spacecraft-and-Instruments.html

[10] NASA/JPL, "2001 Mars Odyssey arrival," press kit, Oct. 2001. [Online]. Available: https://www.jpl.nasa.gov/news/press_kits/odysseyarrival.pdf

[11] NASA, "DSCOVR's size," Feb. 2015. [Online]. Available: https://science.nasa.gov/blogs/dscovr/2015/02/11/dscovrs-size

[12] NASA, "Roman Space Telescope: frequently asked questions." [Online]. Available: https://science.nasa.gov/mission/roman-space-telescope/frequently-asked-questions

[13] JHU/APL, "Parker Solar Probe full-scale model," news release. [Online]. Available: https://www.jhuapl.edu/news/news-releases/260317-parker-solar-probe-full-scale-model-smithsonian

[14] NASA, "Voyager: the spacecraft." [Online]. Available: https://science.nasa.gov/mission/voyager/spacecraft/

[15] JHU/APL, "DART: impactor spacecraft." [Online]. Available: https://dart.jhuapl.edu/Mission/Impactor-Spacecraft.php

[16] NASA/JPL, "Psyche press kit: spacecraft." [Online]. Available: https://www.jpl.nasa.gov/press-kits/psyche/mission/spacecraft/

[17] NASA, "The Lucy spacecraft." [Online]. Available: https://science.nasa.gov/mission/the-lucy-spacecraft

[18] NASA/JPL, "Europa Clipper press kit: spacecraft." [Online]. Available: https://jpl.nasa.gov/press-kits/europa-clipper/mission/spacecraft

[19] JHU/APL, "New Horizons: the spacecraft." [Online]. Available: https://pluto.jhuapl.edu/Mission/Spacecraft.php

[20] ESA, "Juice spacecraft specs." [Online]. Available: https://www.esa.int/Science_Exploration/Space_Science/Juice/Juice_spacecraft_specs

[21] ESA, "SOHO fact sheet." [Online]. Available: https://sci.esa.int/web/soho/47368-fact-sheet

[22] KARI, "Korea Pathfinder Lunar Orbiter (KPLO) press kit." [Online]. Available: https://shadowcam.im-ldi.com/KPLO_english_press_kit.pdf

[23] NASA, "State-of-the-art of small spacecraft technology: structures, materials and mechanisms," CubeSat standard structures. [Online]. Available: https://www.nasa.gov/smallsat-institute/sst-soa/structures-materials-and-mechanisms/

[24] JHU/APL, "DART gets its CubeSat companion, its last major piece." [Online]. Available: https://civspace.jhuapl.edu/stories/dart-gets-its-cubesat-companion-its-last-major-piece
