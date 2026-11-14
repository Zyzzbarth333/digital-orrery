# Body orientation

Which way each body is turned at a given time: needed to put a surface map
on it with the right longitude under the Sun, and later for launch sites,
ground tracks and landing. Code: `src/physics/orientation.js`.

## Body-fixed frames

A body-fixed frame has $Z$ along the north pole, $X$ through 0° longitude on
the equator and $Y = Z \times X$, so east longitude is positive.
`bodyAxesEqj(key, date)` returns the three axes in J2000 equatorial (EQJ)
coordinates; a vector $\mathbf v$ in EQJ has body-fixed components
$(X\cdot\mathbf v,\ Y\cdot\mathbf v,\ Z\cdot\mathbf v)$.

### Earth

The Earth is ITRF93, the frame NAIF's Earth PCKs give and the one GPS,
launch sites and surface maps are measured in. Its axes are the rows of

$$
M = W\,R_3(\text{GAST})\,N\,P, \qquad W = R_1(-y_p)\,R_2(-x_p),
$$

from `earthRotation.js` (`earthFixedAxes(ms)` in `orientation.js`): IAU 1976
precession $P$, IAU 1980 nutation $N$ with the IERS corrections
$\delta\Delta\psi$, $\delta\Delta\epsilon$ added, Greenwich apparent sidereal
time from **UT1**, and polar motion $(x_p, y_p)$, which tilts the crust
against the rotation axis by about 10 m. This is how NAIF builds ITRF93.
The scene, the launch sites, the rocket's ascent, a craft's impact point
and the gravity field and atmosphere (`environment.js`) all take the Earth
from it.

The day's UT1 − UTC, $x_p$, $y_p$, $\delta\Delta\psi$ and
$\delta\Delta\epsilon$ come from `public/ephemeris/earth-orientation-2000-2126.bin`
(336 KB, `eop.js`). UT1 − UTC alone is worth up to 0.9 s, 400 m at the
equator. Without them (before 2000, after 2126, or if the file fails to
load) the Earth turns on UTC with no polar motion, 180 m out.

**Where the table comes from.** NAIF's two binary Earth PCKs, sampled with
CSPICE by `c/earth_orientation.c`:

| Segment | Kernel | What it holds |
| --- | --- | --- |
| 1 Jan 2000 to 9 Feb 2027 | `earth_latest_high_prec.bpc` (13 Nov 2026) | JPL's measured EOP to 13 Nov 2026, then its three-month prediction |
| 9 Feb 2027 to 3 Nov 2126 | `earth_2026_260806_2126_predict.bpc` | NAIF's long-term extension: polar motion and nutation corrections held, UT1 running at the rate of TAI apart from the zonal tides |

For each day, `src/physics/eop.build.mjs` fits the five parameters so that
`earthRotation.js` reproduces ITRF93 at seven instants an hour apart around
0h UTC. Polar motion turns with the crust and the nutation correction with
the sky, so the quarter turn between the first and last instant tells them
apart. The fit is good to 4 mm everywhere. The first segment stores all
five daily as Float32. The second stores only UT1 − UTC, because its pole
is held. Between days `eop.js` uses four-point Lagrange interpolation
within a segment, as the IERS's own routine for its daily values
(`interp.f`) does. UT1 is
interpolated as UT1 − TAI, so leap seconds do not jump.

The long-term file was made in August 2026 from older data. Where it takes
over, NAIF's ITRF93 jumps by 177 ms of UT1 and 0.18″ of polar motion,
85 m at the surface. The table instead joins the second segment onto the
first. Its held pole is the newer file's last value, and its UT1 − UTC
moves by the difference at the junction but keeps the long-term file's
shape. That is NAIF's own extension, made from the newest data.

Past the first months, prediction is the limit. UT1 drifts from any
forecast by tens of milliseconds within a year, and by seconds over
decades (kilometres at the equator). So dates well after Feb 2027 are a
guess, as they are in SPICE.

**Refresh** when NAIF updates `earth_latest_high_prec.bpc` (they do so
often):

```bash
cmake --build c/build
c/build/earth_orientation python/data/kernels/pck/earth_latest_high_prec.bpc \
  python/data/kernels/pck/earth_2026_260806_2126_predict.bpc /tmp/itrf93.bin
node src/physics/eop.build.mjs /tmp/itrf93.bin
c/build/orrery_spice_ref src/physics/fixtures/spice_reference.json
```

