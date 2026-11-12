# UX review: personas, scenarios and a heuristic evaluation

A first usability review of the console (November 2026, after milestone 2).

## Method

- **Framing:** Benyon's PACT framing (people, activities, contexts,
  technologies). The people are represented by personas, the activities and
  contexts by scenarios.
- **Personas and scenarios:** following usability.gov's guidance. Three or
  four personas covering the main audiences; scenarios that state the goal,
  not the steps.
- **Heuristic evaluation:** against Nielsen's ten heuristics (the set
  usability.gov names), with Nielsen's 0–4 severity scale (0 not a problem,
  4 usability catastrophe).
- **Norman's principles:** feedback, mapping and conceptual models from *The
  Design of Everyday Things*, used to judge the time controls and the
  difference between planets and spacecraft.
- **Look and feel:** the NASA-punk lineage (labelled, tactile controls; no
  holograms; a grounded 1970s–80s feel) as described by Starfield's art
  director. It was used for its principles only, not the game's interface.

This is an expert review, not a test with users. The scenarios below double
as tasks for a later think-aloud test (usability.gov suggests 10–12 tasks).

## Personas

| | Mia, the student | Dev, the enthusiast | The engineer (the author) |
| --- | --- | --- | --- |
| Who | Second-year aerospace student | Follows launches and missions | Avionics engineer validating the physics |
| Context | Laptop in a lecture break, or a phone from a portfolio link | Desktop at home | Desktop, long sessions, keyboard |
| Goals | See where things really are; understand an orbit | See today's Earth; plan and fly a real-looking transfer | Exact numbers with sources; fly, burn and check |
| Knows | Kepler's laws, little jargon | Names of missions, some jargon (C3 maybe) | Everything; wants to check it |
| Frustrated by | Jargon without explanation; losing their place | Silent failures; not knowing what to click | Hidden assumptions; values without sources |

## Scenarios (goal-based)

1. Mia opens a portfolio link on her phone and wants to know what she is
   looking at and how far away Mars is.
2. Dev wants to see what Earth looks like today, clouds and all.
3. Dev wants the cheapest launch to Mars in the next two years, and to fly
   it.
4. The engineer puts a craft into a 400 km orbit, raises its apoapsis with
   a node, and checks the propellant the burn used.
5. The engineer runs time fast to watch the orbit evolve, then returns to
   the present.
6. Mia wonders why the spacecraft's amber line keeps changing while the
   planets' orbits do not.
7. Anyone presses NOW or "Fly this" by accident and wants to get back.
8. The engineer wants to know where a number came from.

## Findings

| # | Heuristic | Sev. | Finding | Fix |
| --- | --- | --- | --- | --- |
| 1 | Visibility of status; user control and freedom | 3 | NOW, "Fly this" and the planner move the clock silently and cannot be undone (scenarios 5, 7). | Done: a notice in the header says how far the clock moved, with a BACK key that returns to the previous time |
| 2 | Match with the real world (Norman: conceptual model) | 3 | Nothing says planets move on their ephemeris while spacecraft are integrated, or what the amber and pale lines are (scenario 6). | Done: a "Motion" row (ephemeris, on rails / integrated, n-body) and a line legend in the mission tab |
| 3 | Error prevention | 3 | Launch altitude below the surface, inclination outside 0–180°, a node in the past, or a negative span are accepted and then fail or are dropped. | Done: inputs are bounded, and the launch and node keys say why they are disabled |
| 4 | Help users recover from errors | 3 | A planner cell with no Lambert solution would read "NaN", and an invalid date computes nothing without a word. | Done: "No transfer here" with the reason; the planner explains invalid input |
| 5 | User control and freedom | 3 | "Remove craft" is immediate and permanent. | Done: removal can be undone from a notice |
| 6 | Visibility of status (Norman: feedback) | 2 | Paused and running differ only by the RUN key's light; the clock window looks the same (scenario 5). | Done: the clock window shows HOLD and dims when paused |
| 7 | Recognition rather than recall | 2 | The keyboard legend appears only on the TARGET tab. | Done: the legend sits at the foot of the body rail, always visible |
| 8 | Match with the real world | 2 | C3, v∞, "osculating" and the source codes are unexplained where they appear (scenarios 1, 8). | Done: every readout label carries a plain-language explanation on hover |
| 9 | Help and documentation | 2 | Nothing links to the docs that explain the physics. | Done: a "How it works" link in the rail |
| 10 | Visibility of status | 1 | LAG and KERNEL are explained only on hover. | Kept: the mission tab states lag in words; hover detail is enough |
| 11 | Flexibility and efficiency | 1 | No keyboard route into the plate's tabs. | Open: tabs are reachable with Tab; arrow-key tab switching later |
| 12 | Visibility of status | 3 | Found while checking the fixes: without WebGL the clock froze while RUN stayed lit, because the scene's frame loop is what advanced it; "the data panels still work" was half true. | Done: without WebGL a 100 ms timer runs the clock and the mission |
| 13 | Consistency and standards | 3 | Found while checking: from 720 to about 1,100 px wide the header ran off the screen, hiding NOW and the lamps. | Done: the header wraps onto a second row in that range |
| 14 | User control and freedom | 2 | Found while checking: pressing NOW again within a minute wiped the notice, so BACK was lost. | Done: a set of under a minute keeps the earlier notice |

