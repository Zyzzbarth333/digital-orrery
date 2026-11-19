// src/scene/rings.ts
//
// Planetary rings from measured optical depth (docs/frontend/lighting.md#rings,
// docs/frontend/rings.md).
//
// A ring is a layer of particles of normal optical depth tau. With mu0 and
// mu the cosines of the Sun's and the viewer's angles to the ring normal,
// classical single scattering by such a layer gives the reflectance
//
//   lit face:    I/F = A mu0/(mu0 + mu) (1 - exp(-tau (1/mu0 + 1/mu)))
//   unlit face:  I/F = A mu0/(mu - mu0) (exp(-tau/mu) - exp(-tau/mu0))
//
// and what lies behind shows through by exp(-tau/mu). A is the particles'
// single-scattering albedo times their phase function over 4. Saturn's is 1
// and constant (so the B ring has I/F about 0.5 face-on). The other planets'
// rings mix dark particles, here Lambert spheres of their geometric albedo,
// with micron dust, which scatters strongly forward (rings.js, DUST): they
// brighten when the Sun is behind them. The planet's shadow on the rings is
// its ellipsoid's, as in eclipses (bodyMaterial.ts, ELLIPSOID_SHADOW).
//
// Two shaders share that photometry:
//  - a flat layer in the planet's equatorial plane (Saturn, Uranus,
//    Neptune), drawn on an annulus mesh: a radial profile, plus up to
//    MAX_NARROW narrow rings, each an ellipse in its own slightly inclined
//    plane, found by intersecting the view ray with that plane. A narrow
//    ring is filtered over the pixel's radial footprint: once it is
//    narrower than a pixel it becomes a one-pixel line carrying the ring's
//    true light (its width times its brightness), so it neither flickers nor
//    breaks into dashes at a distance;
//  - a dust volume (Jupiter, whose gossamer rings are thousands of km
//    thick), drawn on a cylinder that bounds it: steep rays take the layer's
//    column at the mid-plane, tau / mu; rays within about 17 deg of the plane
//    are marched through the density.

import * as THREE from 'three';
import { ELLIPSOID_SHADOW, VISIBLE_FRACTION } from './bodyMaterial';
import { DUST, JUPITER } from '@digital-orrery/physics/rings.js';

export const MAX_NARROW = 16;
// Moons whose shadows a flat ring system takes at once.
export const MAX_RING_CASTERS = 4;


// The ring photometry shared by both shaders. cosTheta is the cosine of
// the scattering angle (1: light carried straight on, the Sun behind the
// ring), alpha the phase angle.
const PHOTOMETRY = /* glsl */ `
uniform float dustAlbedo;
uniform float dustG;
uniform float dustLobe;
uniform float lambert;        // 1: particles are Lambert spheres (phase law); 0: Saturn's constant A
float dustPhase(float cosTheta) {
  float g = dustG;
  return (1.0 - dustLobe) + dustLobe * (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
}
// A Lambert sphere's phase law, 1 at zero phase.
float lambertPhase(float alpha) {
  return (sin(alpha) + (PI - alpha) * cos(alpha)) / PI;
}
// The layer's I/F per unit A, lit or unlit face.
float layerIoF(float tau, float mu0, float mu, bool litFace) {
  if (litFace) return mu0 / (mu0 + mu) * (1.0 - exp(-tau * (1.0 / mu0 + 1.0 / mu)));
  float d = mu - mu0;
  return abs(d) < 1e-4 ? tau / mu * exp(-tau / mu) : mu0 / d * (exp(-tau / mu) - exp(-tau / mu0));
}
`;

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

const flatFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tauMap;     // r: normal optical depth, g: dust fraction; u = 0 at inner, 1 at outer
uniform float inner;
uniform float outer;
uniform float useProfile;
uniform vec3 normal;          // the equator's normal (the ring system's angular momentum), render frame
uniform vec3 tint;            // particle colour, unit luminance
uniform float A;              // particles' A at zero phase (their geometric albedo)
uniform float irradiance;
uniform vec3 sunPos;
uniform float sunRadius;
uniform vec3 planetPos;
uniform mat3 planetAxes;      // A of ELLIPSOID_SHADOW
uniform float planetK;        // k of ELLIPSOID_SHADOW
uniform vec4 ringOcc[${MAX_RING_CASTERS}]; // moons casting on the rings: centre, radius (render units; 0: none)
#if NARROW > 0
// Ring k: g0 = (a, e, varpi - node) of its inner edge, and the index of its
// first normal mode; g1 = the same for its outer edge, and how many modes;
// g2.x = the modes' amplitudes summed; g3 = (equivalent depth, dust
// fraction, profile row or -1, arc offset or -1). A mode is (m, A, phase):
// both edges move by -A cos(m psi - phase). Lengths in render units, angles
// in radians, from the ring's node.
uniform vec4 g0[NARROW];
uniform vec4 g1[NARROW];
uniform vec4 g2[NARROW];
uniform vec4 g3[NARROW];
uniform vec4 modes[MODES];
uniform vec3 ringX[NARROW];   // the ring's node on the equator
uniform vec3 ringY[NARROW];   // 90 deg ahead, in the ring's plane
uniform vec3 ringN[NARROW];   // its normal
uniform sampler2D profileMap; // 32 x NARROW: tau across the ring, mean 1
uniform sampler2D arcMap;     // 1024 x 1 over 360 deg: r tau multiplier, g dust fraction
uniform float profileRows;
uniform vec2 narrowBand;      // the radii (render units) between which any narrow ring lies
#endif
varying vec3 vWorld;
varying vec2 vLocal;
${VISIBLE_FRACTION}
${ELLIPSOID_SHADOW}
${PHOTOMETRY}

// Premultiplied colour and opacity of a ring element of depth tau and dust
// fraction f, seen with the ring normal n.
vec4 shadeLayer(float tau, float f, vec3 n, vec3 s, vec3 v, float cosTheta, float alpha) {
  float sn = dot(s, n), vn = dot(v, n);
  float mu0 = max(abs(sn), 1e-3), mu = max(abs(vn), 1e-3);
  float geo = layerIoF(tau, mu0, mu, sn * vn > 0.0);
  float macro = A * mix(1.0, lambertPhase(alpha), lambert);
  vec3 a = tint * macro * (1.0 - f) + vec3(dustAlbedo * dustPhase(cosTheta) * 0.25 * f);
  return vec4(a * geo, 1.0 - exp(-tau / mu));
}

vec4 over(vec4 acc, vec4 c) { return acc + (1.0 - acc.a) * c; }

