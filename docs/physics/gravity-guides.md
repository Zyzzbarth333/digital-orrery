# Gravity guides

Drawing aids that show how gravity works in the scene: each body's spin
axis, its real gravity field, its sphere of influence and Hill sphere, the
Lagrange points, and the strongest pulls on a body. Each has its own switch
in the rail's **Guides** section and is off until switched on. Code:
`src/physics/gravityGuides.js` (the physics, tested in
`gravityGuides.test.mjs`), `src/scene/guides.ts` and `gravityField.ts` (the
drawing).

All of them are drawn at a display level, divided by the exposure like the
orbit lines ([lighting](../frontend/lighting.md#exposure-and-tone-mapping)),
so they read the same at any distance from the Sun.

## Spin axes

A faint grey line through each body's poles, 1.5 radii from its centre each
way, the north half brighter and tagged **N** once the disc is more than 12
pixels across. The axis is the body-fixed Z of [body orientation](orientation.md):
the IAU pole for the Sun and planets (Archinal et al.), Earth's of date from
precession and nutation, and the synchronous moons' own. "North" is the
IAU's, so Venus, whose prime meridian angle decreases, turns backwards
about it.

## Gravity fields

The free-air gravity anomaly on the surface, from the same coefficients the
kernel flies with, as a diverging colour map (blue low, amber high) with a
contour every half of the scale's end and a legend giving the unit, the
range and the source:

| Body | Field | Shown |
| --- | --- | --- |
| Earth | EGM2008 to degree and order 70 (Pavlis et al. 2012) | Less the WGS 84 ellipsoid's normal field (its even zonals to degree 10, NIMA TR8350.2), so what remains is the geology: −106 to +135 mGal at this degree |
| Moon | GRAIL GL0660B to degree and order 100 (Konopliv et al. 2013) | About a sphere: the mascons of the nearside maria stand out (Serenitatis +274 mGal, Imbrium +240) |
| Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune | J2 only (sources in `bodies.js`) | The oblateness alone, said so in the legend: the app holds no fuller field for them |

On a sphere of the reference radius $R$, in the spherical approximation,

$$
\Delta g(\varphi, \lambda) = \frac{GM}{R^2} \sum_{n=2}^{N} (n - 1)
\sum_{m=0}^{n} \bar P_{nm}(\sin\varphi)\,
\left(\Delta\bar C_{nm} \cos m\lambda + \bar S_{nm} \sin m\lambda\right),
$$

with $\Delta\bar C_{n0}$ the coefficient less the normal field's (Earth
only) and $\bar P_{nm}$ the fully normalised Legendre functions by the
standard forward recursions (Holmes and Featherstone 2002). The sum is split
per latitude row, $A_m = \sum_n (n - 1) \bar P_{nm} \bar C_{nm}$, so a row
costs $N^2 + N \times$ columns instead of $N^2 \times$ columns. The Moon's
720 × 361 map still takes about a quarter of a second, so the maps are
worked out in a worker (`gravityField.worker.ts`) the first time each is
wanted, and the coefficient files load there only then. Degree 70 resolves about
290 km on Earth ($\pi R / N$), degree 100 about 55 km on the Moon.

Units are mGal (10⁻⁵ m/s²), or Gal (cm/s²) where the anomalies pass
5,000 mGal: Jupiter's J2 alone gives +18 Gal at the equator and −36 Gal at
the poles. GRAIL's coefficients are in the Moon's principal-axis frame and
the app draws the Moon in the mean-Earth frame; the two differ by about
0.02°, a tenth of a map cell, so the map is not rotated.

**Check.** With $(n + 1)$ in place of $(n - 1)$ the same sum is the radial
pull of the harmonics (the gravity disturbance). `gravityGuides.test.mjs`
compares it with the kernel's own acceleration (`geopotential.js`,
Cunningham's recursion, a different method) on EGM2008 to degree 30 at five
places, with and without C₂₀: they agree to 10⁻¹¹ mGal. The test also checks
that Earth's anomaly averages to zero, that Tibet stands high and Hudson
Bay low, and that GRAIL's Imbrium and Serenitatis mascons are strongly
positive.

## Spheres of influence and Hill spheres

For every body that orbits another, about its parent, from its osculating
orbit (semi-major axis $a$, eccentricity $e$, from its state relative to the
parent this frame) and the two GMs ($m$, $M$):

- **Sphere of influence** (Laplace; Curtis, *Orbital Mechanics for
  Engineering Students*, "Sphere of influence"), a solid amber ring:
  $r_\text{SOI} = a\,(m/M)^{2/5}$. Inside it the body's pull, taken as a
  perturbation of the parent's, matters more than the parent's taken as a
  perturbation of the body's: where patched conics switch from one to the
  other.
- **Hill sphere** (Hamilton and Burns 1992), a dashed pale-green ring:
  $r_H = a(1 - e)\,(m/3M)^{1/3}$, at pericentre. Where the body can hold a
  satellite against the parent's tide; to first order the distance to its
  L1 and L2.

Each is drawn as a sphere's outline about 1.5 pixels wide where the surface
turns edge-on, brighter for the focused body and its moons; rings under 8
pixels across, or ones the camera is inside, are not drawn. The focused
body's radii are tagged at the top of each ring.

| Checked against | Value | Here |
| --- | --- | --- |
| Earth's SOI, Curtis's masses | 925 × 10³ km | 924.7 × 10³ km |
| Moon's SOI about Earth | 66.1 × 10³ km | 66.2 × 10³ km |
| Jupiter's SOI | 48.2 × 10⁶ km | 48.22 × 10⁶ km |
| Earth's Hill radius | 1.47 million km | 1.4714 million km |

The planets' GMs are their systems' (planet and moons, DE442), as the
barycentres they orbit by carry.

## Lagrange points

The five equilibrium points of the circular restricted three-body problem
for a pair with mass ratio $\mu = m_2/(m_1 + m_2)$. In units of the pair's
separation, from the barycentre (primary at $-\mu$), the collinear points
are the roots of

$$
x - \frac{(1 - \mu)(x + \mu)}{|x + \mu|^3} - \frac{\mu (x - 1 + \mu)}{|x - 1 + \mu|^3} = 0,
$$

solved by Newton's method from $1 - \mu \mp (\mu/3)^{1/3}$ (L1, L2) and
$-1 - 5\mu/12$ (L3) (Szebehely 1967); L4 and L5 make equilateral triangles
with the pair, L4 leading. They are placed at the pair's present separation
and in its present orbital plane (from the secondary's position and
velocity relative to the primary), so they move with the bodies, and they
are exact only for a circular orbit. Drawn for Sun–Earth, Earth–Moon and
Sun–Jupiter, and for the focused body with its parent; a marker within 14
pixels of its secondary on screen is not drawn (Sun–Earth L1 and L2 are
1.5 million km from Earth, a pixel at the overview).

Checks: Earth–Moon with $\mu$ = 0.012150585609624 gives L1, L2, L3 at
0.836915, 1.155682 and −1.005063 (Koon, Lo, Marsden and Ross 2011, to the
six places they give): 326,381 km and 448,915 km from Earth at 384,400 km;
Sun–Earth L1 and L2 about 1.5 million km sunward and anti-sunward. With the
small bodies on, Jupiter's trojans sit around its L4 and L5.

## Strongest pulls

For the focused body, the four strongest gravitational accelerations on it
from the other bodies, $GM/d^2$, as faint amber lines to each puller with a
tag giving the acceleration (m/s², mm/s², µm/s² or nm/s²); the tag's title
gives the distance. On Earth: the Sun 6.06 mm/s², the Moon 29.8 µm/s²,
Venus and Jupiter a few tenths of a µm/s². On the Moon the Sun's pull
(6.06 mm/s²) is more than twice Earth's (2.42 mm/s²), which is why the
Moon's path about the Sun is everywhere concave toward the Sun. These are
the whole pulls, not the tides: what moves a body relative to its parent is
the difference of a pull across the pair, which the kernel integrates
([n-body kernel](nbody-kernel.md)).
