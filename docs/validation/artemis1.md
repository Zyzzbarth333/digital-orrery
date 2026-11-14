# Artemis I: the kernel against the flown trajectory

Artemis I flew an uncrewed Orion to a distant retrograde orbit (DRO) about
the Moon and back, from 16 November to 11 December 2022. These checks
compare that flight with the app's own kernel:
- the burns, against NASA's as-flown figures;
- every coast between them;
- the two lunar flybys and the farthest point from Earth.

`npm test` runs `src/physics/artemis1.validate.mjs`;
`npm run crosscheck:artemis1` runs the cross-checks. The numbers below are
from November 2026.

## The reference

- **Trajectory:** NASA/JSC navigation's as-flown ephemeris,
  `Post_TLI_Orion_AsFlown_20221213_EPH_OEM`, through
  [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) (object −1023). It runs
  from after the translunar injection burn (08:46 TDB on 16 November) to
  just before entry (17:20 TDB on 11 December). NAIF holds no Artemis I
  kernel; Artemis II's came from NAIF ([Artemis II](artemis2.md)).
- **What it is:** NASA's navigation solutions joined end to end. Each piece
  is a prediction from one orbit determination, propagated by NASA's own
  flight-dynamics model until the next solution takes over. So:
  - **Between events** it is NASA's propagation, and a coast arc compares
    the kernel with NASA's model, not with the raw tracking. Artemis II's
    reference, a smoothed best-estimated trajectory, is the stronger test
    of the physics.
  - **At the joins** the next solution corrects the last prediction. The
    size of that step is how far the real flight had drifted from it.
- **Sampling:** `npm run fetch:artemis1` (`src/physics/artemis1.fetch.mjs`)
  fetches Orion every minute for the whole flight, and every 5 s around the
  six largest burns. Earth-centred, ICRF axes, UTC; cached in
  `~/.cache/digital-orrery/artemis1`. It writes
  `src/physics/fixtures/artemis1.json` (434 kB):
  - every minute of each event;
  - the 5-second burn windows;
  - the track every 30 minutes;
  - the farthest point.

## Finding the burns and the joins

The fetch script flies every minute of the flight with the kernel and
compares it with the next minute. A minute whose velocity differs by more
than 5 mm/s marks an event, and minutes within 5 of each other are one
event. That finds 86 events:
- **Burns** spread over minutes.
- **Joins** are a single step: an event whose largest minute holds more
  than 1.5 times its whole change.

An event's velocity change is the sum over its minutes. Single minutes
can't be trusted on their own, because Horizons' interpolation of the
ephemeris rings around a burn and swings either side of the thrust; the
event as a whole adds up.

## The burns: ours against NASA's

NASA's as-flown figures are from AAS 23-363, Table 1, its post-flight
review column, and Fig. 7 (ignition). Durations and engines are from
Belair et al., *Artemis I engine performance*, Table 1.

| Burn | Ignition (UTC) | Engine, duration | NASA | Ours |
| --- | --- | --- | --- | --- |
| OTC-1 | 16 Nov 14:32:39 | main engine, 30.5 s | 34.951 m/s (114.67 ft/s) | 34.948 m/s |
| Outbound powered flyby | 21 Nov 12:44:14 | main engine, 149.6 s | 178.640 m/s (586.09 ft/s) | 178.820 m/s (+0.10 %) |
| DRO insertion | 25 Nov 21:52:28 | main engine, 87.9 s | 110.639 m/s (362.99 ft/s) | 110.633 m/s |
| DRO maintenance 3 | 30 Nov 21:53:56 | auxiliary, 94.9 s | 13.219 m/s (43.37 ft/s) | 13.221 m/s |
| DRO departure | 1 Dec 21:53:56 | main engine, 105.1 s | 138.483 m/s (454.34 ft/s) | 138.479 m/s |
| Return powered flyby | 5 Dec 16:43:20 | main engine, 207.1 s | 292.904 m/s (960.97 ft/s) | 292.861 m/s (−0.01 %) |
| OTC-6, RTC-5 | 24 Nov, 10 Dec | auxiliary | 2.679, 1.524 m/s | 2.680, 1.538 m/s |
| 11 burns under 1 m/s | | RCS or auxiliary | 0.015 to 0.978 m/s | within 0.04 m/s |

- **Every one of NASA's 18 burns is found,** and every burn over 1 m/s is
  within 0.1 %, except RTC-5 (0.9 %). The largest small-burn gap is
  OTC-5: a 0.04 m/s thrust follows it three minutes later, and the minute
  sampling can't separate the two.
