// src/scene/OrreryScene.ts
//
// The 3D solar system, at true scale and true positions.
//
// Positions: every frame, each body's heliocentric ecliptic J2000 state comes
// from the ephemeris (src/physics/ephemeris.js, astronomy-engine). Orbit lines
// are sampled from the same ephemeris, not drawn as ellipses.
//
// Precision (floating origin): all positions are kept in km as doubles. The
// camera sits at the render origin, and each object is placed at
// (its position - the camera's position) / 1000 km, so the numbers handed to
// the GPU (float32) are always small near the camera. A logarithmic depth
// buffer covers metres to hundreds of AU in one view.
//
// Frame: ecliptic J2000 with ecliptic north up: three.js (x, y, z) =
// (x_ecl, z_ecl, -y_ecl).
//
// Light: the Sun is the only light, falling off as 1/d^2, with eclipses
// (bodyMaterial.ts) and Earth's atmosphere (atmosphere.ts). The exposure is metered for sunlight at the camera's
// distance from the Sun, like a camera on a spacecraft there. True-scale
// bodies are usually far below a pixel, so each has a constant-size marker
// and label in an HTML overlay.

import * as THREE from 'three';
import { helioStateEcl, eqjToEcl, eclToEqj } from '../physics/ephemeris.js';
import { bodyAxesEqj } from '../physics/orientation.js';
import type { SimClock } from '../app/clock';
import { BODIES, BODY_BY_KEY, type BodyKey } from './catalogue';
import { makeBodyMaterial, MAX_OCCLUDERS, applyAtmosphere, applyRingShadow, applySurfaceMaps, clearCloud } from './bodyMaterial';
import { makeRings, tauTexture, type RingProfile } from './rings';
import { makeStarPoints, makeStars, resetStars, setStarScale } from './stars';
import { DailyEarth } from './clouds';
import { CraftLayer, type CraftView } from './craftLayer';
import { SmallBodyLayer } from './smallBodies';
import { orbitTrailMaterial } from './orbitTrail';
import { EARTH_ATMOSPHERE, makeAtmosphere, type AtmosphereParams } from './atmosphere';
import { BASE as TEXTURE_BASE, loadBinary, loadJson, loadManifest, SurfaceLoader, TextureUploader, type Manifest } from './surfaces';
import { CameraRig, type Anchor } from './cameraRig';
import { HdrPipeline } from './post';
import { makeSunMaterial, SunGlare, visibleFraction } from './sun';
import { RenderScale } from './renderScale';

const UNIT_KM = 1000;                 // one render unit = 1000 km
const ORBIT_SAMPLES = 360;
const AU_KM = 149597870.7;
const SUN_RADIUS_KM = 695700;
// Exposure for sunlight at 1 AU (sets the overall look; scaled by d^2), and
// the tone curve (docs/frontend/lighting.md#exposure-and-tone-mapping).
const TONE: Record<string, [THREE.ToneMapping, number]> = {
  // Khronos PBR Neutral: below its knee colours change only by a small
  // offset (and a quadratic toe near black; lighting.md), highlights
  // roll off to white. 1.2 matches three's ACES on a lit planet (scene
  // value 0.5 shows as 0.56 in both) without ACES's hue shifts.
  neutral: [THREE.NeutralToneMapping, 1.2],
  agx: [THREE.AgXToneMapping, 1 / 0.6],
  aces: [THREE.ACESFilmicToneMapping, 1.0],   // three's ACES already scales by 1 / 0.6
};
// The star-free Milky Way map is scaled to its own brightest light, so it is
// drawn well below white beside the point stars.
const MILKY_WAY_GAIN = 0.5;
const [TONE_MAPPING, EXPOSURE_1AU] = TONE[new URLSearchParams(location.search).get('tone') ?? 'neutral'] ?? TONE.neutral;
// Bodies whose surfaces are bare regolith (Lommel-Seeliger scattering).
const AIRLESS: ReadonlySet<BodyKey> = new Set<BodyKey>(['mercury', 'moon', 'pluto']);
type Vec3 = [number, number, number];

export interface BodyState { r: Vec3; v: Vec3 }

