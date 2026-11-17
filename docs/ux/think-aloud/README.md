# Think-aloud test kit

A small usability test of the orrery with real people, run on the author's
laptop in Firefox. It is the check the [UX review](../review.md) asks for:
that review and the [overhaul](../overhaul-plan.md) only predict where people
will struggle; this finds out.

| File | What it is |
| --- | --- |
| [scenarios.md](scenarios.md) | The eight tasks, with their start states, success criteria and what to watch for |
| [facilitator-script.md](facilitator-script.md) | What to say, from welcome to debrief |
| [consent.md](consent.md) | The consent note, read and agreed before starting |
| [recording-sheet.md](recording-sheet.md) | One sheet per participant: success, time, errors, quotes, SEQ and SUS |
| [results.csv](results.csv) | The same numbers as a table, one row per participant and task |

## The method, briefly

- **Think-aloud, one person at a time.** The participant does each task while
  saying what they are looking for, expecting and thinking. The facilitator
  watches and notes, and helps only when a task has stalled (below).
- **Three to five people a round, then fix and run again.** Five people find
  most of the problems a test can find, and testing should stop when no new
  kinds of problem appear (Rogers, Sharp & Preece, *Interaction Design*,
  6th ed., ch. 15). Hartson and Pyla's RITE approach (*The UX Book*, 2nd ed.,
  §24.5) fixes obvious problems between participants and tests the fix on
  the next one.
- **Mix the people** across the [personas](../review.md#personas): at least
  one with no orbital mechanics (Mia), one who follows missions (Dev), and,
  if possible, one engineer. At least one session on a phone-width window
  later, with the same tasks.
- **Measures per task:** success (yes, with help, no), time, errors (wrong
  turns), the Single Ease Question (SEQ, 1–7) straight after the task, and
  quotes. At the end, the System Usability Scale (SUS, 0–100).
- **Severity** of each problem found, on Nielsen's 0–4 scale as in the
  [review](../review.md): 0 not a problem, 1 cosmetic, 2 minor, 3 major,
  4 catastrophe. A problem one person meets and others avoid is still
  logged.

## Running it in Firefox on the laptop

**Before the day**

1. **Pin the version under test.** Make a worktree at the commit being
   tested, rather than using the main checkout (other work runs there):

   ```bash
   git -C ~/digital-orrery worktree add ~/orrery-uxtest origin/main
   ```

   Then build it and serve the build, which is faster and steadier than the
   development server and has no live reloading:

   ```bash
   cd ~/orrery-uxtest && npm install && npm run build && npx vite preview --port 4173 --strictPort
   ```

   Write the commit (`git -C ~/orrery-uxtest log --oneline -1`) on every
   recording sheet.
2. **A clean Firefox profile**, so no extensions, saved zoom or history get
   in the way:

   ```bash
   firefox --no-remote --profile "$(mktemp -d)" http://localhost:4173/
   ```

3. **Check WebGL** in that profile: open `about:support` and look under
   Graphics. "WebGL 2 Driver Renderer" should name a real GPU (Intel or
   NVIDIA), not "llvmpipe" or "SwiftShader". If it is software, the 3D view
   will be slow and the test will measure that instead; fix it before
   testing.
4. **Do a dry run** of all eight tasks yourself with the scenario sheet,
   timing each, so you know what success looks like and that every start
   link works on this build. Keep the browser console open (F12) during it:
   it should show no errors. A build that throws (main at 157108b throws
   `unit is not defined` on every frame, from `src/physics/orientation.js`)
   is not ready to test with people.

**Each session**

1. Screen at its normal resolution, Firefox maximised, zoom at 100 %
   (Ctrl+0), the laptop on mains power (battery saving can cap the frame
   rate).
2. Close other windows and notifications. Have the scenario cards printed
   or on a second screen the participant can read, and the recording sheet
   for you.
3. Recording is optional and only with consent: the screen with GNOME's
   built-in recorder (Ctrl+Shift+Alt+R starts and stops; it records no
   sound) and the voice on a phone, or OBS for both. Notes on the sheet are
   enough if they decline.
4. Start every task from the start link on its card (typed by the
   facilitator), not from where the last task ended, so each task is
   independent.
5. Between participants, close the Firefox window and start again from
   step 2 of "Before the day" with a new empty profile. The app keeps no
   local data, so a fresh page is a fresh state.

**Afterwards**

- Fill in [results.csv](results.csv) the same day, while it is fresh.
- List every problem seen with its task, how many people met it, and a
  severity. Fix the 3s and 4s before the next round, then run the round
  again with new people.
- Add a pass to [the review](../review.md) with what was found and fixed.

**Reduced motion.** If a participant uses "reduce motion" in their system
settings, the app's camera flights become cuts: note it on the sheet, since
it changes tasks 2 and 6.
