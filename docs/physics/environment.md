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
- **Always on:** the Earth's solid tides (with its field) and relativity;
  `relativity: false` or `earth: { tides: false }` turn them off.

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

## The Moon's gravity field

The Moon's mass is lumpy: dense "mascons" under its maria pull a low orbit
out of shape, and most low lunar orbits come down within months. The
kernel's Moon has J2. Within ten lunar radii, the environment adds the rest
of GRAIL GL0660B, JPL's field from the GRAIL mission (Konopliv et al. 2013):
- **Default:** degrees 2 to 50, leaving out J2, which the zonal model
  already has from the same GL0660B.
- **Data:** the coefficients to degree 100 are in `grail.js`, built by
  `npm run fetch:environment` from NASA's Planetary Data System. The file
  is in degree order, so only the first 0.6 MB of its 26.7 MB is read.
- **Frame:** the field is given in the Moon's principal-axis frame (DE421).
  The app orients the Moon in its mean-Earth frame (`orientation.js`,
  within 0.0036° of SPICE's MOON_ME). The fixed rotation between them is
  taken from NAIF's frame kernel through CSPICE (`PA_TO_ME`): 67.85″,
  78.69″ and 0.28″.
- **Turning:** the orientation is refreshed every ten minutes, with the
  Moon's spin about its pole applied in between.

**Check: Apollo's subsatellites.**
- **PFS-2:** Apollo 16 released it at 21:56:09 UT on 24 April 1972 into a
  90 × 130 km orbit inclined 10° (retrograde, as Apollo flew). It hit the
  Moon 34 days later. No source gives its node, so it is flown at four,
  with the field to degree 30:
  - with the field, it comes down after 46.8, 28.5, 12.4 and 20.0 days;
    NASA's 34 days lies within that spread;
  - with J2 alone, it is still in its 90 × 130 km orbit at day 67. The
    run stops there, on 1 July 1972, at a leap second: the kernel counts
    time in UTC seconds, so every body's position jumps by one second of
    motion there, and the jump reads as an impact. (An earlier version of
    this page called that a decay after 67.1 days.)

  So the mascons bring it down sooner at every node.
- **PFS-1:** Apollo 15's, released into 102 × 139 km at 28.5°, near one of
  the low orbits the mascons leave alone (a "frozen" inclination), lasted
  about 537 days. With the field it is still up after 120 days (150 days
  at two nodes, in a longer run).

## Venting and thruster puffs

A real spacecraft is pushed by more than gravity and sunlight: venting,
uneven heat radiation and attitude-thruster puffs. A simulator can't
predict them; JSC's fit of Artemis II takes them from Orion's logs. So
`vent.js` is a random model, sized from what Artemis II's flown trajectory
showed: a push of 1.3–3.4 µm/s² over each coast arc of a day or two, its
direction changing between arcs, always leaning toward the Sun (cosine
0.3–0.8). The model has three parts:
- **A steady sunward push,** 1.4 µm/s².
- **A wandering push:** on each inertial axis, a first-order Gauss–Markov
  process with standard deviation 1.3 µm/s² and a 1.5-day correlation time.
- **Thruster puffs** (optional): a Poisson number an hour, each a 2-second
  push of about a chosen Δv in a random direction.

**A fixed function of time.** Every value comes from a seeded hash of
absolute time, so the same instant always gives the same push, whatever
order the integrator asks in or however the clock's frames split the
flight:
- **The wandering push:** each knot's value is the exponentially weighted
  sum of the white noise before it, computed from its own index rather
  than by stepping from the start. Values between knots are joined by
  Catmull–Rom curves.
- **A puff:** it is judged on or off at the middle of the integrator's
  step, as burns are, because a fourth-order step's stages reach beyond
  the step. Its edges are breakpoints the step must land on. With them as
  only step limits, the step after a puff carried its push: 0.8 m/s too
  much each.

The model is off unless a craft asks for it. Orion in the app has it, so a
flown Artemis drifts as the real one did and the tracking fixes correct
it.

**Checks** (`environment.test.mjs`):
- **The wandering push,** over 2,000 days: 1.31 µm/s² per axis, and a
  correlation of 0.38 after one correlation time ($e^{-1}$ = 0.37).
- **Artemis II's arcs:** the model's one-day averages over 300 days have a
  median of 2.35 µm/s², leaning toward the Sun at a median cosine of 0.72.
  The arcs showed 1.3–3.4 µm/s² and 0.3–0.8.
- **Puffs through the kernel:** 48 in a day are delivered exactly.

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

## The Earth's solid tides

The Moon and the Sun stretch the solid Earth, and the stretched Earth pulls
on a craft a little differently. The model follows the IERS Conventions
(2010), section 6.2, step 1 (`solidTide()`):
- **What changes:** the Earth's degree 2 and 3 coefficients, by the Love
  number k_nm times the tide-raising potential of each body:

  $$\Delta\bar C_{nm} - i\,\Delta\bar S_{nm} = \frac{k_{nm}}{2n+1}\sum_{j}\frac{GM_j}{GM_E}\left(\frac{R_E}{r_j}\right)^{n+1}\bar P_{nm}(\sin\phi_j)\,e^{-im\lambda_j}$$

  with the Moon's and the Sun's Earth-fixed latitude φ_j, longitude λ_j and
  distance r_j.
- **Love numbers:** the anelastic values of IERS Table 6.3 for degree 2
  (k20 = 0.30190; k21 = 0.29830 − 0.00144 i; k22 = 0.30102 − 0.00130 i),
  and the elastic ones for degree 3 (0.093, and 0.094 for m = 3).
- **How it is applied:** a small degree 3 field whose coefficients follow
  the two bodies, evaluated in the Earth-fixed frame like the main field and
  over the same reach (20 Earth radii by default). It is on whenever the
  Earth's field is (`earth.tides`).
- **Tide system:** EGM2008's coefficients are tide-free, so the tide's
  permanent part is part of the change, as the Conventions intend.
- **Left out:** step 2 (the frequency-dependent corrections), the degree 2
  tide's leak into degree 4 (k⁺, under 0.3 % of it), and the Moon's own
  tides (its k2 is about 0.024).

**Checks:**
- Averaged over the Moon's 18.6-year nodal cycle (2000 to 2018, twice a
  day), the change in C20 is −4.1987×10⁻⁹. The Conventions' permanent tide,
  A0 H0 k20 (eq. 6.14), is −4.2007×10⁻⁹: within 0.05 %.