void main() {
  #include <logdepthbuf_fragment>
  vec3 toSun = sunPos - vWorld;
  vec3 s = normalize(toSun);
  vec3 rd = normalize(vWorld);           // the camera sits at the render origin
  vec3 v = -rd;
  float cosTheta = dot(s, rd);           // scattering angle: from the Sun, on to the eye
  float alpha = acos(clamp(dot(s, v), -1.0, 1.0));
  vec4 acc = vec4(0.0);

  if (useProfile > 0.5) {
    float r = length(vLocal);
    if (r >= inner && r <= outer) {
      vec2 tf = texture2D(tauMap, vec2((r - inner) / (outer - inner), 0.5)).rg;
      if (tf.r > 1e-7) acc = over(acc, shadeLayer(tf.r, tf.g, normal, s, v, cosTheta, alpha));
    }
  }

#if NARROW > 0
  // The pixel's radial footprint, taken once in the equator, before any
  // per-pixel branch (a derivative after one is undefined); the narrow
  // rings are all within a degree of the equator, so it is theirs too.
  float rEq = length(vLocal);
  float F = max(fwidth(rEq), 1e-9);
  if (rEq > narrowBand.x - F && rEq < narrowBand.y + F) {
    for (int k = 0; k < NARROW; k++) {
      vec4 a0 = g0[k], a1 = g1[k], m = g2[k], c = g3[k];
      vec3 n = ringN[k];
      float dn = dot(rd, n);
      if (abs(dn) < 1e-7) continue;
      float t = dot(planetPos, n) / dn;
      if (t <= 0.0) continue;
      vec3 rel = rd * t - planetPos;
      float r = length(rel);
      // Outside the ring at every longitude: skip the rest.
      if (r < a0.x * (1.0 - a0.y) - m.x - F || r > a1.x * (1.0 + a1.y) + m.x + F) continue;
      float psi = atan(dot(rel, ringY[k]), dot(rel, ringX[k]));
      float mode = 0.0;
      int first = int(a0.w), count = int(a1.w);
      for (int j = 0; j < MODES; j++) {
        if (j >= count) break;
        vec4 md = modes[first + j];
        mode += md.y * cos(md.x * psi - md.z);
      }
      float rIn = a0.x * (1.0 - a0.y * a0.y) / (1.0 + a0.y * cos(psi - a0.z)) - mode;
      float rOut = a1.x * (1.0 - a1.y * a1.y) / (1.0 + a1.y * cos(psi - a1.z)) - mode;
      float W = max(rOut - rIn, 1e-6);
      float overlap = min(r + 0.5 * F, rOut) - max(r - 0.5 * F, rIn);
      if (overlap <= 0.0) continue;
      float cover = min(overlap / F, 1.0);
      float E = c.x, f = c.y;
      if (c.w >= 0.0) {
        float u = fract((psi - c.w) / (2.0 * PI));
        vec2 arc = texture2D(arcMap, vec2(u, 0.5)).rg;
        E *= arc.r;
        f = arc.g;
      }
      float tauMean = E / W;
      float shape = 1.0;
      if (c.z >= 0.0) {
        float u = clamp((r - rIn) / W, 0.0, 1.0);
        shape = texture2D(profileMap, vec2((u * 31.0 + 0.5) / 32.0, (c.z + 0.5) / profileRows)).r;
      }
      // Resolved: tau where the pixel falls; unresolved: the ring's mean.
      float tau = tauMean * mix(shape, 1.0, smoothstep(0.25, 1.0, F / W));
      acc = over(acc, cover * shadeLayer(tau, f, n, s, v, cosTheta, alpha));
    }
  }
#endif
  if (acc.a <= 1e-7 && dot(acc.rgb, vec3(1.0)) <= 1e-12) discard;
  float shade = ellipsoidShadow(vWorld, sunPos, sunRadius, planetPos, planetAxes, planetK);
  // The moons' shadows: each a sphere, the overlap of its disc and the Sun's.
  for (int i = 0; i < ${MAX_RING_CASTERS}; i++) {
    vec4 o = ringOcc[i];
    if (o.w <= 0.0) continue;
    vec3 toSun = sunPos - vWorld, toMoon = o.xyz - vWorld;
    float dS = length(toSun), dM = length(toMoon);
    if (dM >= dS || dot(toMoon, toSun) <= 0.0) continue;
    shade *= visibleFraction(asin(clamp(sunRadius / dS, 0.0, 1.0)), asin(clamp(o.w / dM, 0.0, 1.0)),
      atan(length(cross(toMoon, toSun)), dot(toMoon, toSun)));
  }
  gl_FragColor = vec4(acc.rgb * irradiance * shade, acc.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface RingProfile { innerKm: number; stepKm: number; tau: number[]; dust?: number[] }

export function tauTexture(p: RingProfile): THREE.DataTexture {
  const n = p.tau.length;
  const rg = !!p.dust;
  const data = new Uint16Array(n * (rg ? 2 : 1));
  for (let i = 0; i < n; i++) {
    if (rg) { data[2 * i] = THREE.DataUtils.toHalfFloat(p.tau[i]); data[2 * i + 1] = THREE.DataUtils.toHalfFloat(p.dust![i]); }
    else data[i] = THREE.DataUtils.toHalfFloat(p.tau[i]);
  }
  const t = new THREE.DataTexture(data, n, 1, rg ? THREE.RGFormat : THREE.RedFormat, THREE.HalfFloatType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const blank = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(1), THREE.DataUtils.toHalfFloat(0)]), 1, 1, THREE.RGFormat, THREE.HalfFloatType);
blank.needsUpdate = true;

function unitLuminance(c: THREE.Color): THREE.Color {
  return c.multiplyScalar(1 / (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b));
}

function dustUniforms() {
  return {
    dustAlbedo: { value: DUST.albedo }, dustG: { value: DUST.g }, dustLobe: { value: DUST.lobe },
  };
}

function shadowUniforms() {
  return {
    irradiance: { value: 1 },
    sunPos: { value: new THREE.Vector3() },
    sunRadius: { value: 1 },
    planetPos: { value: new THREE.Vector3() },
    planetAxes: { value: new THREE.Matrix3() },
    planetK: { value: 0 },
  };
}

const premultiplied = {
  transparent: true,
  depthWrite: false,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

export interface FlatRingOptions {
  tau?: THREE.Texture | null;           // the radial profile (null: none)
  profileInnerKm?: number;
  profileOuterKm?: number;
  meshInnerKm: number;
  meshOuterKm: number;
  narrow?: number;                      // how many narrow rings
  modes?: number;                       // how many normal modes among them
  profileMap?: THREE.Texture;
  profileRows?: number;
  arcMap?: THREE.Texture;
  tint?: THREE.Color;
  A?: number;
  lambert?: boolean;
}

// A flat ring system in its planet's equator (+z of the mesh).
export function makeFlatRings(o: FlatRingOptions, unitKm: number): THREE.Mesh {
  const geom = new THREE.RingGeometry(o.meshInnerKm / unitKm, o.meshOuterKm / unitKm, 512, 1);
  const n = o.narrow ?? 0;
  const vec4s = () => Array.from({ length: Math.max(n, 1) }, () => new THREE.Vector4());
  const vec3s = () => Array.from({ length: Math.max(n, 1) }, () => new THREE.Vector3());
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: flatFragment,
    defines: { NARROW: n, MODES: Math.max(o.modes ?? 0, 1) },
    side: THREE.DoubleSide,
    ...premultiplied,
    uniforms: {
      tauMap: { value: o.tau ?? blank },
      useProfile: { value: o.tau ? 1 : 0 },
      inner: { value: (o.profileInnerKm ?? 0) / unitKm },
      outer: { value: (o.profileOuterKm ?? 0) / unitKm },
      normal: { value: new THREE.Vector3(0, 1, 0) },
      tint: { value: unitLuminance(o.tint ?? new THREE.Color(1, 1, 1)) },
      A: { value: o.A ?? 1 },
      lambert: { value: o.lambert ? 1 : 0 },
      ...dustUniforms(),
      ...shadowUniforms(),
      ringOcc: { value: Array.from({ length: MAX_RING_CASTERS }, () => new THREE.Vector4()) },
      g0: { value: vec4s() }, g1: { value: vec4s() }, g2: { value: vec4s() }, g3: { value: vec4s() },
      modes: { value: Array.from({ length: Math.max(o.modes ?? 0, 1) }, () => new THREE.Vector4()) },
      ringX: { value: vec3s() }, ringY: { value: vec3s() }, ringN: { value: vec3s() },
      profileMap: { value: o.profileMap ?? blank },
      profileRows: { value: o.profileRows ?? 1 },
      arcMap: { value: o.arcMap ?? blank },
      narrowBand: { value: new THREE.Vector2(0, 0) },
    },
  });
  return new THREE.Mesh(geom, mat);
}

