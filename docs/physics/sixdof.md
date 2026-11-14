# A 6-DOF vehicle in Earth orbit

`src/physics/sixdof.js` propagates a rigid vehicle about the Earth: its
position and velocity, and its attitude and body rates, together. It is
checked against NASA's 6-DOF check cases (below). The app's own
spacecraft are still point masses in the n-body kernel
([The n-body kernel](nbody-kernel.md)); this is the model a vehicle's
attitude and the Earth's full gravity field will come from.

Units are SI throughout (m, m/s, kg, N, N m, rad), as in NASA's cases.

## State and integration

The state is $\mathbf r, \mathbf v$ (J2000, Earth at the origin), the
attitude quaternion $q$ and the body rates $\boldsymbol\omega$:

$$\dot{\mathbf r} = \mathbf v,\quad \dot{\mathbf v} = \mathbf a_g + \mathbf a_{3b} + \mathbf a_D + \frac{\mathbf F_I}{m},\quad \dot q = \tfrac12\, q \otimes (0, \boldsymbol\omega),\quad I\dot{\boldsymbol\omega} = \boldsymbol\tau - \boldsymbol\omega \times I\boldsymbol\omega$$

- **Quaternion** (`rigidbody.js`): scalar first, body to inertial
  ($\mathbf v_I = q \otimes \mathbf v_B \otimes q^*$), renormalised after
  each step with the scalar kept positive.
- **Inertia** about the centre of mass in body axes, with the products of
  inertia entering with a minus sign: $I_{xy} = -\int x y\,dm$.
- **Integration:** classical 4th-order Runge–Kutta at a fixed step (1 s).
  Steps end exactly on output times and on breakpoints, and a force or
  torque pulse is judged on or off at the middle of each step. So a burn
  switches at its stated time, not at whichever Runge–Kutta stage happens
  to straddle the edge. Judged per stage instead, NASA's 93-second
  plane-change burn came out 0.7 km off; per step, it is within 0.07 mm.

## Force and torque models

- **Gravity:** a point mass, or a spherical-harmonic field to any degree
  and order (`geopotential.js`). The field uses Cunningham's V/W recursion
  (Montenbruck and Gill, *Satellite Orbits*, §3.2.4). It has no latitude or
  longitude in it, so no singularity at the poles. Fully normalised
  coefficients are converted once:
  $C_{nm} = \bar C_{nm}\sqrt{(2-\delta_{m0})(2n+1)(n-m)!/(n+m)!}$. The field is
  evaluated in the Earth-fixed frame and rotated back:
  $\mathbf a = M^\mathsf T\, \nabla U(M\mathbf r)$.
