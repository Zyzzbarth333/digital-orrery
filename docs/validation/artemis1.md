# Artemis I: the kernel against the flown trajectory

Artemis I flew an uncrewed Orion to a distant retrograde orbit (DRO) about
the Moon and back, from 16 November to 11 December 2022. These checks
compare that flight with the app's own kernel:
- the burns, against NASA's as-flown figures;
- every coast between them;
- the two lunar flybys and the farthest point from Earth.

`npm test` runs `src/physics/artemis1.validate.mjs`; the numbers below are
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
to a minute before the next:

| Model | Worst at the end | RMS | The longest arc (24.7 h) |
| --- | --- | --- | --- |
| Gravity only (the app's kernel) | 83 m | 22.5 m | 83 m |
| With a constant push away from the Sun of 2.1×10⁻⁸ m/s² | 47 m | 8.0 m | 0.6 m |

The gravity-only gap grows with the square of the arc's length, as a
small steady acceleration would. Fitted across all 77 arcs, a push away
from the Sun of 2.1×10⁻⁸ m/s² takes most of it out. That is sunlight
pressure on Orion: about 4.6×10⁻⁶ N/m² on 60–80 m² of capsule and solar
arrays, for 15 to 26 tonnes. So NASA's model includes solar radiation
pressure, and the kernel doesn't yet. The rest likely follows Orion's
falling mass (a constant push here, though the real one grows as
propellant is spent) and its attitude.

## The lunar flybys and the farthest point

| | NASA | The trajectory | The kernel |
| --- | --- | --- | --- |
| Outbound flyby, closest approach | 81 mi (130.4 km) at 6:57 a.m. CST (12:57 UTC), 21 Nov | 130.4 km at 12:57:35 UTC | 130.4 km at 12:57:35, flown from 12:50 once the engine was off |
| Return flyby, closest approach | 80.6 mi (129.7 km) at 10:43 a.m. CST (16:43 UTC), 5 Dec | 129.6 km at 16:44:00 UTC | inside the burn, not flown |
| Farthest from Earth | 268,563 mi (432,210 km) above the surface, 21:06:10 UTC, 28 Nov | 432,207 km at 21:06 UTC | 432,207 km, flown from 17:06 |

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
