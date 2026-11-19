// scripts/lib/chromium.test.mjs: stopGroup (chromium.mjs) ends a browser's
// process group whether or not its leader is still up. A browser killed at
// its ORRERY_BROWSER_MEMORY cap is already gone when close() runs; that
// must not throw, or the script that launched it goes down with it.
// Run: node scripts/lib/chromium.test.mjs

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { stopGroup } from './chromium.mjs';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`); };

// A child in its own process group, as launch() starts a browser.
const child = (code) => spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore' });
const within = (ms, p, what) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms).unref())]);

await ok('a leader that exited on its own: stopGroup settles, no error', async () => {
  const p = child('process.exit(0)');
  await once(p, 'exit');
  await within(2000, stopGroup(p), 'exited leader');
});

await ok('a leader killed by a signal (the memory cap): stopGroup settles, no error', async () => {
  const p = child('setInterval(() => {}, 1000)');
  await once(p, 'spawn');
  p.kill('SIGKILL');
  await once(p, 'exit');
  assert.equal(p.signalCode, 'SIGKILL');
  await within(2000, stopGroup(p), 'killed leader');
});

await ok('a leader still running: SIGTERM ends it and stopGroup settles', async () => {
  const p = child('setInterval(() => {}, 1000)');
  await once(p, 'spawn');
  await within(5000, stopGroup(p), 'running leader');
  assert.equal(p.signalCode, 'SIGTERM');
});

await ok('a leader that ignores SIGTERM: SIGKILL after the wait', async () => {
  const p = child("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
  await once(p, 'spawn');
  await new Promise((r) => setTimeout(r, 300)); // the handler is in place
  await within(5000, stopGroup(p, 200), 'stubborn leader');
  assert.equal(p.signalCode, 'SIGKILL');
});

console.log(`chromium: ${n} passed`);
