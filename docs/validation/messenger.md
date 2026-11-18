# MESSENGER: cruise to Mercury

MESSENGER left Earth on 3 August 2004 and took six and a half years to
reach Mercury orbit. On the way it flew past the Earth once, Venus twice
and Mercury three times, and fired five deep-space burns on its main
engine. The orbit insertion burn on 18 March 2011 lasted 15 minutes.
These checks fly that cruise, from 5 August 2004 to half a day into
Mercury orbit, with the app's kernel against JHU/APL's reconstruction:
- every burn, against APL's own record of it: size, direction and start;
- the joins between navigation solutions, and the passes of the planets;
- the coast arcs, with the sunlight that MESSENGER steered by fitted
  piece by piece;
- the six flybys, and the orbit MOI reached;
- the app's mission file, flown as the app flies it.

`npm test` runs `src/physics/missions.validate.mjs`
(`node src/physics/missions.validate.mjs messenger` for this one). The
numbers below are from November 2026.

## Why MESSENGER

It is the longest flight here, and the one closest to the Sun. At 0.3 AU
sunlight is eleven times as strong as at the Earth, and MESSENGER used
it: after TCM-19 in December 2007 it trimmed its course by tilting its
sunshade and arrays ("solar sailing") instead of firing thrusters [1]. It
tests the kernel across six flybys of three planets, two of them 200 km
above Mercury, and a 862 m/s capture burn that turned 30° as it fired.

## The reference

- **Trajectory:** JHU/APL's reconstruction `msgr_20040803_20150501_od423sc_0`,
  through [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), object −236 [2].
  Horizons' notes say the planets behind it are DE405 until
  7 December 2009 and DE423 after.
- **Sampling:** `npm run build:missions -- messenger` fetches MESSENGER
  every hour about the Sun for the whole span, flown step by step in the
  full environment. Each event is fetched every 10 s about the body whose
  sphere of influence holds it. Each flyby, and the day of the approach
  to MOI, is fetched every minute about its planet. The fixture is
  `src/physics/fixtures/messenger.json` (3.7 MB); the app's file,
  `public/missions/messenger.json` (3.4 MB), is within 108 m of every
  sample it leaves out. The Horizons cache is 43 MB.

## Finding the burns

MESSENGER fired some burns in parts minutes apart. DSM-2 was a 386 s
main-engine burn followed half an hour later by 133 s on the small
thrusters. TCM-13 had three parts, two of them half an hour long at 4 N.
A twentieth of a window's largest step, as Juno's build uses, misses the
small parts. So MESSENGER's build finds every push above a floor
(`burnFloor`, 10 mm/s in a 10 s step) and makes each run of such steps a
burn of its own.

## The burns

APL's Mission Design page gives every cruise burn's commanded start,
length, mass and change as a vector in EME2000, the frame of these
states [1]. Each vector's length is the change along the path: MOI's is
861.716 m/s, which is what the rocket equation gives from its masses. So
each burn is compared by its change summed along its path, and by
direction.

| Burn | Ours (along) | APL | Off | Direction | Start, ours − APL's |
| --- | --- | --- | --- | --- | --- |
| TCM-1 | 17.895 m/s | 17.901 m/s | −0.03 % | 0.01° | +3 s |
| TCM-2 | 4.599 | 4.589 | 0.22 % | 0.09° | +10 s |
| TCM-3 | 3.248 | 3.247 | 0.01 % | 0.01° | +10 s |
| TCM-5 | 1.092 | 1.103 | −1.06 % | 0.22° | 0 s |
| TCM-6 | 0.150 | 0.150 | 0.02 % | 0.11° | −1 s |
| DSM-1 | 315.639 | 315.633 | 0.00 % | 0.01° | 0 s |
| TCM-10 | 1.284 | 1.281 | 0.22 % | 1.71° | 0 s |
| TCM-11 (A + B) | 1.676 | 1.676 | −0.03 % | 0.49° | 0, 0 s |
| TCM-12 | 0.504 | 0.501 | 0.61 % | 0.13° | 0 s |
| TCM-13 (A + B + C) | 25.162 | 25.175 | −0.05 % | 0.09° | −200, +10, −60 s |
| TCM-15 | 0.576 | 0.572 | 0.60 % | 0.42° | +30 s |
| TCM-16 | 0.213 | 0.212 | 0.15 % | 0.21° | 0 s |
| DSM-2 (A + B) | 227.412 | 227.411 | 0.00 % | 0.00° | +20, 0 s |
| TCM-19 | 1.102 | 1.104 | −0.13 % | 0.13° | 0 s |
| DSM-3 | 72.240 | 72.231 | 0.01 % | 0.05° | +40 s |
| DSM-4A | 222.071 | 222.069 | 0.00 % | 0.00° | (see below) |
| DSM-4B | 24.644 | 24.650 | −0.02 % | 0.01° | +30 s |
| DSM-5 | 177.781 | 177.781 | 0.00 % | 0.00° | 0 s |
| MOI | 861.614 | 861.714 | −0.01 % | 0.49° | +25 s |

