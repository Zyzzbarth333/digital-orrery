# ADR-0002: A streamed, true-scale Earth near the ground, and an assembly bay for rockets

**Status:** Proposed (19 Nov 2026)
**Date:** 19 Nov 2026
**Deciders:** Isaac Ziebarth
**Builds on:** [ADR-0001](0001-data-physics-and-boundaries.md): the data outside git, behind a manifest; the physics in `packages/physics`, behind the golden snapshot; the long-term data host on Cloudflare R2 behind a domain of Isaac's own.
**Checked:** each source's licence and terms were read on the vendor's or producer's own page on 19 Nov 2026, apart from those marked "not opened" in the references.

This is a decision document only. It adds no feature code. It covers two things:
1. **High-resolution elevation and imagery on the planets, the Earth first.**
2. **A rocket builder on the ground: an assembly bay for building a rocket part by part.**

The two meet at the launch pad. A rocket built on the ground is rolled out to a pad, and a pad seen from 2 m up needs the ground under it.

---

## Part 1: High-resolution, streamed terrain

### Context

**What the Earth has today** ([textures](../frontend/textures.md)):
- one 5400 × 2700 day map for each month;
- 8192 × 4096 night lights;
- an 8192 × 4096 relief map, from ETOPO 2022 at 15″, turned into a normal map at true scale;
- the GIBS daily true-colour mosaic for the sim date, at 4096 × 2048.

The Moon and Mars have LOLA and MOLA elevation at 16 px a degree. Relief is shading only: the sphere stays smooth, and the normal map tilts the light.

