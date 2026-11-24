// src/chart/chartMaterial.ts
//
// The chart's raster (docs/frontend/chart.md#drawing): one full-viewport
// quad whose fragment shader turns each pixel into latitude and longitude
// by the inverse projection (projection.ts, the same formulas), then looks
// up the body's colour map and elevation there and composes the layers:
//
// - COLOUR: the day map the 3D view draws (sRGB, so sampled as linear and
//   encoded back);
// - ELEVATION: a hypsometric tint from the ramp (on the Earth, land and sea
//   ramps either side of 0 m);
// - RELIEF: hillshade from the real heights at true scale, times an
//   exaggeration the view states, lit from the screen's upper left as
//   cartographers light relief, whatever the projection turns north to;
// - NIGHT: the side away from the Sun at the clock's time.
//
// Heights are integer textures sampled by texelFetch and interpolated here:
// the 4 px/deg grid, and the 16 px/deg tiles in a texture array where
// loaded (the mask's bit per tile). A height is no data (-32768, Magellan's
// gaps) if any of its four texels is; no-data ground is hatched.

import * as THREE from 'three';

export const LAYER = { colour: 1, relief: 2, elevation: 4, night: 8 } as const;

const vertexShader = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp int;
precision highp isampler2D;
precision highp isampler2DArray;

uniform int uProj;            // 0 simple cylindrical, 1 north polar, 2 south polar
uniform vec4 uView;           // lon0, lat0 (rad), scale (device px per rad), max angle from the pole (rad)
uniform vec2 uPole;           // polar: the pole's offset from the centre, device px, y down
uniform bool uInset;          // an inset: nothing beyond its reach, so the chart under it shows
uniform vec4 uRect;           // the viewport, device px, origin bottom left
uniform int uLayers;
uniform int uStyle;           // 0 a body, 1 the Earth (land and sea)
uniform bool uHasColour;
uniform sampler2D uColour;
uniform bool uHasElev;
uniform isampler2D uBase;
uniform int uBaseW;
uniform isampler2DArray uTiles;
uniform int uTileW;
uniform int uTilesX;
uniform uint uMask;
uniform int uFineW;
uniform sampler2D uRamp;      // 256 x 2: row 0 a body's or the land's, row 1 the sea's (sRGB values)
uniform vec2 uRange;          // metres at the ramp's ends (land: 0 to top)
uniform float uSeaDepth;      // metres at the sea ramp's deep end
uniform float uRadius;        // metres
uniform float uExag;
uniform vec3 uSun;            // body-fixed unit vector to the Sun
uniform vec3 uPaper;          // sRGB

out vec4 outColor;
const float PI = 3.14159265358979;
const int NODATA = -32768;

float texBase(int x, int y) {
  int h = uBaseW / 2;
  x = ((x % uBaseW) + uBaseW) % uBaseW; y = clamp(y, 0, h - 1);
  return float(texelFetch(uBase, ivec2(x, y), 0).r);
}
bool fineOk(int x, int y) {
  int h = uFineW / 2;
  x = ((x % uFineW) + uFineW) % uFineW; y = clamp(y, 0, h - 1);
  int layer = (y / uTileW) * uTilesX + x / uTileW;
  return ((uMask >> uint(layer)) & 1u) == 1u;
}
float texFine(int x, int y) {
  int h = uFineW / 2;
  x = ((x % uFineW) + uFineW) % uFineW; y = clamp(y, 0, h - 1);
  int layer = (y / uTileW) * uTilesX + x / uTileW;
  return float(texelFetch(uTiles, ivec3(x % uTileW, y % uTileW, layer), 0).r);
}
// Bilinear height at grid coordinates g (texels, cell centres at .5) of a
// level; y = no data.
vec2 heightAt(bool fine, vec2 g) {
  vec2 p = g - 0.5;
  ivec2 i = ivec2(floor(p));
  vec2 f = p - vec2(i);
  float a, b, c, d;
  if (fine) { a = texFine(i.x, i.y); b = texFine(i.x + 1, i.y); c = texFine(i.x, i.y + 1); d = texFine(i.x + 1, i.y + 1); }
  else { a = texBase(i.x, i.y); b = texBase(i.x + 1, i.y); c = texBase(i.x, i.y + 1); d = texBase(i.x + 1, i.y + 1); }
  float nd = float(min(min(a, b), min(c, d)) <= float(NODATA));
  return vec2(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), nd);
}
bool fineHere(vec2 g) {
  ivec2 i = ivec2(floor(g - 0.5));
  return fineOk(i.x - 1, i.y - 1) && fineOk(i.x + 2, i.y - 1) && fineOk(i.x - 1, i.y + 2) && fineOk(i.x + 2, i.y + 2);
}
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

