// src/scene/sun.ts
//
// The Sun's disc and the glare it puts in the view
// (docs/frontend/lighting.md#the-sun).
//
// Disc: the photosphere at its true surface brightness, 46,000 times a
// white surface lit face-on at 1 AU (lighting.md), coloured by the Sun's
// chromaticity (CIE xy 0.3233, 0.3326, about 5,772 K) and limb-darkened
// with the quadratic law at 550 nm, I(mu)/I(1) = 0.3 + 0.93 mu - 0.23 mu^2,
// reddened toward the limb (blue darkens more). The centre is brighter than
// the mean by 1/0.805, so the disc's total light is unchanged.
//
// Glare: light scattered in the eye or a camera's optics, drawn over the
// whole view. Its profile is the CIE's disability glare for a young eye,
// L / E = 10 / theta^3 + 5 / theta^2 + 0.05 / theta (theta in degrees):
// relative to a white surface under the same sunlight (L = E / pi), pi
// times that, which an eye would see as a white veil a few degrees across.
// It is drawn at 3 % of that, closer to a good camera than an eye, with the
// fine radial needles of the eye's ciliary corona close in, drifting
// slowly as a pupil does.
// It scales with the visible fraction of the Sun's disc, so a planet in
// front of the Sun takes it away.

import * as THREE from 'three';

// Linear sRGB of the Sun's chromaticity, luminance 1.
export const SUN_RGB: [number, number, number] = [1.097, 0.977, 0.943];
export const SUN_DISC_RADIANCE = 46000;          // mean, relative to white lit at 1 AU
const LIMB_MEAN = 0.3 + 0.93 * (2 / 3) - 0.23 * 0.5;   // disc average of the law above
const GLARE_STRENGTH = 0.03;                     // of the eye's disability glare

const discVertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const discFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 centre;       // radiance at the disc's centre, linear RGB
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  #include <logdepthbuf_fragment>
  float mu = clamp(dot(normalize(vNormal), normalize(-vWorld)), 0.0, 1.0);
  float L = 0.3 + 0.93 * mu - 0.23 * mu * mu;
  // Approximate colour of the limb: stronger darkening in blue.
  vec3 limb = vec3(pow(L, 0.8), L, pow(L, 1.25));
  gl_FragColor = vec4(centre * limb, 1.0);
}
`;

export function makeSunMaterial(): THREE.ShaderMaterial {
  const k = SUN_DISC_RADIANCE / LIMB_MEAN;
  return new THREE.ShaderMaterial({
    vertexShader: discVertex,
    fragmentShader: discFragment,
    uniforms: { centre: { value: new THREE.Vector3(SUN_RGB[0] * k, SUN_RGB[1] * k, SUN_RGB[2] * k) } },
  });
}

// The glare as a function of the pixel, called in the HDR pipeline's final
// pass (post.ts): no pass of its own, so it costs arithmetic, not memory
// traffic. Returns scene-referred light (before exposure), none inside the
// Sun's disc, which draws itself.
export const GLARE_GLSL = /* glsl */ `
uniform vec3 sunDir;        // unit vector to the Sun, view space
uniform vec2 resolution;    // drawing buffer, px
uniform mat4 projInv;       // inverse projection (honours a view offset)
uniform float level;        // irradiance at the camera x visible fraction x strength
uniform float sunRadius;    // angular radius, deg
uniform float time;         // s
uniform float glareOn;      // 0 when no glare reaches the frame
uniform vec3 tint;

float glareHash(float n) { return fract(sin(n) * 43758.5453123); }
float needles(float a, float n, float t) {
  float x = a * n + t;
  float i = floor(x), f = fract(x);
  float h = mix(glareHash(i), glareHash(i + 1.0), smoothstep(0.0, 1.0, f));
  return h * h * h * h;
}

