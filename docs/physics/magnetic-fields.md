# Magnetic fields and auroras

Three switches in the rail's **Guides** section, all off until switched on:

- **Magnetic fields** draws field lines traced through each planet's
  measured internal field, Ganymede's and the Sun's included. The lines
  are shaded by field strength, and the dipole's axis runs through the
  dipole's own centre. The Earth's lines are bent by its magnetosphere for
  the day's Kp and end at its magnetopause; Jupiter's and Saturn's are
  bent by their current sheets; Ganymede's close inside Jupiter's field.
  The Earth's, Jupiter's and Saturn's magnetopauses and the Earth's and
  Jupiter's bow shocks are drawn round them. With the Sun focused, its
  current sheet and Parker spiral reach out to 6 AU. Mars, which has no
  global field, shows its magnetised crust.
- **Auroras** draws:
  - the Earth's auroral ovals;
  - Jupiter's and Saturn's main ovals;
  - the footprints of Io, Europa, Ganymede and Enceladus;
  - Uranus's, Neptune's and Ganymede's auroral zones;
  - Mars's aurora over its crustal fields.
- **Radiation belts** draws the belts of the Earth, Jupiter, Saturn,
  Uranus and Neptune, as shells along their L-shells in each planet's own
  field.

Venus, the Moon, Pluto and the other moons have no field of their own to
draw. Mercury's and Ganymede's are too small to hold stable belts.

| Earth | Jupiter | Uranus |
| --- | --- | --- |
| ![The Earth's field lines from IGRF-14, tilted 9 degrees, shaded from sheen near the surface to orange far out, with the auroral oval as a green and red band on the night-side limb tagged Kp 3−, and the field legend](../images/magnetic-earth.jpg) | ![Jupiter's field lines from JRM33 and its current sheet, stretched outward beyond a few radii, with the main oval near the north pole and the legend giving 1.78 to 20.6 gauss at the surface](../images/magnetic-jupiter.jpg) | ![Uranus's field lines from Voyager's offset tilted dipole, crowded on one side where the dipole sits 0.31 radii off centre, tilted 60 degrees](../images/magnetic-uranus.jpg) |

| The Earth's magnetosphere | The Sun's current sheet |
| --- | --- |
| ![The Earth's field lines bent by T89, closed on the day side and drawn out on the night side, inside faint rings and meridians of the magnetopause tagged MP 11.7 Earth radii and, farther out, the bow shock tagged BS 16.3, for NOAA's measured solar wind](../images/magnetic-magnetosphere.jpg) | ![The inner solar system seen from above with the Sun focused: twelve Parker spiral field lines in amber and blue sectors winding out past Jupiter, and the heliospheric current sheet as cream wavy rings every half AU rising and falling up to 63 degrees north](../images/magnetic-sun.jpg) |

![The Earth with its magnetic field lines and auroral oval switched on, as the camera goes round from the day side to the night side, where the oval glows over the pole](../clips/magnetic-field.webp)