void main() {
  vec2 c = gl_FragCoord.xy - uRect.xy - 0.5 * uRect.zw;      // from the centre, y up
  float s = uView.z;
  float lat, lon;
  vec2 N, E;                                                  // north and east on the screen (y up)
  if (uProj == 0) {
    lon = uView.x + c.x / s;
    lat = uView.y + c.y / s;
    N = vec2(0.0, 1.0); E = vec2(1.0, 0.0);
    if (abs(lat) > 0.5 * PI) { outColor = vec4(uPaper, 1.0); return; }
  } else {
    vec2 pole = vec2(uPole.x, -uPole.y);
    vec2 q = (c - pole) / s;                                  // y up
    float rho = length(q), ang = 2.0 * atan(rho * 0.5);
    if (ang > uView.w) { if (uInset) discard; outColor = vec4(uPaper, 1.0); return; }
    if (uProj == 1) { lat = 0.5 * PI - ang; lon = uView.x + atan(q.x, -q.y); N = rho > 0.0 ? -q / rho : vec2(0.0, 1.0); }
    else { lat = ang - 0.5 * PI; lon = uView.x + atan(q.x, q.y); N = rho > 0.0 ? q / rho : vec2(0.0, 1.0); }
    E = vec2(N.y, -N.x);
  }
  float u = fract((lon + PI) / (2.0 * PI));
  float v = (lat + 0.5 * PI) / PI;

  vec3 col = uPaper;
  if ((uLayers & 1) != 0 && uHasColour) {
    // Derivatives from whichever of u and u + 1/2 is continuous here.
    float u2 = fract(u + 0.5);
    vec2 dx = vec2(dFdx(u), dFdx(v)), dy = vec2(dFdy(u), dFdy(v));
    vec2 dx2 = vec2(dFdx(u2), dFdx(v)), dy2 = vec2(dFdy(u2), dFdy(v));
    if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
    col = srgb(textureGrad(uColour, vec2(u, v), dx, dy).rgb);
  }

  bool nodata = false;
  if (uHasElev && (uLayers & 6) != 0) {
    bool fine = uMask != 0u;
    float W = float(fine ? uFineW : uBaseW);
    vec2 g = vec2(u * W, (0.5 * PI - lat) / PI * 0.5 * W);
    if (fine && !fineHere(g)) { fine = false; W = float(uBaseW); g = vec2(u * W, (0.5 * PI - lat) / PI * 0.5 * W); }
    vec2 h0 = heightAt(fine, g);
    nodata = h0.y > 0.5;
    if (!nodata) {
      float h = h0.x;
      if ((uLayers & 4) != 0) {
        vec3 tint;
        if (uStyle == 1 && h < 0.0) tint = texture(uRamp, vec2(sqrt(clamp(-h / uSeaDepth, 0.0, 1.0)), 0.75)).rgb;
        else if (uStyle == 1) tint = texture(uRamp, vec2(sqrt(clamp(h / uRange.y, 0.0, 1.0)), 0.25)).rgb;
        else tint = texture(uRamp, vec2(clamp((h - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0), 0.25)).rgb;
        col = (uLayers & 1) != 0 && uHasColour ? mix(col, tint, 0.55) : tint;
      }
      if ((uLayers & 2) != 0) {
        vec2 e = heightAt(fine, g + vec2(1.0, 0.0)), w = heightAt(fine, g - vec2(1.0, 0.0));
        vec2 n = heightAt(fine, g - vec2(0.0, 1.0)), so = heightAt(fine, g + vec2(0.0, 1.0));
        float he = e.x, hw = w.x, hn = n.x, hs = so.x;
        if (uStyle == 1) { he = max(he, 0.0); hw = max(hw, 0.0); hn = max(hn, 0.0); hs = max(hs, 0.0); }
        float dxm = uRadius * max(cos(lat), 0.02) * 2.0 * PI / W, dym = uRadius * PI / (0.5 * W);
        vec3 nrm = normalize(vec3(-uExag * (he - hw) / (2.0 * dxm), -uExag * (hn - hs) / (2.0 * dym), 1.0));
        if (e.y + w.y + n.y + so.y > 0.5) nrm = vec3(0.0, 0.0, 1.0);
        // Lit from the screen's upper left, 45 degrees up.
        vec2 ls = normalize(vec2(-1.0, 1.0)) * 0.7071;
        vec3 L = vec3(dot(ls, E), dot(ls, N), 0.7071);
        float rel = max(dot(nrm, L), 0.0) / 0.7071;           // 1 on the flat
        col *= mix(1.0, rel, 0.78);
        col = mix(col, vec3(1.0), clamp(rel - 1.0, 0.0, 1.0) * 0.35);
      }
    }
  }
  if (nodata) {
    float k = mod(gl_FragCoord.x + gl_FragCoord.y, 9.0);
    col = mix(uPaper, vec3(0.45, 0.42, 0.36), k < 1.5 ? 0.6 : 0.0);
  }
  if ((uLayers & 8) != 0) {
    vec3 r = vec3(cos(lat) * cos(lon), cos(lat) * sin(lon), sin(lat));
    float day = smoothstep(-0.0145, 0.0145, dot(r, uSun));       // about the Sun's diameter at 1 AU, either side
    col *= mix(0.5, 1.0, day);
  }
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export function makeChartMaterial(): THREE.ShaderMaterial {
  const blankI = new THREE.DataTexture(new Int16Array(4), 2, 2, THREE.RedIntegerFormat, THREE.ShortType);
  blankI.internalFormat = 'R16I';
  blankI.needsUpdate = true;
  const blankA = new THREE.DataArrayTexture(new Int16Array(4), 2, 2, 1);
  blankA.format = THREE.RedIntegerFormat; blankA.type = THREE.ShortType; blankA.internalFormat = 'R16I';
  blankA.needsUpdate = true;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader, fragmentShader,
    depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      uProj: { value: 0 }, uView: { value: new THREE.Vector4() }, uPole: { value: new THREE.Vector2() }, uInset: { value: false }, uRect: { value: new THREE.Vector4() },
      uLayers: { value: 7 }, uStyle: { value: 0 },
      uHasColour: { value: false }, uColour: { value: null },
      uHasElev: { value: false }, uBase: { value: blankI }, uBaseW: { value: 2 },
      uTiles: { value: blankA }, uTileW: { value: 2 }, uTilesX: { value: 1 }, uMask: { value: 0 }, uFineW: { value: 2 },
      uRamp: { value: null }, uRange: { value: new THREE.Vector2(0, 1) }, uSeaDepth: { value: 11000 },
      uRadius: { value: 1 }, uExag: { value: 1 }, uSun: { value: new THREE.Vector3(1, 0, 0) },
      uPaper: { value: new THREE.Vector3(0.914, 0.89, 0.839) },
    },
  });
}
