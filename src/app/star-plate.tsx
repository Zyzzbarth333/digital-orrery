// src/app/star-plate.tsx
//
// The data plate for a star chosen in the sky or from FIND
// (docs/frontend/interactive-sky.md): its names and catalogue numbers,
// brightness, colour, spectral type, parallax and the distance it gives,
// position and proper motion, each with its source tag as on the bodies'
// plate. The catalogue (public/sky/) loads on the first pick; until it has,
// the plate says so.

import { useEffect, useState } from 'react';
import { Readout, fmtGroup, type Row } from './readout';
import { usePeek, byLabel } from './peek';
import type { SkyCatalogue, SkyLayer } from '../scene/skyLayer';
import { bayerLabel, bvToKelvin, distanceOf, flamsteedLabel, GREEK, PC_LY, starTitle, type Distance } from '../scene/skyCatalogue';
import { bvToRgb } from '../scene/stars';

// "05h 55m 10.29s", "+07° 24′ 25.4″".
export function fmtRa(deg: number): string {
  let s = (((deg % 360) + 360) % 360) / 15 * 3600;
  s = Math.round(s * 100) / 100;
  const h = Math.floor(s / 3600), m = Math.floor((s - 3600 * h) / 60), sec = s - 3600 * h - 60 * m;
  return `${String(h % 24).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${sec.toFixed(2).padStart(5, '0')}s`;
}
export function fmtDec(deg: number): string {
  const sign = deg < 0 ? '−' : '+';
  let s = Math.round(Math.abs(deg) * 36000) / 10;
  const d = Math.floor(s / 3600); s -= 3600 * d;
  const m = Math.floor(s / 60); s -= 60 * m;
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${s.toFixed(1).padStart(4, '0')}″`;
}

// A distance in light-years, to the figures it is known to.
const ly = (pc: number) => pc * PC_LY;
const fmtLy = (x: number) => (x < 100 ? fmtGroup(x, 1) : fmtGroup(Math.round(x / 10) * 10));
export function distanceRow(d: Distance): Pick<Row, 'value' | 'unit' | 'alt'> {
  switch (d.kind) {
    case 'none': return { value: 'not measured', alt: 'no parallax' };
    case 'value': return { value: `${fmtLy(ly(d.pc))} ± ${fmtLy(ly(d.errPc))}`, unit: 'ly', alt: `${fmtGroup(d.pc, d.pc < 100 ? 1 : 0)} pc` };
    case 'range': return { value: `${fmtLy(ly(d.minPc))} to ${fmtLy(ly(d.maxPc))}`, unit: 'ly', alt: 'parallax too uncertain for one value' };
    case 'beyond': return { value: `more than ${fmtLy(ly(d.minPc))}`, unit: 'ly', alt: 'parallax within its error of zero' };
  }
}

// The swatch: the colour the sky draws the star (stars.ts makeStarPoints),
// as sRGB.
function swatch(bv: number | null): string {
  const c = bvToRgb(bv ?? 0.65).map((x) => 0.65 * x + 0.35);
  const top = Math.max(...c);
  const srgb = c.map((x) => { const v = x / top; return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; });
  return `rgb(${srgb.map((v) => Math.round(255 * Math.min(1, v))).join(', ')})`;
}

// A signed number with a true minus sign, as the Dec row has.
const signed = (x: number, digits: number) => x.toFixed(digits).replace('-', '−');

const VARY = ['', 'varies under 0.06 mag', 'varies 0.06 to 0.6 mag', 'varies over 0.6 mag'];

export function StarPlate({ index, sky }: { index: number; sky: SkyLayer }) {
  const [cat, setCat] = useState<SkyCatalogue | null>(sky.ready);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (cat) return;
    let live = true;
    sky.load().then((c) => { if (live) setCat(c); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [sky, cat]);
  const ph = sky.photometry(index);
  const info = cat?.info;
  const names = cat?.names.get(index);
  const hip = info?.hip[index];
  const title = starTitle(names, hip);
  const cons = cat?.constellations.find((c) => c.abbr === names?.con);
  const rows: Row[] = [];
  if (info && ph) {
    const hd = info.hd[index], plx = info.plx[index], err = info.plxErr[index];
    const bayer = names && bayerLabel(names), flam = names && flamsteedLabel(names);
    const sp = info.spTypes[info.sp[index]];
    rows.push({ label: 'IAU name', value: names?.iau ?? 'none', alt: names?.iau ? undefined : 'most stars have none', src: 'WGSN', info: 'star-name' });
    if (bayer || flam) {
      const g = names?.bayer ? GREEK[names.bayer] : undefined;
      rows.push({
        label: 'Designation', value: [bayer, flam].filter(Boolean).join(' · '),
        alt: g && cons ? `${g.name[0].toUpperCase()}${g.name.slice(1)}${names?.sup ? ` ${names.sup}` : ''} ${cons.gen}` : undefined,
        src: 'BSC5', info: 'star-designation',
      });
    }
    rows.push({ label: 'Catalogues', value: `HIP ${hip}`, alt: [hd ? `HD ${hd}` : '', names?.hr ? `HR ${names.hr}` : ''].filter(Boolean).join(' · ') || undefined, src: 'Hipparcos', info: 'star-designation' });
    rows.push(cons
      ? { label: 'Constellation', value: cons.name, alt: cons.en === cons.name ? undefined : cons.en, src: 'BSC5', info: 'star-constellation' }
      : { label: 'Constellation', value: 'not yet placed', alt: 'no Bayer or Flamsteed name', src: 'none', info: 'star-constellation' });
    rows.push({ label: 'Magnitude', value: ph.v.toFixed(2), unit: 'V', alt: VARY[info.vary[index]] || undefined, src: 'Hipparcos', info: 'star-mag' });
    rows.push(ph.bv === null
      ? { label: 'Colour', value: 'not measured', alt: 'drawn at the Sun\'s colour', src: 'Hipparcos', info: 'star-colour' }
      : { label: 'Colour', value: signed(ph.bv, 2), unit: 'B−V', alt: `≈ ${fmtGroup(Math.round(bvToKelvin(ph.bv) / 100) * 100)} K`, src: 'Hipparcos', derived: true, info: 'star-colour' });
    rows.push({ label: 'Spectral type', value: sp || 'not given', src: 'Hipparcos', info: 'star-spectral' });
    rows.push(Number.isFinite(plx)
      ? { label: 'Parallax', value: `${plx.toFixed(2)} ± ${err.toFixed(2)}`, unit: 'mas', src: 'Hipparcos', info: 'star-parallax' }
      : { label: 'Parallax', value: 'not measured', src: 'Hipparcos', info: 'star-parallax' });
    rows.push({ label: 'Distance', ...distanceRow(distanceOf(plx, err)), src: 'Hipparcos', derived: true, info: 'star-distance' });
    rows.push({ label: 'Right ascension', value: fmtRa(info.ra[index]), alt: 'ICRS, epoch 1991.25', src: 'Hipparcos', info: 'star-position' });
    rows.push({ label: 'Declination', value: fmtDec(info.dec[index]), src: 'Hipparcos', info: 'star-position' });
    const pmA = info.pmRa[index], pmD = info.pmDec[index];
    if (Number.isFinite(pmA) && Number.isFinite(pmD)) {
      rows.push({ label: 'Proper motion', value: fmtGroup(Math.hypot(pmA, pmD), 1), unit: 'mas/yr', alt: `μα* ${signed(pmA, 1)}, μδ ${signed(pmD, 1)}`, src: 'Hipparcos', info: 'star-pm' });
    }
  }
  usePeek(byLabel(rows, 'Magnitude', 'Distance'));
  const kind = info ? (info.spTypes[info.sp[index]] ? `${info.spTypes[info.sp[index]]} star` : 'Star') : 'Star';
  return (
    <div className="tab-body">
      <div className="plate-head">
        <h2><span className="star-swatch" style={{ background: swatch(ph?.bv ?? null) }} aria-hidden="true" />{title}</h2>
        <p className="engraved">{kind}{cons ? ` in ${cons.name}` : ''}</p>
      </div>
      <p className="strip" aria-hidden="true">Readout · source</p>
      {info ? <Readout rows={rows} />
        : <p className="plate-notes">{failed ? 'The star catalogue did not load: the sky data set (public/sky/) is missing. Run npm run data.' : 'Loading the star catalogue…'}</p>}
      <div className="plate-notes">
        <p>Drawn where Hipparcos measured it, at its catalogue brightness and colour. Choose a body in the rail to leave it; click empty sky to close this plate.</p>
      </div>
    </div>
  );
}
