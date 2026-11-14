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

## Major moons (`moons.test.mjs`)

Planetocentric positions against JPL Horizons vectors not used in the fit;
the full table, per moon, is in [Moons](frontend/moons.md#how-right-they-are).

| Model | Reference | Result |
| --- | --- | --- |
| Io, Europa, Ganymede, Callisto (astronomy-engine `JupiterMoons`) | Horizons (JUP365), daily Nov 2026 and yearly 2000–2050 | worst 645 km (Callisto) |
| Titan, Triton, Phobos (JPL mean elements, fitted corrections) | Horizons (SAT441, NEP098, MAR099), daily Nov 2026 | 1,346 km, 141 km, 595 km |
| 15 of the 16 element moons, 2000–2050 | Horizons, yearly | within 3 % of the orbit's radius, most within 0.3 % |
| Mimas | Horizons | 136,881 km: its 44° libration with Tethys is beyond a precessing ellipse |
| planet centre about the system barycentre, from the moons' GMs | Horizons x99 about x, Nov 2026 | 0.05 km (Jupiter) to 3 km (Pluto, whose offset is 2,130 km) |
| astronomy-engine's Jupiter to Pluto are system barycentres | Horizons heliocentric x and x99, Nov 2026, less a quadratic | 1.1–1.2 km rms against x; 26–2,116 km against x99 |
| moons about the system barycentre and, relative to the planet, about the Sun | Horizons, 7 moons, Nov 2026 | same as about the planet's centre (Charon 26 km; 2,139 km without the offset) |

## Barycentres (`barycentres.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| SSB about the Sun, from every planet system, Earth, the Moon and Pluto | Horizons (0 about 10), daily Nov 2026 and yearly 2000–2050 | 115 km, 145 km (astronomy-engine's own SSB: 444 km, 1,485 km) |
| Earth-Moon barycentre about the Sun, from DE442 | Horizons (3 about 10) | 0.11 km, the fixture's rounding |

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
| The whole mission in one run from before TLI, every burn replayed as flown | flyby 6,511.2 km (flown 6,545.0): the injection burn's 0.012 m/s grows to 34 km; entry interface 3,716 km off |
| Our own plan: the injection burn designed from the pre-TLI orbit and NASA's published targets only | 1,270.7 ft/s over 348.2 s (NASA's plan: 1,274 ft/s, 5 min 49 s); within 182 km of the flown path for eight days; farthest from Earth equal to the flown to the kilometre |
| The app's mission file, flown by the Craft model and kernel host | the replay's flyby to 0.4 km at every frame size; with a fix every 12 h, 1.2 km at entry |
| The same with a tracking fix every 12 h | never more than 5 km off; 1.1 km at entry interface |
| The app's flight as it flies by default: full environment and random vent, Orion's mass falling with its burns, no fixes, the corrections aimed from the craft | never more than 67 km off; 0.3 km at entry; flyby 6,543.2 km; 4.0 m/s more than the flown corrections (blind: 16,021 km at entry) |
| Coast arcs, 0.2–2.1 days | 0.4–49 km at the end (JSC's 1σ: 0.2–1 km) |
| The same arcs once the real flight's steady push is estimated from each arc's first half | 0.1–17 km |
| First arc after translunar injection | 13 km (957 km with point masses only) |
| The app's Moon vs DE442 | under 1 m (DE442 table) |
| Calibration: Earth's J3/J4, other planets' tides, empirical push models | none helps; the gravity model is complete for this mission ([calibration](validation/artemis2.md#calibration-what-does-not-help)) |

## Rockets (`rocket.test.mjs`, `rocket.xcheck.test.mjs`, `ork.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| Optimal staging, three stages, 5,000 kg to 10 km/s | Curtis Example 13.7 | η and mass ratios to the book's four figures; stage masses and total within 0.1 % |
| Gravity-turn ascent with drag | Curtis Example 13.3 | burnout speed, altitude and downrange within 0.1 %, flight-path angle within 0.02°; losses within 5 m/s |
| Launch into a 51.6° orbit from Florida, cutoff at orbital speed | | inclination within 0.01°; level to 0.01°; circular to 10⁻³ |
| OpenRocket design files read and flown (`ork.test.mjs`): our own two-stage flight saved and read back; OpenRocket's examples' seven saved simulations | the flight that was saved; OpenRocket's own apogee | apogee within 0.1 % (0.3 % at OpenRocket's four saved figures); within 0.72 % of OpenRocket in a 2 m/s wind ([details](physics/rocket.md#openrocket-designs-in-the-rocket-tab)) |
| A model rocket and a two-stage high-power rocket, OpenRocket's example designs, flown straight up (`rocket.xcheck.test.mjs`) | OpenRocket 24.12 and RocketPy 1.13 (3-DOF) on the same thrust curves, masses and drag | apogee, time to apogee and top speed within 0.03 % of both; the height within 0.10 m of OpenRocket's all the way up ([details](physics/rocket.md#checked-against-openrocket-and-rocketpy-rocketxchecktestmjs)) |

## The space environment (`environment.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| Sunlight pressure at 1 AU | P = 1361 W/m² / c | exact; falls as 1/d² |
| The Moon's shadow, total solar eclipse of 21 August 2017 | NASA's eclipse tables (Espenak) | total on the central line and at greatest eclipse; the path's edges within 10 km of NASA's limits |
| Totality on the central line, Oregon, 17:20 UT | NASA: 122.6 s | 122.5 s with NASA's eclipse radii |
| Frame independence with shadows | hour against day frames, a day of low orbit with a burn | 8×10⁻⁷ m/s (2×10⁻⁴ before steps were shortened at shadow edges) |
| The Earth's field beyond J2 (EGM2008) through the kernel | NESC case 3B with NASA's GEM-T1 8×8 | 4 mm after 8 h |
| Drag (MET atmosphere) through the kernel | NESC case 6B | 7 mm after 8 h (0.26 m before velocity-dependent forces were evaluated at the kick's end velocity) |
| U.S. Standard Atmosphere 1976, 0–86 km | its tables | 0.003 % |
| The Moon's field (GRAIL GL0660B): Apollo 16's subsatellite PFS-2 | down after 34 days (NASA) | down after 12–47 days at four orbit nodes (with J2 alone, still up at day 67); Apollo 15's PFS-1 still up after 120 days, as it was |
| Venting model | Artemis II's coast arcs | one-day pushes of median 2.35 µm/s², sunward cosine 0.72 (the arcs: 1.3–3.4, 0.3–0.8) |
| Thruster puffs through the kernel | their summed delta-v | exact |
| The solid Earth tide (IERS 2010, step 1): C20's change averaged over 18.6 years | the permanent tide, A0 H0 k20 = −4.2007×10⁻⁹ | −4.1987×10⁻⁹ (0.05 %); the pull at 400 km within 1.4 % of the closed form |
| Relativity: Mercury through the kernel | 42.98″ a century | 42.98″ a century |
| Relativity: the Earth's Schwarzschild and Lense–Thirring terms, orbit-averaged | 3.2496″ a year at 12,270 km, e = 0.1 | 3.2496″ a year (0.1 %) |
| The planets' J2: a Jupiter orbiter's node, 10 days | secular theory, 11.901° | 11.931° (0.25 %) |

## Entry (`entry.test.mjs`)

Orion's crew module from the end of each mission's flight data, guided to
its target. See [entry](physics/entry.md).

| Check | Result |
| --- | --- |
| The guidance's fast prediction against the kernel, at a held bank | within 0.5 km on direct entries (1 % of the range on a 3,470 km one) |
| A direct entry to a target 100 km beyond and 0.3° beside a held-bank landing | 1.3 km from the target, at 7.8 m/s under the mains |
| Artemis I from 17:19 UTC, to AAS 24-174's splashdown | skips (dip 58.5 km, top 97.6 km; flown 61 and 87.6); drogues 17:35:20, mains 17:36:35 (flown 17:36:06, 17:37:26); 9.1 km from NASA's splashdown |
| Artemis II from 23:29 UTC, to an approximate target off San Diego | drogues 00:03:15, mains 00:04:30, down 00:08:26 (flown about 00:03, 00:04, 00:07); 0.3 km from the target |

## Real flight: Artemis I (`artemis1.validate.mjs`)

Orion's burns and coast arcs flown by the kernel against NASA/JSC
navigation's as-flown ephemeris (through JPL Horizons). See
[Artemis I](validation/artemis1.md).

| Check | Result |
| --- | --- |
| NASA's 18 as-flown burns (AAS 23-363), found in the trajectory | every one; over 1 m/s within 0.1 % (RTC-5: 0.9 %); e.g. DRO insertion 110.633 m/s (NASA 110.639), return flyby 292.861 (292.904); under 1 m/s within 0.04 m/s |
| Ignition of the six largest | within 2 s of NASA's times |
| 77 coast arcs, 1.2–24.7 h (589 h) | gravity alone: all within 83 m at the end, rms 22.5 m; the full environment (sunlight pressure on Orion as its mass falls burn by burn, the Earth's and Moon's fields, tides, relativity): within 44 m, rms 5.35 m (5.59 m with its mass held) |
| Orion's falling mass in the arcs | the push the long arcs want grows 1.30 times from the first coasts to the last, as the mass fell 1.27 times |
| The same three ways (`npm run crosscheck:artemis1`) | force by force; the kernel against an independent RK4 (9 cm at a fine step, 2.5 m at the app's default); fresh Horizons states asked in TDB match the fixture to 0.11 m, and the app's Moon matches Horizons' to 2.5 m |
| Closest lunar approaches, outbound and return | 130.4 km and 129.6 km (NASA: 81 mi and 80.6 mi, 130.4 and 129.7 km) |
| Farthest from Earth | 432,207 km above the surface at 21:06 UTC, 28 Nov (NASA: 268,563 mi, 432,210 km, 21:06:10) |
| Joins between NASA's navigation solutions | 67; velocity steps median 0.074 m/s, position median 49 m |
| The app's mission file (`public/missions/artemis1.json`), flown as the app flies it: full environment and random vent, through the Craft model and kernel host | its 18 burns within 1 % of NASA's; with a fix every 12 h, never more than 275 km off, 6 km at the end, flybys 130.3 and 129.0 km; with no fixes and the burns aimed from the craft, never more than 238 km off, 0.9 km at the end, flybys 124.6 and 130.6 km, for 31.8 m/s more than the flown burns (blind: 712,000 km at the end) |

## NASA's 6-DOF check cases (`nesc.test.mjs`)

NASA's orbital check cases for 6-DOF simulations (NESC,
NASA/TM-2015-218675): 25 cases of a rigid vehicle in Earth orbit for 8
hours, each run by four NASA simulations (sims A to D). `sixdof.js` runs
every one ([A 6-DOF vehicle in Earth orbit](physics/sixdof.md)).

| Check | Reference | Result |
| --- | --- | --- |
| Position after 8 h, every case without MET drag (21 cases: point mass, 4×4 and 8×8 GEM-T1, Sun and Moon, burns, torque pulses, torque-free and gravity-gradient rotation) | the closest NASA tool | within 1.0 mm; the tools' own spread is up to 350 m |
| The four drag cases, in our MET atmosphere (`atmosphereMET.js`) | sim B, the tool that ran the same MET version (1999) | within 5.0 mm (0.35–0.61 m before, on sim B's recorded density interpolated in time); the tools' own spread is 0.56–79 m |
| Earth-fixed position (IAU 1976 precession, IAU 1980 nutation) | the closest tool | within 1.1×10⁻⁹ of the distance (7 mm in low orbit) |
| Gravitation, geodetic height | the tool closest in position | 1.3×10⁻⁹ m/s², 0.6 mm |
| Body rates and attitude, every case but the full one | the closest tool | 5×10⁻¹⁴ rad/s, 3×10⁻⁹ deg |
| Full case (8×8, Sun, Moon, drag, gravity gradient) | the closest tool | 1.0 mm; 3×10⁻⁹ rad/s; 7×10⁻⁵ ° |
| Torque-free tumbling ISS, 8 h | constancy of energy and angular momentum | 3×10⁻¹⁴, 4×10⁻¹⁴ |
| Geopotential, random 8×8 field | gradient of an independent Legendre sum | 7×10⁻⁹ (finite differences) |
| IAU 1980 nutation | NAIF CSPICE `zzwahr` (one-off) | 10⁻¹⁹ rad |
| The app's kernel, case 2 (Earth as the central body) | sim B | 4 mm after 8 h |
| The app's kernel, case 4 (heliocentric, as the app runs it) | sim B | 5 mm (0.62 m on the first Earth table; 0.12 m on its barycentre refit, before Encke took the tidal form) |

### The MET atmosphere

NASA's Marshall Engineering Thermosphere, version 1999, built from NASA's
published equations and Fortran listings
([The MET atmosphere](physics/sixdof.md#the-met-atmosphere)).

| Check | Reference | Result |
| --- | --- | --- |
| NASA's MET-V 2.0 worked example (350 km, 1969, F10.7 136/155, ap 9) | NASA/TM-2002-211786 §4.3, 10 outputs printed to 4–7 digits | every output to its printed digits (worst 2.6×10⁻⁴, the rounding of a 4-digit value) |
| NASA's MET-88 test case (200 km, 1987, F10.7 230, ap 400) | NASA CR-179359 | 1.2×10⁻⁵ (MET-88 had an older Sun and Simpson's rule) |
| Density along cases 5A, 5B, 5C (F10.7 70, 128.8, 250) and the four drag cases, every 60 s for 8 h | sim B (MET-1999) | within 2.4×10⁻⁶ |
| Temperature along the same | sim B | within 0.7 mK |
| Density along cases 5A–C against the other tools (one-off) | sims C (MET-1999), D (MET-1995), A (MET-2007) | 4.6×10⁻⁴, 4.1 %, 13 % |

## Not yet validated

- Against JPL Horizons, GMAT or Orekit trajectories.
- Against other missions' trajectories beyond Artemis I and II (e.g. MSL cruise from NAIF).
- The planets' J2 is checked against secular theory only, not against a
  real orbiter's trajectory (Juno or Cassini from NAIF would do).
- MET's helium terms above 440 km. The check cases reach 441 km at most,
  so neither the fairing nor the winter helium bulge is exercised.

## Body orientation (`orientation.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| Earth axes (precession, nutation, sidereal time) | CSPICE `pxform_c` to ITRF93 | 0.0016° (180 m at the surface) |
| Moon axes (IAU model) | CSPICE to MOON_ME (DE440 libration) | 0.0036° (110 m) |
| Mercury, Venus, Pluto, Sun | CSPICE to IAU frames (pck00011) | under 0.0011° |
| Mars | CSPICE to IAU_MARS (Konopliv 2026) | 0.027° (1.6 km) |
| Jupiter to Neptune (rotation models) | CSPICE to IAU frames | under 0.065° |


## The data plate's facts (`bodyfacts.test.mjs`)

| Fact | Reference | Result |
| --- | --- | --- |
| Sidereal rotation, ten bodies | NASA NSSDCA planetary fact sheets | within 0.02 %; Neptune checked against the IAU rate (541.1397757°/day, 15.966 h), as NSSDCA gives Voyager's 16.11 h |
| Solar day, nine bodies | NSSDCA length of day | within 0.04 % (Venus 2,802 h, Mercury 4,222.6 h) |
| Axial tilt | NSSDCA obliquity to orbit | within 0.05°; the Moon within 0.2° (its plane rocks); Pluto 119.6° from the IAU 2015 pole against NSSDCA's 122.53° |
| Mean density, escape speed | NSSDCA | density within 1 %; escape speed within 0.5 % (the giants' at their 1-bar equator, as NSSDCA takes it; Mercury to NSSDCA's 0.1 km/s) |
| The Sun's rotation | Howard, Harvey & Forgach 1990; IAU 14.1844°/day | 25.13 d at the equator, 34.70 d at the poles; 25.38 d |
| The Sun's Galactic orbit | Reid & Brunthaler 2004, 30.24 km/s/kpc | 203 million years, within 0.5 million |

## Source tags (`tex.test.mjs`)

| Check | Result |
| --- | --- |
| The TeX subset's MathML and plain text | fractions, roots, scripts, fences, function names, unary signs |
| Every tag's equations (`tag-info.js`, 59 entries) | all parse; each has what it is and a source |
