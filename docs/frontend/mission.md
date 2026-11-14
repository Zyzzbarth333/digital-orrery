# Missions: spacecraft, launches, nodes and the planner

How the app flies spacecraft. Code: `src/physics/craft.js` (the craft model,
tested in `craft.test.mjs`), `src/physics/kernelClient.js` (the n-body
kernel in a Web Worker), `src/app/mission.ts`, `src/app/mission-panel.tsx`,
`src/app/planner-panel.tsx`, `src/app/porkchop.worker.ts`, and
`src/scene/craftLayer.ts` / `craftPaths.ts` for drawing.

## The craft model

A craft's exact state is the kernel's: heliocentric J2000 equatorial km and
km/s at kernel time, stepped by the n-body kernel (Encke's method near a
planet, Cowell elsewhere; see [the kernel](../physics/nbody-kernel.md)).
Each rendered frame the mission advances every craft's clock and asks the
kernel, in its Worker, to step it to the clock; the result comes back a
frame or so later. What is drawn is that state carried forward to the clock
along a two-body orbit about the primary (plus the primary's J2, near Earth
and the Moon), with the other accelerations to second order, in pieces near a
body and with the burns between taken one by one
([drawing](../physics/nbody-kernel.md)).

The rules carried over from the earlier spacecraft code:

- **Burns are segments of absolute time.** A burn is
  $\{t_0, t_1, \hat d, F, m_0, \dot m\}$. The kernel ends its steps on
  $t_0$ and $t_1$ and applies $F/m(t)$, so a burn starts and stops at its
  own times whatever the frame rate. A request lost in flight loses
  nothing.
- **Setting the clock is a jump, not a flight.** The sim clock counts its
  `setTime` calls. When the count changes the craft keeps its state at the
  new time, results in flight are dropped, and the burn schedule is cleared,
  so a burn cut short is never flown twice.
- **Nodes check their propellant exactly first.** A node's $\Delta v$ needs
  $m_0\,(1 - e^{-\Delta v / v_e})$ of propellant. A node the tank cannot
  deliver is refused before any is spent; otherwise it burns for exactly
  that long.

The model craft has a 1,000 kg dry mass, 500 kg of propellant and a
5,000 N engine at $I_{sp}$ 320 s, which is 1,272 m/s of $\Delta v$.

## Launches

