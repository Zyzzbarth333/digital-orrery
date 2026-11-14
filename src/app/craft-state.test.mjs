// src/app/craft-state.test.mjs: the header's word for a craft and the WARN
// light agree (craft-state.js). Run: node src/app/craft-state.test.mjs

import assert from 'node:assert/strict';
import { craftStateWord, craftLost, craftWarns } from './craft-state.js';

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${n} ${name}`); };

ok('a splashdown reads DOWN and lights nothing', () => {
  const orion = { crashed: true, splashed: true, error: null };
  assert.equal(craftStateWord(orion), 'Down');
  assert.equal(craftLost(orion), false);
  assert.equal(craftWarns(orion), false);
});

ok('a crash reads LOST and lights WARN', () => {
  const lander = { crashed: true, splashed: false, error: null };
  assert.equal(craftStateWord(lander), 'Lost');
  assert.equal(craftLost(lander), true);
  assert.equal(craftWarns(lander), true);
});

ok('a refused craft reads FAULT and lights WARN; flying ones read their phase', () => {
  assert.equal(craftStateWord({ crashed: false, error: 'kernel refused the burn' }), 'Fault');
  assert.equal(craftWarns({ crashed: false, error: 'kernel refused the burn' }), true);
  assert.equal(craftStateWord({ crashed: false }, { burning: true }), 'Burn');
  assert.equal(craftStateWord({ crashed: false }), 'Coast');
  assert.equal(craftStateWord({ crashed: false }, { climbing: true }), 'Climb');
  assert.equal(craftWarns({ crashed: false, error: null }), false);
});

console.log(`craft-state: ${n} passed`);
