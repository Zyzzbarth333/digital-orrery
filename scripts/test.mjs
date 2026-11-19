// scripts/test.mjs: npm test. Every check file, run side by side.
//
// Each file (or part of one) runs in its own Node process, a few at once;
// its output is printed whole, in the order listed here, once it and every
// part before it are done, so the log reads as one run did. A part fails
// if its process exits non-zero or prints a FAIL line. The slowest files
// run in parts: journey.test.mjs by case, missions.validate.mjs by mission
// (each takes the names on its command line). A journey case not named
// in a part runs in the last part, which takes the rest (--except).
//
//   node scripts/test.mjs [--jobs N] [filter ...]
//
// --jobs (or TEST_JOBS): how many at once; by default the machine's
// processors, at most 4 (the journey parts take up to 0.8 GB each).
// filter: only the parts whose command contains one of these.
// docs/performance.md#the-test-suite has the timings.

import { spawn } from 'node:child_process';
import os from 'node:os';
import { MISSIONS as MISSION_DATA } from '../validation/missions.data.mjs';

const JOURNEY = 'packages/physics/src/journey.test.mjs';
// The journey cases that fly for longest, in parts of their own (CASE 12's
// three flights round the Sun, CASE 17's to Europa and Titan); the rest
// together. CASE 21 takes CASE 20's flight, so they run in one part.
const JOURNEY_PARTS = [['17'], ['12'], ['20', '21'], ['5'], ['15', '16', '8'], ['9', '10']];
const MISSIONS = Object.keys(MISSION_DATA);

const FILES = [
  'scripts/lib/chromium.test.mjs', 'src/app/tex.test.mjs', 'src/scene/ktx2.test.mjs', 'src/scene/ktx2Range.test.mjs', 'src/browser/loadQueue.test.mjs', 'src/scene/layerComposite.test.mjs', 'src/app/craft-state.test.mjs', 'src/app/remember.test.mjs', 'src/app/stores.test.mjs', 'src/app/clouds-row.test.mjs', 'src/app/clock-entry.test.mjs',
  'packages/physics/src/orbital.test.mjs', 'packages/physics/src/porkchop.test.mjs', 'packages/physics/src/nbody.test.mjs',
  'packages/physics/src/orientation.test.mjs', 'packages/physics/src/surfaceClamp.test.mjs', 'packages/physics/src/bodyfacts.test.mjs',
  'src/browser/craft.test.mjs', 'packages/physics/src/warp.test.mjs', 'packages/physics/src/trajsearch.test.mjs',
  ...JOURNEY_PARTS.map((cases) => `${JOURNEY} ${cases.join(' ')}`),
  `${JOURNEY} --except ${JOURNEY_PARTS.flat().join(' ')}`,
  'packages/physics/src/nesc.test.mjs', 'packages/physics/src/attitude.test.mjs', 'packages/physics/src/environment.test.mjs',
  'packages/physics/src/rocket.test.mjs', 'packages/physics/src/rocket.xcheck.test.mjs', 'packages/physics/src/launchers.test.mjs', 'packages/physics/src/stackShape.test.mjs',
  'packages/physics/src/ork.test.mjs', 'packages/physics/src/entry.test.mjs', 'packages/physics/src/smallbodies.test.mjs',
  'packages/physics/src/scintillation.test.mjs', 'packages/physics/src/asteroids.test.mjs', 'packages/physics/src/gravityGuides.test.mjs',
  'packages/physics/src/gravityFlow.test.mjs', 'packages/physics/src/magnetic.test.mjs', 'packages/physics/src/aurora.test.mjs',
  'packages/physics/src/moons.test.mjs', 'packages/physics/src/landingSites.test.mjs', 'packages/physics/src/irregularMoons.test.mjs', 'packages/physics/src/flyby.test.mjs', 'packages/physics/src/remedies.test.mjs',
  'src/browser/kernelClient.test.mjs', 'packages/physics/src/barycentres.test.mjs', 'packages/physics/src/deTable.test.mjs', 'src/browser/dataLoad.test.mjs',
  'packages/physics/src/corona.test.mjs', 'packages/physics/src/rings.test.mjs', 'packages/physics/src/discs.test.mjs', 'packages/physics/src/umbra.test.mjs',
  'packages/physics/src/satellites.test.mjs', 'packages/physics/src/passes.test.mjs', 'packages/physics/src/spacecraft.test.mjs',
  'validation/artemis2.validate.mjs', 'validation/artemis1.validate.mjs',
  ...MISSIONS.map((id) => `validation/missions.validate.mjs ${id}`),
];

