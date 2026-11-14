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
- **Each waypoint:** a body and what happens there. The bodies are the
  planets, the Moon, the planets' other twenty major moons (`moons.js`:
  JPL's mean elements, with Horizons' GM and radius) and the named small
  bodies. What can happen:
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
- **A moon of another planet:** its GM and radius are Horizons'. In the
  kernel only Earth's Moon pulls, so at the others the flight aims at the
  moon itself and its capture is flown as a rendezvous. Titan's atmosphere
  takes a landing, as the planets' do.
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
5. **Departures from an orbit:** the burn onto the outgoing asymptote from
   wherever the craft's orbit now is.
   - **The burn:** at each of 72 points round the orbit, a first guess from
     a two-body Lambert arc to a point out along the excess velocity, then
     Newton's method on the three velocity components until the two-body
     hyperbola about the body leaves along exactly that excess velocity.
     The cheapest point's full vector is burned.
   - **Waiting for the plane:** a long stay turns the orbit's plane (a
     planet's J2 precesses the node, about 10° a day at 400 km over Mars).
     So, as a mission would, the departure may wait up to 30 days, in
     half-day steps, for the plane to hold the way out, when that saves
     more than 2 %. The excess velocity is re-solved for the later date (a
     Lambert arc about the leg's central body to the planned arrival).
6. **Home through the air:** the aim is at the planned arc half an hour
   before the end, so no trial run meets the ground first.

The burns are finite, at 20 m/s² (3 km/s in two and a half minutes). The
closest approach to each waypoint is watched over a window about its date.
The osculating conic between samples gives the periapsis itself.

What the kernel does not yet fly:
- a landing (it waits in the low orbit);
- leaving a moon for another planet;
- a plane change between two orbits about one body (planned, not flown).

What the flight costs beyond the plan is its corrections. Most of them
are on long legs home to a planet: the cruise aims fly without the
target's own gravity (its pull near arrival is the hyperbola), so they
leave out its far-field tug too, and the last aim takes it up. On the Mars
round trip that is about 115 m/s of its 185.

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

Against real launchers (`launcherFor`): a launcher's stack (`launchers.js`,
the ROCKET tab's presets) by the rocket equation with each stage's vacuum
Isp gives the payload a delta-v. That is set against the job, the climb
with its 1.5 km/s of losses plus the journey. Bisection on the payload
gives the most it could carry. It is a delta-v comparison: thrust, drag
and a booster's landing reserve enter only through the stage figures.

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

## Shaping it by hand

In the sky, the journey can be shaped with the pointer. Every change
re-solves it by patched conics at once, and the kernel flies it again when
the pointer is let go.

- **A burn node:** a click on a leg's dashed arc adds one there.
  - Dragging its reticle slides it along the arc to the point nearest the
    pointer.
  - Selected, it grows three pairs of tabs on stalks along its local axes:
    prograde and retrograde (P+, P−), normal and anti-normal (N+, N−),
    radial out and in (R+, R−).
  - Dragging a tab along its stalk adds delta-v that way, 1 m/s a pixel
    (0.1 with Shift).
  - The × tab or Delete removes it. Nodes at the same time add up.
- **A node's frame** (`nodeFrame`), the same as the app's manoeuvre
  nodes, about the leg's central body:
  - $\hat T = \mathbf v / v$;
  - $\hat N = \mathbf r \times \mathbf v / |\mathbf r \times \mathbf v|$;
  - $\hat R = \hat T \times \hat N$, radial outward.
- **A leg with nodes is flown free** (`shapeLeg`):
  - it leaves on its Lambert arc, and Kepler's two-body motion
    (`propagate`) takes it from node to node, each burn added there;
  - it arrives wherever that takes it at the arrival date;
  - the miss from the waypoint is shown, and the leg counts as reaching
    the waypoint inside its sphere of influence;
  - the arrival is costed with the velocity it has.
  
  A node with no burn leaves the leg as it was. **Aim last node** sets the
  last node's burn to the Lambert arc from its place to the waypoint, so
  the leg reaches it again.
- **A flyby's aim:** selecting a flyby's mark shows a ring on a stalk out
  from the planet, toward its B vector.
  - Dragging the ring out or in scales $|B|$ (doubling over a stalk's
    length), raising or lowering the pass.
  - Dragging it round turns the B vector about the approach.
  - With the aim set by hand, the flyby is unpowered: $r_p$ from $B$, and
    the turn $\delta$ about $\mathbf B \times \mathbf S$
    (`flybyFromB`).
  - The leg after it is flown free from it, downstream legs included
    through each flyby they reach.
  - **Planner aims the flyby** goes back to the joining powered flyby.
- **In the kernel:** a leg's node burns are flown as planned vectors, and
  the aimed corrections begin after the last of them. A hand-shaped leg
  that misses its waypoint is brought to it by the corrections, and their
  total is shown.

The handles are the app's own: a node is a square reticle with a diamond
inside, and its tabs are small raised panel tags with engraved legends on
stalks, after the guarded toggles of 1970s flight panels. They are not
drawn from any game's interface.

## The plotting table

The journey gets a full-screen room of its own, the plotting table
(`src/app/plot-table.tsx`). It opens from the PLANNER tab ("Open the
plotting table") or the `#plot` link; Escape closes it. While it is open
the sky stops drawing (`OrreryScene.setPaused`), and the clock and the
mission run on.

Its PLOT station has five parts:
- **The editor:** the journey's editor from the PLANNER tab, on the left.
- **The scope:** the journey from above the ecliptic, about the Sun (or
  about its planet, for a journey that never leaves one).
  - What it shows: range rings, the visited bodies' orbits and their
    places on the time cursor's date, the arcs, the burns, the kernel's
    flown path, and the craft.
  - "Compressed" squeezes the radius (its square root about the centre),
    so the inner and outer planets fit together.
  - A click on an arc adds a burn node there, and dragging a node slides
    it along its leg.
  - The selected node has spring-loaded tabs: P+ P−, R+ R− along their
    directions on the scope, N+ N− to the side (the scope looks down on
    the plane). Pulling a tab adds delta-v at a rate that grows as the
    square of the pull, up to 240 m/s a second at the stalk's full length.
    Letting go stops it, and the wheel over a tab adds 1 m/s (0.1 with
    Shift).
  - The same numbers can be typed in the ledger.
- **The lamps** (below), in the station's head and listed in full on the
  right.
- **The delta-v ledger:** every burn against the ship's budget (from the
  parking orbit on), with the margin.
- **The timeline:**
  - each leg's window profile as a strip, green where the date fits what
    the budget leaves that leg, amber where it does not; clicking a date
    leaves on it, at that date's best flight time;
  - the plan's legs, stays and burns;
  - the time cursor, which the scope follows.

## STACK and GO

The table's other two stations:
- **STACK** (`src/app/plot-stack.tsx`): the rocket the journey needs (below).
  - Its stages are drawn as a stack.
  - A delta-v waterfall sets the journey's parts (the climb, then each
    burn) beside the stages that pay for them. Where a stage ends mid-burn,
    the next finishes it.
  - The published launchers from `launchers.js` (Saturn V as flown on
    Apollo 11, Falcon 9 with and without the booster landing, and Electron)
    are set against the same job, read-only: what each gives the payload,
    and the most it could carry (`staging.js launcherFor`).
