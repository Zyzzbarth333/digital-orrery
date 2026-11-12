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
| astronomy-engine, Venus/Earth/Mars | DE442 via CSPICE | 2.5×10⁻⁵ relative, 1.3 m/s |
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
| 400 km orbit, real Sun/Moon/planets, 1 day | two-body about Earth | within 0.2 km |
| finite burn, no gravity | rocket equation | Δv 2.8×10⁻⁹ km/s; position 2.4×10⁻³ km after 10 days |
| kernel GMs | SPICE `gm_de442.tpc` | 5.9×10⁻¹⁶ |
| Worker message handling | direct advance | identical |

## Spacecraft in the app (`craftKernel.test.mjs`)

| Behaviour | Result |
| --- | --- |
| craft driven through the Worker client vs stepped directly | identical |
| drawn position vs exact state (results a frame late) | 0.02 km in low orbit, 0.38 km in cruise; up to ~11,000 km during a close Earth pass at 100 days/s |
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

## Not yet validated

- Against JPL Horizons, GMAT or Orekit trajectories.
- Against real mission telemetry (NAIF mission kernels, e.g. MSL cruise).
- Anything with non-spherical gravity, drag or radiation pressure (not
  modelled yet).
