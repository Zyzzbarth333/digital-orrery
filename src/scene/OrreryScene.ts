// src/scene/OrreryScene.ts
//
// The 3D solar system, at true scale and true positions.
//
// Positions: every frame, each body's heliocentric ecliptic J2000 state comes
// from the ephemeris (src/physics/ephemeris.js: DE442's table for 2000-2050,
// astronomy-engine outside it). Orbit lines
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
// Shapes: each body is its IAU triaxial ellipsoid (catalogue.ts, radiiKm),
// turned with its body-fixed frame every frame (orientation.js), so Saturn
// shows its 10 % flattening and Phobos its 26 x 23 x 18 km.
//
// Light: the Sun is the only light, falling off as 1/d^2, with eclipses
// (bodyMaterial.ts) and Earth's atmosphere (atmosphere.ts). The exposure is metered for sunlight at the camera's
// distance from the Sun, like a camera on a spacecraft there. True-scale
// bodies are usually far below a pixel, so each has a constant-size marker
// and label in an HTML overlay.

import * as THREE from 'three';
import { helioStateEcl, eqjToEcl, eclToEqj, ttSeconds } from '../physics/ephemeris.js';
import { bodyAxesEqj } from '../physics/orientation.js';
import { systemEqj, moonPositionEqj, MOONS_OF } from '../physics/moons.js';
import { moonTablesVersion, wantMoonTables } from '../physics/moonTables.js';
import { baryStateEqj } from '../physics/barycentres.js';
import type { SimClock } from '../app/clock';
import { BODIES, BODY_BY_KEY, BARYS, BARY_BY_KEY, isBary, isPlanetMoon, maxRadiusKm, systemOf, type BaryKey, type BodyKey, type FocusKey } from './catalogue';
import { makeBodyMaterial, MAX_OCCLUDERS, applyAtmosphere, applyRingShadow, applySurfaceMaps, clearCloud, shadowAxes } from './bodyMaterial';
import { makeRings, tauTexture, type RingProfile } from './rings';
import { makeStarPoints, makeStars, resetStars, setStarScale } from './stars';
import { DailyEarth } from './clouds';
import { CraftLayer, type CraftView } from './craftLayer';
import { JourneyLayer } from './journeyLayer';
import type { JourneyView, JourneyHandlers } from '../app/journey';
import { SmallBodyLayer } from './smallBodies';
import { GuideLayer } from './guides';
import { orbitTrailMaterial } from './orbitTrail';
import { EARTH_ATMOSPHERE, makeAtmosphere, type AtmosphereParams } from './atmosphere';
import { BASE as TEXTURE_BASE, loadBinary, loadJson, loadManifest, SurfaceLoader, TextureUploader, type Manifest } from './surfaces';
import { CameraRig, type Anchor } from './cameraRig';
import { HdrPipeline } from './post';
import { makeSunMaterial, SunGlare, visibleFraction } from './sun';
import { RenderScale } from './renderScale';

const UNIT_KM = 1000;                 // one render unit = 1000 km
const ORBIT_SAMPLES = 360;
// The stretch of an orbit around its body, drawn finely for the focused
// body (and its planet, for a moon): 360
// samples leave each chord a degree long, which bows up to 5,700 km off the
// Earth's orbit (as wide as the Earth) and shows as a bent, offset line up
// close. This window, 0.5 % of a period either side in 256 steps, keeps the
// chords' bow near a kilometre at 1 au.
const NEAR_HALF = 0.005, NEAR_SAMPLES = 256;
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
// Bodies whose surfaces are bare regolith (Lommel-Seeliger scattering):
// these, and every moon but Titan, which is wrapped in haze.
const AIRLESS: ReadonlySet<BodyKey> = new Set<BodyKey>(['mercury', 'moon', 'pluto',
  ...BODIES.filter((b) => isPlanetMoon(b.key) && b.key !== 'titan').map((b) => b.key)]);
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

// Planets whose moons are drawn (moons.js). The ephemeris places each at
// its system barycentre; the scene draws the planet at its own centre,
// offset from that by its moons' pull (2,100 km for Pluto), and each moon
// about that centre.
const SYSTEMS: ReadonlySet<BodyKey> = new Set(Object.keys(MOONS_OF) as BodyKey[]);

