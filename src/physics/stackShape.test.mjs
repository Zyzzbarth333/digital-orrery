// The launchers' shapes for the scene (stackShape.js): their published
// sizes add up, and the stages fall away in order.
import assert from 'node:assert/strict';
import { stackShape, partsFrom } from './stackShape.js';
import { LAUNCHERS } from './launchers.js';

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`);
const sum = (parts) => parts.reduce((a, p) => a + p.length, 0);
const L = Object.fromEntries(LAUNCHERS.map((x) => [x.key, x]));

// Saturn V: 363 ft from the S-IC's base to the tower's tip (NASM), 33 ft across.
{
  const s = stackShape(L['saturn-v']);
  near(sum(s.parts), 363 * 0.3048, 1e-9, 'Saturn V total');
  near(s.parts[0].length, 138 * 0.3048, 1e-9, 'S-IC length');
  near(s.parts[0].diameter, 33 * 0.3048, 1e-9, 'S-IC diameter');
  assert.ok(s.published);
  const above = s.parts.slice(5).reduce((a, p) => a + p.length, 0);
  near(above, 16.5, 0.05, 'service module, command module and tower');
  console.log(`Saturn V: ${sum(s.parts).toFixed(2)} m, the 16.5 m above the adapter ${above.toFixed(2)} m`);
}
// Falcon 9: 70 m with the standard fairing (5.2 by 13.2 m); the stages
// share the rest by propellant volume.
for (const key of ['falcon-9', 'falcon-9-landing']) {
  const s = stackShape(L[key]);
  near(sum(s.parts), 70, 1e-9, `${key} total`);
  const fairing = s.parts.filter((p) => p.stage === undefined);
  near(sum(fairing), 13.2, 1e-9, `${key} fairing`);
  assert.equal(fairing[0].diameter, 5.2);
  const [a, b] = s.parts;
  near(a.length / b.length, 410.9 / 107.5, 1e-9, `${key} stage split`);
  console.log(`${key}: stages ${a.length.toFixed(1)} and ${b.length.toFixed(1)} m`);
}
// The landing preset burns less on the way up, but its tanks are the same.
near(stackShape(L['falcon-9-landing']).parts[0].length, stackShape(L['falcon-9']).parts[0].length, 1e-9, 'Falcon 9 first stage, either preset');
// Electron: 18 m, 1.2 m across, a 2.5 m fairing and a 405 mm kick stage.
{
  const s = stackShape(L.electron);
  near(sum(s.parts), 18, 1e-9, 'Electron total');
  assert.ok(s.parts.every((p) => p.diameter === 1.2));
  console.log(`Electron: stages ${s.parts[0].length.toFixed(2)} and ${s.parts[1].length.toFixed(2)} m`);
}
// A changed launcher, or a sized stack, is worked out from its stages:
// a tank's length grows with its propellant.
{
  const st = [{ name: 'A', prop: 400, isp: 311 }, { name: 'B', prop: 100, isp: 348 }];
  const s = stackShape({ key: 'falcon-9', stages: st, diameter: 3.7 }, { custom: true });
  assert.equal(s.published, false);
  assert.ok(s.parts[0].length > s.parts[1].length);
  const h = stackShape({ stages: [{ name: 'H', prop: 100, isp: 450 }], diameter: 4 });
  const d = stackShape({ stages: [{ name: 'D', prop: 100, isp: 320 }], diameter: 4 });
  near(h.parts[0].length - 4, (d.parts[0].length - 4) * 1030 / 320, 1e-9, 'hydrolox tank by density');
}
// Separation: each stage's parts go with it, the payload stays.
{
  const s = stackShape(L['saturn-v']);
  assert.equal(partsFrom(s, 1)[0].name, 'S-II');
  assert.equal(partsFrom(s, 2)[0].name, 'S-IVB');
  assert.equal(partsFrom(s, 3)[0].name, 'Spacecraft-LM adapter');
}
console.log('stackShape: ok');
