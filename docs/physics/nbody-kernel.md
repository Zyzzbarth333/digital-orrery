# The n-body spacecraft kernel

`src/physics/nbody.js` (the integrator), `src/physics/bodies.js` (the bodies),
`src/physics/kernelHost.js` and `kernel.worker.js` (running it in a Web
Worker).

A spacecraft is a test particle: it feels the Sun, the planets and the Moon,
but does not pull on them. Their positions come from the ephemeris, so they
move on their real paths throughout every step.

## Force model

Heliocentric (positions relative to the Sun's centre, J2000 equatorial):

$$
\ddot{\mathbf r} = -\mu_\odot\frac{\mathbf r}{r^3}
+ \sum_j \mu_j\left[\frac{\mathbf r_j - \mathbf r}{|\mathbf r_j - \mathbf r|^3} - \frac{\mathbf r_j}{r_j^3}\right] + \mathbf a_\text{thrust}
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

Not yet modelled: non-spherical gravity (zonal and tesseral harmonics),
solar radiation pressure, atmospheric drag, relativistic corrections, the
moons of the outer planets as separate bodies, and the asteroids.

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

## Events

Checked at the end of each step:

- **Impact**: closer to a body's centre than its radius, or closer than
  695,700 km to the Sun's. The advance stops there.
- **Primary change**: the innermost sphere of influence holding the craft, by
  Laplace's radius $r_\text{SOI} = d\,(\mu/\mu_\text{primary})^{2/5}$ ($d$ the
  body's distance from its primary; the Moon's is relative to Earth).
  Reported; the advance continues.

Known limit: the check is at step ends with no hysteresis, so a craft
skimming a boundary can switch back and forth.

## Body positions between ephemeris calls

Calling astronomy-engine at every force evaluation would be slow, so each
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
radius $a$ and mean motion $n$. Measured against direct astronomy-engine calls
over 30 days, the worst error is 21 m (`nbody.test.mjs` case 7), set by how
closely astronomy-engine's velocities match its own positions.

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

That is within 0.06 km in low orbit and 0.09 km in cruise in the browser.
During a close planetary pass at very high warp (100 days/s) the drawn
position can be off by about 11,000 km for a frame (the Moon moves too far for
a second-order term to follow); the physics itself is unaffected.

## Sources

- H. Yoshida, "Construction of higher order symplectic integrators",
  *Physics Letters A* 150 (1990) 262-268.
- E. Hairer, C. Lubich, G. Wanner, *Geometric Numerical Integration*, 2nd ed.
  (Springer, 2006): leapfrog, composition methods, energy behaviour.
- Laplace's sphere of influence: Curtis, 4th ed., Section 8.4.
