# Overhaul plan: look, sky, speed, camera and missions

The plan for the November 2026 overhaul, drawn from the
[research](research.md) and a measured baseline. Five points, in the user's
words where possible:

1. A higher-resolution GUI: sharper type, edges, icons, hi-DPI panels.
2. A realistic, slightly animated backdrop with real luminosity (stars, the
   Milky Way, the Sun's glow), and lighting to match: the Sun as the light,
   planet shading, glare and bloom done tastefully.
3. Faster rendering.
4. No instant jump on a planet click: a smooth, interruptible transition,
   scaled to distance, keeping the user's zoom where that makes sense.
5. Missions and craft out of the per-planet plate, reachable whatever is in
   focus.

## Baseline (before)

Measured on 14 November 2026 with the production build (`vite build`),
headless Chromium 1254 on the machine's **Intel UHD (Raptor Lake-S) iGPU**
through ANGLE's GL-EGL backend (real hardware, not SwiftShader), frames
paced at 60 Hz, 1920×1080 window. A frame that misses 16.7 ms shows as
30 fps. "Long tasks" are main-thread tasks over 50 ms in the 6 s measured.

| Scenario | Canvas | fps | p95 frame | Worst frame | Long tasks |
| --- | --- | --- | --- | --- | --- |
| Overview, DPR 1 | 1340×873 | 57.3 | 16.8 ms | 33 ms | none |
| Earth close-up, DPR 1 | 1340×873 | 28.3 | 50 ms | 67 ms | none |
| Saturn close-up, DPR 1 | 1340×873 | 56.0 | 33 ms | 34 ms | none |
| Artemis II in flight, DPR 1 | 1340×873 | 19.2 | 67 ms | 83 ms | none |
| Click Mars in the rail, DPR 1 | 1340×873 | 37.0 | 33 ms | 1,467 ms | 2 (2.0 s) |
| Click Earth, DPR 1 | 1340×873 | 21.6 | 50 ms | 1,383 ms | 2 (1.7 s) |
| Click Moon, DPR 1 | 1340×873 | 47.7 | 17 ms | 850 ms | 2 (1.3 s) |
| Overview, DPR 2 | 2680×1746 | 31.6 | 50 ms | 50 ms | none |
| Earth close-up, DPR 2 | 2680×1746 | 26.6 | 50 ms | 67 ms | none |
| Artemis II in flight, DPR 2 | 2680×1746 | 9.0 | 150 ms | 150 ms | none |
| Click Mars, DPR 2 | 2680×1746 | 12.9 | 50 ms | 2,250 ms | 2 (3.2 s) |

A CPU profile of the overview in development mode put 17 % of the main
thread in React's development JSX runtime: the header, rail and plate
re-render at 10 Hz, in bursts that cost a frame each.

What the numbers say:
- **Clicks stall.** Opening a body's maps (8k day and relief maps for Mars,
  Mercury and the Moon; 5400×2700 monthly maps and a 13500-pixel night map
  for Earth) decodes and uploads them on the main thread inside one frame.
- **Close-ups and DPR 2 miss frames** on an integrated GPU: per-pixel cost
  (eclipse tests, the atmosphere's ray march, the log-depth buffer) and fill
  rate, not draw calls (12 to 20 a frame).
- **React** re-renders far more than the visible numbers change.

## Plan by point

### 3. Speed (first, so the new effects have a budget)

- Decode maps off the main thread (`ImageBitmapLoader`) and upload them one
  per frame with `renderer.initTexture`, starting when a flight to the body
  begins, so the upload hides behind the camera move.
- Cap map sizes to what a screen can show at the closest zoom, and keep only
  the current month's Earth map resident.
- An adaptive pixel ratio: step the render scale down when frames run long
  and back up when they recover, never below 1 device pixel per CSS pixel
  on a 2× screen without need.
- Find the per-pixel cost of the Earth view and the craft view and cut it
  (profile by switching features off one at a time).
- React: header clock and lamps update imperatively or from coarse
  snapshots; the rail re-renders only when a shown digit changes.
- Measure after each step with the same suite; report percentiles.

### 2. Sky and light

- An HDR pipeline: the scene renders linear light into a half-float target;
  one final pass tone-maps (try AgX against ACES and Neutral by screenshot),
  applies exposure and encodes sRGB.
- Physically based bloom (Jimenez's chain, written here in a few hundred
  lines rather than adding a dependency): no threshold, energy conserving,
  so the Sun's true brightness makes its own halo and a planet covering it
  takes the glare away.
- The Sun's disc with limb darkening and its true colour; a faint ciliary
  corona of fine streaks scaled by how much of the disc is visible; slow,
  low-contrast granulation that fades out at high warp. The fake sprite
  glow goes.
- Stars as points from a catalogue (Hipparcos, or the Bright Star Catalogue
  if the larger download is declined) with flux from magnitude and colour
  from B−V, over the SVS star-free Milky Way. **Both downloads need the
  user's approval** (sizes and terms in the research).
- Honest motion: the eye adapts as bright bodies and the Sun enter or leave
  the view, so faint stars fade in a dark view and wash out beside a lit
  limb; exposure changes are smoothed over about a second.
- Exposure and planet shading stay physical
  ([lighting](../frontend/lighting.md)); airless bodies gain the opposition
  surge if it fits the budget.

### 4. Camera

- A camera rig with a van Wijk–Nuij flight between the old and new focus:
  live positions of both bodies each frame (they move during a flight),
  log-distance zoom out and in, ρ = 1.42, duration from the path length,
  clamped to 0.8–3 s, eased on the path parameter.
- Redirectable: a second click starts a new path from where the camera is.
  Interruptible: a drag, a scroll or Escape ends the flight where it is,
  and the aim settles on the new body with a critically damped spring while
  the user has the controls.
- Zoom kept: the distance is remembered in body radii once the user has
  zoomed, and carried to the next body within sensible bounds; otherwise the
  default framing.
- Smooth wheel zoom (a short exponential approach) and inertia-free drag.
- Reduced motion: the flight is a cut.

### 5. Missions

- A flight console hosted by the header: a FLIGHT field shows the selected
  craft (name and state) and a CONSOLE key opens a panel with the
  MISSION, PLANNER and ROCKET tabs over the right of the sky. Its contents
  are the existing panels, unchanged.
- The right plate becomes the focused body's data only; a body click never
  closes the console.
- The header names the camera's mode with two cues: FOCUS (a body) or
  FOLLOW (a craft), with the name.
- `?mission=` and `?plan=` open the console on the right tab; `M` toggles
  it; Escape closes it.

### 1. A crisp console

- Overlay labels on whole device pixels; minimum engraved size 10 px;
  phosphor glow tightened so numerals stay sharp; hairline seams on 2×
  screens; crisp SVG glyphs drawn on the pixel grid for the keys that carry
  them.
- Checked at 1×, 1.25× and 2× and at 1440, 1100 and 390 px wide, and with
  the impeccable detector.

## Checks

- The benchmark suite again, same machine, same GPU, same scenarios.
- Screenshots at real sizes, light and dark OS settings.
- The checklist in the [research](research.md#checklist-for-the-overhaul).
- `npm test` and `npm run typecheck` still pass.
