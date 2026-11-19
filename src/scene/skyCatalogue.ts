// src/scene/skyCatalogue.ts
//
// The interactive sky's catalogue (docs/frontend/interactive-sky.md): what
// python/textures/sky.py writes to public/sky/, decoded, and the rules the
// star plate, FIND and the picking share. Pure: no DOM, no three.js, so the
// tests load it as it is (src/scene/sky.test.mjs).
//
// A star is known by its index in stars/hipparcos.bin (the point layer's
// order); every file here is keyed by it.

// stars-info.bin: per star, what the plate shows that the point layer does
// not carry (sky.py's docstring has the layout).
export interface StarInfo {
  n: number;
  hip: Uint32Array;
  hd: Uint32Array;
  plx: Float32Array;        // mas; NaN: none
  plxErr: Float32Array;     // mas
  pmRa: Float32Array;       // mas/yr, mu_alpha cos(dec)
  pmDec: Float32Array;      // mas/yr
  ra: Float32Array;         // deg, ICRS, epoch J1991.25
  dec: Float32Array;        // deg
  sp: Uint16Array;          // index into spTypes; 0: none
  vary: Uint8Array;         // Hipparcos coarse variability flag (H6): 0 none, 1-3
  spTypes: string[];
}

export function decodeInfo(buf: ArrayBuffer): StarInfo {
  const head = new DataView(buf, 0, 16);
  const magic = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
  if (magic !== 'SKY1') throw new Error(`stars-info.bin: not SKY1 (${magic})`);
  const n = head.getUint32(4, true), spBytes = head.getUint32(12, true);
  let o = 16;
  const take = <T>(make: (b: ArrayBuffer, o: number, n: number) => T, size: number): T => { const t = make(buf, o, n); o += n * size; return t; };
  const hip = take((b, o, n) => new Uint32Array(b, o, n), 4);
  const hd = take((b, o, n) => new Uint32Array(b, o, n), 4);
  const plx = take((b, o, n) => new Float32Array(b, o, n), 4);
  const plxErr = take((b, o, n) => new Float32Array(b, o, n), 4);
  const pmRa = take((b, o, n) => new Float32Array(b, o, n), 4);
  const pmDec = take((b, o, n) => new Float32Array(b, o, n), 4);
  const ra = take((b, o, n) => new Float32Array(b, o, n), 4);
  const dec = take((b, o, n) => new Float32Array(b, o, n), 4);
  const sp = take((b, o, n) => new Uint16Array(b, o, n), 2);
  const vary = take((b, o, n) => new Uint8Array(b, o, n), 1);
  o += (4 - ((n * 3) % 4)) % 4;
  const spTypes = new TextDecoder().decode(new Uint8Array(buf, o, spBytes)).split('\n');
  return { n, hip, hd, plx, plxErr, pmRa, pmDec, ra, dec, sp, vary, spTypes };
}

// names.json: [index, IAU name, Bayer (BSC5's code), superscript, Flamsteed, HR, constellation].
export type NameRow = [number, string | null, string | null, number | null, number | null, number | null, string | null];
export interface StarNames { index: number; iau: string | null; bayer: string | null; sup: number | null; flam: number | null; hr: number | null; con: string | null }
export const nameOf = (r: NameRow): StarNames => ({ index: r[0], iau: r[1], bayer: r[2], sup: r[3], flam: r[4], hr: r[5], con: r[6] });

// constellations.json.
export interface Constellation { abbr: string; name: string; gen: string; en: string; label: [number, number]; lines: [number, number][] }

// The Greek letters: BSC5's three-letter code, the letter, its name, and
// the other code SIMBAD and the IAU's list use.
export const GREEK: Record<string, { letter: string; name: string; alt: string }> = {
  alp: { letter: 'α', name: 'alpha', alt: 'alf' }, bet: { letter: 'β', name: 'beta', alt: 'bet' },
  gam: { letter: 'γ', name: 'gamma', alt: 'gam' }, del: { letter: 'δ', name: 'delta', alt: 'del' },
  eps: { letter: 'ε', name: 'epsilon', alt: 'eps' }, zet: { letter: 'ζ', name: 'zeta', alt: 'zet' },
  eta: { letter: 'η', name: 'eta', alt: 'eta' }, the: { letter: 'θ', name: 'theta', alt: 'tet' },
  iot: { letter: 'ι', name: 'iota', alt: 'iot' }, kap: { letter: 'κ', name: 'kappa', alt: 'kap' },
  lam: { letter: 'λ', name: 'lambda', alt: 'lam' }, mu: { letter: 'μ', name: 'mu', alt: 'mu' },
  nu: { letter: 'ν', name: 'nu', alt: 'nu' }, xi: { letter: 'ξ', name: 'xi', alt: 'ksi' },
  omi: { letter: 'ο', name: 'omicron', alt: 'omi' }, pi: { letter: 'π', name: 'pi', alt: 'pi' },
  rho: { letter: 'ρ', name: 'rho', alt: 'rho' }, sig: { letter: 'σ', name: 'sigma', alt: 'sig' },
  tau: { letter: 'τ', name: 'tau', alt: 'tau' }, ups: { letter: 'υ', name: 'upsilon', alt: 'ups' },
  phi: { letter: 'φ', name: 'phi', alt: 'phi' }, chi: { letter: 'χ', name: 'chi', alt: 'chi' },
  psi: { letter: 'ψ', name: 'psi', alt: 'psi' }, ome: { letter: 'ω', name: 'omega', alt: 'ome' },
};
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const superscript = (n: number) => String(n).split('').map((d) => SUP[Number(d)]).join('');

