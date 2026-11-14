# CSPICE reference generator

`orrery_spice_ref.c` uses NAIF's CSPICE toolkit and the DE442 ephemeris to write
`src/physics/fixtures/spice_reference.json`. The JavaScript tests (`node src/physics/orbital.test.mjs`)
read that file, so they need neither SPICE nor a build to run, but every number they check against comes
from JPL's own toolkit.

The fixture holds:

- 64 two-body cases (40 elliptic, 8 near-parabolic sweeping periapsis, 16 hyperbolic), built with `conics_c`,
  propagated with `prop2b_c` and converted to elements with `oscltx_c`;
- the heliocentric J2000 states of Earth at MSL's launch (2011-11-26 15:02 UTC) and of the Mars system
  barycentre at its arrival (2012-08-06 05:17 UTC), from `spkezr_c`;
- the states of Mercury to Neptune at three epochs, for checking astronomy-engine;
- the J2000 to body-fixed rotation (`pxform_c`) of the Sun, the planets, the Moon, Pluto and the
  planets' 20 major moons (`IAU_PHOBOS` … `IAU_CHARON`) at four epochs, for `orientation.test.mjs`;
- the Earth's (ITRF93) at 408 instants from 2000 to 2126, for the Earth orientation table;
- the triaxial radii (`bodvrd_c` `RADII`) of the same 31 bodies, for checking `src/physics/pck.data.js`;
- the toolkit version, every kernel loaded, and the GM of each body the JS kernel uses, from `python/data/gm_de442.tpc` (system barycentres for Mercury to Neptune, the Earth and Moon themselves).

## Regenerate

1. Get the kernels listed in [`python/README.md`](../python/README.md) into `python/data/kernels/`. The
   tool loads `python/data/metakernel.tm`.
2. Get CSPICE for your platform from the
   [NAIF toolkit page](https://naif.jpl.nasa.gov/naif/toolkit_C.html). On Linux x86_64 it is
   `cspice.tar.Z` (about 43 MB), prebuilt, so there is nothing to compile:

   ```bash
   mkdir -p ~/.local/share/naif && cd ~/.local/share/naif
   curl -fLO https://naif.jpl.nasa.gov/pub/naif/toolkit//C/PC_Linux_GCC_64bit/packages/cspice.tar.Z
   gzip -dc cspice.tar.Z | tar xf -
   ```

3. Build and run from the repo root. CMake looks for CSPICE in `~/.local/share/naif/cspice`; pass
   `-DCSPICE_ROOT=...` if it is elsewhere.

   ```bash
   cmake -S c -B c/build -DCMAKE_BUILD_TYPE=Release
   cmake --build c/build
   c/build/orrery_spice_ref src/physics/fixtures/spice_reference.json
   ```

The output is deterministic (a fixed-seed generator picks the two-body cases), so regenerating it with
the same toolkit and kernels gives the same file.

## Artemis II reference

`artemis2_ref.c` samples Orion's reconstructed trajectory for
[docs/validation/artemis2.md](../docs/validation/artemis2.md). It needs the
kernels above plus NAIF's two Artemis II SPKs from
<https://naif.jpl.nasa.gov/pub/naif/ARTEMIS/kernels/spk/>
(`art002_rec_260402_260410_jsc_bet_revf.bsp` and its `_gapfill` file, about
5.7 MB together) in `python/data/kernels/spk/missions/artemis2/`.

```bash
cmake --build c/build
c/build/artemis2_ref src/physics/fixtures/artemis2_bet.json 600
```

The second argument is the sampling step in seconds. Pairs of UTC times
after it restrict sampling to those windows; the burn fixture
(`artemis2_burns.json`) is the windows around each burn at 5 s, with the
command in [docs/validation/artemis2.md](../docs/validation/artemis2.md#regenerate).

## DE442 for the app

`de_cheb.c` fits the Chebyshev series that the app uses for every planet,
Pluto, the Moon and the SSB
([docs/physics/ephemerides-and-gm.md](../docs/physics/ephemerides-and-gm.md#de442-in-the-app)),
from the same kernels as the reference generator:

```bash
cmake --build c/build
c/build/de_cheb public/ephemeris/de442-2000-2050.bin 2000 2051
```

The arguments are the first year and the year after the last. It prints,
per series and per body as the app composes it about the Sun, the worst
position and acceleration error, checked between the fitting nodes against
`spkezr_c`, and the jumps where intervals meet. `DAYS_<id>` and `N_<id>`
(NAIF code, 301 for the Moon) override a series' interval and coefficients.

## The moons for the app

`moon_cheb.c` fits the moons' tables
([docs/frontend/moons.md](../docs/frontend/moons.md#2000-to-2049-jpls-satellite-ephemerides))
from NAIF's satellite SPKs (`mar099s`, `jup365`, `sat441`, `sat415`, `ura184`
parts 1–3, `nep098` parts 1–3, `plu060`, 11 GB, in `python/data/kernels/spk/satellites/`, or the
folder `$SAT_KERNELS` names):

```bash
cmake --build c/build
c/build/moon_cheb survey 0.5 2000 2050
c/build/moon_cheb public/ephemeris/moons 0.5 2000 2050 public/ephemeris/moons-extra 2020 2036
```

(`npm run build:moon-tables` builds the tool and runs the last line.) The
arguments are the tolerance in km for each series (a moon and its
planet's centre, each about the barycentre, so a moon about its planet is
within twice that), the first year and the year after the last, and
optionally a folder for the inner moons' files outside a core span (the
first year of it and the year after its last): the repo keeps their files
for 2020–2035 only, and `public/ephemeris/moons-extra` is git-ignored. `survey`
only prints the size each body would take. The full run takes about
eleven minutes and prints, for each body, its intervals a year, coefficients, worst
error over every interval, and the jumps where intervals meet.

## The Earth's orientation for the app

`earth_orientation.c` samples ITRF93 from NAIF's two Earth PCKs, each read
alone, for the Earth orientation table
([docs/physics/orientation.md](../docs/physics/orientation.md#earth));
`src/physics/eop.build.mjs` fits each day's UT1 − UTC, polar motion and
nutation corrections to the samples:

```bash
cmake --build c/build
c/build/earth_orientation python/data/kernels/pck/earth_latest_high_prec.bpc \
  python/data/kernels/pck/earth_2026_260806_2126_predict.bpc /tmp/itrf93.bin
node src/physics/eop.build.mjs /tmp/itrf93.bin
```

The samples file is 26 MB and not kept. The build prints the fit's worst
residual (4 mm) and the offset where it joins the long-term file onto the
high-precision one.

## SB441's largest asteroids for the app

`sb_cheb.c` fits the Chebyshev series the app uses for the 25 asteroids it
takes from JPL's SB441 files
([docs/frontend/small-bodies.md](../docs/frontend/small-bodies.md#exact-positions-for-the-largest)).
It needs `de442.bsp` (for the Sun about the barycentre) and
`sb441-n373s.bsp` (982 MB) from
[ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/](https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/),
placed in `python/data/kernels/spk/asteroids/`. The full command, with the
body list, is in that page. Its arguments are the output, the first year,
the year after the last, the tolerance (km), the leapseconds kernel, the
planetary SPK, the asteroid SPK and the NAIF ids. It prints each body's
interval, coefficients and worst heliocentric error against `spkezr_c`;
with `SB_REFERENCE=<file>` set it also writes the SPK states the
JavaScript test checks against (`src/physics/fixtures/asteroids_sb441.json`).
