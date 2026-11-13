# The space environment

`src/physics/environment.js` holds the forces on a spacecraft beyond the
point masses and J2 that the [n-body kernel](nbody-kernel.md) already has.
Each one acts on the craft alone, so it enters the kernel the same way in
Cowell's method and in Encke's: through the `extraAccel` hook, beside the
thrust.
- **The host:** `kernelHost.js` builds the environment for each craft from
  what the craft sends: its mass, sunlit area and reflectivity.
- **The craft:** `Craft` carries those as `area` (default 5 m²) and `cr`
  (default 1.3).
- **Real missions:** Orion flies with its own: 25,536 kg, 92 m², C_r 1.3.

## Sunlight pressure

Sunlight pushes a craft away from the Sun. As a flat "cannonball":

$$
\mathbf a = \nu\, C_r\, P \left(\frac{1\,\text{AU}}{d}\right)^2 \frac{A}{m}\, \hat{\mathbf s},
\qquad P = \frac{1361\ \text{W/m}^2}{c} = 4.54\times10^{-6}\ \text{N/m}^2
$$
- $\hat{\mathbf s}$ points from the Sun to the craft, and $d$ is their
  distance.
- $A$ is the sunlit area and $m$ the mass. The mass is reckoned at each
  instant: a burn sheds propellant, so it comes from the burns themselves.
- $C_r$ runs from 1 (absorbing) to 2 (a mirror); 1.3 is typical.
- $\nu$ is the fraction of the Sun's disc the craft can see.

**Shadows.** The Earth and the Moon are spheres that can cover part or all
of the Sun's disc (Montenbruck and Gill, *Satellite Orbits*, §3.4.2):
- **The overlap:** from the craft, the Sun has apparent radius $a$, the
  body $b$, and their centres are $c$ apart. The visible fraction is 1 when
  $c \ge a + b$, and 0 when the body covers the Sun ($c \le b - a$).
  Between those it is one less the overlap of the two discs; inside the
  Sun's disc (annular), $1 - b^2/a^2$.
- **Light time:** each body stands where it was when the light it blocks
  passed it, $d/c$ earlier. In the Sun's frame the Moon moves at about
  30 km/s, so for a point on the Earth that is 38 km. Without it, the
  2017 eclipse's path came out a few kilometres north of NASA's.

**Steps across a shadow's edge.** The push switches off and on at a
shadow's edge, and a step straight across it puts the switch wherever the
step happens to end. A day of low orbit flown in hourly or daily frames
then differed by 2×10⁻⁴ m/s, about 8 % of the day's push. So the
environment gives both integrators a largest step (`stepCap`):
- **Away from a shadow:** half the time until the nearest contact of the
  two discs.
- **Inside the penumbra:** a tenth of the time to cross it.
- **Never below 0.5 s.**

The frames then agree to 8×10⁻⁷ m/s. A day in low orbit takes 2,505 steps
instead of 1,464, and 59 ms instead of 35.

**Checks** (`environment.test.mjs`):

| Check | Reference | Result |
| --- | --- | --- |
| 1 m² per tonne at 1 AU, C_r = 1 | P/1000 | exact, away from the Sun, falling as 1/d² |
| The Moon's shadow on the Earth, 21 August 2017 | NASA's eclipse tables (F. Espenak, GSFC): central line and limits at 17:20 UT, greatest eclipse at 18:25:31.8 UT | total on the central line and at greatest eclipse; both edges of the path within 10 km of NASA's limits |
| Totality on the central line in Oregon | NASA: 2 min 02.6 s | 122.5 s with NASA's eclipse radii (Moon 0.272281 Earth radii, Sun 959.63″); 126.5 s with the app's mean radii, whose umbra is about 1.5 km wider |
| Artemis I's 77 coast arcs | NASA's as-flown ephemeris | rms 22.5 m without sunlight pressure, 8.0 m with Orion's (C_r A/m = 4.6×10⁻³ m²/kg) |

## Sources

- O. Montenbruck and E. Gill, *Satellite Orbits*, Springer, 2000, §3.4.
- IAU 2015 Resolution B3: nominal solar irradiance 1361 W/m² and radius
  695,700 km.
- F. Espenak, NASA GSFC, *Total Solar Eclipse of 2017 August 21*, path table,
  [eclipse.gsfc.nasa.gov](https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2017Aug21Tpath.html).
