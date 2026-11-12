# Artemis II: the kernel against the flown trajectory

Artemis II flew Orion around the Moon from 2 to 10 April 2026. JSC's flight
navigation team reconstructed the flight from GPS, Deep Space Network and
other tracking. Their best estimated trajectory (BET revF) was cleared for
public release on 1 July 2026, and NAIF converted it into an SPK.

These checks fly Orion with the app's own kernel and compare the result with
that trajectory: first each coast between burns, then the whole mission in
one run. The kernel gained Earth's and the Moon's J2, DE442's Earth and
Moon, and a time-scale fix because of these checks. `npm test` runs it; the
numbers below are from November 2026.

![Position error of each coast arc, and of the whole mission flown with the real burns](artemis2-residuals.svg)

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

## The checks

All three use `advance()` from `nbody.js`, the same integrator the app uses
for spacecraft:
- Encke's method near Earth and the Moon;
- the Sun and planets, with DE442's own Earth and Moon (the app's
  [Chebyshev table](../physics/ephemerides-and-gm.md#de442-in-the-app));
- Earth's J2 (EGM2008) and the Moon's (GRAIL).

Orion's heliocentric state is its flown geocentric state plus the app's
Earth.

### 1. Coast arcs

Each arc starts from the flown state 10 minutes after one burn and runs to
just before the next. A second run with point masses only shows what J2 is
worth.

| Arc | Days | The kernel: error at end | Point masses only |
| --- | --- | --- | --- |
| Outbound, after translunar injection | 2.05 | 13 km, 0.14 m/s | 957 km, 7.7 m/s |
| Outbound, to the correction | 1.04 | 13 km | 13 km |
| Lunar flyby | 1.86 | 21 km | 21 km |
| Return | 2.10 | 49 km | 49 km |
| Return, between corrections | 0.65 | 4.1 km | 4.2 km |
| Final approach to entry | 0.18 | 0.4 km | 0.9 km |

**Closest approach to the Moon,** from the flown state 20 hours before:

| | Altitude above the 1,737.4 km mean radius | Time (UTC, 6 April) |
| --- | --- | --- |
| Flown (BET) | 6,545.0 km | 23:00:49 |
| The kernel | 6,543.5 km | 23:00:45 |

The flown altitude matches the 6,545 km NASA announced.

### 2. The gravity model alone

What is left in the arcs above is almost all a steady push in the real
flight. Fitting one constant acceleration to an arc's first half and
predicting the second half separates the two:

| Arc | Push (µm/s²) | Error at end, push estimated | Without |
| --- | --- | --- | --- |
| Outbound, after translunar injection | 1.3 | 17 km | 13 km |
| Outbound, to the correction | 3.4 | 2.6 km | 13 km |
| Lunar flyby | 1.9 | 1.7 km | 21 km |
| Return | 3.3 | 9.2 km | 49 km |
| Return, between corrections | 3.2 | 0.7 km | 4.1 km |
| Final approach to entry | 3.0 | 0.1 km | 0.4 km |

What this shows:
- **The gravity is right to a few kilometres** over one to two days,
  through the lunar flyby included.
- **The first arc is the exception.** Its push isn't steady just after the
  injection burn, probably from venting after the burn.
- **The DE442 Moon matters.** Repeating this with astronomy-engine's Moon,
  the flyby arc ends 48.7 km off instead of 3.6 km.

### 3. The whole mission with Orion's burns

This is the test of flying Artemis II yourself. One run starts just after
translunar injection and goes to entry interface eight days later.
- **The burns:** each of the five burns between the arcs is applied as the
  BET shows it. Its velocity and position change are measured from the BET
  alone: the flown state before the burn, carried across the gap by the
  kernel's gravity, against the flown state after.
- **What's left out:** nothing is fitted, and the steady push is not
  modelled.

| Burn (UTC) | Δv |
| --- | --- |
| 5 April 01:52 | 1.85 m/s (three small trims) |
| 6 April 03:12 | 3.15 m/s (outbound correction) |
| 8 April 00:15 | 0.48 m/s |
| 10 April 03:05 | 1.61 m/s (return correction) |
| 10 April 19:05 | 1.27 m/s (return correction) |

**Results:**
- **Lunar flyby,** predicted four days ahead: 6,544.3 km against 6,545.0 km
  flown, and 50 s early.
- **At entry interface** (10 April, 23:29 UTC): 238 km off. That splits
  into 25 s late along the path, at 11 km/s, and 144 km to the side.
- **Where it comes from:** the error grows steadily with the unmodelled
  push (the lower panel of the plot), not from any one event.

## What the errors come from

1. **Earth's J2, now in the kernel.**
   - Translunar injection fired at about 200 km altitude. The first arc
     starts 9,000 km from Earth's centre, where Earth's flattening pulls
     at about 5 mm/s².
   - With point masses only, the first two hours put 7.7 m/s of error into
     the velocity, which grows to 957 km in two days.
   - See [the kernel](../physics/nbody-kernel.md#oblateness-j2).
2. **The Moon, now DE442's.**
   - astronomy-engine's Moon is 9–13 km from DE442's, mostly closer to
     Earth. The app now takes the Moon (and Earth) from DE442 itself,
     within a metre.
   - Measured against the gravity alone (check 2), the flyby went from
     49 km to 3.6 km off.
3. **A steady push the app can't know.** The flown trajectory shows
   1.3–3.4 µm/s² beyond gravity: about 0.1 N on Orion.
   - Solar pressure on Orion is about 0.02 µm/s², a hundred times smaller,
     and it pushes away from the Sun. This push always leans toward the
     Sun: its cosine with the Sun's direction is 0.3–0.8 in every arc.
   - So it is most likely venting or uneven thermal radiation while Orion
     holds Sun-relative attitudes. JSC's fit models both from Orion's logs.
   - A simulator can't predict it without those logs. It is what remains
     in checks 1 and 3.
4. **Time, found and fixed by this check.**
   - astronomy-engine extrapolated TT − UT as 75.2 s for 2026, against the
     true 69.2 s, so every body was computed 6 s late.
   - TT − UTC now comes from the leap-second table (`timescale.js`), and
     the DE442 table runs on TDB derived the same way.

## Regression checks

`artemis2.validate.mjs` runs in `npm test`, and fails if:
- the flyby (check 1) moves more than 3 km from the flown altitude, or more
  than 30 s;
- any coast arc ends more than 60 km off, or the first more than 25 km;
- any arc, with its push estimated, ends more than 20 km off;
- the whole-mission run misses the flyby altitude by more than 10 km, or
  ends more than 400 km off at entry interface;
- the app's Moon strays more than 5 m from DE442.

## Regenerate

With the kernels in `python/data/kernels/` (see `c/README.md`) and the two
Artemis II SPKs in `python/data/kernels/spk/missions/artemis2/`:

```bash
cmake --build c/build
c/build/artemis2_ref src/physics/fixtures/artemis2_bet.json 600
node src/physics/artemis2.validate.mjs
```

## Next

- Let a user load this mission in the app, fly it with these burns, and
  watch the residual grow.
- Model the steady push as an empirical acceleration in a Sun-relative
  frame, as navigation teams do, and see how far ahead one estimate holds.
