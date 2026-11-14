# Source tags and their detail

Every readout in the data plate and in the MISSION, PLANNER and ROCKET tabs
has a source tag: a solid one for data, a dashed one for a value worked out
in the app. The tag opens a detail that says what the value is, gives the
equation behind it, says what the symbols are, adds the row's own note and
names the source. Code:
- `src/app/source-tag.tsx`: the tag and its detail.
- `src/app/tag-info.js`: what each tag says.
- `src/app/tex.js`: the equations' typesetting. Tested in `tex.test.mjs`.

## How it behaves

- **Opening:** hover opens the detail after a moment, and the pointer can
  move onto it. Focus opens it too, and a click or tap pins it open; a
  second click closes it.
- **Closing:** Escape (which then doesn't also close the console), a press
  elsewhere or moving focus away.
- **Placing:** one is open at a time. It is fixed in a portal on the page,
  under its tag, or above when there is no room, inside the window, so a
  scrolling panel never clips it.
- **Accessibility:** the detail has `role="tooltip"` and the button has
  `aria-expanded`. Screen readers get the whole detail as one line of text,
  the button's description, whether or not the detail is showing. Nothing
  is hover-only. This follows WCAG 2.2's rule for content on hover or
  focus (1.4.13): the detail can be dismissed, hovered and stays put.

## The equations

Each entry in `tag-info.js` gives its equations in a small TeX subset,
written as the physics docs write them, and was checked against the code
that computes the value (the comment above each entry names the function).
`tex.js` turns each into:
- **MathML Core**, which Chromium, Firefox and Safari typeset themselves
  (no KaTeX, no web font);
- **one line of plain text** (`T = 2π√(a³/μ)`), for the description.

Unknown commands throw, so a typo fails `tex.test.mjs` rather than the
page. The keys are literal types: a tag naming a missing entry fails `tsc`.

**The font** is DejaVu Math TeX Gyre, bundled as `src/app/fonts/DejaVuMathTeXGyre.woff2`
(186 KB) under the name Orrery Math, so every machine sets the maths
alike:
- **Why it:** a sans math face, nearest B612, with the OpenType MATH table
  a math font needs to stretch brackets and radicals.
- **Loading:** an installed copy is used first; otherwise the browser
  fetches the file only when an equation first shows, and STIX Two Math,
  Cambria Math or Latin Modern Math stand in until it arrives.
- **Left out:** Noto Sans Math, because Chromium doesn't stretch with it.
- **The file:** the font's TrueType from DejaVu 2.37 (as Debian ships it),
  converted to WOFF2 with fontTools. Every glyph and the MATH table are
  kept, and none is changed.
- **Licence:** Bitstream Vera; the DejaVu and math additions are public
  domain. Its notice and licence are in `src/app/fonts/LICENSE-DejaVuMath.txt`,
  and the Credits list names it.

## References

Each tag's detail names its source in short. These are the full references
behind them. Textbooks are cited by section, not quoted.

### Books

- H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed.
  (Elsevier, 2020):
  - ch. 2: the energy (vis-viva) equation and the period;
  - Algorithm 4.2: state vector to elements;
  - Algorithm 5.2: Lambert's problem;
  - ch. 6: the Hohmann transfer;
  - §8.4: the sphere of influence;
  - §8.5–8.6 and §8.11: departure, capture and porkchop transfers;
  - ch. 13: §13.2 the gravity turn, eq. 13.27 its losses, §13.3–13.4 the
    rocket equation.
- O. Montenbruck and E. Gill, *Satellite Orbits* (Springer, 2000), §3.2
  (drag) and §3.4 (sunlight pressure and shadows).

### Papers and reports

- B. A. Archinal et al., "Report of the IAU Working Group on Cartographic
  Coordinates and Rotational Elements: 2015", *Celestial Mechanics and
  Dynamical Astronomy* 130:22 (2018),
  [doi:10.1007/s10569-017-9805-5](https://doi.org/10.1007/s10569-017-9805-5):
  the poles and rotation rates, through astronomy-engine and NAIF's
  `pck00011`.
- R. Howard, J. W. Harvey and S. Forgach, "Solar surface velocity fields
  determined from small magnetic features", *Solar Physics* 130, 295–311
  (1990), doi:10.1007/BF00156795, ADS 1990SoPh..130..295H: the Sun's
  rotation by latitude.
- M. J. Reid and A. Brunthaler, "The proper motion of Sagittarius A*. II.
  The mass of Sagittarius A*", *ApJ* 616, 872–884 (2004),
  [doi:10.1086/424960](https://doi.org/10.1086/424960),
  [arXiv:astro-ph/0408107](https://arxiv.org/abs/astro-ph/0408107):
  6.379 ± 0.024 mas/yr, the Sun's Galactic orbit.
- H. Yoshida, "Construction of higher order symplectic integrators",
  *Physics Letters A* 150, 262–268 (1990): the kernel's integrator.
- P. Lu, "Entry guidance: a unified method", *Journal of Guidance, Control,
  and Dynamics* 37(3) (2014): the entry guidance.
- Bibb, Walker, Brauckmann and Robinson, AIAA 2011-3506, NTRS
  20110013644: Orion's aerodynamics.
- Ray, NTRS 20170004357 (2017): Orion's parachute drag areas.
- G. Petit and B. Luzum (eds.), *IERS Conventions (2010)*, IERS Technical
  Note 36: the Earth Rotation Angle.
- IAU 2015 Resolution B3: the nominal solar irradiance, 1361 W/m².

### Data and constants

- D. R. Williams, NASA NSSDCA planetary fact sheets,
  [nssdc.gsfc.nasa.gov/planetary/factsheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/):
  the geometric albedos, and the check on rotation, solar day, tilt,
  density and escape speed (`bodyfacts.test.mjs`).
- JPL DE442 and the satellite kernels, through NAIF's generic kernels
  ([naif.jpl.nasa.gov](https://naif.jpl.nasa.gov/naif/data_generic.html)):
  positions and GM ([ephemerides and GM](../physics/ephemerides-and-gm.md)).
- NASA JSC's Best Estimated Trajectory (BET revF) for Artemis: the flown
  path and burns ([validation](../validation.md)).
- *U.S. Standard Atmosphere, 1976* (NOAA-S/T 76-1562) and NASA's MET-1999
  thermosphere: the air ([the space environment](../physics/environment.md)).
- CODATA 2018, the Newtonian constant of gravitation,
  G = 6.67430 × 10⁻¹¹ m³ kg⁻¹ s⁻²
  ([NIST](https://physics.nist.gov/cgi-bin/cuu/Value?bg)): mean density.
- BIPM, *The International System of Units (SI)*, 9th ed. (2019)
  ([bipm.org](https://www.bipm.org/en/publications/si-brochure)): the speed
  of light, exact.
- NASA Ames Trajectory Browser
  ([trajbrowser.arc.nasa.gov](https://trajbrowser.arc.nasa.gov/)): the
  departure delta-v convention.
- OpenRocket's saved simulations (`.ork`): the ROCKET tab's comparisons
  ([rockets](../physics/rocket.md)).

### Software and standards

- astronomy-engine, Don Cross (MIT),
  [github.com/cosinekitty/astronomy](https://github.com/cosinekitty/astronomy):
  the planets, `RotationAxis` (the WGCCRE 2015 model) and the solar
  system's barycentre.
- SunPy, `sunpy.sun.models.differential_rotation`
  ([docs](https://docs.sunpy.org/en/stable/generated/api/sunpy.sun.models.differential_rotation.html)):
  where Howard et al.'s coefficients are the default; used to confirm their
  values and units.
- W3C, *MathML Core* ([w3.org/TR/mathml-core](https://www.w3.org/TR/mathml-core/)):
  what `tex.js` writes.
- DejaVu fonts, DejaVu Math TeX Gyre, and its licence
  ([dejavu-fonts.github.io/License.html](https://dejavu-fonts.github.io/License.html)):
  the equation face.
- W3C, *WCAG 2.2*, Understanding 1.4.13, Content on Hover or Focus
  ([w3.org](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)).
