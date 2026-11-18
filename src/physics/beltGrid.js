// src/physics/beltGrid.js
//
// Bins the faint asteroids into a 3D grid of reflected sunlight, for the
// belt's haze (src/scene/beltHaze.ts draws it; beltHaze.worker.ts runs this
// off the main thread). Given the packed bodies once (12 bytes each,
// packBelt below, written by smallbodies.build.mjs), then a time, it places every body on its orbit by
// Kepler's equation and adds its brightness, 10^(-0.4 H) / r^2 (sunlight
// falling off with its distance from the Sun), to the 8 nearest cell
// centres by trilinear weights. Heliocentric ecliptic, au.

// Cells in x and y over +-halfXY au and in z over +-halfZ au.
export const GRID = { nx: 256, ny: 256, nz: 48, halfXY: 5.6, halfZ: 1.6 };

const TAU = 2 * Math.PI, K = 0.01720209895;

// The faint belt's packing, 12 bytes a body (smallbodies-belt.bin):
//   bytes 0-1   a, uint16 over aLo to aHi au (0.000052 au, 7,800 km, steps)
//   bytes 2-7   node, peri, M, uint16 each over 2 pi (0.0055 deg steps)
//   bytes 8-11  a uint32: i in bits 0-12 over 0 to pi (0.022 deg), e in
//               bits 13-24 over 0 to eHi (0.00018), and H in bits 25-31,
//               hLo + k hStep (15 to 27.7 in 0.1 mag steps; the faintest
//               body in the file is H 27)
// The bits go to H first: with 1.45 million bodies in 3 million cells, a
// cell's light is that of a few bodies, so H's rounding moves the haze more
// than the positions' (docs/frontend/small-bodies.md#building).
// Little-endian. The class byte of the 16-byte pack (smallbodies.bin) is
// left out: every body here is a main-belt asteroid, and the haze does not
// use it.
export const BELT_PACK = { bytes: 12, aLo: 1.3, aHi: 4.7, eHi: 0.75, hLo: 15, hStep: 0.1 };

const IB = 13, EB = 12, HB = 7;
const IMAX = (1 << IB) - 1, EMAX = (1 << EB) - 1, HMAX = (1 << HB) - 1;
const bound = (x, n) => Math.max(0, Math.min(n, Math.round(x)));
const wrapTau = (x) => ((x % TAU) + TAU) % TAU;

// Packs a list of { a, e, i, node, peri, M, H } (au, rad at SB_EPOCH_JD).
// An orbit outside the ranges above throws: widen BELT_PACK rather than
// move a body.
export function packBelt(list) {
  const { bytes, aLo, aHi, eHi, hLo, hStep } = BELT_PACK;
  const out = new Uint8Array(list.length * bytes), dv = new DataView(out.buffer);
  list.forEach((k, j) => {
    if (!(k.a >= aLo && k.a <= aHi && k.e >= 0 && k.e <= eHi && k.i >= 0 && k.i <= Math.PI)) {
      throw new Error(`packBelt: body ${j} (a ${k.a}, e ${k.e}, i ${k.i}) is outside BELT_PACK's ranges`);
    }
    const o = j * bytes;
    dv.setUint16(o, bound((k.a - aLo) / (aHi - aLo) * 65535, 65535), true);
    dv.setUint16(o + 2, bound(wrapTau(k.node) / TAU * 65535, 65535) % 65535, true);
    dv.setUint16(o + 4, bound(wrapTau(k.peri) / TAU * 65535, 65535) % 65535, true);
    dv.setUint16(o + 6, bound(wrapTau(k.M) / TAU * 65535, 65535) % 65535, true);
    const w = bound(k.i / Math.PI * IMAX, IMAX) | (bound(k.e / eHi * EMAX, EMAX) << IB) | (bound((k.H - hLo) / hStep, HMAX) << (IB + EB));
    dv.setUint32(o + 8, w >>> 0, true);
  });
  return out;
}

