# Lighting

How sunlight is drawn: a camera's view of real illumination, not a stage
light. Code: `src/scene/bodyMaterial.ts` (the shader) and
`OrreryScene.updateLighting`.

## Sunlight and exposure

The Sun is the only light. A surface at distance $d$ from it receives

$$
E(d) = E_{1\,\text{AU}} \left(\frac{1\ \text{AU}}{d}\right)^2 ,
$$

so Jupiter (5.2 AU) gets 1/27 and Neptune (30 AU) 1/900 of the light at
Earth. There is no ambient light: night sides are black, as they are to a
camera exposed for daylight. (Earthshine on the Moon, about $10^{-4}$ of
sunlight, is not drawn.)

A camera on a spacecraft sets its exposure for the light where it is. The
scene does the same: exposure is proportional to $d_\text{cam}^2$, the
squared distance from the camera to the Sun (no closer than 0.2 AU), so a
planet looks properly exposed when you are near it, and the planets keep
their true relative brightness when you look at several from one place.

## Exposure and tone mapping

The scene renders linear light into a half-float target (three.js's HDR
output: `outputBufferType: HalfFloatType`), multisampled 4× where a CSS
pixel is under 1.5 device pixels. Bloom runs on that light, and one final
pass multiplies by the exposure, applies the tone curve and encodes sRGB.
No material tone-maps on its own any more.

The curve is Khronos PBR Neutral: colours below its knee (about 0.76) are
left as they are, so planets keep their albedo colours, and highlights roll
off to white without the hue shifts of ACES. Its exposure at 1 AU is 1.2,
which matches the previous ACES look on a lit planet (a scene value of 0.5
shows as 0.56 in both). `?tone=agx` or `?tone=aces` switch curves for
comparison.

Drawings that are not light (orbit and craft lines, the star background,
city lights) are written at a display level divided by the exposure, so
they look the same at any distance from the Sun.

## The Sun

The Sun's disc is drawn at its true mean surface brightness relative to a
white surface lit face-on at 1 AU:

$$
\frac{L_\odot}{L_\text{white}} = \frac{E/\Omega_\odot}{E/\pi}
= \left(\frac{1\ \text{AU}}{R_\odot}\right)^2 \approx 46\,000,
$$

which saturates to white at any sensible exposure, as a real photograph of
it does. Its colour is the Sun's chromaticity, CIE xy (0.3233, 0.3326)
(about 5,772 K), which is linear sRGB (1.097, 0.977, 0.943) at luminance 1.
It is limb-darkened with the quadratic law at 550 nm,
I(μ)/I(1) = 0.3 + 0.93μ − 0.23μ², whose disc average is 0.805, so the
centre is drawn 1/0.805 brighter and the total light is unchanged. Blue
darkens more toward the limb than red; the colour of the limb is an
approximation (the channel exponents 0.8, 1, 1.25 are not fitted to Neckel
and Labs).

Granulation and the corona are not drawn: at an exposure for sunlit
surfaces the disc is pure white, so granulation cannot show, and the
corona (about 10⁻⁶ of the disc) would be lost in the glare.

## Glare and bloom

Light scatters in any eye or lens. Two parts, both before the tone curve:

- **The Sun's glare** (`sun.ts`) uses the CIE disability-glare function for
  a young eye, L/E = 10/θ³ + 5/θ² + 0.05/θ with θ in degrees. Relative to a
  white surface in the same sunlight (L = E/π) that is π times as much: an
  eye looking near the Sun sees a white veil a few degrees across. It is
  drawn at 3 % of that, closer to a good camera than an eye, with the fine
  radial needles of the eye's ciliary corona within about 10°, drifting
  slowly as a pupil does: the sky's one honest animation of light. The glare
  is scaled by the fraction of the Sun's disc that no body hides (the disc
  overlap below), so a planet in front of the Sun takes it away.
- **Bloom** (`bloom.ts`) scatters 2 % of all light: Jimenez's chain (a
  13-tap downsample through six half-resolution levels, Karis's average on
  the first so no lone pixel flickers, a tent upsample adding each level
  into the one above) with no threshold, mixed rather than added, so the
  image keeps its energy. What enters it is capped at 20 times display
  white: a lit limb or a bright star blooms, but the Sun's disc, whose
  scatter is the glare above, does not (and half floats overflow past
  65,504).

## Surface reflectance

