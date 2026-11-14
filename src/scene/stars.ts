// src/scene/stars.ts
//
// The star background: a sphere around the camera that looks up each view
// direction's J2000 right ascension and declination in an equirectangular
// star map (catalogue-based, so the stars are where they are). Drawn first,
// with no depth, at a fixed display brightness: a camera exposed for sunlit
// surfaces would record no stars at all, but an eye adapted to the dark
// does, and they are what you navigate by.

import * as THREE from 'three';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  vDir = position;                   // the sphere is centred on the camera
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D starMap;
uniform mat3 toEqj;          // render direction -> J2000 equatorial
uniform float raAtLeft;      // RA (rad) at the map's left edge
uniform float raDirection;   // +1 if RA increases to the right, -1 to the left
uniform float gain;
uniform float level;         // 1 / exposure: a display level through the HDR output
uniform float visibility;    // the eye's adaptation (OrreryScene.updateAdaptation)
varying vec3 vDir;
void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(toEqj * vDir);
  float ra = atan(d.y, d.x);
  float dec = asin(clamp(d.z, -1.0, 1.0));
  float u = fract(raDirection * (ra - raAtLeft) / (2.0 * PI));
  vec2 uv = vec2(u, dec / PI + 0.5);
  vec2 uvB = vec2(fract(u + 0.5) - 0.5, uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  bool useB = abs(dxB.x) + abs(dyB.x) < abs(dxA.x) + abs(dyA.x);
  vec3 c = textureGrad(starMap, uv, useB ? dxB : dxA, useB ? dyB : dyA).rgb;
  gl_FragColor = vec4(c * gain * level * visibility, 1.0);
  #include <colorspace_fragment>
}
`;

export function makeStars(map: THREE.Texture, toEqj: THREE.Matrix3, raAtLeftDeg: number,
  raIncreasesRight: boolean, gain = 1): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    uniforms: {
      starMap: { value: map },
      toEqj: { value: toEqj },
      raAtLeft: { value: (raAtLeftDeg * Math.PI) / 180 },
      raDirection: { value: raIncreasesRight ? 1 : -1 },
      gain: { value: gain },
      level: { value: 1 },
      visibility: { value: 1 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}

// Stars as points (docs/frontend/lighting.md#stars): each a Gaussian of
// fixed width in device pixels, centred on its true sub-pixel position (so
// its light is the same wherever it falls, and it neither shimmers nor
// vanishes as the view turns), with a peak of 10^(-0.4 V) times a display
// level and the colour of its B-V. They are added in HDR before the bloom,
// so the brightest saturate and bloom a little, as in a photograph. Each
// sprite is only as wide as its star's glow above 1/512 of white, so the
// tens of thousands of faint stars cost few fragments.
const pointVertex = /* glsl */ `
attribute float mag;
attribute vec3 tint;
uniform float peak0;        // peak display value of a magnitude-0 star
uniform float level;        // 1 / exposure
uniform float visibility;   // the eye's adaptation: 1 dark-adapted, less beside bright light
uniform float sigma;        // device px
uniform float size;         // largest sprite, device px
varying vec3 vColour;
varying float vSize;
void main() {
  float peak = peak0 * pow(10.0, -0.4 * mag) * visibility;
  if (peak * 512.0 < 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }   // too faint to show
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  vColour = tint * (peak * level);
  float r = sigma * sqrt(2.0 * log(peak * 512.0));
  vSize = min(size, 2.0 * ceil(r) + 1.0);
  gl_PointSize = vSize;
}
`;

const pointFragment = /* glsl */ `
uniform float sigma;
varying vec3 vColour;
varying float vSize;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * vSize;
  gl_FragColor = vec4(vColour * exp(-dot(d, d) / (2.0 * sigma * sigma)), 1.0);
}
`;

// B-V to linear sRGB at luminance 1: Ballesteros's (2012) temperature, a
// Planck spectrum integrated with the CIE 1931 colour-matching functions
// (Wyman, Sloan and Shirley's 2013 multi-lobe fit), then XYZ to linear sRGB.
function lobe(x: number, mu: number, s1: number, s2: number): number {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}

export function bvToRgb(bv: number): [number, number, number] {
  const T = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 5) {
    const m = l * 1e-9;
    const B = 1 / (m ** 5 * (Math.exp(1.4387769e-2 / (m * T)) - 1));
    X += B * (1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2));
    Y += B * (0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1));
    Z += B * (1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8));
  }
  X /= Y; Z /= Y; Y = 1;
  const rgb: [number, number, number] = [
    Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z),
    Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z),
    Math.max(0, 0.0557 * X - 0.2040 * Y + 1.0570 * Z),
  ];
  const lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return [rgb[0] / lum, rgb[1] / lum, rgb[2] / lum];
}

// data: int16 per star x, y, z (J2000 equatorial unit vector x 32767),
// V x 1000, B-V x 1000 (-32768: none, taken as the Sun's 0.65).
// eqjToRender: the inverse of the background's toEqj.
export function makeStarPoints(data: Int16Array, eqjToRender: THREE.Matrix3, dpr: number): THREE.Points {
  const n = Math.floor(data.length / 5);
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), tint = new Float32Array(n * 3);
  const lut = new Map<number, [number, number, number]>();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const o = 5 * i;
    v.set(data[o], data[o + 1], data[o + 2]).applyMatrix3(eqjToRender).normalize();
    pos.set([v.x, v.y, v.z], 3 * i);
    mag[i] = data[o + 3] / 1000;
    const bvKey = data[o + 4] === -32768 ? 33 : Math.max(-20, Math.min(100, Math.round(data[o + 4] / 20)));   // 0.02-wide bins
    let c = lut.get(bvKey);
    if (!c) { c = bvToRgb(bvKey * 0.02); lut.set(bvKey, c); }
    // A little less saturated: the eye sees star colours faintly.
    tint.set([0.65 * c[0] + 0.35, 0.65 * c[1] + 0.35, 0.65 * c[2] + 0.35], 3 * i);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  geom.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const sigma = 0.55 + 0.35 * dpr;
  const mat = new THREE.ShaderMaterial({
    vertexShader: pointVertex,
    fragmentShader: pointFragment,
    // Opaque pass, drawn just after the background: bodies drawn later cover
    // them (a transparent material would be drawn over the bodies).
    transparent: false,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      peak0: { value: 30 },
      level: { value: 1 },
      visibility: { value: 1 },
      sigma: { value: sigma },
      size: { value: Math.ceil(7 * sigma) + 1 },
    },
  });
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -999;
  return pts;
}
