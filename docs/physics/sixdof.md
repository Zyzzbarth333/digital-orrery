# A 6-DOF vehicle in Earth orbit

`src/physics/sixdof.js` propagates a rigid vehicle about the Earth: its
position and velocity, and its attitude and body rates, together. It is
checked against NASA's 6-DOF check cases [1] (below). The app's own
spacecraft fly their translation in the n-body kernel
([The n-body kernel](nbody-kernel.md)); craft launched in the app carry
an attitude as well, turned by the rotational half of this model
([Attitude in the app](#attitude-in-the-app)).

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
  (Montenbruck and Gill, *Satellite Orbits*, §3.2.4 [2]). It has no latitude or
  longitude in it, so no singularity at the poles. Fully normalised
  coefficients are converted once:
  $C_{nm} = \bar C_{nm}\sqrt{(2-\delta_{m0})(2n+1)(n-m)!/(n+m)!}$. The field is
  evaluated in the Earth-fixed frame and rotated back:
  $\mathbf a = M^\mathsf T\, \nabla U(M\mathbf r)$.
- **Earth rotation** (`earthRotation.js`): $M = R_3(\text{GAST})\,N\,P$,
  from J2000 to the Earth-fixed frame of date.
  - Precession is IAU 1976 (Lieske [3]).
  - Nutation is IAU 1980 [4], the full 106-term series. The table and its
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
  A torque can also depend on the state (`control`: an attitude
  controller), and the mass can fall with time (`massAt`).
- **Gravity gradient:** the point-mass torque
  $\boldsymbol\tau = 3\mu/r^3\,(\hat{\mathbf r}_B \times I\hat{\mathbf r}_B)$
  (`gravityGradientTorque`).
- **Aerodynamic torque:** the drag acting at a centre of pressure
  $\mathbf r_{cp}$ (body axes, from the centre of mass),
  $\boldsymbol\tau = \mathbf r_{cp} \times \left(-\tfrac12 \rho\,|\mathbf v_B|\,\mathbf v_B\,C_D A\right)$,
  $\mathbf v_B$ the air-relative velocity in body axes (`aeroTorque`).
  Behind the centre of mass it turns the body into the airflow.

`makeModel` returns the rotational half of the rates on its own,
`rotationalRates(t, r, v, q, ω)`, which the full derivative uses and the
app's attitude integrates on a translation it is given.

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
version of Jacchia's 1970 [5] static diffusion model, with two of Jacchia's
1971 [6] terms. It gives density, temperature and composition from 90 to
2,500 km. NASA's report says the code is available only from MSFC on
request. The equations and Fortran listings are public, though: they are
in four NASA reports on the Technical Reports Server [7]–[10]. The
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
  - The integrals use MET's own Gaussian quadrature [8], over its eight fixed
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
  the year, over a 365.2422-day year. MET-2007 [10] made these continuous.
- Its helium fairing goes in 10 km steps. `{ fairing: 'smooth' }` gives
  MET-V 2.0's cos² fairing instead.

How it checks (`nesc.test.mjs`, [Validation](../validation.md#the-met-atmosphere)):
- **NASA's MET-V 2.0 worked example** [9]: every one of the ten printed
  outputs, to the digits printed.
- **MET-88's test case** [7]: within 1.2×10⁻⁵. MET-88 had an older Sun and
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

## Attitude in the app

Craft launched in the app (MISSION and ROCKET tabs) carry an attitude:
a quaternion and body rates, turned by thrusters with a finite torque, by
the gravity gradient and, low in the Earth's air, by drag. Their burns
fire along the body's $+x$ axis. Real missions (Artemis) and journeys stay
point masses, so their validations don't move. Code: `attitude.js` (the
model and controller), `craftAttitude.js` (the craft's side, and its
burns), tested in `attitude.test.mjs`
([Validation](../validation.md#attitude-in-the-app-attitudetestmjs)).

### The model

`attitude.js` integrates only the rotation, with `makeModel`'s
`rotationalRates`: the same torques and Euler's equations that the check
cases test. The translation is handed to it as $\mathbf r(t), \mathbf v(t)$
about the craft's primary, from the kernel's state as the app draws it,
carried over a frame on the two-body orbit. The quaternion kinematics,
the gravity-gradient torque and the aerodynamic torque are the standard
forms [11].

The MISSION tab's craft is a 2 × 2 × 3 m box of 1,500 kg, long along the
thrust axis: full, $I = \mathrm{diag}(1000, 1625, 1625)$ kg m², from
$I = m(b^2+c^2)/12$. Its thrusters are 20 N pairs fired as couples,
0.5 m from the roll axis and 1 m from the pitch and yaw axes: 20 N m in
roll and 40 N m in pitch and yaw, at most 3°/s. The centre of pressure is
0.3 m behind the centre of mass, and $C_D A$ is the craft's drag area
(2.2 × 5 m²). The thrusters burn propellant
([below](#the-thrusters-propellant)), and the inertia falls as the tank
empties ([below](#inertia-and-the-propellant)). A craft launched from the
ROCKET tab is sized to its own stage instead
([below](#a-stages-attitude)).

### Pointing and the controller

The modes point body $+x$ along a direction of the orbital frame about the
primary, with body $+z$ toward the orbit normal (toward the velocity for
the two normal modes):

| Mode | $+x$ along |
| --- | --- |
| Prograde, retrograde | $\pm\hat{\mathbf v}$ |
| Normal, anti-normal | $\pm\hat{\mathbf h}$, $\mathbf h = \mathbf r \times \mathbf v$ |
| Radial out, radial in | $\pm\hat{\mathbf v} \times \hat{\mathbf h}$ (square to the velocity, in the plane) |
| Node | the next node's $\Delta\mathbf v$ in the same frame; during its burn, the burn's fixed direction |
| Hold | the attitude it had when chosen |
| Free | none: thrusters off |

The controller is sampled every $T_c$ = 0.1 s and holds its torque
between samples, as flight software does. It turns about the eigenaxis
$\hat{\mathbf e}$ of the error, the single rotation by $\theta$ that takes
the body onto the reference [12]:

$$\boldsymbol\omega_\text{cmd} = \hat{\mathbf e}\,\min\left(\omega_\text{max},\ \sqrt{2\alpha_b\theta + c^2} - c\right) + \boldsymbol\omega_\text{ref},\qquad c = \alpha_b T_p$$

$$\boldsymbol\tau = \boldsymbol\omega \times I\boldsymbol\omega + I\,\frac{\boldsymbol\omega_\text{cmd} - \boldsymbol\omega}{T_c}$$

- $\alpha$ is the angular acceleration the torque limit allows about
  $\hat{\mathbf e}$: the largest with $|(I\hat{\mathbf e}\,\alpha)_i| \le \tau_{\max,i}$
  on every axis. The braking curve uses $\alpha_b = 0.8\,\alpha$, a margin
  so the rate loop can always follow it.
- Far from the target the curve brakes at $\alpha_b$, as the time-optimal
  $\sqrt{2\alpha\theta}$ law does. Near it, it becomes $\theta/T_p$, a
  first-order approach ($T_p$ = 0.4 s, critically damped with the
  sampling), and it never asks for more than $\alpha_b$. An earlier
  version switched to $\theta/T_p$ at a corner. That asked for $2\alpha_b$
  there and saturated, overshooting slightly.
- The rate loop is deadbeat: unsaturated, it reaches the command in one
  period. The torque is clipped to the limit per axis, scaled as a whole
  so it keeps its axis.
- $\boldsymbol\omega_\text{ref}$, the reference's own turning (the orbital
  frame turns at about the mean motion), is fed forward, from the
  reference a second either side.

A rest-to-rest turn can be no faster than full torque to the rate limit,
a coast, and full torque back (bang-coast-bang):
$t_\text{min} = \theta/\omega_\text{max} + \omega_\text{max}/\alpha$, or
$2\sqrt{\theta/\alpha}$ when the rate limit is not reached. The controller
follows its curve in a time it can predict in closed form
(`slewTime`): full torque up to the curve or the rate limit, a coast, then
down the curve, whose time from $\omega_1$ to $\omega_2$ is
$[(\omega_1 - \omega_2) + c\ln(\omega_1/\omega_2)]/\alpha_b$. Eigenaxis turns
are not quite time-optimal for a three-axis body [13], but they are the
usual choice for their predictable path.

**Locking.** Settled within $10^{-4}$ rad and $2\times10^{-4}$ rad/s of its
reference, with the disturbances under a quarter of the torque limit, the
attitude locks: it is the reference from then on, without integration,
until the mode changes or a disturbance grows past half the limit. A craft
holding prograde at a day a second costs nothing to carry.

### The thrusters' propellant

The attitude thrusters draw on the engine's tank. Each axis has its pair
of thrusters, fired as a couple $L_i$ from the axis, so a torque
$\tau_i$ takes $|\tau_i|/L_i$ of thrust between them, and the propellant
is the total impulse over the exhaust velocity [14, §13.3]:

$$J = \int \sum_i \frac{|\tau_i|}{L_i}\,dt,\qquad \Delta m = \frac{J}{I_{sp}\,g_0}$$

- **The torque counted** is the controller's, held over each control
  period. Locked on its reference, the craft is charged for the
  disturbance it holds against (the gravity gradient, the air), found at
  the start of each frame.
- **The default craft:** $L = (0.5, 1, 1)$ m and $I_{sp}$ = 290 s,
  bipropellant from the main tank. That is the class of ArianeGroup's
  10 N bipropellant thruster, 292 s at its nominal point [15].
- **Accounting:** `attitude.js` adds up $J$ as it steps; `craftAttitude.js`
  takes $\Delta m$ from the tank each frame, after the engine's own draw
  (`craft.js` `updateBurns`). An empty tank switches control off and cuts
  the engine.
- **A rest-to-rest turn** about a principal axis costs
  $J = 2 I\,\omega_\text{peak}/L$, whatever the torque profile: the
  torque gives the body all its angular momentum and takes it back. A 90°
  pitch turn at the 3°/s limit is
  $2 \times 1625 \times 0.0524 / 1 = 170.2$ N s, 59.8 g.
- **Left out:** the thrusters' minimum impulse bit and the deadband limit
  cycle a real hold pays for (here the hold pays only for the torque it
  cancels), and the propellant they use during a burn, which the engine's
  mass flow does not include (a few grams against kilograms).

### Inertia and the propellant

On the MISSION tab's craft the propellant sits in two equal spherical tanks of radius $R$ = 0.37 m
on the thrust axis, $d$ = 0.6 m fore and aft of the centre of mass. 250 kg
of MMH and NTO at about 1.2 t/m³ fills each. With $m$ kg on board, each
tank is a solid sphere about its centre, moved by the parallel-axis
theorem [14, ch. 9]:

$$I(m) = I_\text{dry} + \mathrm{diag}\left(\tfrac25 mR^2,\ \tfrac25 mR^2 + md^2,\ \tfrac25 mR^2 + md^2\right)$$

The dry tensor is the full box's less the full tanks':
$I_\text{dry} = \mathrm{diag}(972.6, 1417.6, 1417.6)$ kg m². Empty, the
craft turns 15 % faster in pitch and yaw than full.

- **Each frame** the tank has changed, `craftAttitude.js` sets the new
  tensor (`attitude.js` `setInertia`, which makes the `sixdof.js` models
  again, since they hold its inverse). Within a frame the tensor is held.
- **The liquid turns with its tank,** as a rigid body. Slosh, and the lag
  of a liquid in a turning tank, are left out. So are the terms in
  $\dot I$ and the exhaust's own angular momentum (jet damping). They
  are of the order of the propellant's flow times a distance squared (to
  the tanks, to the nozzle) times the rate: during an engine burn
  (1.6 kg/s) at the 3°/s limit with the nozzle 1.5 m back, about 0.2 N m,
  half a per cent of the thrusters' torque, and nothing outside a burn.
- **The tanks are equal,** so the centre of mass stays put as they drain.
- The NASA check cases and `sixdof.js` keep fixed inertia, as the cases
  do.
- A ROCKET-tab stage keeps its propellant in one cylindrical tank of its
  own diameter instead ([below](#a-stages-attitude)), on the same terms:
  the tank keeps its shape as it drains, so the tensor is linear in the
  propellant, and it is centred on the centre of mass.

### A stage's attitude

A craft launched from the ROCKET tab is the stage left burning at cutoff,
any stages above it and the payload (`rocket-panel.tsx` `reached`), and
`mission.ts` gives it an attitude sized to it (`craftAttitude.js`
`stageAttitude`), not the MISSION craft's box. It is a cylinder of the
stack's diameter $d = 2R$ on the thrust axis:

- **The tank** holds the full load of the stages left, $m_p$ (not only
  what is left at cutoff), in one solid cylinder of the stage's diameter,
  $h = m_p/(\rho\pi R^2)$ long, at the propellant's bulk density
  $\rho$ [16]: 320 kg/m³, liquid oxygen and hydrogen at a mixture ratio
  of 4.83, for an engine of 400 s or more in vacuum, and otherwise
  1,030 kg/m³, liquid oxygen and RP-1 at 2.77 (both the table's figures
  for expansion to vacuum). Storable propellants are
  denser (1.20 g/cm³ for nitrogen tetroxide and MMH [16]), so their tanks
  come out 15 % long. Engines run hydrogen richer than the table's
  ratio, which makes their propellant denser and their tanks shorter
  than here.
- **The body** is one diameter longer than its tank, $L = h + d$: the
  engine and thrust structure aft, the payload and its adapter fore. Its
  dry mass $m_d$, payload included, is a thin-walled cylinder of that
  length about the same centre.
- **The tensor**, by the closed forms for the two cylinders [14, ch. 9],
  with $m$ the propellant on board:

  $$I_{xx} = m_d R^2 + \tfrac12 m R^2,\qquad I_{yy} = I_{zz} = m_d\left(\tfrac{R^2}{2} + \tfrac{L^2}{12}\right) + m\left(\tfrac{R^2}{4} + \tfrac{h^2}{12}\right)$$

- **The thrusters** are sized so the stage turns, full, as the MISSION
  craft does full: the same angular acceleration about each axis,
  $\tau_{\max,i} = \alpha_i I_{ii}$ with $\alpha$ = 0.0200 rad/s² in
  roll and 0.0246 rad/s² in pitch and yaw, the same 3°/s limit and the
  same 290 s. So every craft launched in the app turns alike, and the
  auto-turn's lead is the same. The roll pairs sit at the skirt, $R$
  from the axis; the pitch and yaw couples at the two ends, $L/2$ from
  the centre. The centre of pressure is $L/10$ behind the centre of mass,
  as the box's 0.3 m in 3 m.
- **Saturn V's S-IVB** at cutoff, as the ROCKET tab flies Apollo 11:
  59.7 t dry with the spacecraft and 107.1 t of propellant, a tank of
  4.18 m and a body of 14.28 m at the stack's 10.1 m (the ROCKET tab has
  one diameter for the whole stack, so its upper stages come out short
  and wide). Full, $I = \mathrm{diag}(2.89, 2.61, 2.61)\times10^6$
  kg m², and the thrusters are 4.5–5.7 kN each. With 70 % of the
  propellant left, a 90° slew to prograde takes 33.5 s and 12.2 kg.
- **Left out:** a real stage of this size carries much weaker thrusters
  than that and turns more slowly; here the turning rate is the same for
  every craft by choice. The centre of mass does not move as the tank
  drains (a real stage's moves aft as it settles), and the payload is
  spread along the shell rather than at the front.

### Turning for a node

A manoeuvre node turns the craft to it by itself (AUTO NODE TURN, on by
default). The turn starts

$$t_\text{turn} = t_\text{node} - (1.1\,t_\text{slew} + 5\ \text{s})$$

before the node, with $t_\text{slew}$ the controller's own closed-form
time for the turn (`slewTime`, a few per cent over what it takes): the
tenth covers the gyroscopic terms, the sampling and the reference's own
turning, and the 5 s lets it lock. The turn is measured where the craft
and the node's direction will be at $t_\text{turn}$: a locked craft on
its reference then, and the node's direction in the orbital frame then.
That matters at high warp, when a frame can carry the orbital frame
through tens of degrees. Found a few passes from now, the turn starts
exactly at its time, even inside a frame. After the burn the craft goes
back to the mode it had. A node too close to settle for starts the turn
at once, and the log says how long the turn needs and how long is left.
When a node burn starts, the log says if the axis is more than a degree
off its direction.

In NODE mode, the craft aims along the node's $\Delta\mathbf v$ in the
orbital frame of the moment until the burn is set up (at the start of the
frame it falls in), then along the burn's fixed direction, and afterwards
holds the direction it burned along.

**Steps.** Under control, one RK4 step a control period, cut at frame
edges. Without control, RK4 at a step that turns the body at most
0.05 rad and takes a twentieth of the gravity-gradient and aerodynamic
swings' periods, at most 30 s. At most 20,000 steps a frame; a burn is
then flown only as far as the attitude has reached.

### Burns along the body axis

`craftAttitude.js` keeps what the thrust axis did, back to the kernel's
state, as spans: each step's start and end directions, or a stretch
locked on a reference. A burn goes to the kernel as pieces of those
spans:
- **Locked in a pointing mode:** a burn steered in the orbital frame (the
  kernel's `vnb` burns), which is exactly a point-mass craft's steered
  burn.
- **Locked in a hold:** a burn along the held axis.
- **Turning or free:** a piece per step (merged while the axis moves under
  $10^{-4}$ rad), along the step's mean direction.

The kernel only steps up to the clock, which the attitude has always
reached, and the drawn carry takes the same pieces. A manoeuvre node on a
6-DOF craft burns along the body axis too; the log says when the axis was
more than a degree off the node's direction.

### Where the attitude is carried

On the main thread, frame by frame, and not in the kernel's Worker.
`npm run bench:attitude` measured both on this machine (Node 20, an
idle machine; the attitude's share of a frame, its craft against a
point-mass twin):

| Main thread | ms a frame |
| --- | --- |
| Held prograde, 1× (60 fps) | 0.02 |
| Held prograde, a day a second | 0.08 |
| A 90° slew to prograde, 1× (median of its 2,029 frames) | 0.01 |
| The same slew inside one frame, a day a second (once) | 7.6 |
| Thrusters off, tumbling under the gravity gradient, a day a second | 1.5 |

| In the kernel (a 60 s step in low orbit) | ms |
| --- | --- |
| Coasting (3 steps) | 1.4 |
| Ending on every 0.1 s control sample (600 steps) | 72 |

Integrated with the translation, the kernel's steps would have to end on
every control sample while the craft turns: fifty times the cost of the
coast, for a rotation that costs microseconds alone. Moved to the Worker
as a separate loop, the cost would be the main thread's, plus a frame of
lag that the drawing would have to carry anyway. Accuracy is the same
either way, and on the main thread the drawn attitude is never late.

Accuracy of the main-thread path, against `sixdof.js` integrating the
translation and the attitude together with the controller in the loop
(a 428 m/s burn in a 400 km orbit, 600 s,
[Validation](../validation.md#attitude-in-the-app-attitudetestmjs)):
held prograde, 0.2 m; burning through a 30° turn, 1.2 m of the 7.5 km the
turn costs (the coupled run's inertia fixed, the app's falling 2 % over
the turn). The two-body carry within a frame leaves out the frame's
thrust: at a day a second, a 5 kN burn on 1.5 t turns prograde by 0.03°
in a frame, while a locked burn goes to the kernel steered exactly.

## References

[1] NASA Engineering and Safety Center, "Check-cases for verification of 6-degree-of-freedom flight vehicle simulations," Vols. I and II, NASA/TM-2015-218675 (NESC-RP-12-00770), 2015. [Online]. Available: https://nescacademy.nasa.gov/flightsim/2015

[2] O. Montenbruck and E. Gill, *Satellite Orbits: Models, Methods and Applications*. Berlin, Germany: Springer, 2000, §3.2.4.

[3] J. H. Lieske *et al.*, "Expressions for the precession quantities based upon the IAU (1976) system of astronomical constants," *Astron. Astrophys.*, vol. 58, 1977.

[4] P. K. Seidelmann, Ed., *Explanatory Supplement to the Astronomical Almanac*, 1992, pp. 114–115 (IAU 1980 nutation). The nutation table and fundamental arguments are those of NAIF CSPICE `zzwahr.c`.

[5] L. G. Jacchia, "New static models of the thermosphere and exosphere with empirical temperature profiles," Smithsonian Astrophys. Observatory, Special Rep. 313, 1970.

[6] L. G. Jacchia, "Revised static models of the thermosphere and exosphere with empirical temperature profiles," Smithsonian Astrophys. Observatory, Special Rep. 332, 1971.

[7] M. P. Hickey, "The NASA Marshall Engineering Thermosphere Model," NASA Contractor Rep. CR-179359, 1988. MET-88's Fortran listing.

[8] M. P. Hickey, "An improvement in the numerical integration procedure used in the NASA Marshall Engineering Thermosphere Model," NASA Contractor Rep. CR-179389, 1988. The Gaussian quadrature.

[9] J. K. Owens, "NASA Marshall Engineering Thermosphere Model: Version 2.0," NASA/TM-2002-211786, 2002. MET-1999's Sun and the worked example.

[10] J. K. Owens *et al.*, "Marshall Engineering Thermosphere Model, Version MET-2007," NASA/TM-2017-218238, 2017. What MET-1999 did with time.

[11] F. L. Markley and J. L. Crassidis, *Fundamentals of Spacecraft Attitude Determination and Control*. New York, NY, USA: Springer, 2014, doi: 10.1007/978-1-4939-0802-8.

[12] B. Wie, *Space Vehicle Dynamics and Control*, 2nd ed. Reston, VA, USA: AIAA, 2008.

[13] K. D. Bilimoria and B. Wie, "Time-optimal three-axis reorientation of a rigid spacecraft," *J. Guid. Control Dyn.*, vol. 16, no. 3, pp. 446–452, 1993, doi: 10.2514/3.21030.

[14] H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. Oxford, U.K.: Butterworth-Heinemann (Elsevier), 2020. §13.3 (specific impulse), ch. 9 (moments of inertia, the parallel-axis theorem).

[15] ArianeGroup, "Chemical bi-propellant thruster family," product brochure. [Online]. Available: https://ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf

[16] Wikipedia, "Liquid rocket propellant," Bipropellants table (bulk density $d$, optimal expansion from 68.05 atm to vacuum, from JANNAF data compiled in D. K. Huzel and D. H. Huang, NASA SP-125), 2026. [Online]. Available: https://en.wikipedia.org/wiki/Liquid_rocket_propellant
