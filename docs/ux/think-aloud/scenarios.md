# Scenarios

Eight tasks, easy to hard, plus an optional ninth. Each has a **card** for
the participant, written as a goal in everyday words with no control names
(naming the control would test reading, not finding), and **notes** for the
facilitator: the start link, the expected path, what counts as success, a
time limit, and what to watch for.

They update the eight scenarios of the [UX review](../review.md#scenarios-goal-based)
for what the app does now (moons, small bodies, the plotting table with its
STACK and GO stations, the ROCKET tab's presets, the flight console, the
gravity guides), and keep the personas: Mia (a student, no jargon), Dev
(follows missions), the engineer.

Start links assume the build is served at `http://localhost:4173/` (see the
[README](README.md#running-it-in-firefox-on-the-laptop)). Labels in the notes
are the app's own, as written in the source on main at 157108b.

---

## 1. Find Mars

**Card.** *You've just opened this app. Find Mars, and find out how far it
is from Earth right now and how long a radio message would take to reach
it.*

- **Start:** `http://localhost:4173/`
- **Path:** Mars in the body rail (or its label in the sky) → the camera
  flies there → the data plate on the right: "From Earth" and "Light time".
- **Success:** says the distance (km) and the light time (minutes).
  Partial: finds Mars but not the light time.
- **Limit:** 3 min.
- **Watch for:** whether they try the rail or the sky first; whether they
  notice the flight (the view plate's "En route") or click again; whether
  they find the plate's numbers, and read "Light time" as the radio delay.

## 2. Earth today

**Card.** *Have a close look at Earth as it is today, clouds and all. Then
turn it so that you can see the side where it's night.*

- **Start:** `http://localhost:4173/`
- **Path:** Earth in the rail → zoom with the wheel → drag to turn until the
  night side (city lights) shows.
- **Success:** Earth fills much of the view and the night side, with city
  lights, is in view.
- **Limit:** 3 min.
- **Watch for:** whether they find zoom and drag without help (the hint is
  at the foot of the rail); whether a drag during the flight surprises them
  (it stops the flight); whether the daily clouds are noticed (they take a
  few seconds to arrive).

## 3. A moon of Jupiter

**Card.** *Jupiter has dozens of moons. Find Europa and find out how big it
is.*

- **Start:** `http://localhost:4173/`
- **Path:** Jupiter in the rail → its "+N" moon chips open under it →
  "Europa" → the plate's "Mean radius".
- **Success:** says Europa's size (radius about 1,561 km, or the diameter).
- **Limit:** 3 min.
- **Watch for:** whether the "+N" count and the chip grid are noticed;
  whether they look for a search box; what they make of the "Barycentre"
  chip.

## 4. A small body

**Card.** *Ceres is a dwarf planet in the asteroid belt. Go to Ceres and
find out how long it takes to go once around the Sun. Then hide the
asteroids so that only the planets are showing.*

- **Start:** `http://localhost:4173/`
- **Path:** the rail's "Small bodies" section → "Fly to" ("a named one…")
  → Ceres → the plate's "Orbital period"; then the "Main belt" (and other)
  switches off.
- **Success:** says Ceres's period (about 4.6 years) and turns off at least
  the main belt.
- **Limit:** 4 min.
- **Watch for:** whether they find the small-body list at all (it is below
  the planets in the rail); whether they understand the switches' "on/off";
  whether they try clicking asteroids in the sky.

## 5. Fly Artemis II

**Card.** *In April 2026 NASA flew four astronauts around the Moon on
Artemis II. Fly that mission in the app and keep the camera on the
spacecraft. How high above Earth is it?*

- **Start:** `http://localhost:4173/`
- **Path:** the header's "Console" key (or M) → "Mission" → "Real
  missions" → Mission "Artemis II · April 2026" → "Fly it" → the camera
  follows the craft (view plate "Follow Artemis II") → the console's
  "Altitude".
- **Success:** the craft is flying and followed, and they read an altitude.
- **Limit:** 4 min.
- **Watch for:** whether "Console" says "missions" to them, or they look for
  a mission in the rail; whether the clock jump ("Clock set …" with Back) is
  noticed or alarms them; whether the "Flight" window in the header is used.

## 6. Plan a journey and fly it

**Card.** *Plan a trip for a spacecraft from Earth to Mars. Find out
roughly how big a rocket you'd need for it, then send the spacecraft on its
way.*

- **Start:** `http://localhost:4173/`
- **Path:** "Console" → "Planner" → "Open the plotting table" → PLOT: in
  "Journey", pick Mars and "Add waypoint" → the leg solves (lamps, the scope)
  → STACK: "Real launchers, same job" (which can do it) → GO: every row GO
  → "Commit to the orrery".
- **Success:** a craft is flying toward Mars and followed, and they named a
  rocket (or a stage count) that could do it. Partial: committed without
  looking at STACK, or found STACK but could not commit.
- **Limit:** 8 min.
- **Watch for:** the jargon (delta-v, C3, Lambert, node, Isp); whether the
  three stations PLOT, STACK and GO read as steps in order; what they do when
  a GO row reads NO GO or STANDBY; whether they find the way back to the sky
  ("Close" or Esc).

## 7. Launch a real rocket

**Card.** *Take the Saturn V, the rocket that sent Apollo 11 to the Moon,
and launch it from its pad into orbit around Earth.*

- **Start:** `http://localhost:4173/`
- **Path:** "Console" → "Rocket" → Vehicle "Start from" "Saturn V (Apollo
  11)" → The job "Orbit" → Launch "Fly the ascent" → "Launch from the pad"
  (or "Put it in orbit").
- **Success:** the ascent is flown and the craft is in orbit (or climbing
  from the pad) in the sky.
- **Limit:** 6 min.
- **Watch for:** whether the greyed published figures read as locked or
  broken; whether "Fly the ascent" (a calculation) and "Launch from the pad"
  (in the sky) are told apart; reactions to the clock moving to T−10 s.

## 8. Undo a mistake and check a number

**Card.** *Someone pressed a key and the date changed. Put it back to the
date it was showing before. Then find out where the app gets its figure for
the mass of Mars.*

- **Start:** `http://localhost:4173/?focus=mars&t=2030-01-01T00:00Z`. Once
  it has loaded, the facilitator presses **N** (the clock jumps to now and
  the "Clock set …" notice appears). Then hand over the card.
- **Path:** the notice's "Back" key → the date returns to 2030 → the
  plate's "GM, system" row → its source tag ("DE442"): hover, focus or click
  for the detail.
- **Success:** the date is back to 1 January 2030 and they say where the
  mass comes from (JPL's DE442 ephemeris). Partial: one of the two.
- **Limit:** 4 min.
- **Watch for:** whether the notice is seen at all (it sits under the
  clock); whether they try the date itself or the browser's back button;
  whether "GM, system" reads as mass (it is G times the mass of Mars and its
  moons); whether the tags read
  as clickable.

## 9. Optional: gravity guides

Use if there is time, after task 8; log it as task 9 on the sheet.

**Card.** *Show where Earth's gravity stops being the main pull on a
spacecraft and the Moon's or the Sun's takes over.*

- **Start:** `http://localhost:4173/?focus=earth`
- **Path:** the rail's "Guides" section → "SOI and Hill" on (and perhaps
  "Lagrange" or "Pulls").
- **Success:** the sphere of influence (and Hill sphere) shows around Earth
  and they can say what it means in their words.
- **Limit:** 3 min.
- **Watch for:** whether the guide names mean anything without hovering
  (the hover text is the only explanation); whether they zoom out far
  enough to see it.

---

## After each round

Collect every problem seen, with the task, how many participants met it
and a severity (0–4), and turn the 3s and 4s into fixes before the next
round. Tasks 5 to 7 test the newest and most complex parts; if most people
fail one, try a simpler card for it next round rather than drop it, and
note the change.
