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
  gl_FragColor = vec4(c * gain, 1.0);
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
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}
