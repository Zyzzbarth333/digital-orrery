# Burns, launches and the porkchop

## Finite burns

A burn is a segment of absolute time:
$\{t_0, t_1, \hat{\mathbf d}, F, m_0, \dot m\}$, on from $t_0$ to $t_1$ along
the unit vector $\hat{\mathbf d}$, thrust $F$ (N) on a craft of mass $m_0$
(kg) at $t_0$ losing propellant at $\dot m = F/v_e$ (kg/s), with $v_e$ the
exhaust velocity (m/s; $v_e = I_\text{sp}\,g_0$, $g_0 = 9.80665$ m/s²).

### Equations

$$
\mathbf a_\text{thrust}(t) = \frac{F}{m_0 - \dot m\,(t - t_0)}\,\hat{\mathbf d}\times10^{-3}\ \text{km/s}^2,\qquad t_0 \le t < t_1 .
$$

With no gravity this integrates to the rocket equation. With
$m_1 = m_0 - \dot m\,T$ and $T = t_1 - t_0$:

$$
\Delta v = v_e\ln\frac{m_0}{m_1},
$$

$$
x(T) = v_e\left[T\ln m_0 + \frac{(m_1\ln m_1 - m_1) - (m_0\ln m_0 - m_0)}{\dot m}\right]
$$

(the distance covered during the burn, from integrating
$v(\tau) = v_e\ln\bigl(m_0/(m_0 - \dot m\tau)\bigr)$), after which the craft
coasts at the new velocity. These are the exact answers the kernel is tested
against.

### How the kernel steps onto them

`advance()` takes **breakpoints**: times steps must end on exactly. Each burn
contributes its $t_0$ and $t_1$, so no step straddles an engine switching on
or off. The burn is on for a step when the step's **midpoint** lies in
$[t_0, t_1)$; the thrust itself is evaluated at each stage time, so the mass
falls smoothly through the step. After landing on a breakpoint the carried
acceleration is recomputed for the far side, where the burn has changed.

In cruise the gravity step rule would take a whole burn in one step. For a
burn that sheds a large share of the mass that is too curved for one
fourth-order step (the first test found it 1.5 % short of the rocket equation
when 44 % of the mass was burned). Each burn is therefore subdivided so the
mass falls by at most 1 % per step:

$$
n = \Bigl\lceil \frac{\ln(m_0/m_1)}{\ln 1.01} \Bigr\rceil \quad (\le 4000).
$$

A burn that would leave no mass is refused. Validation (`nbody.test.mjs`
case 11): a 60 s, 50 kN burn on 2000 kg inside one 10-day request matches the
rocket equation to 2.8×10⁻⁹ km/s and the burn-then-coast position to
2.4×10⁻³ km (that velocity error times ten days of coasting); splitting the
request mid-burn changes the result by 1.4×10⁻⁵ km.

### Manoeuvre nodes

A node's burn starts at the node's own time (even mid-frame), points from the
state carried forward to that time, and lasts

$$
T = \frac{m_0\left(1 - e^{-\Delta v/v_e}\right)}{\dot m}
$$

from the craft's actual mass, which is exactly the propellant
$m_0(1 - e^{-\Delta v/v_e})$ for the node's $\Delta v$. A node that the main
tank cannot deliver is refused before an ignition is spent. Validation: a
0.8 km/s node draws 415.816 kg, the rocket-equation figure, and ends in the
same state with 10-minute, one-hour or one-day frames.

## Launch: the departure hyperbola

A launch is given as $\mathbf v_\infty$, the velocity the craft should have
relative to the planet once it has escaped. The craft starts at the
**periapsis of the departure hyperbola** on a circular parking orbit of radius
$r_p$ (planet radius plus 200 km unless the planner sets it), at the launch
instant.

$$
e = 1 + \frac{r_p v_\infty^2}{\mu},\qquad
\theta_\infty = \arccos\Bigl(-\frac1e\Bigr),\qquad
v_p = \sqrt{v_\infty^2 + \frac{2\mu}{r_p}} .
$$

