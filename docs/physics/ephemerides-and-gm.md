# Ephemerides, barycentres and GM values

## Two ephemeris sources

| | Used by | Accuracy |
| --- | --- | --- |
| **DE442** through SPICE (`python/data/metakernel.tm`) | the reference fixture, the C generator, the Python scripts | JPL's fit to radar, spacecraft tracking and occultations; the reference |
| **DE442 Earth–Moon table** (`src/physics/deTable.js`) | Earth and the Moon in the browser app and the kernel, 2000–2050 | Chebyshev series fitted to DE442: worst 0.3 mm (Moon) and 3.6 mm (Earth); the Earth's acceleration within 1.5×10⁻⁹ m/s² |
| **astronomy-engine** (`src/physics/ephemeris.js`) | the other planets, and Earth and the Moon outside 2000–2050 | measured against DE442: within 2.5×10⁻⁵ of the distance and 1.3 m/s for Venus, Earth and Mars; within 9.3×10⁻⁵ and 9.5 m/s for all eight planets (`porkchop.test.mjs` case 1); its Moon is 9–13 km from DE442's |

## DE442 in the app

Earth and the Moon matter most to the precision of what the app flies, so
they come from DE442 itself.
- **The fit:** `c/de_cheb.c` fits Chebyshev series to DE442 through CSPICE:
  - the Moon relative to Earth: 8-day intervals, 18 coefficients;
  - the Earth-Moon barycentre relative to the Sun: 16-day intervals, 14
    coefficients;
  - both in J2000 equatorial km against TDB.
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
- **The file:** `public/ephemeris/de442-earth-moon-2000-2050.bin`, 1.4 MB
  (format 2).
- **Accuracy:** checked between the fitting nodes against `spkezr_c`:
  - **Position:** worst 0.3 mm for the Moon, 3.7 mm for the barycentre
    and 3.6 mm for the derived Earth.
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

Through that path, Earth at MSL's launch is 0.09 m from SPICE. Over Artemis
II the Moon stays within 0.8 m of DE442, which is the millisecond rounding
of the fixture's times.

Why it matters:
- The Moon from astronomy-engine is 9–13 km from DE442's. Predicting
  Artemis II through the lunar flyby, that is 49 km of error against 3.6 km
  with DE442 ([validation](../validation/artemis2.md)).
- Earth's heliocentric position from astronomy-engine is up to about
  3,400 km off DE442's.

Outside 2000–2050, or if the table fails to load, ephemeris.js falls back to
astronomy-engine (with a console warning), with a jump of that size at the
boundary. The other planets will follow the same way.

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
| Mars to Neptune | system barycentre | DE442 system values |

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

## Next: planet systems inside their sphere of influence

From far away a planet system is one mass at its barycentre. Close in, the
moons matter (the Galilean moons near Jupiter, Titan near Saturn). The plan is
to switch, inside a planet's sphere of influence, from the barycentre to the
planet and its major moons as separate bodies with their own GMs, using
positions from the satellite kernels.

## Sources

- R. S. Park et al., "The JPL Planetary and Lunar Ephemerides DE440 and
  DE441", *Astronomical Journal* 161:105 (2021); DE442 technical comments
  (NAIF, 2025).
- NAIF generic kernels: `spk/planets`, `spk/satellites` and their
  `aa_summaries.txt`; JPL Solar System Dynamics, `sb441-n16`.
