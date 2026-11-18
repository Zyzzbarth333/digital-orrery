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
Students*, 4th edition (Butterworth-Heinemann, 2020) [1]. It is cited by
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
- **A return to the same body:** if either end is a flyby, the leg goes
  round the Sun and back on a resonant orbit (Galileo's two years from
  Earth to Earth; below).

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
- **A moon of another planet:** its GM and radius are Horizons'. Titan's
  atmosphere takes a landing, as the planets' do. The flight still treats
  these moons as having no gravity (an aim at the moon and a rendezvous),
  though the kernel has pulled with them since #39. So a flight to one
  comes in too low and hits it (below, Limits).
- **A small body:** its gravity is a guess, a sphere of its diameter at
  2,000 kg/m³. That is tiny either way, so a capture is a rendezvous, about
  $v_\infty$.
- **A moon left for another planet:** priced by where the moon really is
  on the day (below).
- **A planet's own moon:** the free end is a point on the parking orbit at
  the planet, in the moon's orbit plane. It is placed where the leg costs
  least, by 36 trial angles and then a golden-section search.

### Leaving a moon by where it is

A leg from a moon to another planet is solved about the Sun from the
moon's planet. Its excess velocity $\mathbf v_{\infty,P}$ is the planet's.
Three levels of patched conics join it to the moon
(`transfers.js asymptoteVelocities`, `moonExcess`):

- **The hyperbola about the planet:** it starts at the moon's place
  $\mathbf r_m$ on the day, and leaves along $\mathbf v_{\infty,P}$. Its plane
  holds both. The eccentricity vector, $\mu\mathbf e = \mathbf v\times\mathbf h -
  \mu\hat{\mathbf r}$ [1, Sec. 2.5], is the same at $\mathbf r_m$ as far out on
  the asymptote, where $\hat{\mathbf r}$ is $\hat{\mathbf u}$, the asymptote's
  direction, and $\mathbf v$ is $v_\infty\hat{\mathbf u}$.
- **The velocity there:** write it as $v_r\hat{\mathbf r} + v_t\hat{\mathbf t}$,
  with $\hat{\mathbf t}$ in the plane at right angles to $\hat{\mathbf r}$,
  towards $\hat{\mathbf u}$, at angle $\varphi$ from $\hat{\mathbf r}$, and
  $h = r v_t$. The two components of that equality are then
  $$r v_t\,(v_t - v_\infty\sin\varphi) = \mu(1 - \cos\varphi),\qquad
  v_r = v_\infty\cos\varphi + \frac{\mu\sin\varphi}{r v_t}.$$
- **Two roots:** the first is a quadratic in $v_t$, with one root of each
  sign. The craft swings the short way round to the asymptote, or the long
  way. Both have the energy $v_\infty^2/2$. Over 500 random states, both
  leave along $\mathbf v_{\infty,P}$ to $10^{-13}$, checked against the
  asymptote of the orbit they start.
- **The excess about the moon:** $\mathbf v - \mathbf v_m$, from the root
  nearer the moon's own velocity. It is the departure's excess speed in
  Curtis 8.40 above.
- **Not a pass of the planet:** a root that is still falling inward, with
  its periapsis under half the moon's distance, swings past the planet on
  its way out. The flight does not aim that pass, so the root is not taken
  while the other one is left. Ten days into the stay below, the nearer
  root dives to a perigee of 673 km, inside the Earth.

**The phase.** Over a month the moon goes round, so the price swings.
Leaving lunar orbit for Mars on 31 Oct 2026, the Moon's velocity is 66°
off the way out: 2,227 m/s. The old price took the moon as moving the way
out, its best phase (the speed needed at its distance, less its own, as
scalars): 1,652 m/s. The flight, in the full model, pays 2,257: 1.4 % more.

The window strips step a day at a time for these legs, not every 8 days,
so the month's ripple shows. Two days into that week's stay, the departure
is 1,647 m/s; sixteen days in, 3,381. The planner suggests the best day
(`journey.js phaseOption`):

- **The search:** every day's best flight time, from the arrival at the
  moon (or the start date) to the planned departure, or a whole turn of
  the moon if the stay is shorter. It is the porkchop search over that
  span, with a departure a day.
- **Where it shows:** as an option for the leg ("Best phase of the
  Moon"), as a mark under the leg's strip that can be clicked to leave
  then, and as the phase lamp when it saves more than 50 m/s and 3 %.
- **On the week's stay:** it is 26 Oct, 2.4 days in. The leg costs 3.71
  km/s, against 4.34 as scheduled; the departure is planned at 1,657 m/s
  and flown at 1,666.

Arriving at a moon from another planet is priced the same way, with time
reversed: the state $(\mathbf r, -\mathbf v)$ leaves along
$-\mathbf v_{\infty,P}$. The ideal options (Hohmann and the others) keep the
best phase, as they keep circular coplanar orbits.

The flight aims such an arrival at the moon itself: at its B-plane point,
from the excess velocity about the moon where it is on the day (`moonArr`).
The planet's own pull on the way in is in every trial run. (It used to aim
at the planet's centre plus the moon's periapsis offset, and the craft hit
the Earth.) Mars orbit to lunar orbit, leaving 11 Aug 2028:
- the Moon 1.3 km off the planned periapsis, for 65 m/s of aims;
- the capture 2,061 m/s, against the plan's 2,123;
- landing instead: down at 2.3 m/s.

### Near 180 degrees: the broken plane

Lambert's arc lies in the plane of its two ends and the central body. When
the ends are nearly opposite, that plane is ill-defined, and Mars is a
little above or below the ecliptic. So a direct arc to it must tilt
steeply, and its price leaps as the arc sweeps through 180° [5, Sec. I,
Figs. 1–2]. Leaving lunar orbit for Mars, arriving on 20 Aug 2027, after a
23-day stay at the Moon:

