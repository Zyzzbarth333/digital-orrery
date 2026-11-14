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
// Glare: light scattered in a camera's optics, drawn over the whole view.
// Its point-spread function, relative to a white surface under the same
// sunlight, is G(theta) = A / theta^2 + B / theta (theta in degrees): the
// inverse-square fall-off of scatter from polished lens surfaces (Harvey's
// model) with a faint wide tail. Spread over the disc, the A term averages
// to A ln(theta^2 / (theta^2 - r^2)) / r^2 for a disc of angular radius r,
// so close to the Sun the halo follows the limb instead of a point. The
// glare's strength is the sunlight at the camera relative to the exposure:
// steady while the exposure follows the distance (beyond 0.2 AU), so its
// apparent size does not change as you zoom; growing as 1/d^2 inside that.
// The fine radial needles of an eye's ciliary corona are kept, faint, close
// in, drifting slowly. The glare scales with the visible fraction of the
// Sun's disc, so a planet in front of the Sun takes it away.

import * as THREE from 'three';

// Linear sRGB of the Sun's chromaticity, luminance 1.
export const SUN_RGB: [number, number, number] = [1.097, 0.977, 0.943];
export const SUN_DISC_RADIANCE = 46000;          // mean, relative to white lit at 1 AU
const LIMB_MEAN = 0.3 + 0.93 * (2 / 3) - 0.23 * 0.5;   // disc average of the law above
// The glare's point-spread function (header): white out to about 0.4 deg
// at the exposure for the camera's own sunlight, 10 % of white at 1.2 deg,
// 1 % at 4 deg. In all, about 0.1 % of the Sun's light is scattered.
export const GLARE_A = 0.15;                     // deg^2
export const GLARE_B = 0.005;                    // deg

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
uniform float level;        // irradiance at the camera x visible fraction
uniform float sunRadius;    // angular radius, deg
uniform float time;         // s
uniform float glareOn;      // 0 when no glare reaches the frame
uniform float degPerPx;     // field of view per canvas pixel, deg
uniform vec3 tint;
uniform vec2 psf;           // A, B (sun.ts)

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
  // Over the disc the glare adds to light that is already saturated; where
  // a body hides part of the disc it carries on across the hidden limb.
  float th = max(theta, max(sunRadius, 0.05));
  // The A term spread over the disc (header); a point while x is tiny.
  float r = max(sunRadius, 0.05);
  float x = min(r * r / (th * th), 0.999);
  float near = x < 1e-3 ? 1.0 / (th * th) : -log(1.0 - x) / (r * r);
  float g = psf.x * near + psf.y / th;
  // Ciliary corona: fine radial needles within 10 deg, drifting slowly.
  if (th < 10.0) {
    vec3 side = normalize(cross(sunDir, vec3(0.0, 0.0, 1.0)) + vec3(1e-5, 0.0, 0.0));
    vec3 up = cross(side, sunDir);
    vec3 rr = ray - sunDir * cosT;
    float a = atan(dot(rr, up), dot(rr, side));
    float drift = 0.15 * sin(time * 0.31) + 0.05 * time;
    // Each set of needles fades out where they would be closer than a few
    // pixels apart, rather than alias into crawling speckle.
    float arcPx = radians(th) * 57.29578 / degPerPx;   // pixels around the circle per radian of angle
    float f1 = smoothstep(2.0, 5.0, arcPx * 6.2832 / 90.0), f2 = smoothstep(2.0, 5.0, arcPx * 6.2832 / 211.0);
    float n = needles(a, 90.0, drift) * 0.7 * f1 + needles(a, 211.0, -drift * 1.7) * 0.5 * f2;
    g += n * 0.3 * psf.x * near * smoothstep(10.0, 1.0, th);
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
    degPerPx: { value: 0.05 },
    tint: { value: new THREE.Vector3(...SUN_RGB) },
    psf: { value: new THREE.Vector2(GLARE_A, GLARE_B) },
  };
  private view = new THREE.Matrix4();
  private tmp = new THREE.Vector3();

  // sunPos: the Sun's centre in render units relative to the camera;
  // irradiance: sunlight at the camera, (1 AU / d)^2, in the scene's units
  // (the exposure then scales it); visible: the fraction of the disc not
  // hidden by a body.
  update(camera: THREE.PerspectiveCamera, sunPos: THREE.Vector3, sunRadius: number, irradiance: number,
    visible: number, buffer: THREE.Vector2, timeS: number): void {
    const u = this.uniforms;
    this.view.copy(camera.matrixWorld).invert();
    const d = sunPos.length();
    (u.sunDir.value as THREE.Vector3).copy(this.tmp.copy(sunPos).transformDirection(this.view));
    (u.resolution.value as THREE.Vector2).copy(buffer);
    (u.projInv.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    u.sunRadius.value = (Math.asin(Math.min(1, sunRadius / d)) * 180) / Math.PI;
    u.level.value = irradiance * visible;
    u.time.value = timeS;
    u.degPerPx.value = camera.fov / Math.max(1, buffer.y);
    // Off when the Sun is so far out of view that its glare at the nearest
    // edge of the frame is under a thousandth of white (at the exposure
    // for the camera's sunlight).
    const fwd = this.tmp.set(0, 0, -1).transformDirection(camera.matrixWorld);
    const thetaC = (Math.acos(Math.max(-1, Math.min(1, fwd.dot(sunPos) / d))) * 180) / Math.PI;
    const t = Math.tan((camera.fov * Math.PI) / 360);
    const halfDiag = (Math.atan(t * Math.hypot(1, camera.aspect)) * 180) / Math.PI;
    const edge = Math.max(0.05, thetaC - halfDiag);
    // Inside 0.2 AU the exposure stops following the distance
    // (OrreryScene.updateLighting), so the Sun outshines it by (0.2 AU / d)^2.
    const atEdge = (GLARE_A / edge ** 2 + GLARE_B / edge) * visible * Math.max(1, 0.04 * irradiance);
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
