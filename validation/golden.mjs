// validation/golden.mjs: the golden snapshot (ADR-0001 phase C).
//
// Recorded before the physics moves into a package, so the move can be
// shown to change nothing. Two parts, each a checked-in fixture:
//
//   validation/golden/npm-test.txt  every line `npm test` prints, with the
//     wall-clock values masked (MASKS below) and nothing else changed;
//   validation/golden/api.json      the physics' answers for fixed inputs
//     (golden.api.mjs): ephemeris, moons, asteroids, kernel, journeys and
//     satellites, every double kept whole.
//
// A comparison is bit for bit: the text line by line, the numbers with
// Object.is. That holds on one pinned Node version (.nvmrc). Across Node
// versions and browser engines Math.sin, pow and exp may round
// differently, so there --tol compares the API numbers to a relative
// tolerance instead and reports the largest difference.
//
//   node validation/golden.mjs                compare both (runs npm test, about 2 min)
//   node validation/golden.mjs --api          compare the API part only (5 s)
//   node validation/golden.mjs --log FILE     take npm test's output from FILE
//   node validation/golden.mjs --record       write the fixtures instead
//   node validation/golden.mjs --api --tol 1e-12
//
// npm run golden and npm run golden:record do the first and the fourth.

import '@digital-orrery/physics/deNode.js';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apiSnapshot } from './golden.api.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = new URL('./golden/', import.meta.url);
const TEST_FILE = new URL('npm-test.txt', DIR), API_FILE = new URL('api.json', DIR);

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const record = flag('--record'), apiOnly = flag('--api'), log = opt('--log');
const tol = opt('--tol') === null ? 0 : Number(opt('--tol'));

