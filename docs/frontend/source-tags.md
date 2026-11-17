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
  focus (1.4.13) [1]: the detail can be dismissed, hovered and stays put.

## The equations

Each entry in `tag-info.js` gives its equations in a small TeX subset,
written as the physics docs write them, and was checked against the code
that computes the value (the comment above each entry names the function).
`tex.js` turns each into:
- **MathML Core** [2], which Chromium, Firefox and Safari typeset themselves
  (no KaTeX, no web font);
- **one line of plain text** (`T = 2π√(a³/μ)`), for the description.

Unknown commands throw, so a typo fails `tex.test.mjs` rather than the
page. The keys are literal types: a tag naming a missing entry fails `tsc`.

**The font** is DejaVu Math TeX Gyre [3], bundled as `src/app/fonts/DejaVuMathTeXGyre.woff2`
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

[1] W3C, "Understanding SC 1.4.13: Content on Hover or Focus," in *Web Content Accessibility Guidelines (WCAG) 2.2*. [Online]. Available: https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html

[2] W3C, "MathML Core." [Online]. Available: https://www.w3.org/TR/mathml-core/

[3] DejaVu fonts, "DejaVu Math TeX Gyre," and its licence. [Online]. Available: https://dejavu-fonts.github.io/License.html

[4] H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. Oxford, U.K.: Butterworth-Heinemann (Elsevier), 2020. Cited by location: ch. 2 (the energy (vis-viva) equation and the period); Alg. 4.2 (state vector to elements); Alg. 5.2 (Lambert's problem); ch. 6 (the Hohmann transfer); §8.4 (the sphere of influence); §§8.5–8.6 and 8.11 (departure, capture and porkchop transfers); ch. 13 (§13.2 the gravity turn, eq. 13.27 its losses, §§13.3–13.4 the rocket equation).

[5] O. Montenbruck and E. Gill, *Satellite Orbits*. Berlin, Germany: Springer, 2000, §3.2 (drag) and §3.4 (sunlight pressure and shadows).

[6] B. A. Archinal et al., "Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015," *Celest. Mech. Dyn. Astron.*, vol. 130, art. no. 22, 2018, doi: 10.1007/s10569-017-9805-5. The poles and rotation rates, through astronomy-engine and NAIF's `pck00011`.

[7] R. Howard, J. W. Harvey, and S. Forgach, "Solar surface velocity fields determined from small magnetic features," *Sol. Phys.*, vol. 130, pp. 295–311, 1990, doi: 10.1007/BF00156795. The Sun's rotation by latitude (ADS 1990SoPh..130..295H).

[8] M. J. Reid and A. Brunthaler, "The proper motion of Sagittarius A*. II. The mass of Sagittarius A*," *Astrophys. J.*, vol. 616, no. 2, pp. 872–884, 2004, doi: 10.1086/424960, arXiv:astro-ph/0408107. 6.379 ± 0.024 mas/yr, the Sun's Galactic orbit.

[9] H. Yoshida, "Construction of higher order symplectic integrators," *Phys. Lett. A*, vol. 150, no. 5–7, pp. 262–268, 1990, doi: 10.1016/0375-9601(90)90092-3. The kernel's integrator.

[10] P. Lu, "Entry guidance: a unified method," *J. Guid. Control Dyn.*, vol. 37, no. 3, pp. 713–728, 2014, doi: 10.2514/1.62605. The entry guidance.

[11] Bibb, Walker, Brauckmann, and Robinson, AIAA 2011-3506, NTRS 20110013644, 2011. Orion's aerodynamics.

[12] Ray, NTRS 20170004357, 2017. Orion's parachute drag areas.

[13] G. Petit and B. Luzum, Eds., *IERS Conventions (2010)*, IERS Tech. Note 36, 2010. The Earth Rotation Angle.

[14] IAU, "Resolution B3 on recommended nominal conversion constants for selected solar and planetary properties," 2015. The nominal solar irradiance, 1361 W/m².

[15] D. R. Williams, "Planetary fact sheets," NASA NSSDCA. [Online]. Available: https://nssdc.gsfc.nasa.gov/planetary/factsheet/ The geometric albedos, and the check on rotation, solar day, tilt, density and escape speed (`bodyfacts.test.mjs`).

[16] JPL and NAIF, "DE442 and the satellite kernels," NAIF generic kernels. [Online]. Available: https://naif.jpl.nasa.gov/naif/data_generic.html Positions and GM ([ephemerides and GM](../physics/ephemerides-and-gm.md)).

[17] NASA JSC, "Best Estimated Trajectory (BET revF) for Artemis." The flown path and burns ([validation](../validation.md)).

[18] *U.S. Standard Atmosphere, 1976*, NOAA-S/T 76-1562, 1976; and NASA's MET-1999 thermosphere. The air ([the space environment](../physics/environment.md)).

[19] JPL Solar System Dynamics, "SBDB orbit classes." [Online]. Available: https://ssd-api.jpl.nasa.gov/doc/sbdb_filter.html Orbit classes, diameters and absolute magnitudes; and JPL Horizons, the named bodies' elements at 2026-01-01 ([small bodies](small-bodies.md)).

[20] JPL Solar System Dynamics, "SB441 small-body ephemerides." [Online]. Available: https://ssd.jpl.nasa.gov/ftp/eph/small_bodies/asteroids_de441/ The place and osculating elements of the 14 named bodies they cover (tag SB441; [small bodies](small-bodies.md#exact-positions-for-the-largest)).

[21] JPL CNEOS, "Asteroid size estimator." [Online]. Available: https://cneos.jpl.nasa.gov/tools/ast_size_est.html and Fowler and Chillemi, in *The IRAS Minor Planet Survey*, Phillips Laboratory, Rep. PL-TR-92-2049, 1992. A diameter from H and albedo.

[22] CODATA, "2018 CODATA recommended value of the Newtonian constant of gravitation," G = 6.67430 × 10⁻¹¹ m³ kg⁻¹ s⁻². [Online]. Available: https://physics.nist.gov/cgi-bin/cuu/Value?bg Mean density.

[23] BIPM, *The International System of Units (SI)*, 9th ed., 2019. [Online]. Available: https://www.bipm.org/en/publications/si-brochure The speed of light, exact.

[24] NASA Ames Research Center, "Trajectory Browser." [Online]. Available: https://trajbrowser.arc.nasa.gov/ The departure delta-v convention.

[25] OpenRocket saved simulations (`.ork`). The ROCKET tab's comparisons ([rockets](../physics/rocket.md)).

[26] D. Cross, "astronomy-engine" (MIT). [Online]. Available: https://github.com/cosinekitty/astronomy The planets, `RotationAxis` (the WGCCRE 2015 model) and the solar system's barycentre.

[27] SunPy, "sunpy.sun.models.differential_rotation." [Online]. Available: https://docs.sunpy.org/en/stable/generated/api/sunpy.sun.models.differential_rotation.html Where Howard et al.'s coefficients are the default; used to confirm their values and units.
