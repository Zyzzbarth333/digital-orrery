# Journeys: legs, transfers, flybys and the rocket

The PLANNER tab plans a whole journey, not just one hop. You give a start
and any number of waypoints in order. Each leg is solved by patched conics
as you edit, and the n-body kernel flies the whole journey once you let go.
Each leg's transfer options are set side by side, and you can pick one.
The journey's delta-v is then turned into a stack of stages.

The code:
- **`src/physics/transfers.js`:** closed-form transfers and flyby pieces.
- **`src/physics/journey.js`:** legs, chaining, options and drawing.
- **`src/physics/journeyFlight.js`:** the kernel's flight.
- **`src/physics/staging.js`:** the rocket.
- **The app side:** `src/app/journey.ts` holds the store,
  `src/app/journey-panel.tsx` the panel, `src/app/journey.worker.ts` runs
  the kernel off the page's thread, and `src/scene/journeyLayer.ts` draws
  the journey in the scene.

The reference throughout is Curtis, *Orbital Mechanics for Engineering
Students*, 4th edition (Butterworth-Heinemann, 2020). It is cited by
section, equation and example; staging is chapter 13 there (chapter 11 in
the first two editions).

## A journey

- **The start:** the pad (a parking orbit at a given altitude, reached by
  the rocket below), an orbit, or the selected craft's own state.
- **Each waypoint:** a body (a planet, the Moon or a named small body) and
  what happens there:
  - **flyby:** the lowest altitude it may pass at;
  - **orbit:** a circular orbit at an altitude, and a stay;
  - **land:** landing from that orbit, then a stay.
- **Dates:** each waypoint has an arrival date, and leaves when its stay
  ends. A flyby leaves the moment it arrives.

Each leg is solved about the body its two ends share:
- **About the Sun:** two planets or small bodies.
- **About a planet:** the planet and its own moon (Earth to the Moon and
  back), or two moons of one planet.
- **About the Sun, from the planet:** a moon to another planet. The leg runs
  from the moon's planet, and the moon's own escape is patched on (three
  levels of patched conics).
- **An orbit change:** the same body at both ends, with no flyby. This is a
  Hohmann transfer (or bi-elliptic, or phasing) between the two orbits, and
  it sets its own arrival. Later waypoints keep their spacing from it.