// Saturn's rings: the Cassini profile, constant A (as before the other
// planets' rings were added; docs/frontend/lighting.md#saturns-rings).
export function makeRings(tau: THREE.DataTexture, innerKm: number, outerKm: number, unitKm: number): THREE.Mesh {
  return makeFlatRings({
    tau, profileInnerKm: innerKm, profileOuterKm: outerKm, meshInnerKm: innerKm, meshOuterKm: outerKm,
    tint: new THREE.Color(1.0, 0.9, 0.76), A: 1,
  }, unitKm);
}

// ------------------------------------------------------------- Jupiter

const J = JUPITER;
// Halo: brightness edge-on falls as z^-0.6 near the plane and z^-1.5
// several thousand km up (Showalter 2001, via de Pater et al. 2018), out to
// the table's ~5e4 km thickness; regularised at 50 km.
const HALO_Z0 = 50, HALO_Z1 = 2000, HALO_ZMAX = 25000;
// Gossamer rings: dust on orbits tilted by i has z = r sin i sin(u), so its
// time-averaged density is 1 / (pi sqrt(h^2 - z^2)) with h = r sin i, which
// peaks at the edges; softened (EPS) so it stays finite.
const GOSSAMER_EPS = 0.06;
// The halo's vertical profile integrated from the plane to |z|, in closed
// form, and its total over the slab (for the normalisation).
const HALO_C = Math.pow(HALO_Z1, 0.9);
function haloK(z: number): number {
  const a = Math.min(Math.abs(z), HALO_ZMAX) + HALO_Z0;
  const k1 = (Math.pow(HALO_Z1, 0.4) - Math.pow(HALO_Z0, 0.4)) / 0.4;
  return a < HALO_Z1 ? (Math.pow(a, 0.4) - Math.pow(HALO_Z0, 0.4)) / 0.4 : k1 + 2 * HALO_C * (Math.pow(HALO_Z1, -0.5) - Math.pow(a, -0.5));
}
const HALO_TOTAL = 2 * haloK(HALO_ZMAX);
// The main ring's radial shape: MAIN_SHELLS equal shells between its edges,
// each a multiple of the ring's mean depth. New Horizons LORRI measured it
// (python/textures/lorri.py; setMainShape); until that file loads, and
// without it, the shape is the bright outer annulus as a step, twice as
// deep over the outer 800 km, keeping the mean the table's.
export const MAIN_SHELLS = 14;
const MAIN_STEP = (J.main.outer - J.main.inner) / MAIN_SHELLS;
const MAIN_INNER = (J.main.outer - J.main.inner) / (J.main.outer - J.main.inner + J.main.annulus);
function stepShape(): number[] {
  const split = J.main.outer - J.main.annulus;
  return Array.from({ length: MAIN_SHELLS }, (_, k) => {
    const a = J.main.inner + k * MAIN_STEP, b = a + MAIN_STEP;
    const inAnnulus = Math.max(0, Math.min(b, J.main.outer) - Math.max(a, split)) / MAIN_STEP;
    return MAIN_INNER * (1 + inAnnulus);
  });
}
const f = (x: number) => x.toExponential(6);