- The direct arc runs 180.4° round the Sun on a plane tilted 20.1°, and
  costs 15.69 km/s.
- Its excess speed leaving the Earth jumps from 4.55 to 11.53 km/s in one
  day of stay.
- Flown, an arc a few degrees off 180° is no better. The kernel's aims,
  re-solved from where the craft is, chase a plane that turns with every
  kilometre the craft is off it. A 20-day stay (183.4°) flies with 679 m/s
  of corrections, where nearby stays need about 150.

**The broken plane** (`journey.js brokenPlane`) is the way round it
[5, Sec. I]:
1. Take the target's place, turned into the departure body's orbit plane
   at its own distance.
2. Solve Lambert's arc to that point. In a plane fixed beforehand,
   180° is no trouble.
3. Fly that arc to a break point $B$.
4. At $B$, a burn turns the craft onto Lambert's arc from $B$ to the real
   target.

$B$ is placed by when it is reached: the fraction of the flight time that
makes the whole leg cheapest, on a grid of tenths, then by golden section.
It comes out near halfway, as Abilleira's do [5]. The burn there is almost
all the plane's turn $\delta$. That is a rotation of the horizontal velocity
$v_h$ about the radius to $B$, so it costs $2v_h\sin(\delta/2)$ [1, eq.
(6.20)]. The turn that reaches a target an angle $\phi$
on from $B$, at a height $\beta$ above the plane, is given by Napier's
rule for the right spherical triangle: $\sin\delta = \sin\beta/\sin\phi$.

**When a leg takes it.** A leg between two bodies about one central body
tries the broken plane within 15° of 180°. It takes it there wherever it
costs less than the direct arc. Within 6° it takes it even where the
direct arc is a little cheaper on paper, since the direct arc doesn't fly
as planned there. At 183.4° the direct arc is 12 m/s cheaper. Flown, the
broken plane takes 205 m/s of corrections, 61 of them its planned break;
the direct arc takes 679 m/s.