// The moons' tables (moonTables.js) are fetched for a system in view: the
// focused one, and any the camera is within MOON_TABLE_RANGE_KM of. Each
// fetch covers the years its moons' orbit lines span (half the longest
// period either side; Ferdinand's is 7.6 years).
const MOON_TABLE_RANGE_KM = 3e7;
const MOON_LINE_DAYS = Object.fromEntries([...SYSTEMS].map((p) =>
  [p, Math.max(...(MOONS_OF as Record<string, string[]>)[p].map((k) => BODY_BY_KEY[k as BodyKey].periodDays ?? 0)) / 2])) as Record<string, number>;

function addEcl(base: BodyState, rel: { r: number[]; v: number[] }): BodyState {
  const r = eqjToEcl(rel.r), v = eqjToEcl(rel.v);
  return { r: [base.r[0] + r[0], base.r[1] + r[1], base.r[2] + r[2]], v: [base.v[0] + v[0], base.v[1] + v[1], base.v[2] + v[2]] };
}

// A planet (at its centre), its moons and its system's barycentre,
// heliocentric ecliptic J2000.
export function systemStates(planet: BodyKey, date: Date): Partial<Record<FocusKey, BodyState>> {
  const bary = helioStateEcl(planet, date) as BodyState;
  const { moons, offset } = systemEqj(planet, date);
  const centre = addEcl(bary, offset);
  const out: Partial<Record<FocusKey, BodyState>> = { [planet]: centre, [`${planet}-bary`]: bary };
  for (const [k, st] of Object.entries(moons) as [BodyKey, { r: number[]; v: number[] }][]) out[k] = addEcl(centre, st);
  return out;
}

export function bodyState(key: BodyKey, date: Date): BodyState {
  if (key === 'sun') return { r: [0, 0, 0], v: [0, 0, 0] };
  if (isPlanetMoon(key)) return systemStates(BODY_BY_KEY[key].parent!, date)[key]!;
  if (SYSTEMS.has(key)) return systemStates(key, date)[key]!;
  return helioStateEcl(key, date) as BodyState;
}

// A barycentre, heliocentric ecliptic J2000 (barycentres.js).
export function baryState(key: BaryKey, date: Date): BodyState {
  if (key.endsWith('-bary')) return helioStateEcl(key.replace('-bary', ''), date) as BodyState;
  const s = baryStateEqj(key, date);
  return { r: eqjToEcl(s.r) as Vec3, v: eqjToEcl(s.v) as Vec3 };
}

// The frame orbits and distances are given in: the Sun's centre, or the
// solar system barycentre (the Sun then has a path of its own about it).
export type Frame = 'sun' | 'ssb';
// The Sun's path about the SSB is drawn over two of Jupiter's years.
const SUN_PATH_DAYS = 2 * 4332.59;
// The SSB for orbit lines and the SSB frame, as barycentres.js gives it:
// DE442's own (one series) inside its table, blended at its ends into the
// sum over every body used outside it. The line's origin is this same
// point, so the line still passes through its body.
function ssbForLines(date: Date): Vec3 {
  return eqjToEcl(baryStateEqj('ssb', date).r) as Vec3;
}

// Where a body's orbit line is centred, and over how many days it runs.
function orbitOrigin(key: BodyKey, frame: Frame): BodyKey | 'ssb' | null {
  const parent = BODY_BY_KEY[key].parent;
  if (frame === 'ssb' && (parent === 'sun' || key === 'sun')) return 'ssb';
  return parent;
}
function orbitDays(key: BodyKey, frame: Frame): number | null {
  if (key === 'sun') return frame === 'ssb' ? SUN_PATH_DAYS : null;
  return BODY_BY_KEY[key].periodDays;
}

// A body's position about its line's origin (km, ecliptic): a moon's
// straight from its model, without the planet's heliocentric state.
function relativePosition(key: BodyKey, date: Date, frame: Frame): Vec3 {
  if (isPlanetMoon(key)) return eqjToEcl(moonPositionEqj(key, date)) as Vec3;
  const origin = orbitOrigin(key, frame)!;
  if (origin === 'ssb') return sub(key === 'sun' ? [0, 0, 0] : bodyState(key, date).r, ssbForLines(date));
  return sub(bodyState(key, date).r, bodyState(origin, date).r);
}