// The column through each part along a view ray: the main ring, the halo
// and the Thebe extension are uniform in radius between their edges, so
// their column is exact: the ray's stretches inside each cylindrical shell,
// times the vertical profile integrated in closed form between the heights
// where it enters and leaves. The gossamer rings, whose thickness grows
// with radius, are marched (16 jittered samples over their slab).
const dustFragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform mat3 toRing;          // render -> ring frame (rows: X, Y, pole)
uniform vec3 tint;            // parent bodies' colour, unit luminance
uniform float A;
uniform float irradiance;
uniform vec3 sunPos;
uniform float sunRadius;
uniform vec3 planetPos;
uniform mat3 planetAxes;
uniform float planetK;
uniform float slabH;
uniform float outerR;
uniform float sinAm;          // sin of Amalthea's and Thebe's inclinations
uniform float sinTh;
uniform float U;              // render units per km
uniform float pxAngle;        // a pixel's angular size, rad
uniform float mainDepth[${MAIN_SHELLS}];   // the main ring's shells, multiples of its mean depth
varying vec3 vWorld;
varying vec2 vLocal;
${VISIBLE_FRACTION}
${ELLIPSOID_SHADOW}
${PHOTOMETRY}

float erf1(float x) {         // Abramowitz and Stegun 7.1.26, |error| < 1.5e-7
  float sg = sign(x); x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  return sg * (1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x));
}
// Signed vertical integrals from the plane to z (half the total at the slab's edge).
// The main ring's Gaussian thickness, widened to a pixel's footprint where
// it is thinner than that (edge-on from afar), so it stays one smooth line.
float gSigma = ${(J.main.thickness / 2.3548).toFixed(3)};
float mainC(float z) { return 0.5 * erf1(z / (gSigma * 1.41421356)); }
float haloC(float z) {
  float a = min(abs(z), ${HALO_ZMAX.toFixed(1)}) + ${HALO_Z0.toFixed(1)};
  float k = a < ${HALO_Z1.toFixed(1)} ? (pow(a, 0.4) - ${Math.pow(HALO_Z0, 0.4).toFixed(6)}) / 0.4
          : ${((Math.pow(HALO_Z1, 0.4) - Math.pow(HALO_Z0, 0.4)) / 0.4).toFixed(6)} + ${(2 * HALO_C).toFixed(6)} * (${Math.pow(HALO_Z1, -0.5).toFixed(8)} - pow(a, -0.5));
  return sign(z) * k / ${HALO_TOTAL.toFixed(6)};
}
float extC(float z) { return clamp(z / ${J.thebeExtension.thickness.toFixed(1)}, -0.5, 0.5); }
float profileC(int kind, float z) { return kind == 0 ? mainC(z) : kind == 1 ? haloC(z) : extC(z); }

