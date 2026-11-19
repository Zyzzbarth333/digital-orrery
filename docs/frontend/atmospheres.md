# Atmospheres

Earth's air drawn from its physics: sunlight scattered by molecules and
aerosols along each line of sight, once and then many times, and the same
air reddening the sunlight that reaches the ground. Code: `src/scene/atmosphere.ts` (the shell) and
`bodyMaterial.ts` (sunlight on the surface).

## The medium

Three constituents, each with a density that falls with altitude $h$:

| Constituent | Coefficient at the surface | Profile | Phase function |
| --- | --- | --- | --- |
| Molecules (Rayleigh) | scattering $\beta_R = 1.24062\times10^{-6}\,\lambda^{-4}$ m⁻¹ ($\lambda$ in µm): (5.802, 13.558, 33.1)×10⁻⁶ at 680, 550, 440 nm | $e^{-h/8\,\text{km}}$ | $\tfrac{3}{16\pi}(1 + \cos^2\theta)$ |
| Aerosols (Mie) | extinction $4.44\times10^{-6}$ m⁻¹, scattering 0.9 of it | $e^{-h/1.2\,\text{km}}$ | Cornette–Shanks [1], $g = 0.8$ |
| Ozone (absorption) | (0.650, 1.881, 0.085)×10⁻⁶ m⁻¹ at the peak | tent, 10–40 km, peak 25 km | — |

These are the reference values of Bruneton's precomputed atmospheric
scattering model [2] (`demo.cc`). The ozone peak coefficients and tent are
Hillaire's [4, Table 1, Sec. 4]. Hillaire's table lists the aerosols'
absorption as 4.40×10⁻⁶ m⁻¹, about the extinction here; the model keeps
Bruneton's absorption, 0.444×10⁻⁶ m⁻¹ (a scattering albedo of 0.9). The ground's
diffuse albedo, for the light it sends back up into the air, is 0.3 [4,
Sec. 4]. The shell reaches 100 km.

## Sky light along a view ray

Each view ray is marched from where it enters the atmosphere (or from the
camera, inside it) to where it leaves or meets the ground, in 32 steps. At
each point $\mathbf q$ the sunlight scattered toward the camera is

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

### The view table

From one camera, a view ray is fixed by two angles: its angle from the
zenith and its azimuth from the Sun's. So the rays are not marched pixel
by pixel. Each frame, a table of 128 × 256 rays from the camera is marched
(`renderViewTable` in `atmosphere.ts`), and each pixel of the shell looks
its ray up in it, as in Hillaire's sky-view table [4]. A pixel then costs a
few square roots and two texture reads instead of 32 steps of sunlight
lookups and exponentials, and the table costs the same at any distance.

- **Light without its phase.** The table keeps the Rayleigh and Mie
  integrals apart, without $P_R$ and $P_M$, and each pixel applies them for
  its own angle from the Sun, so the Mie forward peak stays sharp. Its
  alpha is the view ray's transmittance.
- **Rows** are the angle from the zenith, in two halves: rays that meet the
  ground and rays that miss it, so no lookup mixes the two across the
  planet's edge. Within each half the rows are spaced as in Bruneton's
  tables [2], by the distance along the ray to the ground or to the top of
  the atmosphere, which crowds them towards the horizon. From outside the
  atmosphere, the rays that miss the ground are spaced by the square root
  of how close they pass to it instead. That puts the most rows at the
  limb's bright lower edge (a row every 0.006 km of closest approach
  there, against 0.8 km if evenly spread).
- **Columns** are the azimuth from the Sun's, 0 to 180° (1.4° a column):
  the light is symmetric about the Sun's vertical.
- **One sphere.** The table is worked in the ground sphere's space, the
  ellipsoid scaled to a sphere, as the march was. Its lengths are not
  converted back to kilometres along each ray, as the per-pixel march's
  were. For the Earth that scale differs from 1 by 0.3 % at most, and so
  does the light.

Screenshots against the per-pixel march, at the same time and view on the
NVIDIA GPU, differ by at most 1 of 255 at the 99.9th percentile of pixels:
the full disc, the terminator, the day and twilight limbs from 15,000 km,
and from 60 km up, inside the air. The mean levels match to 0.14 of 255.
The frame times are in [performance](../performance.md#the-atmosphere-near-the-earth).

When neither the camera nor the Sun has moved relative to the Earth since
the last march (the clock held, the camera still or only turning), the
table would come out the same, so its pass is skipped.

## Light scattered more than once

Single scattering leaves the air dark wherever the sunlight cannot reach
it directly: past the terminator, in the twilight band, the sunlit air
above lights the air in the Earth's shadow below it. The light scattered two, three
or more times is added from a second table, Hillaire's multiple-scattering
table [4, Sec. 5.5].

Two assumptions make it a small table:

- after its second bounce the light is isotropic, so its phase is
  $p_u = 1/4\pi$;
- the light reaching the air around a point is the light reaching the
  point itself.

Then the light of every order past the first, per unit of sunlight,
depends only on the point's altitude $h$ and the cosine $\mu_\odot$ of the
Sun's angle from its zenith. Over the sphere of directions $\omega$ from
the point $\mathbf x$,

$$
L_2 = \int_{4\pi} L_0(\mathbf x, -\omega)\,p_u\,d\omega, \qquad
f = \int_{4\pi} \int_0^{\ell} \sigma_s\,T\,dt\;p_u\,d\omega, \qquad
\Psi = \frac{L_2}{1 - f} = L_2\,(1 + f + f^2 + \dots),
$$

where $L_0$ is the sunlight scattered once toward $\mathbf x$ along
$\omega$ (and the sunlight the ground reflects, with albedo 0.3), $\ell$
the ray's length to the ground or the top of the atmosphere, and $f$ the
fraction of light that one more bounce returns [4, Eqs. 5–10]. $\Psi$ has
units of sr⁻¹. Along a view ray each step then adds
$T_v\,\sigma_s\,\Psi\,ds$, with no phase and no shadow [4, Eq. 11], where
$\sigma_s$ is the Rayleigh and Mie scattering together.

- **The table** is 32 × 32: columns $\tfrac12(1 + \mu_\odot)$, rows the
  altitude over the shell's 100 km, as in the paper. Each texel averages
  256 directions of equal solid angle, each marched in 40 steps, with the
  step's integral of $T\sigma_s$ taken exactly (it keeps $f$ under 1
  [4, Sec. 5.5.3]). The
  paper takes 64 directions of 20 steps [4, Sec. 5.5.3, Table 2], which
  are 10–20 % out in places against a finer integration. The medium does
  not change, so the table is made once, on the GPU, when the shell is
  first drawn (`msFragment`, drawn by `renderViewTable`): 8–24 ms on the
  Intel GPU, 3 ms on the NVIDIA, once.
