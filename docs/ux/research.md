# Research: look, sky, speed, camera and missions

Research for the November 2026 overhaul ([plan](overhaul-plan.md)): what
space-simulation and planetarium software, data-dense panel design, camera
navigation, real-time sky rendering and WebGL performance work say about the
orrery's five open problems. Book findings are paraphrased with chapter and
page; web findings link their source. **Inference** marks design reasoning
that no source states.

Sources read: the four UX books named in [review](review.md) (Norman 2013;
Rogers, Sharp & Preece 6th ed. 2023, "RSP"; Hartson & Pyla 2nd ed. 2018,
"H&P"; Benyon 3rd ed. 2013), standards (WCAG 2.2, FAA AC 25-11B), vendor and
project documentation (three.js, CesiumJS, MapLibre, OpenSpace, Open MCT,
NASA SVS, ESA, HEASARC) and papers (van Wijk & Nuij 2003, Jimenez 2014,
Spencer et al. 1995, Ritschel et al. 2009). The usability.gov archive could
not be fetched, so nothing below rests on it.

## 1. A crisp console

- **Canvas pixels.** A canvas is sharp only when its backing store is its CSS
  size times `devicePixelRatio`; the ratio changes with browser zoom and the
  page is not told, so re-arm a `matchMedia('(resolution: …dppx)')` query
  after each change ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)).
- **Text.** `-webkit-font-smoothing` is macOS-only and makes light text on
  dark look thinner ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-font-smoothing)).
  **Inference:** place overlay labels on whole device pixels (fractional
  translations resample glyphs), keep text at whole CSS pixel sizes, and give
  amber-on-black text enough size rather than glow.
- **Structure beats density.** The same table took about 3.2 s to search
  with column gaps and one header row, against 5.5 s with labels repeated per
  row (RSP ch. 4, pp. 103–104). White space and Gestalt proximity group items
  (RSP pp. 110–111; Benyon ch. 12.4, pp. 270–273). Use colour sparingly,
  check it in greyscale, and keep red for urgency (H&P 32.10.7, pp. 818–822).
