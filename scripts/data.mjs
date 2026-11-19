// scripts/data.mjs
//
// npm run data: make public/ hold the data public/manifest.json pins
// (ADR-0001, phase B). For each set it checks every file is there at the
// manifest's size; a set with a file missing or the wrong size is fetched
// from its GitHub Release asset (data-<set>-<version>), unpacked into public/
// and checked against the manifest's SHA-256s.
//
//   npm run data                      fetch what is missing or out of date
//   npm run data -- --verify          also hash every file (slower; CI)
//   npm run data -- --check           report only, fetch nothing (exit 1 if not ready)
//   npm run data -- --set textures,models
//   ORRERY_DATA_URL=<base> npm run data  fetch from another host (<base>/<tag>/<asset>)
//
// Downloads go to node_modules/.cache/orrery-data, on disk (not /tmp, which
// may be memory), and are removed once unpacked.

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PUBLIC, ROOT, assetOf, readManifest, sha256File, urlOf } from './lib/data-sets.mjs';

const args = process.argv.slice(2);
const verify = args.includes('--verify'), checkOnly = args.includes('--check');
const only = (args.find((_a, i) => args[i - 1] === '--set') ?? args.find((a) => a.startsWith('--set='))?.slice(6))?.split(',');

const m = readManifest();
const names = Object.keys(m.sets).filter((n) => !only || only.includes(n));
if (only) for (const n of only) if (!m.sets[n]) { console.error(`no set "${n}" in the manifest (${Object.keys(m.sets).join(', ')})`); process.exit(2); }

// Files of a set that are missing, the wrong size, or (with hashing) the wrong content.
async function problems(set, hash) {
  const bad = [];
  for (const f of m.files.filter((x) => x.set === set)) {
    const p = join(PUBLIC, f.path);
    if (!existsSync(p)) { bad.push(`${f.path}: missing`); continue; }
    if (statSync(p).size !== f.bytes) { bad.push(`${f.path}: ${statSync(p).size} bytes, the manifest says ${f.bytes}`); continue; }
    if (hash && (await sha256File(p)) !== f.sha256) bad.push(`${f.path}: SHA-256 differs from the manifest`);
  }
  return bad;
}

async function fetchSet(set, version) {
  const cache = join(ROOT, 'node_modules', '.cache', 'orrery-data');
  mkdirSync(cache, { recursive: true });
  const file = join(cache, assetOf(set, version)), url = urlOf(set, version);
  console.log(`  fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}${res.status === 404 ? ' (is this data version published? see npm run data:publish)' : ''}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  execFileSync('tar', ['-xzf', file, '-C', PUBLIC], { stdio: 'inherit' });
  rmSync(file, { force: true });
}

let failed = 0;
for (const set of names) {
  const { version, files, bytes } = m.sets[set];
  let bad = await problems(set, verify);
  if (bad.length === 0) { console.log(`${set.padEnd(12)} ok      ${files} files, ${(bytes / 1e6).toFixed(1)} MB (${version})`); continue; }
  console.log(`${set.padEnd(12)} ${bad.length} of ${files} files not as pinned (${version}); first: ${bad[0]}`);
  if (checkOnly) { failed++; continue; }
  try {
    await fetchSet(set, version);
    bad = await problems(set, true);
    if (bad.length) { console.error(`${set}: still wrong after fetching: ${bad.slice(0, 3).join('; ')}`); failed++; }
    else console.log(`${set.padEnd(12)} fetched and verified`);
  } catch (e) { console.error(`${set}: ${e.message}`); failed++; }
}
if (failed) {
  console.error(`\n${failed} data set(s) not ready.${checkOnly ? ' Run npm run data to fetch them.' : ''}${verify ? ' If you rebuilt data on purpose, run npm run data:manifest.' : ''}`);
  process.exit(1);
}
