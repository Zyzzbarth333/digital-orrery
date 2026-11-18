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
| [NASA JPL](https://ssd.jpl.nasa.gov/planets/eph_export.html) and [NAIF SPICE](https://naif.jpl.nasa.gov/naif/data_generic.html): DE442, the satellite kernels (with [`jup347`–`jup349`, `sat455`–`sat459` and `nep104`](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/) for the irregular moons), `pck00011`, [`sb441-n16`](https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/), Earth orientation kernels | the planets', moons', Sun's and asteroids' positions; body shapes and rotation; the Earth's UT1 and polar motion |
| JPL Solar System Dynamics: [satellite mean elements](https://ssd.jpl.nasa.gov/sats/elem/); [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/); [satellite discovery circumstances](https://ssd.jpl.nasa.gov/sats/discovery.html); the [Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_query.html) | moons outside their tables' years, radii, GMs and albedos; the irregular moons' discoveries; the 135,353 asteroids and comets |
| [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT) | positions outside 2000–2050, and the Galilean moons' fallback |
| EGM2008 (NGA), via [GFZ ICGEM](https://icgem.gfz-potsdam.de/); GRAIL GL0660B (NASA/JPL), via the [PDS Geosciences Node](https://pds-geosciences.wustl.edu/missions/grail/default.htm) | the Earth's and the Moon's gravity fields |
| [CelesTrak](https://celestrak.org/SpaceData/) (NOAA SWPC, GFZ) | space weather for the upper atmosphere's density; the Kp index for the auroras |
| [IGRF-14](https://www.ngdc.noaa.gov/IAGA/vmod/igrf.html) (IAGA V-MOD, via NOAA NCEI); JRM33 ([Connerney et al. 2022](https://doi.org/10.1029/2021JE007055), its supporting tables via [Caltech](https://authors.library.caltech.edu/records/dds0z-2vx98)); Cassini 11 ([Cao et al. 2020](https://doi.org/10.1016/j.icarus.2019.113541)), via [libinternalfield](https://github.com/mattkjames7/libinternalfield) (MIT); Voyager's dipoles ([Ness et al. 1986](https://doi.org/10.1126/science.233.4759.85), [1989](https://doi.org/10.1126/science.246.4936.1473)) as tabled in [JPL Publication 15-7](https://ntrs.nasa.gov/citations/20160009378) and [17-2](https://ntrs.nasa.gov/citations/20170006886); Starkov's auroral oval as [Sigernes et al. 2011](https://folk.uib.no/st07350/papers/sigernes2011OPA599.pdf) give it; Mercury's dipole ([Anderson et al. 2012](https://doi.org/10.1029/2012JE004159)); Neptune's aurora ([Melin et al. 2025](https://doi.org/10.1038/s41550-025-02507-9)); the radiation belts' extents ([Reeves and Daglis 2016](https://doi.org/10.1093/acprof:oso/9780198705246.003.0004); [Roussos and Kollmann 2021](https://doi.org/10.1002/9781119815624.ch32)) | the planets' magnetic fields, auroras and radiation belts ([magnetic fields](physics/magnetic-fields.md)) |
| Ganymede's dipole ([Weber et al. 2022](https://doi.org/10.1029/2022GL098633); [Kivelson et al. 2002](https://doi.org/10.1006/icar.2002.6834)), and its aurora ([Feldman et al. 2000](https://doi.org/10.1086/308889)); Mars's crust ([Langlais et al. 2019](https://doi.org/10.1029/2018JE005854), coefficients via [libinternalfield](https://github.com/mattkjames7/libinternalfield), MIT) and aurora ([Bertaux et al. 2005](https://doi.org/10.1038/nature03603); [Brain et al. 2006](https://doi.org/10.1029/2005GL024782)); the moons' footprints and lead angles ([Hue et al. 2023](https://doi.org/10.1029/2023JA031363); [Pryor et al. 2011](https://doi.org/10.1038/nature09928)); Uranus's and Neptune's belts ([Cooper and Stone 1991](https://doi.org/10.1029/90JA02629); [Mauk et al. 1991](https://doi.org/10.1029/91JA01820)) | Ganymede's and Mars's fields and auroras, the moons' footprints, the ice giants' belts ([magnetic fields](physics/magnetic-fields.md)) |
| [NOAA NCEI Magnetic Field Calculator](https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml#igrfwmm) | IGRF-14 checked after 2025 |
| [NOAA SWPC](https://www.swpc.noaa.gov/products/aurora-30-minute-forecast) OVATION Prime aurora forecast (US Government work), fetched live | the Earth's aurora when the clock is near now |
| [CelesTrak GP data](https://celestrak.org/NORAD/elements/) (T. S. Kelso), from the US Space Force via [Space-Track.org](https://www.space-track.org/); fetched under CelesTrak's [usage policy](https://celestrak.org/usage-policy.php) | the 16,892 active Earth satellites' element sets (a dated snapshot, and the Latest key) |

**Missions and validation**

| Source | Used for |
| --- | --- |
| NASA JSC/FOD/NAV, via [NAIF](https://naif.jpl.nasa.gov/pub/naif/ARTEMIS/kernels/spk/) | Artemis II's reconstructed trajectory |
| NASA/JSC navigation, via [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Artemis I's as-flown trajectory |
| JPL navigation: Juno's reconstructed trajectory and Cassini's final post-mission reconstruction, via [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) | Juno's passes over Ganymede and Io and Cassini's over Titan, the checks on the moons' pull |
| JPL Juno navigation (`spk_rec_110805_*_260824`), via [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/); NASA, JPL and SwRI releases and the [Juno press kit](https://www.jpl.nasa.gov/news/press_kits/juno/facts/) | Juno's 2012–13 flight in the app: its burns, mass and arrays ([Juno 2012–13](validation/juno2013.md)) |
| DART navigation (`dart_2022_*_rec_v03`, `spc_v04`) and Dimorphos (JPL s547), via [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/); Daly et al., [*Nature* 616, 443 (2023)](https://doi.org/10.1038/s41586-023-05810-5), CC BY 4.0 | DART's last five weeks in the app: its impact, mass and arrays ([DART](validation/dart.md)) |
| NASA Engineering and Safety Center, [NASA/TM-2015-218675](https://ntrs.nasa.gov/citations/20150001263) ([check-case data](https://nescacademy.nasa.gov/flightsim/2015)) | the 6-DOF check cases |
| ArianeGroup, [*Chemical Bi-Propellant Thruster Family*](https://ariane.group/app/uploads/2024/09/ArianeGroup_Chemical_Bipropellant_Thruster_Family.pdf) (the 10 N thruster's 292 s) | the class of the app's craft's attitude thrusters, and their Isp |
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
