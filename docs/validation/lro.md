# LRO: capture at the Moon

The Lunar Reconnaissance Orbiter left Earth on 18 June 2009, coasted four
and a half days to the Moon, and was captured by a 40-minute burn on 23
June. Four smaller burns over the next four days brought it down to a
30 by 216 km polar commissioning orbit. These checks fly that fortnight,
from 18 to 28 June 2009, with the app's kernel against the reconstruction:
- the burns, against what was published;
- the coast arcs, out to the Moon and in lunar orbit;
- the orbits reached, and what each degree of the Moon's gravity field is
  worth there;
- the app's mission file, flown as the app flies it.

`npm test` runs `validation/missions.validate.mjs`
(`node validation/missions.validate.mjs lro` for this one). The numbers
below are from November 2026.

## Why LRO

It is the one mission here that ends in a low orbit: 30 km above the Moon
at its lowest, where the Moon's mascons pull a craft kilometres off a
smooth-Moon path in a day. It tests the kernel's lunar orbit insertion
(a 527 m/s burn about the Moon) and the app's GRAIL field degree by
degree, which Artemis's flybys at 130 km only touch.

## The reference

- **Trajectory:** LRO's final reconstructed trajectory, from the PDS,
  through [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/),
  object −85, from 22:16 TDB on 18 June 2009.
- **Sampling:** `npm run build:missions -- lro` fetches LRO every 10
  minutes about the Earth for the whole span, flown step by step in the
  full environment (in lunar orbit the Moon's field beyond J2 moves LRO by
  metres a minute), and every 10 s about the Moon through each event. The
  fixture is `src/physics/fixtures/lro.json` (1.08 MB); the app's file,
  `public/missions/lro.json` (810 kB).

## The burns

