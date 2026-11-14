# Atmospheric entry

How a capsule comes home in the orrery: Orion's crew module flying a lifting
entry, guided to its splashdown point, under its parachutes to the sea.
The code is `src/physics/entry.js` (the force and the guidance) and
`src/physics/orion.js` (the capsule and each mission's entry), wired into
the kernel's environment (`environment.js`) and the app's real missions
(`src/app/mission.ts`). Checks: `src/physics/entry.test.mjs`.

## The capsule

At the mission's separation time the craft becomes the crew module
(`Mission.entry`; the kernel holds there, so no request flies past it as
the whole spacecraft). From `orion.js`:

| | Value | Source |
| --- | --- | --- |
| Mass | 9,239 kg | the LM606 design reference (Rea & Putnam 2007); the flown masses are not published |
| Area | 19.87 m² | the 5.03 m (16.5 ft) heat shield |
| L/D | 0.26 at Mach 30 to 0.28 at Mach 10, 0.37 at Mach 1.6-2, 0.10 at Mach 0.4 | hypersonic trim about 0.28 (Bibb et al. 2011); EFT-1's 0.25-0.29, peaking near 0.35-0.4 around Mach 1.5-2 (Mazaheri et al. 2026); the subsonic value is assumed |
| Cd | 1.3 to Mach 1.6, falling to 0.9 at Mach 0.4 | Mazaheri et al. 2026 below Mach 1.6; the hypersonic 1.3 is assumed |
| Drogues | 2 × 23.2 m² drag area | Ray 2017 (about 250 ft² each, fully open) |
| Mains | 3 × 1,013 m² | back-calculated from Ray 2017's reefing ratios (about 10,900 ft² each); settles at 7 m/s at sea level (NASA: about 17 mph) |

The Mach number comes from the standard atmosphere's temperature
(`machAt`), and the tables are interpolated linearly (`aeroAt`). The
chutes open by height above the WGS-84 ellipsoid, each over 0.3 km (the
reefed stages, a few seconds), the mains cutting the drogues away.

## The force

The capsule flies at its trim angle of attack, so its lift is L/D times its
drag, across the air-relative velocity. The bank angle turns it about that
velocity: at 0 it points up (in the plane of the radius and the velocity),
at +90° to the left, toward the orbit normal r × v (`liftDirection`). Drag
and lift use the kernel's atmosphere: the 1976 standard to 86 km, MET-1999
above. The parachutes add their drag below their heights.

Two step limits keep the integration stable through the chutes
(`environment.js`): the drag's time constant is taken from the speed
through the turning air, not relative to the Earth's centre (a capsule
under its mains moves at the ground's 0.4 km/s), and with the chute area a
ramp's height lower, so a step starting as a chute begins to open is already
short; and no step falls far past an opening height.

## The guidance

A numerical predictor-corrector, of the kind of Orion's skip entry guidance
and FNPEG (Lu 2014). Every 2 s (`cycle`) it flies the capsule ahead with a
fast 3-DOF model (`predict`): point-mass and J2 gravity, the standard
atmosphere and, above 86 km, the kernel's own MET densities looked up where
the predicted capsule is (a long skip spends twenty minutes in that air
thousands of kilometres away), the Earth's rotation, the Mach tables and the
chutes, down to the sea. Against the kernel at a held bank it lands within
0.5 km of the kernel's landing on a direct entry.

- **Bank size.** The downrange of the predicted landing, along the great
  circle toward the target (the target where the Earth will have carried it
  by the landing time), against the target's. Solved by bracketing from the
  last bank and Illinois steps, to 0.6 km. A prediction that skips out, or
  climbs above 200 km, or takes more than 2,500 s, counts as too long. The
  size is kept within 15° and 165°, so some lift is always left sideways.
- **Bank sign.** Fast (above 3 km/s), the landing with no turn either way is
  predicted (the lift's vertical part only), and the bank turns toward the
  target once the target lies further to the side of that landing than a
  deadband (25 km at 11 km/s, narrowing to 2 km at 3 km/s). Slow, the size
  is solved for both signs and the sign whose landing comes nearer is kept.
  At most one reversal every 10 s.
- **Hold.** Below 0.3 km/s through the air, or 10 km up, the bank is held.

The guidance runs inside the kernel's environment in the Worker, and its
state (the sign, the size, the last reversal) travels with each kernel
request and result (`envState`), so reversals keep their history.

What does not work, and why (found getting here):
- downrange as the straight angle to the landing: a steep bank swings the
  landing sideways, so two banks reach the same angle, and the bank swung
  between them every cycle;
- choosing the sign by comparing landings at either fixed sign from far out:
  each is far off anyway, the sideways error built up early, and Artemis I
  ended 20-30 km out;
- the target's angle out of the current plane of motion: it ignores the
  Earth's turn under the target over twenty minutes (500 km).

## Against the real entries

From the end of each mission's flight data, as the crew module, guided to
the mission's target (`entry.test.mjs`):

| | Ours | Flown |
| --- | --- | --- |
| **Artemis I** (target: the splashdown in AAS 24-174, 27.35 N, 118.10 W) | | |
| First dip | 58.5 km | just below 61 km |
| Skip top | 97.6 km | 87.6 km |
| Drogues | 17:35:20 | 17:36:06 |
| Mains | 17:36:35 | 17:37:26 |
| Splashdown | 17:42:44 at 7.0 m/s, 9.1 km from NASA's point | 17:39:41, 2.1 nmi from NASA's target |
| **Artemis II** (target approximate: no published coordinates) | | |
| Entry | dips to 55.9 km, lofts to 72 km | no climb back out |
| Drogues | 00:03:15 | about 00:03 |
| Mains | 00:04:30 | about 00:04 |
| Splashdown | 00:08:26, 0.3 km from the target | 00:07 |

In the app, flown from the start of Artemis I with its corrections aimed
from the craft, the crew module separates at 17:00 and splashes down at
17:42:40, 21 km from NASA's point.

What is still off:
- **The skip** tops out 10 km higher than Artemis I's. Orion's PredGuid
  flies phases (an initial roll, energy management, then the
  predictor-corrector); this flies a constant bank size from entry
  interface. A bank linear in energy (FNPEG) and the PredGuid phases are the
  next steps ([the review](simulation-review.md#3-entry-modelling-plan)).
- **Under the mains.** NASA's Artemis I blog gives the mains at 9,500 ft at
  17:37:26 and splashdown at 17:39:41: 135 s for 2.9 km, an average of
  21 m/s, where the mains settle at 7.6 m/s. The published heights are kept
  (Artemis II's are its day-of figures, 22,000 and 6,000 ft), so splashdown
  comes 1.5 to 3 minutes late.
- **The flown masses, the hypersonic drag coefficient and the subsonic L/D**
  are not published; the table's values are marked as assumptions.
- **Winds** are left out; the review lists the sources for them.

## Sources

- Rea, McNamara & Kane, *Orion Artemis I Entry Performance*, AAS 24-174
  (NTRS 20240001314, 20240000024): the flown skip, the target and splashdown.
- Rea & Putnam 2007 (NTRS 20070023643): entry design, the LM606 mass.
- Bibb, Walker, Brauckmann & Robinson, AIAA 2011-3506 (NTRS 20110013644):
  Orion's hypersonic aerodatabase.
- Mazaheri, Bibb & Lessard, IPPW 2026 (NTRS 20260004998): EFT-1 and Artemis
  aerodynamics.
- Ray 2017 (NTRS 20170004357): CPAS drag areas and reefing.
- Lu, *Entry guidance: a unified method*, JGCD 37(3), 2014: FNPEG.
- NASA Artemis I and II mission blogs, the Artemis II press kit.
- The full list, checked claim by claim: [simulation review](simulation-review.md#7-sources).