// The packed bodies as elements (typed arrays: a, e, i, node, peri, M, H).
export function unpackBelt(buffer) {
  const { bytes, aLo, aHi, eHi, hLo, hStep } = BELT_PACK;
  const count = buffer.byteLength / bytes, dv = new DataView(buffer), ang = TAU / 65535;
  const out = { count };
  for (const k of ['a', 'e', 'i', 'node', 'peri', 'M', 'H']) out[k] = new Float64Array(count);
  for (let j = 0; j < count; j++) {
    const o = j * bytes, w = dv.getUint32(o + 8, true);
    out.a[j] = aLo + dv.getUint16(o, true) * (aHi - aLo) / 65535;
    out.node[j] = dv.getUint16(o + 2, true) * ang;
    out.peri[j] = dv.getUint16(o + 4, true) * ang;
    out.M[j] = dv.getUint16(o + 6, true) * ang;
    out.i[j] = (w & IMAX) * Math.PI / IMAX;
    out.e[j] = ((w >>> IB) & EMAX) * eHi / EMAX;
    out.H[j] = hLo + (w >>> (IB + EB)) * hStep;
  }
  return out;
}

// The packed bodies as the arrays build() reads.
export function loadBelt(buffer) {
  const u = unpackBelt(buffer), count = u.count;
  const B = { count };
  for (const k of ['a', 'e', 'M0', 'n', 'b', 'cosI', 'sinI', 'cosN', 'sinN', 'cosW', 'sinW']) B[k] = new Float32Array(count);
  for (let j = 0; j < count; j++) {
    const a = u.a[j];
    B.a[j] = a;
    B.e[j] = u.e[j];
    B.cosI[j] = Math.cos(u.i[j]); B.sinI[j] = Math.sin(u.i[j]); B.cosN[j] = Math.cos(u.node[j]); B.sinN[j] = Math.sin(u.node[j]);
    B.cosW[j] = Math.cos(u.peri[j]); B.sinW[j] = Math.sin(u.peri[j]);
    B.M0[j] = u.M[j];
    B.n[j] = K / (a * Math.sqrt(a));
    B.b[j] = Math.pow(10, -0.4 * u.H[j]);
  }
  return B;
}

// The grid (x fastest, then y, then z) at `days` after SB_EPOCH_JD. With
// stride k, every k-th body only, each counted k times: a quick first look
// (a ninth of the time for k = 8) while the whole grid is built.
export function buildBelt(B, days, G = GRID, stride = 1) {
  const { nx, ny, nz, halfXY, halfZ } = G;
  const grid = new Float32Array(nx * ny * nz);
  const sx = nx / (2 * halfXY), sy = ny / (2 * halfXY), sz = nz / (2 * halfZ);
  for (let j = 0; j < B.count; j += stride) {
    const ej = B.e[j], a = B.a[j];
    let M = (B.M0[j] + B.n[j] * days) % TAU; if (M < 0) M += TAU;
    let E = M + 0.85 * ej * (Math.sin(M) < 0 ? -1 : 1);
    for (let k = 0; k < 12; k++) { const dE = (E - ej * Math.sin(E) - M) / (1 - ej * Math.cos(E)); E -= dE; if (Math.abs(dE) < 1e-7) break; }
    const x = a * (Math.cos(E) - ej), y = a * Math.sqrt(1 - ej * ej) * Math.sin(E);
    const xp = B.cosW[j] * x - B.sinW[j] * y, yp = B.sinW[j] * x + B.cosW[j] * y;
    const X = B.cosN[j] * xp - B.sinN[j] * B.cosI[j] * yp, Y = B.sinN[j] * xp + B.cosN[j] * B.cosI[j] * yp, Z = B.sinI[j] * yp;
    const gx = (X + halfXY) * sx - 0.5, gy = (Y + halfXY) * sy - 0.5, gz = (Z + halfZ) * sz - 0.5;
    const ix = Math.floor(gx), iy = Math.floor(gy), iz = Math.floor(gz);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= nx - 1 || iy >= ny - 1 || iz >= nz - 1) continue;
    const fx = gx - ix, fy = gy - iy, fz = gz - iz;
    const w = (stride * B.b[j]) / (X * X + Y * Y + Z * Z);
    const base = (iz * ny + iy) * nx + ix;
    for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) {
      const wzy = w * (dz ? fz : 1 - fz) * (dy ? fy : 1 - fy), row = base + dz * nx * ny + dy * nx;
      grid[row] += wzy * (1 - fx); grid[row + 1] += wzy * fx;
    }
  }
  return grid;
}