| Burn | From (UTC) | To | Ours | Published |
| --- | --- | --- | --- | --- |
| Mid-course correction | 19 Jun 22:20:00 | 22:21:00 | 1.310 m/s | 1.3 m/s over 38 s from 22:16 UTC [1] |
| Correction | 23 Jun 03:05:00 | 03:05:40 | 6.221 m/s | — |
| LOI-1 | 23 Jun 09:47:30 | 10:26:30 | 527.167 m/s | a 40-minute burn, completed 10:26:26 UTC [2] |
| LOI-2 | 24 Jun 10:31:51 | 10:39:08 | 104.760 m/s (fitted; its samples' sum 99.596) | one of four more burns [2] |
| LOI-3 | 25 Jun 10:35:46 | 10:43:13 | 110.529 m/s (fitted; 107.438) | |
| LOI-4 | 26 Jun 12:27:26 | 12:33:33 | 94.891 m/s (fitted; 93.277) | |
| LOI-5 | 27 Jun 12:35:23 | 12:37:36 | 35.717 m/s (fitted; 35.577) | |

- **LOI-1** ends at 10:26:30 in the 10 s samples, against NASA's 10:26:26,
  and lasts 39 minutes (the release: "a 40-minute ... burn"). A join of
  4.1 m/s follows two minutes after it.
- **The mid-course correction** is 1.310 m/s against the release's 1.3 m/s,
  but the trajectory places it at 22:20, four minutes after the release's
  6:16 p.m. EDT; its 10 s samples ring (1.8 m/s of steps for 1.31 in sum),
  so its 38 s length can't be told from them. Checked within five minutes,
  its length not checked.
- **The 6.2 m/s burn on 23 June at 03:05,** 40 s at about 0.15 m/s² (the
  four 80 N insertion thrusters on LRO's 1,846 kg), is in the
  reconstruction but not in our sources: a last trim before capture.

### Four burns the samples can't resolve

Horizons' interpolation of the reconstruction can't follow LOI-2 to LOI-5:
across each its 10 s steps swing back and forth along one line, by up to
445 m/s in 10 s (45 m/s², against the thrusters' 0.2 m/s²), and add to two
to twenty-five times their sum. The build tells such a burn by that
(a step faster than three times the engine can push, or steps swinging
across a join), and fits it as the engine would fly it:
- **its length** is its change at 320 N on LRO's mass then (the launch
  load less what the earlier burns drew, at an Isp of 200 s);
- **its push** is steady, along one J2000 direction, its change solved for
  by the kernel's own aim (`kernelHost.aimTo`) so that LRO flown from a
  clean sample ten minutes before reaches the sample half an hour after;
- **its centre** is the one, within ten minutes of the ringing's middle,
  that leaves the least velocity there.

Each fit leaves 0.6 to 1.6 m/s at the far sample (checked under 2 m/s),
and is within 5.2 % of its samples' sum (checked within 6 %): one steady
push in a fixed direction stands for each burn to that much. The real
burns were probably steered; the reconstruction doesn't say.

## Coast arcs

The app's 10.7 m² array [3] at Cr 1.3 on 1,846 kg; the arcs fit 113 % of
that.

| Arc | Days | Gravity only | Full environment, as built | Sunlight fitted |
| --- | --- | --- | --- | --- |
| 18 to 19 Jun (to the correction) | 1.0 | 0.2 km | 0.38 km | 0.40 km |
| 19 to 23 Jun (to the Moon) | 3.2 | 1.7 km | 0.50 km | 0.46 km |
| 23 Jun (before LOI-1) | 0.3 | 0.0 km | 0.03 km | 0.03 km |
| 23 to 24 Jun (220 by 3,100 km) | 1.0 | 10.3 km | 0.12 km | 0.13 km |
| 24 to 25 Jun | 0.9 | 6.8 km | 0.01 km | 0.01 km |
| 25 to 26 Jun | 1.0 | 5.9 km | 0.02 km | 0.02 km |

In lunar orbit gravity alone (the Moon's J2 the only term beyond a point)
ends 6 to 10 km off in a day; the full environment, with GRAIL GL0660B to
degree 50, 10 to 125 m. Checked: every arc within 1 km with sunlight fitted,
the fit at least ten times better than gravity alone, the fitted sunlight
within 20 % of the array as built.

After the last burn, in the 30 km by 216 km orbit, each perilune pass
leaves 30 to 80 mm/s that the field to degree 50 doesn't explain:
mascons too fine for it at 30 km. Those steps are listed as joins; the
span ends half a day into that orbit.

## The orbits reached

| | Published [2] | Osculating about the Moon |
| --- | --- | --- |
| After LOI-1 | 220 by 3,100 km | 207.4 by 3,082.1 km, inclined 112.4° to the J2000 equator |
| At the end | 30 by 216 km (commissioning) | 34.0 by 198.6 km |

Heights above the Moon's mean radius, from the state at one instant: in the
Moon's lumpy field an osculating orbit moves by kilometres around an orbit,
and the published figures are round. Checked within 15 %.

## The Moon's field, degree by degree

The day-long coast from 25 to 26 June, at about 200 km, flown with the
Moon's field cut at each degree:

| Degree | At the end |
| --- | --- |
| 2 | 4.199 km |
| 10 | 1.477 km |
| 20 | 0.074 km |
| 50 | 0.020 km |
| 100 | 0.020 km |

Each degree brings the arc closer, down to 20 m at degree 50; at 200 km
up, degree 100 adds nothing more. Checked: each no worse than the last, and
within 50 m at degree 100.

## In the app

Choose **LRO · capture at the Moon, June 2009** under Real missions, or
`?mission=lro`. The craft starts on 18 June 2009 with LRO's 1,846 kg and
its four 80 N thrusters [3], and flies with a tracking fix every 6 h by
default (`fixHours` in the file).

| | At the end | Worst | Added |
| --- | --- | --- | --- |
| Every burn replayed as flown | 3,424 km | 4,204 km | — |
| As flown, a fix every 6 h (the default) | 0.1 km | 25.5 km | — |
| Burns aimed, no fixes | 0.0 km | 526 km | 181.8 m/s |

- **Blind,** 6.7 km off at capture becomes thousands of kilometres in a
  lunar orbit of a few hours.
- **Aimed,** as Juno and DART fly, each burn is worked out from where the
  craft is and aimed a day ahead, at the next burn: across twelve
  revolutions the aim finds costly phasing answers (181.8 m/s in all).
  LRO's navigators worked each burn from a fresh orbit determination, so
  the app flies it with a fix every 6 h instead, and the burns as flown.
- **Checks:** with fixes, within 1 km at the end and 50 km throughout.

## Sources

1. LROC (Arizona State University), *News 146* (20 June 2009): the
   mid-course correction "executed yesterday (June 19) at 6:16pm EDT", "38
   seconds", "1.3 m/s"; LOI-1 scheduled for 09:47 UTC.
   <https://lroc.im-ldi.com/news/146> (mirror of
   <https://www.lroc.asu.edu/news/146>)
2. LROC, *LRO in lunar orbit!* (23 June 2009): "At 6:26:26am EDT today the
   Lunar Reconnaissance Orbiter completed a 40-minute Lunar Orbit Insertion
   (LOI) burn"; "a 220 km by 3100 km ... orbit"; "four more small burns";
   the "30 km by 216 km ... (Commissioning Phase Orbit)".
   <https://lroc.im-ldi.com/news/147>
3. NASA PDS Geosciences Node, LRO instrument host description
   (`insthost.cat`, LOLA archive): "less than 949 kg dry and 1846 kg fully
   fueled"; "894 kg of hydrazine (~ 1300 m/sec delta-V capability)"; four
   80 N insertion thrusters; a 10.7 m² solar array. (Pre-launch figures.)
   <https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/insthost.cat>
