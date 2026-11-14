// src/physics/deTable.js
//
// DE442 in the app: Chebyshev series fitted to JPL's DE442 by c/de_cheb.c
// (public/ephemeris/de442-2000-2050.bin, 2.5 MB), J2000 equatorial km,
// against TDB seconds past J2000. Each series is a target relative to a
// centre (NAIF codes):
//   - the Moon relative to the Earth (8-day intervals, worst 0.3 mm) and the
//     Earth-Moon barycentre relative to the Sun (16 days, 3.7 mm). The Earth
//     is
//       Earth = EMB - k (Moon - Earth),  k = GM_moon / (GM_earth + GM_moon)
//     (worst 3.7 mm, acceleration within 1.5e-9 m/s^2), as JPL stores it:
//     the barycentre moves smoothly, while a series of the Earth itself has
//     to follow its monthly 4,700 km swing;
//   - Mercury, Venus and the Mars system barycentre relative to the Sun;
//   - the Sun and the Jupiter to Pluto system barycentres relative to the
//     solar system barycentre (SSB), where an outer planet moves on a smooth
//     arc a few coefficients per year cover; heliocentric, it would carry the
//     Sun's 450 km annual wobble. Here they are planet - Sun.
// Every body relative to the Sun is within 0.86 m of SPICE (de_cheb's own
// check, docs/physics/ephemerides-and-gm.md). Each series runs past
// 2000-2050 by a margin over which ephemeris.js blends it into
// astronomy-engine, which it uses beyond.
//
// The table is installed once per thread before anything asks for a
// position: deLoad.js in the browser (the main thread and each worker),
// deNode.js under Node.

const MOON = 301, EARTH = 399, SUN = 10, SSB = 0;
// The app's keys for the series' targets: a planet with moons is its
// system's barycentre, as astronomy-engine gives it.
export const DE_KEYS = { mercury: 1, venus: 2, mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8, pluto: 9 };
let table = null;

export function parseDeTable(buffer) {
  const f = new Float64Array(buffer);
  if (f[0] !== 3) throw new Error(`deTable: unknown format ${f[0]}`);
  const nb = f[1];
  const out = { kMoon: f[2], series: new Map() };
  let off = 3 + 6 * nb;
  for (let k = 0; k < nb; k++) {
    const [id, centre, t0, len, n, nc] = f.subarray(3 + 6 * k, 9 + 6 * k);
    if (nc > 32) throw new Error(`deTable: series ${id} has ${nc} coefficients`);
    out.series.set(id, { centre, t0, len, n, nc, c: f.subarray(off, off + n * 3 * nc) });
    off += n * 3 * nc;
  }
  if (off !== f.length) throw new Error('deTable: size does not match its header');
  const need = [MOON, 3, SUN, ...Object.values(DE_KEYS)];
  for (const id of need) if (!out.series.has(id)) throw new Error(`deTable: no series for ${id}`);
  if (out.series.get(MOON).centre !== EARTH || out.series.get(SUN).centre !== SSB) throw new Error('deTable: unexpected centres');
  return out;
}

export function installDeTable(parsed) { table = parsed; }
export function deTableInstalled() { return table !== null; }

// The span a body's state covers, TDB seconds past J2000: its series, and
// for one about the SSB the Sun's too. 'ssb' is the Sun's series. null when
// no table is installed or the key is not in it.
export function deKeySpan(key) {
  if (!table) return null;
  const span = (...ids) => {
    const s = ids.map((id) => table.series.get(id));
    return [Math.max(...s.map((x) => x.t0)), Math.min(...s.map((x) => x.t0 + x.n * x.len))];
  };
  if (key === 'earth' || key === 'moon') return span(3, MOON);
  if (key === 'ssb') return span(SUN);
  const id = DE_KEYS[key];
  if (id === undefined) return null;
  return table.series.get(id).centre === SSB ? span(id, SUN) : span(id);
}

// The span covered, in TDB seconds past J2000 (the narrowest of the series).
export function deSpan() {
  if (!table) return null;
  const s = [...table.series.values()];
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

// The Sun relative to the SSB at TDB et: { r, v }, or null outside the table.
export function deSunFromSsb(et) {
  if (!table) return null;
  const r = [0, 0, 0], v = [0, 0, 0];
  return evaluate(table.series.get(SUN), et, r, v) ? { r, v } : null;
}

// Heliocentric J2000 equatorial state of 'earth', 'moon' or a key of DE_KEYS
// at TDB et, or null when no table is installed or et is outside it.
export function deHelioState(key, et) {
  if (!table) return null;
  if (key === 'earth' || key === 'moon') {
    const b = [0, 0, 0], vb = [0, 0, 0], rm = [0, 0, 0], vm = [0, 0, 0];
    if (!evaluate(table.series.get(3), et, b, vb) || !evaluate(table.series.get(MOON), et, rm, vm)) return null;
    const k = table.kMoon;
    const r = [b[0] - k * rm[0], b[1] - k * rm[1], b[2] - k * rm[2]], v = [vb[0] - k * vm[0], vb[1] - k * vm[1], vb[2] - k * vm[2]];
    if (key === 'earth') return { r, v };
    return { r: [r[0] + rm[0], r[1] + rm[1], r[2] + rm[2]], v: [v[0] + vm[0], v[1] + vm[1], v[2] + vm[2]] };
  }
  const id = DE_KEYS[key];
  if (id === undefined) return null;
  const s = table.series.get(id), r = [0, 0, 0], v = [0, 0, 0];
  if (!evaluate(s, et, r, v)) return null;
  if (s.centre === SUN) return { r, v };
  const rs = [0, 0, 0], vs = [0, 0, 0];
  if (!evaluate(table.series.get(SUN), et, rs, vs)) return null;
  return { r: [r[0] - rs[0], r[1] - rs[1], r[2] - rs[2]], v: [v[0] - vs[0], v[1] - vs[1], v[2] - vs[2]] };
}
