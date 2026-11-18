// src/scene/screenLines.ts
//
// Line segments a constant width on screen, as an instrument's marks are
// drawn: each segment a quad widened in the vertex shader to its width in
// CSS pixels (scaled to the target's pixels), its edges smoothed by the
// pixel's coverage, its ends trimmed to the near plane. A segment's half
// width can differ at its two ends, so one drawn to nothing at its tip is
// a filled arrowhead. Ends are square and unpadded, so segments meeting at
// a vertex do not overlap (additive blending would light the joint).
//
// GL_LINES are 1 px wide whatever is asked, aliased, and swim as the
// geometry turns; this is what three's LineSegments2 does, with its own
// coverage instead of alpha-to-coverage and a per-end width and alpha.

import * as THREE from 'three';

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 segA;
attribute vec3 segB;
attribute vec2 halfWidth;     // CSS px at A and at B
attribute vec2 alphas;        // at A and at B
attribute float side;         // -1 or +1 across the segment
attribute float atEnd;        // 0 at A, 1 at B
uniform vec2 resolution;      // the target's pixels
uniform float pxScale;        // target pixels per CSS pixel
varying float vAlpha;
varying float vAcross;        // signed distance from the centre line, target px
varying float vHalf;          // the half width here, target px
void main() {
  vec4 a = modelViewMatrix * vec4(segA, 1.0);
  vec4 b = modelViewMatrix * vec4(segB, 1.0);
  // Trim to the near plane, so a segment passing behind the camera keeps
  // the part in front (as LineMaterial does).
  float near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
  float zNear = -near * 1.0001;
  if (a.z > zNear && b.z > zNear) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (a.z > zNear) a = mix(a, b, (zNear - a.z) / (b.z - a.z));
  else if (b.z > zNear) b = mix(b, a, (zNear - b.z) / (a.z - b.z));
  vec4 ca = projectionMatrix * a, cb = projectionMatrix * b;
  vec2 sa = ca.xy / ca.w * 0.5 * resolution, sb = cb.xy / cb.w * 0.5 * resolution;
  vec2 d = sb - sa;
  float len = length(d);
  vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float hw = mix(halfWidth.x, halfWidth.y, atEnd) * pxScale;
  float pad = hw + 1.0;                       // a pixel more for the smoothed edge
  vec4 c = atEnd > 0.5 ? cb : ca;
  c.xy += n * side * pad / (0.5 * resolution) * c.w;
  gl_Position = c;
  vAcross = side * pad;
  vHalf = hw;
  vAlpha = mix(alphas.x, alphas.y, atEnd);
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 colour;
uniform float level;
varying float vAlpha;
varying float vAcross;
varying float vHalf;
void main() {
  #include <logdepthbuf_fragment>
  // The pixel's coverage of the stroke; under a pixel wide, the stroke's
  // whole width in one pixel, dimmer.
  float h = max(vHalf, 0.5);
  float cover = clamp(h + 0.5 - abs(vAcross), 0.0, 1.0) * min(1.0, vHalf / 0.5);
  float a = vAlpha * cover;
  if (a < 0.003) discard;
  gl_FragColor = vec4(colour * a * level, a);
}
`;

export class ScreenLines {
  readonly mesh: THREE.Mesh;
  private a: THREE.BufferAttribute;
  private b: THREE.BufferAttribute;
  private w: THREE.BufferAttribute;
  private al: THREE.BufferAttribute;
  private resolution = new THREE.Vector2(1, 1);
  private cssWidth = 1;

  constructor(readonly capacity: number, colour: number) {
    const g = new THREE.BufferGeometry();
    const n = capacity * 4;
    this.a = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.b = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.w = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    this.al = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
    for (const at of [this.a, this.b, this.w, this.al]) at.setUsage(THREE.DynamicDrawUsage);
    const side = new Float32Array(n), end = new Float32Array(n), index: number[] = [];
    for (let i = 0; i < capacity; i++) {
      side.set([-1, 1, -1, 1], 4 * i);
      end.set([0, 0, 1, 1], 4 * i);
      const o = 4 * i;
      index.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
    g.setAttribute('segA', this.a);
    g.setAttribute('segB', this.b);
    g.setAttribute('halfWidth', this.w);
    g.setAttribute('alphas', this.al);
    g.setAttribute('side', new THREE.BufferAttribute(side, 1));
    g.setAttribute('atEnd', new THREE.BufferAttribute(end, 1));
    // three needs a position attribute to count vertices.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setIndex(index);
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { colour: { value: new THREE.Color(colour) }, level: { value: 1 }, resolution: { value: this.resolution }, pxScale: { value: 1 } },
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    // The target's size as it is drawn (the HDR pass may be scaled).
    this.mesh.onBeforeRender = (renderer) => {
      const t = renderer.getRenderTarget();
      if (t) this.resolution.set(t.width, t.height); else renderer.getDrawingBufferSize(this.resolution);
      m.uniforms.pxScale.value = this.resolution.x / Math.max(1, this.cssWidth);
    };
  }

  get material(): THREE.ShaderMaterial { return this.mesh.material as THREE.ShaderMaterial; }

  // The sky's width in CSS pixels, for widths given in them.
  setViewWidth(cssWidth: number): void { this.cssWidth = cssWidth; }

  // Segment i from p to q: half widths (CSS px) and alphas at each end.
  set(i: number, p: THREE.Vector3, q: THREE.Vector3, wp: number, wq: number, ap: number, aq: number): void {
    for (let k = 0; k < 4; k++) {
      const v = 4 * i + k;
      this.a.setXYZ(v, p.x, p.y, p.z);
      this.b.setXYZ(v, q.x, q.y, q.z);
      this.w.setXY(v, wp, wq);
      this.al.setXY(v, ap, aq);
    }
  }

  // Segment i drawn as nothing.
  clear(i: number): void {
    for (let k = 0; k < 4; k++) this.al.setXY(4 * i + k, 0, 0);
  }

  commit(): void {
    for (const at of [this.a, this.b, this.w, this.al]) at.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
