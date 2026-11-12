# Artemis II: the kernel against the flown trajectory

Artemis II flew Orion around the Moon from 2 to 10 April 2026. JSC's flight
navigation team reconstructed the flight from GPS, Deep Space Network and
other tracking. Their best estimated trajectory (BET revF) was cleared for
public release on 1 July 2026, and NAIF converted it into an SPK.

This check flies the coast between burns with the app's own kernel and
compares the result with that trajectory. `npm test` runs it; the
numbers below are from November 2026.

![Position error of each coast arc, and of the whole mission flown without corrections](artemis2-residuals.svg)

## The reference

- **Trajectory:** NAIF's
  [`art002_rec_260402_260410_jsc_bet_revf.bsp`](https://naif.jpl.nasa.gov/pub/naif/ARTEMIS/kernels/spk/)
  (5.7 MB) and its gap-fill file (50 kB). It holds Orion (NAIF ID −24)
  relative to Earth in J2000, from Orion's separation from the upper
  stage at 01:58 UTC on 2 April to entry interface at 23:53 UTC on
  10 April.
- **What JSC's fit models:** gravity from the Earth, Moon, Sun and Jupiter,
  the burns, life-support vents, thruster firings and solar radiation
  pressure.
- **Uncertainty:** the file's covariance puts JSC's 1σ position uncertainty
  at 0.2–1 km in the coast arcs.
- **Sampling:** `c/artemis2_ref.c` samples Orion's state every 10 minutes
  with CSPICE, along with DE442's Moon at the same instants. It writes
  `src/physics/fixtures/artemis2_bet.json` (263 kB), so the check needs
  neither SPICE nor the kernels to run.

## The burns

The SPK breaks into six continuous segments, and the burns show up in the
data. I took Orion's acceleration from 1-minute samples and subtracted the
gravity of the Earth (with J2), the Moon (DE442) and the Sun. Anything
larger than 2 mm/s² that was left over was a push:

| When (UTC) | Δv (approximate) | What it is |
| --- | --- | --- |
| 2 Apr, 03:25 and 12:07 | 15 and 6 m/s | burns in the high Earth orbit before departure |
| 2 Apr, 23:49 to 23:57 | 424 m/s, peak 1.15 m/s² | translunar injection, fired about 200 km above Earth at perigee |
| 5 Apr, 01:21 to 01:42 | three of 0.3–0.5 m/s | small trims |
| 6 Apr, 03:03 | 3.2 m/s | outbound trajectory correction |
| 8 Apr, 00:03 | 0.5 m/s | small trim |
| 10 Apr, 02:53 | 1.6 m/s | return trajectory correction |
| 10 Apr, 18:53 | 1.3 m/s | return trajectory correction |

The Δv values come from 2-minute differences, so they are good to about
10 %. That error also leaves a spurious few mm/s² near perigee, which
should not be mistaken for thrust.

## The check

Each coast arc starts from the flown state 10 minutes after one burn and
runs to just before the next. Orion's heliocentric state is its flown
geocentric state plus the app's Earth. It is then stepped with `advance()`
from `nbody.js`, the same integrator the app uses for spacecraft: Sun,
planets and Moon as point masses on the app's ephemeris, Encke's method
near Earth and the Moon. A second run adds Earth's J2 (EGM2008), which the
kernel does not model yet.

| Arc | Days | Point masses (the kernel today): error at end | With J2 added |
| --- | --- | --- | --- |
| Outbound, after translunar injection | 2.05 | 969 km, 7.8 m/s | 42 km, 0.38 m/s |
| Outbound, to the correction | 1.04 | 14 km | 14 km |
| Lunar flyby | 1.86 | 49 km | 49 km |
| Return | 2.10 | 81 km | 81 km |
| Return, between corrections | 0.65 | 8 km | 8 km |
| Final approach to entry | 0.18 | 1.1 km | 0.3 km |
| Whole mission, no burns flown | 7.98 | 97,000 km | 730 km (1,600 km at worst) |

**Closest approach to the Moon:**

| | Altitude above the 1,737.4 km mean radius | Time (UTC, 6 April) |
| --- | --- | --- |
| Flown (BET) | 6,545.0 km | 23:00:49 |
| The kernel | 6,546.1 km | 23:00:41 |

The flown altitude matches the 6,545 km NASA announced. The kernel, started
from the flown state 20 hours before closest approach, puts it 1.1 km
higher and 8 s earlier.

## What the errors come from

1. **Earth's J2.**
   - Translunar injection fired at about 200 km altitude. The first arc
     starts 9,000 km from Earth's centre, where Earth's flattening pulls
     at about 5 mm/s².
   - Without J2, the first two hours put 7.8 m/s of error into the
     velocity. That grows to 969 km in two days, and to 97,000 km over
     the whole mission, because the lunar flyby amplifies it.
   - With J2 added, the first arc ends 42 km off instead of 969 km.
   - J2 is the next physics to add to the kernel.
2. **Forces the kernel does not have.** In the arcs away from Earth, the
   flown trajectory shows a steady leftover acceleration of 1–4 µm/s².
   - That alone accounts for 5–15 km of drift a day, matching the arcs'
     errors.
   - It points roughly toward the Sun rather than away from it, so it is
     probably not mainly solar pressure. It is more likely the vents and
     attitude-thruster firings that JSC's fit models.
   - A simulator can't predict these without the vent log. Flying them
     as small burns would close most of the gap.
3. **The Moon.** The app's Moon comes from astronomy-engine's shortened
   lunar theory.
   - Over the mission it sits 9–13 km from DE442's, mostly closer to
     Earth.
   - That limits the flyby to roughly the kilometre level shown above.
   - Loading DE442 in the browser, already planned, would remove it.
4. **Time, found and fixed by this check.**
   - astronomy-engine takes UT and adds its own estimate of TT − UT. Past
     the end of its tables it extrapolates, giving 75.2 s for 2026
     against the true 69.2 s.
   - So every body was computed 6 s late: 180 km along Earth's orbit and
     6 km along the Moon's.
   - `ephemeris.js` now sets TT − UTC from the leap-second table (32.184 s
     plus TAI − UTC, 69.184 s since 2017). That moved the flyby from 14 s
     early to 8 s early, and the lunar arc's error from 59 km to 49 km.
   - It also slightly improved the planet checks against SPICE: the worst
     relative position for Venus, Earth and Mars went from 2.46×10⁻⁵ to
     2.28×10⁻⁵.

The whole-mission row is not a fair test of the physics: it leaves out
about 8 m/s of real corrections. It does show why missions fly them.

## Regression checks

`artemis2.validate.mjs` fails if:
- the flyby's altitude moves more than 3 km from the flown one, or its
  time more than 30 s;
- any arc after the first ends more than 100 km off;
- any arc with J2 does;
- the app's Moon strays more than 15 km from DE442.

## Regenerate

With the kernels in `python/data/kernels/` (see `c/README.md`) and the two
Artemis II SPKs in `python/data/kernels/spk/missions/artemis2/`:

```bash
cmake --build c/build
c/build/artemis2_ref src/physics/fixtures/artemis2_bet.json 600
node src/physics/artemis2.validate.mjs
```

## Next

- J2 in the kernel, starting with the Encke reference orbit near Earth.
- Fly the burns from the table as finite burns, and compare the whole
  mission with corrections.
- DE442 in the browser for the Moon.
- Let a user load this mission in the app and watch the residual grow.
