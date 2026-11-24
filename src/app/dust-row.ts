// src/app/dust-row.ts
//
// The Dust row of Mars's plate: the sol of Montabone et al.'s dust maps the
// scene drew (marsDust.ts marsDustInfo), its optical depth over the globe
// and at its dustiest cell, or, outside the maps' sols, that there was no
// observation for the date. Nothing until the maps' index has loaded.

import type { Row } from './readout';
import type { MarsDustInfo } from '../scene/marsDust';

const SPAN = 'the maps run from 3 March 1999 (MY 24, Ls 105) to 26 December 2022 (the end of MY 36)';
const tau = (x: number) => x.toFixed(x < 1 ? 2 : 1);

export function dustRow(dust: MarsDustInfo): Row {
  if (dust.status === 'fast') {
    return { label: 'Dust', value: 'Not drawn', alt: 'while time runs over 10 sols a second', src: 'LMD', info: 'mars-dust' };
  }
  if (dust.status === 'none') {
    return {
      label: 'Dust', value: 'No observation', alt: 'for this date', src: 'LMD', info: 'mars-dust',
      detail: `MY ${dust.my}, Ls ${dust.ls.toFixed(1)}°: ${SPAN}. The Viking map is drawn clear`,
    };
  }
  return {
    label: 'Dust', value: tau(dust.mean), alt: `optical depth, mean over the globe; up to ${tau(dust.max)}`, src: 'LMD', info: 'mars-dust',
    detail: `MY ${dust.my} sol ${dust.sol}, Ls ${dust.ls.toFixed(1)}°: that sol's kriged map (v${dust.version}), 9.3 µm absorption, 3° × 3°; drawn as a haze of ${(2.6).toFixed(1)} times that in visible light`,
  };
}
