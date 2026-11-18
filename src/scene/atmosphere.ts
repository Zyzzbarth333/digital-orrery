// src/scene/atmosphere.ts
//
// Physically based atmospheres (docs/frontend/atmospheres.md): scattering
// by molecules (Rayleigh) and aerosols (Mie), with ozone absorption,
// integrated along each view ray through a shell around the planet
// (marched once a frame into a table of rays from the camera, which the
// shell's pixels look up: renderViewTable), the light scattered more than
// once added from a second table (Hillaire's multiple-scattering table,
// made once: msFragment), and the same medium's transmittance applied
// to the sunlight that reaches the surface (sunset reddening at the
// terminator).
//
// All lengths in the shaders are km, relative to the planet's centre;
// coefficients are per km. The planet is an ellipsoid and so is its
// atmosphere: positions and directions go through atmoShape, the body
// frame scaled so the ellipsoid is the sphere of the ground radius (the
// mean radius), and the scattering is worked in that sphere. For Earth the
// scale differs from 1 by 0.3 % at most, so only the shape changes.

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
  groundAlbedo: number;        // the ground's diffuse albedo, for the light it sends back up into the air
  source: string;
}

// Earth: Bruneton's reference model (precomputed_atmospheric_scattering,
// demo.cc): Rayleigh 1.24062e-6 lambda^-4 /m (lambda in um) at 680, 550 and
// 440 nm with an 8 km scale height; Mie extinction 5.328e-3 / 1.2 km
// (Angstrom beta over the scale height) = 4.44e-6 /m with single-scattering
// albedo 0.9, g = 0.8; ozone in a tent from 10 to 40 km peaking at 25 km,
// its peak coefficients from Hillaire (2020), Table 1. Ground albedo 0.3,
// Hillaire's (2020, Section 4).
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
  groundAlbedo: 0.3,
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
uniform mat3 atmoShape;     // render -> body frame scaled to the ground sphere (rows X Rg/a, Y Rg/b, Z Rg/c)
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

// ---- Light scattered more than once ----------------------------------------
//
// Hillaire's (2020, Section 5.5) multiple-scattering table. After its
// second bounce, the light is taken as isotropic, and the light reaching
// the air around a point as the light reaching the point itself. Then the
// light of every order past the first, per unit sunlight, depends only on
// the point's altitude and the Sun's angle from its zenith:
//
//   Psi = L2 / (1 - f),
//
// with L2 the light scattered once toward the point and once more there
// (isotropically), and f the fraction of light that one more bounce
// returns to it, each averaged over the directions round the point (Eqs.
// 5-10). The light the ground reflects counts in L2. Along a view ray,
// each step then adds sigma_s Psi, with the view path's transmittance
// (Eq. 11). The medium does not change, so the table is made once, on the
// GPU, when the shell is first drawn. The paper takes 64 directions of 20
// steps, which a finer integration puts 10-20 % out in places; made once,
// the table can take 256 directions of 40 steps, within about 3 %.

const MS_N = 32;

