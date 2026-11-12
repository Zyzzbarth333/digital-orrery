# Lambert's problem

`src/physics/orbital.js`: `lambert(r1, r2, tof, mu, prograde)`.

Given two position vectors and the time of flight between them, find the
conic (and the velocities at each end) that connects them. Zero-revolution
only.

## Universal-variable form

After Curtis (4th ed., Algorithm 5.2). Let $r_1 = |\mathbf r_1|$,
$r_2 = |\mathbf r_2|$ and $\Delta\theta$ the transfer angle, taken in
$(0, 2\pi)$ in the direction of motion: for a prograde transfer
$\Delta\theta = \arccos(\hat{\mathbf r}_1\cdot\hat{\mathbf r}_2)$ if
$(\mathbf r_1\times\mathbf r_2)_z \ge 0$ and $2\pi - \arccos(\cdot)$ otherwise
(retrograde the other way round). Define

$$
A = \sin\Delta\theta\,\sqrt{\frac{r_1 r_2}{1-\cos\Delta\theta}},\qquad
y(z) = r_1 + r_2 + A\,\frac{zS(z)-1}{\sqrt{C(z)}} ,
$$

with the Stumpff functions $C$, $S$ of [two-body propagation](two-body.md).
The time of flight as a function of $z$ is

$$
\sqrt\mu\,t(z) = \Bigl(\frac{y}{C}\Bigr)^{3/2} S + A\sqrt y ,
$$

and the solution is the root of $F(z) = \sqrt\mu\,(t(z) - \Delta t)$. With
$y$ at that root, the Lagrange coefficients and velocities are

$$
f = 1 - \frac{y}{r_1},\qquad g = A\sqrt{\frac{y}{\mu}},\qquad \dot g = 1 - \frac{y}{r_2},
$$

$$
\mathbf v_1 = \frac{\mathbf r_2 - f\,\mathbf r_1}{g},\qquad
\mathbf v_2 = \frac{\dot g\,\mathbf r_2 - \mathbf r_1}{g}.
$$

$z > 0$ is an ellipse, $z < 0$ a hyperbola.

## Solving $F(z) = 0$ reliably

The zero-revolution branch lies in $z \in (-\infty, 4\pi^2)$, and
$t(z) \to \infty$ as $z \to 4\pi^2$.

- **Transfer angle under 180°** ($A > 0$): $t(z)$ increases with $z$, but
  $y(z) < 0$ (no real solution) below some $z$. The code treats $y < 0$ as
  "time of flight too short", i.e. $F < 0$.
- **Transfer angle over 180°** ($A < 0$): $y > r_1 + r_2$ throughout, but
  $t(z)$ has a **minimum** at negative $z$ and rises again below it, a branch
  with no physical meaning.

Curtis's version searches upward from $z = -100$ for a sign change and then
runs Newton. The port this project started from instead began Newton at
$z = 0$ with no bracket; on an Earth to Mars grid (14,240 cells) 1,047 cells
came back NaN and 1,910 silently missed Mars, nearly all with transfer angles
over 180°. The code now:

1. evaluates $F(0)$ (the parabolic time of flight);
2. if $F(0) < 0$, the root is elliptic, in $(0, 4\pi^2)$. The upper bound
   approaches $4\pi^2$ in steps ($4\pi^2 - \tfrac12 4\pi^2 10^{-k}$) rather than
   sitting on it, because there $C(z)$ cancels to 0 and, for $A < 0$, $F$
   evaluates to $\infty - \infty$;
3. if $F(0) > 0$, it steps down in $z$ by doubling; when $dF/dz \le 0$ it has
   passed the minimum of $t$, finds the minimum by bisection on $dF/dz$, and
   if $F$ is still positive there the time of flight is shorter than any
   zero-revolution long-way transfer allows (returns `null`);
4. solves within the bracket by Newton steps with a bisection fallback,
   stopping at $|F| < 10^{-13}$ (relative to $\sqrt\mu\Delta t$) or a bracket
   of $10^{-15}|z|$.

It returns `null` for degenerate geometry (transfer angle within 10⁻⁸ rad of
0 or 180°, where the transfer plane is undefined), a non-positive time of
flight, or no convergence, so callers such as the porkchop grid get "no
transfer" rather than NaN or a wrong arc.

The derivative used in Newton's steps:

$$
\frac{dF}{dz} = \Bigl(\frac{y}{C}\Bigr)^{3/2}\Bigl[\frac{1}{2z}\Bigl(C - \frac{3S}{2C}\Bigr) + \frac{3S^2}{4C}\Bigr]
+ \frac{A}{8}\Bigl[\frac{3S}{C}\sqrt y + A\sqrt{\frac{C}{y}}\Bigr]
\quad (z\ne0),
$$

$$
\frac{dF}{dz}\Big|_{z=0} = \frac{\sqrt2}{40}y(0)^{3/2} + \frac A8\Bigl[\sqrt{y(0)} + A\sqrt{\frac{1}{2y(0)}}\Bigr].
$$

## Validation

| Check | Result |
| --- | --- |
| Curtis Ex 5.2 | $\mathbf v_1$, $\mathbf v_2$ within 5×10⁻⁵ km/s of the book |
| Curtis Ex 5.3 (hyperbolic, $z = -0.17344$) | $\mathbf v_1$ within 10⁻³ km/s, $e = 1.05065$ |
| 920-cell Earth to Mars grid, 461 of them over 180° (`orbital.test.mjs` case 5) | every cell solved; every arc reaches $\mathbf r_2$ to within 5.5×10⁻⁹ when flown by an independent adaptive RK4 |
| 14,240-cell grid (development probe) | 0 NaN, 0 wrong endpoints (previously 21 % bad) |
| 200,000 random round trips through `propagate` (independent review) | no `null`, no error above 10⁻⁶ |
| the real MSL transfer on DE442 states | converges, reaches Mars to 2×10⁻¹¹; 253.6 d Type I, C3 = 10.69 km²/s² |

## Limits

Zero-revolution only. A multi-revolution solver (Izzo, from the MIT-licensed
boinor/poliastro implementation, with attribution) is planned, keeping this
one as a cross-check.

## Sources

- H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed.:
  Algorithm 5.2, Appendix D.25, Examples 5.2-5.3.
- D. Izzo, "Revisiting Lambert's problem", *Celestial Mechanics and Dynamical
  Astronomy* 121 (2015) (planned multi-revolution solver).
