// src/scene/bodyMaterial.ts
//
// Sunlight on a body, as a camera would see it (docs/frontend/lighting.md).
//
// - Irradiance falls off as 1/d^2 from the Sun; the scene's exposure, not the
//   light, decides how bright that looks (OrreryScene sets the exposure).
// - No ambient light: a night side gets nothing but its own emission (city
//   lights, drawn at a display brightness, not photometrically).
// - Airless regolith (Mercury, the Moon, Pluto) scatters close to
//   Lommel-Seeliger, mu0 / (mu0 + mu); the other bodies use Lambert, mu0.
// - Shapes: each body is its IAU triaxial ellipsoid, the unit sphere scaled
//   along its body-fixed axes. Normals take the inverse transpose of that
//   scale, so the terminator and the relief follow the flattened surface.
// - Eclipses: for each occluding ellipsoid, the fraction of the Sun's disc
//   still visible from the surface point (overlap of two discs), worked in
//   the occluder's own frame scaled to a unit sphere (ELLIPSOID_SHADOW).
//   OrreryScene picks each frame the (up to four) bodies whose penumbra
//   reaches this one. In the Earth's shadow, sunlight its air bends in
//   (UMBRA_LIGHT, physics/umbra.js) gives the eclipsed Moon its colour.
// - Surface maps (docs/frontend/textures.md) are looked up by body-fixed
//   longitude and latitude, so they turn with the body's real rotation. All
//   maps share one layout: equirectangular, u = 0 at -180 deg east longitude,
//   v = 0 at the south pole. Relief comes from a normal map made from real
//   elevation, in east-north-up components, at true scale.
//
// All positions are in render units relative to the camera (the floating
// origin), so they stay small near the camera where shadows matter.

import * as THREE from 'three';
import { ATMO_FUNCS, ATMO_UNIFORMS, atmosphereUniforms, type AtmosphereParams } from './atmosphere';
import { DEFLECTION_GROUND_RAD, REFRACTIVITY_SCALE_KM } from '../physics/umbra.js';
import { VISIBLE_FRACTION } from './shadowGlsl';

export const MAX_OCCLUDERS = 4;

// visibleFraction(a, b, c), the overlap of the Sun's disc and a body's (shadowGlsl.ts).
export { VISIBLE_FRACTION };
export const UMBRA_N = 24;           // heights in the refracted light's table
// The refracted light in a planet's shadow is about 1/3000 of sunlight at
// the centre of the Earth's at the Moon (umbra.js), which a view exposed
// for sunlit bodies would draw black; it is drawn this many times brighter,
// a display level like the city lights', so its colour shows.
export const UMBRA_GAIN = 200;

// Sunlight refracted into an occluder's shadow (physics/umbra.js): at a
// point L radii behind the planet and rho off the axis, rays from the near
// limb bent by (1 - rho) / L and from the far one by (1 + rho) / L, each
// T(h) H / (rho L delta) of direct sunlight, T from the table by the
// tangent height h whose bend is delta. Worked in the occluder's unit
// sphere frame, as ELLIPSOID_SHADOW is. Needs the umbra uniforms.
export const UMBRA_LIGHT = /* glsl */ `
#define UMBRA_N ${UMBRA_N}
#define UMBRA_D0 ${DEFLECTION_GROUND_RAD.toFixed(7)}
#define UMBRA_HKM ${REFRACTIVITY_SCALE_KM.toFixed(1)}
uniform vec3 umbraT[UMBRA_N];  // transmittance of a grazing ray, 0 to umbraMaxKm
uniform float umbraMaxKm;
uniform float umbraRadiusKm;   // the occluder's mean radius
vec3 umbraLookup(float hKm) {
  float f = clamp(hKm / umbraMaxKm, 0.0, 1.0) * float(UMBRA_N - 1);
  int i = int(floor(f));
  int j = min(i + 1, UMBRA_N - 1);
  return mix(umbraT[i], umbraT[j], f - float(i));
}
vec3 umbraLight(vec3 x, vec3 sunPos, float sunRadius, vec3 centre, mat3 A, float k) {
  vec3 p = A * (x - centre);
  vec3 toSun = A * (sunPos - centre) - p;
  float dSun = length(toSun);
  vec3 s = toSun / dSun;
  float L = -dot(p, s);                     // behind the planet, along the shadow's axis
  if (L <= 0.0) return vec3(0.0);
  float rho = length(p + L * s);
  float H = UMBRA_HKM / umbraRadiusKm;
  float rhoEff = sqrt(rho * rho + L * L * (sunRadius * k / dSun) * (sunRadius * k / dSun));
  vec3 sum = vec3(0.0);
  for (int side = 0; side < 2; side++) {
    float delta = (side == 0 ? 1.0 - rho : 1.0 + rho) / L;
    if (delta <= 0.0 || delta > UMBRA_D0) continue;
    float h = UMBRA_HKM * log(UMBRA_D0 / delta);
    sum += umbraLookup(h) * min(1.0, H / (rhoEff * L * delta));
  }
  return sum;
}
`;