All launches are from Earth for now. The MISSION tab's two place a craft
straight in orbit or on a departure; the ROCKET tab's fly a rocket from a
real pad ([rocket](../physics/rocket.md#in-the-app)).

- **Orbit.** A circular orbit at a chosen altitude, inclined to Earth's
  J2000 equator, starting at the ascending node.
- **Departure.** The departure hyperbola from a 200 km parking orbit: its
  periapsis is on the parking orbit, its outgoing asymptote along $v_\infty$,
  in the lowest-inclination plane
  ([burns and launch](../physics/burns-and-launch.md)). $v_\infty$ is given
  as a speed along Earth's prograde, retrograde, outward or inward
  direction, or comes from the planner.
- **From the pad (ROCKET tab).** `Mission.launchAscent` takes the ascent
  as geocentric J2000 states (`rocket.js` `ascentTrack`) and the craft
  that reaches orbit, built at the start with the cutoff state. Until
  cutoff the ascent is drawn as a craft: its marker interpolated along the
  track, the climb so far as its trail, the rest of the planned ascent as
  its path, all about the Earth. It keeps the craft's id, so a camera
  following the climb follows the craft on. At cutoff the craft joins the
  kernel. The MISSION tab reads out the climb (`ascentReadout`).

## Real missions

**Real missions** on the MISSION tab flies a mission as it actually flew:
- **Artemis I** (November to December 2022), from just after translunar
  injection to just before entry: both powered lunar flybys and the
  distant retrograde orbit. Its file, `public/missions/artemis1.json`, is
  written from NASA/JSC navigation's as-flown ephemeris (through JPL
  Horizons) by `src/physics/artemis1.export.mjs`
  (`npm run export:artemis1`, after `npm run fetch:artemis1`).
- **Artemis II** (April 2026), from ten minutes before translunar
  injection to entry. Its file, `public/missions/artemis2.json`, is
  written from JSC's reconstructed trajectory by
  `src/physics/artemis2.export.mjs`.

The app reads both with `src/physics/realMission.js`.

- **Fly it:** sets the clock to the mission's start (BACK undoes it). For
  Artemis II that's 2 April 2026, 23:39:59 UTC, ten minutes before
  translunar injection. The craft starts from its flown state.
- **Burns:** scripted as flown, each steered in the orbital frame about
  the body whose sphere of influence holds it (the Moon for Artemis I's
  flybys and the burns near them; the Earth otherwise). Each 5 seconds of
  a burn sampled that finely is a finite burn with its measured direction
  and acceleration. Artemis I's twelve small burns, which its data
  resolves only by the minute, are each one steady push over NASA's
  duration, along the change the trajectory shows. Scripted burns draw nothing from the model
  tank and survive clock jumps; they're tied to the mission's times.
  Choose **The first; correct it yourself** to fly only the injection burn
  and make the corrections with manoeuvre nodes.
- **From the flown path:** how far the craft is from where the real one was
  at this time, interpolated from the flown trajectory.
- **Next burn:** its name, when it starts, and in its detail the Δv as
  flown with what NASA published.
- **Green line:** the flown path, drawn relative to Earth.
- **Tracking:** a fix every 24, 12, 6 or 3 hours resets the craft to the
  flown state, as a navigation team's tracking would.
- **Corrections:** with **Aimed from the craft** (the default), each
  correction after the injection burn is worked out when the craft reaches
  it, from where this craft is, as NASA's were from where Orion was. The
  kernel holds at the burn's start (`Craft.holdAt`); there
  `RealMission.aimCorrection` flies the craft from its own state to the
  start of the next burn (or the end of the data), through the kernel with
  the scripted burns between, and finds by Newton's method the velocity
  change that brings it to the flown position there, within 10 m. Each
  round takes three more runs, nudged 1 cm/s each. Flying the burns in
  these runs matters: Artemis I's outbound powered flyby, aimed from a
  coast that left out its 180 m/s, took the sensitivities of another path
  and added 104 m/s instead of 9. The correction is added to the burn as
  flown, spread over it. The aim runs in the kernel's Worker
  (`KernelClient.aim`, `kernelHost.aimTo`), so the page never waits: the
  craft holds at the burn until the answer comes back, 2 to 200 ms later
  (longest for the powered flybys). In Node (the validations) the same
  `aimTo` runs at once; flown through the client a frame later, Artemis II
  comes out 0.4 m from that at entry. A correction followed within 12 hours by
  another (the first outbound trim) is flown as it was, and the later one
  aims for both. **As flown, blind** replays every correction exactly as
  Orion flew it, whatever the craft's state; the lunar flyby magnifies the
  difference, so without fixes that ends some 16,000 km off at entry.
  Aimed, with no fixes, Artemis II stays within 67 km of the flown path
  for the whole mission and reaches entry 0.3 km from it, for 4.0 m/s more
  than the flown corrections (`artemis2.validate.mjs`, part 6). Artemis I,
  over 25 days with two powered flybys and the distant retrograde orbit,
  stays within 238 km and ends 0.9 km off, for 31.8 m/s more than its 18
  burns; blind, it passes the Moon at 424 km instead of 130 and ends
  712,000 km off (`artemis1.validate.mjs`, case 5).
- **Setting the clock inside the mission** puts the craft where the real one
  was.
- **Entry.** At the mission's separation time (Artemis I 17:00 UTC on 11
  December 2022, Artemis II 23:33 UTC on 10 April 2026) the craft becomes
  Orion's crew module and flies its entry: lift banked by a guidance law to
  the splashdown point, then drogues and mains to the sea
  ([entry](../physics/entry.md)). The readout adds the bank and the
  parachutes; a capsule down under its chutes reads Splashdown, which is
  not a warning. Setting the clock back before separation makes it the
  whole spacecraft again.
