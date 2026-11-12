# Performance

What each part costs, measured with `npm run bench` (`src/physics/bench.mjs`,
Node 20, November 2026), and what is planned to make the slow parts fast.

## Measured

| Work | Cost | Notes |
| --- | --- | --- |
| Ten body states (one frame) | 0.04 ms | every frame; Earth and the Moon from the DE442 table, the rest astronomy-engine |
| Ten body orientations (one frame) | 0.01 ms | every frame |
| One orbit line (361 samples) | 2.4–2.8 ms | resampled at most one line per frame |
| Kernel, low Earth orbit, Cowell | about 50 sim days per second | 9,776 steps per sim day |
| Kernel, low Earth orbit, with Encke | about 220 sim days per second | 1,134 steps per sim day with Earth's J2 (326 with point masses, about 600 sim days per second); 4x more accurate than Cowell |
| Kernel, GEO | about 850 sim days per second | Cowell (perturbed beyond Encke's range) |
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
