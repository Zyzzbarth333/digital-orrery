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

## Centre: the Sun for the app, the barycentre for the kernel

The app works **heliocentric**: every position it holds, draws or sends to
the kernel is relative to the Sun's centre.

The kernel integrates about the **solar system barycentre** (SSB), as the
DE ephemerides, GMAT and Orekit do. There the frame is inertial and no
indirect term is needed. The Sun is a moving body there, placed by DE442's
own Sun about the SSB; it wanders more than a solar radius from the SSB,
mostly with Jupiter and Saturn. `advance()` moves the state to the SSB at
the start and back at the end, so its interface stays heliocentric
([n-body kernel](nbody-kernel.md#about-the-solar-system-barycentre)).

Before 17 November 2026 the kernel integrated about the Sun, with an
indirect term for the Sun's acceleration toward the bodies. The two
describe the same motion; they differ only in where the Sun's acceleration
comes from: the kernel's own sum, or DE442.

## Time

| Where | Time scale |
| --- | --- |
| SPICE fixture (`c/orrery_spice_ref.c`) | ephemeris time (TDB seconds past J2000), via `str2et_c` from UTC strings |
| app clock | UTC (Unix milliseconds) |
| kernel | **TT** seconds from `KERNEL_EPOCH_MS` = 2000-01-01 12:00 UTC: `kernelSeconds(date)` and `kernelMs(t)` (`kernelHost.js`), `sys.secondsAt` and `sys.msAt` (`bodies.js`) |
| astronomy-engine | takes UTC dates; TT − UTC is set from the leap-second table (`timescale.js`: 32.184 s + TAI − UTC, 69.184 s since 2017), not the library's extrapolation (75.2 s for 2026) |
| DE442 table | TDB seconds past J2000, from UTC by `timescale.js`: TT − UTC from the leap seconds, then TDB − TT ≈ 0.001657 s sin g + 0.000014 s sin 2g |
| the Earth's turn (`earthRotation.js`) | **UT1** for sidereal time, UTC plus the day's UT1 − UTC from the Earth orientation table (`eop.js`, 2000 to 2126); TT for precession and nutation |

The kernel counts uniform seconds: TT seconds since the TT instant of
`KERNEL_EPOCH_MS`, by the same TT − UTC the ephemerides use (the
leap-second table from 1972, astronomy-engine's Espenak–Meeus ΔT before).
Its bodies are looked up by TT directly (`helioStateEqjAtTt`), so nothing
passes through UTC inside the kernel, and the last UTC second before a leap
second lasts two kernel seconds. Converting back, an instant inside a leap
second (23:59:60, which JavaScript's UTC cannot name) reads as the
following midnight, so the clock stands still for that second.

It used to count UTC seconds. Across a leap second the craft then flew one
second less than the bodies moved, so each body jumped a second of its
motion against it: 30 km for the Earth, 1 km for the Moon. The PFS-2 check
found it on 1 July 1972, where the Moon's jump read as an impact. Leap
seconds in the app's range: 1972 to 1998 (22 of them), 2005, 2008, 2012,
2015 and 2016. None falls during Artemis I or II.

Kernel time is still **not** TDB: it is offset from TDB seconds past J2000
by a constant (TT − UTC at the kernel epoch, 64.184 s, plus TDB − TT's
millisecond wobble), so a state labelled with kernel time is not a TDB
label. Checked (`nbody.test.mjs`, kernel time): UTC to kernel time and back
within 1 µs from 1969 to 2026; 2 s across 23:59:59 to 00:00:00 at three leap
seconds; the Earth's quarter-second steps through the 2016 leap second equal
to 1 part in 10⁶. Earth at MSL's launch, given as a UTC date, is 0.09 m
from SPICE.

### UT1

The Earth's rotation keeps its own time, UT1: the angle it has turned.
UTC is held within 0.9 s of it by leap seconds, and 0.9 s of the Earth's
turn is 400 m at the equator. So the Earth's orientation does not use UTC
directly. It adds the day's UT1 − UTC from NAIF's Earth PCKs, read into
`public/ephemeris/earth-orientation-2000-2126.bin` with the day's polar
motion ([orientation](orientation.md#earth)). Between days, the table
interpolates UT1 − TAI, which runs smoothly where UT1 − UTC jumps a second
at a leap second. Outside 2000 to 2126 the Earth turns on UTC, 180 m out.
`earthRotation.js` counts its days from J2000 rather than as Julian dates,
since a double holds a Julian date only to 40 µs (2 cm of the Earth's
turn).

## Sources

- IAU 2012 Resolution B2 (the astronomical unit).
- NAIF SPICE Required Reading: Frames, Time, PCK (ITRF93).
- astronomy-engine documentation (EQJ, ECL, rotation functions).
