# Rockets: stages, staging and the ascent

`src/physics/rocket.js` holds the launch-vehicle physics. The ROCKET tab
(`src/app/rocket-panel.tsx`) puts it to work. Both follow Curtis,
*Orbital Mechanics for Engineering Students* (4th ed.), chapter 13.

## A stack of stages

Each stage has a dry (empty) mass, propellant, a vacuum and a sea-level
specific impulse, and a vacuum thrust. Stages are listed bottom first: the
first burns first, and each carries everything above it. For each,
`stackPerformance` gives:
- **Delta-v,** by the rocket equation with the vacuum Isp:
  $\Delta v = I_{sp} g_0 \ln(m_0/m_f)$, with $g_0 = 9.80665$ m/s².
- **Burn time:** $m_p/\dot m$, where $\dot m = T/(I_{sp} g_0)$.
- **Thrust-to-weight at ignition,** $T/(m_0 g_0)$.

The spent stage drops away before the next lights.

## The lightest stack for a job

`optimalStaging` is Curtis's section 13.6. Given each stage's exhaust speed
$c_i = I_{sp,i} g_0$ and structural ratio
$\varepsilon_i = m_{E,i}/(m_{E,i} + m_{p,i})$, the stack of least mass that
gives a payload the burnout speed $v_{bo}$ has a Lagrange multiplier
$\eta$ solving
$$\sum_i c_i \ln\frac{c_i\eta - 1}{c_i\varepsilon_i\eta} = v_{bo},$$
found by bisection.
- **Stage mass ratios:** $n_i = (c_i\eta - 1)/(c_i\varepsilon_i\eta)$.
- **Stage masses,** top down: $m_i = (n_i - 1)/(1 - n_i\varepsilon_i)$
  times everything above it.
- **Limit:** no stack exists beyond $\sum_i c_i\ln(1/\varepsilon_i)$.

The tab's "Size the stack for this job" keeps each stage's Isp, structural
ratio and thrust-to-weight, and rescales its masses and thrust.

## Working backwards from a job

The delta-v a job needs (`deltaVToOrbit`, `deltaVDeparture`,
`deltaVToApoapsis`):
- **Into orbit:** the circular speed at the altitude, less the Earth's
  rotation along the launch azimuth, $\omega R \cos\phi \sin A$ (408 m/s
  due east from Florida), plus the ascent's losses. The losses default to
  1.5 km/s, typical, and are replaced by the stack's own once an ascent is
  flown.
- **On from a 200 km parking orbit:**
  - geostationary transfer: the Hohmann first burn to 35,786 km, 2.455 km/s;
  - the Moon: a departure of C3 about −2 km²/s², 3.13 km/s;
  - the window picked in the PLANNER:
    $\sqrt{C_3 + 2\mu/r} - \sqrt{\mu/r}$, the Trajectory Browser's
    convention.

The launch azimuth for an inclination is $\sin A = \cos i/\cos\phi$
(ascending); an inclination below the pad's latitude can't be reached
directly.

## The ascent

`ascent` is the gravity turn of Curtis section 13.2, integrated by RK4 as
motion in the launch plane about the Earth's centre, which holds
equations (13.6)–(13.8) and their curvature terms exactly. The sequence:
1. **Vertical climb** to the pitchover height. The step is shortened to
   land on it exactly: the result is very sensitive to it, and a fixed
   0.01 s step moved the burnout flight-path angle by 0.1°.
2. **The kick:** a small turn to flight-path angle $\gamma_0$.
3. **The turn:** thrust along the velocity relative to the air from then
   on.

**Additions to the book:**
- **The Earth turns.** The book's Earth doesn't. Here the atmosphere and
  the pad move with it along the launch plane, so the rocket starts with
  the pad's speed and drag acts on the air-relative velocity.
- **Isp and thrust vary with pressure:**
  $I_{sp} = I_{sp,vac} + (I_{sp,SL} - I_{sp,vac})\,p/p_0$.
- **Engine cutoff in orbit** (`toOrbit`): the engine stops when the speed
  reaches the circular speed for the height, and the stage keeps its
  remaining propellant.
