// src/browser/loadQueue.test.mjs: the load queue (loadQueue.js) lets
// previews go at once, holds full-size downloads until they are done, and
// then sends those one at a time, the focused body's first.
// Run: node src/browser/loadQueue.test.mjs

import assert from 'node:assert/strict';
import { focusLoads, loadState, onLoadChange, queued, Rank } from './loadQueue.js';

let n = 0;
const ok = async (name, fn) => { await fn(); n++; console.log(`ok ${n} ${name}`); };
// Long enough for the queue's own task (a bulk job starts a task later).
const tick = () => new Promise((r) => setTimeout(() => setTimeout(r, 0), 0));

// A job that records when it starts and finishes when told.
function job(log, name, opts) {
  let finish, handle;
  const p = queued({ label: name, ...opts }, (h) => { log.push(name); handle = h; return new Promise((r) => { finish = r; }); });
  return { p, finish: () => finish(name), done: () => handle.done(), get started() { return log.includes(name); } };
}

await ok('first jobs start at once, side by side', async () => {
  const log = [];
  const a = job(log, 'a', { lane: 'first' }), b = job(log, 'b', { lane: 'first' });
  await tick();
  assert.deepEqual(log, ['a', 'b']);
  a.finish(); b.finish();
  await Promise.all([a.p, b.p]);
});

await ok('a bulk job waits for the first jobs, then bulk jobs go one at a time', async () => {
  const log = [];
  const pre = job(log, 'preview', { lane: 'first' });
  const x = job(log, 'x', { lane: 'bulk' }), y = job(log, 'y', { lane: 'bulk' });
  await tick();
  assert.deepEqual(log, ['preview']);
  pre.finish(); await pre.p; await tick();
  assert.deepEqual(log, ['preview', 'x']);
  x.finish(); await x.p; await tick();
  assert.deepEqual(log, ['preview', 'x', 'y']);
  y.finish(); await y.p;
});

await ok('done() frees the place before the job settles (decoding overlaps the next download)', async () => {
  const log = [];
  const x = job(log, 'x', { lane: 'bulk' }), y = job(log, 'y', { lane: 'bulk' });
  await tick();
  assert.deepEqual(log, ['x']);
  x.done(); await tick();
  assert.deepEqual(log, ['x', 'y']);
  x.finish(); y.finish();
  await Promise.all([x.p, y.p]);
});

await ok('a first job asked for while a bulk job downloads starts at once; the next bulk waits for both', async () => {
  const log = [];
  const big = job(log, 'big', { lane: 'bulk' });
  await tick();
  const pre = job(log, 'preview', { lane: 'first' }), next = job(log, 'next', { lane: 'bulk' });
  await tick();
  assert.deepEqual(log, ['big', 'preview']);
  big.finish(); await big.p; await tick();
  assert.ok(!next.started, 'the preview is still open');
  pre.finish(); await pre.p; await tick();
  assert.ok(next.started);
  next.finish(); await next.p;
});

await ok('bulk jobs go by rank, then in the order asked', async () => {
  const log = [];
  const hold = job(log, 'hold', { lane: 'first' });
  const belt = job(log, 'belt', { lane: 'bulk', rank: Rank.extra });
  const moon = job(log, 'moon', { lane: 'bulk', rank: Rank.seen });
  const sky = job(log, 'sky', { lane: 'bulk', rank: Rank.sky });
  const io = job(log, 'io', { lane: 'bulk', rank: Rank.seen });
  await tick(); hold.finish(); await hold.p;
  for (const j of [sky, moon, io, belt]) { await tick(); assert.ok(j.started); j.finish(); await j.p; }
  assert.deepEqual(log, ['hold', 'sky', 'moon', 'io', 'belt']);
});

await ok('within a rank, a lower order goes first (a body\'s day map before its relief)', async () => {
  const log = [];
  const hold = job(log, 'hold', { lane: 'first' });
  const relief = job(log, 'relief', { lane: 'bulk', order: 2 }), day = job(log, 'day', { lane: 'bulk', order: 0 });
  await tick(); hold.finish(); await hold.p;
  for (const j of [day, relief]) { await tick(); assert.ok(j.started); j.finish(); await j.p; }
  assert.deepEqual(log, ['hold', 'day', 'relief']);
});

await ok('the focused body\'s waiting jobs go first, and lose that when the focus moves on', async () => {
  const log = [];
  const hold = job(log, 'hold', { lane: 'first' });
  const sky = job(log, 'sky', { lane: 'bulk', rank: Rank.sky });
  const moon = job(log, 'moon', { lane: 'bulk', tag: 'moon' });
  const mars = job(log, 'mars', { lane: 'bulk', tag: 'mars' });
  focusLoads('moon');
  focusLoads('mars');
  await tick(); hold.finish(); await hold.p; await tick();
  assert.deepEqual(log, ['hold', 'mars']);
  for (const j of [mars, sky, moon]) { await tick(); j.finish(); await j.p; }
  assert.deepEqual(log, ['hold', 'mars', 'sky', 'moon']);
  // A job asked for while its body is the focus starts at the focus rank.
  const hold2 = job(log, 'hold2', { lane: 'first' });
  const s2 = job(log, 's2', { lane: 'bulk', rank: Rank.sky }), m2 = job(log, 'm2', { lane: 'bulk', tag: 'mars' });
  await tick(); hold2.finish(); await hold2.p; await tick();
  assert.ok(m2.started && !s2.started);
  m2.finish(); await m2.p; await tick(); s2.finish(); await s2.p;
  focusLoads(null);
});

await ok('a failing job gives up its place, and the state and listeners follow the queue', async () => {
  let calls = 0;
  const off = onLoadChange(() => { calls++; });
  const bad = queued({ label: 'bad', lane: 'bulk' }, () => Promise.reject(new Error('HTTP 404')));
  const log = [];
  const after = job(log, 'after', { lane: 'bulk' });
  await assert.rejects(bad, /404/);
  await tick();
  assert.ok(after.started);
  assert.deepEqual(loadState().open.map((j) => j.label), ['after']);
  after.finish(); await after.p; await tick();
  assert.deepEqual(loadState(), { open: [], waiting: [] });
  assert.ok(calls > 0);
  off();
});