const msFragment = /* glsl */ `
#include <common>
${ATMO_UNIFORMS}
${ATMO_FUNCS}
uniform float atmoAlbedo;
layout(location = 0) out vec4 outMs;
void main() {
  // Texel centres at the ends: u = (1 + cos of the Sun's zenith angle) / 2,
  // v = altitude / the shell's depth.
  vec2 x = floor(gl_FragCoord.xy) / ${MS_N - 1}.0;
  float muS = 2.0 * x.x - 1.0;
  float r = atmoRg + max(x.y * (atmoRt - atmoRg), 0.01);
  vec3 p = vec3(0.0, 0.0, r);
  vec3 sun = vec3(sqrt(max(1.0 - muS * muS, 0.0)), 0.0, muS);
  vec3 L2 = vec3(0.0), f = vec3(0.0);
  const int SQRT_DIRS = 16, STEPS = 40;
  for (int a = 0; a < SQRT_DIRS; a++) {
    for (int b = 0; b < SQRT_DIRS; b++) {
      // 256 directions of equal solid angle.
      float cosT = 1.0 - 2.0 * (float(a) + 0.5) / float(SQRT_DIRS);
      float phi = 2.0 * PI * (float(b) + 0.5) / float(SQRT_DIRS);
      float sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
      vec3 d = vec3(sinT * cos(phi), sinT * sin(phi), cosT);
      vec2 g = atmoSphere(p, d, atmoRg);
      bool hit = g.x > 0.0;
      float tEnd = hit ? g.x : max(atmoSphere(p, d, atmoRt).y, 0.0);
      float ds = tEnd / float(STEPS);
      vec3 T = vec3(1.0), L = vec3(0.0), F = vec3(0.0);
      for (int k = 0; k < STEPS; k++) {
        vec3 q = p + d * ((float(k) + 0.5) * ds);
        float h = length(q) - atmoRg;
        vec3 sigS = atmoBetaR * exp(-h / atmoHR) + atmoBetaMs * exp(-h / atmoHM);
        vec3 ext = max(atmoExtinction(h), vec3(1e-9));
        vec3 Ts = exp(-ext * ds);
        // The step's integral of T sigma_s, exact for a uniform step,
        // which keeps f under 1 (Hillaire 2020, Sec. 5.5.3).
        vec3 S = T * (sigS - sigS * Ts) / ext;
        L += S * atmoSunTransmittance(q, sun) / (4.0 * PI);
        F += S;
        T *= Ts;
      }
      if (hit) {
        vec3 n = normalize(p + d * tEnd);
        L += T * atmoSunTransmittance(n * (atmoRg + 1e-3), sun) * max(dot(n, sun), 0.0) * atmoAlbedo / PI;
      }
      L2 += L;
      f += F;
    }
  }
  // The integrals over the sphere with the isotropic phase 1 / (4 pi):
  // each direction's solid angle, 4 pi / n, times the phase, is 1 / n.
  float n = float(SQRT_DIRS * SQRT_DIRS);
  outMs = vec4((L2 / n) / (1.0 - f / n), 1.0);
}
`;

// ---- The shell -------------------------------------------------------------
//
// The scattered light along a view ray depends only on where the ray
// starts (the camera) and its direction: from one camera, on the ray's
// angle from the zenith and its azimuth from the Sun's, two numbers. So
// rather than march every pixel's ray, a view table of 128 x 256 rays from
// the camera is marched each frame (renderViewTable), as Hillaire's (2020)
// sky-view table is, and the shell's pixels look their ray up in it: a
// few square roots and two texture reads instead of 32 steps of sunlight
// lookups and exponentials. The table keeps the Rayleigh and Mie light
// apart, without their phase functions, which each pixel applies for its
// own angle from the Sun, so the Mie forward peak stays sharp.
//
// Rows are the ray's angle from the zenith, in two halves: rays that meet
// the ground (the lower half) and rays that miss it, so no lookup mixes the
// two across the planet's edge. Within each half the angle is spaced as in
// Bruneton's (2017) tables, by the distance along the ray to the ground or
// to the top of the atmosphere, which crowds rows towards the horizon. From
// outside the atmosphere the rays that miss the ground are spaced by how
// close they pass to it instead, densest at the ground (the limb's bright
// edge). Columns are the azimuth from the Sun's, 0 to 180 degrees: the
// light is symmetric about the Sun's vertical.

const VIEW_W = 128, VIEW_HALF = 128;

const VIEW_PARAMS = /* glsl */ `
uniform vec3 viewCam;       // the camera, ground sphere's space, km from the centre
uniform vec3 viewUp;        // its zenith (viewCam normalised)
uniform vec3 viewSunH;      // the Sun's direction along the camera's horizon (any, if overhead)
uniform vec3 viewSun;       // unit vector to the Sun, ground sphere's space
const float VW = ${VIEW_W}.0, VH = ${VIEW_HALF}.0;
float viewRho(float r) { return sqrt(max(r * r - atmoRg * atmoRg, 0.0)); }
`;

// The multiple-scattering table's light (per unit sunlight, 1/sr) at
// altitude h, the Sun's zenith angle's cosine muS.
const MS_LOOKUP = /* glsl */ `
uniform sampler2D msLut;
vec3 msLight(float h, float muS) {
  vec2 x = clamp(vec2(0.5 + 0.5 * muS, h / (atmoRt - atmoRg)), 0.0, 1.0);
  return texture(msLut, (0.5 + x * ${MS_N - 1}.0) / ${MS_N}.0).rgb;
}
`;