- **Standards.** WCAG 2.2 asks for 3:1 contrast on controls and their states,
  no meaning by hue alone, and 24×24 CSS px targets
  ([1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html),
  [2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)).
  Flight decks keep red for warnings and amber for cautions
  ([14 CFR 25.1322](https://www.faa.gov/sites/faa.gov/files/2022-11/25.1322.pdf)).
- **Edges of attention.** Status lines at a screen edge go unnoticed because
  attention sits where the work is (H&P 32.6.2.2, pp. 727–728): a header
  lamp that matters needs a second cue.

## 2. A believable sky and light

### Data

| Layer | Source | Size | Terms |
| --- | --- | --- | --- |
| Milky Way without the bright stars | NASA SVS Deep Star Maps 2020, `milkyway_2020_4k.exr` (half-float, ICRF plate carrée) | 36.4 MB (8k: 137 MB) | NASA; credit NASA/Goddard SVS and ESA/Gaia/DPAC ([SVS 4851](https://svs.gsfc.nasa.gov/4851/)) |
| Bright stars only | same, `hiptyc_2020_4k.exr` | 21.3 MB | as above |
| Point stars | Hipparcos via NASA HEASARC, `heasarc_hipparcos.tdat.gz`, 118,218 stars | 14.8 MB | ESA 1997 (SP-1200), free with acknowledgement; no redistribution licence found |
| Point stars, small | Yale Bright Star Catalogue 5, 9,110 stars to V 6.5 | 0.3 MB | public domain per the 1981 documentation |
| Avoid | HYG v4.4 | — | CC BY-SA 4.0: share-alike on any derived file in an MIT repo |
| Avoid | Gaia DR3 | — | licence page and summaries conflict (CC BY-NC 3.0 IGO?) |

Sizes are from HEAD requests on 14 November 2026. CDS (VizieR) refused
connections from this machine, so HEASARC and Harvard are the working
mirrors. The user approved the Hipparcos catalogue and the star-free Milky
Way the same day, and the app now uses both
([textures](../frontend/textures.md#stars)); the SVS page asks only for its
credit line.

### Drawing it

- **Why the current sky looks soft.** It is one 4096×2048 image (0.088° a
  texel). At a 45° field on a 1,746-pixel-high canvas each texel covers 3.4
  device pixels, so every star is a blurred blob.
- **Stars as points.** OpenSpace draws Gaia stars as PSF-filtered points or
  billboards with a colour lookup ([docs](https://docs.openspaceproject.com/releases-v0.20/generated/asset-components/RenderableGaiaStars.html)),
  and Gaia Sky gives bright stars a PSF halo ([blog](https://tonisagrista.com/blog/2021/gaiasky-point-cloud-rendering/)).
  Flux is 10^(−0.4 m); colour from B−V via Ballesteros's blackbody fit
  ([arXiv:1201.1809](https://arxiv.org/abs/1201.1809)). **Inference:** a
  Gaussian core of fixed size with intensity scaled to conserve each star's
  flux, so sub-pixel stars neither vanish nor shimmer.
- **Motion.** Stars do not twinkle in vacuum, and aberration and proper
  motion are far too small to see. **Inference:** honest motion comes from
  the observer: the eye's adaptation as bright things enter and leave the
  view, the Sun's granulation, and parallax from travel. Repeating motion is
  soon ignored and flashing annoys (Benyon ch. 21.3, pp. 474–480; H&P p. 818).

### Pipeline

- **HDR.** three.js's `EffectComposer` renders to half-float targets and
  `OutputPass` applies tone mapping, exposure and the sRGB encode at the end
  ([source](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/postprocessing/OutputPass.js)).
  Materials do not tone-map when drawing into a render target, so bloom sees
  linear light.
- **Bloom.** `UnrealBloomPass` thresholds and adds light, so it is not energy
  conserving. Jimenez's chain (13-tap downsample, 3×3 tent upsample, Karis
  average on the first level, no threshold, mixed in at a few percent) is
  ([Jimenez 2014](https://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare/);
  [LearnOpenGL](https://learnopengl.com/Guest-Articles/2022/Phys.-Based-Bloom)).
  pmndrs/postprocessing implements it but is a new dependency.
- **Tone mapping.** three.js ACES multiplies exposure by 1/0.6 and shifts
  hues; AgX (Filament, Blender) has a long shoulder; Khronos PBR Neutral keeps
  colours below about 0.76 nearly untouched (three.js's version subtracts up to 0.04 and squares the darkest values)
  ([three.js](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/tonemapping_pars_fragment.glsl.js);
  [Khronos](https://github.com/KhronosGroup/ToneMapping/blob/main/PBR_Neutral/README.md)).
- **Glare.** Spencer et al. split the eye's glare into bloom and flare (a
  lenticular halo and a ciliary corona of fine radial streaks)
  ([1995](https://w1.graphics.cornell.edu/pubs/1995/SSZG95.pdf)); Ritschel et
  al. animate it from the eye's anatomy
  ([2009](https://diglib.eg.org/handle/10.2312/CGF.v28i2pp183-192)). Hard
  four- or six-point spikes are a telescope artefact.
- **The Sun's disc.** Limb darkening at 550 nm is about
  0.3 + 0.93μ − 0.23μ² of the centre
  ([summary of Neckel & Labs](https://en.wikipedia.org/wiki/Limb_darkening));
  the photosphere's chromaticity is near xy (0.3233, 0.3326) (5,772 K)
  ([JILA](https://jila.colorado.edu/%7Eajsh/colour/Tspectrum.html)).
- **Exposure.** Frostbite and Unreal model a camera's EV100 and adapt over
  time. **Inference:** the app already meters for sunlight at the camera, so
  smooth that value rather than read pixels back.

## 3. Speed

- **Depth.** three.js's `logarithmicDepthBuffer` writes `gl_FragDepth`, which
  turns off early depth rejection; `reversedDepthBuffer` (needs
  `EXT_clip_control`) is documented as faster and more accurate
  ([WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)).
- **Textures.** Decoded RGBA costs w × h × 4 × 4/3 bytes with mipmaps: an
  8192×4096 map is about 179 MB of video memory. The main-thread cost is the
  upload, not the decode ([three.js #28101](https://github.com/mrdoob/three.js/issues/28101));
  `ImageBitmapLoader` decodes off the main thread in Chrome and
  `renderer.initTexture` lets the app choose when to upload
  ([Ludicon 2026](https://www.ludicon.com/castano/blog/2026/05/image-loading-on-the-web/)).
  KTX2/Basis cuts memory and upload four to eight times
  ([McCurdy](https://www.donmccurdy.com/2024/02/11/web-texture-formats/)).
- **Resolution.** With post-processing, `antialias` only affects the default
  framebuffer; MSAA moves to the render target's `samples`. An adaptive pixel
  ratio (drei's `PerformanceMonitor` pattern: rolling frame-rate windows with
  hysteresis) is the proven lever on weak GPUs
  ([drei](http://drei.docs.pmnd.rs/performances/performance-monitor)).
- **React.** `useSyncExternalStore` re-renders on every snapshot change;
  give it coarse snapshots, and write fast-changing readouts to the DOM
  directly ([React](https://react.dev/reference/react/useSyncExternalStore)).
- **Method.** SwiftShader is CPU-only, so its timings mean nothing for a GPU
  ([Chromium](https://chromium.googlesource.com/chromium/src.git/+/lkgr-ios-internal/docs/gpu/swiftshader.md)).
  Report frame-time percentiles, not mean fps, and name the GPU.

## 4. Camera transitions

- **The path.** van Wijk and Nuij's optimal zoom-and-pan path is closed-form
  in (pan u, view width w) space: zoom out, cross, zoom in, with one
  parameter ρ; its length S sets the duration, and recomputing the rest of
  the path from the current view each frame makes a flight retargetable.
  Their users preferred ρ ≈ 1.42 ([2003](https://vanwijk.win.tue.nl/zoompan.pdf)).
  d3 defaults ρ to √2; MapLibre uses 1.42 with a maximum duration
  ([d3](https://github.com/d3/d3-interpolate/blob/main/src/zoom.js),
  [MapLibre](https://github.com/maplibre/maplibre-gl-js/blob/main/src/ui/camera.ts)).
- **Practice.** CesiumJS caps default flights at about 3 s whatever the
  distance and cancels on a new flight
  ([source](https://github.com/CesiumGS/cesium/blob/main/packages/engine/Source/Scene/CameraFlightPath.js));
  OpenSpace sets arrival distance as a multiple of the target's bounding
  sphere and has an abort key
  ([docs](https://docs.openspaceproject.com/latest/using-openspace/navigation/camera-paths.html)).
- **Why animate.** Animated viewpoint changes help people keep their mental
  map without slowing tasks (Bederson & Boltman 1999,
  [UMD](https://drum.lib.umd.edu/handle/1903/984)); overview paths aid survey
  knowledge, but fast flights over hard paths raise load
  ([Treves & Skarlatidou 2018](https://eprints.soton.ac.uk/417462)). UI
  motion runs 100–500 ms ([NN/g](https://www.nngroup.com/articles/animation-duration/));
  spatial moves need longer.
- **Control.** Interfaces should be redirectable at any moment, with
  critically damped motion that does not overshoot
  ([WWDC18 803](https://developer.apple.com/videos/play/wwdc2018/803/)).
  Never take control from the user, and give a way out (H&P 32.6.4.6,
  pp. 775–777). Feedback must start at once (Norman ch. 1, pp. 23–24).
- **Reduced motion.** Scaling and panning large views can trigger
  vestibular symptoms; the reduced alternative is a cut or a short dissolve
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)).
- **Keeping zoom.** No shipped app documents it. **Inference:** zoom is the
  user's state; keep it as a multiple of the body's radius when they set it.

## 5. Missions at app level

- **Global versus local.** Global navigation stays the same everywhere;
  local navigation belongs to the section in view (Benyon ch. 14.4,
  pp. 328–329). Missions, the planner and the rocket are app-level tasks,
  yet they sit in a plate that a body click resets to that body.
- **Peers.** OpenSpace's toolbar holds Scene, Navigation and Time as peers
  ([docs](https://docs.openspaceproject.com/latest/)); Open MCT keeps an
  app-level object tree and a global Time Conductor
  ([API](https://github.com/nasa/openmct/blob/master/API.md)).
- **Modes.** Following a body and following a craft are modes; mode errors
  come from the same control meaning different things (Norman ch. 5,
  pp. 177–178; H&P pp. 766–767). Show the active mode with two redundant cues
  ([NN/g](https://www.nngroup.com/articles/modes/)).
- **Conceptual model.** Planets are ephemerides (scrubbable); craft are
  integrated. The interface has to show the difference (Norman ch. 1,
  pp. 28–31; RSP ch. 3, pp. 75–77).

## Checklist for the overhaul

Derived from Nielsen's heuristics as printed in RSP (ch. 16.2, pp. 584–586)
and the guidelines above; used in the [plan](overhaul-plan.md)'s checks.

1. Can I tell at a glance what the camera follows, the rate, and run or hold?
2. Is the focus type (body or craft) shown with two cues?
3. Can I stop or redirect a flight with a drag, a scroll or a key?
4. Is my zoom kept, or its change visible?
5. Are missions and craft reachable whatever is in focus?
6. Is each craft and mission called the same thing everywhere?
7. Do look-alike controls behave alike?
8. Would I notice a lamp change while looking at the sky?
9. Are readouts aligned in columns with units apart from values?
10. Is text sharp and large enough on a 1× and a 2× screen?
11. Does any motion repeat, flash or cover data?
12. Is it clear which objects are on rails and which are integrated?
