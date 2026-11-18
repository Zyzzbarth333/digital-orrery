# Credits

Every data source, map, font and library the app uses, with a link to where it comes from and its terms. Each map's details are in [Textures](frontend/textures.md), and each dataset's in the page that uses it.

**Surfaces, sky and imagery**

| Source | Used for | Terms |
| --- | --- | --- |
| NASA Earth Observatory: [Blue Marble](https://visibleearth.nasa.gov/collection/1484/blue-marble), [Black Marble](https://earthobservatory.nasa.gov/features/NightLights) | the Earth's surface and night lights | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) |
| [NASA GIBS](https://nasa-gibs.github.io/gibs-api-docs/) (ESDIS) | the Earth's clouds on the sim date | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) |
| NOAA NCEI: [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model), [doi:10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74) | the Earth's relief | NOAA, public domain |
| NASA Scientific Visualization Studio: [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/); [Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851/) ([Gaia DR2](https://www.cosmos.esa.int/web/gaia/dr2): ESA/Gaia/DPAC) | the Moon's surface and relief; the Milky Way | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/); ESA credit |
| [ESA Hipparcos Catalogue](https://www.cosmos.esa.int/web/hipparcos/catalogues) (ESA SP-1200), via [NASA HEASARC](https://heasarc.gsfc.nasa.gov/W3Browse/all/hipparcos.html) | the stars | ESA credit |
| NASA/JPL and [USGS Astrogeology](https://astrogeology.usgs.gov/search): Viking, Galileo, Voyager and Cassini mosaics (Cassini's with the Space Science Institute; Deimos by Philip Stooke); each map's page is linked in [textures.md](frontend/textures.md) | Mars and fourteen moons' surfaces | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/), [USGS](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits) |
| NASA/GSFC MOLA Science Team: [MEGDR](https://pds-geosciences.wustl.edu/missions/mgs/megdr.html), via the PDS Geosciences Node | Mars's relief | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) |
| NASA/JHUAPL/Carnegie Institution of Washington: [MESSENGER MDIS mosaic](https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_basemap_enhanced_color_global_mosaic_665m) | Mercury's surface | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) |
| NASA/JHUAPL/SwRI: [New Horizons mosaics](https://astrogeology.usgs.gov/search/map/pluto_new_horizons_lorri_mvic_global_mosaic_300m) | Pluto's and Charon's surfaces | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) |
| NASA/JPL/Space Science Institute: Cassini, [PIA07782](https://photojournal.jpl.nasa.gov/catalog/PIA07782) | Jupiter's map | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) |
| [NASA PDS Ring-Moon Systems Node](https://pds-rings.seti.org/): Cassini UVIS occultations | Saturn's ring profile | [NASA](https://www.nasa.gov/nasa-brand-center/images-and-media/) |
| [Solar System Scope](https://www.solarsystemscope.com/textures/) | Venus's clouds; Saturn, Uranus and Neptune maps | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

**Ephemerides, gravity and reference data**

| Source | Used for |
| --- | --- |
| [NASA JPL](https://ssd.jpl.nasa.gov/planets/eph_export.html) and [NAIF SPICE](https://naif.jpl.nasa.gov/naif/data_generic.html): DE442, the satellite kernels, `pck00011`, [`sb441-n16`](https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/), Earth orientation kernels | the planets', moons', Sun's and asteroids' positions; body shapes and rotation; the Earth's UT1 and polar motion |
| JPL Solar System Dynamics: [satellite mean elements](https://ssd.jpl.nasa.gov/sats/elem/); [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/); the [Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_query.html) | moons outside their tables' years, radii, GMs and albedos; the 135,353 asteroids and comets |
| [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT) | positions outside 2000–2050, and the Galilean moons' fallback |
| EGM2008 (NGA), via [GFZ ICGEM](https://icgem.gfz-potsdam.de/); GRAIL GL0660B (NASA/JPL), via the [PDS Geosciences Node](https://pds-geosciences.wustl.edu/missions/grail/default.htm) | the Earth's and the Moon's gravity fields |
| [CelesTrak](https://celestrak.org/SpaceData/) (NOAA SWPC, GFZ) | space weather for the upper atmosphere's density; the Kp index for the auroras |
| [IGRF-14](https://www.ngdc.noaa.gov/IAGA/vmod/igrf.html) (IAGA V-MOD, via NOAA NCEI); JRM33 ([Connerney et al. 2022](https://doi.org/10.1029/2021JE007055), its supporting tables via [Caltech](https://authors.library.caltech.edu/records/dds0z-2vx98)); Cassini 11 ([Cao et al. 2020](https://doi.org/10.1016/j.icarus.2019.113541)), via [libinternalfield](https://github.com/mattkjames7/libinternalfield) (MIT); Voyager's dipoles ([Ness et al. 1986](https://doi.org/10.1126/science.233.4759.85), [1989](https://doi.org/10.1126/science.246.4936.1473)) as tabled in [JPL Publication 15-7](https://ntrs.nasa.gov/citations/20160009378) and [17-2](https://ntrs.nasa.gov/citations/20170006886); Starkov's auroral oval as [Sigernes et al. 2011](https://folk.uib.no/st07350/papers/sigernes2011OPA599.pdf) give it | the planets' magnetic fields and auroras ([magnetic fields](physics/magnetic-fields.md)) |
| [CelesTrak GP data](https://celestrak.org/NORAD/elements/) (T. S. Kelso), from the US Space Force via [Space-Track.org](https://www.space-track.org/); fetched under CelesTrak's [usage policy](https://celestrak.org/usage-policy.php) | the 16,892 active Earth satellites' element sets (a dated snapshot, and the Latest key) |

**Missions and validation**

| Source | Used for |
| --- | --- |
| NASA JSC/FOD/NAV, via [NAIF](https://naif.jpl.nasa.gov/pub/naif/ARTEMIS/kernels/spk/) | Artemis II's reconstructed trajectory |
| NASA/JSC navigation, via [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Artemis I's as-flown trajectory |
| JPL navigation: Juno's reconstructed trajectory and Cassini's final post-mission reconstruction, via [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Juno's passes over Ganymede and Io and Cassini's over Titan, the checks on the moons' pull |
| NASA Engineering and Safety Center, [NASA/TM-2015-218675](https://ntrs.nasa.gov/citations/20150001263) ([check-case data](https://nescacademy.nasa.gov/flightsim/2015)) | the 6-DOF check cases |
| NASA Ames Research Center, [Trajectory Browser](https://trajbrowser.arc.nasa.gov/) | transfer optima to compare against |
| D. A. Vallado, P. Crawford, R. Hujsak and T. S. Kelso, [*Revisiting Spacetrack Report #3*](https://celestrak.org/publications/AIAA/2006-6753/) (AIAA 2006-6753): its verification set and TEME example | the SGP4 checks |
| [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/): the ISS (−125544) | the satellites' independent check |
| NASA SP-2000-4029, [*Apollo by the Numbers*](https://history.nasa.gov/SP-4029.pdf); SpaceX's [*Falcon User's Guide*](https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf); Rocket Lab's [*Electron Payload User's Guide*](https://rocketlabusa.com/assets/Electron-Payload-User-Guide-7.0-v6.pdf); Crew Dragon Demo-1 webcast telemetry ([shahar603/Telemetry-Data](https://github.com/shahar603/Telemetry-Data), public domain) | the ROCKET tab's real launchers and their flights |

**Fonts and software**

| | Licence |
| --- | --- |
| [B612 and B612 Mono](https://github.com/polarsys/b612) (Airbus), [Michroma](https://fonts.google.com/specimen/Michroma) (Vernon Adams), via [Fontsource](https://fontsource.org/) | [SIL Open Font License 1.1](https://openfontlicense.org/) |
| [DejaVu Math TeX Gyre](https://ctan.org/pkg/tex-gyre-math-dejavu), the equation font ([licence](../src/app/fonts/LICENSE-DejaVuMath.txt)) | Bitstream Vera; [DejaVu](https://dejavu-fonts.github.io/) and math additions public domain |
| [three.js](https://threejs.org/), [React](https://react.dev/), [astronomy-engine](https://github.com/cosinekitty/astronomy), [satellite.js](https://github.com/shashwatak/satellite-js) (SGP4) | MIT |
| [Lucide](https://lucide.dev/) icons | [ISC](https://lucide.dev/license) |
