# Ephemerides, barycentres and GM values

## Two ephemeris sources

| | Used by | Accuracy |
| --- | --- | --- |
| **DE442** through SPICE (`python/data/metakernel.tm`) | the reference fixture, the C generator, the Python scripts | JPL's fit to radar, spacecraft tracking and occultations; the reference |
| **DE442 table** (`src/physics/deTable.js`) | every planet, Pluto, the Moon and the SSB in the browser app and the kernel, 2000–2050 | Chebyshev series fitted to DE442: worst 0.3 mm (Moon), 3.7 mm (Earth), under 0.86 m for every body about the Sun; the Earth's acceleration within 1.5×10⁻⁹ m/s² |
| **astronomy-engine** (`src/physics/ephemeris.js`) | every body outside the table (2000–2050, plus the margins it blends over), or if it fails to load | measured against DE442: within 2.3×10⁻⁵ of the distance and 1.3 m/s for Venus, Earth and Mars; within 9.3×10⁻⁵ and 9.4 m/s for all eight planets (`porkchop.test.mjs` case 1a); its Moon is 9–13 km from DE442's |

## DE442 in the app

Every planet, Pluto and the Moon come from DE442 itself between 2000 and
2050. Earth and the Moon came first, as they matter most to what the app
flies; the planets followed because astronomy-engine's are hundreds to
hundreds of thousands of kilometres out ([below](#why-it-matters)).
- **The fit:** `c/de_cheb.c` fits Chebyshev series to DE442 through CSPICE,
  all in J2000 equatorial km against TDB:

  | Series | Relative to | Interval | Coefficients | Margin and blend | Worst about the Sun |
  | --- | --- | ---: | ---: | ---: | ---: |
  | Moon | Earth | 8 d | 18 | 30 d | 0.4 mm (about Earth) |
  | Earth-Moon barycentre | Sun | 16 d | 14 | 30 d | 3.6 mm (Earth) |
  | Mercury | Sun | 16 d | 16 | 30 d | 0.15 m |
  | Venus | Sun | 32 d | 13 | 30 d | 0.06 m |
  | Mars barycentre | Sun | 32 d | 12 | 60 d | 0.03 m |
  | Sun | SSB | 32 d | 12 | 8 yr (SSB blend 1 yr) | 0.03 m (about the SSB) |
  | Jupiter barycentre | SSB | 128 d | 10 | 1 yr | 0.15 m |
  | Saturn barycentre | SSB | 256 d | 11 | 1 yr | 0.34 m |
  | Uranus barycentre | SSB | 512 d | 12 | 2 yr | 0.84 m |
  | Neptune barycentre | SSB | 1,024 d | 12 | 4 yr | 0.86 m |
  | Pluto barycentre | SSB | 1,024 d | 12 | 8 yr | 0.77 m |

- **The outer planets about the SSB:** relative to the Sun, an outer planet
  carries the Sun's own wobble (450 km a year from the Earth, 260 km every
  225 days from Venus), which needs short intervals. About the SSB it moves
  on a smooth arc that 10 to 12 coefficients cover for a year or more. The
  app subtracts the Sun's series (planet minus Sun); the last column is
  that difference against SPICE's heliocentric position. The Sun's series
  is also the app's SSB, DE442's own (every body JPL integrates, asteroids
  included).
- **Lengths and degrees** were chosen to keep every body under a metre
  with the smallest file: a 0.8 m error is 10⁻¹⁰ of Neptune's distance.
  The accelerations follow DE442 to 10⁻⁹ m/s² and jump at the joins by
  under 7×10⁻⁹ m/s² (Mercury); the others under 2×10⁻⁹. `DAYS_<id>` and
  `N_<id>` override a series' interval and coefficients when refitting.
- **The Earth** is derived, as JPL's own ephemerides store it:
  $\mathbf r_\oplus = \mathbf r_{EMB} - k\,(\mathbf r_{☾} - \mathbf r_\oplus)$
  with $k = GM_☾/(GM_\oplus + GM_☾) = 0.0121505844$ (stored in the file).
  - **Why:** the barycentre moves smoothly, but the Earth swings 4,700 km
    round it every month.
  - **The old fit:** a series of the Earth itself held its position to
    0.48 m, but its acceleration rippled by 10⁻⁸ m/s² and jumped by up to
    2×10⁻⁶ m/s² at the joins between intervals.
  - **Why acceleration matters:** an orbit about the Earth follows the
    table's Earth. NASA's Sun-and-Moon check case
    ([6-DOF](sixdof.md#the-apps-kernel-on-the-same-cases)) flown by the
    kernel was 0.62 m off after 8 hours on the old table and 0.12 m on
    this one. The rest was DE442's own floor, which Encke's tidal form
    keeps out of the motion about the Earth: 5 mm
    ([Encke's method](nbody-kernel.md#enckes-method)).
- **The file:** `public/ephemeris/de442-2000-2050.bin`, 2.5 MB (format 3):
  1.4 MB for the Earth and Moon, 1.1 MB for the rest, most of it Mercury.
  Each series's header names its target and centre by NAIF code.
- **Accuracy:** checked between the fitting nodes against `spkezr_c`:
  - **Position:** worst 0.3 mm for the Moon, 3.7 mm for the barycentre
    and 3.7 mm for the derived Earth; the planets as in the table.
  - **Acceleration:** the derived Earth within 1.5×10⁻⁹ m/s² of a second
    difference of SPICE's positions.
  - **Joins:** jumps under 3 mm, 0.2 mm/s and 5×10⁻¹¹ m/s².

  Against the forces on the Earth (Sun, planets, Moon), the table's
  acceleration agrees to 2.7×10⁻⁹ m/s², with a steady 2×10⁻¹⁰ m/s² from
  what DE442 adds (relativity, asteroids). That scatter is the floor of
  DE442's own Chebyshev records.
- **Loading:** `deLoad.js` fetches the table on the main thread before the
  app is imported, and in each worker before its first job. Under Node,
  `deNode.js` loads it as the first import of every test.
- **Time:** the app's clock is UTC, converted to TDB by `timescale.js`.

Through that path, Earth at MSL's launch is 0.09 m from SPICE, and all
eight planets at the fixture's epochs are within 2.8 m (Mercury at J2000,
whose UTC is rounded to a millisecond; `porkchop.test.mjs` case 1). Over
Artemis II the Moon stays within 0.8 m of DE442, which is the millisecond
rounding of the fixture's times.

### Why it matters

- The Moon from astronomy-engine is 9–13 km from DE442's. Predicting
  Artemis II through the lunar flyby, that is 49 km of error against 3.6 km
  with DE442 ([validation](../validation/artemis2.md)).
- Earth's heliocentric position from astronomy-engine is up to about
  3,400 km off DE442's.
- astronomy-engine's system barycentres against JPL Horizons, November 2026
  (`moons.test.mjs`): Mars 1,809 km, Jupiter 16,275 km, Saturn 69,172 km,
  Uranus 85,433 km, Neptune 335,209 km, Pluto 141,082 km. A flyby aimed by
  the kernel misses by that much, and a moon drawn about its planet is
  carried with it.
- From the table, the same barycentres are 0.2 km (Mars), 14.1 km
  (Jupiter), 0.3 km (Saturn), 1,231 km (Uranus), 352 km (Neptune) and
  1.7 km (Pluto) from Horizons. All of that is DE440 against DE442:
  Horizons serves DE440 for the planets (its rows match DE440 through
  SPICE to 0.08 km, the fixture's rounding), and DE442 moved Uranus with
  new occultations and Jupiter with more Juno ranging ([below](#de442-against-de440)).
  Horizons' planet centres (x99, from its satellite solutions) put Uranus
  and Neptune where DE442 does: the table's barycentre plus Horizons'
  centre offset is 0.07–0.28 km from them for Mars, Saturn, Uranus and
  Neptune.

### At the table's ends

Beyond the table, or if it fails to load, ephemeris.js falls back to
astronomy-engine (with a console warning). Handing over at once would make
each body jump by astronomy-engine's error there, up to 260,000 km (Pluto,
in 2051). That would put a kink in every orbit line that spans the edge
(Uranus's, Neptune's and Pluto's always do), and a leap under a craft
flying across it.

So each series runs past 2000–2050 by a margin, and over that margin the
app blends one into the other. With $s$ the fraction of the blend from the
table's end and $w = 10s^3 - 15s^4 + 6s^5$ (smooth to the second
derivative):

$$
\mathbf r = \mathbf r_\text{AE} + w\,(\mathbf r_\text{DE} - \mathbf r_\text{AE}),\qquad
\mathbf v = \mathbf v_\text{AE} + w\,(\mathbf v_\text{DE} - \mathbf v_\text{AE}) + \dot w\,(\mathbf r_\text{DE} - \mathbf r_\text{AE}).
$$

- **The core is untouched:** 2000-01-01 12:00 TDB to 2051-01-01 is DE442
  alone, and the plate's tags say DE442 only there.
- **Blend lengths** grow with the jump. The ramp itself adds an
  acceleration $2\dot w\,\Delta\mathbf v + \ddot w\,\Delta\mathbf r$, up
  to about $5.8\,\Delta r/T^2$. The lengths keep that under 1 % of the
  Sun's pull: 0.02 % for Earth, 0.55–0.6 % for Saturn to Neptune, 0.8 % for
  Pluto (`deTable.test.mjs`).
- **Earth and the Moon** share one length, so the Moon about the Earth
  blends as one too. A planet's moons ride on their planet.
- **The SSB** blends into the sum over every body that barycentres.js uses
  beyond the table.
- **Checked** (`deTable.test.mjs`): at each end every body is within a
  millimetre of astronomy-engine. Inside the blend the velocity is the
  positions' derivative to 0.3 mm/s, as close as astronomy-engine's own;
  Pluto's own velocities are 0.25 m/s off its positions, and the kernel
  differences them. Through the kernel's TT path, nothing jumps across the
  end.
- **The cost:** 0.1 MB of file, and astronomy-engine as well as the table
  for bodies inside a blend.

## What DE442 contains, and what the satellite kernels add

DE442 (JPL, February 2025) integrates the Sun, planets, Moon and 343 asteroids
together and fits them to observations. It updates DE440 with Uranus
occultation data, more Mars orbiter ranging and four more years of Juno
ranging. Its file gives:

- the Sun, Mercury, Venus, Earth and the Moon as **bodies**, and
- Mars to Pluto only as **system barycentres** (the planet and its moons
  together).

Planet centres and moons come from NAIF's satellite kernels, each giving
bodies relative to their system barycentre. SPICE chains them:

$$
\mathbf r_\text{Io/SSB} = \mathbf r_\text{Io/Jupiter bary}\ (\texttt{jup365}) + \mathbf r_\text{Jupiter bary/SSB}\ (\texttt{de442}).
$$

The meta-kernel loads `mar099s`, `jup365`, `sat441`, `ura184_part-3`,
`nep097`, `plu060` and JPL's `sb441-n16` (the 16 perturber asteroids). Load
order matters: SPICE uses the last-loaded kernel that covers a body, and every
satellite kernel carries its own older copy of the barycentres, so
**`de442.bsp` is loaded last**. Checked with CSPICE: with everything loaded,
the Sun, every system barycentre, Earth and the Moon are identical to DE442
alone, and all 29 planet centres, major moons and asteroids tried resolve
against the SSB. Together the files cover 1995-2049, set by the short-span
Mars file.

### DE442 against DE440

Position differences from the same CSPICE build (2000-2040):

| Body | Change |
| --- | --- |
| Mercury, Venus, Earth, Moon | under 20 m |
| Mars barycentre | up to 0.32 km |
| Jupiter barycentre | 3-14 km (Juno ranging) |
| Saturn barycentre | under 0.4 km |
| Neptune barycentre | 60-640 km |
| Uranus barycentre | 360-2,900 km (new occultation data) |

## GM must match what the position is

A body placed at its **system barycentre** must pull with the **system's**
GM (planet plus moons). A planet-only GM there leaves out the moons. This was
a bug until the DE442 change: the kernel used planet-only values (NAIF
`599`, `699`, ...) at barycentre positions, so the pull was too weak by

$$
\frac{\mu_\text{system}}{\mu_\text{planet}} - 1 = 2.07\times10^{-4}\ (\text{Jupiter}),\quad
2.47\times10^{-4}\ (\text{Saturn}),\quad 2.08\times10^{-4}\ (\text{Neptune}).
$$

`src/physics/bodies.js` now uses:

| Body in the kernel | Position | GM (km³/s²) |
| --- | --- | --- |
| Sun | Sun centre (origin) | 1.32712440041253311×10¹¹ |
| Mercury, Venus | planet (no moons) | 2.20318685514×10⁴, 3.24858592×10⁵ |
| Earth | Earth centre (399) | 3.98600435543531×10⁵ |
| Moon | Moon centre (301) | 4.90280010414135×10³ |
| Mars to Pluto, far from them | system barycentre | DE442 system values (Pluto's within 5 AU of it only) |
| Mars to Pluto, near them (split) | planet centre (499, 599, ...) | planet-only values from the NAIF satellite kernels (`PLANET_GM`) |
| their 20 major moons, near their planet | moon centre | each moon's GM from Horizons ([moons](../frontend/moons.md#physical-data)) |

(`constants.js` keeps the planet-only GMs for planet-centred uses such as
escape from the planet itself.)

### Where the DE442 GMs come from

NAIF publishes `gm_de440.tpc` but no `gm_de442.tpc`. DE442's technical
comments (`spk/planets/de442_tech-comments.txt`) list each GM in AU³/day².
`python/data/gm_de442.tpc` converts them:

$$
\mu\ [\text{km}^3/\text{s}^2] = \mu\ [\text{AU}^3/\text{day}^2]\times\frac{(149\,597\,870.7)^3}{86\,400^2}.
$$

The result matches the same table's km³/s² column to its printed precision
(worst 2.9×10⁻¹¹ relative). In DE's numbering GM3 is the Earth itself (NAIF
399) and GMB the Earth-Moon barycentre (NAIF 3). `nbody.test.mjs` case 12
checks every kernel GM against the value SPICE reads from that file (worst
5.9×10⁻¹⁶) and that the giant planets carry their moons.

## Planet systems near them

From far away a planet system is one mass at its barycentre. Close in, the
moons matter (the Galilean moons near Jupiter, Titan near Saturn). So,
within 1.25 times a planet's sphere of influence, the kernel switches from
the barycentre to the planet at its centre and its major moons as separate
bodies, each with its own GM (the table above). The planet-only GM and the
centre go together, as the system GM and the barycentre do. The positions
are `moons.js`'s, not the satellite kernels': see
[the kernel](nbody-kernel.md#moons).

## Sources

- R. S. Park et al., "The JPL Planetary and Lunar Ephemerides DE440 and
  DE441", *Astronomical Journal* 161:105 (2021); DE442 technical comments
  (NAIF, 2025).
- NAIF generic kernels: `spk/planets`, `spk/satellites` and their
  `aa_summaries.txt`; JPL Solar System Dynamics, `sb441-n16`.
