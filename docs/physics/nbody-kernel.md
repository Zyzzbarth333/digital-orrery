# The n-body spacecraft kernel

`src/physics/nbody.js` (the integrator), `src/physics/bodies.js` (the bodies),
`src/physics/kernelHost.js` and `kernel.worker.js` (running it in a Web
Worker).

A spacecraft is a test particle: it feels the Sun, the planets, the Moon,
near a planet that has them that planet's major moons ([below](#moons)),
and near one of them the sixteen most massive asteroids
([below](#asteroids)), but does not pull on them. Their positions come from the ephemeris, so they
move on their real paths throughout every step.

## Force model

Heliocentric (positions relative to the Sun's centre, J2000 equatorial):

$$
\ddot{\mathbf r} = -\mu_\odot\frac{\mathbf r}{r^3}
+ \sum_j \mu_j\left[\frac{\mathbf r_j - \mathbf r}{|\mathbf r_j - \mathbf r|^3} - \frac{\mathbf r_j}{r_j^3}\right]
+ \sum_j \mathbf a_{J_2,j} + \mathbf a_\text{thrust}
$$

$\mathbf r_j$ and $\mu_j$ are body $j$'s heliocentric position and GM
([which GM](ephemerides-and-gm.md#gm-must-match-what-the-position-is)). The
first term in the bracket is body $j$'s pull on the craft. The second is the
**indirect term**: the Sun's own acceleration toward body $j$, which a frame
centred on the Sun has to subtract. Without it a craft orbiting a planet
drifts away from that planet at the planet's heliocentric acceleration.

The indirect term is tested directly (`nbody.test.mjs` case 4): for a particle
near a planet, its acceleration minus the planet's own heliocentric
acceleration $-(\mu_\odot + \mu_p)\mathbf r_p/r_p^3$ equals the planet's pull
plus a solar tide no larger than $3\mu_\odot d/r_p^3$.

### Oblateness (J2)

A spinning body bulges at its equator, and the bulge pulls a nearby craft
toward the equator plane. The largest term is the zonal harmonic $J_2$. At
the craft's offset $\mathbf d = \mathbf r - \mathbf r_j$ from body $j$, with
$z = \mathbf d\cdot\hat{\mathbf p}$ along the body's spin pole
$\hat{\mathbf p}$ (`zonal.js`):

$$
\mathbf a_{J_2} = \frac{3}{2}\frac{J_2\,\mu R^2}{d^5}
\left[\left(\frac{5z^2}{d^2} - 1\right)\mathbf d - 2z\,\hat{\mathbf p}\right],
$$

with $R$ the reference radius the value was fitted with. In the body's own
frame this is the familiar $a_z = -\tfrac32 J_2\mu R^2 z\,(3 - 5z^2/d^2)/d^5$
and $a_{x,y} = -\tfrac32 J_2\mu R^2 (x, y)(1 - 5z^2/d^2)/d^5$.

| Body | $J_2$ | $R$ | Source |
| --- | --- | --- | --- |
| Earth | $1.0826267\times10^{-3}$ | 6378.1363 km | EGM2008 (Pavlis et al. 2012), tide-free $\bar C_{20} = -4.84165143790815\times10^{-4}$ |
| Moon | $2.032157\times10^{-4}$ | 1738.0 km | GRAIL GL0660B (Konopliv et al. 2013), $\bar C_{20} = -9.088083466222\times10^{-5}$ |

$J_2 = -\sqrt5\,\bar C_{20}$ converts the fully normalised coefficient.

- **The pole** is the body's spin axis of date from `orientation.js`,
  refreshed once a simulated day (Earth's moves 0.14″ a day).
- **What is applied:** only the direct term on the craft. The bulge's
  reaction on the body is already in its ephemeris.
- **Range:** beyond 100 reference radii the term is dropped. There it is
  under $1.5J_2/100^2$ of the point-mass pull, $2\times10^{-7}$ for Earth.

Low Earth orbit is where it matters most:
- at 400 km, J2 is about $10^{-3}$ of Earth's pull;
- it turns an orbit's node by about 5° a day (checked against the analytic
  rate in `nbody.test.mjs` case 8b);
- leaving it out put Artemis II's first coast arc 969 km off instead of
  42 km ([validation](../validation/artemis2.md)).

Every planet has its $J_2$ too, each from its field's primary source (the
table is in [the space environment](environment.md#the-planets-j2)); Mars's,
Jupiter's and Saturn's matter for craft orbiting them. `solarSystemBodies({
zonal: false })` gives point masses only, for comparisons.

The forces beyond these (the Earth's and Moon's higher harmonics, the
Earth's tides, drag, sunlight pressure, venting and relativity) come from
[the space environment](environment.md), through the `extraAccel` hook. Not
yet modelled: the planets' harmonics beyond $J_2$, the moons' fields beyond
degree 2 ([moons](#the-moons-own-fields)), and the asteroids.

## Integrators

### Kick-drift-kick leapfrog (velocity Verlet)

One step of length $h$ from $(t, \mathbf r, \mathbf v)$ with
$\mathbf a = \ddot{\mathbf r}(t, \mathbf r)$ known:

$$
\mathbf v_{1/2} = \mathbf v + \tfrac h2\,\mathbf a(t,\mathbf r),\qquad
\mathbf r' = \mathbf r + h\,\mathbf v_{1/2},\qquad
\mathbf v' = \mathbf v_{1/2} + \tfrac h2\,\mathbf a(t+h,\mathbf r').
$$

Second order, time-reversible, and symplectic for a fixed step in a
time-independent field. The acceleration at the end of a step is the one at
the start of the next, so each step costs one force evaluation ("first same
as last").

### Yoshida's fourth-order composition (the default)

Three leapfrog steps of lengths $w_1 h$, $w_0 h$, $w_1 h$ with

$$
w_1 = \frac{1}{2 - 2^{1/3}} = 1.3512071919596578,\qquad
w_0 = -\frac{2^{1/3}}{2 - 2^{1/3}} = -1.7024143839193153
$$

($2w_1 + w_0 = 1$) cancel the third-order error terms, leaving a fourth-order
method that is still time-reversible (Yoshida 1990). The middle step runs
backwards in time, so stage times reach about $t - 0.35h$ and $t + 1.35h$;
everything evaluated there (ephemeris, thrust with falling mass) is smooth,
so this is harmless.

**Forces that depend on velocity.** Drag and a burn steered in the orbital
frame depend on the velocity, which the leapfrog has only half-kicked when
it evaluates the forces between its kicks. Evaluated at that velocity,
the method drops to first order in those forces. NASA's drag check case
flown through the kernel came out 0.26 m off after 8 hours, and a quarter
of the step gave 0.06 m. So the extra forces are evaluated at the
velocity the kick ends on:
- **The prediction:** the half-kicked velocity plus half a step of the
  gravity just found and of the last extra push.
- **The result:** the same case comes out 7 mm off, 1 mm at a quarter of
  the step.
- **Elsewhere:** the Artemis II injection burn's replay went from 0.030 to
  0.012 m/s.

**Step limits from the environment.** The environment
([the space environment](environment.md)) can cap the step (`stepCap`),
in both integrators:
- **Near a shadow's edge,** where sunlight pressure switches.
- **Low in the atmosphere,** where drag is stiff.

Measured on the fixed-step order test (`nbody.test.mjs` case 2): halving $h$
cuts the error by 4.00 for leapfrog and 16.01 for Yoshida (orders 2.00 and
4.00). A full orbit out and back returns to the start to 2×10⁻¹³ of $|\mathbf r|$
(round-off). With a fixed step, leapfrog's energy error over 100 orbits is
bounded: its maximum over every step is the same, 2.54×10⁻⁴, in orbits 1-2
and 99-100.

### Step size

Each step is a fraction $\eta$ of the shortest local dynamical time:

$$
h = \min\Bigl(\eta\,\min_k \sqrt{d_k^3/\mu_k},\ h_\text{max}\Bigr),\qquad \eta = 0.01,\ h_\text{max} = 1\ \text{day},
$$

over the Sun ($d$ = distance to the Sun) and every body $k$. $\sqrt{d^3/\mu}$
is the time it takes to move about one radian of an orbit at that distance,
so the step shrinks near a planet and grows in cruise. This varies the step,
so the method is no longer exactly symplectic, and there is no error
estimate. A 4× finer $\eta$ cuts the error by 216-300× (4⁴ = 256) on the
test orbits, and the default is within 10⁻⁵ of the exact two-body answer.
Error-controlled stepping (an embedded Runge-Kutta-Nyström pair or DOP853) is
planned.

The last step of an advance lands exactly on the end time (at large $t$ a
leftover smaller than one unit in the last place used to stop $t$ advancing
while $\mathbf r$ kept drifting).

### Step budget

Each call has a step budget (200,000 in the kernel, 20,000 per frame in the
app). Steps are never stretched to meet it: a stretched step near a planet can
pass straight through it. When the budget runs out the advance stops short
and reports `complete: false`; the app carries on from there next frame and
shows that physics is behind the clock.

## Encke's method

Inside a body's sphere of influence the craft mostly follows a two-body
conic about it, and the Cowell integrator above spends nearly all its steps
following that conic. Encke's method follows the conic exactly and
integrates only the small deviation from it. Code: `src/physics/encke.js`.

Relative to the primary $P$, the craft is at
$\boldsymbol\rho = \boldsymbol\rho_\text{ref} + \boldsymbol\delta$, where
$\boldsymbol\rho_\text{ref}(t)$ is a two-body conic about $P$, propagated by
universal variables (`keplerStep`, a warm-started Newton solve of the same
equations as `propagate`, which it falls back on). Subtracting the conic's
equation of motion from the craft's,

$$
\ddot{\boldsymbol\delta} = \frac{\mu_P}{|\boldsymbol\rho_\text{ref}|^3}
\left[(1 - g)\,\boldsymbol\rho - \boldsymbol\delta\right] + \mathbf a_\text{pert},
\qquad g = \frac{|\boldsymbol\rho_\text{ref}|^3}{|\boldsymbol\rho|^3} = (1 + q)^{-3/2},
\qquad q = \frac{\boldsymbol\delta\cdot(\boldsymbol\delta + 2\boldsymbol\rho_\text{ref})}{|\boldsymbol\rho_\text{ref}|^2},
$$

with $1 - g$ evaluated in Battin's form

$$
1 - g = \frac{q\,(3 + 3q + q^2)}{\left((1+q)^{3/2} + 1\right)(1+q)^{3/2}},
$$

which never subtracts two nearly equal numbers. The perturbation is the
craft's acceleration less the primary's, both from the force model, so the
Sun and every other body act only by their tides across
$\boldsymbol\rho$ (the indirect terms cancel):

$$
\mathbf a_\text{pert} = \mu_\odot\left[\frac{\mathbf r_P}{|\mathbf r_P|^3} - \frac{\mathbf r}{|\mathbf r|^3}\right]
+ \sum_{j\ne P}\mu_j\left[\frac{\mathbf r_j - \mathbf r}{|\mathbf r_j - \mathbf r|^3} - \frac{\mathbf r_j - \mathbf r_P}{|\mathbf r_j - \mathbf r_P|^3}\right]
+ \mathbf a_{J_2} + \mathbf a_\text{thrust} .
$$

The ephemeris places $P$ and the other bodies, but its acceleration never
enters the motion about $P$:
- **Why it matters:** a Chebyshev ephemeris holds position far better than
  acceleration. DE442's own Earth scatters by about $3\times10^{-9}$ m/s²
  about the forces on it, and an orbit about the Earth would follow that.
- **On NASA's check case:** with the Sun and Moon on, the kernel's low
  orbit comes out 5 mm from NASA's tools after 8 hours in this form, and
  0.12 m with the primary's acceleration taken from the ephemeris
  ([6-DOF](sixdof.md#the-apps-kernel-on-the-same-cases)).
- **The older form** (`tidal: false`) subtracts the primary's acceleration
  from the ephemeris instead (the second derivative of its Hermite cubic).
  Then $\mathbf r = \mathbf r_P + \boldsymbol\rho$ obeys exactly the
  heliocentric Cowell equation $\ddot{\mathbf r} = \mathbf a(\mathbf r)$.
  The two forms differ by the ephemeris's fitting noise. When the Earth
  came from astronomy-engine that difference was about $10^{-10}$ km/s²
  (23 km after 10 days at GEO), which is why the ephemeris form came
  first.
- **Cowell stays heliocentric,** so a fine Cowell run is no longer an exact
  reference for Encke: they differ by that same noise (0.18 km after 10
  days on a high orbit, `nbody.test.mjs`).

**Steps.** $\boldsymbol\delta$ is advanced by Dormand–Prince 5(4) with error
control: the step grows or shrinks so the embedded error estimate stays
under `tolKm` (default $10^{-7}$ km per step) in position, and that over the
local dynamical time in velocity. Steps end on the primary's ephemeris nodes
(where the Hermite cubic changes), with the end stages a nanosecond inside
the step so each uses the cubic of the interval it crosses; they are capped,
as in Cowell, at 1 % of every other body's dynamical time, and at 1 % of the
primary's on a conic whose periapsis is inside it, so impacts are caught as
tightly as before. An impact is a step that ends below the body's surface:
the Earth's is sea level, the WGS-84 ellipsoid about its pole of date
(6,378.137 km at the equator, 6,356.752 km at the poles); every other
body's is the sphere of its mean radius. When $|\boldsymbol\delta|$ exceeds $10^{-4}|\boldsymbol\rho|$
the conic is re-anchored on the current state (rectification).

**When it is used.** Encke pays only while the motion is nearly Keplerian.
The kernel judges that by the size of the tides rather than their momentary
value, which passes through zero twice an orbit as the geometry turns (at
GEO it swings between $1.6\times10^{-6}$ and $6\times10^{-5}$ in a day and
made the kernel switch integrators twice an orbit):

$$
\varepsilon = \frac{|\boldsymbol\rho|^2}{\mu_P}\left(\sum_j \frac{2\mu_j|\boldsymbol\rho|}{(d_j - |\boldsymbol\rho|)^3} + |\mathbf a_\text{thrust}|\right),
$$

over the Sun and every other body, $d_j$ its distance from the primary.
Encke below $10^{-5}$, Cowell above $3\times10^{-5}$ (the gap stops it
flip-flopping). Low Earth orbit is about $2\times10^{-7}$; GEO, at about
$5\times10^{-5}$, and beyond, and any craft under thrust are Cowell. On a high elliptical orbit
the kernel switches each revolution: Encke through perigee, Cowell near
apogee. Leaving the sphere of influence returns the craft to Cowell as
before.

**With J2.** The primary's J2 is part of $\mathbf a_\text{pert}$ but left
out of $\varepsilon$. In low orbit it is about $10^{-3}$ of the central
pull, far above the switching threshold, but it is smooth and Encke
integrates it well:
- In low Earth orbit the deviation grows about 100 times faster than from
  the tides alone, so Encke rectifies and steps more often.
- The tolerance went from $10^{-6}$ to $10^{-7}$ km per step to hold about
  a metre a day: 1.20 m from a fine Cowell reference in 1,134 steps,
  against Cowell's 5.1 m in 9,795.
- Point masses only took 326 steps, so J2 costs about 3.5 times the steps
  in low orbit.

A reference orbit that already includes J2's secular drift (averaged
elements) would win that back, and is the next speed-up.

## Events

Checked at the end of each step:

- **Impact**: closer to a body's centre than its radius, or closer than
  695,700 km to the Sun's. The advance stops there. The planets' moons are
  bodies like any other here, with their radii from Horizons.
- **Primary change**: the innermost sphere of influence holding the craft, by
  Laplace's radius $r_\text{SOI} = d\,(\mu/\mu_\text{primary})^{2/5}$ ($d$ the
  body's distance from its primary; the Moon's is relative to Earth, and
  each planet's moon's relative to its planet: Ganymede's is 24,500 km).
  Reported; the advance continues.

Known limit: the check is at step ends with no hysteresis, so a craft
skimming a boundary can switch back and forth.

## Body positions between ephemeris calls

Calling the ephemeris (DE442's table, or astronomy-engine outside it) at
every force evaluation would be slow, so each
body's state is computed at nodes spaced $\Delta$ apart (1 h for the Moon, 2 h
for Earth, 6 h for the other inner planets, 1-2 days outside) and
interpolated with a cubic Hermite polynomial, using position and velocity at
both ends. With $s = (t - t_k)/\Delta$:

$$
\mathbf r(t) = h_{00}(s)\,\mathbf r_k + h_{10}(s)\,\Delta\,\mathbf v_k + h_{01}(s)\,\mathbf r_{k+1} + h_{11}(s)\,\Delta\,\mathbf v_{k+1},
$$

$$
h_{00} = 2s^3 - 3s^2 + 1,\quad h_{10} = s^3 - 2s^2 + s,\quad h_{01} = -2s^3 + 3s^2,\quad h_{11} = s^3 - s^2 .
$$

The interpolation itself errs by about $(\Delta n)^4 a/384$ for an orbit of
radius $a$ and mean motion $n$. Measured against direct ephemeris calls
over 30 days, the worst error is 20 m (`nbody.test.mjs` case 7): Mercury,
whose 6-hour nodes give 15 m by that formula. DE442's velocities are its
series' own derivative. On astronomy-engine it was 21 m, set by how closely
its velocities match its own positions.

Two sources' velocities do not match their positions well enough, so they
are replaced by central differences of the positions:

- **astronomy-engine's Pluto** (outside DE442's table; inside it the
  difference agrees with the series' own velocity): a cubic through its velocities is 0.4 km
  out at 6-hour nodes and 3 km at two days. Differenced over a minute, it
  is 29 m at two days. Wider nodes do worse, as $\Delta^2$, because its
  positions are themselves piecewise.
- **`JupiterMoons`:** its velocities differ from its positions' derivative
  by up to 3 m/s (Callisto), which bends the cubic by 0.4 km. Differenced
  over 10 s, the four moons hold to 34 m.

The moons' nodes are in [Moons](#moons).

## Moons

From far away a planet and its moons pull as one mass at the system's
barycentre, and that is how the kernel has them in cruise. The error is the
moons' quadrupole, about $3\,\mu_m a^2/d^4$ for a moon of GM $\mu_m$ on an
orbit of radius $a$, at distance $d$. At 1.25 times Jupiter's sphere of
influence that is $10^{-14}$ km/s², from Callisto and Ganymede.

Close in, the moons are bodies of their own. Within `EXPAND` = 1.25 times
a system's sphere of influence, `bodies.js` **splits** it. Beyond
`COLLAPSE` = 1.5 times, it folds it up again. Split, the system is:

- **the planet at its own centre**, with its planet-only GM and its $J_2$.
  The centre is the barycentre plus $-\sum_i \mu_i\mathbf r_i/\mu_\text{system}$
  over the moons ([moons](../frontend/moons.md#planets-drawn-at-their-centres)).
- **each moon at the planet's centre plus its planetocentric place** from
  `moons.js`, with its own GM. The five largest also carry their degree-2
  fields ([below](#the-moons-own-fields)).

| System | Planet GM (km³/s², NAIF) | Moons in the kernel (GM, km³/s²) |
| --- | --- | --- |
| Mars | 42,828.375 (499, mar099s) | Phobos 0.00072, Deimos 0.00012 |
| Jupiter | 126,686,531.9 (599, jup365) | Io 5,959.9, Europa 3,202.7, Ganymede 9,887.8, Callisto 7,179.3 |
| Saturn | 37,931,206.2 (699, sat441) | Mimas 2.5, Enceladus 7.2, Tethys 41.2, Dione 73.1, Rhea 153.9, Titan 8,978.1, Iapetus 120.5 |
| Uranus | 5,793,950.6 (799, ura184) | Miranda 4.3, Ariel 83.4, Umbriel 85.4, Titania 222.8, Oberon 205.3 |
| Neptune | 6,835,100.0 (899, nep097) | Triton 1,428.5 |
| Pluto | 869.3 (999, plu060) | Charon 106.1 |

The planet's GM plus its moons' matches the system's GM (DE442) to within a
small part of the moons' share:

- 0.01 % for Jupiter (Amalthea and the other small moons, 2.4 km³/s², are
  left out) and 0.02 % for Saturn;
- 0.1 % for Neptune and Pluto;
- 0.7 % (4.5 km³/s², $8\times10^{-7}$ of the system) for Uranus.

**Which systems are split** is state, kept in a *view* of the bodies:

- `focus(r, t)` moves each system to the state the craft at `r` calls for.
  The kernel calls it at the start of `advance()` and after every step, in
  both integrators (`opts.focus`, by default `bodiesAt.focus`). The body list
  may change between steps, never within one.
- Inside a sphere of influence the craft may be in Encke's method about the
  planet, whose reference conic needs the planet to stay one point. The split
  starts outside the sphere, so it always holds there.
- Each full check notes how far the craft is from the nearest threshold.
  Until the craft (and the planets, at up to 30 km/s) could have covered
  that, the check is skipped: in low Earth orbit, for weeks.
- `sys.view()` gives each craft its own view (`craft.js` takes one), so a
  craft near Jupiter keeps its moons while another is far away.
  `sys.bodyAt(key, t)` finds any body by key whatever the view: a moon, or a
  planet with moons at its centre. The app uses it for lookups by name.
- `solarSystemBodies({ moons: false })` never splits, for comparisons.
  `satellites` replaces `moons.js` as the source of the moons; the flyby
  check uses it to fly with JPL's moons.

**Pluto** is a system too (with Charon), and is in the list only within 5 AU
of it. Beyond that its pull is under $2\times10^{-15}$ km/s², a kilometre in
a year, and the inner solar system never comes within 28 AU of it.
Everywhere else it would only add a tenth to every force sum.

**Nodes.** A planet's centre is interpolated on 6-hour nodes, built on the
barycentre's own cubic plus the moons' offset. Each moon about its planet
is a cubic of its own, whose spacing divides 6 hours and keeps
$(\Delta n)^4 a/384$ under 100 m. Io, Europa, Ganymede and Callisto share
Io's spacing, because `JupiterMoons` gives all four at once. A moon's
heliocentric ephemeris is the sum of the two cubics (its nodes are the
moon's, which Encke's steps end on). Measured against the models directly
over 20 days (`flyby.test.mjs` case 1):

| Body | Node spacing | Worst error |
| --- | ---: | ---: |
| Mars's centre; Phobos, Deimos | 6 h; 18, 45 min | 0.2 m; 101 m, 36 m |
| Jupiter's centre; Io, Europa, Ganymede, Callisto | 6 h; 36 min | 34 m (Io's 20 km swing of the centre); 69 m (Io), 34–38 m |
| Saturn's centre; Mimas to Rhea; Titan; Iapetus | 6 h; 24–90 min; 3 h; 6 h | 1 m; 54–90 m; 24 m; 2 m |
| Uranus's centre; Miranda to Oberon | 6 h; 40 min–3 h | 2 m; 19–80 m |
| Neptune's centre; Triton | 6 h; 2 h | 1 m; 58 m |
| Pluto's centre; Charon | 6 h; 3 h | 20 m (Charon's 2,100 km swing); 20 m |

That is far inside how well `moons.js` knows the moons themselves: 130 to
650 km for the Galilean moons, 1,600 km for Titan
([moons](../frontend/moons.md#how-right-they-are)). Those errors, not the
kernel, set how closely a flyby of a moon can be followed. On Juno's pass
over Ganymede the kernel follows JPL's trajectory to 4 km after nine hours
with JPL's moons (Ganymede where Juno's own track puts it; 21 km with the
Ganymede Horizons serves), 323 km with `moons.js`'s, and 9,300 km with no
moons
([validation](../validation.md#the-moons-pull-junos-ganymede-flyby-flybytestmjs)).

**Cost** (`npm run bench`; `flyby.test.mjs` case 2 checks that cruise never
evaluates a moon):

- **Away from the systems:** unchanged. The same steps as before, and each
  costs the same to within the bench's noise (±5 % on this machine).
- **Among Jupiter's moons**, on a 1.5 million km orbit, the steps are the
  same in number (61 a day). Each costs about 3 times as much: 13 bodies
  instead of 9, and each moon's place is a sum of two cubics. The Galilean
  moons' nodes add about 1.2 ms per simulated day (three `JupiterMoons`
  calls a node, for the differenced velocity).
- **Overall:** Cowell runs about 450 sim days a second there, against
  3,400 with the system folded up. That is still a year in under a second.

## Asteroids

The sixteen most massive asteroids are point masses in the kernel
(`src/physics/asteroids.js`). They are the perturbers JPL's small-body
integrations use with DE441: Ceres, Pallas, Juno, Vesta, Iris, Hygiea,
Eunomia, Psyche, Euphrosyne, 52 Europa, Cybele, Sylvia, Thisbe, Camilla,
Davida and Interamnia.

- **GM:** the DE441 masses of the SB441-N16 perturber file, as NAIF's
  `gm_de440.tpc` gives them (`BODY2000001_GM` etc.). Its sources list the
  "SB441-N16 small-body integration perturber file (DE441 masses)". Ceres
  62.63 km³/s², Vesta 17.29, Pallas 13.67, Hygiea 5.63, Psyche 1.59; the
  smallest, Cybele, 0.94.
- **Positions:** SB441's own, from the Chebyshev table `sbTable.js`
  ([small bodies](../frontend/small-bodies.md#exact-positions-for-the-largest)),
  within 1 km of SB441 from 2000 to 2050 and two-body from the table's
  ends outside it. In the kernel each is a Hermite cubic through nodes a
  day apart taken from the table (2×10⁻⁴ km from the series), which also
  smooths the series' joins into a path with continuous velocity.
- **Radius,** for impacts: half the diameter in JPL's Small-Body Database
  (Vesta 261 km). They are spheres here, with no $J_2$, though Vesta's
  $J_2$ is large; an orbit about one precesses less than it would.
- **On by default,** whenever the table is installed (`deNode.js`,
  `deLoad.js`). `solarSystemBodies({ asteroids: false })` leaves them
  out; an array of keys takes just those.

**Reach.** Like Pluto, each asteroid is in the body list only within
`ASTEROID_REACH` = 1 AU of the craft, and leaves it beyond 1.2 AU. From
1 AU Ceres pulls by 2.8×10⁻¹⁵ km/s², 0.1 km in a hundred days. All
sixteen everywhere would make every force sum 25 bodies instead of 9, and
the kernel about three times slower in low Earth orbit for nothing. From
2000 to 2050 only Iris comes within 1 AU of the Earth (to 0.85 AU, on
1.7 % of days), so near the Earth the list is what it was. The same `focus`
check that splits the planets' systems moves each asteroid in or out, and
is skipped until the craft could have reached an edge.
`asteroidReach: Infinity` keeps them all in.

**What they change** (`asteroids.test.mjs`):

| Case | Result |
| --- | --- |
| 300 days of cruise from the Earth, 3 km/s faster | the asteroids, all in everywhere, move the craft 0.161 km; the 1 AU reach leaves out all of it |
| a year on a circular orbit through the belt (2.6 AU) | 0.304 km; the reach leaves out 0.297 km |
| a Dawn-like orbit about Vesta (950 km, 12.3 h, August 2011), two days | Vesta is the primary and Encke holds 950.0 km; without the asteroids the craft drifts 23,300 km away |
| a Psyche-like approach (August 2029): 15,000 km out at 50 m/s, aimed 1,000 km off | pericentre 561.5 km (hourly samples) against the hyperbola's 560.3 km; without the asteroids it passes at 1,003 km |

So in cruise the asteroids are well under a kilometre. At an asteroid they are the whole of the
dynamics: each has a sphere of influence (Vesta's 39,000 km, Psyche's
19,000 km), and inside it the kernel hands the craft to Encke's method
about it, as about a planet.

## In the app: Web Worker, versions and drawing

The kernel runs in a Web Worker (`kernel.worker.js` wrapping
`kernelHost.js`). Each frame every craft sends its exact state, the sim time to
advance to and its burns; one batch is in flight at a time, and a busy Worker
means the next request covers a longer span. Every result carries the craft's
state version; a burn or a clock jump on the main thread bumps the version,
and a result computed from the old state is dropped.

Results arrive a frame or so late, so a craft is drawn at its last exact state
$(\mathbf r_0, \mathbf v_0, t_0)$ carried forward to the sim clock: along a
two-body orbit about its primary (with the primary's own position from the
ephemeris), plus every other acceleration to second order,

$$
\mathbf r \approx \mathbf r_\text{2-body}(t) + \tfrac12\,\mathbf a_\text{other}\,(t-t_0)^2,\qquad
\mathbf a_\text{other} = \mathbf a_\text{kernel} - \mathbf a_\text{primary} - \mathbf a_\text{2-body}.
$$

About a primary with a J2 (Earth, the Moon), the primary's J2 is taken out
of $\mathbf a_\text{other}$: it turns with the craft around its orbit, so
held constant it would make things worse (0.24 km off after 10 minutes in
low orbit, 115 km after an hour). The craft is instead carried by two-body
motion plus J2, integrated with classical RK4 at 1/256 of the orbital
period (at most 2,048 steps), with the other accelerations still held
constant. That gives 5×10⁻⁵ km after 10 minutes and 6.5 m after an hour.

That is within 0.06 km in low orbit and 0.09 km in cruise in the browser.

Two more rules keep long carries honest (`Craft.carryForward`):
- **In pieces near a body.** A carry longer than a quarter of the dynamical
  time $\sqrt{r^3/\mu}$ at the closest the osculating conic comes is split
  into that many pieces (at most 32), the acceleration found afresh at each.
  Held through Artemis I's pass 130 km above the Moon, one 25-minute carry was
  163 km out; in pieces it is 0.15 km.
- **Burns apart.** The kernel's acceleration holds the thrust of a burn
  burning at its instant, which a carry would push past the burn's end, and
  none of a burn that starts within the carry. So the thrust is taken out,
  the craft coasts to each burn, takes its velocity change there at once (20
  s of it at a time, each piece along its own direction in the orbital frame
  of the moment), and coasts on. A 100 m/s burn ten minutes into an hour's
  carry is drawn within 0.2 km of the kernel; carried with the kernel's
  acceleration alone it was left out entirely.

At very high warp the kernel can still be a frame or more behind, most of
all while it holds at a burn for an aimed correction: at a day a second the
drawn Artemis I was 1,100 km off for a frame, eight hours past its outbound
powered flyby. The physics itself is unaffected. The drawn state is worked
out once per frame and shared by the scene and the readouts.

### The moons' own fields

A moon that keeps one face to its planet is flattened by its spin and
stretched toward the planet by the tide, so besides $J_2$ it has a sectoral
term $C_{22}$, about a third of $J_2$ (exactly $3/10$ for a fluid body). In
the moon's body axes ($x$ toward the planet, $z$ its spin pole, which for
these moons is the orbit's pole), with $\mathbf d$ the craft's offset from
the moon's centre, the potential is

$$
U = -\frac{\mu R^2 J_2}{2}\left(\frac{3z^2}{d^5} - \frac{1}{d^3}\right) + 3\mu R^2 C_{22}\,\frac{x^2 - y^2}{d^5},
$$

so the $C_{22}$ acceleration is

$$
\mathbf a_{C_{22}} = 3C_{22}\,\mu R^2\left[\frac{2(x\,\hat{\mathbf X} - y\,\hat{\mathbf Y})}{d^5} - \frac{5(x^2 - y^2)\,\mathbf d}{d^7}\right].
$$

`zonal.js` adds it with $J_2$, and `bodies.js` turns the axes with the
moon's orbit at every placing. `flyby.test.mjs` case 5 checks the
acceleration against finite differences of $U$ ($8\times10^{-10}$
relative).

| Moon | $J_2$ ($10^{-6}$) | $C_{22}$ ($10^{-6}$) | $R$ (km) | Source |
| --- | ---: | ---: | ---: | --- |
| Io | 1,834.6 ± 1.5 | 549.6 ± 0.3 | 1,821.6 | Park et al. 2025 (Juno and Galileo) |
| Europa | 437.6 ± 77.5 | 138.62 ± 2.44 | 1,560.8 | Gomez Casajus et al. 2021 (Galileo reanalysed), as the JUICE review tabulates it |
| Ganymede | 133.0 ± 6.8 | 39.56 ± 1.73 | 2,631.2 | Gomez Casajus et al. 2022 (Juno and Galileo); normalised 5.948167 and 6.128513 ×10⁻⁵ in its dataset |
| Callisto | 32.7 ± 0.8 | 10.2 ± 0.3 | 2,410.3 | Anderson et al. 2001, as the JUICE review tabulates it |
| Titan | 31.808 ± 0.404 | 9.983 ± 0.039 | 2,575 | Iess et al. 2010, Table 1, solution SOL1 |

- **Reference radii:** for Io, Europa and Callisto the radius is the mean
  radius the review lists beside the values. The papers themselves were not
  opened to confirm it; a radius a few kilometres off changes the term by
  well under 1 %.
- **Titan:** the 2012 tidal solution (SOL1b, $J_2 = 34.227$, $C_{22} =
  10.263$) fits a Love number as well. The static 2010 solution is used,
  since the tide is not modelled.
- **Not modelled:** the moons' fields beyond degree 2, and their tides.
- **Effect:** small on a flyby. On Juno's pass 1,046 km over Ganymede it
  moves the kernel's Juno by 0.2 km after nine hours. For a craft orbiting a
  moon it is what turns the orbit.

## Sources

- R. S. Park et al., "Io's tidal response precludes a shallow magma ocean",
  *Nature* 638 (2025) 69-73, doi:10.1038/s41586-024-08442-5.
- L. Gomez Casajus et al., "Updated Europa gravity field and interior
  structure from a reanalysis of Galileo tracking data", *Icarus* 358 (2021)
  114187, doi:10.1016/j.icarus.2020.114187.
- L. Gomez Casajus et al., "Gravity field of Ganymede after the Juno extended
  mission", *Geophysical Research Letters* 49 (2022) e2022GL099475,
  doi:10.1029/2022GL099475; dataset doi:10.5281/zenodo.6949645.
- J. D. Anderson et al., "Shape, mean radius, gravity field, and interior
  structure of Callisto", *Icarus* 153 (2001) 157-161,
  doi:10.1006/icar.2001.6664.
- L. Iess et al., "Gravity field, shape, and moment of inertia of Titan",
  *Science* 327 (2010) 1367-1369, doi:10.1126/science.1182583.
- L. Iess et al., "The tides of Titan", *Science* 337 (2012) 457-459,
  doi:10.1126/science.1219631.
- The JUICE geophysics review in *Space Science Reviews* (2026),
  doi:10.1007/s11214-026-01293-8, for its table of the Galilean moons'
  fields.

- H. Yoshida, "Construction of higher order symplectic integrators",
  *Physics Letters A* 150 (1990) 262-268.
- E. Hairer, C. Lubich, G. Wanner, *Geometric Numerical Integration*, 2nd ed.
  (Springer, 2006): leapfrog, composition methods, energy behaviour.
- Laplace's sphere of influence: Curtis, 4th ed., Section 8.4.
- The asteroids' GMs: NAIF `gm_de440.tpc` (from `gm_Horizons.pck`, J.
  Giorgini, SSD/JPL, 2022), source 3, "SB441-N16 small-body integration
  perturber file (DE441 masses)".
- Their positions: JPL's SB441 ephemerides,
  [ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/](https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/),
  documented in JPL IOM 392R-21-005 (D. Farnocchia, 2021).
- JPL SSD, "Horizons" announcement of 2021 April 12: the switch to DE440/441
  and the sixteen most massive small-body perturbers,
  [ssd.jpl.nasa.gov/announcements/an20210412a.html](https://ssd.jpl.nasa.gov/announcements/an20210412a.html).
