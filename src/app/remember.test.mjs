// src/app/remember.test.mjs: what the app keeps across a refresh
// (remember.js) reads back as it was written, and anything else falls back
// to the defaults rather than breaking the start.
// Run: node src/app/remember.test.mjs

import assert from 'node:assert/strict';
import { DEFAULT_LAYERS, parseLayers, parseType, parseView, readStore, resumeTime, writeStore, clearStore } from './remember.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

ok('no saved layers: the defaults', () => {
  assert.deepEqual(parseLayers(null), DEFAULT_LAYERS);
  assert.deepEqual(parseLayers('not json'), DEFAULT_LAYERS);
  assert.deepEqual(parseLayers('[1,2]'), DEFAULT_LAYERS);
});

ok('saved layers read back as written', () => {
  const l = structuredClone(DEFAULT_LAYERS);
  l.small.belt = false; l.small.colours = true; l.irregular = true; l.sites = true;
  l.sats.debris = true; l.probes = true; l.guides.magnetic = true; l.guides.flow = true;
  l.flow = { frame: 'rotating', plane: 'view' }; l.frame = 'ssb';
  assert.deepEqual(parseLayers(JSON.stringify(l)), l);
});

ok('a bad field falls back alone', () => {
  const l = parseLayers(JSON.stringify({ irregular: 'yes', sites: true, small: { belt: 0, neo: false, junk: true }, flow: { frame: 'sideways', plane: 'view' }, frame: 'galaxy' }));
  assert.equal(l.irregular, false);
  assert.equal(l.sites, true);
  assert.equal(l.small.belt, true);
  assert.equal(l.small.neo, false);
  assert.equal('junk' in l.small, false);
  assert.deepEqual(l.flow, { frame: 'falling', plane: 'view' });
  assert.equal(l.frame, 'sun');
});

ok('the defaults are not shared with what parseLayers returns', () => {
  const l = parseLayers(null);
  l.small.belt = false;
  assert.equal(DEFAULT_LAYERS.small.belt, true);
});

const view = { focus: 'mars', on: null, cam: { az: 1, el: -0.3, dist: 5e4, pan: [10, -20, 3] }, clock: { timeMs: 1.7e12, rate: 3600, playing: false }, savedAt: 1.7e12 };

ok('a saved view reads back as written', () => {
  assert.deepEqual(parseView(JSON.stringify(view)), view);
  assert.equal(parseView(JSON.stringify({ ...view, on: 'irr:himalia' })).on, 'irr:himalia');
});

ok('a broken view: none, or the parts that read', () => {
  assert.equal(parseView(null), null);
  assert.equal(parseView('{'), null);
  assert.equal(parseView(JSON.stringify({ cam: view.cam })), null);
  assert.equal(parseView(JSON.stringify({ ...view, cam: { ...view.cam, dist: -1 } })).cam, null);
  assert.equal(parseView(JSON.stringify({ ...view, cam: { ...view.cam, pan: [1, 2] } })).cam, null);
  assert.equal(parseView(JSON.stringify({ ...view, clock: { ...view.clock, rate: 'fast' } })).clock, null);
  assert.equal(parseView(JSON.stringify({ ...view, cam: { ...view.cam, az: null } })).cam, null);
});

ok('the clock: held stays, running goes on by at most a second', () => {
  const t = 1.7e12;
  assert.equal(resumeTime({ timeMs: t, rate: 86400, playing: false }, t, t + 5000), t);
  assert.equal(resumeTime({ timeMs: t, rate: 86400, playing: true }, t, t + 500), t + 0.5 * 86400e3);
  assert.equal(resumeTime({ timeMs: t, rate: 86400, playing: true }, t, t + 60e3), t + 86400e3);
  assert.equal(resumeTime({ timeMs: t - 3e10, rate: 1, playing: true }, t, t + 3000), t - 3e10 + 1000);
});

ok('a live clock comes back live', () => {
  const t = 1.7e12;
  assert.equal(resumeTime({ timeMs: t + 20e3, rate: 1, playing: true }, t, t + 3.6e6), t + 3.6e6);
});

ok('storage that throws is no storage', () => {
  const bad = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('no'); } };
  assert.equal(readStore(bad, 'k'), null);
  assert.doesNotThrow(() => writeStore(bad, 'k', 'v'));
  assert.doesNotThrow(() => clearStore(bad, 'k'));
  assert.equal(readStore(undefined, 'k'), null);
  const mem = new Map();
  const good = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  writeStore(good, 'k', 'v');
  assert.equal(readStore(good, 'k'), 'v');
  clearStore(good, 'k');
  assert.equal(readStore(good, 'k'), null);
});

ok('the TYPE step reads back as 1, 2 or 3, and anything else is 1', () => {
  assert.equal(parseType('2'), 2);
  assert.equal(parseType('3'), 3);
  for (const bad of [null, '', '1', '4', '1.5', 'large', '0']) assert.equal(parseType(bad), 1);
});

console.log(`${n} passed`);