Checks after the fixes, in a browser without WebGL at 800 px:
- the clock advanced 1.9 s in 2 s with RUN lit;
- NOW from 2030 showed "Clock set −3.14 yr", and BACK returned to
  2030-01-01 00:00:00;
- the header fit;
- a launched craft stepped, with "Motion: Integrated" and the line legend
  shown.

## Second pass: an independent review

A second reviewer, given the code and screenshots but not this document,
walked the same scenarios at desktop, tablet and phone widths.

| # | Heuristic | Sev. | Finding | Fix |
| --- | --- | --- | --- | --- |
| 15 | Visibility of status | 2 | RUN and HOLD looked like two separate switches; nothing showed that one excludes the other, and NOW stayed enabled when the clock was already live. | Done: RUN and HOLD are a radio pair; NOW is disabled when live |
| 16 | Consistency and standards | 2 | The header's lamps were all one colour, so a warning looked like an advisory. | Done: a flight-deck annunciator (advisory green, caution amber, warning red, each labelled) with an ACK key; the warning lamp stays lit until the condition clears |
| 17 | Recognition rather than recall | 2 | Source tags explained themselves only on hover, which a phone does not have. | Done: tags are buttons; a tap shows the detail beneath the row |
| 18 | Aesthetic and minimalist design | 2 | The mission tab was one long column. | Done: Engine, Manoeuvre node, Log and Launch are sections that fold, with the ones in use open |
| 19 | Match with the real world | 2 | The porkchop had no axes or scale, so it could not be read without the docs; a minimum on the grid's edge was presented as the best. | Done: labelled axes, a C3 ramp legend, and a note when the minimum lies on the edge |
| 20 | Aesthetic and minimalist design | 1 | Text as small as 8 px, and units set in capitals (KM/S). | Done: an 11 px floor for labels, 10 px for table heads; units in their own case |
| 21 | Visibility of status | 3 | A dropped WebGL context left a black view with no word (seen on the reviewer's tablet and phone runs). | Done: a caution says the view was dropped, and the scene resumes when the browser restores it |
| 22 | Consistency and standards | 2 | Labels of bodies hidden behind a nearer planet still showed on top of it. | Done: a label is hidden when its body is behind a nearer disc |

## Third pass: checking the fixes

Screenshots of the second pass's fixes at 1,440, 900 and 390 px wide turned
up four problems, all fixed:

| # | Sev. | Finding | Fix |
| --- | --- | --- | --- |
| 23 | 2 | The LAG lamp showed caution hatching while off: its class collided with the page's caution-stripe class. | Lamp classes renamed (`k-caution` and so on) |
| 24 | 3 | A `?craft=` link opened on the whole solar system, not the craft, because the development double-mount built a second scene that never followed it. | The second scene follows the craft too |
| 25 | 1 | "Arrival excess speed" ran to three lines and "Fly this" broke onto two. | Shorter label (v-inf, explained on hover); primary keys never wrap |
| 26 | 2 | In the overview, the names of Mercury, Venus, Earth and the Sun printed over one another. | Overprinting names give way: the focus first, then the larger body; the smaller keeps its marker and shows its name on hover |

## Still to do

- A think-aloud usability test with scenarios 1–8 and three or four
  people, at least one on a phone. That is the real check; this review only
  predicts.
- Arrow-key switching between the plate's tabs (finding 11).
