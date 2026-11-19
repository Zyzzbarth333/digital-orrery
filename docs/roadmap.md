# Roadmap

What comes next, in one list. It merges the accuracy roadmap that was on the [Physics and accuracy](accuracy.md) page with the follow-ups each piece of work left behind. Each item links to the page that explains its context and cites its sources. Within each section, the items are roughly in order of impact.

Done items stay ticked so the history reads in one place. When an item is taken, its pull request says so; when it lands, it is ticked here and in the [changelog](../CHANGELOG.md).

## Accuracy

- [x] Wire the Lambert core in `src/physics/orbital.js` into the porkchop delta-V grid, so the planner reads straight from the verified solver.
- [x] Replace the fixed-step integrator with a higher-order one whose step follows the local dynamical time.
- [x] Add error-controlled adaptive stepping, and a two-body fast path for weakly perturbed orbits: Dormand–Prince 5(4) for Cowell's method (#72), and Encke's method near a primary ([the n-body kernel](physics/nbody-kernel.md#integrators)).
- [x] Validate propagated trajectories against flown missions: Artemis I and II, the Juno, Cassini and Voyager 2 flybys, Juno's 2012–13 cruise, DART, LRO's capture and MESSENGER's cruise ([validation](validation.md)).
- [ ] Patched-conic sphere-of-influence hand-offs, so planned trajectories pass correctly between central bodies.
- [ ] Saturn's rings' own pull, with their mass spread over the drawn ring profiles, tested on Cassini's Rev 278 pass, which leaves 0.32 km ([environment](physics/environment.md), [rings](frontend/rings.md)).
- [ ] Zonal terms beyond J2 for moons, starting with Enceladus's J3, tested on Cassini's E12 pass, which leaves 0.16 km ([environment](physics/environment.md)).
- [ ] The Sun's tide on Mercury: about 1 % of its C20, changing threefold round its eccentric orbit ([environment](physics/environment.md)).
- [ ] The Moon's field past degree 100, for LRO's 30 km commissioning orbit, where each perilune leaves 30–80 mm/s ([validation](validation.md)).
- [ ] A plate model of the craft, with its arrays' attitude, in place of the cannonball for sunlight pressure, to cut the 400 km left over Juno's 210-day cruise arc ([validation](validation.md)).
- [ ] Check MESSENGER's Mercury flybys against the Mercury ephemeris its reconstruction used (DE405), to confirm the 50–100 m centre offset ([MESSENGER](validation/messenger.md)).
- [ ] A field-by-degree check of MESSENGER's first orbit after capture, on coast arcs under a day ([MESSENGER](validation/messenger.md)).
- [ ] The ROCKET tab's ascent with closed-loop guidance, so its orbits end where steered launches do ([rockets](physics/rocket.md#real-launchers)).

## Missions and planning

- [ ] A real mission whose aims target orbit elements rather than a position, so lunar orbits fly aimed without six-hourly fixes ([journeys](physics/journey.md)).
- [ ] Fly MESSENGER aimed again, now that the second Mercury flyby leaves 0.028 m/s instead of 0.125 ([MESSENGER](validation/messenger.md)).
- [ ] Price the gravity losses of a capture or departure at a planet's moon, which the flight burns nearly impulsively (up to 12–13 g at Europa) ([journeys](physics/journey.md)).
- [ ] Aim the Moon with a bending model in the Earth–Moon problem rather than at the B-plane point, to cut its 12 + 11 m/s of aims and 14 + 4 m/s of trims; and let a departure from a moon via its planet use the far-field aim too ([journeys](physics/journey.md)).
- [ ] Name a leg's transfer on its tag (deep-space burn, broken plane), not LAMBERT for every leg.
- [ ] Show one lamp when leaving a moon: the window and phase lamps now say the same thing.
- [ ] The ROCKET tab's "Falcon 9 Block 5 (expendable)" preset asks for a 28.5° orbit from Kennedy at 28.6°, so it can't be flown as it comes.
- [ ] The ROCKET tab and STACK on one pad latitude: STACK sizes for 28.5° and the tab flies from Kennedy's 28.627°, so an exactly sized stack reads 0.001 km/s short.
- [ ] Size STACK's climb from a flown ascent, not a flat 1.5 km/s allowance, which runs low for stacks whose second stage climbs from about 1.5 km/s.
- [ ] Check the bare-model fallback live: only its trouble rules are unit-tested.
- [ ] Trigger a planner re-check from the edit itself, not a timer, which a hidden tab throttles for up to a minute.
- [ ] Measure the near-180° search's cost on the Moon-to-Mars leg (0.66 s to 1.44 s) and skip it when the direct arc's tilt is small.

## The sky and its bodies

- [ ] Jupiter's main ring from measured New Horizons LORRI profiles, in place of the fitted shape (in progress) ([rings](frontend/rings.md#what-is-measured-and-what-is-modelled)).
- [ ] Jupiter's dust phase curve fitted to published data points; Uranus's dust lanes as Voyager saw them in forward scatter; Neptune's arcs after 2016 from JWST images ([rings](frontend/rings.md)).
- [ ] The rings' shadows on Jupiter, Uranus and Neptune. The moons' shadows on the rings, and the rings' on the moons, are in (#176) ([rings](frontend/rings.md)).
- [ ] An eclipse and transit finder: the next events, to jump to ([lighting](frontend/lighting.md)).
- [ ] A telescope view (a narrow field of view), without which transits and occultations stay below a pixel.
- [ ] Stratospheric aerosol (GloSSAC) for the Danjon darkening of lunar eclipses; it needs a download.
- [ ] Real models of the spacecraft beyond Earth orbit and the real missions' other craft (in progress).
- [ ] Light the ground with the sky's own light, from the multiple-scattering table, so the land near the terminator takes the sky's blue ([atmospheres](frontend/atmospheres.md)).
- [ ] Mars's and Titan's skies, reusing the Earth's view table once their parameters have primary sources ([atmospheres](frontend/atmospheres.md)).
- [ ] The irregular moons' tables beyond 2000–2049: the kernels cover about 1750–2200, at about 0.5 MB a year ([moons](frontend/moons.md)).
- [ ] Unequal table intervals for very eccentric moons, so S/2023 S 38 (e 0.909) fits to 0.5 km, not 1,000 km ([moons](frontend/moons.md)).
- [ ] Colour or name the irregular moons' dynamical families from a cited classification ([moons](frontend/moons.md)).
- [ ] Saturn's Daphnis and its other small ring moons, and Uranus's and Neptune's newest moons, from their own kernels ([moons](frontend/moons.md)).
- [ ] Mercury's and Venus's fields as anomaly maps in the gravity guides, as the Earth's and the Moon's are ([gravity guides](physics/gravity-guides.md)).
- [ ] Equipotential contours in the inertial and falling frames, and a rotating frame for a planet with its largest moon, such as Jupiter and Ganymede ([gravity guides](physics/gravity-guides.md)).
- [ ] Jupiter's and Saturn's magnetopause and tail currents bending their outer field lines, as the Earth's model bends its own; Saturn's bow shock; Juno's ultraviolet ovals as a full check of Jupiter's main aurora ([magnetic fields](physics/magnetic-fields.md)).
- [ ] The solar wind's 4° aberration of the Earth's magnetopause and bow shock; hourly solar wind for dates older than NOAA's seven days; a newer solar rotation and fast and slow streams for the current sheet ([magnetic fields](physics/magnetic-fields.md)).
- [ ] An ISS data plate with its modules ([satellites](frontend/satellites.md)).
- [ ] Landing sites still missing a primary coordinate: Hayabusa on Itokawa, Hayabusa2's touchdowns on Ryugu, Philae and Rosetta on 67P, Deep Impact on Tempel 1, and where Spirit and Opportunity stopped ([landing sites](frontend/landing-sites.md#beyond-the-moon)).
- [ ] Colour cloud imagery near the sim's minute for Asia, Europe, Africa and Australia: GIBS carries Himawari only in greyscale and has no Meteosat ([textures](frontend/textures.md)).
- [ ] Re-fetch the spacecraft beyond Earth orbit when Horizons updates its predictions: the data covers 2026–2027, and MRO's and DSCOVR's end in November 2026 ([spacecraft](frontend/spacecraft.md)).

## The console

From a design critique of the console on 18 Nov 2026 (28/40 against Nielsen's ten heuristics), in order:

- [x] The rail keeps every planet in view at a laptop's height, and a phone no longer slides sideways.
- [x] One vehicle across the ROCKET tab, STACK and GO, and plain labels for terms such as "(r)", "2-BODY" and "D/C" (#157).
- [x] Lamps lit only when they mean something, one orange key per flow, and the lit RUN key's label at 4.5:1 contrast (#158, #164).
- [x] A preview and confirm step before the MISSION tab's LAUNCH (#160).
- [x] The ROCKET tab split into vehicle, job and launch (#161).
- [x] One search over every body, moon, small body and craft, and a `?` sheet of the keyboard shortcuts.
- [x] A name and a touch hint on phones (#162).
- [x] A phone layout of its own: the sky full-screen under a band of the clock, RUN and FIND, with the plate, the rail and the console in one sheet over it; the touch hint is a line of its peek ([phone layout](frontend/phone.md)).
- [ ] Try the phone layout on a real phone: the sheet's drag and fling, Back, the keyboard and the safe areas.
- [x] The MISSION tab after a launch folds to a short panel, its sections saying what they hold (#165).
- [x] The rail's lower sections as groups that fold away, each saying what it has on (in the phone's sheet; beside the sky the rail scrolls as one).
- [ ] Wrap or expand the plotting table's long lamps at phone width.
- [ ] Keep a plate's Epoch on one line on a laptop (it wraps between the date and the time), and set negatives such as "Horizons ID -31" with a true minus, as the guide plate does.
- [ ] Take the README's screenshots again since the typography pass (#178, #180) and the phone layout (#177).

## Performance and tooling

- [ ] Faster journey tests: the Europa round trip (case 17) alone takes about 70 s.
- [x] From the code audit of 19 Nov 2026:
  - [x] one `src/physics/vec.js` for the `dot`, `cross` and `norm` copied into about 40 files (two of which use `norm` to mean normalise);
  - [x] one focus target in the scene in place of five fields cleared by hand in eight `focusOn*` methods;
  - [x] `Readout`, `Row` and `fmtGroup` in their own module, ending the import cycles between `panels.tsx` and two plates;
  - [x] tests for the `Mission` and `JourneyStore` stores (stale worker replies, a failed fetch);
  - [x] `// @ts-check` on the files that cross the worker boundary;
  - [x] one `getJson` for the six loaders that each check `r.ok` their own way.
- [ ] Time the gravity field at twice the pixel density and in a 4K window, and skip bodies whose pull is below a stated tolerance ([performance](performance.md)).
- [ ] Trim the compressed maps' downloads near a body, which roughly double (the Moon's 25 MB against 5.5) ([textures](frontend/textures.md)).
- [ ] Let `npm run bench:frames` settle its zoom at twice the pixel density, where the Earth and belt scenes now drop every sample ([performance](performance.md)).
- [ ] Check that a benchmark killed mid-sample leaves no browser behind ([performance](performance.md)).
- [ ] Stop the `Mission`'s kernel worker on a dev-server hot reload: each reload of `App.tsx` leaves one idle worker behind.
- [ ] Try panning, pinching and the remembered view on a real phone, and in Firefox and Safari.
- [ ] Film the docs clips again since the compressed maps, the new sky and the rail fix, and add clips of the craft beyond Earth orbit and of a flyby.
