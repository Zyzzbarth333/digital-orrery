# Camera

How the view moves: an orbit camera about the focused body or craft, and
flights between them. Code: `src/scene/cameraRig.ts`, used by
`OrreryScene`. Research and sources: [UX research](../ux/research.md#4-camera-transitions).

## The orbit camera

The camera looks at a pivot and sits `dist` km from it, at an azimuth and
elevation in the ecliptic frame. Dragging turns it (0.005 rad per pixel; one pointer at a time, so a
second finger does not make the view jump);
the wheel zooms by e^(0.0015 Δy) per event and the distance eases to the
new value over about a quarter of a second, in log distance, so a zoom
reads as one motion rather than steps. The pivot is the target's live
position (a body from the ephemeris, a craft from the kernel) plus a
settling offset, described below.

### Close to the ground

Following a craft a kilometre or two up, turning the camera could swing
it below the ground. Inside a body its surface isn't drawn, because its
inside faces are culled, so the stars showed through. Each frame, a
camera inside any body's ellipsoid is moved straight out from the body's
centre to 5 m above the surface, still looking at its pivot
(`src/physics/surfaceClamp.js`; `surfaceClamp.test.mjs` checks this on the
WGS-84 Earth, at the pole as at the equator and with the body turned).

Above the ground, the bodies' 96 × 48 spheres were too coarse up close.
Each flat face sags below the true surface, up to 6.8 km on the Earth.
From a few kilometres up, the horizon showed gaps of sky between facets.
So within half a radius of a body's surface, a finely divided patch is
drawn over the sphere (`src/scene/surfacePatch.ts`):
- **Shape:** a polar grid centred under the camera, reaching 1.3 times
  the horizon's angle.
- **Spacing:** 96 rings, the first at 5 % of the height from the point
  below and the rest opening out geometrically, and 256 sectors.
- **Material:** the body's own, with the same ellipsoid, maps and
  lighting.

A chord's sag stays under 0.4 % of the camera's height:

| Height | Patch reaches | Worst sag |
| --- | --- | --- |
| 2 m | 0.06° | 1 cm |
| 1.6 km | 1.7° | 4 m |
| 100 km | 13° | 140 m |
| 3,000 km | 61° | 1.4 km |

The patch is rebuilt when the height changes by a tenth. Otherwise it is
only turned to follow the point below.

### Close to a craft

The camera follows a craft from as close as 50 m, and an Earth satellite
from 20 m. The near plane was a fixed kilometre, so everything nearer than
that was clipped: the craft's conic and trail stopped a kilometre short of
it, and a 3D model of the craft would not have been drawn at all. Each
frame the near plane is now a tenth of the camera's distance from its
pivot, between 1 m and 1 km (`fitNear` in `src/scene/OrreryScene.ts`).

Two other ways were weighed:
- **A fixed near plane of a metre.** It would do as well, because the
  logarithmic depth buffer's precision does not depend on the near plane
  ([Scene](scene.md#floating-origin)). But it changes every view, while the
  adaptive one leaves the near plane at 1 km for anything followed from
  beyond 10 km.
- **A second pass for the craft with its own near and far planes.** It
  would also give a 3D model its own depth precision. It costs a pass and
  a depth clear every frame, and lines in it would not be hidden by the
  Earth.

On the ground (above), the camera is 5 m up but its pivot, the craft, is
kilometres away, so the near plane stays at hundreds of metres. That is
no worse than before. The ground within it is clipped, as it was within
the kilometre.

The near plane alone did not bring the lines to the craft: their samples
and their float32 positions about the primary missed it by up to 500 m.
Close up, they are drawn relative to the craft
([Mission](mission.md#the-readout)).

In the scene's 24-bit depth buffer, the logarithmic depth resolves
$\Delta w \approx 2^{-24} \ln 2 \, \log_2(\text{far} + 1)\,(1 + w)$, with $w$
in render units: about 1.4 m anywhere within a few hundred kilometres. Lines don't write depth, so this
doesn't matter for them. A 3D model of the craft seen from 50 m would
need its own pass (the second way above) for parts closer together than
that.

## Flights

Choosing a body (the rail, a marker in the sky, the arrow keys) or a craft
flies the camera there instead of cutting.

![A flight from the inner solar system to the Earth: the view pulls back a little, crosses to the Earth's marker and closes in, slowing as it arrives](../clips/overview-to-earth.webp)

**The path** is van Wijk and Nuij's optimal zoom-and-pan path (2003). In
the space of (u, w), where u is how far the pivot has moved along the line
between the two targets and w is the width of the view (2 tan 22.5° times
the distance), the path that minimises perceived motion zooms out, crosses
and zooms in. With ρ = 1.42 (their users' preference) and
bᵢ = (w₁² − w₀² ± ρ⁴u₁²) / (2wᵢρ²u₁):

$$
r_i = -\operatorname{asinh} b_i, \qquad S = \frac{r_1 - r_0}{\rho},
$$

$$
u(s) = \frac{w_0}{\rho^2}\left(\cosh r_0 \tanh(\rho s + r_0) - \sinh r_0\right),
\qquad
w(s) = w_0 \frac{\cosh r_0}{\cosh(\rho s + r_0)} .
$$

The −asinh form is the paper's ln(√(b²+1) − b) written so that it stays
exact when b is large (a planet seen from across the solar system).

**Moving ends.** Both ends are read live every frame and the path is
recomputed from them, so the camera lands on a body that moved during the
flight, even at a year per second.

**Duration** grows with the path's length S: T = 0.5 + 0.17 S seconds,
clamped to 0.8–3 s. Some values:

| Flight | S | T |
| --- | --- | --- |
| Earth to the Moon | 5.0 | 1.35 s |
| Overview to Earth | 7.3 | 1.75 s |
| Earth to Saturn | 14.0 | 2.9 s |
| Earth to Neptune | 16.3 | 3.0 s |

The path parameter is eased in and out (cubic). On arrival the camera is
at the target's framing distance.

**Arrival distance.** The default frames a planet or moon at 8 radii
(at least 20,000 km) and the Sun at the overview, 1.6 × 10⁹ km. Once the
user zooms, the distance is remembered in the target's radii (1.6 to 80)
and carried to the next body, so a close look at Mars stays a close look
at Jupiter; the Sun's view and the distance to a craft are remembered
separately. Choosing the body already in view reframes it at the default.

## Control during a flight

- **Another choice** starts a new path from wherever the camera is, eased
  out only (it is already moving), so the motion does not restart from
  rest.
- **A drag, a scroll or Escape** ends the flight on the spot. The target
  becomes the new body; the aim, which was between the two, settles onto it
  through a critically damped spring (ω = 7 rad/s, no overshoot, about
  0.6 s), while the user's drag or zoom applies at once. Stopped while still
  closer than 1.2 times the new body's largest semi-axis (early in a flight toward
  something bigger), the zoom eases back out to that distance, so the
  camera never ends inside a body.
- **Choosing the body a flight is already heading for** changes nothing.
- **A body with no position yet** (a link's `?focus=` before the first
  frame) is reached by a cut.
- **Reduced motion** (`prefers-reduced-motion: reduce`): a flight is a cut.

## Maps on the way

A flight starts loading the target's surface maps at once. They are decoded
in a worker and uploaded 4 MB per frame
([textures](textures.md#loading)), so they are usually ready on arrival
and the flight never stalls.
