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
  - There is no polar motion.
- **Third bodies:** point masses with the indirect term,
  $\mu_k\left[(\mathbf r_k - \mathbf r)/|\mathbf r_k - \mathbf r|^3 - \mathbf r_k/|\mathbf r_k|^3\right]$.
  The Sun and the Moon come from the app's DE442 ephemeris.
- **Drag:** $\mathbf a_D = -\tfrac12 \rho\, |\mathbf v_r|\, \mathbf v_r\, C_D A/m$.
  $\mathbf v_r$ is the velocity relative to an atmosphere turning with the
  Earth about its pole of date (the third row of $M$).
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
- **The MET atmosphere.** NASA's Marshall Engineering Thermosphere is not
  public (the report refers requests to MSFC). The four drag cases
  therefore use NASA's own density along the path, sim B's every 60 s,
  interpolated in time. They agree to 0.6 m, inside the four tools' own
  spread. Cases 5A–C exist to compare the atmosphere itself, so their
  densities are not checked.
- **DE405.** The Sun and the Moon come from DE442. The difference is
  below 1 mm in every case.

## The app's kernel on the same cases

The n-body kernel flies two of the cases too:
- **Case 2:** the Earth as its central body; 4 mm from sim B after 8 h.
- **Case 4:** heliocentric, exactly as the app runs it; 0.62 m.

The case 4 gap is the app's Earth table, not the kernel. `deTable.js`'s
Chebyshev fit holds the Earth's heliocentric position to 0.5 m. Its
acceleration, though, ripples by about 10⁻⁸ m/s² against the force model,
and jumps at the joins between segments. An orbit about the Earth follows
the table's Earth. With the same Sun and Moon but the Earth at the origin,
`sixdof.js` matches sim B to 1 mm.

## Sources

- NASA Engineering and Safety Center, *Check-Cases for Verification of
  6-Degree-of-Freedom Flight Vehicle Simulations*, NASA/TM-2015-218675
  (NESC-RP-12-00770), Volumes I and II, 2015; data at
  [nescacademy.nasa.gov/flightsim/2015](https://nescacademy.nasa.gov/flightsim/2015).
- O. Montenbruck and E. Gill, *Satellite Orbits*, Springer, 2000, §3.2.4.
- J. H. Lieske et al., "Expressions for the precession quantities based
  upon the IAU (1976) system of astronomical constants", *A&A* 58, 1977.
- P. K. Seidelmann (ed.), *Explanatory Supplement to the Astronomical
  Almanac*, 1992, pp. 114–115 (IAU 1980 nutation); NAIF CSPICE `zzwahr.c`.
