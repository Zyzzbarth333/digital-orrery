# Performance

What each part costs, measured with `npm run bench` (`src/physics/bench.mjs`,
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
  video memory uncompressed. Maps now load only when a body's disc is more
  than three pixels across, so the overview loads only the star map; a view
  of one planet loads that planet's maps.

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

**Not done.** A smaller belt file (23 MB at 16 bytes a body; 12 would do)
and KTX2 textures, which need a transcoder dependency and the user's
approval.

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

What remains is mostly the GPU, which half the frame waits on near the
Earth (the atmosphere fills the view).

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
5. **GPU-compressed textures (KTX2 / Basis).** Four to eight times less
   video memory than WebP decoded to RGBA, and faster uploads.
6. **WebAssembly for the kernel** only if, after these, profiling still
   puts the time in the integrator's arithmetic.
