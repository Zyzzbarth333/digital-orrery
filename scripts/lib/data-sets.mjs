// scripts/lib/data-sets.mjs
//
// The generated data the app loads from public/, in sets that are published
// as GitHub Release assets and pinned by public/manifest.json (ADR-0001,
// phase B). Shared by pipelines/manifest.build.mjs, scripts/data.mjs and
// scripts/data-publish.mjs.
//
// A set's version is the first 12 hex digits of the SHA-256 of its sorted
// file list (path and hash per line): it changes when any file does, and the
// same content always has the same version, so a release tag
// (data-<set>-<version>) never needs to change once published.

import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = new URL('../..', import.meta.url).pathname;
export const PUBLIC = join(ROOT, 'public');
export const MANIFEST = join(PUBLIC, 'manifest.json');
export const REPO = 'Zyzzbarth333/digital-orrery';

// Each set: its folder under public/ and where its files come from.
export const SETS = {
  textures: { dir: 'textures', source: 'python/textures (surface maps, stars), pipelines/*.build.mjs' },
  ephemeris: { dir: 'ephemeris', source: 'c/ CSPICE fitters (DE442, moons, asteroids, Earth orientation)' },
  models: { dir: 'models', source: 'NASA 3D Resources, NASA/JPL Eyes on the Solar System and Eyes on the Earth (docs/credits.md)' },
  data: { dir: 'data', source: 'pipelines/*.fetch.mjs (CelesTrak, SBDB, NOAA, Horizons and others)' },
  missions: { dir: 'missions', source: 'pipelines/missions.build.mjs, pipelines/artemis*.export.mjs' },
  trajbrowser: { dir: 'trajbrowser', source: 'pipelines/trajbrowser.fetch.mjs (NASA Ames Trajectory Browser)' },
  sky: { dir: 'sky', source: 'python/textures/sky.py (Hipparcos, IAU WGSN names, BSC5, d3-celestial constellations)' },
  // Share-alike: the baked maps keep the source's licence, its credit and a
  // note of the changes, which the release notes carry (licence).
  marsdust: {
    dir: 'marsdust', source: 'pipelines/marsdust.build.mjs (Montabone et al., Mars dust climatology v2, LMD)',
    licence: 'Licence: CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/), as its source, not the code\'s MIT. Source: Mars dust climatology v2, the kriged daily column dust optical depth maps, MY 24 to MY 36, by L. Montabone, F. Forget, E. Millour et al. (Icarus 251, 65-95, 2015, doi:10.1016/j.icarus.2014.12.034; JGR Planets 125, 2020, doi:10.1029/2019JE006111), Laboratoire de Météorologie Dynamique, https://www-mars.lmd.jussieu.fr/mars/dust_climatology/. Changes: each sol\'s map reordered from the south pole and 180 W, encoded as one byte per cell (the square root of the optical depth), only complete maps kept, one file per Mars year; marsdust/index.json says the same.',
  },
  charts: {
    dir: 'charts', source: 'python/charts/build_charts.py (MOLA, LOLA, MESSENGER and Magellan DEMs, ETOPO 2022, the IAU/USGS Gazetteer)',
    licence: 'Licence: public domain, as its sources are US government works: MOLA MEGDR (NASA/GSFC MOLA Science Team), LOLA (NASA/GSFC, via NASA SVS), the USGS MESSENGER global DEM 665 m v2 and Magellan global topography 4,641 m (USGS Astrogeology), ETOPO 2022 (NOAA NCEI, doi:10.25921/fd45-gt74), and the names from the IAU/USGS Gazetteer of Planetary Nomenclature. Credits: docs/credits.md; method: docs/frontend/chart.md.',
  },
};

// Files under a set's folder that are not part of the published set: the
// inner moons' tables outside 2020-2035, built locally by
// `npm run build:moon-tables` (docs/frontend/moons.md), and desktop clutter.
export const EXCLUDE = [/^ephemeris\/moons-extra\//, /(^|\/)\.DS_Store$/, /(^|\/)Thumbs\.db$/];

export const tagOf = (set, version) => `data-${set}-${version}`;
export const assetOf = (set, version) => `${set}-${version}.tar.gz`;
// Where the sets are fetched from: GitHub Releases, or another host with the
// same <tag>/<asset> layout (ORRERY_DATA_URL; the ADR's long-term R2 bucket).
export const DATA_BASE = process.env.ORRERY_DATA_URL ?? `https://github.com/${REPO}/releases/download`;
export const urlOf = (set, version) => `${DATA_BASE.replace(/\/$/, '')}/${tagOf(set, version)}/${assetOf(set, version)}`;

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

export function versionOf(files) {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) h.update(`${f.path} ${f.sha256}\n`);
  return h.digest('hex').slice(0, 12);
}

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}