// Ecliptic km vector -> three.js render units.
function toRender(a: Vec3, out: THREE.Vector3): THREE.Vector3 {
  return out.set(a[0] / UNIT_KM, a[2] / UNIT_KM, -a[1] / UNIT_KM);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// Rotation taking a render-frame direction to J2000 equatorial.
function renderToEqj(): THREE.Matrix3 {
  const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(([x, y, z]) => eclToEqj([x, -z, y]) as Vec3);
  return new THREE.Matrix3().set(
    cols[0][0], cols[1][0], cols[2][0],
    cols[0][1], cols[1][1], cols[2][1],
    cols[0][2], cols[1][2], cols[2][2]);
}

export function bodyState(key: BodyKey, date: Date): BodyState {
  if (key === 'sun') return { r: [0, 0, 0], v: [0, 0, 0] };
  return helioStateEcl(key, date) as BodyState;
}

interface OrbitLine {
  line: THREE.Line;
  epochMs: number;      // centre of the sampled span
  sampledAt: number;    // performance.now() of the last resample
}

export class OrreryScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private meshes = new Map<BodyKey, THREE.Mesh>();
  private orbits = new Map<BodyKey, OrbitLine>();
  private labels = new Map<BodyKey, HTMLDivElement>();
  private materials = new Map<BodyKey, THREE.ShaderMaterial>();
  private occluderKeys = new Map<BodyKey, BodyKey[]>();
  private manifest: Manifest | null = null;
  private surfaces: SurfaceLoader;
  private uploader: TextureUploader;
  private rings: THREE.Mesh | null = null;
  private stars: THREE.Mesh | null = null;
  private starPoints: THREE.Points | null = null;
  readonly dailyEarth = new DailyEarth();
  private atmospheres = new Map<BodyKey, THREE.Mesh>();
  private unloadedSurfaces = new Set<BodyKey>();
  private earthResolved = false;
  private glare = new SunGlare();
  private post: HdrPipeline;
  private sunVisible = 1;
  private adapt = 1;              // the eye's adaptation: 1 dark-adapted
  private buffer = new THREE.Vector2();
  private scale: RenderScale;
  private states = {} as Record<BodyKey, BodyState>;
  private raf = 0;
  private lastFrame = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private resizeObserver: ResizeObserver;

  // The camera orbits a pivot on the focused body or craft and flies
  // between them (cameraRig.ts). `focus` is the body the panels describe;
  // it changes at the click, while the camera is still on its way.
  focus: BodyKey = 'sun';
  private rig: CameraRig;
  // Zoom the user chose, carried to the next body: in body radii for
  // planets and moons, in km for the Sun's view and for craft.
  private userRadii: number | null = null;
  private sunDist: number | null = null;
  private craftDist: number | null = null;
  private lastCrafts: CraftView[] = [];

  private sunViewPending = false;
  private sunViewPhase = 0.35;

  onFocusChange: (key: BodyKey) => void = () => {};
  // Spacecraft: the mission steps on each frame (after the clock), the scene
  // draws what craftSource returns, and the camera can follow one craft.
  onFrame: (timeMs: number, jumps: number) => void = () => {};
  onContextLost: (lost: boolean) => void = () => {};
  onFlight: (flying: boolean) => void = () => {};
  get flying(): boolean { return this.rig.flying; }
  // Pixels of the sky covered on the right (the flight console): the view's
  // centre moves left by half of it, easing over a quarter second.
  private insetGoal = 0;
  private inset = 0;
  setInsetRight(px: number): void { this.insetGoal = px; }
  craftSource: () => CraftView[] = () => [];
  onCraftPick: (id: number) => void = () => {};
  focusCraftId: number | null = null;
  private craftLayer!: CraftLayer;
  // The asteroids and comets (smallBodies.ts), for the rail's toggles.
  smallBodies!: SmallBodyLayer;

  private bodyAnchor(key: BodyKey): Anchor {
    return { id: `body:${key}`, pos: () => this.states[key]?.r ?? (key === 'sun' ? [0, 0, 0] : null), minDist: BODY_BY_KEY[key].radiusKm * 1.2 };
  }

  private craftAnchor(id: number): Anchor {
    const find = (list: CraftView[]) => list.find((c) => c.id === id)?.rEcl ?? null;
    return { id: `craft:${id}`, pos: () => find(this.lastCrafts) ?? find(this.craftSource()), minDist: 0.05 };
  }

  // Where a flight to a body ends: the user's zoom in radii if they set
  // one (within reason), else the default framing; the Sun's overview.
  private arrivalDist(key: BodyKey, reframe: boolean): number {
    if (key === 'sun') return !reframe && this.sunDist !== null ? this.sunDist : 1.6e9;
    const R = BODY_BY_KEY[key].radiusKm;
    if (!reframe && this.userRadii !== null) return R * Math.max(1.6, Math.min(80, this.userRadii));
    return Math.max(R * 8, 2.0e4);
  }

  // Put the camera at phase angle `phase` (rad) from the Sun as seen from
  // the focused body: about 0.35 shows the day side with a little
  // terminator, pi/2 the terminator edge-on (applied on the next frame).
  viewFromSun(phase = 0.35): void { this.sunViewPending = true; this.sunViewPhase = phase; }

  constructor(private container: HTMLElement, private overlay: HTMLElement, private clock: SimClock) {
    // HDR (post.ts): the scene renders linear light into a half-float
    // target (4x multisampled below 1.5 device pixels per CSS pixel; above
    // that the pixels are small enough), and one final pass mixes in the
    // bloom and the Sun's glare and applies exposure, the tone curve and
    // the sRGB encode. A dual-GPU laptop is asked for its discrete GPU.
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(dpr);
    this.post = new HdrPipeline(dpr < 1.5, this.glare);
    // ?scale=fixed keeps the full ratio (for measuring the raw cost).
    this.scale = new RenderScale(dpr, new URLSearchParams(location.search).get('scale') === 'fixed');
    this.renderer.toneMapping = TONE_MAPPING;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1e-3, 1e10);
    this.camera.position.set(0, 0, 0);
    this.rig = new CameraRig(this.bodyAnchor('sun'));
    this.rig.onArrive = () => this.onFlight(false);

    // No light objects: each body's material computes its own sunlight.
    // The Sun's disc is drawn at its true surface brightness relative to a
    // white surface lit face-on at 1 AU, (1 AU / R_sun)^2, about 46,000.
    const sphere = new THREE.SphereGeometry(1, 96, 48);
    for (const b of BODIES) {
      let material: THREE.Material;
      if (b.key === 'sun') {
        material = makeSunMaterial();
      } else {
        const m = makeBodyMaterial(b.colour, b.geometricAlbedo ?? 0.3, AIRLESS.has(b.key));
        this.materials.set(b.key, m);
        material = m;
        // A body can be shadowed by its parent (not the Sun) and its moons.
        const occ = BODIES.filter((o) => o.parent === b.key).map((o) => o.key);
        if (b.parent && b.parent !== 'sun') occ.unshift(b.parent);
        this.occluderKeys.set(b.key, occ.slice(0, MAX_OCCLUDERS));
      }
      const mesh = new THREE.Mesh(sphere, material);
      mesh.scale.setScalar(b.radiusKm / UNIT_KM);
      this.scene.add(mesh);
      this.meshes.set(b.key, mesh);
      this.labels.set(b.key, this.makeLabel(b.key, b.name));
    }

    // Atmospheres: a scattering shell, and the same medium on the surface's
    // sunlight.
    const atmos: Partial<Record<BodyKey, AtmosphereParams>> = { earth: EARTH_ATMOSPHERE };
    for (const [key, a] of Object.entries(atmos) as [BodyKey, AtmosphereParams][]) {
      const R = BODY_BY_KEY[key].radiusKm;
      const shell = makeAtmosphere(a, R, UNIT_KM);
      this.scene.add(shell);
      this.atmospheres.set(key, shell);
      applyAtmosphere(this.materials.get(key)!, a, R);
    }

    this.uploader = new TextureUploader(this.renderer);
    this.surfaces = new SurfaceLoader(this.uploader);
    this.dailyEarth.uploader = this.uploader;
    this.dailyEarth.onChange = (tex) => {
      const m = this.materials.get('earth')!;
      if (tex) applySurfaceMaps(m, { cloud: tex, cloudWhiteLuminance: this.dailyEarth.whiteLuminance });
      else clearCloud(m);
    };
    void loadManifest().then((m) => {
      this.manifest = m;
      if (!m) return;
      // A body's maps load the first time its disc is more than a few pixels
      // across (placeLabels), so GPU memory goes only to what is seen.
      for (const key of Object.keys(m.bodies) as BodyKey[]) this.unloadedSurfaces.add(key);
      const ring = m.rings?.saturn;
      if (ring) {
        void loadJson<RingProfile>(ring.tau).then((profile) => {
          const tex = tauTexture(profile);
          const outerKm = profile.innerKm + profile.stepKm * (profile.tau.length - 1);
          this.rings = makeRings(tex, profile.innerKm, outerKm, UNIT_KM);
          this.scene.add(this.rings);
          applyRingShadow(this.materials.get('saturn')!, tex, profile.innerKm / UNIT_KM, outerKm / UNIT_KM);
        });
      }
      const stars = m.stars;
      if (stars) {
        // The light between the stars, then the stars as points over it.
        const gain = (stars.gain ?? 1) * (stars.points ? MILKY_WAY_GAIN : 1);
        void this.surfaces.load(stars.map, true).then((tex) => {
          this.stars = makeStars(tex, renderToEqj(), stars.raAtLeftDeg, stars.raIncreasesRight, gain,
            stars.detail && { entry: stars.detail, base: TEXTURE_BASE });
          this.scene.add(this.stars);
        });
        if (stars.points) {
          void loadBinary(stars.points).then((buf) => {
            this.starPoints = makeStarPoints(new Int16Array(buf), renderToEqj().transpose(), this.scale.max);
            setStarScale(this.starPoints, this.scale.max, this.renderer.getPixelRatio());
            this.scene.add(this.starPoints);
          });
        }
      }
    });

    this.craftLayer = new CraftLayer(this.scene, this.overlay, (id) => this.onCraftPick(id));
    this.smallBodies = new SmallBodyLayer(this.scene, this.overlay, import.meta.env.BASE_URL);
    this.smallBodies.setScale(this.scale.max, this.renderer.getPixelRatio());
    // The GPU can drop the WebGL context (sleep, driver reset, memory
    // pressure): say so rather than show a black view, and carry on when the
    // browser restores it.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost(true); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.reloadMaps(); this.onContextLost(false); });
    this.attachControls();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  // Maps are uploaded by hand (surfaces.ts), so a restored context needs
  // them loaded again: each body's on its next sighting, the stars now.
  private reloadMaps(): void {
    this.surfaces.reset();
    this.dailyEarth.reset();
    const m = this.manifest;
    if (!m) return;
    for (const key of Object.keys(m.bodies) as BodyKey[]) this.unloadedSurfaces.add(key);
    if (m.stars && this.stars) {
      const mat = this.stars.material as THREE.ShaderMaterial;
      resetStars(this.stars);
      void this.surfaces.load(m.stars.map, true).then((tex) => { mat.uniforms.starMap.value = tex; }).catch(() => {});
    }
  }

  private makeLabel(key: BodyKey, name: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'body-marker';
    el.innerHTML = `<span class="dot"></span><span class="name">${name}</span>`;
    el.addEventListener('click', () => this.focusOn(key));
    this.overlay.appendChild(el);
    return el;
  }

  // Follow a craft: fly to it, or (immediate) start there.
  focusOnCraft(id: number, immediate = false): void {
    this.focusCraftId = id;
    const d = this.craftDist ?? 2.0e4;
    if (immediate) this.rig.jumpTo(this.craftAnchor(id), d);
    else this.rig.flyTo(this.craftAnchor(id), d);
    this.onFlight(this.rig.flying);
  }

  // Fly to a body. Choosing the body already in view reframes it at the
  // default distance; choosing the body a flight is already heading for
  // changes nothing.
  focusOn(key: BodyKey): void {
    if (this.rig.flying && this.rig.destination.id === `body:${key}`) return;
    const reframe = key === this.focus && this.focusCraftId === null;
    this.focusCraftId = null;
    this.focus = key;
    this.loadSurfaces(key);           // start now: the flight hides the upload
    this.rig.flyTo(this.bodyAnchor(key), this.arrivalDist(key, reframe));
    this.onFlight(this.rig.flying);
    this.onFocusChange(key);
  }

  // Stop a flight where it is (Escape).
  stopFlight(): void { this.rig.interrupt(); }

  private loadSurfaces(key: BodyKey): void {
    if (!this.manifest || !this.unloadedSurfaces.has(key)) return;
    this.unloadedSurfaces.delete(key);
    void this.surfaces.apply(key, this.manifest.bodies[key]!, this.materials.get(key)!, new Date(this.clock.snapshot.timeMs))
      .catch(() => this.unloadedSurfaces.add(key));   // a lost context: load again on the next sighting
  }

  stateOf(key: BodyKey): BodyState | undefined {
    return this.states[key];
  }

  private attachControls(): void {
    const el = this.renderer.domElement;
    // One pointer drags; a second finger is ignored until the first lifts.
    let pointer: number | null = null, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      pointer = e.pointerId; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      this.rig.rotate(-(e.clientX - lx) * 0.005, (e.clientY - ly) * 0.005);
      lx = e.clientX; ly = e.clientY;
    });
    this.container.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKey);
  }

  // The wheel takes over from a flight and zooms smoothly; the distance it
  // settles on is remembered for the next body (arrivalDist). It is heard on
  // the whole sky, labels included (they sit over the canvas).
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const craft = this.focusCraftId !== null;
    const minDist = craft ? 0.05 : BODY_BY_KEY[this.focus].radiusKm * 1.2;
    // Lines are 3 % of a page; pixels as they come.
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    this.rig.zoom(Math.exp(dy * 0.0015), minDist, 2.0e10);
    const goal = this.rig.goalDistance;
    if (craft) this.craftDist = goal;
    else if (this.focus === 'sun') this.sunDist = goal;
    else this.userRadii = goal / BODY_BY_KEY[this.focus].radiusKm;
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || !this.rig.flying) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    this.rig.interrupt();
    e.preventDefault();               // handled: the app does not also close the console
  };

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.renderer.getDrawingBufferSize(this.buffer);
    this.post.setSize(this.buffer.x, this.buffer.y, this.renderer.getPixelRatio());
    if (this.starPoints) setStarScale(this.starPoints, this.scale.max, this.renderer.getPixelRatio());
    this.smallBodies?.setScale(this.scale.max, this.renderer.getPixelRatio());
    this.camera.aspect = w / h;
    this.applyInset();
  }

  // Shift the projection so the pivot sits in the middle of the uncovered
  // part of the sky.
  private applyInset(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    if (this.inset > 0.5) this.camera.setViewOffset(w, h, this.inset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // Sample a body's orbit about its parent from the ephemeris, centred on t.
  private sampleOrbit(key: BodyKey, tMs: number): THREE.Line | null {
    const b = BODY_BY_KEY[key];
    if (!b.parent || !b.periodDays) return null;
    const pts = new Float32Array((ORBIT_SAMPLES + 1) * 3);
    const us = new Float32Array(ORBIT_SAMPLES + 1);
    const span = b.periodDays * 86400e3;
    for (let i = 0; i <= ORBIT_SAMPLES; i++) {
      const d = new Date(tMs - span / 2 + (span * i) / ORBIT_SAMPLES);
      const rel = sub(bodyState(key, d).r, bodyState(b.parent, d).r);
      toRender(rel, this.tmp);
      pts.set([this.tmp.x, this.tmp.y, this.tmp.z], i * 3);
      us[i] = i / ORBIT_SAMPLES - 0.5;          // time offset from the centre, in periods
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    geom.setAttribute('u', new THREE.BufferAttribute(us, 1));
    // A faint whole orbit with a glowing trail behind the body (orbitTrail.ts).
    const line = new THREE.Line(geom, orbitTrailMaterial(b.colour));
    line.frustumCulled = false;
    return line;
  }

  private updateOrbits(tMs: number, now: number): void {
    for (const b of BODIES) {
      if (!b.parent || !b.periodDays) continue;
      const o = this.orbits.get(b.key);
      const period = b.periodDays * 86400e3;
      // Resample when the sim has moved 5 % of a period (the orbit precesses
      // and the drawn span should stay centred), at most twice a second per
      // line and one line per frame (each costs about 3 ms), so time warp
      // does not stall a frame.
      if (o && (Math.abs(tMs - o.epochMs) < 0.05 * period || now - o.sampledAt < 500)) continue;
      const line = this.sampleOrbit(b.key, tMs);
      if (!line) continue;
      if (o) { this.scene.remove(o.line); o.line.geometry.dispose(); (o.line.material as THREE.Material).dispose(); }
      this.scene.add(line);
      this.orbits.set(b.key, { line, epochMs: tMs, sampledAt: now });
      return;
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    this.uploader.step();
    const dtReal = Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    const ratio = this.scale.frame(now, now - this.lastFrame);
    if (ratio !== null) { this.renderer.setPixelRatio(ratio); this.resize(); }
    if (this.inset !== this.insetGoal) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.inset = reduced || Math.abs(this.inset - this.insetGoal) < 0.5 ? this.insetGoal
        : this.inset + (this.insetGoal - this.inset) * (1 - Math.exp(-dtReal / 0.08));
      this.applyInset();
    }
    this.clock.tick((now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const tMs = this.clock.snapshot.timeMs;
    const date = new Date(tMs);
    this.onFrame(tMs, this.clock.snapshot.jumps);
    const crafts = this.craftSource();
    this.lastCrafts = crafts;

    for (const b of BODIES) this.states[b.key] = bodyState(b.key, date);
    if (this.earthResolved) this.dailyEarth.update(tMs, this.clock.snapshot.playing ? this.clock.snapshot.rate : 0);
    this.updateOrbits(tMs, now);

    if (this.sunViewPending && this.focus !== 'sun') {
      const b = this.states[this.focus].r;
      const d = Math.hypot(b[0], b[1], b[2]);
      this.rig.az = Math.atan2(-b[1], -b[0]) + this.sunViewPhase;
      this.rig.el = Math.asin(-b[2] / d) + 0.15;
      this.sunViewPending = false;
    }
    // Camera position in km (ecliptic): about the pivot (cameraRig.ts). A
    // followed craft that is gone hands the camera back to the focus body.
    if (!this.rig.update(dtReal)) {
      this.focusCraftId = null;
      this.onFocusChange(this.focus);   // the app stops showing FOLLOW
      this.rig.flyTo(this.bodyAnchor(this.focus), this.arrivalDist(this.focus, false));
      this.rig.update(0);
    }
    const f = this.rig.pivot;
    const { az, el, dist } = this.rig;
    const ce = Math.cos(el);
    const offset: Vec3 = [dist * ce * Math.cos(az), dist * ce * Math.sin(az), dist * Math.sin(el)];
    const cam: Vec3 = [f[0] + offset[0], f[1] + offset[1], f[2] + offset[2]];

    for (const b of BODIES) {
      toRender(sub(this.states[b.key].r, cam), this.meshes.get(b.key)!.position);
    }
    const sunPos = this.meshes.get('sun')!.position;
    this.updateLighting(sunPos, cam, date);
    for (const b of BODIES) {
      const o = this.orbits.get(b.key);
      if (o && b.parent) {
        o.line.position.copy(this.meshes.get(b.parent)!.position);
        (o.line.material as THREE.ShaderMaterial).uniforms.now.value = (tMs - o.epochMs) / (b.periodDays! * 86400e3);
      }
    }

    this.craftLayer.place(crafts, cam, UNIT_KM);

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(toRender([-offset[0], -offset[1], -offset[2]], this.tmp));
    this.camera.updateMatrixWorld();
    this.updateGlare(sunPos, cam, now);
    this.updateAdaptation(dtReal, sunPos);
    this.smallBodies.update(tMs, cam, 1 / this.renderer.toneMappingExposure, this.adapt);

    this.post.render(this.renderer, this.scene, this.camera);
    this.placeLabels();
    this.craftLayer.label(crafts, cam, UNIT_KM, this.camera, this.container.clientWidth, this.container.clientHeight);
  };

  // The Sun's glare: its strength follows the sunlight at the camera and
  // the part of the disc that no body hides (the eclipse overlap again).
  private updateGlare(sunPos: THREE.Vector3, cam: Vec3, now: number): void {
    const dSun = sunPos.length();
    const a = Math.asin(Math.min(1, SUN_RADIUS_KM / UNIT_KM / dSun));
    let visible = 1;
    for (const b of BODIES) {
      if (b.key === 'sun' || visible === 0) continue;
      const p = this.meshes.get(b.key)!.position;
      const d = p.length();
      if (d >= dSun || p.dot(sunPos) <= 0) continue;
      const beta = Math.asin(Math.min(1, b.radiusKm / UNIT_KM / d));
      const c = Math.acos(Math.max(-1, Math.min(1, p.dot(sunPos) / (d * dSun))));
      visible *= visibleFraction(a, beta, c);
    }
    const dCamAu = Math.hypot(cam[0], cam[1], cam[2]) / AU_KM;
    this.renderer.getDrawingBufferSize(this.buffer);
    this.glare.update(this.camera, sunPos, SUN_RADIUS_KM / UNIT_KM, 1 / (dCamAu * dCamAu), visible, this.buffer, now / 1000);
    this.sunVisible = visible;
  }

  // The eye's adaptation, the sky's honest motion (docs/frontend/lighting.md#stars):
  // faint stars and the Milky Way fade when bright light is in view (the
  // Sun near the centre, lit discs by their share of the view and phase)
  // and return in the dark: quickly toward light (0.3 s), slowly back (2 s).
  private updateAdaptation(dt: number, sunPos: THREE.Vector3): void {
    const fwd = this.tmp.set(0, 0, -1).transformDirection(this.camera.matrixWorld);
    const cosSun = fwd.dot(sunPos) / sunPos.length();
    const thetaSun = (Math.acos(Math.max(-1, Math.min(1, cosSun))) * 180) / Math.PI;
    // The Sun's disc in frame would blind an eye to faint stars outright;
    // it is tempered to a third so the overview keeps a sky.
    let light = 0.35 * this.sunVisible * Math.max(0, Math.min(1, (35 - thetaSun) / 20));
    const h = this.container.clientHeight, w = this.container.clientWidth;
    const pxPerRad = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    for (const b of BODIES) {
      if (b.key === 'sun') continue;
      const p = this.meshes.get(b.key)!.position;
      const d = p.length();
      const ndc = this.tmp2.copy(p).project(this.camera);
      if (ndc.z > 1 || ndc.z < -1 || Math.abs(ndc.x) > 1.5 || Math.abs(ndc.y) > 1.5) continue;
      const rPx = (b.radiusKm / UNIT_KM / d) * pxPerRad;
      const share = Math.min(1, (Math.PI * rPx * rPx) / (w * h));
      if (share < 1e-3) continue;
      const toSun = this.tmp2.copy(sunPos).sub(p).normalize();
      const lit = 0.5 * (1 - toSun.dot(p) / d);             // fraction of the disc lit, seen from here
      light += share * lit * 2;
    }
    const target = 1 / (1 + 4 * light);
    const tau = target < this.adapt ? 0.3 : 2.0;
    this.adapt += (target - this.adapt) * (1 - Math.exp(-dt / tau));
    if (this.starPoints) (this.starPoints.material as THREE.ShaderMaterial).uniforms.visibility.value = this.adapt;
    if (this.stars) (this.stars.material as THREE.ShaderMaterial).uniforms.visibility.value = this.adapt;
  }

  // Per-body sunlight and shadow casters, and the camera's exposure.
  private updateLighting(sunPos: THREE.Vector3, cam: Vec3, date: Date): void {
    const m3 = new THREE.Matrix3();
    for (const [key, m] of this.materials) {
      // Body-fixed axes in render coordinates; the rows of the render ->
      // body-fixed rotation.
      const [X, Y, Z] = (bodyAxesEqj(key, date) as Vec3[]).map((a) => toRender(eqjToEcl(a) as Vec3, new THREE.Vector3()).normalize());
      m3.set(X.x, X.y, X.z, Y.x, Y.y, Y.z, Z.x, Z.y, Z.z);
      (m.uniforms.toBody.value as THREE.Matrix3).copy(m3);
      (m.uniforms.bodyCentre.value as THREE.Vector3).copy(this.meshes.get(key)!.position);
      const entry = this.manifest?.bodies[key];
      // Earth's month swaps only while Earth is seen and time runs under a
      // week a second: at a year a second the month changed every few
      // frames and the 78 MB maps were fetched and uploaded without end.
      if (entry?.dayMonthly && !this.unloadedSurfaces.has(key) && this.earthResolved && Math.abs(this.clock.snapshot.rate) <= 7 * 86400) {
        void this.surfaces.updateDay(key, entry, m, date).catch(() => {});
      }
      const r = this.states[key].r;
      const dAu = Math.hypot(r[0], r[1], r[2]) / AU_KM;
      const u = m.uniforms;
      u.irradiance.value = 1 / (dAu * dAu);
      (u.sunPos.value as THREE.Vector3).copy(sunPos);
      u.sunRadius.value = SUN_RADIUS_KM / UNIT_KM;
      const occ = u.occluders.value as THREE.Vector4[];
      const keys = this.occluderKeys.get(key)!;
      for (let i = 0; i < MAX_OCCLUDERS; i++) {
        const k = keys[i];
        if (!k) { occ[i].set(0, 0, 0, 0); continue; }
        const p = this.meshes.get(k)!.position;
        occ[i].set(p.x, p.y, p.z, BODY_BY_KEY[k].radiusKm / UNIT_KM);
      }
    }
    // Meter for sunlight where the camera is (no closer than 0.2 AU, so the
    // view from beside the Sun is not exposed for its photosphere).
    const dCamAu = Math.max(0.2, Math.hypot(cam[0], cam[1], cam[2]) / AU_KM);
    this.renderer.toneMappingExposure = EXPOSURE_1AU * dCamAu * dCamAu;
    const inv = 1 / this.renderer.toneMappingExposure;
    for (const m of this.materials.values()) m.uniforms.invExposure.value = inv;
    // Drawings at a display level (orbit lines, craft lines, the star
    // background) are divided by the exposure the output pass applies.
    this.post.exposure = this.renderer.toneMappingExposure;
    for (const o of this.orbits.values()) (o.line.material as THREE.ShaderMaterial).uniforms.level.value = inv;
    this.craftLayer.setLevel(inv);
    if (this.stars) (this.stars.material as THREE.ShaderMaterial).uniforms.level.value = inv;
    if (this.starPoints) (this.starPoints.material as THREE.ShaderMaterial).uniforms.level.value = inv;

    for (const [key, shell] of this.atmospheres) {
      const p = this.meshes.get(key)!.position;
      shell.position.copy(p);
      const u = (shell.material as THREE.ShaderMaterial).uniforms;
      (u.centre.value as THREE.Vector3).copy(p);
      (u.sunDir.value as THREE.Vector3).copy(sunPos).sub(p).normalize();
      u.irradiance.value = this.materials.get(key)!.uniforms.irradiance.value;
      u.inside.value = p.length() * UNIT_KM < (u.atmoRt.value as number) ? 1 : 0;
      // From inside, the shell's far side lies behind the planet: draw it
      // regardless of depth (the shader stops each ray at the ground).
      (shell.material as THREE.ShaderMaterial).depthTest = u.inside.value < 0.5;
    }

    if (this.rings) {
      const sat = this.materials.get('saturn')!;
      const pole = new THREE.Vector3(0, 0, 1).applyMatrix3((sat.uniforms.toBody.value as THREE.Matrix3).clone().transpose());
      const p = this.meshes.get('saturn')!.position;
      this.rings.position.copy(p);
      this.rings.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), pole.normalize());
      const u = (this.rings.material as THREE.ShaderMaterial).uniforms;
      (u.normal.value as THREE.Vector3).copy(pole);
      u.irradiance.value = sat.uniforms.irradiance.value;
      (u.sunPos.value as THREE.Vector3).copy(sunPos);
      u.sunRadius.value = SUN_RADIUS_KM / UNIT_KM;
      (u.planetPos.value as THREE.Vector3).copy(p);
      u.planetRadius.value = BODY_BY_KEY.saturn.radiusKm / UNIT_KM;
    }
  }

  // Markers and labels at each body's projected position. The dot hides once
  // the body itself is bigger than a few pixels.
  private placeLabels(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const pxPerRad = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const dpr = window.devicePixelRatio || 1;     // the screen's pixels, not the render scale
    const screen = new Map<BodyKey, [number, number]>();
    // Discs big enough to hide what lies behind them: x, y, radius in px,
    // distance from the camera.
    const discs: [number, number, number, number][] = [];
    for (const b of BODIES) {
      const p = this.meshes.get(b.key)!.position;
      const ndc = this.tmp.copy(p).project(this.camera);
      if (ndc.z > 1 || ndc.z < -1) continue;
      const rPx = (b.radiusKm / UNIT_KM / p.length()) * pxPerRad;
      if (rPx > 4) discs.push([((ndc.x + 1) / 2) * w, ((1 - ndc.y) / 2) * h, rPx, p.length()]);
    }
    const named: { el: HTMLDivElement; x: number; y: number; key: BodyKey; r: number }[] = [];
    for (const b of BODIES) {
      const el = this.labels.get(b.key)!;
      const p = this.meshes.get(b.key)!.position;
      const ndc = this.tmp.copy(p).project(this.camera);
      const behind = ndc.z > 1 || ndc.z < -1;
      if (behind) { el.style.display = 'none'; continue; }
      const distRender = p.length();
      const radiusPx = (b.radiusKm / UNIT_KM / distRender) * pxPerRad;
      // Whole device pixels: a fractional offset resamples the label's text.
      const x = Math.round(((ndc.x + 1) / 2) * w * dpr) / dpr, y = Math.round(((1 - ndc.y) / 2) * h * dpr) / dpr;
      screen.set(b.key, [x, y]);
      // A moon that sits on top of its planet's marker is hidden until the
      // camera is close enough to separate them (unless it is the focus).
      const ps = b.parent && b.parent !== 'sun' ? screen.get(b.parent) : undefined;
      if (ps && b.key !== this.focus && Math.hypot(x - ps[0], y - ps[1]) < 14) {
        el.style.display = 'none'; continue;
      }
      // A body behind a nearer body's disc is out of sight: so is its label.
      if (discs.some(([dx, dy, dr, dd]) => dd < distRender && Math.hypot(x - dx, y - dy) < dr)) {
        el.style.display = 'none'; continue;
      }
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
      named.push({ el, x, y, key: b.key, r: b.radiusKm });
      el.classList.toggle('resolved', radiusPx > 4);
      if (b.key === 'earth') this.earthResolved = radiusPx > 3;
      if (radiusPx > 3) this.loadSurfaces(b.key);
      el.classList.toggle('focused', b.key === this.focus && this.focusCraftId === null);
    }
    // Names that would overprint one another: the focus keeps its name, then
    // the larger body; the smaller keeps only its marker (its name shows on
    // hover). Boxes are estimated from the name's length at 9 px Michroma.
    named.sort((a, b) => Number(b.key === this.focus) - Number(a.key === this.focus) || b.r - a.r);
    const boxes: [number, number, number, number][] = [];
    for (const n of named) {
      const box: [number, number, number, number] = [n.x, n.y - 9, n.x + 22 + 9 * n.key.length, n.y + 9];
      const hit = boxes.some((o) => box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3]);
      n.el.classList.toggle('quiet', hit);
      if (!hit) boxes.push(box);
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.container.removeEventListener('wheel', this.onWheel);
    this.resizeObserver.disconnect();
    this.craftLayer.dispose();
    this.smallBodies.dispose();
    for (const el of this.labels.values()) el.remove();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

