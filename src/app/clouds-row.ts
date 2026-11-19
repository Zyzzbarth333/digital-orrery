// src/app/clouds-row.ts
//
// The Clouds row of the Earth's plate: what the scene drew from NASA GIBS
// (clouds.ts dailyEarthInfo): GOES's frame where it reaches, and the day
// (or days) of the polar orbiters' mosaic under it. With neither (no layer
// gave any of the globe) there is no row; with the frame alone, its row
// says no day was drawn under it.

import type { Row } from './readout';
import type { DailyEarthInfo } from '../scene/clouds';

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function cloudsRow(clouds: DailyEarthInfo): Row | null {
  const geo = clouds.geo;
  const sat = clouds.layer.replace(/_CorrectedReflectance_TrueColor$/, '').replace(/_/g, ' ').replace('NOAA', 'NOAA-').replace('SNPP', 'Suomi NPP');
  const frame = geo && `${geo.parts.map((g) => `${g.name} ${pct(g.share)}`).join(', ')} of the globe: GeoColor at that minute, where the Sun was up and within 70° of the satellite.`;
  if (!clouds.days.length) {
    return geo && {
      label: 'Clouds', value: `${geo.time.slice(11, 16)} UTC`, src: 'GIBS', info: 'clouds',
      alt: `${geo.time.slice(0, 10)}, GOES`,
      detail: `${frame} No day of the ${sat} mosaic had data to draw; the rest shows the Blue Marble`,
    };
  }
  const [newest, ...older] = clouds.days;
  const daily = `${sat}, about ${sat.startsWith('MODIS Terra') ? '10:30' : '13:30'} local time at each place`
    + (Number.isFinite(newest.share) && (older.length || geo) ? `: ${clouds.days.map((d) => `${d.day} ${pct(d.share)}`).join(', ')} of the globe` : '');
  return geo
    ? {
      label: 'Clouds', value: `${geo.time.slice(11, 16)} UTC`, src: 'GIBS', info: 'clouds',
      alt: `${geo.time.slice(0, 10)}, GOES; elsewhere ${newest.day.slice(5)}${older.length ? ' and before' : ''}`,
      detail: `${frame} Elsewhere ${daily}. The rest shows the Blue Marble (night, gaps between passes)`,
    }
    : {
      label: 'Clouds', value: newest.day, src: 'GIBS', info: 'clouds',
      alt: older.length ? `newest pass; ${older.map((d) => d.day.slice(5)).join(', ')} under it` : 'that day, not live',
      detail: daily + (older.length ? '; the rest shows the Blue Marble (polar night, gaps between passes)' : ''),
    };
}