// Whether the Sun is hidden by the planet from x (render units): a hard
// umbra, enough for faint dust.
float lit(vec3 x, vec3 sA) {
  vec3 p = planetAxes * (x - planetPos);
  float b = dot(p, sA);
  float c = dot(p, p) - 1.0;
  return (c > 0.0 && b < 0.0 && b * b > c * dot(sA, sA)) ? 0.0 : 1.0;
}

vec3 gO, gD, gSA;             // the ray (km, ring frame), the Sun in the planet's unit-sphere frame
vec3 gRd;
float gT0, gT1;

// The ray's t where it is inside radius R: [lo, hi], empty if lo >= hi.
vec2 insideR(float R) {
  float qa = dot(gD.xy, gD.xy), qb = dot(gO.xy, gD.xy), qc = dot(gO.xy, gO.xy) - R * R;
  float disc = qb * qb - qa * qc;
  if (disc <= 0.0 || qa < 1e-12) return qc < 0.0 ? vec2(-1e12, 1e12) : vec2(1.0, 0.0);
  float sq = sqrt(disc);
  return vec2((-qb - sq) / qa, (-qb + sq) / qa);
}
// Column through a stretch [a, b] of the ray for profile kind: the
// profile's mean over the heights crossed, times the length.
float stretch(float a, float b, int kind) {
  a = max(a, gT0); b = min(b, gT1);
  if (b <= a) return 0.0;
  float za = gO.z + a * gD.z, zb = gO.z + b * gD.z;
  float tc = clamp(abs(gD.z) > 1e-9 ? -gO.z / gD.z : 0.5 * (a + b), a, b);
  float F = tc * pxAngle;
  gSigma = sqrt(${((J.main.thickness / 2.3548) ** 2).toFixed(3)} + 0.16 * F * F);
  float c = abs(zb - za) > 1.0 ? (profileC(kind, zb) - profileC(kind, za)) / (zb - za)
          : (profileC(kind, 0.5 * (za + zb) + 0.5) - profileC(kind, 0.5 * (za + zb) - 0.5));
  // Sunlit or not where the stretch is closest to the plane.
  return c * (b - a) * lit(gRd * tc * U, gSA);
}
// Column through the shell ra < r < rb.
float shell(float ra, float rb, int kind) {
  vec2 o = insideR(rb), i = insideR(ra);
  if (o.x >= o.y) return 0.0;
  if (i.x >= i.y) return stretch(o.x, o.y, kind);
  return stretch(o.x, min(o.y, i.x), kind) + stretch(max(o.x, i.y), o.y, kind);
}
// Softened by e (at least the pixel's footprint over h, so the bright
// edges stay smooth from afar), normalised for that e in closed form.
float gossamerShape(float x, float e) {
  if (abs(x) > 1.0) return 0.0;
  float xe = sqrt(1.0 - e);
  float total = (2.0 / PI) * (asin(xe) + (1.0 - xe) / sqrt(e));
  return 1.0 / (total * PI * sqrt(max(1.0 - x * x, e)));
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 rd = normalize(vWorld);
  vec3 o = toRing * (-planetPos) / U;    // camera in the ring frame, km
  vec3 d = toRing * rd;
  // The ray's stretch inside the slab |z| < H and the cylinder r < R.
  float t0 = 0.0, t1 = 1e12;
  if (abs(d.z) > 1e-9) {
    float ta = (-slabH - o.z) / d.z, tb = (slabH - o.z) / d.z;
    t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb));
  } else if (abs(o.z) > slabH) discard;
  // The planet hides what lies behind it.
  vec3 pa = planetAxes * (-planetPos), da = planetAxes * rd;
  float pb = dot(pa, da), pc = dot(pa, pa) - 1.0, pdisc = pb * pb - dot(da, da) * pc;
  if (pdisc > 0.0) {
    float tp = (-pb - sqrt(pdisc)) / dot(da, da);
    if (tp > 0.0) t1 = min(t1, tp / U);
  }
  if (t1 <= t0) discard;
  vec3 s = normalize(sunPos - vWorld);
  gO = o; gD = d; gRd = rd; gSA = planetAxes * s; gT0 = t0; gT1 = t1;

  // The main ring is thin: a ray that crosses its plane at more than about
  // 3 deg meets it at one radius, so its column is the whole annulus's,
  // times the measured depth there. Only grazing rays, which run along it
  // through several shells, add the shells one by one.
  float mainCol = 0.0;
  if (abs(d.z) > 0.05) {
    float tc = clamp(-o.z / d.z, t0, t1);
    float rc = length((o + tc * d).xy);
    int k = int(clamp(floor((rc - ${J.main.inner.toFixed(1)}) / ${MAIN_STEP.toFixed(4)}), 0.0, ${(MAIN_SHELLS - 1).toFixed(1)}));
    mainCol = shell(${J.main.inner.toFixed(1)}, ${J.main.outer.toFixed(1)}, 0) * mainDepth[k];
  } else {
    for (int k = 0; k < ${MAIN_SHELLS}; k++) {
      float ra = ${J.main.inner.toFixed(1)} + float(k) * ${MAIN_STEP.toFixed(4)};
      mainCol += shell(ra, ra + ${MAIN_STEP.toFixed(4)}, 0) * mainDepth[k];
    }
  }
  vec2 col = vec2(mainCol * ${f(J.main.tauDust)}, mainCol * ${f(J.main.tauBodies)});
  col.x += shell(${J.halo.inner.toFixed(1)}, ${J.halo.outer.toFixed(1)}, 1) * ${f(J.halo.tau)};
  col.x += shell(${J.thebeExtension.inner.toFixed(1)}, ${J.thebeExtension.outer.toFixed(1)}, 2) * ${f(J.thebeExtension.tau)};

  // Gossamer rings: march their slab inside Thebe's orbit.
  float hMax = ${J.thebe.outer.toFixed(1)} * sinTh;
  float g0 = t0, g1 = t1;
  if (abs(d.z) > 1e-9) {
    float ta = (-hMax - o.z) / d.z, tb = (hMax - o.z) / d.z;
    g0 = max(g0, min(ta, tb)); g1 = min(g1, max(ta, tb));
  } else if (abs(o.z) > hMax) g1 = g0;
  vec2 inT = insideR(${J.thebe.outer.toFixed(1)});
  g0 = max(g0, inT.x); g1 = min(g1, inT.y);
  if (g1 > g0) {
    const int N = 16;
    float dt = (g1 - g0) / float(N);
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    float sum = 0.0;
    for (int i = 0; i < N; i++) {
      float t = g0 + (float(i) + j) * dt;
      vec3 x = o + t * d;
      float r = length(x.xy);
      if (r < ${J.amalthea.inner.toFixed(1)}) continue;
      float hA = r * sinAm, hT = r * sinTh, F = t * pxAngle;
      float n = (r < ${J.amalthea.outer.toFixed(1)} ? gossamerShape(x.z / hA, clamp(2.0 * F / hA, ${GOSSAMER_EPS.toFixed(3)}, 1.0)) / hA * ${f(J.amalthea.tau)} : 0.0)
              + gossamerShape(x.z / hT, clamp(2.0 * F / hT, ${GOSSAMER_EPS.toFixed(3)}, 1.0)) / hT * ${f(J.thebe.tau)};
      if (n > 0.0) sum += n * lit(rd * t * U, gSA);
    }
    col.x += sum * dt;
  }
  if (col.x + col.y <= 0.0) discard;
  float cosTheta = dot(s, rd);
  float alpha = acos(clamp(-cosTheta, -1.0, 1.0));
  vec3 iof = vec3(dustAlbedo * dustPhase(cosTheta) * 0.25) * col.x + tint * A * lambertPhase(alpha) * col.y;
  gl_FragColor = vec4(iof * irradiance, 1.0 - exp(-(col.x + col.y)));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Jupiter's dust rings: a cylinder about the planet (axis +z) bounding them.
