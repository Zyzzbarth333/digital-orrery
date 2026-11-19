// packages/physics/src/sunField.js
//
// The Sun's large-scale magnetic field (docs/physics/magnetic-fields.md#the-suns-field):
// the potential-field source-surface (PFSS) model of the Wilcox Solar
// Observatory (Hoeksema 1984; Sun 2009, "Notes on PFSS extrapolation"), from WSO's own
// photospheric magnetograms, one set of coefficients per Carrington
// rotation (public/data/sun-pfss.json, from npm run fetch:magnetic).
//
// WSO gives g_lm, h_lm (microtesla) of the radial field on the photosphere,
// Br(R0) = sum P_l^m(cos theta) (g cos m phi + h sin m phi), to degree 9,
// with Schmidt semi-normalised P_l^m (as magnetic.js). The field is
// potential between the photosphere R0 and a source surface Rs = 2.5 R0,
// where it turns radial. With c_l = l + 1 + l (R0/Rs)^(2l+1) and r in R0
// (Sun 2009, "Notes on PFSS extrapolation", WSO, eqs. 16-18):
//
//   Br = sum P (g cos + h sin) r^-(l+2) [l + 1 + l (r/Rs)^(2l+1)] / c_l
//   Bt = -sum dP/dtheta (g cos + h sin) r^-(l+2) [1 - (r/Rs)^(2l+1)] / c_l
//   Bp = sum m P / sin theta (g sin - h cos) r^-(l+2) [1 - (r/Rs)^(2l+1)] / c_l
//
// Beyond Rs the field is radial and falls as 1/r^2. Longitude is
// Carrington longitude, the IAU's prime meridian for the Sun.
//
//   parseWso(text) -> { cr, g: [...], h: [...] }    one WSO file
//   pfssField(gh, N, Rs) -> field(x, y, z, out)    nT, r in solar radii
//   carringtonRotation(ms) -> rotation number (fractional)

export const SOURCE_SURFACE = 2.5;
export const SUN_RADIUS_KM = 695700;

// Flat array index in magnetic.js's order (g10 g11 h11 g20 ...).
const at = (n, m, h) => n * n - 1 + (m === 0 ? 0 : 2 * m - 1 + (h ? 1 : 0));

