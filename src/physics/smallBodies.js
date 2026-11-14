// src/physics/smallBodies.js
//
// The asteroids and comets the orrery draws (public/data/smallbodies.bin and
// .json, written by smallbodies.build.mjs from JPL's Small-Body Database):
// their orbit classes, the shared epoch, the named ones, decoding the packed
// file, and a body's position by two-body motion. Pure: no DOM.
//
// Each orbit is a fixed heliocentric ellipse (ecliptic J2000) with its mean
// anomaly at SB_EPOCH_JD, carried by Kepler's equation. That is how the app
// draws them (src/scene/smallBodies.ts does the same in its vertex shader);
// the planets' pull moves the real bodies off these ellipses slowly, most for
// the near-Earth asteroids, so a drawn position is for showing where the
// populations are, not for navigation.

export const SB_EPOCH_JD = 2461041.5;          // 2026-01-01 00:00 TT
const K = 0.01720209895;                        // Gaussian gravitational constant, rad/day
const TAU = 2 * Math.PI;

// SBDB orbit classes, by their index in the packed file.
export const SB_CLASSES = ['MBA', 'IMB', 'OMB', 'MCA', 'IEO', 'ATE', 'APO', 'AMO', 'TJN', 'CEN', 'TNO', 'AST',
  'JFc', 'JFC', 'HTC', 'ETc', 'CTc', 'COM', 'PAR', 'HYP'];

// A comet's K1, the slope of its total magnitude with log10 r (M1 + 5 log10
// Delta + K1 log10 r), packed as the nearest of these.
export const SB_K1 = [5, 7.5, 10, 12.5, 15, 20, 25, 35];

// The populations they are drawn and toggled as.
export const SB_GROUPS = {
  belt: ['MBA', 'IMB', 'OMB', 'MCA', 'AST'],
  neo: ['IEO', 'ATE', 'APO', 'AMO'],
  trojans: ['TJN'],
  outer: ['CEN', 'TNO'],
  comets: ['JFc', 'JFC', 'HTC', 'ETc', 'CTc', 'COM', 'PAR', 'HYP'],
};

// Named, with labels: dwarf planets, the largest asteroids, spacecraft
// targets and famous comets, by SBDB primary designation.
export const NOTABLE = {
  1: { name: 'Ceres', kind: 'dwarf planet' }, 2: { name: 'Pallas', kind: 'asteroid' }, 4: { name: 'Vesta', kind: 'asteroid' },
  10: { name: 'Hygiea', kind: 'asteroid' }, 16: { name: 'Psyche', kind: 'asteroid' }, 21: { name: 'Lutetia', kind: 'asteroid' },
  243: { name: 'Ida', kind: 'asteroid' }, 433: { name: 'Eros', kind: 'near-Earth asteroid' }, 617: { name: 'Patroclus', kind: 'Jupiter trojan' },
  3200: { name: 'Phaethon', kind: 'near-Earth asteroid' }, 3548: { name: 'Eurybates', kind: 'Jupiter trojan' },
  4179: { name: 'Toutatis', kind: 'near-Earth asteroid' }, 25143: { name: 'Itokawa', kind: 'near-Earth asteroid' },
  65803: { name: 'Didymos', kind: 'near-Earth asteroid' }, 99942: { name: 'Apophis', kind: 'near-Earth asteroid' },
  101955: { name: 'Bennu', kind: 'near-Earth asteroid' }, 162173: { name: 'Ryugu', kind: 'near-Earth asteroid' },
  50000: { name: 'Quaoar', kind: 'trans-Neptunian object' }, 90377: { name: 'Sedna', kind: 'trans-Neptunian object' },
  90482: { name: 'Orcus', kind: 'trans-Neptunian object' }, 136108: { name: 'Haumea', kind: 'dwarf planet' },
  136199: { name: 'Eris', kind: 'dwarf planet' }, 136472: { name: 'Makemake', kind: 'dwarf planet' },
  225088: { name: 'Gonggong', kind: 'trans-Neptunian object' }, 486958: { name: 'Arrokoth', kind: 'trans-Neptunian object' },
  2060: { name: 'Chiron', kind: 'centaur' },
  '1P': { name: '1P/Halley', kind: 'comet' }, '2P': { name: '2P/Encke', kind: 'comet' }, '9P': { name: '9P/Tempel 1', kind: 'comet' },
  '21P': { name: '21P/Giacobini-Zinner', kind: 'comet' }, '46P': { name: '46P/Wirtanen', kind: 'comet' },
  '55P': { name: '55P/Tempel-Tuttle', kind: 'comet' }, '67P': { name: '67P/Churyumov-Gerasimenko', kind: 'comet' },
  '81P': { name: '81P/Wild 2', kind: 'comet' }, '103P': { name: '103P/Hartley 2', kind: 'comet' },
  '109P': { name: '109P/Swift-Tuttle', kind: 'comet' },
};

