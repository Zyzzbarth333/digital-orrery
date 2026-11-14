// src/physics/moonTables.js
//
// The moons from JPL's satellite ephemerides (mar099s, jup365, sat441,
// ura184, nep098, plu060): Chebyshev series fitted by c/moon_cheb.c, one
// file per planet system per year, public/ephemeris/moons/<system>-<year>.bin
// for 2000 to 2049. Each file holds every moon of the system and the planet's
// centre, each about the system barycentre (J2000 equatorial km, against TDB
// seconds past J2000), each within 0.5 km of the SPK, so a moon about its
// planet's centre is within 1 km. moons.js uses them where a year is
// installed and the mean elements elsewhere.
//
// Files are installed lazily, a system and a year at a time:
//   setMoonChunkLoader(load, { onMiss }): load(system, year) fetches a file
//     and calls installMoonChunk (or returns the parsed file, to install it
//     at once, as moonNode.js does). With onMiss, any position asked of a
//     year that is not installed asks for it (Node, and the kernel's worker,
//     which only asks about a system when a craft is near it); without, only
//     wantMoonTables does (the main thread, for the systems in view).
//   wantMoonTables(system, tt, days): the years from tt - days to tt + days.
//   moonTablesVersion(): counts installs, so the scene can redraw lines.
//
// File layout: Float64 [0] format (1), [1] number of series k; per series
// 6 values: NAIF id, t0, interval length (s), intervals, coefficients per
// axis, bytes per coefficient (4 or 8); then per series, per interval, the
// x, y and z coefficients (Float32 or Float64), each series padded to 8 bytes.

export const MOON_TABLE_YEARS = [2000, 2049];

const chunks = new Map();          // `${system}-${year}` -> parsed | 'loading' | 'failed'
let loader = null, onMiss = false, version = 0, enabled = true;

// Off, every moon comes from the fallback (for checking it).
export function setMoonTablesEnabled(on) { enabled = !!on; }

export function parseMoonChunk(buffer) {
  const head = new Float64Array(buffer, 0, 2);
  if (head[0] !== 1) throw new Error(`moonTables: unknown format ${head[0]}`);
  const k = head[1], meta = new Float64Array(buffer, 16, 6 * k);
  const series = new Map();
  let off = 16 + 48 * k;
  for (let j = 0; j < k; j++) {
    const [id, t0, len, n, nc, bytes] = meta.subarray(6 * j, 6 * j + 6);
    const count = n * 3 * nc;
    const c = bytes === 4 ? new Float32Array(buffer, off, count) : new Float64Array(buffer, off, count);
    series.set(id, { t0, len, n, nc, c });
    off += Math.ceil((count * bytes) / 8) * 8;
  }
  if (off !== buffer.byteLength) throw new Error('moonTables: size does not match its header');
  return series;
}

export function installMoonChunk(system, year, parsed) {
  chunks.set(`${system}-${year}`, parsed);
  version++;
}

export function setMoonChunkLoader(load, opts = {}) {
  loader = load;
  onMiss = !!opts.onMiss;
}

export const moonTablesVersion = () => version;

// TDB seconds past J2000 at the start of a year (a uniform calendar, as
// c/moon_cheb.c cuts the files).
const yearStart = (y) => (Date.UTC(y, 0, 1) - Date.UTC(2000, 0, 1, 12)) / 1000;
function yearOf(tt) {
  let y = 2000 + Math.floor(tt / (365.25 * 86400) + 0.5);
  while (tt < yearStart(y)) y--;
  while (tt >= yearStart(y + 1)) y++;
  return y;
}

function request(system, year) {
  const key = `${system}-${year}`;
  if (chunks.has(key) || !loader || year < MOON_TABLE_YEARS[0] || year > MOON_TABLE_YEARS[1]) return chunks.get(key);
  chunks.set(key, 'loading');
  try {
    const got = loader(system, year);
    if (got instanceof Map) installMoonChunk(system, year, got);
    else if (got && typeof got.then === 'function') {
      got.then((p) => { if (p instanceof Map) installMoonChunk(system, year, p); }, () => chunks.set(key, 'failed'));
    }
  } catch {
    chunks.set(key, 'failed');
  }
  return chunks.get(key);
}

export function wantMoonTables(system, tt, days = 0) {
  const a = yearOf(tt - days * 86400), b = yearOf(tt + days * 86400);
  for (let y = Math.max(a, MOON_TABLE_YEARS[0]); y <= Math.min(b, MOON_TABLE_YEARS[1]); y++) request(system, y);
}

const T = new Float64Array(128), U = new Float64Array(128);   // moon_cheb.c NMAX is 120

// Position (km) and velocity (km/s) of a series at et into r, v; false
// when et is outside it.
function evaluate(s, et, r, v) {
  let i = Math.floor((et - s.t0) / s.len);
  if (i < 0 || i > s.n) return false;
  if (i === s.n) { if (et > s.t0 + s.n * s.len) return false; i--; }
  const x = 2 * (et - (s.t0 + i * s.len)) / s.len - 1, nc = s.nc;
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

// The installed year for a system at tt (TDB s past J2000), or null.
export function moonChunkAt(system, tt) {
  if (!enabled || !(tt >= yearStart(MOON_TABLE_YEARS[0]) && tt <= yearStart(MOON_TABLE_YEARS[1] + 1))) return null;
  let y = yearOf(tt);
  if (y > MOON_TABLE_YEARS[1]) y = MOON_TABLE_YEARS[1];            // the span's last instant
  const c = onMiss ? request(system, y) : chunks.get(`${system}-${y}`);
  return c instanceof Map ? c : null;
}

// State of NAIF body id about its system barycentre from a chunk, into
// r and v; false if the chunk does not hold it there.
export const chunkState = (chunk, id, tt, r, v) => {
  const s = chunk.get(id);
  return !!s && evaluate(s, tt, r, v);
};