Code: `src/physics/magnetic.js` (the field models and the tracer),
`src/physics/t89.js` (the Earth's magnetosphere),
`src/physics/boundaries.js` (magnetopauses, bow shocks and the solar wind),
`src/physics/ringCurrent.js` (Saturn's ring current),
`src/physics/sunField.js` (the Sun's field),
`src/physics/aurora.js` (the ovals and the moons' footprints),
`src/physics/ovation.js` (NOAA's live map), `src/physics/belts.js` (the
radiation belts) and `src/physics/marsCrustal.js` (Mars's crust), tested
in `magnetic.test.mjs` and `aurora.test.mjs`; `src/scene/magnetic.ts` draws them. The coefficients
come from `npm run fetch:magnetic` (`magnetic.fetch.mjs`), which writes
`src/physics/magnetic.data.js`, `public/data/kp.json`,
`public/data/sun-pfss.json` (the Sun's coefficients), Mars's map
`public/data/mars-crustal-br.bin` and its coefficients'
test fixture.

## The field models

| Body | Model | Reference radius |
| --- | --- | --- |
| Earth | IGRF-14 at the date, to degree 13 [1], plus T89 for the day's Kp [45] | 6,371.2 km |
| Jupiter | JRM33 to degree 13 [2], plus the con2020 current sheet [3] | 71,492 km |
| Saturn | Cassini 11, axisymmetric, to degree 11 [4], [5], plus the Voyager ring current [50], [51] | 60,268 km |
| Uranus | Voyager 2's offset tilted dipole [6] | 25,559 km |
| Neptune | Voyager 2's offset tilted dipole [7] | 24,765 km |
| Mercury | MESSENGER's offset dipole [8] | 2,440 km |
| Ganymede | Juno and Galileo's dipole [9], in Jupiter's field at its place | 2,634.1 km |
| Sun | WSO's PFSS model for the Carrington rotation, to degree 9 [47]–[49] | 695,700 km |
| Mars | its crust, Langlais et al., to degree 134 [10] | 3,393.5 km |

Each is evaluated in the body's fixed frame
([orientation](orientation.md)): X toward 0° longitude, Z toward the IAU
north pole, east longitude positive. Jupiter's IAU prime meridian is
System III (1965), the frame JRM33 and con2020 are written in.

### Spherical harmonics

The internal field is the gradient of a potential with Schmidt
semi-normalised Gauss coefficients $g_n^m, h_n^m$ (nT):

$$
V(r, \theta, \phi) = a \sum_{n=1}^{N} \left(\frac{a}{r}\right)^{n+1}
\sum_{m=0}^{n} \left(g_n^m \cos m\phi + h_n^m \sin m\phi\right) P_n^m(\cos\theta),
\qquad \mathbf B = -\nabla V,
$$

so that

$$
B_r = \sum_n (n+1) \left(\tfrac{a}{r}\right)^{n+2} \sum_m (g \cos m\phi + h \sin m\phi) P_n^m, \quad
B_\theta = -\sum_n \left(\tfrac{a}{r}\right)^{n+2} \sum_m (g \cos m\phi + h \sin m\phi) \frac{dP_n^m}{d\theta},
$$

$$
B_\phi = \frac{1}{\sin\theta} \sum_n \left(\tfrac{a}{r}\right)^{n+2} \sum_m m\,(g \sin m\phi - h \cos m\phi) P_n^m.
$$

The Schmidt functions come by the usual recursions [11]:
$P_n^n = \sqrt{(2n-1)/2n}\,\sin\theta\,P_{n-1}^{n-1}$ (with $P_1^1 = \sin\theta$), and

$$
P_n^m = \frac{(2n-1)\cos\theta\,P_{n-1}^m - \sqrt{(n-1)^2 - m^2}\,P_{n-2}^m}{\sqrt{n^2 - m^2}},
$$

with the same recursions differentiated for $dP_n^m/d\theta$.

**IGRF-14.** The coefficients are linear between the five-yearly epochs
(1900 to 2025, degree 10 before 2000). After 2025 they follow the 2025–30
secular variation, held at 2030 after that. The app takes the quarter-year
and retraces the Earth's lines when the year changes.

**JRM33** is published to degree 30. Its authors call the coefficients
well resolved to degree 13 and useful to degree 18 [2]. The app uses 13,
the conservative choice.

### The dipole, its tilt and its centre

The degree-1 terms are a dipole of moment $\mathbf m = (g_1^1, h_1^1, g_1^0)$
(nT $a^3$). Its tilt from the spin axis is $\arccos(|g_1^0| / |\mathbf m|)$. The
quadrupole puts its best centre off the planet's, the eccentric dipole of
Fraser-Smith [12]:

$$
L_0 = 2 g_1^0 g_2^0 + \sqrt3\,(g_1^1 g_2^1 + h_1^1 h_2^1), \quad
L_1 = -g_1^1 g_2^0 + \sqrt3\,(g_1^0 g_2^1 + g_1^1 g_2^2 + h_1^1 h_2^2),
$$

$$
L_2 = -h_1^1 g_2^0 + \sqrt3\,(g_1^0 h_2^1 - h_1^1 g_2^2 + g_1^1 h_2^2), \quad
E = \frac{L_0 g_1^0 + L_1 g_1^1 + L_2 h_1^1}{4 B_0^2},
$$

and the centre is $a\,(L_1 - g_1^1 E,\ L_2 - h_1^1 E,\ L_0 - g_1^0 E) / 3B_0^2$, with
$B_0^2 = (g_1^0)^2 + (g_1^1)^2 + (h_1^1)^2$. The axis is drawn through that
centre, so the offset shows:

| Body | Tilt | Centre off the planet's | Source of the offset |
| --- | --- | --- | --- |
| Earth (2026) | 9.1° | 610 km | IGRF-14's quadrupole |
| Jupiter | 10.25° | 7,800 km | JRM33's quadrupole |
| Saturn | 0° | 2,250 km north | Cassini 11's quadrupole |
| Uranus | 60° | 7,900 km (0.31 $R_U$) | fitted by Voyager |
| Neptune | 46.8° | 13,500 km (0.55 $R_N$) | fitted by Voyager |
| Mercury | 0° | 479 km north (0.196 $R_M$) | fitted by MESSENGER |

### Uranus and Neptune

The Voyager magnetometer team fitted each planet with a single dipole off
its centre [6], [7]. Garrett et al. tabulate the fits as Cartesian
components [13], [14]:

- **Uranus:** moment (0.133, −0.148, 0.115) G $R_U^3$ (0.230 G $R_U^3$,
  60° from the pole toward 48° W), centre (−0.020, 0.020, −0.310) $R_U$.
- **Neptune:** moment (0.0177, −0.0953, 0.0910) G $R_N^3$ (0.133 G
  $R_N^3$, 46.8° toward 79.5° W), centre (0.17, 0.46, −0.24) $R_N$.

Its field is $\mathbf B = [3(\mathbf m \cdot \mathbf r)\mathbf r - \mathbf m r^2] / r^5$ with $\mathbf r$
from the dipole's centre.

Voyager's Uranus frame has Z along the spin's angular momentum, the pole
that faced the Sun in 1986 (right ascension 77.3°, declination +15.2°)
[13]. The IAU's north pole is the other one (257.3°, −15.2°) [15], so the
fit is turned 180° about X into the IAU frame: $(x, y, z) \to (x, -y, -z)$.
The field lines then leave the IAU southern hemisphere, and the dipole sits
0.31 $R_U$ toward the IAU north.

Neither planet's rotation period is known well enough to carry Voyager's
longitudes to today: an error of 0.01 h in 17 h, over 40 years, is about
200 turns. So the tilt and the offset are Voyager's, but the longitude the
dipole leans toward is drawn as if the IAU's prime meridian were Voyager's.
It is a convention, not a measurement.

### Mercury

MESSENGER found Mercury's field to be an axial dipole of 190 nT $R_M^3$,
its moment southward like the Earth's, centred 479 km north of the
planet's centre [8]. It is drawn as that offset dipole, so its field
lines bunch toward the north. The same offset written as harmonics,
$g_n^0 = n\,g_1^0 z_0^{n-1}$, gives the $-190$, $-74.6$, $-22.0$ and $-5.7$ nT
that libinternalfield lists for the model [16].

### Ganymede

Ganymede is the only moon with a dynamo of its own. Weber et al. fitted
Juno's 2021 flyby together with Galileo's six [9]: $g_1^0 = -716.4$,
$g_1^1 = 56.0$, $h_1^1 = 27.0$ nT. That is 719 nT at the equator, tilted
5° from the spin axis and pointing against Jupiter's field. Kivelson et
al.'s Galileo-only fit [17] agrees within 0.8° in direction and 1% in
strength.

Ganymede orbits at 15 $R_J$, inside Jupiter's magnetosphere, where
Jupiter's field (JRM33 with con2020) is 70–120 nT and points south. Its
own moment points the same way, so the two oppose at its magnetic equator
and add over its poles. The lines are traced through the dipole plus
Jupiter's field at Ganymede's place, taken as uniform across the moon and
turned into Ganymede's frame: the vacuum-superposition picture of Kivelson
et al. [53]. Lines near the equator close on the moon; those from its
polar caps run off into Jupiter's field. For a dipole $M$ in a uniform
opposing field $B_0$ the last closed line leaves the surface at

$$
\sin^2\theta = \frac{3}{2 r_n (1 + B_0 / 2M)}, \qquad r_n = (M / B_0)^{1/3},
$$

about 31° latitude for 719 nT in 100 nT. The ambient field changes as
Ganymede moves through Jupiter's tilted current sheet; the lines are
retraced when it has changed by 8%. Left out: the plasma flowing past,
which bends the open lines downstream.

### Jupiter's current sheet

The magnetodisc's currents stretch Jupiter's field lines outward beyond a
few $R_J$. con2020 [3] models them as an annular disc of azimuthal current,
from $r_0$ = 7.8 to $r_1$ = 51.4 $R_J$ and $D$ = 3.6 $R_J$ half-thick, of
strength $\mu_0 I_0 / 2$ = 139.6 nT, with its normal tilted 9.3° toward
155.8° E. It adds a radial current $I_\rho$ = 16.7 MA, whose field is
azimuthal:

$$
B_\phi = \mp 2.7975 \frac{I_\rho}{\rho} \ \text{nT}\ (I_\rho \text{ in MA}, \rho \text{ in } R_J),
$$

reversing across the sheet and scaled by $|z|/D$ inside it.

The disc is a semi-infinite sheet from $r_0$ less one from $r_1$, each from
Edwards et al.'s analytic forms [18]. Their eqs. 9a–b hold inside the inner
edge and 13a–b beyond it, and the two are blended by
$\tanh((\rho - a)/1\,R_J)$, as the con2020 community code does. Those
approximate the original model's Bessel-function integrals [19] to a few
nT near $\rho = r_0$.

### Saturn's ring current

Voyager found Saturn's field lines stretched by a ring of azimuthal
current around 8–16 $R_S$. Connerney et al.'s model [50], as Bunce and
Cowley give it [51], is a disc of current density $I_0/\rho$ between
$\rho$ = 8 and 15.5 $R_S$, 3 $R_S$ either side of the magnetic equator,
with $\mu_0 I_0$ = 60.4 nT: 11.5 MA in all.

Bunce and Cowley found that Edwards et al.'s forms, which serve Jupiter's
thin, wide sheet, fail near Saturn's squarer disc [51]. So the field here
is summed exactly: the disc as 30 × 24 circular loops, each loop's field
from complete elliptic integrals [52],

$$
B_z = c \left[K + \frac{a^2 - \rho^2 - z^2}{(a - \rho)^2 + z^2} E\right], \quad
B_\rho = c \frac{z}{\rho} \left[-K + \frac{a^2 + \rho^2 + z^2}{(a - \rho)^2 + z^2} E\right],
$$

with $k^2 = 4a\rho/((a + \rho)^2 + z^2)$ and
$c = \mu_0 I / 2\pi\sqrt{(a + \rho)^2 + z^2}$. $K$ and $E$ come from the
arithmetic-geometric mean. The sum is tabulated once on a 0.2 $R_S$ grid
to 24 $R_S$ out and 20 $R_S$ up, a third of a second spread over the
first frames, and interpolated. Beyond the table the disc is a dipole of
its own moment. Its field adds about 10 nT northward inside the disc, and
it draws the 76° line out from 9.4 to 14.2 $R_S$ at the equator.

### The Earth's magnetosphere

The solar wind squeezes the Earth's field on the day side and draws it
out into a tail on the night side. Tsyganenko's T89 [45] models the
currents that do it: the ring current, the tail's warped current sheet
and its closure, and the magnetopause's and Birkeland currents. Its 30
parameters were fitted to spacecraft data in seven sets by Kp, level 1
for Kp 0 and 0+ up to level 7 for 6− and above. The day's Kp, from the
same table as the auroral ovals [23], picks the set. The port is of
geopack's Python [46] of the revised version, T89c.

T89 works in geocentric solar magnetospheric (GSM) axes: X toward the Sun,
Z the dipole's north axis made square to X. The dipole tilt $\psi$ is the
angle between that axis and Z, positive when the north magnetic pole leans
toward the Sun. Here the axes come from the Sun's direction in the Earth's
frame and IGRF's centred dipole. T89's field is added to IGRF's in the
Earth's frame.

The GSM axes turn with the Earth, so the lines are retraced once the Earth
has turned 7.5° under the Sun (half an hour) or Kp changes level. The last
set stays up while the next is traced. The auroral ovals' CGM grid and the
radiation belts stay on IGRF alone, as their definitions use it.

T89 has no sharp magnetopause and no bow shock: its field is a smooth
fit, not a boundary. So the lines end where they meet the magnetopause of
the next section, drawn for the date's solar wind, and otherwise at 40
$R_E$.

### Magnetopauses and bow shocks

The solar wind stops a planet's field at the magnetopause, where the
field's pressure balances the wind's, and slows to below its own
magnetosonic speed at the bow shock standing ahead of it.

**The Earth.** Shue et al.'s magnetopause [54] is a surface of revolution
about the Sun line, with $\theta$ the angle from it, $D_p$ the solar
wind's dynamic pressure (nPa) and $B_z$ the interplanetary field's
north-south component (nT, GSM):

$$
r = r_0 \left(\frac{2}{1 + \cos\theta}\right)^{\alpha}, \quad
r_0 = \{10.22 + 1.29 \tanh[0.184 (B_z + 8.14)]\}\, D_p^{-1/6.6}, \quad
\alpha = (0.58 - 0.007 B_z)[1 + 0.024 \ln D_p].
$$

It was fitted for $-18 < B_z < 15$ nT and $0.5 < D_p < 8.5$ nPa, and the
app keeps to those ranges. $D_p$ counts the wind's helium, a factor 1.16
at its usual 4% [54]. The bow shock stands off from the magnetopause's
nose by Farris and Russell's relation [55], as Volpes and Bothmer give it
[56]:

$$
\frac{\Delta}{R_c} = 0.81\, \frac{(\gamma - 1) M^2 + 2}{(\gamma + 1)(M^2 - 1)},
\qquad R_c = 1.35\, r_0,
$$

with $\gamma = 5/3$ and $M$ the fast magnetosonic Mach number, so it runs
off to infinity as $M \to 1$. Its shape is the app's own, not a fitted
model: a hyperboloid with that nose, a radius of curvature $R_c + \Delta$
there (concentric with the magnetopause's), and the Mach cone's
half-angle $\arcsin(1/M)$ as its asymptote. Both are drawn in GSM axes,
without the solar wind's 4° aberration.

The wind is NOAA SWPC's propagated from L1 to the Earth [59], a row a
minute for the last 7 days, averaged over 10 minutes about the clock's
time. Otherwise the app takes a quiet wind: 5 cm⁻³ at 400 km/s, 10⁵ K,
5 nT, $B_z$ = 0. That gives 1.55 nPa, Mach 5.8, the magnetopause at 10.7
$R_E$ and the bow shock at 13.9.

**Jupiter.** Rutala et al. fitted Jupiter's magnetopause and bow shock to
the crossings of every spacecraft through Juno's prime mission [57]. With
$\phi$ measured from the north (the spin axis) through dawn and $p$ the
wind's dynamic pressure,

$$
r = r_0 p^{r_1} \left(\frac{2}{1 + \cos\theta}\right)^{a_0 + a_1 p} + \sin^2\frac{\theta}{2}\, r_{2|3} \sin^2\phi\, p^{r_1},
$$

$r_2$ on the dawn side and $r_3$ at dusk. The magnetopause has
$r_0 = 33.5$, $r_1 = -0.25$, $r_2 = 12.9$, $r_3 = 25.8$, $a_0 = 0.19$,
$a_1 = 1.27$; the bow shock 36.4, −0.25, 0.0, 9.9, 0.89, 0.88 (their
Tables 2 and 4, as the preprint gives them). The magnetopause holds for
$x > -90\ R_J$, where crossings constrain it.

**Saturn.** Pilkington et al.'s magnetopause [58] is Shue's form with
$r_0 = 10.5\, D_p^{-1/5.7}$ and exponent $K = 0.67 + 0.17 D_p$,
squeezed 19% north-south. Saturn's bow shock is left out: Went et al.'s
model could not be read to check its coefficients.

Jupiter's and Saturn's are drawn for the quiet wind thinned to their
distance from the Sun as $1/r^2$: about 0.055 nPa at Jupiter, which
puts the magnetopause at 69 $R_J$, and 0.017 nPa at Saturn, 21 $R_S$.
Their field lines, to 40 and 20 radii, stay inside.

Each boundary is drawn as rings 30° apart round the Sun line and
meridians every 45°, recomputed in the planet's frame as it turns under
the Sun. They fade out as the camera comes inside the magnetopause's
nose. Tags give the nose distances and, on hover, the wind used.

### The Sun's field

The Wilcox Solar Observatory has mapped the Sun's photospheric field
every Carrington rotation since 1976. From each map it fits the
potential-field source-surface (PFSS) model [47], [48]: a field with no
currents between the photosphere and a source surface at 2.5 $R_\odot$,
where the solar wind is taken to have turned it radial. WSO gives the
coefficients $g_l^m$, $h_l^m$ to degree 9, in μT, with Schmidt
semi-normalised Legendre functions [49]. With
$c_l = l + 1 + l\,(1/R_s)^{2l+1}$ and $r$ in $R_\odot$ [48, eqs. 16–18],

$$
\begin{aligned}
B_r &= \sum P_l^m (g \cos m\phi + h \sin m\phi)\, r^{-(l+2)}\, \frac{l + 1 + l (r/R_s)^{2l+1}}{c_l}, \\
B_\theta &= -\sum \frac{dP_l^m}{d\theta} (g \cos m\phi + h \sin m\phi)\, r^{-(l+2)}\, \frac{1 - (r/R_s)^{2l+1}}{c_l}, \\
B_\phi &= \sum \frac{m P_l^m}{\sin\theta} (g \sin m\phi - h \cos m\phi)\, r^{-(l+2)}\, \frac{1 - (r/R_s)^{2l+1}}{c_l}.
\end{aligned}
$$

Past $R_s$ the field is radial, falling as $1/r^2$. Longitude is
Carrington longitude, the IAU's prime meridian for the Sun [15].

`npm run fetch:magnetic` reads WSO's files from CR 1958 (January 2000) on, one a
rotation, into `public/data/sun-pfss.json` (213 kB). The app takes the
rotation of the date, numbered from CR 1927's start on 8 September 1997,
27.2753 days each. About 300 footpoints spread evenly over the photosphere
are traced out to 3.5 $R_\odot$: closed loops over active regions and
the streamer belt, open lines from the polar coronal holes. The lines are
retraced when the rotation changes. Degree 9 is about 20° on the Sun: the
large-scale field only, without active regions' detail.

**The current sheet and the Parker spiral.** Past the source surface the
field points outward on one side of the line where $B_r = 0$ there and
inward on the other. The solar wind carries that neutral line out as the
heliospheric current sheet. The wind leaves radially at speed $v$ while
the Sun turns under it, so in the Sun's turning frame a field line from
Carrington longitude $\phi_0$ lies at

$$
\phi(r) = \phi_0 - \frac{\Omega (r - R_s)}{v},
$$

the Parker spiral [60]. Here $\Omega$ is the Carrington system's sidereal
rate, 360° in 25.38 days, and $v$ = 400 km/s. At 1 AU the field then lies
47° from the radial.

The app finds the neutral line by marching squares on a 1° × 2° grid of
$B_r$ on the source surface, a few rows a frame, and sweeps it out along
the spiral. It draws the sheet where it crosses spheres every half AU out
to 6 AU, with twelve spiral field lines in the Sun's equator: amber where
the field points outward, blue inward. A filled sheet, folded over itself
many times, cost the integrated GPU 28 ms a frame; the rings cost about
1.6 ms. They show while the Sun is focused, and the legend gives how far
north and south the sheet reaches. The wind is taken as uniform, so the
sheet is the model's, without the fast and slow streams that bend it.

### Mars's crust

Mars has no global field now, but its ancient crust stayed magnetised,
most strongly in the southern highlands. Langlais et al. fitted MGS's and
MAVEN's measurements to degree 134, about 160 km [10]. On their
3,393.5 km sphere, the radial field runs from −8,520 to 11,260 nT.

`npm run fetch:magnetic` sums the coefficients on a 720 × 360 grid, a
latitude row at a time as for the gravity maps. It stores each cell as one
signed byte on an asinh scale, $127\,\mathrm{asinh}(B_r/50\,\mathrm{nT}) / \mathrm{asinh}(240)$:
259 kB in `public/data/mars-crustal-br.bin`. The map is drawn on a shell
just above Mars: blue inward, amber outward, with a legend.

The sum reproduces the paper's range to 2 nT on a 0.25° grid. The
strongest point is at 48° S, 175° E, over Terra Cimmeria and Sirenum.

### Field lines

The lines start on the planet's surface, the IAU ellipsoid (Jupiter's at
1/15.4 flattening, Saturn's 1-bar spheroid), along rays from the dipole's
centre:

- at magnetic latitudes 15° to 74° (by body) in the hemisphere the field
  lines leave;
- at 12 magnetic longitudes, alternate rows staggered by half a step;
- plus the two highest rows in the other hemisphere, kept only where their
  lines are open.

Each is traced both ways by RK4 along the unit field direction
$d\mathbf x/ds = \pm \mathbf B/|\mathbf B|$, with steps 3% of the distance from the
centre. A line stops at the surface (bisected to it), at the Earth's
magnetopause (bisected to it too), beyond 16 (Uranus, Neptune), 20
(Saturn) or 40 (Earth, Jupiter) radii, 3.5 for the Sun, or after 3,000
steps.

The tracing happens 3 ms a frame, focused body first, until done: about
100 lines a body, under a second. The lines are fixed in the body's frame,
so after that they only turn with it.

**Strength** is shaded along the console's own ramp (the porkchop's):
sheen where the field is strongest at the surface, through phosphor amber
and key orange, to engraving 1,000 times weaker. The lines are brighter
where stronger. The legend gives the surface range, the dipole moment, tilt
and offset, and the source.

**What is left out:** Jupiter's and Saturn's magnetopause currents and
tails, whose fields would bend their outer lines as T89 bends the
Earth's. Saturn's bow shock. Uranus's, Neptune's and Mercury's
magnetospheres: their lines are their internal fields alone.

## Auroras

### The Earth's ovals

Starkov's model [20] gives the poleward and equatorward edges of the
auroral oval, and the equatorward edge of the diffuse aurora. Each is a
corrected geomagnetic (CGM) colatitude against magnetic local time $t$
(hours), as Sigernes et al. give it [21]:

$$
\theta(t) = A_0 + A_1 \cos[15(t + \alpha_1)] + A_2 \cos[15(2t + \alpha_2)] + A_3 \cos[15(3t + \alpha_3)],
$$

with the arguments in degrees. Each $A_i$ and $\alpha_i$ is
$b_0 + b_1 x + b_2 x^2 + b_3 x^3$ in $x = \log_{10}|AL|$, from their Table 1. The
auroral electrojet index comes from Kp through Starkov's fit [22]:

$$
AL = 18 - 12.3\,Kp + 27.2\,Kp^2 - 2\,Kp^3 \ \text{nT}.
$$

At Kp 3 the oval's equatorward edge is at 63.8° at midnight, and the oval
spans 73.3–75.7° at noon.

The cubic dips between Kp 0 and 0.23 and peaks at 655 nT near Kp 8.8. So
the ovals stop growing at the very largest storms, which the model was not
fitted to.

**Kp** is the planetary index for the three-hour interval, from GFZ
Potsdam's definitive and quicklook values [23], as CelesTrak's
`SW-All.csv` carries them. After that come NOAA's 45-day predictions. The
file is the one the atmosphere's space weather comes from
([environment](environment.md)), read from the same cache. Past the
table's end Kp 2o is assumed, and the tag says so.

**CGM to geographic.** CGM coordinates [24] are found by following the
IGRF field line from a point to the centred dipole's equator, then back
down the dipole's own field line to the ground. The app runs this the
other way:

1. A CGM latitude $\lambda$ crosses the dipole equator at $r = a / \cos^2\lambda$.
2. The IGRF line traced down from there meets the ground at the
   geographic point.

This runs once per year of IGRF, on a grid 2° in latitude (50–82°) by 10°
in longitude in both hemispheres, a few milliseconds a frame, and
bilinear between. CGM longitude 0 is the meridian through the geographic
south pole [12]. Magnetic local time is $12 + (\phi - \phi_\odot)/15$ hours,
with $\phi_\odot$ the Sun's longitude in the centred dipole's frame.

**Drawing.** The oval is stacked sheets from 100 to 310 km up. Green
(557.7 nm) is brightest near 110–150 km, where Sigernes et al. place the
emission peak [21]. Red (630.0 nm) is brightest above about 200 km. Two
rows between the diffuse edge and the oval glow faintly. The oval is
brightest before magnetic midnight and brighter with Kp, and fades out
where the Sun is up.

The brightness is an illustration: Starkov's model places the edges, not
the intensity.

### Live aurora: NOAA's OVATION Prime map

When the app's clock is within three hours of now, it fetches NOAA Space
Weather Prediction Center's live aurora map [25]. The map is the
OVATION Prime model [26], [27], driven by the solar wind measured
upstream at L1. It gives the probability of visible aurora (%) on a 1°
geographic grid, for a forecast time half an hour to an hour and a half
ahead.

The app uses the map from half an hour before its solar-wind time to an
hour after its forecast time, and asks for a new one at most every five
minutes. NOAA publishes only the latest map, so any other time falls back
to Starkov's oval.

The map is drawn as four sheets from 105 to 250 km up, in the Earth's own
frame. Brightness follows the probability (full at 40% and above), green
below and red above as before, faded where the Sun is up. Cells under
about 4% are left out. The tag names the forecast time and sits at the
map's brightest northern point.

The map is geographic and changes only every few minutes, so it is built
once per map. It costs nothing measurable a frame: the layer's update
takes 0.1 ms.

### Jupiter and Saturn

Both giants' main ovals shine mostly in the ultraviolet, so they are drawn
in a pale violet false colour, on both day and night sides:

- **Jupiter's main emission** maps to about 20–30 $R_J$ in the
  magnetodisc [28]. It is drawn as the band between the footprints of
  field lines from 20 and 30 $R_J$ in the magnetic equator, traced through
  JRM33 and con2020. The northern band reaches down to about 55° near
  180–200° W (57° at 200° W), the long-known "kidney" shape that the field's northern
  anomaly gives it.
- **The moons' footprints.** Io, Europa and Ganymede each leave a spot
  where their field lines meet Jupiter, and Enceladus one on Saturn
  [29]. Each moon's field line, at 5.9, 9.4, 15.0 and 3.95 planet
  radii, is traced to both hemispheres every 5° of its System III
  longitude and interpolated for the moon's place now.
  - **Lead angle:** the spot sits downstream of that footprint by the
    angle the moon's Alfvén wave falls behind on its way down. Hue et al.
    fitted it from Juno-UVS against the moon's System III west longitude
    $\lambda$ [30]:
    $\delta = a_0 + a_1 \cos w\lambda + b_1 \sin w\lambda\,(+\,a_2 \cos 2w\lambda + b_2 \sin 2w\lambda)$.
    It averages about 4° for Io, 6–7° for Europa and 12–13° for Ganymede,
    north and south.
  - **Tail:** behind each spot runs a tail over the footprints of the
    moon's earlier longitudes. Jupiter turns faster than its moons orbit,
    so the plasma a moon disturbed lies at larger east longitudes. Io's
    tail is drawn over 60°, the others' over 20°.
  - Enceladus has no fitted lead angle, so its spot sits at its footprint.
- **Saturn's main oval** is drawn at 14–16° colatitude from the southern
  pole, the medians of Badman et al.'s HST statistics [31]. The northern
  oval is that band's conjugate along Cassini 11's field lines. It comes
  out 13.3° from the north pole, smaller because the field is offset north.

### Uranus and Neptune

JWST found Neptune's infrared aurora in 2023, the first since Voyager's
faint ultraviolet glimpses. The southern emission lay between 30° and 60°
S and 200° and 280° W, and mapped to L-shells from under 3 to 20 $R_N$
(3–5 in the north) [32]. Uranus's aurora has been seen by Hubble as
spots near its magnetic poles, rotating with the planet [33].

Both are drawn as the band between the footprints of field lines from 3
and 20 radii in the magnetic equator, traced through Voyager's dipoles.
The band is brightest mid-way and fainter than the gas giants' ovals.
Through Voyager's Neptune dipole, the southern zone falls at 24–48° S and
259–291° W. JWST's latitudes match; the longitudes rest on the Voyager
convention above. Uranus's is drawn the same way: a mapped oval has not
been published.

### Ganymede and Mars

**Ganymede's** oxygen aurora, seen by Hubble, is confined to latitudes
above ±40°, along the boundary of its open field lines [34]. It is drawn
as a band from 40° to 48° in each hemisphere. The boundary moves poleward
on the trailing hemisphere, where Jupiter's plasma presses, and that
shift is not drawn.

**Mars's** discrete aurora was first seen by SPICAM, over the strong
crustal fields of the south [35]. Mars Global Surveyor found the
auroral electrons where crustal field lines open to space, the cusps
between crustal loops [36]. With the auroras on, the night side glows
violet where the map's radial field is strong, from about 400 nT to full
by 3,500 nT, as a stand-in for those cusps. Mars's diffuse and proton
auroras, which follow the Sun's storms rather than the crust, are not
drawn.

## Radiation belts

Energetic particles are trapped on closed field lines, bouncing between
mirror points and drifting round the planet, so a belt fills a band of
L-shells. Each belt is drawn as three shells across its band: 36 field
lines round each, traced from the magnetic equator at that L through the
planet's own field, and joined into a surface. The shells glow most where
seen edge-on, so the belt reads as a volume. Its brightness is a smooth
bump, zero at the band's edges and one at its peak, fading away from the
magnetic equator, where trapped particles crowd. That shape is drawn, not
measured.

| Body | Belt | L (peak) | Source |
| --- | --- | --- | --- |
| Earth | inner, protons and electrons | 1.2–2 (1.5) | "$L \lesssim 2$", the slot at L 2–3 [37] |
| Earth | outer, electrons | 3–6.6 (4.6) | "$L \gtrsim 3$", its heart at L 4.6, strong at geosynchronous orbit, L 6.6 [37] |
| Jupiter | ions and electrons | 1.2–6 (3) | trapping from 1.2 $R_J$; MeV electrons peak near L 3 and fall about tenfold by L 6 [38] |
| Saturn | innermost, protons | 1.03–1.22 (1.12) | between the planet and the D ring [38], [39] |
| Saturn | electrons | 2.27–7 (2.5) | outside the A ring, peaking near L 2.5, gone by L 7 [38] |
| Uranus | electrons | 4.5–10.4 (4.7) | most intense at Voyager 2's closest L, 4.67, and swept by Miranda, Ariel and Umbriel out to Umbriel's L, 10.4 [40]; inside 4.67 was not sampled |
| Neptune | ions and electrons | 1.2–14.4 (centred) | out to Triton's L-shell, which bounds them [41]; where they peak within is not drawn from data |

Because the shells are traced through the real field, the Earth's inner
belt follows the dipole's tilt and offset. It comes lowest, about 980 km
up at L 1.25, over the South Atlantic: the South Atlantic Anomaly.
Saturn's rings and moons cut its belts into segments; the gaps at the
moons' orbits are not drawn.

**Cost.** Each shell is its own mesh, and pixels too faint to see are
discarded before blending, which was most of the belts' cost at Earth on
an integrated GPU. On the Intel GPU at the Earth, with the belts on, a
frame takes 15.7 ms against 14.6–15.2 ms off; before this change it was
26 ms against 18. A shell also fades out as the camera comes inside it,
since from within, a belt is only a haze over the whole view.

## Validation

`magnetic.test.mjs`:

- **IGRF against NOAA.** NOAA NCEI's Geomag 7.0 calculator ships its 20
  sample points run on IGRF-13 [42]. The same sum on the same coefficients
  gives X, Y, Z, H and F within 0.054 nT of them, under the printout's
  0.1 nT, and D and I within its minute. The points cover 2015–2024.5,
  0–30,000 ft, geodetic and geocentric.
  - IGRF-14 holds IGRF-13's definitive 2015 model unchanged, and at the
    two 2015.0 points it gives NOAA's numbers to 0.04 nT.
  - Its 2025 geomagnetic north pole comes out at 80.8° N, 72.8° W.
- **IGRF-14 after 2025 against NOAA's online calculator** [43]. Four
  points were read on 18 November 2026:
  - Brisbane, 2026.5;
  - Tromsø, 2027.2, at 10 km;
  - Boulder, 2025.4, at 1.6 km;
  - the South Atlantic, 2028.0, at 400 km.

  Two of them fall on the 2025–30 secular variation. All agree within
  0.05 nT and 0.0001°. The calculator counts 1 January as day 0.
- **JRM33 against its paper [2].** The dipole is 4.1766 G $R_J^3$
  (paper 4.177), tilted 10.250° (10.25) toward 196.379° W (196.38).
  - On the 1/15.4 surface the field runs 1.77–21.9 G. The paper gives
    "just under 2" to "almost 22" G, to degree 18.
  - Io's footprints at 144 longitudes fall within 1.17° of arc of the
    paper's own Tables S2 and S3 (JRM33 to degree 18 with con2020), rms
    0.34°.
  - $|B|$ along the footprint peaks at 19.8 G north and 12.3 G south. The
    paper gives about 20 and 12.
- **Cassini 11 against its paper [5].** The file the app reads,
  libinternalfield's transcription [16], matches Cao et al.'s Table 5. The eccentric dipole sits 2,254 km north, against the magnetic
  equator's 2,300 km northward shift they measured.
- **Uranus and Neptune** match Ness's moments, tilts and offsets. Uranus's
  OTD moment is within 4.9° of the dipole of Connerney's Q3 model [44]
  turned the same way, whose tilt is 58.6°.
- **The sums and the tracer:**
  - Degree-1 harmonics equal the closed-form dipole.
  - The IGRF sum is curl- and divergence-free to $10^{-9}$.
  - A dipole line from latitude $\lambda$ reaches $L = 1/\cos^2\lambda$ to
    $10^{-4}$ and lands at $-\lambda$.
  - Seeds lie on the spheroid.
  - Footprints from further out land nearer the dipole's poles.
- **Europa's and Ganymede's footprints** fall within 1.07° and 1.89° of
  arc of the paper's Tables S2 and S3 [2], rms 0.34° and 0.43°.
- **Ganymede:** Weber et al.'s dipole is 719 nT, tilted 4.96°, and lies
  0.8° from Kivelson et al.'s Galileo fit, 713 nT [9], [17].
- **Mars:** the sum of Langlais et al.'s coefficients gives the radial
  field from −8,522 to 11,261 nT on a 0.25° grid [10] (paper: −8,520
  to 11,260), strongest at 47.9° S, 174.6° E. The app's byte map holds it
  within 2.4% of $|B_r| + 70$ nT.
- **Uranus:** belts are drawn for the five planets that hold them.
  Uranus's L = 5 shell crosses its magnetic equator between 4.75 and 5.26
  $R_U$ from the planet's centre, the offset dipole's doing.
- **Ganymede in Jupiter's field:**
  - Jupiter's field at 15 $R_J$ in its equator is 71–116 nT, southward at
    every longitude.
  - Traced through a 719 nT dipole in a uniform opposing 100 nT field, the
    last closed line leaves at 58.48° colatitude, where the flux function
    puts it.
- **Saturn's ring current** [50], [51]:
  - $K(1/2)$ and $E(1/2)$ match their tabulated values to $10^{-9}$, and one
    loop's field on its axis matches the closed form.
  - The disc carries 11.50 MA (paper: 11.5).
  - The table holds the direct loop sum within 0.17 nT. At the centre it
    gives 10.531 nT northward, against 10.532 from the on-axis integral.
  - At 200 $R_S$ the disc is a dipole of its own moment within 1%.
- **The Earth's magnetosphere:**
  - T89 at Tsyganenko's own test point (level 2, tilt −0.5336 rad, GSM
    (−5.1, 0.3, 2.8) $R_E$) gives (20.77213, −0.64655, −15.07164) nT,
    within $2 \times 10^{-6}$ nT of his Fortran's output as geopack's tests
    record it [46].
  - The dipole tilt from IGRF and the Sun at 2001-01-01 02:03:04 UT is
    −0.53356 rad, against geopack's −0.53359.
  - Kp maps to T89's levels as Tsyganenko's table gives.
  - The 68° line at midnight reaches 6.2 $R_E$ with T89 at Kp 2 (5.2 on
    IGRF alone) and 11.7 at Kp 5; its noon twin moves by under 5%. T89's
    own field 9 $R_E$ toward the Sun points north: the compressed day side.
- **The Sun** [47]–[49]:
  - A WSO file parses to the coefficients in the app's order, with the
    monopole a finite map leaves dropped.
  - The field at the source surface is radial, and between the
    photosphere and it the sum is curl- and divergence-free to $10^{-9}$.
  - CR 1927 begins on 8 September 1997, as WSO's own example gives, and
    all 661 rotation start dates in WSO's table (CR 1642–2302, 1976–2025)
    fall within 2.3 h of the app's numbering [61].
  - The current sheet's farthest north and south, from the same
    coefficients with WSO's 3.25 $R_\odot$ source surface, against WSO's
    computed tilts for its radial model [61] at every fourth rotation
    (70, values under 70°): median 1.43°, 80% within 3.27°. Over all 287
    such rotations the median is 1.39° on a finer grid.
  - A 400 km/s Parker spiral lies 46.98° from the radial at 1 AU.
  - The sign of the dipole term $g_1^0$ follows WSO's measured polar field
    [49] at all 739 dates from 2000 to 2026 when the poles' mean is past
    20 μT. The polar field reverses every solar cycle; the PFSS fit tracks
    each reversal.
- **Magnetopauses and bow shocks** [54]–[58]:
  - Below 7 nPa Shue's magnetopause stays outside geosynchronous orbit at
    every $B_z$ in its range (nearest 6.70 $R_E$), as the paper says; at
    8 nPa and $B_z = -18$ nT it is inside, 6.57.
  - Farris and Russell's standoff tends to $\Delta/R_c = 0.2025$ at high
    Mach number, and the shock runs out to 109 $R_E$ at Mach 1.05.
  - The hyperboloid has the nose, nose radius and asymptotic Mach cone it
    was built with (9.6° at Mach 6, 10.2° at $10^4$ $R_E$ downstream).
  - Jupiter's magnetopause stands off 89.1 and 48.9 $R_J$ at 0.02 and
    0.22 nPa (paper: 89 and 51, the posterior medians). At the median
    0.071 nPa its polar flattening at $x = 0$ is 13.7% (13%), and its
    dawn-to-dusk ratio 0.88 (0.93 ± 0.41).
  - Saturn's drawn surface is the one lines are cut at, 19% flatter
    north-south.
  - The Earth's lines from the dayside cusp end on the magnetopause to
    $10^{-10}$ $R_E$.
  - NOAA's propagated wind parses, skipping empty rows, and averages over
    ±5 minutes.
- **Mercury** is MESSENGER's 190 nT $R_M^3$ dipole, 479 km north [8].
  Its harmonic expansion matches libinternalfield's terms to 0.06 nT, and
  their eccentric dipole sits 479 km north.
- **Radiation belts:**
  - A centred dipole's L = 4 shell reaches 4.000000 at the equator and
    meets the surface at 59.997° (60°).
  - IGRF-14's L = 1.25 shell is lowest, 984 km up, at 11° S, 60° W, over
    the South Atlantic.

`aurora.test.mjs`:

- **Starkov's table.** The 84 coefficients match Sigernes et al.'s Table
  1, as the PDF's text gives it. Eqs. 1 and 3 hold.
- **The paper's own description:**
  - The Kp 3 oval is wider at midnight (8.1°) than at noon (2.4°).
  - The equatorward edge moves steadily equatorward with Kp.
  - The diffuse edge lies equatorward of the oval at every hour.
- **What is not checked:** we found no published table of boundary
  latitudes against Kp to hold the evaluated ovals to. Kp 3's 63.8°
  midnight edge sits where Feldstein's ovals put moderate activity.
- **Kp** through the 10–11 May 2024 storm matches CelesTrak's rows,
  including the 9o at 00 UT on the 11th.
- **CGM:**
  - On a pure centred dipole it maps to itself within 0.004°.
  - Longitude 0 runs through the geographic south pole.
  - Tromsø comes out at CGM 67.2° N in 2025.
- **Saturn's oval** maps from 15° south to 13.3° north.
- **Jupiter's main emission** lies poleward of Io's footprint: a mean
  73.3° against 66.2° magnetic latitude.
- **Jupiter's main oval against Hubble's.** Bonfond et al.'s reference
  ovals from Hubble centre on 74° N, 185° W (System III) in the north and
  82° S, 32° W in the south [62], as Head et al. give them for their
  Juno-UVS ovals [63]. The app's oval (25 $R_J$), its footprints' mean
  direction, centres on 70.9° N, 178.6° W and 82.4° S, 29.8° W: 3.7° and
  0.5° of arc away. The northern oval is kidney-shaped round the magnetic
  anomaly, so its centre is the looser check. Juno-UVS's reference ovals
  themselves are in the journal's supplement, which could not be read.
- **Lead angles** [30]: the Table 1 fits average 4.26°/4.14° (Io,
  north/south), 5.75°/7.06° (Europa) and 12.33°/13.02° (Ganymede). The
  paper gives 4.3/4.1, 5.8/7.0 and 12.3/13.0. Io's stays between 1.8° and
  7.2°.
- **Enceladus's footprints** land at 65.2° N and 62.2° S. The northern one
  sits nearer the pole because Cassini 11's field is offset north.
- **Starkov's oval against NOAA's live map.** This is an independent
  check of the oval, IGRF-14, CGM and Kp together. A saved OVATION Prime
  map [25] (forecast 03:09 UTC, 18 November 2026) is compared with
  Starkov's oval for that hour's Kp (3−). On the night side, 18 to 06 MLT,
  the map's mean probability is:
  - north: 19.6% mid-oval, 7.7% six degrees equatorward and 1.0% six
    degrees poleward;
  - south: 15.2%, 7.1% and 0.8%.
- **Neptune's zone** (L 3–20) falls at 24–48° S, mean 35° S, inside
  JWST's 30–60° S [32]. Its 259–291° W, against JWST's 200–280° W,
  rests on the Voyager longitude convention.

## References

[1] International Association of Geomagnetism and Aeronomy, Working Group V-MOD, "International Geomagnetic Reference Field: the 14th generation (IGRF-14), coefficients 1900–2030," NOAA NCEI, Dec. 2024. [Online]. Available: https://www.ngdc.noaa.gov/IAGA/vmod/coeffs/igrf14coeffs.txt

[2] J. E. P. Connerney *et al.*, "A new model of Jupiter's magnetic field at the completion of Juno's Prime Mission," *J. Geophys. Res. Planets*, vol. 127, no. 2, Art. no. e2021JE007055, 2022, doi: 10.1029/2021JE007055. Supporting Tables S1–S3: https://authors.library.caltech.edu/records/dds0z-2vx98

[3] J. E. P. Connerney, S. Timmins, M. Herceg, and J. L. Joergensen, "A Jovian magnetodisc model for the Juno era," *J. Geophys. Res. Space Phys.*, vol. 125, no. 10, Art. no. e2020JA028138, 2020, doi: 10.1029/2020JA028138.

[4] M. K. Dougherty *et al.*, "Saturn's magnetic field revealed by the Cassini Grand Finale," *Science*, vol. 362, no. 6410, Art. no. eaat5434, 2018, doi: 10.1126/science.aat5434.

[5] H. Cao *et al.*, "The landscape of Saturn's internal magnetic field from the Cassini Grand Finale," *Icarus*, vol. 344, Art. no. 113541, 2020, doi: 10.1016/j.icarus.2019.113541. Table 5. Preprint: arXiv:1911.06952.

[6] N. F. Ness *et al.*, "Magnetic fields at Uranus," *Science*, vol. 233, no. 4759, pp. 85–89, 1986, doi: 10.1126/science.233.4759.85.

[7] N. F. Ness *et al.*, "Magnetic fields at Neptune," *Science*, vol. 246, no. 4936, pp. 1473–1478, 1989, doi: 10.1126/science.246.4936.1473.

[8] B. J. Anderson *et al.*, "Low-degree structure in Mercury's planetary magnetic field," *J. Geophys. Res. Planets*, vol. 117, no. E12, Art. no. 2012JE004159, 2012, doi: 10.1029/2012JE004159. (Not opened; its abstract's 190 nT $R_M^3$ and 479 ± 6 km.)

[9] T. Weber *et al.*, "Updated spherical harmonic magnetic field moments of Ganymede from the Juno flyby," *Geophys. Res. Lett.*, vol. 49, no. 23, Art. no. e2022GL098633, 2022, doi: 10.1029/2022GL098633. (Its coefficients as libinternalfield transcribes them.)

[10] B. Langlais, E. Thébault, A. Houliez, M. E. Purucker, and R. J. Lillis, "A new model of the crustal magnetic field of Mars using MGS and MAVEN," *J. Geophys. Res. Planets*, vol. 124, no. 6, pp. 1542–1569, 2019, doi: 10.1029/2018JE005854. Full text via NTRS 20190026599. (Coefficients via libinternalfield.)

[11] R. A. Langel, "The main field," in *Geomagnetism*, vol. 1, J. A. Jacobs, Ed. London, U.K.: Academic Press, 1987, pp. 249–512.

[12] A. C. Fraser-Smith, "Centered and eccentric geomagnetic dipoles and their poles, 1600–1985," *Rev. Geophys.*, vol. 25, no. 1, pp. 1–16, 1987, doi: 10.1029/RG025i001p00001.

[13] H. B. Garrett *et al.*, "The JPL Uranian Radiation Model (UMOD)," Jet Propulsion Laboratory, Pasadena, CA, USA, JPL Publication 15-7, 2015. Tables 1–3. [Online]. Available: https://ntrs.nasa.gov/citations/20160009378

[14] H. B. Garrett *et al.*, "The JPL Neptune Radiation Model (NMOD)," Jet Propulsion Laboratory, Pasadena, CA, USA, JPL Publication 17-2, 2017. Table 1. [Online]. Available: https://ntrs.nasa.gov/citations/20170006886

[15] B. A. Archinal *et al.*, "Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015," *Celest. Mech. Dyn. Astron.*, vol. 130, no. 3, Art. no. 22, 2018, doi: 10.1007/s10569-017-9805-5.

[16] M. James, "libinternalfield," GitHub, MIT licence. [Online]. Available: https://github.com/mattkjames7/libinternalfield (Cassini 11's coefficient file).

[17] M. G. Kivelson, K. K. Khurana, and M. Volwerk, "The permanent and inductive magnetic moments of Ganymede," *Icarus*, vol. 157, no. 2, pp. 507–522, 2002, doi: 10.1006/icar.2002.6834.

[18] T. M. Edwards, E. J. Bunce, and S. W. H. Cowley, "A note on the vector potential of Connerney et al.'s model of the equatorial current sheet in Jupiter's magnetosphere," *Planet. Space Sci.*, vol. 49, no. 10–11, pp. 1115–1123, 2001, doi: 10.1016/S0032-0633(00)00164-1.

[19] J. E. P. Connerney, M. H. Acuña, and N. F. Ness, "Modeling the Jovian current sheet and inner magnetosphere," *J. Geophys. Res.*, vol. 86, no. A10, pp. 8370–8384, 1981, doi: 10.1029/JA086iA10p08370.

[20] G. V. Starkov, "Mathematical model of the auroral boundaries," *Geomagn. Aeron.*, vol. 34, no. 3, pp. 331–336, 1994. (Not opened; its coefficients as [16] gives them.)

[21] F. Sigernes *et al.*, "Real time aurora oval forecasting — SvalTrackII," *Opt. Pura Apl.*, vol. 44, no. 4, pp. 599–603, 2011. Eqs. 1–3, Table 1. [Online]. Available: https://folk.uib.no/st07350/papers/sigernes2011OPA599.pdf

[22] G. V. Starkov, "Statistical dependences between the magnetic activity indices," *Geomagn. Aeron.*, vol. 34, no. 1, pp. 101–103, 1994. (Not opened; its fit as [16] gives it.)

[23] J. Matzka, C. Stolle, Y. Yamazaki, O. Bronkalla, and A. Morschhauser, "The geomagnetic Kp index and derived indices of geomagnetic activity," *Space Weather*, vol. 19, no. 5, Art. no. e2020SW002641, 2021, doi: 10.1029/2020SW002641.

[24] G. Gustafsson, N. E. Papitashvili, and V. O. Papitashvili, "A revised corrected geomagnetic coordinate system for Epochs 1985 and 1990," *J. Atmos. Terr. Phys.*, vol. 54, no. 11–12, pp. 1609–1631, 1992, doi: 10.1016/0021-9169(92)90167-J.

[25] NOAA Space Weather Prediction Center, "Aurora - 30 minute forecast," ovation_aurora_latest.json. [Online]. Available: https://www.swpc.noaa.gov/products/aurora-30-minute-forecast (data: https://services.swpc.noaa.gov/json/ovation_aurora_latest.json). US Government work.

[26] P. T. Newell, T. Sotirelis, and S. Wing, "Diffuse, monoenergetic, and broadband aurora: The global precipitation budget," *J. Geophys. Res. Space Phys.*, vol. 114, no. A9, Art. no. 2009JA014326, 2009, doi: 10.1029/2009JA014326.

[27] P. T. Newell *et al.*, "OVATION Prime-2013: Extension of auroral precipitation model to higher disturbance levels," *Space Weather*, vol. 12, no. 6, pp. 368–379, 2014, doi: 10.1002/2014SW001056.

[28] J. T. Clarke *et al.*, "Jupiter's aurora," in *Jupiter: The Planet, Satellites and Magnetosphere*, F. Bagenal, T. E. Dowling, and W. B. McKinnon, Eds. Cambridge, U.K.: Cambridge Univ. Press, 2004, ch. 26, pp. 639–670. (The 20–30 $R_J$ mapping as later papers cite it.)

[29] W. R. Pryor *et al.*, "The auroral footprint of Enceladus on Saturn," *Nature*, vol. 472, no. 7343, pp. 331–333, 2011, doi: 10.1038/nature09928.

[30] V. Hue *et al.*, "The Io, Europa, and Ganymede auroral footprints at Jupiter in the ultraviolet: Positions and equatorial lead angles," *J. Geophys. Res. Space Phys.*, vol. 128, no. 5, Art. no. e2023JA031363, 2023, doi: 10.1029/2023JA031363. Table 1. Preprint: arXiv:2304.14949.

[31] S. V. Badman *et al.*, "A statistical analysis of the location and width of Saturn's southern auroras," *Ann. Geophys.*, vol. 24, no. 12, pp. 3533–3545, 2006, doi: 10.5194/angeo-24-3533-2006.

[32] H. Melin *et al.*, "Discovery of H3+ and infrared aurorae at Neptune with JWST," *Nat. Astron.*, vol. 9, no. 5, pp. 666–671, 2025, doi: 10.1038/s41550-025-02507-9.

[33] L. Lamy *et al.*, "The aurorae of Uranus past equinox," *J. Geophys. Res. Space Phys.*, vol. 122, no. 4, pp. 3997–4008, 2017, doi: 10.1002/2017JA023918. (Not opened; its abstract.)

[34] P. D. Feldman *et al.*, "HST/STIS ultraviolet imaging of polar aurora on Ganymede," *Astrophys. J.*, vol. 535, no. 2, pp. 1085–1090, 2000, doi: 10.1086/308889. (As Milby et al. 2024, arXiv:2409.06055, summarise it.)

[35] J.-L. Bertaux *et al.*, "Discovery of an aurora on Mars," *Nature*, vol. 435, no. 7043, pp. 790–794, 2005, doi: 10.1038/nature03603.

[36] D. A. Brain *et al.*, "On the origin of aurorae on Mars," *Geophys. Res. Lett.*, vol. 33, no. 1, Art. no. 2005GL024782, 2006, doi: 10.1029/2005GL024782.

[37] G. D. Reeves and I. A. Daglis, "Geospace magnetic storms and the Van Allen radiation belts," in *Waves, Particles, and Storms in Geospace*, G. Balasis, I. A. Daglis, and I. R. Mann, Eds. Oxford, U.K.: Oxford Univ. Press, 2016, ch. 3, doi: 10.1093/acprof:oso/9780198705246.003.0004.

[38] E. Roussos and P. Kollmann, "The radiation belts of Jupiter and Saturn," in *Magnetospheres in the Solar System*, Geophys. Monogr. Ser., vol. 259. Washington, DC, USA: AGU/Wiley, 2021, pp. 499–514, doi: 10.1002/9781119815624.ch32. Preprint: arXiv:2006.14682.

[39] E. Roussos *et al.*, "A radiation belt of energetic protons located between Saturn and its rings," *Science*, vol. 362, no. 6410, Art. no. eaat1962, 2018, doi: 10.1126/science.aat1962.

[40] J. F. Cooper and E. C. Stone, "Electron signatures of satellite sweeping in the magnetosphere of Uranus," *J. Geophys. Res. Space Phys.*, vol. 96, no. A5, pp. 7803–7821, 1991, doi: 10.1029/90JA02629. (Not opened; its abstract.)

[41] B. H. Mauk *et al.*, "The magnetosphere of Neptune: Hot plasmas and energetic particles," *J. Geophys. Res. Space Phys.*, vol. 96, no. S01, pp. 19061–19084, 1991, doi: 10.1029/91JA01820. (Not opened; its abstract.)

[42] NOAA National Centers for Environmental Information, "Geomag 7.0" (geomag70_linux.tar.gz: sample_coords.txt, sample_out_IGRF13.txt, IGRF13.COF). [Online]. Available: https://www.ngdc.noaa.gov/IAGA/vmod/igrf.html

[43] NOAA National Centers for Environmental Information, "Magnetic Field Calculator," model IGRF (IGRF2025). [Online]. Available: https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml#igrfwmm (read 18 Nov. 2026).

[44] J. E. P. Connerney, M. H. Acuña, and N. F. Ness, "The magnetic field of Uranus," *J. Geophys. Res.*, vol. 92, no. A13, pp. 15329–15336, 1987, doi: 10.1029/JA092iA13p15329.

[45] N. A. Tsyganenko, "A magnetospheric magnetic field model with a warped tail current sheet," *Planet. Space Sci.*, vol. 37, no. 1, pp. 5–20, 1989, doi: 10.1016/0032-0633(89)90066-4.

[46] S. Tian, "geopack: Python version of geopack and Tsyganenko models," GitHub, MIT licence. [Online]. Available: https://github.com/tsssss/geopack (T89 and its test values, as ported to `t89.js`).

[47] J. T. Hoeksema, "Structure and evolution of the large scale solar and heliospheric magnetic fields," Ph.D. dissertation, Stanford Univ., Stanford, CA, USA, 1984.

[48] X. Sun, "Notes on PFSS extrapolation," Wilcox Solar Observatory, Stanford Univ., 2009. [Online]. Available: http://wso.stanford.edu/words/pfss.pdf

[49] Wilcox Solar Observatory, "Radial PFSS harmonic coefficients" (Harmonic.rad, one file a Carrington rotation) and "Polar field observations." [Online]. Available: http://wso.stanford.edu/Harmonic.rad/ and http://wso.stanford.edu/Polar.html (read 18 Nov. 2026). Data use: http://wso.stanford.edu/DataPolicy.html. For the coronal field maps WSO asks for J. T. Hoeksema, J. M. Wilcox, and P. H. Scherrer, "The structure of the heliospheric current sheet: 1978–1982," *J. Geophys. Res.*, vol. 88, no. A12, pp. 9910–9918, 1983, doi: 10.1029/JA088iA12p09910.

[50] J. E. P. Connerney, M. H. Acuña, and N. F. Ness, "Currents in Saturn's magnetosphere," *J. Geophys. Res.*, vol. 88, no. A11, pp. 8779–8789, 1983, doi: 10.1029/JA088iA11p08779. (Not opened; its parameters as [51] gives them.)

[51] E. J. Bunce and S. W. H. Cowley, "A note on the ring current in Saturn's magnetosphere: Comparison of magnetic data obtained during the Pioneer-11 and Voyager-1 and -2 fly-bys," *Ann. Geophys.*, vol. 21, no. 3, pp. 661–669, 2003, doi: 10.5194/angeo-21-661-2003.

[52] J. D. Jackson, *Classical Electrodynamics*, 3rd ed. New York, NY, USA: Wiley, 1999, sec. 5.5.

[53] M. G. Kivelson *et al.*, "Ganymede's magnetosphere: Magnetometer overview," *J. Geophys. Res. Planets*, vol. 103, no. E9, pp. 19963–19972, 1998, doi: 10.1029/98JE00227. (Not opened; the vacuum-superposition picture as it is widely cited.)

[54] J.-H. Shue *et al.*, "Magnetopause location under extreme solar wind conditions," *J. Geophys. Res. Space Phys.*, vol. 103, no. A8, pp. 17691–17700, 1998, doi: 10.1029/98JA01103. Eqs. 1, 10, 11. Author copy: https://faculty.epss.ucla.edu/~ctrussell/russell_bib.html/papers/mpause_extreme/

[55] M. H. Farris and C. T. Russell, "Determining the standoff distance of the bow shock: Mach number dependence and use of models," *J. Geophys. Res. Space Phys.*, vol. 99, no. A9, pp. 17681–17689, 1994, doi: 10.1029/94JA01020. (Not opened; as [56] gives it.)

[56] B. Volpes and V. Bothmer, "An application of the stereoscopic self-similar-expansion model to the determination of CME-driven shock parameters," *Sol. Phys.*, vol. 290, no. 10, pp. 3005–3022, 2015, doi: 10.1007/s11207-015-0775-z. Eqs. 7–9. Preprint: arXiv:1509.03181.

[57] M. J. Rutala *et al.*, "New models of Jupiter's magnetopause and bow shock through the Juno prime mission: Probabilistic location, shape, and internally-driven variation," *J. Geophys. Res. Space Phys.*, vol. 130, no. 5, Art. no. e2025JA033842, 2025, doi: 10.1029/2025JA033842. Eq. 2, Tables 2 and 4, from the preprint arXiv:2502.09186v2.

[58] N. M. Pilkington *et al.*, "Internally driven large-scale changes in the size of Saturn's magnetosphere," *J. Geophys. Res. Space Phys.*, vol. 120, no. 9, pp. 7289–7306, 2015, doi: 10.1002/2015JA021290. Eqs. 1–3, Table 1.

[59] NOAA Space Weather Prediction Center, "Propagated solar wind" (geospace product, propagated-solar-wind.json, 7 days). [Online]. Available: https://services.swpc.noaa.gov/products/geospace/propagated-solar-wind.json (read 18 Nov. 2026). US Government work.

[60] E. N. Parker, "Dynamics of the interplanetary gas and magnetic fields," *Astrophys. J.*, vol. 128, p. 664, 1958, doi: 10.1086/146579.

[61] Wilcox Solar Observatory, "Computed 'tilt angle' of the heliospheric current sheet" (tilts updated 23 Oct. 2025). [Online]. Available: http://wso.stanford.edu/Tilts.html (read 18 Nov. 2026).

[62] B. Bonfond, D. Grodent, J.-C. Gérard, T. Stallard, J. T. Clarke, M. Yoneda, A. Radioti, and J. Gustin, "Auroral evidence of Io's control over the magnetosphere of Jupiter," *Geophys. Res. Lett.*, vol. 39, no. 1, Art. no. L01105, 2012, doi: 10.1029/2011GL050253. (Not opened; its reference ovals' centres as [63] gives them.)

[63] L. A. Head *et al.*, "Effect of magnetospheric conditions on the morphology of Jupiter's ultraviolet main auroral emission as observed by Juno-UVS," *Astron. Astrophys.*, vol. 688, Art. no. A205, 2024, doi: 10.1051/0004-6361/202450253. Sec. 4.1. Preprint: arXiv:2404.04030.
