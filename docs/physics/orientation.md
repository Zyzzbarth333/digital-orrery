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

Earth's axes come from astronomy-engine's `ObserverVector`: the J2000
directions of the points at latitude 0°, longitude 0° and of the north pole.
That includes precession, nutation and Greenwich apparent sidereal time,
the same chain an observer on the ground uses. It leaves out polar motion
(about 10 m at the surface).

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

$\alpha_0$, $\delta_0$ and $W$ come from astronomy-engine's `RotationAxis`.

## Checks

`npm test` runs `orientation.test.mjs`, which compares the axes with CSPICE
`pxform_c` from J2000 to each body-fixed frame at four epochs from 2000 to
2026:

| Body | CSPICE frame | Worst axis error | At the surface |
| --- | --- | --- | --- |
| Earth | ITRF93 (high-precision Earth PCK) | 0.0016° | 180 m |
| Moon | MOON_ME (the frame of the LRO maps) | 0.0036° | 110 m |
| Mercury | IAU_MERCURY | 0.00045° | 19 m |
| Venus | IAU_VENUS | 0.00011° | 12 m |
| Mars | IAU_MARS (Konopliv 2026 model) | 0.027° | 1.6 km |
| Jupiter, Saturn | IAU frames | 0.064°, 0.060° | 79 km, 61 km |
| Uranus, Neptune | IAU frames | 0.037°, 0.040° | 16 km, 17 km |
| Pluto | IAU_PLUTO | 0.0042° | 86 m |
| Sun | IAU_SUN | 0.0011° | 13 km |

The giant planets have no surface; their "longitude" is a rotation model
(System III), so these differences only move cloud bands, and only for the
models astronomy-engine and pck00011 take from different IAU reports.