- At 400 km round the equator the tide pulls up to 3.3×10⁻⁷ m/s². The
  closed form for a single k2 = 0.3 (the gradient of
  k2 GM_j R⁵ P2(cos θ) / (r_j³ r³)) agrees to 1.4 %, as it should: the k_2m
  differ by 1 % and degree 3 adds about 2 %.
- On Artemis I's coast arcs it moves an arc's end by 2 cm at most.

## Relativity

The leading relativistic corrections, from the IERS Conventions (2010),
eq. 10.12, with the PPN parameters β = γ = 1 (`relativity`, on by default):
- **The Sun's Schwarzschild term,** with the craft's heliocentric r and v:

  $$\mathbf a = \frac{GM}{c^2 r^3}\left[\left(\frac{4GM}{r} - v^2\right)\mathbf r + 4(\mathbf r\cdot\mathbf v)\,\mathbf v\right]$$

  The planets' and the Moon's ephemerides (DE442) already include
  relativity, so without this a craft drifted from them: at 1 AU the term is
  1.8×10⁻¹⁰ m/s², about 0.7 m a day.
- **The Earth's Schwarzschild term,** the same with geocentric r and v,
  within 1.5 million km: 1.9×10⁻⁸ m/s² in low orbit.
- **The Earth's Lense–Thirring term,** frame dragging by the Earth's spin:

  $$\mathbf a = \frac{2GM}{c^2 r^3}\left[\frac{3}{r^2}(\mathbf r\times\mathbf v)(\mathbf r\cdot\mathbf J) + \mathbf v\times\mathbf J\right]$$

  with J the Earth's spin angular momentum per unit mass, 9.8×10⁸ m²/s
  along its pole of date.
- **Left out:** de Sitter's term, which belongs to integrations in the
  geocentric frame (the kernel's is heliocentric, where the Sun's term
  carries it), and the other bodies' Schwarzschild terms (the Moon's is
  10⁻¹⁴ m/s² at its surface).

**Checks:**
- Mercury's orbit about the Sun, flown through the kernel for 10 orbits
  with and without the term: the perihelion advances 42.98″ a century,
  the classical 6πGM/(c²a(1 − e²)) per orbit (43″, Einstein's figure).
- The Earth's terms on a 12,270 km orbit (LAGEOS's size) in the equator,
  e = 0.1, averaged over the orbit by Gauss's equation: the perigee
  advances 3.2496″ a year, Schwarzschild's 3.3118″ less Lense–Thirring's
  0.0622″, to 0.1 %. (Flown through the kernel instead, the Sun's tide on
  the orbit hides an effect this small.)
- On Artemis I's coast arcs it moves an arc's end by up to 0.74 m.

## The planets' J2

The kernel's zonal model (`zonal.js`) now gives every planet its J2, not
only the Earth and the Moon. Each value is from the field's primary source
(`bodies.js`):

| Body | J2 (unnormalised) | Reference radius | Source |
| --- | --- | --- | --- |
| Mercury | 5.0317×10⁻⁵ | 2,440.0 km | MESSENGER, JGMESS160A (Konopliv et al. 2020), PDS |
| Venus | 4.4044×10⁻⁶ | 6,051.0 km | Magellan, MGNP180U (Konopliv et al. 1999), PDS |
| Mars | 1.9566×10⁻³ | 3,396.0 km | MRO120D, PDS |
| Jupiter | 14,696.5735×10⁻⁶ | 71,492 km | Juno (Durante et al. 2020), PDS |
| Saturn | 16,290.573×10⁻⁶ | 60,330 km | Cassini Grand Finale (Iess et al. 2019) |
| Uranus | 3,510.7×10⁻⁶ | 25,559 km | Jacobson 2014, Table 12 |
| Neptune | 3,408.43×10⁻⁶ | 25,225 km | Jacobson 2009, Table 5 |

