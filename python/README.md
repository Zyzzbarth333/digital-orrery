# Python SPICE reference

This subtree is an offline NASA SPICE (NAIF) reference for the digital-orrery project. It grounds the JavaScript simulator's ephemerides against authoritative planetary data: body physical parameters (radii, gravitational parameters), IAU orientation models (pole, prime meridian, nutation-precession) and ephemeris positions computed directly from NAIF SPICE kernels. Use it to cross-check the numbers the JS simulator produces, or as a standalone viewer to inspect solar system motion.

It is a reference, not a runtime dependency of the web app. The two entry points are independent scripts.

## Contents

- `spice_body_params.py` - queries and prints body physical and orientation parameters (RADII, GM, POLE_RA, POLE_DEC, PM, nutation-precession terms) for a hierarchy of barycenters, the Sun, planets, satellites, an asteroid and a comet.
- `solar_system_reference.py` - an interactive Matplotlib 3D viewer of planetary orbits driven by SPICE `spkpos`, with a time slider, play/pause and hover tooltips.
- `parameters.py` - a small simulation-configuration module (start/end epochs, timestep, constants) used as shared setup.
- `data/metakernel.tm` - the SPICE meta-kernel listing the NAIF kernels to load. It uses a relative kernel path (`./kernels`).
- `requirements.txt` - Python dependencies (spiceypy, numpy, matplotlib).

## NAIF kernels are not included

The SPICE kernels are large binary data files and are NOT committed to this repository. You must download them yourself from the NAIF generic kernels archive and place them under `python/data/kernels/`, preserving the sub-directory layout referenced by the meta-kernel.

Archive: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/

The meta-kernel (`data/metakernel.tm`) expects the following files, resolved relative to `python/data/kernels/`:

Leapseconds (lsk):
- `lsk/naif0012.tls`

Planetary constants and orientation (pck):
- `pck/pck00011.tpc`
- `pck/gm_de440.tpc`
- `pck/earth_620120_240827.bpc`
- `pck/mars_iau2000_v1.tpc`
- `pck/moon_pa_de440_200625.bpc`

Ephemerides (spk):
- `spk/de440.bsp`
- `spk/ceres_1900_2100.bsp`
- `spk/codes_300ast_20100725.bsp`
- `spk/jupiter/jup344.bsp`, `jup344-s2003_j24.bsp`, `jup346.bsp`, `jup365.bsp`
- `spk/mars/mar097.bsp`
- `spk/neptune/nep095.bsp`, `nep097.bsp`, `nep097xl-801.bsp`, `nep097xl-899.bsp`, `nep101xl.bsp`, `nep101xl-802.bsp`, `nep104.bsp`, `nep105.bsp`
- `spk/pluto/plu060.bsp`
- `spk/saturn/sat393_daphnis.bsp`, `sat415.bsp`, `sat441.bsp`, `sat454.bsp`
- `spk/uranus/ura111.bsp`, `ura111l.bsp`, `ura111xl-701.bsp` to `ura111xl-705.bsp`, `ura111xl-799.bsp`, `ura115.bsp`, `ura116.bsp`, `ura117.bsp`
- `spk/comets/ison.bsp`, `siding_spring_8-19-14.bsp`, `siding_spring_s46.bsp`

If you only need the core planets and the Sun (enough for `solar_system_reference.py` with its default body list), `lsk/naif0012.tls`, `pck/pck00011.tpc`, `pck/gm_de440.tpc` and `spk/de440.bsp` are sufficient. To load only that subset, trim `KERNELS_TO_LOAD` in `data/metakernel.tm` to the kernels you have downloaded.

## Setup

From the `python/` directory:

```
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

pip install -r requirements.txt
```

`solar_system_reference.py` uses the `TkAgg` Matplotlib backend, so a Tk-capable Python installation is required for the interactive viewer.

## Running

Run both scripts from the `python/` directory so that the relative kernel path (`./kernels`, referenced from `data/metakernel.tm`) resolves to `python/data/kernels/`.

Body parameters report:

```
python spice_body_params.py
```

This loads `data/metakernel.tm`, then prints physical and orientation parameters for each body in the built-in list.

Interactive solar system viewer:

```
python solar_system_reference.py
```

This loads `data/metakernel.tm`, computes positions for the Sun and the four inner planets over two years from J2000, and opens an interactive 3D plot with a time slider, a play/pause button and hover tooltips. Edit the body list and date range in `main()` to inspect other configurations.