// pipelines/marsdust.build.mjs
//
// Bakes Montabone et al.'s Mars dust climatology (LMD, v2: the kriged daily
// column dust optical depth maps, 3 deg x 3 deg, MY 24 to MY 36) into the
// app's marsdust data set (docs/frontend/mars-dust.md):
//
//   public/marsdust/my<NN>.bin   one map per sol, nLat rows from the south
//                                pole up, nLon values from 180 W eastward,
//                                one byte per cell: 255 sqrt(tau / maxCdod)
//   public/marsdust/index.json   the grid, the encoding, each year's sols,
//                                the source, licence and changes made
//
// The source files are CC BY-SA 3.0, and so are these: the credit and the
// changes are written into index.json and the docs.
//
//   npm run build:marsdust -- [dir]     dir: where the LMD files are
//                                       (default ~/.cache/digital-orrery/marsdust),
//                                       either dustscenario_MY*.nc or
//                                       krigedcdod_v2.tar.gz, unpacked there
//   npm run build:marsdust -- --inspect [dir]   print one file's header
//
// Times: each file holds 669 daily maps on the paper's sol calendar
// (Montabone et al. 2015, App. A): map t from t.0 to t+1.0 sols past its
// year's start, labelled with the Ls at t.5. The calendar's years are whole
// sols, 668 or 669, so a year starts up to 0.7 sol from Ls 0 and a year's
// last map can be the next year's first (then the next year's is used).
// The calendar counts whole sols without a break, so the years are placed
// together: each year's start is estimated from its maps (the instants
// marsTime.js's series reaches each map's Ls, less t + 0.5 sols, averaged),
// and one epoch is fitted to all thirteen with each start a whole number of
// sols after it. Every map's Ls must then be reached by the series within
// a quarter of a sol of its middle: the files' Ls comes from a simpler
// orbit than the series' (up to 0.1 deg apart, about 4 hours), and each
// map is a whole sol's average. Each year's own estimate may drift from the
// epoch by up to 0.1 sol (the calendar's 668.6-sol year against Mars's
// 668.59: 0.008 sol a year). MY 35 and 36 give each map's mean observation
// time (aveMJD): the median, over the year, must be within half a sol of
// the maps' middles (a map in a gap between observations draws on days
// either side, so single maps can be sols away).
// MY 24's file fills Ls 0 to 105 (before MGS TES began mapping) with the
// average of MY 25 and 26 (its title says so): those sols are left out.

import '@digital-orrery/physics/deNode.js';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { marsLs, marsYearStart, SOL_S } from '@digital-orrery/physics/marsTime.js';
import { readNetcdf } from './lib/netcdf3.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'public', 'marsdust');
const args = process.argv.slice(2);
const inspect = args.includes('--inspect');
const dir = args.find((a) => !a.startsWith('--')) ?? join(homedir(), '.cache', 'digital-orrery', 'marsdust');

// The variable drawn: the column dust optical depth at 9.3 um normalised to
// the MCD's surface pressure at each cell (the column the light crosses
// there), not the one at the 610 Pa reference level.
const VARIABLE = 'cdodtot';
// Visible extinction per 9.3 um absorption optical depth (the LMD page's
// note, from Montabone et al. 2015, Sec. 2.3.4).
const VISIBLE = 2.6;
const STEP = 3;

function sources() {
  const find = () => (existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => /dustscenario_MY\d+_v[\d-]+\.nc$/.test(f)).sort() : []);
  let files = find();
  if (!files.length && existsSync(join(dir, 'krigedcdod_v2.tar.gz'))) {
    execFileSync('tar', ['-xzf', join(dir, 'krigedcdod_v2.tar.gz'), '-C', dir], { stdio: 'inherit' });
    files = find();
  }
  if (!files.length) throw new Error(`no dustscenario_MY*.nc in ${dir}`);
  return files.map((f) => join(dir, f));
}

