// src/scene/orbitTrail.ts
//
// How an orbit line is shaded: the whole orbit as a faint outline, and a
// bright trail just behind the body that fades over about a quarter of an
// orbit, drawn additively so it glows. Each vertex carries u, its time
// offset from the line's centre as a fraction of the period; `now` is the
// body's own offset, so the trail follows the body between resamples.
// A drawing aid, kept out of the exposure and tone mapping.

import * as THREE from 'three';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float u;
varying float vU;
void main() {
  vU = u;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 colour;
uniform float now;        // the body's offset, same units as u
uniform float outline;    // opacity of the whole orbit
uniform float tail;       // fade length, as a fraction of the period
varying float vU;
void main() {
  #include <logdepthbuf_fragment>
  float behind = now - vU;                         // > 0 behind the body
  float glow = behind >= 0.0 ? exp(-behind / tail) : 0.0;
  float a = outline + (1.0 - outline) * glow;
  // Lift the body's (often dark) mean colour so every line reads, and let
  // the head of the trail run hotter still.
  vec3 c = mix(colour, vec3(1.0), 0.35 + 0.35 * glow);
  gl_FragColor = vec4(c * a, a);
}
`;

export function orbitTrailMaterial(colour: number, outline = 0.3, tail = 0.08): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      colour: { value: new THREE.Color(colour) },
      now: { value: 0 },
      outline: { value: outline },
      tail: { value: tail },
    },
  });
}
