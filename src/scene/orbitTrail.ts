// src/scene/orbitTrail.ts
//
// How an orbit line is shaded: the whole orbit as a faint outline, and a
// bright trail just behind the body that fades over about a quarter of an
// orbit, drawn additively so it glows. Each vertex carries u, its time
// offset from the line's centre as a fraction of the period; `now` is the
// body's own offset, so the trail follows the body between resamples.
// A drawing aid at a display level: divided by the exposure (level) that
// the HDR output applies.
//
// Close in, a line recedes: where it passes the camera at less than 5 % of
// its orbit's size (`reach`, the farthest point from what it circles) it
// fades, to nothing under 0.3 %. Zoomed in on a body, its own orbit about
// the Sun is a nearly straight line through the view that says nothing
// about the curve; at system scale every line is far from the camera
// against its size and stays as it was.

import * as THREE from 'three';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float u;
varying float vU;
varying vec3 vView;
void main() {
  vU = u;
  vec4 v = modelViewMatrix * vec4(position, 1.0);
  vView = v.xyz;
  gl_Position = projectionMatrix * v;
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
uniform float level;      // 1 / exposure: drawn at a display level through the HDR output
uniform vec2 gap;         // (centre, half-width) in u left to a finer line; half-width < 0: none
uniform float reach;      // the orbit's size, render units; 0: never fades
varying float vU;
varying vec3 vView;
void main() {
  if (abs(vU - gap.x) < gap.y) discard;
  #include <logdepthbuf_fragment>
  float behind = now - vU;                         // > 0 behind the body
  float glow = behind >= 0.0 ? exp(-behind / tail) : 0.0;
  float a = outline + (1.0 - outline) * glow;
  if (reach > 0.0) a *= smoothstep(0.003, 0.05, length(vView) / reach);
  if (a < 0.002) discard;
  // Lift the body's (often dark) mean colour so every line reads, and let
  // the head of the trail run hotter still.
  vec3 c = mix(colour, vec3(1.0), 0.35 + 0.35 * glow);
  gl_FragColor = vec4(c * a * level, a);
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
      level: { value: 1 },
      gap: { value: new THREE.Vector2(0, -1) },
      reach: { value: 0 },
    },
  });
}

// The farthest of a line's points from its origin: its orbit's size.
export function reachOf(positions: ArrayLike<number>): number {
  let r2 = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) r2 = Math.max(r2, positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2);
  return Math.sqrt(r2);
}