// The shadow of an ellipsoid, as the fraction of the Sun's disc seen past
// it. A maps render coordinates relative to its centre to its body frame
// scaled to a unit sphere (rows X/a, Y/b, Z/c); whether a line from the
// point to the Sun meets the ellipsoid is unchanged by that map, so the
// occluder is exactly a unit sphere there. The Sun's disc is stretched by
// under the flattening (10 % for Saturn) and is taken as a disc of its
// radius times k = (abc)^(-1/3). Needs visibleFraction(a, b, c).
export const ELLIPSOID_SHADOW = /* glsl */ `
float ellipsoidShadow(vec3 x, vec3 sunPos, float sunRadius, vec3 centre, mat3 A, float k) {
  vec3 p = A * (x - centre);
  vec3 toSun = A * (sunPos - centre) - p;
  float dSun = length(toSun);
  vec3 s = toSun / dSun;
  float dOcc = length(p);
  if (dOcc >= dSun || dot(-p, s) <= 0.0) return 1.0;
  vec3 u = -p / dOcc;
  float a = asin(clamp(sunRadius * k / dSun, 0.0, 1.0));
  float b = asin(clamp(1.0 / dOcc, 0.0, 1.0));
  float c = atan(length(cross(u, s)), dot(u, s));
  return visibleFraction(a, b, c);
}
`;

// Uniforms for an ellipsoid shadow caster: the map A above and k.
export function shadowAxes(toBody: THREE.Matrix3, radii: [number, number, number], out: THREE.Matrix3): number {
  const e = toBody.elements;                  // column-major: e[col * 3 + row]
  const o = out.elements;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) o[col * 3 + row] = e[col * 3 + row] / radii[row];
  return Math.cbrt(1 / (radii[0] * radii[1] * radii[2]));
}

const vertex = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  // Normals under a non-uniform scale: the inverse transpose.
  vNormal = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const fragment = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
#define MAX_OCC ${MAX_OCCLUDERS}
uniform vec3 albedo;          // linear RGB reflectance (flat colour, or the map's scale)
uniform float irradiance;     // sunlight relative to 1 AU, (1 AU / d)^2
uniform float lommel;         // 1 = Lommel-Seeliger, 0 = Lambert
uniform vec3 sunPos;          // render units, camera-relative
uniform float sunRadius;      // render units
uniform vec4 occluders[MAX_OCC]; // xyz centre, w = k of ELLIPSOID_SHADOW (0: unused)
uniform mat3 occAxes[MAX_OCC];   // A of ELLIPSOID_SHADOW
uniform int umbraOcc;         // the occluder whose air bends light into its shadow, or -1
uniform float umbraGain;

uniform vec3 bodyCentre;      // render units, camera-relative
uniform mat3 toBody;          // render -> body-fixed (rows: X, Y, Z axes)
uniform sampler2D dayMap;     uniform float useDay;
uniform sampler2D normalMap;  uniform float useNormal;
uniform sampler2D nightMap;   uniform float useNight; uniform float nightLevel;
uniform sampler2D cloudMap;   uniform float useCloud; uniform float cloudScale;
uniform float invExposure;    // 1 / renderer exposure, for display-level emission
uniform sampler2D ringMap;    uniform float useRing;   // rings' optical depth, for their shadow
uniform float ringInner;      uniform float ringOuter; // render units
uniform vec3 ringCentre;      uniform vec3 ringPole;   // the planet's centre and pole, render frame
uniform float useAtmo;        uniform float unitKm;
${ATMO_UNIFORMS}

varying vec3 vWorld;
varying vec3 vNormal;

${VISIBLE_FRACTION}

${ATMO_FUNCS}
${ELLIPSOID_SHADOW}
${UMBRA_LIGHT}

