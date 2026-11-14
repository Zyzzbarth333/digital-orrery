// src/scene/atmosphere.ts
//
// Physically based atmospheres (docs/frontend/atmospheres.md): single
// scattering by molecules (Rayleigh) and aerosols (Mie), with ozone
// absorption, integrated along each view ray through a shell around the
// planet, and the same medium's transmittance applied to the sunlight that
// reaches the surface (sunset reddening at the terminator).
//
// All lengths in the shaders are km, relative to the planet's centre;
// coefficients are per km.

import * as THREE from 'three';

export interface AtmosphereParams {
  topKm: number;               // height of the shell above the surface
  rayleigh: [number, number, number];   // scattering at the surface, 1/km (R, G, B ~ 680, 550, 440 nm)
  rayleighHKm: number;
  mieScatter: [number, number, number]; // 1/km
  mieExtinct: [number, number, number]; // 1/km
  mieHKm: number;
  mieG: number;                // Cornette-Shanks asymmetry
  ozone: [number, number, number];      // absorption at the layer's peak, 1/km
  ozoneCentreKm: number;
  ozoneHalfWidthKm: number;
  source: string;
}

// Earth: Bruneton's reference model (precomputed_atmospheric_scattering,
// demo.cc): Rayleigh 1.24062e-6 lambda^-4 /m (lambda in um) at 680, 550 and
// 440 nm with an 8 km scale height; Mie extinction 5.328e-3 / 1.2 km
// (Angstrom beta over the scale height) = 4.44e-6 /m with single-scattering
// albedo 0.9, g = 0.8; ozone in a tent from 10 to 40 km peaking at 25 km.
// The ozone peak coefficients are Hillaire's (2020), not yet checked
// against the paper.
export const EARTH_ATMOSPHERE: AtmosphereParams = {
  topKm: 100,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighHKm: 8,
  mieScatter: [3.996e-3, 3.996e-3, 3.996e-3],
  mieExtinct: [4.44e-3, 4.44e-3, 4.44e-3],
  mieHKm: 1.2,
  mieG: 0.8,
  ozone: [0.650e-3, 1.881e-3, 0.085e-3],
  ozoneCentreKm: 25,
  ozoneHalfWidthKm: 15,
  source: 'Bruneton (2017) reference model; ozone peak from Hillaire (2020)',
};

// Size of the transmittance table (columns: view angle, rows: altitude).
const LUT_W = 256, LUT_H = 64;

// Shared GLSL: the medium's density and the transmittance from a point
// along a direction to the top of the atmosphere (or 0 if the ray meets the
// ground). Needs the uniforms declared in ATMO_UNIFORMS.
export const ATMO_UNIFORMS = /* glsl */ `
uniform float atmoRg;       // ground radius, km
uniform float atmoRt;       // top radius, km
uniform vec3 atmoBetaR;
uniform float atmoHR;
uniform vec3 atmoBetaMs;
uniform vec3 atmoBetaMe;
uniform float atmoHM;
uniform float atmoG;
uniform vec3 atmoBetaO;
uniform float atmoOzC;
uniform float atmoOzW;
uniform sampler2D atmoTransLut;
`;