Each body reflects its **geometric albedo** $p$, the brightness of the
full disc at zero phase relative to a flat white disc, from the NASA NSSDCA
planetary fact sheets (Mercury 0.142, Venus 0.689, Earth 0.434, Moon 0.12,
Mars 0.170, Jupiter 0.538, Saturn 0.499, Uranus 0.488, Neptune 0.442,
Pluto 0.52). The colour in the catalogue sets only the hue, scaled to that
luminance.

With $\mu_0 = \cos i$ (incidence) and $\mu = \cos e$ (emission), two
scattering laws are used, each scaled to 1 when lit and seen face-on:

| Surface | Law | Brightness | Surface reflectance |
| --- | --- | --- | --- |
| Atmospheres, ices (Venus, Earth, Mars, giants) | Lambert | $A\,\mu_0$ | $A = 1.5\,p$ |
| Bare regolith (Mercury, Moon, Pluto) | Lommel-Seeliger | $A\,\dfrac{2\mu_0}{\mu_0 + \mu}$ | $A = p$ |

A Lambert sphere's full disc averages 2/3 of its centre, hence $1.5p$. A
Lommel-Seeliger disc at full phase is uniform, which is why the full Moon
looks flat and has no darkened limb.

## Eclipses

Every surface point checks the bodies that can shadow it (its parent other
than the Sun, and its moons). Seen from the point, the Sun is a disc of
angular radius $a = \arcsin(R_\odot/d_\odot)$, the occluder a disc of
$b = \arcsin(R/d)$, and their centres are $c$ apart, computed as
$\operatorname{atan2}(|\hat u \times \hat s|,\ \hat u \cdot \hat s)$ to keep
precision at a fraction of a degree. The light reaching the point is the
visible fraction of the Sun's disc:

$$
f = \begin{cases}
1 & c \ge a + b \\
0 & c \le b - a \quad \text{(umbra)} \\
1 - b^2/a^2 & c \le a - b \quad \text{(annular)} \\
1 - \dfrac{A_\text{lens}}{\pi a^2} & \text{otherwise (penumbra)}
\end{cases}
$$

$$
A_\text{lens} = a^2 \cos^{-1}\!\frac{c^2 + a^2 - b^2}{2ca}
+ b^2 \cos^{-1}\!\frac{c^2 + b^2 - a^2}{2cb}
- \tfrac12\sqrt{(-c+a+b)(c+a-b)(c-a+b)(c+a+b)} .
$$

This is the flat-disc overlap, accurate for angles this small; the Sun's limb
darkening is ignored. The umbra and penumbra therefore have their true
sizes and shapes. Checked visually at astronomy-engine's peak times for the
2026 eclipses: the total solar eclipse of 12 August (17:45:47 UTC, umbra on
the northern hemisphere) and the total lunar eclipse of 3 March (11:33:40
UTC, Moon fully in the umbra).

## Saturn's rings

The rings are a thin layer of particles in Saturn's equatorial plane, with
measured normal optical depth $\tau(r)$ ([textures](textures.md#saturns-rings)).
With $\mu_0$ and $\mu$ the cosines of the Sun's and the viewer's angles to
the ring normal, single scattering by such a layer (the classical
plane-parallel result) gives the reflectance

$$
\frac{I}{F} = A\,\frac{\mu_0}{\mu_0 + \mu}\left[1 - e^{-\tau(1/\mu_0 + 1/\mu)}\right]
\quad\text{(lit face)},
\qquad
\frac{I}{F} = A\,\frac{\mu_0}{\mu - \mu_0}\left[e^{-\tau/\mu} - e^{-\tau/\mu_0}\right]
\quad\text{(unlit face)},
$$

so the unlit face glows faintly by light passed through the layer, as it
does in Cassini images. What lies behind the rings shows through by
$e^{-\tau/\mu}$ along the line of sight, and the rings' shadow on Saturn
dims the sunlight by $e^{-\tau/\mu_0}$ where the ray to the Sun crosses the
ring plane. $A$ (single-scattering albedo times the phase factor) is 1, so
the opaque B ring has $I/F \approx 0.5$ face-on at low phase; the particles
are drawn a pale tan. Saturn's shadow on the rings uses the eclipse formula
above. Not modelled: the strong backscatter (opposition surge) and
multiple scattering in the dense rings.

Not modelled yet: sunlight refracted by Earth's atmosphere into its umbra
(the copper colour of a lunar eclipse, $10^{-4}$ to $10^{-6}$ of full Moon
brightness, so near-black at a daylight exposure). Earth's atmosphere is
in [atmospheres](atmospheres.md); surface maps, relief and night lights in
[textures](textures.md).
