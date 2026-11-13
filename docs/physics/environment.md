# The space environment

`src/physics/environment.js` holds the forces on a spacecraft beyond the
point masses and J2 that the [n-body kernel](nbody-kernel.md) already has.
Each one acts on the craft alone, so it enters the kernel the same way in
Cowell's method and in Encke's: through the `extraAccel` hook, beside the
thrust.
- **The host:** `kernelHost.js` builds the environment for each craft from
  what the craft sends: its mass, area, reflectivity and drag coefficient.
- **The craft:** `Craft` carries those as `area` (default 5 m²), `cr`
  (default 1.3) and `cd` (default 2.2), and optionally its own Earth-field
  settings (`earth`).
- **Real missions:** Orion flies with its own: 25,536 kg, 92 m², C_r 1.3.

## The Earth's gravity field

The kernel's Earth has J2 ([zonal.js](nbody-kernel.md)). The environment
adds the rest of EGM2008 (NGA's Earth Gravitational Model 2008), as an
acceleration on the craft alone:
- **Default:** degrees and orders 2 to 20, leaving out J2, which the zonal
  model already has from the same EGM2008.
- **Method:** the field (`geopotential.js`, Cunningham's recursion) is
  evaluated in the Earth-fixed frame and rotated back.
- **Earth rotation:** IAU 1976 precession, the full IAU 1980 nutation,
  and apparent sidereal time (`earthRotation.js`, checked to 1 cm against
  NASA's tools). These are computed once an hour, with the Earth's spin
  about its pole of date applied analytically in between.
- **Data:** the coefficients to degree 70 are in `egm2008.js`, built by
  `npm run fetch:environment` from GFZ's ICGEM copy of the model. That
  file lists the model by degree, so only its first 0.3 MB is read.
- **Range:** beyond 20 Earth radii the harmonics are left out.

| Degree | A day at 400 km (cost) | Steps | From degree 70 after a day |
| --- | --- | --- | --- |
| J2 only | 93 ms | 2,505 | 1,397 m |
| 8 | 197 ms | 7,371 | 983 m |
| 20 (default) | 276 ms | 7,335 | 85 m |
| 70 | 1,498 ms | 7,352 | |

The field triples the steps at any degree: Encke's error control follows
a perturbation that now changes as fast as the craft circles the Earth.

## Drag

$\mathbf a = -\tfrac12 \rho\, |\mathbf v_r|\, \mathbf v_r\, C_D A / m$:
- **Relative velocity:** $\mathbf v_r$ is relative to an atmosphere turning
  with the Earth about its pole of date.
- **The craft:** $C_D$ defaults to 2.2, and $A$ is the area also used for
  sunlight.
- **Height:** geodetic height on WGS-84.
- **Density** comes from `atmosphere.js`:
  - **0 to 86 km:** the U.S. Standard Atmosphere 1976 (seven layers of
    constant gradient in geopotential altitude). It matches the 1976
    tables to 0.003 % from 0 to 86 km.
  - **90 to 2,500 km:** NASA's MET-1999 thermosphere
    (`atmosphereMET.js`), driven by the Sun's activity for the date:
    - the previous day's F10.7, its 81-day mean, and the day's Ap;
    - from CelesTrak's space-weather file, observed and then predicted to
      2041 (`public/data/spaceweather.json`, loaded with the DE442 table);
    - outside it, a moderate F10.7 150 and Ap 15.
  - **86 to 90 km:** the logarithm of density is blended between the two.
  - **Above 2,500 km:** none.

**Stiffness.** Low in the atmosphere drag's time constant $|v|/|a|$ is
seconds, and a longer explicit step makes the speed swing instead of
settle: a craft dropped toward the Earth went unstable and never landed.
So the environment caps the step:
- **By time constant:** a fifth of drag's time constant at the state the
  step starts from.
- **By descent:** while descending below 200 km, a quarter of a 7 km
  scale height of descent. At 7 km/s an 8 s step would fall 56 km, from
  thin air into thick.

In orbit neither binds.

**The drawn state.** While the kernel lags behind the clock the craft is
drawn by a quick local integration. That now carries the environment
too, evaluated along the way. In low orbit, an hour late is 6 m from the
kernel (1.85 km without the Earth's field).

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

**Checks** (`environment.test.mjs`, `nesc.test.mjs`, `craft.test.mjs`):

| Check | Reference | Result |
| --- | --- | --- |
| 1 m² per tonne at 1 AU, C_r = 1 | P/1000 | exact, away from the Sun, falling as 1/d² |
| The Moon's shadow on the Earth, 21 August 2017 | NASA's eclipse tables (F. Espenak, GSFC): central line and limits at 17:20 UT, greatest eclipse at 18:25:31.8 UT | total on the central line and at greatest eclipse; both edges of the path within 10 km of NASA's limits |
| Totality on the central line in Oregon | NASA: 2 min 02.6 s | 122.5 s with NASA's eclipse radii (Moon 0.272281 Earth radii, Sun 959.63″); 126.5 s with the app's mean radii, whose umbra is about 1.5 km wider |
| Artemis I's 77 coast arcs | NASA's as-flown ephemeris | rms 22.5 m without sunlight pressure, 8.0 m with Orion's (C_r A/m = 4.6×10⁻³ m²/kg) |
| The Earth's field through the kernel: NESC case 3B, 8×8 GEM-T1, 8 hours | NASA's simulations | 4 mm from sim B |
| Drag through the kernel: NESC case 6B, MET atmosphere, 8 hours | NASA's simulations | 7 mm from sim B |
| U.S. Standard Atmosphere 1976 | its tables, 0 to 86 km | within 0.003 % |
| A craft dropped from 20,000 km | | enters, slows and lands; the impact is reported |

## Sources

- O. Montenbruck and E. Gill, *Satellite Orbits*, Springer, 2000, §3.2 and §3.4.
- N. K. Pavlis et al., "The development and evaluation of the Earth
  Gravitational Model 2008 (EGM2008)", *JGR* 117 (2012); coefficients via
  GFZ's ICGEM service.
- *U.S. Standard Atmosphere, 1976*, NOAA-S/T 76-1562.
- CelesTrak space weather data (T. S. Kelso), from NOAA SWPC and GFZ
  Potsdam: [celestrak.org/SpaceData](https://celestrak.org/SpaceData/).
- IAU 2015 Resolution B3: nominal solar irradiance 1361 W/m² and radius
  695,700 km.
- F. Espenak, NASA GSFC, *Total Solar Eclipse of 2017 August 21*, path table,
  [eclipse.gsfc.nasa.gov](https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2017Aug21Tpath.html).
