// src/scene/post.ts
//
// The HDR pipeline (docs/frontend/lighting.md#exposure-and-tone-mapping):
//
//   scene -> half-float target (4x MSAA below 1.5 device px per CSS px)
//         -> bloom chain from two CSS pixels a texel (a quarter of the
//            target on a 2x screen)
//         -> one final pass to the screen: the bloom mixed in, the Sun's
//            glare added (sun.ts), exposure, the tone curve, sRGB.
//
// Bloom follows Jimenez ("Next generation post processing in Call of Duty:
// Advanced Warfare", SIGGRAPH 2014): a 13-tap downsample through five
// levels, the first with Karis's average so one very bright pixel cannot
// flicker, then a 3 x 3 tent upsample adding each level into the one above.
// No threshold: every pixel scatters the same 2 %, mixed rather than
// added, so the image keeps its energy. What enters is capped at 20 times
// display white: a lit limb or a bright star blooms, but the Sun's disc,
// whose scatter is the glare, does not (and half floats overflow past
// 65504).
//
// Everything after the scene is one full-screen pass. With three.js's own
// HDR output, bloom's mix, the glare and the tone curve were three, and on
// the Intel iGPU at 2680 x 2032 they cost about 19 ms of a 43 ms frame
// (docs/performance.md#rendering).

import * as THREE from 'three';
import { GLARE_GLSL, type SunGlare } from './sun';

const LEVELS = 5;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const down = /* glsl */ `
uniform sampler2D src;
uniform vec2 texel;          // tap spacing, uv
uniform float karis;         // 1 on the first level
uniform float exposure;      // Karis's weights depend on the displayed level
uniform float cap;           // 20 / exposure on the first level
varying vec2 vUv;
vec3 tap(vec2 o) { return min(texture2D(src, vUv + o * texel).rgb, vec3(cap)); }
float w(vec3 c) { return karis > 0.5 ? 1.0 / (1.0 + dot(c * exposure, vec3(0.2126, 0.7152, 0.0722))) : 1.0; }
void main() {
  vec3 a = tap(vec2(-2, 2)), b = tap(vec2(0, 2)), c = tap(vec2(2, 2));
  vec3 d = tap(vec2(-2, 0)), e = tap(vec2(0, 0)), f = tap(vec2(2, 0));
  vec3 g = tap(vec2(-2, -2)), h = tap(vec2(0, -2)), i = tap(vec2(2, -2));
  vec3 j = tap(vec2(-1, 1)), k = tap(vec2(1, 1)), l = tap(vec2(-1, -1)), m = tap(vec2(1, -1));
  vec3 g0 = (j + k + l + m) * 0.25;
  vec3 g1 = (a + b + d + e) * 0.25, g2 = (b + c + e + f) * 0.25;
  vec3 g3 = (d + e + g + h) * 0.25, g4 = (e + f + h + i) * 0.25;
  float w0 = 0.5 * w(g0), w1 = 0.125 * w(g1), w2 = 0.125 * w(g2), w3 = 0.125 * w(g3), w4 = 0.125 * w(g4);
  gl_FragColor = vec4((g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4), 1.0);
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

const final = /* glsl */ `
uniform sampler2D scene;
uniform sampler2D bloom;
uniform float strength;      // fraction of the light scattered
uniform float levels;
${GLARE_GLSL}
varying vec2 vUv;
void main() {
  vec3 c = texture2D(scene, vUv).rgb;
  vec3 b = min(texture2D(bloom, vUv).rgb, vec3(6e4)) / levels;
  c = mix(c, b, strength) + sunGlare(gl_FragCoord.xy);
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class HdrPipeline {
  strength = 0.02;
  exposure = 1;
  readonly target: THREE.WebGLRenderTarget;
  private mips: THREE.WebGLRenderTarget[] = [];
  private div = 2;                 // first bloom level: 1/div of the target
  private quad: THREE.Mesh;
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private downMat: THREE.ShaderMaterial;
  private upMat: THREE.ShaderMaterial;
  private finalMat: THREE.ShaderMaterial;

  constructor(msaa: boolean, glare: SunGlare) {
    // Depth is for the scene's own draws only: nothing samples it, so the
    // multisampled target neither resolves nor keeps it.
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, samples: msaa ? 4 : 0, depthBuffer: true, stencilBuffer: false,
      resolveDepthBuffer: false, resolveStencilBuffer: false,
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
    const common = { vertexShader: vertex, depthTest: false, depthWrite: false };
    this.downMat = new THREE.ShaderMaterial({ ...common, fragmentShader: down, toneMapped: false,
      uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() }, karis: { value: 0 }, exposure: { value: 1 }, cap: { value: 3e4 } } });
    this.upMat = new THREE.ShaderMaterial({ ...common, fragmentShader: up, toneMapped: false, blending: THREE.AdditiveBlending,
      uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() } } });
    // Drawn to the screen with toneMapped, so three applies the renderer's
    // tone curve and exposure, and the sRGB encode, in this one pass.
    this.finalMat = new THREE.ShaderMaterial({ ...common, fragmentShader: final, toneMapped: true,
      uniforms: { scene: { value: null }, bloom: { value: null }, strength: { value: 0 }, levels: { value: LEVELS }, ...glare.uniforms } });
    this.quad = new THREE.Mesh(geom, this.downMat);
    this.quad.frustumCulled = false;
  }

  // Drawing-buffer size and the render's pixel ratio. The bloom's first
  // level is two CSS pixels a texel whatever the ratio (a quarter of the
  // target on a 2x screen, half on a 1x one), so its cost and the halo's
  // size do not jump when the adaptive render scale steps.
  setSize(width: number, height: number, ratio: number): void {
    this.target.setSize(width, height);
    this.div = Math.max(2, 2 * ratio);
    let w = Math.max(1, Math.round(width / this.div)), h = Math.max(1, Math.round(height / this.div));
    for (let i = 0; i < LEVELS; i++) {
      if (!this.mips[i]) {
        this.mips[i] = new THREE.WebGLRenderTarget(w, h, {
          type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
          minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
        });
      } else this.mips[i].setSize(w, h);
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
  }

  // Every pass covers its whole target and the upsample adds into the
  // level above, so nothing is cleared.
  private pass(renderer: THREE.WebGLRenderer, mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.quad, this.cam);
    renderer.autoClear = clear;
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    const d = this.downMat.uniforms;
    d.exposure.value = this.exposure;
    let src: THREE.WebGLRenderTarget = this.target;
    for (let i = 0; i < LEVELS; i++) {
      d.src.value = src.texture;
      // The first level spans `div` source texels per output texel; space
      // its taps to match.
      const k = i === 0 ? this.div / 2 : 1;
      (d.texel.value as THREE.Vector2).set(k / src.width, k / src.height);
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
    const f = this.finalMat.uniforms;
    f.scene.value = this.target.texture;
    f.bloom.value = this.mips[0].texture;
    f.strength.value = this.strength;
    this.pass(renderer, this.finalMat, null);
  }

  dispose(): void {
    this.target.dispose();
    for (const m of this.mips) m.dispose();
  }
}
