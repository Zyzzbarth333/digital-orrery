# Two-body propagation and orbital elements

`src/physics/orbital.js`: `propagate`, `rvToElements`, `elementsToRv`.

## Universal-variable propagation

Given a state $(\mathbf r_0, \mathbf v_0)$ about a body of parameter $\mu$,
find the state a time $\Delta t$ later. Working through classical elements and
mean anomaly fails at $e = 1$ (the parabola, where the mean motion is
undefined) and is ill-conditioned near it. Universal variables use one set of
equations for every conic.

### Quantities

$$
r_0 = |\mathbf r_0|,\qquad
v_{r0} = \frac{\mathbf r_0\cdot\mathbf v_0}{r_0},\qquad
\alpha = \frac{2}{r_0} - \frac{v_0^2}{\mu} = \frac1a
$$

$\alpha > 0$ for an ellipse, $= 0$ for a parabola and $< 0$ for a hyperbola.
The universal anomaly $\chi$ (units $\sqrt{\text{km}}$) parameterises the
motion, with $z = \alpha\chi^2$.

### Stumpff functions

$$
C(z) = \begin{cases}
\dfrac{1-\cos\sqrt z}{z} & z>0\\[4pt]
\dfrac{\cosh\sqrt{-z}-1}{-z} & z<0\\[4pt]
\tfrac12 & z=0
\end{cases}
\qquad
S(z) = \begin{cases}
\dfrac{\sqrt z-\sin\sqrt z}{(\sqrt z)^3} & z>0\\[4pt]
\dfrac{\sinh\sqrt{-z}-\sqrt{-z}}{(\sqrt{-z})^3} & z<0\\[4pt]
\tfrac16 & z=0
\end{cases}
$$

For $|z| < 10^{-6}$ the code uses the series $C \approx \tfrac12 - \tfrac{z}{24} + \tfrac{z^2}{720}$,
$S \approx \tfrac16 - \tfrac{z}{120} + \tfrac{z^2}{5040}$, which avoids the cancellation in the
closed forms near zero.

### The universal Kepler equation

$$
\sqrt\mu\,\Delta t = T(\chi) =
\frac{r_0 v_{r0}}{\sqrt\mu}\,\chi^2 C(z) + (1-\alpha r_0)\,\chi^3 S(z) + r_0\,\chi .
$$

Its derivative is the radius at $\chi$:

$$
\frac{dT}{d\chi} = r(\chi) =
\frac{r_0 v_{r0}}{\sqrt\mu}\,\chi\,\bigl(1 - zS(z)\bigr) + (1-\alpha r_0)\,\chi^2 C(z) + r_0 > 0 ,
$$

so $T$ increases monotonically with $\chi$ and the equation has exactly one
root. Curtis (4th ed., Algorithm 3.3) solves it by Newton's method from
$\chi_0 = \sqrt\mu\,|\alpha|\,\Delta t$.

**What the code does differently, and why.** For a hyperbola and a long
$\Delta t$, $T(\chi)$ grows exponentially and Curtis's starting guess can be
about 50 times the root (the 15 km/s perigee case below). Plain Newton then
creeps down the exponential one small step at a time. The code instead:

1. brackets the root $[\chi_\text{lo}, \chi_\text{hi}]$ by doubling from the
   starting guess (backwards for $\Delta t < 0$);
2. takes Newton steps, but bisects whenever a Newton step would leave the
   bracket or fails to halve it;
3. maps overflow (deep hyperbolas, $\sqrt{-z} > 710$) to $\pm\infty$ in the
   direction of $\chi$, keeping $T$ monotonic;
4. stops when $|T - \sqrt\mu\Delta t| \le 10^{-14}\max(\sqrt\mu|\Delta t|, r_0|\chi|, 1)$
   or the bracket is $10^{-15}|\chi|$ wide, and returns `null` if it never
   converges.

For an ellipse, whole periods are removed first,
$\Delta t \leftarrow \Delta t - T\,\text{round}(\Delta t/T)$ with
$T = 2\pi/(\sqrt\mu\,\alpha^{3/2})$, so many-revolution propagation keeps
full precision.

### Lagrange coefficients