// The packed file (16 bytes a body, see smallbodies.build.mjs) as typed
// arrays: a (au), e, i, node, peri, M (rad, at SB_EPOCH_JD), H (a comet's
// M1), cls (index into SB_CLASSES), k1 (a comet's K1; 0 for an asteroid).
export function decodeSmallBodies(buffer) {
  const dv = new DataView(buffer), n = buffer.byteLength / 16;
  const out = { count: n, a: new Float32Array(n), e: new Float32Array(n), i: new Float32Array(n), node: new Float32Array(n),
    peri: new Float32Array(n), M: new Float32Array(n), H: new Float32Array(n), cls: new Uint8Array(n), k1: new Float32Array(n) };
  const ang = TAU / 65535;
  for (let j = 0; j < n; j++) {
    const o = j * 16;
    out.a[j] = dv.getFloat32(o, true);
    out.e[j] = dv.getUint16(o + 4, true) / 65535;
    out.i[j] = dv.getUint16(o + 6, true) * ang;
    out.node[j] = dv.getUint16(o + 8, true) * ang;
    out.peri[j] = dv.getUint16(o + 10, true) * ang;
    out.M[j] = dv.getUint16(o + 12, true) * ang;
    out.H[j] = dv.getUint8(o + 14) / 7 - 2;
    const c = dv.getUint8(o + 15);
    out.cls[j] = c & 31;
    out.k1[j] = SB_CLASSES[c & 31] && SB_GROUPS.comets.includes(SB_CLASSES[c & 31]) ? SB_K1[c >> 5] : 0;
  }
  return out;
}

// Heliocentric ecliptic J2000 position (au) of an orbit { a, e, i, node,
// peri, M (at SB_EPOCH_JD) } at Julian date jd (TT), by Kepler's equation.
export function positionAu({ a, e, i, node, peri, M }, jd) {
  const n = K / Math.pow(a, 1.5);
  const Mt = ((M + n * (jd - SB_EPOCH_JD)) % TAU + TAU) % TAU;
  let E = e < 0.8 ? Mt : Math.PI;
  for (let k = 0; k < 30; k++) {
    const dE = (E - e * Math.sin(E) - Mt) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  const x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cw = Math.cos(peri), sw = Math.sin(peri), cn = Math.cos(node), sn = Math.sin(node), ci = Math.cos(i), si = Math.sin(i);
  const xp = cw * x - sw * y, yp = sw * x + cw * y;
  return [cn * xp - sn * ci * yp, sn * xp + cn * ci * yp, si * yp];
}

// What JPL's SBDB orbit classes mean (ssd-api.jpl.nasa.gov/doc/sbdb_filter.html),
// in the words the data plate uses.
export const SB_CLASS_NAMES = {
  MBA: 'main-belt asteroid', IMB: 'inner main-belt asteroid', OMB: 'outer main-belt asteroid', MCA: 'Mars-crosser',
  IEO: 'Atira (inside the Earth\'s orbit)', ATE: 'Aten (Earth-crossing)', APO: 'Apollo (Earth-crossing)', AMO: 'Amor (Earth-approaching)',
  TJN: 'Jupiter trojan', CEN: 'centaur', TNO: 'trans-Neptunian object', AST: 'asteroid',
  JFc: 'Jupiter-family comet', JFC: 'Jupiter-family comet', HTC: 'Halley-type comet', ETc: 'Encke-type comet',
  CTc: 'Chiron-type comet', COM: 'comet', PAR: 'comet on a parabolic orbit', HYP: 'comet on a hyperbolic orbit',
};

// The Sun's GM in au^3/day^2 (the Gaussian constant squared), and 1 au/day in km/s.
const MU_AU = K * K;
const AU_PER_DAY_KMS = 149597870.7 / 86400;

// The facts the data plate shows for a named body { a, e, i, ... } at
// Julian date jd (TT): its heliocentric position (au) and distance, its
// speed by vis-viva, perihelion and aphelion, and its period by Kepler's
// third law, with the same Gaussian constant the drawing uses.
//   v = sqrt(GM (2/r - 1/a)),  q = a(1 - e),  Q = a(1 + e),  T = 2 pi sqrt(a^3 / GM)
export function smallBodyFacts(b, jd) {
  const r = positionAu(b, jd);
  const dist = Math.hypot(r[0], r[1], r[2]);
  return {
    r, dist,
    speedKms: Math.sqrt(MU_AU * (2 / dist - 1 / b.a)) * AU_PER_DAY_KMS,
    perihelion: b.a * (1 - b.e),
    aphelion: b.a * (1 + b.e),
    periodDays: TAU * Math.sqrt(b.a ** 3 / MU_AU),
  };
}

// An asteroid's diameter from its absolute magnitude H and geometric albedo
// p, where neither is measured: D = 1329 km / sqrt(p) 10^(-H/5) (JPL CNEOS's
// size estimator; Fowler & Chillemi in The IRAS Minor Planet Survey, 1992).
// A comet's H is its coma's, not its nucleus's, so this does not apply to
// comets.
export const diameterFromH = (H, p) => (1329 / Math.sqrt(p)) * 10 ** (-H / 5);
