// src/physics/moonTables.js
//
// The moons from JPL's satellite ephemerides (mar099s, jup365, sat441,
// sat415, ura184, nep098, plu060): Chebyshev series fitted by c/moon_cheb.c, one
// file per planet system per year, public/ephemeris/moons/<system>-<year>.bin
// for 2000 to 2049. Each file holds every moon of the system and the planet's
// centre, each about the system barycentre (J2000 equatorial km, against TDB
// seconds past J2000), each within 0.5 km of the SPK, so a moon about its
// planet's centre is within 1 km. moons.js uses them where a year is
// installed and the mean elements elsewhere.
//
// The inner moons (Saturn's ring moons, Uranus's and Neptune's inner moons,
// about 100 kB a year each) are in files of their own,
// <system>-inner-<year>.bin. The repo carries them for 2020 to 2035 only
// (INNER_CORE_YEARS); `npm run build:moon-tables` builds the other years
// from the kernels into public/ephemeris/moons-extra/, which git ignores.
// Where an inner file is missing, those moons quietly use the mean elements.
//
// Files are installed lazily, a system and a year at a time:
//   setMoonChunkLoader(load, { onMiss }): load(path) fetches a file (a path
//     under public/, from moonChunkPath) and returns it parsed, or a
//     promise of it, or null if there is none. With onMiss, any position asked of a
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
export const INNER_CORE_YEARS = [2020, 2035];
const INNER_SYSTEMS = new Set(['saturn', 'uranus', 'neptune']);

// Where a year's file is, under public/: part '' (every moon but the inner
// ones, and the planet) or 'inner'.
export function moonChunkPath(system, year, part) {
  if (!part) return `ephemeris/moons/${system}-${year}.bin`;
  const core = year >= INNER_CORE_YEARS[0] && year <= INNER_CORE_YEARS[1];
  return `ephemeris/${core ? 'moons' : 'moons-extra'}/${system}-inner-${year}.bin`;
}

const chunks = new Map();          // path -> parsed | 'loading' | 'failed' | 'none'
const merged = new Map();          // `${system}-${year}` -> the year's series, both parts
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

function install(path, parsed) {
  chunks.set(path, parsed);
  merged.clear();
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

function requestPath(path) {
  if (chunks.has(path) || !loader) return chunks.get(path);
  chunks.set(path, 'loading');
  try {
    const got = loader(path);
    if (got instanceof Map) install(path, got);
    else if (got && typeof got.then === 'function') {
      got.then((p) => (p instanceof Map ? install(path, p) : chunks.set(path, 'none')), () => chunks.set(path, 'failed'));
    } else chunks.set(path, 'none');
  } catch {
    chunks.set(path, 'failed');
  }
  return chunks.get(path);
}

function request(system, year, inner = true) {
  if (year < MOON_TABLE_YEARS[0] || year > MOON_TABLE_YEARS[1]) return;
  requestPath(moonChunkPath(system, year, ''));
  if (inner && INNER_SYSTEMS.has(system)) requestPath(moonChunkPath(system, year, 'inner'));
}

// A year's series from both its files, once its main file is installed.
function yearSeries(system, year) {
  const key = `${system}-${year}`;
  let m = merged.get(key);
  if (m) return m;
  const a = chunks.get(moonChunkPath(system, year, ''));
  if (!(a instanceof Map)) return null;
  const b = INNER_SYSTEMS.has(system) ? chunks.get(moonChunkPath(system, year, 'inner')) : null;
  m = b instanceof Map ? new Map([...a, ...b]) : a;
  merged.set(key, m);
  return m;
}

// The inner moons go round in under 1.2 days, so their orbit lines need
// only the year (or two) about tt itself, not the years the outer moons'
// span: Uranus's would otherwise be 1.3 MB a year for eight years.
export function wantMoonTables(system, tt, days = 0) {
  const a = yearOf(tt - days * 86400), b = yearOf(tt + days * 86400);
  const ia = yearOf(tt - 2 * 86400), ib = yearOf(tt + 2 * 86400);
  for (let y = Math.max(a, MOON_TABLE_YEARS[0]); y <= Math.min(b, MOON_TABLE_YEARS[1]); y++) request(system, y, y >= ia && y <= ib);
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
  if (onMiss) request(system, y);
  return yearSeries(system, y);
}

// State of NAIF body id about its system barycentre from a chunk, into
// r and v; false if the chunk does not hold it there.
export const chunkState = (chunk, id, tt, r, v) => {
  const s = chunk.get(id);
  return !!s && evaluate(s, tt, r, v);
};
