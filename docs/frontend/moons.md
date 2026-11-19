# The planets' moons

Seventy-six moons besides our own are drawn as real bodies, at their real
sizes and true positions about their planets: every moon in the JPL
satellite ephemerides used here (below). The twenty major ones are
in bold.

| Planet | Moons |
| --- | --- |
| Mars | **Phobos**, **Deimos** |
| Jupiter | Metis, Adrastea, Amalthea, Thebe, **Io**, **Europa**, **Ganymede**, **Callisto** |
| Saturn | Pan, Atlas, Prometheus, Pandora, Epimetheus, Janus, Aegaeon, **Mimas**, Methone, Anthe, Pallene, **Enceladus**, **Tethys**, Telesto, Calypso, **Dione**, Helene, Polydeuces, **Rhea**, **Titan**, Hyperion, **Iapetus**, Phoebe |
| Uranus | Cordelia, Ophelia, S/2025 U 1, Bianca, Cressida, Desdemona, Juliet, Portia, Rosalind, Cupid, Belinda, Perdita, Puck, Mab, **Miranda**, **Ariel**, **Umbriel**, **Titania**, **Oberon**, and the irregular Francisco, Caliban, Stephano, S/2023 U 1, Trinculo, Sycorax, Margaret, Prospero, Setebos, Ferdinand |
| Neptune | Naiad, Thalassa, Despina, Galatea, Larissa, Hippocamp, Proteus, **Triton**, Nereid |
| Pluto | **Charon**, Styx, Nix, Kerberos, Hydra |

