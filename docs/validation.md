# Validation

Every model is checked against an independent reference. `npm test` runs all
of these; the numbers below are what the checks measured (November 2026, on
`main`). References: NAIF CSPICE N0067 with DE442 (`c/orrery_spice_ref.c`
writes `src/physics/fixtures/spice_reference.json`), Curtis's worked examples,
the rocket equation, and an independent adaptive RK4 integrator written in the
tests (it shares no code with the models).

## Two-body and orbital elements (`orbital.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| `propagate`, elliptic | NAIF `prop2b_c`, 40 cases | 2×10⁻¹⁴ relative |
| `propagate`, hyperbolic | `prop2b_c`, 16 cases | 4×10⁻¹⁵ |
| `propagate`, near-parabolic through periapsis | `prop2b_c`, 8 cases | 2.4×10⁻¹³ |
| `propagate`, exact parabola | Curtis Ex 3.4 | r = 86,976.6 km, θ = 144.754° |
| `propagate`, hyperbola | Curtis Ex 3.5, 3.6 | θ = 107.780°, 100.040° |
| `propagate`, ellipse | Curtis Ex 3.7 | within 1.5 km (book rounds f, g) |
| `propagate`, 10⁸ s hyperbola | energy, angular momentum | 2×10⁻¹⁵, 2×10⁻¹¹ |
| `rvToElements` | NAIF `oscltx_c` | e 2×10⁻¹⁵, angles 10⁻¹²° |
| `rvToElements`, `elementsToRv` | Curtis Ex 4.3, 4.7 | to the book's precision |
| `lambert` | Curtis Ex 5.2, 5.3 | 5×10⁻⁵ km/s, 10⁻³ km/s |
| `lambert`, 920-cell Earth to Mars grid (461 Type II) | independent RK4 | every cell solved; worst endpoint 5.5×10⁻⁹ |
| `lambert`, real MSL dates | DE442 states, RK4 | reaches Mars to 2×10⁻¹¹; C3 = 10.69 km²/s² |

## Ephemeris and porkchop (`porkchop.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| the app's Earth (DE442 Chebyshev table), 4 epochs, from UTC | DE442 via CSPICE | 0.09 m (2.2 m at J2000, whose UTC is rounded to 1 ms) |
| astronomy-engine, Venus/Earth/Mars | DE442 via CSPICE | 2.3×10⁻⁵ relative, 1.3 m/s |
| astronomy-engine, all eight planets | DE442 | 9.3×10⁻⁵, 9.5 m/s |
| porkchop cell on MSL dates | DE442 Lambert | C3 agrees to 10⁻⁴ |
| 2011 Mars window | physical | all 11,011 cells solved; minimum C3 9.00 km²/s² inside the grid |

## n-body kernel (`nbody.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| Sun-only motion, three orbits | `propagate` | under 10⁻⁵ at the default step; 4× finer η cuts error 216-300× |
| leapfrog, Yoshida order | fixed-step halving | orders 2.00, 4.00 |
| time reversal | start state | 2×10⁻¹³ of \|r\| |
| leapfrog energy, 100 orbits | bounded | max 2.54×10⁻⁴ early and late |
| indirect term | planet pull + solar tide bound | within the bound |
| orbit around a moving planet, 5 orbits | two-body about the planet | 0.009 % drift (solar tide) |
| impact, SOI entry, step budget, flyby within budget | events, unlimited run | all reported; flyby identical to an unlimited run |
| Hermite interpolation, 30 days | direct ephemeris calls | worst 21 m |
| 400 km orbit, real Sun/Moon/planets, point masses, 1 day | two-body about Earth | within 0.2 km |
| Earth's J2: node of a 400 km, 51.6° orbit, 3 days | $-\tfrac32 nJ_2(R/p)^2\cos i$ | −5.0305°/day against −5.0060°/day (0.49 %, the mean-versus-osculating offset); Encke and Cowell agree to 10⁻⁴°/day |
| finite burn, no gravity | rocket equation | Δv 2.8×10⁻⁹ km/s; position 2.4×10⁻³ km after 10 days |
| kernel GMs | SPICE `gm_de442.tpc` | 5.9×10⁻¹⁶ |
| Worker message handling | direct advance | identical |
| Encke, low Earth orbit with J2, 1 day | Cowell at 1/20 the step | 1.20 m (default Cowell: 5.1 m), 1,134 steps (Cowell: 9,795) |
| Encke, forward then back a day | start state | 0.86 m |
| Encke/Cowell hybrid, 300 × 380,000 km orbit, 10 days | Cowell at 1/20 the step | 0.088 km (default Cowell: 1.93 km), 793 steps (1,282) |
| Encke, suborbital path | Cowell | impact on Earth at the same time (310.8 s) |
| `keplerStep` | `propagate` | 1.2×10⁻¹⁴ relative |

