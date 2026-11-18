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
| `timeToRadius` (first descent to a radius: ellipse in and out, hyperbola, parabola) | flown by `propagate` | at the radius to under 1 mm, above it at 400 times before; never (∞) above periapsis or leaving |

## Ephemeris and porkchop (`porkchop.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| the app's eight planets (DE442 Chebyshev table), 3 epochs, from UTC | DE442 via CSPICE | 2.8 m (Mercury at J2000, whose UTC is rounded to 1 ms), 0.002 mm/s |
| the app's Earth (DE442 Chebyshev table), 4 epochs, from UTC | DE442 via CSPICE | 0.09 m (2.2 m at J2000) |
| the table's series, every body about the Sun, 2000–2050 and its margins, between the fitting nodes (`c/de_cheb.c`) | DE442 via CSPICE | under 0.86 m (Neptune); accelerations within 7×10⁻⁹ m/s² |
| astronomy-engine (the fallback outside 2000–2050), Venus/Earth/Mars | DE442 via CSPICE | 2.3×10⁻⁵ relative, 1.3 m/s |
| astronomy-engine, all eight planets | DE442 | 9.3×10⁻⁵, 9.4 m/s |
| porkchop cell on MSL dates | DE442 Lambert | C3 agrees to 2.4×10⁻⁶ km²/s², arrival v∞ to 0.5 mm/s (10⁻⁴ and 5 m/s on astronomy-engine) |
| 2011 Mars window | physical | all 11,011 cells solved; minimum C3 9.00 km²/s² inside the grid |

## The DE442 table's ends (`deTable.test.mjs`)