Each has a marker and label like the planets', an orbit line about its
planet, and a place in the body rail under its planet. Choosing one flies the
camera there (the same `focusOn` and [camera](camera.md) path as a planet).
Near its planet each major moon also pulls on spacecraft with its own GM:
the kernel splits the planet's system into the planet and those moons there
([kernel](../physics/nbody-kernel.md#moons)), from the same positions.
That is checked on Juno's 2021 flyby of Ganymede
([validation](../validation.md#moon-and-planet-flybys-flybytestmjs)).
The small moons are drawn only; the largest of them, Proteus, Phoebe,
Hyperion and Janus, have GMs of 2.6, 0.55, 0.37 and 0.13 km³/s², about Mimas's at most.

Beyond them, the 381 irregular moons of Jupiter, Saturn and Neptune are a
layer the rail switches on ([below](#the-irregular-moons)).

![Jupiter and the Galilean moons on 14 November 2026, with their orbit lines; the rail lists the moons under Jupiter](moons-jupiter.jpg)

![Saturn and its moons out to Titan on the same date](moons-saturn.jpg)

![Jupiter at a day a second: Metis, Adrastea, Amalthea, Thebe and Io go round on their orbit lines, then the camera flies to Io](../clips/jupiter-moons.webp)

Code: `packages/physics/src/moons.js` (positions), `packages/physics/src/moonTables.js` (the
satellite-ephemeris tables, fitted by `c/moon_cheb.c` into
`public/ephemeris/moons/`, loaded by `moonLoad.js` in the browser and
`moonNode.js` under Node), `packages/physics/src/moons.data.js` (the fallback's
elements and every moon's physical data, written by
`pipelines/moons.fetch.mjs`), `packages/physics/src/moons.test.mjs` (the checks),
and the scene's `systemStates` in `src/scene/OrreryScene.ts`; for the
kernel, `packages/physics/src/bodies.js` and `packages/physics/src/flyby.test.mjs`.

## Positions

### 2000 to 2049: JPL's satellite ephemerides

From 2000 to 2049 (the inner moons 2020 to 2035, [below](#the-inner-moons-span)) every moon comes from NAIF's satellite SPK kernels [1], the
numerically integrated ephemerides JPL fits to the observations and the
spacecraft data, and Horizons [2] serves:

| Kernel | System | Covers |
| --- | --- | --- |
| `mar099s` | Mars, Phobos, Deimos | 1995–2050 |
| `jup365` | Jupiter and its eight inner and Galilean moons | 1600–2200 |
| `sat441` | Saturn and its fourteen major and outer moons here | 1750–2250 |
| `sat415` | Saturn's ring moons, Pan to Pallene (Methone is taken from `sat441`) | 1950–2050 |
| `ura184` (part 3) | Uranus, its five major and ten irregular moons | 1600–2400 |
| `ura184` (parts 1, 2) | Uranus's fourteen inner moons, Cordelia to Mab | 1900–2100 |
| `nep098` (parts 1–3) | Neptune, Naiad to Proteus, Triton, Nereid | 1800–2200 |
| `plu060` | Pluto, Charon and the four small moons | 1800–2200 |

The kernels themselves are 11 GB, so `c/moon_cheb.c` fits them through
CSPICE into compact Chebyshev series, one file per system per year,
`public/ephemeris/moons/<system>-<year>.bin` (300 files, 74 MB for the
fifty years), and for Saturn, Uranus and Neptune a second,
`<system>-inner-<year>.bin`, with their inner moons. Each main file holds
every other moon of the system and the planet's centre, each about the system barycentre (J2000 equatorial, km, against TDB
seconds past J2000). For each body the tool picks the number of equal
intervals a year and of coefficients per interval that store it in the
fewest bytes with every position within 0.5 km of the SPK:

- Each interval is fitted at the Chebyshev–Gauss nodes of a window 10 %
  wider than itself, and the polynomial re-expanded on the interval. A
  Chebyshev fit's derivative is worst at the ends of its window (by about
  $n^2$ against $n$ inside), and the kernel's Hermite nodes use the
  velocities, so this keeps them as good at the joins as inside: the
  velocity steps where intervals meet fell from about 1 m/s to a few cm/s.
- Each interval is then pinned to the SPK's positions at its two ends by a
  straight line (no larger than the ends' own misses), so neighbouring
  intervals, and years, meet without a step.
- Coefficients are Float32 for bodies within 300,000 km of the barycentre
  and Float64 beyond: Float32 rounds the leading coefficients to $6\times
  10^{-8}$ of themselves, 0.1 km for a moon two million kilometres out,
  which would undo the pinning. The far moons move slowly and need few
  coefficients, so it costs little.
- Every interval of the fifty years is checked against the SPK at six
  points per coefficient, position and velocity, and a body that misses
  anywhere is refitted with more coefficients (Margaret, whose eccentric
  orbit swings in to 1.7 million km, needed 45 intervals a year of 18).

The worst position error per body is 0.21 to 0.48 km. Position steps where
intervals meet are under 0.05 km, from the Float32 rounding; velocities
are within a few m/s of the SPK at worst (Phobos 6 m/s, at 2.1 km/s), and
within 0.5 m/s for most.

A moon about its planet's centre is the difference of two such series, so
it is within 1 km of the SPK; the planet's centre about the barycentre is
JPL's own, with every moon's pull in it. Velocities are the series'
derivatives, so they match the positions.

The fast inner moons cost the most, about 100 kB a year each: Phobos
146 kB, Jupiter's four inner moons 440 kB between them, Saturn's nine ring
moons 520 kB, Uranus's fourteen inner moons 1.26 MB, Neptune's seven inner
moons 520 kB. The irregular moons, which take years to go round, need a few
hundred bytes. A year of a system is 44 kB (Pluto) to 1.39 MB (Uranus,
with its inner moons).

### The inner moons' span

The 29 inner moons (Saturn's nine ring moons, Uranus's fourteen and
Neptune's six inner moons) are 2.3 MB a year between them, 115 MB for the
fifty years. So the repo carries their files for 2020 to 2035 only (48
files, 35 MB; 109 MB of tables in all), and their other years are built
locally from the kernels:

```bash
npm run build:moon-tables
```

which rebuilds every table and puts the inner moons' years outside
2020–2035 in `public/ephemeris/moons-extra/` (102 files, 75 MB), which git
ignores. Where an inner moon's file is not there, that moon quietly uses
the mean elements, as every moon does after 2049; a dev server or build
made with the folder in place serves it. `moons.test.mjs` passes either
way and checks the extra years when they are present.

**Loading.** A file is fetched only when it is wanted (both of a year's
files, where there are two): on the main thread,
for the system the camera is focused on or within 30 million km of, and
for the years its moons' orbit lines span (half the longest period either
side: up to 3.8 years for Uranus's Ferdinand; the inner moons' files only
for the year about the date, since they go round in a day); in the kernel's worker, the
first time a craft comes near enough for the system to split. Until the
year has arrived, and outside 2000–2049, the moons come from the fallback
below, and the orbit lines are redrawn when it arrives. Under Node
(`moonNode.js`, which `deNode.js` imports) each year is read synchronously
the first time it is asked for, so tests see what the app sees.

### The fallback: Io, Europa, Ganymede and Callisto

astronomy-engine's `JupiterMoons`: Lieske's E5 theory of the Galilean
satellites as truncated in L1.2, giving jovicentric J2000 equatorial states.

### The fallback: JPL's mean elements for the others

From JPL's [planetary satellite mean elements](https://ssd.jpl.nasa.gov/sats/elem/) [3]
(fetched 14 November 2026). Each row is a precessing ellipse fitted by JPL to
the moon's numerically integrated orbit: $a$, $e$, $i$, the argument of
periapsis $\omega$, the mean anomaly $M$ and the node $\Omega$ at the epoch
2000-01-01.5 TDB, the period $P$ and the precession periods of $\omega$ and
$\Omega$. Mars's and Saturn's moons are referred to each moon's own Laplace
plane, given by its pole (right ascension and declination in the ICRF); the
Laplace plane is the plane about which the moon's orbit pole precesses.
Uranus's, Neptune's and Pluto's are referred to the planet's equator.

At $t$ days TDB after the epoch:

$$
M = M_0 + \frac{360°\,t}{P} + \delta M + \delta n\,t,\qquad
\omega = \omega_0 + \delta\omega + \frac{360°\,t}{P_\omega},\qquad
\Omega = \Omega_0 + \delta\Omega \mp \frac{360°\,t}{P_\Omega},
$$

the node regressing ($-$) for a prograde orbit and advancing for Triton's
retrograde one. Kepler's equation gives the position in the orbit plane,
which is turned by $R_z(\Omega)\,R_x(i)\,R_z(\omega)$ into the reference
plane. The reference plane's axes in the ICRF are its ascending node on the
ICRF equator, $\hat N = (-\sin\alpha_p, \cos\alpha_p, 0)$, its pole
$\hat P$ from $(\alpha_p, \delta_p)$, and $\hat P \times \hat N$; $\Omega$
is measured from $\hat N$, as JPL defines it.

The planet's equator for Uranus is taken about the pole its moons orbit
(right-handed), which is the opposite of the IAU's "north" pole for Uranus:
with the IAU pole every Uranian moon ran backwards.

Velocities, which the data plate shows, are a central difference of the
position over 10 seconds. The Galilean moons' are differenced too:
`JupiterMoons`'s own velocities differ from its positions' rate by up to
3 m/s, too much for the kernel's interpolation
([kernel](../physics/nbody-kernel.md#body-positions-between-ephemeris-calls)).

### The fitted corrections

The table's own warning says its mean elements are not meant for ephemeris
work, and as given they do not hold a moon's place:

- the periods are rounded, Phobos's to four digits (0.3187 d), which loses
  80° of Phobos's orbit every five years;
- $P$ is the period of the mean longitude in some planets' rows (Mars,
  Saturn) and of the mean anomaly in others (Jupiter);
- Saturn's and Uranus's epoch angles disagree with Horizons at the epoch
  itself, by up to 160°.

So each element moon carries four corrections, $\delta M$, $\delta n$,
$\delta\omega$ and $\delta\Omega$ (the `fit` in `moons.data.js`), fitted to
JPL Horizons planetocentric ICRF vectors: first $\delta M$ and $\delta n$ from
the along-track angle on six-hourly samples over two months of 2010 (which
cannot alias for a rate error under 720° a day), then all four by
damped Gauss-Newton on weekly samples from 2000 to 2050. $a$, $e$, $i$, the
reference planes and the precession periods stay JPL's. The fit's residual
over the fifty years is in `moons.data.js` (`rmsKm`, `maxKm`).

Mimas is left about 70,000 km out (rms; about 22° of its orbit) because it
librates by 44° over 71 years in its resonance with Tethys, which no
precessing ellipse can follow.

## Planets drawn at their centres

The ephemeris (DE442's table, and astronomy-engine outside 2000–2050)
places Mars to Pluto at their system barycentres, which is what the kernel
pulls toward far from them. With moons drawn, the scene puts
each planet at its own centre instead (and so does the kernel near it),

$$
\mathbf r_\text{planet} = \mathbf r_\text{bary} - \sum_i \frac{GM_i}{GM_\text{system}}\,\mathbf r_i,
$$

over the moons here ($\mathbf r_i$ planetocentric), and each moon at
$\mathbf r_\text{planet} + \mathbf r_i$. The offset is 2,130 km for Pluto
(Charon holds 11 % of the system's mass), so Pluto visibly swings about a
point outside itself; it is up to 310 km for Saturn, 210 km for Jupiter
and 74 km for Neptune. The data plate's orbital period for a planet still
uses the barycentre's state and the system GM.

## How right they are

`npm test` runs `moons.test.mjs` against Horizons vectors that were not used
in any fit (`packages/physics/src/fixtures/moons_horizons.json`): daily over November
2026, and on 1 January of each year 2000 to 2050. The fixture is rounded to
0.1 km.

### From the tables

Every one of the 75 moons Horizons serves is within 0.6 km of it, about its
planet's centre (S/2025 U 1, found in 2025, is not in Horizons yet; its
table is checked against `ura184` alone):

| | Nov 2026, daily | 2000–2050, yearly |
| --- | ---: | ---: |
| worst | 0.58 km (Styx) | 0.09 km (Mimas) |
| typical | 0.25–0.45 km | 0.07–0.08 km |

The yearly samples fall on 1 January, where every interval is pinned to the
SPK, so what is left there is the fixture's rounding; the daily ones fall
anywhere in an interval. The planet's centre about its barycentre is within
0.35 km of Horizons for every system (Pluto's offset is 2,130 km).

Horizons serves the same solutions the tables are fitted to, with one
exception found on the way: for Neptune it serves `nep098` (2026), and the
older `nep097`'s Triton is 275–385 km from it, so the tables use `nep098`.

On Juno's 2021 Ganymede flyby the kernel now follows JPL's reconstruction to
22.7 km nine hours on with these moons, the same as with Horizons' own
(22.9 km); with the fallback's Ganymede it was 323 km
([validation](../validation.md#moon-and-planet-flybys-flybytestmjs)).

### From the fallback

Before 2000, after 2049, and until a year has loaded. Largest distance from
Horizons, km:

| Moon | $a$ (km) | Nov 2026 | 2000–2050 | Source |
| --- | ---: | ---: | ---: | --- |
| Phobos | 9,375 | 595 | 606 | elements |
| Deimos | 23,457 | 38 | 155 | elements |
| Io | 421,800 | 132 | 251 | JupiterMoons |
| Europa | 671,100 | 175 | 177 | JupiterMoons |
| Ganymede | 1,070,400 | 303 | 296 | JupiterMoons |
| Callisto | 1,882,700 | 513 | 645 | JupiterMoons |
| Mimas | 186,000 | 86,476 | 136,881 | elements |
| Enceladus | 238,400 | 1,786 | 1,838 | elements |
| Tethys | 295,000 | 9,051 | 9,787 | elements |
| Dione | 377,700 | 607 | 631 | elements |
| Rhea | 527,200 | 596 | 927 | elements |
| Titan | 1,221,900 | 1,346 | 1,583 | elements |
| Iapetus | 3,561,700 | 9,941 | 10,984 | elements |
| Miranda | 129,846 | 850 | 3,767 | elements |
| Ariel | 190,929 | 338 | 1,086 | elements |
| Umbriel | 265,986 | 298 | 593 | elements |
| Titania | 436,298 | 758 | 1,629 | elements |
| Oberon | 583,511 | 1,999 | 2,175 | elements |
| Triton | 354,800 | 141 | 240 | elements |
| Charon | 19,600 | 29 | 29 | elements |
| Metis, Adrastea | 128,000 | 233 | 237 | elements |
| Amalthea, Thebe | 181,400–221,900 | 277 | 1,529 | elements |
| Methone, Helene, Polydeuces, Telesto, Calypso | 194,700–377,600 | 189,656 | 191,233 | elements |
| Hyperion | 1,481,500 | 521,580 | 774,561 | elements |
| Phoebe | 12,929,400 | 441,891 | 485,781 | elements |
| Uranus's irregular moons | 4.3–20.4 million | up to 7.8 million | up to 16.4 million | elements |
| Naiad | 48,300 | 6,981 | 7,038 | elements |
| Nereid | 5,513,900 | 84,069 | 94,519 | elements |
| Styx, Nix, Kerberos, Hydra | 43,200–65,200 | 4,362 | 4,445 | elements |

So apart from Mimas the twenty major moons are within 3 % of their orbits'
radii, most within 0.3 %, and the error does not grow across 2000 to 2050.
Outside those years the fitted rates carry on, and the error grows. The
small moons' elements do worse: the co-orbital and resonant moons
(Methone, Helene, Polydeuces, Telesto, Calypso) librate, Hyperion's orbit
is chaotic in its resonance with Titan, and the irregular moons, Phoebe and
Nereid are pulled about by the Sun far more than a precessing ellipse
allows (Uranus's irregular moons' rows are referred to the ecliptic at
2020, as JPL gives them). They are a placeholder only.

The fallback's planet centre about its barycentre, from the moons' GMs,
agrees with Horizons to 0.05 km for Jupiter, 0.3 km for Saturn, 0.9 km for
Uranus, 0.07 km for Neptune and 3 km for Pluto (Charon's 29 km times its
11 % share).

### Which point each position is

Every error above is the moon about its planet's **body centre**, on both
sides: the Horizons vectors are about the planet's centre (Titan about 699,
not the Saturn barycentre 6 nor the solar system barycentre), geometric
(no light time), ICRF, TDB, and `moons.js` gives the moon about the
planet's centre too (`JupiterMoons` is documented as jovicentric, about
Jupiter's centre). `moons.test.mjs` checks the rest of the chain:

- **DE442's planets are system barycentres** by construction (NAIF 4 to 9),
  and the table's are within 0.2–1.7 km of Horizons' for Mars, Saturn and
  Pluto. Jupiter, Uranus and Neptune differ by 14, 1,231 and 352 km,
  which is DE440 (what Horizons serves for them) against DE442
  ([ephemerides](../physics/ephemerides-and-gm.md#why-it-matters)).
- **astronomy-engine's planets are system barycentres** too. Its error against
  JPL changes slowly over a month, so astronomy-engine minus a Horizons
  point, less a quadratic in time, leaves only what moves with the moons.
  Against the barycentre (5, 6, ...) that is 1.1–1.2 km rms; against the
  planet's centre (599, 699, ...) it is the moons' whole pull: 137 km for
  Jupiter, 274 km for Saturn, 26 km for Uranus, 73 km for Neptune, 2,116 km
  for Pluto. (Mars's moons move it by millimetres, so there the two cannot
  be told apart, and it does not matter.)
- **About the barycentre**, the moon as the scene composes it (about the
  centre, plus the centre's offset) has the same error as about the centre:
  Charon 26 km, which would be 2,139 km with the offset left out.
- **About the Sun** (the scene's origin is the Sun's centre, not the solar
  system barycentre), a moon is now within the figures above too: Triton
  141 km, Charon 26 km. On astronomy-engine it was off by its planet's
  error, 16,000 km for Jupiter up to 335,000 km for Neptune, and so was its
  planet: the system moves as one.
- Horizons' own frames agree with one another to 0.14 km (moon about the
  barycentre against moon about the centre plus centre about the
  barycentre), the rounding of the fixture.

## Physical data

Radius, GM and geometric albedo come from each moon's JPL Horizons object
page (fetched 14 November 2026). Where Horizons gives a triaxial shape
(Phobos, Deimos, Ariel, Miranda, Telesto, Calypso, Methone, Polydeuces) the
radius is that of the sphere of equal volume; where it gives a mass and no
GM (Phobos, Deimos), $GM = G\,m$ with the CODATA 2018 $G$. Where it gives
no albedo (Charon, Pluto's four small moons, Methone, Polydeuces, Uranus's
irregular moons) the moon is drawn at 0.3.

The small moons are less well known:

- **No GM** for Methone, Polydeuces, Nereid and Uranus's ten irregular
  moons (none has been measured). The data plate says so; none of them is
  in the kernel, and with the tables the planet's offset from its
  barycentre is JPL's own, so nothing needs one.
- **No measured size** for eight of the irregular moons: Horizons gives
  Caliban about 30 km and Sycorax about 60 km, Prospero only under 50 km,
  and the rest nothing (they are seen only as points of light; sizes in the
  literature are estimates from an assumed albedo). Those eight are drawn
  at a nominal 10 km, and the data plate says so (`radiusNote`).

JPL's [physical-parameters table](https://ssd.jpl.nasa.gov/sats/phys_par/) [4]
lists only the moons with a measured mass, so it adds nothing here.

## Drawing

- **Surfaces:** USGS Astrogeology global mosaics on fourteen of them
  (Phobos, Deimos, the Galilean moons, Saturn's moons but Titan, Triton and
  Charon), grey maps drawn in the moon's mean colour; Titan and the Uranian
  moons stay plain spheres in that colour
  ([textures](textures.md#the-moons-maps)). All are lit like the planets
  ([lighting](lighting.md)), with Lommel-Seeliger scattering for all but
  Titan, whose haze is closer to Lambert.
  ![The fourteen mapped moons, 3.2 radii out at 35° phase, 14 November 2026: Io, Europa, Ganymede, Callisto, Phobos, Deimos and Mimas; Enceladus, Tethys, Dione, Rhea, Iapetus, Triton and Charon](moons-maps.jpg)
- **Turning:** each moon turns by its IAU rotation model [5] from NAIF's
  pck00011 [6], pole and prime meridian with their libration terms
  ([orientation](../physics/orientation.md#the-planets-moons)), the frame
  the USGS maps are made in. All of them turn once each orbit; the
  Uranian moons and Triton turn backwards about the IAU north pole.
- **Shape:** each is its IAU triaxial ellipsoid, long axis toward the
  planet (Phobos 26 × 23 × 18 km, Mimas 416 × 393 × 381 km).
- **Shadows:** a planet takes the four largest of its moons as shadow
  casters (`MAX_OCCLUDERS`), so the Galilean moons' shadows cross Jupiter,
  and a moon is eclipsed by its planet. One moon's shadow on another is not
  drawn.
- **Orbit lines:** one period about the planet's centre, sampled straight
  from the moon's model (under 2 ms a line from the tables in Node, about
  as long as from the elements), resampled like the planets'
  ([scene](scene.md#orbit-lines)), and redrawn when a year of the tables
  arrives.
- **Rail:** a planet's moons are listed under it, two to a row, while it or
  one of them is in view; otherwise its row shows how many it has (`+14`
  for Saturn, `+15` for Uranus).
  Earth's Moon is always listed.

Computing all six systems, 76 moons, takes about 0.08 ms a frame from the
tables (0.12 ms from the fallback), measured in Node.

## The irregular moons

Jupiter, Saturn and Neptune have swarms of small moons far out, on large,
eccentric and steeply inclined orbits, most of them retrograde: captured
bodies, most likely, rather than moons formed with their planet [8]. The
app has all 381 that JPL's mean-elements table lists [3]: Jupiter's 107
(Himalia, Elara, Pasiphae, Sinope, Lysithea, Carme, Ananke, Leda, Themisto,
Callirrhoe and the rest, out to 24 million km), Saturn's 267 (Ymir,
Paaliaq, Kiviuq, Siarnaq, Tarvos, Ijiraq, Albiorix, Mundilfari, the 2023
batch and the rest, to 27 million km), and Neptune's 7 besides Nereid
(Halimede, Sao, Laomedeia, Psamathe, Neso and two provisional ones, Neso out
to 50 million km). 305 of them are retrograde. Uranus's ten irregular moons
and Nereid are full moons, above.

![Jupiter's irregular moons, 18 November 2026, about 34 million km out: points, labels and the orbit lines of the 64 numbered ones, each with a trail behind it](moons-irregular-jupiter.jpg)

![Jupiter's irregular moons at a month a second, seen from 50 million km: points with short trails go round on tilted orbits far outside the Galilean moons, most of them backwards](../clips/irregular-moons.webp)

They are a layer, not bodies in the rail: off by default, switched on under
**Irregular moons** in the rail. Any of them is found by name in the rail's
**FIND** field ([`find.tsx`](../../src/app/find.tsx), the `/` key), whose
**Irregular moons** group gives each one's planet and says which go round
backwards; choosing one switches the layer on if it is off ("Irregular
moons shown") and flies there. Clicking one's label flies there too. The plate then gives where it is about its planet
and from the Earth, its mean orbit (semi-major axis, eccentricity,
inclination to the ecliptic, period), which way it goes round, its radius,
GM, albedo where known, and when and by whom it was found [7], each with
its source tag. None of them pulls on spacecraft: the largest, Himalia, has
a GM of 0.152 km³/s² (Horizons), a twenty-thousandth of Europa's, and it is
the only one with a measured GM.

![Himalia flown to: its NEOWISE size and Cassini's 1.25 elongation, lit, with its plate](moons-irregular-himalia.jpg)

Code: `packages/physics/src/irregularMoons.js` (positions),
`packages/physics/src/irregularMoons.data.js` (elements, sizes, GMs, discoveries and
the fitted corrections, written by `pipelines/irregularMoons.fetch.mjs`),
`packages/physics/src/irregularMoons.test.mjs`, `src/scene/irregularMoons.ts` (the
layer) and `src/app/irregular-moon-plate.tsx`.

### Positions

- **From JPL's satellite ephemerides, 2000 to 2049:** every one of the 381,
  from the kernel JPL fits it in [1]: `jup347` (89 of Jupiter's), `jup348`
  (4), `jup349` (14), `sat456` (42 of Saturn's, the named and numbered
  ones), `sat457` (79), `sat455` (128), `sat459` (18) and `nep104`
  (Neptune's 7). `c/moon_cheb.c` fits them as it fits the other moons
  ([above](#2000-to-2049-jpls-satellite-ephemerides)), each within 0.5 km
  of its kernel, into a third file per system and year,
  `public/ephemeris/moons/<system>-irregular-<year>.bin`. A moon about its
  planet is the moon's series less the planet's centre from the system's
  main file, both about the barycentre. About the planet's centre itself
  they would carry its wobble with the Galilean moons, and cost 10 to 30
  times the bytes (19 kB a year for most of Jupiter's, against 0.7 to
  1.8 kB). These moons go round in 130 days to 27 years and most need a few
  hundred bytes to 4.5 kB a year: 119 kB a year for Jupiter's, 400 kB
  for Saturn's, 2.5 kB for Neptune's, 26.1 MB for the fifty years. The
  files are fetched only while the layer is shown, for a system within
  3 au of the camera.
- **One exception, S/2023 S 38** (`sat455`), is fitted to 1,000 km. At an
  eccentricity of 0.909 it dives to 1.1 million km from Saturn at 8 km/s
  once in its 546 days, and `sat455`'s pieces of it meet there with steps
  of a few m/s in velocity, which a polynomial follows only slowly. With
  equal intervals, 0.5 km would take some 360 a year of 70 coefficients
  and 100 km took 7.6 MB for the fifty years; 1,000 km takes 128 intervals a year of 14
  coefficients, 2.2 MB, and its worst over the fifty years is 730 km, under
  0.01 % of its orbit and only near periapsis.
- **From JPL's mean elements:** all 381 outside 2000–2049, and until a
  year of the tables has loaded. Each is a precessing ellipse in the J2000
  ecliptic, as for the other moons
  ([the fallback](#the-fallback-jpls-mean-elements-for-the-others)), with
  $\delta M$, $\delta n$, $\delta\omega$ and $\delta\Omega$ fitted to
  Horizons vectors [2] every 10 days from 2000 to 2050. As given, the
  elements put a moon near its place at their epoch (Himalia within 3 % of
  its orbit) but lose it within years: the worst over the fifty years is
  more than the orbit's whole size for most of them.

### How right they are

`irregularMoons.test.mjs` checks every one against Horizons at five dates
(2 January 2000, 1 July 2013, 18 November 2026, 1 January 2040, 1 December
2049) that no fit used. Horizons serves the same kernels for these moons.

| Source | Moons | Worst from Horizons |
| --- | ---: | --- |
| `jup347` table | 89 | 0.51 km (Hermippe) |
| `jup348` table | 4 | 0.35 km (S/2011 J 5) |
| `jup349` table | 14 | 0.37 km (S/2021 J 8) |
| `sat456` table | 42 | 0.41 km (Eggther) |
| `sat457` table | 79 | 0.48 km (S/2007 S 6) |
| `sat455` table | 128 | 0.39 km (S/2020 S 11); S/2023 S 38 0.3 km at these dates (fitted to 1,000 km) |
| `sat459` table | 18 | 0.41 km (S/2023 S 62) |
| `nep104` table | 7 | 0.29 km (Neso) |
| mean elements, Jupiter's | 107 | median 46 % of the orbit's semi-major axis, worst 73 % (S/2003 J 23, 17 million km) |
| mean elements, Saturn's | 267 | median 15 %, worst 154 % (S/2023 S 38, 20 million km) |
| mean elements, Neptune's | 7 | median 26 %, worst 60 % (Neso, 30 million km) |

The elements' rows are each planet's moons with the tables switched off,
which is what they are before 2000 and after 2049. A precessing ellipse
cannot follow these orbits. They lie a fifth to nearly half of the way to
the edge of their planet's Hill sphere, $R_H = a_p\,(m/3M_\odot)^{1/3}$
(53 million km for Jupiter, 65 for Saturn, 116 for Neptune), and there the
Sun's tidal pull against the planet's is

$$
\frac{3GM_\odot r/a_p^3}{Gm/r^2} = \left(\frac{r}{R_H}\right)^3,
$$

1 % for Himalia and 8 % for Carme and Neso: enough to swing a moon's
eccentricity, inclination and period about through each orbit [8].
Outside 2000–2049, then, a point marks the right orbit about the right
planet and not much more; the plate's source tag says `elements`, and its
note gives that moon's own residual.

### Sizes and shapes

**Sizes.** Each moon's diameter, from the best source that has it:

| Source | Moons | How |
| --- | ---: | --- |
| NEOWISE, Grav et al. 2015, Table 3 [9] | 13 | measured, from the heat they give off in the infrared: Himalia 139.6 ± 1.7 km, Elara 79.9, Pasiphae 57.8, Carme 46.7, Lysithea 42.2, Siarnaq 39.3, Sinope 35.0, Ananke 29.1, Albiorix 28.6, Leda 21.5, Callirrhoe 9.6, Praxidike 7.0, Kalyke 6.9 |
| T. Denk's table of Saturn's irregular moons [10] | 119 | estimated from the absolute magnitude $H$ for an albedo of 0.06 |
| the Minor Planet Center's discovery circulars [11] | 146 | Saturn's announced in 2025 and 2026, from the $H$ in each circular, by Denk's formula and albedo |
| S. S. Sheppard's tables of Jupiter's and Neptune's moons [12] | 103 | estimated from their brightness (the albedo is not stated) |

Denk's formula is

$$
D = 1\ \text{au}\,\frac{2}{\sqrt p}\,10^{-0.2\,(H - M_\odot)},
$$

with $p$ = 0.06 and $M_\odot$ = −26.71, the Sun's apparent V magnitude: it
gives his own table's 119 sizes from their $H$ to 4.8 %, the rounding of
$H$ to 0.1 mag and of the sizes to two figures. An estimate depends on the
albedo taken, so it is uncertain by a quarter or more: against NEOWISE's
measurements, Sheppard's estimates are 0.84 to 1.15 times them. The NEOWISE
albedos (2.9 to 6.2 %) replace Horizons' where they exist, and Horizons'
older radii, which NEOWISE supersedes, are not used.

**Shapes.** Only Himalia has been seen as more than a point: Cassini's
images give radii of 75 ± 10 by 60 ± 10 km [13]. For 22 of Saturn's, the
swing of their brightness as they turn gives the least the long axis can
be over the short one, $a/b \ge 10^{0.4\,\Delta m}$ for a lightcurve
amplitude $\Delta m$ near zero phase, and Denk et al. tabulate it [14]:
Kiviuq at least 2.32, Erriapus 1.51, Bestla 1.47, Mundilfari 1.43, down to
Loge 1.04. These 23 are drawn as ellipsoids $a \times b \times b$ of their
moon's volume (the third axis is not constrained, so it is taken as $b$);
the other 358 as spheres. The plate gives the shape, with "at least" where
it is the lightcurve's minimum.

![Kiviuq, at least 2.32 times as long as it is wide, 5.5 hours apart: a quarter of its 22-hour turn](moons-irregular-kiviuq.jpg)

**Spins.** The same table gives 24 rotation periods (Hati 5.45 h to Tarqeq
76.13 h, five marked uncertain), and Pilcher et al. give Himalia's,
7.7819 ± 0.0005 h [15]. No pole or phase is known for any of them, so a
shaped moon turns at its period about the pole of its orbit, from 0 at
J2000.

GMs and discoveries: Horizons gives a GM for Himalia only, 0.152 km³/s².
Discovery year, discoverers and announcement are from JPL's discovery
table [7]; 169 of the moons were found in 2019 or later.

### Drawing

- **Points:** a small fixed-size point for each moon of a system within
  3 au of the camera (or of the focused system): a drawing aid, like the
  markers, not a photometric star (Himalia is magnitude 15 from the Earth).
- **Labels:** for the moons within 40 million km of the camera, kept apart
  as the small bodies' are.
- **Orbit lines:** one period about the planet's centre, for the 111
  moons with an IAU number (Jupiter's 64, Saturn's 42, Neptune's 5) and for
  the one flown to, while the camera is within 1 au of the system;
  resampled after 5 % of a period or when a year of the tables arrives,
  within 2 ms a frame. All the lines are one draw. The 270 provisional ones
  (S/2019 S 1 and the like) have none: Saturn's swarm of 267 lines is a
  blur, and on an integrated GPU each line across the view costs about
  0.05 ms.
- **Flown to:** a lit body at the moon's size, its ellipsoid turning where
  it has a shape, as a named asteroid's ([small bodies](small-bodies.md)),
  with its NEOWISE albedo or a dark 0.04.

![Saturn's irregular moons, 18 November 2026, about 43 million km out: 267 labelled points, the 42 numbered ones with their orbits](moons-irregular-saturn.jpg)

**Cost.** Frame cost (docs/performance.md's method: the render callback
and a one-pixel `readPixels`, median of 4 s, 1920 × 1080 at a pixel ratio of
1, layer off then on):

| View | Intel UHD | RTX 5070 Ti |
| --- | --- | --- |
| Jupiter, 34 million km out | 12.4–14.4 → 15.0–15.7 ms | 7.3–7.5 → 6.6–7.8 ms |
| Saturn, 43 million km out | 15.3 → 15.8 ms | 8.3 → 8.3 ms |

On Intel each orbit line across the view costs about 0.05 ms: with lines
for all 267 of Saturn's moons the frame took 30 ms there, so only the 111
numbered moons have them, and all of them are one draw (one draw each cost
2.6 ms for Jupiter's 107). Placing the moons costs 0.4 to 1 ms of CPU a frame for a
system in view.

## Not yet

- **Before 2000 and after 2049** the moons are the fallback's. The kernels
  reach 1600 to 2400 (Mars's short file only 1995 to 2050), so the span
  could grow at about 1.2 MB a year of tables; past 2050 the planets
  themselves come from astronomy-engine (16,000 to 335,000 km out), so it
  would buy less.
- **Unequal intervals** for very eccentric moons: S/2023 S 38 is fitted to
  100 km because its 546-day orbit packs its fast motion into a few days at
  periapsis, and the tables' equal intervals spend that resolution all
  year. Saturn's Daphnis, Neptune's and Uranus's newest moons and the rest
  of Saturn's ring moons are in other kernels.
- **The irregular moons' poles**: none is known, so the shaped ones turn
  about their orbit's pole; and the third axis of each shape.
- **The moons' gravity fields beyond degree 2.** Io, Europa, Ganymede,
  Callisto and Titan carry their $J_2$ and $C_{22}$
  ([kernel](../physics/nbody-kernel.md#the-moons-own-fields)); the others
  are point masses.
- Surface maps for Titan (visible haze rather than surface) and the Uranian
  moons (no digital global mosaic; Voyager 2 saw only their southern
  hemispheres), and Iapetus's full albedo contrast, which the USGS mosaic
  flattens.
- Mimas's libration, which a sinusoidal term in its mean longitude could
  hold, for the fallback.

## Updating the data

```bash
npm run fetch:moons
```

It downloads the elements page and the Horizons headers and vectors into
`~/.cache/digital-orrery/moons` (delete the folder to fetch afresh), refits,
and rewrites `moons.data.js` and `fixtures/moons_horizons.json`.

The tables come from the kernels with `c/moon_cheb.c`
([c/README.md](../../c/README.md#the-moons-for-the-app)):

```bash
npm run build:moon-tables
```

([The inner moons' span](#the-inner-moons-span) says what it writes where.)

The irregular moons' elements, sizes, discoveries, fitted corrections and
Horizons check vectors:

```bash
npm run fetch:irregular-moons
```

It caches its downloads in the same folder (about 1,100 Horizons requests,
four at a time, about 20 minutes the first time) and rewrites
`irregularMoons.data.js` and `fixtures/irregular_moons_horizons.json`.
Their tables come with the others from `npm run build:moon-tables`, or alone
with `MOON_PARTS=irregular` ([c/README.md](../../c/README.md#the-moons-for-the-app)).

## References

[1] NAIF, "Generic kernels: satellite SPK ephemerides." [Online]. Available: https://naif.jpl.nasa.gov/naif/data_generic.html

[2] JPL Solar System Dynamics, "Horizons system." [Online]. Available: https://ssd.jpl.nasa.gov/horizons/

[3] JPL Solar System Dynamics, "Planetary satellite mean elements." [Online]. Available: https://ssd.jpl.nasa.gov/sats/elem/

[4] JPL Solar System Dynamics, "Planetary satellite physical parameters." [Online]. Available: https://ssd.jpl.nasa.gov/sats/phys_par/

[5] B. A. Archinal et al., "Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015," *Celest. Mech. Dyn. Astron.*, vol. 130, art. no. 22, 2018, doi: 10.1007/s10569-017-9805-5.

[6] NAIF, "pck00011.tpc, generic text PCK." [Online]. Available: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/

[7] JPL Solar System Dynamics, "Planetary satellite discovery circumstances." [Online]. Available: https://ssd.jpl.nasa.gov/sats/discovery.html

[8] D. Jewitt and N. Haghighipour, "Irregular satellites of the planets: Products of capture in the early solar system," *Annu. Rev. Astron. Astrophys.*, vol. 45, pp. 261–295, 2007, doi: 10.1146/annurev.astro.44.051905.092459.

[9] T. Grav, J. M. Bauer, A. K. Mainzer, J. R. Masiero, C. R. Nugent, R. M. Cutri, S. Sonnett and E. Kramer, "NEOWISE: Observations of the irregular satellites of Jupiter and Saturn," *Astrophys. J.*, vol. 809, art. no. 3, 2015, doi: 10.1088/0004-637X/809/1/3.

[10] T. Denk, "Irregular moons of Saturn: overview table," 20 May 2025. [Online]. Available: https://tilmanndenk.de/wp-content/uploads/OSM_7_Table.txt

[11] Minor Planet Center, MPECs 2025-E153, 2025-E154, 2025-E155, 2026-F14 and 2026-G68 to G75. [Online]. Available: https://minorplanetcenter.net/mpec/

[12] S. S. Sheppard, "Moons of Jupiter" and "Moons of Neptune," Carnegie Science. [Online]. Available: https://sites.google.com/carnegiescience.edu/sheppard/moons

[13] C. C. Porco et al., "Cassini imaging of Jupiter's atmosphere, satellites, and rings," *Science*, vol. 299, pp. 1541–1547, 2003, doi: 10.1126/science.1079462.

[14] T. Denk, S. Mottola, F. Tosi, W. F. Bottke and D. P. Hamilton, "The irregular satellites of Saturn," in *Enceladus and the Icy Moons of Saturn*, Univ. Arizona Press, 2018, Table 3, doi: 10.2458/azu_uapress_9780816537075-ch020.

[15] F. Pilcher, S. Mottola and T. Denk, "Photometric lightcurve and rotation period of Himalia (Jupiter VI)," *Icarus*, vol. 219, pp. 741–742, 2012, doi: 10.1016/j.icarus.2012.03.021.