- **Ignition:** for the six largest, the first 5-second step whose thrust
  passes half the burn's peak comes within 2 s of NASA's time. DRO
  insertion starts with a minute of lower thrust before the main engine,
  so a lower threshold would put it 53 s early.
- **Durations are not measured.** Horizons' interpolation spreads a burn
  over minutes; OTC-1's 30.5 s looks like 275 s.
- **One event is in no NASA list:** the last 1 h 44 min before entry,
  inside 50,000 km, adds 6.7 m/s. No burn is listed there; it is most
  likely the ephemeris's own sampling close to Earth, where Orion moves
  fastest.

## The joins

There are 67 joins between navigation solutions:
- **Velocity steps:** 0.001 to 1.0 m/s, median 0.074 m/s.
- **Position steps:** median 49 m, largest 3.5 km.

They are how far the real flight drifted from each prediction before the
next orbit determination. They do not count against the kernel: a coast arc
never crosses one.

## Coast arcs

There are 77 arcs between events, from 1.2 to 24.7 hours, 589 hours in
all. Each is flown by the kernel from the state a minute after one event
to a minute before the next. `npm test` flies them with gravity alone and
with the full environment; `npm run crosscheck:artemis1`
(`src/physics/artemis1.crosscheck.mjs`) adds one force at a time, at an
eighth of the kernel's default step:

| Model | Worst at the end | RMS | Median |
| --- | --- | --- | --- |
| Gravity: point masses, and the J2 of the Earth, Moon and planets | 83.4 m | 22.5 m | 6.8 m |
| + Orion's sunlight pressure, C_r A/m = 4.6×10⁻³ m²/kg, with shadows | 47.4 m | 7.9 m | 0.6 m |
| + the Earth's field to degree 20 and the Moon's to 50 | 43.1 m | 5.5 m | 0.5 m |
| + the Earth's solid tides | 43.1 m | 5.5 m | 0.5 m |
| + relativity (the full model) | 43.1 m | 5.6 m | 0.5 m |

What each force moves an arc's end by, at most: sunlight pressure 85.5 m,
the two gravity fields 40.9 m, relativity 0.74 m, the tides 2 cm. At the
kernel's default step `npm test` finds 83.3 m and 22.5 m with gravity
alone, and 43.5 m and 5.6 m with the full model.

- **Sunlight pressure is in NASA's model.** The gravity-only gap grows with
  the square of the arc's length, as a small steady push would. Fitted
  across all 77 arcs, a push away from the Sun of 2.1×10⁻⁸ m/s² takes most
  of it out: about 4.6×10⁻⁶ N/m² on 60–80 m² of capsule and solar arrays,
  for 15 to 26 tonnes. The kernel flies Orion as a cannonball with
  C_r A/m = 4.6×10⁻³ m²/kg (92 m² at C_r 1.3 for 26 t), shadows included.
- **Tides and relativity are below what this data can show:** a few
  centimetres and under a metre, against NASA's own joins of tens of
  metres (below).
- **What is left** most likely follows Orion's falling mass (fixed at 26 t
  here, though propellant use took it lower), its attitude (a cannonball
  has none), and the venting that NASA's predictions could not know.

## Cross-checks

`npm run crosscheck:artemis1` checks the comparison three independent ways.

1. **The model, force by force:** the table above. Each force moves the
   arcs by about what its size predicts, and the full model ends every arc
   within 44 m of NASA's ephemeris.
2. **The integrator:** the full model flown by the kernel at its default
   step and at a half, a quarter and an eighth of it, against a plain
   fixed-step fourth-order Runge–Kutta written in the check (a different
   method; at 10 s and 5 s it agrees with itself to 2 mm):

   | The kernel's step | Worst against RK4 | RMS |
   | --- | --- | --- |
   | default | 2.48 m | 0.49 m |
   | ½ | 0.16 m | 0.03 m |
   | ¼ | 0.07 m | 0.02 m |
   | ⅛ | 0.07 m | 0.03 m |

   So the integrator's own error is centimetres at a fine step, a
   hundredth of the model's miss. At the app's default step it adds up to
   2.5 m to an arc. Encke's method never takes over on these arcs: between
   the Earth and the Moon the motion is far from a single conic, so the
   kernel flies them by Cowell.
