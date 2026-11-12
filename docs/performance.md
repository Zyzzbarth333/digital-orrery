# Performance

What each part costs, measured with `npm run bench` (`src/physics/bench.mjs`,
Node 20, November 2026), and what is planned to make the slow parts fast.

## Measured

| Work | Cost | Notes |
| --- | --- | --- |
| Ten body states (one frame) | 0.06 ms | astronomy-engine, every frame |
| Ten body orientations (one frame) | 0.01 ms | every frame |
| One orbit line (361 samples) | 2.4–2.8 ms | resampled at most one line per frame |
| Kernel, low Earth orbit, Cowell | 37 sim days per second | 9,776 steps per sim day |
| Kernel, low Earth orbit, with Encke | 96 sim days per second | 326 steps per sim day, 11x more accurate |
| Kernel, GEO | about 650 sim days per second | Cowell (perturbed beyond Encke's range) |
| Kernel, cruise | about 200 µs per step | each day-long step needs new ephemeris samples |

A frame's ephemeris and orientation work is about 0.07 ms of a 16.7 ms
frame. The limits are elsewhere:

- **Kernel at high warp.** With Encke's method a craft in low Earth orbit
  runs at about 96 sim days per real second (Cowell alone: 37), so a warp
  of one year per second is still about 4 times faster than it can follow;
  it falls behind the clock and catches up, with a warning, rather than
  taking unsafe steps. Timings are wall-clock on a quiet machine;
  `npm run bench` measures CPU time, which other load skews less.
- **GPU memory.** An 8192×4096 texture with mipmaps takes about 180 MB of
  video memory uncompressed. Maps now load only when a body's disc is more
  than three pixels across, so the overview loads only the star map; a view
  of one planet loads that planet's maps.

## Planned, in order of payoff

1. **Encke's method near a primary: done** ([n-body kernel](physics/nbody-kernel.md#enckes-method)).
   30 times fewer steps in low orbit, 11 times more accurate, 2.6 times
   faster in wall time; each Encke step costs about 30 µs against Cowell's
   3 µs, mostly body positions and the conic at every stage.
2. **Cheaper Encke steps.** Evaluate the slowly moving bodies once per step
   rather than per stage, and cut allocation in the hot loop.
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
