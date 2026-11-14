// src/scene/beltHaze.ts
//
// The faint main belt as a haze: the sunlight reflected by about 1.45
// million asteroids too faint to see one by one, drawn from their real
// orbits. A worker (beltHaze.worker.ts, running src/physics/beltGrid.js)
// places every body on its orbit at the clock's time and bins its
// brightness into a 3D grid; this draws the grid by marching rays through
// it, so the cost does not grow with the number of bodies
// (docs/frontend/small-bodies.md#the-faint-belt).
//
// Radiance: a cloud of emitters with emissivity j (light per volume) has
// surface brightness I = (1 / 4 pi) times the integral of j along the line of
// sight, whatever the distance. Each cell's emissivity is its summed
// 10^(-0.4 H) / r^2 over its volume; the phase angle is left out. The result
// is metered as the points are (for sunlight at the camera) and its range
// halved (the square root), so the haze and the bright points read alike.

import * as THREE from 'three';
import { GRID } from '../physics/beltGrid.js';
import { SB_EPOCH_JD } from '../physics/smallBodies.js';
import { ttMinusUtc } from '../physics/timescale.js';

const AU_KM = 149597870.7, UNIT_KM = 1000, AU = AU_KM / UNIT_KM;
// The haze's display scale: the square root of its metered radiance times
// this. Set so the dense belt seen from the Earth sits a little below its
// brightest points, and leaves them the belt's detail.
const HAZE_GAIN = 1.6;
// Rebuild the grid when the clock has moved this far (days): the belt turns
// about 0.25 deg a day at 2.7 au, under a cell (0.9 deg there) in four.
const REBUILD_DAYS = 2;

const VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  uniform sampler3D uGrid;
  uniform vec3 uSun;          // the Sun, render units (the box's centre)
  uniform vec3 uHalf;         // the box's half size, au: (x, y, z) ecliptic
  uniform float uAu;          // render units per au
  uniform float uCellVolume;  // au^3
  uniform float uGain;        // HAZE_GAIN x the metering
  uniform float uLevel;       // 1 / the exposure
  uniform float uVis;         // the eye's adaptation
  uniform float uOn;
  varying vec3 vWorld;
  // render (x, y, z) -> ecliptic (x, -z, y), in au about the Sun.
  vec3 ecl(vec3 p) { vec3 q = (p - uSun) / uAu; return vec3(q.x, -q.z, q.y); }
  void main() {
    if (uOn < 0.5) discard;
    // The ray from the camera (at the render origin) through this pixel, in
    // ecliptic au; where it is inside the box.
    vec3 o = ecl(vec3(0.0)), d = normalize(ecl(vWorld) - o);
    vec3 inv = 1.0 / d, t0 = (-uHalf - o) * inv, t1 = (uHalf - o) * inv;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    float ta = max(max(tmin.x, tmin.y), max(tmin.z, 0.0)), tb = min(min(tmax.x, tmax.y), tmax.z);
    if (tb <= ta) discard;
    const int STEPS = 32;
    float ds = (tb - ta) / float(STEPS);
    // Jittered start against banding.
    float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float sum = 0.0;
    for (int k = 0; k < STEPS; k++) {
      vec3 p = o + d * (ta + (float(k) + jitter) * ds);
      vec3 uvw = (p + uHalf) / (2.0 * uHalf);
      sum += texture(uGrid, uvw).r;
    }
    float radiance = sum * ds / (uCellVolume * 12.566370614);
    float v = uGain * sqrt(max(radiance, 0.0)) * uLevel * uVis;
    gl_FragColor = vec4(vec3(0.68, 0.64, 0.58) * v, 1.0);
    #ifdef TONE_MAPPING
    gl_FragColor.rgb *= toneMappingExposure;
    #endif
  }`;

export class BeltHaze {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private texture: THREE.Data3DTexture | null = null;
  private worker: Worker | null = null;
  private builtDays = NaN;
  private pending = false;
  private ready = false;
  private on = true;

  constructor(private scene: THREE.Scene) {
    const { halfXY, halfZ, nx, ny, nz } = GRID;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT,
      // Drawn from inside or out: the box's far faces start each ray.
      side: THREE.BackSide, transparent: false, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uGrid: { value: null }, uSun: { value: new THREE.Vector3() }, uHalf: { value: new THREE.Vector3(halfXY, halfXY, halfZ) },
        uAu: { value: AU }, uCellVolume: { value: (2 * halfXY / nx) * (2 * halfXY / ny) * (2 * halfZ / nz) },
        uGain: { value: HAZE_GAIN }, uLevel: { value: 1 }, uVis: { value: 1 }, uOn: { value: 1 },
      },
    });
    // The box in render axes: ecliptic x, z, y spans.
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(2 * halfXY * AU, 2 * halfZ * AU, 2 * halfXY * AU), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -998.5;          // after the stars, before the points
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  // The faint bodies, packed as smallbodies-belt.bin (the worker keeps them).
  setBodies(buffer: ArrayBuffer): void {
    this.worker = new Worker(new URL('./beltHaze.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent) => {
      if (ev.data.type !== 'grid') return;
      this.pending = false;
      this.builtDays = ev.data.days;
      const { nx, ny, nz } = GRID;
      const data: Float32Array = ev.data.grid;
      if (!this.texture) {
        this.texture = new THREE.Data3DTexture(data, nx, ny, nz);
        this.texture.format = THREE.RedFormat;
        this.texture.type = THREE.FloatType;
        this.texture.minFilter = this.texture.magFilter = THREE.LinearFilter;
        this.texture.wrapS = this.texture.wrapT = this.texture.wrapR = THREE.ClampToEdgeWrapping;
        this.texture.unpackAlignment = 1;
        this.material.uniforms.uGrid.value = this.texture;
      } else {
        this.texture.image.data = data;
      }
      this.texture.needsUpdate = true;
      this.ready = true;
      this.mesh.visible = this.on;
    };
    this.worker.postMessage({ type: 'bodies', buffer }, [buffer]);
  }

  setOn(on: boolean): void { this.on = on; this.mesh.visible = on && this.ready; }

  // Each frame: the time, the Sun's render position, the level and the
  // eye's adaptation; the camera's distance from the Sun meters it.
  update(timeMs: number, sunRender: THREE.Vector3, camAuDist: number, level: number, visibility = 1): void {
    const days = timeMs / 86400e3 + 2440587.5 + (ttMinusUtc(timeMs) ?? 69.184) / 86400 - SB_EPOCH_JD;
    if (this.worker && !this.pending && !(Math.abs(days - this.builtDays) < REBUILD_DAYS)) {
      this.pending = true;
      this.worker.postMessage({ type: 'build', days });
    }
    this.mesh.position.copy(sunRender);
    const u = this.material.uniforms;
    (u.uSun.value as THREE.Vector3).copy(sunRender);
    const dc = Math.max(0.2, camAuDist);
    u.uGain.value = HAZE_GAIN * dc;          // sqrt(radiance x dc^2)
    u.uLevel.value = level;
    u.uVis.value = visibility;
  }

  dispose(): void {
    this.worker?.terminate();
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture?.dispose();
  }
}
