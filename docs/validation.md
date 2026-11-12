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
| `lambertRevs`, 300 random geometries, 1 and 2 revolutions, both branches | flown by `propagate` | every one reaches r₂; worst 5.8×10⁻⁹ relative |

## Ephemeris and porkchop (`porkchop.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| the app's Earth (DE442 Chebyshev table), 4 epochs, from UTC | DE442 via CSPICE | 0.09 m (2.2 m at J2000, whose UTC is rounded to 1 ms) |
| astronomy-engine, Venus/Earth/Mars | DE442 via CSPICE | 2.3×10⁻⁵ relative, 1.3 m/s |
| astronomy-engine, all eight planets | DE442 | 9.3×10⁻⁵, 9.5 m/s |
| porkchop cell on MSL dates | DE442 Lambert | C3 agrees to 10⁻⁴ |
| 2011 Mars window | physical | all 11,011 cells solved; minimum C3 9.00 km²/s² inside the grid |

## Trajectory search (`trajsearch.test.mjs`)

Against NASA Ames's Trajectory Browser, its 2026–2040 optima for the seven
other planets (`public/trajbrowser/planets.json`).

| Model | Reference | Result |
| --- | --- | --- |
| `transfer`, NASA's own dates, every direct route (54) | the browser's total Δv | all solved; 53 compared, mean 3.0 %, worst 4.5 % (Saturn); fast Jupiter flybys up to 8.8 % (NASA patches at the sphere of influence) |
| the same, excluded | | one with Earth and the planet within 5° of a line through the Sun; one (Mars, 2026-03-13) at the 1-revolution minimum flight time, 1.2 % one day longer |
| `searchTransfers`, Venus and Mars rendezvous | the browser's per-opportunity optima | every one found; worst 3.1 % and 8 days (Venus), 3.0 % and 2 days (Mars) |

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
| Encke, low Earth orbit with J2, 1 day | Cowell at 1/20 the step | 0.77 m (default Cowell: 5.4 m), 1,134 steps (Cowell: 9,795); the reference follows the ephemeris's acceleration noise, Encke's tidal form does not |
| Encke, forward then back a day | start state | 0.86 m |
| Encke/Cowell hybrid, 300 × 380,000 km orbit, 10 days | Cowell at 1/20 the step | 0.18 km (default Cowell: 1.91 km), 792 steps (1,283); 0.088 km in Encke's ephemeris form, which shares the reference's frame |
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
| Burns reconstructed from the trajectory against NASA's figures | translunar injection 1,272.0 ft/s over 350.3 s (NASA: 1,274 ft/s planned, 5 min 50 s); return corrections 1.6 and 5.3 ft/s (NASA: the same) |
| The whole mission in one run from before TLI, every burn replayed as flown | flyby 6,506.4 km (flown 6,545.0): the injection burn's 0.03 m/s grows to 40 km; entry interface 4,327 km off |
| Our own plan: the injection burn designed from the pre-TLI orbit and NASA's published targets only | 1,270.7 ft/s over 348.2 s (NASA's plan: 1,274 ft/s, 5 min 49 s); within 182 km of the flown path for eight days; farthest from Earth equal to the flown to the kilometre |
| The app's mission file, flown by the Craft model and kernel host | the replay's flyby to 0.4 km at every frame size; with a fix every 12 h, 1.3 km at entry |
| The same with a tracking fix every 12 h | never more than 5 km off; 1.1 km at entry interface |
| Coast arcs, 0.2–2.1 days | 0.4–49 km at the end (JSC's 1σ: 0.2–1 km) |
| The same arcs once the real flight's steady push is estimated from each arc's first half | 0.1–17 km |
| First arc after translunar injection | 13 km (957 km with point masses only) |
| The app's Moon vs DE442 | under 1 m (DE442 table) |
| Calibration: Earth's J3/J4, other planets' tides, empirical push models | none helps; the gravity model is complete for this mission ([calibration](validation/artemis2.md#calibration-what-does-not-help)) |

## NASA's 6-DOF check cases (`nesc.test.mjs`)

NASA's orbital check cases for 6-DOF simulations (NESC,
NASA/TM-2015-218675): 25 cases of a rigid vehicle in Earth orbit for 8
hours, each run by four NASA simulations (sims A to D). `sixdof.js` runs
every one ([A 6-DOF vehicle in Earth orbit](physics/sixdof.md)).

| Check | Reference | Result |
| --- | --- | --- |
| Position after 8 h, every case without MET drag (21 cases: point mass, 4×4 and 8×8 GEM-T1, Sun and Moon, burns, torque pulses, torque-free and gravity-gradient rotation) | the closest NASA tool | within 1.0 mm; the tools' own spread is up to 350 m |
| The four drag cases (MET density from sim B) | the four tools | 0.35–0.61 m, inside the tools' own spread (0.56–79 m) |
| Earth-fixed position (IAU 1976 precession, IAU 1980 nutation) | the closest tool | within 1.1×10⁻⁹ of the distance (7 mm in low orbit) |
| Gravitation, geodetic height | the tool closest in position | 1.3×10⁻⁹ m/s², 0.6 mm |
| Body rates and attitude, every case but the full one | the closest tool | 5×10⁻¹⁴ rad/s, 3×10⁻⁹ deg |
| Full case (8×8, Sun, Moon, drag, gravity gradient) | the closest tool | 0.35 m; 8×10⁻⁸ rad/s; 0.002° |
| Torque-free tumbling ISS, 8 h | constancy of energy and angular momentum | 3×10⁻¹⁴, 4×10⁻¹⁴ |
| Geopotential, random 8×8 field | gradient of an independent Legendre sum | 7×10⁻⁹ (finite differences) |
| IAU 1980 nutation | NAIF CSPICE `zzwahr` (one-off) | 10⁻¹⁹ rad |
| The app's kernel, case 2 (Earth as the central body) | sim B | 4 mm after 8 h |
| The app's kernel, case 4 (heliocentric, as the app runs it) | sim B | 5 mm (0.62 m on the first Earth table; 0.12 m on its barycentre refit, before Encke took the tidal form) |

## Not yet validated

- Against JPL Horizons, GMAT or Orekit trajectories.
- Against other missions' trajectories (NAIF mission kernels, e.g. MSL cruise).
- The planets' J2, and radiation pressure (not modelled yet). The Earth's
  higher harmonics and drag are modelled and checked in `sixdof.js`, but
  not yet in the app's kernel.
- The MET atmosphere itself (not public; the drag cases use NASA's
  density).

## Body orientation (`orientation.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| Earth axes (precession, nutation, sidereal time) | CSPICE `pxform_c` to ITRF93 | 0.0016° (180 m at the surface) |
| Moon axes (IAU model) | CSPICE to MOON_ME (DE440 libration) | 0.0036° (110 m) |
| Mercury, Venus, Pluto, Sun | CSPICE to IAU frames (pck00011) | under 0.0011° |
| Mars | CSPICE to IAU_MARS (Konopliv 2026) | 0.027° (1.6 km) |
| Jupiter to Neptune (rotation models) | CSPICE to IAU frames | under 0.065° |

