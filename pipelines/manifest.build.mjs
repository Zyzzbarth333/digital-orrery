// pipelines/manifest.build.mjs
//
// Writes public/manifest.json: every data file the app loads, by set, with
// its size and SHA-256, and each set's version (scripts/lib/data-sets.mjs).
// Run after any pipeline changes a file in public/ (npm run data:manifest);
// CI's `npm run data -- --verify` fails until the manifest matches the files.
//
// The files are what is on disk in each set's folder (the sets are not in
// git: ADR-0001, phase B), less the local extras EXCLUDE names, such as
// public/ephemeris/moons-extra/.

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { EXCLUDE, MANIFEST, PUBLIC, REPO, ROOT, SETS, sha256File, versionOf } from '../scripts/lib/data-sets.mjs';


function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}

function filesOf(dir) {
  return walk(join(PUBLIC, dir)).map((p) => relative(PUBLIC, p)).filter((p) => !EXCLUDE.some((re) => re.test(p)));
}

const sets = {}, files = [];
for (const [name, { dir, source }] of Object.entries(SETS)) {
  const list = [];
  for (const path of filesOf(dir).sort()) {
    const abs = join(PUBLIC, path);
    list.push({ path, set: name, bytes: statSync(abs).size, sha256: await sha256File(abs) });
  }
  const version = versionOf(list);
  sets[name] = { version, files: list.length, bytes: list.reduce((n, f) => n + f.bytes, 0), source };
  files.push(...list);
  console.log(`${name.padEnd(12)} ${String(list.length).padStart(4)} files ${(sets[name].bytes / 1e6).toFixed(1).padStart(7)} MB  version ${version}`);
}

const manifest = { schema: 1, repo: REPO, note: 'The data the app loads, by set (ADR-0001). npm run data fetches and verifies it.', sets, files };
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`wrote ${relative(ROOT, MANIFEST)}: ${files.length} files, ${(files.reduce((n, f) => n + f.bytes, 0) / 1e6).toFixed(1)} MB`);