**How fine that is.**
- At the equator, an 8192-wide map is 40,075 km / 8192 = **4.9 km a texel**.
- The field of view is 45° vertically, so one pixel covers d · 2 tan 22.5° / H at distance d, on a canvas H device pixels tall.
- That footprint equals one texel at about **9,400 km on a phone** (H = 1584: 390 × 844 at DPR 2, [performance](../performance.md#a-phones-view)) and **6,400 km on a 1080-line laptop**.
- Below those heights the map is magnified and goes soft. A craft on the pad at Kennedy is seen from metres up, against kilometre-wide texels.

**What already works near the ground** ([camera](../frontend/camera.md#close-to-the-ground)):
- A camera inside the ellipsoid is clamped to 5 m above the WGS-84 surface (`surfaceClamp.js`).
- Within half a radius of the surface, a finely divided polar patch (`surfacePatch.ts`) replaces the 96 × 48 sphere, keeping a chord's sag under 0.4 % of the camera's height.
- Every position is kept in 64-bit numbers, in km, about a floating origin at the camera ([scene](../frontend/scene.md#floating-origin)).

**The precision budget near the ground.** Two limits matter.
- **Vertices.** A float32 has 24 bits of mantissa. Measured from the Earth's centre in metres (6.4 × 10⁶ m) its step is 0.5 m, so terrain vertices can't be stored relative to the body. Relative to a tile's own centre, a 5 km tile resolves under a millimetre. This is the "relative to centre" method that virtual-globe engines use [1, Ch. 5].
- **Depth.** The scene's logarithmic depth is log₂(1 + w) / log₂(far + 1), with w in render units of 1000 km and far = 10¹⁰ units. For w ≪ 1 that is almost linear. Its step, 2⁻²⁴ ln 2 log₂(far + 1) units, is **about 1.4 m anywhere within a few hundred kilometres** ([camera](../frontend/camera.md#close-to-a-craft)).
  - A pad, a vehicle's base and the ground under them are closer together than that, so they would z-fight.
  - With w in metres the same formula gives about 8 µm at 2 m and about 3 mm at 1 km: the precision is there, but in the wrong unit.
  - three.js 0.187 (the version installed) also offers a reversed depth buffer, `reversedDepthBuffer`, which needs the `EXT_clip_control` extension [2].

**The audiences** ([PRODUCT.md](../../PRODUCT.md)). The engineer wants real heights with stated sources and datums. The portfolio visitor is often on a phone. On the phone layout today, an Earth close-up already costs a whole 60 Hz frame on the Intel iGPU (16.9 ms; [performance](../performance.md#a-phones-view)).

### Options: where the elevation comes from

| Source | Grid | Heights | Terms for a public MIT site | Verdict |
|---|---|---|---|---|
| **Copernicus DEM GLO-30** | 1″ (30 m), worldwide on land; ocean has no tiles, taken as 0 [3] | A surface model: buildings and trees included [3]. EGM2008 (EPSG:3855) [4] | Free, worldwide and unlimited in time, including reproduction [5]. Public redistribution must carry the notice "© DLR e.V." (unmodified), or "Produced using Copernicus WorldDEM-30 © DLR e.V." (modified), and a no-liability disclaimer [5], [4]. Some countries' tiles aren't public at 30 m: Armenia and Azerbaijan [4], [3]. GLO-90 covers them | **Chosen** as the elevation source. Cloud-optimised GeoTIFFs in the open bucket `copernicus-dem-30m` [3] |
| **SRTM 1″ (SRTMGL1) and NASADEM** | 1″ (30 m), 60° N to 56° S [6], [7] | 2000 radar, converted to the geoid [6] | "Openly shared, without restriction" under EOSDIS guidance, with a citation [6], [7] | **Fallback.** Open and clean, but no polar coverage, and older than Copernicus |
| **AWS Terrain Tiles** (Mapzen, Tilezen joerd) [8] | Web Mercator PNG and GeoTIFF tiles [9]. Zoom 15 exists and zoom 16 doesn't (checked on the bucket, 19 Nov 2026) | Mixes SRTM, GMTED2010, ETOPO1, 3DEP and national models [10]. Its 1° `skadi` tiles are on EGM96 [9] | No key, and CORS open to any origin (`Access-Control-Allow-Origin: *`, checked 19 Nov 2026). Each source has its own attribution string [10] | **For the spike.** Nothing to host, but mixed sources and datums: not for the engineer's numbers |
| **ETOPO 2022** (already used) | 15″ (about 460 m at the equator) [11] | Land and sea floor, EGM2008 [11] | CC0-1.0. "Not to be used for navigation" [11] | **Kept** for the global relief and the sea floor |
| **Cesium World Terrain** (Cesium ion) | Streamed quantized-mesh [12] | n/a | The free Community plan is for "Personal and non-commercial use", with 15 GB of streaming a month [13]. Tokens sit in the page source and should be restricted to the site's URLs [14] | **Rejected** for the public site. A portfolio's use is arguably not "non-commercial", and 15 GB is a few hundred descents a month |

### Options: where the imagery comes from

| Source | Ground resolution | Terms | Verdict |
|---|---|---|---|
| **NASA GIBS** | Tile matrices down to 15.625 m in EPSG:4326 [15]. The app already uses the daily true-colour layers | Open; NASA asks for an acknowledgement of GIBS [15]. CORS `*`, and tiles cached for 3 days (checked 19 Nov 2026) | **Chosen** for the global layer and the daily Earth, streamed straight from GIBS |
| **Blue Marble Next Generation** | 500 m, one composite for each month of 2004 [16] | Credit "NASA Earth Observatory" [16] | **Kept** as the monthly base map (already shipped) |
| **EOX Sentinel-2 cloudless** | Sentinel-2's 10 m bands (EOX's own figure not read) | The 2016 layer is CC BY 4.0. The 2018–2025 layers are CC BY-NC-SA 4.0 [17]. Its WMTS may be used directly under the licence [17] | **2016 layer only**, for the pad regions. The later years' non-commercial and share-alike terms don't fit a portfolio site or an MIT repository |
| **Google Photorealistic 3D Tiles** (Map Tiles API) | Photogrammetric meshes of cities | A billing account and an API key on every request [18]. At most 10,000 root-tileset requests a day per project [18]. "Don't pre-fetch, index, store, or cache Map Tiles content", and the Google logo must show [19] | **Rejected.** See below |

**Why not Google's 3D Tiles?** The terms don't forbid a public site, but they don't fit one:
- **The key.** It has to be in a public repository's page. Even restricted by referrer, any visitor's use is billed to Isaac's account.
- **Caching.** It can't be cached or re-hosted on R2 [19]. That breaks ADR-0001's model: pinned, hashed data on our own host.
- **Mixing.** Combined views must show which parts are Google's [19]. That's workable, but it's a second set of rules beside the orrery's provenance tags.

Google's meshes are a city view, not an engineering surface: they have no datum or height source to show beside a number.

### Options: the renderer

1. **3DTilesRendererJS** (NASA-AMMOS) [20].
   - Apache-2.0, at v0.5.4 (3 Nov 2026).
   - It renders OGC 3D Tiles [21], and through plugins it renders quantized-mesh terrain, XYZ, TMS and WMTS imagery. It can also render Cesium ion and Google tiles, which need their keys.
   - Its LRU cache has hard caps in tiles and bytes: when it's full, coarser tiles stay and no new ones load [20]. That is the control a phone needs.
   - It is three.js, so the tiles join the existing scene, lights and depth.
2. **Our own quadtree**, grown from `surfacePatch.ts`: chunked or CDLOD tiles built from the same ellipsoid and material. Full control, and no dependency, but we would write the loading, the LRU cache, the cracks between tiles and the level-of-detail rule ourselves.
3. **CesiumJS** beside or instead of three.js. **Rejected:** a second engine with its own camera, time and frames, and it can't share the orrery's floating origin, lighting or kernel.

### Options: where the tiles live

| Option | Cost | Verdict |
|---|---|---|
| **Stream from the producers** (GIBS, AWS Terrain Tiles) | Nothing to host; both send CORS `*` | **Spike and global layer.** We don't control their uptime or their content |
| **R2 behind Isaac's domain** (ADR-0001's long-term host) | Storage over 10 GB at US$0.015 a GB-month. Writes US$4.50 a million (Class A), reads US$0.36 a million (Class B), 10 million reads a month free, and no egress charge [22] | **Chosen for our own tiles**: hashed, pinned, cached for ever, credited |
| **GitHub Pages** | The 1 GB site limit (ADR-0001) | **Rejected** for tiles |

**Rough sizes, to be measured in phase 1** (estimates, not measurements):
- **A global GLO-30 pyramid** to zoom 12 (38 m tiles of 256 px, about the DEM's own 30 m) is about 5 million land tiles: a few hundred GB, and about US$25 in writes to upload one tile at a time.
- **A pad region** of 100 km × 100 km to zoom 15 is about 10,000 tiles with its pyramid: under 1 GB, with imagery.
- The five pads fit R2's 10 GB free tier.
- A descent from orbit to a pad reads about 800 tiles (imagery and terrain; see below), so the free 10 million reads a month cover about 12,000 descents.

### What a phone pays

Estimates for phase 0 to measure:
- **Visible tiles.** A 780 × 1584 canvas needs about 1.2 million texels at one a pixel. That is about 20 tiles of 256², or 40–80 with the coarser rings and overlap.
- **Video memory.** Uncompressed, a 256² RGBA tile with its mipmaps is about 350 KB, and a 65 × 65 terrain mesh about 100 KB. That makes 30–40 MB for the visible set. KTX2 tiles, as the body maps already use ([GPU-compressed maps](../frontend/textures.md#gpu-compressed-maps)), cut the imagery to about a quarter.
- **Download.** A descent from 9,000 km to the pad crosses about 12 zoom levels, each with 20–40 new tiles: tens of MB. That's a lot on mobile data, so streaming starts only below the height where the 8k map goes soft (above), and the LRU cache is capped by bytes [20].
- **Frame time.** The Earth close-up already fills a frame on the Intel iGPU. Tiles replace the polar patch rather than adding to it, and the gate below holds them to the frame cost of today.

### Decision (proposed)

1. **Stream terrain and imagery only near the surface**, below the height where the 8k maps are magnified (about 9,400 km on a phone and 6,400 km on a laptop). Above it, nothing changes.
2. **Renderer: 3DTilesRendererJS** [20], mounted in the Earth's body-fixed frame (the same rotation, `earthRotation.js` with the EOP, that turns the maps today). The tile meshes are relative to each tile's centre, and the scene's floating origin sets their matrices in 64-bit. Our own quadtree (option 2) is the fallback if the spike's gate fails.
3. **Elevation:**
   - **Copernicus GLO-30**, with GLO-90 where GLO-30 is withheld, as a surface model, and said so: at a pad its "ground" is the top of whatever stands there.
   - Heights are converted from EGM2008 to WGS-84 ellipsoidal heights offline, from NGA's full EGM2008 geoid grid. The degree-70 field in `egm2008.js` is a gravity model, too coarse for a geoid.
   - ETOPO 2022 stays for the sea floor and the global relief.
4. **Imagery:** GIBS, streamed straight from NASA, for the global and daily layers. For the pad regions, the 2016 Sentinel-2 cloudless layer (CC BY 4.0) re-tiled to KTX2.
5. **Our tiles go on R2 behind Isaac's domain**, pinned by the manifest with SHA-256 names as ADR-0001 set up. **Pads first:** the five pads in the ROCKET tab, then the whole globe only if the pilot earns it.
6. **No keyed services in the public site:** no Google 3D Tiles and no Cesium ion. A developer may try them locally with their own key, never committed.
7. **Fix the depth unit before any ground view ships**: the logarithmic depth with w in metres, or the reversed depth buffer where `EXT_clip_control` exists, chosen by the spike.
8. **Every tile set is credited** in the textures doc's credits table with its source, licence and exact notice, and the in-app readout names the source and datum of the height under the cursor, as the data plate does for every value.

### Phases and gates

**Phase 0: a spike, local only, nothing hosted**
1. [ ] 3DTilesRendererJS over Kennedy, with AWS Terrain Tiles for the heights and GIBS for the imagery, in the existing scene.
2. [ ] Depth: try w in metres in the logarithmic depth, and the reversed depth buffer.
3. [ ] **Gate:**
   - **Frame:** the tiles meet the body-fixed Earth and the ROCKET tab's pad within a pixel at 2 m up, with no jitter as the Earth turns under time warp.
   - **Depth:** a stack on the pad shows no z-fighting from 2 m to 1,000 km.
   - **Phone:** `npm run bench:frames -- --gpu intel --size 390x844 --dpr 2` is within 2 ms of today's Earth close-up, with the tile cache capped at a stated byte limit.
   - **Bundle:** the added script, gzipped, is stated, and loaded only when a body is approached.
   - **Golden snapshot** unchanged (`npm run golden -- --api`): no physics moves.
   - **Decision:** option 1 or option 2, written into this ADR.

**Phase 1: pad regions, our own tiles**
1. [ ] Prerequisites from ADR-0001: phase B's gate closed (a fresh clone runs, and the site loads on a phone), and the domain and R2 decision taken.
2. [ ] A pipeline in `pipelines/terrain/`: GLO-30 to ellipsoidal heights, to quantized-mesh [12] or 3D Tiles [21]; Sentinel-2 cloudless 2016 to KTX2; one manifest entry for each set.
3. [ ] Upload to R2, and fetch the tiles through the loaders' base URL.
4. [ ] **Gate:**
   - **Heights:** heights at sampled points match the GLO-30 rasters within the tiles' stated quantisation. The EGM2008 conversion is checked against NGA's own geoid values at a few points.
   - **Credits:** every notice and disclaimer [5], [15], [17] is in the credits table and the app.
   - **Cost:** a descent's bytes and tile count on a phone are measured and written to [performance](../performance.md).
   - **Size:** R2 storage under the free 10 GB.

**Phase 2: the whole globe.** Only when phase 1 shows the need. Global GLO-30 to zoom 12, priced from phase 1's measurements, with the R2 bill stated before upload.

**Phase 3: other bodies.** The Moon and Mars from LOLA, MOLA and higher-resolution digital terrain models, each source and its terms checked then. Not decided here.

### Risks

- **The surface model's "ground".** GLO-30 puts the pad's surface on top of its tower and the trees. The readout must say "surface model", and a pad's local terrain may need flattening to its published height, credited as ours.
- **Datum mix.** EGM96 (Terrain Tiles), EGM2008 (Copernicus, ETOPO) and WGS-84 (the scene) differ by metres. Every height is converted once, offline, to the ellipsoid.
- **The dependency.** 3DTilesRendererJS is below 1.0, and its interface may change. Pin it, and keep the tile code behind one module.
- **Phones.** Tens of MB a descent, and video memory: capped by the cache, and started only near the ground.
- **Producers' uptime.** GIBS or the AWS bucket may change. The global layer falls back to the shipped maps when tiles fail, as the daily Earth already does.
- **Licence drift.** EOX already changed its terms for later years [17]. Pin the year and keep the licence page's text in the credits.

---

## Part 2: An assembly bay for building rockets

### Context

**The ROCKET tab today** (`src/app/rocket-panel.tsx`, [rocket](../physics/rocket.md)):
- It builds a launch vehicle **stage by stage**: rows of dry mass, propellant, Isp and thrust. It also has real launchers' presets (Saturn V, Falcon 9, Electron), sizing for a job, and an ascent from one of five pads into the kernel.
- It flies **OpenRocket designs**: `ork.js` reads an `.ork` file's stages, motors and *saved simulations* in the browser, and flies them as a point mass whose axis follows the wind with a set 0.1 s lag. It reads no parts: no nose cone, body tube or fins. Its limits say so: "its axis follows a set lag, not the rocket's own stability".

**The physics has the pieces:**
- `stackPerformance` and `optimalStaging` (Δv, burn time, thrust-to-weight);
- `ascent`;
- `sixdof.js`: a 6-DOF rigid body, with an **aerodynamic torque at a centre of pressure** and an inertia tensor;
- `stackShape.js`: the cylinders and cones the scene draws a stack by.

**What's missing:**
- the parts themselves;
- their masses and centres of gravity;
- a centre of pressure.

There is no Barrowman or other normal-force code anywhere in `packages/physics`.

**OpenRocket:**
- It is GPL-3.0-or-later (its `LICENSE.TXT`), at release 24.12 (27 Jul 2025) [23].
- An `.ork` is a zip of XML whose root is `openrocket`, at file version 1.11. Its components are named elements: `rocket`, `stage`, `nosecone`, `bodytube`, `transition`, `trapezoidfinset`, `ellipticalfinset`, `freeformfinset`, `innertube`, `centeringring`, `bulkhead`, `masscomponent`, `parachute` and others [24].
- Its saved flights carry the **CP location, CG location and stability margin** at every step [25]. That makes it an oracle for a builder.

The orrery is MIT, so it must never take OpenRocket's code. It may read and write the file format, as `ork.js` already does, and use the published methods behind it:
- Barrowman's 1967 method for slender finned vehicles [26];
- Niskanen's 2009 thesis, which OpenRocket grew from [27].

**The audiences.** The engineer wants the numbers a design review asks for: mass, Δv, thrust-to-weight, CG, CP and the stability margin, each with its source. The visitor wants to see a rocket come together and fly. "Built on the ground" means the craft starts somewhere physical, the bay, and is rolled out to a real pad.

**The design language** ([DESIGN.md](../../DESIGN.md)) is 1970s flight hardware:
- beige sheet-metal panels;
- engraved oxblood labels and readout windows;
- one colour for one meaning, with every lamp reporting a real state;
- a provenance tag on every value.

Its lineage is real NASA hardware. It cites Starfield's "NASA-punk" for principles only, and Starfield's logo, stripe, fonts and screen layouts are not used. **Its ship builder's interface must not be recreated**: not its layout, its grid, its snapping, its part cards or its colours.

### Options: the builder

| Option | What it gives | Verdict |
|---|---|---|
| **A. More rows in the ROCKET tab** | Parts as rows in the panel, with no 3D | **Too little.** It doesn't show the vehicle, and the stats lose the shape they come from |
| **B. An assembly bay** | A view of its own: a light, clean workspace, the vehicle upright in the middle at true scale, a rail of parts, and a stats plate that updates as each part changes | **Chosen** |
| **C. Assemble on the pad** in the main scene | The rocket built where it flies | **Later, as roll-out:** the bay hands its stack to the pad. It needs Part 1's ground, and the night side of the Earth is no workspace |
| **D. Run OpenRocket** (Java, GPL) beside or behind the app | OpenRocket's full models | **Rejected.** ADR-0001 keeps other simulators as separate programs, joined by files |
| **E. Port OpenRocket's aerodynamics** | Its models in JavaScript | **Rejected.** Translating GPL code into an MIT repository is a derivative work. We implement from the primary sources [26], [27] and test against OpenRocket's output [25] |

### Options: the visual style

1. **Clean-room drafting.** The bay as an integration clean room, drawn the orrery's way:
   - **The room.** The floor and back wall are the panel palette's lightest neutrals (`sheen`, `panel-raised`), lit evenly and without drama.
   - **The vehicle.** It stands in the middle in its real finishes: white paint, bare aluminium, phenolic.
   - **A drafting layer:** the centreline, station marks along the axis from the nose tip, dimension lines on the part being edited, and the CG and CP marked on the axis.
   - **The console:** around it, the same sheet-metal panels: a parts rail with engraved labels, and a stats plate of readout windows with provenance tags.
   - **Selection** is white, as DESIGN.md has it. There is no glass, blur, glow or hologram.
2. **Blueprint.** White line work on cyanotype blue. Striking, but blue is DESIGN.md's *advisory* colour, a dark field isn't the light workspace asked for, and a blueprint shows no materials. **Kept as the print and export view** (the drawing that goes with a saved design), not the bay.
3. **A dark hangar** under work lights. **Rejected:** it repeats the sky's dark, and it is the look most games' builders share.

**Chosen: clean-room drafting**, named in DESIGN.md as the bay's own section when phase R1 starts.

**How it stays original.**
- References are real hardware and drawings only: NASA's vehicle drawings and photographs of clean rooms and integration bays. No game screenshots go on any reference board.
- Layout follows from DESIGN.md's rules: place, size and shape mark the primary action, and arm then act for what can't be undone.
- Phase R1's gate includes a review that no layout, grid, snapping overlay, part-card form or colour came from any game's builder.

### The live stats

The stats plate's values, each tagged with its source:

| Value | From | Lamp |
|---|---|---|
| **Mass**: wet, dry, at each staging | The parts' materials and sizes (density × volume), or a part's stated mass | none |
| **Δv**: vacuum and sea level | `stackPerformance` (Curtis ch. 13), as today | none |
| **Thrust-to-weight** at ignition | `stackPerformance`; the motor's peak and average thrust for a solid | caution below a stated minimum |
| **CG** | The parts' masses and positions, at liftoff and at burnout | none |
| **CP** | Barrowman [26]: each part's normal-force slope and centre, summed | none |
| **Stability margin** (calibres) | (CP − CG) / body diameter, at liftoff and burnout | see below |

**The margin lamp follows NASA's Student Launch guidance** [28]:
- Below 1.0 calibre is **warn** (UNSTABLE).
- From 1.0 calibre it is stable; 1.5 to 2.0 is "desirable", and Student Launch requires at least 2.0 on the pad. So 1.0 to 1.5 shows **caution**, and 1.5 up to 3.0 shows **green**.
- 3.0 and above is "over stable" [28], shown as **caution** (OVERSTABLE).

**Big launchers.** The margin is a fin-stabilised rocket's measure: its CP must be behind its CG for the air to turn it back [29]. A guided orbital launcher is steered by its engines instead, so for one of those the margin is shown as a number only, beside an advisory ACTIVE CONTROL in place of the lamp. That follows the product's rule to be honest about limits.

### How it connects

**To the physics.** New pure modules in `packages/physics`, beside `rocket.js`:
- **`assembly.js`**: a part tree, its element types named as in `.ork` [24], so the two map one to one. From it:
  - mass properties: mass, CG and the inertia tensor;
  - the stage rows that `stackPerformance`, `ascent` and the ROCKET tab already take;
  - the shapes that `stackShape.js` and the scene draw.
- **`barrowman.js`**: the normal-force slope and CP of nose cones, transitions and fin sets [26], valid in Barrowman's slender-body regime. Parts outside it (pods, tube fins, freeform fins) are flagged, not guessed.
- **A 6-DOF flight for a built rocket**: `sixdof.js` with the bay's inertia, and its aerodynamic torque at the bay's CP. A rocket then weathercocks by its own stability, replacing `flyOrk`'s set lag.

**To OpenRocket.**
- **Read** a design's component tree from an `.ork` [24] into the bay, beside the saved flights `ork.js` reads today.
- **Write** the model-rocket subset back as an `.ork` that OpenRocket opens. `ork.test.mjs` already writes the format for its own design.
- **Liquid stages and tanks** have no `.ork` form. Those designs are saved as the orrery's own versioned JSON.

**Motors.** An `.ork` names its motors but holds no thrust curves.
- The bay reads RASP `.eng` and RockSim `.rse` files that the user opens, in the browser, as it does `.ork`. Nothing is redistributed.
- ThrustCurve.org's database and API [30] are the obvious library. Its terms weren't readable on 19 Nov 2026, so any bundled curve waits on reading them.

**Checked against:**
- OpenRocket's own CP, CG and stability margin, saved in its flights [25], for its example designs, at launch and burnout. The examples are GPL, so they stay out of the repository and are run locally, as `npm run oracle:openrocket` already does.
- RocketPy (MIT) [31], which `rocket.xcheck.test.mjs` already uses, for the 6-DOF flight.

### Decision (proposed)

1. **Build an assembly bay (option B), in the clean-room drafting style**, as its own view opened from the ROCKET tab, with the vehicle in the middle and the stats plate live.
2. **The physics first, in `packages/physics`**, with no UI: `assembly.js` and `barrowman.js`, from the primary sources [26], [27], checked against OpenRocket's output [25].
3. **One part tree for both scales:**
   - model and high-power rockets, which round-trip through `.ork`;
   - orbital launchers, whose tanks and engines feed the existing stage rows and ascent, and which are saved as the orrery's own JSON.
4. **No GPL code, and no GPL files in git.** Read and write the format; don't copy the program.
5. **Roll-out to the pad** in the main scene once Part 1's pad regions exist.

### Phases and gates

**Phase R0: the physics, no UI**
1. [ ] `assembly.js`: parts, materials and mass properties; stage rows for `stackPerformance`.
2. [ ] `barrowman.js`: normal-force slopes and CP.
3. [ ] `ork.js` reads the component tree.
4. [ ] **Gate:**
   - **Hand checks:** CG and CP match worked cases (a cone, a cylinder and a trapezoidal fin set) done by hand.
   - **OpenRocket:** for every saved simulation in OpenRocket's examples, CG, CP and the margin at launch agree with OpenRocket's saved columns [25] within stated tolerances.
   - **Existing tests:** the golden snapshot is unchanged, and `npm test` passes.

**Phase R1: the bay, model and high-power rockets**
1. [ ] The view: a parts rail, the vehicle at the centre, the stats plate, and guarded removal (arm, then act).
2. [ ] Every part editable from the keyboard and by number; dragging is never the only way (WCAG 2.2's 2.5.7).
3. [ ] A phone layout: the vehicle above, the stats in the sheet.
4. [ ] DESIGN.md gains the bay's section.
5. [ ] **Gate:**
   - **Design:** `impeccable detect` clean, and the accessibility audit's checks pass.
   - **Phone:** `npm run bench:frames` at phone size within budget.
   - **Originality:** the review above signed off by Isaac.
   - **Files:** no GPL files committed.

**Phase R2: fly it**
1. [ ] A built model rocket flies a 6-DOF ascent from the pad with its own CP and inertia.
2. [ ] The bay writes `.ork`.
3. [ ] **Gate:**
   - **Apogee:** within a stated tolerance of OpenRocket's for its examples, beside the point-mass replay's 0.72 %.
   - **Round trip:** a design written by the bay opens in OpenRocket 24.12 and gives the same CG and CP there.

**Phase R3: orbital launchers and roll-out**
1. [ ] Tanks, engines, interstages and fairings, sized from `STAGE_TECH` and the real launchers' figures.
2. [ ] Roll the stack out to the pad, onto Part 1's ground where it exists.
3. [ ] **Gate:**
   - **The table:** a Saturn V or Falcon 9 assembled from parts gives the same stage rows as its preset.
   - **The ascent:** `rocket.test.mjs` and the real-flight checks pass unchanged.

### Risks

- **Scope.** A builder can grow into a game. The gate for each phase is a number checked against OpenRocket or a real vehicle, not a feature list.
- **Barrowman's limits.** It covers slender bodies with simple fins. Outside that, the bay says the CP is unknown rather than showing a wrong number.
- **GPL.** Reading OpenRocket's code to "check" it is how a port starts. Work from the papers, and test against its output only.
- **Two looks in one app.** The light bay beside the dark sky. The bay is a separate view with the same panels, not a theme switch.
- **Phones.** A second three.js scene costs memory. The bay uses one canvas and frees the bay's scene on leaving it.
- **Motor data.** Thrust curves are third-party data with their own terms [30]. User-loaded files avoid redistribution until the terms are read.

---

## Order and dependencies

- **R0** (pure physics, cheap, testable) and Part 1's **phase 0** spike can run now and in parallel. They touch different files.
- **Part 1 phase 1** needs ADR-0001's open items: phase B's gate, and the domain and R2 decision.
- **R3's roll-out** needs Part 1 phase 1's pad regions.

## Consequences

**Easier:**
- The engineer can check a height's source and datum.
- A visitor can build a rocket, see whether it's stable and why, and fly it.
- OpenRocket designs open as designs, not only as saved flights.

**Harder:**
- A tile pipeline and a second data host to keep.
- A new dependency below 1.0.
- A second view to design and test on phones.
- More notices to carry.

**To revisit:**
- The whole-globe pyramid (phase 2).
- Other bodies' terrain (phase 3).
- Bundled motor curves.
- A blueprint export.

## References

[1] P. Cozzi and K. Ring, *3D Engine Design for Virtual Globes*. Boca Raton, FL, USA: CRC Press, 2011, doi: 10.1201/9781439865583.

[2] three.js, "WebGLRenderer," `reversedDepthBuffer` parameter, r187 source (`src/renderers/WebGLRenderer.js`). [Online]. Available: https://threejs.org/docs/#api/en/renderers/WebGLRenderer. Accessed: Nov. 19, 2026.

[3] Amazon Web Services, "Copernicus Digital Elevation Model (DEM)," Registry of Open Data on AWS. [Online]. Available: https://registry.opendata.aws/copernicus-dem/. Accessed: Nov. 19, 2026.

[4] Google, "Copernicus DEM GLO-30 (2024_1): Global 30m Digital Elevation Model," Earth Engine Data Catalog. [Online]. Available: https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30_2024_1. Accessed: Nov. 19, 2026.

[5] Copernicus Programme, "Licence for the use of the Copernicus WorldDEM-30," COP-DEM licence. [Online]. Available: https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf. Accessed: Nov. 19, 2026. (The PDF did not open; its terms were read through search summaries and [4].)

[6] NASA JPL, "NASADEM Merged DEM Global 1 arc second V001," NASA EOSDIS Land Processes DAAC, 2020, doi: 10.5067/MEASURES/NASADEM/NASADEM_HGT.001. [Online]. Available: https://www.earthdata.nasa.gov/data/catalog/lpcloud-nasadem-hgt-001. Accessed: Nov. 19, 2026.

[7] NASA JPL, "NASA Shuttle Radar Topography Mission Global 1 arc second (SRTMGL1) V003," NASA EOSDIS Land Processes DAAC, 2013, doi: 10.5067/MEASURES/SRTM/SRTMGL1.003. [Online]. Available: https://www.earthdata.nasa.gov/data/catalog/lpcloud-srtmgl1-003. Accessed: Nov. 19, 2026.

[8] Amazon Web Services, "Terrain Tiles," Registry of Open Data on AWS. [Online]. Available: https://registry.opendata.aws/terrain-tiles/. Accessed: Nov. 19, 2026.

[9] Tilezen, "joerd: formats," GitHub. [Online]. Available: https://github.com/tilezen/joerd/blob/master/docs/formats.md. Accessed: Nov. 19, 2026.

[10] Tilezen, "joerd: attribution," GitHub. [Online]. Available: https://github.com/tilezen/joerd/blob/master/docs/attribution.md. Accessed: Nov. 19, 2026.

[11] NOAA National Centers for Environmental Information, "ETOPO 2022 15 Arc-Second Global Relief Model," 2022, doi: 10.25921/fd45-gt74. Licence: CC0-1.0. [Online]. Available: https://data.noaa.gov/metaview/page?xml=NOAA/NESDIS/NGDC/MGG/DEM//iso/xml/etopo_2022.xml&view=getDataView&header=none. Accessed: Nov. 19, 2026.

[12] Cesium, "quantized-mesh-1.0 terrain format," GitHub. [Online]. Available: https://github.com/CesiumGS/quantized-mesh. Accessed: Nov. 19, 2026.

[13] Cesium, "Cesium ion pricing." [Online]. Available: https://cesium.com/platform/cesium-ion/pricing/. Accessed: Nov. 19, 2026.

[14] Cesium, "Cesium ion access tokens." [Online]. Available: https://cesium.com/learn/ion/cesium-ion-access-tokens/. Accessed: Nov. 19, 2026.

[15] NASA ESDIS, "GIBS API documentation": "Access basics" and "Advanced topics." [Online]. Available: https://nasa-gibs.github.io/gibs-api-docs/ and https://nasa-gibs.github.io/gibs-api-docs/access-advanced-topics/. Accessed: Nov. 19, 2026.

[16] NASA Earth Observatory, "Blue Marble Next Generation." [Online]. Available: https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation. Accessed: Nov. 19, 2026.

[17] EOX IT Services GmbH, "EOxCloudless licence." [Online]. Available: https://cloudless.eox.at/license-non-commercial. Accessed: Nov. 19, 2026.

[18] Google, "Map Tiles API usage and billing," Google Maps Platform. [Online]. Available: https://developers.google.com/maps/documentation/tile/usage-and-billing. Accessed: Nov. 19, 2026.

[19] Google, "Map Tiles API policies," Google Maps Platform. [Online]. Available: https://developers.google.com/maps/documentation/tile/policies. Accessed: Nov. 19, 2026.

[20] NASA-AMMOS, "3DTilesRendererJS," GitHub repository, release v0.5.4, Nov. 3, 2026. Licence: Apache-2.0. [Online]. Available: https://github.com/NASA-AMMOS/3DTilesRendererJS. Accessed: Nov. 19, 2026.

[21] Open Geospatial Consortium, "3D Tiles Specification 1.1," OGC Community Standard 22-025r4. [Online]. Available: https://docs.ogc.org/cs/22-025r4/22-025r4.html. Accessed: Nov. 19, 2026.

[22] Cloudflare, "R2 pricing." [Online]. Available: https://developers.cloudflare.com/r2/pricing/. Accessed: Nov. 19, 2026.

[23] OpenRocket, "openrocket," GitHub repository: `LICENSE.TXT` (GNU GPL version 3 or later) and release 24.12, Jul. 27, 2025. [Online]. Available: https://github.com/openrocket/openrocket. Accessed: Nov. 19, 2026.

[24] OpenRocket, "File specification," OpenRocket documentation. [Online]. Available: https://openrocket.readthedocs.io/en/latest/dev_guide/file_specification.html. Accessed: Nov. 19, 2026.

[25] OpenRocket, `FlightDataType.java` (the `cp_location`, `cg_location` and `stability` flight data types), GitHub. [Online]. Available: https://github.com/openrocket/openrocket/blob/unstable/core/src/main/java/info/openrocket/core/simulation/FlightDataType.java. Accessed: Nov. 19, 2026.

[26] J. S. Barrowman, "The practical calculation of the aerodynamic characteristics of slender finned vehicles," M.S. thesis, Catholic Univ. of America, Washington, DC, USA, Mar. 1967. Reissued as NASA/TM-2001-209983, NTRS 20010047838. [Online]. Available: https://ntrs.nasa.gov/citations/20010047838. Accessed: Nov. 19, 2026.

[27] OpenRocket, "Overview," OpenRocket documentation (on S. Niskanen, "Development of an Open Source model rocket simulation software," M.Sc. thesis, Helsinki Univ. of Technology, 2009). [Online]. Available: https://openrocket.readthedocs.io/en/latest/introduction/overview.html. Accessed: Nov. 19, 2026.

[28] NASA STEM, "NASA Student Launch ARW: Rocketry by the Numbers," 2023. [Online]. Available: https://www.nasa.gov/wp-content/uploads/2023/09/nasa-sl-2024-arw-rocketry-by-the-numbers-508.pdf. Accessed: Nov. 19, 2026.

[29] NASA Glenn Research Center, "Rocket stability," Beginner's Guide to Aeronautics. [Online]. Available: https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/rocket-stability/. Accessed: Nov. 19, 2026.

[30] ThrustCurve.org, "API." [Online]. Available: https://www.thrustcurve.org/info/api.html. Accessed: Nov. 19, 2026. (Not opened: the site refused automated fetches. Its terms are unread.)

[31] G. H. Ceotto, R. N. Schmitt, G. F. Alves, L. A. Pezente and B. S. Carmo, "RocketPy: Six degree-of-freedom rocket trajectory simulator," *J. Aerosp. Eng.*, vol. 34, no. 6, Art. no. 04021093, Nov. 2021, doi: 10.1061/(ASCE)AS.1943-5525.0001331. Code: https://github.com/RocketPy-Team/RocketPy (MIT). Accessed: Nov. 19, 2026.