- **A return to the same body:** if either end is a flyby, the leg goes once
  round the Sun and back (Galileo's two years from Earth to Earth).

### One leg, by patched conics

A leg between two bodies is Lambert's arc between their centres over the
time of flight (orbital.js `lambertRevs`, 0 to 2 revolutions; the cheapest
is kept). The excess velocity at each end is the arc's velocity less the
body's: $\mathbf v_\infty = \mathbf v_\text{arc} - \mathbf v_\text{body}$.
The burns:

- **Leaving a circular orbit of radius $r_p$** (Curtis 8.40, Examples 8.4
  and 8.9):
  $$\Delta v = \sqrt{v_\infty^2 + \frac{2\mu}{r_p}} - \sqrt{\frac{\mu}{r_p}}$$
- **Captured into a circular orbit** (Curtis 8.58, Example 8.10, with
  $e = 0$):
  $$\Delta v = \sqrt{v_\infty^2 + \frac{2\mu}{r_p}} - \sqrt{\frac{\mu(1+e)}{r_p}}$$
- **Landing:** through the atmosphere where there is one (no burn: the
  entry and parachutes are not costed). On an airless body, the capture
  plus the orbit's circular speed, an ideal descent with no losses. Lifting
  off again costs the same, again with no losses.
- **A small body:** its gravity is a guess, a sphere of its diameter at
  2,000 kg/m³. That is tiny either way, so a capture is a rendezvous, about
  $v_\infty$.
- **A moon left for another planet:** the speed needed at the moon's
  distance from its planet, $\sqrt{v_{\infty,P}^2 + 2\mu_P/a}$, less the
  moon's own $\sqrt{\mu_P/a}$, is the excess speed about the moon.
- **A planet's own moon:** the free end is a point on the parking orbit at
  the planet, in the moon's orbit plane. It is placed where the leg costs
  least, by 36 trial angles and then a golden-section search.

### Chaining legs, and the gravity assist

Leg $k+1$ leaves waypoint $k$ at its arrival date (a flyby) or after its
stay. A flyby joins the two legs either side of it. It must turn the
incoming excess velocity $\mathbf v_{\infty,\text{in}}$ (leg $k$'s arrival)
onto the outgoing one (leg $k+1$'s departure). A hyperbola of periapsis
$r_p$ turns the excess velocity by (Curtis 8.75, Example 8.6)
$$\delta = 2\sin^{-1}\frac{1}{e},\qquad e = 1 + \frac{r_p v_\infty^2}{\mu}.$$

When the speeds differ, the flyby is two half-hyperbolas joined at
periapsis, with a burn there for the change of speed (a powered flyby):
$$\delta = \sin^{-1}\frac{1}{e_\text{in}} + \sin^{-1}\frac{1}{e_\text{out}},\qquad
\Delta v_p = \left|\sqrt{v_{\infty,\text{out}}^2 + \frac{2\mu}{r_p}} - \sqrt{v_{\infty,\text{in}}^2 + \frac{2\mu}{r_p}}\right|.$$
The periapsis that makes the turn is found by bisection. If it is below the
waypoint's lowest pass, the flyby passes at that height, and the turn still
missing is a burn at the edge of the sphere of influence,
$2v\sin(\Delta\delta/2)$. The panel flags it.

The aim point is the B vector, in Kizner's B-plane:
- **S:** along the approach.
- **T:** in the ecliptic, $\mathbf S \times \hat z$ normalised.
- **R:** $\mathbf S \times \mathbf T$.
- **Its size:** the aiming radius (Curtis 8.71, Examples 8.5 and 8.6),
  $$B = r_p\sqrt{1 + \frac{2\mu}{r_p v_\infty^2}}.$$
- **Its direction:** the part of $\hat u_\text{in} - \hat u_\text{out}$
  across the approach, the side away from the turn.

`flybyFromB` goes the other way: from an aim point $(B\cdot T, B\cdot R)$ to
the periapsis $r_p = \frac{\mu}{v^2}\left(\sqrt{1 + (Bv^2/\mu)^2} - 1\right)$
and the outgoing excess velocity, turned by $\delta$ about $\mathbf B \times \mathbf S$.

When the legs are solved in order, a leg that leaves a flyby prefers arcs
whose departure excess speed matches the arrival's. A chain of flybys then
picks arcs that join. Each option for such a leg is costed with the flyby
it needs.

## The options for a leg, compared

For each leg, every transfer that applies is listed with its delta-v (every
burn of the leg), its flight time and its departure:

- **Lambert, as scheduled:** the leg at the waypoints' dates.
- **Hohmann** (Curtis 6.2; Example 6.1; 8.13–8.16): two tangent burns
  between circular, coplanar orbits at the bodies' mean distances. Its
  window is the next date when the target leads by
  $\phi_0 = \pi - n_2 t_{12}$. The wait for it is the phase still to
  gain, at the rate $n_2 - n_1$ (Example 8.2 waits 453.8 days at Mars).
  About a planet, the craft can burn anywhere in its parking orbit, so any
  day will do.
- **Bi-elliptic** (Curtis 6.3, Example 6.3): out to a far apoapsis $r_B$,
  then down. About the Sun $r_B$ is three times the outer orbit; about a
  planet it is half the planet's sphere of influence. It is flagged where
  it beats Hohmann, which needs $r_C/r_A$ above 11.94 (Curtis Fig. 6.8). It
  flies two Lambert arcs through the apoapsis point, with a burn there.
- **Hohmann with a plane change** (Curtis 6.21, Examples 6.11 and 6.12):
  the angle between the two orbits is split between the two burns, each
  combined with its speed change,
  $\Delta v = \sqrt{v_1^2 + v_2^2 - 2v_1v_2\cos\Delta i}$. The split that
  costs least is found by golden section. 28° from a 300 km LEO to GEO
  puts 2.18° at the first burn: 4.221 km/s, against 4.245 for all of it at
  GEO.
- **Porkchop optimum:** a grid of departure by flight time, refined by
  Nelder–Mead (shared with `trajsearch.js`).
  - The departures run from the earliest across a synodic period. After a
    flyby the departure is fixed, so only the flight time varies.
  - The flight times run from 0.5 to 1.6 of Hohmann's (for a return to the
    same body, 0.8 to 2.2 of its period).
  - Each cell is the leg's full patched-conic cost: one Lambert solve
    (with up to one revolution about the Sun), or, for a leg to a planet's
    own moon, the trial angles of its free end too.
- **Phasing** (Curtis 6.4, Examples 6.4 and 6.5): for an orbit change that
  keeps its altitude and moves along the orbit by a lead angle. A phasing
  orbit of period $T_2 = T_1 - \Delta t/n$ is flown $n$ times, with a burn
  each way.
- **The gravity assist:** for a leg that ends at a flyby, not an
  alternative but the flyby's numbers: the turn, the periapsis, the B-plane
  aim, the heliocentric change it gives, $|\mathbf v_{\infty,\text{out}} -
  \mathbf v_{\infty,\text{in}}|$, and the burn it needs.

Choosing an option re-times the journey to it. The leg leaves at the
option's departure (the stay before it, or the start date, takes up the
difference) and arrives at its arrival. Later waypoints keep their spacing.
The ideal options (Hohmann, bi-elliptic, plane change) set the dates, and
the leg is then flown as Lambert's arc between those dates on the real
orbits. A new waypoint starts at its leg's porkchop optimum.

## Flying it

The plan is patched conics; the kernel is the n-body truth
(docs/physics/nbody-kernel.md). `planFlight` turns a solved journey into a
schedule, and `flyJourney` flies it. The worker does the same in the app,
and "Fly this journey" gives a new craft the burns the kernel made, as
scripted burns on the same kernel. Each step, in time order:

1. **The start:** at the periapsis of the departure hyperbola in the
   parking orbit (as the planner's launches already do,
   `launch.js departureHyperbola`). For the Moon, the start is on the
   leg's Lambert arc.
2. **Aimed corrections** (`kernelHost.aimTo`, Newton on the end position):
   - **The first:** once the craft is half again clear of the body it left,
     $1.5\,r_\text{SOI}/v_\infty$ after departure.
   - **The second:** three sphere-crossing times out from the target.
   - **What they aim at:** each is flown without the target's own gravity,
     at the B-plane point (the planet's position plus the planned B vector)
     at the planned arrival. The target's pull is the hyperbola, not an
     error to cancel; aiming at the periapsis point itself, with the pull,
     fails, because the craft reaches periapsis early, pulled in.
   - **Newton's start:** the two-body Lambert arc to that point gives the
     first guess, and a step that misses by more is halved.
3. **Two periapsis trims inside the target's sphere:** a burn along the B
   vector, with the radius found by the secant method on the two-body
   hyperbola about the target. The second trim comes halfway to the
   predicted periapsis.
4. **Captures:**
   - **The burn:** retrograde, steered with the velocity, from the
     predicted periapsis (not centred on it; braking before periapsis
     would drop a 6 km/s capture into Mars) down to the circular speed.
   - **The orbit's plane:** the arrival hyperbola's plane holds the next
     departure's excess velocity too, so the parking orbit already contains
     it.
5. **Departures from an orbit:** a prograde burn where the departure
   hyperbola's periapsis is. The craft waits within one orbit to reach it.
6. **Home through the air:** the aim is at the planned arc half an hour
   before the end, so no trial run meets the ground first.

The burns are finite, at 20 m/s² (3 km/s in two and a half minutes). The
closest approach to each waypoint is watched over a window about its date.
The osculating conic between samples gives the periapsis itself.

What the kernel does not yet fly:
- a landing (it waits in the low orbit);
- leaving a moon for another planet;
- a plane change between two orbits about one body (planned, not flown).

## The rocket it needs

`staging.js` sizes the stack for the journey's delta-v. It adds the climb
from the pad to the parking orbit when the journey starts there
(`rocket.js deltaVToOrbit`: the circular speed, less the Earth's turn
along the azimuth, plus 1.5 km/s of losses). Every burn of the journey is
the stack's, and the payload is what arrives.

Optimal staging is Curtis §13.6, in `rocket.js optimalStaging`. Given each
stage's exhaust speed $c_i = I_{sp,i} g_0$ and structural ratio
$\varepsilon_i$, the Lagrange multiplier $\eta$ solves (13.84)
$$\sum_i c_i \ln\frac{c_i\eta - 1}{c_i\varepsilon_i\eta} = \Delta v,$$
and then the stage mass ratios and masses follow, top down:
$$n_i = \frac{c_i\eta - 1}{c_i\varepsilon_i\eta},\qquad m_i = \frac{n_i - 1}{1 - n_i\varepsilon_i}\,m_\text{above}.$$

`sizeLauncher` tries one to four stages:
- **The stages:** stage 1 of one technology, the rest of another.
- **The pick:** the fewest stages whose liftoff mass is within 10 % of the
  lightest, since each stage beyond that adds engines and separations for
  little saving.
- **When none is possible:** a count is beyond what its stages can give
  ($\sum c_i \ln(1/\varepsilon_i)$), or its optimum would leave a stage
  empty, so fewer stages do it better ("no gain").

The stage technologies:
- **Isp:** Curtis Table 6.1's typical values: solid 290 s, nitric acid and
  MMH 310 s, LOX and LH2 455 s.
- **Structural ratio:** 0.1, the lower limit Curtis §13.4 gives for
  current materials.

Both can be edited, and they are not any one vehicle's. Real launchers come
to the ROCKET tab separately, and `staging.js` is where its comparison will
read from.

With identical stages, the Lagrange optimum is restricted staging (Curtis
13.56):
$$v_{bo} = N c \ln\frac{1}{\pi^{1/N}(1-\varepsilon) + \varepsilon}.$$
The tests check both against Examples 13.4 and 13.5.

## In the scene

- **Each leg's arc:** a dashed pale-amber line about its central body,
  placed at that body each frame. A leg about Earth moves with Earth.
- **The kernel's flown path:** a thin solid amber line about the journey's
  frame (the Sun, or Earth for a journey that never leaves it).
- **Each burn:** a burn node, an open square reticle with a centre dot
  (orange for a capture or landing, dashed for a flyby), with its delta-v
  in a window tag.

## Validation (`journey.test.mjs`)

| Check | Reference | Result |
| --- | --- | --- |
| Hohmann from an elliptical orbit's perigee | Curtis Ex 6.1 | 1.7225 + 1.3297 = 3.0522 km/s; 1,291.3 kg of propellant |
| Bi-elliptic against Hohmann | Ex 6.3 | 4.0285 km/s in 5.66 d against 4.0463 in 65,942 s |
| Where bi-elliptic wins | Fig. 6.8 | never below rC/rA 11.94; any rB above 15.58 |
| Phasing | Ex 6.4, 6.5 | 0.4970 km/s, T₂ 8,756.3 s; GEO drift 22.5 m/s |
| Plane change, either end and split | Ex 6.11, 6.12 | 4.2448, 6.3908; 2.1751° and 4.2207 km/s |
| Synodic period, Hohmann window, wait at Mars | Ex 8.1, 8.2 | 778.65 d (Ex 8.1 prints 777.9; its own figures and Ex 8.2 give 778.65); 258.8 d, 44.56°, 453.8 d |
| Departure, optimal capture, aiming radius | Ex 8.4, 8.5, 8.9, 8.10 | to the book's four figures |
| Venus flyby, dark side and sunlit | Ex 8.6 | 103.6°, 18,343 km, 31.78 and 37.27 km/s after |
| A Lambert leg on real ephemerides | Ex 8.8 | v∞ 3.1620 and 2.8847 km/s (book 3.1656, 2.8852 on its Algorithm 8.1 ephemeris) |
| B-plane round trip; a flyby needing no burn | geometry | 10⁻⁹ |
| Restricted and optimal staging | Ex 13.4, 13.5 | 5.657, 7.407, 7.928 km/s; 200,000 kg and the stage masses to the book's figures |
| Legs chained, stays, orbit changes, options, choosing one | the journey's own rules | all hold |
| Mariner 10, flown by the kernel (NASA's dates) | the plan | Venus 0.4 km, Mercury 0.1 km off the planned periapsis |
| Earth to Mars, captured | the plan | 1.4 km |
| Round the Moon and home | the plan | Moon 17 km; home 3 km from the aimed point |
| Earth orbit, Moon orbit for 3 days, home | the plan | Moon 0.9 km; home 0.5 km |

## Limits

- **Patched conics:** the planets' centres are the ends of each leg, and
  the Sun alone pulls along it. The kernel's corrections close the gap,
  and the flown journey's corrections are part of its delta-v as flown.
- **A return to the same body after whole years:** the two ends are nearly
  the same point, so Lambert's plane is the ecliptic and the arc can be far
  from the cheapest resonant orbit. A deep-space node, coming with drag
  editing, is the way to shape it.
- **Landings:** the entry through an atmosphere and the losses of an ascent
  or a descent are not costed.
- **The ideal options:** Hohmann, bi-elliptic and plane change use mean
  circular orbits. "As scheduled" and the porkchop optimum use the real
  ones.