With $\chi$ found and $z = \alpha\chi^2$:

$$
f = 1 - \frac{\chi^2}{r_0}C,\qquad
g = \Delta t - \frac{\chi^3}{\sqrt\mu}S,\qquad
\mathbf r = f\,\mathbf r_0 + g\,\mathbf v_0,
$$

$$
\dot f = \frac{\sqrt\mu}{r\,r_0}\bigl(\alpha\chi^3 S - \chi\bigr),\qquad
\dot g = 1 - \frac{\chi^2}{r}C,\qquad
\mathbf v = \dot f\,\mathbf r_0 + \dot g\,\mathbf v_0 .
$$

### Validation

| Check | Result |
| --- | --- |
| against NAIF `prop2b_c` (64 cases, `orbital.test.mjs` case 7) | elliptic 2×10⁻¹⁴, hyperbolic 4×10⁻¹⁵, near-parabolic (0.99 ≤ e ≤ 1.01, through periapsis) 2.4×10⁻¹³ relative |
| Curtis Ex 3.4, exact parabola, 6 h | $r$ = 86,976.6 km, $\theta$ = 144.754° (the full-precision values) |
| Curtis Ex 3.5, hyperbola from θ = 100° for 3 h | $r$ = 163,180.5 km, θ = 107.780°, $v_r$ equals $(\mu/h)\,e\sin\theta$ to 10⁻⁹ |
| Curtis Ex 3.6, 3.7 | θ = 100.040°; $\mathbf r$ within 1.5 km of the printed values (the book rounds $f, g$) |
| parabola with $e$ rounding to 0.9999999999999998 | matches an independent RK4 run to 6×10⁻¹² (the old element-based code returned a wrong state) |
| hyperbola from perigee, $\Delta t$ up to 10⁸ s | energy conserved to 2×10⁻¹⁵, angular momentum to 2×10⁻¹¹ |
| 1000.25 periods against an independent RK4 over 0.25 | 3×10⁻⁸ km |

## State vector to classical elements

`rvToElements` (after Curtis, Algorithm 4.2): angular momentum
$\mathbf h = \mathbf r\times\mathbf v$, node vector $\mathbf n = \hat{\mathbf k}\times\mathbf h$,
eccentricity vector

$$
\mathbf e = \frac{1}{\mu}\Bigl[\Bigl(v^2 - \frac{\mu}{r}\Bigr)\mathbf r - (\mathbf r\cdot\mathbf v)\,\mathbf v\Bigr],
$$

then $i = \arccos(h_z/h)$, $\Omega$ from $\mathbf n$, $\omega$ from
$\mathbf n\cdot\mathbf e$, $\theta$ from $\mathbf e\cdot\mathbf r$, and
$a = 1/(2/r - v^2/\mu)$. Quadrants come from the signs of $n_y$, $e_z$ and
$v_r$. Degenerate cases use the standard substitutes: for an equatorial orbit
$\Omega = 0$ and $\omega$ is the longitude of periapsis; for a circular
inclined orbit $\theta$ is the argument of latitude; for a circular equatorial
orbit, the true longitude.

Validated against NAIF `oscltx_c` on the fixture cases ($e$ to 2×10⁻¹⁵,
angles to 10⁻¹²°) and against Curtis Ex 4.3 and 4.7.

`OrbitalMechanics.calculateOrbitalElements` (used by the app) converts the
scene state to ecliptic km and calls `rvToElements`, so inclinations are from
the ecliptic. The previous implementation mixed AU and km in $\mathbf h$, which
made $(\mathbf v\times\mathbf h)/\mu$ about 1.5×10⁸ too small and every orbit
read $e \approx 1$. For a parabola ($a = \infty$) periapsis comes from
$h^2/\bigl(\mu(1+e)\bigr)$; for a radial orbit ($h = 0$) the inclination is
reported as 0.

## Sources

- H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed.
  (Elsevier, 2020): Algorithms 3.3, 3.4, 4.2, 4.5; Examples 3.4-3.7, 4.3,
  4.7.
- NAIF CSPICE `prop2b_c`, `oscltx_c`, `conics_c` (the fixture).
