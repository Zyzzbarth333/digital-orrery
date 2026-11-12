# Python SPICE reference

This subtree is an offline NASA SPICE (NAIF) reference for the digital-orrery project. It grounds the JavaScript simulator's ephemerides against authoritative planetary data: body physical parameters (radii, gravitational parameters), IAU orientation models (pole, prime meridian, nutation-precession) and ephemeris positions computed directly from NAIF SPICE kernels. Use it to cross-check the numbers the JS simulator produces, or as a standalone viewer to inspect solar system motion.

It is a reference, not a runtime dependency of the web app. The two entry points are independent scripts.

## Contents

- `spice_body_params.py` - queries and prints body physical and orientation parameters (RADII, GM, POLE_RA, POLE_DEC, PM, nutation-precession terms) for a hierarchy of barycenters, the Sun, planets, satellites, an asteroid and a comet.
- `solar_system_reference.py` - an interactive Matplotlib 3D viewer of planetary orbits driven by SPICE `spkpos`, with a time slider, play/pause and hover tooltips.
- `parameters.py` - a small simulation-configuration module (start/end epochs, timestep, constants) used as shared setup.
- `data/metakernel.tm` - the SPICE meta-kernel listing the NAIF kernels to load. It uses relative paths (`./data/kernels`, `./data`), resolved from the working directory.
- `data/gm_de442.tpc` - DE442's GM values as a text kernel (see below).
- `requirements.txt` - Python dependencies (spiceypy, numpy, matplotlib).

## NAIF kernels are not included

The SPICE kernels are large binary data files and are NOT committed to this repository. You must download them yourself from the NAIF generic kernels archive and place them under `python/data/kernels/`, preserving the sub-directory layout referenced by the meta-kernel.

Archive: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/

The meta-kernel (`data/metakernel.tm`) loads these, resolved relative to `python/data/kernels/` (all from NAIF's generic kernels archive, checked current on 12 Nov 2026):

| File | NAIF archive path | Size | What it is |
| --- | --- | --- | --- |
| `lsk/naif0012.tls` | `lsk/naif0012.tls` | 5 KB | Leap seconds (no new leap second since 2017) |
| `pck/pck00011_n0066.tpc` | `pck/pck00011_n0066.tpc` | 132 KB | IAU sizes and orientation, in the format for toolkit N0066 and later |
| `pck/earth_latest_high_prec.bpc` | `pck/earth_latest_high_prec.bpc` | 5 MB | Precise Earth orientation (NAIF refreshes it often) |
| `pck/moon_pa_de440_200625.bpc` | `pck/moon_pa_de440_200625.bpc` | 13 MB | Lunar libration |
| `fk/moon_de440_250416.tf` | `fk/satellites/moon_de440_250416.tf` | 19 KB | Lunar frames |
| `pck/mars_konopliv_2026_n0066_v1.tpc` | `pck/mars_konopliv_2026_n0066_v1.tpc` | 20 KB | Mars rotation (Konopliv 2026) |
| `spk/satellites/mar099s.bsp` | `spk/satellites/mar099s.bsp` | 68 MB | Mars centre, Phobos, Deimos (1995-2049) |
| `spk/satellites/jup365.bsp` | `spk/satellites/jup365.bsp` | 1.14 GB | Jupiter centre, Galilean and inner moons (1600-2200) |
| `spk/satellites/sat441.bsp` | `spk/satellites/sat441.bsp` | 662 MB | Saturn centre, Titan and the major moons (1750-2250) |
| `spk/satellites/ura184_part-3.bsp` | `spk/satellites/ura184_part-3.bsp` | 387 MB | Uranus centre and its five major moons (1600-2400) |
| `spk/satellites/nep097.bsp` | `spk/satellites/nep097.bsp` | 105 MB | Neptune centre, Triton (1600-2400) |
| `spk/satellites/plu060.bsp` | `spk/satellites/plu060.bsp` | 135 MB | Pluto centre, Charon and the small moons (1800-2200) |
| `spk/asteroids/sb441-n16.bsp` | JPL `ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/` | 646 MB | The 16 asteroids the DE ephemerides use as perturbers (MD5 `03b8f72822ff459643f43bc83a07506e`; JPL publishes no checksum) |
| `spk/de442.bsp` | `spk/planets/de442.bsp` | 120 MB | Planetary ephemeris DE442 (Feb 2025; MD5 `446656322267e7b819a26cb08a0d8718`) |

The satellite kernels' MD5s match NAIF's `spk/satellites/aa_checksums.txt`. **Load order matters**: SPICE uses the last-loaded kernel that covers a body, and each satellite kernel carries its own older copy of the system barycentres, so `de442.bsp` is listed last. With everything loaded, the Sun, every system barycentre, Earth and the Moon are identical to DE442 alone, and all 29 planet centres, major moons and the asteroids resolve against the solar-system barycentre. Together they cover 1995-2049 (the short-span Mars file `mar099s` sets that; the full `mar099.bsp`, 1.2 GB, extends it).

`python/data/gm_de442.tpc` is in the repository: DE442's GM values, converted from the table in NAIF's `spk/planets/de442_tech-comments.txt`, because NAIF publishes `gm_de440.tpc` but no `gm_de442.tpc`.

From the `python/` directory:

```
mkdir -p data/kernels/lsk data/kernels/pck data/kernels/spk/satellites data/kernels/spk/asteroids data/kernels/fk
B=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
curl -fL -o data/kernels/lsk/naif0012.tls                   $B/lsk/naif0012.tls
curl -fL -o data/kernels/pck/pck00011_n0066.tpc             $B/pck/pck00011_n0066.tpc
curl -fL -o data/kernels/pck/earth_latest_high_prec.bpc     $B/pck/earth_latest_high_prec.bpc
curl -fL -o data/kernels/pck/moon_pa_de440_200625.bpc       $B/pck/moon_pa_de440_200625.bpc
curl -fL -o data/kernels/fk/moon_de440_250416.tf            $B/fk/satellites/moon_de440_250416.tf
curl -fL -o data/kernels/pck/mars_konopliv_2026_n0066_v1.tpc $B/pck/mars_konopliv_2026_n0066_v1.tpc
curl -fL -o data/kernels/spk/de442.bsp                      $B/spk/planets/de442.bsp
for f in mar099s jup365 sat441 ura184_part-3 nep097 plu060; do
  curl -fL -o data/kernels/spk/satellites/$f.bsp $B/spk/satellites/$f.bsp
done
curl -fL -o data/kernels/spk/asteroids/sb441-n16.bsp https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/sb441-n16.bsp
```

DE442 against DE440: the inner planets and the Moon move by under 20 m (2000-2040), Mars's barycentre by up to 0.3 km, Jupiter's by 3-14 km (Juno ranging), Saturn's by under 0.4 km, Neptune's by 60-640 km and Uranus's by 360-2,900 km (new Uranus occultation data).

SPICE stops at the first listed kernel that is missing: to run with DE442 alone, drop the satellite and asteroid lines from `KERNELS_TO_LOAD`.

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