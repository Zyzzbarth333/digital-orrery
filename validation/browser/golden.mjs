// validation/browser/golden.mjs: the golden snapshot's API part in a
// browser engine (gate.mjs), against validation/golden/api.json. Engines
// may round Math.sin, pow and exp differently from Node, and a flown
// trajectory grows those differences, so this only reports: how many
// numbers differ at all, and the largest relative difference. It fails
// only if the answers differ in kind (a string, a missing key, a null).
// Whether the physics still holds is the validations' job, at their own
// tolerances.

import '@digital-orrery/physics/deNode.js';
import { readFileSync } from 'node:fs';
import { apiSnapshot } from '../golden.api.mjs';

const { node: _recordedOn, ...want } = JSON.parse(readFileSync(new URL('../golden/api.json', import.meta.url), 'utf8'));
const got = apiSnapshot();
let failures = 0;
for (const section of Object.keys(want)) {
  let n = 0, differ = 0, worst = 0, at = '';
  const walk = (a, b, path) => {
    if (typeof a === 'number' && typeof b === 'number') {
      n++;
      if (Object.is(a, b)) return;
      differ++;
      const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), Number.MIN_VALUE);
      if (rel > worst) { worst = rel; at = path; }
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], `${path}.${k}`);
      return;
    }
    if (a !== b) { differ++; worst = Infinity; at = `${path} (${JSON.stringify(a)} -> ${JSON.stringify(b)})`; }
  };
  walk(want[section], got[section], section);
  const ok = Number.isFinite(worst);
  if (!ok) failures++;
  console.log(`  ${ok ? 'info' : 'FAIL'}  api ${section}: ${differ} of ${n} numbers differ from Node's${differ ? `; largest relative ${worst.toExponential(2)} at ${at}` : ''}`);
}
process.exitCode = failures ? 1 : 0;