// Sample an equirectangular map without a seam at +-180 deg: take the
// texture-coordinate derivatives from whichever of u or u + 0.5 (wrapped) is
// continuous at this pixel (Tarini 2012).
vec4 sampleMap(sampler2D map, vec2 uv) {
  vec2 uvB = vec2(fract(uv.x + 0.5) - 0.5, uv.y);
  vec2 dxA = dFdx(uv), dyA = dFdy(uv), dxB = dFdx(uvB), dyB = dFdy(uvB);
  bool useB = abs(dxB.x) + abs(dyB.x) < abs(dxA.x) + abs(dyA.x);
  return textureGrad(map, uv, useB ? dxB : dxA, useB ? dyB : dyA);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 nGeo = normalize(vNormal);
  vec3 toSun = sunPos - vWorld;
  float dSun = length(toSun);
  vec3 s = toSun / dSun;
  vec3 v = normalize(-vWorld);

  // Body-fixed position -> planetocentric longitude, latitude -> map
  // coordinates (the maps' convention, on an ellipsoid as on a sphere).
  vec3 p = normalize(toBody * (vWorld - bodyCentre));
  float lon = atan(p.y, p.x);
  float lat = asin(clamp(p.z, -1.0, 1.0));
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);

  vec3 refl = albedo;
  float cloudCover = 0.0;
  if (useDay > 0.5) refl *= sampleMap(dayMap, uv).rgb;
  if (useCloud > 0.5) {
    vec4 c = sampleMap(cloudMap, uv);
    // GIBS marks no data (polar night, swath gaps) as pure black; the
    // darkest real ocean in true colour is about 0.02 linear.
    c.a *= step(0.003, max(c.r, max(c.g, c.b)));
    vec3 cloudRefl = cloudScale * c.rgb;
    cloudCover = c.a * clamp((dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)) - 0.25) * 2.5, 0.0, 1.0);
    refl = mix(refl, cloudRefl, c.a);
  }

  // Shading normal: the map's east-north-up slope about the ellipsoid's own
  // normal (up), rotated into the scene.
  vec3 n = nGeo;
  if (useNormal > 0.5) {
    vec3 enu = sampleMap(normalMap, uv).xyz * 2.0 - 1.0;
    enu.xy *= (1.0 - cloudCover);                    // clouds hide the relief
    vec3 up = toBody * nGeo;
    vec3 east = normalize(vec3(-up.y, up.x, 0.0) + vec3(1e-6, 0.0, 0.0));
    vec3 north = cross(up, east);
    vec3 nb = normalize(enu.x * east + enu.y * north + enu.z * up);
    n = normalize(transpose(toBody) * nb);
  }

  float mu0Geo = dot(nGeo, s);
  float mu0 = max(dot(n, s), 0.0) * smoothstep(-0.02, 0.02, mu0Geo);   // nothing lit past the terminator
  float mu = max(dot(n, v), 0.0);
  float lambert = mu0;
  float lommelSeeliger = mu0 > 0.0 ? 2.0 * mu0 / (mu0 + mu) : 0.0;
  float brdf = mix(lambert, lommelSeeliger, lommel);

  float shade = 1.0;
  vec3 bent = vec3(0.0);        // sunlight refracted into an occluder's shadow
  if (mu0Geo > -0.02) {
    float sU = 1.0;
    for (int i = 0; i < MAX_OCC; i++) {
      vec4 o = occluders[i];
      if (o.w <= 0.0) continue;
      float sh = ellipsoidShadow(vWorld, sunPos, sunRadius, o.xyz, occAxes[i], o.w);
      shade *= sh;
      if (i == umbraOcc) sU = sh;
    }
    if (umbraOcc >= 0 && sU < 1.0)
      bent = umbraGain * (1.0 - sU) * umbraLight(vWorld, sunPos, sunRadius, occluders[umbraOcc].xyz, occAxes[umbraOcc], occluders[umbraOcc].w);
  }

  // The rings' shadow: follow the ray to the Sun to the ring plane (the
  // planet's equator, through its centre: on the planet and on its moons)
  // and dim by the slant transmission exp(-tau / mu0).
  if (useRing > 0.5 && mu0Geo > 0.0) {
    vec3 pole = ringPole;
    vec3 rel = vWorld - ringCentre;
    float denom = dot(s, pole);
    if (abs(denom) > 1e-6) {
      float t = -dot(rel, pole) / denom;
      if (t > 0.0) {
        float r = length(rel + t * s);
        if (r > ringInner && r < ringOuter) {
          float tau = texture2D(ringMap, vec2((r - ringInner) / (ringOuter - ringInner), 0.5)).r;
          shade *= exp(-tau / max(abs(denom), 1e-3));      // slant path through the layer
        }
      }
    }
  }

  // Sunlight that reaches the ground through the atmosphere (reddened and
  // dimmed near the terminator). The view path's extinction and the sky's
  // own light come from the atmosphere shell drawn over the planet.
  vec3 sunT = vec3(1.0);
  if (useAtmo > 0.5 && mu0Geo > -0.1) {
    vec3 pk = normalize(atmoShape * (vWorld - bodyCentre)) * (atmoRg + 0.01);
    sunT = atmoSunTransmittance(pk, normalize(atmoShape * s));
  }

  vec3 colour = refl * irradiance * brdf * (shade + bent) * sunT;
  if (useNight > 0.5) {
    float dark = 1.0 - smoothstep(-0.12, 0.05, mu0Geo * shade);
    colour += sampleMap(nightMap, uv).rgb * nightLevel * dark * (1.0 - cloudCover) * invExposure;
  }
  gl_FragColor = vec4(colour, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface SurfaceMaps {
  day?: THREE.Texture;
  dayMeanLuminance?: number;   // mean linear luminance of the day map
  dayWhiteLuminance?: number;  // or: luminance of its brightest 0.5 %, calibrated to reflectance 0.9
  tint?: boolean;              // a grey map, coloured by the body's catalogue colour
  normal?: THREE.Texture;
  night?: THREE.Texture;
  cloud?: THREE.Texture;
  cloudWhiteLuminance?: number; // luminance of the daily image's brightest 0.5 %, set to reflectance 0.9
}

// Earth's images are calibrated to the visible reflectance of thick cloud
// tops and fresh snow, about 0.9 (docs/frontend/textures.md#earth).
const BRIGHT_REFLECTANCE = 0.9;

const UMBRA_NONE = Array.from({ length: UMBRA_N }, () => new THREE.Vector3());

// The refracted light's table for every material: one shared array, as only
// the Earth's air bends light into a shadow the app draws.
export function setUmbraTable(materials: Iterable<THREE.ShaderMaterial>, t: { table: Float32Array; n: number; maxKm: number }, radiusKm: number): void {
  const v = Array.from({ length: UMBRA_N }, (_, i) => new THREE.Vector3(t.table[3 * i], t.table[3 * i + 1], t.table[3 * i + 2]));
  for (const m of materials) { m.uniforms.umbraT.value = v; m.uniforms.umbraMaxKm.value = t.maxKm; m.uniforms.umbraRadiusKm.value = radiusKm; }
}

const blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
blank.needsUpdate = true;

// The colour gives the hue (or the map gives the pattern); the scale is set
// so the full disc at zero phase reflects the body's geometric albedo p. For
// Lommel-Seeliger (normalised to 1 face-on) a full disc is uniformly 1, so the
// mean surface reflectance is p. A Lambert sphere's full disc averages 2/3 of
// its face-on brightness, so the mean surface reflectance is 1.5 p.
export function makeBodyMaterial(colour: number, geometricAlbedo: number, airless: boolean): THREE.ShaderMaterial {
  const occ: THREE.Vector4[] = [];
  const occAxes: THREE.Matrix3[] = [];
  for (let i = 0; i < MAX_OCCLUDERS; i++) { occ.push(new THREE.Vector4(0, 0, 0, 0)); occAxes.push(new THREE.Matrix3()); }
  const m = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: {
      albedo: { value: new THREE.Color() },
      irradiance: { value: 1 },
      lommel: { value: airless ? 1 : 0 },
      sunPos: { value: new THREE.Vector3() },
      sunRadius: { value: 1 },
      occluders: { value: occ },
      occAxes: { value: occAxes },
      umbraOcc: { value: -1 }, umbraGain: { value: UMBRA_GAIN },
      umbraT: { value: UMBRA_NONE }, umbraMaxKm: { value: 60 }, umbraRadiusKm: { value: 6371 },
      bodyCentre: { value: new THREE.Vector3() },
      toBody: { value: new THREE.Matrix3() },
      dayMap: { value: blank }, useDay: { value: 0 },
      normalMap: { value: blank }, useNormal: { value: 0 },
      nightMap: { value: blank }, useNight: { value: 0 }, nightLevel: { value: 0.5 },
      cloudMap: { value: blank }, useCloud: { value: 0 }, cloudScale: { value: 1 },
      invExposure: { value: 1 },
      ringMap: { value: blank }, useRing: { value: 0 }, ringInner: { value: 0 }, ringOuter: { value: 0 },
      ringCentre: { value: new THREE.Vector3() }, ringPole: { value: new THREE.Vector3(0, 0, 1) },
      useAtmo: { value: 0 }, unitKm: { value: 1000 },
      ...atmosphereUniforms(NO_ATMOSPHERE, 1),
    },
  });
  m.userData.geometricAlbedo = geometricAlbedo;
  m.userData.airless = airless;
  m.userData.colour = colour;
  setFlatColour(m, colour);
  return m;
}

