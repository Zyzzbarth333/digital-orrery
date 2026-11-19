# DART: the last five weeks to Dimorphos

NASA's Double Asteroid Redirection Test struck Dimorphos, the 170 m moonlet
of the asteroid Didymos, at 23:14:24 UTC on 26 September 2022, at
6.14 km/s, to change its orbit. These checks fly DART's last five weeks,
from 20 August 2022 to the impact, with the app's kernel against the
navigation team's reconstruction:
- the burns: the last corrections, LICIACube's release and the
  autonomous terminal guidance, against Daly et al.'s timeline [1];
- the coast arcs between them, about the Sun;
- the impact, against Daly et al.'s time, speed and point;
- the app's mission file, flown as the app flies it, to Dimorphos.

`npm test` runs `validation/missions.validate.mjs`
(`node validation/missions.validate.mjs dart` for this one). The numbers
below are from November 2026.

## Why DART

It is the one mission here whose target is not a planet or a moon but a
body the size of a stadium, 11 million km from the Earth, struck at
6 km/s. Its last hours were flown by its own camera and guidance (SMART
Nav), and the aim it had to hold is tens of metres. In the app, flying it
blind misses by 180 km; aimed as its navigators and SMART Nav did, it
strikes 23 m from the centre.

## The reference

- **Trajectory:** the DART navigation reconstruction through
  [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), object −135: the
  segments `dart_2022_231_2022_269_rec_v03` (to 22:00 TDB on 26 September)
  and `dart_2022_269_2022_269_rec_v03` (to 23:14:45.3 TDB, 23:13:36 UTC),
  then `dart_2022_269_2022_269_spc_v04`, the final solution, to the impact.
  Dimorphos from Horizons too (120065803, JPL's solution s547).
- **Two solutions at the end.** The reconstruction hands over to the final
  solution 48 s before the impact, with a step of 1.95 km along the track
  and 119 m across it. They are two estimates of one flight; the final one
  is fitted to DART's last images. So:
  - the build ends DART's trajectory proper at 23:13:30 UTC, the last
    reconstructed sample on its 10 s grid;
  - the final solution is fetched about Dimorphos, every second, and placed
    on Dimorphos's ephemeris (its heliocentric states in Horizons are not
    continuous with the reconstruction's), then carried by the kernel to
    the published impact time. The app's flown path ends there.
- **Sampling:** `npm run build:missions -- dart` fetches DART every hour
  about the Sun, every 10 s through each event, every second for
  Dimorphos and the final solution. The fixture is
  `src/physics/fixtures/dart.json` (281 kB); the app's file is
  `public/missions/dart.json` (341 kB).

## The burns

The build flies every hour with the kernel; an hour more than 2 mm/s from
it is an event (6 are found), fetched every 10 s and flown again in the
full environment. All six are thrust or a push; none is a join.

| Event | From (UTC) | To | Ours | Published |
| --- | --- | --- | --- | --- |
| Correction | 7 Sep 20:00:00 | 20:01:40 | 0.073 m/s | — |
| LICIACube release | 11 Sep 23:13:50 | 23:14:00 | 0.033 m/s | 23:14 UTC [2] |
| Push | 12 Sep 23:29 | 13 Sep 05:59 | 0.028 m/s | — |
| Correction | 19 Sep 20:01:50 | 20:05:20 | 0.249 m/s | — |
| Correction | 25 Sep 23:00:30 | 23:01:30 | 0.058 m/s | — |
| SMART Nav, toward Dimorphos | 26 Sep 22:24:50 | 23:11:50 | 0.586 m/s | 22:24:24 to 23:11:52 [1] |

- **SMART Nav** took control at 19:09:24 UTC, steered for Didymos until it
  could see Dimorphos, and "at 50 minutes prior to impact" (22:24:24)
  "began maneuvering towards Dimorphos"; its manoeuvring "ended at
  23:11:52 UTC" [1]. The trajectory's thrust toward Dimorphos runs from
  22:24:50 to 23:11:50. Held to a minute at the start (the published time
  is "50 minutes") and to the 10 s sampling at the end. Its earlier thrust
  toward Didymos, 4 mm/s at 21:58, is in the same burn.
- **LICIACube**, the Italian cubesat that photographed the impact, left
  DART at 23:14 UTC on 11 September [2]: the trajectory has a single 10 s
  step of 33 mm/s at 23:13:50. A 14 kg cubesat pushed off at about
  1.1 m/s would give DART's 580 kg about 26 mm/s (both from secondary
  sources). Held to the published minute.
- **The push of 12–13 September,** 0.028 m/s over six and a half hours
  (about 1.2e-6 m/s², four times the sunlight on DART), is in the
  reconstruction but not in our sources. Long and gentle, it is resolved
  by the minute rather than every 10 s.
