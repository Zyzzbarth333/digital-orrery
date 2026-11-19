# Performance

What each part costs, measured with `npm run bench` (`packages/physics/src/bench.mjs`,
Node 20, November 2026) for the physics and in a browser on real GPUs for
the drawing ([rendering](#rendering)), and what is planned to make the slow
parts fast.

## Measured

| Work | Cost | Notes |
| --- | --- | --- |
| Ten body states (one frame) | 0.04 ms | every frame; Earth and the Moon from the DE442 table, the rest astronomy-engine |
| Ten body orientations (one frame) | 0.01 ms | every frame |
| One orbit line (361 samples) | 2.4–2.8 ms | resampled at most one line per frame |
| Kernel, low Earth orbit, Cowell | about 100 sim days per second (was 44) | 2,324 steps per sim day of error-controlled Dormand-Prince (was 9,795 of Yoshida); 3.5 m in a day against a tight reference (was 5.8 m) |
| Kernel, low Earth orbit, with Encke | about 115 sim days per second with the asteroids in reach, 220 without (were 100 and 155) | 1,134 steps per sim day with Earth's J2 (326 with point masses) |
| Kernel, GEO | about 1,060 sim days per second (was 680) | Cowell (perturbed beyond Encke's range), 205 steps per sim day (was 630); 2.0 m in 10 days (was 24 m) |
| Kernel, cruise | about 36,000 sim days per second (was 15,000) | about one step a day; 5 m in 300 days (was 8.4 km) |
| Kernel, among Jupiter's moons (1.5 million km orbit) | about 970 sim days per second (unchanged) | Cowell, 25 steps per sim day (was 61); 1.2 m in 30 days (was 207 m). Each step costs about 3 times a step near the Earth (13 bodies, each moon a sum of two cubics) |
| Kernel, Jupiter with its moons folded up | about 4,000 sim days per second (was 5,000) | the one case the error-controlled steps are slower than Yoshida's: a smooth field where the old fixed fraction was already accurate |
| Kernel, Artemis II's injection burn (23 min, one request) | 35–80 ms wall (was 1.5–2.6 s) | 276 steps (was 5,480) with Orion's whole environment ([a steered burn](#a-steered-burn-at-a-day-a-second)) |
| Splitting systems near the craft (`focus`) | within the ±5 % noise away from them | the same steps as before; the check is skipped until the craft could reach a threshold |
| Ephemeris for the kernel | under 1.6 ms per sim day | the Moon at hourly nodes, now from the DE442 table |

Kernel speeds are steady forward running, as in the app: 90 days in 10-day
chunks, the median of the last five (after V8 has compiled the hot code),
in CPU time. Earlier single short runs mostly measured compilation. The
figures in brackets are main before 18 November 2026's speed work, by the
same `npm run bench`. The machine was busy, so separate runs vary by up to
a third; run interleaved in one process, the speed work is 23 % faster in
low Earth orbit with Encke, 56 % in Cowell, 41 % at GEO and 61 % in cruise,
and 8 % slower among Jupiter's moons.

A frame's ephemeris and orientation work is about 0.07 ms of a 16.7 ms
frame. The limits are elsewhere:

- **Kernel at high warp.** With Encke's method a craft in low Earth orbit
  runs at about 600 sim days per CPU second, so a warp of one year per
  second fits with room to spare (Cowell alone: about 50). About a third of
  that time is the ephemeris, mostly the Moon.
- **GPU memory.** An 8192×4096 texture with mipmaps takes about 180 MB of
  video memory uncompressed, 45 MB in BC7 from its KTX2 copy, which the
  app loads where the GPU takes it. Maps load only when a body's disc is
  more than three pixels across, so the overview loads only the star map;
  a view of one planet loads that planet's maps.

## Measuring

`npm run bench:frames` (`scripts/bench-frames.mjs`) times the app's frames
on this machine's GPUs and prints a Markdown table for a pull request. It
serves a production build with `vite preview` (or takes `--url`), and
times a second build or URL as the baseline when given one:

```bash
git worktree add /tmp/orrery-main origin/main
(cd /tmp/orrery-main && npm ci && npm run build)
npm run build
npm run bench:frames -- --gpu intel,nvidia --base-dist /tmp/orrery-main/dist
```

- **The browser.** Headless Chromium (Playwright's, or `CHROME=`) over the
  DevTools protocol with no npm packages, rendering through ANGLE's GL-EGL
  backend: on the integrated GPU by default, on the NVIDIA with
  `--gpu nvidia` (PRIME render offload). The renderer's name is printed,
  and an NVIDIA run that lands on another GPU stops with an error. The
  launch and the page's helpers are shared with `npm run docs:clips`
  (`scripts/lib/chromium.mjs`).
- **Scenarios.** A URL query and a camera distance each: `earth` (20,000
  km), `belt` (the Sun at 9 × 10⁸ km), and a craft launched with
  `?craft=orbit,400,51.6` and followed at 0.4 km and 3,000 km, with an
  attitude (`craft-near`, `craft-far`) and as a point mass (`,point`:
  `point-near`, `point-far`). Those six run by default. `overview`,
  `earth-fill` (the Earth at 9,000 km, filling the view), `earth-held`
  (`earth-fill` with the clock held), `craft-warp`
  (`craft-far` with the clock at a day a second), the ringed planets
  (`saturn`, `jupiter`, `jupiter-in`, `uranus`, `neptune`),
  the Earth with all 16,892 satellites on (`sats`, 20,000 km), every set on
(`sats-all`) and the same three years on (`sats-later`, [a long
run](#a-long-run)), and the ISS
  followed from 0.1 km (`sat-near`, its close-up orbit drawn) and from
  20,000 km with its passes and ground track (`sat-track`, and
  `sat-track-warp` at an hour a second) run by name, and `all` runs every
  one; `--list` lists them. A scenario can run a setup expression once the
  page is up (the satellites' switch), and hold the clock.
- **Frame cost.** The app's render callback (`window.orrery.frame`, which
  `?debug` exposes) wrapped with a one-pixel `readPixels`, which waits for
  the GPU to finish the frame: CPU and GPU time together. The **frame gap**
  is the time from one callback to the next, 16.7 ms when the frame fits
  the display's 60 Hz. The render scale is held (`?scale=fixed`).
- **Rounds.** Each round loads every scenario afresh in each build, in a
  browser of its own (one browser on the Intel GPU grows past 8 GB over a
  run's page loads, since its textures are system memory), the builds
  alternating which goes first, then waits `--settle` seconds (8)
  and times `--seconds` (4). The table gives the median of each round's
  median over `--rounds` (3); each round's numbers, with the 90th
  percentile and the worst frame, go to stderr, and all of them to
  `--json FILE`. `--size` (1920x1080) and `--dpr` (1) set the viewport.
- **Framing.** Each scenario's camera distance is set with wheel events
  over the sky (`zoomTo` in `scripts/lib/chromium.mjs`). The page receives
  the wheel's delta divided by the device pixel ratio, and the browser may
  scale it further, so the first event measures how far one unit of
  wheel zooms on this page. The rest use that rate, and up to four more
  close the gap to within 0.5 %; a step the camera's limits stop ends it.
  Until 19 November 2026 it assumed the scene's own rate,
  exp(0.0015 Δy), so at DPR 2 every zoom fell short of its tolerance and
  every sample was left out, at phone size as at 1920 × 1080.
- **A busy machine.** Under heavy load the page can stall for seconds:
  its camera flight never ends, or it draws a handful of frames while
  timed. Such a sample is loaded afresh up to `--retries` times (2), then
  left out. The table is still printed, with the missing samples listed
  under it, and the script exits with status 1. The page's own errors and
  the load average at each sample are printed as well.
- **Clean-up.** The browser and the servers run in their own process
  groups with a fresh profile, and are stopped by group, with the profile
  removed, at the end, on an error or on Ctrl-C. A run killed outright
  leaves its profile behind; the next launch removes any over ten minutes
  old that no running process names.

- **Sharing the machine.** Two browsers on one GPU time each other, so a
  run first takes the lock that GPU benchmarks share
  (`~/.cache/digital-orrery/gpu-bench.lock`, through `flock`) and says so
  if it has to wait; `npm run docs:clips` takes it too. Each browser's GPU
  and page processes run in a systemd scope of their own capped at 10 GB
  (`ORRERY_BROWSER_MEMORY`), so a page that grows too big is killed alone
  (and its sample retried) rather
  than systemd-oomd killing everything that shares the terminal's or the
  editor's cgroup. `ORRERY_GPU_LOCK=0` and `ORRERY_BROWSER_MEMORY=0` turn
  them off; without `flock` or `systemd-run` (CI, macOS) both are skipped.
  `npm run bench:textures` holds the same lock. A wait names who holds
  the lock: one of these scripts by its folder and pid, a run wrapped in
  `flock` by hand by its command line (from `/proc/locks`). The scripts
  take the lock themselves, so there is no need to wrap them in `flock`;
  a run that is wrapped anyway sees that its own parent holds the lock and
  goes on under it, rather than waiting for itself for ever. Once it has
  the lock, a run refuses to start with less memory available
  (`MemAvailable`) than the cap and 4 GiB to spare, 14 GiB by default,
  unless given `--force`. A browser the cap stops is reported as such,
  and its failed scope reset, so `systemctl --user --failed` stays
  clear.

Read the before and after of one run rather than numbers from different
runs. On a busy machine repeat runs differ by 10 to 20 %.

**A long run.** `npm run bench:soak` (`scripts/bench-soak.mjs`) keeps one
page open for `--minutes` (25), doing in cycles of about four minutes
what a user does: every rail switch on, timed, then half off and on again
and all off; the clock up to a year a second and back, and a day a second
backwards; flights to Mars, Jupiter, Saturn, the Moon and the Sun; five
FIND searches; the plotting table opened, its stations stepped through,
and closed; a craft launched into low orbit, followed at 3 km and an hour
a second, and removed; the phone layout with its sheet raised and
lowered. Each cycle starts and ends at the Earth from 20,000 km, every
layer off, at real time, where it times the frame. Every 10 s it samples
the frame, the JS heap, DOM nodes and listeners, three.js's geometries,
textures, programs and the whole frame's draw calls, the hand-uploaded
maps' video memory, the live workers and their messages in flight, long
tasks, and the GPU and page processes' memory (their cgroup's, which on
the integrated GPU holds its textures). It exits with status 1, after a
table of the first quarter of the cycles against the last, if the
reference frame, the frame with every layer on, the heap, the GPU and
page memory, the geometries, textures, DOM nodes, listeners or workers
climb. `--per-layer` also times each switch alone every cycle, `--profile`
takes a 3 s CPU profile with every layer on and prints the functions with
the most self time, `--skip` leaves steps out, and `--json` keeps every
sample. It holds the GPU lock and caps its browser as `bench:frames`
does.

**Loading over a slow network.** `npm run bench:load`
(`scripts/bench-load.mjs`) times a first visit (a fresh browser profile)
on a real GPU through a shaped link: every request, the page's and its
workers', goes through one proxy (`scripts/lib/netshape.mjs`) that sends
each direction round robin across connections at the profile's rate and
holds it for half the round trip. `fast4g` is Chrome DevTools' Fast 4G
preset (9 and 1.5 Mbit/s at 90 %, a 165 ms round trip [1]); `cable` is an
NBN 50 service (50 / 20 Mbit/s, 20 ms). A local build is served over
HTTP/2 with byte ranges, gzip and `max-age=600`, as Pages serves it, and
`--url` times the live site instead. It reports the first frame, the sky,
the Earth's maps from a link to the Earth and a flight from there to Mars,
the bytes by kind, and each map's request, decode and upload times in the
`--json` file ([loading over the network](#loading-over-the-network)).

### A phone's view

The phone layout ([phone](frontend/phone.md)) draws the sky full-screen
under its band: at 390 × 844 and DPR 2 the canvas is 780 × 1584 pixels,
about 60 % of a 1920 × 1080 frame at DPR 1. Frame cost and gap, median
ms, two rounds:

| Scenario | Intel frame | Intel gap | NVIDIA frame | NVIDIA gap |
| --- | ---: | ---: | ---: | ---: |
| Earth close-up, 20,000 km | 16.9 | 17.5 | 6.2 | 16.7 |
| The asteroid belt, 9 × 10⁸ km | 12.7 | 16.7 | 4.2 | 16.7 |
| Craft in LEO (6-DOF), 0.4 km | 16.1 | 17.1 | 5.1 | 16.7 |
| Craft in LEO (6-DOF), 3,000 km | 17.6 | 18.4 | 4.9 | 16.7 |
| Craft in LEO (point), 0.4 km | 15.9 | 16.8 | 4.9 | 16.6 |
| Craft in LEO (point), 3,000 km | 16.2 | 16.9 | 4.8 | 16.7 |

`npm run bench:frames -- --gpu intel,nvidia --size 390x844 --dpr 2
--rounds 2`, 19 November 2026, load average 3–5. The emulated screen has
a mouse, not a touch screen, so the sheet sits at peek and the camera's
offset is the one a phone gets there. On the Intel GPU the Earth and the
craft cost about a whole 60 Hz frame (16–18 ms), so the gap stretches to
17–18 ms; the belt fits with 4 ms to spare. On the RTX every scene fits
with 10 ms or more.

## The test suite

`npm test` (`scripts/test.mjs`) runs every check file in its own Node
process, four at a time (`--jobs N` or `TEST_JOBS` for more or fewer).
Each file's output is printed whole, in the runner's order, so the log
reads as one run did. The runner ends with a table of the slowest parts.
A part fails if it exits non-zero or prints a FAIL line. The slowest
files run in parts:

- **`journey.test.mjs`, by case.** CASE 5, 12 and 17 run alone; 20 and
  21 together (21 takes 20's flight); 8, 15 and 16 together; 9 and 10
  together; and the rest (`--except`) in one more
  part, so a new case runs without being listed. Each file takes the cases
  to run on its command line: `node packages/physics/src/journey.test.mjs 12 17`.
  A case named that the file doesn't have fails, so a part can't silently
  run nothing.
- **`missions.validate.mjs`, by mission**, as it already took them:
  `node validation/missions.validate.mjs messenger`.

`npm test -- journey` runs only the parts whose command contains
`journey`. With more processors, `TEST_JOBS=8 npm test` is faster still:
CASE 12 and 17, about a minute each, and 20 with 21 are then the floor. Each journey part
takes up to 0.8 GB, which is why four is the default.

No flight is flown twice in one run, so there is nothing to share between
checks. A journey flight's time is the kernel's: half of it is placing the
bodies at each step (`bodies.js`). MESSENGER's blind replay, every burn as
flown with no fixes, is flown a day past the Earth flyby. After that it is
lost and shows nothing more, and it was 30 s of its six-year flight
(`blindFlybys` in `missions.data.mjs`).

Measured on 18 November 2026: main at c827a24, one file after another
as `npm test` ran them, against this runner straight after, on a 32-thread
machine shared with other sessions (load average about 3), each run
capped at 4 GB:

| | Main, one after another | Side by side |
| --- | --- | --- |
| `npm test`, wall | 461 s | 146 s, four at a time |
| All parts one after another | 461 s | 575 s (each part slower with four running) |
| `journey.test.mjs` | 228 s in one | slowest part 66 s (CASE 20 and 21) |
| `missions.validate.mjs` | 70 s in one | slowest part 36 s (MESSENGER) |
| `artemis1.validate.mjs` | 22 s | 29 s |
| `artemis2.validate.mjs` | 17 s | 23 s |
| PASS lines | 1,219 | 1,219 |

An earlier pair of runs, with the machine busier (load average 5), took
551 s and 140 s.

Every check prints the same tolerance and value as before. The only lines
that differ are measured times and MESSENGER's blind line, which now ends
at the Earth flyby.

## Rendering

Measured on 14 November 2026 for the [overhaul](ux/overhaul-plan.md),
before (main at f5273e6) and after (feat/ui-overhaul), both as production
builds.

**Method.**

- **Browser and GPUs.** Headless Chromium 1254 driven over the DevTools
  protocol, rendering on this machine's real GPUs through ANGLE's GL-EGL
  backend: an Intel UHD (Raptor Lake-S) integrated GPU and an NVIDIA
  RTX 5070 Ti Laptop GPU. SwiftShader, which draws on the CPU, gives
  meaningless timings and was not used.
- **Viewport.** 1920 × 1080 at a device pixel ratio of 1 and 2, so the sky's
  canvas is 1340 × 1016 or 2680 × 2032.
- **Frame cost.** The render loop's callback plus a one-pixel `readPixels`,
  which waits for the GPU to finish the frame: CPU and GPU time together,
  independent of the display's 60 Hz pacing. Median over 4 s after 12 s of
  loading, at a fixed render scale (`?scale=fixed`).
- **Fairness.** Other work loaded the machine heavily during the runs (load
  averages of 16 to 200 on 32 threads), so before and after ran
  interleaved, scenario by scenario. Repeat runs differ by 10 to 20 %.

**Frame cost, before → after** (median, ms):

| Scene | Intel, DPR 1 | Intel, DPR 2 | RTX, DPR 1 | RTX, DPR 2 |
| --- | --- | --- | --- | --- |
| Overview (the Sun, 1.6 × 10⁹ km) | 12.6 → 14.7 | 19.3 → 29.6 | 6.4 → 6.7 | 13.0 → 13.4 |
| Earth close-up | 21.6 → 17.4 | 55.7 → 40.8 | 6.6 → 6.7 | 12.6 → 6.2 |
| Artemis II in flight, near Earth | 44.0 → 21.2 | 119 → 54.4 | 8.7 → 4.4 | 9.6 → 7.8 |

At 60 Hz this is, on the Intel GPU at DPR 1, Earth from 44 to 55 fps and
Artemis II from 21 to 44 fps; on the RTX at DPR 2, the overview from 47 to
60 fps (slow frames from 41 to 2 in 6 s) and Earth from 53 to 60 fps.

**The overview got dearer**, by 2 ms at DPR 1 and 10 ms at DPR 2 on the
Intel GPU: HDR is memory traffic (a half-float target is 8 bytes a pixel, 43
MB at 2680 × 2032), and the overview had little else to cut. Switching
parts off in the first HDR version showed the bloom and the Sun's glare
costing about 19 ms of a 43 ms frame there, in three full-screen passes;
they became one ([lighting](frontend/lighting.md#exposure-and-tone-mapping)),
and the bloom starts at a quarter of the resolution on 2× screens.

**The adaptive render scale** (`renderScale.ts`) covers what is left: when
frames run over 20 ms the canvas's pixel ratio steps down by 0.2, to no less
than 1 (the full resolution of a normal screen; the panels' text is never
scaled), and steps back up after a calm spell. A step that does not shorten
the frames is undone and the scale holds (a browser capping frames at 30 Hz
to save power looks slow but is not). Star widths and the bloom's
resolution follow the scale, so neither jumps when it steps. On the Intel
GPU at DPR 2, 60 Hz paced, an earlier version with its floor at 1.2 took the
overview from 33 to 50 fps (settling at 1.4), Earth from 24 to 30 fps and
Artemis II from 14 to 28 fps, the last two held back by that floor. With
the floor now at 1, its logic was checked by driving the class with
simulated frames (60 Hz display, GPU cost proportional to pixels):

| Frame at full DPR 2 | Settles at | Frame then |
| --- | --- | --- |
| 10 ms (GPU) | 2 (no change) | 16.7 ms |
| 30 ms (GPU) | 1.4 | 16.7 ms |
| 55 ms (GPU) | 1.0 | 16.7 ms |
| 120 ms (GPU) | 1.0 | 33.3 ms |
| 30 Hz cap, 5 ms of GPU work | 2, after one undone descent; retried after 30 s, 60 s, … | 33.3 ms |
| 90 ms of CPU, 10 ms of GPU | 2, the same | 100 ms |

Live runs at the end, under a load average of 63 from other work on the
machine, were CPU-bound at about 100 ms a frame whatever the resolution:
the scale stepped down, found no gain and went back, as in the last row.

**Choosing a body**: main-thread tasks over 50 ms in the 6 s after a click
in the rail, at DPR 1 (the worst single frame in brackets):

| Body | Intel before | Intel after | RTX before | RTX after |
| --- | --- | --- | --- | --- |
| Mars | 3 tasks, 2.35 s (1.78 s) | 12 tasks, 1.34 s (0.22 s) | 2 tasks, 1.80 s (1.38 s) | none (33 ms) |
| Earth | 3 tasks, 1.84 s (1.37 s) | none (83 ms) | 2 tasks, 1.77 s (1.37 s) | none (17 ms) |
| Moon | 2 tasks, 2.01 s (1.42 s) | none (50 ms) | 2 tasks, 1.79 s (1.20 s) | 9 tasks, 0.65 s (117 ms) |

The page no longer freezes: each 8k map is decoded in a worker and
uploaded 4 MB a frame ([textures](frontend/textures.md#loading)), so the
worst frame fell from 1.2–1.8 s to 0.02–0.22 s. Under heavy load a strip
upload can still pass 50 ms (Mars on the Intel GPU, the Moon on the RTX
above); on a quiet machine Mars and the Moon showed none.

**What changed, and why:**

| Change | Where | Effect |
| --- | --- | --- |
| Earth's sunlight transmittance from a table, not a ray march per sample | `atmosphere.ts` | Earth view on the Intel GPU 19–20 → 14 ms (the table alone) |
| Maps decoded in a worker, uploaded in 4 MB strips as `ExternalTexture`s | `decode.worker.ts`, `surfaces.ts` | no freeze on choosing a body; loading starts with the flight |
| HDR in one final pass: bloom mix, glare and tone mapping together | `post.ts`, `sun.ts` | two fewer full-screen passes than three.js's own HDR output |
| No MSAA at 1.5 device pixels per CSS pixel or more | `post.ts` | MSAA cost 6 ms of 24 at DPR 2 on the Intel GPU |
| Bloom from a quarter of the resolution on 2× screens | `post.ts` | the first downsample reads a quarter of the pixels |
| Glare skipped when the Sun is well out of view | `sun.ts` | no full-screen glare when it cannot reach the frame |
| Star sprites only as wide as each star's light | `stars.ts` | 83,392 stars, most a few pixels |
| Header and rail redraw only when what they show changes | `clock.ts`, `panels.tsx` | see below |
| Adaptive render scale | `renderScale.ts` | holds the frame rate on weak GPUs at DPR 2 |
| The renderer asks for the discrete GPU | `OrreryScene.ts` | `powerPreference: 'high-performance'` |

### The belt's haze and the load

Measured on 14 November 2026, before (main at fcbee79) and after
(feat/perf-pass), production builds, interleaved, Sun view, everything on,
the point budget held at full quality. `?debug` exposes the scene as
`window.orrery`, so each layer can be switched off in turn.

**The floor.** A bare page that only clears a canvas of the same size and
reads one pixel costs 13.2 ms a frame on the Intel GPU and 5.3 ms on the
NVIDIA in this headless setup: the browser's own compositing, the same
for every configuration. Everything below is on top of it.

**Per layer, Intel at 2× (1720 × 1672), before.** Switching each off in
turn, against everything on either side of it: the haze 8 to 12 ms; the
HDR pipeline (its target, bloom and final pass) about 3 to 5 ms; the belt
points, the Milky Way and its 16k tiles, the glare and the point stars
each within the run-to-run noise (about 2 ms). On the NVIDIA the whole
scene costs about a millisecond over the floor.

| Intel, 2× | Before | After |
| --- | --- | --- |
| Frame, everything on | 28–32 ms | 20–23 ms |
| The haze's share | 7.5–12 ms | 1.5–2.3 ms |
| Multi-second stalls with the haze on (some runs) | yes | none seen |

**Load, page open to each part on screen** (median of three, Intel /
NVIDIA, ms):

| Part | Before | After |
| --- | --- | --- |
| First frame | 640 / 1370 | 700 / 1240 |
| Belt points | 750 / 1520 | 760 / 1350 |
| Sky (Milky Way) | 4370 / 3880 | 1110 / 1590 (2k preview); full 8k at 5550 / 3660 |
| Haze | 3550 / 3590 | 2560 / 2560 (every eighth body); full grid 3740 / 3570 |

The sky was the last part to appear: decoding the 8192 × 4096 WebP takes
seconds. A 2048-wide copy (0.57 MB, the same mean light to 0.04 %) is shown
first and the full map put in its place when it is up.

**Since then.** The belt file is 17.4 MB at 12 bytes a body, down from
23.1 MB at 16 ([the faint belt's file](frontend/small-bodies.md#the-data)).
KTX2 textures came later ([below](#gpu-compressed-maps)).

### A craft at high warp

A craft in low Earth orbit at a day a second goes round 16 times a second,
and the kernel's results arrive a frame or more behind the clock. Each
frame, the main thread carries the drawn craft across that lag (above),
and evaluating the environment at every RK4 stage made that the costliest
work on the main thread: 7.4 % of it in a profile on the Intel GPU, with
frames of 113–174 ms when the lag grew. With the environment once per step
it is 2.7 %, and frames over 100 ms are gone. Intel at 1 d/s, headless on
the overview of a low orbit:

| | Median frame | Worst | Frames over 100 ms (of 300) |
| --- | ---: | ---: | ---: |
| Before | 25.6–26.0 ms | 113–174 ms | 1–3 |
| After | 20.9–22.7 ms | 72–87 ms | 0 |

What remained was mostly the GPU, which half the frame waited on near
the Earth: the atmosphere filled the view
([the atmosphere near the Earth](#the-atmosphere-near-the-earth)).

### A steered burn at a day a second

`?mission=artemis2` starts ten minutes before the translunar injection.
Switched straight from real time to a day a second, the clock passes the
whole 23-minute burn (its settling pulses included) in a frame. The kernel
worker then took 4–5 s of wall time to fly it, against its 200 ms budget
a request. For those seconds the LAG lamp was lit and the kernel fell 2–5
days behind the clock. The burn was the cost, not the coast after it:
- **The steps.** A burn steered in the orbital frame had its steps capped
  at 0.25 s, a rule from the symplectic integrator before the
  error-controlled one. That made 5,480 steps where the burn's 273
  five-second intervals need 276. The cap is gone, and the burn ends 2 mm
  from the same burn at 0.01 s steps
  ([Artemis II check](validation/artemis2.md#3-the-whole-mission-with-orions-burns)).
- **The environment at each stage.** It was 88 % of a step: the MET
  density through the eight altitude bands between 186 and 2,100 km, the
  degree-20 field, the solid tide, and a scan of all 273 intervals for the
  thrust and the mass. Each is now cheaper and gives the same numbers to
  the bit (checked over seven days of Artemis II and 9,906 MET points):
  - MET's quadrature nodes are worked out once a band, and a band two
    integrals cover is summed once (2.2 times faster).
  - The field runs on flat arrays.
  - The tide works out each body's place once rather than for each of its
    seven terms.
  - The space weather's dates are parsed once.
  - The burn on, and the mass, are kept per interval between burn edges.
  - The Earth's rotation and the time scale are kept for a stage's repeated
    asks.

Node, warm, the burn in one request with Orion's whole environment
(interleaved runs, the machine heavily loaded by other work):

| | Steps | Wall time |
| --- | ---: | ---: |
| Before | 5,480 | 1.5–2.6 s |
| Without the cap | 276 | 70–120 ms |
| And the cheaper environment | 276 | 35–70 ms |

In the app (production build, headless Chromium on the Intel GPU, five
runs each, interleaved, the machine at a load of 25–31 on 32
threads):

| | LAG lamp lit | Kernel behind the clock, worst | First burn request in the worker |
| --- | ---: | ---: | ---: |
| Before | 72–110 frames | 55–115 h | cut by the budget |
| After | none in four runs, 2 frames in one | 3.6–9.3 h | 109–127 ms |

The kernel is now a frame or two (24–48 min) behind on the coast. Through
the burn it falls about 4 h behind for 0.2 s, the time the worker takes to
fly it, and is back within two frames 0.25 s after the switch. Later
jumps of 3–6 frames are the holds at the aimed corrections, while the
worker aims each one (`RealMission.aimStep`).

### The atmosphere near the Earth

Each pixel of the Earth's atmosphere shell used to march its own view ray:
32 steps, each a sunlight transmittance lookup and five exponentials. With
the Earth filling the view on the Intel GPU, that was about 17 ms of a
52 ms frame. Hiding the shell in the page, between timed spells, gave
35 ms. Leaving out the surface's sunlight through the air as well changed
nothing beyond the noise. So the cost was the shell's march, over every
pixel the shell covers.

Now each frame marches a table of 128 × 256 rays from the camera, and the
shell's pixels look theirs up
([atmospheres](frontend/atmospheres.md#the-view-table)). The shell then
costs about 3 ms of the same frame. Screenshots at the same time and view
differ by at most 1 of 255 at the 99.9th percentile of pixels.

`npm run bench:frames`, 18 November 2026, 1920 × 1080 at DPR 1, main
before and this change after, interleaved, the median of three rounds.
The Intel GPU's samples each ran in a fresh browser, since one browser
grew past 8 GB over a run's page loads. Load average 8–18.

| Scenario | Intel, before → after | NVIDIA, before → after |
| --- | ---: | ---: |
| Earth close-up, 20,000 km | 35.6 → 21.2 ms (−40 %) | 5.6 → 5.4 ms (−4 %) |
| Earth filling the view, 9,000 km | 43.0 → 25.3 ms (−41 %) | 6.2 → 5.5 ms (−11 %) |
| Craft in LEO, 0.4 km | 24.8 → 23.0 ms (−7 %) | 8.0 → 6.7 ms (−16 %) |
| Craft in LEO at 1 d/s, 3,000 km | 53.3 → 40.8 ms (−23 %) | 17.3 → 18.2 ms (noise) |

At 0.4 km the camera looks along the orbit, past the craft, with little
of the Earth in view. At 1 d/s the NVIDIA's frame is the kernel's carry
on the CPU, and its rounds ran 11.6–28.8 ms before and 16.4–22.1 ms after.

#### Light scattered more than once

The sky's second table, Hillaire's multiple-scattering table
([atmospheres](frontend/atmospheres.md#light-scattered-more-than-once)),
is made once, when the Earth's air is first drawn: 8–24 ms on the Intel
GPU, 3 ms on the NVIDIA. After that, each step of the view table's march
reads it once more. The view table's pass alone, timed in the page (20
passes between two waits for the GPU, the median of 7, 3 rounds), went
from 0.37 to 0.43 ms on the Intel GPU and stayed at 0.05 ms on the NVIDIA.
With the clock held and the camera still, that pass is now skipped.

`npm run bench:frames`, 18 November 2026, 1920 × 1080 at DPR 1, main
before and this change after, interleaved, the median of three rounds,
load average 2–7:

| Scenario | Intel, before → after | NVIDIA, before → after |
| --- | ---: | ---: |
| Earth close-up, 20,000 km | 15.1 → 15.0 ms (−1 %) | 4.3 → 4.5 ms (+5 %) |
| Earth filling the view, 9,000 km | 18.4 → 18.4 ms (±0 %) | 4.2 → 4.0 ms (−5 %) |
| The same, the clock held | 18.6 → 18.2 ms (−2 %) | 4.4 → 4.2 ms (−5 %) |
| Craft in LEO at 1 d/s, 3,000 km | 20.5 → 21.6 ms (+5 %) | 9.6 → 10.5 ms (+9 %) |

The differences are within the rounds' spread: the NVIDIA's Earth
close-up ran 2.6–4.6 ms before and 4.0–7.1 after, and its LEO rounds
7.7–11.1 before and 9.4–12.1 after, a frame that is mostly the kernel's
work on the CPU. The Intel's LEO rounds ran 20.3–20.6 ms before and
20.5–22.0 after. `earth-held` is the scenario with the clock held.

### Earth satellites

Measured on 18 November 2026: main at the branch point (39fd9ca) and
feat/satellites, production builds, interleaved, headless as above at
1920 × 1080 and DPR 1. The view is the Earth from 51,000 km, at real time
unless marked, with the layer switched off and on in the same page. Median
frame, ms:

| Scene | Intel | RTX |
| --- | ---: | ---: |
| Earth, main | 14.7–16.0 | 6.9–7.0 |
| Earth, satellites off | 15.0–15.9 | 6.4–6.6 |
| Earth, all 16,892 on | 18.1–19.5 | 6.6–6.7 |
| the same at an hour a second | 19.4–19.5 | 7.1 |
| the same at a day a second (main: Intel 15.9–16.0, RTX 8.2) | 20.0–20.5 | 7.5 |
| following the ISS | 15.1 (a second run, 24.6, shared the GPU with another session's browser) | 6.8 |

The first timing had the layer at 4–6 ms on the Intel GPU at real time and
10 ms at a day a second. Switching parts off in turn found three costs:

- **The markers, about 4 ms.** 85 markers moved every frame, though their
  script took 0.5 ms. Now a constellation member's marker shows only
  within 20,000 km of the camera, or when it is focused.
- **The orbits, about 3.6 ms.** 85 lines, mostly in draw calls. Now the
  constellations' 82 are one line set, drawn at once.
- **The points, about 2 ms**, as they are.

At high rates the worker's results also went to the GPU every frame (0.7 MB
each). They are now sent at most ten times a second.

**The debris, rocket bodies and analyst objects** (#147) add 5,446 points
in three more draw calls, and 0.2 MB a refresh. Measured on 18 November
2026 with `npm run bench:frames` (scenarios `sats`, `sats-hour`, `sats-all`
and `sats-all-hour`): the Earth from 20,000 km on 10 November 2026, main
before #147 (40e236b) against its branch (82937fc), production builds,
1920 × 1080 at DPR 1, three rounds. On the Intel GPU each sample had a
browser of its own, one page load; on the RTX, one browser a run. Median
frame, ms (the Intel range over the rounds in brackets):

| Scene | Intel | RTX |
| --- | ---: | ---: |
| the active satellites, main | 20.1 (19.4–23.6) | 3.9 |
| the active satellites, the branch | 20.7 (19.2–24.6) | 3.2 |
| every set on | 20.6 (20.3–21.7) | 3.5 |
| the active satellites at an hour a second, main | 21.7 (20.9–25.7) | 7.2 |
| the same, the branch | 22.8 (19.7–23.1) | 7.7 |
| every set on at an hour a second | 21.2 (21.0–21.4) | 6.5 |

Every set on costs no more than the active satellites alone, within the
noise of the rounds (the spread between rounds is several times the
difference), so nothing scaled that needed fixing. The RTX held 60 frames a
second throughout; its frame cost there is mostly the CPU's.

The focused satellite's close-up orbit ([satellites.md](frontend/satellites.md#drawing):
65 SGP4 calls a frame within a tenth of its distance from the Earth)
costs nothing measurable. `npm run bench:frames -- sats sat-near earth`
on 18 November 2026, main (e271722) against the branch, 4 rounds
interleaved, load average 2–6, median frame, ms:

| Scenario | Intel | RTX |
| --- | ---: | ---: |
| The Earth, all 16,892 on, 20,000 km | 26.4 → 26.0 | 4.7 → 5.5 |
| The ISS followed, 0.1 km | 30.3 → 30.4 | 5.3 → 4.9 |
| Earth close-up (satellites off), 20,000 km | 22.0 → 21.7 | 4.9 → 6.2 |

The RTX's rounds swing from 3.9 to 7.4 ms in both builds, its frame gap
stays at 16.7 ms throughout, and the Earth close-up does not run the new
code, so its differences are noise. In one page, with the close-up
stretch switched on and off every 4.5 s six times on the Intel GPU, the
frame was 31.6 ms on and 32.4 ms off, and `placeNear` took 0.1 ms.

### Satellite passes and the ground track

The passes run in a worker (about 50 ms for three days of the ISS, four
times a day of clock). The ground track is two lines and a point on the
Earth, resampled by SGP4 on the main thread (241 calls, about 2 ms) once
the clock has moved a two-hundredth of a period, at most every 50 ms
([satellites.md](frontend/satellites.md#passes-over-a-place)).
`npm run bench:frames -- --gpu intel,nvidia sat-track sat-track-warp earth`
on 18 November 2026, main (52a371f) against the branch, 3 rounds
interleaved, load average 11–15, median frame, ms:

| Scenario | Intel | RTX |
| --- | ---: | ---: |
| The ISS followed, its passes and ground track, 20,000 km | 30.3 → 22.2 | 7.8 → 6.7 |
| The same at an hour a second | 27.1 → 24.8 | 9.6 → 9.4 |
| Earth close-up (no satellites), 20,000 km | 26.8 → 22.8 | 7.4 → 7.5 |

Every difference is the machine's load: the Earth close-up runs none of
the new code and moved as much, and the Intel rounds swung 20–35 ms in
both builds. The RTX's frame gap stayed at 16.7 ms throughout. The ground
track costs nothing measurable.

### A long run

The report: the app lagged after layers were switched on, and did not
recover. #168 switched every layer on and off three times at the Earth
and found the frame back at 13 ms each time. `npm run bench:soak`
([measuring](#measuring)) runs for 25 minutes instead, doing the other
things a user does in between, on the Intel GPU (19 November 2026, main
at 311be9b, a production build, 1440 × 900).

**What stayed flat.** With every layer off, at the reference view, the
frame (14.6 → 15.0 ms), the GPU and page processes' memory (about
1.8 GB), three.js's 157 geometries, 23 textures and 33 programs, the
maps' video memory (455 MB once every body has been seen), DOM nodes
and the 8 workers were the same in the last cycles as in the first. The
workers' messages in flight did not build up, and the KTX2 transcoder's
three stayed three. Switching the layers on and off over and over,
without the rest of the cycle, did not slow the frame either (41–50 ms
with every layer on, over eight cycles).

**What climbed.** The frame with every layer on, cycle after cycle:

| Every layer on, Intel | Cycle 1 | 2 | 3 | 4 | 5 | 6 | 7 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| main, frame (ms) | 38.0 | 31.4 | 33.9 | 37.9 | 41.5 | 65.5 | 45.5 |
| main, SDP4's resonance steps (ms of each 3 s) | 0 | 404 | 521 | 702 | 924 | 1,452 | 1,336 |
| this change, frame (ms) | 35.2 | 28.5 | 24.9 | 28.0 | 28.4 | 25.9 | 28.6 |

(An earlier run on main, eight cycles: 30, 48, 42, 59, 45, 58, 76 and
116 ms.) A CPU profile of each cycle (`--profile`) put the growing time
in one function: satellite.js's `dspace`, called from `sgp4` from the
satellite layer's `label`, which places the 85 named satellites every
frame on the main thread. Each cycle's warp leaves the clock about three
years further from the element sets' epoch, and for a 12- or 24-hour
orbit (GPS, Molniya, the geostationary belt) satellite.js integrated the
resonance terms from the epoch at every call, in 720-minute steps
([satellites](frontend/satellites.md#moving-them-sgp4)). So any time the
clock had run far, the satellite layers cost more, and stayed so until
the clock came back. The first cycle is cheaper only because it comes
before the warp; its frame is heavier for loading each layer as it is
switched on.

`sgp4.js` now keeps the integrator's state between calls, as Vallado's
code does: the same states to the last bit, and no steps left to take
on the next frame. Every layer on, the frame stays at 25–29 ms from the
second cycle to the seventh, and the profiles no longer show `dspace`.
The same in one page each, every satellite set on, the Earth from
20,000 km, the clock started at a date and running at real time
(milliseconds of `dspace` in each 3 s profile in brackets):

| Clock | main | this change |
| --- | ---: | ---: |
| 19 November 2026 (the epochs' week) | 15.5 (1) | 14.5 (2) |
| three years on | 15.9 (612) | 16.1 (1) |
| fifteen years on | 37.4 (1,415) | 13.8 (5) |

Three years on, the Intel GPU's frame hides the 3.6 ms of script: it
waits for the GPU anyway. The script shows once it outgrows the GPU's
time, with more layers on or the clock further out. `npm run
bench:frames -- earth sats-all sats-later` (three rounds interleaved,
load average 2–6) agrees: 24.8 → 24.4 ms with every set on, 23.6 → 22.0
three years on.

`bench:soak` now fails a run whose every-layer-on frame climbs, from
the second cycle (the first loads the layers), as well as one whose
reference frame or memory does. Its listener count is taken after a full
collection: without one it swung between about 1,000 and 3,600 in both
builds with when V8 had last collected, and with one it holds at 970–984.

**In development only.** Each hot reload of `App.tsx` made a new
`Mission` (Fast Refresh runs `useMemo` again), whose kernel worker was
never stopped, and StrictMode's double render made a second one that
React threw away: 2 kernel workers at the start and 8 after three
reloads. Now `App.tsx`'s `useLifetime` starts a `Mission` once React has
kept it and disposes of it once nothing holds it, in a way StrictMode's
double effect does not trip, and the kernel client starts its worker
lazily. One kernel worker, before and after three reloads.

### GPU-compressed maps

Measured on 18 November 2026: the maps as WebP (`?webp`, which loads them
as main does) against the KTX2 copies ([textures](frontend/textures.md#gpu-compressed-maps)),
the same production build, both GPUs, interleaved, three rounds, medians.
`npm run bench:textures` (`scripts/bench-textures.mjs`) opens each scene
in a fresh browser with its cache off and waits until the full sky and the
scene's maps are on the GPU and nothing is queued. It reports:

- **the download:** every map file and the transcoder, fetched by the page
  or its workers (the WebP maps are fetched by the decode worker, which the
  page's own Resource Timing does not see);
- **the maps' video memory from their formats:** what the uploader and the
  sky's tile array allocated, level by level (`window.orrery.uploader`
  with `?debug`). three.js's `renderer.info.memory.textures` counts only
  the textures three makes itself (10 or 11 here either way), not these;
- **the GPU process's memory as the driver counts it:** from the NVIDIA
  driver's process table, or the i915 driver's `fdinfo` on the Intel GPU,
  canvas, render targets and buffers included;
- **the first and the full sky:** from navigation to the first frame with
  any sky, and to the full 8192-wide map.

At 1920 × 1080, DPR 1 (WebP → KTX2; MiB of video memory, MB of download).
The sky ships as WebP only ([textures](frontend/textures.md#gpu-compressed-maps)),
so the start differs only by the transcoder:

| Scene | GPU | Download | Maps' video memory | GPU process (driver) | First sky, ms | Full sky, ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Start (the Sun and the sky) | Intel | 16.4 → 17.0 | 171 → 171 | 471 → 479 | 1503 → 1467 | 3065 → 2870 |
| Start | NVIDIA | 16.4 → 17.0 | 171 → 171 | 445 → 443 | 1610 → 1719 | 2971 → 3092 |
| The Moon, 6,000 km (and the Earth) | Intel | 27.0 → 60.4 | 841 → 338 | 1241 → 688 | | |
| The Moon | NVIDIA | 27.0 → 60.4 | 841 → 338 | 1110 → 603 | | |
| Mars, 12,000 km | Intel | 25.2 → 54.7 | 426 → 234 | 770 → 556 | | |
| Mars | NVIDIA | 25.2 → 54.7 | 426 → 234 | 698 → 508 | | |

At DPR 2, where the sky's 16k tiles come in (24 in view at start), the
start is the same: 22.9 → 23.5 MB, 267 MiB of maps either way, and the
first and full sky within the noise (Intel 1154 → 1230 and 2730 → 2755
ms; NVIDIA 1677 → 1783 and 3069 → 3017 ms).

- **Video memory falls by the bodies' share**: their maps take a quarter
  (one byte a texel in BC7 against four in RGBA), the sky's 171 MiB stays.
  In the Moon's view the maps go from 841 to 338 MiB, and the GPU process
  gives back about the same, 550 MiB on the Intel GPU, whose video memory
  is the machine's own.
- **The download near a body about doubles**, since most of the large maps
  are UASTC (the Moon's 25 MB against 5.5; its normal map 12 MB against
  2.8). The Moon's 60 MB includes the Earth's maps and the sky.
- **Loading is no slower.** The transcoder is fetched as the page starts,
  so the sky's timings are unchanged. The bodies' maps go up in fewer
  frames (45 MB for an 8k map, not 128 plus its mipmapping).

**The sky as UASTC, measured and not shipped.** With the Milky Way and its
tiles in UASTC as well, the maps at start took 43 MiB instead of 171 (67
instead of 267 at DPR 2), but the start downloaded 36.0 MB instead of
16.4 (46.3 instead of 22.9), and the full sky came no sooner: 2.7–3.0 s
either way on both GPUs. Decoding a WebP of 8192 × 4096 and uploading 128
MB costs about what fetching 34 MB and transcoding it does. An earlier
version also had a KTX2 preview, which put the first sky about 0.3 s
later while the transcoder loaded; the preview stays a WebP.

**Frame time**, `npm run bench:frames` against main's build (WebP), median
ms, 1920 × 1080:

| Scene | Intel, DPR 1 | NVIDIA, DPR 1 | Intel, DPR 2 | NVIDIA, DPR 2 |
| --- | ---: | ---: | ---: | ---: |
| Overview (the Sun), 1.6 × 10⁹ km | 19.2 → 19.0 | 7.4 → 7.6 | 17.9 → 17.8 | 4.4 → 5.8 |
| Earth close-up, 20,000 km | 29.0 → 29.2 | 8.3 → 7.4 | | |
| The asteroid belt, 9 × 10⁸ km | 18.8 → 18.3 | 7.5 → 7.7 | | |

Three rounds, interleaved, under load averages of 9–13 at DPR 1 and 3–53
(once 104) at DPR 2. At DPR 2 the Earth and belt scenes could not be timed
in either build: the harness's zoom never settled within its tolerance, so
every sample was left out (since fixed, under [Measuring](#measuring)).
The NVIDIA overview at DPR 2 is a few frames' noise at 4–6 ms; at DPR 1
the two are level.

Sampling a compressed texture reads a quarter of the bytes, but none of
these scenes is limited by texture reads, so frame time is unchanged within
the run-to-run noise. These were timed with the sky in UASTC as well; it
now draws from the same WebP as main.

### Spacecraft beyond Earth orbit

Measured on 18 November 2026 on feat/deep-space-craft, a production
build, headless as above at 1920 × 1080 and DPR 1, the layer switched off
and on in the same page, interleaved. The machine was loaded (load
average 12), so the Intel figures swing by several ms. Median frame, ms:

| Scene | Intel | RTX |
| --- | ---: | ---: |
| Mars (four orbiters in view), off | 17.7 | 5.0–5.7 |
| Mars, on | 19.3 | 5.6–5.7 |
| the overview (the probes in cruise), off | 16.3–19.9 | 4.9–5.4 |
| the overview, on | 16.1–19.2 | 5.1–5.2 |
| Mars at a day a second, off | 31.4–32.6 | 10.1–10.6 |
| Mars at a day a second, on | 32.1–39.5 | 10.6–12.8 |

At real time the layer costs about 1.6 ms on the Intel GPU and nothing
measurable on the RTX. At a day a second a low orbiter's path fell due
every frame, so a path is now resampled at most every 250 ms of real
time. That leaves up to 2 ms on the RTX, where the app at that rate already
takes 10 ms.

### The Moon's landing sites

Measured on 18 November 2026 with `npm run bench:frames`: main (`52a371f`,
#130) against feat/moon-landing-sites, production builds,
interleaved, headless at 1920 × 1080 and DPR 1, the Moon from 20,000 km at
real time ([landing sites](frontend/landing-sites.md)). On main the layer
does not exist, so "layer on" there is the Moon alone. The machine was
loaded (load average 11 to 15). Median frame, ms, median over the rounds
(Intel: four rounds, each in a fresh browser; RTX: three):

| Scene | Intel UHD | RTX 5070 Ti |
| --- | ---: | ---: |
| Moon, layer off: main → branch | 18.8 → 20.1 | 8.0 → 8.1 |
| Moon, layer on: main → branch | 19.9 → 19.3 | 7.9 → 7.7 |
| Apollo 11's site framed, 140 km (branch) | 20.5 | 7.5 |
| the Moon from 20,000 km in the same run (branch) | 18.6 | 6.7 |

Within the noise: the same branch build timed faster with the layer on
than off, and main's own samples of one view ranged from 18.2 to 21.3 ms on
the Intel GPU. The markers are 38 positions a frame on the CPU and no GPU
work; the one new per-frame call, the Moon's axes, takes 3 µs. The low
view costs about 1 to 2 ms more than the distant one: that is the surface
patch and the near ground ([camera](frontend/camera.md)), not the layer.

### Eclipses, spin axes and field-line pulses

The shadow casters are picked each frame (`pickOccluders`): 0.08 ms for
all 86 bodies on the laptop's CPU. Most bodies now have no caster most of
the time, where each kept four before, so the surface shader's eclipse
loop does less. The spin axes are quads widened on screen
(`screenLines.ts`) instead of GL lines, and the magnetic field's pulses
are a few instructions a pixel of line, set by one uniform a frame. Frame
cost against main, `npm run bench:frames` (medians, ms):

| Scenario | Intel | NVIDIA |
| --- | ---: | ---: |
| Saturn and its rings, 500,000 km | 15.0 → 13.7 | 8.0 → 8.1 |
| Earth close-up, 20,000 km | 16.9 → 16.1 | 2.8 → 6.8 * |
| The Moon in the Earth's shadow, 2025-09-07 | 16.3 → 16.5 | 6.3 → 6.4 |
| Spin axes on (Earth), 40,000 km | 16.3 → 16.3 | 6.3 → 6.6 |
| Magnetic field on (Jupiter), pulses running | 15.3 → 16.2 | 6.1 → 6.0 |

18 November 2026, 1920 × 1080 at DPR 1. Intel's Saturn and Earth rows are
a second run of 5 rounds at load average 2–3; the rest 3 rounds at load
1–8, where the Intel rows moved by up to 2 ms between rounds either way
(a first Saturn run read 14.8 → 16.9, its rounds +2.4, −1.4, +3.3). The
NVIDIA Earth scene (*) swings between about 3 and 7 ms from load to load
in both builds: its rounds read 6.8, 2.8, 2.7 before and 7.0, 6.8, 2.9
after, so its median moved with which loads came out low, not with the
change. Within that noise, nothing here costs a frame.

### Every eclipse and shadow

The satellite points now work out the share of the Sun the Earth and the
Moon leave each one (two disc overlaps a vertex), Saturn's, Uranus's and
Neptune's rings take up to four moons' shadows a pixel, and the Earth's
air its Moon's shadow a pixel. Frame cost against main, `npm run
bench:frames`, 19 November 2026 (medians, ms):

| Scenario | Intel | NVIDIA |
| --- | ---: | ---: |
| Earth close-up, 20,000 km | 14.9 → 14.8 | 3.8 → 5.8 * |
| Saturn and its rings, 500,000 km | 14.3 → 14.4 | 6.4 → 7.1 * |
| Earth satellites, all on | 20.7 → 20.4 | 7.3 → 6.9 |
| The Moon in the Earth's shadow, 2025-09-07 | 14.4 → 14.1 | 6.5 → 6.8 |

1920 × 1080 at DPR 1, 3 rounds interleaved, load average 2–5. On Intel,
where a cost would show first, every round is within 0.6 ms of main's
either way. The NVIDIA rows marked * moved with the load from round to
round in both builds (Earth 3.7, 6.6, 3.8 before and 5.8, 7.3, 3.7 after;
Saturn 8.5, 5.9, 6.4 before and 8.4, 7.1, 5.7 after), not with the change.
The satellites' shade per vertex costs nothing measurable.

### The panels

The panels read the clock through `useSyncExternalStore`, which re-renders
a component whenever the store notifies (ten times a second). The header,
the rail and the data plate all re-rendered on every tick, and in a
development-mode profile of the overview React's JSX runtime took 672 ms of
every 4 s of main thread, in bursts that each cost a frame. Now the header
and the rail subscribe through `useClockValue`, which re-renders only when a
selected value changes: the clock's window once a second, the RUN/HOLD pair
when it changes, the rail when a distance's third decimal does. The same
profile now shows 111 ms (−83 %), and the main thread is busy 21 % of the
time instead of 58 %. The data plate still re-renders ten times a second,
since its numbers do change.

## Loading over the network

The frame rate holds (4 ms a frame on the NVIDIA GPU, 15–19 ms on the
Intel, flat over long runs); what was slow is the loading. Measured on 20
November 2026 with `npm run bench:load` ([measuring](#measuring)): main
at 14d4483 against this change, local production builds served as Pages
serves them, interleaved, two rounds, medians, 1920 × 1080 at DPR 1.

**The live site loads as the local build does.** Interleaved with the
local build of main over fast 4G on the Intel GPU (two rounds each), the
live site's first frame came at 5.7–6.3 s (local 5.5–6.0), the first sky
at 10.4–10.8 s (11.4–12.3), the Earth's day map at 14.6–15.9 s
(16.2–17.5), Mars's maps 66–74 s after the flight started (76–82), and the
same bytes: 39.6 MB at start, 138.4 MB for the Earth and Mars.

**Where the time went (main).** On fast 4G, the network: of each map's
time from asking to on screen, transcoding took 0.1–2.1 s and uploading
0.1–0.6 s, the rest was the download (Mars's day map: 56 s of bytes, 2.1
s of transcoding, 0.3 s of upload on the Intel GPU; 0.8 and 0.2 s on the
NVIDIA). Everything shared the link at once:

- The first frame waited for the DE442 tables (2.5 MB, gzipped) before
  the app's code (0.9 MB) was even asked for (`main.tsx`).
- The sky's 0.6 MB preview came down beside the full sky (15 MB) and
  the faint belt (17 MB): about 6 s after the first frame.
- From a link to the Earth, its 1.3 MB day map shared the link with its
  relief map (4.9 MB), the belt, the full sky and the day's clouds from
  NASA GIBS (17 MB).
- A flight from the Earth to Mars loaded the Moon's maps on the way out
  (37 MB, the Moon's disc passed three pixels), and Mars's day map (29.5
  MB) waited for its relief map, so it was in 73–74 s after the flight
  started, against a 3 s flight.

**What changed** ([textures](frontend/textures.md#over-the-network)): a
2048-wide preview of each large KTX2 map from the first bytes of its file
(byte ranges, no new files), one queue that sends previews first and the
full maps one at a time (the focused body's first, day map before relief,
the clouds after the Earth's own maps), all of a body's maps asked for at
once, nothing loaded for a body only passed in a flight, the app's code
fetched alongside the tables, and the decode worker started with the
scene.

**Start (the Sun and the sky)**, s from navigation (main → this change):

| | fast 4G, Intel | fast 4G, NVIDIA | cable, Intel | cable, NVIDIA |
| --- | ---: | ---: | ---: | ---: |
| First frame | 5.7 → 5.4 | 5.7 → 5.4 | 1.3 → 1.1 | 1.5 → 1.4 |
| First sky (the preview) | 11.8 → 9.0 | 11.6 → 9.0 | 2.5 → 2.0 | 2.7 → 2.0 |
| Full sky | 36.8 → 26.4 | 33.0 → 25.9 | 6.4 → 5.2 | 6.9 → 5.4 |
| Nothing left to load | 42.1 → 41.9 | 42.1 → 42.0 | 6.5 → 6.0 | 6.9 → 6.2 |
| Downloaded | 39.6 MB | 39.6 MB | 39.6 MB | 39.6 MB |

**A link to the Earth, then a flight to Mars** (the Mars rows from the
flight's start):

| | fast 4G, Intel | fast 4G, NVIDIA | cable, Intel | cable, NVIDIA |
| --- | ---: | ---: | ---: | ---: |
| First frame | 5.7 → 5.1 | 5.7 → 5.4 | 1.2 → 1.1 | 1.6 → 1.4 |
| Earth's day map shown | 14.2 → 10.0 | 15.3 → 10.2 | 3.2 → 2.0 | 3.6 → 2.4 |
| Earth's day map, full size | 14.2 → 11.6 | 15.3 → 11.7 | 3.2 → 2.3 | 3.6 → 2.6 |
| All the Earth's maps, full size | 25.2 → 17.9 | 24.2 → 17.6 | 3.7 → 3.5 | 3.8 → 3.8 |
| Nothing left to load | 67.9 → 78.1 | 67.9 → 78.7 | 11.0 → 15.9 | 12.0 → 16.5 |
| Mars's day map shown | 74.4 → 3.2 | 72.9 → 3.3 | 9.9 → 0.5 | 10.1 → 0.5 |
| Mars's day map, full size | 74.4 → 31.8 | 72.9 → 35.3 | 9.9 → 5.0 | 10.1 → 4.9 |
| Mars's day and relief maps, full size | 74.4 → 39.0 | 72.9 → 42.7 | 9.9 → 5.5 | 10.1 → 5.5 |
| Downloaded | 138.4 → 101.8 MB | 138.4 → 101.8 MB | 138.4 → 101.8 MB | 138.4 → 101.8 MB |

- **What is looked at comes first.** The Earth's day map shows 4–5 s
  sooner on fast 4G and 1.2 s sooner on cable; Mars's shows 3.2 s after
  the flight starts instead of 73 s (0.5 s instead of 10 on cable), and
  is at full size in half the time. The previews are 2048 × 1024, a
  quarter of an 8k map's width.
- **The start downloads the same 39.6 MB**, in a better order: the full
  sky is up 7–10 s sooner on fast 4G, the faint belt last.
- **The Earth and Mars download 37 MB less**: the Moon's maps are no
  longer fetched on the way out.
- **The clouds come last.** The day's cloud mosaic now waits for the
  Earth's own maps and the queue, so the last byte of a visit to the
  Earth comes 5–11 s later than before; on fast 4G one round's clouds
  came part-way (NASA's server, not shaped by this harness, varies).
- **The first frame is the tables' now.** The app's code arrives in 1.3 s
  beside the tables; the first frame (5.1–5.4 s on fast 4G) waits for the
  2.5 MB of tables ([planned](#planned-in-order-of-payoff)).
- **Prefetching the next body's maps: not done.** Mars's preview shows
  3.2 s after a 3 s flight starts on fast 4G, and 0.5 s on cable, so
  fetching it ahead could save at most a fraction of a second on the
  slower link, for megabytes a visit that a metered link pays for.

**Frame time** (`npm run bench:frames`, main → this change, three rounds,
load average 2–9): within the run-to-run noise on both GPUs (Intel −1 to
+5 %; NVIDIA −22 to +11 %, and the belt's +11 % was 3.5 → 3.4 ms in five
rounds):

| Scenario | Intel frame | NVIDIA frame |
| --- | ---: | ---: |
| Earth close-up, 20,000 km | 15.7 → 16.0 | 3.6 → 3.7 |
| The asteroid belt, 9 × 10⁸ km | 14.5 → 14.9 | 4.4 → 4.9 (five rounds: 3.5 → 3.4) |
| Craft in LEO (6-DOF), 0.4 km | 16.6 → 16.5 | 6.1 → 6.3 |
| Craft in LEO (6-DOF), 3,000 km | 16.6 → 17.4 | 6.2 → 6.2 |
| Craft in LEO (point), 0.4 km | 15.6 → 16.0 | 5.1 → 4.0 |
| Craft in LEO (point), 3,000 km | 16.0 → 16.2 | 3.9 → 4.0 |

### A second visit, and what a CDN would change

GitHub Pages answers every file with `Cache-Control: max-age=600` and an
ETag made of the file's modification time and size, and every file's
modification time is the deploy's (headers read on 19 November 2026: the
maps, unchanged for days, carried the 14:16 deploy's time, the third
deploy in 20 minutes that afternoon). Pages offers no way to set response
headers. So a visitor back within ten minutes loads from the browser's
cache, but after that every file is asked for again, and after any
deploy every ETag has changed and every file downloads again: the
39.6 MB of the start, 102 MB for the Earth and Mars, whether or not the
data changed.

Serving the data sets from Cloudflare R2 behind a custom domain on
Cloudflare's CDN (ADR-0001) would change that:

- **Each object carries its own `Cache-Control`** [2], so the data, under
  paths that name their set's version (they are already versioned, and
  `public/manifest.json` pins them), can be `public, max-age=31536000,
  immutable`: a returning visitor downloads none of it until a new
  version is pinned, and a deploy that leaves a set alone leaves its
  files cached. Measured here as the difference between a first visit
  and none: up to 39.6 MB and 42 s at start on fast 4G.
- **No egress fees** [3]: the per-visit bytes above cost nothing to serve.
- **Caveats.** Cloudflare's CDN caches an R2 bucket only on a custom
  domain, not on `r2.dev`, and by default only some file types: `.ktx2`
  and `.bin` need a cache rule [4]. The previews need byte ranges; R2's
  own API reads ranges [2], but ranges through the custom domain should
  be checked before the move (the app falls back to whole files if they
  are not honoured).

Until then the app could keep the data files in the browser's Cache
Storage itself, keyed by each file's SHA-256 in `public/manifest.json`,
which gives the same second visit on Pages.

## Planned, in order of payoff

1. **Encke's method near a primary: done** ([n-body kernel](physics/nbody-kernel.md#enckes-method)).
   30 times fewer steps in low orbit, 11 times more accurate.
2. **Cheaper Encke steps: done.** Each body's ephemeris keeps its current
   interval (no map lookup per call), and integrators switch by the size of
   the tides, not their momentary value: about 4.5 µs per step, low Earth
   orbit 13 times faster than Cowell in steady running, GEO no slower.
   Since 18 November 2026 the other bodies are placed once a step, at its
   far end, and at the stages by the cubic between its ends
   ([kernel](physics/nbody-kernel.md#enckes-method)): six cubics a body
   became two. `primaryOf` keeps each body's $(\mu/\mu_\text{primary})^{0.4}$
   per list instead of a `Math.pow` per body per step (a fifth of a Cowell
   step), and the closures the hot loops allocated each step are gone.
3. **Error-controlled integration: done** (18 November 2026). Cowell's
   integrator is Dormand-Prince 5(4) with its error held to $10^{-6}$ km plus
   $10^{-11}$ of the distance from the primary a step
   ([kernel](physics/nbody-kernel.md#integrators)): one to three orders of
   magnitude more accurate than the fixed fraction of the dynamical time, in
   fewer steps. DOP853 or a Runge-Kutta-Nyström 12(10) pair could follow
   where a tighter tolerance is wanted.
4. **DE442 in the browser.** Evaluate the Chebyshev segments directly:
   exact positions, and a few microseconds per body instead of an
   analytic series, which speeds up cruise steps.
5. **GPU-compressed textures (KTX2 / Basis): done** (18 November 2026,
   [above](#gpu-compressed-maps)). The bodies' maps take a quarter of the
   video memory, for downloads about twice as large near a body; the sky
   stays WebP, so the start downloads what it did.
6. **WebAssembly for the kernel** only if, after these, profiling still
   puts the time in the integrator's arithmetic.
7. **Loading: the first frame.** It now waits only for the DE442 tables
   (2.5 MB gzipped, 2000–2050), 5.1–5.4 s on fast 4G
   ([loading](#loading-over-the-network)). Split by decade, the first
   frame would need the current decade's part.
8. **Loading: a second visit.** The data cached for good, by R2 behind a
   CDN or by the app in Cache Storage ([above](#a-second-visit-and-what-a-cdn-would-change)).
9. **Loading: the full maps' size.** Most large maps are UASTC, 3–4 times
   their WebP (Mars's day map: 29.5 MB against 7.8), for a quarter of the
   video memory ([GPU-compressed maps](#gpu-compressed-maps)). On fast 4G
   that is 30 s against 8 s for Mars's full map, after its preview. A
   slow link could take the WebP instead, if the video memory allows.

## References

[1] Chrome DevTools, "NetworkManager.ts" (the throttling presets, `Fast4GConditions`), devtools-frontend. [Online]. Available: https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/core/sdk/NetworkManager.ts

[2] Cloudflare, "Workers API reference," R2 documentation (`httpMetadata.cacheControl`; `range` in `R2GetOptions`). [Online]. Available: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/

[3] Cloudflare, "Pricing," R2 documentation. [Online]. Available: https://developers.cloudflare.com/r2/pricing/

[4] Cloudflare, "Public buckets," R2 documentation. [Online]. Available: https://developers.cloudflare.com/r2/buckets/public-buckets/