- **GO** (`src/app/plot-go.tsx`): a go/no-go poll, one row for each of the
  following:
  - **trajectory:** the kernel flew it to every waypoint within 50 km,
    without hitting anything, and with corrections under 250 m/s or a
    tenth of the plan;
  - **windows** and **delta-v:** from the lamps;
  - **flybys:** none underground;
  - **vehicle:** a stack exists, and which real launchers could fly it;
  - **launch.**

  When every row reads GO, "Commit to the orrery" jumps the clock to the
  departure (BACK undoes it), gives a new craft the kernel's burns, and
  follows it.

The PLANNER tab is now a summary of the journey (route, dates, delta-v
and lamps) with the key to the table. The porkchop and NASA's list are in
the table, under the journey's editor. A `?plan=` link opens the table
with that porkchop computed.

## The flags

`src/physics/feasibility.js` answers whether the journey can be flown, and
if not, when. It works from the window profile of each leg that can choose
its departure (`legProfile`). That profile is the cheapest delta-v for
each departure date, from when the leg can first leave, across 1.25
synodic periods (at most 1,100 days), in 8-day steps. Each date's best
flight time is found from 0.5 to 1.6 times Hohmann's. A leg after a flyby
has no profile: the flyby fixes its departure. The worker computes the
profiles when an edit settles.

