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
from NAIF's satellite SPKs (`mar099s`, `jup365`, `sat441`, `ura184_part-3`,
`nep098_part-1`, `plu060`, 3.3 GB, in `python/data/kernels/spk/satellites/`, or the
folder `$SAT_KERNELS` names):

```bash
cmake --build c/build
c/build/moon_cheb survey 0.5 2000 2050
c/build/moon_cheb public/ephemeris/moons 0.5 2000 2050
```

The arguments are the tolerance in km for each series (a moon and its
planet's centre, each about the barycentre, so a moon about its planet is
within twice that), the first year and the year after the last. `survey`
only prints the size each body would take. The full run takes about six
minutes and prints, for each body, its intervals a year, coefficients, worst
error over every interval, and the jumps where intervals meet.