const files = sources();
if (inspect) {
  const nc = readNetcdf(readFileSync(files[0]));
  console.log(files[0], `CDF-${nc.version}`, 'records', nc.numrecs);
  console.log('dims', nc.dims);
  console.log('global attrs', nc.attrs);
  for (const [k, v] of Object.entries(nc.vars)) console.log(k, v.dims, v.shape, v.type, v.attrs);
  process.exit(0);
}

const wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
const pick = (nc, names) => { const n = names.find((x) => nc.vars[x]); if (!n) throw new Error(`none of ${names.join(', ')} in the file`); return n; };

// First pass: read each year, check its grid and times, and find the
// largest optical depth for the encoding.
const years = [];
let maxAll = 0, lonFirst = null;
for (const path of files) {
  const [, myStr, ver] = path.match(/dustscenario_MY(\d+)_v([\d-]+)\.nc$/);
  const my = Number(myStr);
  const nc = readNetcdf(readFileSync(path));
  const v = nc.vars[VARIABLE];
  if (!v) throw new Error(`${path}: no ${VARIABLE} (has ${Object.keys(nc.vars).join(', ')})`);
  const lon = nc.read(pick(nc, ['longitude', 'lon'])), lat = nc.read(pick(nc, ['latitude', 'lat']));
  const time = nc.read(pick(nc, ['Time', 'time'])), ls = nc.read(pick(nc, ['Ls', 'ls']));
  const [nT, nLat, nLon] = v.shape;
  if (v.dims.length !== 3 || lon.length !== nLon || lat.length !== nLat || time.length !== nT) throw new Error(`${path}: ${VARIABLE} is ${v.dims.join(' x ')}, not time x latitude x longitude`);
  // Every 3 deg: the longitudes from 180 W east (the files' points are at
  // 180 W, 177 W, ...; written from 180 W either way), the latitudes cell
  // centres from 88.5 S up (the files run from the north).
  const lonE = Array.from(lon, (x) => ((x + 180) % 360 + 360) % 360 - 180);
  const lonOrder = lonE.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  const latOrder = Array.from(lat, (x, i) => [x, i]).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  lonFirst ??= lonE[lonOrder[0]];
  const okGrid = lonOrder.every((i, k) => Math.abs(lonE[i] - (lonFirst + k * STEP)) < 1e-3) && lonFirst < -180 + STEP
    && latOrder.every((j, k) => Math.abs(lat[j] - (-90 + STEP / 2 + k * STEP)) < 1e-3);
  if (!okGrid || nLon !== 360 / STEP || nLat !== 180 / STEP) throw new Error(`${path}: not a 3-degree grid like the other years' (lon ${lon[0]}..${lon[nLon - 1]}, lat ${lat[0]}..${lat[nLat - 1]})`);
  const data = nc.read(VARIABLE);
  const fill = v.attrs._FillValue ?? v.attrs.missing_value;
  // A map is used only if every cell has a value.
  const maps = [];
  for (let t = 0; t < nT; t++) {
    const grid = new Float64Array(nLat * nLon);
    let ok = true;
    for (let k = 0; k < nLat; k++) for (let i = 0; i < nLon; i++) {
      const x = data[t * nLat * nLon + latOrder[k] * nLon + lonOrder[i]];
      if (!Number.isFinite(x) || x < 0 || (fill !== undefined && x === fill) || x > 1e3) ok = false;
      grid[k * nLon + i] = x;
    }
    maps.push(ok ? grid : null);
    if (ok) for (const x of grid) maxAll = Math.max(maxAll, x);
  }
  if (!time.every((x, t) => x === t + 0.5)) throw new Error(`${path}: Time is not 0.5, 1.5, ...`);
  // The instant of the first map's middle, from its Ls; half a sol before it
  // the year's first sol began.
  const solMs = SOL_S * 1000;
  let noon = marsYearStart(my) + 0.5 * solMs;
  for (let k = 0; k < 20; k++) {
    const rate = wrap180(marsLs(noon + 43200e3) - marsLs(noon - 43200e3)) / 86400e3;
    const step = wrap180(marsLs(noon) - ls[0]) / rate;
    noon -= step;
    if (Math.abs(step) < 1) break;
  }
  // How far (sols) each map's Ls is from the series' at the map's middle,
  // the series running ahead (positive) or behind.
  const offsets = (s0) => Array.from({ length: nT }, (_, t) => {
    const at = s0 + (t + 0.5) * solMs;
    const dLs = wrap180(marsLs(at) - ls[t]);
    return [dLs / wrap180(marsLs(at + solMs / 2) - marsLs(at - solMs / 2)), dLs];   // over deg per sol
  });
  const first0 = noon - 0.5 * solMs;
  const start = first0 - (offsets(first0).reduce((n, [o]) => n + o, 0) / nT) * solMs;
  // Left out: MY 24's maps before Ls 105, which are other years' average.
  const first = my === 24 ? ls.findIndex((x) => x >= 105) : 0;
  const aveMJD = nc.vars.aveMJD ? nc.read('aveMJD') : null;
  years.push({ my, ver: ver.replace(/-/g, '.'), maps, estimate: start, offsets, first, ls, aveMJD, units: v.attrs.units, longName: v.attrs.long_name });
}
// One epoch for the calendar: each year a whole number of sols after MY 24.
{
  const solMs = SOL_S * 1000;
  years.sort((p, q) => p.my - q.my);
  const e0 = years[0].estimate;
  for (const y of years) y.n = Math.round((y.estimate - e0) / solMs);
  const epoch = years.reduce((s, y) => s + (y.estimate - y.n * solMs), 0) / years.length;
  for (const y of years) {
    y.start = epoch + y.n * solMs;
    const residual = (y.estimate - y.start) / solMs;
    let worst = 0, worstDeg = 0;
    for (const [o, d] of y.offsets(y.start)) { worst = Math.max(worst, Math.abs(o)); worstDeg = Math.max(worstDeg, Math.abs(d)); }
    let obs = '';
    if (y.aveMJD) {
      const off = Array.from(y.aveMJD, (m, t) => ((m - 40587) * 86400e3 - (y.start + (t + 0.5) * solMs)) / solMs);
      const abs = off.map(Math.abs).sort((p, q) => p - q);
      const median = [...off].sort((p, q) => p - q)[off.length >> 1];
      if (Math.abs(median) > 0.5) throw new Error(`MY ${y.my}: the maps' mean observation times are a median ${median.toFixed(2)} sol from their middles`);
      obs = `; observed (aveMJD) a median ${median.toFixed(2)} sol from each map's middle, 95 % within ${abs[Math.floor(abs.length * 0.95)].toFixed(2)}, the farthest ${abs[abs.length - 1].toFixed(2)}`;
    }
    if (worst > 0.25 || Math.abs(residual) > 0.1) throw new Error(`MY ${y.my}: a map's Ls is ${worst.toFixed(3)} sol from the series' at its middle (year ${residual.toFixed(3)} sol from the calendar)`);
    console.log(`MY ${y.my} v${y.ver}: ${y.maps.length} maps from ${new Date(y.start).toISOString().slice(0, 16)}Z, calendar sol ${y.n} (${((y.start - marsYearStart(y.my)) / solMs).toFixed(2)} sol from Ls 0; its own maps put it ${residual.toFixed(3)} sol off); each map's Ls within ${worst.toFixed(3)} sol (${worstDeg.toFixed(3)} deg) of the series'${obs}${y.first ? `; from map ${y.first} (Ls ${y.ls[y.first].toFixed(2)})` : ''}`);
  }
}