## Spacecraft in the app (`craftKernel.test.mjs`)

| Behaviour | Result |
| --- | --- |
| craft driven through the Worker client vs stepped directly | identical |
| drawn position vs exact state (results a frame late) | 0.02 km in low orbit, 0.38 km in cruise; up to ~11,000 km during a close Earth pass at 100 days/s |
| drawn position carried forward while the kernel lags | low orbit (two-body plus J2): 5×10⁻⁵ km at 10 min, 6.5 m at 1 h; GEO 0.74 km at 6 h; cruise 0.03 km at 1.7 days |
| burn during a request in flight; dropped request | burn kept; nothing lost |
| manual burn to empty, hour vs day frames | same state within the kernel's accuracy |
| manoeuvre node | 415.816 kg drawn = rocket equation |
| backward clock jump | no burn re-flown |
| undeliverable node | refused before an ignition is spent |
| orbital elements of Earth's state | a = 1.0003 AU, e = 0.0165 |
| departure hyperbola | periapsis to 10⁻⁶ km; asymptote 1.3×10⁻⁵° from v∞ after 200 days |
| five PhysicsTest launches | expected apsides and eccentricities |
| 2026 Lambert plan flown by the kernel | passes Mars at ~371,000 km, day 301 of 308 (no correction burns) |

## SPICE kernel set (CSPICE, one-off checks)

| Check | Result |
| --- | --- |
| barycentres, Sun, Earth, Moon with all kernels vs DE442 alone | identical |
| planet centres, major moons, asteroids against the SSB | 29 of 29 resolve |
| `gm_de442.tpc` against DE442's published km³/s² table | 2.9×10⁻¹¹ (its printed precision) |
| DE442 against DE440, 2000-2040 | inner planets < 20 m; Jupiter 3-14 km; Uranus up to 2,900 km |

## Real flight: Artemis II (`artemis2.validate.mjs`)

Orion's coast arcs flown by the kernel against JSC's reconstructed
trajectory (BET revF, NAIF SPK). See [Artemis II](validation/artemis2.md).

| Check | Result |
| --- | --- |
| Closest approach to the Moon, from the flown state 20 h before | 6,543.5 km vs 6,545.0 km flown; 4 s early |
| The whole mission in one run from just after TLI, with the five real burns | flyby 6,544.3 km (predicted 4 days ahead), 50 s early; entry interface 25 s late and 144 km to the side |
| Coast arcs, 0.2–2.1 days | 0.4–49 km at the end (JSC's 1σ: 0.2–1 km) |
| The same arcs once the real flight's steady push is estimated from each arc's first half | 0.1–17 km |
| First arc after translunar injection | 13 km (957 km with point masses only) |
| The app's Moon vs DE442 | under 1 m (DE442 table) |
| Calibration: Earth's J3/J4, other planets' tides, empirical push models | none helps; the gravity model is complete for this mission ([calibration](validation/artemis2.md#calibration-what-does-not-help)) |

## Not yet validated

- Against JPL Horizons, GMAT or Orekit trajectories.
- Against other missions' trajectories (NAIF mission kernels, e.g. MSL cruise).
- The planets' J2, higher harmonics, drag and radiation pressure (not
  modelled yet).

## Body orientation (`orientation.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| Earth axes (precession, nutation, sidereal time) | CSPICE `pxform_c` to ITRF93 | 0.0016° (180 m at the surface) |
| Moon axes (IAU model) | CSPICE to MOON_ME (DE440 libration) | 0.0036° (110 m) |
| Mercury, Venus, Pluto, Sun | CSPICE to IAU frames (pck00011) | under 0.0011° |
| Mars | CSPICE to IAU_MARS (Konopliv 2026) | 0.027° (1.6 km) |
| Jupiter to Neptune (rotation models) | CSPICE to IAU frames | under 0.065° |

