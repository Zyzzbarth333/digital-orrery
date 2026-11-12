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
along a two-body orbit about the primary, with the other accelerations to
second order.

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

All launches are from Earth for now; real launch pads and weather come
later.

- **Orbit.** A circular orbit at a chosen altitude, inclined to Earth's
  J2000 equator, starting at the ascending node.
- **Departure.** The departure hyperbola from a 200 km parking orbit: its
  periapsis is on the parking orbit, its outgoing asymptote along $v_\infty$,
  in the lowest-inclination plane
  ([burns and launch](../physics/burns-and-launch.md)). $v_\infty$ is given
  as a speed along Earth's prograde, retrograde, outward or inward
  direction, or comes from the planner.

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
about the Sun.

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

## Links

| Parameter | Effect |
| --- | --- |
| `?craft=orbit,400,51.6` | starts with a craft in that orbit (km, °), followed |
| `?craft=departure,2.95,prograde` | starts on that departure |
| `?plan=mars` | opens the planner and computes the grid |