The long-term file must start before the high-precision one ends. NAIF
publishes a new one from time to time.

### The other bodies

The IAU Working Group on Cartographic Coordinates and Rotational Elements
gives each body's north pole as a right ascension and declination
$(\alpha_0, \delta_0)$ and its prime meridian as an angle $W$ along the
equator, measured from the node where the body's equator crosses the ICRF
equator, all slowly varying with time. With

$$
\mathbf N = (-\sin\alpha_0,\ \cos\alpha_0,\ 0), \qquad
\mathbf Z = (\cos\delta_0\cos\alpha_0,\ \cos\delta_0\sin\alpha_0,\ \sin\delta_0),
$$

$$
\mathbf X = \cos W\,\mathbf N + \sin W\,(\mathbf Z \times \mathbf N), \qquad
\mathbf Y = \mathbf Z \times \mathbf X .
$$

For the Sun, the planets and Pluto, $\alpha_0$, $\delta_0$ and $W$ come from
astronomy-engine's `RotationAxis`.

### The planets' moons

The 20 major moons the scene draws (Phobos to Charon) use the IAU models as
NAIF's `pck00011_n0066.tpc` gives them, the same constants SPICE's
`IAU_<MOON>` frames use. `src/physics/pck.build.mjs` reads the kernel's
data blocks (a later assignment replacing an earlier one, as SPICE's pool
does) and writes `src/physics/pck.data.js`. With $d$ days and $T$ Julian
centuries TDB from J2000, as SPICE's `bodeul` evaluates them:

$$
\theta_j = A_j + B_j T,
$$

$$
\alpha_0 = \alpha_{00} + \alpha_{01}T + \alpha_{02}T^2 + \sum_j a_j\sin\theta_j, \qquad
\delta_0 = \delta_{00} + \delta_{01}T + \delta_{02}T^2 + \sum_j d_j\cos\theta_j,
$$

$$
W = W_0 + W_1 d + W_2 d^2 + \sum_j w_j\sin\theta_j,
$$

where the $\theta_j$ are the system's nutation-precession angles
(`BODY4_NUT_PREC_ANGLES` for Mars's moons, `BODY5_` for Jupiter's, and so
on). The sums carry each moon's forced libration and the precession of its
orbit's plane: Phobos's prime meridian librates by over a degree, Mimas's by 45° (its
orbit's libration in the resonance with Tethys), and Triton's pole
circles 32° in right ascension over Neptune's 690-year nodal cycle. TT
stands in for TDB (under 2 ms apart).

