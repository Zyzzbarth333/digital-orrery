# Surface maps, rings, stars and daily Earth

Where every image the scene draws comes from, how it is turned into a
texture, and how it is put on the body. Code: `python/textures/` (the
conversion), `src/scene/surfaces.ts`, `bodyMaterial.ts`, `rings.ts`,
`stars.ts` and `clouds.ts`.

## Sources and credits

All NASA, USGS and NOAA products are US-government public domain; the
credit lines are the ones each source asks for. Solar System Scope maps
([solarsystemscope.com/textures](https://www.solarsystemscope.com/textures/))
are [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and need their
attribution, with a link to the licence; the app's Credits list gives both.

| Body | Map | Source | Credit |
| --- | --- | --- | --- |
| Earth | Day colour, one per month (5400×2700) | Blue Marble Next Generation, 2004 base (no relief shading) | NASA Earth Observatory (Reto Stöckli) |
| Earth | Night lights (13500×6750 grey) | Black Marble 2016 | NASA Earth Observatory |
| Earth | Relief (8192×4096, 16-bit metres) | ETOPO 2022 15″ surface elevation, via the NCEI ImageServer | NOAA National Centers for Environmental Information, doi:10.25921/fd45-gt74 |
| Earth | Daily true colour for the sim date | GIBS VIIRS (NOAA-21, NOAA-20, Suomi NPP) and MODIS Terra corrected reflectance | NASA Global Imagery Browse Services (GIBS), part of NASA ESDIS |
| Moon | Colour (8192×4096) and elevation (16 px/deg) | CGI Moon Kit: LRO LROC colour, LOLA LDEM | NASA's Scientific Visualization Studio |
| Mars | Colour (8192×4096) | Viking MDIM 2.1 colour mosaic, USGS map server | NASA/JPL, USGS Astrogeology |
| Mars | Elevation (16 px/deg) | MOLA MEGDR, PDS Geosciences Node | NASA/GSFC MOLA Science Team |
| Mercury | Colour (8192×4096) | MESSENGER MDIS colour, USGS map server | NASA/JHUAPL/Carnegie Institution of Washington, USGS Astrogeology |
| Pluto | Mosaic (8192×4096) | New Horizons LORRI/MVIC, USGS map server | NASA/JHUAPL/SwRI, USGS Astrogeology |
| Jupiter | Global map (3601×1801) | Cassini PIA07782 | NASA/JPL/Space Science Institute |
| Venus | Cloud tops (4096×2048) | Solar System Scope | Solar System Scope, CC BY 4.0, based on NASA imagery |
| Saturn, Uranus, Neptune | Colour (4096, 2048, 2048 wide) | Solar System Scope | Solar System Scope, CC BY 4.0, based on NASA imagery |
| Phobos | Viking Orbiter mosaic, 40 px/deg, DLR control (2048×1024) | USGS Astrogeology GeoTIFF (Stooke) | NASA/JPL, USGS Astrogeology |
| Deimos | Viking Orbiter map (2048×1024) | USGS map server (Philip Stooke, 2001; Thomas et al. shape model) | NASA/JPL, USGS Astrogeology |
| Io | Galileo SSI and Voyager colour mosaic, 1 km/px (4096×2048) | USGS map server | NASA/JPL, USGS Astrogeology |
| Europa, Ganymede, Callisto | Galileo SSI and Voyager mosaics, 500 m and 1 km/px (4096×2048 grey) | USGS map server | NASA/JPL, USGS Astrogeology |
| Mimas, Dione, Rhea, Iapetus | Cassini ISS and Voyager mosaics, 154–803 m/px (2048×1024 grey) | USGS map server | NASA/JPL/Space Science Institute, USGS Astrogeology |
| Enceladus, Tethys | Cassini ISS mosaics, 110 and 293 m/px (2048×1024 grey) | USGS map server | NASA/JPL/Space Science Institute, USGS Astrogeology |
| Triton | Voyager 2 mosaic, 600 m/px (4096×2048, kept grey) | USGS map server (Paul Schenk, LPI) | NASA/JPL, USGS Astrogeology |
| Charon | New Horizons LORRI/MVIC mosaic, 300 m/px (2048×1024 grey) | USGS map server | NASA/JHUAPL/SwRI, USGS Astrogeology |
| Saturn's rings | Normal optical depth, 10 km bins | Cassini UVIS 126 Tau egress occultation (COUVIS_8001) | NASA PDS Ring-Moon Systems Node (Colwell et al.) |
| Stars | The Hipparcos main catalogue: 83,392 stars to V 9 with V and B−V | ESA 1997 (SP-1200), via NASA HEASARC | ESA, *The Hipparcos and Tycho Catalogues* (1997) |
| Milky Way | Map of the light between the stars (Hipparcos and Tycho stars removed), 8192×4096, refined to 16384×8192 in tiles where the screen can show it | Deep Star Maps 2020, Milky Way layer (Hipparcos-2, Tycho-2, Gaia DR2) | NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC |

The Venus surface is not shown: in visible light Venus is its cloud deck.
No Sun map is used, since at its true brightness the disc saturates to
white.

### The moons' maps

Fourteen of the twenty major moons have a USGS Astrogeology global mosaic,
fetched by `python/textures/fetch_moons.py`. The USGS lists each as public
domain, or with no access constraint (Europa, Charon); the credits name the
missions and USGS. Most are single requests to the USGS planetary map server
(WMS `GetMap`, `EPSG:4326`, `BBOX=-180,-90,180,90`), which reprojects each
mosaic to the layout below whatever its own longitude convention. The
server's only Phobos layer is a synthetic shaded relief, so Phobos uses the
full 99 MB Viking GeoTIFF instead.

- **Colour.** Io's map is the colour mosaic. The others are grey, and are
  drawn in the moon's catalogue colour (`tint` in the manifest): the shader
  scales that colour to unit luminance, so the map's mean still sets the
  geometric albedo. Triton's mosaic is in colour, but synthesised from
  orange, violet and ultraviolet filters (green and blue-white, not the
  real pinkish white), so it is used grey too.
- **Gaps.** Where no spacecraft imaged (Triton north of about 45° N,
  Charon south of about 30° S, Galilean polar gaps), the mosaic is solid
  black or white. Blocks of that value at least 1/256 of the width across
  are filled with the imaged part's mean colour (linear light, weighted by
  area) and their edge softened, so an unseen pole shows the moon's mean
  colour.
- **Photometry.** These mosaics are normalised for mapping, so albedo
  contrasts are weaker than on the real moons. Iapetus shows it most: its
  dark leading hemisphere (Cassini Regio) is about ten times darker than the
  trailing side, but only about a quarter darker in the mosaic.
- **Not mapped.** Titan, since in visible light it is its haze (its surface
  maps are near-infrared), and the five Uranian moons. Voyager 2 saw only
  their southern hemispheres, and USGS publishes no digital global mosaic
  of them.

Each map's orientation was checked against named features at their IAU
positions: Io's Pele (105° E, 19° S) and Loki; Europa's Pwyll (89° E,
25° S); Ganymede's Tros; Callisto's Asgard; Mimas's Herschel (112° W);
Tethys's Odysseus (129° W, 33° N); Rhea's Inktomi; Dione's bright wispy
fractures on its trailing (+90° E) side; Phobos's Stickney (49° W);
Deimos's Voltaire and Swift (just west of 0°); Triton's cantaloupe terrain
west of 0° and walled plains east of it; and Charon's dark north pole
(Mordor Macula).

## One layout for every map

Every map is equirectangular, with its west edge at −180° east longitude and
its top row at +90° latitude. Sources in other layouts are rolled to it (the
MOLA grid starts at 0° E). The USGS map server returns at most 4096 pixels a
side, so its maps are fetched as west and east halves and joined.

The moons' body frame (`moonAxesEqj`) puts 0° longitude toward the planet
and Z along the IAU's north pole, so their maps, east-positive about that
pole, need no flip: see [moons](moons.md#drawing).

Conventions were checked against known features, not assumed: on the Moon
the nearside maria are dark and the farside highlands bright where expected,
and the lowest part of the LOLA grid falls in the South Pole–Aitken basin
(148° W, 62° S) with the range −8.98 to +10.69 km.

## Putting a map on a body

The shader turns each surface point into body-fixed longitude and latitude
with the body's real rotation ([body orientation](../physics/orientation.md))
and looks the map up there, so the right longitude is under the Sun at the
sim time. Near ±180° it takes the texture derivatives from whichever of
$u$ and $u + \tfrac12$ is continuous, so there is no seam.

**Brightness.** (Earth is calibrated differently; see [below](#earths-brightness).) A map gives the pattern; its scale is set so the area-
weighted mean reflectance matches the body's geometric albedo
([lighting](lighting.md#surface-reflectance)): the mean linear luminance
$\bar L$ of the map (rows weighted by $\cos\varphi$) is scaled to $1.5p$
(Lambert) or $p$ (Lommel–Seeliger).

**Relief.** Elevation $h(\lambda, \varphi)$ becomes a normal map at true
scale. On a sphere of radius $R$ the east and north slopes are

$$
\frac{\partial h}{\partial E} = \frac{1}{R\cos\varphi}\frac{\partial h}{\partial\lambda},
\qquad
\frac{\partial h}{\partial N} = \frac{1}{R}\frac{\partial h}{\partial\varphi},
$$

and the surface normal in east-north-up components is
$\hat n = \operatorname{normalize}(-\partial h/\partial E,\ -\partial h/\partial N,\ 1)$,
stored as $(\hat n + 1)/2$. The heights are first averaged down to the
output grid, so the slopes are those the grid can show. The shader rotates
$\hat n$ into the scene with the body-fixed east, north and up directions.
Relief is not exaggerated: from orbit it shows in the shading along the
terminator, as it does in real images. On Earth the sea floor is flattened
to sea level for shading, since water covers it, and clouds in the daily
image hide the relief beneath them.

**Night lights.** The Black Marble greyscale, tinted to the colour of
mostly sodium and LED street lighting, is added on the night side, fading
across the terminator. It is drawn at a display brightness, not
photometrically: a camera exposed for daylight would not record it.

## Daily Earth

For a sim date from 24 February 2000 to today, Earth's day side shows
that UTC day's GIBS true-colour mosaic (4096×2048; for today, which is still
filling in, yesterday's), the newest satellite
whose record covers the day first. It is one image per day from polar
orbiters crossing the equator at about 10:30 (Terra) or 13:30 (VIIRS) local
time: the weather that day, not that minute. Pure-black pixels are no data
(polar night, swath gaps) and show the Blue Marble instead. The image is
calibrated like the base map (below), dropped when the sim moves more than
about a day from it, and not fetched while time runs faster than
a day per second.

### Earth's brightness

Earth's images are not normalised to its geometric albedo like the other
maps: a cloud-free base map scaled to the whole planet's albedo (clouds
included) would make the ground several times too bright. NASA publishes no
inverse of the true-colour stretch, so the images are calibrated to a known
bright target: the brightest 0.5 % of each image (fresh snow, thick cloud
tops) is set to reflectance 0.9, and the rest scales linearly. For the Blue
Marble that scale is 0.98, so the map is already close to linear
reflectance. Bare ocean then reflects a few per cent and looks near-black,
as it does without an atmosphere: the blue of Earth from space is Rayleigh
scattering, which the corrected-reflectance imagery also removes and the
[atmosphere model](atmospheres.md) adds back.

## Saturn's rings

The profile is the Cassini UVIS stellar occultation of 126 Tau (egress,
2005), 70,385 to 141,372 km in 10 km bins. Its optical depth $-1$
("unconstrained") is used for three things, handled separately:

| Case | Where | Value used |
| --- | --- | --- |
| Signal flagged missing | 81,928–84,188 km (C ring) | interpolated from either side |
| Signal at or above the unocculted star | the Colombo, Maxwell, Huygens, Encke and Keeler gaps | 0 |
| Inside the C ring's inner edge | 70,385–74,490 km (D ring) | 0 |

Where the measured depth reaches 95 % of the maximum detectable depth the
star was fully blocked (37 % of the B ring core): the true depth is only
known to exceed about 1.9, so those bins are set to 5, effectively opaque.
Taking 1.9 literally would leave the B ring 14 % transparent face-on.

The ring photometry, transparency and shadow on Saturn are in
[lighting](lighting.md#saturns-rings).

## Stars

The sky is two layers, both downloaded with the user's approval on
14 November 2026 and kept as originals in the texture source folder (the
8k and 16k Milky Way the same afternoon; the 4k one is kept as the white
reference):

| Layer | Source | Download | Shipped |
| --- | --- | --- | --- |
| The light between the stars | NASA SVS Deep Star Maps 2020 ([SVS 4851](https://svs.gsfc.nasa.gov/4851/)), Milky Way layer `milkyway_2020_8k.exr` and `milkyway_2020_16k.exr` (the full star map with the Hipparcos and Tycho stars taken out); `_4k.exr` for the white | 137.3 MB, 434.0 MB (4k: 36.4 MB) | `stars/milky-way-8k.webp`, 8192 × 4096 8-bit sRGB, 14.9 MB; `stars/milky-way-16k/`, 128 tiles of 1024 × 1024 (1028 with their edges), 58 MB in all |
| The stars | The Hipparcos main catalogue (ESA 1997), 118,218 stars, from NASA HEASARC (`heasarc_hipparcos.tdat.gz`) | 14.8 MB | `stars/hipparcos.bin`, the 83,392 stars to V 9.0, 0.83 MB |

**The Milky Way map** is plate carrée in ICRF (J2000 equatorial), centred on
RA 0h with RA increasing to the left, in linear half-float light. Its
pixels hold light per pixel, not per steradian: each doubling of the
resolution quarters them (an 8k map averaged down to 4k matches the 4k map
to within 1 %). So the 8k map is multiplied by 4 and the 16k by 16, and
both are written as sRGB with the 4k map's white, its brightest 0.01 %
(0.013 % of the 8k pixels then clip, 0.1 % of the light). The scene draws
it at half that (lighting.md), as before. Stars fainter than Tycho's limit stay in it as
unresolved light, so the Milky Way's grain is real; stars between V 9 and
Tycho's limit (about V 11.5) are in neither layer, which at the scene's
display level is below visibility anyway.

**The star file** holds, per star, five int16: x, y, z of the J2000 unit
vector times 32,767 (about 6″ resolution), V × 1,000 and B−V × 1,000
(−32,768 for the 131 stars without one, drawn at the Sun's 0.65). The
catalogue's positions are ICRS at epoch J1991.25; proper motion since then
(under 1′ for all but a handful) is not applied.

**Colour** comes from B−V in the app (`stars.ts`, `bvToRgb`): a temperature
from Ballesteros's (2012) formula,
T = 4600 (1/(0.92 (B−V) + 1.7) + 1/(0.92 (B−V) + 0.62)) K, a Planck spectrum
at that temperature integrated over 380–780 nm with the CIE 1931
colour-matching functions (Wyman, Sloan and Shirley's 2013 multi-lobe fit),
and the XYZ-to-linear-sRGB matrix, at luminance 1. As a check, B−V 0.65
gives 5,778 K and (1.11, 0.98, 0.91), against (1.10, 0.98, 0.94) from the
Sun's measured chromaticity ([lighting](lighting.md#the-sun)).

**Credits**, as the SVS page asks (checked 14 November 2026; it states no
licence terms beyond credit; the 8k and 16k maps are the same product): NASA/Goddard Space Flight Center Scientific
Visualization Studio; Gaia DR2: ESA/Gaia/DPAC. Hipparcos: ESA 1997, *The
Hipparcos and Tycho Catalogues*, ESA SP-1200, via NASA HEASARC; ESA makes the
catalogue freely available with this acknowledgement.

An earlier stopgap split the SVS combined star map into points and
background on the machine (commit 4a660fe); it is replaced by these.

## Loading

A body's maps load the first time its disc is more than three pixels
in radius (six across), or when a flight to it starts ([camera](camera.md#maps-on-the-way)).
Maps run to 8192 × 4096, about 180 MB of video memory each with mipmaps,
and loading them used to freeze the page for up to two seconds. Now:

- **Decoding** happens in a worker (`decode.worker.ts`): it fetches the
  file, decodes and flips it with `createImageBitmap`, and transfers the
  bitmap back. Doing that on the main thread still blocked it for 59 ms (no
  options) to 246 ms (flipped, not premultiplied) per 8k map after the
  decode itself. Body maps are opaque, so they are premultiplied, which
  changes no value; the cloud mosaic has alpha and is not.
- **Uploading** happens 4 MB per frame at the top of the frame
  (`TextureUploader` in `surfaces.ts`): an immutable texture
  (`texStorage2D`) is filled in strips with `texSubImage2D`, mipmapped once
  and handed to three.js as an `ExternalTexture`. One `texImage2D` of an 8k
  map blocked for 0.41–0.55 s; a 128-row strip takes 2–3 ms, so the map goes
  up over about 32 frames.
- **Earth's months**: only the current month's day map is kept; the
  previous one (78 MB) is freed when the month changes.
- **A lost WebGL context** takes these textures with it, so on restore the
  maps load again.

### Loading the sky

The field of view is fixed at 45° vertically, so the sky's magnification
depends only on the canvas's height in device pixels. The 8k Milky Way has
22.8 texels a degree: about one a pixel on a 1080-line canvas (24 px a
degree), and it loads at start like the other maps (179 MB with mipmaps,
against 45 MB for the old 4k). On a taller canvas (a 1440-line screen, or
a 2× display) its texels are magnified, and the full 16k map would take
0.7 GB of video memory with mipmaps, more than an integrated GPU should
give a backdrop. So the 16k map is cut into 1024-px tiles, each stored
with 2 px of its neighbours on every side (wrapped in RA, repeated at the
poles) so filtering never sees a seam, and `skyDetail.ts` keeps only those
in view:

- **When.** The tiles are used while a pixel, at the canvas's full
  resolution (not the adaptive render scale's), is under 0.8 of a base
  texel: canvases taller than about 1,300 device pixels. Otherwise their
  memory is freed.
- **Which.** Each frame 25 × 15 view directions are mapped to tiles, and
  only directions where a pixel is under two 16k texels count (near the
  poles the map is stretched across, and the 8k map suffices). The most
  wanted tiles are fetched and decoded in the worker, three at a time, and
  uploaded one a frame (4.2 MB) into a texture array of 24 layers (101 MB,
  one level). A tile out of view gives its layer to a new one, the longest
  unseen first.
- **How.** The shader treats a tile as the base map's missing finer mip
  level: from the base's own derivatives it finds the 16k level of detail
  λ and mixes in the tile by 1 − λ (all tile at λ ≤ 0, all base at λ ≥ 1).
  Where a tile has not arrived the base shows, slightly softer.

## Rebuilding

```bash
python3 python/textures/build_textures.py            # all bodies
python3 python/textures/build_textures.py --only moon,rings
python3 python/textures/fetch_moons.py               # the moons' sources (about 160 MB)
python3 python/textures/build_textures.py --only io,europa,triton
```

The sources live outside the repo in `~/.cache/digital-orrery/textures-src`
(about 535 MB with the moons'). Converted textures go to `public/textures/` with
`manifest.json`; without the manifest every body keeps its flat albedo
colour.