// The table's (u, v) for a ray from the camera: mu the cosine of its angle
// from the zenith, cosPhi of its azimuth from the Sun's.
const VIEW_ENCODE = /* glsl */ `
vec2 viewUv(float mu, float cosPhi, bool ground) {
  float r = length(viewCam), Rg = atmoRg, Rt = atmoRt;
  float rho = viewRho(r), H = sqrt(Rt * Rt - Rg * Rg);
  float t;
  if (ground) {
    float d = -r * mu - sqrt(max(r * r * (mu * mu - 1.0) + Rg * Rg, 0.0));
    t = (d - (r - Rg)) / max(rho - (r - Rg), 1e-6);
  } else if (r <= Rt) {
    float d = -r * mu + sqrt(max(r * r * (mu * mu - 1.0) + Rt * Rt, 0.0));
    t = (d - (Rt - r)) / max(rho + H - (Rt - r), 1e-6);
  } else {
    float b = r * sqrt(max(1.0 - mu * mu, 0.0));
    t = 1.0 - sqrt(clamp((b - Rg) / (Rt - Rg), 0.0, 1.0));
  }
  float row = 0.5 + clamp(t, 0.0, 1.0) * (VH - 1.0);
  float phi = acos(clamp(cosPhi, -1.0, 1.0));
  return vec2((0.5 + phi / PI * (VW - 1.0)) / VW, (ground ? row : VH + row) / (2.0 * VH));
}
`;

const quadVertex = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// One texel of the view table: the ray it stands for, marched as the shell
// used to march every pixel's (32 midpoint steps).
const tableFragment = /* glsl */ `
#include <common>
${ATMO_UNIFORMS}
${VIEW_PARAMS}
${ATMO_FUNCS}
${MS_LOOKUP}
// rgb: Rayleigh light without its phase, and the multiple-scattering light
// divided by the Rayleigh phase at this texel's ray (the shell multiplies
// it back by its own pixel's, which differs from it by little across a
// texel: the phase is smooth); a: 1 - the view path's transmittance
// (luminance).
layout(location = 0) out vec4 outRayleigh;
layout(location = 1) out vec4 outMie;        // rgb: Mie light without its phase
void main() {
  float i = floor(gl_FragCoord.x), j = floor(gl_FragCoord.y);
  bool groundRow = j < VH;
  float t = (groundRow ? j : j - VH) / (VH - 1.0);
  float r = length(viewCam), Rg = atmoRg, Rt = atmoRt;
  float rho = viewRho(r), H = sqrt(Rt * Rt - Rg * Rg);
  float muH = -rho / r;                      // the horizon
  float mu;
  if (groundRow) {
    float d = (r - Rg) + t * (rho - (r - Rg));
    mu = d <= 0.0 ? -1.0 : (Rg * Rg - r * r - d * d) / (2.0 * r * d);
    mu = min(mu, muH);
  } else {
    if (r <= Rt) {
      float d = (Rt - r) + t * (rho + H - (Rt - r));
      mu = d <= 0.0 ? 1.0 : (Rt * Rt - r * r - d * d) / (2.0 * r * d);
    } else {
      float b = Rg + (Rt - Rg) * (1.0 - t) * (1.0 - t);
      mu = -sqrt(max(1.0 - b * b / (r * r), 0.0));
    }
    // Just above the horizon, so the ray grazes past the ground.
    mu = max(mu, muH + 1e-5);
  }
  mu = clamp(mu, -1.0, 1.0);
  float phi = PI * i / (VW - 1.0);
  vec3 side = cross(viewUp, viewSunH);
  vec3 d = mu * viewUp + sqrt(max(1.0 - mu * mu, 0.0)) * (cos(phi) * viewSunH + sin(phi) * side);
  vec3 p = viewCam;
  vec2 top = atmoSphere(p, d, Rt);
  float t0 = max(top.x, 0.0), t1 = max(top.y, 0.0);
  vec2 ground = atmoSphere(p, d, Rg);
  if (ground.x > 0.0) t1 = min(t1, ground.x);
  if (t1 <= t0) { outRayleigh = vec4(0.0); outMie = vec4(0.0); return; }
  const int N = 32;
  float ds = (t1 - t0) / float(N);
  vec3 tau = vec3(0.0), LR = vec3(0.0), LM = vec3(0.0), LMS = vec3(0.0);
  for (int k = 0; k < N; k++) {
    vec3 q = p + d * (t0 + (float(k) + 0.5) * ds);
    float rq = length(q), h = rq - Rg;
    vec3 ext = atmoExtinction(h);
    vec3 tv = exp(-(tau + 0.5 * ext * ds)) * ds;
    vec3 w = tv * atmoSunTransmittance(q, viewSun);
    float dR = exp(-h / atmoHR), dM = exp(-h / atmoHM);
    LR += w * dR;
    LM += w * dM;
    // Light scattered more than once: sigma_s Psi, with no phase and no
    // shadow (Hillaire 2020, Eq. 11).
    LMS += tv * (atmoBetaR * dR + atmoBetaMs * dM) * msLight(h, dot(q, viewSun) / rq);
    tau += ext * ds;
  }
  float nu = dot(d, viewSun);
  float phR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
  outRayleigh = vec4(atmoBetaR * LR + LMS / phR, 1.0 - dot(exp(-tau), vec3(0.2126, 0.7152, 0.0722)));
  outMie = vec4(atmoBetaMs * LM, 1.0);
}
`;

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