The lamps (`assess`), each lit only when it means something:
- **Window** (caution): the leg furthest above its cheapest date, where
  that is more than 10 % or 0.2 km/s dearer and more than 3 days away.
  It says when to leave and what that costs instead.
- **Wait** (caution): the longest stay over 30 days.
- **Delta-v:** the total against the budget, with the margin, or by how
  much it is over.
- **No window** (warning): a leg with no date in its profile under what
  the budget leaves it (the budget less every other burn).
- **Miss** (warning): a shaped leg that ends outside its target's sphere
  of influence.
- **Flyby:** a pass that needs to go lower than its floor (caution), or
  whose periapsis is underground (warning).
- **Kernel:** the worst miss of the n-body flight, and its corrections.

The Mars round trip in the tests shows the point. It arrives on 7 Sep 2027
and plans to leave 30 days later. The window lamp says the cheapest date
home is 9 Sep 2028, 368 days after arriving, at 2.00 km/s, instead of
20.1 km/s. The delta-v lamp says that is over an 8 km/s budget. With a
5 km/s budget, no date home fits at all. Curtis's Example 8.2, on circular
orbits, waits 454 days.

## In the scene

- **Each leg's arc:** a dashed pale-amber line about its central body,
  placed at that body each frame. A leg about Earth moves with Earth.
- **The kernel's flown path:** a thin solid amber line about the journey's
  frame (the Sun, or Earth for a journey that never leaves it).
- **Each burn:** an open square reticle with a centre dot (orange for a
  capture or landing, dashed for a flyby), with its delta-v in a window
  tag. Burn nodes and flyby aims are the shaping marks above.

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
| Jupiter's orbit to Europa, then to Ganymede | geometry; Europa at 671,100 km and 13.74 km/s | legs about Jupiter; within 1 % and 2 % |
| Mariner 10, flown by the kernel (NASA's dates) | the plan | Venus 0.4 km, Mercury 0.1 km off the planned periapsis |
| Earth to Mars, captured | the plan | 1.4 km |
| Round the Moon and home | the plan | Moon 17 km; home 3 km from the aimed point |
| Earth orbit, Moon orbit for 3 days, home | the plan | Moon 0.9 km; home 0.5 km |
| A burn node with no burn; a node's frame | Lambert's arc; geometry | on target to 1 m, the same delta-v; orthonormal, radial out |
| A 200 m/s node halfway to Mars, then aimed | Lambert from the node | misses by 3.28 million km; aimed, on target to 1 m |
| Mariner 10's Venus aim set by hand to the plan's B point | the planned flyby | the same periapsis, unpowered; Mercury missed by 194,000 km without its 29 m/s |
| An aimed node on the way to Mars, flown | the plan | Mars 1.4 km off the planned periapsis |
| The return window from Mars (arrive 7 Sep 2027) | Curtis Ex 8.2 (454 d on circular orbits) | 9 Sep 2028, 368 d later, 2.00 km/s; each profile point is the leg solved there |
| The lamps: leaving Mars after 30 days, at 8 and 5 km/s; leaving at the window | the rules above | window and delta-v lamps lit, then no window; at the window, green with a 368-day wait |
| Saturn V, Apollo 11's 45.7 t to 185 km and on to the Moon (TLI 3.13 km/s) | the flight | needs 12.03, gives 12.87 km/s: it can, with 0.84 to spare |
| Falcon 9 expendable, 22.8 t to 200 km; Electron, 300 kg to 500 km | the user's guides | 8.88 needed, 9.43 given; Electron 0.02 km/s short with its kick stage carried as payload (it burns, in fact) |
| A year in Mars orbit, then home, flown | the plan | departs 13 d late for the turned plane, 2,058 m/s against 2,000; Mars 0.4 km, Earth 22 km; corrections 182 m/s |

## Limits

- **Patched conics:** the planets' centres are the ends of each leg, and
  the Sun alone pulls along it. The kernel's corrections close the gap,
  and the flown journey's corrections are part of its delta-v as flown.
- **A return to the same body after whole years:** the two ends are nearly
  the same point, so Lambert's plane is the ecliptic and the arc can be far
  from the cheapest resonant orbit. Burn nodes are the way to shape it.
- **Landings:** the entry through an atmosphere and the losses of an ascent
  or a descent are not costed.
- **The ideal options:** Hohmann, bi-elliptic and plane change use mean
  circular orbits. "As scheduled" and the porkchop optimum use the real
  ones.