**Where it shows:**
- The leg's arcs are drawn broken at $B$.
- The burn list has a plane change at $B$.
- The leg's options list it as "Broken plane, as scheduled". "Direct, one
  plane" is listed beside it for comparison, and can be chosen (`via:
  'direct'`).
- The plane lamp says where the plane breaks (below).

The porkchop search, the window strips and the best day in a stay all
price each leg through the same solver. So the ridge of high cost along
180° that a ballistic porkchop plot shows [5, Figs. 3–4] isn't in them.

**In flight**, the craft leaves on the first arc. Its first aim, near the
departure, is at the break point, not the target. If the departure waits
for the parking orbit's plane, the way out is re-solved to the break point
too. The burn at $B$ is the next aim, from where the craft is, to the
target.

### Resonant returns

Lambert's problem can't do a return to the same body after whole years. Its
two ends are nearly one point, so the plane it finds is the ecliptic,
whatever the flyby needs. Lambert between Galileo's two Earth flybys
gives 5.0 km/s, in the ecliptic, against the 8.9 km/s the flyby brings in.

The leg is instead a resonant orbit (`transfers.js resonantCone`,
`resonantVinf`; Strange and Longuski 2002 [2]). Its period is N/M of the
body's, so the craft comes back to the body after N of the body's orbits
(M of its own):
- **The cone:** with the excess speed $v_\infty$ fixed by the flyby, the
  period fixes the craft's speed at the body's distance by vis-viva, and so
  the angle $\theta$ between the excess velocity and the body's velocity
  $v_B$:
  $$a = \left(\mu\left(\frac{N T_B}{2\pi M}\right)^2\right)^{1/3},\quad v^2 = \mu\left(\frac{2}{r} - \frac{1}{a}\right),\quad \cos\theta = \frac{v^2 - v_B^2 - v_\infty^2}{2 v_B v_\infty}.$$
  The excess velocity lies on a cone of half-angle $\theta$ about $v_B$.
- **The clock angle:** its angle round the cone is free. It is chosen, by
  72 trials and then golden section, so the flybys either side cost least
  (powered flybys from the inbound leg, and to the next leg).
- **The return:** the leg ends when the body comes back nearest where it
  was, within 20 days of N of its periods, rather than at its osculating
  period on the day. The Moon swings the Earth enough for that to be a day
  wrong in two years. The craft's period is set from it, and later
  waypoints keep their spacing.
- **The ratio:** the waypoint's own (`resonance: [N, M]`), else the one
  whose flight time is nearest its date. The leg's options list every
  ratio the excess speed allows (N and M up to 6), each costed with the
  flybys either side.

On Galileo's dates the planner picks 2:1, as flown [3]. It returns on 8 Dec
1992 with the same excess speed it left with, and the two Earth flybys
need 0 and 70 m/s. Lambert between the same dates needed kilometres a
second.

In the kernel, the first aimed correction of a return to the body just
left waits until a quarter of the way round. The aims fly without the
target's gravity, and that target is also the body the craft is still
climbing away from.

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

### The parking orbit's plane

A capture leaves the craft in a circular parking orbit whose plane holds
the way in and the next leg's way out (as the flight flies it, step 4
under [Flying it](#flying-it)). A stay turns that plane. The planet's
oblateness regresses its node about the pole while the inclination holds
(Curtis Sec. 4.7, eq. (4.52) [1]):
$$\dot\Omega = -\frac{3}{2}\,\frac{\sqrt{\mu}\,J_2R^2}{(1-e^2)^2\,a^{7/2}}\cos i.$$
Here $i$ is the orbit's inclination to the planet's equator of date
(`orientation.js`), and $J_2$ and $R$ are the kernel's own (`bodies.js`
`ZONAL`). A prograde orbit's node goes west and a retrograde one's east.
400 km over Mars, the node turns about 9° a day, so after a long stay the
plane may no longer hold the way out. `parkingPlane.js` and
`journey.js` `planeAt` price that.

- **The rate.** Eq. (4.52) is the rate of the mean orbit. A circular
  orbit started at the capture's radius is not quite that orbit. Its mean
  semi-major axis differs by about $J_2(R/r)^2r$, depending on where it
  starts, and J2's second-order terms add a little more. 400 km over Mars
  the kernel's node turns 0.15 to 0.6 % faster than eq. (4.52), and over a
  year that is 5 to 20° of node. So `flownNodeRate` flies the capture's
  orbit for ten turns in the planet's zonal field as the kernel has it
  (`zonal.js` `addJ2`: J2, eq. (10.30) [1], and the giant planets' terms
  beyond it as `bodies.js` `ZONAL` holds them, J4 and Jupiter's J6 to J12,
  which turn the node too; RK4, 240 steps a turn, about 10 ms). It reads
  the node where the orbit crosses the equator going north, so the terms
  that come and go within a turn cancel. The plan's rate is eq. (4.52)
  scaled by that flight's rate over its own.
- **The plane on the day.** The capture's plane (normal
  $\hat{\mathbf n}_0 \propto \mathbf v_{\infty,\text{in}} \times \mathbf v_{\infty,\text{out}}$)
  is turned about the pole by $\dot\Omega\,t_\text{stay}$. The angle off
  the way out is $\sin^{-1}|\hat{\mathbf n}\cdot\hat{\mathbf v}_{\infty,\text{out}}|$.
- **The burn out of the plane** (`leaveCircularDv`). This is the cheapest
  single burn from the circular orbit onto the way out. At 72 points round
  the orbit it takes the cheaper of the two hyperbolas through the point
  that leave along the excess velocity (`asymptoteVelocities`, exact, as
  the flight burns), then refines by golden section about the best point.
  In the plane it is the tangential burn at periapsis (eq. (8.42) [1]), and
  out of it the burn costs more. The leg's departure is priced so, and the
  extra over the burn in the plane is added to it.
- **Up to 30 days, no extra.** For a stay of up to 30 days the flight
  aims the capture so that the turned plane holds the way out on the day
  (step 3, *allowing for the stay*). The plan marks the plane "held".
- **The day it holds** (`planeOption`). This looks up to 30 days either
  side of the planned day, in half days, keeping the arrival date. It
  takes the day the leg costs least with the plane as a stay to that day
  would turn it (a later departure is a longer stay, and the capture holds
  that day's way out). It is an option for the leg, a mark on the strip,
  and the **parking orbit lamp** when the planned day is dearer than 50 m/s and
  3 % of the leg. It also carries what the flight does as planned: from
  the capture's plane, waiting while a day costs 2 % less than the best
  before it, as the flight waits.
- **The window strip** prices each date with the plane as a stay to that
  date would turn it. It steps every 2 days where the plane comes round
  in under two months (Mars's in 40 days), not every 8.

**Where it holds.** It holds about a planet, low enough that J2 rules the
plane. The plane is not priced where another body's tide on the orbit is
more than 5 % of J2's pull, $\mu_3 r/d^3 > 0.05 \cdot \tfrac{3}{2}\mu J_2R^2/r^4$.
That other body is the Sun, the Earth's Moon, or one of the planet's moons
beyond the orbit. A moon within the orbit counts by the $J_2$ it adds,
$\tfrac{1}{2}(\mu_3/\mu)(d/R)^2$, against the planet's own. These are
order-of-magnitude rules, not a theory of those pulls. The plane is priced
up to about 19,600 km over Mars and 21,000 km over the Earth (the limits
set by the Sun and the Moon), and 320,000 km over Jupiter (by Io). The leg
says why when it is not priced.

**The Moon is not priced.** The Earth's pull and the Moon's own field
turn a low lunar orbit's plane, not J2 alone. When the flight first tried
a J2-only rate there, a week turned the plane 4° the other way. For a stay
of up to a month the flight flies the stay to aim the capture (the plane
is then held). Beyond that the departure waits for the plane, and the plan
does not price it.

The case in the tests is a year in Mars orbit, then home: 400 km up,
arriving 7 Sep 2027, a 364-day stay. The orbit is 150.6° to Mars's
equator, and its node turns 9.066° a day (eq. (4.52) alone gives 9.012).
On the planned day its plane is 24.6° off the way out, and the departure
costs 2,911 m/s instead of 2,000 in the plane. The lamp suggests leaving
6.5 days later, for 2.01 km/s. As planned, the plan has the flight waiting
12.5 days, for 2,025 m/s.

| | The plan | Flown (full model) |
| --- | --- | --- |
| On the planned day | 24.6° off, 2,911 m/s | 3,012 m/s (3.5 %) |
| The flight's wait for the plane | 12.5 d, 2,025 m/s | 11.2 d, 2,016 m/s (0.4 %) |
| Re-timed 6.5 d later (a 370.5-day stay) | 0.9° off, 2,008 m/s | leaves 2 h late, 2,095 m/s (4.3 %) |

The flight's capture leaves the orbit circular at the planned mean radius
(e 0.0016; [Flying it](#flying-it), step 4). Before it did, the capture
left e 0.046, and the flight paid 2,070 m/s on the wait and 3,043 on the
planned day. What is left is the plane. The flown plane holds the way out,
as planned, but it is 0.5° steeper than the plan's (151.1° for 150.6°).
The kernel's way in is not quite the patched conics', and the trims hold
only the way out in the plane. So its node turns 0.3 % faster, 9.095° a
day for 9.067, which is 11° over the year. The plane comes round 1.2 days
early, and on a fixed day it is that far off. The rate itself is right:
`flownNodeRate` from the flown orbit gives the kernel's rate over the year
to 0.0001° a day.

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
- **Best phase of the moon:** for a leg leaving a moon for another planet,
  the best day in the stay (above).
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
scripted burns on the same kernel, with its landings.

**The model.** The flight is worked out in the full model, as the app's
Craft flies (`flyJourney`, `model: 'full'`). That is the kernel's point
masses and zonal terms, with `environment.js` on them
(docs/physics/environment.md):
- the Earth's field beyond J2 (EGM2008 to degree 20), and its tides;
- the Moon's beyond J2 (GRAIL GL0660B to degree 50, mascons and all);
- drag, sunlight pressure with the shadows, and relativity.

The craft is the app's default one, `JOURNEY_CRAFT`: 1,500 kg and 5 m²,
with Cr 1.3 and Cd 2.2. Its scripted burns draw nothing from its tank, so
the mass the environment sees stays the same headless and live.

**Why it matters.** A descent is flown open loop in the app, its burns
worked out headless. Worked out in the bare model (point masses and zonal
terms alone) and flown live with the mascons on, the Moon landing below
hits the ground at 47 m/s. Worked out in the full model, the live Craft
comes down 60 m from the headless flight's site.

**The fallback** (`flyPlanned`). A flight with trouble falls back to the
bare model. Trouble is any of these:
- an aim with no burn, or one that ends more than 50 km from its point;
- a departure, descent or ascent it could not work out;
- a crash, or a landing not made;
- a waypoint missed by more than 50 km or 2 % of its periapsis;
- a flight that takes more than a minute to work out (a long stay in a low
  lunar orbit, at degree 50, can take minutes).

If the bare flight has none, it is the one kept. The craft is then flown
bare too. Its Model row reads "Planner's (fallback)", and says what the
full model could not do. So do the planner's kernel line and the GO
board's trajectory row. If both models have trouble, the full one is
kept.

**The cost.** The full model makes the flight slower: the Moon landing
trip takes 4.5 s, the week in lunar orbit then Mars 7 to 8 s (in Node,
against 0.4 s bare). Most of it is the Moon's field at degree 50 in a low
orbit. Looking ahead takes the fields to degree 10: a departure's wait for
its plane, and a stay's trial orbits (step 3, for stays up to a month). An aim's sensitivities take
degree 4, and every run it keeps is flown at full degree. The window
profiles now run in a worker of their own, so the strips need not wait
for the flight, and an edit made while a flight is still under way stops
it and starts again.

Each step, in time order:

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
   - **In the full model:** the trial runs are flown with the environment,
     and the sensitivities with the fields to degree 4 (`aimTo`'s `envJ`).
3. **Two periapsis trims inside the target's sphere:** a burn along the B
   vector, with the radius found by the secant method on the two-body
   hyperbola about the target. The second trim comes halfway to the
   predicted periapsis.
   - **The plane, for an orbit it will leave:** the trim also turns the
     hyperbola's plane to hold the next way out. It is Newton on the two
     components across the velocity, for the periapsis and the plane
     together.
   - **Allowing for the stay:** a stay turns the orbit's plane. The Moon's
     J2 regresses the node, and the Earth's pull and the mascons move it
     too. A J2 rate alone made it worse: a week in lunar orbit turned the
     plane 4° the other way. So the stay is flown: a trial circular orbit
     at the planned periapsis, in the kernel, to the departure. The way out
     is turned back by the rotation that took the plane from start to end.
     The plane that ends nearest is kept, of up to three tries.
   - **Taken only if worth it:** the plane is changed only if that costs
     less extra than the plane error would cost at the departure, about the
     circular speed times the angle. (Newton can land on a far root: 150
     m/s to fix 0.07°.)
4. **Captures** (`landing.js designCapture`, `planCapture`):
   - **Where it starts:** at the predicted periapsis, worked out again from
     the craft's own state five minutes short of it. Not centred on it:
     braking before periapsis would drop a 6 km/s capture into Mars.
   - **Why it is steered:** impulsive, the capture is
     $v_p - \sqrt{\mu/r_p}$ at the periapsis [1, eq. (8.58)]. Finite, it
     takes 101 s for 2,026 m/s at Mars at 20 m/s². Held retrograde from
     the periapsis, the craft climbs while it is still faster than
     circular and falls after. The orbit ends at e 0.047, and a year
     on the departure from it cost 3.8 % more than the plan's, which
     prices a circular orbit.
   - **The burn:** two halves, each held at its own pitch from retrograde
     in the orbit's plane. Newton on the two pitches and the length puts
     the two-body orbit at its end on a circle (e = 0, three conditions,
     three unknowns), with RK4 about the body.
   - **The radius:** holding a radius within the burn is dear. Lowering
     the end by 2 km within a 40 s burn at the Moon takes 14° of pitch
     and 3 % more. So the circle the burn ends on is chosen for the least
     delta-v of the burn plus a Hohmann transfer [1, Sec. 6.2] from it to
     the planned radius. That is a scan over −0.5 to 2 times the burn's
     own height scale $a\,t^2/8$, then golden section. At Mars the burn
     ends 4 km up, and burn and transfer together cost 0.5 % over the
     impulse (holding the radius in the burn, 0.9 %). At the Moon it is
     0.2 %, and at Jupiter for Galileo 0.3 %.
   - **The transfer, on the mean radius:** in the body's J2 field the
     osculating radius of a circular orbit swings by about 2 km round each
     turn (as $\cos 2u$ from the node, 400 km over Mars). The node's rate
     goes as $a^{-7/2}$ [1, eq. (4.52)], so 2 km is 0.2 % of it, 13°
     over a year at Mars. So the transfer is worked out on the orbit's
     mean semi-major axis: the osculating one averaged over a turn, on a
     side run. Its two burns go along the velocity, half the transfer's
     period apart, not at apsides from the two-body orbit, which J2 makes
     meaningless for a few kilometres. A second pass tidies what J2 left.
     The transfer is skipped under 100 m, or if the next event comes first
     (an orbit change straight after). If no steered burn is found, the
     burn is held retrograde, as before.
   - **What it leaves:** the log and `captures` give the orbit's mean
     radius and its eccentricity from the radius over a turn,
     $(r_\text{max} - r_\text{min})/(r_\text{max} + r_\text{min})$.
     A year at Mars: 2,038 m/s for an impulse of 2,028, the mean radius
     3,789.9 km for 3,789.9, e 0.0016, and still 0.0016 at the departure.
   - **The orbit's plane:** the arrival hyperbola's plane holds the next
     departure's excess velocity too, so the parking orbit already contains
     it. Leaving a moon via its planet, that is the excess velocity about
     the moon, not the planet's.
5. **Departures from an orbit:** the burn onto the outgoing asymptote from
   wherever the craft's orbit now is.
   - **The burn:** at each of 72 points round the orbit, the two
     hyperbolas through it that leave along the excess velocity (exact, as
     above). The cheaper burn is refined by golden section about the best
     point, and its full vector is burned.
   - **Waiting for the plane:** a long stay turns the orbit's plane (a
     planet's J2 precesses the node, about 9° a day at 400 km over Mars;
     the plan prices it, [above](#the-parking-orbits-plane)).
     So, as a mission would, the departure may wait up to 30 days, in
     half-day steps, for the plane to hold the way out, when that saves
     more than 2 %. It takes the cheapest of the half days, then golden
     section within half a day either side: the plane turns 4.5° in half a
     day there, which costs per cent. The log gives the planned day's burn
     beside the one made. The excess velocity is re-solved for the later date (a
     Lambert arc about the leg's central body to the planned arrival).
     The days ahead are looked at on a side run, and only the wait chosen
     is flown. Leaving a moon via its planet, there is no wait: the phase
     prices every day differently, and the plan has chosen the day.
6. **Home through the air:** the aim is at the planned arc half an hour
   before the end, so no trial run meets the ground first. The kernel's
   perigee after that point is its own (the Moon's and the Sun's pulls over
   the days home move it by about 100 km), so for a landing two trims after
   the point bring it to the planned entry height, about 60 m/s home from
   the Moon.
7. **Landings** (`landing.js`):
   - **Through an atmosphere:** the drag-free path is flown to its
     perigee, at the waypoint's height (120 km at Earth), and the craft is
     set down on the ground beneath it. The entry itself (heat shield,
     parachutes) is not flown, as the plan does not cost it. A path that
     meets the ground before its perigee is a crash.
   - **On an airless body**, from the low orbit the capture left:
     - **The descent orbit:** retrograde, onto the ellipse down to 15 km,
       the first burn of a Hohmann transfer (17 m/s from 100 km over the
       Moon). It is worked out from the orbit the craft is really in
       (circular to a few thousandths, its osculating radius swung by the
       body's J2). So the burn is the one that puts the two-body periapsis
       15 km up, by bisection.
     - **The braking burn:** from that periapsis, steered against the
       velocity. Its thrust is found by bisection so that the speed is gone
       1.5 km up, on a two-body run from the craft's own state two minutes
       before (the Earth's pull and the Moon's J2 move the periapsis by
       kilometres over the half orbit).
     - **Across the ground:** the braking stops the craft in space, and the
       ground beneath moves with the body's spin (4.6 m/s on the Moon's
       equator), so a sideways burn matches it.
     - **The last fall and stop:** a fall, then thrust straight up at 2.5
       times the surface gravity until the craft is coming down at 1.5 m/s
       a metre up, where the engine is cut so it settles on. The fall's
       length is found by bisection. It is designed on the radial pull the
       flight's model has at the craft, not the body's point mass: over a
       1.5 km fall, the few tenths of a percent the mascons add are metres,
       and the engine was cut 6 m up.
     - **Touchdown:** the kernel's impact, at the point where its step
       crossed the ground. Faster than 10 m/s over the ground is a crash
       (`landing.js TOUCHDOWN_SPEED`; the flown descents touch down under
       3).
   - **On a body without the kernel's gravity** (a small body, a moon other
     than ours): set down from the rendezvous.
   - **The stay:** the craft is held at the body-fixed site, turning with
     the body (`orientation.js` axes), and its path follows the site.
   - **In the app** (`Craft.addLandings`): the craft flies the planned
     burns, and an impact on the landing's body within an hour of the
     planned touchdown is the landing only if it is slower than 10 m/s over
     the ground, where the craft crossed it (stepped back from the end of
     the kernel's step, which can be 100 m down). Faster, it is a crash.
     For an entry, or a descent that never quite touches, the craft is put
     on the planned site at its time only if it is where the plan has it:
     a descent within 100 m of the ground and as slow, an entry no higher
     than its planned perigee and 50 km. Otherwise the landing is missed
     and the craft flies on. A landed craft is not stepped; it is drawn at
     the site until its liftoff. Like every craft, it keeps its state
     across a clock jump: set the clock back before the touchdown, and it
     stays on the ground until its liftoff time.
8. **Lifting off:** three hours before the departure, from the site's
   state (the body's spin included):
   - **The plane:** the one holding the site and the next departure's
     excess velocity, turned the way the body spins.
   - **The climb:** ten seconds tilted from the vertical towards the way
     the orbit goes, then prograde (a gravity turn), both at five times the
     surface gravity, until the coast's apoapsis is the parking orbit. The
     tilt is chosen for the least delta-v: a scan from 2° to 86°, then a
     golden-section search.
   - **Circularising:** at the apoapsis, from the craft's own state. The
     departure from that orbit is step 5.
9. **Leaving a moon for another planet:** the plan's excess velocity is
   the planet's. The flight takes the excess velocity about the moon as
   the plan does (`moonExcess`, at the moon's place when it leaves), and
   step 5 flies it. The first aim waits until
   the craft is clear of the planet.

The burns are finite, at 20 m/s² (3 km/s in two and a half minutes). The
closest approach to each waypoint is watched over a window about its date.
The osculating conic between samples gives the periapsis itself.

What the kernel does not yet fly: a plane change between two orbits about
one body (planned, not flown).

**The phase of a moon left for a planet** is priced now (above). Leaving
lunar orbit for Mars on 31 Oct 2026, the flight pays 2,257 m/s against the
plan's 2,227. On the suggested day, 26 Oct, it pays 1,666 against 1,657.

**The descent and the ascent flown cost more than the plan's ideal**
(the low orbit's circular speed), by the gravity losses a real descent
pays: over the Moon from 100 km, 1,859 m/s down and 1,759 up, against
1,634 (in the full model).

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

Both can be edited, and they are not any one vehicle's. The ROCKET tab
offers the stack STACK sizes as "Journey's stack", to fly its ascent beside
the real launchers, with the journey as its job
([the journey's stack](rocket.md#the-journeys-stack)).

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
- **A leg of two arcs** (a broken plane, or bi-elliptic) keeps its burn at
  the break under nodes:
  - at the break the craft is put on the planned second arc's velocity,
    whatever it comes in with, so that burn costs what the nodes before it
    left it to do;
  - a node before the break is aimed at the break point, not the waypoint,
    and the burn there takes the craft on;
  - in flight, a node before a broken plane's break also drops the early
    aim at the break point, which would undo it. A two-arc leg's
    departure, if it waits for the parking orbit's plane, is re-aimed at
    its break point, not the waypoint.
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

![The plotting table with a journey to Mars: a click on the transfer arc adds a burn node, its radial tab is pulled until the arc misses Mars and the MISS lamp lights, and AIM NODE brings it back](../clips/plotting-table.webp)

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
synodic periods (at most 1,100 days), in 8-day steps. A leg leaving or
reaching a moon via its planet, whose price ripples with the moon's phase
over a month, is stepped a day at a time. A leg leaving a planet's orbit
whose plane comes round in under two months is stepped every 2 days, each
date with its plane ([the parking orbit's plane](#the-parking-orbits-plane)).
Each date's best
flight time is found from 0.5 to 1.6 times Hohmann's. A leg after a flyby
has no profile: the flyby fixes its departure. A leg leaving a moon for
another planet also carries the best day in its stay (`phaseOption`), and
one leaving a planet's orbit after a long stay the day its plane holds the
way out (`planeOption`). A
worker of their own computes the profiles when an edit settles.

The lamps (`assess`), each lit only when it means something:
- **Window** (caution): the leg furthest above its cheapest date, where
  that is more than 10 % or 0.2 km/s dearer and more than 3 days away.
  It says when to leave and what that costs instead.
- **Phase** (caution): a leg leaving a moon on a day its phase makes dear,
  when the best day in the stay saves more than 50 m/s and 3 %.
- **Parking orbit** (caution): a leg leaving a planet's orbit whose turned plane
  makes the planned day dearer by more than 50 m/s and 3 %. It names the
  day near it when the plane holds the way out (within 30 days, the
  arrival kept), or, until the profile comes, the angle and the extra. A
  window lamp for a date within those 30 days gives way to it.
- **Wait** (caution): the longest stay over 30 days.
- **Delta-v:** the total against the budget, with the margin, or by how
  much it is over.
- **No window** (warning): a leg with no date in its profile under what
  the budget leaves it (the budget less every other burn).
- **Plane** (caution): a leg near 180° round its central body, flown on a
  broken plane. It says when the plane breaks, what that costs and the
  turn, and what the direct arc would cost and how far it tilts. A leg
  within 6° of 180° flown direct (chosen by hand, or with no broken plane
  found) lights it as a warning.
- **Miss** (warning): a shaped leg that ends outside its target's sphere
  of influence.
- **Flyby:** a pass that needs to go lower than its floor (caution), or
  whose periapsis is underground (warning).
- **Kernel:** the worst miss of the n-body flight, its corrections, and
  the model it was flown in (full, or the planner's as a fallback).

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
| Earth orbit, Moon orbit for 3 days, home | the plan | Moon 0.9 km; home 0.3 km |
| A burn node with no burn; a node's frame | Lambert's arc; geometry | on target to 1 m, the same delta-v; orthonormal, radial out |
| A 200 m/s node halfway to Mars, then aimed | Lambert from the node | misses by 3.28 million km; aimed, on target to 1 m |
| Mariner 10's Venus aim set by hand to the plan's B point | the planned flyby | the same periapsis, unpowered; Mercury missed by 194,000 km without its 29 m/s |
| An aimed node on the way to Mars, flown | the plan | Mars 1.4 km off the planned periapsis |
| A node with no burn on a broken plane (before and after the break) and on a bi-elliptic leg | Lambert's arcs, as planned | on target to 1 m (the bi-elliptic leg 54 m in 1,821 d, within 1 km); the break burn the same to 10⁻⁹ km/s (bi-elliptic 10⁻⁶) |
| A 50 m/s node before the break, then aimed | the break point by Lambert | misses by 855,000 km and the break grows from 60.9 to 83.4 m/s; aimed, on target to 1 m and the plan's delta-v to 10⁻⁶ km/s |
| A broken plane with a 20 m/s node before the break, flown | the plan | no early aim at the break; Mars 1.1 km off the planned periapsis |
| The 2:1 resonance cone at 8.9 km/s about a circular 1 AU orbit | geometry | a = 2^(2/3) AU, 61.98°, back in two years; every clock angle on the cone and back to the start (two-body) |
| Galileo's Earth to Earth (8 Dec 1990 to 8 Dec 1992) | NASA's dates: PDS mission catalogue [4] | 2:1 chosen, back within a day of 8 Dec 1992, 8.871 out and 8.864 km/s back; Earth flybys 0 and 70 m/s |
| Galileo's whole route flown by the kernel | the plan | Venus 2.0, Earth 0.9 and 14.5 km off; Jupiter 3,100 km off a 270,000 km periapsis (1.1 %); corrections 1.1 km/s over six years |
| The return window from Mars (arrive 7 Sep 2027) | Curtis Ex 8.2 (454 d on circular orbits) | 9 Sep 2028, 368 d later, 2.00 km/s; each profile point is the leg solved there |
| The lamps: leaving Mars after 30 days, at 8 and 5 km/s; leaving at the window | the rules above | window and delta-v lamps lit, then no window; at the window, green with a 368-day wait |
| Saturn V, Apollo 11's 45.7 t to 185 km and on to the Moon (TLI 3.13 km/s) | the flight | needs 12.03, gives 12.87 km/s: it can, with 0.84 to spare |
| Falcon 9 expendable, 22.8 t to 200 km; Electron, 300 kg to 500 km | the user's guides | 8.88 needed, 9.43 given; Electron 0.02 km/s short with its kick stage carried as payload (it burns, in fact) |
| The capture burn, two-body: 2,026 m/s 400 km over Mars at 20 m/s² | Curtis eq. (8.58) and Sec. 6.2; an independent integration of the retrograde burn | near-impulsive (2 km/s²) to 10⁻⁴ of eq. (8.58); held retrograde from the periapsis, e 0.047; steered, e 2 × 10⁻¹¹ at the radius, never more than 0.12 km below the periapsis, for 0.9 % over the impulse; the cheapest way in (circular 4 km up, then Hohmann) 0.5 % |
| A year in Mars orbit, then home, flown | the plan | the capture 2,038 m/s for an impulse of 2,028, its mean radius 3,789.9 km for 3,789.9, e 0.0016 (held retrograde: 0.046); departs 11.2 d late for the turned plane, 2,016 m/s against 2,000 in the plane (before: 2,070); Mars 0.8 km, Earth 23 km; corrections 206 m/s |
| The same: the plane on the planned day, priced and flown | the flight's departure (within 4 %) | 24.6° off, 2,911 m/s; flown 3,012 (3.5 %; 4.5 % before the capture was circular) |
| The same: the flight's wait for the plane, planned and flown | the flight's departure (1.5 d, 2 %) | 12.5 d and 2,025 m/s; flown 11.2 d and 2,016 (0.4 %) |
| The same, leaving on the parking orbit lamp's day (6.5 d later) | the plan (on time, 5 %) | leaves 2 h late, 2,095 m/s against 2,008 (4.3 %: the flown plane 0.5° steeper than the plan's, its node 0.3 % faster); Mars 0.6 km, Earth 24 km |
| The node's J2 regression, 280 by 400 km at 51.43° | Curtis Ex 4.8, eq. (4.52) | −1.0465 × 10⁻⁶ rad/s, 5.181° a day west |
| The node 400 km over Mars at 150.6°, ten days in the kernel, from the node and 90° past it | the kernel | eq. (4.52) 0.58 and 0.15 % slow (within 1 %); flown ten turns in the J2 field, 0.06 and 0.04 % (within 0.25 %) |
| The node 1.5 Jupiter radii out at 30°, three days in the kernel (its field to J12, its moons), averaged over a turn at each end | the kernel | flown in the same zonal field, 0.03 % (within 0.25 %); in J2 alone, 2.5 % slow |
| A stay 36,000 km over Jupiter, priced with and without the terms beyond J2 | the plan's own rate | ×1.076 of eq. (4.52) in the full field, ×1.026 in J2 alone: the planner takes the field |
| The burn from a circular orbit 400 km over Mars onto 2.48 km/s, 0 to 45° out of its plane | Curtis eq. (8.42); a scan of 7,200 points; burning at the planes' node | 2,000.4 m/s in the plane (eq. (8.42) to 1 mm/s); 2,057, 2,420, 2,931, 4,044 m/s at 5, 15, 25, 45°, the scan to 0.1 m/s, never over the node bound |
| Where the plane is priced | the rules above | a month at Mars and 3 d at the Moon held; 40 d at the Moon and 30,000 km over Mars not priced, and why |
| The strip leaving Mars after a year, and the parking orbit lamp | the leg solved there | every 2 days, each point with its plane; the lamp at the day the profile names |
| The descent orbit burn, 100 to 15 km over the Moon | a Hohmann transfer's first burn (Curtis 6.2) | equal to 10⁻¹² |
| An entry periapsis at 3 km/s over Mars | geometry (h = R v_R cos γ) | the hyperbola meets the ground at 12° to 10⁻⁹ |
| Braking from 15 km over the Moon; the ascent to 100 km (two-body) | stops where asked; more than the speed taken off or given | 1.5 km up, 1,762 m/s for 1,692; 1,763 m/s for 1,634 |
| Earth orbit, down to the Moon for 3 days, up, home through the air, flown in the full model (GRAIL to degree 50) | the plan | no fallback; down at 2.2 m/s, 1,859 m/s for the descent; up for 1,759; home 1.7 km from the aimed point, the entry perigee 118 km for 120 |
| The same, flown live by the app's Craft in the full model | the headless flight | down on the Moon 60 m from the headless site, held, up, down at Earth, never crashed |
| The same journey's bare-model burns, flown live in the full model | why the craft no longer flies bare | hits the Moon at 47 m/s |
| A Craft meeting the Moon at 1 km/s near a planned touchdown; one still in orbit at it | the 10 m/s limit | a crash, not a landing; the landing missed, flying on |
| Mars orbit to lunar orbit, and to a landing, flown (porkchop optimum, 11 Aug 2028 to 23 Jul 2029) | the plan, the Moon reached via the Earth | aimed at the Moon: 1.3 km off the planned periapsis; capture 2,061 m/s against 2,123 (within 5 %); landed at 2.3 m/s |
| Earth orbit, a week in lunar orbit, then Mars, flown in the full model | the plan, priced by where the Moon is | leaves the Moon for 2,257 m/s against the plan's 2,227 (1.4 %, within 3 %; the best-phase price was 1,652); Mars 1.4 km off; corrections 165 m/s |
| The hyperbolas from a point onto a given excess velocity, 500 random states | the asymptote from the eccentricity vector [1, Sec. 2.5] | both leave along it to 1.2 × 10⁻¹³ |
| The same journey's strip leaving the Moon | the Moon's month | a point a day; 3.71 to 5.42 km/s; its lows on days 2 and 28 |
| The best day in its stay | the strip | 26 Oct 2026, 3.706 km/s for the leg against 4.339 as scheduled; an option and the phase lamp |
| Flown on that day | its price | leaves the Moon for 1,666 m/s against 1,657 (0.5 %); Mars 0.1 km off |
| Ten days into the stay | the Earth's radius | the nearer hyperbola dives to a 673 km perigee and is not taken; the other, 3.814 km/s about the Moon, is |
| What makes the full model's flight fall back | the rules above | an aim with no burn, a crash, a landing not made and a 400 km miss, each a reason |
| Earth orbit, 23 days at the Moon, Mars on 20 Aug 2027: the leg at 180.4° | Abilleira [5]: a direct arc near 180° tilts steeply; a burn near halfway breaks the plane | direct 15.69 km/s on a plane tilted 20.1°; broken plane 4.572 km/s, its break at 47.0 % of the flight |
| The broken plane's arcs and its break | geometry; two-body; Curtis eq. (6.20) on the horizontal speed; Napier's rule | first arc in the Earth's plane to 10⁻⁶°; the arcs join and reach Mars to 1 m; the break 60.869 m/s, the pure plane change to 10⁻³; the turn 0.1452° against Napier's 0.1452° (to 1 %) |
| Stays of 18 to 30 days, through 180° | smoothness | the excess speed leaving the Earth 3.17 to 3.72 km/s, its second difference at most 2.9 m/s (under 20); direct, 11 km/s |
| The plane lamp; the options | the rules above | lit at 180.4°, with the break's date; none at 196°; "Direct, one plane" listed, at 15.69 km/s |
| 20 days at the Moon (183.4°), flown in the full model | the plan | broken plane 205 m/s of corrections (61 planned) and Mars 0.7 km off, within 250 m/s and 20 km; direct 679 m/s (over 500) |

## Limits

- **Patched conics:** the planets' centres are the ends of each leg, and
  the Sun alone pulls along it. The kernel's corrections close the gap,
  and the flown journey's corrections are part of its delta-v as flown.
- **Resonant returns:** circular-orbit physics on the real ephemeris. The
  flown return comes within about 9,000 km of the planet in two years, and
  the kernel's aims take up the rest.
- **Landings:** the plan does not cost the entry through an atmosphere, or
  the losses of an ascent or a descent; the flight pays the losses, and
  sets a craft entering an atmosphere down beneath its perigee without
  flying the entry. Terrain is a sphere (the Earth's, the WGS-84
  ellipsoid).
- **Another planet's moon** (Europa, Titan and the rest): not yet flown
  right. The flight takes them as having no gravity, and the kernel gives
  them theirs. Earth orbit to Europa orbit comes in 200 km low, hits
  Europa, and its departure would burn the planet's excess velocity. A
  moon flyby reached via its planet is aimed at the planet, as arrivals
  were.
- **A moon left for a planet:** three levels of patched conics at the
  moon's place. The moon's own pull on the way out of the planet's sphere
  is the flight's (its aims take it up), and a way out that passes close
  by the planet is not taken. The ideal options still take the moon's best
  phase.
- **The broken plane:** its first arc keeps to the departure body's
  orbit plane, and its break is placed by when it comes, not searched in
  three dimensions. A deep-space burn that also reshapes the orbit can
  cost less, and isn't sought. A craft's first leg (from its own
  state) is always direct.
- **The full model:** the flight is slower in it (seconds, not tenths).
  Looking ahead uses lower degrees of the fields, though every burn kept
  is worked out at full degree. A journey whose full-model flight has
  trouble falls back to the bare model, and says so.
- **The ideal options:** Hohmann, bi-elliptic and plane change use mean
  circular orbits. "As scheduled" and the porkchop optimum use the real
  ones.
- **The parking orbit's plane:** J2 alone, about a planet, for a circular
  orbit. The plane is not priced at the Moon, high over a planet, or after
  an orbit change, a landing or a moon's orbit. A year at Mars carries the
  node to within about 5° of the flight's, and so the parking orbit lamp's day to
  within a day or so.

## References

[1] H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. Oxford, U.K.: Butterworth-Heinemann (Elsevier), 2020. Chapters 4, 6, 8, 10 and 13, by section, equation and example as cited above.

[2] N. J. Strange and J. M. Longuski, "Graphical method for gravity-assist trajectory design," *J. Spacecr. Rockets*, vol. 39, no. 1, pp. 9–16, 2002, doi: 10.2514/2.3800. The resonant orbit and its cone of excess velocities.

[3] NASA, "Galileo in depth." [Online]. Available: https://solarsystem.nasa.gov/missions/galileo/in-depth. Launch on 18 Oct 1989, the flybys and arrival at Jupiter on 7 Dec 1995.

[4] NASA Planetary Data System, "Galileo mission catalogue." [Online]. Available: https://pds.nasa.gov/data/go-l-nims-3-tube-v1.0/go_1103/catalog/mission.cat. The Venus and Earth flyby times and altitudes.

[5] F. Abilleira, "Broken-plane maneuver applications for Earth to Mars trajectories," in *Proc. 20th Int. Symp. Space Flight Dynamics (ISSFD)*, 2007. [Online]. Available: https://ntrs.nasa.gov/citations/20080012680. Why near-180° transfers tilt steeply, and the burn near halfway that breaks the plane.