- **Earth rotation** (`earthRotation.js`): $M = R_3(\text{GAST})\,N\,P$,
  from J2000 to the Earth-fixed frame of date.
  - Precession is IAU 1976 (Lieske).
  - Nutation is IAU 1980, the full 106-term series. The table and its
    fundamental arguments are NAIF's (CSPICE `zzwahr.c`), and our sum
    matches NAIF's routine to 10⁻¹⁹ rad.
  - Sidereal time is GMST (IAU 1982) plus the classic equation of the
    equinoxes, $\Delta\psi\cos\epsilon$. NASA's tools leave out the 1994
    terms in $\Omega$: with them, their Earth-fixed positions are 5 cm away
    instead of 1 cm.
  - There is no polar motion: NASA's cases hold it at zero and give
    UT1 − UTC by hand. The app's own craft get both, and the nutation
    corrections, from the Earth orientation table
    ([orientation](orientation.md#earth)).
- **Third bodies:** point masses with the indirect term,
  $\mu_k\left[(\mathbf r_k - \mathbf r)/|\mathbf r_k - \mathbf r|^3 - \mathbf r_k/|\mathbf r_k|^3\right]$.
  The Sun and the Moon come from the app's DE442 ephemeris.
- **Drag:** $\mathbf a_D = -\tfrac12 \rho\, |\mathbf v_r|\, \mathbf v_r\, C_D A/m$.
  $\mathbf v_r$ is the velocity relative to an atmosphere turning with the
  Earth about its pole of date (the third row of $M$). The density $\rho$
  is any function of time and position; for NASA's cases it is the MET
  atmosphere (below).
- **Thrust and torque:** fixed in body axes, through the centre of mass.
- **Gravity gradient:** the point-mass torque
  $\boldsymbol\tau = 3\mu/r^3\,(\hat{\mathbf r}_B \times I\hat{\mathbf r}_B)$.

## NASA's 6-DOF check cases

NASA's Engineering and Safety Center published check cases for 6-DOF
flight simulations (NASA/TM-2015-218675, 2015). The orbital set is 25
cases of a vehicle in Earth orbit for 8 hours, each run by four NASA
simulations. The report masks which tool is which, calling them sims A
to D; among them are JSC's JEOD, LaRC's LaSRS++, MSFC's MAVERIC and
POST II. `nesc.lib.mjs` sets every case up from the report:
- **Constants:** the report's own, not WGS-84 (GM 3.98600436×10¹⁴ m³/s²,
  R 6,378,137 m, 1/f 298.3).
- **Gravity:** GEM-T1 to degree and order 8.
- **Vehicles:** the ISS, a sphere and a cylinder.
- **Pulses:** the burns and torque pulses.
- **Initial attitude:** given in the local-vertical frame.

`nesc.test.mjs` compares every case with each tool. Results are in
[Validation](../validation.md#nasas-6-dof-check-cases-nesctestmjs).

Where the report and the tools' data disagree, the cases follow the data,
since the data are the reference:
- **Initial pitch rate:** the tables give −0.065 deg/s throughout. The
  data hold the vehicle in the local-vertical frame, at −0.064999 deg/s on
  the circular orbit and −0.064299 on the elliptical one.
- **Cases 10A–D:** the stated 3-2-1 angles (0, 85, 1) do not give the
  tools' starting attitude. Pitching 85° and then yawing 1° does, to
  10⁻⁸. Their "zero rate" means zero relative to the local-vertical frame,
  and 10B and 10D add 0.01 deg/s about body y.
- **Case 6A's constant density:** the report gives no number. The data
  imply 1.4×10⁻¹² kg/m³.

What is not reproduced:
- **DE405.** The Sun and the Moon come from DE442. The difference is
  below 1 mm in every case.

## The MET atmosphere

`src/physics/atmosphereMET.js` is the Marshall Engineering Thermosphere
(MET), the atmosphere all four NASA tools ran. It is NASA Marshall's
version of Jacchia's 1970 static diffusion model, with two of Jacchia's
1971 terms. It gives density, temperature and composition from 90 to
2,500 km. NASA's report says the code is available only from MSFC on
request. The equations and Fortran listings are public, though: they are
in four NASA reports on the Technical Reports Server (Sources). The
module is built from those.

Inputs are the time (UTC), geodetic latitude, east longitude and height,
the daily F10.7, its 162-day centred mean, and $a_p$ from 6.7 h before
(or $K_p$).

The model, in the order MET computes it:
- **Exospheric temperature** $T_\infty$ (Jacchia 1970):
  - Solar activity: $T_c = 383 + 3.32\bar F + 1.8(F - \bar F)$.
  - Diurnal bulge: $T_c(1+R\sin^m\theta)\left[1 + R\cos^n(\tau/2)\,\frac{\cos^m\eta-\sin^m\theta}{1+R\sin^m\theta}\right]$.
    Here $R = 0.31$, $m = 2.5$, $n = 3$, $\eta = |\phi-\delta_\odot|/2$,
    $\theta = |\phi+\delta_\odot|/2$ and $\tau = H - 37° + 6°\sin(H + 43°)$,
    with $H$ the Sun's hour angle.
  - Geomagnetic: $a_p + 100(1 - e^{-0.08 a_p})$.
  - Semiannual: $2.41 + \bar F\,[0.349 + 0.206\sin(2\pi\tau_s + 226.5°)]\sin(4\pi\tau_s + 247.6°)$,
    where $\tau_s$ is the fraction of the year, warped as in MET.
- **Temperature profile:** 183 K at 90 km and an inflection at 125 km,
  where $T_x = 444.3807 + 0.02385\,T_\infty - 392.8292\,e^{-0.0021357\,T_\infty}$
  (Jacchia 1971's $T_x$).
  - Below 125 km: a quartic.
  - Above it: $T_x + \tfrac{2}{\pi}(T_\infty - T_x)\arctan\{\ldots\}$.
- **Density:**
  - From 90 to 105 km: the barometric equation, with the mean molecular
    mass a sixth-degree polynomial in height.
  - Above 105 km: diffusive equilibrium for each of N₂, O₂, O, Ar and He
    (He with thermal diffusion factor −0.38), and H from 500 km.
  - Gravity is $9.80665/(1+z/6356.766\text{ km})^2$.
  - The integrals use MET's own Gaussian quadrature, over its eight fixed
    height bands, with its 7-digit abscissas and weights.
- **Jacchia 1971's terms:**
  - Seasonal-latitudinal density below 170 km.
  - Helium above the winter pole above 500 km, faired in between 440 and
    500 km.
- **The Sun:** the Astronomical Almanac's low-precision formulae
  (MET-1999 onward).

The version reproduced is MET-1999, which sims B and C ran (sim A ran
MET-2007, sim D MET-1995). MET-1999 has a few quirks, which the module
keeps:
- It reads the time as whole minutes and the date as an integer day of
  the year, over a 365.2422-day year. MET-2007 made these continuous.
- Its helium fairing goes in 10 km steps. `{ fairing: 'smooth' }` gives
  MET-V 2.0's cos² fairing instead.

How it checks (`nesc.test.mjs`, [Validation](../validation.md#the-met-atmosphere)):
- **NASA's MET-V 2.0 worked example:** every one of the ten printed
  outputs, to the digits printed.
- **MET-88's test case:** within 1.2×10⁻⁵. MET-88 had an older Sun and
  Simpson's rule.
- **Along cases 5A–C and the drag cases:** at every 60 s sample, density
  within 2.4×10⁻⁶ of sim B's and temperature within 0.7 mK, at all three
  solar levels (F10.7 70, 128.8 and 250).
- **The reading of the inputs**, which these results settle:
  - Latitude is geodetic: geocentric latitude is several hundred times
    worse (10⁻³ in density).
  - The report's single F10.7 is both the daily value and the mean.
  - The day number is 324, counting 1 January as 1. Day 323 would move
    the exospheric temperature by 1.4 K.
  - Ap is used as $a_p$. The cases give one value, and MET takes one
    either way.

With MET in place of NASA's recorded density, the drag cases fly to
within 5 mm of sim B after 8 hours. With sim B's density interpolated
between its 60 s samples, they were 0.35–0.61 m off. The whole-minute
clock matters: let the Sun move between minutes and the cases end 0.35–1.1 m
from sim B. So sim B called MET with whole minutes, at every step.

## The app's kernel on the same cases

The n-body kernel flies two of the cases too:
- **Case 2:** the Earth as its central body; 4 mm from sim B after 8 h.
- **Case 4:** heliocentric, exactly as the app runs it; 5 mm.

Case 4 found two problems in the kernel, each fixed:
- **The Earth table.** The first table held the Earth's position to 0.5 m,
  but its acceleration rippled by 10⁻⁸ m/s² and jumped where its segments
  met. That gave 0.62 m. It is now fitted through the Earth-Moon barycentre,
  as JPL stores it ([DE442 in the app](ephemerides-and-gm.md#de442-in-the-app)),
  which gave 0.12 m.
- **Encke's frame.** That 0.12 m was the floor of DE442's own records: its
  Earth's acceleration scatters by about 3×10⁻⁹ m/s² about the forces on
  it, and Encke's method followed it. It does so by subtracting the
  Earth's acceleration as the ephemeris gives it. Encke now subtracts the
  force model's acceleration instead, so the Sun and the other bodies act
  only by their tides ([Encke's method](nbody-kernel.md#enckes-method)).
  That gives 5 mm.

For comparison: with the same Sun and Moon but the Earth at the origin,
`sixdof.js` matches sim B to 1 mm.

## Sources

- M. P. Hickey, *The NASA Marshall Engineering Thermosphere Model*,
  NASA CR-179359, 1988 (MET-88's Fortran listing); and *An Improvement in
  the Numerical Integration Procedure Used in the NASA Marshall Engineering
  Thermosphere Model*, NASA CR-179389, 1988 (the Gaussian quadrature).
- J. K. Owens, *NASA Marshall Engineering Thermosphere Model — Version
  2.0*, NASA/TM-2002-211786, 2002 (MET-1999's Sun, the worked example).
- J. K. Owens et al., *Marshall Engineering Thermosphere Model, Version
  MET-2007*, NASA/TM-2017-218238, 2017 (what MET-1999 did with time).
- L. G. Jacchia, *New Static Models of the Thermosphere and Exosphere with
  Empirical Temperature Profiles*, SAO Special Report 313, 1970; and
  *Revised Static Models…*, SAO Special Report 332, 1971.
- NASA Engineering and Safety Center, *Check-Cases for Verification of
  6-Degree-of-Freedom Flight Vehicle Simulations*, NASA/TM-2015-218675
  (NESC-RP-12-00770), Volumes I and II, 2015; data at
  [nescacademy.nasa.gov/flightsim/2015](https://nescacademy.nasa.gov/flightsim/2015).
- O. Montenbruck and E. Gill, *Satellite Orbits*, Springer, 2000, §3.2.4.
- J. H. Lieske et al., "Expressions for the precession quantities based
  upon the IAU (1976) system of astronomical constants", *A&A* 58, 1977.
- P. K. Seidelmann (ed.), *Explanatory Supplement to the Astronomical
  Almanac*, 1992, pp. 114–115 (IAU 1980 nutation); NAIF CSPICE `zzwahr.c`.
