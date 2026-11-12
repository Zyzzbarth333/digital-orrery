// src/scene/bodyMaterial.ts
//
// Sunlight on a body, as a camera would see it (docs/frontend/lighting.md).
//
// - Irradiance falls off as 1/d^2 from the Sun; the scene's exposure, not the
//   light, decides how bright that looks (OrreryScene sets the exposure).
// - No ambient light: a night side gets nothing (earthshine and the like are
//   not modelled yet).
// - Airless regolith (Mercury, the Moon, Pluto) scatters close to
//   Lommel-Seeliger, mu0 / (mu0 + mu), which is why the full Moon looks flat
//   and does not darken at the limb; the other bodies use Lambert, mu0.
// - Eclipses: for each occluding sphere the fraction of the Sun's disc still
//   visible from the surface point is the area outside the overlap of two
//   discs (the Sun's and the occluder's, as angular radii). That gives the
//   umbra, penumbra and annular phases with their true sizes.
//
// All positions are in render units relative to the camera (the floating
// origin), so they stay small near the camera where shadows matter.

import * as THREE from 'three';

export const MAX_OCCLUDERS = 4;

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#define MAX_OCC ${MAX_OCCLUDERS}
uniform vec3 albedo;          // linear RGB
uniform float irradiance;     // sunlight relative to 1 AU, (1 AU / d)^2
uniform float lommel;         // 1 = Lommel-Seeliger, 0 = Lambert
uniform vec3 sunPos;          // render units, camera-relative
uniform float sunRadius;      // render units
uniform vec4 occluders[MAX_OCC]; // xyz centre, w radius (w = 0: unused)
varying vec3 vWorld;
varying vec3 vNormal;

// Fraction of a disc of angular radius a left visible when a disc of angular
// radius b sits at angular separation c in front of it.
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
  vec3 n = normalize(vNormal);
  vec3 toSun = sunPos - vWorld;
  float dSun = length(toSun);
  vec3 s = toSun / dSun;
  vec3 v = normalize(-vWorld);           // towards the camera (at the origin)
  float mu0 = max(dot(n, s), 0.0);
  float mu = max(dot(n, v), 0.0);
  // Both laws are scaled to give 1 when lit and seen face-on (mu0 = mu = 1).
  float lambert = mu0;
  float lommelSeeliger = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
  float brdf = mix(lambert, lommelSeeliger, lommel);

  float shade = 1.0;
  if (mu0 > 0.0) {
    float a = asin(clamp(sunRadius / dSun, 0.0, 1.0));
    for (int i = 0; i < MAX_OCC; i++) {
      vec4 o = occluders[i];
      if (o.w <= 0.0) continue;
      vec3 toOcc = o.xyz - vWorld;
      float dOcc = length(toOcc);
      if (dOcc >= dSun || dot(toOcc, s) <= 0.0) continue;   // behind the point, or beyond the Sun
      vec3 u = toOcc / dOcc;
      float b = asin(clamp(o.w / dOcc, 0.0, 1.0));
      float c = atan(length(cross(u, s)), dot(u, s));        // accurate at small angles
      shade *= visibleFraction(a, b, c);
    }
  }
  gl_FragColor = vec4(albedo * irradiance * brdf * shade, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// The colour gives only the hue; its brightness is set so the full disc at
// zero phase reflects the body's geometric albedo p. For Lommel-Seeliger
// (normalised to 1 face-on) a full disc is uniformly 1, so the surface
// reflectance is p. A Lambert sphere's full disc averages 2/3 of its
// face-on brightness, so the surface reflectance is 1.5 p.
export function makeBodyMaterial(colour: number, geometricAlbedo: number, airless: boolean): THREE.ShaderMaterial {
  const albedo = new THREE.Color(colour);                 // linear RGB
  const lum = 0.2126 * albedo.r + 0.7152 * albedo.g + 0.0722 * albedo.b;
  albedo.multiplyScalar(((airless ? 1 : 1.5) * geometricAlbedo) / lum);
  const occ: THREE.Vector4[] = [];
  for (let i = 0; i < MAX_OCCLUDERS; i++) occ.push(new THREE.Vector4(0, 0, 0, 0));
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      albedo: { value: albedo },
      irradiance: { value: 1 },
      lommel: { value: airless ? 1 : 0 },
      sunPos: { value: new THREE.Vector3() },
      sunRadius: { value: 1 },
      occluders: { value: occ },
    },
  });
}