- **A kick that ends level** (`levelAscent`): the kick $\gamma_0$ is found
  by bisection so the flight-path angle at cutoff is zero.
- **Losses:** gravity $\int g\sin\gamma\,dt$ and drag $\int D/m\,dt$
  (Curtis 13.27).

`ascentToState` turns the end state into a geocentric J2000 state:
- **Placing the plane:** the plane is fixed in inertial space through the
  pad at liftoff, placed by the app's Earth orientation
  (`bodyAxesEqj`), along the azimuth.
- **The pad's speed across the plane:** a real launch steers it away. It
  is left out and reported, as an upper bound on that steering's cost
  (289 m/s for 51.6° from Florida).

`ascentTrack` does the same for every sample of the ascent, for drawing
the climb: geocentric J2000 states from the pad (moving with the Earth's
surface along the plane) to the cutoff state, which is `ascentToState`'s.

## In the app

The ROCKET tab:
- **Vehicle:** each stage's numbers, and the stack's delta-v, burn times
  and thrust-to-weight. Two starting points: a generic two-stage launcher
  sized for 22 t to low orbit, and Curtis's Example 13.3 rocket.
- **The job:** an orbit, a geostationary transfer, the Moon, or the
  PLANNER's window. It shows what the job needs against what the stack
  has, and sizes the stack for it.
- **Launch:** from one of five pads (approximate public coordinates), at
  the inclination asked for, lifting off at the clock. The ascent is
  drawn (altitude stretched), with the orbit it reaches and its losses.
  Then either:
  - **Launch from the pad:** the clock goes to ten seconds before liftoff
    and runs at 10 s a second. The craft climbs along the ascent in the
    scene, with the rest of the planned climb drawn ahead of it, and the
    MISSION tab reads out its time, height and speed. At engine cutoff it
    joins the kernel as a craft.
  - **Put it in orbit:** the clock jumps to cutoff and the payload joins
    the kernel there.

  The climb is the planar ascent replayed, not flown by the kernel: the
  Earth's pull, the air and the engine were integrated in the ROCKET tab.
  Its heights are above the sphere the ascent is flown over, the
  equatorial radius (6,378.137 km, WGS-84). The MISSION tab measures a
  craft's altitude, periapsis and apoapsis about the Earth from the same
  radius, so the two agree at cutoff and the orbit reads the same in both
  tabs.
  Either way the craft carries the burning stage's engine and its
  leftover propellant, and any stages above it, so the next burns (a
  departure to the Moon, say) are flown from the MISSION tab.

The book's checks use Curtis's exponential atmosphere, 1.225 kg/m³ with a
7.5 km scale height. The app's launches fly through `realAtmosphere`
instead ([the space environment](environment.md#drag)): the 1976 standard
to 86 km, with its pressure for the Isp, and NASA's MET above 90 km for the
date and the pad.

## Checks (`rocket.test.mjs`)

| Check | Reference | Result |
| --- | --- | --- |
| Single stage, burn time and delta-v | Curtis Example 13.2 | 238.8 s; $c\ln n$ exactly |
| Optimal three-stage vehicle, 5,000 kg to 10 km/s | Curtis Example 13.7 | η 0.4668 s/km, mass ratios 4.541, 2.507, 1.361, 191,221 kg (book 191,200, to four figures); a minimum by the book's second-order test; any shift of delta-v between stages is heavier |
| Gravity-turn ascent | Curtis Example 13.3 | burnout 5.737 km/s, 9.166° (book 9.154°), 110.39 km (110.32), 318.33 km downrange (318.36); drag loss 0.297 km/s (0.298), gravity loss 1.413 (1.410); maximum dynamic pressure 0.156 atm |
| Hohmann burn to geostationary height; escape | vis-viva | exact |
| A level-ending gravity turn, and cutoff in orbit | | flight-path angle 0 to 0.01°; with cutoff, eccentricity 6×10⁻⁵ with propellant kept |
| The end state in 3D | the inclination aimed for | within 0.01° of 51.6° |