- **In the view table**, the light scattered more than once is kept with
  the Rayleigh light, divided by the Rayleigh phase at the texel's own ray.
  The shell multiplies the Rayleigh column by its own pixel's phase, so
  this light comes back as it was, within the phase's change across a
  texel: no third texture to read per pixel.

Checked against a separate CPU integration of the same equations (in
NumPy, with the sunlight's transmittance marched rather than looked up),
the GPU's table agrees to 1 % at the same sampling (tried at the paper's
64 directions of 20 steps). With 256 directions of 60 steps, the CPU
agrees with the table to 4 %, at the ground and at 10, 32 and 100 km,
with the Sun overhead or 2° above the horizon.

Screenshots at the same time and view, before and after, on the NVIDIA
GPU (Earth from 30,000 km, 10 November 2026, 15:00 UTC):

| View | Region | Mean R, G, B of 255, before → after |
| --- | --- | --- |
| Noon, the Sun behind the camera | the disc's centre | 88.8, 101.0, 118.2 → 93.8, 109.7, 135.9 |
| Twilight, the terminator across the disc | the band at the terminator | 12.8, 9.7, 12.1 → 12.8, 11.3, 18.2 |
| The limb, a crescent at a phase angle of 151° | the sunlit crescent's edge | 6.5, 4.9, 5.6 → 6.7, 5.3, 6.4 |
| The same | the far, unlit limb | 2.5, 1.9, 0.8 → 2.7, 2.0, 0.9 |

The light scattered more than once is bluest: it adds the most to the
blue haze on the day side, and it carries the blue of the twilight band
on past the terminator, where single scattering left the air dark. The
far limb, in the Earth's full shadow, stays dark, as it should: little
sunlit air lies above it.

The ground and cloud images (Blue Marble, GIBS corrected reflectance) have
the atmosphere's own haze removed, so this adds it back rather than
doubling it.

## Sunlight on the ground

The surface shader multiplies the sunlight at each point by $T_\odot$ from
the same medium, so the light near the terminator, through hundreds of
kilometres of air, is dimmer and redder.

In a solar eclipse the air in the Moon's shadow is not lit either: the
shell's scattered light along each view ray is dimmed by the share of the
Sun the Moon leaves where the ray meets the ground, or at its lowest point
([lighting](lighting.md#every-case)).

## Checks

| Quantity | Model | Expected |
| --- | --- | --- |
| Zenith transmittance (R, G, B) | 0.940, 0.868, 0.762 | blue attenuated most |
| Sunlight at 5° elevation (air mass ~10.4) | 0.53, 0.23, 0.06 | the deep orange of a low sun |
| Zenith Rayleigh optical depth at 550 nm | 0.108 | about 0.097 for the US Standard Atmosphere (Bucholtz 1995 [3], from memory, not yet checked): the constant 8 km scale height reads about 11 % high |

Visually: the full disc shows the blue haze over oceans and clouds; the
terminator reddens; at a thin crescent only the sunlit limb glows.

## Not yet

- The sky's own light on the ground: the surface is lit by the reddened
  sunlight, not by the blue sky over it (Hillaire's table would give it).
- The view-ray transmittance per colour on what lies behind (blending has
  one alpha).
- Clouds at altitude: the cloud images sit on the ground, under the air.
- Other atmospheres. Mars (dust-dominated, butterscotch by day, blue at
  sunset), Venus, Titan and the giants need parameters from primary
  sources; the published Mars values found so far are a rendering
  approximation, not measurements, so Mars waits.

## References

[1] W. M. Cornette and J. G. Shanks, "Physically reasonable analytic expression for the single-scattering phase function," *Appl. Opt.*, vol. 31, no. 16, p. 3152, 1992, doi: 10.1364/AO.31.003152.

[2] E. Bruneton and F. Neyret, "Precomputed atmospheric scattering," *Comput. Graph. Forum*, vol. 27, no. 4, pp. 1079–1086, 2008, doi: 10.1111/j.1467-8659.2008.01245.x.

[3] A. Bucholtz, "Rayleigh-scattering calculations for the terrestrial atmosphere," *Appl. Opt.*, vol. 34, no. 15, p. 2765, 1995, doi: 10.1364/AO.34.002765.

[4] S. Hillaire, "A scalable and production ready sky and atmosphere rendering technique," *Comput. Graph. Forum*, vol. 39, no. 4, pp. 13–22, 2020, doi: 10.1111/cgf.14050.