- **The corrections** NASA did not publish are found in the trajectory and
  named by date.

## Coast arcs

| Arc | Days | Gravity only | Full environment, as built | Sunlight fitted |
| --- | --- | --- | --- | --- |
| 20 Aug to 7 Sep | 18.8 | 352 km | 141 km | 20.4 km |
| 7 Sep to 11 Sep | 4.1 | 18.4 km | 6.7 km | 4.0 km |
| 13 Sep to 19 Sep | 6.5 | 49.4 km | 13.2 km | 9.6 km |
| 19 Sep to 25 Sep | 6.1 | 40.0 km | 12.8 km | 2.9 km |

- **Sunlight** on the two ROSA arrays as a flat plate: 8.5 m long [1],
  2.4 m wide (secondary sources), 40.8 m² at Cr 1.3 on 579.4 kg [1]. The
  arcs fit 72 % of that: the arrays are not a plate facing the Sun, and
  DART turned its camera to Didymos. Fitted, the rms at the arcs' ends
  falls from 179 km to 11.6 km.
- **The app's DART** flies with the fitted strength (Cr 0.93), as the app's
  Orion flies with Artemis I's; checked within 2 % of the fit.
- **Checks:** every arc within 25 km with sunlight fitted; the fit at least
  ten times better than gravity alone; the fitted strength within 30 % of
  the arrays as built (their width is not from a primary source, and the
  body's few m² are left out).

## The impact

| | Daly et al. [1] | The final solution, flown by the kernel |
| --- | --- | --- |
| Time | 23:14:24.183 ± 0.004 UTC, at the surface | closest to the centre 23:14:24.197 |
| Speed relative to Dimorphos | 6.1449 ± 0.0003 km/s | 6.14478 km/s |
| Point | 25 ± 1 m from the centre of the figure | 23.6 m from the centre |

- The kernel flies from the final solution's first sample, 271.6 km out at
  23:13:40, on Dimorphos's ephemeris. Its closest point to the centre
  comes 14 ms after the published impact, 86 m further along the track:
  about Dimorphos's radius, as the impact is on its surface. Checked: the
  offset within 3 m of 25 m, the centre's closest point after the impact
  and within 0.015 s of it, the speed within the published ± 0.0003 km/s.
- The reconstruction before the final images, flown on from 23:13:30,
  passes 142.5 m from the centre at 23:14:23.880, 0.317 s early: on that
  estimate DART would have grazed or passed beside a body 177 by 174 by
  116 m. The difference between the two is what the last images taught
  the navigators, not a manoeuvre.

## In the app

Choose **DART · impact on Dimorphos, Sep 2022** under Real missions, or
`?mission=dart`. The craft starts on 20 August 2022 with Daly et al.'s
579.4 kg; its corrections are scripted as flown along fixed J2000
directions (about the Sun the orbital frame barely turns in a burn, and
steering in it would be flown in quarter-second steps). Didymos itself is
in the small-body search.

| | At the end | Worst | From Dimorphos's centre | Added |
| --- | --- | --- | --- | --- |
| Every burn replayed as flown | 181 km | 181 km | 181 km | — |
| Burns aimed from the craft (the default) | 0.0 km | 43 km | 23 m | 2.59 m/s |

- **Blind,** the first 18 days' sunlight alone carries DART 20 km off,
  and five weeks of it 181 km: a miss of 180 km.
- **Aimed,** each burn after the first is worked out from where this craft
  is, in its own environment, and solved for as the push it is flown as,
  spread over the burn: aimed two minutes ahead of SMART Nav's 47-minute
  burn, an impulse at its start would have missed by 0.6 km. The last aim
  targets the published impact point, and the app's DART strikes 23 m
  from the centre (published: 25 m).
- **Checks:** aimed, within 1 km of the flown path at the end, 100 km
  throughout, 50 m from Dimorphos's centre, for under 5 m/s.

## Sources

1. R. T. Daly et al., "Successful kinetic impact into an asteroid for
   planetary defence," *Nature*, vol. 616, pp. 443–447, 2023: Table 1 (the
   impact's time, speed, point and DART's mass), the SMART Nav timeline,
   and the ROSA arrays' length. CC BY 4.0.
   <https://doi.org/10.1038/s41586-023-05810-5> (also arXiv:2303.02248)
2. Space.com, *LICIACube readies to observe DART hit asteroid* (2022):
   released "7:14 p.m. EDT (2314 GMT)" on 11 September.
   <https://www.space.com/liciacube-readies-to-observe-dart-hit-asteroid>