vec3 sunGlare(vec2 fragCoord) {
  if (glareOn < 0.5) return vec3(0.0);
  vec2 ndc = fragCoord / resolution * 2.0 - 1.0;
  // Unproject on the near plane: the far plane is 1e13 times further and
  // its w is lost in single precision.
  vec4 v = projInv * vec4(ndc, -1.0, 1.0);
  vec3 ray = normalize(v.xyz / v.w);
  float cosT = dot(ray, sunDir);
  float theta = degrees(acos(clamp(cosT, -1.0, 1.0)));
  if (theta < sunRadius) return vec3(0.0);
  float th = max(theta, 0.05);
  // CIE disability glare, relative to a white surface in the same light.
  float g = 3.14159265 * (10.0 / (th * th * th) + 5.0 / (th * th) + 0.05 / th);
  // Ciliary corona: fine radial needles within 10 deg, drifting slowly.
  if (th < 10.0) {
    vec3 side = normalize(cross(sunDir, vec3(0.0, 0.0, 1.0)) + vec3(1e-5, 0.0, 0.0));
    vec3 up = cross(side, sunDir);
    vec3 r = ray - sunDir * cosT;
    float a = atan(dot(r, up), dot(r, side));
    float drift = 0.15 * sin(time * 0.31) + 0.05 * time;
    float n = needles(a, 90.0, drift) * 0.7 + needles(a, 211.0, -drift * 1.7) * 0.5;
    g += n * 8.0 / (th * th) * smoothstep(10.0, 1.0, th);
  }
  return tint * level * g;
}
`;

// Keeps the glare's uniforms, shared with the pipeline's final pass.
export class SunGlare {
  readonly uniforms: Record<string, THREE.IUniform> = {
    sunDir: { value: new THREE.Vector3(0, 0, -1) },
    resolution: { value: new THREE.Vector2(1, 1) },
    projInv: { value: new THREE.Matrix4() },
    level: { value: 0 },
    sunRadius: { value: 0.25 },
    time: { value: 0 },
    glareOn: { value: 0 },
    tint: { value: new THREE.Vector3(...SUN_RGB) },
  };
  private view = new THREE.Matrix4();
  private tmp = new THREE.Vector3();

  // sunPos: the Sun's centre in render units relative to the camera;
  // irradiance: sunlight at the camera, (1 AU / d)^2; visible: the fraction
  // of the disc not hidden by a body.
  update(camera: THREE.PerspectiveCamera, sunPos: THREE.Vector3, sunRadius: number, irradiance: number,
    visible: number, buffer: THREE.Vector2, timeS: number): void {
    const u = this.uniforms;
    this.view.copy(camera.matrixWorld).invert();
    const d = sunPos.length();
    (u.sunDir.value as THREE.Vector3).copy(this.tmp.copy(sunPos).transformDirection(this.view));
    (u.resolution.value as THREE.Vector2).copy(buffer);
    (u.projInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    u.sunRadius.value = (Math.asin(Math.min(1, sunRadius / d)) * 180) / Math.PI;
    u.level.value = irradiance * visible * GLARE_STRENGTH;
    u.time.value = timeS;
    // Off when the Sun is so far out of view that its glare at the nearest
    // edge of the frame is under a thousandth of white.
    const fwd = this.tmp.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const thetaC = (Math.acos(Math.max(-1, Math.min(1, fwd.dot(sunPos) / d))) * 180) / Math.PI;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const halfDiag = (Math.atan(t * Math.hypot(1, camera.aspect)) * 180) / Math.PI;
    const edge = Math.max(0.05, thetaC - halfDiag);
    const atEdge = Math.PI * (10 / edge ** 3 + 5 / edge ** 2 + 0.05 / edge) * GLARE_STRENGTH * visible;
    u.glareOn.value = visible > 0 && atEdge > 1e-3 ? 1 : 0;
  }
}

// Fraction of a disc of angular radius a still visible past a disc of
// angular radius b whose centre is c away (all radians): the overlap of two
// discs, as in the eclipse shader (bodyMaterial.ts).
export function visibleFraction(a: number, b: number, c: number): number {
  if (c >= a + b) return 1;
  if (c <= Math.abs(a - b)) return b >= a ? 0 : 1 - (b * b) / (a * a);
  const a2 = a * a, b2 = b * b, c2 = c * c;
  const lens = a2 * Math.acos(Math.max(-1, Math.min(1, (c2 + a2 - b2) / (2 * c * a))))
    + b2 * Math.acos(Math.max(-1, Math.min(1, (c2 + b2 - a2) / (2 * c * b))))
    - 0.5 * Math.sqrt(Math.max((-c + a + b) * (c + a - b) * (c - a + b) * (c + a + b), 0));
  return Math.max(0, Math.min(1, 1 - lens / (Math.PI * a2)));
}