// Seconds each took on its own (docs/performance.md), so the longest start
// first and the short ones fill in around them; unlisted, a second.
const SECONDS = {
  [`${JOURNEY} 17`]: 58, [`${JOURNEY} 12`]: 58, [`${JOURNEY} 20 21`]: 51, 'validation/artemis1.validate.mjs': 43,
  'validation/missions.validate.mjs messenger': 37, 'validation/artemis2.validate.mjs': 29,
  [`${JOURNEY} 5`]: 28, [`${JOURNEY} 15 16 8`]: 32, 'packages/physics/src/entry.test.mjs': 24,
  'validation/missions.validate.mjs lro': 24, 'packages/physics/src/attitude.test.mjs': 23,
  [`${JOURNEY} 9 10`]: 21, 'src/browser/kernelClient.test.mjs': 20, 'packages/physics/src/environment.test.mjs': 19,
  'src/browser/craft.test.mjs': 17, 'packages/physics/src/nesc.test.mjs': 12, 'validation/missions.validate.mjs juno2013': 10,
  'packages/physics/src/trajsearch.test.mjs': 10, 'packages/physics/src/warp.test.mjs': 4,
};

const argv = process.argv.slice(2);
const jobsAt = argv.indexOf('--jobs');
const jobs = Math.max(1, Number(jobsAt >= 0 ? argv.splice(jobsAt, 2)[1] : process.env.TEST_JOBS) || Math.min(os.availableParallelism(), 4));
const parts = FILES.filter((f) => !argv.length || argv.some((a) => f.includes(a)));
if (!parts.length) { console.log(`no part matches ${argv.join(' ')}`); process.exit(1); }

const results = new Array(parts.length);
let printed = 0;
const flush = () => {
  while (printed < parts.length && results[printed]) {
    const r = results[printed++];
    process.stdout.write(`\n>>> node ${r.part}  (${r.seconds.toFixed(1)} s)\n${r.out}`);
    if (!r.ok) process.stdout.write(`>>> FAILED: node ${r.part}${r.code ? ` (exit ${r.code})` : ''}\n`);
  }
};
const run = (i) => new Promise((done) => {
  const part = parts[i], t0 = performance.now(), chunks = [];
  const p = spawn(process.execPath, part.split(' '), { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => chunks.push(d));
  p.stderr.on('data', (d) => chunks.push(d));
  p.on('close', (code, signal) => {
    const out = Buffer.concat(chunks).toString();
    results[i] = { part, out, code: code ?? signal, seconds: (performance.now() - t0) / 1000, ok: code === 0 && !/^\s*FAIL\b/m.test(out) };
    flush();
    done();
  });
});

const t0 = performance.now();
const queue = parts.map((_, i) => i).sort((a, b) => (SECONDS[parts[b]] ?? 1) - (SECONDS[parts[a]] ?? 1));
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => { while (queue.length) await run(queue.shift()); }));

const failed = results.filter((r) => !r.ok);
const wall = (performance.now() - t0) / 1000, sum = results.reduce((s, r) => s + r.seconds, 0);
console.log(`\n${'='.repeat(72)}\nnpm test: ${parts.length} parts, ${jobs} at a time, ${wall.toFixed(0)} s (${sum.toFixed(0)} s one after another); the slowest:`);
for (const r of [...results].sort((a, b) => b.seconds - a.seconds).slice(0, 8)) console.log(`  ${r.seconds.toFixed(1).padStart(6)} s  ${r.part}`);
console.log(failed.length ? `RESULT: ${failed.length} part(s) FAILED: ${failed.map((r) => r.part).join('; ')}` : 'RESULT: every part PASSED');
process.exitCode = failed.length ? 1 : 0;
