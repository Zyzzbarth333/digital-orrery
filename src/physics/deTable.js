// src/physics/deTable.js
//
// DE442's Earth and Moon in the app: Chebyshev series fitted to JPL's DE442
// by c/de_cheb.c (public/ephemeris/de442-earth-moon-2000-2050.bin, 1.4 MB).
// The Moon relative to the Earth (8-day intervals, worst 0.3 mm) and the
// Earth-Moon barycentre relative to the Sun (16-day intervals, worst
// 3.7 mm), J2000 equatorial km, against TDB seconds past J2000. The Earth is
//   Earth = EMB - k (Moon - Earth),  k = GM_moon / (GM_earth + GM_moon)
// (worst 3.6 mm, acceleration within 1.5e-9 m/s^2), as JPL stores it: the
// barycentre moves smoothly, while a series of the Earth itself has to
// follow its monthly 4,700 km swing. ephemeris.js uses them for 'earth' and
// 'moon' inside the table's span and astronomy-engine elsewhere.
//
// The table is installed once per thread before anything asks for a
// position: deLoad.js in the browser (the main thread and each worker),
// deNode.js under Node.

const SERIES = { 1: 'moonFromEarth', 3: 'embFromSun' };
let table = null;

export function parseDeTable(buffer) {
  const f = new Float64Array(buffer);
  if (f[0] !== 2) throw new Error(`deTable: unknown format ${f[0]}`);
  const nb = f[1];
  const out = { kMoon: f[2] };
  let off = 3 + 5 * nb;
  for (let k = 0; k < nb; k++) {
    const [id, t0, len, n, nc] = f.subarray(3 + 5 * k, 8 + 5 * k);
    const name = SERIES[id];
    if (!name) throw new Error(`deTable: unknown series ${id}`);
    out[name] = { t0, len, n, nc, c: f.subarray(off, off + n * 3 * nc) };
    off += n * 3 * nc;
  }
  if (off !== f.length) throw new Error('deTable: size does not match its header');
  return out;
}

export function installDeTable(parsed) { table = parsed; }
export function deTableInstalled() { return table !== null; }

// The span covered, in TDB seconds past J2000 (the narrower of the two).
export function deSpan() {
  if (!table) return null;
  const s = [table.moonFromEarth, table.embFromSun];
  return [Math.max(...s.map((x) => x.t0)), Math.min(...s.map((x) => x.t0 + x.n * x.len))];
}

const T = new Float64Array(32), U = new Float64Array(32);

// Position (km) and velocity (km/s) of a series at TDB et, or false when et
// is outside it. Writes into r and v.
function evaluate(s, et, r, v) {
  let i = Math.floor((et - s.t0) / s.len);
  if (i < 0 || i > s.n) return false;
  if (i === s.n) { if (et > s.t0 + s.n * s.len) return false; i--; }
  const x = 2 * (et - (s.t0 + i * s.len)) / s.len - 1, nc = s.nc;
  // T_j(x) and dT_j/dx = j U_{j-1}(x).
  T[0] = 1; T[1] = x; U[0] = 1; U[1] = 2 * x;
  for (let j = 2; j < nc; j++) { T[j] = 2 * x * T[j - 1] - T[j - 2]; U[j] = 2 * x * U[j - 1] - U[j - 2]; }
  const base = i * 3 * nc, dxdt = 2 / s.len;
  for (let d = 0; d < 3; d++) {
    const o = base + d * nc;
    let p = 0, q = 0;
    for (let j = 0; j < nc; j++) p += s.c[o + j] * T[j];
    for (let j = 1; j < nc; j++) q += s.c[o + j] * j * U[j - 1];
    r[d] = p; v[d] = q * dxdt;
  }
  return true;
}

// Heliocentric J2000 equatorial state of 'earth' or 'moon' at TDB et, or
// null when no table is installed or et is outside it.
export function deHelioState(key, et) {
  if (!table) return null;
  const b = [0, 0, 0], vb = [0, 0, 0], rm = [0, 0, 0], vm = [0, 0, 0];
  if (!evaluate(table.embFromSun, et, b, vb) || !evaluate(table.moonFromEarth, et, rm, vm)) return null;
  const k = table.kMoon;
  const r = [b[0] - k * rm[0], b[1] - k * rm[1], b[2] - k * rm[2]], v = [vb[0] - k * vm[0], vb[1] - k * vm[1], vb[2] - k * vm[2]];
  if (key === 'earth') return { r, v };
  return { r: [r[0] + rm[0], r[1] + rm[1], r[2] + rm[2]], v: [v[0] + vm[0], v[1] + vm[1], v[2] + vm[2]] };
}
