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

The scene renders linear light into a half-float target, multisampled 4×
where a CSS pixel is under 1.5 device pixels (`post.ts`). Bloom runs on that
light, and one final pass to the screen mixes in the bloom, adds the Sun's
glare, multiplies by the exposure, applies the tone curve and encodes sRGB.
No material tone-maps on its own any more. Everything after the scene is
that one full-screen pass: with three.js's own HDR output the bloom's mix,
the glare and the tone curve took three, about 19 ms of a 43 ms frame on the
Intel iGPU at 2680 × 2032 ([performance](../performance.md#rendering)).

The curve is Khronos PBR Neutral as three.js r187 implements it: every
channel first loses a small offset, 0.04, or for the darkest channel x
under 0.08 the amount x − 6.25x² (so a near-black x shows as 6.25x²);
below the knee at about 0.76 nothing else changes, so lit planets keep
their albedo colours, and highlights roll off to white without the hue
shifts of ACES. The quadratic toe darkens faint display-level light (the
Milky Way, stars fainter than about V 6) well below its linear value; their
gains were set by eye under this curve. Its exposure at 1 AU is 1.2,
which matches the previous ACES look on a lit planet (a scene value of 0.5
shows as 0.56 in both). `?tone=agx` or `?tone=aces` switch curves for
comparison.

Drawings that are not light (orbit and craft lines, the star background,
city lights) are written at a display level divided by the exposure, so
they look the same at any distance from the Sun.

## The Sun

The Sun's disc is a sphere of the Sun's true radius, so it is drawn at its
true angular size from anywhere, and at its true mean surface brightness
relative to a white surface lit face-on at 1 AU:

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

- **The Sun's glare** (`sun.ts`, evaluated in the final pass) is a
  camera's, not an eye's. Its point-spread function, relative to a white
  surface under the same sunlight, is
  $G(\theta) = A/\theta^2 + B/\theta$ with θ in degrees, A = 0.15 and
  B = 0.005: the inverse-square fall-off of scatter from polished lens
  surfaces (Harvey's model) and a faint wide tail. At the exposure for the
  camera's own sunlight it is white out to about 0.4°, 10 % of white at
  1.2° and 1 % at 4°, and it scatters about 0.1 % of the Sun's light. Close
  to the Sun the disc is no point: the A term averaged over a disc of
  angular radius r is $A \ln(\theta^2/(\theta^2 - r^2))/r^2$ at θ from its
  centre, so the halo follows the limb. Faint radial needles (an eye's
  ciliary corona, kept as the sky's one honest animation of light) drift
  slowly within about 10°.

  The glare's strength is the sunlight at the camera divided by the
  exposure. Beyond 0.2 AU the exposure follows the distance, so the ratio
  is fixed and the glare keeps one apparent size as you zoom: at 10 AU the
  Sun is the same small white core and halo as at 1 AU, which is what an
  auto-exposed camera records, and its true disc shows through from about
  0.3 AU in. Inside 0.2 AU the exposure is held, so the glare grows with
  the light, (0.2 AU/d)², as a fixed exposure's would. The glare is scaled
  by the fraction of the Sun's disc that no body hides (the disc overlap
  below), so a planet in front of the Sun takes it away.

  It used to be the CIE's disability glare for a young eye at 3 %
  ($\pi (10/\theta^3 + 5/\theta^2 + 0.05/\theta)$ of white): its
  $\theta^{-3}$ core stayed white out to 1.3°, so from 0.3 AU outward the Sun
  was the same 2.6°-wide white blob, its disc hidden inside.
- **Bloom** (`post.ts`) scatters 2 % of all light: Jimenez's chain (a
  13-tap downsample through five levels starting at half resolution, or a
  quarter on 2× screens where that is still a CSS pixel, Karis's average on
  the first so no lone pixel flickers, a tent upsample adding each level
  into the one above) with no threshold, mixed rather than added, so the
  image keeps its energy. What enters it is capped at 20 times display
  white: a lit limb or a bright star blooms, but the Sun's disc, whose
  scatter is the glare above, does not (and half floats overflow past
  65,504).

## Stars

The sky is drawn as an eye adapted to the dark would see it, at a display
level that does not follow the exposure (a camera exposed for sunlit
surfaces would record no stars at all). It has two layers
([textures](textures.md#stars)):

- **The light between the stars**: the Milky Way, the Magellanic Clouds
  and every star too faint to pick out, an 8192 × 4096 map (refined to
  16384 × 8192 on tall canvases; [textures](textures.md#loading-the-sky))
  looked up by each view direction's right ascension and declination, at
  half of its own brightest light.
- **The stars**: the 83,392 Hipparcos stars to V 9, each a Gaussian of
  fixed width in device pixels (σ = 0.55 + 0.35 × the pixel ratio) centred
  on its true sub-pixel position, so its light is the same wherever it falls
  and it neither shimmers nor vanishes as the view turns. Its peak is
  30 × 10^(−0.4 V) of display white in the colour of its B−V, before the
  tone curve: magnitude 0 at 30 times white (it saturates and blooms a
  little), magnitude 3 at about 1.9 times, magnitude 5 at a third,
  magnitude 7 at 5 % (just visible on a dark screen after the curve's toe).
  Each sprite is only as wide as the star's light above 1/512 of white, so
  the many faint stars cost few fragments; that cut falls at V 10.5 when
  dark-adapted, so every catalogue star (to V 9) is drawn until adaptation
  dims the sky below about a quarter. The width is held on screen when the
  adaptive render scale changes the canvas's pixels; below 0.8 of a canvas
  pixel it stays at 0.8 and the peak drops to keep the star's light. Stars do not twinkle
  in vacuum, so they don't here.

**Adaptation**, the sky's honest motion: faint stars and the Milky Way fade
when bright light is in view and come back in the dark. The light counted is
the Sun within 35° of the view's centre (weighted by how much of its disc
is visible, and tempered to a third: physically its disc in frame would
leave only the brightest stars, which is too bare for the overview) plus
twice each body's share of the view times its lit fraction; the
sky is scaled by 1 / (1 + 4 × that light), approached in 0.3 s toward light
and 2 s back toward the dark, roughly as eyes adapt. Flying past a sunlit
planet or turning toward the Sun therefore changes the sky as it would for
a person there.

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
than the Sun, and its moons). Each occluder is its triaxial ellipsoid,
worked in its frame scaled to a unit sphere ([scene](scene.md#shapes)),
where the following holds exactly. Seen from the point, the Sun is a disc of
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