- **Artemis II · our own plan** flies the simulator's own design of the
  mission instead. It's planned from the pre-TLI orbit and NASA's published
  targets only ([our own plan](../validation/artemis2.md#6-our-own-plan)),
  beside the real path, so "From the flown path" compares ours with
  theirs. Its file takes the flown path from `artemis2.json`
  (`flownFrom`).

What the craft does is checked against the real flight in
[the Artemis II validation](../validation/artemis2.md): the mission file,
flown frame by frame by the craft model, is within 0.4 km of the
validation's replay at the flyby.

The flown path is stored to the source's precision (1 mm, 1 nm/s) and
interpolated by cubic Hermite, except across gaps under a second (the
first two samples are 0.26 s apart), where the velocity is taken straight
between the samples' own: the cubic's velocity divides the positions'
rounding by the gap, and with positions to the metre that put 0.2 m/s into
a craft placed on the path just after the start (FLY IT with the clock
running), which the injection burn grew to 180 km by the next day.

The kernel learned two things for this:
- **Steered burns:** a burn can be steered in the orbital frame about a
  body (`frame: 'vnb'`). The integrator passes the craft's velocity to the
  thrust (in Encke too), and steps inside such a burn are capped at 0.25 s.
- **Tracking fixes:** `Craft.setState` takes a fix.

## Manoeuvre nodes and the engine

A node is a time and a $\Delta v$ in the primary-relative frame at that
time:

- **radial**, outward, completing a right-handed set;
- **prograde**, along the velocity relative to the primary;
- **normal**, along $\mathbf r \times \mathbf v$.

The engine keys burn prograde or retrograde (relative to the primary)
until cut or dry.

## The readout

| Value | Tag | What it is |
| --- | --- | --- |
| About, altitude, speed | kernel | n-body state relative to the primary, at the clock |
| Periapsis, apoapsis, period, eccentricity, inclination, excess speed | 2-body (dashed) | osculating elements about the primary: what the orbit would be if every other force stopped now |
| Propellant | model | the model craft's tank |
| Δv left | rocket eq. (dashed) | $v_e \ln(m / m_\text{dry})$ |
| Closest to the destination | kernel (dashed) | the smallest distance so far to the planned destination's system barycentre |

Inclinations are to the J2000 equator about a planet and to the ecliptic
about the Sun. Heights about the Earth (altitude, periapsis, apoapsis, and
the altitude asked for in LAUNCH) are above its equatorial radius,
6,378.137 km (WGS-84), as in the ROCKET tab and as orbit altitudes are
usually given; about every other body, above its mean radius. The ground
is lower than that sphere away from the equator (6,356.8 km at the poles),
so a craft about to come down away from the equator reads below zero, by
up to 21 km at the poles.

After an impact the readout gives when and where the craft came down
(latitude and longitude in the body's own frame) instead of an orbit. The
craft stays at that spot, carried with the body and turned with its spin:
left where it was in space, it would fall behind the Earth at its orbital
speed, millions of kilometres in a few days.

In the sky:
- **Marker:** a turned square, orange while the engine burns, struck
  through after an impact.
- **Amber line:** the osculating conic, sampled analytically (ellipses in
  eccentric anomaly; hyperbolas in hyperbolic anomaly out to the sphere of
  influence or 30 periapsis radii).
- **Pale line:** the path actually flown, kept relative to the primary.

The header's KERNEL lamp is lit while a craft is being stepped. LAG lights
caution yellow if a craft falls more than a minute behind the clock: the
kernel catches up rather than taking unsafe steps.

## The planner

For a destination and a departure span, the planner solves the
zero-revolution prograde Lambert arc for every (departure date, time of
flight) cell on astronomy-engine states ([Lambert's problem](../physics/lambert.md),
[porkchop](../physics/burns-and-launch.md)), in a Web Worker: about 9,000
cells in under 0.1 s. The grid is shaded by departure $C_3$, amber where it
is low, from the minimum to eight times it on a log scale. Clicking a cell
reads out:
- the departure and arrival dates;
- $C_3$ and the arrival $v_\infty$;
- the total $\Delta v$ from a 200 km parking orbit into a 400 km capture
  orbit.

"Fly this" sets the clock to the departure (a jump) and launches onto the
departure hyperbola whose $v_\infty$ is that cell's Lambert $v_\infty$. The
mission then tracks the closest approach to the destination. With no
correction burns the n-body flight misses the two-body plan (the 2026
window passes Mars at about 470,000 km, `craft.test.mjs`); targeting is
next on the physics roadmap.

## NASA's Trajectory Browser

Under the porkchop, the PLANNER tab shows what NASA Ames's
[Trajectory Browser](https://trajbrowser.arc.nasa.gov) lists for the chosen
planet, rendezvous or flyby:
- **NASA's optima:** the lowest eight per-opportunity optima from 2026 to
  2040, with their route, so gravity assists such as EVM show.
- **Ours:** for each direct one, our own transfer between NASA's two dates
  (`transfer()` in `src/physics/trajsearch.js`, up to two revolutions round
  the Sun), under NASA's conventions, with the difference in percent. The
  same dates mean any difference is the modelling alone; its tooltip gives
  our C3 and the revolutions.

A row can be shown on the grid (a 120-day span around its launch) or flown:
- **Flying a row** flies our cheapest Lambert arc between NASA's dates
  (multi-revolution where that is cheaper). Flying a grid cell keeps the
  grid's direct arc.
- **"Open on NASA's site"** posts the same search to the browser in a new
  tab.

How the data gets in:
- **The browser can't be queried from a page.** It answers only form posts
  and sends no cross-origin headers.
- **So it's fetched ahead of time.** `npm run fetch:trajbrowser`
  (`src/physics/trajbrowser.fetch.mjs`) fetches its results once and writes
  `public/trajbrowser/planets.json`. It's paced 15 s apart and cached in
  `~/.cache/digital-orrery/trajbrowser`, so reruns don't repeat finished
  queries.
- **Per-planet limits matter.** The browser takes launch years 2010–2040
  and Δv up to 20 km/s. Each planet's search uses its own flight-time and
  Δv limits, because the browser's one-per-year optima depend on both.

## Links

| Parameter | Effect |
| --- | --- |
| `?craft=orbit,400,51.6` | starts with a craft in that orbit (km, °), followed |
| `?craft=departure,2.95,prograde` | starts on that departure |
| `?plan=mars` | opens the planner and computes the grid |
| `?mission=artemis2` | flies Artemis II from its start (`artemis2,first` flies only the injection burn) |
| `?mission=artemis2&t=2026-04-06T22:50:00Z&fix=12` | starts just before the lunar flyby, with a tracking fix every 12 h |