// A WSO coefficient file: lines "l  g_l0 g_l1 ... g_ll" under a g block,
// then the same for h; the l = 0 term (the monopole a finite map leaves) is
// dropped. Returns the flat array to degree N in magnetic.js's order.
export function parseWso(text, N = 9) {
  const out = new Array(N * N + 2 * N).fill(0);
  let block = null;
  for (const line of text.split(/\r?\n/)) {
    if (/g's/.test(line)) block = 'g';
    if (/h's/.test(line)) block = 'h';
    const f = line.trim().split(/\s+/);
    if (!/^\d+$/.test(f[0] ?? '')) continue;
    const l = Number(f[0]);
    if (l === 0 && /g's|h's/.test(line) === false && block === null) block = 'g';
    if (l === 0 || l > N) continue;
    for (let m = 0; m <= l; m++) {
      const v = Number(f[1 + m]);
      if (!Number.isFinite(v)) continue;
      if (block === 'g') out[at(l, m, false)] = v;
      else if (block === 'h' && m > 0) out[at(l, m, true)] = v;
    }
  }
  return out;
}

export function pfssField(gh, N = 9, Rs = SOURCE_SURFACE) {
  const W = N + 1, P = new Float64Array(W * W), dP = new Float64Array(W * W);
  const k1 = new Float64Array(W * W), k2 = new Float64Array(W * W), kn = new Float64Array(W), cl = new Float64Array(W);
  for (let n = 1; n <= N; n++) {
    kn[n] = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
    cl[n] = n + 1 + n * Math.pow(1 / Rs, 2 * n + 1);
    for (let m = 0; m < n; m++) {
      const d = Math.sqrt(n * n - m * m);
      k1[n * W + m] = (2 * n - 1) / d;
      k2[n * W + m] = n >= 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) / d : 0;
    }
  }
  const cm = new Float64Array(W), sm = new Float64Array(W);
  return function field(x, y, z, out) {
    const rho2 = x * x + y * y, r0 = Math.sqrt(rho2 + z * z), rho = Math.sqrt(rho2);
    const r = Math.min(r0, Rs), beyond = r0 > Rs;       // past Rs: the field at Rs, falling as 1/r^2
    const ct = z / r0, st = Math.max(rho / r0, 1e-12), cp = rho > 0 ? x / rho : 1, sp = rho > 0 ? y / rho : 0;
    cm[0] = 1; sm[0] = 0;
    for (let m = 1; m <= N; m++) { cm[m] = cm[m - 1] * cp - sm[m - 1] * sp; sm[m] = sm[m - 1] * cp + cm[m - 1] * sp; }
    P[0] = 1; dP[0] = 0;
    let Br = 0, Bt = 0, Bp = 0;
    for (let n = 1; n <= N; n++) {
      const pnn = (n - 1) * W + n - 1, inn = n * W + n;
      P[inn] = kn[n] * st * P[pnn];
      dP[inn] = kn[n] * (st * dP[pnn] + ct * P[pnn]);
      for (let m = 0; m < n; m++) {
        const i = n * W + m, i1 = (n - 1) * W + m, two = n - 2 >= m;
        P[i] = k1[i] * ct * P[i1] - (two ? k2[i] * P[(n - 2) * W + m] : 0);
        dP[i] = k1[i] * (ct * dP[i1] - st * P[i1]) - (two ? k2[i] * dP[(n - 2) * W + m] : 0);
      }
      const q = Math.pow(r / Rs, 2 * n + 1), fr = (Math.pow(r, -(n + 2)) * (n + 1 + n * q)) / cl[n], ft = (Math.pow(r, -(n + 2)) * (1 - q)) / cl[n];
      for (let m = 0; m <= n; m++) {
        const g = gh[at(n, m, false)], h = m ? gh[at(n, m, true)] : 0, i = n * W + m;
        const gc = g * cm[m] + h * sm[m];
        Br += fr * P[i] * gc;
        Bt -= ft * dP[i] * gc;
        if (m) Bp += (ft * m * P[i] * (g * sm[m] - h * cm[m])) / st;
      }
    }
    if (beyond) { const s = (Rs / r0) ** 2; Br *= s; Bt = 0; Bp = 0; }
    // microtesla to nT, spherical to Cartesian.
    Br *= 1000; Bt *= 1000; Bp *= 1000;
    out[0] = Br * st * cp + Bt * ct * cp - Bp * sp;
    out[1] = Br * st * sp + Bt * ct * sp + Bp * cp;
    out[2] = Br * ct - Bt * st;
    return out;
  };
}

// Carrington rotations, of 27.2753 days, numbered so that CR 1927 began on
// 8 Sep 1997 (WSO's request form gives that as its example).
const CR1927 = Date.UTC(1997, 8, 8);
export const carringtonRotation = (ms) => 1927 + (ms - CR1927) / (27.2753 * 864e5);

// ---- the heliospheric current sheet and the Parker spiral ----
//
// Past the source surface the field is radial, outward on one side of the
// line where Br = 0 there and inward on the other. Carried out by the
// solar wind, that neutral line becomes the heliospheric current sheet.
// The wind leaves radially at v while the Sun turns under it, so a field
// line from Carrington longitude phi0 lies, in the Sun's turning frame, at
//   phi(r) = phi0 - Omega (r - Rs) / v
// (Parker 1958), Omega the Sun's sidereal rotation in the Carrington
// system, 360 deg in 25.38 days. The sheet is the neutral line swept along
// those spirals.

export const CARRINGTON_SIDEREAL_DAYS = 25.38;
export const OMEGA_SUN = (2 * Math.PI) / (CARRINGTON_SIDEREAL_DAYS * 86400);   // rad/s
export const AU_KM = 149597870.7;

// Br on the source surface (just inside it) on a grid: rows of latitude
// lat0..lat1 step dLat, columns of longitude 0..360 step dLon (deg), filled
// a few rows a call.
export function sourceSurfaceGrid(field, Rs = SOURCE_SURFACE, { dLat = 1, dLon = 2, latMax = 89 } = {}) {
  const lats = [], lons = [];
  for (let l = -latMax; l <= latMax + 1e-9; l += dLat) lats.push(l);
  for (let l = 0; l <= 360 + 1e-9; l += dLon) lons.push(l);
  const br = new Float64Array(lats.length * lons.length), b = [0, 0, 0], r = Rs * (1 - 1e-9), D = Math.PI / 180;
  let row = 0;
  const G = {
    lats, lons, br, done: false,
    step(ms = Infinity) {
      const t0 = performance.now();
      while (row < lats.length && performance.now() - t0 < ms) {
        const cl = Math.cos(lats[row] * D), sl = Math.sin(lats[row] * D);
        for (let j = 0; j < lons.length; j++) {
          const x = cl * Math.cos(lons[j] * D), y = cl * Math.sin(lons[j] * D);
          field(r * x, r * y, r * sl, b);
          br[row * lons.length + j] = b[0] * x + b[1] * y + b[2] * sl;
        }
        row++;
      }
      G.done = row >= lats.length;
      return G.done;
    },
  };
  return G;
}

// The neutral line's segments by marching squares: [[lat, lon], [lat, lon]]
// pairs (deg), each crossing placed by linear interpolation.
export function neutralSegments(G) {
  const { lats, lons, br } = G, W = lons.length, out = [];
  const at = (i, j) => br[i * W + j];
  const cross = (a, b, pa, pb) => { const t = a / (a - b); return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])]; };
  for (let i = 0; i + 1 < lats.length; i++) for (let j = 0; j + 1 < W; j++) {
    const c = [[i, j], [i, j + 1], [i + 1, j + 1], [i + 1, j]], v = c.map(([a, b]) => at(a, b)), p = c.map(([a, b]) => [lats[a], lons[b]]);
    const pts = [];
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; if ((v[k] > 0) !== (v[k2] > 0)) pts.push(cross(v[k], v[k2], p[k], p[k2])); }
    if (pts.length === 2) out.push(pts);
    else if (pts.length === 4) {
      // A saddle: pair by the centre's sign.
      const mid = (v[0] + v[1] + v[2] + v[3]) / 4;
      if ((mid > 0) === (v[0] > 0)) out.push([pts[0], pts[3]], [pts[1], pts[2]]);
      else out.push([pts[0], pts[1]], [pts[2], pts[3]]);
    }
  }
  return out;
}

// The sheet's reach in latitude, as WSO tabulates it: its farthest north
// and south (deg).
export function sheetTilt(segments) {
  let n = -90, s = 90;
  for (const seg of segments) for (const [lat] of seg) { n = Math.max(n, lat); s = Math.min(s, lat); }
  return { north: n, south: s };
}

// A spiral field line's Carrington longitude (rad) at r (solar radii) for
// a wind of v km/s, leaving the source surface at phi0.
export const spiralLongitude = (phi0, r, v = 400, Rs = SOURCE_SURFACE) => phi0 - (OMEGA_SUN * (r - Rs) * SUN_RADIUS_KM) / v;
// The angle between the field and the radial direction in the Sun's
// equator at r: tan psi = Omega r / v.
export const spiralAngle = (rKm, v = 400) => Math.atan((OMEGA_SUN * rKm) / v);
