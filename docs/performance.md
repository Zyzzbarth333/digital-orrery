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
| Kernel, low Earth orbit, Cowell | about 50 sim days per second | 9,776 steps per sim day |
| Kernel, low Earth orbit, with Encke | about 220 sim days per second | 1,134 steps per sim day with Earth's J2 (326 with point masses, about 600 sim days per second); 4x more accurate than Cowell |
| Kernel, GEO | about 850 sim days per second | Cowell (perturbed beyond Encke's range) |
| Kernel, among Jupiter's moons (1.5 million km orbit) | about 450 sim days per second | Cowell, 61 steps per sim day; 3,400 with the system folded at its barycentre. Each step about 3 times dearer (13 bodies, each moon a sum of two cubics), and the Galilean moons' nodes add 1.2 ms per sim day ([kernel](physics/nbody-kernel.md#moons)) |
| Splitting systems near the craft (`focus`) | within the ±5 % noise away from them | the same steps as before; the check is skipped until the craft could reach a threshold |
| Ephemeris for the kernel | under 1.6 ms per sim day | the Moon at hourly nodes, now from the DE442 table |

Kernel speeds are steady forward running, as in the app: 90 days in 10-day
chunks, the median of the last five (after V8 has compiled the hot code),
in CPU time. Earlier single short runs mostly measured compilation.
| Kernel, cruise | about 200 µs per step | each day-long step needs new ephemeris samples |

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
3. **Error-controlled integration.** An embedded high-order pair
   (Runge-Kutta-Nyström 12(10) or DOP853) with a tolerance, replacing the
   fixed fraction of the dynamical time: fewer steps where the motion is
   smooth, and a stated error.
4. **DE442 in the browser.** Evaluate the Chebyshev segments directly:
   exact positions, and a few microseconds per body instead of an
   analytic series, which speeds up cruise steps.
5. **GPU-compressed textures (KTX2 / Basis).** Four to eight times less
   video memory than WebP decoded to RGBA, and faster uploads.
6. **WebAssembly for the kernel** only if, after these, profiling still
   puts the time in the integrator's arithmetic.