3. **The data:** a dozen fresh states from JPL Horizons, asked for in TDB
   rather than UTC, against the fixture, and the Moon and the Sun at the
   same instants against the app's own:
   - Orion: the two agree to 0.11 m, so the stored trajectory and the
     UTC-to-TDB conversion are right (a second's error would show as about
     a kilometre);
   - the Moon from the Earth: the app's DE442 against Horizons', within
     2.5 m;
   - the Sun from the Earth: within 17 m.

The published numbers are a check of their own: NASA's burns, flyby
distances and farthest point, below and above, come from NASA's papers
and blog, not from the ephemeris.

## The lunar flybys and the farthest point

| | NASA | The trajectory | The kernel |
| --- | --- | --- | --- |
| Outbound flyby, closest approach | 81 mi (130.4 km) at 6:57 a.m. CST (12:57 UTC), 21 Nov | 130.4 km at 12:57:35 UTC | 130.4 km at 12:57:35, flown from 12:50 once the engine was off |
| Return flyby, closest approach | 80.6 mi (129.7 km) at 10:43 a.m. CST (16:43 UTC), 5 Dec | 129.6 km at 16:44:00 UTC | inside the burn, not flown |
| Farthest from Earth | 268,563 mi (432,210 km) above the surface, 21:06:10 UTC, 28 Nov | 432,207 km at 21:06 UTC | 432,207 km, flown from 17:06 |

## In the app

The app flies Artemis I from **Real missions** on the MISSION tab, or with
`?mission=artemis1` ([real missions](../frontend/mission.md#real-missions)).
Its file, `public/missions/artemis1.json` (619 kB), is written by
`artemis1.export.mjs` from the minute-by-minute cache and the fixture:
- **The flown path:** every 10 minutes; every 2 minutes within 30,000 km
  of the Earth; every minute within 15,000 km of it, within 8,000 km of
  the Moon and through every event; every 5 s through the six large
  burns. Interpolated, it is within 7.4 m of every minute left out.
- **The burns:** NASA's 18. The six large ones as each 5 s interval's
  change beyond gravity, from the first interval over a twentieth of the
  peak to the last; the twelve small ones as one steady push over NASA's
  duration from NASA's ignition time, along the change their whole event
  shows. Each is steered about the Earth or, inside its sphere of
  influence, the Moon. All are within 0.5 % of NASA's figures (the
  outbound powered flyby: 179.51 m/s against 178.64), or 0.05 m/s for
  those under 1 m/s.

Flown through the app's Craft model and kernel host in one-minute frames,
Orion as the app flies it (the full environment and the random vent model;
case 5):

| | Worst off the flown path | Flybys (flown: 130.4, 129.6 km) | At the end |
| --- | --- | --- | --- |
| Every burn replayed as flown | 712,000 km | 424.0 km, then none | 712,000 km |
| A fix every 12 h | 275 km | 130.3, 129.0 km | 6.0 km |
| No fixes, every burn after the first aimed from the craft | 238 km | 124.6, 130.6 km | 0.9 km |

Replayed blind, the craft passes the Moon at 424 km instead of 130, and
the distant retrograde orbit and everything after it never happen. Aimed from
the craft, as NASA's navigation aimed them, the 17 burns after the first
take 31.8 m/s more than they did in flight, 8.9 m/s of it at the outbound
powered flyby. The craft then comes down at 17:28 UTC on 11 December,
13.9° S, 119.6° W: the app flies entry as a ballistic fall, not Orion's
skip entry, which splashed down off Baja California at 17:40.

## Sources

- NASA/JSC navigation, `Post_TLI_Orion_AsFlown_20221213_EPH_OEM`, through
  JPL Horizons (object −1023), [ssd.jpl.nasa.gov/horizons](https://ssd.jpl.nasa.gov/horizons/).
- *Artemis I Operations*, AAS 23-363: as-flown burns (Table 1) and their
  times (Fig. 7),
  [NTRS 20230010480](https://ntrs.nasa.gov/api/citations/20230010480/downloads/AAS_23-363_artemis1-operations_rev2.pdf).
- Belair et al., *Artemis I Engine Performance*: durations and engines,
  [NTRS 20240003648](https://ntrs.nasa.gov/api/citations/20240003648/downloads/382_BELAIR_ARTEMIS_I_ENGINE_PERFORMANCE_FINAL.pdf).
- NASA Artemis I blog, flight days 6, 13 and 20: closest approaches and the
  farthest distance.
