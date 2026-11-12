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

The Sun's disc is drawn at its true surface brightness relative to a white
surface lit face-on at 1 AU:

$$
\frac{L_\odot}{L_\text{white}} = \frac{E/\Omega_\odot}{E/\pi}
= \left(\frac{1\ \text{AU}}{R_\odot}\right)^2 \approx 46\,000,
$$

which saturates to white through the ACES tone curve at any sensible
exposure, as a real photograph of it does.

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
brightness, so near-black at a daylight exposure), atmospheres and their
scattering. Surface maps, relief and night lights are in
[textures](textures.md).