Mercury's, Venus's and Mars's are their normalised C20 times −√5. Each acts
within 100 reference radii, about the body's pole of date.

**Check:** a circular orbit 3 Jupiter radii out, 30° to Jupiter's equator,
flown for 10 days: the node turns 11.931°, against 11.901° from the
secular rate −(3/2) n J2 (R/a)² cos i (0.25 %, the size of the J2² terms the
secular rate leaves out).

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
| Artemis I's 77 coast arcs | NASA's as-flown ephemeris | rms 22.5 m with gravity alone; 7.9 m with Orion's sunlight pressure (C_r A/m = 4.6×10⁻³ m²/kg); 5.6 m with the full environment |
| The Earth's field through the kernel: NESC case 3B, 8×8 GEM-T1, 8 hours | NASA's simulations | 4 mm from sim B |
| Drag through the kernel: NESC case 6B, MET atmosphere, 8 hours | NASA's simulations | 7 mm from sim B |
| U.S. Standard Atmosphere 1976 | its tables, 0 to 86 km | within 0.003 % |
| A craft dropped from 20,000 km | | enters, slows and lands; the impact is reported |
| The Moon's field (GRAIL GL0660B, degree 30): Apollo 16's PFS-2 | NASA: down after 34 days | down after 12–47 days at four nodes; with J2 alone, still up at day 67 |
| The same, Apollo 15's PFS-1 at 28.5° | lasted about 537 days | still up after 120 days |
| Venting: the wandering push, and one-day averages | Artemis II's coast arcs: 1.3–3.4 µm/s², sunward cosine 0.3–0.8 | 1.31 µm/s² per axis; median 2.35 µm/s², cosine 0.72 |
| Thruster puffs through the kernel | their summed delta-v | exact |
| The solid Earth tide: C20's change over 18.6 years | IERS 2010 permanent tide, A0 H0 k20 = −4.2007×10⁻⁹ | −4.1987×10⁻⁹ (0.05 %) |
| The tide's pull at 400 km | closed form for k2 = 0.3 | within 1.4 % (3.3×10⁻⁷ m/s² at most) |
| Relativity: Mercury through the kernel, 10 orbits | 42.98″ a century | 42.98″ a century |
| Relativity: the Earth's terms on a 12,270 km orbit | Schwarzschild less Lense–Thirring, 3.2496″ a year | 3.2496″ a year (0.1 %) |
| Jupiter's J2: a node at 3 Jupiter radii, 10 days | secular theory, 11.901° | 11.931° (0.25 %) |

## Sources

- O. Montenbruck and E. Gill, *Satellite Orbits*, Springer, 2000, §3.2 and §3.4.
- N. K. Pavlis et al., "The development and evaluation of the Earth
  Gravitational Model 2008 (EGM2008)", *JGR* 117 (2012); coefficients via
  GFZ's ICGEM service.
- *U.S. Standard Atmosphere, 1976*, NOAA-S/T 76-1562.
- A. S. Konopliv et al., "The JPL lunar gravity field to spherical harmonic
  degree 660 from the GRAIL Primary Mission", *JGR Planets* 118 (2013);
  NASA PDS Geosciences Node, `jggrx_0660b_sha.tab`.
- NASA, *Apollo 16 Subsatellite*
  ([science.nasa.gov](https://science.nasa.gov/mission/apollo-16-subsatellite/));
  Gunter's Space Page, *PFS 1, 2*
  ([space.skyrocket.de](https://space.skyrocket.de/doc_sdat/pfs.htm)).
- CelesTrak space weather data (T. S. Kelso), from NOAA SWPC and GFZ
  Potsdam: [celestrak.org/SpaceData](https://celestrak.org/SpaceData/).
- IAU 2015 Resolution B3: nominal solar irradiance 1361 W/m² and radius
  695,700 km.
- G. Petit and B. Luzum (eds.), *IERS Conventions (2010)*, IERS Technical
  Note 36: section 6.2 and Table 6.3 (solid tides), eq. 10.12
  (relativity), [iers-conventions.obspm.fr](https://iers-conventions.obspm.fr/).
- The planets' J2: Konopliv et al. 2020 (Icarus 335, 113500) and the PDS
  file `jgmess_160a_sha.tab`; PDS `shgj180u.a01` (MGNP180U); PDS
  `jgmro_120d_sha.tab` (MRO120D); Durante et al. 2020 (GRL 47,
  e2019GL086572) and PDS `GRV_JUGR_SHA_JUP_U_DUR2020`; Iess et al. 2019
  (Science 364, eaat2965); R. A. Jacobson, AJ 148, 76 (2014) and AJ 137,
  4322 (2009).
- F. Espenak, NASA GSFC, *Total Solar Eclipse of 2017 August 21*, path table,
  [eclipse.gsfc.nasa.gov](https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2017Aug21Tpath.html).
