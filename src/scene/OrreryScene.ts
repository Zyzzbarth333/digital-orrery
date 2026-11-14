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
import { makeStars } from './stars';
import { DailyEarth } from './clouds';
import { CraftLayer, type CraftView } from './craftLayer';
import { SmallBodyLayer } from './smallBodies';
import { orbitTrailMaterial } from './orbitTrail';
import { EARTH_ATMOSPHERE, makeAtmosphere, type AtmosphereParams } from './atmosphere';
import { loadJson, loadManifest, SurfaceLoader, type Manifest } from './surfaces';

const UNIT_KM = 1000;                 // one render unit = 1000 km
const ORBIT_SAMPLES = 360;
const AU_KM = 149597870.7;
const SUN_RADIUS_KM = 695700;
// Exposure for sunlight at 1 AU (sets the overall look; scaled by d^2).
const EXPOSURE_1AU = 1.0;
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
  private rings: THREE.Mesh | null = null;
  private stars: THREE.Mesh | null = null;
  readonly dailyEarth = new DailyEarth();
  private atmospheres = new Map<BodyKey, THREE.Mesh>();
  private unloadedSurfaces = new Set<BodyKey>();
  private earthResolved = false;
  private sunGlow: THREE.Sprite;
  private states = {} as Record<BodyKey, BodyState>;
  private raf = 0;
  private lastFrame = 0;
  private tmp = new THREE.Vector3();
  private resizeObserver: ResizeObserver;

  // Camera about the focused body: distance (km), azimuth and elevation (rad)
  // in the ecliptic frame.
  focus: BodyKey = 'sun';
  private dist = 1.6e9;          // wide enough to frame Saturn at the start
  private az = -1.2;
  private el = 0.5;

  private sunViewPending = false;
  private sunViewPhase = 0.35;

  onFocusChange: (key: BodyKey) => void = () => {};
  // Spacecraft: the mission steps on each frame (after the clock), the scene
  // draws what craftSource returns, and the camera can follow one craft.
  onFrame: (timeMs: number, jumps: number) => void = () => {};
  onContextLost: (lost: boolean) => void = () => {};
  craftSource: () => CraftView[] = () => [];
  onCraftPick: (id: number) => void = () => {};
  focusCraftId: number | null = null;
  private craftLayer!: CraftLayer;
  // The asteroids and comets (smallBodies.ts), for the rail's toggles.
  smallBodies!: SmallBodyLayer;

  // Put the camera at phase angle `phase` (rad) from the Sun as seen from
  // the focused body: about 0.35 shows the day side with a little
  // terminator, pi/2 the terminator edge-on (applied on the next frame).
  viewFromSun(phase = 0.35): void { this.sunViewPending = true; this.sunViewPhase = phase; }

  constructor(private container: HTMLElement, private overlay: HTMLElement, private clock: SimClock) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 1);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1e-3, 1e10);
    this.camera.position.set(0, 0, 0);

    // No light objects: each body's material computes its own sunlight.
    // The Sun's disc is drawn at its true surface brightness relative to a
    // white surface lit face-on at 1 AU, (1 AU / R_sun)^2, about 46,000.
    const sphere = new THREE.SphereGeometry(1, 96, 48);
    for (const b of BODIES) {
      let material: THREE.Material;
      if (b.key === 'sun') {
        const sun = new THREE.MeshBasicMaterial({ color: b.colour });
        sun.color.multiplyScalar((AU_KM / SUN_RADIUS_KM) ** 2);
        material = sun;
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
    this.sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffd9a0, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.sunGlow.scale.setScalar((SUN_RADIUS_KM * 8) / UNIT_KM);
    this.scene.add(this.sunGlow);

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

    this.surfaces = new SurfaceLoader(this.renderer);
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
        void this.surfaces.load(stars.map, true).then((tex) => {
          this.stars = makeStars(tex, renderToEqj(), stars.raAtLeftDeg, stars.raIncreasesRight, stars.gain ?? 1);
          this.scene.add(this.stars);
        });
      }
    });

    this.craftLayer = new CraftLayer(this.scene, this.overlay, (id) => this.onCraftPick(id));
    this.smallBodies = new SmallBodyLayer(this.scene, this.overlay, import.meta.env.BASE_URL);
    // The GPU can drop the WebGL context (sleep, driver reset, memory
    // pressure): say so rather than show a black view, and carry on when the
    // browser restores it.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.onContextLost(true); });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => this.onContextLost(false));
    this.attachControls();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private makeLabel(key: BodyKey, name: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'body-marker';
    el.innerHTML = `<span class="dot"></span><span class="name">${name}</span>`;
    el.addEventListener('click', () => this.focusOn(key));
    this.overlay.appendChild(el);
    return el;
  }

  focusOnCraft(id: number): void {
    this.focusCraftId = id;
    this.dist = 2.0e4;
  }

  focusOn(key: BodyKey): void {
    this.focusCraftId = null;
    this.focus = key;
    const r = BODY_BY_KEY[key].radiusKm;
    this.dist = key === 'sun' ? 1.6e9 : Math.max(r * 8, 2.0e4);
    this.onFocusChange(key);
  }

  stateOf(key: BodyKey): BodyState | undefined {
    return this.states[key];
  }

  private attachControls(): void {
    const el = this.renderer.domElement;
    let dragging = false, lx = 0, ly = 0;
    el.addEventListener('pointerdown', (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', (e) => { dragging = false; el.releasePointerCapture(e.pointerId); });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.az -= (e.clientX - lx) * 0.005;
      this.el = Math.max(-1.5, Math.min(1.5, this.el + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const minDist = this.focusCraftId !== null ? 0.05 : BODY_BY_KEY[this.focus].radiusKm * 1.2;
      this.dist = Math.max(minDist, Math.min(2.0e10, this.dist * Math.exp(e.deltaY * 0.0015)));
    }, { passive: false });
  }

  private resize(): void {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
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
    this.clock.tick((now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const tMs = this.clock.snapshot.timeMs;
    const date = new Date(tMs);
    this.onFrame(tMs, this.clock.snapshot.jumps);
    const crafts = this.craftSource();
    const followed = this.focusCraftId === null ? null : crafts.find((c) => c.id === this.focusCraftId) ?? null;

    for (const b of BODIES) this.states[b.key] = bodyState(b.key, date);
    if (this.earthResolved) this.dailyEarth.update(tMs, this.clock.snapshot.playing ? this.clock.snapshot.rate : 0);
    this.updateOrbits(tMs, now);

    // Camera position in km (ecliptic), relative to the focused body or craft.
    const f = followed ? followed.rEcl : this.states[this.focus].r;
    if (this.sunViewPending && this.focus !== 'sun') {
      const d = Math.hypot(f[0], f[1], f[2]);
      this.az = Math.atan2(-f[1], -f[0]) + this.sunViewPhase;
      this.el = Math.asin(-f[2] / d) + 0.15;
      this.sunViewPending = false;
    }
    const ce = Math.cos(this.el);
    const offset: Vec3 = [
      this.dist * ce * Math.cos(this.az), this.dist * ce * Math.sin(this.az), this.dist * Math.sin(this.el),
    ];
    const cam: Vec3 = [f[0] + offset[0], f[1] + offset[1], f[2] + offset[2]];

    for (const b of BODIES) {
      toRender(sub(this.states[b.key].r, cam), this.meshes.get(b.key)!.position);
    }
    const sunPos = this.meshes.get('sun')!.position;
    this.sunGlow.position.copy(sunPos);
    this.updateLighting(sunPos, cam, date);
    this.smallBodies.update(tMs, cam, 1);
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

    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    this.craftLayer.label(crafts, cam, UNIT_KM, this.camera, this.container.clientWidth, this.container.clientHeight);
  };

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
      if (entry?.dayMonthly && !this.unloadedSurfaces.has(key)) void this.surfaces.updateDay(key, entry, m, date);
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
    for (const m of this.materials.values()) m.uniforms.invExposure.value = 1 / this.renderer.toneMappingExposure;

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
      const x = ((ndc.x + 1) / 2) * w, y = ((1 - ndc.y) / 2) * h;
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
      if (radiusPx > 3 && this.unloadedSurfaces.has(b.key) && this.manifest) {
        this.unloadedSurfaces.delete(b.key);
        const entry = this.manifest.bodies[b.key]!;
        void this.surfaces.apply(b.key, entry, this.materials.get(b.key)!, new Date(this.clock.snapshot.timeMs));
      }
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
    this.resizeObserver.disconnect();
    this.craftLayer.dispose();
    this.smallBodies.dispose();
    for (const el of this.labels.values()) el.remove();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// A soft radial glow for the Sun (display only).
function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0.0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.12, 'rgba(255,230,180,0.5)');
  grad.addColorStop(0.35, 'rgba(255,200,120,0.12)');
  grad.addColorStop(1.0, 'rgba(255,180,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