// The encoding's top: the largest value, up to the next tenth.
const maxCdod = Math.ceil(maxAll * 10) / 10;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const index = {
  source: 'Mars dust climatology v2 (kriged daily column dust optical depth maps), Laboratoire de Météorologie Dynamique: https://www-mars.lmd.jussieu.fr/mars/dust_climatology/',
  authors: 'L. Montabone, F. Forget, E. Millour et al., Icarus 251, 65-95 (2015), doi:10.1016/j.icarus.2014.12.034; L. Montabone et al., JGR Planets 125 (2020), doi:10.1029/2019JE006111',
  licence: 'CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/), as the source',
  time: 'Map k of a year\'s file is for the sol from start + k sols to start + k + 1 sols (start: UTC, ms; a sol is 88775.244 s), sol soy + k of that Mars year in the files\' calendar; the years\' starts are one epoch, fitted to every map\'s Ls by Allison and McEwen\'s series, and a whole number of sols.',
  changes: 'Each sol\'s map of cdodtot (the whole column, to the surface) reordered to rows from the south pole and values from 180 W, encoded as one byte, round(255 sqrt(cdodtot / maxCdod)); MY 24\'s maps before Ls 105 (the MY 25 and 26 average, not MY 24\'s observations) and a year\'s last map where it is the next year\'s first sol left out; one file per Mars year. Made by pipelines/marsdust.build.mjs.',
  variable: `${VARIABLE}: ${years[0].longName ?? ''} (${years[0].units ?? ''})`,
  // lon0, lat0: the first value's place (deg east, deg north); cells step east, then north.
  grid: { nLon: 360 / STEP, nLat: 180 / STEP, lon0: lonFirst, lat0: -90 + STEP / 2, step: STEP },
  maxCdod, visible: VISIBLE,
  years: [],
};
let worstErr = 0, bytes = 0;
const n = (360 / STEP) * (180 / STEP);
for (const [i, y] of years.entries()) {
  // From the first map used up to the next year's first sol.
  const next = years[i + 1];
  if (next && next.my !== y.my + 1) throw new Error(`no MY ${y.my + 1} after MY ${y.my}`);
  const span = next ? next.n - y.n : y.maps.length;
  if (span < 668) throw new Error(`MY ${y.my + 1} begins ${span} sols after MY ${y.my}`);
  const a = y.first, b = Math.min(y.maps.length, span);
  const gap = y.maps.slice(a, b).findIndex((g) => !g);
  if (gap >= 0) throw new Error(`MY ${y.my}: map ${a + gap} is not complete`);
  const out = new Uint8Array((b - a) * n);
  for (let t = a; t < b; t++) {
    const g = y.maps[t];
    for (let c = 0; c < n; c++) {
      const v = Math.round(255 * Math.sqrt(Math.min(g[c], maxCdod) / maxCdod));
      out[(t - a) * n + c] = v;
      worstErr = Math.max(worstErr, Math.abs(maxCdod * (v / 255) ** 2 - g[c]) / Math.max(g[c], 0.05));
    }
  }
  const file = `my${y.my}.bin`;
  writeFileSync(join(OUT, file), out);
  bytes += out.length;
  // start: when the first map's sol begins (UTC, ms); soy: its sol of the
  // year, from 1 as the files count it.
  const start = Math.round(y.start + a * SOL_S * 1000);
  index.years.push({ my: y.my, file, start, soy: a + 1, sols: b - a, version: y.ver });
  console.log(`  my${y.my}.bin: maps ${a}..${b - 1} (sols ${a + 1}..${b}), ${new Date(start).toISOString().slice(0, 16)}Z to ${new Date(start + (b - a) * SOL_S * 1000).toISOString().slice(0, 16)}Z`);
}
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`wrote public/marsdust: ${index.years.length} years, ${(bytes / 1e6).toFixed(1)} MB; maxCdod ${maxCdod}; worst encoding error ${(worstErr * 100).toFixed(2)} % (of the value, or of 0.05 below it)`);
