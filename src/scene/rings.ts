// src/scene/rings.ts
//
// Saturn's rings: a flat annulus in Saturn's equatorial plane (the plane
// normal is the planet's north pole from the IAU rotation model), coloured
// and made transparent by a radial strip map. Sunlit with 1/d^2 like every
// surface, and shadowed by Saturn with the same disc-overlap formula as the
// eclipses. Both faces show the lit colour: the unlit face of the real rings
// glows by forward-scattered light, which is not modelled here.

import * as THREE from 'three';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec2 vLocal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vLocal = position.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D ringMap;   // u = 0 at the inner edge, 1 at the outer; rgb colour, a opacity
uniform float inner;          // render units
uniform float outer;
uniform float irradiance;
uniform float brightness;     // scales the map to the rings' reflectance
uniform vec3 sunPos;
uniform float sunRadius;
uniform vec3 planetPos;
uniform float planetRadius;
varying vec3 vWorld;
varying vec2 vLocal;

float visibleFraction(float a, float b, float c) {
  if (c >= a + b) return 1.0;
  if (c <= abs(a - b)) return b >= a ? 0.0 : 1.0 - (b * b) / (a * a);
  float a2 = a * a, b2 = b * b, c2 = c * c;
  float lens = a2 * acos(clamp((c2 + a2 - b2) / (2.0 * c * a), -1.0, 1.0))
             + b2 * acos(clamp((c2 + b2 - a2) / (2.0 * c * b), -1.0, 1.0))
             - 0.5 * sqrt(max((-c + a + b) * (c + a - b) * (c - a + b) * (c + a + b), 0.0));
  return clamp(1.0 - lens / (PI * a2), 0.0, 1.0);
}

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal);
  if (r < inner || r > outer) discard;
  vec4 m = texture2D(ringMap, vec2((r - inner) / (outer - inner), 0.5));
  if (m.a < 0.01) discard;
  vec3 toSun = sunPos - vWorld;
  float dSun = length(toSun);
  vec3 s = toSun / dSun;
  vec3 toP = planetPos - vWorld;
  float dP = length(toP);
  float shade = 1.0;
  if (dot(toP, s) > 0.0) {
    float a = asin(clamp(sunRadius / dSun, 0.0, 1.0));
    float b = asin(clamp(planetRadius / dP, 0.0, 1.0));
    float c = atan(length(cross(toP / dP, s)), dot(toP / dP, s));
    shade = visibleFraction(a, b, c);
  }
  gl_FragColor = vec4(m.rgb * brightness * irradiance * shade, m.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function makeRings(map: THREE.Texture, innerKm: number, outerKm: number, unitKm: number): THREE.Mesh {
  const geom = new THREE.RingGeometry(innerKm / unitKm, outerKm / unitKm, 256, 1);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      ringMap: { value: map },
      inner: { value: innerKm / unitKm },
      outer: { value: outerKm / unitKm },
      irradiance: { value: 1 },
      brightness: { value: 1 },
      sunPos: { value: new THREE.Vector3() },
      sunRadius: { value: 1 },
      planetPos: { value: new THREE.Vector3() },
      planetRadius: { value: 1 },
    },
  });
  return new THREE.Mesh(geom, mat);
}