export const ATMO_FUNCS = /* glsl */ `
// Nearest and farthest t >= 0 where p + t d meets the sphere of radius R
// (x = -1 if it does not).
vec2 atmoSphere(vec3 p, vec3 d, float R) {
  float b = dot(p, d);
  float c = dot(p, p) - R * R;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  // Stable roots: avoid subtracting nearly equal numbers.
  float q = b > 0.0 ? -(b + s) : -(b - s);
  float t1 = q, t2 = c / q;
  return vec2(min(t1, t2), max(t1, t2));
}

// Extinction coefficient (1/km) at altitude h km.
vec3 atmoExtinction(float h) {
  float r = exp(-h / atmoHR);
  float m = exp(-h / atmoHM);
  float o = max(0.0, 1.0 - abs(h - atmoOzC) / atmoOzW);
  return atmoBetaR * r + atmoBetaMe * m + atmoBetaO * o;
}

// Transmittance from p (km, planet-centred) toward unit direction s to the
// top of the atmosphere; zero if the ray meets the ground. Looked up in a
// table made once on the CPU (transmittanceLut), in Bruneton's (2017)
// parametrisation: x_r = rho / H, x_mu = (d - d_min) / (d_max - d_min).
// The ray march it replaces cost 8 samples (24 exp) at every step of every
// view ray, most of the Earth view's frame time on an integrated GPU.
vec3 atmoSunTransmittance(vec3 p, vec3 s) {
  vec2 g = atmoSphere(p, s, atmoRg);
  if (g.x > 0.0) return vec3(0.0);
  float r = clamp(length(p), atmoRg, atmoRt);
  float mu = clamp(dot(p, s) / length(p), -1.0, 1.0);
  float H = sqrt(atmoRt * atmoRt - atmoRg * atmoRg);
  float rho = sqrt(max(r * r - atmoRg * atmoRg, 0.0));
  float d = max(-r * mu + sqrt(max(r * r * (mu * mu - 1.0) + atmoRt * atmoRt, 0.0)), 0.0);
  float dMin = atmoRt - r, dMax = rho + H;
  float xMu = (d - dMin) / max(dMax - dMin, 1e-6);
  float xR = rho / H;
  vec2 uv = vec2(0.5 / ${LUT_W}.0 + xMu * ${LUT_W - 1}.0 / ${LUT_W}.0, 0.5 / ${LUT_H}.0 + xR * ${LUT_H - 1}.0 / ${LUT_H}.0);
  return texture2D(atmoTransLut, uv).rgb;
}
`;

// The transmittance table: rows are x_r (ground to top), columns x_mu
// (straight up to the horizon), each texel exp(-optical depth) along the ray
// to the top, integrated with 48 midpoint steps.
const lutCache = new Map<string, THREE.DataTexture>();
let blankLut: THREE.DataTexture | null = null;

