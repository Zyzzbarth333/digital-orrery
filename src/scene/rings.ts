// src/scene/rings.ts
//
// Saturn's rings from measured optical depth (docs/frontend/lighting.md#rings).
//
// tau(r) is the normal optical depth from the Cassini UVIS 126 Tau egress
// stellar occultation (10 km bins, PDS Ring-Moon Systems Node). The rings
// are a flat layer in Saturn's equatorial plane. With mu0 and mu the cosines
// of the Sun's and the viewer's angles to the ring normal, classical single
// scattering by a layer of particles gives the reflectance
//
//   lit face:    I/F = A mu0/(mu0 + mu) (1 - exp(-tau (1/mu0 + 1/mu)))
//   unlit face:  I/F = A mu0/(mu - mu0) (exp(-tau/mu) - exp(-tau/mu0))
//
// and what lies behind shows through by exp(-tau/mu). Saturn's shadow on the
// rings is its ellipsoid's, as in eclipses (bodyMaterial.ts,
// ELLIPSOID_SHADOW). A is set so the
// dense B ring has I/F about 0.5 face-on at low phase.

import * as THREE from 'three';
import { ELLIPSOID_SHADOW } from './bodyMaterial';

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
uniform sampler2D tauMap;     // r: normal optical depth, u = 0 at inner, 1 at outer
uniform float inner;
uniform float outer;
uniform vec3 normal;          // ring-plane normal (Saturn's north pole), render frame
uniform vec3 tint;            // particle colour, unit luminance
uniform float A;              // single-scattering albedo x phase factor
uniform float irradiance;
uniform vec3 sunPos;
uniform float sunRadius;
uniform vec3 planetPos;
uniform mat3 planetAxes;      // A of ELLIPSOID_SHADOW
uniform float planetK;        // k of ELLIPSOID_SHADOW
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
${ELLIPSOID_SHADOW}

void main() {
  #include <logdepthbuf_fragment>
  float r = length(vLocal);
  if (r < inner || r > outer) discard;
  float tau = texture2D(tauMap, vec2((r - inner) / (outer - inner), 0.5)).r;
  if (tau <= 1e-4) discard;
  vec3 toSun = sunPos - vWorld;
  float dSun = length(toSun);
  vec3 s = toSun / dSun;
  vec3 v = normalize(-vWorld);
  float sn = dot(s, normal), vn = dot(v, normal);
  float mu0 = max(abs(sn), 1e-3), mu = max(abs(vn), 1e-3);
  float iof;
  if (sn * vn > 0.0) {
    iof = A * mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu)));
  } else {
    float d = mu - mu0;
    iof = abs(d) < 1e-4 ? A * tau / mu * exp(-tau / mu)
                        : A * mu0 / d * (exp(-tau / mu) - exp(-tau / mu0));
  }
  float shade = ellipsoidShadow(vWorld, sunPos, sunRadius, planetPos, planetAxes, planetK);
  float opacity = 1.0 - exp(-tau / mu);
  // Premultiplied: the ring's own light plus what shows through it.
  gl_FragColor = vec4(tint * iof * irradiance * shade, opacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface RingProfile { innerKm: number; stepKm: number; tau: number[] }

export function tauTexture(p: RingProfile): THREE.DataTexture {
  const data = new Uint16Array(p.tau.length);
  for (let i = 0; i < p.tau.length; i++) data[i] = THREE.DataUtils.toHalfFloat(p.tau[i]);
  const t = new THREE.DataTexture(data, p.tau.length, 1, THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function makeRings(tau: THREE.DataTexture, innerKm: number, outerKm: number, unitKm: number): THREE.Mesh {
  const geom = new THREE.RingGeometry(innerKm / unitKm, outerKm / unitKm, 512, 1);
  const tint = new THREE.Color(1.0, 0.9, 0.76);
  tint.multiplyScalar(1 / (0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      tauMap: { value: tau },
      inner: { value: innerKm / unitKm },
      outer: { value: outerKm / unitKm },
      normal: { value: new THREE.Vector3(0, 1, 0) },
      tint: { value: tint },
      A: { value: 1.0 },
      irradiance: { value: 1 },
      sunPos: { value: new THREE.Vector3() },
      sunRadius: { value: 1 },
      planetPos: { value: new THREE.Vector3() },
      planetAxes: { value: new THREE.Matrix3() },
      planetK: { value: 0 },
    },
  });
  return new THREE.Mesh(geom, mat);
}
