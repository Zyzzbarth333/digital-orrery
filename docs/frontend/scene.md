# The 3D scene

How the front end draws the solar system at true scale and true positions.
Code: `src/scene/` (three.js, TypeScript) and `src/app/` (React panels).
Nothing in `src/physics/` depends on it.

## True scale, true positions

Every body is drawn at its real size and shape (below) and at its
ephemeris position for the sim time; nothing is enlarged or moved for visibility. At most zoom levels
that makes the planets far smaller than a pixel, so each body also carries an
HTML marker (a ring and its name) at its projected position. The ring hides
once the body's disc is wider than 4 px, and a moon's marker hides while it
sits within 14 px of its planet's, unless the moon is focused.

Positions come from `helioStateEcl` in `src/physics/ephemeris.js`, re-read
every frame:
- **Earth and the Moon:** DE442 itself, through a Chebyshev table, within a
  metre ([ephemerides](../physics/ephemerides-and-gm.md#de442-in-the-app)).
- **The other planets:** astronomy-engine, within 1×10⁻⁴ of each planet's
  distance from the Sun against DE442; see
  [validation](../validation.md#ephemeris-and-porkchop-porkchoptestmjs).
  These are system barycentres; Mars to Pluto are drawn at their own
  centres, offset by their moons' pull.
- **Twenty major moons** of Mars to Pluto: astronomy-engine's Galilean
  moons and JPL's mean elements, within 0.3 % of their orbits' radii for
  most; see [Moons](moons.md).

## Shapes

Each body is its IAU triaxial ellipsoid, from NAIF's pck00011 (`radiiKm` in
`catalogue.ts`, from `src/physics/pck.data.js`; table in
[orientation](../physics/orientation.md#shapes)). Every mesh is one unit
sphere with its poles on local $Z$, scaled to $(a, b, c)$ along local $X$,
$Y$, $Z$ and turned each frame to the body-fixed axes of
[orientation](../physics/orientation.md), so the semi-axes lie along the
body's prime meridian, 90° east of it and its pole. Saturn is 9.8 % flatter
at the poles than at the equator, Jupiter 6.5 %, and Phobos is
26 × 23 × 18 km with its long axis toward Mars.

![Saturn and Jupiter on main (spheres of the mean radius) and as their IAU
ellipsoids](shapes-saturn-jupiter.jpg)

What a non-uniform scale changes, and how each part handles it:
- **Shading** (`bodyMaterial.ts`): the normal is the inverse transpose of
  the model matrix times the sphere's, so the terminator and the
  Lommel-Seeliger and Lambert terms follow the flattened surface. Maps are
  still looked up by the planetocentric longitude and latitude of the
  surface point (the convention of the USGS and IAU maps), and a normal
  map's east-north-up slope is turned about the ellipsoid's own normal.
- **Eclipses:** an occluder is an ellipsoid. In its body frame scaled to a
  unit sphere (rows $X/a$, $Y/b$, $Z/c$) whether a line from a point to
  the Sun meets it is unchanged, so the disc-overlap formula of
  [lighting](lighting.md#eclipses) runs there with the occluder exactly a
  unit sphere; the Sun's disc, stretched by under the flattening, is taken
  as a disc of its radius times $(abc)^{-1/3}$. For a sphere this is the
  old formula exactly (`ELLIPSOID_SHADOW`). Saturn's shadow on its rings
  is worked the same way.
- **The rings' shadow on Saturn:** the ray to the Sun meets the equatorial
  plane whatever the surface's shape, so it is unchanged.
- **Earth's atmosphere** (`atmosphere.ts`): the shell is the ellipsoid
  scaled by $R_t/R_g$ and turned with the Earth. Its shader, and the
  sunlight reaching the ground, work in the body frame scaled so the
  ellipsoid is the sphere of the mean radius $R_g$ (`atmoShape`), and
  convert step lengths back to km; for the Earth that scale is within
  0.3 % of 1, so the scattering is unchanged and the air follows the
  surface instead of floating 14 km over the poles.
- **Camera:** the closest approach is 1.2 times the largest semi-axis
  (`maxRadiusKm`), so the camera never ends inside an equatorial bulge or
  Phobos's long end. Arrival and the remembered zoom stay in mean radii.
- **Markers and label occlusion** keep the sphere of the mean radius: a
  label is hidden behind a disc of that radius, off by under 7 % of the
  disc at the limb (Saturn's pole).

## Frame and units

The scene frame is heliocentric ecliptic J2000, with ecliptic north up on
screen (three.js is $y$-up); orbits and distances can be given about the
solar system barycentre instead ([Barycentres](barycentres.md)):

$$
(x, y, z)_\text{render} = \frac{1}{1000\ \text{km}}\,
\left(x,\ z,\ -y\right)_\text{ecliptic} - \text{camera}.
$$

One render unit is 1000 km. The ecliptic conversion from J2000 equatorial uses
the mean obliquity at J2000, 23.4392911° ([frames](../physics/frames-and-time.md)).

## Floating origin

A 32-bit GPU float has 24 bits of mantissa, so at Neptune's distance
($4.5\times10^9$ km) it cannot resolve anything under about 270 km, and an
Earth-sized sphere would visibly jitter. The scene therefore keeps every
position in 64-bit JavaScript numbers in kilometres, and before each frame
subtracts the camera's position from them. The camera sits at the render
origin, so whatever is near it (the focused body) is drawn with full
precision; whatever is far away has large coordinates, but its errors are
far below a pixel.

A logarithmic depth buffer covers the depth range, from a near plane of 1 km
(10⁻³ render units) to a far plane of $10^{10}$ render units, with no visible z-fighting.

## Camera

The camera orbits the focused body or craft: distance $d$ in km, azimuth and
elevation about ecliptic north. Dragging changes the angles (elevation
clamped to ±86°); scrolling scales $d$ by $e^{0.0015\,\Delta}$, eased over a
quarter second, and stops at 1.2 times the body's largest semi-axis. Selecting a body flies the
camera there on van Wijk and Nuij's zoom-and-pan path, interruptible and
redirectable, ending at 8 radii (at least 20,000 km), $1.6\times10^9$ km for
the Sun, or the zoom the user last chose in radii. See [Camera](camera.md).

## Orbit lines

Each orbit line is the body's real path for one orbital period, centred on
the sim time and relative to its parent (the Sun, or the planet for a moon),
sampled at 360 points from the same ephemeris. It is drawn at the parent's
current position. A line is resampled when the sim time moves more than 5% of
a period from its centre (at most every 0.5 s a line, and for at most 2 ms
a frame), so it always passes close to the body. Because it is the ephemeris path and not a Kepler ellipse, it
includes the perturbations the ephemeris has.

Up close, 360 points are not enough. Each chord spans a degree of the orbit
and bows up to $r(1 - \cos 0.5°)$ off the path: 5,700 km at 1 au, nearly
the Earth's radius. Seen from near the planet, the line was bent and missed
its centre. So the focused body's orbit, and its planet's when the focus is
a moon, has a fine stretch drawn over it:
- **Its extent:** 0.5 % of a period either side of the body, in 256 steps,
  each 0.014°.
- **Its precision:** the chords' bow is about a kilometre at 1 au, and the
  vertices are stored relative to the stretch's centre, so float32 keeps
  them to metres.
- **Upkeep:** the stretch is resampled when the body has moved a fifth of
  the way to its edge.
- **Joining the coarse line:** the coarse line skips the same span (a `gap`
  in `orbitTrail.ts`), and both share the trail's $u$, so the glow runs
  across the join unbroken.

Measured against the ephemeris (DE442 Earth table, 200 instants over 74
days), the Earth sat up to 5,682 km off its 360-point line, and sits within
1.1 km of the fine stretch.

The line is a faint outline of the whole orbit with a glowing trail behind
the body (`orbitTrail.ts`). Each vertex carries $u$, its time offset from the
line's centre in periods; each frame sets
$\text{now} = (t - t_\text{centre}) / P$. A point that the body passed
$\Delta = \text{now} - u \ge 0$ periods ago glows by $g = e^{-\Delta/\tau}$
with $\tau = 0.08$, and its opacity is $a = a_0 + (1 - a_0)\,g$ with the
outline at $a_0 = 0.3$. So the trail is brightest at the body, fades over
roughly the last tenth of an orbit, and the rest of the orbit stays outlined.
Points ahead of the body are outline only. The glow is additive and drawn at
a display level (divided by the exposure the HDR output applies), like the
other drawing aids. A spacecraft's flown path
uses the same shader, with $u$ its age along the trail (newest 0, oldest
$-1$), $\tau = 0.25$ and $a_0 = 0.12$.

## Labels

A label is hidden when its body is behind a nearer body's disc, and a moon's
label when it sits on its planet's marker. Names that would overprint keep
the focused body's first, then the larger body's; the smaller body keeps its
marker and shows its name on hover.

## Lighting

Sunlight falls off as $1/d^2$, the exposure is metered at the camera's
distance from the Sun, each body reflects its NASA geometric albedo, and
eclipses are computed from the overlap of the Sun's and the occluder's
discs. The scene renders in HDR and is tone-mapped once (Khronos PBR
Neutral), with bloom, the Sun's glare and point stars that adapt to bright
light. See [Lighting](lighting.md).

## Time

`SimClock` (`src/app/clock.ts`) holds the UTC time, a rate in sim seconds per
real second and a play state. The render loop advances it by the real frame
time (capped at 1 s, so a hidden tab does not jump). React panels subscribe
through `useSyncExternalStore` and re-render at most ten times a second;
the header and the body rail redraw only when a value they show changes
(`useClockValue`).
The URL can set the start state: `?focus=mars&t=2030-01-01T00:00Z`, and
`&view=sun` starts on the sunlit side of the focused body.

## No WebGL

If the browser cannot create a WebGL context, the panels still load and the
view shows a short message instead of the scene.