export function transmittanceLut(a: AtmosphereParams, groundKm: number): THREE.DataTexture {
  if (a.rayleigh.every((v) => v === 0) && a.mieExtinct.every((v) => v === 0)) {
    if (!blankLut) {
      blankLut = new THREE.DataTexture(new Uint16Array([0x3c00, 0x3c00, 0x3c00, 0x3c00]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
      blankLut.needsUpdate = true;
    }
    return blankLut;
  }
  const key = `${a.source}|${groundKm}|${a.topKm}`;
  const hit = lutCache.get(key);
  if (hit) return hit;
  const Rg = groundKm, Rt = groundKm + a.topKm;
  const H = Math.sqrt(Rt * Rt - Rg * Rg);
  const data = new Uint16Array(LUT_W * LUT_H * 4);
  const STEPS = 48;
  for (let j = 0; j < LUT_H; j++) {
    const rho = (H * j) / (LUT_H - 1);
    const r = Math.sqrt(rho * rho + Rg * Rg);
    for (let i = 0; i < LUT_W; i++) {
      const dMin = Rt - r, dMax = rho + H;
      const d = dMin + ((dMax - dMin) * i) / (LUT_W - 1);
      const mu = d === 0 ? 1 : Math.max(-1, Math.min(1, (H * H - rho * rho - d * d) / (2 * r * d)));
      const ds = d / STEPS;
      let tr = 0, tm = 0, to = 0;
      for (let k = 0; k < STEPS; k++) {
        const t = (k + 0.5) * ds;
        const h = Math.sqrt(r * r + t * t + 2 * r * mu * t) - Rg;
        tr += Math.exp(-h / a.rayleighHKm);
        tm += Math.exp(-h / a.mieHKm);
        to += Math.max(0, 1 - Math.abs(h - a.ozoneCentreKm) / a.ozoneHalfWidthKm);
      }
      const o = 4 * (j * LUT_W + i);
      for (let c = 0; c < 3; c++) {
        const tau = (a.rayleigh[c] * tr + a.mieExtinct[c] * tm + a.ozone[c] * to) * ds;
        data[o + c] = THREE.DataUtils.toHalfFloat(Math.exp(-tau));
      }
      data[o + 3] = 0x3c00;
    }
  }
  const tex = new THREE.DataTexture(data, LUT_W, LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  lutCache.set(key, tex);
  return tex;
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_UNIFORMS}
uniform vec3 centre;          // planet centre, render units, camera-relative
uniform float unitKm;
uniform vec3 sunDir;          // unit vector to the Sun from the planet
uniform float irradiance;     // sunlight relative to 1 AU
uniform float inside;         // 1 when the camera is inside the shell
varying vec3 vWorld;
${ATMO_FUNCS}

void main() {
  #include <logdepthbuf_fragment>
  // Draw each ray once: front faces from outside, back faces from inside.
  if ((inside > 0.5) == gl_FrontFacing) discard;
  vec3 d = normalize(vWorld);                       // camera at the origin
  vec3 p = inside > 0.5 ? -centre * unitKm : (vWorld - centre) * unitKm;
  vec2 top = atmoSphere(p, d, atmoRt);
  float tEnd = max(top.y, 0.0);
  vec2 ground = atmoSphere(p, d, atmoRg);
  if (ground.x > 0.0) tEnd = min(tEnd, ground.x);
  if (tEnd <= 0.0) discard;

  float mu = dot(d, sunDir);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = atmoG, g2 = g * g;
  float phM = 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + mu * mu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));

  const int N = 32;
  float ds = tEnd / float(N);
  vec3 tau = vec3(0.0), L = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = p + d * ((float(i) + 0.5) * ds);
    float h = length(q) - atmoRg;
    vec3 ext = atmoExtinction(h);
    vec3 tauMid = tau + 0.5 * ext * ds;
    vec3 scat = atmoBetaR * exp(-h / atmoHR) * phR + atmoBetaMs * exp(-h / atmoHM) * phM;
    L += exp(-tauMid) * atmoSunTransmittance(q, sunDir) * scat * ds;
    tau += ext * ds;
  }
  vec3 T = exp(-tau);
  // In the scene's units a white surface lit face-on shows irradiance, so
  // scattered radiance shows as pi * L * irradiance.
  vec3 colour = PI * L * irradiance;
  float alpha = 1.0 - dot(T, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(colour, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function atmosphereUniforms(a: AtmosphereParams, groundKm: number): Record<string, THREE.IUniform> {
  return {
    atmoRg: { value: groundKm },
    atmoRt: { value: groundKm + a.topKm },
    atmoBetaR: { value: new THREE.Vector3(...a.rayleigh) },
    atmoHR: { value: a.rayleighHKm },
    atmoBetaMs: { value: new THREE.Vector3(...a.mieScatter) },
    atmoBetaMe: { value: new THREE.Vector3(...a.mieExtinct) },
    atmoHM: { value: a.mieHKm },
    atmoG: { value: a.mieG },
    atmoBetaO: { value: new THREE.Vector3(...a.ozone) },
    atmoOzC: { value: a.ozoneCentreKm },
    atmoOzW: { value: a.ozoneHalfWidthKm },
    atmoTransLut: { value: transmittanceLut(a, groundKm) },
  };
}

export function makeAtmosphere(a: AtmosphereParams, groundKm: number, unitKm: number): THREE.Mesh {
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
      ...atmosphereUniforms(a, groundKm),
      centre: { value: new THREE.Vector3() },
      unitKm: { value: unitKm },
      sunDir: { value: new THREE.Vector3(1, 0, 0) },
      irradiance: { value: 1 },
      inside: { value: 0 },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry((groundKm + a.topKm) / unitKm, 128, 64), mat);
  mesh.renderOrder = 10;
  return mesh;
}