// The fine stretch about the focused body: its centre time and its centre's
// position about the parent (km), which the line's vertices are relative
// to, so float32 keeps them to metres.
interface NearOrbit { key: BodyKey; line: THREE.Line; centreMs: number; centreKm: Vec3; epochMs: number; frame: Frame }

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
  private moonTablesSeen = -1;
  private nearOrbits = new Map<BodyKey, NearOrbit>();
  private labels = new Map<BodyKey, HTMLDivElement>();
  private baryLabels = new Map<BaryKey, HTMLDivElement>();
  private baryPos = new Map<BaryKey, THREE.Vector3>(BARYS.map((b) => [b.key, new THREE.Vector3()]));
  private ssbLinePos = new THREE.Vector3();
  refFrame: Frame = 'sun';
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
  private states = {} as Record<FocusKey, BodyState>;
  private raf = 0;
  private lastFrame = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private resizeObserver: ResizeObserver;

  // The camera orbits a pivot on the focused body or craft and flies
  // between them (cameraRig.ts). `focus` is the body the panels describe;
  // it changes at the click, while the camera is still on its way.
  focus: FocusKey = 'sun';
  private rig: CameraRig;
  // Zoom the user chose, carried to the next body: in body radii for
  // planets and moons, in km for the Sun's view and for craft.
  private userRadii: number | null = null;
  private sunDist: number | null = null;
  private craftDist: number | null = null;
  private lastCrafts: CraftView[] = [];

  private sunViewPending = false;
  private sunViewPhase = 0.35;

  onFocusChange: (key: FocusKey) => void = () => {};
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
  // A named asteroid or comet the camera is on (smallBodies.ts), like a
  // followed craft: `focus` keeps the last body.
  focusSmall: string | null = null;
  onSmallPick: (pdes: string) => void = () => {};
  private craftLayer!: CraftLayer;
  // The journey being planned (journeyLayer.ts): its arcs and burn nodes.
  journeySource: () => JourneyView | null = () => null;
  // While a full-screen view covers the sky (the plotting table), stop
  // drawing it; the clock and the mission keep running.
  private paused = false;
  setPaused(on: boolean): void {
    if (this.paused === on) return;
    this.paused = on;
    if (!on) this.lastFrame = performance.now();
  }
  // What dragging its nodes and aims does (the app's JourneyStore).
  journeyHandlers: JourneyHandlers | null = null;
  private journeyLayer!: JourneyLayer;
  private journeyCentral = (key: string): Vec3 | null => (key === 'sun' ? [0, 0, 0] : this.states[key as BodyKey]?.r ?? null);
  // The asteroids and comets (smallBodies.ts), for the rail's toggles.
  smallBodies!: SmallBodyLayer;
  guides!: GuideLayer;           // spin axes, gravity fields, SOI and Hill spheres, Lagrange points, pulls

  private bodyAnchor(key: FocusKey): Anchor {
    // A barycentre is a point: the camera may close to a kilometre.
    return { id: `body:${key}`, pos: () => this.states[key]?.r ?? (key === 'sun' ? [0, 0, 0] : null), minDist: isBary(key) ? 1 : maxRadiusKm(key) * 1.2 };
  }

  private smallAnchor(pdes: string): Anchor {
    return { id: `small:${pdes}`, pos: () => this.smallBodies.positionKm(pdes, this.clock.snapshot.timeMs), minDist: this.smallBodies.radiusKm(pdes) * 1.2 };
  }

  // Fly to a named small body: framed at eight radii, at least 1 km out.
  focusOnSmall(pdes: string): void {
    if (!this.smallBodies.body(pdes)) return;
    if (this.rig.flying && this.rig.destination.id === `small:${pdes}`) return;
    this.focusCraftId = null;
    this.focusSmall = pdes;
    this.smallBodies.setFocus(pdes);
    this.rig.flyTo(this.smallAnchor(pdes), Math.max(this.smallBodies.radiusKm(pdes) * 8, 1));
    this.onFlight(this.rig.flying);
    this.onSmallPick(pdes);
  }
  private clearSmall(): void {
    if (this.focusSmall === null) return;
    this.focusSmall = null;
    this.smallBodies.setFocus(null);
  }

  private craftAnchor(id: number): Anchor {
    const find = (list: CraftView[]) => list.find((c) => c.id === id)?.rEcl ?? null;
    return { id: `craft:${id}`, pos: () => find(this.lastCrafts) ?? find(this.craftSource()), minDist: 0.05 };
  }

  // Where a flight to a body ends: the user's zoom in radii if they set
  // one (within reason), else the default framing; the Sun's overview.
  private arrivalDist(key: FocusKey, reframe: boolean): number {
    if (isBary(key)) return BARY_BY_KEY[key].viewKm;     // framing the system about it
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
    // A unit sphere with its poles on local Z, scaled per body to its
    // ellipsoid along body-fixed X, Y, Z (the mesh turns with the body).
    const sphere = new THREE.SphereGeometry(1, 96, 48).rotateX(Math.PI / 2);
    for (const b of BODIES) {
      let material: THREE.Material;
      if (b.key === 'sun') {
        material = makeSunMaterial();
      } else {
        const m = makeBodyMaterial(b.colour, b.geometricAlbedo ?? 0.3, AIRLESS.has(b.key));
        this.materials.set(b.key, m);
        material = m;
        // A body can be shadowed by its parent (not the Sun) and its moons,
        // the largest first.
        const occ = BODIES.filter((o) => o.parent === b.key).sort((x, y) => y.radiusKm - x.radiusKm).map((o) => o.key);
        if (b.parent && b.parent !== 'sun') occ.unshift(b.parent);
        this.occluderKeys.set(b.key, occ.slice(0, MAX_OCCLUDERS));
      }
      const mesh = new THREE.Mesh(sphere, material);
      const [ra, rb, rc] = b.radiiKm;
      mesh.scale.set(ra / UNIT_KM, rb / UNIT_KM, rc / UNIT_KM);
      this.scene.add(mesh);
      this.meshes.set(b.key, mesh);
      this.labels.set(b.key, this.makeLabel(b.key, b.name));
    }
    // Barycentres: a marker and label, no body.
    for (const b of BARYS) this.baryLabels.set(b.key, this.makeLabel(b.key, b.short, 'bary'));

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
        // A 2048-wide preview first (0.6 MB, on screen in about a second),
        // then the full map, which takes seconds to decode, in its place.
        const show = (tex: THREE.Texture) => {
          if (this.stars) { (this.stars.material as THREE.ShaderMaterial).uniforms.starMap.value = tex; return; }
          this.stars = makeStars(tex, renderToEqj(), stars.raAtLeftDeg, stars.raIncreasesRight, gain,
            stars.detail && { entry: stars.detail, base: TEXTURE_BASE });
          this.scene.add(this.stars);
        };
        let full = false;
        if (stars.preview) void this.surfaces.load(stars.preview, true).then((tex) => { if (!full) show(tex); }).catch(() => {});
        void this.surfaces.load(stars.map, true).then((tex) => {
          full = true;
          show(tex);
          if (stars.preview) this.surfaces.drop(stars.preview);
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
    this.journeyLayer = new JourneyLayer(this.scene, this.overlay, () => this.journeyHandlers);
    this.smallBodies = new SmallBodyLayer(this.scene, this.overlay, import.meta.env.BASE_URL);
    this.guides = new GuideLayer(this.scene, this.overlay, toRender,
      (date) => toRender(eqjToEcl(bodyAxesEqj('sun', date)[2]) as Vec3, new THREE.Vector3()).normalize());
    this.smallBodies.setScale(this.scale.max, this.renderer.getPixelRatio());
    this.smallBodies.onPick = (pdes) => this.focusOnSmall(pdes);
    // The GPU can drop the WebGL context (sleep, driver reset, memory
    // pressure): say so rather than show a black view, and carry on when the
    // browser restores it.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost(true); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => { this.reloadMaps(); this.onContextLost(false); });
    this.attachControls();
    // ?debug exposes the scene as window.orrery, for the frame-time harness
    // (docs/performance.md#measuring) and for poking at it from the console.
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { orrery: OrreryScene }).orrery = this;
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

  private makeLabel(key: FocusKey, name: string, kind = ''): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `body-marker${kind ? ` ${kind}` : ''}`;
    if (isBary(key)) el.title = BARY_BY_KEY[key].name;
    el.innerHTML = `<span class="dot"></span><span class="name">${name}</span>`;
    el.addEventListener('click', () => this.focusOn(key));
    this.overlay.appendChild(el);
    return el;
  }

  // Follow a craft: fly to it, or (immediate) start there.
  focusOnCraft(id: number, immediate = false): void {
    this.clearSmall();
    this.focusCraftId = id;
    const d = this.craftDist ?? 2.0e4;
    if (immediate) this.rig.jumpTo(this.craftAnchor(id), d);
    else this.rig.flyTo(this.craftAnchor(id), d);
    this.onFlight(this.rig.flying);
  }

  // Fly to a body. Choosing the body already in view reframes it at the
  // default distance; choosing the body a flight is already heading for
  // changes nothing.
  focusOn(key: FocusKey): void {
    if (this.rig.flying && this.rig.destination.id === `body:${key}`) return;
    const reframe = key === this.focus && this.focusCraftId === null && this.focusSmall === null;
    this.focusCraftId = null;
    this.clearSmall();
    this.focus = key;
    if (!isBary(key)) this.loadSurfaces(key);   // start now: the flight hides the upload
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
    // A press that does not move (a click) goes to the journey: a burn
    // node on the arc under it, or the selection cleared.
    let sx = 0, sy = 0, travel = 0;
    el.addEventListener('pointerdown', (e) => {
      if (pointer !== null) return;
      pointer = e.pointerId; lx = sx = e.clientX; ly = sy = e.clientY; travel = 0; el.setPointerCapture(e.pointerId);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (e.type === 'pointerup' && travel < 4) this.journeyLayer.click(sx, sy);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pointer) return;
      travel = Math.max(travel, Math.hypot(e.clientX - sx, e.clientY - sy));
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
    const focus = this.focus;
    const small = this.focusSmall;
    const minDist = craft ? 0.05 : small ? this.smallBodies.radiusKm(small) * 1.2 : isBary(focus) ? 1 : maxRadiusKm(focus) * 1.2;
    // Lines are 3 % of a page; pixels as they come.
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    this.rig.zoom(Math.exp(dy * 0.0015), minDist, 2.0e10);
    const goal = this.rig.goalDistance;
    if (craft) this.craftDist = goal;
    else if (small) { /* a small body's zoom is its own */ }
    else if (focus === 'sun') this.sunDist = goal;
    else if (!isBary(focus)) this.userRadii = goal / BODY_BY_KEY[focus].radiusKm;
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

  // Sample a body's orbit about its origin (its parent, or the SSB) from
  // the ephemeris, centred on t.
  private sampleOrbit(key: BodyKey, tMs: number): THREE.Line | null {
    const b = BODY_BY_KEY[key];
    const days = orbitDays(key, this.refFrame);
    if (!orbitOrigin(key, this.refFrame) || !days) return null;
    const pts = new Float32Array((ORBIT_SAMPLES + 1) * 3);
    const us = new Float32Array(ORBIT_SAMPLES + 1);
    const span = days * 86400e3;
    for (let i = 0; i <= ORBIT_SAMPLES; i++) {
      const d = new Date(tMs - span / 2 + (span * i) / ORBIT_SAMPLES);
      toRender(relativePosition(key, d, this.refFrame), this.tmp);
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

  // The fine stretches: the focused body's, and its planet's when it is a
  // moon (the planet's orbit passes the camera too). Each is resampled when
  // its body has moved a fifth of the way to its edge, or its coarse line
  // is resampled (the trail's offsets count from that line's centre).
  private updateNearOrbits(tMs: number): void {
    const want = new Set<BodyKey>();
    const drawn = (k: BodyKey) => !!orbitOrigin(k, this.refFrame) && !!orbitDays(k, this.refFrame);
    if (this.focusCraftId === null && !isBary(this.focus)) {
      const f = BODY_BY_KEY[this.focus as BodyKey];
      if (drawn(f.key)) want.add(f.key);
      if (f.parent && isPlanetMoon(f.key) && drawn(f.parent)) want.add(f.parent);
    }
    for (const k of [...this.nearOrbits.keys()]) if (!want.has(k)) this.dropNearOrbit(k);
    for (const key of want) {
      const b = BODY_BY_KEY[key], o = this.orbits.get(key), frame = this.refFrame;
      if (!o) continue;
      // The coarse line's span (a period, or the Sun's drawn path about the
      // SSB): its trail offsets count in it.
      const period = orbitDays(key, frame)! * 86400e3, half = NEAR_HALF * period, n = this.nearOrbits.get(key);
      if (n && n.epochMs === o.epochMs && n.frame === frame && Math.abs(tMs - n.centreMs) < 0.2 * half) continue;
      if (n) this.dropNearOrbit(key);
      const centreKm = relativePosition(key, new Date(tMs), frame);
      const pts = new Float32Array((NEAR_SAMPLES + 1) * 3), us = new Float32Array(NEAR_SAMPLES + 1);
      for (let i = 0; i <= NEAR_SAMPLES; i++) {
        const t = tMs - half + (2 * half * i) / NEAR_SAMPLES;
        toRender(sub(relativePosition(key, new Date(t), frame), centreKm), this.tmp);
        pts.set([this.tmp.x, this.tmp.y, this.tmp.z], i * 3);
        us[i] = (t - o.epochMs) / period;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      geom.setAttribute('u', new THREE.BufferAttribute(us, 1));
      const line = new THREE.Line(geom, orbitTrailMaterial(b.colour));
      line.frustumCulled = false;
      this.scene.add(line);
      this.nearOrbits.set(key, { key, line, centreMs: tMs, centreKm, epochMs: o.epochMs, frame });
      // The coarse line leaves this stretch to it.
      (o.line.material as THREE.ShaderMaterial).uniforms.gap.value.set((tMs - o.epochMs) / period, NEAR_HALF);
    }
  }

  private dropNearOrbit(key: BodyKey): void {
    const n = this.nearOrbits.get(key);
    if (!n) return;
    this.scene.remove(n.line); n.line.geometry.dispose(); (n.line.material as THREE.Material).dispose();
    const o = this.orbits.get(key);
    if (o) (o.line.material as THREE.ShaderMaterial).uniforms.gap.value.set(0, -1);
    this.nearOrbits.delete(key);
  }

  private updateOrbits(tMs: number, now: number): void {
    const start = performance.now();
    // A year of the moons' tables has arrived: their lines are redrawn
    // from it (they were drawn from the mean elements).
    if (moonTablesVersion() !== this.moonTablesSeen) {
      this.moonTablesSeen = moonTablesVersion();
      for (const [key, o] of this.orbits) if (isPlanetMoon(key)) { o.epochMs = NaN; o.sampledAt = -Infinity; }
    }
    for (const b of BODIES) {
      const days = orbitDays(b.key, this.refFrame);
      if (!orbitOrigin(b.key, this.refFrame) || !days) continue;
      const o = this.orbits.get(b.key);
      const period = days * 86400e3;
      // Resample when the sim has moved 5 % of a period (the orbit precesses
      // and the drawn span should stay centred), at most twice a second per
      // line and for at most 2 ms a frame (a planet's line costs about 3 ms,
      // a moon's a tenth of that), so time warp does not stall a frame.
      if (o && (Math.abs(tMs - o.epochMs) < 0.05 * period || now - o.sampledAt < 500)) continue;
      const line = this.sampleOrbit(b.key, tMs);
      if (!line) continue;
      if (o) {
        this.dropNearOrbit(b.key);
        this.scene.remove(o.line); o.line.geometry.dispose(); (o.line.material as THREE.Material).dispose();
      }
      this.scene.add(line);
      this.orbits.set(b.key, { line, epochMs: tMs, sampledAt: now });
      if (performance.now() - start > 2) return;
    }
  }

  // Give orbits and distances about the Sun's centre or the SSB: the
  // lines about the one change (the moons' stay about their planets).
  setFrame(frame: Frame): void {
    if (frame === this.refFrame) return;
    this.refFrame = frame;
    for (const b of BODIES) {
      if (b.parent !== 'sun' && b.key !== 'sun') continue;
      const o = this.orbits.get(b.key);
      if (!o) continue;
      this.scene.remove(o.line); o.line.geometry.dispose(); (o.line.material as THREE.Material).dispose();
      this.orbits.delete(b.key);
    }
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    // Paused (the plotting table covers the sky): the clock and the mission
    // run on, nothing is drawn, and the render-scale budget sees no frame.
    if (this.paused) {
      this.clock.tick((now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.onFrame(this.clock.snapshot.timeMs, this.clock.snapshot.jumps);
      return;
    }
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

    for (const b of BODIES) {
      if (isPlanetMoon(b.key)) continue;                // with its planet
      if (SYSTEMS.has(b.key)) Object.assign(this.states, systemStates(b.key, date));
      else this.states[b.key] = bodyState(b.key, date);
    }
    // The other barycentres (the planet systems' came with them).
    this.states.ssb = baryState('ssb', date);
    this.states.emb = baryState('emb', date);
    if (this.earthResolved) this.dailyEarth.update(tMs, this.clock.snapshot.playing ? this.clock.snapshot.rate : 0);
    this.updateOrbits(tMs, now);
    this.updateNearOrbits(tMs);

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
    const sys = this.focusCraftId === null ? systemOf(this.focus) : null;
    for (const p of SYSTEMS) {
      const r = this.states[p].r;
      if (p === sys || Math.hypot(r[0] - cam[0], r[1] - cam[1], r[2] - cam[2]) < MOON_TABLE_RANGE_KM) {
        wantMoonTables(p, ttSeconds(tMs), MOON_LINE_DAYS[p]);
      }
    }

    for (const b of BODIES) {
      toRender(sub(this.states[b.key].r, cam), this.meshes.get(b.key)!.position);
    }
    for (const b of BARYS) toRender(sub(this.states[b.key].r, cam), this.baryPos.get(b.key)!);
    if (this.refFrame === 'ssb') toRender(sub(ssbForLines(date), cam), this.ssbLinePos);
    const sunPos = this.meshes.get('sun')!.position;
    this.updateLighting(sunPos, cam, date);
    for (const b of BODIES) {
      const o = this.orbits.get(b.key);
      const origin = orbitOrigin(b.key, this.refFrame), days = orbitDays(b.key, this.refFrame);
      if (o && origin && days) {
        o.line.position.copy(origin === 'ssb' ? this.ssbLinePos : this.meshes.get(origin)!.position);
        (o.line.material as THREE.ShaderMaterial).uniforms.now.value = (tMs - o.epochMs) / (days * 86400e3);
      }
    }
    for (const n of this.nearOrbits.values()) {
      const origin = orbitOrigin(n.key, n.frame);
      if (!origin || !this.orbits.get(n.key)) continue;
      n.line.position.copy(origin === 'ssb' ? this.ssbLinePos : this.meshes.get(origin)!.position).add(toRender(n.centreKm, this.tmp));
      const m = n.line.material as THREE.ShaderMaterial, c = this.orbits.get(n.key)!.line.material as THREE.ShaderMaterial;
      m.uniforms.now.value = c.uniforms.now.value;
      n.line.visible = this.orbits.get(n.key)!.line.visible;
    }

    this.craftLayer.place(crafts, cam, UNIT_KM);
    const journey = this.journeySource();
    this.journeyLayer.place(journey, this.journeyCentral, cam, UNIT_KM, dist);

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(toRender([-offset[0], -offset[1], -offset[2]], this.tmp));
    this.camera.updateMatrixWorld();
    this.updateGlare(sunPos, cam, now);
    this.updateAdaptation(dtReal, sunPos);
    this.smallBodies.update(tMs, cam, 1 / this.renderer.toneMappingExposure, this.adapt);
    this.guides.update({ camera: this.camera, states: this.states, cam, meshes: this.meshes, materials: this.materials,
      // A barycentre has no surface, axis or pulls of its own: no focus for the guides.
      focus: this.focusCraftId === null && !isBary(this.focus) ? this.focus : null, width: this.container.clientWidth, height: this.container.clientHeight,
      level: 1 / this.renderer.toneMappingExposure, date });

    this.smallBodies.renderHaze(this.renderer, this.camera);
    this.post.render(this.renderer, this.scene, this.camera);
    this.placeLabels();
    this.craftLayer.label(crafts, cam, UNIT_KM, this.camera, this.container.clientWidth, this.container.clientHeight);
    this.journeyLayer.label(this.journeyCentral, cam, UNIT_KM, this.camera, this.container.clientWidth, this.container.clientHeight);
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
    const basis = new THREE.Matrix4();
    for (const [key, m] of this.materials) {
      // Body-fixed axes in render coordinates; the rows of the render ->
      // body-fixed rotation. The mesh turns with them, so its ellipsoid's
      // axes are the body's.
      const [X, Y, Z] = (bodyAxesEqj(key, date) as Vec3[]).map((a) => toRender(eqjToEcl(a) as Vec3, new THREE.Vector3()).normalize());
      (m.uniforms.toBody.value as THREE.Matrix3).set(X.x, X.y, X.z, Y.x, Y.y, Y.z, Z.x, Z.y, Z.z);
      this.meshes.get(key)!.quaternion.setFromRotationMatrix(basis.makeBasis(X, Y, Z));
    }
    // Each shadow caster's map to its unit sphere (ELLIPSOID_SHADOW).
    const casters = new Map<BodyKey, { A: THREE.Matrix3; k: number }>();
    const caster = (k: BodyKey) => {
      let c = casters.get(k);
      if (!c) {
        const A = new THREE.Matrix3();
        const r = BODY_BY_KEY[k].radiiKm.map((x) => x / UNIT_KM) as [number, number, number];
        c = { A, k: shadowAxes(this.materials.get(k)!.uniforms.toBody.value as THREE.Matrix3, r, A) };
        casters.set(k, c);
      }
      return c;
    };
    for (const [key, m] of this.materials) {
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
      const occAxes = u.occAxes.value as THREE.Matrix3[];
      const keys = this.occluderKeys.get(key)!;
      for (let i = 0; i < MAX_OCCLUDERS; i++) {
        const k = keys[i];
        if (!k) { occ[i].set(0, 0, 0, 0); continue; }
        const p = this.meshes.get(k)!.position;
        const c = caster(k);
        occ[i].set(p.x, p.y, p.z, c.k);
        occAxes[i].copy(c.A);
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
    for (const n of this.nearOrbits.values()) (n.line.material as THREE.ShaderMaterial).uniforms.level.value = inv;
    this.craftLayer.setLevel(inv);
    this.journeyLayer?.setLevel(inv);
    if (this.stars) (this.stars.material as THREE.ShaderMaterial).uniforms.level.value = inv;
    if (this.starPoints) (this.starPoints.material as THREE.ShaderMaterial).uniforms.level.value = inv;

    for (const [key, shell] of this.atmospheres) {
      const mesh = this.meshes.get(key)!;
      const p = mesh.position;
      const body = this.materials.get(key)!;
      // The shell is the ellipsoid scaled from the ground sphere's radius to
      // its top's, turned with the body; its shader works in the ground
      // sphere's space (atmoShape: rows X Rg/a, Y Rg/b, Z Rg/c).
      const u = (shell.material as THREE.ShaderMaterial).uniforms;
      const Rg = u.atmoRg.value as number;
      const [ra, rb, rc] = BODY_BY_KEY[key].radiiKm;
      shell.position.copy(p);
      shell.quaternion.copy(mesh.quaternion);
      shell.scale.set(ra / Rg, rb / Rg, rc / Rg);
      const shape = u.atmoShape.value as THREE.Matrix3;
      shadowAxes(body.uniforms.toBody.value as THREE.Matrix3, [ra / Rg, rb / Rg, rc / Rg], shape);
      (body.uniforms.atmoShape.value as THREE.Matrix3).copy(shape);
      (u.centre.value as THREE.Vector3).copy(p);
      (u.sunDir.value as THREE.Vector3).copy(sunPos).sub(p).normalize();
      u.irradiance.value = body.uniforms.irradiance.value;
      u.inside.value = this.tmp.copy(p).applyMatrix3(shape).length() * UNIT_KM < (u.atmoRt.value as number) ? 1 : 0;
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
      const c = caster('saturn');
      (u.planetAxes.value as THREE.Matrix3).copy(c.A);
      u.planetK.value = c.k;
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
    const named: { el: HTMLDivElement; x: number; y: number; key: FocusKey; r: number }[] = [];
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
      el.classList.toggle('focused', b.key === this.focus && this.focusCraftId === null && this.focusSmall === null);
    }
    // Barycentres: hidden while they sit on their body's marker (unless
    // focused). They are drawn over discs, the Sun's or a planet's, that
    // they lie inside: the SSB is often within the Sun.
    for (const b of BARYS) {
      const el = this.baryLabels.get(b.key)!;
      const ndc = this.tmp.copy(this.baryPos.get(b.key)!).project(this.camera);
      if (ndc.z > 1 || ndc.z < -1) { el.style.display = 'none'; continue; }
      const x = Math.round(((ndc.x + 1) / 2) * w * dpr) / dpr, y = Math.round(((1 - ndc.y) / 2) * h * dpr) / dpr;
      const focused = b.key === this.focus && this.focusCraftId === null && this.focusSmall === null;
      const ps = screen.get(b.of);
      if (!focused && ps && Math.hypot(x - ps[0], y - ps[1]) < 14) { el.style.display = 'none'; continue; }
      el.style.display = '';
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.classList.toggle('focused', focused);
      named.push({ el, x, y, key: b.key, r: 0 });
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
    this.journeyLayer.dispose();
    this.smallBodies.dispose();
    this.guides.dispose();
    for (const el of this.labels.values()) el.remove();
    for (const el of this.baryLabels.values()) el.remove();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

