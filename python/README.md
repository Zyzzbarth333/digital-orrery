# Python SPICE reference

This subtree is an offline NASA SPICE (NAIF) reference for the digital-orrery project. It grounds the JavaScript simulator's ephemerides against authoritative planetary data: body physical parameters (radii, gravitational parameters), IAU orientation models (pole, prime meridian, nutation-precession) and ephemeris positions computed directly from NAIF SPICE kernels. Use it to cross-check the numbers the JS simulator produces, or as a standalone viewer to inspect solar system motion.

It is a reference, not a runtime dependency of the web app. The two entry points are independent scripts.

## Contents

- `spice_body_params.py` - queries and prints body physical and orientation parameters (RADII, GM, POLE_RA, POLE_DEC, PM, nutation-precession terms) for a hierarchy of barycenters, the Sun, planets, satellites, an asteroid and a comet.
- `solar_system_reference.py` - an interactive Matplotlib 3D viewer of planetary orbits driven by SPICE `spkpos`, with a time slider, play/pause and hover tooltips.
- `parameters.py` - a small simulation-configuration module (start/end epochs, timestep, constants) used as shared setup.
- `data/metakernel.tm` - the SPICE meta-kernel listing the NAIF kernels to load. It uses a relative kernel path (`./data/kernels`), resolved from the working directory.
- `requirements.txt` - Python dependencies (spiceypy, numpy, matplotlib).

## NAIF kernels are not included

The SPICE kernels are large binary data files and are NOT committed to this repository. You must download them yourself from the NAIF generic kernels archive and place them under `python/data/kernels/`, preserving the sub-directory layout referenced by the meta-kernel.

Archive: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/

The meta-kernel (`data/metakernel.tm`) loads four kernels, resolved relative to `python/data/kernels/`:

| File | NAIF archive path | Size |
| --- | --- | --- |
| `lsk/naif0012.tls` | `lsk/naif0012.tls` | 5 KB |
| `pck/pck00011.tpc` | `pck/pck00011.tpc` | 131 KB |
| `pck/gm_de440.tpc` | `pck/gm_de440.tpc` | 12 KB |
| `spk/de440.bsp` | `spk/planets/de440.bsp` | 120 MB |

From the `python/` directory:

```
mkdir -p data/kernels/lsk data/kernels/pck data/kernels/spk
B=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
curl -fL -o data/kernels/lsk/naif0012.tls $B/lsk/naif0012.tls
curl -fL -o data/kernels/pck/pck00011.tpc $B/pck/pck00011.tpc
curl -fL -o data/kernels/pck/gm_de440.tpc $B/pck/gm_de440.tpc
curl -fL -o data/kernels/spk/de440.bsp    $B/spk/planets/de440.bsp
```

This covers the Sun, planets, Moon and planetary barycentres, plus body radii, orientation and GM values. Satellite, asteroid and comet ephemerides (for example `spk/satellites/jup365.bsp`, about 1.1 GB) need extra SPKs: download them and add their paths to `KERNELS_TO_LOAD` only when you need them. SPICE stops at the first listed kernel that is missing.

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

Run the scripts from the `python/` directory. SPICE resolves the meta-kernel's relative path (`./data/kernels`) from the working directory, not from the meta-kernel's own location, so this is what makes it point at `python/data/kernels/`.

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