function scaleFor(m: THREE.ShaderMaterial, meanLuminance: number): number {
  const p = m.userData.geometricAlbedo as number;
  return ((m.userData.airless ? 1 : 1.5) * p) / meanLuminance;
}

function setFlatColour(m: THREE.ShaderMaterial, colour: number): void {
  const c = new THREE.Color(colour);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  (m.uniforms.albedo.value as THREE.Color).copy(c).multiplyScalar(scaleFor(m, lum));
}

const NO_ATMOSPHERE: AtmosphereParams = {
  topKm: 1, rayleigh: [0, 0, 0], rayleighHKm: 1, mieScatter: [0, 0, 0], mieExtinct: [0, 0, 0],
  mieHKm: 1, mieG: 0, ozone: [0, 0, 0], ozoneCentreKm: 0, ozoneHalfWidthKm: 1, groundAlbedo: 0, source: '',
};

export function applyAtmosphere(m: THREE.ShaderMaterial, a: AtmosphereParams, groundKm: number): void {
  Object.assign(m.uniforms, atmosphereUniforms(a, groundKm));
  m.uniforms.useAtmo.value = 1;
}

// No daily mosaic: also unbind the old one, whose GL texture is about to be
// deleted (binding a deleted texture is a WebGL error on every draw).
export function clearCloud(m: THREE.ShaderMaterial): void { m.uniforms.useCloud.value = 0; m.uniforms.cloudMap.value = blank; }

