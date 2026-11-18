// src/physics/sunField.js
//
// The Sun's large-scale magnetic field (docs/physics/magnetic-fields.md#the-suns-field):
// the potential-field source-surface (PFSS) model of the Wilcox Solar
// Observatory (Hoeksema 1984; Zhao and Hoeksema 1993), from WSO's own
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