// "α¹ Cen", or null.
export function bayerLabel(s: StarNames): string | null {
  if (!s.bayer || !s.con) return null;
  const g = GREEK[s.bayer];
  return g ? `${g.letter}${s.sup ? superscript(s.sup) : ''} ${s.con}` : null;
}
// "58 Ori", or null.
export const flamsteedLabel = (s: StarNames): string | null => (s.flam && s.con ? `${s.flam} ${s.con}` : null);

// What a star is called first: its IAU name, else its Bayer, Flamsteed, HR
// or HIP designation.
export function starTitle(s: StarNames | undefined, hip: number | undefined): string {
  if (s?.iau) return s.iau;
  return (s && (bayerLabel(s) ?? flamsteedLabel(s) ?? (s.hr ? `HR ${s.hr}` : null))) ?? (hip ? `HIP ${hip}` : 'Star');
}

// Every name FIND matches for a star: the IAU name; the Bayer designation
// written four ways ("α Ori", "alpha Ori", "alf Ori", "Alpha Orionis");
// Flamsteed's ("58 Ori", "58 Orionis"); HR, HD and HIP numbers.
export function searchNames(s: StarNames | undefined, hip: number, hd: number, gen: (abbr: string) => string | undefined): string[] {
  const out: string[] = [];
  if (s?.iau) out.push(s.iau);
  if (s?.bayer && s.con) {
    const g = GREEK[s.bayer], sup = s.sup ? String(s.sup) : '', genitive = gen(s.con);
    if (g) {
      out.push(bayerLabel(s)!, `${g.letter}${sup} ${s.con}`, `${g.name}${sup} ${s.con}`, `${g.alt}${sup} ${s.con}`);
      if (genitive) out.push(`${g.name}${sup} ${genitive}`);
    }
  }
  if (s?.flam && s.con) {
    out.push(flamsteedLabel(s)!);
    const genitive = gen(s.con);
    if (genitive) out.push(`${s.flam} ${genitive}`);
  }
  if (s?.hr) out.push(`HR ${s.hr}`);
  if (hd) out.push(`HD ${hd}`);
  out.push(`HIP ${hip}`);
  return out;
}

// The distance a parallax gives, said only as well as it is known. A
// parallax measured to better than a fifth of itself (plx / err >= 5) gives
// 1/plx; a worse one gives the range its 1-sigma bounds give, or, where the
// lower bound reaches zero, only a least distance. A bare 1/plx of a noisy
// parallax is biased and can be wildly wrong (Lutz and Kelker 1973; Bailer-
// Jones 2015), so it is never shown.
export type Distance =
  | { kind: 'none' }
  | { kind: 'value'; pc: number; errPc: number }
  | { kind: 'range'; minPc: number; maxPc: number }
  | { kind: 'beyond'; minPc: number };
export const PC_LY = 3.26156;
export const PLX_SNR_MIN = 5;
export function distanceOf(plxMas: number, errMas: number): Distance {
  if (!Number.isFinite(plxMas) || !Number.isFinite(errMas) || errMas <= 0) return { kind: 'none' };
  if (plxMas - errMas <= 0) return { kind: 'beyond', minPc: 1000 / (plxMas + errMas) };
  if (plxMas / errMas >= PLX_SNR_MIN) return { kind: 'value', pc: 1000 / plxMas, errPc: (1000 * errMas) / (plxMas * plxMas) };
  return { kind: 'range', minPc: 1000 / (plxMas + errMas), maxPc: 1000 / (plxMas - errMas) };
}

// B-V to an effective temperature (Ballesteros 2012, as stars.ts's bvToRgb).
export const bvToKelvin = (bv: number) => 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));

// The visible star a pointer means: of those within radiusPx, the one with
// the least mag + 2 (d / radiusPx)^2. A star at the pointer wins over one a
// magnitude brighter at the edge of the circle, but one two magnitudes
// brighter anywhere in it wins: the eye goes to the bright one.
export interface Candidate { index: number; mag: number; dPx: number }
export function choose(cands: readonly Candidate[], radiusPx: number): number | null {
  let best: number | null = null, bestCost = Infinity;
  for (const c of cands) {
    if (c.dPx > radiusPx) continue;
    const cost = c.mag + 2 * (c.dPx / radiusPx) ** 2;
    if (cost < bestCost) { bestCost = cost; best = c.index; }
  }
  return best;
}

// Whether the point layer draws a star of magnitude mag at all: its shader
// leaves out a sprite whose peak is under 1/512 of white (stars.ts).
export const drawn = (mag: number, peak0: number, peakScale: number, visibility: number) =>
  peak0 * peakScale * 10 ** (-0.4 * mag) * visibility * 512 >= 1;
