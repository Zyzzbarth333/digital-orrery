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
// vanishes as the view turns), with a peak of 10^(-0.4 m) times a display
// level and the star's own colour. They are added in HDR before the bloom,
// so the brightest saturate and bloom a little, as in a photograph.
const pointVertex = /* glsl */ `
attribute float mag;
attribute vec3 tint;
uniform float peak0;        // peak display value of a magnitude-0 star
uniform float level;        // 1 / exposure
uniform float visibility;   // the eye's adaptation: 1 dark-adapted, less beside bright light
uniform float size;         // sprite size, device px
varying vec3 vColour;
void main() {
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
  vColour = tint * (peak0 * pow(10.0, -0.4 * mag) * level * visibility);
  gl_PointSize = size;
}
`;

const pointFragment = /* glsl */ `
uniform float sigma;        // device px
uniform float size;
varying vec3 vColour;
void main() {
  vec2 d = (gl_PointCoord - 0.5) * size;
  float g = exp(-dot(d, d) / (2.0 * sigma * sigma));
  gl_FragColor = vec4(vColour * g, 1.0);
}
`;

// data: float32 per star x, y, z (J2000 equatorial unit vector), V
// magnitude, linear R, G, B at luminance 1. eqjToRender: the inverse of the
// background's toEqj.
export function makeStarPoints(data: Float32Array, eqjToRender: THREE.Matrix3, dpr: number): THREE.Points {
  const n = Math.floor(data.length / 7);
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), tint = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const o = 7 * i;
    v.set(data[o], data[o + 1], data[o + 2]).applyMatrix3(eqjToRender).normalize();
    pos.set([v.x, v.y, v.z], 3 * i);
    mag[i] = data[o + 3];
    // A little less saturated than the map's colours: the eye sees star
    // colours faintly.
    const r = data[o + 4], g = data[o + 5], b = data[o + 6];
    tint.set([0.7 * r + 0.3, 0.7 * g + 0.3, 0.7 * b + 0.3], 3 * i);
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
      size: { value: Math.ceil(6 * sigma) + 1 },
    },
  });
  const pts = new THREE.Points(geom, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -999;
  return pts;
}
