// src/chart/sheets.ts
//
// The standard sheet grids a body's charts are printed on
// (docs/frontend/chart.md#sheet-grids): Mars's 30 MC quadrangles, Mercury's
// 15 H, Venus's 62 V and the Moon's 144 Lunar Astronautical Charts. The
// layout is sheets.json, which python/charts/build_charts.py checks against
// the quadrangle the IAU/USGS Gazetteer gives each of the bodies' 13,700
// named features; the names are the Gazetteer's too (public/charts/index.json).

import SHEETS from './sheets.json';

// [south edge, north edge, sheets, edge (deg E), first number, direction]
export type Band = [number, number, number, number, number, 1 | -1];
export interface SheetSet { prefix: string; series: string; projections: string; bands: Band[] }
export interface Sheet { n: number; code: string; south: number; north: number; west: number; east: number; polar: boolean }

export const SHEET_SETS = SHEETS.sets as unknown as Record<string, SheetSet>;

const wrap360 = (x: number) => ((x % 360) + 360) % 360;

export const codeOf = (set: SheetSet, n: number): string => `${set.prefix}-${n}`;

// The sheet a point (latitude, longitude east, degrees) is on.
export function sheetAt(set: SheetSet, lat: number, lonE: number): Sheet | null {
  for (const b of set.bands) {
    const [south, north, count, edge, first, dir] = b;
    if (lat < south || lat > north) continue;
    if (count === 1) return { n: first, code: codeOf(set, first), south, north, west: -180, east: 180, polar: true };
    const w = 360 / count;
    const k = Math.min(count - 1, Math.floor((dir > 0 ? wrap360(lonE - edge) : wrap360(edge - lonE)) / w));
    const west = dir > 0 ? edge + k * w : edge - (k + 1) * w;
    return { n: first + k, code: codeOf(set, first + k), south, north, west, east: west + w, polar: false };
  }
  return null;
}

// Every sheet, for drawing the grid (west edges in deg E, not wrapped).
export function allSheets(set: SheetSet): Sheet[] {
  const out: Sheet[] = [];
  for (const [south, north, count, edge, first, dir] of set.bands) {
    if (count === 1) { out.push({ n: first, code: codeOf(set, first), south, north, west: -180, east: 180, polar: true }); continue; }
    const w = 360 / count;
    for (let k = 0; k < count; k++) {
      const west = dir > 0 ? edge + k * w : edge - (k + 1) * w;
      out.push({ n: first + k, code: codeOf(set, first + k), south, north, west, east: west + w, polar: false });
    }
  }
  return out.sort((a, b) => a.n - b.n);
}