Before this the moons were drawn turning synchronously, with $X$ toward the
planet and $Z$ along the orbit's pole. Against the IAU frame, 2000 to 2050,
that put the sub-planet point up to 3° off 0° longitude for most moons,
5–7° for Enceladus, Titan and Iapetus and 37° for Mimas (both errors of the
mean-element orbit and the IAU model's own libration), and it flipped the
pole of the Uranian moons and Triton: the IAU puts a body's north on the
solar system's north side, and these moons orbit the other way about it
($W_1 < 0$), so a map would have been drawn mirrored.

### Shapes

`pck.data.js` also carries each drawn body's triaxial ellipsoid,
`BODYnnn_RADII`: the semi-axes $(a, b, c)$ along body-fixed $X$, $Y$ and $Z$.
The scene draws these ([the 3D scene](../frontend/scene.md#shapes)):

| Body | $a \times b \times c$ (km) | Flattening $(a - c)/a$ |
| --- | --- | --- |
| Earth | 6,378.1366 × 6,356.7519 | 0.34 % (1/298.3) |
| Mars | 3,396.19 × 3,376.20 | 0.59 % |
| Jupiter | 71,492 × 66,854 | 6.5 % |
| Saturn | 60,268 × 54,364 | 9.8 % |
| Uranus | 25,559 × 24,973 | 2.3 % |
| Neptune | 24,764 × 24,341 | 1.7 % |
| Phobos | 13.0 × 11.4 × 9.1 | |
| Deimos | 7.8 × 6.0 × 5.1 | |
| Io | 1,829.4 × 1,819.4 × 1,815.7 | |
| Mimas | 207.8 × 196.7 × 190.6 | |
| Iapetus | 745.7 × 712.1 | 4.5 % |

The long axis of a tidally locked moon points at its planet (0° longitude).
Mercury, Enceladus, Tethys, Dione, Rhea, Titan, Miranda and Ariel are
slightly triaxial as well; Venus, the Moon, Pluto, Ganymede, Callisto,
Umbriel, Titania, Oberon, Triton and Charon are spheres in pck00011.

## Rotation periods and tilts on the data plate

`src/physics/bodyfacts.js` reads the same IAU model for the facts the data
plate shows.
- **Sidereal rotation:** $P = 360°/|\dot W|$, with $\dot W$ the mean rate
  of $W$ over 1,000 days from J2000 (the Moon's and Mercury's librations
  average out). The IAU puts a planet's north pole on the north side of
  the invariable plane, so Venus and Uranus have $\dot W < 0$; a dwarf
  planet's pole is the positive one, so Pluto's $\dot W > 0$. The Earth's
  is the Earth Rotation Angle's rate (IERS Conventions 2010), the stellar
  day.
- **Axial tilt:** the spin axis $\hat{\mathbf s} = \operatorname{sign}(\dot W)\,\mathbf Z$
  against the osculating orbit's normal $\hat{\mathbf h}$,
  $\cos\varepsilon = \hat{\mathbf s}\cdot\hat{\mathbf h}$ (the Moon's about
  the Earth, the Sun's against the ecliptic pole). Over 90°, the body turns
  backwards.
- **Solar day:** $P_\odot = 360°/|\omega - n|$, with $\omega = \pm 360°/P$
  (negative when the tilt is over 90°) and $n$ the mean motion about the
  Sun (the Earth's, for the Moon, whose solar day is then the synodic
  month).
- **Mean density** $\bar\rho = (GM/G)/(\tfrac43\pi R^3)$ and **escape speed**
  $\sqrt{2GM/R}$, from the body's own GM and its mean radius, with
  $G = 6.67430\times10^{-11}$ m³ kg⁻¹ s⁻² (CODATA 2018).

For the Sun:
- **By latitude:** $\omega(\varphi) = A + B\sin^2\varphi + C\sin^4\varphi$,
  sidereal, $A = 2.894$, $B = -0.428$, $C = -0.370$ µrad/s (Howard,
  Harvey & Forgach 1990, from small magnetic features): 25.1 days at the
  equator, 34.7 near the poles (the fit carried there). The IAU's own rate,
  14.1844°/day (25.38 days), is Carrington's.
- **Its Galactic orbit:** Sgr A* drifts along the Galactic plane by
  6.379 mas/yr (Reid & Brunthaler 2004), the Sun's motion round it. As an
  angular rate $\Omega_\odot = 4.74047\,\mu$ km/s/kpc $= 30.24$, so
  $T = 2\pi/\Omega_\odot = 203$ million years, with no need for the
  distance to the centre. The often quoted 225–250 million years comes
  from the older round values of 8.5 kpc and 220 km/s.
- **The barycentre:** $\mathbf r_\text{SSB} = \sum\mu_i\mathbf r_i/\sum\mu_i$,
  from astronomy-engine (the Sun and the four giant planets).

`bodyfacts.test.mjs` checks them against NASA's planetary fact sheets
(NSSDCA): rotation to 0.02 %, the solar day to 0.04 %, the tilts to 0.05°,
density to 1 %. Two differ, and the plate says so:
- **Neptune:** NSSDCA gives 16.11 h, Voyager 2's radio period; the IAU
  model, as NAIF's pck00011 has it, turns at 541.1397757°/day, 15.966 h.
- **Pluto:** the IAU 2015 pole tilts it 119.6° to its orbit; NSSDCA lists
  122.53°.

## Checks

`npm test` runs `orientation.test.mjs`, which compares the axes with CSPICE
`pxform_c` from J2000 to each body-fixed frame at four epochs from 2000 to
2026 (the fixture is `src/physics/fixtures/spice_reference.json`, written by
`c/orrery_spice_ref.c`; the angle of the worst axis, by `atan2`, since
`acos` stops resolving below about 10⁻⁸ rad, 9 cm on the Earth):

| Body | CSPICE frame | Worst axis error | At the surface |
| --- | --- | --- | --- |
| Earth | ITRF93 (high-precision Earth PCK) | 1.1×10⁻⁷° | 1.2 cm |
| Moon | MOON_ME (the frame of the LRO maps) | 0.0036° | 110 m |
| Mercury | IAU_MERCURY | 0.00045° | 19 m |
| Venus | IAU_VENUS | 0.00011° | 12 m |
| Mars | IAU_MARS (Konopliv 2026 model) | 0.027° | 1.6 km |
| Jupiter, Saturn | IAU frames | 0.064°, 0.060° | 79 km, 61 km |
| Uranus, Neptune | IAU frames | 0.037°, 0.040° | 16 km, 17 km |
| Pluto | IAU_PLUTO | 0.0042° | 86 m |
| Sun | IAU_SUN | 0.0011° | 13 km |
| The 20 major moons | IAU_PHOBOS … IAU_CHARON | 1.9×10⁻⁵° (Phobos); 8.5×10⁻⁷° to 6.6×10⁻⁶° the others | under 1 m |

The moons use SPICE's own model, so only TT for TDB and rounding are left.
The same test checks the 31 ellipsoids in `pck.data.js` against SPICE's
`bodvrd_c` reading of `RADII`: equal to the last digit.

Then the Earth densely, against ITRF93 at 408 instants (to the
millisecond) from 2000 to 2126, in metres at the equator:

| Span | Instants | Against | Worst | RMS |
| --- | --- | --- | --- | --- |
| 2000 to 9 Feb 2027 (including either side of the 2008 and 2016 leap seconds) | 307 | `earth_latest_high_prec.bpc` | 4.2 cm | 1.6 cm |
| After 9 Feb 2027 | 101 | `earth_2026_260806_2126_predict.bpc` | 82.47 m | steady to 1 cm |

After Feb 2027 the difference is the junction's offset (above), held
constant. The craft's Earth (`environment.js`, recomputed hourly and spun
between) stays within 9.5 cm of this one: that is how far the nutation's
fortnightly term moves the pole and the equinox in half an hour. Before
this table, the Earth was 180 m out, because it took UTC for UT1 and left
out polar motion.

The giant planets have no surface; their "longitude" is a rotation model
(System III), so these differences only move cloud bands, and only for the
models astronomy-engine and pck00011 take from different IAU reports.

## Sources

- NAIF, `pck00011_n0066.tpc`, the generic text PCK in the N0066 toolkit's
  format (<https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/>): the
  moons' rotation models and every body's radii, as the IAU 2015 report and
  its later corrections give them.

- B. A. Archinal et al., "Report of the IAU Working Group on Cartographic
  Coordinates and Rotational Elements: 2015", *Celestial Mechanics and
  Dynamical Astronomy* 130:22 (2018),
  [doi:10.1007/s10569-017-9805-5](https://doi.org/10.1007/s10569-017-9805-5).
- G. Petit and B. Luzum (eds.), *IERS Conventions (2010)*, IERS Technical
  Note 36: the Earth Rotation Angle; polar motion (chapter 5).
- NAIF, Earth binary PCKs and their comments (`commnt -r`):
  [generic_kernels/pck](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/),
  `earth_latest_high_prec.bpc` (13 Nov 2026) and
  `earth_2026_260806_2126_predict.bpc` (7 Aug 2026), both made by WRTPEM
  from JPL's EOP file `latest.long`
  ([eop.jpl.nasa.gov](https://eop.jpl.nasa.gov/)).
- NAIF, *PCK Required Reading* and *Frames Required Reading*: ITRF93 and
  the high-precision Earth frame.
- R. Howard, J. W. Harvey and S. Forgach, "Solar surface velocity fields
  determined from small magnetic features", *Solar Physics* 130, 295
  (1990), doi:10.1007/BF00156795, ADS 1990SoPh..130..295H. SunPy's
  `differential_rotation` uses the same coefficients by default
  ([docs](https://docs.sunpy.org/en/stable/generated/api/sunpy.sun.models.differential_rotation.html)).
- M. J. Reid and A. Brunthaler, "The proper motion of Sagittarius A*. II.
  The mass of Sagittarius A*", *ApJ* 616, 872 (2004),
  [doi:10.1086/424960](https://doi.org/10.1086/424960): 6.379 ± 0.024
  mas/yr.
- D. R. Williams, NASA NSSDCA planetary fact sheets,
  [nssdc.gsfc.nasa.gov/planetary/factsheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/).
- CODATA 2018 value of G,
  [physics.nist.gov](https://physics.nist.gov/cgi-bin/cuu/Value?bg).
