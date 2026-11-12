# Performance

What each part costs, measured with `npm run bench` (`src/physics/bench.mjs`,
Node 20, November 2026), and what is planned to make the slow parts fast.

## Measured

| Work | Cost | Notes |
| --- | --- | --- |
| Ten body states (one frame) | 0.06 ms | astronomy-engine, every frame |
| Ten body orientations (one frame) | 0.01 ms | every frame |
| One orbit line (361 samples) | 2.4–2.8 ms | resampled at most one line per frame |
| Kernel, low Earth orbit | about 80,000 steps/s | 408 steps per hour of sim time |
| Kernel, cruise | about 200 µs per step | each day-long step needs new ephemeris samples |

A frame's ephemeris and orientation work is about 0.07 ms of a 16.7 ms
frame. The limits are elsewhere:

- **Kernel at high warp.** A craft in low Earth orbit needs about 3.6
  million steps per sim year. At a warp of one year per second that is 45
  times what the kernel does, so the craft falls behind the clock (it
  catches up, with a warning, rather than taking unsafe steps).
- **GPU memory.** An 8192×4096 texture with mipmaps takes about 180 MB of
  video memory uncompressed. Maps now load only when a body's disc is more
  than three pixels across, so the overview loads only the star map; a view
  of one planet loads that planet's maps.

## Planned, in order of payoff

1. **Encke's method near a primary.** Integrate only the small difference
   from a two-body orbit that is propagated analytically (`propagate`), so
   steps are set by the perturbations, not by the orbit itself: tens to
   hundreds of times fewer steps in low orbit at the same accuracy.
2. **Error-controlled integration.** An embedded high-order pair
   (Runge-Kutta-Nyström 12(10) or DOP853) with a tolerance, replacing the
   fixed fraction of the dynamical time: fewer steps where the motion is
   smooth, and a stated error.
3. **DE442 in the browser.** Evaluate the Chebyshev segments directly:
   exact positions, and a few microseconds per body instead of an
   analytic series, which speeds up cruise steps.
4. **GPU-compressed textures (KTX2 / Basis).** Four to eight times less
   video memory than WebP decoded to RGBA, and faster uploads.
5. **WebAssembly for the kernel** only if, after 1 to 3, profiling still
   puts the time in the integrator's arithmetic.
