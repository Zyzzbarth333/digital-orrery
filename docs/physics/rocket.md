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

**For model, high-power and sounding rockets** (used by the
[cross-check](#checked-against-openrocket-and-rocketpy-rocketxchecktestmjs)):
- **Thrust curves** (`thrustCurve` on a stage): thrust against time from
  ignition, as motor makers publish it, linear between points. The
  propellant burns in proportion to the impulse delivered, and the stage
  burns out at the curve's end. A stage's curve may start with a wait
  before its motor lights.
- **Drag against Mach** (`cdAt(mach, t, burning)`), with the speed of sound
  from the 1976 standard. Base drag is lower with an engine lit, so it is
  told whether one is.
- **Straight up** (`vertical`, no pitchover) and **stop at apogee**
  (`stopAtApogee`).
- **Held on the pad** until the thrust outweighs the rocket: a motor's
  thrust builds from nothing over the first moments.

The ROCKET tab's own vehicles still burn at a constant thrust; an
[OpenRocket design](#openrocket-designs-in-the-rocket-tab) uses all of
these. A steady **wind** (`wind`, m/s, blowing back along the plane) and
**weathercocking** (`weathercock`: from the top of the launch rod the
rocket flies along its velocity through the air, so it turns into the
wind, at once, as a point mass with no attitude must) fly a design's
launch conditions.

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
  and thrust-to-weight. Starting points: four real launchers
  ([below](#real-launchers)), a generic two-stage launcher sized for 22 t to
  low orbit, and Curtis's Example 13.3 rocket.
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

## Real launchers

The ROCKET tab starts from four real launchers (`src/physics/launchers.js`).

**How the figures show:**
- A real launcher's figures sit in unlit, greyed windows as published.
- A figure its maker doesn't publish has a dashed outline, and its tooltip
  says it is an estimate.
- Changing any vehicle figure makes the design the user's own: the windows
  light, the preset reads "Custom, from …", and **Back to published**
  restores it.
- Choosing a real launcher also sets its pad, inclination and orbit.
- After an ascent, the launcher's real flight is set beside the model's at
  the same times after liftoff.

| Launcher | Source | Not published (estimated) | Flight beside it |
| --- | --- | --- | --- |
| Saturn V (Apollo 11) | NASA SP-2000-4029, *Apollo by the Numbers*: actual weights at ignition, p. 284; F-1 and J-2 ratings as NASA's Saturn V news reference gives them | the drag coefficient; the engine ratings via secondary copies | Apollo 11, p. 103 (space-fixed) |
| Falcon 9 Block 5 (booster landing) | SpaceX, *Falcon User's Guide* (2025), §2: diameter, thrust | masses, Isp (commonly cited); the landing reserve, fitted | Crew Dragon Demo-1 webcast telemetry (public domain), speed over the ground |
| Falcon 9 Block 5 (expendable) | as above; 22.8 t to low orbit | as above | none |
| Electron | Rocket Lab, *Electron Payload User's Guide* v7.0, pp. 12-13 | dry masses, first-stage propellant and sea-level Isp, the kick stage | no open telemetry found |

**How each is modelled:**
- **Saturn V.** Apollo 11's stage rows add up exactly to its 6,477,875 lb
  at ignition. Mass that fell away with a stage rides with it, because the
  model drops mass only at staging: the S-IC/S-II interstage and the escape
  tower ride on the S-IC, the S-II/S-IVB interstage on the S-II, and the
  instrument unit on the S-IVB.
- **Falcon 9 (booster landing).** A recovered first stage keeps propellant
  back to land, and SpaceX publishes neither that nor the stage masses. The
  landing preset burns 355 t on the way up, the amount at which the
  model's first stage cuts off at Demo-1's measured 1.881 km/s over the
  ground. It carries the other 55.9 t as dead weight.
- **Electron.** The 13,000 kg at liftoff is Rocket Lab's figure. The dry
  masses, the first stage's propellant and its sea-level Isp are estimates,
  and the kick stage rides as part of the 0.3 t payload.

**Against the real flights** (`launchers.test.mjs`):

| Check | Real | Here |
| --- | --- | --- |
| Saturn V: S-IC burnout | 161.63 s, 66.1 km, 2.764 km/s | 163.1 s, 82.1 km, 2.661 km/s |
| Saturn V: S-IVB propellant to reach orbit | 147.13 s at the rated flow: 36.5 t | 38.4 t, keeping 68.7 t for the translunar burn |
| Saturn V: parking orbit | 186 × 183 km | about 380 km |
| Falcon 9 (landing): first-stage cutoff | 158 s, 85.3 km, 1.881 km/s | 127 s, 65.3 km, 1.871 km/s (fitted) |
| Falcon 9 (landing): second-stage cutoff | 548.9 s, 198 km, 7.548 km/s | 493 s, 307 km, 7.423 km/s, 2.5 t left |
| Falcon 9 (expendable): 22.8 t to low orbit | SpaceX's figure | reaches orbit with every tonne spent |
| Electron: 0.3 t with the kick stage | 200 kg to 500 km sun-synchronous | reaches orbit at 181 km, every tonne spent |

**What the model leaves out:**
- **Guidance.** The masses, burn times and staging speeds land close, but
  the model has no closed-loop guidance: it kicks once and ends level
  wherever the gravity turn takes it, higher than the real ascents, which
  were steered to their orbits.
- **Throttling.** Demo-1 throttled down through max q, so its first stage
  burned 31 s longer than the model's.
- **Saturn V's centre engines.** The real S-IC and S-II cut their centre
  engines early, which the model also leaves out.

## Checks (`rocket.test.mjs`)

| Check | Reference | Result |
| --- | --- | --- |
| Single stage, burn time and delta-v | Curtis Example 13.2 | 238.8 s; $c\ln n$ exactly |
| Optimal three-stage vehicle, 5,000 kg to 10 km/s | Curtis Example 13.7 | η 0.4668 s/km, mass ratios 4.541, 2.507, 1.361, 191,221 kg (book 191,200, to four figures); a minimum by the book's second-order test; any shift of delta-v between stages is heavier |
| Gravity-turn ascent | Curtis Example 13.3 | burnout 5.737 km/s, 9.166° (book 9.154°), 110.39 km (110.32), 318.33 km downrange (318.36); drag loss 0.297 km/s (0.298), gravity loss 1.413 (1.410); maximum dynamic pressure 0.156 atm |
| Hohmann burn to geostationary height; escape | vis-viva | exact |
| A level-ending gravity turn, and cutoff in orbit | | flight-path angle 0 to 0.01°; with cutoff, eccentricity 6×10⁻⁵ with propellant kept |
| The end state in 3D | the inclination aimed for | within 0.01° of 51.6° |

## Checked against OpenRocket and RocketPy (`rocket.xcheck.test.mjs`)

Two of OpenRocket's own example designs, flown calm and straight up from
sea level on the equator (gravity 9.780 m/s²) in the ISA atmosphere, by
three simulators:
- **OpenRocket 24.12** (GPL-3.0, used as an outside oracle).
  `npm run oracle:openrocket` (`rocket.openrocket.mjs`) flies them through
  `tools/openrocket/ORRun.java`, a small runner compiled against a local
  OpenRocket jar. It fixes OpenRocket's random seed, because OpenRocket
  nudges its rockets with small random pitch and yaw moments, and uses a
  5 ms step. It keeps the motors' thrust curves and ignition times, the
  masses as OpenRocket flew them, the drag coefficient against time and
  against Mach (burning and coasting), and the results
  (`fixtures/rocket_xcheck.json`). No OpenRocket code is in the repo.
- **RocketPy 1.13** (MIT), in its point-mass "3 DOF" mode, given the same
  thrust curves, masses and Mach tables (`tools/rocketpy/fly.py`, in its
  own Python environment, `tools/rocketpy/requirements.txt`). Its 3-DOF
  flight does not run with a time limit, so the second stage starts from
  the first stage's state at burnout, interpolated.
- **Ours:** `ascent` with the thrust curves, `vertical`, `stopAtApogee`,
  the reference area and `cdAt`, with the drag coefficient taken two ways:
  OpenRocket's own against time (replayed), and the Mach tables RocketPy
  gets.

| Vehicle | Simulator | Apogee | Time to apogee | Top speed |
| --- | --- | --- | --- | --- |
| One stage, A8 motor, 64.5 g | OpenRocket | 51.19 m | 3.481 s | 29.38 m/s |
| | ours, OpenRocket's drag | 51.19 m | 3.481 s | 29.38 m/s |
| | RocketPy | 51.20 m | 3.481 s | 29.38 m/s |
| | ours, drag against Mach | 51.19 m | 3.482 s | 29.38 m/s |
| Two stages, H148R each, 2.574 kg | OpenRocket | 679.02 m | 11.045 s | 159.02 m/s |
| | ours, OpenRocket's drag | 679.12 m | 11.046 s | 159.04 m/s |
| | RocketPy | 678.89 m | 11.044 s | 158.99 m/s |
| | ours, drag against Mach | 679.03 m | 11.046 s | 159.01 m/s |

The test holds each pair within 0.1 %, and our height every half second
within 0.1 % of OpenRocket's apogee (it is within 0.10 m on the two-stage).

What it took to agree:
- **The motors' own curves.** Thrust sampled from OpenRocket's output, at
  its steps up to 0.09 s apart, lost the shape of each burn's start, which
  cost 0.4 % of the two-stage's apogee.
- **The time to apogee between samples.** OpenRocket reports the time of
  its highest sample, and its default steps near the top are 0.2 s long.
  The fixture finds where the climb rate crosses zero.
- **Held on the pad,** as OpenRocket and RocketPy hold a rocket until its
  thrust outweighs it.
- **OpenRocket's own masses.** Its flight of the two-stage loses 295.6 g
  while the booster burns, though the booster's H148R holds 147.8 g of
  propellant, then 147.8 g more while the sustainer burns: 148 g more in
  all than the two motors hold. The cross-check flies the masses as
  OpenRocket flew them, since it compares the flight, not the bookkeeping.

**Not run: RASAero II.** It is a Windows program, and this machine has no
Wine. It would add a third estimate of drag against Mach rather than
another flight.

## OpenRocket designs in the ROCKET tab

**OpenRocket design** opens an `.ork` file and flies a simulation that
OpenRocket saved in it, with the ascent above, beside OpenRocket's own
result. The file is read in the browser (`src/physics/ork.js`) and never
leaves it. Like the airbrakes project's reader, it takes OpenRocket's
record of the flight rather than running OpenRocket.
- **The file:** an `.ork` is XML, zipped (unzipped in the browser with
  `DecompressionStream`), gzipped or plain. `readOrk` takes the rocket's
  stages and motors, and each simulation's launch conditions, summary
  and saved flight: up to 58 quantities at each of OpenRocket's steps,
  and its events.
- **The vehicle** (`vehicleFromOrk`):
  - **Stages** split at the stage-separation events.
  - **Thrust:** each stage's thrust curve is OpenRocket's saved thrust,
    joined by straight lines. The file names its motors but holds no
    thrust curves.
  - **Masses** are as the flight carried them: what it lost while each
    stage was the bottom one, what dropped at each separation, and what
    reached apogee.
  - **Drag:** each stage's drag coefficient against Mach, burning and
    coasting, from the rows before any parachute opens. The replay is
    the drag coefficient against time.
  - **Air:** density, pressure and the speed of sound against height,
    as the flight recorded them. Files from before OpenRocket 24.12 save
    no density, so it comes from the pressure and temperature (p / R T,
    within 0.13 % of 24.12's own). With no air recorded at all, the 1976
    standard from the pad's height.
  - **Reference area:** OpenRocket saves it to three decimals (0.019 m²
    for a 154 mm body's 0.0186), 2 % off. It is recovered from the drag
    force, D / (q C_D), over the climb's rows, within that rounding.
  - **Gravity:** as at the pad.
- **The flight** (`flyOrk`):
  - It goes up the launch rod, then along its velocity through the air.
    Its axis turns into the simulation's average wind with a 0.1 s lag,
    the airbrakes project's value for a stable rocket (`turnLag`).
    OpenRocket's gusts are left out.
  - A tilted rod sets the direction it leaves at, taken to lean into the
    wind (OpenRocket launches into the wind by default).
  - It stops at apogee.
  - Drag comes from the Mach tables, or from OpenRocket's own drag
    replayed. Once a parachute opens before apogee, as in three of
    OpenRocket's examples, both use OpenRocket's recorded drag.

`ork.test.mjs` checks it three ways:

| Check | Result |
| --- | --- |
| A design of our own, written as OpenRocket writes its files, zipped (with OpenRocket's data descriptors), gzipped and plain | reads the same every way; entities, quoting and CDATA as XML has them |
| A two-stage flight flown by `ascent`, saved in that format, read back | masses within 0.02 % (0.2 % at the four figures OpenRocket saves); each stage's impulse within 1 %; apogee and the time to it within 0.1 % (0.3 %) |
| A flight saved without air density, as before OpenRocket 24.12; its reference area saved to three decimals | the air from pressure and temperature, apogee within 0.3 %; the area recovered to 0.1 % |
| OpenRocket's examples, every saved simulation: a model rocket on A8, B4 and C6 motors, and the two-stage rocket on H148R and I357T plus I59WN, all in a 2 m/s wind | within 0.72 % of OpenRocket's apogee (−0.72 to +0.49 %) |

OpenRocket's examples are GPL, so they are not in the repo. The test flies
them when `npm run oracle:openrocket` has unpacked them from a local
OpenRocket jar, and skips them otherwise.

**Limits:**
- It's a point mass in the plane of the wind: its axis follows a set lag,
  not the rocket's own stability, and a rod pointing across the wind is
  taken as leaning into it. On a few hundred saved flights of real
  high-power designs the median difference from OpenRocket's apogee is
  about 1.2 %, most of it the launch's geometry.
- Simulations that OpenRocket itself stopped before apogee can't be
  flown; tumbles and errors it logged are shown.
- The thrust between OpenRocket's samples is a straight line.
- OpenRocket saves three or four figures, so a model rocket's masses come
  out to the nearest gram.
- A design flies to apogee in the ROCKET tab only. It isn't launched into
  the scene.

