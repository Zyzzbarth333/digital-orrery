# Frames, units and time

Every physics module works in one frame and one set of units, and converts
only at the edges (rendering, the UI, external data).

## Units

| Quantity | Unit |
| --- | --- |
| length | km |
| velocity | km/s |
| acceleration | km/s² |
| time | s |
| gravitational parameter $\mu = GM$ | km³/s² |
| mass, thrust (burns only) | kg, N; converted with $1\ \text{m/s}^2 = 10^{-3}\ \text{km/s}^2$ |
| angles | rad |

## Inertial frame: J2000 equatorial (EQJ)

The kernel, the ephemeris adapter (`src/physics/ephemeris.js`) and the SPICE
fixture all use the J2000 mean equator and equinox. That is SPICE's `J2000`
frame and astronomy-engine's `EQJ`; it is the ICRF to within about 0.02
arcseconds (a frame bias that matters only far below the accuracy here).

### Ecliptic J2000

The Lambert solver's "prograde" test looks at the sign of the $z$
component of $\mathbf r_1\times\mathbf r_2$, so it needs a frame whose $z$ axis
is near the orbit normals of the planets: the ecliptic. EQJ and ecliptic
J2000 differ by a rotation about $x$ through the J2000 mean obliquity
$\varepsilon = 23.4392911°$:

$$
\mathbf r_\text{ecl} =
\begin{pmatrix}1 & 0 & 0\\ 0 & \cos\varepsilon & \sin\varepsilon\\ 0 & -\sin\varepsilon & \cos\varepsilon\end{pmatrix}
\mathbf r_\text{EQJ}
$$

and the transpose goes back. `helioStateEcl` and `eclToEqj` use
astronomy-engine's own rotation (the same $\varepsilon$); a craft's
heliocentric orbital elements are taken in the ecliptic, so their
inclinations are measured from it.

### Scene frame (rendering only)

three.js is $y$-up. The scene draws the **ecliptic** frame with ecliptic north
up, in units of 1000 km, relative to the camera (a floating origin):

$$
(x, y, z)_\text{render} = \frac{1}{1000\ \text{km}}\,(x, z, -y)_\text{ecliptic} - \text{camera}.
$$

Velocities use the same axis map without the scaling. Nothing in
`src/physics/` uses scene coordinates; see [the 3D scene](../frontend/scene.md).

## Centre: the Sun now, the solar-system barycentre next

The kernel is **heliocentric**: positions are relative to the Sun's centre.
The Sun is itself pulled by the planets, so a heliocentric frame accelerates,
and the equations of motion carry an *indirect term* for that
([n-body kernel](nbody-kernel.md#force-model)). With it, heliocentric and
barycentric integration describe the same motion.

The DE ephemerides, GMAT and Orekit all integrate about the **solar-system
barycentre** (SSB), where no indirect term is needed. The Sun wanders more
than one solar radius from the SSB, mostly because of Jupiter and Saturn.
Moving the kernel to the SSB, with the Sun as a moving body read from DE442,
is planned for the exact-ephemeris phase.

## Time

| Where | Time scale |
| --- | --- |
| SPICE fixture (`c/orrery_spice_ref.c`) | ephemeris time (TDB seconds past J2000), via `str2et_c` from UTC strings |
| kernel and app | seconds from `KERNEL_EPOCH_MS` = 2000-01-01 12:00 **UTC**, i.e. UTC seconds |
| astronomy-engine | takes UTC dates; TT − UTC is set from the leap-second table (`ephemeris.js`: 32.184 s + TAI − UTC, 69.184 s since 2017), not the library's extrapolation (75.2 s for 2026) |

The kernel's time is only ever used as a difference and as the date it
passes to astronomy-engine, so it is consistent on the JavaScript side. It is
**not** TDB: TDB − UTC is about 69 s now (32.184 s + 37 leap seconds), so a
state labelled with kernel time is 69 s off a TDB label. That is below the
current ephemeris accuracy (astronomy-engine is 300-3,000 km off DE442 for the
inner planets), but it becomes significant once DE442 is read directly.
Proper time scales (UTC, TAI, TT, TDB with leap seconds from `naif0012.tls`)
are part of the exact-ephemeris phase.

## Sources

- IAU 2012 Resolution B2 (the astronomical unit).
- NAIF SPICE Required Reading: Frames, Time.
- astronomy-engine documentation (EQJ, ECL, rotation functions).