Each body blends from DE442 into astronomy-engine over the table's
margins ([ephemerides](physics/ephemerides-and-gm.md#at-the-tables-ends)).

| Model | Reference | Result |
| --- | --- | --- |
| every body and the SSB, 2000-01-01 12:00, 2026 and 2050-12-31 | DE442 alone | yes |
| each body at the table's ends | astronomy-engine | under 1 mm |
| velocity inside the blend | central difference of positions | 0.3 mm/s, astronomy-engine's own (Pluto's own: 0.25 m/s) |
| the ramp's own acceleration | the Sun's pull there | 0.02 % (Earth) to 0.8 % (Pluto) |
| the kernel's TT path across the end, 2 s | the body's motion | no jump (to 1 m) |

## Moons (`moons.test.mjs`)

Planetocentric positions of the 75 moons Horizons serves (of 76) against JPL Horizons vectors not
used in any fit; the full tables, per moon, are in
[Moons](frontend/moons.md#how-right-they-are).

| Model | Reference | Result |
| --- | --- | --- |
| the satellite-ephemeris tables (2000–2049), all 75 | Horizons, daily Nov 2026 and yearly 2000–2050 | within 0.58 km (Styx), most within 0.4 km; 0.09 km on the yearly samples (the fixture's rounding) |
| planet centre about the system barycentre, from the tables | Horizons x99 about x, Nov 2026 | within 0.35 km (Pluto's offset is 2,130 km) |
| moons about the system barycentre and, relative to the planet, about the Sun | Horizons, 7 moons, Nov 2026 | within 1 km |
| fallback: Io, Europa, Ganymede, Callisto (astronomy-engine `JupiterMoons`) | Horizons (JUP365), daily Nov 2026 and yearly 2000–2050 | worst 645 km (Callisto) |
| fallback: the twenty major moons but Mimas, from JPL's mean elements and fitted corrections | Horizons, yearly | within 3 % of the orbit's radius, most within 0.3 % |
| fallback: Mimas, the small co-orbital and resonant moons, Hyperion, the irregular moons | Horizons | up to the orbit's size: librations and solar perturbations a precessing ellipse cannot follow |
| fallback: planet centre about the system barycentre, from the moons' GMs | Horizons x99 about x, Nov 2026 | 0.05 km (Jupiter) to 3 km (Pluto) |
| the app's Mars to Pluto (DE442 table) | Horizons heliocentric x, Nov 2026 (Horizons serves DE440 here: its rows match DE440 via CSPICE to 0.08 km) | Mars 0.21 km, Jupiter 14.1 km, Saturn 0.28 km, Uranus 1,231 km, Neptune 352 km, Pluto 1.7 km: DE440 − DE442 itself |
| astronomy-engine's Mars to Pluto, the same | Horizons heliocentric x | 1,809 km (Mars) to 335,209 km (Neptune) |
| astronomy-engine's Jupiter to Pluto are system barycentres | Horizons heliocentric x and x99, Nov 2026, less a quadratic | 1.1–1.2 km rms against x; 26–2,116 km against x99 |
| body-frame pole (`bodyAxesEqj`, pck00011), Phobos, Io, Rhea, Ariel, Titania, Triton, Charon | WGCCRE 2015 poles, constant terms only (Triton's precessing series in full), 14 Nov 2026 | within 1.07° (Phobos, whose periodic terms the check leaves out), Triton 0.00°; right-handed |
| moon surface maps, longitude and latitude (by eye, not in the test) | named features at their gazetteer positions, against their mirror images ([textures](frontend/textures.md#the-moons-maps)) | all 14 east-positive with the west edge at −180°, none flipped |

## Irregular moons (`irregularMoons.test.mjs`)

The 381 irregular moons of Jupiter, Saturn and Neptune about their
planet's centre, against JPL Horizons vectors at five dates, 2000–2049, not
used in any fit ([Irregular moons](frontend/moons.md#the-irregular-moons)).

| Model | Reference | Result |
| --- | --- | --- |
| tables of `jup347`, `jup348`, `jup349`, `sat455`, `sat456`, `sat457`, `sat459`, `nep104`, all 381 (2000–2049) | Horizons, which serves those kernels | within 0.51 km (Hermippe); S/2023 S 38, fitted to 1,000 km for its e = 0.909 orbit, 0.3 km at these dates |
| fallback outside 2000–2049: JPL's mean elements with fitted corrections | Horizons, every 10 days 2000–2050 for the fit; five other dates for the check | each within its fit's worst; median 46 % of the orbit's size for Jupiter's, 15 % for Saturn's, 26 % for Neptune's: the Sun's pull, which no precessing ellipse follows |
| sense of motion | each moon's state now against its elements' inclination | 305 retrograde of 381, all agree |

## Barycentres (`barycentres.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| SSB about the Sun, DE442's own (the table's Sun series) | Horizons (0 about 10, DE440), daily Nov 2026 and yearly 2000–2050 | 0.22 km, 0.24 km (astronomy-engine's own SSB: 444 km, 1,485 km) |
| SSB from every planet system, Earth, the Moon and Pluto on astronomy-engine (used outside the table) | Horizons, 2000-01-01 00:00, measured when that was before the table | 121 km |
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
| Sun-only motion, three orbits | `propagate` | the default (Dormand-Prince, error-controlled) within 7×10⁻⁹ relative, in fewer steps than Yoshida, which is 100–2,800× further off; Yoshida's 4× finer η cuts its error 216-300× |
| leapfrog, Yoshida order | fixed-step halving | orders 2.00, 4.00 |
| time reversal | start state | 2×10⁻¹³ of \|r\| |
| leapfrog energy, 100 orbits | bounded | max 2.54×10⁻⁴ early and late |
| indirect term | planet pull + solar tide bound | within the bound |
| orbit around a moving planet, 5 orbits | two-body about the planet | 0.009 % drift (solar tide) |
| impact, SOI entry, step budget, flyby within budget | events, unlimited run | all reported; flyby identical to an unlimited run |
| impacts within a step (case 6b): a fall from 5,000 km onto a still body of 1,737.4 km, and onto a tilted WGS-84 ellipsoid | Kepler's equation [3, Sec. 3.4] and vis-viva for the sphere; the exact conic's crossing (universal variables, bisected) for the ellipsoid | every integrator's impact on the surface to under 1 mm; dp45, Encke and Yoshida at the crossing time to 2, 0.1 and 9 µs and the speed to 1 mm/s; the leapfrog 67 ms late, its own path's error; the ellipsoid's within 1 ms |
| Hermite interpolation, 30 days | direct ephemeris calls (DE442 table) | worst 20 m (Mercury, the cubic's own error at 6-hour nodes) |
| 400 km orbit, real Sun/Moon/planets, point masses, 1 day | two-body about Earth | within 0.2 km |
| Earth's J2: node of a 400 km, 51.6° orbit, 3 days | $-\tfrac32 nJ_2(R/p)^2\cos i$ | −5.0305°/day against −5.0060°/day (0.49 %, the mean-versus-osculating offset); Encke and Cowell agree to 10⁻⁴°/day |
| finite burn, no gravity | rocket equation | Δv 5×10⁻¹⁴ km/s; position 3.5×10⁻⁸ km after 10 days (Yoshida: 2.8×10⁻⁹, 2.4×10⁻³) |
| kernel GMs | SPICE `gm_de442.tpc` | 5.9×10⁻¹⁶ |
| Worker message handling | direct advance | identical |
| Encke, low Earth orbit with J2, 1 day | Cowell (Dormand-Prince) at 10⁻¹⁰ km a step | 0.18 m (default Cowell: 3.0 m), 1,134 steps (Cowell: 2,324; Yoshida's took 9,795 for 6.7 m) |
| Encke, forward then back a day | start state | 0.86 m |
| Encke/Cowell hybrid, 300 × 380,000 km orbit, 10 days | the same reference | 0.092 km in 475 steps; default Cowell 0.03 km in 577 (Yoshida's: 1.91 km in 1,283). Encke's tidal form leaves out the ephemeris's acceleration noise, which every Cowell run follows |
| about the SSB against about the Sun (case 14) | the same flights, `{ frame: 'sun' }` | the same steps; under 1 mm in low Earth orbit in a day (Encke), 4.3 m at GEO in 10 days (Cowell), 149 m after 300 days of cruise; the Sun's daily nodes within 3 cm of DE442; hooks handed heliocentric states; a fall into the Sun is an impact on it |
| steps at the error-controlled integrator's 1 ms floor (case 15) | counted in the result | none in a day of smooth flight; one of 49 where a 10 km/s² push switches on across a plane at 10⁻⁹ km; none for Yoshida |
| Encke, suborbital path | Cowell | impact on Earth at the same time (304.0 s; 310.8 s when found at a step's end) |
| `keplerStep` | `propagate` | 1.2×10⁻¹⁴ relative |

## The moons' pull: flybys of Ganymede, Io and Titan (`flyby.test.mjs`)

Near a planet with moons the kernel splits the system into the planet and
its moons, each with its own GM ([kernel](physics/nbody-kernel.md#moons)).
The checks are three real passes, each against the craft's reconstructed
trajectory: Juno at Ganymede, Juno at Io and Cassini at Titan.

### Juno at Ganymede

Juno flew 1,046 km over Ganymede on 7 June 2021
(closest approach 16:57:20 TDB, 3,677.4 km from the centre, at 18.57 km/s),
and Ganymede bent its path by about 0.28 km/s.

- **Reference:** JPL Horizons vectors [1] (`src/physics/flyby.fetch.mjs`,
  `fixtures/flyby_juno_ganymede.json`): Juno (-61) about the Jupiter system
  barycentre, from JPL's reconstructed trajectory
  (`spk_rec_110805_*_260824`), every 10 minutes from 08:00 on 7 June to
  02:00 on 8 June TDB. That is nine hours either side of the pass, and six
  hours before the perijove that followed, where Jupiter's harmonics beyond
  $J_2$ take over.
- **Method:** the kernel starts from Juno's first vector, set on the
  kernel's own Jupiter barycentre, and flies the 18 hours. At each later
  vector its distance from Juno is measured about the same barycentre, so
  any error in Jupiter's place about the Sun drops out (16,000 km on
  astronomy-engine, 14 km between DE440 and DE442).
- **Runs:** the moons four ways: not at all (the system folded up at its
  barycentre, as before), from `moons.js` (what the app uses), from
  Horizons' own Galilean moons, and from Horizons with Ganymede put where
  Juno's own track puts it.

That last run is needed because Horizons is not consistent with itself
here. Its Juno about Ganymede differs from its Juno about the barycentre
less Ganymede about the barycentre by a smooth 11.3 km (0.12 m/s) through
the whole window. Juno's trajectory was fitted with a different Ganymede
from the one Horizons serves. The Ganymede that fits Juno's track is Juno
about the barycentre less Juno about Ganymede.

| Moons in the kernel | 3 min after closest approach | 9 h after | Closest approach (Horizons: 3,677.39 km) |
| --- | ---: | ---: | ---: |
| none (system at its barycentre) | 169 km | 9,307 km | 3,707 km |
| `moons.js` (the jup365 tables) | 0.24 km | 22.7 km | 3,677.3 km |
| Horizons' Galilean moons | 0.24 km | 22.9 km | 3,677.3 km |
| Horizons', Ganymede as Juno's track has it | 0.01 km | 0.09 km | 3,677.37 km |

What this shows:

- **The moons' pull is now there.** Without the moons the kernel misses by
  9,300 km nine hours on. With them it follows Juno to 90 m, given
  Ganymede's right place: a residual drift of 3 mm/s on a bend of
  0.28 km/s. With the old fixed-step Cowell integrator the same run was
  4.0 km off: nearly all of that was the integrator's
  ([kernel](physics/nbody-kernel.md#integrators)).
- **The force model is not the limit; the moons' places are.** The 11 km
  between Horizons' two Ganymedes accounts for all but 0.1 km of the
  22.9 km in the third row. `moons.js`'s Ganymede, from the `jup365` tables, is within 0.3 km of
  the one Horizons serves, so the app's own run matches that row (22.7 km
  against 22.9). With the fallback's Ganymede (astronomy-engine's
  `JupiterMoons`, about 300 km from JPL's) it was 323 km.
- **The moons' own fields count for little here.** Ganymede's $J_2$ and
  $C_{22}$ ([kernel](physics/nbody-kernel.md#the-moons-own-fields)) moved the
  last row by 0.18 km (measured with the fixed-step integrator). At 1.4 Ganymede radii the field is
  $10^{-4}$ of Ganymede's pull.
- **Jupiter's field beyond $J_2$ plays no part.** The kernel carries it to
  $J_{12}$ (from Juno's gravity science [2]); without it the last row
  moves by 1 m, since Juno stays beyond 7.7 Jupiter radii.
- **Events behave.** The primary goes from Jupiter to Ganymede at its
  24,500 km sphere of influence and back.

### Juno at Io

On its 57th perijove, on 30 December 2023, Juno flew 1,496 km over Io
(closest approach 08:37:10 TDB, 3,317.1 km from the centre) at 30.09 km/s.
Four hours later it passed 1.016 Jupiter radii from Jupiter's centre
(12:40 TDB) at 59 km/s. The span flown tests both: Io's field, and
Jupiter's.

- **Reference:** Horizons vectors [1] (`fixtures/flyby_juno_io.json`), the
  same reconstruction, from 02:30 to 14:40 TDB: six hours in to Io, then
  on through the perijove and two hours out.
- **Method and runs:** as at Ganymede, with Io where Juno's track has it
  (Horizons' Io is 9.8 km from that one, much as its Ganymede is 11 km
  from Juno's). Beside it, the same run:
  - without Io's $J_2$ and $C_{22}$;
  - with Jupiter's field cut to $J_2$ alone, and to $J_2$ and $J_4$ [2];
  - with $J_2$ in the kernel and $J_4$ written out again in the test as
    an outside force;
  - with Io's Hermite nodes every 10 minutes;
  - at tolerances of $10^{-10}$ km (Encke) and $10^{-9}$ km (Cowell) a
    step.

| Moons and field in the kernel | 1 h after the Io pass | At the perijove | 2 h after it |
| --- | ---: | ---: | ---: |
| none (system at its barycentre) | 441 km | 3,042 km | 6,967 km |
| `moons.js` | 1.092 km | 9.97 km | 15.8 km |
| Horizons' Galilean moons | 1.100 km | 10.08 km | 15.9 km |
| Horizons', Io as Juno's track has it | **0.041 km** | **0.276 km** | **0.554 km** |
| the same, without Io's $J_2$ and $C_{22}$ | 0.186 km | 0.855 km | 2.49 km |
| the same, Jupiter's $J_2$ alone | 0.054 km | 22.5 km | 150 km |
| the same, Jupiter's $J_2$ and $J_4$ | 0.041 km | 0.790 km | 5.04 km |
| the same, $J_2$, and $J_4$ outside the kernel | 0.041 km | 0.790 km | 5.05 km |
| the same, Io's nodes every 10 min | 0.042 km | 0.280 km | 0.558 km |
| the same, tighter tolerances | 0.041 km | 0.276 km | 0.554 km |

Closest approach to Io: 3,317.10 km in every run with the moons
(Horizons: 3,317.09 km).

- **The pass measures Io's field.** Io bends Juno by 0.12 km/s, 441 km an
  hour on. Its $J_2$ and $C_{22}$ (Park et al. 2025,
  [kernel](physics/nbody-kernel.md#the-moons-own-fields)) take what is
  left from 0.186 km to 0.041 km.
- **The perijove measures Jupiter's.** With $J_2$ alone Juno is 150 km off
  two hours after the perijove. $J_4$ takes that to 5.0 km, and $J_6$ to
  $J_{12}$ to 0.55 km ([kernel](physics/nbody-kernel.md#oblateness-j2)).
  The kernel's $J_4$ and the same term written out separately agree to
  0.2 m at the perijove.
- **What is left is not the kernel's numerics.** Neither finer nodes for
  Io nor tighter tolerances move it. Nor does Durante's own pole for
  Jupiter in place of the IAU's (they are $7\times10^{-6}$ rad apart; 12 m
  at the end). It is the gap between the two force models, which this
  check cannot split further: Jupiter's tides and tesseral terms, the
  field the reconstruction was fitted with, and Juno's own small forces (sunlight on its arrays, for
  one).
- **Jupiter's centre on hourly nodes** made this check a little worse,
  not better. On 6-hour nodes the centre was 17 m off JPL's table here
  and the runs read 0.22 km at the perijove and 0.44 km after it. On
  hourly nodes it is within 0.1 m, and they read 0.28 and 0.55 km. The
  old error was partly cancelling the gap above; the new figures are the
  honest ones.
- **The places of the moons set the rest.** With Horizons' Io (9.8 km
  off Juno's) it is 1.1 km an hour on; `moons.js`'s Io matches that run to
  8 m.

### Cassini at Titan

On its T45 pass, on 31 July 2008, Cassini flew 1,613 km over Titan
(closest approach 02:14:20 TDB, 4,188.9 km from the centre) at 6.24 km/s,
19 to 20 Saturn radii out. At that height Titan's atmosphere is far too
thin to matter to the orbit.

- **Reference:** Horizons vectors [1] (`fixtures/flyby_cassini_titan.json`):
  Cassini (-82) about the Saturn system barycentre, from the final
  post-mission reconstruction, from 17:10 on 30 July to 11:10 on 31 July
  TDB, nine hours either side; Saturn's centre about the barycentre; the
  seven major moons (601–606, 608) about the centre.
- **Runs:** as at Io, with Titan's nodes every 10 minutes in place of
  $J_4$ (Saturn's is under $10^{-15}$ km/s² out here).
- **Titan's nodes** are two hours apart since November 2026; the runs
  before had them three hours apart (below).

| Moons in the kernel | 3 min after closest approach | 9 h after | Closest approach (Horizons: 4,188.89 km) |
| --- | ---: | ---: | ---: |
| none (system at its barycentre) | 1,074 km | 22,134 km | 4,426 km |
| `moons.js` | 0.003 km | 0.712 km | 4,188.89 km |
| Horizons' moons | 0.013 km | 0.204 km | 4,188.90 km |
| Horizons', Titan as Cassini's track has it | 0.016 km | 0.004 km | 4,188.90 km |
| the same, without Titan's $J_2$ and $C_{22}$ | 0.011 km | 0.369 km | 4,188.90 km |
| the same, Titan's nodes every 10 min | 0.016 km | 0.007 km | 4,188.90 km |

- **The kernel follows Cassini to 4 m** nine hours after the pass, given
  Titan where Cassini's track has it.
- **That needed the kernel's own Titan to be closer.** A pass this slow is
  sensitive to where Titan is. Its Hermite nodes were three hours apart,
  the spacing that held Titan to 100 m; at closest approach they put it
  27 m from the table, and Cassini was 0.093 km off nine hours on. Two
  hours apart, to 10 m ([kernel](physics/nbody-kernel.md#moons)), they put
  it 14 m off and leave 4 m; nodes every 10 minutes change nothing more.
- **Titan's field is measured too.** Its $J_2$ and $C_{22}$ (Iess et al.
  2010) take the error from 0.369 km to 0.004 km.
- **Horizons is nearly consistent here.** Its Titan is 0.04 km from the one
  Cassini's track has, and that alone makes 0.2 km of the difference
  between the third and fourth rows. `moons.js`'s Titan (sat441) leaves
  0.71 km.

The same file checks:

| Model | Reference | Result |
| --- | --- | --- |
| each split system's planet centre and moons from the kernel's Hermite nodes, 20 days | `moons.js` and astronomy-engine directly | worst 31 m (Rhea); Jupiter's system 12 m (104 m before its centre's nodes went from 6 hours to 1) |
| 200 days of cruise from Earth | the moons' ephemerides | never evaluated; no system split |
| split and fold of Jupiter at 1.3, 1.2, 1.4 and 1.6 times its sphere of influence | the thresholds | folded, split, split, folded (in at 1.25, out at 1.5) |
| Pluto at 6 AU, 4 AU, 10⁶ km, 8 AU | its 5 AU reach | away, folded, split with Charon, away |
| two craft, one near Jupiter, one far | their own views | 13 bodies and 9 |
| a fall onto Ganymede at 3 km/s | impact event, found where the step crossed the surface | `impact` on `ganymede` 0.0 m from the surface at 3.94 km/s (it was found 46 km in, a 14 s step late) |
| the moons' $J_2$ and $C_{22}$ acceleration, Ganymede's field about tilted axes | central differences of the potential | $7.6\times10^{-10}$ relative |
| Jupiter's zonal field to $J_{12}$, about tilted axes, 1.05 to 1.6 Jupiter radii out | central differences of the potential | $1.8\times10^{-9}$ relative ($J_5$ to $J_{12}$ up to 0.4 % of the field's pull there) |

## The largest asteroids (`asteroids.test.mjs`)

SB441's 25 asteroids in the app (`sbTable.js`; the 16 most massive and the
9 other named bodies `sb441-n373s.bsp` covers), and the 16's gravity in the
kernel ([small bodies](frontend/small-bodies.md#exact-positions-for-the-largest),
[kernel](physics/nbody-kernel.md#asteroids)).

| Model | Reference | Result |
| --- | --- | --- |
| the Chebyshev table, asteroid less Sun | SB441 (`c/sb_cheb.c`, `spkezr_c` every 0.37 days, 2000–2050) | within 0.94 km |
| the JavaScript reader | SB441 (`fixtures/asteroids_sb441.json`: `spkezr_c`, 25 bodies, 11 dates) | within 0.49 km and 1.4 mm/s |
| main belt and Eros, 2000–2050 | JPL Horizons, current orbit solutions (`fixtures/asteroids_horizons.json`) | within 340 km (Hygiea, 2050), within 200 km in 2025; Ceres 49 km, Vesta 73, Psyche 280, Eros 3 |
| the trans-Neptunian objects | Horizons | 9,900 to 198,000 km (Orcus): their 2021 solutions; the 2026 ellipses are 9 to 10 million km off |
| the 2026 ellipses the labels used before | Horizons | 2.4 million km (Eros) to 72 million (Hygiea) |
| the points refreshed from the table every 5 days | the table | within 0.48′ as seen from the Sun; Sedna 3.7′, half a step of its packed M |
| two-body past the table's ends | the end's state carried a minute | within 6 m; there and back over 30 days to 1 mm |
| 300 days of cruise from the Earth; a year in the belt | the same with no asteroids, and with all 16 everywhere | 0.16 km and 0.30 km in all; the 1 AU reach leaves out 0.16 and 0.30 |
| a Dawn-like orbit about Vesta (950 km, August 2011), two days | two-body about Vesta | 950.0 km throughout; 23,300 km away without the asteroids |
| a Psyche-like approach from 15,000 km at 50 m/s, August 2029 | the two-body hyperbola about Psyche, pericentre 560.3 km | 561.5 km (hourly samples); 1,003 km without the asteroids |

Horizons and SB441 differ by what the orbits have learned since 2021, so
the Horizons rows bound the source, not the fit.

### The kernel about the solar system barycentre

On 17 November 2026 the kernel moved from integrating about the Sun, with
an indirect term for the Sun's acceleration, to integrating about the SSB
with DE442's Sun as a moving body
([kernel](physics/nbody-kernel.md#about-the-solar-system-barycentre)). The
whole of `npm test` ran before (main at 0ccd10e) and after. Everything
passed both times, and these are every number that moved:

| Check | About the Sun | About the SSB | Why |
| --- | ---: | ---: | --- |
| LEO 1 day, against a Cowell reference at 1/20 the step | Encke 0.58 m, Cowell 6.9 m | 0.66 m, 6.7 m | the reference's own rounding: Cowell carries absolute coordinates at 1 au, $3\times10^{-8}$ km an ulp, over 196,000 steps |
| HEO 10 days, hybrid against the reference | 0.184 km | 0.187 km | the same |
| craft drawn while the kernel lags, low orbit 1 h | 5.6e-4 km | 4.5e-4 km | the same reference noise |
| the app's aims flown through the kernel client a frame later | 1.66 m apart at entry | 1.44 m | — |
| Artemis I, every burn as flown, blind | 712,146.2 km at the end | 712,146.1 km | — |
| Artemis II from before TLI, entry | 3,716.8 km off | 3,716.9 km | — |
| Artemis II, no fixes (and with the full environment), entry | 3,713.9 (16,021.2) km | 3,714.0 (16,021.4) km | — |
| journey planner, Mars and back | 181 m/s of corrections, 22.4 km off | 191 m/s, 22.6 km | the aimed corrections are re-solved from a slightly different path |
| asteroids' pull in 300 days of cruise | 0.161 km | 0.330 km | now their direct pull alone: their pull on the Sun is in DE442's Sun in both runs |
| asteroids' pull in a year through the belt | 0.304 km | 0.352 km | the same |

Every other line of the suite's output is unchanged to its printed digits,
including the moons, the NESC cases, Juno at Ganymede, the Artemis I
force-by-force residuals and the Apollo subsatellites.

### The kernel's error-controlled integrator and cheaper steps

On 18 November 2026 Cowell's integrator became Dormand-Prince 5(4) with
error control, in place of Yoshida's fixed fraction of the dynamical time,
and Encke's steps began placing the other bodies once a step
([kernel](physics/nbody-kernel.md#integrators)). The whole of `npm test` ran
on main (6cb00fa) and after. Everything passed both times. The numbers that
moved, besides the kernel's own checks above:

| Check | Before | After | Why |
| --- | ---: | ---: | --- |
| Juno at Ganymede, JPL's moons, Ganymede as Juno's track has it, 9 h on | 3.96 km | 0.09 km | the old integrator's own error |
| Juno at Ganymede with Horizons' moons (and `moons.js`'s) | 20.9 (20.8) km | 22.9 (22.7) km | the 11 km between the two Ganymedes, no longer partly offset by the integrator's error |
| entry prediction against the kernel's flight, bank 75° | 15.3 km apart | 3.6 km | the same |
| Artemis I's entry from the last flown state | 9.1 km from NASA's splashdown | 6.9 km | — |
| Artemis I, every burn as flown, blind | 712,146 km at the end | 712,154 km | — |
| Artemis I residuals with the full environment | 5.35 m rms | 5.28 m rms | — |
| Artemis II, no fixes (full environment), entry | 3,714.0 (16,021.4) km | 3,713.4 (16,020.3) km | — |
| Artemis II's injection burn flown in one fixed direction (a contrast case) | 0.83 km, 6.9 m/s off | 2.46 km, 2.1 m/s | the burn now integrated to the tolerance |
| Galileo's VEEGA flown, corrections over six years | 1,151 m/s | 1,140 m/s | the aims re-solved |
| NESC cases 2, 3B and 6B through the kernel | 4, 4, 7 mm (Yoshida, η 0.002) | 3, 3, 10 mm (Dormand-Prince, 10⁻⁸ km) | — |

Everything else, the moons, the asteroids and the other NESC cases among
them, is unchanged to its printed digits or within a step's rounding.

## Spacecraft in the app (`craftKernel.test.mjs`)

| Behaviour | Result |
| --- | --- |
| craft driven through the Worker client vs stepped directly | identical |
| drawn position vs exact state (results a frame late) | 0.02 km in low orbit, 0.38 km in cruise; up to ~11,000 km during a close Earth pass at 100 days/s |
| drawn position carried forward while the kernel lags | low orbit (two-body plus J2): 5×10⁻⁵ km at 10 min, 6.5 m at 1 h; GEO 0.74 km at 6 h; cruise 0.03 km at 1.7 days |
| Artemis II drawn while the kernel lags at a day a second (`warp.test.mjs`) | from before the injection, 15 h on: 6.8 km from the flown path (was 17,052 km); a day past separation: held at the entry interface (120.3 km up, 11.0 km/s; was 191 million km out), then the kernel's splashdown, where it stays |
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

## Journeys (`journey.test.mjs`)

Curtis's chapter 4, 6, 8 and 13 worked examples, the journey's chaining rules,
and journeys flown by the kernel to their waypoints; the table is in
[the journey page](physics/journey.md#validation-journeytestmjs).

| Check | Reference | Result |
| --- | --- | --- |
| Hohmann, bi-elliptic, phasing, plane change | Curtis Ex 6.1, 6.3, 6.4, 6.5, 6.11, 6.12 | to the book's figures |
| Windows, departure, capture, flyby, Lambert leg | Ex 8.1, 8.2, 8.4, 8.5, 8.6, 8.8, 8.9, 8.10 | to the book's figures (Ex 8.8 within 0.12 % on DE442) |
| Restricted and optimal staging | Ex 13.4, 13.5 | to the book's figures |
| Mariner 10, Earth to Mars, a lunar free return, a Moon round trip, flown | the plan | every periapsis within 17 km, home within 3 km |
| Resonant returns: the 2:1 cone; Galileo's Earth to Earth on NASA's dates; Galileo's whole route flown | geometry; PDS mission catalogue | 2:1 chosen, back on 8 Dec 1992, Earth flybys 0 and 70 m/s; flown within 20 km at Venus and Earth, 1.4 % at Jupiter |
| Landings: the descent orbit burn, an entry periapsis, braking and ascent; a Moon landing with a stay, up and home, flown headless and by the Craft, both in the full model (GRAIL to degree 50) | Curtis 6.2; geometry; the plan; the headless site | to 10⁻¹² and 10⁻⁹; down on the Moon at 2.2 m/s, the entry perigee 118 km for 120; the live Craft down 60 m from the headless site (the bare model's burns flown with the mascons hit the Moon at 47 m/s) |
| Leaving a moon by where it is: the hyperbolas onto an excess velocity; lunar orbit to Mars priced and flown; the month's strip; the best day in the stay, flown | the eccentricity vector (Curtis Sec. 2.5); the full-model flight | to 1.2 × 10⁻¹³; priced 2,227 m/s, flown 2,257 (1.4 %, within 3 %); lows a month apart; the best day priced 1,657, flown 1,666 |
| Mars orbit to the Moon, flown: lunar orbit and a landing | the plan | 1.3 km off the planned periapsis; capture within 3 % of its price; down at 2.3 m/s |
| The parking orbit's plane: the node's J2 rate; the rate flown in the field against the kernel's; the burn out of the plane; a year at Mars priced and flown, as planned and on the lamp's day | Curtis Ex 4.8, eqs. (4.52), (8.42); the kernel; a 7,200-point scan; the full-model flight | to the book's figures; 0.06 % (within 0.25 %); to 0.1 m/s; the planned day 2,911 m/s, flown 3,043 (4.3 %); the wait 12.5 d, flown 11.5 (2,025 against 2,070 m/s); the parking orbit lamp's day 2,008, flown 2,086 on time |
| The full model's fallback to the bare one | the rules on the journey page | each kind of trouble a reason |
| Near 180° round the Sun, the broken plane: lunar orbit to Mars, a 23- and a 20-day stay | Abilleira (ISSFD 2007); Curtis eq. (6.20); Napier's rule; the full-model flight | 4.572 km/s against the direct arc's 15.69; the break a pure plane change to 10⁻³; smooth through 180°; flown with 205 m/s of corrections against the direct arc's 679 |

## Rockets (`rocket.test.mjs`, `rocket.xcheck.test.mjs`, `ork.test.mjs`)

| Model | Reference | Result |
| --- | --- | --- |
| Optimal staging, three stages, 5,000 kg to 10 km/s | Curtis Example 13.7 | η and mass ratios to the book's four figures; stage masses and total within 0.1 % |
| Gravity-turn ascent with drag | Curtis Example 13.3 | burnout speed, altitude and downrange within 0.1 %, flight-path angle within 0.02°; losses within 5 m/s |
| Launch into a 51.6° orbit from Florida, cutoff at orbital speed | | inclination within 0.01°; level to 0.01°; circular to 10⁻³ |
| A journey's stack as the ROCKET tab's vehicle (`launchers.test.mjs`): Earth to Mars orbit, and the Moon landed and home, sized by STACK and flown up the ascent | the rocket equation on the sized stack; the real launchers' medians; the job's delta-v | the sized delta-v to 10⁻⁹; liftoff T/W 1.381 (Falcon 9's); into orbit, keeping the journey's delta-v to within 5 % (3.8 % and 0.3 % short) ([details](physics/rocket.md#the-journeys-stack)) |
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

## Real flight: Juno's Earth flyby (`missions.validate.mjs`)

Juno from 25 August 2012 to 30 November 2013 against JPL's navigation
reconstruction (through JPL Horizons). See
[Juno 2012–13](validation/juno2013.md).

| Check | Result |
| --- | --- |
| DSM-1 and DSM-2, found in the trajectory | 344.28 m/s in 1,780 s and 387.94 m/s in 1,770 s (NASA: about 344 m/s in 29 min 39 s, about 388 m/s in 30 min); DSM-2 lit at NASA's 22:30:00 UTC |
| 10 coast arcs, 6–210 days, about the Sun | gravity alone rms 2,062 km at the ends; with sunlight on the arrays fitted (91 % of the craft as built), rms 139 km, worst 398 km (the 210-day arc); under 5 km for the first three weeks |
| The Earth flyby | 561.1 km above the ellipsoid at 19:21:25 UTC (559 km, 19:21 published); the kernel through the pass ends 35 m and 1.8 mm/s off (J2 alone: 0.72 km, 36 mm/s); 125,531 to 139,377 km/h about the Sun (126,000 to 140,000) |
| The flyby anomaly | Anderson's formula predicts 6.4 mm/s; the kernel's v∞ after the pass is 0.47 mm/s from the reconstruction's |
| The app's file (`public/missions/juno2013.json`), flown as the app flies it | aimed: perigee 561.7 km (flown 561.8), 0.1 km off at the end, 157 km at worst, for 0.29 m/s more than the flown burns; blind, it hits the Earth |

## Real flight: DART's impact on Dimorphos (`missions.validate.mjs`)

DART from 20 August 2022 to its impact on 26 September against its
navigation reconstruction and final solution (through JPL Horizons). See
[DART](validation/dart.md).

| Check | Result |
| --- | --- |
| SMART Nav's terminal guidance, found in the trajectory | toward Dimorphos 22:24:50 to 23:11:50 UTC (Daly et al.: from 50 minutes before the impact, 22:24:24, to 23:11:52), 0.586 m/s |
| LICIACube's release | a 33 mm/s step at 23:13:50 on 11 September (published 23:14 UTC) |
| 4 coast arcs, 4–19 days, about the Sun | gravity alone rms 179 km at the ends; with sunlight on the arrays fitted (72 % of a flat plate), rms 11.6 km, worst 20.4 km |
| The impact, on the final solution | 23.6 m from Dimorphos's centre at 6.14478 km/s, the centre's closest point 14 ms after the impact (Daly et al.: 25 ± 1 m, 6.1449 ± 0.0003 km/s, 23:14:24.183 at the surface) |
| The app's file (`public/missions/dart.json`), flown as the app flies it | aimed: 23 m from Dimorphos's centre, for 2.59 m/s more than the flown burns; blind, 180 km |

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

## Attitude in the app (`attitude.test.mjs`)

A craft's attitude as the app carries it: the rotational half of
`sixdof.js` on a translation it is given, a sampled controller with finite
torque, and burns along the body axis to the kernel
([Attitude in the app](physics/sixdof.md#attitude-in-the-app)).

| Check | Reference | Result |
| --- | --- | --- |
| NESC rotation cases 8A, 8B (torque-free), 9A, 9B (torque pulse), 10A–D (gravity gradient), through the app's stepper on the case's own translation, 8 h | the closest NASA tool | within 5×10⁻¹⁴ rad/s and 3.4×10⁻⁹ deg (tolerance 10⁻¹⁰ rad/s, 10⁻⁶ deg); 2.6×10⁻¹⁶ rad/s from `sixdof.js` integrating both |
| Turns of 10°, 45°, 90°, 120° and 170° about fixed axes, to settled | the bang-coast-bang least time under the torque and rate limits | never faster; 2.8–30 % slower (the margin and the final approach weigh most in short turns) |
| The same turns | the controller's closed-form time (`slewTime`) | within 0.6–4.6 % |
| A 90° slew to prograde in a 400 km orbit, by the app's craft at 60 fps through the kernel | the controller's time; the least time | 33.82 s against 34.12 s (0.9 %) and 32.13 s; settled within 0.01° of prograde |
| A 428 m/s burn along the body axis held prograde, 600 s | the kernel's point-mass burn steered prograde | 0 m |
| The same, about a point-mass Earth | `sixdof.js` with translation and attitude together, the app's controller in the loop | 0.21 m (the kernel's point-mass burn: 0.42 m, the Sun's and Moon's tides) |
| The same burn begun 30° off prograde, turning as it burns | the same coupled run (fixed inertia; the app's falls 2 % over the turn) | 1.2 m, of the 7.5 km the turn costs |
| A weathervane: 2° in pitch at 7.8 km/s in air of 2.5×10⁻¹⁰ kg/m³, the centre of pressure 0.3 m aft | the small-angle period $2\pi/\sqrt{q C_D A\,|r_{cp}|/I}$ | 1,598.9 s against 1,598.8 s |
| A craft held prograde, two days at a day a second | its point-mass twin's frame | no attitude steps; no slower |
| The thrusters' impulse for rest-to-rest turns of 10°, 90°, 120° and 170° | $2I\omega_\text{peak}/L$, the angular momentum given and taken back, over the thrusters' arm | within 0.17 % (tolerance 1 %): 169.9 N s against 170.2 N s for 90° in pitch, 59.8 g at 290 s |
| The same through the craft: a 90° slew to prograde in a 400 km orbit | the same; the tank's loss against $J/(I_{sp}g_0)$ | 0.13 % (tolerance 1 %); the tank to 10⁻¹² kg |
| Held prograde for 60 s | the hold's limit cycle in closed form, each frame's | to 10⁻⁸ (the clock's rounding): 0.667 N s, 0.338 kg a day, against 1.5×10⁻⁵ N s for the gravity gradient alone |
| The hold's limit cycle, centred, no disturbance, flown pulse by pulse (one 0.29 N s bit a thruster past the 0.5° deadband, sampled every 0.1 s), pitch and roll | Jackson et al.'s two-sided cycle, eqs. (1)–(2) (NTRS 20080000345) | to 0.5 % (tolerance 0.5 %): a firing every 97.80 s in pitch and 120.37 s in roll, both as eq. (1); the closed form without a disturbance 2/3 of eq. (2), exact |
| The same from six random starts, disturbances of 0.003 to 0.1 and 0.9 to 5 times $R_2 L$ | the closed form: $\tfrac23 R_2$ two-sided, $\lvert\tau\rvert/L$ one-sided | within 5.0 % (tolerance 6 %) |
| The same at 0.4 and 0.6 times $R_2 L$ | $3\lvert\tau\rvert/L$, two pulses to one | its own cycle within 0.35 % (tolerance 1 %); every random start between a third of it (one-sided for days first) and all of it |
| The same at 0.15 and 0.2 times $R_2 L$, where the cycles mix | the closed form | within 30 % (tolerance 50 %) |
| The tanks' inertia, 500 kg in two spheres of 0.37 m, 0.6 m fore and aft | $\tfrac25 mR^2$, plus $md^2$ across (parallel-axis theorem, Curtis ch. 9) | exact: 27.38 and 207.38 kg m²; full, the box's diag(1000, 1625, 1625) |
| A 90° slew with 50 kg of propellant left | the controller's closed-form time for the inertia then ($I_{yy}$ 1,438 kg m²) | 33.52 s against 33.85 s (1.0 %, tolerance 6 %), faster than full (34.12 s) |
| A node 20 m/s radial out an hour ahead, held prograde, at 1/4 s frames | the turn's lead $1.1\,t_\text{slew} + 5$ s; the point-mass craft with the same node | turn began 42.54 s ahead (as planned), locked 8.5 s before the node; 0° off the node's direction; 3 mm from the point mass after; back to prograde |
| The same at 600 s frames | the same | turn began 41.54 s ahead (the orbital frame turns 2.7° in the lead); 46 mm from the point mass |
| A node 10 s ahead | — | the log says it cannot settle in time |
| The MISSION tab's craft, after ROCKET-tab stages got their own attitude | its spec as validated above | unchanged: the box, its tanks and its thrusters (with its hold's deadband and bit) |
| A ROCKET-tab stage's tensor: Saturn V's S-IVB at cutoff, 59.7 t dry with the spacecraft and 107.1 t of propellant at 320 kg/m³, 10.1 m across | the thin-walled cylinder's $m R^2$, $m(R^2/2 + L^2/12)$ and the solid propellant cylinder's $mR^2/2$, $m(R^2/4 + h^2/12)$ (Curtis ch. 9), against both bodies summed point by point | within 3×10⁻⁵ (tolerance 10⁻⁴): full, diag(2.887, 2.612, 2.612)×10⁶ kg m²; the tank holds the load at its density to 10⁻¹² |
| The stage's thrusters | the MISSION craft's angular acceleration, full | equal on every axis (1.146°/s² in roll, 1.410°/s² in pitch and yaw) |
| The stage's impulse bits | its thrusters' thrust times the default's 14.5 ms (0.29 N s at 20 N), in the same 0.5° deadband | exact: 82.9 N s in roll, 65.3 N s in pitch and yaw; held without a disturbance at 70 %, 92.4 kg a day |
| A 90° slew to prograde by that stage with 70 % of its propellant, through the kernel | the controller's closed-form time for its inertia; $2I\omega_\text{max}/L$ | 33.52 s against 33.89 s (1.1 %, tolerance 6 %); 34,573 N s against 34,633 N s (0.17 %, tolerance 1 %), 12.2 kg |

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
| Earth axes (precession, nutation, sidereal time from UT1, polar motion: the Earth orientation table) | CSPICE `pxform_c` to ITRF93, 408 instants 2000 to 2126 | to 9 Feb 2027 (the high-precision PCK): worst 4.2 cm, rms 1.6 cm at the surface; after it, a steady 82.5 m from NAIF's Aug 2026 long-term prediction, which the table joins onto newer data instead ([orientation](physics/orientation.md#earth)). Was 0.0016° (180 m), with UTC for UT1 and no polar motion |
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

## Twinkling (`scintillation.test.mjs`)

| Check | Reference | Result |
| --- | --- | --- |
| Hufnagel–Valley 5/7: r₀ and θ₀ straight up at 0.5 µm | 5 cm and 7 µrad by its definition | 4.96 cm, 6.90 µrad |
| Weak turbulence | σ_I² = σ_R² | to 1 % at σ_R² = 10⁻³ |
| Airmass | σ_R² ∝ sec^(11/6) z | exact; σ_I² rises 0.20 → 0.88 from 0° to 70° |
| Strong turbulence | σ_I² saturates at 1 | 1.24, 1.14, 1.03 at σ_R² = 10, 100, 10⁴ |
| Height | the turbulence is low | σ_R² at 10, 20, 30 km: 0.11, 1×10⁻³, 0 of the ground's |
| Air's refractivity | Edlén (1966), standard air: 2.7782×10⁻⁴ at 550 nm | 2.7782×10⁻⁴; blue 1.51 % above red |

## The corona (`corona.test.mjs`)

| Check | Reference | Result |
| --- | --- | --- |
| Baumbach's brightness at the limb | 10⁻⁶ (0.0532 + 1.425 + 2.565) of the disc's centre | 4.0432 × 10⁻⁶ |
| Fall-off | steep inside 2 radii, then ρ^−2.5 | 0.5 % of the limb's at 2 radii; the ρ^−2.5 term alone by 6 |
| In the scene | the disc's centre is 46,000/0.805 of white | 0.231 of white at the limb |

## How much of the Sun is in view (`discs.test.mjs`)

| Check | Reference | Result |
| --- | --- | --- |
| Overlap of two discs, 20 partial cases | the overlap counted on a 1200 × 1200 grid | within 3×10⁻⁵ |
| Annular eclipse, 14 Oct 2023 | magnitude 0.95204, obscuration 0.90638 | 0.90638 |
| Total eclipse, 8 Apr 2024 | magnitude 1.0566 | none of the disc in view |
| Transit of Venus, 6 Jun 2012, in the app | Venus 58″ on the Sun's 1891″: 0.094 % | 0.093 % hidden |
| Transit of Mercury, 11 Nov 2019, in the app | Mercury 10″ on 1940″: about 0.003 % | 0.0026 % hidden |

## A small body's plate (`smallbodies.test.mjs`)

| Fact | Reference | Result |
| --- | --- | --- |
| Ceres's period, perihelion and aphelion | NASA: 4.6 years, 2.55 to 2.99 au | 4.599 yr, 2.545 au, 2.986 au (osculating, 2026) |
| Halley's period and perihelion | NASA: about 76 years, 0.59 au | 75.47 yr, 0.572 au (osculating, 2026) |
| Vis-viva speed | the drawn positions a minute apart | within 10⁻³ km/s (Ceres 17.140 km/s) |
| Diameter from H and albedo | Ceres measured, 939.4 km (SBDB) | 951 km from H 3.34 and albedo 0.090 |

## Earth satellites (`satellites.test.mjs`)

SGP4 and SDP4 (satellite.js, opsmode a), the TEME to J2000 turn, and the
shipped snapshot ([Earth satellites](frontend/satellites.md#how-right-they-are)).

| Model | Reference | Result |
| --- | --- | --- |
| SGP4, near-Earth, 158 states | Vallado et al. [4], verification set (`SGP4-VER.TLE`, MATLAB output) | within 0.14 mm and 0.81 µm/s |
| SDP4, deep space, 508 states (resonances, Lyddane choices, near-parabolic) | the same | within 35 mm and 15.5 µm/s (the OMM reader's epoch to the millisecond) |
| the error case 33334 | the same | refused (error 3) |
| TEME to J2000, "of date" | [4, App. C, eq. (C-3)], satellite 00005 | position within 0.82 m (the turn moves it 1,154 m), velocity within 0.50 mm/s, matrix as eq. (C-2) to 10⁻⁷ |
| the ISS, ±6 h of its epoch | JPL Horizons, the ISS (−125544) [5], geocentric ICRF | within 106 m and 0.12 m/s (TEME as J2000 would be 25.8 km off) |
| the snapshot, 16,892 satellites | placed at the fetch time | all, between the ground and 2 million km |
| the Earth's shadow (cylinder) | geometry; the ISS over an orbit | 39 % of the orbit in shadow at its epoch |

## Magnetic fields and auroras (`magnetic.test.mjs`, `aurora.test.mjs`)

The planets' internal fields, the field-line tracer and the auroral ovals
([magnetic fields and auroras](physics/magnetic-fields.md#validation), whose
references these are).

| Model | Reference | Result |
| --- | --- | --- |
| spherical-harmonic sum, IGRF-13 | NOAA Geomag 7.0's 20 published sample points (2015–2024.5, 0–30,000 ft, geodetic and geocentric) | X Y Z H F within 0.054 nT (its 0.1 nT printout), D and I within its minute |
| IGRF-14, 2015.0 | the same, where IGRF-14 keeps IGRF-13's DGRF 2015 | within 0.04 nT |
| JRM33 dipole | Connerney et al. 2022: 4.177 G R_J³, 10.25° toward 196.38° W | 4.1766, 10.250°, 196.379° |
| JRM33 surface field, 1/15.4 spheroid | the same: just under 2 to almost 22 G (to degree 18) | 1.77 to 21.9 G (degree 13) |
| Io's footprints, JRM33 + con2020, 144 longitudes | the paper's Tables S2 and S3 (degree 18) | within 1.17° of arc, rms 0.34°; peak \|B\| 19.8 G north, 12.3 G south (paper about 20 and 12) |
| Cassini 11 | Cao et al. 2020, Table 5; magnetic equator about 2,300 km north | coefficients as tabled; eccentric dipole 2,254 km north |
| Uranus and Neptune offset tilted dipoles | Ness et al. 1986, 1989, as JPL Publications 15-7 and 17-2 table them; Connerney's Q3 | moments, tilts and offsets as published; Uranus's moment within 4.9° of Q3's dipole |
| field-line tracer | a centred dipole's $L = 1/\cos^2\lambda$ | apex to 10⁻⁴, lands at −λ to 0.004° |
| Starkov's oval | Sigernes et al. 2011, eqs. 1–3, Table 1 | 84 coefficients as published; wider at midnight than noon; equatorward with Kp; diffuse edge equatorward of the oval. No published table of evaluated latitudes found to check against |
| Kp | CelesTrak SW-All.csv, 10–11 May 2024 | every three-hour value, the 9o included |
| corrected geomagnetic coordinates | a pure centred dipole (identity) | within 0.004° |
| Saturn's northern oval | Cassini 11 conjugate of 15° south | 13.3° from the north pole |
| Starkov's oval, IGRF-14, CGM and Kp together | NOAA's OVATION Prime map, forecast 03:09 UTC 18 Nov 2026 (Kp 3−), night side | mean probability 19.6 % mid-oval vs 7.7 % 6° equatorward and 1.0 % 6° poleward (north); 15.2, 7.1 and 0.8 % (south) |
| Neptune's auroral zone, L 3–20 | JWST: 30–60° S (Melin et al. 2025) | 24–48° S, mean 35° S |
| Mercury's offset dipole | Anderson et al. 2012: 190 nT R_M³, 479 km north; libinternalfield's expansion | as published; expansion within 0.06 nT |
| IGRF-14 after 2025 | NOAA's online Magnetic Field Calculator, 4 points 2025.4–2028.0, 0–400 km | X Y Z F within 0.049 nT, D and I within 0.00005° |
| Europa's and Ganymede's footprints (JRM33 + con2020) | Connerney et al. 2022, Tables S2, S3 | within 1.07° and 1.89° of arc, rms 0.34° and 0.43° |
| the moons' lead angles | Hue et al. 2023, Table 1 and its quoted means | means 4.26/4.14°, 5.75/7.06°, 12.33/13.02° (paper 4.3/4.1, 5.8/7.0, 12.3/13.0) |
| Ganymede's dipole | Weber et al. 2022 against Kivelson et al. 2002 | 719 vs 713 nT, 0.8° apart |
| Mars's crustal field | Langlais et al. 2019: Br −8,520 to 11,260 nT | −8,522 to 11,261 nT (0.25° grid), strongest at 47.9° S 174.6° E |
| radiation belt shells | a centred dipole's L = 4; the South Atlantic Anomaly | apex 4.000000, feet at 59.997°; IGRF-14's L = 1.25 shell lowest (984 km) at 11° S, 60° W |

## References

[1] JPL Solar System Dynamics, "Horizons System" API. Vectors for Juno (-61), from JPL's reconstructed trajectory `spk_rec_110805_*_260824`, and for Cassini (-82), from its final post-mission reconstruction. [Online]. Available: https://ssd.jpl.nasa.gov/api/horizons.api

[2] D. Durante *et al.*, "Jupiter's gravity field halfway through the Juno mission," *Geophys. Res. Lett.*, vol. 47, no. 4, Art. no. e2019GL086572, 2020, doi: 10.1029/2019GL086572. Coefficients from the PDS table `GRV_JUGR_SHA_JUP_U_DUR2020_20200203_V01.TAB` (Juno gravity volume `jnogrv_0002`). [Online]. Available: https://atmos.nmsu.edu/PDS/data/jnogrv_0002/DATA/SHADR/

[3] H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. Oxford, U.K.: Butterworth-Heinemann (Elsevier), 2020.

[4] D. A. Vallado, P. Crawford, R. Hujsak, and T. S. Kelso, "Revisiting Spacetrack Report #3," in *Proc. AIAA/AAS Astrodynamics Specialist Conf.*, Keystone, CO, USA, Aug. 2006, AIAA 2006-6753 (rev. 3), doi: 10.2514/6.2006-6753. Paper, code and verification set: https://celestrak.org/publications/AIAA/2006-6753/

[5] NASA JPL Solar System Dynamics, "Horizons system," ISS (−125544), TLE-based, revised 17 Nov. 2026. [Online]. Available: https://ssd.jpl.nasa.gov/horizons/