In the orbit plane (unit normal $\hat{\mathbf n}$), with $\hat{\mathbf p}$
towards periapsis and $\hat{\mathbf q}$ along the periapsis velocity, the
outgoing asymptote is
$\hat{\mathbf u} = \cos\theta_\infty\,\hat{\mathbf p} + \sin\theta_\infty\,\hat{\mathbf q}$.
Given $\hat{\mathbf u} = \mathbf v_\infty/v_\infty$ and
$\hat{\mathbf w} = \hat{\mathbf n}\times\hat{\mathbf u}$:

$$
\hat{\mathbf p} = \cos\theta_\infty\,\hat{\mathbf u} - \sin\theta_\infty\,\hat{\mathbf w},\qquad
\hat{\mathbf q} = \sin\theta_\infty\,\hat{\mathbf u} + \cos\theta_\infty\,\hat{\mathbf w},
$$

$$
\mathbf r = \mathbf r_\text{planet} + r_p\,\hat{\mathbf p},\qquad
\mathbf v = \mathbf v_\text{planet} + v_p\,\hat{\mathbf q}.
$$

The plane is free to rotate about $\hat{\mathbf u}$. The default is the one
closest to the planet's equator, $\hat{\mathbf n} \propto \hat{\mathbf k} - (\hat{\mathbf k}\cdot\hat{\mathbf u})\hat{\mathbf u}$,
whose inclination equals the declination of the asymptote: the usual
launch-window limit. Validation: periapsis to 10⁻⁶ km and true anomaly 0;
after 200 days of two-body motion the velocity is 1.3×10⁻⁵° from
$\mathbf v_\infty$; the inclination equals the declination.

For $v_\infty = 0$ (no asymptote) and bodies without GM the craft starts on a
radial line instead: at $R = \min(100\,R_\text{planet}, r_\text{SOI})$ along
$\hat{\mathbf u}$ with speed $\sqrt{v_\infty^2 + 2\mu/R}$.

## Porkchop grid

`src/physics/porkchop.js`. For each departure date and time of flight, the
Lambert arc between the two planets' heliocentric ecliptic states gives
$\mathbf v_1$ and $\mathbf v_2$; then

$$
\mathbf v_{\infty,\text{dep}} = \mathbf v_1 - \mathbf v_\text{dep planet},\qquad
C_3 = |\mathbf v_{\infty,\text{dep}}|^2,\qquad
\mathbf v_{\infty,\text{arr}} = \mathbf v_2 - \mathbf v_\text{arr planet},
$$

and the burns from and into circular orbits of radius $r$:

$$
\Delta v = \sqrt{v_\infty^2 + \frac{2\mu}{r}} - \sqrt{\frac{\mu}{r}} .
$$

A transfer is Type I if its angle is under 180° (the sign of
$(\mathbf r_1\times\mathbf r_2)_z$ in the ecliptic), Type II if over.
Validation: on the real MSL dates the grid's C3 agrees with the DE442 result
to 10⁻⁴; over the 2011 window all 11,011 cells solve and the minimum C3,
9.00 km²/s² on 8 November 2011, is inside the grid.

### Flying a plan

Execute Plan launches at the plan's departure date with the arc's exact
$\mathbf v_\infty$ on the departure hyperbola. Flown by the n-body kernel with
no correction burns, the 2026 minimum-ΔV Mars plan passes Mars at about
371,000 km on day 301 of 308. The Lambert arc assumes a start from Earth's
centre with only the Sun pulling; closing that gap needs targeting (a
differential corrector on $\mathbf v_\infty$), which is planned. No capture
burn is modelled yet.

## Sources

- The rocket equation: Curtis, 4th ed., Sections 13.3-13.4.
- Patched conics and planetary departure: Curtis, Sections 8.5-8.6;
  non-Hohmann interplanetary transfers (the basis of porkchop plots),
  Section 8.11.