- **Checked:** each within 1 % and 10 mm/s of APL's, its direction within
  2°, its start within a minute of APL's commanded start.
- **A burn in parts** is compared by the parts' vector sum. The
  reconstruction shares a burn between its parts its own way: it has
  TCM-11A as 20 s at 0.035 m/s², 0.695 m/s (APL: 0.835 over 55 s), and
  11B as 1.510 m/s (APL: 1.444). Their sums are 1.676 m/s both, 0.5°
  apart. Its TCM-13A starts 200 s before APL's 21:00 (checked within
  240 s).
- **MOI** turned 30° as it fired. Its vector sum is 850.46 m/s and its
  change along the path 861.61 m/s, against APL's 861.714 m/s [1] and the
  Technical Digest's "861.714" [3].
- **DSM-4A** is at 20:30 UTC in the trajectory, an hour after the 19:30
  on APL's page and at DSM-4B's time of day four days later. It is matched
  by its day and its start isn't checked.
- **Lengths** aren't checked. The reconstruction models each burn as
  steady pushes of its own length (DSM-1's 530 s at half its peak, against
  APL's 553 s), not as APL's record has it.

## The joins and the passes

`findEvents` takes a step whose velocity is 5 mm/s or more from the
kernel's as an event. MESSENGER's navigation solutions also join with
jumps in position and almost none in velocity: 24 of them, from 0.8 to
21.4 km, most at midnight. The build takes a step 0.5 km or more off as
an event too (`jumpKm`), so the coast arcs end at the joins.

The six flybys are joins of their own, with no step over the floor. Each
is flown in the full environment, which now has Mercury's and Venus's
fields to degree 20 ([the space environment](../physics/environment.md#mercurys-and-venuss-gravity-fields)):

| Pass | Left in the 10 s steps | With J2 alone |
| --- | --- | --- |
| Earth, 2,347 km | 0.4 mm/s | |
| Venus, 2,987 km | 14.8 mm/s | 0.2 mm/s |
| Venus, 338 km | 0.7 mm/s | 105 mm/s |
| Mercury, 202 km | 39 mm/s | 64 mm/s |
| Mercury, 200 km | 28 mm/s | 125 mm/s |
| Mercury, 228 km | 101 mm/s | 69 mm/s |

- **The Earth:** its field to degree 20 accounts for the pass.
- **Venus, 338 km:** MGNP180U to degree 20 accounts for it. With J2 alone
  the steps rose smoothly to 2.7 mm/s near closest approach; now the
  largest is 0.47 mm/s, two steps at 23:06:30 and 23:06:40. Higher degrees
  leave more (3.2 mm/s at degree 50), so the reconstruction seems to have
  been flown with the field to about degree 20.
- **Venus, 2,987 km:** the reconstruction matches J2 alone (0.2 mm/s,
  and 0.04 mm/s a step rms), and the field's low degrees put 14.8 mm/s
  into the pass. It seems to have been flown without Venus's field here.
- **Mercury:** the field cuts the steps' rms by half at the first two
  flybys (0.17 to 0.10 and 0.34 to 0.11 mm/s a step, by least squares
  over the pass). At the third it doesn't help (0.21 to 0.22). Every
  modern Mercury field leaves the same: JGMESS160A and three of GSFC's
  (`ggmes_100v08`, HgM008; `ggmes_50v06`; `ggmes_20v04`) are within
  7 mm/s of each other at every pass. And
  no one field fits them: degree 2 and 3 coefficients fitted to each
  pass in turn disagree with each other and with all four fields.

  What's left fits Mercury itself in another place. Move Mercury's centre
  50 to 100 m, a fitted shift for each pass, and what the field (to
  degree 50 here; 20 leaves the same within 1 mm/s) leaves falls to 2.9,
  17 and 23 mm/s. With J2 alone a shift explains far less (18,
  23 and 62 mm/s, from 116 to 172 m). Horizons' notes [2] say the
  reconstruction's planets are DE405 until December 2009, and the
  kernel's are DE442. A different Mercury fits, and so does the kernel's
  closest approach at each flyby, 89 to 172 m from the reconstruction's
  with the field or without. Fitting Mercury's GM instead doesn't explain
  it: the three fits disagree in sign.

## Coast arcs

Between the events there are 49 coast arcs, from a day to 262 days long.
With one sunlight strength for the whole flight, as Juno's and DART's
are fitted, the arcs fit 93 % of the craft as built. That leaves the arcs
tens to thousands of km off (rms 1,051 km at their ends, against 4,489 km
in gravity alone). One strength can't follow MESSENGER's attitude: it
turned its sunshade from the Sun near 1 AU, tilted it to sail, and turned
its arrays from the Sun near Mercury to keep them cool.

So each arc is cut into pieces of about 10 days, and each piece has its
own push, falling as 1/r² from the Sun, along the radial, along-track and
normal axes (radial alone in an arc under 5 days). Every push is solved
for by least squares against every daily sample in the arc
(`fitSunlightPieces`). The arc is still flown in one go from its first
sample.

| | Rms over 2,420 daily samples | Worst |
| --- | --- | --- |
| No sunlight | 4,686 km | 20,771 km |
| Sunlight fitted every 10 days | 0.72 km | 5.4 km |

The fitted push is sunlight on this craft:
- **Up to mid-2007** it is steady: Cr·A from 15.5 to 18.6 m², tilted
  under 5° from the Sun line, against Cr 1.3 on the 9.95 m² sunshade and
  arrays as built (12.9 m²) [4], [5].
- **From July 2007**, sailing, it ranges from 3.5 to 17 m² and tilts up
  to 24°. Near Mercury's distance, where the arrays turn from the Sun, it
  is about 9 m².

Checked: every arc within 10 km of the reconstruction at every daily
sample; the fit at least ten times better than no sunlight at all; Cr·A
within 75 % of the craft as built in every piece of an arc of 5 days or
more; every tilt under 30°.

## The flybys

The heights on APL's flyby page [6] are above a sphere at Mercury
(2,439.4 km) and Venus (6,051.8 km): its distances from the centre less
its heights give those radii. At the Earth the height is above the
WGS-84 ellipsoid: the radius it implies, 6,366.7 km, is the ellipsoid's
at the pass's 47° N.

| Flyby | Published [6] | The trajectory | Kernel's closest | 12 h on, off by | With J2 alone |
| --- | --- | --- | --- | --- | --- |
| Earth, 2 Aug 2005 | 2,347.5 km, 19:13:08 | 2,347.49 km (ellipsoid), 19:13:08 | 2 m | 0.15 km, 2.8 mm/s | |
| Venus, 24 Oct 2006 | 2,987.3 km, 08:34:00 | 2,987.28 km, 08:34:00 | 9 m | 0.69 km, 15.8 mm/s | 0.16 km |
| Venus, 5 Jun 2007 | 338.3 km, 23:08:19 | 338.32 km, 23:08:19 | 5 m | 0.61 km, 14.2 mm/s | 3.99 km |
| Mercury, 14 Jan 2008 | 201.7 km, 19:04:39 | 201.71 km, 19:04:39 | 94 m | 2.20 km, 50.6 mm/s | 1.74 km |
| Mercury, 6 Oct 2008 | 199.5 km, 08:40:22 | 199.54 km, 08:40:22 | 89 m | 2.77 km, 66.1 mm/s | 1.89 km |
| Mercury, 29 Sep 2009 | 227.8 km, 21:54:56 | 227.80 km, 21:54:56 | 172 m | 8.04 km, 175.8 mm/s | 3.51 km |

- **The trajectory** puts every closest approach within 0.04 km and a
  second of APL's figures (checked within 3 km and a minute). The MOI
  press kit gives the Mercury heights 0.3 km lower [4].
- **The kernel,** flown from 12 h before each pass with the fields,
  keeps within 9 m of the closest approach at the Earth and Venus
  (checked within 20 m), and 89 to 172 m at Mercury (checked within
  200 m).
- **Half a day on,** the Earth's and both Venus passes end within 0.7 km
  (checked within 1 km). The pass 338 km over Venus ended 4.0 km off with
  J2 alone. The one at 2,987 km gains 0.5 km from the field that the
  reconstruction seems to leave out there.
- **At Mercury** the passes end 2.2 to 8.0 km off, no closer than with J2
  alone (1.7 to 3.5 km): the different Mercury above, not its field.
  Checked within 3 km for the first two and 10 km for the third (each
  flyby's `endKm` in `missions.data.mjs`).
- **The flyby anomaly:** at the Earth, Anderson et al.'s formula [7]
  would give 0.06 mm/s for MESSENGER's asymptotes (32° in, −33° out). The
  kernel ends the pass 0.70 mm/s from the reconstruction's v∞, so it can't
  settle one this small. Reported, not checked.

## The orbit reached

After MOI the state 10 minutes past cutoff is 207.5 by 15,272 km above
Mercury's 2,439.4 km sphere, a 12.076 h orbit. The Technical Digest
gives MOI's result as a 12.071 h orbit, 206.77 km at its lowest [3].
Checked within 5 %.

## In the app

Choose **MESSENGER · cruise to Mercury, 2004–11** under Real missions, or
`?mission=messenger`. The craft starts on 5 August 2004 with the press
kit's 1,107 kg [4] and the main engine as APL's record has it at MOI
(646 N, Isp 314 s) [1]. It flies with a tracking fix every 24 h by
default (`fixHours` in the file).

| | Flybys (from the flown) | At the end | Worst |
| --- | --- | --- | --- |
| Every burn replayed as flown | Earth 5,435 km (flown 2,336), then lost | — | — |
| As flown, a fix every 24 h (the default) | within 0.6 km at each | 12.7 km | 14.9 km |

- **Blind,** a year of sunlight the app's one Cr can't follow brings the
  Earth flyby in 3,100 km too high, and the rest of the flight is lost.
  The validation flies it to a day past that flyby and no further
  (`blindFlybys`), which saves 30 s of `npm test`.
- **Aimed,** as Juno and DART fly, each burn aims at the next one's
  flown state. Across Mercury's second flyby, with J2 alone, what the
  pass left (0.125 m/s) turned into hundreds of kilometres by DSM-4A. So
  the aim found a flyby 93 km too low, and the aims after it diverged.
  With the field the pass leaves 0.028 m/s; the aimed flight hasn't been
  flown again. Its
  navigators flew it on a fresh orbit determination before each burn, so
  the app flies it with a fix every 24 h and the burns as flown. The
  validation doesn't fly it aimed (`fixesOnly`).
- **Checks:** with fixes, every flyby within 5 km of the flown, within
  15 km at the end and 500 km throughout. The end is half a day into
  Mercury orbit: 12.7 km, against 9.6 km before the app had Mercury's
  field. The end carries MOI as replayed and half a day in orbit. Mercury's field
  halves the error of the first orbit flown on its own: from 01:30 after
  MOI to 12:00, 0.52 km against 1.12 km with J2 alone, and degrees past
  4 change nothing (measured, not checked: the arc is under the
  day a coast arc needs).
- **Leap seconds:** the cruise crosses two, on the last days of 2005 and
  2008. The file's states are interpolated in seconds as they passed
  (TT), not UTC's milliseconds, which run a second short across one: at
  MESSENGER's 38 km/s that was 38 km.

## References

[1] Johns Hopkins University Applied Physics Laboratory, "MESSENGER: Mission design," the DSM and TCM tables and each burn's details (start time, masses, thrust duration, effective thrust and Isp, Cartesian ΔV in EME2000). [Online]. Available: https://messenger.jhuapl.edu/About/Mission-Design.html

[2] JHU/APL MESSENGER reconstruction `msgr_20040803_20150501_od423sc_0`, via JPL Horizons, object −236. [Online]. Available: https://ssd.jpl.nasa.gov/horizons/

[3] J. V. McAdams *et al.*, "Spacecraft trajectory planning and execution for the MESSENGER mission," *Johns Hopkins APL Tech. Dig.*, vol. 34, no. 1, 2017, Table 10. [Online]. Available: https://jhuapl.edu/sites/default/files/2024-09/34-01-McAdams.pdf

[4] NASA and Johns Hopkins University Applied Physics Laboratory, "MESSENGER Mercury orbit insertion," press kit, Mar. 2011. [Online]. Available: https://www.nasa.gov/pdf/525164main_MercuryMOI_PK.pdf

[5] Johns Hopkins University Applied Physics Laboratory, "MESSENGER: Spacecraft and instruments." [Online]. Available: https://messenger.jhuapl.edu/About/Spacecraft-and-Instruments.html

[6] Johns Hopkins University Applied Physics Laboratory, "MESSENGER: Flyby information." [Online]. Available: https://messenger.jhuapl.edu/Resources/Flyby-Information.html

[7] J. D. Anderson, J. K. Campbell, J. E. Ekelund, J. Ellis and J. F. Jordan, "Anomalous orbital-energy changes observed during spacecraft flybys of Earth," *Phys. Rev. Lett.*, vol. 100, no. 9, art. no. 091102, 2008, doi: 10.1103/PhysRevLett.100.091102.
