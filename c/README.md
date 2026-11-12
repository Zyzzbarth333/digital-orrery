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
