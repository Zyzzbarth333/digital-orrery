// scripts/data-publish.mjs
//
// npm run data:publish: publish each data set in public/manifest.json that
// has no release yet, as a GitHub Release asset (ADR-0001, phase B). A
// release is never replaced or deleted: older commits pin it.
//
//   npm run data:publish              show what would be published (no change)
//   npm run data:publish -- --yes     pack and publish (needs gh, signed in)
//
// It first checks the files on disk match the manifest (npm run data --
// --verify), so a release always holds exactly what the manifest pins.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC, REPO, ROOT, SETS, assetOf, readManifest, tagOf } from './lib/data-sets.mjs';

const yes = process.argv.includes('--yes');
const m = readManifest();
const cache = join(ROOT, 'node_modules', '.cache', 'orrery-data');

const exists = (tag) => spawnSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' }).status === 0;

execFileSync(process.execPath, [join(ROOT, 'scripts', 'data.mjs'), '--verify', '--check'], { stdio: 'inherit' });

const todo = Object.entries(m.sets).filter(([set, { version }]) => !exists(tagOf(set, version)));
if (todo.length === 0) { console.log('Every data set in the manifest is already published.'); process.exit(0); }
for (const [set, { version, files, bytes }] of todo) console.log(`${yes ? 'publishing' : 'would publish'} ${tagOf(set, version)}: ${files} files, ${(bytes / 1e6).toFixed(1)} MB`);
if (!yes) { console.log('\nNothing changed. Run with --yes to publish.'); process.exit(0); }

mkdirSync(cache, { recursive: true });
for (const [set, { version, source }] of todo) {
  const licence = SETS[set]?.licence;
  const file = join(cache, assetOf(set, version));
  const list = m.files.filter((f) => f.set === set).map((f) => f.path);
  // Packed from the manifest's own list, so nothing outside it ships.
  execFileSync('tar', ['-czf', file, '-C', PUBLIC, ...list], { stdio: 'inherit', maxBuffer: 1 << 26 });
  console.log(`  ${assetOf(set, version)}: ${(statSync(file).size / 1e6).toFixed(1)} MB packed`);
  execFileSync('gh', ['release', 'create', tagOf(set, version), file, '--repo', REPO,
    '--title', `Data: ${set} ${version}`,
    '--notes', `The ${set} data set (public/${SETS[set]?.dir ?? set}/), version ${version}, pinned by public/manifest.json. Made by ${source}. Fetched by \`npm run data\`; never replaced or deleted, since older commits pin it.${licence ? `\n\n${licence}` : ''}`,
    '--latest=false'], { stdio: 'inherit' });
  rmSync(file, { force: true });
}