export function makeDustRings(unitKm: number, sinAmalthea: number, sinThebe: number, albedo: number): THREE.Mesh {
  const R = J.thebeExtension.outer + 3000, H = HALO_ZMAX;
  const geom = new THREE.CylinderGeometry(R / unitKm, R / unitKm, (2 * H) / unitKm, 256, 1, false);
  geom.rotateX(Math.PI / 2);             // axis along +z, as the flat rings' normal
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: dustFragment,
    side: THREE.FrontSide,
    ...premultiplied,
    uniforms: {
      toRing: { value: new THREE.Matrix3() },
      tint: { value: unitLuminance(new THREE.Color(1.0, 0.72, 0.55)) },
      A: { value: albedo },
      lambert: { value: 1 },
      ...dustUniforms(),
      ...shadowUniforms(),
      slabH: { value: H },
      outerR: { value: R },
      sinAm: { value: sinAmalthea },
      sinTh: { value: sinThebe },
      U: { value: 1 / unitKm },
      pxAngle: { value: 1e-3 },
      mainDepth: { value: stepShape() },
    },
  });
  return new THREE.Mesh(geom, mat);
}

// The main ring's measured shape (MAIN_SHELLS multiples of its mean depth,
// inner to outer), from rings_lorri.json.
export function setMainShape(mesh: THREE.Mesh, depth: number[]): void {
  if (depth.length !== MAIN_SHELLS) throw new Error(`main ring: ${depth.length} shells, not ${MAIN_SHELLS}`);
  (mesh.material as THREE.ShaderMaterial).uniforms.mainDepth.value = depth.slice();
}
