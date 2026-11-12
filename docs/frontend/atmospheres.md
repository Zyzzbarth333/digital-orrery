# Atmospheres

Earth's air drawn from its physics: sunlight scattered by molecules and
aerosols along each line of sight, and the same air reddening the sunlight
that reaches the ground. Code: `src/scene/atmosphere.ts` (the shell) and
`bodyMaterial.ts` (sunlight on the surface).

## The medium

Three constituents, each with a density that falls with altitude $h$:

| Constituent | Coefficient at the surface | Profile | Phase function |
| --- | --- | --- | --- |
| Molecules (Rayleigh) | scattering $\beta_R = 1.24062\times10^{-6}\,\lambda^{-4}$ m⁻¹ ($\lambda$ in µm): (5.802, 13.558, 33.1)×10⁻⁶ at 680, 550, 440 nm | $e^{-h/8\,\text{km}}$ | $\tfrac{3}{16\pi}(1 + \cos^2\theta)$ |
| Aerosols (Mie) | extinction $4.44\times10^{-6}$ m⁻¹, scattering 0.9 of it | $e^{-h/1.2\,\text{km}}$ | Cornette–Shanks, $g = 0.8$ |
| Ozone (absorption) | (0.650, 1.881, 0.085)×10⁻⁶ m⁻¹ at the peak | tent, 10–40 km, peak 25 km | — |

These are the reference values of Bruneton's precomputed atmospheric
scattering model (`demo.cc`). The ozone peak coefficients are Hillaire's
(2020) and have not yet been checked against the paper. The shell reaches
100 km.

## Sky light along a view ray

Each pixel of the shell around the planet marches its view ray from where
it enters the atmosphere (or from the camera, inside it) to where it leaves
or meets the ground, in 32 steps. At each point $\mathbf q$ the sunlight
scattered toward the camera is

$$
dL = T_v(\mathbf q)\,T_\odot(\mathbf q)\left[\beta_R\,\rho_R(h)\,P_R(\theta) + \beta_{M,s}\,\rho_M(h)\,P_M(\theta)\right] ds,
$$

where $T_v$ is the transmittance back to the camera (accumulated along the
march), $T_\odot$ the transmittance from $\mathbf q$ to the Sun (8 steps to
the top of the atmosphere, zero if the Earth is in the way), and $\theta$ the
angle between the view ray and the Sun. In the scene's units, where a white
surface lit face-on shows the irradiance, the sky adds $\pi L$ times the
irradiance. What lies behind the air is dimmed by the view ray's
transmittance (its luminance, since blending has one alpha). Even steps are
enough: along a grazing ray the altitude changes over about
$\sqrt{2RH} \approx 320$ km, much longer than a step.

The ground and cloud images (Blue Marble, GIBS corrected reflectance) have
the atmosphere's own haze removed, so this adds it back rather than
doubling it.

## Sunlight on the ground

The surface shader multiplies the sunlight at each point by $T_\odot$ from
the same medium, so the light near the terminator, through hundreds of
kilometres of air, is dimmer and redder.

## Checks

| Quantity | Model | Expected |
| --- | --- | --- |
| Zenith transmittance (R, G, B) | 0.940, 0.868, 0.762 | blue attenuated most |
| Sunlight at 5° elevation (air mass ~10.4) | 0.53, 0.23, 0.06 | the deep orange of a low sun |
| Zenith Rayleigh optical depth at 550 nm | 0.108 | about 0.097 for the US Standard Atmosphere (Bucholtz 1995, from memory, not yet checked): the constant 8 km scale height reads about 11 % high |

Visually: the full disc shows the blue haze over oceans and clouds; the
terminator reddens; at a thin crescent only the sunlit limb glows.

## Not yet

- Multiple scattering (the sky's second bounce, which lightens twilight and
  the shadowed side of the limb).
- The view-ray transmittance per colour on what lies behind (blending has
  one alpha).
- Clouds at altitude: the cloud images sit on the ground, under the air.
- Other atmospheres. Mars (dust-dominated, butterscotch by day, blue at
  sunset), Venus, Titan and the giants need parameters from primary
  sources; the published Mars values found so far are a rendering
  approximation, not measurements, so Mars waits.
