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
//
// The largest asteroids have exact positions instead: positionAu takes a
// numbered body that JPL's SB441 files cover from sbTable.js (within 1 km of
// SB441 from 2000 to 2050), and the ellipse only for the rest.

import { sbHelioState } from './sbTable.js';
import { tdbFromTt } from './timescale.js';

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

// The obliquity of the J2000 ecliptic (IAU 1976, 84381.448"), as
// astronomy-engine's and SPICE's ECLIPJ2000 use it.
const EPS = 84381.448 / 3600 * Math.PI / 180, CE = Math.cos(EPS), SE = Math.sin(EPS);
const AU_KM = 149597870.7;

// The NAIF id of a numbered asteroid by its SBDB designation (2000000 plus
// its number, as SB441 numbers them), or 0 for anything else.
export const naifIdOf = (pdes) => (/^\d+$/.test(String(pdes)) && Number(pdes) < 1000000 ? 2000000 + Number(pdes) : 0);

// Heliocentric ecliptic J2000 position (au) of an orbit { a, e, i, node,
// peri, M (at SB_EPOCH_JD), pdes? } at Julian date jd (TT): from SB441's
// table when the orbit names a body it covers (outside its span, two-body
// from its nearer end), else by Kepler's equation.
export function positionAu(orbit, jd) {
  const id = orbit.pdes !== undefined ? naifIdOf(orbit.pdes) : 0;
  const s = id ? sbHelioState(id, tdbFromTt((jd - 2451545.0) * 86400)) : null;
  if (s) {
    const [x, y, z] = s.r;
    return [x / AU_KM, (CE * y + SE * z) / AU_KM, (-SE * y + CE * z) / AU_KM];
  }
  return keplerAu(orbit, jd);
}

// The osculating ellipse { a, e, i, node, peri, M (at SB_EPOCH_JD) } of a
// body SB441's table covers, at Julian date jd (TT): heliocentric ecliptic
// J2000 with the Gaussian constant, as the drawn points carry it, so a point
// whose elements are refreshed from it every few days stays on the body's
// exact track. null for a body the table does not cover.
export function exactOrbit(pdes, jd) {
  const id = naifIdOf(pdes);
  const s = id ? sbHelioState(id, tdbFromTt((jd - 2451545.0) * 86400)) : null;
  if (!s) return null;
  const ecl = ([x, y, z], k) => [x * k, (CE * y + SE * z) * k, (-SE * y + CE * z) * k];
  return elementsOf(ecl(s.r, 1 / AU_KM), ecl(s.v, 86400 / AU_KM), jd);
}

// Elliptic elements of heliocentric r (au), v (au/day) at jd, M carried back
// to SB_EPOCH_JD.
export function elementsOf(r, v, jd) {
  const mu = K * K;
  const rn = Math.hypot(...r), v2 = v[0] ** 2 + v[1] ** 2 + v[2] ** 2, rv = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]], hn = Math.hypot(...h);
  const a = 1 / (2 / rn - v2 / mu);
  const ev = [0, 1, 2].map((d) => ((v2 - mu / rn) * r[d] - rv * v[d]) / mu), e = Math.hypot(...ev);
  const i = Math.acos(h[2] / hn), node = Math.atan2(h[0], -h[1]);
  // The argument of perihelion, from the ascending node in the orbit's
  // plane (the node's direction and the one 90 degrees on).
  const nx = Math.cos(node), ny = Math.sin(node);
  const qx = -Math.cos(i) * ny, qy = Math.cos(i) * nx, qz = Math.sin(i);
  const peri = Math.atan2(ev[0] * qx + ev[1] * qy + ev[2] * qz, ev[0] * nx + ev[1] * ny);
  const E = Math.atan2(rv / Math.sqrt(mu * a), 1 - rn / a), Mjd = E - e * Math.sin(E);
  const M = Mjd - K / Math.pow(a, 1.5) * (jd - SB_EPOCH_JD);
  const wrap = (x) => ((x % TAU) + TAU) % TAU;
  return { a, e, i, node: wrap(node), peri: wrap(peri), M: wrap(M) };
}