// The shell: each pixel's ray, looked up in the view table. Front faces
// are drawn from outside the atmosphere, back faces from inside
// (renderViewTable sets the side).
const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
${ATMO_UNIFORMS}
${VIEW_PARAMS}
uniform float irradiance;     // sunlight relative to 1 AU
uniform sampler2D viewRayleigh;
uniform sampler2D viewMie;
varying vec3 vWorld;
${ATMO_FUNCS}
${VIEW_ENCODE}

void main() {
  #include <logdepthbuf_fragment>
  vec3 d = normalize(atmoShape * normalize(vWorld));  // the camera at the origin
  vec3 p = viewCam;
  vec2 top = atmoSphere(p, d, atmoRt);
  if (top.y <= 0.0) discard;
  bool ground = atmoSphere(p, d, atmoRg).x > 0.0;
  float mu = dot(viewUp, d);
  vec3 h = d - mu * viewUp;
  float hl = length(h);
  float cosPhi = hl > 1e-6 ? dot(h, viewSunH) / hl : 1.0;
  vec2 uv = viewUv(mu, cosPhi, ground);
  vec4 R = texture2D(viewRayleigh, uv);
  vec3 M = texture2D(viewMie, uv).rgb;

  float nu = dot(d, viewSun);
  float phR = 3.0 / (16.0 * PI) * (1.0 + nu * nu);
  float g = atmoG, g2 = g * g;
  float phM = 3.0 / (8.0 * PI) * (1.0 - g2) * (1.0 + nu * nu) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * nu, 1.5));
  // In the scene's units a white surface lit face-on shows irradiance, so
  // scattered radiance shows as pi * L * irradiance.
  vec3 colour = PI * (R.rgb * phR + M * phM) * irradiance;
  gl_FragColor = vec4(colour, R.a);
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
    atmoShape: { value: new THREE.Matrix3() },
  };
}

interface ViewTable {
  target: THREE.WebGLRenderTarget;
  scene: THREE.Scene;
  camera: THREE.Camera;
  uniforms: Record<string, THREE.IUniform>;   // shared with the shell's material
  ms: { target: THREE.WebGLRenderTarget; scene: THREE.Scene; drawn: boolean };
  // The camera and the Sun (ground sphere's space) the table was last
  // marched from, or null before the first.
  lastCam: THREE.Vector3 | null;
  lastSun: THREE.Vector3;
}

// A full-screen triangle pair drawing one fragment shader into a target.
function quadScene(fragmentShader: string, uniforms: Record<string, THREE.IUniform>): THREE.Scene {
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: quadVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false,
  }));
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return scene;
}