// The values npm test prints that come from the wall clock, not the
// physics: each line's timed figures become <clock>, the rest of it stays.
// Each was found by comparing runs and by reading the tests' timers.
const MASKS = [
  // scripts/test.mjs: each part's header.
  [/^(>>> .*?)  \(\d+\.\d s\)$/, '$1'],
  // porkchop.test.mjs, nbody.test.mjs: a grid's and a day's CPU time.
  [/ cells in \d+ ms, /, ' cells in <clock> ms, '],
  [/(\d+ steps) in \d+ ms; /, '$1 in <clock> ms; '],
  // attitude.test.mjs: the frames' CPU cost and its ratio.
  [/frames [\d.]+ ms each on average/, 'frames <clock> ms each on average'],
  [/a median frame [\d.]+ ms of CPU against [\d.]+ ms for the point mass(.*); median ratio [\d.]+$/, 'a median frame <clock> ms of CPU against <clock> ms for the point mass$1; median ratio <clock>'],
  // smallbodies.test.mjs: binning and search times.
  [/ binned in \d+ ms$/, ' binned in <clock> ms'],
  [/a search over every body takes [\d.]+ ms/, 'a search over every body takes <clock> ms'],
  // kernelClient.test.mjs CASE 1 and 2: requests cut by a wall-clock
  // budget, so how many there are and where the entry lands move (0 to
  // 1.4 km, the test's own comment).
  [/in one request: [\d.]+ s of kernel time/, 'in one request: <clock> s of kernel time'],
  [/through the client: \d+ requests in [\d.]+ s, the longest answered in \d+ ms/, 'through the client: <clock> requests in <clock> s, the longest answered in <clock> ms'],
  [/\(longest \d+ ms, against [\d.]+ s in one request\)/, '(longest <clock> ms, against <clock> s in one request)'],
  [/one-request entry \(\d+ m, -?[\d.]+ s apart\)/, 'one-request entry (<clock> m, <clock> s apart)'],
  [/one batch: \d+ ms; capsule \d+ steps \([\d.]+ h to go\)/, 'one batch: <clock> ms; capsule <clock> steps (<clock> h to go)'],
  // warp.test.mjs: the entry's wall time.
  [/the kernel's entry: [\d.]+ s;/, "the kernel's entry: <clock> s;"],
  // passes.test.mjs: search times.
  [/300 calls take [\d.]+ ms kept against [\d.]+ ms from the epoch/, '300 calls take <clock> ms kept against <clock> ms from the epoch'],
  [/(passes found, .*), in \d+ ms$/, '$1, in <clock> ms'],
  // remedies.test.mjs CASE 3: the time remedies() takes.
  [/^  worked out in \d+ ms$/, '  worked out in <clock> ms'],
  // gravityFlow.test.mjs, artemis2.validate.mjs: a stage's wall time.
  [/^(\s*)\([\d.]+ s\)$/, '$1(<clock> s)'],
];

// The move into packages/physics (ADR-0001 phase C) changed where the test
// files are, not what they print: their paths are compared as recorded,
// when every one of them was under src/physics/.
const MOVED = [[/packages\/physics\/src\//g, 'src/physics/'], [/src\/browser\//g, 'src/physics/']];

// npm's own header, and test.mjs's closing summary (its timings and the
// slowest parts, in an order that changes) up to the RESULT line.
function normalise(text) {
  const out = [];
  let floating = [], inSummary = false;
  const flush = () => { out.push(...floating.sort()); floating = []; };
  for (let line of text.replace(/\r/g, '').split('\n')) {
    if (/^> (digital-orrery@|node scripts\/test\.mjs)/.test(line)) continue;
    if (/^npm test: \d+ parts, /.test(line)) { inSummary = true; continue; }
    if (inSummary) { if (/^RESULT: /.test(line)) inSummary = false; else continue; }
    // The client's warnings come on stderr, so where they fall among a
    // part's lines depends on timing: they go, sorted, to its end.
    if (/^KernelClient: /.test(line)) { floating.push(line); continue; }
    if (line.startsWith('>>> ')) flush();
    for (const [re, to] of [...MOVED, ...MASKS]) line = line.replace(re, to);
    out.push(line);
  }
  flush();
  while (out.length && out[0] === '') out.shift();
  while (out.length && out.at(-1) === '') out.pop();
  return out.join('\n') + '\n';
}

function npmTestOutput() {
  if (log) return readFileSync(log, 'utf8');
  console.log('running npm test (about 2 min) ...');
  const r = spawnSync(process.execPath, ['scripts/test.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) { process.stdout.write(r.stdout + r.stderr); throw new Error(`npm test failed (exit ${r.status})`); }
  return r.stdout + r.stderr;
}

// Every difference between two canonical values, by path.
function diffs(a, b, path = '', out = [], worst = { rel: 0, at: '' }) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Object.is(a, b)) return { out, worst };
    const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
    if (rel > worst.rel) Object.assign(worst, { rel, at: path });
    if (rel > tol) out.push(`${path}: ${a} -> ${b} (relative ${rel.toExponential(2)})`);
    return { out, worst };
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (!(k in a)) out.push(`${path}.${k}: added`);
      else if (!(k in b)) out.push(`${path}.${k}: gone`);
      else diffs(a[k], b[k], `${path}.${k}`, out, worst);
    }
    return { out, worst };
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return { out, worst };
}

const show = (list, n = 20) => list.slice(0, n).map((x) => `    ${x}`).join('\n') + (list.length > n ? `\n    ... and ${list.length - n} more` : '');
let failed = 0;

console.log(`golden snapshot on Node ${process.versions.node}${tol ? `, API numbers to a relative ${tol}` : ', bit for bit'}`);
const api = apiSnapshot();
if (record) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(API_FILE, JSON.stringify({ node: process.versions.node, ...api }, null, 1) + '\n');
  console.log(`wrote ${fileURLToPath(API_FILE).slice(ROOT.length)}`);
  if (!apiOnly) {
    writeFileSync(TEST_FILE, normalise(npmTestOutput()));
    console.log(`wrote ${fileURLToPath(TEST_FILE).slice(ROOT.length)}`);
  }
  process.exit(0);
}

const { node: recordedOn, ...want } = JSON.parse(readFileSync(API_FILE, 'utf8'));
for (const section of Object.keys(want)) {
  const { out, worst } = diffs(want[section], api[section], section);
  const n = JSON.stringify(want[section]).match(/-?\d[\d.e+-]*/g)?.length ?? 0;
  if (out.length) failed++;
  console.log(`${out.length ? 'FAIL' : 'ok  '} api ${section}: ${out.length ? `${out.length} differ` : tol ? 'within tolerance' : 'identical'} (about ${n} numbers${worst.rel ? `; largest relative difference ${worst.rel.toExponential(2)} at ${worst.at}` : ''})`);
  if (out.length) console.log(show(out));
}
if (recordedOn !== process.versions.node) console.log(`     (recorded on Node ${recordedOn})`);

if (!apiOnly) {
  const want = readFileSync(TEST_FILE, 'utf8').split('\n'), got = normalise(npmTestOutput()).split('\n');
  const bad = [];
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) bad.push(`line ${i + 1}:\n      want ${want[i] ?? '(none)'}\n      got  ${got[i] ?? '(none)'}`);
  }
  if (bad.length) failed++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} npm test: ${bad.length ? `${bad.length} of ${want.length} lines differ` : `all ${want.length} lines identical`}`);
  if (bad.length) console.log(show(bad, 10));
}

console.log(failed ? `\n${failed} FAILED` : '\nall identical');
process.exit(failed ? 1 : 0);