// The two-body ellipse alone, for every body (the drawn points do this).
export function keplerAu({ a, e, i, node, peri, M }, jd) {
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

// The facts the data plate shows for a named body { pdes, a, e, i, ... } at
// Julian date jd (TT): its heliocentric position (au) and distance, its
// speed by vis-viva, perihelion and aphelion, and its period by Kepler's
// third law, with the same Gaussian constant the drawing uses. For a body
// SB441's table covers (exact: true) the position is the table's and the
// elements (a, e, i) are its osculating ellipse at jd; for the rest, the
// fixed 2026 ellipse.
//   v = sqrt(GM (2/r - 1/a)),  q = a(1 - e),  Q = a(1 + e),  T = 2 pi sqrt(a^3 / GM)
export function smallBodyFacts(b, jd) {
  const r = positionAu(b, jd);
  const dist = Math.hypot(r[0], r[1], r[2]);
  const ex = b.pdes !== undefined ? exactOrbit(b.pdes, jd) : null, el = ex ?? b;
  return {
    r, dist, exact: ex !== null, a: el.a, e: el.e, i: el.i,
    speedKms: Math.sqrt(MU_AU * (2 / dist - 1 / el.a)) * AU_PER_DAY_KMS,
    perihelion: el.a * (1 - el.e),
    aphelion: el.a * (1 + el.e),
    periodDays: TAU * Math.sqrt(el.a ** 3 / MU_AU),
  };
}

// An asteroid's diameter from its absolute magnitude H and geometric albedo
// p, where neither is measured: D = 1329 km / sqrt(p) 10^(-H/5) (JPL CNEOS's
// size estimator; Fowler & Chillemi in The IRAS Minor Planet Survey, 1992).
// A comet's H is its coma's, not its nucleus's, so this does not apply to
// comets.
export const diameterFromH = (H, p) => (1329 / Math.sqrt(p)) * 10 ** (-H / 5);

// ---------------------------------------------------------------------------
// The designation index (public/data/smallbodies-index.txt, written by
// smallbodies.build.mjs): one line per body of smallbodies.bin, in the same
// order, so line j names point j. Fetched only when a search is opened.
//   <designation>[TAB<name>[TAB<diameter km>]]
// A numbered asteroid one more than the previous numbered line leaves its
// designation empty, and one up to 999 more is written +k (most of the
// main belt runs in order, with gaps); empty fields at the end are dropped,
// so the file is mostly short lines.

const isNumber = (s) => /^[1-9]\d*$/.test(s);

/** rows: [{ des, name, diameter }] in packed order -> the index's text. */
export function encodeIndex(rows) {
  let last = 0;
  return rows.map(({ des, name, diameter }) => {
    let field = des;
    if (isNumber(des)) {
      const k = Number(des) - last;
      if (k === 1) field = ''; else if (k > 1 && k < 1000) field = `+${k}`;
      last = Number(des);
    }
    const d = diameter > 0 ? String(Number(diameter.toPrecision(4))) : '';
    return d ? `${field}\t${name ?? ''}\t${d}` : name ? `${field}\t${name}` : field;
  }).join('\n');
}

/** The index's text -> { count, des, name, diameter (NaN unknown), and lower-case copies for search }. */
export function parseIndex(text) {
  const lines = text.split('\n'), n = lines.length;
  const des = new Array(n), name = new Array(n), diameter = new Float32Array(n);
  let last = 0;
  for (let j = 0; j < n; j++) {
    const [f, nm = '', d = ''] = lines[j].split('\t');
    let s = f;
    if (s === '') s = String(last + 1);
    else if (s[0] === '+') s = String(last + Number(s.slice(1)));
    if (isNumber(s)) last = Number(s);
    des[j] = s; name[j] = nm; diameter[j] = d ? Number(d) : NaN;
  }
  return { count: n, des, name, diameter, desLower: des.map((s) => s.toLowerCase()), nameLower: name.map((s) => s.toLowerCase()) };
}

/**
 * Bodies matching a query, best first: by number ("433", "(433)"), by
 * designation ("2010 AB12", "1P"), or by name ("eros"), whole or the start
 * of it, then anywhere in a name. "433 Eros" is read as its number.
 * @returns {number[]} indices into the index (and smallbodies.bin)
 */
export function searchIndex(index, query, limit = 8) {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ').replace(/^\((\d+)\)/, '$1');
  if (!q) return [];
  // A number, alone or before a name ("433 eros"); not the year of a
  // provisional designation ("1997 au24", "2026 p4").
  const num = /^\d{4} [a-z]{1,2}\d*$/.test(q) ? undefined : /^(\d+)(?: .*)?$/.exec(q)?.[1];
  const scored = [];
  const { desLower, nameLower, count } = index;
  for (let j = 0; j < count; j++) {
    const d = desLower[j], nm = nameLower[j];
    let s = -1;
    if (num !== undefined && d === num) s = 0;
    else if (d === q || d.slice(d.indexOf('/') + 1) === q) s = 0;    // "2026 p4" finds C/2026 P4
    else if (nm && nm === q) s = 1;
    else if (nm && nm.startsWith(q)) s = 2;
    else if (d.startsWith(q) && !/^\d+$/.test(q)) s = 3;
    else if (nm && q.length >= 3 && nm.includes(q)) s = 4;
    if (s >= 0) scored.push(s * 1e7 + j);
  }
  scored.sort((x, y) => x - y);
  return scored.slice(0, limit).map((v) => v % 1e7);
}

// What a body is, by its SBDB class, in the words the named list uses.
export function kindOfClass(cls) {
  if (SB_GROUPS.comets.includes(cls)) return 'comet';
  if (SB_GROUPS.neo.includes(cls)) return 'near-Earth asteroid';
  if (cls === 'TJN') return 'Jupiter trojan';
  if (cls === 'CEN') return 'centaur';
  if (cls === 'TNO') return 'trans-Neptunian object';
  return 'asteroid';
}

/** One body of the packed file (as decodeSmallBodies, for index j). */
export function decodeOne(buffer, j) {
  const dv = new DataView(buffer), o = j * 16, ang = TAU / 65535;
  const c = dv.getUint8(o + 15);
  return {
    a: dv.getFloat32(o, true), e: dv.getUint16(o + 4, true) / 65535,
    i: dv.getUint16(o + 6, true) * ang, node: dv.getUint16(o + 8, true) * ang, peri: dv.getUint16(o + 10, true) * ang,
    M: dv.getUint16(o + 12, true) * ang, H: dv.getUint8(o + 14) / 7 - 2, cls: SB_CLASSES[c & 31],
  };
}