function linearTextures(target: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget {
  for (const t of target.textures) {
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
  }
  return target;
}

export function makeAtmosphere(a: AtmosphereParams, groundKm: number, unitKm: number): THREE.Mesh {
  const target = linearTextures(new THREE.WebGLRenderTarget(VIEW_W, 2 * VIEW_HALF, { count: 2, type: THREE.HalfFloatType, depthBuffer: false }));
  const msTarget = linearTextures(new THREE.WebGLRenderTarget(MS_N, MS_N, { type: THREE.HalfFloatType, depthBuffer: false }));
  const uniforms: Record<string, THREE.IUniform> = {
    ...atmosphereUniforms(a, groundKm),
    viewCam: { value: new THREE.Vector3(0, 0, groundKm + a.topKm + 1) },
    viewUp: { value: new THREE.Vector3(0, 0, 1) },
    viewSunH: { value: new THREE.Vector3(1, 0, 0) },
    viewSun: { value: new THREE.Vector3(1, 0, 0) },
  };
  const scene = quadScene(tableFragment, { ...uniforms, msLut: { value: msTarget.texture } });
  const msScene = quadScene(msFragment, { ...uniforms, atmoAlbedo: { value: a.groundAlbedo } });
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      ...uniforms,
      irradiance: { value: 1 },
      viewRayleigh: { value: target.textures[0] },
      viewMie: { value: target.textures[1] },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry((groundKm + a.topKm) / unitKm, 128, 64), mat);
  mesh.renderOrder = 10;
  mesh.userData.viewTable = {
    target, scene, camera: new THREE.Camera(), uniforms,
    ms: { target: msTarget, scene: msScene, drawn: false },
    lastCam: null, lastSun: new THREE.Vector3(),
  } satisfies ViewTable;
  mesh.userData.sunDir = new THREE.Vector3(1, 0, 0);
  return mesh;
}

const _frustum = new THREE.Frustum();
const _m = new THREE.Matrix4();

// Each frame, before the scene is drawn: the camera and the Sun in the
// shell's ground-sphere space, the side to draw, and the view table marched
// from there. centre is the planet's render position (camera-relative),
// sunDir the unit vector to the Sun from it, unitKm km per render unit.
// The table is skipped while the shell is out of view or under two pixels
// across; it is redrawn when it comes back. It is also skipped while
// neither the camera nor the Sun has moved relative to the planet (the
// clock held, the camera still or only turning): it would come out the
// same. The multiple-scattering table is made before the first.
export function renderViewTable(renderer: THREE.WebGLRenderer, shell: THREE.Mesh, camera: THREE.PerspectiveCamera,
  centre: THREE.Vector3, sunDir: THREE.Vector3, unitKm: number): void {
  const vt = shell.userData.viewTable as ViewTable;
  const u = vt.uniforms;
  const shape = u.atmoShape.value as THREE.Matrix3;
  const cam = (u.viewCam.value as THREE.Vector3).copy(centre).applyMatrix3(shape).multiplyScalar(-unitKm);
  const r = cam.length();
  const up = (u.viewUp.value as THREE.Vector3).copy(cam).divideScalar(r);
  const sun = (u.viewSun.value as THREE.Vector3).copy(sunDir).applyMatrix3(shape).normalize();
  const h = (u.viewSunH.value as THREE.Vector3).copy(sun).addScaledVector(up, -sun.dot(up));
  // The Sun overhead or underfoot: any horizontal direction will do.
  if (h.lengthSq() < 1e-12) h.set(Math.abs(up.x) < 0.9 ? 1 : 0, Math.abs(up.x) < 0.9 ? 0 : 1, 0).addScaledVector(up, -h.dot(up));
  h.normalize();
  const inside = r < (u.atmoRt.value as number);
  const mat = shell.material as THREE.ShaderMaterial;
  mat.side = inside ? THREE.BackSide : THREE.FrontSide;
  // From inside, the shell's far side lies behind the planet: draw it
  // regardless of depth (the shader stops each ray at the ground).
  mat.depthTest = !inside;

  camera.updateMatrixWorld();
  shell.updateMatrixWorld();
  _frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  if (!inside) {
    if (!_frustum.intersectsObject(shell)) return;
    const px = (u.atmoRt.value as number) / r / Math.tan((camera.fov * Math.PI) / 360) * renderer.domElement.height / 2;
    if (px < 1) return;
  }
  // Still: under a millimetre and a nanoradian since the last march.
  if (vt.lastCam && vt.lastCam.distanceToSquared(cam) < 1e-12 && vt.lastSun.distanceToSquared(sun) < 1e-18) return;
  const prev = renderer.getRenderTarget();
  if (!vt.ms.drawn) {
    renderer.setRenderTarget(vt.ms.target);
    renderer.render(vt.ms.scene, vt.camera);
    vt.ms.drawn = true;
  }
  renderer.setRenderTarget(vt.target);
  renderer.render(vt.scene, vt.camera);
  renderer.setRenderTarget(prev);
  (vt.lastCam ??= new THREE.Vector3()).copy(cam);
  vt.lastSun.copy(sun);
}
