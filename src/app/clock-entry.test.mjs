// src/app/clock-entry.test.mjs: typing the clock (clock-entry.ts): what is
// read as a UTC instant, what is refused, and the arrow keys' steps.
//
// It is TypeScript, so Vite's module runner loads it.
//
//   node src/app/clock-entry.test.mjs

import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const { parseUtc, formatUtc, stepAt, unitAt } = (await runnerImport('/src/app/clock-entry.ts', { root, configFile: false, logLevel: 'error' })).module;

let passed = 0, failed = 0;
function check(name, fn) {
  let ok;
  try { ok = fn(); } catch (err) { ok = false; console.log(`        threw ${err}`); }
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (ok) passed++; else failed++;
}
const at = (s) => Date.parse(s);
const BASE = at('2026-11-19T12:34:56Z');

console.log('reading what is typed, as UTC');
check('the clock\'s own text', () => parseUtc('2027-08-02 10:06:30', BASE) === at('2027-08-02T10:06:30Z'));
check('ISO with T and Z, no seconds', () => parseUtc('2027-08-02T10:06Z', BASE) === at('2027-08-02T10:06:00Z'));
check('single-digit month, day and hour', () => parseUtc('2027-8-2 9:05', BASE) === at('2027-08-02T09:05:00Z'));
check('a trailing UTC, and spaces around', () => parseUtc('  2028-12-31 16:51 UTC ', BASE) === at('2028-12-31T16:51:00Z'));
check('a date alone is midnight', () => parseUtc('2027-02-06', BASE) === at('2027-02-06T00:00:00Z'));
check('a time alone is on the clock\'s own day', () => parseUtc('18:53', BASE) === at('2026-11-19T18:53:00Z'));
check('fractional seconds are dropped', () => parseUtc('2027-08-02 10:06:30.75', BASE) === at('2027-08-02T10:06:30Z'));
check('a leap day', () => parseUtc('2028-02-29 00:00', BASE) === at('2028-02-29T00:00:00Z'));
check('the year 1000 and the year 2999', () => parseUtc('1000-01-01', BASE) === Date.UTC(1000, 0, 1) && parseUtc('2999-12-31', BASE) === Date.UTC(2999, 11, 31));

console.log('refused');
for (const bad of ['', '   ', 'tomorrow', '2027-02-30', '2027-02-29', '2027-13-01', '2027-00-10', '2027-08-02 24:00', '2027-08-02 10:60',
  '2027-08-02 10:06:61', '2027-08-02+10:00', '2027-08-02 10:06 +10:00', '27-08-02', '2027/08/02', '10:06 2027-08-02', '2027-08-02 10:06 10:07']) {
  check(`"${bad}"`, () => parseUtc(bad, BASE) === null);
}

console.log('formatting');
check('the clock\'s text round-trips', () => formatUtc(at('2027-08-02T10:06:30.400Z')) === '2027-08-02 10:06:30' && parseUtc(formatUtc(BASE), 0) === BASE);

console.log('the arrow keys step the part under the caret');
const T = '2027-01-31 23:59:30';
check('caret positions map to parts', () => [0, 4, 5, 7, 8, 10, 11, 13, 14, 16, 17, 19].map(unitAt).join('') === '001122334455');
check('a year', () => stepAt(T, 2, 1, BASE).text === '2028-01-31 23:59:30');
check('a month keeps its day where it can (31 Jan to 28 Feb)', () => stepAt(T, 6, 1, BASE).text === '2027-02-28 23:59:30');
check('a month back across a year', () => stepAt(T, 6, -1, BASE).text === '2026-12-31 23:59:30');
check('a day rolls the month', () => stepAt(T, 9, 1, BASE).text === '2027-02-01 23:59:30');
check('an hour rolls the day', () => stepAt(T, 12, 1, BASE).text === '2027-02-01 00:59:30');
check('ten minutes (Shift)', () => stepAt(T, 15, -10, BASE).text === '2027-01-31 23:49:30');
check('a second', () => stepAt(T, 19, 1, BASE).text === '2027-01-31 23:59:31');
check('the step selects its part', () => stepAt(T, 12, 1, BASE).sel.join() === '11,13');
check('the instant matches the text', () => { const r = stepAt(T, 9, 1, BASE); return r.ms === at('2027-02-01T23:59:30Z'); });
check('text that isn\'t a date steps nothing', () => stepAt('soon', 3, 1, BASE) === null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