// The rings' shadow on a planet or one of its moons; their plane (the
// planet's centre and pole) is set each frame (setRingPlane).
export function applyRingShadow(m: THREE.ShaderMaterial, map: THREE.Texture, inner: number, outer: number): void {
  const u = m.uniforms;
  u.ringMap.value = map; u.useRing.value = 1; u.ringInner.value = inner; u.ringOuter.value = outer;
}

export function applySurfaceMaps(m: THREE.ShaderMaterial, maps: SurfaceMaps): void {
  const u = m.uniforms;
  if (maps.day) {
    u.dayMap.value = maps.day; u.useDay.value = 1;
    const scale = maps.dayWhiteLuminance
      ? BRIGHT_REFLECTANCE / maps.dayWhiteLuminance
      : scaleFor(m, maps.dayMeanLuminance ?? 0.18);
    const albedo = u.albedo.value as THREE.Color;
    if (maps.tint) {
      // The map's grey pattern in the body's mean colour, at unit luminance
      // so the scale still sets the mean reflectance.
      albedo.set(m.userData.colour as number);
      albedo.multiplyScalar(scale / (0.2126 * albedo.r + 0.7152 * albedo.g + 0.0722 * albedo.b));
    } else albedo.setScalar(scale);
  }
  if (maps.normal) { u.normalMap.value = maps.normal; u.useNormal.value = 1; }
  if (maps.night) { u.nightMap.value = maps.night; u.useNight.value = 1; }
  if (maps.cloud) {
    u.cloudMap.value = maps.cloud; u.useCloud.value = 1;
    u.cloudScale.value = BRIGHT_REFLECTANCE / (maps.cloudWhiteLuminance ?? 1);
  }
}

export function setRingPlane(m: THREE.ShaderMaterial, centre: THREE.Vector3, pole: THREE.Vector3): void {
  (m.uniforms.ringCentre.value as THREE.Vector3).copy(centre);
  (m.uniforms.ringPole.value as THREE.Vector3).copy(pole);
}
