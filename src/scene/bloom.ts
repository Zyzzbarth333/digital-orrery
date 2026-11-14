// src/scene/bloom.ts
//
// Bloom: a little of the light in the image spread wide, as optics and the
// eye scatter it (docs/frontend/lighting.md#glare-and-bloom). It follows
// Jimenez's chain ("Next generation post processing in Call of Duty:
// Advanced Warfare", SIGGRAPH 2014): a 13-tap downsample through six half-
// resolution levels, the first with Karis's average so one very bright
// pixel cannot flicker, then a 3 x 3 tent upsample that adds each level
// into the one above. There is no threshold: every pixel scatters the same
// fraction, so the result keeps the image's energy (mix, not add) and only
// what is truly bright makes a visible halo. The Sun's own halo is its
// glare (sun.ts); its disc is capped on the way in.
//
// It runs as an effect of three.js's HDR output (WebGLRenderer with
// outputBufferType HalfFloatType), on scene-referred linear light, before
// the output pass applies exposure and tone mapping.

import * as THREE from 'three';

const LEVELS = 6;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const down = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;          // 1 / source size
uniform float karis;         // 1 on the first level
uniform float exposure;      // for Karis's weights, which depend on the displayed level
uniform float cap;           // 20 / exposure on the first level
varying vec2 vUv;
// What enters the chain is capped at 20 times display white: a lit limb,
// a bright star or a glint blooms fully, but the Sun's disc (tens of
// thousands of times brighter) does not, because its scatter is modelled
// on its own (sun.ts, the CIE glare). Karis's weights cannot damp a disc
// several texels wide, and half floats overflow past 65504.
vec3 tap(vec2 o) { return min(texture2D(src, vUv + o * texel).rgb, vec3(cap)); }
float w(vec3 c) { return karis > 0.5 ? 1.0 / (1.0 + dot(c * exposure, vec3(0.2126, 0.7152, 0.0722))) : 1.0; }
void main() {
  vec3 a = tap(vec2(-2, 2)), b = tap(vec2(0, 2)), c = tap(vec2(2, 2));
  vec3 d = tap(vec2(-2, 0)), e = tap(vec2(0, 0)), f = tap(vec2(2, 0));
  vec3 g = tap(vec2(-2, -2)), h = tap(vec2(0, -2)), i = tap(vec2(2, -2));
  vec3 j = tap(vec2(-1, 1)), k = tap(vec2(1, 1)), l = tap(vec2(-1, -1)), m = tap(vec2(1, -1));
  // Five overlapping 2 x 2 boxes: the centre one weighted 0.5, the
  // corners 0.125 each.
  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * w(g0), w1 = 0.125 * w(g1), w2 = 0.125 * w(g2), w3 = 0.125 * w(g3), w4 = 0.125 * w(g4);
  vec3 sum = g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4;
  gl_FragColor = vec4(sum / (w0 + w1 + w2 + w3 + w4), 1.0);
}
`;

const up = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(src, vUv + vec2(-1, 1) * texel).rgb + texture2D(src, vUv + vec2(1, 1) * texel).rgb
         + texture2D(src, vUv + vec2(-1, -1) * texel).rgb + texture2D(src, vUv + vec2(1, -1) * texel).rgb;
  vec3 e = texture2D(src, vUv + vec2(0, 1) * texel).rgb + texture2D(src, vUv + vec2(0, -1) * texel).rgb
         + texture2D(src, vUv + vec2(-1, 0) * texel).rgb + texture2D(src, vUv + vec2(1, 0) * texel).rgb;
  vec3 c = texture2D(src, vUv).rgb;
  gl_FragColor = vec4(min((s + 2.0 * e + 4.0 * c) / 16.0, vec3(3e4)), 1.0);
}
`;

const composite = /* glsl */ `
uniform sampler2D scene;
uniform sampler2D bloom;
uniform float strength;      // fraction of the light scattered
uniform float levels;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(scene, vUv).rgb;
  vec3 b = min(texture2D(bloom, vUv).rgb, vec3(6e4)) / levels;
  gl_FragColor = vec4(mix(c, b, strength), 1.0);
}
`;

export class BloomEffect {
  enabled = true;
  needsSwap = true;
  strength = 0.02;
  exposure = 1;
  private mips: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private compMat: THREE.ShaderMaterial;

  constructor() {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const common = { vertexShader: vertex, depthTest: false, depthWrite: false, toneMapped: false };
    this.downMat = new THREE.ShaderMaterial({ ...common, fragmentShader: down,
      uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() }, karis: { value: 0 }, exposure: { value: 1 }, cap: { value: 3e4 } } });
    this.upMat = new THREE.ShaderMaterial({ ...common, fragmentShader: up, blending: THREE.AdditiveBlending,
      uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() } } });
    this.compMat = new THREE.ShaderMaterial({ ...common, fragmentShader: composite,
      uniforms: { scene: { value: null }, bloom: { value: null }, strength: { value: 0 }, levels: { value: LEVELS } } });
    this.quad = new THREE.Mesh(geom, this.downMat);
    this.quad.frustumCulled = false;
  }

  setSize(width: number, height: number): void {
    let w = width, h = height;
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      if (!this.mips[i]) {
        this.mips[i] = new THREE.WebGLRenderTarget(w, h, {
          type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
          minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
        });
      } else this.mips[i].setSize(w, h);
    }
  }

  // Every pass covers its whole target, and the upsample adds into the
  // level above, so nothing is cleared.
  private pass(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.quad, this.cam);
    renderer.autoClear = clear;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    if (!this.mips.length) this.setSize(readBuffer.width, readBuffer.height);
    const d = this.downMat.uniforms;
    d.exposure.value = this.exposure;
    let src: THREE.WebGLRenderTarget = readBuffer;
    for (let i = 0; i < LEVELS; i++) {
      d.src.value = src.texture;
      (d.texel.value as THREE.Vector2).set(1 / src.width, 1 / src.height);
      d.karis.value = i === 0 ? 1 : 0;
      d.cap.value = i === 0 ? 20 / this.exposure : 3e4;
      this.pass(renderer, this.downMat, this.mips[i]);
      src = this.mips[i];
    }
    const u = this.upMat.uniforms;
    for (let i = LEVELS - 1; i > 0; i--) {
      u.src.value = this.mips[i].texture;
      (u.texel.value as THREE.Vector2).set(1 / this.mips[i].width, 1 / this.mips[i].height);
      this.pass(renderer, this.upMat, this.mips[i - 1]);
    }
    const c = this.compMat.uniforms;
    c.scene.value = readBuffer.texture;
    c.bloom.value = this.mips[0].texture;
    c.strength.value = this.enabled ? this.strength : 0;
    this.pass(renderer, this.compMat, writeBuffer);
  }

  dispose(): void { for (const m of this.mips) m.dispose(); }
}
