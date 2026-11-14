// src/physics/beltGrid.js
//
// Bins the faint asteroids into a 3D grid of reflected sunlight, for the
// belt's haze (src/scene/beltHaze.ts draws it; beltHaze.worker.ts runs this
// off the main thread). Given the packed bodies once (16 bytes each,
// smallbodies.build.mjs), then a time, it places every body on its orbit by
// Kepler's equation and adds its brightness, 10^(-0.4 H) / r^2 (sunlight
// falling off with its distance from the Sun), to the 8 nearest cell
// centres by trilinear weights. Heliocentric ecliptic, au.

// Cells in x and y over +-halfXY au and in z over +-halfZ au.
export const GRID = { nx: 256, ny: 256, nz: 48, halfXY: 5.6, halfZ: 1.6 };

const TAU = 2 * Math.PI, K = 0.01720209895;

// The packed bodies as the arrays build() reads.
export function loadBelt(buffer) {
  const count = buffer.byteLength / 16;
  const dv = new DataView(buffer), ang = TAU / 65535;
  const B = { count };
  for (const k of ['a', 'e', 'M0', 'n', 'b', 'cosI', 'sinI', 'cosN', 'sinN', 'cosW', 'sinW']) B[k] = new Float32Array(count);
  for (let j = 0; j < count; j++) {
    const o = j * 16, a = dv.getFloat32(o, true);
    const i = dv.getUint16(o + 6, true) * ang, node = dv.getUint16(o + 8, true) * ang, peri = dv.getUint16(o + 10, true) * ang;
    B.a[j] = a;
    B.e[j] = dv.getUint16(o + 4, true) / 65535;
    B.cosI[j] = Math.cos(i); B.sinI[j] = Math.sin(i); B.cosN[j] = Math.cos(node); B.sinN[j] = Math.sin(node);
    B.cosW[j] = Math.cos(peri); B.sinW[j] = Math.sin(peri);
    B.M0[j] = dv.getUint16(o + 12, true) * ang;
    B.n[j] = K / (a * Math.sqrt(a));
    B.b[j] = Math.pow(10, -0.4 * (dv.getUint8(o + 14) / 7 - 2));
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
