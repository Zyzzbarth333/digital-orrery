# Physics and accuracy

The simulator is honest about where it sits on the fidelity scale. The goal is to move toward and beyond KSP-grade patched-conic-plus-n-body fidelity, and the codebase is being built out to get there rather than claiming to be there already.

## What is high-fidelity today

- **Gravitational parameters** are SPICE-precision GM constants for the Sun and all planets, held in `src/utils/constants.js`.
- **Planetary positions** come from JPL's DE442 for 2000–2050, through a Chebyshev table within a metre of it ([ephemerides](physics/ephemerides-and-gm.md#de442-in-the-app)), and from astronomy-engine outside those years, so the Sun and planets sit where they actually are for a given date.
- **Moons.** Seventy-six moons of Mars to Pluto (the twenty major moons; Jupiter's four inner moons; Saturn's ring, co-orbital and small moons, Hyperion and Phoebe; Uranus's fourteen inner and ten irregular moons; Neptune's seven inner moons and Nereid; Pluto's four small ones), are drawn at their real sizes about their planets, fourteen of them with USGS global mosaics. From 2000 to 2049 they come from those ephemerides as compact Chebyshev tables, within 1 km, loaded a system and a year at a time (the 29 inner moons for 2020–2035 from the repo, their other years with `npm run build:moon-tables`); outside, from astronomy-engine and JPL's mean elements. Near its planet each major moon pulls on spacecraft ([moons](frontend/moons.md)), checked on seven real passes against the craft's own reconstructed tracks: Juno at Ganymede, Io and Europa, Cassini at Titan, at Enceladus and between Saturn and its rings, and Voyager 2 at Neptune and Triton. The moons' passes are followed to within 0.2 km hours after closest approach, Voyager 2's to 3.2 km ([validation](validation.md#moon-and-planet-flybys-flybytestmjs)). A layer the rail switches on adds the 381 irregular moons of Jupiter (107), Saturn (267) and Neptune (7) in JPL's tables, as points with labels, each one to fly to with its data plate. From 2000 to 2049 all of them come from tables of JPL's eight satellite kernels for them, within 0.51 km of Horizons (26.1 MB for the fifty years); outside those years, from JPL's mean elements, a rough place only. The 111 numbered ones have orbit lines ([irregular moons](frontend/moons.md#the-irregular-moons)).
- **Spacecraft propagation** runs in a physics kernel (`src/physics/nbody.js`) with no three.js in it, inside a Web Worker (`src/physics/kernel.worker.js`), so its steps never block drawing; it falls back to the main thread if a Worker cannot start.
  - **Forces:** the Sun, the planets and the Moon at their ephemeris positions; near a planet its major moons, with their $J_2$ and $C_{22}$; the sixteen heaviest asteroids; every planet's $J_2$, Jupiter's and Saturn's zonal fields to $J_{12}$ and Uranus's and Neptune's $J_4$, and the tide Jupiter's moons raise on it; and for the app's craft the Earth's and the Moon's gravity fields, drag and sunlight pressure with shadows ([the space environment](physics/environment.md)). The kernel integrates about the solar system barycentre, with the Sun on DE442's own path, so it needs no indirect term.
  - **Integrators:** error-controlled Dormand–Prince 5(4) on the full equations (Cowell's method) in cruise and wherever the motion is far from two-body. Inside a body's sphere of influence, while the motion is nearly Keplerian, Encke's method: the two-body orbit is followed exactly and only the small deviation from it is integrated, also with error control. In low Earth orbit over a day that is 0.18 m from a fine reference in 1,134 steps, against Cowell's 3.0 m in 2,324 ([validation](validation.md#n-body-kernel-nbodytestmjs)). Yoshida's fourth-order composition and the leapfrog remain for fixed steps ([the n-body kernel](physics/nbody-kernel.md#integrators)).
  - **Impacts** are found where the craft met the surface, on the step's dense output, to a microsecond ([impacts](physics/nbody-kernel.md#impacts)).
  - **Drawing:** results arrive a frame or so late, so each craft is drawn at its last exact state carried forward to the sim clock along a two-body orbit about its primary, plus the other accelerations to second order. That is within a kilometre in orbit and in cruise; during a close planetary pass at very high warp the drawn position can be off by thousands of km until the next result, while the physics itself is unaffected. If a frame needs more steps than its budget, the craft falls behind the clock and catches up, with an on-screen warning, rather than taking steps long enough to pass through a planet.
  - **Launches** start on the escape hyperbola, 100 planet radii out or at the edge of the sphere of influence if that is closer, with the preset delta-V as the hyperbolic excess speed.
- **Orbital-mechanics core.** `src/physics/orbital.js` provides universal-variable two-body propagation (one code path for ellipses, parabolas and hyperbolas) and a universal-variable Lambert solver with a bracketed root solve. Both are checked against worked examples from Curtis [1]. Propagation and the state-to-elements conversion are also checked against NAIF CSPICE (`prop2b_c`, `oscltx_c`). SPICE has no Lambert solver, so the Lambert solver is checked on the real MSL launch and arrival geometry from the DE442 ephemeris and on transfer grids flown by an independent numerical integrator. Run the checks with:

  ```bash
  node src/physics/orbital.test.mjs
  ```

## What is still approximate

- **Journeys are planned by patched conics.** Each leg uses the verified Lambert solver, and flybys a B-plane aim. The kernel then flies the plan, landings, stays and liftoffs included, and reports how close it comes to each waypoint. It is flown in the full model, with the Earth's and the Moon's gravity fields (the Moon's mascons included), drag and sunlight, so the journey's craft in the app lands where the plan's flight did. Leaving a moon for another planet is priced by where the moon is on the day, and the planner suggests the best day in the stay. A leg nearly 180 degrees round the Sun, where Lambert's plane is ill-defined, is flown with a deep-space burn near halfway, which reshapes the transfer as well as turning its plane, and meets Lawden's conditions for an optimal burn ([journeys](physics/journey.md#the-deep-space-burn)). A long stay in a planet's orbit turns the orbit's plane (the planet's J2), so the planner prices leaving out of the plane and suggests the day the plane holds the way out; at the Moon it does not (J2 alone does not turn a lunar orbit).
- **Jupiter's rings are shaped by fitted models.** Uranus's and Neptune's rings are measured throughout (orbits from occultations, depths from Voyager's profiles, the arcs at measured longitudes, interpolated between 1989, 2007 and 2016). Jupiter's extents, thicknesses and depths are measured, but no radial profile of them is tabulated, so their shapes in between follow the published fits: the gossamer rings' tilted-orbit model and the halo's power law ([rings](frontend/rings.md#what-is-measured-and-what-is-modelled)).
- **The ascent has no closed-loop guidance.** The ROCKET tab's gravity turn ends its orbits higher than real launches, which are steered ([rockets](physics/rocket.md#real-launchers)).

## In short

The constants, ephemerides, n-body integration and the Kepler/Lambert core are checked against references. The planning layers on top of them are where the remaining approximations live, and each says so in its docs.

## Accuracy roadmap

The following changes would push fidelity further, roughly in order of impact:

- [x] Wire the Lambert core in `src/physics/orbital.js` into the porkchop delta-V grid so the planner reads directly from the verified solver.
- [ ] Add patched-conic sphere-of-influence transitions so trajectories hand off correctly between central bodies.
- [x] Replace the fixed-step integrator with a higher-order integrator whose step follows the local dynamical time.
- [x] Add error-controlled adaptive stepping, and a two-body fast path for weakly perturbed orbits: Dormand–Prince 5(4) for Cowell's method (#72), and Encke's method near a primary ([the n-body kernel](physics/nbody-kernel.md#integrators)).
- [x] Validate propagated trajectories against flown missions: Artemis I and II against NASA's reconstructed trajectories, Juno's, Cassini's and Voyager 2's moon and planet flybys against JPL's, and Juno's 2012–13 cruise and Earth flyby, DART's impact on Dimorphos and LRO's lunar capture against their navigators' ([validation](validation.md)).

## References

[1] H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. Oxford, U.K.: Butterworth-Heinemann (Elsevier), 2020.
